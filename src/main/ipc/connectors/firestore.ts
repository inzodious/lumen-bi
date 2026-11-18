/**
 * Cloud Firestore over its REST API (firestore.googleapis.com/v1, or the emulator's host).
 *
 * `listCollectionIds` lists collections (root or under a document); `runQuery` reads documents of a
 * collection or collection group with the folded filters and limit, paged with cursors: results are
 * ordered by the inequality fields (Firestore requires them first) and then by document name, and each
 * page starts after the previous page's last document. The caller authorizes requests (service
 * account / application default credentials / OAuth / API key / emulator owner token).
 */
import type { FirestoreDocument, FirestoreFilter, FirestoreValue } from '../../../core/m/host'
import { ConnectorError, DEFAULT_MAX_ROWS } from './common'

export interface FirestoreTarget {
  project: string
  database: string
  parent?: string
  emulator?: string
}

export interface FirestoreAuthorization {
  headers: Record<string, string>
  query?: Record<string, string>
}

export type Authorize = () => Promise<FirestoreAuthorization>

const PAGE_SIZE = 500

function baseUrl(t: FirestoreTarget): string {
  const root = t.emulator ? `http://${t.emulator.replace(/^https?:\/\//, '').replace(/\/+$/, '')}/v1` : 'https://firestore.googleapis.com/v1'
  return `${root}/projects/${encodeURIComponent(t.project)}/databases/${encodeURIComponent(t.database)}/documents`
}

function parentUrl(t: FirestoreTarget): string {
  const parent = t.parent ? `/${t.parent.split('/').map(encodeURIComponent).join('/')}` : ''
  return `${baseUrl(t)}${parent}`
}

async function call(t: FirestoreTarget, authorize: Authorize, url: string, body: unknown): Promise<unknown> {
  const auth = await authorize()
  const u = new URL(url)
  for (const [k, v] of Object.entries(auth.query ?? {})) u.searchParams.set(k, v)
  let res: Response
  try {
    res = await fetch(u, { method: 'POST', headers: { 'content-type': 'application/json', ...auth.headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(120_000) })
  } catch (e) {
    throw new ConnectorError(`Firestore wasn't reachable at ${u.host} (${(e as Error).message}).`)
  }
  const text = await res.text()
  let json: unknown = null
  try {
    json = JSON.parse(text)
  } catch {
    json = null
  }
  if (!res.ok) {
    const err = (Array.isArray(json) ? json[0] : json) as { error?: { message?: string; status?: string } } | null
    const msg = err?.error?.message ?? (text.slice(0, 300) || `HTTP ${res.status}`)
    if (res.status === 401 || res.status === 403) throw new ConnectorError(`Firestore denied access to project '${t.project}' (${msg}). Check the credentials in Data source settings ▸ Edit Permissions.`, 'credentials')
    if (res.status === 404) throw new ConnectorError(`Firestore: ${msg}`, 'notFound')
    // OR filters (folded from `or` in Table.SelectRows) need Firestore from 2023 on; older emulators reject them
    if (res.status === 400 && JSON.stringify(body).includes('"op":"OR"')) throw new ConnectorError(`Firestore: ${msg} (this Firestore endpoint may not support OR queries: update the emulator, or filter with Table.Buffer first)`)
    throw new ConnectorError(`Firestore: ${msg}`)
  }
  return json
}

export async function firestoreCollections(t: FirestoreTarget, authorize: Authorize): Promise<string[]> {
  const out: string[] = []
  let pageToken: string | undefined
  do {
    const r = (await call(t, authorize, `${parentUrl(t)}:listCollectionIds`, { pageSize: 300, ...(pageToken ? { pageToken } : {}) })) as { collectionIds?: string[]; nextPageToken?: string }
    out.push(...(r.collectionIds ?? []))
    pageToken = r.nextPageToken || undefined
  } while (pageToken)
  return out.sort()
}

/** Splits a field path into segments (back-quoted segments may contain dots). */
export function fieldPathSegments(path: string): string[] {
  const out: string[] = []
  let i = 0
  while (i < path.length) {
    if (path[i] === '`') {
      let s = ''
      i++
      while (i < path.length && path[i] !== '`') {
        if (path[i] === '\\') i++
        s += path[i++]
      }
      i++
      out.push(s)
    } else {
      const j = path.indexOf('.', i)
      out.push(path.slice(i, j < 0 ? undefined : j))
      i = j < 0 ? path.length : j
    }
    if (path[i] === '.') i++
  }
  return out
}

function valueAt(doc: FirestoreDocument, field: string): FirestoreValue {
  if (field === '__name__') return { referenceValue: doc.name }
  let cur: FirestoreValue | undefined = { mapValue: { fields: doc.fields ?? {} } }
  for (const seg of fieldPathSegments(field)) {
    cur = (((cur?.['mapValue'] ?? {}) as { fields?: Record<string, FirestoreValue> }).fields ?? {})[seg]
    if (!cur) return { nullValue: null }
  }
  return cur
}

const INEQUALITY = new Set(['LESS_THAN', 'LESS_THAN_OR_EQUAL', 'GREATER_THAN', 'GREATER_THAN_OR_EQUAL'])

/** The structured query for one page. */
export function structuredQuery(
  q: { collection: string; allDescendants?: boolean; filters?: FirestoreFilter[]; orderBy?: { field: string; desc: boolean }[] },
  limit: number,
  after?: FirestoreDocument
): Record<string, unknown> {
  const rest = (f: FirestoreFilter): Record<string, unknown> =>
    'filters' in f
      ? { compositeFilter: { op: f.op, filters: f.filters.map(rest) } }
      : f.op === 'IS_NOT_NULL'
        ? { unaryFilter: { field: { fieldPath: f.field }, op: 'IS_NOT_NULL' } }
        : { fieldFilter: { field: { fieldPath: f.field }, op: f.op, value: f.value } }
  const filters = (q.filters ?? []).map(rest)
  const order: { field: string; desc: boolean }[] = [...(q.orderBy ?? [])]
  // inequality fields (top level) are ordered too (Firestore orders by them implicitly; explicit for cursors)
  for (const f of q.filters ?? []) if ('field' in f && (INEQUALITY.has(f.op) || f.op === 'IS_NOT_NULL') && !order.some((o) => o.field === f.field)) order.push({ field: f.field, desc: false })
  if (!order.some((o) => o.field === '__name__')) order.push({ field: '__name__', desc: order.length ? order[order.length - 1]!.desc : false })
  const sq: Record<string, unknown> = {
    from: [{ collectionId: q.collection, allDescendants: !!q.allDescendants }],
    orderBy: order.map((o) => ({ field: { fieldPath: o.field }, direction: o.desc ? 'DESCENDING' : 'ASCENDING' })),
    limit
  }
  if (filters.length === 1) sq['where'] = filters[0]
  else if (filters.length > 1) sq['where'] = { compositeFilter: { op: 'AND', filters } }
  if (after) sq['startAt'] = { values: order.map((o) => valueAt(after, o.field)), before: false }
  return sq
}

export async function firestoreQuery(
  t: FirestoreTarget,
  authorize: Authorize,
  q: { collection: string; allDescendants?: boolean; filters?: FirestoreFilter[]; orderBy?: { field: string; desc: boolean }[]; limit?: number },
  maxDocs = DEFAULT_MAX_ROWS
): Promise<FirestoreDocument[]> {
  const out: FirestoreDocument[] = []
  const want = q.limit ?? Infinity
  let after: FirestoreDocument | undefined
  for (;;) {
    const size = Math.min(PAGE_SIZE, want - out.length)
    if (size <= 0) break
    const r = (await call(t, authorize, `${parentUrl(t)}:runQuery`, { structuredQuery: structuredQuery(q, size, after) })) as Array<{ document?: FirestoreDocument }>
    const docs = (r ?? []).map((x) => x.document).filter((d): d is FirestoreDocument => !!d)
    out.push(...docs)
    if (out.length > maxDocs) throw new ConnectorError(`The query returned more than ${maxDocs.toLocaleString()} documents (the row limit). Add a filter.`)
    if (docs.length < size) break
    after = docs[docs.length - 1]
  }
  return out
}

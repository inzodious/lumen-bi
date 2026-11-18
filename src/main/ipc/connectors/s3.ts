/**
 * S3-compatible object storage (AWS S3, MinIO / TrueNAS apps, Cloudflare R2, Backblaze B2, Garage, …)
 * over `@aws-sdk/client-s3`. Credentials: access key + secret (+ session token), a named profile from
 * ~/.aws, or the SDK's default chain (environment, SSO, instance roles). Listings are paged
 * (ListObjectsV2); object bodies are read whole.
 */
import { GetObjectCommand, ListObjectsV2Command, S3Client, type S3ClientConfig } from '@aws-sdk/client-s3'
import type { HostFileEntry } from '../../../core/m/host'
import type { CredentialAuth } from '../../../shared/host'
import { ConnectorError } from './common'

export interface S3Target {
  bucket: string
  endpoint?: string
  region?: string
  forcePathStyle?: boolean
  auth?: CredentialAuth
}

const clients = new Map<string, S3Client>()

function client(t: S3Target): S3Client {
  const a = t.auth
  const key = JSON.stringify([t.endpoint ?? '', t.region ?? '', !!t.forcePathStyle, a?.kind ?? '', a?.accessKeyId ?? '', a?.secretAccessKey ?? '', a?.sessionToken ?? '', a?.profile ?? ''])
  let c = clients.get(key)
  if (c) return c
  const cfg: S3ClientConfig = {
    region: t.region || (t.endpoint ? 'us-east-1' : process.env['AWS_REGION'] || 'us-east-1'),
    forcePathStyle: t.forcePathStyle ?? !!t.endpoint,
    // S3-compatible stores often don't implement the newer default checksums
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED'
  }
  if (t.endpoint) cfg.endpoint = /^https?:\/\//i.test(t.endpoint) ? t.endpoint : `https://${t.endpoint}`
  if (a?.kind === 'aws-keys') {
    if (!a.accessKeyId || !a.secretAccessKey) throw new ConnectorError('The access key ID and secret access key are both required (Data source settings ▸ Edit Permissions).', 'credentials')
    cfg.credentials = { accessKeyId: a.accessKeyId, secretAccessKey: a.secretAccessKey, ...(a.sessionToken ? { sessionToken: a.sessionToken } : {}) }
  } else if (a?.kind === 'aws-profile' && a.profile) cfg.profile = a.profile
  else if (a?.kind === 'anonymous') cfg.signer = { sign: async (req) => req }
  c = new S3Client(cfg)
  clients.set(key, c)
  return c
}

export function resetS3Clients(): void {
  for (const c of clients.values()) c.destroy()
  clients.clear()
}

function explain(e: unknown, t: S3Target): ConnectorError {
  const err = e as { name?: string; message?: string; Code?: string; $metadata?: { httpStatusCode?: number } }
  const code = err.name ?? err.Code ?? ''
  const status = err.$metadata?.httpStatusCode
  const msg = err.message || code || String(e)
  if (/InvalidAccessKeyId|SignatureDoesNotMatch|AccessDenied|InvalidToken|ExpiredToken|CredentialsProviderError|Could not load credentials/i.test(`${code} ${msg}`) || status === 403 || status === 401) {
    return new ConnectorError(`Access to the bucket '${t.bucket}' was denied (${msg}). Check the credentials in Data source settings ▸ Edit Permissions.`, 'credentials')
  }
  if (code === 'NoSuchBucket') return new ConnectorError(`The bucket '${t.bucket}' doesn't exist${t.endpoint ? ` on ${t.endpoint}` : ''}.`, 'notFound')
  if (code === 'NoSuchKey' || status === 404) return new ConnectorError(`${msg} (bucket '${t.bucket}').`, 'notFound')
  if (/ENOTFOUND|ECONNREFUSED|getaddrinfo/.test(msg)) return new ConnectorError(`The storage endpoint ${t.endpoint ?? 'Amazon S3'} wasn't reachable (${msg}).`)
  return new ConnectorError(msg)
}

/** Objects under `prefix` (recursive), or its direct children with folders (non-recursive). Paths are s3:// URLs. */
export async function s3List(t: S3Target, prefix: string, recursive: boolean): Promise<HostFileEntry[]> {
  const out: HostFileEntry[] = []
  let token: string | undefined
  try {
    do {
      const r = await client(t).send(new ListObjectsV2Command({ Bucket: t.bucket, Prefix: prefix || undefined, Delimiter: recursive ? undefined : '/', ContinuationToken: token }))
      for (const p of r.CommonPrefixes ?? []) {
        if (!p.Prefix) continue
        const dir = p.Prefix.replace(/\/$/, '')
        out.push({ name: dir.split('/').pop()!, path: `s3://${t.bucket}/${dir}`, isFolder: true })
      }
      for (const o of r.Contents ?? []) {
        if (!o.Key || o.Key.endsWith('/')) continue // folder markers
        const modified = o.LastModified?.getTime()
        out.push({ name: o.Key.split('/').pop()!, path: `s3://${t.bucket}/${o.Key}`, isFolder: false, size: o.Size, modified, created: modified, accessed: modified })
      }
      token = r.IsTruncated ? r.NextContinuationToken : undefined
    } while (token)
  } catch (e) {
    throw explain(e, t)
  }
  return out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
}

export async function s3Get(t: S3Target, key: string): Promise<Uint8Array> {
  try {
    const r = await client(t).send(new GetObjectCommand({ Bucket: t.bucket, Key: key }))
    if (!r.Body) return new Uint8Array()
    return await (r.Body as { transformToByteArray(): Promise<Uint8Array> }).transformToByteArray()
  } catch (e) {
    throw explain(e, t)
  }
}

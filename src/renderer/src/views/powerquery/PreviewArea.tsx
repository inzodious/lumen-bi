/**
 * Center area of the Power Query Editor: the preview of the selected query / step.
 *  - table → <TableGrid/> (+ column profile pane, error / value details pane)
 *  - list → "List" column with To Table; record → name / value pairs with Into Table
 *  - scalar → the value; parameter → current value + Manage Parameter
 *  - function → "Enter Parameters" form with Invoke (adds an invoked-function query, like PBI)
 *  - errors → Power BI's error banner ("Expression.Error: …", Details, Go To Error / Edit Credentials)
 */
import { useMemo, useState } from 'react'
import { DismissRegular, WarningFilled, ErrorCircleRegular, InfoRegular, TableRegular } from '@fluentui/react-icons'
import type { ErrorInfo, PreviewCell } from '@core/m/engine.ts'
import { parseExpression } from '@core/m/parser.ts'
import { dataSourcesOf } from '@core/data/queries'
import type { SemanticModel } from '@core/model/types'
import { Button, Spinner, TextField, cx } from '../../app/ui'
import { useApp } from '../../state/store'
import { formatCell } from './logic/format'
import { mIdent, mText } from './logic/mtext'
import * as T from './logic/transforms'
import { usePq, useSelectedQuery } from './pqStore'
import { openPqDialog } from './pqDialogs'
import { TableGrid } from './Grid'
import { ProfilePane } from './ProfilePane'
import { addSpec, newQuery, selectStep } from './actions'

const CREDENTIAL_RE = /login failed|AADSTS|credential|authenticat|sign[- ]?in|access token|unauthori[sz]ed|\b401\b|permission was denied/i

export function isCredentialError(e: ErrorInfo): boolean {
  return /^DataSource\./.test(e.reason) && CREDENTIAL_RE.test(`${e.message} ${e.detail ?? ''}`)
}

/** Data sources a query reads (for "Edit Credentials"). */
function sourcesOfQuery(name: string, source: string) {
  const model = { tables: [], relationships: [], expressions: [{ name, kind: 'm', expression: source }] } as unknown as SemanticModel
  const project = useApp.getState().project
  const own = dataSourcesOf(model)
  return own.length ? own : project ? dataSourcesOf(project.model) : []
}

function ErrorBanner({ error, atStep }: { error: ErrorInfo; atStep: string | null }) {
  const q = useSelectedQuery()
  const errorStep = usePq((s) => (q ? s.errorSteps[q.id] : undefined))
  if (!q) return null
  const cred = isCredentialError(error)
  const goto = errorStep && errorStep !== atStep ? errorStep : null
  return (
    <div className="wbi-pq-error">
      <div className={cx('wbi-pq-error__box', cred && 'is-cred')}>
        <WarningFilled fontSize={20} className="wbi-pq-error__icon" />
        <div className="wbi-pq-error__text">
          {cred ? (
            <>
              <div className="wbi-pq-error__title">Please specify how to connect.</div>
              <div className="wbi-pq-error__msg wbi-selectable">
                {error.reason}: {error.message}
              </div>
            </>
          ) : (
            <>
              <div className="wbi-pq-error__title wbi-selectable">
                {error.reason}: {error.message}
              </div>
              {error.detail && (
                <div className="wbi-pq-error__detail wbi-selectable">
                  <span>Details:</span>
                  <pre>{error.detail}</pre>
                </div>
              )}
            </>
          )}
        </div>
        <div className="wbi-pq-error__actions">
          {cred ? (
            <Button
              onClick={() => {
                const src = sourcesOfQuery(q.name, q.source)[0]
                if (src) openPqDialog({ id: 'credentials', source: src })
                else openPqDialog({ id: 'dataSources' })
              }}
            >
              Edit Credentials
            </Button>
          ) : goto ? (
            <Button onClick={() => selectStep(goto)}>Go To Error</Button>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function ValueCell({ v, onDrill }: { v: PreviewCell; onDrill?(): void }) {
  const d = formatCell(v)
  if (d.cls === 'nested' && onDrill)
    return (
      <span className={cx('wbi-pq-link-nested', `is-${d.nested?.toLowerCase()}`)} onClick={onDrill}>
        {d.text}
      </span>
    )
  if (d.cls === 'error') return <span className="wbi-pq-link-error" onClick={() => d.error && usePq.setState({ detail: { column: '', row: 0, error: d.error } })}>Error</span>
  return <span className={`wbi-pq-val is-${d.cls}`}>{d.text}</span>
}

function ListPreview({ items, truncated, count }: { items: PreviewCell[]; truncated: boolean; count: number }) {
  return (
    <div className="wbi-pq-structured">
      <div className="wbi-pq-tools">
        <span className="wbi-pq-tools__label">List Tools</span>
        <Button size="small" icon={<TableRegular fontSize={16} />} onClick={() => void addSpec(T.listToTable())}>
          To Table
        </Button>
      </div>
      <div className="wbi-pq-grid wbi-pq-grid--simple">
        <div className="wbi-pq-tr wbi-pq-tr--head">
          <div className="wbi-pq-corner" style={{ width: 44 }} />
          <div className="wbi-pq-th" style={{ width: 260 }}>
            <span className="wbi-pq-th__name">List</span>
          </div>
        </div>
        {items.map((v, i) => (
          <div key={i} className="wbi-pq-tr wbi-pq-tr--static">
            <div className="wbi-pq-rownum" style={{ width: 44 }}>
              {i + 1}
            </div>
            <div className={cx('wbi-pq-td', `is-${formatCell(v).cls}`)} style={{ width: 260 }}>
              <ValueCell v={v} onDrill={() => void addSpec(T.drillDownItem(i))} />
            </div>
          </div>
        ))}
        {truncated && <div className="wbi-pq-more">Showing the first {items.length} of {count} items.</div>}
      </div>
    </div>
  )
}

function RecordPreview({ fields }: { fields: Array<{ name: string; value: PreviewCell }> }) {
  return (
    <div className="wbi-pq-structured">
      <div className="wbi-pq-tools">
        <span className="wbi-pq-tools__label">Record Tools</span>
        <Button size="small" icon={<TableRegular fontSize={16} />} onClick={() => void addSpec(T.recordToTable())}>
          Into Table
        </Button>
      </div>
      <div className="wbi-pq-record">
        {fields.map((f) => (
          <div key={f.name} className="wbi-pq-record__row">
            <div className="wbi-pq-record__name">{f.name}</div>
            <div className={cx('wbi-pq-record__value', `is-${formatCell(f.value).cls}`)}>
              <ValueCell v={f.value} onDrill={() => void addSpec(T.drillDownField(f.name))} />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

interface FnParam {
  name: string
  optional: boolean
  type?: string
}

function functionParams(source: string): { params: FnParam[]; signature: string } | null {
  try {
    let e = parseExpression(source)
    if (e.t === 'meta') e = e.expr
    if (e.t === 'let') {
      // `let f = (x) => … in f`
      const body = e.body
      const b = body.t === 'ident' ? e.bindings.find((x) => x.name === body.name) : undefined
      if (b) e = b.expr
    }
    if (e.t !== 'func') return null
    const params = e.params.map((p) => ({ name: p.name, optional: p.optional, type: p.type && p.type.k === 'prim' ? p.type.name : undefined }))
    const sig = `function (${params.map((p) => `${p.optional ? 'optional ' : ''}${p.name}${p.type ? ` as ${p.type}` : ''}`).join(', ')}) as any`
    return { params, signature: sig }
  } catch {
    return null
  }
}

function argLiteral(v: string, type?: string): string {
  const t = v.trim()
  if (!t) return 'null'
  if (type === 'number' && Number.isFinite(Number(t))) return t
  if (type === 'logical' && /^(true|false)$/i.test(t)) return t.toLowerCase()
  if (type === 'text') return mText(v)
  if (!type || type === 'any') return Number.isFinite(Number(t)) ? t : mText(v)
  return mText(v)
}

function FunctionPreview() {
  const q = useSelectedQuery()
  const info = useMemo(() => (q ? functionParams(q.source) : null), [q])
  const [vals, setVals] = useState<Record<string, string>>({})
  if (!q) return null
  const params = info?.params ?? []
  const missing = params.some((p) => !p.optional && !(vals[p.name] ?? '').trim())
  return (
    <div className="wbi-pq-fn">
      <div className="wbi-pq-fn__title">Enter Parameter{params.length === 1 ? '' : 's'}</div>
      {params.map((p) => (
        <TextField
          key={p.name}
          label={`${p.name}${p.optional ? ' (optional)' : ''}`}
          hint={p.type ? `Type: ${p.type}` : undefined}
          value={vals[p.name] ?? ''}
          onChange={(v) => setVals((s) => ({ ...s, [p.name]: v }))}
          placeholder={p.type === 'text' ? 'Example: abc' : p.type === 'number' ? 'Example: 123' : ''}
        />
      ))}
      <div className="wbi-pq-fn__buttons">
        <Button
          variant="primary"
          disabled={missing}
          onClick={() => {
            let args = params.map((p) => argLiteral(vals[p.name] ?? '', p.type))
            while (args.length && args[args.length - 1] === 'null' && params[args.length - 1]?.optional) args = args.slice(0, -1)
            const name = `Invoked Function${q.name.replace(/[^A-Za-z0-9]/g, '')}`
            newQuery({ name: uniqueName(name), kind: 'query', source: `let\n    Source = ${mIdent(q.name)}(${args.join(', ')})\nin\n    Source`, loadEnabled: true })
          }}
        >
          Invoke
        </Button>
        <Button onClick={() => setVals({})}>Clear</Button>
      </div>
      {info && <div className="wbi-pq-fn__sig">{info.signature}</div>}
    </div>
  )
}

function uniqueName(base: string): string {
  const taken = new Set(usePq.getState().draft.queries.map((x) => x.name.toLowerCase()))
  if (!taken.has(base.toLowerCase())) return base
  for (let n = 2; ; n++) if (!taken.has(`${base} (${n})`.toLowerCase())) return `${base} (${n})`
}

function DetailPane() {
  const detail = usePq((s) => s.detail)
  if (!detail?.error) return null
  const e = detail.error
  return (
    <div className="wbi-pq-details">
      <button type="button" className="wbi-pq-details__close" aria-label="Close" onClick={() => usePq.setState({ detail: null })}>
        <DismissRegular fontSize={14} />
      </button>
      <ErrorCircleRegular fontSize={18} className="wbi-pq-details__icon" />
      <div className="wbi-selectable">
        <div className="wbi-pq-details__title">
          {e.reason}: {e.message}
        </div>
        {e.detail && (
          <div className="wbi-pq-details__detail">
            Details:
            <pre>{e.detail}</pre>
          </div>
        )}
      </div>
    </div>
  )
}

export function PreviewArea() {
  const q = useSelectedQuery()
  const preview = usePq((s) => s.preview)
  const profile = usePq((s) => s.view.profile)
  if (!q) return <div className="wbi-pq-empty">No queries. Use New Source to add one.</div>
  const res = preview.queryId === q.id ? preview.result : null
  if (!res) return <div className="wbi-pq-loading">{preview.running && <Spinner size="large" label={preview.waiting ? `Waiting for ${preview.waiting}…` : 'Evaluating…'} />}</div>
  const r = res.result
  const stale = preview.running
  let body
  if (!r.ok) body = <ErrorBanner error={r.error} atStep={res.step} />
  else {
    const p = r.preview
    if (p.kind === 'table') {
      body = (
        <div className="wbi-pq-tablearea">
          <TableGrid data={p} queryId={q.id} />
          {profile && <ProfilePane data={p} />}
        </div>
      )
    } else if (p.kind === 'list') body = <ListPreview items={p.items} truncated={p.truncated} count={p.count} />
    else if (p.kind === 'record') body = <RecordPreview fields={p.fields} />
    else if (p.kind === 'function') body = <FunctionPreview />
    else
      body = (
        <div className="wbi-pq-scalar">
          <div className="wbi-pq-scalar__value wbi-selectable">{formatCell(p.value, p.kind === 'date' ? 'date' : p.kind === 'datetime' ? 'datetime' : p.kind === 'datetimezone' ? 'datetimezone' : p.kind === 'time' ? 'time' : 'any').text}</div>
          {q.kind === 'parameter' && (
            <Button className="wbi-pq-scalar__btn" onClick={() => openPqDialog({ id: 'parameters', queryId: q.id })}>
              Manage Parameter
            </Button>
          )}
        </div>
      )
  }
  return (
    <div className={cx('wbi-pq-previewarea', stale && 'is-stale')}>
      {res.warnings?.map((w) => (
        <div key={w} className="wbi-pq-notice" role="status">
          <InfoRegular fontSize={16} /> <span className="wbi-selectable">{w}</span>
        </div>
      ))}
      {body}
      <DetailPane />
      {stale && (
        <div className="wbi-pq-overlay">
          <Spinner label={preview.waiting ? `Waiting for ${preview.waiting}…` : 'Evaluating…'} />
        </div>
      )}
    </div>
  )
}

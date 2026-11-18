/**
 * PBI "Refresh" dialog: one row per table with its live state (Evaluating… / N rows loaded / error),
 * Cancel (aborts) while running, Close when done. Failed tables can be filled with sample data.
 * Like PBI's load dialog it closes by itself when every table loaded; it stays open on errors / cancellation.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { refreshHost } from '../views/powerquery/credentials'
import { CheckmarkCircleRegular, ErrorCircleRegular, CircleRegular, DismissCircleRegular } from '@fluentui/react-icons'
import { refreshProject } from '@core/data/refresh'
import { useApp } from '../state/store'
import { useShell } from '../app/shellState'
import { useSampleData } from '../app/commands'
import { Button, Modal, ProgressBar, Spinner } from '../app/ui'

type RowState = { state: 'queued' | 'running' | 'done' | 'error' | 'cancelled'; detail?: string }

/** Tables refreshed by default: non-calculated tables with an M / query partition. */
export function refreshableTables(model: { tables: Array<{ name: string; calculationGroup?: unknown; partitions: Array<{ sourceType: string }> }> }): string[] {
  return model.tables.filter((t) => !t.calculationGroup && t.partitions.some((p) => p.sourceType === 'm' || p.sourceType === 'query' || p.sourceType === 'entity')).map((t) => t.name)
}

/** Errors that mean "fix the credentials" (auth failures from SQL / HTTP / cloud connectors). */
const CREDENTIAL_ERROR = /credential|authenticat|unauthori[sz]ed|sign[- ]?in|log ?in failed|login failed|password|access denied|\b401\b|\b403\b|token/i

export function RefreshDialog({ tables: requested, onClose }: { tables?: string[]; onClose(): void }) {
  const project = useApp((s) => s.project)
  const tables = useMemo(() => (requested?.length ? requested : project ? refreshableTables(project.model) : []), [requested, project])
  const [rows, setRows] = useState<Record<string, RowState>>(() => Object.fromEntries(tables.map((t) => [t, { state: 'queued' as const }])))
  const [running, setRunning] = useState(true)
  const [fatal, setFatal] = useState<string | null>(null)
  const [cancelling, setCancelling] = useState(false)
  const abort = useRef<AbortController | null>(null)
  const started = useRef(false)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    if (started.current) return
    started.current = true
    const p = useApp.getState().project
    if (!p || !tables.length) {
      setRunning(false)
      if (!tables.length) setFatal('There are no tables to refresh.')
      return
    }
    const ctl = new AbortController()
    abort.current = ctl
    refreshProject(p, refreshHost(), {
      tables,
      signal: ctl.signal,
      onProgress: (table, state, detail) => setRows((r) => ({ ...r, [table]: { state: state === 'running' ? 'running' : state === 'done' ? 'done' : 'error', detail } }))
    })
      .then((res) => {
        setRows((r) => {
          const next = { ...r }
          for (const t of res.tables) next[t.table] = t.ok ? { state: 'done', detail: `${(t.rows ?? 0).toLocaleString()} rows loaded` } : { state: 'error', detail: t.error ?? 'Failed' }
          return next
        })
        useApp.getState().dataChanged()
        if (res.tables.every((t) => t.ok)) {
          useShell.getState().setDataNotice(null)
          if (!ctl.signal.aborted) onCloseRef.current()
        } else useShell.getState().setDataNotice({ kind: 'refreshErrors', tables: res.tables.filter((t) => !t.ok).map((t) => t.table) })
      })
      .catch((e) => {
        if (ctl.signal.aborted) {
          setRows((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v.state === 'done' || v.state === 'error' ? v : { state: 'cancelled' as const }])))
          useApp.getState().dataChanged()
        } else setFatal(e instanceof Error ? e.message : String(e))
      })
      .finally(() => setRunning(false))
  }, [tables])

  const cancel = () => {
    setCancelling(true)
    abort.current?.abort()
  }

  const list = Object.entries(rows)
  const done = list.filter(([, r]) => r.state === 'done' || r.state === 'error' || r.state === 'cancelled').length
  const failed = list.filter(([, r]) => r.state === 'error').map(([t]) => t)
  const anyFailed = failed.length > 0 || !!fatal
  // credential / sign-in failures: offer PBI's "Edit credentials" path (Data source settings)
  const credentialError = [fatal, ...list.filter(([, r]) => r.state === 'error').map(([, r]) => r.detail)].some((d) => !!d && CREDENTIAL_ERROR.test(d))

  return (
    <Modal
      title="Refresh"
      onClose={() => (running ? cancel() : onClose())}
      width={560}
      footerLeft={
        !running && anyFailed ? (
          <>
            {credentialError && (
              <Button variant="primary" onClick={() => useShell.getState().openDialog({ id: 'dataSources' })}>
                Edit credentials…
              </Button>
            )}
            <Button
              onClick={() => {
                onClose()
                useSampleData()
              }}
            >
              Use sample data for tables without data
            </Button>
          </>
        ) : null
      }
      footer={
        running ? (
          <Button disabled={cancelling} onClick={cancel}>
            {cancelling ? 'Cancelling…' : 'Cancel'}
          </Button>
        ) : (
          <Button variant="primary" onClick={onClose}>
            Close
          </Button>
        )
      }
    >
      <div className="wbi-col" style={{ gap: 12 }}>
        <div className="wbi-row">
          {running ? <Spinner label={cancelling ? 'Cancelling refresh…' : `Refreshing ${tables.length} table${tables.length === 1 ? '' : 's'}…`} /> : <span style={{ fontWeight: 600 }}>{fatal ? 'Refresh failed' : failed.length ? `Refresh finished with ${failed.length} error${failed.length === 1 ? '' : 's'}` : 'Refresh complete'}</span>}
        </div>
        {running && <ProgressBar value={tables.length ? done / tables.length : undefined} />}
        {fatal && <div className="wbi-dlg-error">{fatal}</div>}
        {list.length > 0 && (
          <div className="wbi-refresh__list">
            {list.map(([t, r]) => (
              <div key={t} className="wbi-refresh__row">
                <span className="wbi-refresh__icon">
                  {r.state === 'running' ? (
                    <span className="wbi-spinner" style={{ width: 14, height: 14 }} />
                  ) : r.state === 'done' ? (
                    <CheckmarkCircleRegular className="wbi-refresh__ok" fontSize={16} />
                  ) : r.state === 'error' ? (
                    <ErrorCircleRegular className="wbi-refresh__err" fontSize={16} />
                  ) : r.state === 'cancelled' ? (
                    <DismissCircleRegular fontSize={16} />
                  ) : (
                    <CircleRegular fontSize={16} color="var(--wbi-fg-4)" />
                  )}
                </span>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="wbi-refresh__name">{t}</div>
                  <div className={`wbi-refresh__detail${r.state === 'error' ? ' is-error' : ''}`}>
                    {r.state === 'queued' ? (fatal ? 'Not refreshed' : 'Waiting…') : r.state === 'running' ? r.detail ?? 'Evaluating…' : r.state === 'cancelled' ? 'Cancelled' : r.detail ?? (r.state === 'done' ? 'Loaded' : 'Failed')}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  )
}

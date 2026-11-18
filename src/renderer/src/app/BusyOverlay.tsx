/**
 * Modal progress overlay for long operations (opening PBIX/PBIP, saving, exporting): PBI-style
 * white card with spinner, message and a determinate bar when progress is known.
 */
import { useApp } from '../state/store'
import { ProgressBar, Spinner } from './ui/primitives'

export function BusyOverlay() {
  const busy = useApp((s) => s.busy)
  if (!busy) return null
  const pct = busy.progress !== undefined && Number.isFinite(busy.progress) ? Math.round(busy.progress * 100) : undefined
  return (
    <div className="wbi-modal-backdrop wbi-busy" role="alertdialog" aria-busy="true" aria-label={busy.message}>
      <div className="wbi-busy__card">
        <div className="wbi-row" style={{ gap: 12 }}>
          <Spinner size="large" />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="wbi-busy__title">{busy.message}</div>
            {pct !== undefined && <div className="wbi-muted">{pct}%</div>}
          </div>
        </div>
        <ProgressBar value={busy.progress} className="wbi-busy__bar" />
      </div>
    </div>
  )
}

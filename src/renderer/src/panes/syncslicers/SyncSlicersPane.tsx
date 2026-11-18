/**
 * Sync slicers pane: for the selected slicer, a page × (Sync, Visible) grid plus Advanced options
 * (group name, sync field changes, sync filter changes). Writes PBIR `visual.syncGroup` (sync.ts).
 */
import { useMemo, useState } from 'react'
import { ArrowSyncRegular, EyeRegular, ChevronDownRegular, ChevronRightRegular } from '@fluentui/react-icons'
import { useApp } from '../../state/store'
import { findPage, findVisual, isSlicerType, visualTypeOf } from '../../report/pbir'
import { PaneFrame } from '../PaneFrame'
import { Checkbox, TextField, Tip, cx } from '../../app/ui'
import { setGroupOptions, setPageSync, setPageVisible, syncAllPages, syncState } from './sync'
import '../selection/selection.css'
import './syncslicers.css'

export function SyncSlicersPane() {
  const report = useApp((s) => s.project?.report)
  const activePage = useApp((s) => s.activePage)
  const selected = useApp((s) => s.selectedVisuals)
  const mutate = useApp((s) => s.mutateReport)
  const [advanced, setAdvanced] = useState(true)
  const [groupDraft, setGroupDraft] = useState<string | null>(null)
  const page = findPage(report, activePage)
  const visual = selected.length === 1 ? findVisual(page, selected[0]) : undefined
  const isSlicer = !!visual && isSlicerType(visualTypeOf(visual))
  const state = useMemo(() => (report && page && visual && isSlicer ? syncState(report, page.name, visual.name) : undefined), [report, page, visual, isSlicer])
  const edit = (label: string, fn: (r: NonNullable<typeof report>) => void) => mutate(label, fn)

  return (
    <PaneFrame id="syncSlicers" title="Sync slicers">
      {!state || !page || !visual ? (
        <div className="wbi-pane__empty">Select a slicer to see sync options.</div>
      ) : (
        <div className="wbi-sync">
          <div className="wbi-sync__head">
            <span className="wbi-sync__page">Page</span>
            <Tip title="Sync">
              <span className="wbi-sync__col" aria-label="Sync">
                <ArrowSyncRegular fontSize={16} />
              </span>
            </Tip>
            <Tip title="Visible">
              <span className="wbi-sync__col" aria-label="Visible">
                <EyeRegular fontSize={16} />
              </span>
            </Tip>
          </div>
          {state.rows.map((r) => (
            <div key={r.page} className={cx('wbi-sync__row', r.isSource && 'is-current')}>
              <span className="wbi-sync__page" title={r.displayName}>
                {r.displayName}
              </span>
              <span className="wbi-sync__col">
                <Checkbox checked={r.synced} title={`Sync on ${r.displayName}`} onChange={(on) => edit('Sync slicers', (rep) => setPageSync(rep, page.name, visual.name, r.page, on))} />
              </span>
              <span className="wbi-sync__col">
                <Checkbox checked={r.visible} title={`Visible on ${r.displayName}`} onChange={(on) => edit('Sync slicers', (rep) => setPageVisible(rep, page.name, visual.name, r.page, on))} />
              </span>
            </div>
          ))}
          <button type="button" className="wbi-link wbi-sync__all" onClick={() => edit('Sync slicers', (rep) => syncAllPages(rep, page.name, visual.name))}>
            Add and sync with all pages
          </button>
          <div className="wbi-sync__adv">
            <button type="button" className="wbi-sync__advhead" onClick={() => setAdvanced((a) => !a)} aria-expanded={advanced}>
              {advanced ? <ChevronDownRegular fontSize={12} /> : <ChevronRightRegular fontSize={12} />} Advanced options
            </button>
            {advanced && (
              <div className="wbi-col" style={{ padding: '4px 12px 12px' }}>
                <div className="wbi-muted">Enter a group name. Slicers with the same group name are synced.</div>
                <TextField
                  size="small"
                  value={groupDraft ?? state.groupName}
                  onChange={setGroupDraft}
                  onCommit={(v) => {
                    setGroupDraft(null)
                    if (v.trim() && v.trim() !== state.groupName) edit('Sync group', (rep) => setGroupOptions(rep, page.name, visual.name, { groupName: v.trim() }))
                  }}
                />
                <Checkbox checked={state.fieldChanges} label="Sync field changes to other slicers" onChange={(on) => edit('Sync group', (rep) => setGroupOptions(rep, page.name, visual.name, { fieldChanges: on }))} />
                <Checkbox checked={state.filterChanges} label="Sync filter changes to other slicers" onChange={(on) => edit('Sync group', (rep) => setGroupOptions(rep, page.name, visual.name, { filterChanges: on }))} />
              </div>
            )}
          </div>
        </div>
      )}
    </PaneFrame>
  )
}

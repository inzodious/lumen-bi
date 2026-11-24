/**
 * Animation pane (Lumen only): everything that moves on the open page in one place.
 *  - Page: this page's transition, its duration and curve, and the stagger between visuals entering it;
 *  - Sequence: the visuals that enter, in the order they enter, each with a bar on a shared timeline. Drag a row to
 *    change the order (stored as each visual's `order`), "Reset order" goes back to reading order;
 *  - the selected visual: entrance, start (with / after the previous visual), delay, duration, curve, data changes,
 *    hover effect and whether it stays fixed during page transitions;
 *  - Report: the defaults every page and visual starts from.
 * Play runs the page's transition and the whole sequence on the canvas, with a playhead over the timeline.
 * Settings are Lumen_Motion annotations (core/report/motion.ts), which Power BI keeps and ignores.
 */
import { useMemo, useState } from 'react'
import { ArrowResetRegular, PinRegular, PlayRegular, ReOrderDotsVerticalRegular } from '@fluentui/react-icons'
import {
  MOTION_EASINGS,
  MOTION_LIMITS,
  PAGE_TRANSITIONS,
  clearSequence,
  pageMotion,
  pageTransitionTiming,
  reportMotion,
  setPageMotion,
  setReportMotion,
  setSequence,
  setVisualMotion,
  visualMotion,
  type BookmarkMotion,
  type DrillthroughMotion,
  type MotionEasing,
  type PageMotion,
  type PageTransition,
  type ReportMotion,
  type VisualEntrance,
  type VisualMotion
} from '@core/report/motion'
import { useApp } from '../../state/store'
import { findPage, findVisual, isGroup } from '../../report/pbir'
import { PaneFrame } from '../PaneFrame'
import { CollapsibleCard, Dropdown, Tip, Toggle, cx } from '../../app/ui'
import { SpinField } from '../visualizations/controls'
import { BOOKMARK_OPTIONS, DRILL_OPTIONS, ENTRANCES, HoverRows, Note, POWER_BI_NOTE, Row, TRANSITION_LABELS, previewMotion } from '../visualizations/MotionCards'
import { layerName } from '../selection/layers'
import { typeDisplayName } from '../selection/SelectionPane'
import { replayMotion, useMotionAllowed } from '../../report/motion/env'
import { pageSchedule, sequenceVisuals } from '../../report/motion/sequence'
import './animation.css'

const SEQ_MIME = 'application/x-lumen-sequence'

export const EASING_LABELS: Record<MotionEasing, string> = {
  smooth: 'Smooth',
  linear: 'Linear',
  'ease-in': 'Ease in (speeds up)',
  'ease-out': 'Ease out (slows down)',
  'ease-in-out': 'Ease in and out',
  overshoot: 'Overshoot'
}

const easingOptions = (def?: MotionEasing) => [
  ...(def ? [{ value: 'default' as const, label: `Default (${EASING_LABELS[def]})` }] : []),
  ...MOTION_EASINGS.map((e) => ({ value: e, label: EASING_LABELS[e] }))
]

const seconds = (ms: number) => `${(ms / 1000).toFixed(ms % 100 ? 2 : 1)} s`

export function AnimationPane() {
  const project = useApp((s) => s.project)
  const activePage = useApp((s) => s.activePage)
  const selected = useApp((s) => s.selectedVisuals)
  const selectVisuals = useApp((s) => s.selectVisuals)
  const mutate = useApp((s) => s.mutateReport)
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const [playing, setPlaying] = useState(0)
  const reportJson = project?.report?.report
  const page = findPage(project?.report, activePage)
  const rm = reportMotion(reportJson)
  const pm: PageMotion = page ? pageMotion(page.json) : {}
  const schedule = useMemo(() => (page ? pageSchedule(reportJson, page) : new Map()), [page, reportJson])
  const rows = [...schedule.values()]
  const total = Math.max(1, ...rows.map((r) => r.end))
  const still = useMemo(() => (page ? sequenceVisuals(page).filter((v) => !schedule.has(v.name)) : []), [page, schedule])
  const timing = page ? pageTransitionTiming(reportJson, page.json) : null
  const allowed = useMotionAllowed()

  const setReport = (label: string, patch: Partial<ReportMotion>) =>
    mutate(label, (r) => {
      r.report ??= {}
      setReportMotion(r.report, patch)
    })
  const setPage = (label: string, patch: PageMotion) =>
    mutate(label, (r) => {
      const p = findPage(r, activePage)
      if (p) setPageMotion(p.json, patch)
    })
  const setVisual = (name: string, label: string, patch: VisualMotion) =>
    mutate(label, (r) => {
      const v = findVisual(findPage(r, activePage), name)
      if (v) setVisualMotion(v.json, patch)
    })
  const reorder = (src: string, before: string | null) =>
    mutate('Animation order', (r) => {
      const p = findPage(r, activePage)
      if (!p) return
      const names = rows.map((x) => x.name).filter((n) => n !== src)
      const at = before ? names.indexOf(before) : names.length
      names.splice(at < 0 ? names.length : at, 0, src)
      setSequence(p.visuals, names)
    })
  const play = () => {
    if (!timing || !allowed) return
    previewMotion(timing.kind, timing.duration, timing.easing)
    setPlaying((n) => n + 1)
  }

  const sel = selected.length === 1 ? findVisual(page, selected[0]) : undefined
  const selMotion = sel ? visualMotion(sel.json) : undefined
  const selAt = sel ? schedule.get(sel.name) : undefined
  const nameOf = (n: string) => {
    const v = findVisual(page, n)
    return v ? layerName(v, typeDisplayName) : n
  }

  const toolbar = page && (
    <div className="wbi-anim__toolbar">
      <button type="button" className="wbi-btn wbi-anim__play" disabled={!allowed} onClick={play} aria-label="Play">
        <PlayRegular fontSize={16} />
        <span>Play</span>
      </button>
      <span className="wbi-anim__total" title="When the last visual has finished entering">
        {rows.length ? seconds(total) : ''}
      </span>
      <span className="wbi-sel__spacer" />
      <Tip title="Back to reading order (top to bottom, left to right)">
        <button type="button" className="wbi-link" disabled={!page.visuals.some((v) => visualMotion(v.json).order !== undefined)} onClick={() => mutate('Reset animation order', (r) => clearSequence(findPage(r, activePage)?.visuals ?? []))}>
          <ArrowResetRegular fontSize={14} /> Reset order
        </button>
      </Tip>
    </div>
  )

  return (
    <PaneFrame id="animation" title="Animation" className="wbi-anim">
      {!page ? (
        <div className="wbi-pane__empty">Open a report page to set how it animates.</div>
      ) : (
        <div className="wbi-anim__body">
          {toolbar}
          {!allowed ? <Note text="Your system asks for reduced motion, so Lumen doesn't play animations in this window." /> : null}
          {!rm.animate ? <Note text="Animate visuals is off for this report (Report, below), so visuals don't enter or animate." /> : null}

          <CollapsibleCard title="Page" defaultOpen>
            <Row label="Transition">
              <Dropdown
                size="small"
                title="Page transition"
                value={pm.transition ?? 'default'}
                options={[{ value: 'default' as const, label: `Report default (${TRANSITION_LABELS[rm.transition]})` }, ...PAGE_TRANSITIONS.map((t) => ({ value: t, label: TRANSITION_LABELS[t] }))]}
                onChange={(v) => setPage('Page transition', { transition: v === 'default' ? undefined : (v as PageTransition) })}
              />
            </Row>
            <Row label="Transition duration (ms)">
              <SpinField label="Transition duration (ms)" integer step={50} value={pm.transitionDuration} placeholder={`${rm.transitionDuration} (report)`} min={MOTION_LIMITS.transitionDuration[0]} max={MOTION_LIMITS.transitionDuration[1]} onChange={(v) => setPage('Transition duration', { transitionDuration: v })} />
            </Row>
            <Row label="Transition curve">
              <Dropdown size="small" title="Transition curve" value={pm.transitionEasing ?? 'default'} options={easingOptions(rm.transitionEasing)} onChange={(v) => setPage('Transition curve', { transitionEasing: v === 'default' ? undefined : (v as MotionEasing) })} />
            </Row>
            <Row label="Stagger between visuals (ms)">
              <SpinField label="Stagger between visuals (ms)" integer step={10} value={pm.stagger} placeholder={`${rm.stagger} (report)`} min={MOTION_LIMITS.stagger[0]} max={MOTION_LIMITS.stagger[1]} onChange={(v) => setPage('Animation stagger', { stagger: v })} />
            </Row>
          </CollapsibleCard>

          <CollapsibleCard title="Sequence" defaultOpen>
            <div className="wbi-anim__list" role="list" aria-label="Animation sequence">
              {!rows.length && <div className="wbi-pane__empty">Nothing on this page enters with an animation.</div>}
              {rows.map((r) => {
                const isSel = selected.includes(r.name)
                return (
                  <div
                    key={r.name}
                    role="listitem"
                    data-visual={r.name}
                    className={cx('wbi-anim__row', isSel && 'is-selected', dropTarget === r.name && 'is-drop')}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData(SEQ_MIME, r.name)
                      e.dataTransfer.effectAllowed = 'move'
                    }}
                    onDragOver={(e) => {
                      if (!e.dataTransfer.types.includes(SEQ_MIME)) return
                      e.preventDefault()
                      setDropTarget(r.name)
                    }}
                    onDragLeave={() => setDropTarget(null)}
                    onDrop={(e) => {
                      e.preventDefault()
                      setDropTarget(null)
                      const src = e.dataTransfer.getData(SEQ_MIME)
                      if (src && src !== r.name) reorder(src, r.name)
                    }}
                    onClick={() => selectVisuals([r.name])}
                  >
                    <span className="wbi-anim__grip" aria-hidden>
                      <ReOrderDotsVerticalRegular fontSize={14} />
                    </span>
                    <span className="wbi-anim__num">{r.index + 1}</span>
                    <span className="wbi-anim__name" title={nameOf(r.name)}>
                      {nameOf(r.name)}
                    </span>
                    <span className="wbi-anim__mode" title={r.mode === 'after' ? 'Starts after the previous visuals finish' : 'Starts with the previous visual'}>
                      {r.mode === 'after' ? 'After' : 'With'}
                    </span>
                    <span className="wbi-anim__track" title={`${r.start} ms to ${r.end} ms`}>
                      <span className="wbi-anim__bar" style={{ left: `${(r.start / total) * 100}%`, width: `${Math.max(2, ((r.end - r.start) / total) * 100)}%` }} />
                      {playing > 0 && <span key={playing} className="wbi-anim__playhead" style={{ animationDuration: `${total}ms` }} />}
                    </span>
                  </div>
                )
              })}
              {rows.length > 0 && (
                <div
                  className={cx('wbi-anim__end', dropTarget === '__end' && 'is-drop')}
                  onDragOver={(e) => {
                    if (!e.dataTransfer.types.includes(SEQ_MIME)) return
                    e.preventDefault()
                    setDropTarget('__end')
                  }}
                  onDragLeave={() => setDropTarget(null)}
                  onDrop={(e) => {
                    e.preventDefault()
                    setDropTarget(null)
                    const src = e.dataTransfer.getData(SEQ_MIME)
                    if (src) reorder(src, null)
                  }}
                />
              )}
              {still.length > 0 && (
                <details className="wbi-anim__still">
                  <summary className="wbi-anim__still-title">Doesn't move ({still.length})</summary>
                  {still.map((v) => (
                    <div key={v.name} role="listitem" className={cx('wbi-anim__row', 'is-still', selected.includes(v.name) && 'is-selected')} onClick={() => selectVisuals([v.name])}>
                      <span className="wbi-anim__grip" aria-hidden>
                        {v.pinned ? <PinRegular fontSize={14} /> : null}
                      </span>
                      <span className="wbi-anim__name" title={nameOf(v.name)}>
                        {nameOf(v.name)}
                      </span>
                      <span className="wbi-anim__mode">{v.pinned ? 'Fixed' : visualMotion(v.json).entrance === 'none' ? 'Off' : 'Still'}</span>
                    </div>
                  ))}
                </details>
              )}
            </div>
            <Note text="Drag a visual to change when it enters. Visuals you haven't placed follow, top to bottom and left to right." />
          </CollapsibleCard>

          {sel && selMotion && isGroup(sel) ? (
            <CollapsibleCard title={nameOf(sel.name)} defaultOpen key={sel.name}>
              <Row label="Stay fixed during page transitions" inline>
                <Toggle size="small" on={!!selMotion.pinned} onChange={(on) => setVisual(sel.name, 'Stay fixed during page transitions', { pinned: on })} />
              </Row>
              <HoverRows motion={selMotion} onChange={(label, patch) => setVisual(sel.name, label, patch)} />
              <Note text="A group's visuals enter one by one (see Sequence). Its hover effect moves the whole group." />
            </CollapsibleCard>
          ) : sel && selMotion ? (
            <CollapsibleCard title={nameOf(sel.name)} defaultOpen key={sel.name}>
              <Row label="Stay fixed during page transitions" inline>
                <Toggle size="small" on={!!selMotion.pinned} onChange={(on) => setVisual(sel.name, 'Stay fixed during page transitions', { pinned: on })} />
              </Row>
              {!selMotion.pinned ? (
                <>
                  <Row label="Entrance">
                    <Dropdown size="small" title="Entrance" value={selMotion.entrance ?? 'auto'} options={ENTRANCES} onChange={(v) => setVisual(sel.name, 'Visual animation', { entrance: v as VisualEntrance })} />
                  </Row>
                  {selAt ? (
                    <>
                      <Row label="Start">
                        <Dropdown
                          size="small"
                          title="Start"
                          value={selMotion.start ?? 'with'}
                          options={[
                            { value: 'with', label: 'With previous' },
                            { value: 'after', label: 'After previous' }
                          ]}
                          onChange={(v) => setVisual(sel.name, 'Animation start', { start: v === 'after' ? 'after' : undefined })}
                        />
                      </Row>
                      <Row label="Delay (ms)">
                        <SpinField label="Delay (ms)" integer step={50} value={selMotion.delay ?? 0} min={MOTION_LIMITS.delay[0]} max={MOTION_LIMITS.delay[1]} onChange={(v) => setVisual(sel.name, 'Visual animation delay', { delay: v ?? 0 })} />
                      </Row>
                      <Row label="Duration (ms)">
                        <SpinField label="Duration (ms)" integer step={50} value={selMotion.duration} placeholder={`${rm.duration} (report)`} min={MOTION_LIMITS.visualDuration[0]} max={MOTION_LIMITS.visualDuration[1]} onChange={(v) => setVisual(sel.name, 'Visual animation duration', { duration: v })} />
                      </Row>
                      <Row label="Curve">
                        <Dropdown size="small" title="Curve" value={selMotion.easing ?? 'default'} options={easingOptions(rm.easing)} onChange={(v) => setVisual(sel.name, 'Visual animation curve', { easing: v === 'default' ? undefined : (v as MotionEasing) })} />
                      </Row>
                    </>
                  ) : null}
                  <Row label="Animate data changes" inline>
                    <Toggle size="small" on={selMotion.update !== 'none'} onChange={(on) => setVisual(sel.name, 'Animate data changes', { update: on ? undefined : 'none' })} />
                  </Row>
                </>
              ) : null}
              <HoverRows motion={selMotion} onChange={(label, patch) => setVisual(sel.name, label, patch)} />
              {selAt ? (
                <div className="wbi-fmt__row">
                  <button type="button" className="wbi-link" disabled={!allowed || !rm.animate} onClick={() => replayMotion(sel.name)}>
                    Play this visual
                  </button>
                </div>
              ) : null}
            </CollapsibleCard>
          ) : (
            <div className="wbi-anim__hint">Select a visual on the canvas or in the sequence to set its timing and hover effect.</div>
          )}

          <CollapsibleCard title="Report defaults" defaultOpen={false}>
            <Row label="Animate visuals" inline>
              <Toggle size="small" on={rm.animate} onChange={(on) => setReport('Animate visuals', { animate: on })} />
            </Row>
            <Row label="Duration (ms)">
              <SpinField label="Duration (ms)" integer step={50} value={rm.duration} min={MOTION_LIMITS.duration[0]} max={MOTION_LIMITS.duration[1]} onChange={(v) => v !== undefined && setReport('Animation duration', { duration: v })} />
            </Row>
            <Row label="Stagger (ms)">
              <SpinField label="Stagger (ms)" integer step={10} value={rm.stagger} min={MOTION_LIMITS.stagger[0]} max={MOTION_LIMITS.stagger[1]} onChange={(v) => v !== undefined && setReport('Animation stagger', { stagger: v })} />
            </Row>
            <Row label="Curve">
              <Dropdown size="small" title="Animation curve" value={rm.easing} options={easingOptions()} onChange={(v) => setReport('Animation curve', { easing: v as MotionEasing })} />
            </Row>
            <Row label="Data change duration (ms)">
              <SpinField label="Data change duration (ms)" integer step={50} value={rm.updateDuration || undefined} placeholder="Same as duration" min={100} max={MOTION_LIMITS.updateDuration[1]} onChange={(v) => setReport('Data change duration', { updateDuration: v ?? 0 })} />
            </Row>
            <Row label="Default page transition">
              <Dropdown size="small" title="Default page transition" value={rm.transition} options={PAGE_TRANSITIONS.map((t) => ({ value: t, label: TRANSITION_LABELS[t] }))} onChange={(v) => setReport('Page transition', { transition: v as PageTransition })} />
            </Row>
            <Row label="Transition duration (ms)">
              <SpinField label="Report transition duration (ms)" integer step={50} value={rm.transitionDuration} min={MOTION_LIMITS.transitionDuration[0]} max={MOTION_LIMITS.transitionDuration[1]} onChange={(v) => v !== undefined && setReport('Transition duration', { transitionDuration: v })} />
            </Row>
            <Row label="Transition curve">
              <Dropdown size="small" title="Report transition curve" value={rm.transitionEasing} options={easingOptions()} onChange={(v) => setReport('Transition curve', { transitionEasing: v as MotionEasing })} />
            </Row>
            <Row label="Drill-through">
              <Dropdown size="small" title="Drill-through" value={rm.drillthrough} options={DRILL_OPTIONS} onChange={(v) => setReport('Drill-through transition', { drillthrough: v as DrillthroughMotion })} />
            </Row>
            <Row label="Bookmarks">
              <Dropdown size="small" title="Bookmarks" value={rm.bookmarks} options={BOOKMARK_OPTIONS} onChange={(v) => setReport('Bookmark transition', { bookmarks: v as BookmarkMotion })} />
            </Row>
          </CollapsibleCard>
          <Note text={POWER_BI_NOTE} />
        </div>
      )}
    </PaneFrame>
  )
}

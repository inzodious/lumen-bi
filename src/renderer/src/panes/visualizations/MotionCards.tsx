/**
 * Format pane cards for Lumen's motion settings (core/report/motion.ts):
 *  - page formatting ▸ Animations: this page's transition, and the report's switches (animate visuals, durations,
 *    stagger, default page transition), with a preview;
 *  - visual ▸ General ▸ Animation: the visual's entrance and delay, and whether it stays fixed during page transitions
 *    (on a group, only that switch).
 * Power BI ignores all of it (the settings are PBIR annotations), which the cards say.
 */
import { PAGE_TRANSITIONS, MOTION_LIMITS, pageMotion, reportMotion, setPageMotion, setReportMotion, setVisualMotion, visualMotion, type BookmarkMotion, type DrillthroughMotion, type PageTransition, type ReportMotion, type VisualEntrance } from '@core/report/motion'
import type { PageDocument, VisualDocument } from '@core/report/types'
import { useApp } from '../../state/store'
import { findPage, findVisual } from '../../report/pbir'
import { CollapsibleCard, Dropdown, Toggle } from '../../app/ui'
import { SpinField } from './controls'
import { matchesSearch } from './PropEditor'
import { motionAllowed, replayMotion } from '../../report/motion/env'
import { previewPageTransition } from '../../report/motion/pageTransition'

const TRANSITION_LABELS: Record<PageTransition, string> = {
  none: 'None',
  fade: 'Fade',
  slide: 'Slide',
  push: 'Push',
  rise: 'Rise',
  zoom: 'Zoom',
  depth: 'Depth',
  wipe: 'Wipe',
  circle: 'Circle reveal',
  morph: 'Morph (shared visuals glide)'
}
const DRILL_OPTIONS: Array<{ value: DrillthroughMotion; label: string }> = [
  { value: 'zoom', label: 'Zoom from the visual' },
  { value: 'page', label: 'Page transition' }
]
const BOOKMARK_OPTIONS: Array<{ value: BookmarkMotion; label: string }> = [
  { value: 'morph', label: 'Morph' },
  { value: 'none', label: 'None' }
]
const ENTRANCES: Array<{ value: VisualEntrance; label: string }> = [
  { value: 'auto', label: 'Auto (by visual type)' },
  { value: 'fade', label: 'Fade in' },
  { value: 'rise', label: 'Rise' },
  { value: 'zoom', label: 'Zoom' },
  { value: 'none', label: 'None' }
]

const POWER_BI_NOTE = 'Lumen only: Power BI keeps these settings but ignores them. There, visuals animate the Power BI way and pages switch without a transition.'

function Row({ label, children, inline }: { label: string; children: React.ReactNode; inline?: boolean }) {
  return (
    <div className={'wbi-fmt__row' + (inline ? ' is-inline' : '')}>
      <div className="wbi-fmt__label">
        <span title={label}>{label}</span>
      </div>
      {children}
    </div>
  )
}

function Note({ text }: { text: string }) {
  return <div className="wbi-fmt__motion-note">{text}</div>
}

/** Play the open page's transition and every visual's entrance once. */
export function previewMotion(transition: PageTransition, duration: number): void {
  if (!motionAllowed()) return
  const page = document.querySelector<HTMLElement>('.wbi-report .wbi-page-shadow') ?? document.querySelector<HTMLElement>('.wbi-report .wbi-page-outer')
  if (page && transition !== 'none') previewPageTransition(page, transition, duration)
  replayMotion()
}

export const MOTION_SEARCH = ['Animations', 'Page transition', 'Animate visuals', 'Duration', 'Stagger', 'Default page transition', 'Transition duration', 'Drill-through', 'Bookmarks', 'Animation', 'Entrance', 'Delay']

export function PageMotionCard({ page, search }: { page: PageDocument; search: string }) {
  const mutate = useApp((s) => s.mutateReport)
  const reportJson = useApp((s) => s.project?.report?.report)
  if (!matchesSearch(search, ...MOTION_SEARCH)) return null
  const rm = reportMotion(reportJson)
  const own = pageMotion(page.json).transition
  const setReport = (label: string, patch: Partial<ReportMotion>) =>
    mutate(label, (r) => {
      r.report ??= {}
      setReportMotion(r.report, patch)
    })
  const pageValue: PageTransition | 'default' = own ?? 'default'
  const allowed = motionAllowed()
  return (
    <CollapsibleCard key={search ? 'q' : 'n'} title="Animations" defaultOpen={!!search}>
      <Row label="Page transition">
        <Dropdown
          size="small"
          title="Page transition"
          value={pageValue}
          options={[{ value: 'default' as const, label: `Report default (${TRANSITION_LABELS[rm.transition]})` }, ...PAGE_TRANSITIONS.map((t) => ({ value: t, label: TRANSITION_LABELS[t] }))]}
          onChange={(v) =>
            mutate('Page transition', (r) => {
              const p = findPage(r, page.name)
              if (p) setPageMotion(p.json, { transition: v === 'default' ? undefined : (v as PageTransition) })
            })
          }
        />
      </Row>
      <CollapsibleCard title="Report" level={2} defaultOpen>
        <Row label="Animate visuals" inline>
          <Toggle size="small" on={rm.animate} onChange={(on) => setReport('Animate visuals', { animate: on })} />
        </Row>
        <Row label="Duration (ms)">
          <SpinField label="Duration (ms)" integer step={50} value={rm.duration} min={MOTION_LIMITS.duration[0]} max={MOTION_LIMITS.duration[1]} onChange={(v) => v !== undefined && setReport('Animation duration', { duration: v })} />
        </Row>
        <Row label="Stagger (ms)">
          <SpinField label="Stagger (ms)" integer step={10} value={rm.stagger} min={MOTION_LIMITS.stagger[0]} max={MOTION_LIMITS.stagger[1]} onChange={(v) => v !== undefined && setReport('Animation stagger', { stagger: v })} />
        </Row>
        <Row label="Default page transition">
          <Dropdown
            size="small"
            title="Default page transition"
            value={rm.transition}
            options={PAGE_TRANSITIONS.map((t) => ({ value: t, label: TRANSITION_LABELS[t] }))}
            onChange={(v) => setReport('Page transition', { transition: v as PageTransition })}
          />
        </Row>
        <Row label="Transition duration (ms)">
          <SpinField label="Transition duration (ms)" integer step={50} value={rm.transitionDuration} min={MOTION_LIMITS.transitionDuration[0]} max={MOTION_LIMITS.transitionDuration[1]} onChange={(v) => v !== undefined && setReport('Transition duration', { transitionDuration: v })} />
        </Row>
        <Row label="Drill-through">
          <Dropdown size="small" title="Drill-through" value={rm.drillthrough} options={DRILL_OPTIONS} onChange={(v) => setReport('Drill-through transition', { drillthrough: v as DrillthroughMotion })} />
        </Row>
        <Row label="Bookmarks">
          <Dropdown size="small" title="Bookmarks" value={rm.bookmarks} options={BOOKMARK_OPTIONS} onChange={(v) => setReport('Bookmark transition', { bookmarks: v as BookmarkMotion })} />
        </Row>
      </CollapsibleCard>
      <div className="wbi-fmt__row">
        <button type="button" className="wbi-link" disabled={!allowed} onClick={() => previewMotion(own ?? rm.transition, rm.transitionDuration)}>
          Preview
        </button>
      </div>
      {!allowed ? <Note text="Your system asks for reduced motion, so Lumen doesn't play animations or transitions in this window." /> : null}
      <Note text={POWER_BI_NOTE} />
    </CollapsibleCard>
  )
}

export function VisualMotionCard({ page, visual, search, group }: { page: PageDocument; visual: VisualDocument; search: string; group?: boolean }) {
  const mutate = useApp((s) => s.mutateReport)
  const reportJson = useApp((s) => s.project?.report?.report)
  if (!matchesSearch(search, 'Animation', 'Entrance', 'Delay', 'Stay fixed', 'Pinned')) return null
  const m = visualMotion(visual.json)
  const rm = reportMotion(reportJson)
  const set = (label: string, patch: Parameters<typeof setVisualMotion>[1]) =>
    mutate(label, (r) => {
      const v = findVisual(findPage(r, page.name), visual.name)
      if (v) setVisualMotion(v.json, patch)
    })
  return (
    <CollapsibleCard key={search ? 'q' : 'n'} title="Animation" defaultOpen={!!search}>
      <Row label="Stay fixed during page transitions" inline>
        <Toggle size="small" on={!!m.pinned} onChange={(on) => set('Stay fixed during page transitions', { pinned: on })} />
      </Row>
      {!group && !m.pinned ? (
        <>
          <Row label="Entrance">
            <Dropdown size="small" title="Entrance" value={m.entrance ?? 'auto'} options={ENTRANCES} onChange={(v) => set('Visual animation', { entrance: v as VisualEntrance })} />
          </Row>
          <Row label="Delay (ms)">
            <SpinField label="Delay (ms)" integer step={50} value={m.delay ?? 0} min={MOTION_LIMITS.delay[0]} max={MOTION_LIMITS.delay[1]} onChange={(v) => v !== undefined && set('Visual animation delay', { delay: v })} />
          </Row>
          <div className="wbi-fmt__row">
            <button type="button" className="wbi-link" disabled={!motionAllowed() || !rm.animate} onClick={() => replayMotion(visual.name)}>
              Preview
            </button>
          </div>
          {!rm.animate ? <Note text="Animate visuals is off for this report (page formatting ▸ Animations)." /> : null}
        </>
      ) : null}
      <Note text={m.pinned ? PINNED_NOTE : group ? GROUP_NOTE : POWER_BI_NOTE} />
    </CollapsibleCard>
  )
}

const PINNED_NOTE =
  'Holds still while the rest of the page moves, when the page you came from has the same kind of visual or group in the same place (a sidebar copied to every page). It has no entrance animation. Lumen only: Power BI ignores this setting.'
const GROUP_NOTE = 'Turn this on to keep the group and everything in it still during page transitions, like a sidebar. Lumen only: Power BI ignores this setting.'

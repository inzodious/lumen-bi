/**
 * Narrative / smart narrative (Power BI `aiNarratives`) — template-generated summary.
 *
 * One summary engine: the sentences come from narrative/generate.ts, which phrases the insights of
 * narrative/insights.ts — the same code that evaluates the smart-narrative `Transform` values of text boxes
 * (elements/narrativeQuery.ts), so a Narrative visual and a Power BI smart narrative over the same fields agree.
 *
 * Power BI's Narrative visual writes its summary with Copilot (or, in "Custom" mode, with the smart-narrative
 * engine). Lumen generates it from fixed templates (narrative/generate.ts): with fields in its own wells it
 * summarizes them; otherwise it summarizes the page's other visuals (`ctx.report.pageVisuals`, else the page in
 * the document store), honouring `userPrompt.useAllVisuals` / `selectedVisualsJson`. The visual states that the
 * text is template-generated. The classic "Smart narrative" is stored by Power BI as a `textbox` with dynamic
 * values (no visual type of its own in the report schema), so it is rendered by the textbox visual.
 */
import { useMemo, type CSSProperties } from 'react'
import { getVisual } from '../../../registry'
import type { ReportDocument } from '@core/report/types'
import type { PageVisualInfo, VisualHostContext, VisualProps } from '../../../contract'
import { EmptyVisual, VisualError, useVisualQuery } from '../../../common/VisualState'
import { FormatReader } from '../../../common/fmtProps'
import { cssFontFamily, ptToPx } from '../../../common/text'
import { getProjections } from '../../../common/query'
import { useApp } from '../../../../state/store'
import { cardsFilters } from '../../../../report/filters'
import { filterCards, findPage } from '../../../../report/pbir'
import { ICONS } from '../../icons'
import { datasetFor, pageDatasets } from './collect'
import { narrate, sentenceText, type Sentence } from './generate'

export const NARRATIVE_NOTE = 'Template-generated summary — Lumen does not run Copilot / AI models.'

/** Names of the visuals selected in `userPrompt.selectedVisualsJson` (array of names or of { name }). */
export function selectedVisualNames(raw: string | undefined): Set<string> | undefined {
  if (!raw) return undefined
  try {
    const parsed = JSON.parse(raw)
    const list = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.visuals) ? parsed.visuals : []
    const names = list.map((x: any) => (typeof x === 'string' ? x : (x?.name ?? x?.visualName ?? x?.id))).filter((x: any): x is string => typeof x === 'string')
    return names.length ? new Set(names) : undefined
  } catch {
    return undefined
  }
}

/** Page visuals to summarize: the host's list, else the page from the document store (with visual-level filters). */
export function narrativeSources(ctx: VisualHostContext, pageName: string, storeReport: ReportDocument | undefined): PageVisualInfo[] {
  if (ctx.report.pageVisuals) return ctx.report.pageVisuals
  const page = findPage(storeReport, pageName)
  return (page?.visuals ?? []).map((v) => ({ visual: v, filters: [...ctx.filters, ...cardsFilters(filterCards(v.json))] }))
}

export interface NarrativeResult {
  sentences: Sentence[]
  errors: string[]
  scope: 'visual' | 'page'
}

/** Sentences for a narrative visual: its own fields when it has any, else the (selected) page visuals. */
export function computeNarrative(json: any, selfName: string, ctx: VisualHostContext, sources: PageVisualInfo[]): NarrativeResult {
  const own = Object.values(getProjections(json)).some((list) => list.length > 0)
  if (own) {
    const ds = datasetFor(json, ctx, ctx.filters, getVisual('aiNarratives')?.roles)
    return { sentences: ds ? narrate([ds], { maxPerVisual: 8 }) : [], errors: [], scope: 'visual' }
  }
  const fmt = new FormatReader(json, ctx.theme)
  const only = fmt.bool('userPrompt', 'useAllVisuals', true) ? undefined : selectedVisualNames(fmt.optStr('userPrompt', 'selectedVisualsJson'))
  const { datasets, errors } = pageDatasets(sources, ctx, selfName, only)
  return { sentences: narrate(datasets), errors, scope: 'page' }
}

export function Narrative({ visual, pageName, width, height, ctx }: VisualProps) {
  const json = visual.json
  const fmt = useMemo(() => new FormatReader(json, ctx.theme), [json, ctx.theme])
  // Fallback when the host doesn't provide the page's visuals: read them from the document store.
  const storeReport = useApp((s) => (ctx.report.pageVisuals ? undefined : s.project?.report))
  const sources = useMemo(() => narrativeSources(ctx, pageName, storeReport), [ctx, pageName, storeReport])
  const sourceKey = sources.map((s) => `${s.visual.name}:${JSON.stringify(s.visual.json?.visual?.query ?? null)}:${JSON.stringify(s.filters ?? null)}`).join('|')
  const promptKey = JSON.stringify(json?.visual?.objects?.userPrompt ?? null)
  const q = useVisualQuery(json, ctx, () => computeNarrative(json, visual.name, ctx, sources), `${promptKey}|${sourceKey}`)
  if (!q.ok) return <VisualError error={q.error} height={height} />

  const family = fmt.str('text', 'fontFamily', 'Segoe UI')
  const sizePx = ptToPx(fmt.num('text', 'fontSize', 11))
  const color = fmt.color('text', 'fontColor', '#252423')
  const align = fmt.str('text', 'textAlignment', 'Auto').toLowerCase()
  // values are underlined in theme color 1 while editing, like smart-narrative values in Power BI text boxes
  const accent = ctx.mode === 'edit' ? (ctx.theme.dataColors[0] ?? '#118DFF') : undefined
  const { sentences, errors, scope } = q.data
  const box: CSSProperties = {
    width,
    height,
    overflowY: 'auto',
    overflowX: 'hidden',
    boxSizing: 'border-box',
    padding: '4px 6px',
    fontFamily: cssFontFamily(family),
    fontSize: sizePx,
    color,
    textAlign: align === 'center' || align === 'right' ? align : 'left',
    lineHeight: 1.45
  }
  if (!sentences.length) {
    if (height < 70) return <EmptyVisual icon={ICONS.aiNarratives} width={width} height={height} />
    return (
      <div style={{ ...box, display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', color: '#605E5C', fontSize: 12 }}>
        {scope === 'page' ? "There's nothing to summarize yet: add visuals with data to this page." : 'There is no data to summarize.'}
        {errors.length ? <span title={errors.join('\n')}> ({errors.length} visual{errors.length > 1 ? 's' : ''} couldn't be read)</span> : null}
      </div>
    )
  }
  return (
    <div style={{ width, height, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ ...box, width, height: undefined, flex: 1, minHeight: 0 }} aria-label={sentences.map(sentenceText).join(' ')}>
        {sentences.map((s, i) => (
          <SentenceView key={i} s={s} accent={accent} />
        ))}
      </div>
      {height >= 60 ? (
        <div
          style={{ flex: 'none', padding: '2px 6px', fontSize: 10, color: '#8A8886', fontStyle: 'italic', fontFamily: cssFontFamily('Segoe UI'), whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
          title={errors.length ? `${NARRATIVE_NOTE}\n${errors.join('\n')}` : NARRATIVE_NOTE}
        >
          {NARRATIVE_NOTE}
        </div>
      ) : null}
    </div>
  )
}

function SentenceView({ s, accent }: { s: Sentence; accent?: string }) {
  return (
    <p style={{ margin: '0 0 0.75em' }}>
      {s.map((r, i) =>
        r.value && accent ? (
          <span key={i} style={{ textDecoration: 'underline', textDecorationColor: accent, textDecorationThickness: '1px', textUnderlineOffset: '0.2em' }}>
            {r.text}
          </span>
        ) : (
          <span key={i}>{r.text}</span>
        )
      )}
    </p>
  )
}

/** "Show as table" / export data: one row per sentence (page from the host, else the document store). */
export function narrativeTable(json: any, selfName: string, ctx: VisualHostContext): { columns: string[]; rows: string[][] } {
  const sources = narrativeSources(ctx, ctx.report.activePage, useApp.getState().project?.report)
  const r = computeNarrative(json, selfName, ctx, sources)
  return { columns: ['Summary'], rows: r.sentences.map((s) => [sentenceText(s)]) }
}

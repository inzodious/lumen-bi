/**
 * PrintLayout — renders report pages one after another at native size, each in its own CSS page box
 * (named @page rules per page size, so mixed page sizes print correctly with `preferCSSPageSize`).
 * Used by the shell's PDF / PNG export. Non-interactive (no selection chrome, headers, tooltips).
 */
import { useCallback, useMemo, useRef } from 'react'
import '../visuals'
import './report.css'
import type { PageDocument, ReportDocument } from '@core/report/types'
import { useApp } from '../state/store'
import { PageCanvas, type CanvasReadyResult } from './PageCanvas'
import { findPage, orderedPages, pageInfo } from './pbir'

export interface PrintLayoutProps {
  /** pages (documents or names) — default: all pages visible in reading view, in order */
  pages?: Array<PageDocument | string>
  report?: ReportDocument
  /**
   * called once every page finished rendering; `result.incomplete` lists the pages whose canvas hit its readiness
   * timeout (drawn partly), with the visuals still pending
   */
  onReady?(result?: PrintReadyResult): void
  /** include pages hidden in view mode when `pages` isn't given */
  includeHidden?: boolean
}

/** A page that was not fully rendered when its canvas' readiness timeout fired. */
export interface IncompletePrintPage {
  name: string
  displayName: string
  pending: CanvasReadyResult['pending']
}

export interface PrintReadyResult {
  incomplete: IncompletePrintPage[]
}

export function PrintLayout(props: PrintLayoutProps) {
  const storeReport = useApp((s) => s.project?.report)
  const report = props.report ?? storeReport
  const pages = useMemo(() => {
    if (!report) return []
    if (props.pages) return props.pages.map((p) => (typeof p === 'string' ? findPage(report, p) : p)).filter((p): p is PageDocument => !!p)
    return orderedPages(report).filter((p) => {
      const i = pageInfo(p)
      return props.includeHidden || (!i.hidden && !i.isTooltip)
    })
  }, [report, props.pages, props.includeHidden])

  const sizes = [...new Set(pages.map((p) => `${pageInfo(p).width}x${pageInfo(p).height}`))]
  const css =
    sizes.map((s) => {
      const [w, h] = s.split('x')
      return `@page wbi${w}x${h} { size: ${w}px ${h}px; margin: 0; }`
    }).join('\n') +
    `\n@media print { html, body, #root { height: auto !important; overflow: visible !important; background: #fff; } }`

  const done = useRef(new Map<string, CanvasReadyResult | undefined>())
  const fired = useRef(false)
  const onPageReady = useCallback(
    (name: string, result?: CanvasReadyResult) => {
      done.current.set(name, result)
      if (!fired.current && pages.every((p) => done.current.has(p.name))) {
        fired.current = true
        const incomplete = pages.flatMap((p) => {
          const r = done.current.get(p.name)
          return r?.timedOut ? [{ name: p.name, displayName: pageInfo(p).displayName, pending: r.pending }] : []
        })
        props.onReady?.({ incomplete })
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pages, props.onReady]
  )

  if (!report) return null
  return (
    <div className="wbi-print">
      <style>{css}</style>
      {pages.map((p) => {
        const i = pageInfo(p)
        return (
          <div key={p.name} className="wbi-print-page" data-page={p.name} style={{ width: i.width, height: i.height, page: `wbi${i.width}x${i.height}` } as React.CSSProperties}>
            <PageCanvas report={report} page={p} scale={1} mode="view" interactive={false} editing={false} onReady={(r) => onPageReady(p.name, r)} />
          </div>
        )
      })}
    </div>
  )
}

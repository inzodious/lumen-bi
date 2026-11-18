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
import { PageCanvas } from './PageCanvas'
import { findPage, orderedPages, pageInfo } from './pbir'

export interface PrintLayoutProps {
  /** pages (documents or names) — default: all pages visible in reading view, in order */
  pages?: Array<PageDocument | string>
  report?: ReportDocument
  /** called once every page finished rendering */
  onReady?(): void
  /** include pages hidden in view mode when `pages` isn't given */
  includeHidden?: boolean
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

  const done = useRef(new Set<string>())
  const fired = useRef(false)
  const onPageReady = useCallback(
    (name: string) => {
      done.current.add(name)
      if (!fired.current && pages.every((p) => done.current.has(p.name))) {
        fired.current = true
        props.onReady?.()
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
            <PageCanvas report={report} page={p} scale={1} mode="view" interactive={false} editing={false} onReady={() => onPageReady(p.name)} />
          </div>
        )
      })}
    </div>
  )
}

/**
 * Lumen hover effects (core/report/motion.ts hoverStyle) on a visual container or a group: a `data-hover` attribute and
 * CSS variables that report.css turns into the effect on :hover. Groups take the effect as a whole (a KPI tile made of
 * a card and its note grows as one). Reading view and published dashboards only.
 */
import type { CSSProperties } from 'react'
import { DEFAULT_HOVER_AMOUNT, hoverOrigin, hoverStyle, visualMotion, type HoverEffect } from '@core/report/motion'
import type { PageDocument, VisualDocument } from '@core/report/types'
import { absoluteRect, pageInfo } from '../pbir'

export interface HoverProps {
  effect: HoverEffect
  style: CSSProperties
}

export function hoverProps(page: PageDocument, v: VisualDocument): HoverProps | undefined {
  const m = visualMotion(v.json)
  const fx = hoverStyle(m)
  if (!fx || !m.hover) return undefined
  const origin = m.hover === 'enlarge' ? hoverOrigin(absoluteRect(page, v), pageInfo(page), 1 + (m.hoverAmount ?? DEFAULT_HOVER_AMOUNT) / 100) : '50% 50%'
  return {
    effect: m.hover,
    style: { '--wbi-hover-filter': fx.filter ?? 'none', '--wbi-hover-transform': fx.transform ?? 'none', '--wbi-hover-shadow': fx.boxShadow ?? 'none', '--wbi-hover-origin': origin } as CSSProperties
  }
}

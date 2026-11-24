/**
 * A page's animation sequence (core/report/motion.ts entranceSchedule) from its visuals: reading order from their
 * places, groups left out (their visuals enter one by one), hidden visuals left out (they don't show, so they don't
 * hold up the visuals after them).
 */
import { entranceSchedule, isPinned, pageMotion, readingOrder, reportMotion, type ScheduledEntrance, type SequenceVisual } from '@core/report/motion'
import type { PageDocument } from '@core/report/types'
import { absoluteRect, isEffectivelyHidden, isGroup, visualTypeOf } from '../pbir'

export function sequenceVisuals(page: PageDocument): SequenceVisual[] {
  const shown = page.visuals.filter((v) => !isGroup(v) && !isEffectivelyHidden(page, v))
  const order = readingOrder(shown.map((v) => ({ name: v.name, ...absoluteRect(page, v) })))
  return shown.map((v) => ({ name: v.name, type: visualTypeOf(v), json: v.json, reading: order.get(v.name) ?? 0, pinned: isPinned(page.visuals, v.name) }))
}

export function pageSchedule(reportJson: unknown, page: PageDocument): Map<string, ScheduledEntrance> {
  return entranceSchedule(reportMotion(reportJson), pageMotion(page.json), sequenceVisuals(page))
}

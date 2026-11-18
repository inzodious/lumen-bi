/** Recently used icons (per user, localStorage; a convenience only — failures are ignored). */
import { parseIconRef, serializeIconRef, iconKey } from '@core/icons/ref'
import type { IconRef } from '@core/icons/types'

const KEY = 'lumen.recentIcons'
const MAX = 24

export function readRecentIcons(): IconRef[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]')
    return Array.isArray(v) ? (v.map(parseIconRef).filter(Boolean) as IconRef[]).slice(0, MAX) : []
  } catch {
    return []
  }
}

export function pushRecentIcon(ref: IconRef): void {
  try {
    const key = iconKey(ref)
    const list = [serializeIconRef(ref), ...readRecentIcons().filter((r) => iconKey(r) !== key)].slice(0, MAX)
    localStorage.setItem(KEY, JSON.stringify(list))
  } catch {
    /* storage unavailable */
  }
}

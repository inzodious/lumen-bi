/**
 * React access to the icon registry: a set's components once its lazily imported module has loaded.
 * While a set loads, the app counts as busy (readiness), so headless captures and exports wait for icons.
 */
import { useEffect, useState } from 'react'
import type { IconSetId } from '@core/icons/types'
import { holdBusy } from '../app/readiness'
import { getLoadedIconSet, loadIconSet, type LoadedIconSet } from './registry'

export function useIconSet(set: IconSetId | undefined): LoadedIconSet | undefined {
  const [, setTick] = useState(0)
  const data = set ? getLoadedIconSet(set) : undefined
  useEffect(() => {
    if (!set || data) return
    let live = true
    const release = holdBusy(`icons:${set}`)
    loadIconSet(set)
      .then(() => live && setTick((t) => t + 1))
      .catch((e) => console.error(`[icons] could not load the ${set} icons`, e))
      .finally(release)
    return () => {
      live = false
    }
  }, [set, data])
  return data
}

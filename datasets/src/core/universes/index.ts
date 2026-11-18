/**
 * Registry of dataset universes. Each universe lives in its own folder (tables.ts = specs,
 * generate.ts = simulation, index.ts = story/measures/report/invariants) and is exported here.
 */
import type { Universe } from '../schema.ts'
import { starlite } from './starlite/index.ts'
import { gravelstar } from './gravelstar/index.ts'
import { sunjar } from './sunjar/index.ts'
import { moonwake } from './moonwake/index.ts'
import { leafloft } from './leafloft/index.ts'
import { pixelpagoda } from './pixelpagoda/index.ts'
import { griffingecko } from './griffingecko/index.ts'

export const UNIVERSES: Universe[] = [starlite, gravelstar, sunjar, moonwake, leafloft, pixelpagoda, griffingecko]

export function findUniverse(id: string): Universe | undefined {
  return UNIVERSES.find((u) => u.id === id)
}

/** Registers the decomposition tree, key influencers, narrative and the Q&A placeholder. */
import type { DataRoleDef, VisualDefinition, VisualProps } from '../../contract'
import { registerVisual } from '../../registry'
import { FormatReader } from '../../common/fmtProps'
import { ICONS } from '../icons'
import { DecompositionTree } from './decompositionTree'
import { computeTree, treeTable } from './decomp/query'
import { decompositionTreeCards, keyInfluencersCards, narrativeCards } from './formatCards'
import { KeyInfluencers } from './keyInfluencers/KeyInfluencers'
import { computeKeyInfluencers, influencersTable } from './keyInfluencers/query'
import { Narrative, narrativeTable } from './narrative/Narrative'
import { AiPlaceholder } from './placeholders'

const AI: Array<{ type: string; displayName: string; roles: DataRoleDef[] }> = [{ type: 'qnaVisual', displayName: 'Q&A', roles: [] }]

export function registerMiscVisuals(): void {
  const tree: VisualDefinition = {
    type: 'decompositionTreeVisual',
    displayName: 'Decomposition tree',
    category: 'chart',
    icon: ICONS.decompositionTreeVisual,
    roles: [
      { name: 'Analyze', displayName: 'Analyze', kind: 'measure', max: 1 },
      { name: 'ExplainBy', displayName: 'Explain by', kind: 'grouping' },
      { name: 'Tooltips', displayName: 'Tooltips', kind: 'measure' }
    ],
    formatCards: decompositionTreeCards,
    component: DecompositionTree,
    getData: (visual, ctx) => {
      const fmt = new FormatReader(visual.json, ctx.theme)
      const t = computeTree(visual.json, ctx, { aiEnabled: fmt.bool('analysis', 'aiEnabled', true), aiMode: fmt.str('analysis', 'aiMode', 'absolute') === 'relative' ? 'relative' : 'absolute' })
      return t ? treeTable(t) : undefined
    },
    inGallery: true,
    defaultSize: { width: 560, height: 320 }
  }
  registerVisual(tree)

  registerVisual({
    type: 'keyDriversVisual',
    displayName: 'Key influencers',
    category: 'chart',
    icon: ICONS.keyDriversVisual,
    roles: [
      { name: 'Analyze', displayName: 'Analyze', kind: 'both', max: 1 },
      { name: 'ExplainBy', displayName: 'Explain by', kind: 'both' },
      { name: 'ExpandBy', displayName: 'Expand by', kind: 'grouping' }
    ],
    formatCards: keyInfluencersCards,
    component: KeyInfluencers,
    getData: (visual, ctx) => {
      const fmt = new FormatReader(visual.json, ctx.theme)
      const d = computeKeyInfluencers(visual.json, ctx, {
        targetValue: fmt.optStr('keyDrivers', 'targetValue'),
        direction: fmt.num('keyDrivers', 'numericTargetSelectedKind', 0) === 1 ? 'decrease' : 'increase',
        numericAsCategorical: fmt.str('keyDrivers', 'selectedNumericAnalysis', 'Continuous') === 'Categorical',
        sort: fmt.str('keyDrivers', 'selectedSort', 'impact') === 'count' ? 'count' : 'impact'
      })
      return d ? influencersTable(d) : undefined
    },
    inGallery: true,
    defaultSize: { width: 640, height: 400 }
  })

  registerVisual({
    type: 'aiNarratives',
    displayName: 'Narrative',
    category: 'chart',
    icon: ICONS.aiNarratives,
    // Power BI's Narrative has no field wells (it summarizes the page); Lumen also accepts fields to
    // summarize a specific measure / category, like "Summarize" on a single visual.
    roles: [
      { name: 'Category', displayName: 'Category', kind: 'grouping', max: 1 },
      { name: 'Values', displayName: 'Values', kind: 'measure' }
    ],
    formatCards: narrativeCards,
    component: Narrative,
    getData: (visual, ctx) => narrativeTable(visual.json, visual.name, ctx),
    inGallery: true,
    defaultSize: { width: 320, height: 240 }
  })

  for (const a of AI) {
    const Component = (props: VisualProps) => <AiPlaceholder {...props} type={a.type} displayName={a.displayName} />
    registerVisual({
      type: a.type,
      displayName: a.displayName,
      category: 'chart',
      icon: ICONS[a.type],
      roles: a.roles,
      formatCards: [],
      component: Component,
      inGallery: true,
      defaultSize: { width: 320, height: 240 }
    })
  }
}

/**
 * Gallery fixtures for the decomposition tree, key influencers, narrative and Q&A.
 * Tree / narrative use the shared sample model (Sales); key influencers needs row-level data and uses the
 * customers sample (sampleCustomers.ts) through a per-entry engine.
 */
import { literalExpr } from '@core/report/sq'
import type { QueryEngine } from '@core/engine/api'
import type { ReportInfo } from '../../contract'
import { col, msr, props, visualJson, type GalleryEntry } from '../../gallery/registry'
import { customerEngine } from './sampleCustomers'

const S = 'Sales'
const C = 'Customers'
const SECTION = 'Decomposition tree & AI visuals'

/** expansionStates entry (PBIR) for a decomposition tree fixture. */
function expansion(levels: Array<{ ref: string; ai?: 'MaxSplit' | 'MinSplit'; locked?: boolean }>, path: string[]): any[] {
  let children: any[] | undefined
  for (let i = path.length - 1; i >= 0; i--) children = [{ identityValues: [literalExpr(path[i])], isToggled: true, ...(children ? { children } : {}) }]
  return [
    {
      roles: ['ExplainBy'],
      levels: levels.map((l) => ({
        queryRefs: [l.ref],
        isCollapsed: true,
        identityKeys: [col(l.ref.split('.')[0], l.ref.split('.')[1])],
        isPinned: true,
        ...(l.locked ? { isLocked: true } : {}),
        ...(l.ai ? { AIInformation: { method: l.ai } } : {})
      })),
      root: { isToggled: true, ...(children ? { children } : {}) }
    }
  ]
}

function tree(name: string, explain: string[], levels: Parameters<typeof expansion>[0], path: string[], objects?: Record<string, any>): any {
  const j = visualJson(name, 'decompositionTreeVisual', { Analyze: [msr(S, 'Total Sales')], ExplainBy: explain.map((c) => col(S, c)) }, { objects })
  if (levels.length) j.visual.expansionStates = expansion(levels, path)
  return j
}

const churnWells = { Analyze: [col(C, 'Churned')], ExplainBy: [col(C, 'Contract'), col(C, 'Plan'), col(C, 'Tenure'), col(C, 'Support Tickets'), col(C, 'Region')] }

const pageVisuals = [
  visualJson('p_trend', 'lineChart', { Category: [col(S, 'Month')], Y: [msr(S, 'Total Sales'), msr(S, 'Total Cost')] }),
  visualJson('p_region', 'clusteredBarChart', { Category: [col(S, 'Region')], Y: [msr(S, 'Total Sales')] }),
  visualJson('p_category', 'donutChart', { Category: [col(S, 'Category')], Y: [msr(S, 'Total Sales')] }),
  visualJson('p_profit', 'card', { Values: [msr(S, 'Profit')] })
].map((json, i) => {
  json.position = { x: (i % 2) * 420, y: Math.floor(i / 2) * 300, z: i, width: 400, height: 280 }
  return { visual: { name: json.name as string, json } }
})

const pageReport: ReportInfo = { pages: [{ name: 'gallery', displayName: 'Overview', hidden: false }], activePage: 'gallery', bookmarks: [], resolveImage: () => undefined, pageVisuals }

export const miscGalleryEntries: GalleryEntry[] = [
  {
    id: 'decompTree',
    section: SECTION,
    title: 'Decomposition tree — 3 levels + AI split (High value)',
    json: tree(
      'g_decompTree',
      ['Region', 'Category', 'Channel', 'Segment'],
      [{ ref: 'Sales.Region' }, { ref: 'Sales.Category' }, { ref: 'Sales.Channel', ai: 'MaxSplit' }],
      ['Europe', 'Bikes']
    ),
    width: 1000,
    height: 400
  },
  {
    id: 'decompTreeLow',
    section: SECTION,
    title: 'Decomposition tree — locked level, scrolling, relative Low value',
    json: tree('g_decompTreeLow', ['Country', 'Category', 'Channel'], [{ ref: 'Sales.Country', locked: true }, { ref: 'Sales.Category', ai: 'MinSplit' }], ['Germany'], {
      tree: [props({ barsPerLevel: 5, density: 'dense' })],
      analysis: [props({ aiMode: 'relative' })]
    }),
    width: 760,
    height: 320,
    mode: 'edit'
  },
  {
    id: 'decompTreeRoot',
    section: SECTION,
    title: 'Decomposition tree — root only',
    json: tree('g_decompTreeRoot', ['Region', 'Category'], [], []),
    width: 360,
    height: 220
  },
  {
    id: 'keyInfluencers',
    section: SECTION,
    title: 'Key influencers — categorical (Churned = Yes)',
    json: visualJson('g_keyInfluencers', 'keyDriversVisual', churnWells, { objects: { keyDrivers: [props({ targetValue: 'Yes' })] } }),
    get engine(): QueryEngine {
      return customerEngine()
    },
    width: 820,
    height: 440
  },
  {
    id: 'keyInfluencersContinuous',
    section: SECTION,
    title: 'Key influencers — continuous (Monthly Charges, Increase)',
    json: visualJson('g_keyInfluencersCont', 'keyDriversVisual', { Analyze: [col(C, 'Monthly Charges')], ExplainBy: [col(C, 'Plan'), col(C, 'Region'), col(C, 'Contract'), col(C, 'Support Tickets')] }),
    get engine(): QueryEngine {
      return customerEngine()
    },
    width: 820,
    height: 440
  },
  {
    id: 'keyInfluencersSegments',
    section: SECTION,
    title: 'Key influencers — top segments',
    json: visualJson('g_keyInfluencersSeg', 'keyDriversVisual', churnWells, { objects: { keyDrivers: [props({ targetValue: 'Yes', selectedAnalysis: 'topProfiles' })] } }),
    get engine(): QueryEngine {
      return customerEngine()
    },
    width: 820,
    height: 440
  },
  {
    id: 'narrative',
    section: SECTION,
    title: 'Narrative — page summary',
    json: visualJson('g_narrative', 'aiNarratives', {}),
    report: pageReport,
    width: 420,
    height: 440
  },
  {
    id: 'narrativeFields',
    section: SECTION,
    title: 'Narrative — own fields',
    json: visualJson('g_narrativeFields', 'aiNarratives', { Category: [col(S, 'Channel')], Values: [msr(S, 'Total Sales'), msr(S, 'Profit')] }),
    width: 420,
    height: 240
  },
  {
    id: 'qna',
    section: SECTION,
    title: 'Q&A',
    json: visualJson('g_qna', 'qnaVisual', {}),
    width: 300,
    height: 220
  }
]

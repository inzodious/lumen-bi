/**
 * Sunjar Fusion Labs — "a sun in a jar". Plasma shots on five devices, diagnostics, magnet-coil
 * procurement, R&D budget vs actuals, funding rounds & grants, staff (SCD2) & publications,
 * power purchase agreements and safety inspections.
 */
import { GENERIC_HOLIDAYS } from '../../calendar.ts'
import { checkRows, compareSums, groupCount, groupSum, near, rowsOf } from '../../check.ts'
import type { MeasureSpec, Universe } from '../../schema.ts'
import { generateSunjar } from './generate.ts'
import { SUNJAR_ISSUES, SUNJAR_SOURCES, SUNJAR_TABLES } from './tables.ts'

const SH = "'Shots'"
const DD = "'Device Day'"
const FIN = "'Finance'"
const CO = "'Component Orders'"
const DATE = "'Date'[Date]"

const measures: MeasureSpec[] = [
  // Plasma
  { name: 'Shots', expr: `COUNTROWS ( ${SH} )`, format: '#,0', folder: 'Plasma', description: 'Shots fired (magnet energisations on the test stand).' },
  { name: 'Success Rate %', expr: `DIVIDE ( CALCULATE ( [Shots], 'Shot Outcome'[Outcome] = "Success" ), [Shots] )`, format: '0.0%', folder: 'Plasma', description: 'Shots that met their target cleanly.' },
  { name: 'Disruptions', expr: `CALCULATE ( [Shots], ${SH}[Is Disruption] = TRUE () )`, format: '#,0', folder: 'Plasma', description: 'Shots that ended in a disruption.' },
  { name: 'Disruption Rate %', expr: 'DIVIDE ( [Disruptions], [Shots] )', format: '0.0%', folder: 'Plasma', description: 'Disruptions per shot.' },
  { name: 'Avg Peak Temp (keV)', expr: `AVERAGE ( ${SH}[Peak Temp keV] )`, format: '0.00', folder: 'Plasma', description: 'Average peak ion temperature (1 keV ≈ 11.6 million °C).' },
  { name: 'Avg Confinement (ms)', expr: `AVERAGE ( ${SH}[Confinement ms] )`, format: '0.0', folder: 'Plasma', description: 'Average energy confinement time τE (shots with a valid reconstruction).' },
  { name: 'Best Triple Product', expr: `MAX ( ${SH}[Triple Product] )`, format: '0.000', folder: 'Plasma', description: 'Best n·T·τE — the Lawson figure of merit (≈3 for D-T breakeven in this model).' },
  { name: 'Best Q', expr: `MAX ( ${SH}[Q Factor] )`, format: '0.000', folder: 'Plasma', description: 'Highest scientific gain (fusion power ÷ heating power).' },
  { name: 'Fusion Energy (MJ)', expr: `SUM ( ${SH}[Energy Out MJ] )`, format: '#,0.00', folder: 'Plasma', description: 'Fusion energy released.' },
  { name: 'Energy Gain', expr: `DIVIDE ( [Fusion Energy (MJ)], SUM ( ${SH}[Energy In MJ] ) )`, format: '0.0000', folder: 'Plasma', description: 'Total fusion energy out ÷ heating energy in.' },
  { name: 'Record Shots', expr: `CALCULATE ( [Shots], ${SH}[Is Record] = TRUE () )`, format: '#,0', folder: 'Plasma', description: 'Shots that set a new device record for triple product.' },
  { name: 'Breakeven Shots', expr: `CALCULATE ( [Shots], ${SH}[Q Factor] >= 1 )`, format: '#,0', folder: 'Plasma', description: 'Shots with Q ≥ 1 (scientific breakeven).' },
  // Time intelligence
  { name: 'Shots YTD', expr: `TOTALYTD ( [Shots], ${DATE} )`, format: '#,0', folder: 'Time Intelligence', description: 'Calendar year-to-date shots.' },
  { name: 'Shots YoY %', expr: `VAR Prior = CALCULATE ( [Shots], SAMEPERIODLASTYEAR ( ${DATE} ) )\nRETURN\n    DIVIDE ( [Shots] - Prior, Prior )`, format: '0.0%;-0.0%;0.0%', folder: 'Time Intelligence', description: 'Shot count versus the same period last year.' },
  { name: 'Best Q (Rolling 90D)', expr: `CALCULATE ( [Best Q], DATESINPERIOD ( ${DATE}, MAX ( ${DATE} ), -90, DAY ) )`, format: '0.000', folder: 'Time Intelligence', description: 'Best Q in the trailing 90 days — the learning curve.' },
  { name: 'Shots per Run Day (28D)', expr: `AVERAGEX ( DATESINPERIOD ( ${DATE}, MAX ( ${DATE} ), -28, DAY ), [Shots] )`, format: '#,0.0', folder: 'Time Intelligence', description: 'Average shots per day with shots over the trailing 28 days.' },
  // Rankings
  { name: 'Device Rank by Best Q', expr: `IF ( HASONEVALUE ( 'Device'[Device Name] ), RANKX ( ALL ( 'Device'[Device Name] ), [Best Q] ) )`, format: '0', folder: 'Rankings', description: 'Device rank by best Q.' },
  { name: 'Top Session Leader', expr: `FIRSTNONBLANK ( TOPN ( 1, VALUES ( 'Staff'[Full Name] ), [Shots] ), 1 )`, folder: 'Rankings', description: 'Physicist who led the most shots in context.' },
  // Operations
  { name: 'Availability %', expr: `DIVIDE ( CALCULATE ( COUNTROWS ( ${DD} ), ${DD}[Device Status] = "Running" ), CALCULATE ( COUNTROWS ( ${DD} ), ${DD}[Device Status] <> "Idle" ) )`, format: '0.0%', folder: 'Operations', description: 'Running days ÷ (running + maintenance + outage days); idle weekends excluded.' },
  { name: 'Grid Energy (MWh)', expr: `SUM ( ${DD}[Energy Drawn MWh] )`, format: '#,0', folder: 'Operations', description: 'Electricity drawn from the grid.' },
  { name: 'Major Findings', expr: `SUM ( ${DD}[Findings Major] )`, format: '#,0', folder: 'Operations', description: 'Major inspection findings.' },
  { name: 'Safety Incidents', expr: `SUM ( ${DD}[Safety Incidents] )`, format: '#,0', folder: 'Operations', description: 'Recordable safety incidents.' },
  // Finance
  { name: 'Budget', expr: `SUM ( ${FIN}[Budget Amount] )`, format: '$#,0', folder: 'Finance', description: 'Approved budget (incl. months not yet spent).' },
  { name: 'Actual Spend', expr: `SUM ( ${FIN}[Actual Amount] )`, format: '$#,0', folder: 'Finance', description: 'Actual spend from the GL.' },
  { name: 'Budget to Date', expr: `CALCULATE ( [Budget], NOT ISBLANK ( ${FIN}[Actual Amount] ) )`, format: '$#,0', folder: 'Finance', description: 'Budget for months that already have actuals.' },
  { name: 'Budget Variance', expr: '[Actual Spend] - [Budget to Date]', format: '$#,0;($#,0);$0', folder: 'Finance', description: 'Overspend (positive) or underspend (negative) to date.' },
  { name: 'Budget Variance %', expr: 'DIVIDE ( [Budget Variance], [Budget to Date] )', format: '0.0%;-0.0%;0.0%', folder: 'Finance', description: 'Variance as a share of budget to date.' },
  { name: 'Actual Spend FYTD', expr: `TOTALYTD ( [Actual Spend], ${DATE}, "6/30" )`, format: '$#,0', folder: 'Finance', description: 'Fiscal year-to-date spend (fiscal year starts 1 July).' },
  { name: 'Burn Rate (3M Avg)', expr: `DIVIDE ( CALCULATE ( [Actual Spend], DATESINPERIOD ( ${DATE}, MAX ( ${DATE} ), -3, MONTH ) ), 3 )`, format: '$#,0', folder: 'Finance', description: 'Average monthly spend over the trailing three months.' },
  { name: 'Committed Funding', expr: `SUM ( 'Funding Source'[Committed Amount] )`, format: '$#,0', folder: 'Finance', description: 'Capital committed by investors, grants and partners.' },
  { name: 'Funding Drawn %', expr: 'DIVIDE ( [Actual Spend], [Committed Funding] )', format: '0.0%', folder: 'Finance', description: 'Spend charged to a funding source ÷ its commitment.' },
  {
    name: 'Actual Spend (Smart Units)',
    expr: '[Actual Spend]',
    formatExpr: 'SWITCH ( TRUE (), ABS ( [Actual Spend] ) >= 1000000000, "$#,0.00,,,""B""", ABS ( [Actual Spend] ) >= 1000000, "$#,0.0,,""M""", ABS ( [Actual Spend] ) >= 1000, "$#,0,""K""", "$#,0" )',
    folder: 'Finance',
    description: 'Actual spend with a dynamic format string ($1.2B / $45.3M / $950K).'
  },
  // Procurement
  { name: 'Component Spend', expr: `SUM ( ${CO}[Line Amount] )`, format: '$#,0', folder: 'Procurement', description: 'Component order value by order date.' },
  { name: 'Component Spend by Received Date', expr: `CALCULATE ( [Component Spend], USERELATIONSHIP ( ${CO}[Received Date Key], 'Date'[Date Key] ) )`, format: '$#,0', folder: 'Procurement', description: 'Same spend dated by receipt (role-playing date via USERELATIONSHIP).' },
  {
    name: 'On-Time Delivery %',
    expr: `DIVIDE ( CALCULATE ( COUNTROWS ( ${CO} ), ${CO}[Is On Time] = TRUE () ), CALCULATE ( COUNTROWS ( ${CO} ), NOT ISBLANK ( ${CO}[Received Date Key] ) ) )`,
    format: '0.0%',
    folder: 'Procurement',
    description: 'Received lines that arrived by the promised date.'
  },
  { name: 'QA Rejection Rate %', expr: `DIVIDE ( SUM ( ${CO}[Rejected Qty] ), SUM ( ${CO}[Received Qty] ) )`, format: '0.00%', folder: 'Procurement', description: 'Share of received quantity rejected at incoming inspection.' },
  // Research, people & commercial
  { name: 'Publications', expr: `COUNTROWS ( 'Publication' )`, format: '#,0', folder: 'Research', description: 'Publications (filterable by Staff through the Authorship bridge).' },
  {
    name: 'Headcount',
    expr: `VAR AsOf = MAX ( ${DATE} )\nRETURN\n    CALCULATE (\n        DISTINCTCOUNT ( 'Staff'[Staff ID] ),\n        FILTER ( 'Staff', 'Staff'[Valid From] <= AsOf && 'Staff'[Valid To] >= AsOf && 'Staff'[Employment Status] = "Active" )\n    )`,
    format: '#,0',
    folder: 'People',
    description: 'Active staff on the last date in context (semi-additive, uses SCD2 validity).'
  },
  { name: 'Contracted PPA Capacity (MW)', expr: `CALCULATE ( SUM ( 'PPA'[Capacity MW] ), 'PPA'[PPA Status] <> "Terminated" )`, format: '#,0', folder: 'Commercial', description: 'Future plant output already sold under PPAs.' }
]

export const sunjar: Universe = {
  id: 'sunjar',
  company: 'Sunjar Fusion Labs',
  name: 'Sunjar',
  tagline: 'We put a small sun in a very strong jar — five machines, thousands of shots, one breakeven day.',
  premise: `
Sunjar Fusion Labs is a venture-backed fusion start-up chasing the oldest dream in energy: get more energy out of a
plasma than you put in. It runs five machines across two campuses — **Jarbelly-1** (a compact high-field tokamak),
**Little Sun** (a spherical tokamak), **Corkscrew** (a brand-new stellarator that achieves first plasma during the
history), **Snapdragon** (a pulsed Z-pinch that fires dozens of microsecond shots a day) and the **Magnet Test
Stand M3**, where high-temperature-superconducting coils are ramped until something gives.

Every shot is logged with its temperature, density and confinement time; the triple product n·T·τE drives the
scientific gain **Q**. The machines get better as the team learns (watch the learning curve), the tokamak gets a
**heating upgrade**, D-T fuel arrives after the **tritium licence** — and late in the history one record shot on
Jarbelly-1 crosses **Q = 1**. The paper about it is the most-cited thing Sunjar has ever written.

Not everything goes to plan:

- A **magnet quench** knocks Jarbelly-1 out for six weeks, triggers a safety incident, a tough regulatory
  inspection, a spike in disruptions after restart and a brand-new (and badly over-budget) *Quench Protection Upgrade*.
- A Thomson-scattering channel **drifts out of calibration** for three weeks (it reads hot compared with the shot log).
- **Coldstream Superconductor Tapes** hits a tape shortage: deliveries slip by months, the HTS Coil Program underspends
  and then catches up; **Vesselcraft Fabrication** is on probation for a reason.
- The money side is real: fiscal-year budgets (July start) vs GL actuals, spend charged to grants, a utility partnership,
  a PPA prepayment and four equity rounds — hiring jumps after Series B and Series C.
`,
  shapes: ['R&D experiments', 'IoT / diagnostics', 'Finance: budget vs actual', 'Funding & cap table', 'Procurement lifecycle', 'HR (SCD2) & publications'],
  fiscalYearStartMonth: 7,
  holidays: [...GENERIC_HOLIDAYS, { name: 'First Plasma Day', month: 5, day: 17 }],
  timeDim: true,
  sources: SUNJAR_SOURCES,
  issues: SUNJAR_ISSUES,
  tables: SUNJAR_TABLES,
  measures,
  fieldParameter: {
    name: 'Shot Breakdown',
    fields: [
      { label: 'Device', ref: "'Device'[Device Name]" },
      { label: 'Device Type', ref: "'Device'[Device Type]" },
      { label: 'Campaign', ref: "'Campaign'[Campaign Name]" },
      { label: 'Heating Scheme', ref: "'Shot Profile'[Heating Scheme]" },
      { label: 'Fuel', ref: "'Shot Profile'[Fuel]" },
      { label: 'Shot Mode', ref: "'Shot Profile'[Shot Mode]" },
      { label: 'Outcome', ref: "'Shot Outcome'[Outcome]" },
      { label: 'Team', ref: "'Staff'[Team]" }
    ]
  },
  report: [
    {
      name: 'Plasma Performance',
      visuals: [
        { type: 'slicer', field: { table: 'Device', column: 'Device Name' }, title: 'Device' },
        { type: 'slicer', field: { table: 'Date', column: 'Year' }, title: 'Year', mode: 'Basic' },
        { type: 'card', measure: 'Shots' },
        { type: 'card', measure: 'Success Rate %' },
        { type: 'card', measure: 'Best Q' },
        { type: 'card', measure: 'Record Shots' },
        { type: 'line', category: { table: 'Date', column: 'Month Start' }, measures: ['Best Triple Product'], title: 'Learning curve: best triple product by month' },
        { type: 'column', category: { table: 'Device', column: 'Device Name' }, measures: ['Shots'], title: 'Shots by Device' },
        { type: 'matrix', rows: [{ table: 'Campaign', column: 'Campaign Name' }], measures: ['Shots', 'Disruption Rate %', 'Avg Peak Temp (keV)', 'Best Q'], title: 'Campaign Scorecard' },
        { type: 'bar', category: { table: 'Shot Outcome', column: 'Disruption Type' }, measures: ['Shots'], title: 'Shots by Outcome Cause' }
      ]
    },
    {
      name: 'Finance & Operations',
      visuals: [
        { type: 'slicer', field: { table: 'Project', column: 'Program' }, title: 'Program' },
        { type: 'card', measure: 'Actual Spend (Smart Units)', title: 'Actual Spend' },
        { type: 'card', measure: 'Budget Variance %' },
        { type: 'card', measure: 'Committed Funding' },
        { type: 'card', measure: 'Headcount' },
        { type: 'line', category: { table: 'Date', column: 'Month Start' }, measures: ['Actual Spend', 'Budget'], title: 'Spend vs Budget' },
        { type: 'column', category: { table: 'GL Account', column: 'Account Group' }, measures: ['Actual Spend'], title: 'Spend by Account Group' },
        { type: 'matrix', rows: [{ table: 'Project', column: 'Project Name' }], columns: [{ table: 'Time Intelligence', column: 'Time Calculation' }], measures: ['Actual Spend'], title: 'Time Intelligence (calculation group)' },
        { type: 'column', category: { table: 'Supplier', column: 'Supplier Name' }, measures: ['On-Time Delivery %'], title: 'Supplier On-Time %' }
      ]
    }
  ],
  analyses: [
    { title: 'Breakeven day', question: 'When did Sunjar first reach Q ≥ 1, on which device, fuel and campaign?', how: 'Breakeven Shots and Best Q by Date; drill to the shot (Shot ID) and its profile; compare with the Rolling 90D line.' },
    { title: 'The learning curve', question: 'How fast does each device improve, and how big was the heating-upgrade step on Jarbelly-1?', how: 'Best Q (Rolling 90D) and Best Triple Product by month per device; annotate the upgrade date.' },
    { title: 'The quench', question: 'Find the magnet quench: how long was Jarbelly-1 down, and what happened to disruptions after restart?', how: 'Device Day status over time, Disruption Rate % by week, Safety Incidents and Major Findings around the event.' },
    { title: 'Disruption drivers', question: 'Which shot modes and densities cause density-limit disruptions?', how: 'Disruption Rate % by Shot Mode × Disruption Type; scatter Density vs Peak Temp coloured by outcome.' },
    { title: 'Calibration drift', question: 'One diagnostic channel read 12% hot for three weeks. Which one, and when?', how: 'Join silver_diagnostic_readings (TS channel) to silver_shots on shot_id and plot reading ÷ logged temperature over time.' },
    { title: 'D-T vs D-D', question: 'How much more fusion energy per shot does D-T fuel give after the tritium licence?', how: 'Fusion Energy (MJ) ÷ Shots by Shot Profile[Fuel] and month.' },
    { title: 'Budget overruns', question: 'Which projects blow their budget, and when did the overspend start?', how: 'Budget Variance % by Project with the Time Intelligence calculation group; spot Quench Protection Upgrade and Breakeven Push.' },
    { title: 'Runway', question: 'At the current burn rate, how many months of committed funding remain?', how: 'Burn Rate (3M Avg) vs Committed Funding − cumulative Actual Spend; Funding Drawn % per source.' },
    { title: 'Funding mix', question: 'Who funds Sunjar — and which spend runs on grants vs equity?', how: 'Actual Spend by Funding Source[Source Type]; silver_funding_commitments by investor type; lead investors per round.' },
    { title: 'HTS tape shortage', question: 'How late were superconducting tape deliveries during the shortage, and did it ripple into project milestones?', how: 'On-Time Delivery % and average Lead Time Days by Supplier over Order Date; silver_milestones slip for the HTS Coil Program.' },
    { title: 'Supplier quality', question: 'Which supplier has the worst QA rejection and on-time record?', how: 'QA Rejection Rate % and On-Time Delivery % by Supplier; Component Spend by Received Date via USERELATIONSHIP.' },
    { title: 'Research output', question: 'Which teams publish most, and how did the breakeven paper change citations?', how: 'Publications and SUM(Publication[Citations]) by Staff[Team] through the Authorship bridge (bidirectional).' },
    { title: 'Growing the team', question: 'How did headcount and salary bands change after Series B and Series C?', how: 'Headcount (semi-additive) by month; Staff SCD2 versions by Grade; compare with Funding Source close dates.' },
    { title: 'Selling power before it exists', question: 'How much future capacity is already contracted, and at what price?', how: 'Contracted PPA Capacity (MW) by counterparty type; weighted price (prices blank where confidential).' }
  ],
  notes: `
## Physics note

Q in this dataset is a stylised function of the triple product (Q ≈ (nTτE / 3)^1.6 for D-T, ~250× lower for D-D),
not a plasma simulation — but it behaves the way people expect: better confinement and hotter, denser plasmas raise Q,
pushing harder causes more disruptions, and the test stand produces no plasma at all (its plasma columns are blank).

## Volume note

\`small\` uses realistic shot cadences (tens of shots per run day per device); \`large\` multiplies the cadence ×30
(think high-repetition-rate pulsed operation) — ratios stay the same.
`,
  generate: generateSunjar,
  invariants(t) {
    const errors: string[] = []
    // Q = fusion power ÷ heating power; energies = power × duration
    errors.push(...checkRows('Q = P_fus / P_heat', t.get('gold_fact_shot'), (r) => r.q_factor === null || near(r.q_factor as number, (r.fusion_power_mw as number) / (r.heating_power_mw as number), 1e-5)))
    errors.push(...checkRows('E_in = P_heat × duration', t.get('gold_fact_shot'), (r) => near(r.energy_in_mj as number, ((r.heating_power_mw as number) * (r.duration_ms as number)) / 1000, 0.001)))
    errors.push(...checkRows('triple product = n·T·τ', t.get('gold_fact_shot'), (r) => r.triple_product === null || near(r.triple_product as number, ((r.density_1e20 as number) * (r.peak_temp_kev as number) * (r.confinement_ms as number)) / 1000, 1e-5)))
    // device-day snapshot ties to the shots
    errors.push(...compareSums('device-day shots', groupSum(t.get('gold_fact_device_day'), ['device_key', 'date_key'], 'shots'), groupCount(t.get('gold_fact_shot'), ['device_key', 'date_key']), 0))
    const disr = new Map<string, number>()
    for (const r of rowsOf(t.get('gold_fact_shot'))) if (r.is_disruption) disr.set(`${r.device_key}|${r.date_key}`, (disr.get(`${r.device_key}|${r.date_key}`) ?? 0) + 1)
    errors.push(...compareSums('device-day disruptions', groupSum(t.get('gold_fact_device_day'), ['device_key', 'date_key'], 'disruptions'), disr, 0))
    // finance: actuals = Σ GL lines; budgets = Σ unpivoted workbooks
    const projKey = new Map<string, number>()
    for (const r of rowsOf(t.get('gold_dim_project'))) projKey.set(r.project_code as string, r.project_key as number)
    const accKey = new Map<string, number>()
    for (const r of rowsOf(t.get('gold_dim_gl_account'))) accKey.set(r.account_code as string, r.account_key as number)
    const dateMonthEnd = (d: Date) => {
      const e = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0))
      return e.getUTCFullYear() * 10000 + (e.getUTCMonth() + 1) * 100 + e.getUTCDate()
    }
    const gl = new Map<string, number>()
    for (const r of rowsOf(t.get('silver_gl_lines'))) {
      const k = `${projKey.get(r.project_code as string) ?? -1}|${accKey.get(r.account_code as string)}|${dateMonthEnd(r.posting_date as Date)}`
      gl.set(k, (gl.get(k) ?? 0) + (r.amount as number))
    }
    const fact = new Map<string, number>()
    const factBudget = new Map<string, number>()
    for (const r of rowsOf(t.get('gold_fact_finance_month'))) {
      const k = `${r.project_key}|${r.account_key}|${r.month_end_date_key}`
      if (r.actual_amount !== null) fact.set(k, (fact.get(k) ?? 0) + (r.actual_amount as number))
      factBudget.set(k, (factBudget.get(k) ?? 0) + (r.budget_amount as number))
    }
    errors.push(...compareSums('finance actual = Σ GL lines', fact, gl, 0.02))
    const bud = new Map<string, number>()
    const dates = [...rowsOf(t.get('gold_dim_date'))].map((r) => (r.date as Date).getTime())
    const first = Math.min(...dates)
    const last = Math.max(...dates)
    for (const r of rowsOf(t.get('silver_budget_monthly'))) {
      const k = `${projKey.get(r.project_code as string)}|${accKey.get(r.account_code as string)}|${dateMonthEnd(r.month_start as Date)}`
      if (factBudget.has(k) || (r.budget_amount as number) === 0) continue
      const ms = (r.month_start as Date).getTime()
      if (ms >= first && ms <= last) bud.set(k, r.budget_amount as number)
    }
    if (bud.size) errors.push(`budget rows missing from finance fact: ${[...bud.keys()].slice(0, 3).join(', ')}`)
    for (const [k, v] of factBudget) {
      const [pk, ak, mk] = k.split('|')
      if (pk === '-1') continue
      void ak
      void mk
      if (v <= 0) errors.push(`finance budget ≤ 0 for ${k}`)
    }
    // funding: commitments sum to each source's committed amount
    errors.push(...compareSums('Σ commitments = committed', groupSum(t.get('silver_funding_commitments'), ['funding_code'], 'amount'), groupSum(t.get('gold_dim_funding_source'), ['funding_code'], 'committed_amount'), 0.02))
    // procurement lifecycle consistency
    errors.push(...checkRows('component order lifecycle', t.get('gold_fact_component_order'), (r) => {
      const s = r.order_status
      if (s === 'Installed') return r.installed_date_key !== null && r.received_date_key !== null
      if (s === 'Received') return r.received_date_key !== null && r.installed_date_key === null
      if (s === 'Shipped') return r.shipped_date_key !== null && r.received_date_key === null
      return r.shipped_date_key === null && r.received_date_key === null
    }))
    errors.push(...checkRows('rejected ≤ received', t.get('gold_fact_component_order'), (r) => (r.rejected_qty as number) <= (r.received_qty as number)))
    // authorship: each publication has authors and exactly one corresponding author
    const corr = groupSum(t.get('gold_bridge_publication_author'), ['publication_key'], 'is_corresponding')
    const authors = groupCount(t.get('gold_bridge_publication_author'), ['publication_key'])
    for (const r of rowsOf(t.get('gold_dim_publication'))) {
      const k = String(r.publication_key)
      if ((authors.get(k) ?? 0) !== r.author_count) errors.push(`publication ${k}: author_count mismatch`)
      if ((corr.get(k) ?? 0) !== 1) errors.push(`publication ${k}: ${corr.get(k) ?? 0} corresponding authors`)
    }
    return errors
  }
}

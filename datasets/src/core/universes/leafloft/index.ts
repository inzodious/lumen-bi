/**
 * Leafloft Vertical Farms — indoor vertical farms that sell their harvest as veggie-box
 * subscriptions. Subscription / SaaS metrics (MRR bridge, cohorts, churn) + IoT telemetry + an
 * accumulating grow-batch lifecycle.
 */
import { GENERIC_HOLIDAYS } from '../../calendar.ts'
import { checkRows, compareSums, groupSum, near, rowsOf } from '../../check.ts'
import type { MeasureSpec, Universe } from '../../schema.ts'
import { generateLeafloft } from './generate.ts'
import { LEAFLOFT_ISSUES, LEAFLOFT_SOURCES, LEAFLOFT_TABLES } from './tables.ts'

const M = "'Subscription MRR'"
const DL = "'Deliveries'"
const GB = "'Grow Batch'"
const RC = "'Room Climate'"
const DATE = "'Date'[Date]"
const LAST_SNAPSHOT = `LASTNONBLANK ( ${DATE}, CALCULATE ( COUNTROWS ( ${M} ) ) )`
const FIRST_SNAPSHOT = `FIRSTNONBLANK ( ${DATE}, CALCULATE ( COUNTROWS ( ${M} ) ) )`

const measures: MeasureSpec[] = [
  // Subscriptions
  { name: 'MRR', expr: `CALCULATE ( SUM ( ${M}[Closing MRR] ), ${LAST_SNAPSHOT} )`, format: '$#,0', folder: 'Subscriptions', description: 'Monthly recurring revenue at the last snapshot in context (semi-additive over time).' },
  { name: 'ARR', expr: '[MRR] * 12', format: '$#,0', folder: 'Subscriptions', description: 'Annualised recurring revenue.' },
  {
    name: 'MRR (Smart Units)',
    expr: '[MRR]',
    formatExpr: 'SWITCH ( TRUE (), ABS ( [MRR] ) >= 1000000, "$#,0.0,,""M""", ABS ( [MRR] ) >= 1000, "$#,0.0,""K""", "$#,0" )',
    folder: 'Subscriptions',
    description: 'MRR with a dynamic format string ($1.2M / $48.5K / $900).'
  },
  { name: 'Active Subscriptions', expr: `CALCULATE ( COUNTROWS ( ${M} ), ${M}[Is Active End] = TRUE (), ${LAST_SNAPSHOT} )`, format: '#,0', folder: 'Subscriptions', description: 'Paying subscriptions at the last snapshot in context.' },
  { name: 'ARPU', expr: 'DIVIDE ( [MRR], [Active Subscriptions] )', format: '$#,0.00', folder: 'Subscriptions', description: 'Average MRR per paying subscription.' },
  { name: 'Opening MRR', expr: `CALCULATE ( SUM ( ${M}[Opening MRR] ), ${FIRST_SNAPSHOT} )`, format: '$#,0', folder: 'MRR Bridge', description: 'MRR at the start of the first month in context.' },
  { name: 'New MRR', expr: `SUM ( ${M}[New MRR] )`, format: '$#,0', folder: 'MRR Bridge', description: 'MRR from first-time starts.' },
  { name: 'Expansion MRR', expr: `SUM ( ${M}[Expansion MRR] )`, format: '$#,0', folder: 'MRR Bridge', description: 'Upgrades, add-ons and price rises.' },
  { name: 'Reactivation MRR', expr: `SUM ( ${M}[Reactivation MRR] )`, format: '$#,0', folder: 'MRR Bridge', description: 'Resumed pauses and win-backs.' },
  { name: 'Contraction MRR', expr: `SUM ( ${M}[Contraction MRR] )`, format: '$#,0', folder: 'MRR Bridge', description: 'Downgrades, removed add-ons and pauses.' },
  { name: 'Churned MRR', expr: `SUM ( ${M}[Churned MRR] )`, format: '$#,0', folder: 'MRR Bridge', description: 'MRR lost to cancellations.' },
  { name: 'Net New MRR', expr: '[New MRR] + [Expansion MRR] + [Reactivation MRR] - [Contraction MRR] - [Churned MRR]', format: '$#,0;-$#,0', folder: 'MRR Bridge', description: 'Net change in MRR.' },
  { name: 'Net Revenue Retention %', expr: 'DIVIDE ( [Opening MRR] + [Expansion MRR] - [Contraction MRR] - [Churned MRR], [Opening MRR] )', format: '0.0%', folder: 'Retention', description: 'Revenue kept from the opening base incl. expansion (excludes new and reactivated).' },
  { name: 'Gross Revenue Retention %', expr: 'DIVIDE ( [Opening MRR] - [Contraction MRR] - [Churned MRR], [Opening MRR] )', format: '0.0%', folder: 'Retention', description: 'Revenue kept from the opening base, ignoring expansion.' },
  { name: 'Churned Subscriptions', expr: `CALCULATE ( COUNTROWS ( ${M} ), ${M}[Status End] = "Churned" )`, format: '#,0', folder: 'Retention', description: 'Cancellations in the period.' },
  {
    name: 'Logo Churn %',
    expr: `DIVIDE ( [Churned Subscriptions], CALCULATE ( COUNTROWS ( ${M} ), ${M}[Opening MRR] > 0, ${FIRST_SNAPSHOT} ) )`,
    format: '0.0%',
    folder: 'Retention',
    description: 'Cancellations ÷ paying subscriptions at the start of the period.'
  },
  {
    name: 'Cohort MRR Retention %',
    expr: `DIVIDE ( SUM ( ${M}[Closing MRR] ), CALCULATE ( SUM ( ${M}[Closing MRR] ), ${M}[Tenure Month] = 0 ) )`,
    format: '0%',
    folder: 'Retention',
    description: 'Closing MRR as a share of the cohort\'s month-0 MRR — put Customer[Cohort Month] on rows and Tenure Month on columns.'
  },
  { name: 'Cohort MRR', expr: `CALCULATE ( SUM ( ${M}[Closing MRR] ), USERELATIONSHIP ( ${M}[Cohort Date Key], 'Date'[Date Key] ) )`, format: '$#,0', folder: 'Retention', description: 'Closing MRR attributed to the cohort month on the Date axis (role-playing date via USERELATIONSHIP).' },
  { name: 'MRR PY', expr: `CALCULATE ( [MRR], SAMEPERIODLASTYEAR ( ${DATE} ) )`, format: '$#,0', folder: 'Time Intelligence', description: 'MRR at the same point last year.' },
  { name: 'MRR YoY %', expr: 'DIVIDE ( [MRR] - [MRR PY], [MRR PY] )', format: '0.0%;-0.0%;0.0%', folder: 'Time Intelligence', description: 'Year-over-year MRR growth.' },
  // Deliveries
  { name: 'Delivery Revenue', expr: `SUM ( ${DL}[Net Amount] )`, format: '$#,0', folder: 'Deliveries', description: 'Billed box revenue.' },
  { name: 'Delivery Revenue YTD', expr: `TOTALYTD ( [Delivery Revenue], ${DATE} )`, format: '$#,0', folder: 'Time Intelligence', description: 'Year-to-date billed box revenue.' },
  { name: 'Delivery Revenue 28D Avg', expr: `AVERAGEX ( DATESINPERIOD ( ${DATE}, MAX ( ${DATE} ), -28, DAY ), [Delivery Revenue] )`, format: '$#,0', folder: 'Time Intelligence', description: 'Rolling 28-day average daily revenue.' },
  { name: 'Boxes Delivered', expr: `CALCULATE ( COUNTROWS ( ${DL} ), ${DL}[Status] = "Delivered" )`, format: '#,0', folder: 'Deliveries', description: 'Boxes that reached the customer.' },
  { name: 'Avg Box Revenue', expr: 'DIVIDE ( [Delivery Revenue], [Boxes Delivered] )', format: '$#,0.00', folder: 'Deliveries', description: 'Revenue per delivered box.' },
  { name: 'On-Time %', expr: `DIVIDE ( CALCULATE ( COUNTROWS ( ${DL} ), ${DL}[Is On Time] = TRUE () ), [Boxes Delivered] )`, format: '0.0%', folder: 'Deliveries', description: 'Delivered inside the promised window.' },
  { name: 'Skip Rate %', expr: `DIVIDE ( CALCULATE ( COUNTROWS ( ${DL} ), ${DL}[Status] = "Skipped" ), COUNTROWS ( ${DL} ) )`, format: '0.0%', folder: 'Deliveries', description: 'Scheduled drops the customer skipped.' },
  // Farm
  { name: 'Harvested kg', expr: `SUM ( ${GB}[Harvested kg] )`, format: '#,0', folder: 'Farm', description: 'Harvested weight (by seeding date).' },
  { name: 'Harvested kg by Harvest Date', expr: `CALCULATE ( [Harvested kg], USERELATIONSHIP ( ${GB}[Harvest Date Key], 'Date'[Date Key] ) )`, format: '#,0', folder: 'Farm', description: 'Harvested weight dated by harvest (inactive role-playing relationship).' },
  { name: 'Target kg', expr: `CALCULATE ( SUM ( ${GB}[Target Yield kg] ), ${GB}[Status] = "Harvested" )`, format: '#,0', folder: 'Farm', description: 'Target weight of harvested batches.' },
  { name: 'Yield vs Target %', expr: 'DIVIDE ( [Harvested kg], [Target kg] )', format: '0.0%', folder: 'Farm', description: 'Actual vs target yield.' },
  { name: 'Yield per m²', expr: `DIVIDE ( [Harvested kg], CALCULATE ( SUM ( ${GB}[Growing Area m²] ), ${GB}[Status] = "Harvested" ) )`, format: '0.00', folder: 'Farm', description: 'kg harvested per m² of canopy per cycle.' },
  { name: 'Batch Failure %', expr: `DIVIDE ( CALCULATE ( COUNTROWS ( ${GB} ), ${GB}[Status] = "Failed" ), CALCULATE ( COUNTROWS ( ${GB} ), ${GB}[Status] <> "Growing" ) )`, format: '0.0%', folder: 'Farm', description: 'Completed batches that were discarded.' },
  { name: 'Crop Rank', expr: `IF ( HASONEVALUE ( 'Crop'[Crop] ), RANKX ( ALL ( 'Crop'[Crop] ), [Harvested kg] ) )`, format: '0', folder: 'Farm', description: 'Rank of the crop by harvested weight.' },
  // Environment & energy
  { name: 'Avg Temp °C', expr: `AVERAGE ( ${RC}[Avg Temp °C] )`, format: '0.0', folder: 'Environment', description: 'Average room temperature.' },
  { name: 'Energy kWh', expr: `SUM ( ${RC}[Energy kWh] )`, format: '#,0', folder: 'Environment', description: 'Metered room energy.' },
  { name: 'Energy Cost', expr: `SUM ( ${RC}[Energy Cost] )`, format: '$#,0', folder: 'Environment', description: 'Energy at the monthly farm tariff.' },
  { name: 'kWh per kg', expr: 'DIVIDE ( [Energy kWh], [Harvested kg by Harvest Date] )', format: '0.0', folder: 'Environment', description: 'Energy intensity of production.' },
  { name: 'Climate Alerts', expr: `SUM ( ${RC}[Alert Count] )`, format: '#,0', folder: 'Environment', description: 'Readings outside the climate band.' },
  { name: 'HVAC Fault Days', expr: `CALCULATE ( COUNTROWS ( ${RC} ), ${RC}[Is HVAC Fault] = TRUE () )`, format: '#,0', folder: 'Environment', description: 'Room-days with a logged HVAC fault.' }
]

export const leafloft: Universe = {
  id: 'leafloft',
  company: 'Leafloft Vertical Farms',
  name: 'Leafloft',
  tagline: 'Salad grown sixteen tiers high, delivered by bicycle — and billed like a SaaS company.',
  premise: `
Leafloft turns empty warehouses into **vertical farms**: windowless rooms of LED-lit racks, six or seven tiers
high, growing lettuce, kale, basil, microgreens, strawberries and cherry tomatoes without a speck of soil. The
harvest goes out in **veggie-box subscriptions** — *Sprout*, *Canopy*, *Rainforest* and the *Skyfarm Office* box —
plus add-ons like the Microgreens Medley and the Skyberry Punnet.

That makes Leafloft two businesses in one lakehouse:

- **A subscription company.** Every start, upgrade, downgrade, add-on, pause, cancellation and win-back is an
  event; the monthly MRR snapshot bridges exactly (opening + new + expansion + reactivation − contraction − churned
  = closing), so cohort retention curves, NRR and logo churn all work. January brings New-Year's-resolution
  signups, summer brings vacation pauses, and a spring **"Spring Greens Blitz"** campaign brings a big, cheap,
  flaky cohort (watch the *Influencer* channel). A mid-history **8 % price rise** shows up as expansion MRR — and
  as a churn spike the month after.
- **An IoT-instrumented factory.** Every room reports temperature, humidity, CO2, light (PPFD/DLI), pH, EC and
  energy every four hours. Racks get **LED Gen2 retrofits** (more light per watt, higher yields — tracked as SCD2
  versions). One summer an **HVAC unit fails** for two and a half weeks: rooms run hot, heat-sensitive lettuce
  and cilantro bolt, batches fail — and subscribers served by that farm cancel with "Quality Issue". Meanwhile one
  room's **CO2 sensor slowly drifts upward** while its yields stay perfectly normal: a calibration problem, not a
  plant problem.
`,
  shapes: ['Subscription / SaaS metrics', 'IoT telemetry', 'Accumulating snapshot (grow batches)', 'Cohorts & retention', 'Energy'],
  fiscalYearStartMonth: 1,
  holidays: [...GENERIC_HOLIDAYS, { name: 'Leafloft Harvest Festival', month: 9, day: 21 }],
  sources: LEAFLOFT_SOURCES,
  issues: LEAFLOFT_ISSUES,
  tables: LEAFLOFT_TABLES,
  measures,
  fieldParameter: {
    name: 'Growth Breakdown',
    fields: [
      { label: 'Plan', ref: "'Plan'[Plan Name]" },
      { label: 'Customer Type', ref: "'Customer'[Customer Type]" },
      { label: 'Channel', ref: "'Customer'[Acquisition Channel]" },
      { label: 'Zone', ref: "'Customer'[Delivery Zone]" },
      { label: 'Cohort', ref: "'Customer'[Cohort Month]" },
      { label: 'Farm', ref: "'Farm'[Farm Name]" }
    ]
  },
  report: [
    {
      name: 'Subscription Health',
      visuals: [
        { type: 'slicer', field: { table: 'Customer', column: 'Customer Type' }, title: 'Customer Type' },
        { type: 'slicer', field: { table: 'Date', column: 'Year' }, title: 'Year', mode: 'Basic' },
        { type: 'card', measure: 'MRR (Smart Units)', title: 'MRR' },
        { type: 'card', measure: 'Active Subscriptions' },
        { type: 'card', measure: 'Net Revenue Retention %' },
        { type: 'card', measure: 'Logo Churn %' },
        { type: 'line', category: { table: 'Date', column: 'Month Start' }, measures: ['MRR', 'MRR PY'], title: 'MRR vs Prior Year' },
        { type: 'column', category: { table: 'Customer', column: 'Acquisition Channel' }, measures: ['New MRR', 'Churned MRR'], title: 'New vs Churned MRR by Channel' },
        { type: 'matrix', rows: [{ table: 'Customer', column: 'Cohort Month' }], columns: [{ table: 'Subscription MRR', column: 'Tenure Month' }], measures: ['Cohort MRR Retention %'], title: 'Cohort MRR Retention' },
        { type: 'bar', category: { table: 'Plan', column: 'Plan Name' }, measures: ['MRR'], title: 'MRR by Plan' }
      ]
    },
    {
      name: 'Farm Operations',
      visuals: [
        { type: 'slicer', field: { table: 'Farm', column: 'Farm Name' }, title: 'Farm' },
        { type: 'card', measure: 'Harvested kg' },
        { type: 'card', measure: 'Yield vs Target %' },
        { type: 'card', measure: 'Batch Failure %' },
        { type: 'card', measure: 'kWh per kg' },
        { type: 'line', category: { table: 'Date', column: 'Month Start' }, measures: ['Avg Temp °C'], title: 'Room Temperature' },
        { type: 'column', category: { table: 'Crop', column: 'Crop Category' }, measures: ['Yield per m²'], title: 'Yield per m² by Crop Category' },
        { type: 'matrix', rows: [{ table: 'Room', column: 'Room Name' }], columns: [{ table: 'Time Intelligence', column: 'Time Calculation' }], measures: ['Harvested kg'], title: 'Harvest with Time Intelligence' },
        { type: 'bar', category: { table: 'Rack', column: 'Light Type' }, measures: ['Yield per m²'], title: 'LED Gen1 vs Gen2' }
      ]
    }
  ],
  analyses: [
    { title: 'MRR bridge', question: 'How did MRR move each month — new, expansion, reactivation, contraction, churn?', how: 'Waterfall of the MRR Bridge measures by Date[Year Month]; Net New MRR line.' },
    { title: 'Cohort retention curves', question: 'Which signup cohorts keep their revenue — and is the Spring Greens Blitz cohort the leakiest?', how: 'Matrix Customer[Cohort Month] × Subscription MRR[Tenure Month] with Cohort MRR Retention %; conditional formatting heat map.' },
    { title: 'Channel quality', question: 'Influencer and Social Ads bring volume; do they bring durable customers?', how: 'Logo Churn % and Net Revenue Retention % by Customer[Acquisition Channel]; the Growth Breakdown field parameter.' },
    { title: 'Price rise fallout', question: 'The 8 % price rise added expansion MRR overnight. How much churn followed, and did it pay off?', how: 'Expansion MRR and Churned MRR around the rise month; churn_reason = "Price" in Subscription.' },
    { title: 'Summer pauses', question: 'How much MRR is parked in pauses each summer and how much comes back?', how: 'Contraction MRR vs Reactivation MRR by month; status_end = Paused counts.' },
    { title: 'The HVAC failure', question: 'Find the room that ran hot. Which crops failed, and what did it cost in kg and dollars?', how: 'Room Climate Avg Temp °C and HVAC Fault Days by room; Batch Failure % and Yield vs Target % by Crop[Heat Sensitive] for batches growing during the fault.' },
    { title: 'Quality churn', question: 'Did subscribers served by the farm with the HVAC failure cancel more afterwards?', how: 'Churned Subscriptions by Deliveries[Farm] or Customer zone and month; churn_reason = "Quality Issue".' },
    { title: 'Sensor drift vs reality', question: 'One room\'s CO2 keeps climbing. Is the room broken or the sensor?', how: 'Avg CO2 PPM trend by room next to Yield vs Target % for the same room — yields stay flat, so recalibrate the sensor.' },
    { title: 'LED retrofit ROI', question: 'How much more yield per m² and how much less energy per kg after the Gen2 retrofits?', how: 'Yield per m² by Rack[Light Type] (SCD2 version at seeding); kWh per kg before/after each farm\'s retrofit date.' },
    { title: 'Crop economics', question: 'Which crops earn the most per m² per day of rack time?', how: 'Harvest value (silver) ÷ (area × days to harvest) by Crop; Crop Rank.' },
    { title: 'Delivery reliability', question: 'When does on-time performance dip, and do skips rise in summer?', how: 'On-Time % and Skip Rate % by Date[Month Name] and Farm.' },
    { title: 'Unit economics', question: 'What is ARPU by plan and how much of it comes from add-ons?', how: 'ARPU by Plan; bridge Subscription Add-on → Add-on to slice MRR by add-on (many-to-many).' }
  ],
  notes: `
## Modelling notes

- **MRR is semi-additive**: use the \`MRR\`, \`Active Subscriptions\` and \`Opening MRR\` measures (LASTNONBLANK /
  FIRSTNONBLANK over Date) — never sum Closing MRR across months.
- **Pauses** count as contraction (to 0) and resumes as reactivation, so the MRR bridge always ties out.
- **Add-ons** are many-to-many: the Subscription Add-on bridge filters Subscription in both directions, so an
  Add-on slicer filters MRR and Deliveries.
- Production volumes (farms, rooms, racks, batches, telemetry) are the same at \`small\` and \`large\`; the demand
  side (customers, subscriptions, deliveries) scales ×30 in \`large\`.
`,
  generate: generateLeafloft,
  invariants(t) {
    const errors: string[] = []
    const mrr = t.get('gold_fact_subscription_month')
    errors.push(...checkRows('MRR bridge', mrr, (r) => near((r.opening_mrr as number) + (r.new_mrr as number) + (r.expansion_mrr as number) + (r.reactivation_mrr as number) - (r.contraction_mrr as number) - (r.churned_mrr as number), r.closing_mrr as number)))
    // opening = previous month's closing
    const last = new Map<number, { month: number; closing: number }>()
    const sorted = [...rowsOf(mrr)].sort((a, b) => (a.month_date_key as number) - (b.month_date_key as number))
    for (const r of sorted) {
      const key = r.subscription_key as number
      const ym = Math.floor((r.month_date_key as number) / 100)
      const prev = last.get(key)
      const prevYm = ym % 100 === 1 ? ym - 89 : ym - 1
      if (prev && prev.month === prevYm && !near(prev.closing, r.opening_mrr as number)) {
        errors.push(`MRR opening ≠ previous closing for subscription ${key} at ${r.month_date_key}`)
        break
      }
      last.set(key, { month: ym, closing: r.closing_mrr as number })
    }
    // latest closing MRR equals the subscription's current MRR (rebuilt from events)
    const latest = new Map<string, number>()
    const subId = new Map<number, string>()
    for (const r of rowsOf(t.get('gold_dim_subscription'))) subId.set(r.subscription_key as number, r.subscription_id as string)
    for (const [key, v] of last) latest.set(subId.get(key)!, v.closing)
    errors.push(...compareSums('latest closing MRR = current MRR', latest, groupSum(t.get('silver_subscriptions'), ['subscription_id'], 'current_mrr')))
    errors.push(...compareSums('Σ event deltas = current MRR', groupSum(t.get('silver_subscription_events'), ['subscription_id'], 'mrr_after'), sumPlus(groupSum(t.get('silver_subscription_events'), ['subscription_id'], 'mrr_before'), groupSum(t.get('silver_subscriptions'), ['subscription_id'], 'current_mrr'))))
    // deliveries
    errors.push(...checkRows('delivery arithmetic', t.get('gold_fact_delivery'), (r) => (r.status === 'Delivered' ? near(r.net_amount as number, (r.box_value as number) + (r.addon_value as number) + (r.delivery_fee as number) - (r.discount_amount as number)) : r.net_amount === 0)))
    errors.push(...compareSums('silver vs gold delivery revenue', groupSum(t.get('silver_deliveries'), [], 'net_amount'), groupSum(t.get('gold_fact_delivery'), [], 'net_amount'), 0.05))
    // harvest = Σ weigh-ins; gold = silver
    errors.push(...compareSums('harvested kg = Σ weigh-ins', groupSum(t.get('silver_grow_batches'), ['batch_id'], 'harvested_kg'), groupSum(t.get('silver_harvest_weighins'), ['batch_id'], 'net_kg'), 0.0005))
    errors.push(...compareSums('gold harvested = silver', groupSum(t.get('gold_fact_grow_batch'), ['batch_id'], 'harvested_kg'), groupSum(t.get('silver_grow_batches'), ['batch_id'], 'harvested_kg'), 0.0005))
    errors.push(...checkRows('yield vs target', t.get('gold_fact_grow_batch'), (r) => r.status !== 'Harvested' || near(r.yield_vs_target as number, (r.harvested_kg as number) / (r.target_yield_kg as number), 0.0001)))
    // telemetry: daily energy = Σ 4-hour readings; avg temp = mean of valid readings
    const roomCode = new Map<number, string>()
    for (const r of rowsOf(t.get('gold_dim_room'))) roomCode.set(r.room_key as number, r.room_code as string)
    const silverEnergy = new Map<string, number>()
    const silverTemp = new Map<string, { s: number; n: number }>()
    for (const r of rowsOf(t.get('silver_sensor_readings'))) {
      const ts = r.reading_ts as Date
      const key = `${r.room_code}|${ts.toISOString().slice(0, 10)}`
      silverEnergy.set(key, (silverEnergy.get(key) ?? 0) + ((r.energy_kwh as number | null) ?? 0))
      if (r.temp_c !== null) {
        const a = silverTemp.get(key) ?? { s: 0, n: 0 }
        a.s += r.temp_c as number
        a.n++
        silverTemp.set(key, a)
      }
    }
    const goldEnergy = new Map<string, number>()
    for (const r of rowsOf(t.get('gold_fact_room_env_day'))) {
      const dk = r.date_key as number
      const key = `${roomCode.get(r.room_key as number)}|${Math.floor(dk / 10000)}-${String(Math.floor(dk / 100) % 100).padStart(2, '0')}-${String(dk % 100).padStart(2, '0')}`
      goldEnergy.set(key, r.energy_kwh as number)
      const st = silverTemp.get(key)
      if (st && !near(st.s / st.n, r.avg_temp_c as number, 0.001)) {
        errors.push(`avg temp mismatch ${key}`)
        break
      }
    }
    errors.push(...compareSums('room-day energy = Σ readings', goldEnergy, silverEnergy, 0.02))
    return errors
  }
}

function sumPlus(a: Map<string, number>, b: Map<string, number>): Map<string, number> {
  const out = new Map(a)
  for (const [k, v] of b) out.set(k, (out.get(k) ?? 0) + v)
  return out
}

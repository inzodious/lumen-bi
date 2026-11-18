/**
 * Gravelstar Mining Consortium — asteroid mining: claims, rigs (SCD2), extraction runs & assays,
 * refineries, equipment telemetry with degradation before failure, maintenance, freight hauls priced
 * off commodity curves, offtake contracts, crew rosters (bridge) and safety incidents.
 */
import { GENERIC_HOLIDAYS } from '../../calendar.ts'
import { checkRows, compareSums, groupSum, near, rowsOf } from '../../check.ts'
import type { MeasureSpec, Universe } from '../../schema.ts'
import { generateGravelstar } from './generate.ts'
import { GRAVELSTAR_ISSUES, GRAVELSTAR_SOURCES, GRAVELSTAR_TABLES } from './tables.ts'

const X = "'Extraction'"
const EQ = "'Equipment Day'"
const CG = "'Cargo'"
const SF = "'Safety Incidents'"
const DATE = "'Date'[Date]"

const measures: MeasureSpec[] = [
  // Production
  { name: 'Ore Mined (t)', expr: `SUM ( ${X}[Ore Tonnes] )`, format: '#,0', folder: 'Production', description: 'Ore delivered to shuttles.' },
  { name: 'Waste Rock (t)', expr: `SUM ( ${X}[Waste Tonnes] )`, format: '#,0', folder: 'Production', description: 'Waste rock moved.' },
  { name: 'Strip Ratio', expr: 'DIVIDE ( [Waste Rock (t)], [Ore Mined (t)] )', format: '0.00', folder: 'Production', description: 'Waste tonnes per ore tonne.' },
  { name: 'Extraction Runs', expr: `COUNTROWS ( ${X} )`, format: '#,0', folder: 'Production', description: 'Drilling shifts completed.' },
  { name: 'Drill Hours', expr: `SUM ( ${X}[Drill Hours] )`, format: '#,0', folder: 'Production', description: 'Hours the drill heads were cutting.' },
  { name: 'Ore per Drill Hour (t)', expr: 'DIVIDE ( [Ore Mined (t)], [Drill Hours] )', format: '#,0.0', folder: 'Production', description: 'Cutting productivity.' },
  { name: 'Energy per Tonne (MWh/t)', expr: `DIVIDE ( SUM ( ${X}[Energy MWh] ), [Ore Mined (t)] )`, format: '0.000', folder: 'Production', description: 'Reactor energy per ore tonne.' },
  { name: 'Contained Primary (kg)', expr: `SUM ( ${X}[Contained Primary kg] )`, format: '#,0', folder: 'Production', description: 'Primary mineral contained in mined ore.' },
  { name: 'Head Grade %', expr: 'DIVIDE ( [Contained Primary (kg)], [Ore Mined (t)] * 1000 )', format: '0.0000%', folder: 'Production', description: 'Tonnage-weighted primary grade (filter to one mineral for a meaningful number).' },
  { name: 'Estimated Ore Value', expr: `SUM ( ${X}[Estimated Value USD] )`, format: '$#,0', folder: 'Production', description: 'Contained primary mineral at the day\'s index price.' },
  { name: 'Ore Mined 30D Avg (t)', expr: `AVERAGEX ( DATESINPERIOD ( ${DATE}, MAX ( ${DATE} ), -30, DAY ), [Ore Mined (t)] )`, format: '#,0', folder: 'Time Intelligence', description: 'Rolling 30-day average of daily ore mined.' },
  // Equipment
  { name: 'Operating Hours', expr: `SUM ( ${EQ}[Operating Hours] )`, format: '#,0', folder: 'Equipment', description: 'Hours operating.' },
  { name: 'Downtime Hours', expr: `SUM ( ${EQ}[Downtime Hours] )`, format: '#,0', folder: 'Equipment', description: 'Hours down for maintenance or breakdowns.' },
  { name: 'Availability %', expr: 'DIVIDE ( [Operating Hours], [Operating Hours] + [Downtime Hours] )', format: '0.0%', folder: 'Equipment', description: 'Operating share of operating + down hours.' },
  { name: 'Breakdowns', expr: `CALCULATE ( COUNTROWS ( ${EQ} ), ${EQ}[Is Failure] = TRUE () )`, format: '#,0', folder: 'Equipment', description: 'Unplanned breakdowns.' },
  { name: 'MTBF (h)', expr: 'DIVIDE ( [Operating Hours], [Breakdowns] )', format: '#,0', folder: 'Equipment', description: 'Mean operating hours between breakdowns.' },
  { name: 'Planned Maintenance %', expr: `DIVIDE ( CALCULATE ( COUNTROWS ( ${EQ} ), ${EQ}[Is Planned Maintenance] = TRUE () ), CALCULATE ( COUNTROWS ( ${EQ} ), ${EQ}[Is Planned Maintenance] = TRUE () ) + [Breakdowns] )`, format: '0.0%', folder: 'Equipment', description: 'Planned work orders as a share of all maintenance events.' },
  { name: 'Maintenance Cost', expr: `SUM ( ${EQ}[Maintenance Cost USD] )`, format: '$#,0', folder: 'Equipment', description: 'Parts and labor.' },
  { name: 'Avg Vibration (mm/s)', expr: `AVERAGE ( ${EQ}[Avg Vibration (mm/s)] )`, format: '0.00', folder: 'Equipment', description: 'Mean vibration velocity.' },
  { name: 'Wear % (Latest)', expr: `CALCULATE ( AVERAGE ( ${EQ}[Drill Wear %] ), LASTDATE ( ${DATE} ) )`, format: '0.0', folder: 'Equipment', description: 'Semi-additive: average wear on the last date in context.' },
  // Sales & logistics
  { name: 'Revenue', expr: `SUM ( ${CG}[Revenue USD] )`, format: '$#,0', folder: 'Sales', description: 'Delivered quantity × contract price (by loading date).' },
  {
    name: 'Revenue (Smart Units)',
    expr: '[Revenue]',
    formatExpr: 'SWITCH ( TRUE (), ABS ( [Revenue] ) >= 1000000000, "$#,0.0,,,""B""", ABS ( [Revenue] ) >= 1000000, "$#,0.0,,""M""", ABS ( [Revenue] ) >= 1000, "$#,0.0,""K""", "$#,0" )',
    folder: 'Sales',
    description: 'Revenue with a dynamic format string ($1.2B / $3.4M / $56.7K).'
  },
  { name: 'Revenue by Delivery Date', expr: `CALCULATE ( [Revenue], USERELATIONSHIP ( ${CG}[Delivered Date Key], 'Date'[Date Key] ) )`, format: '$#,0', folder: 'Sales', description: 'Revenue dated by delivery (role-playing date via USERELATIONSHIP).' },
  { name: 'Delivered (kg)', expr: `SUM ( ${CG}[Delivered kg] )`, format: '#,0', folder: 'Sales', description: 'Quantity delivered.' },
  { name: 'Transit Loss %', expr: `DIVIDE ( SUM ( ${CG}[Transit Loss kg] ), SUM ( ${CG}[Delivered kg] ) + SUM ( ${CG}[Transit Loss kg] ) )`, format: '0.00%', folder: 'Sales', description: 'Share of loaded product lost in transit (delivered hauls).' },
  { name: 'Avg Realized Price (USD/kg)', expr: 'DIVIDE ( [Revenue], [Delivered (kg)] )', format: '$#,0.00', folder: 'Sales', description: 'Revenue per delivered kg.' },
  {
    name: 'Price vs Index %',
    expr: `VAR Realized = [Revenue]\nVAR AtIndex = SUMX ( FILTER ( ${CG}, NOT ISBLANK ( ${CG}[Revenue USD] ) ), ${CG}[Delivered kg] * ${CG}[Index Price (USD/kg)] )\nRETURN\n    DIVIDE ( Realized - AtIndex, AtIndex )`,
    format: '0.0%;-0.0%;0.0%',
    folder: 'Sales',
    description: 'Realized revenue versus the same volume at the index price.'
  },
  { name: 'Receivables Outstanding', expr: `CALCULATE ( [Revenue], ${CG}[Status] = "Delivered" )`, format: '$#,0', folder: 'Sales', description: 'Delivered but not yet paid.' },
  { name: 'Avg Days to Pay', expr: `AVERAGE ( ${CG}[Days To Pay] )`, format: '0.0', folder: 'Sales', description: 'Average days from delivery to payment.' },
  { name: 'Revenue YTD', expr: `TOTALYTD ( [Revenue], ${DATE} )`, format: '$#,0', folder: 'Time Intelligence', description: 'Calendar year-to-date revenue.' },
  { name: 'Revenue FYTD', expr: `TOTALYTD ( [Revenue], ${DATE}, "3/31" )`, format: '$#,0', folder: 'Time Intelligence', description: 'Fiscal year-to-date (fiscal year starts 1 April).' },
  { name: 'Revenue PY', expr: `CALCULATE ( [Revenue], SAMEPERIODLASTYEAR ( ${DATE} ) )`, format: '$#,0', folder: 'Time Intelligence', description: 'Same period last year.' },
  { name: 'Revenue YoY %', expr: 'DIVIDE ( [Revenue] - [Revenue PY], [Revenue PY] )', format: '0.0%;-0.0%;0.0%', folder: 'Time Intelligence', description: 'Growth versus last year.' },
  { name: 'Customer Rank', expr: `IF ( HASONEVALUE ( 'Customer'[Customer Name] ), RANKX ( ALL ( 'Customer'[Customer Name] ), [Revenue] ) )`, format: '0', folder: 'Sales', description: 'Rank of the customer by revenue.' },
  // Safety
  { name: 'Incidents', expr: `COUNTROWS ( ${SF} )`, format: '#,0', folder: 'Safety', description: 'All reported incidents incl. near misses.' },
  { name: 'Lost Time Injuries', expr: `CALCULATE ( COUNTROWS ( ${SF} ), ${SF}[Lost Time Days] > 0 )`, format: '#,0', folder: 'Safety', description: 'Incidents with at least one lost work day.' },
  { name: 'LTIFR', expr: `DIVIDE ( [Lost Time Injuries] * 1000000, SUM ( ${EQ}[Crew Hours] ) )`, format: '0.00', folder: 'Safety', description: 'Lost-time injuries per million crew hours.' },
  { name: 'Days Lost', expr: `SUM ( ${SF}[Lost Time Days] )`, format: '#,0', folder: 'Safety', description: 'Work days lost.' },
  { name: 'Crew Who Served', expr: `CALCULATE ( DISTINCTCOUNT ( 'Crew Roster'[Crew Key] ) )`, format: '#,0', folder: 'Safety', description: 'Distinct crew aboard the vessels in context (many-to-many roster bridge).' }
]

export const gravelstar: Universe = {
  id: 'gravelstar',
  company: 'Gravelstar Mining Consortium',
  name: 'Gravelstar',
  tagline: 'We dig the belt so you don\'t have to — drill rigs, refineries and freighters working three rings of very grumpy rocks.',
  premise: `
Gravelstar Mining Consortium holds claims on asteroids with names like *Grumbleton*, *Potato Prime* and
*Sir Rocksalot*, spread across three rings — the **Inner Gravel Ring**, the **Middle Ring** and the
**Outer Rubble Belt**. Its drill rigs (*Old Rattler*, *Core Blimey*, *Shale We Dance*…) cut ore three
shifts a day, shuttle it to the belt's refinery, and its freighters (*Long Haul Linda*, *Bulk Bertha*…)
deliver refined Nickel-Iron, Cobalt, Platinum, Iridium, Water Ice, Ammonia, Rare Earths and the
glowing exotic **Lumenite** to shipyards, fuel depots, fabricators and habitats.

What makes the numbers move:

- **Physics of wear.** Every operating hour wears drill heads and drives; vibration and bearing temperature
  creep up, fault codes appear, and if maintenance is deferred the breakdown hazard explodes.
  *Old Rattler*'s crew keeps postponing its service — watch what happens.
- **Geology.** Grades vary run to run and **deplete** as a claim is mined; harder M- and X-type rocks cut slower.
  Mid-history a newly registered claim, *Old Crumble*, turns out to hide a **Lumenite seam** three times richer than expected.
- **Markets.** Prices follow a mean-reverting index with an **Iridium spike** (a shipyard boom) and a
  **Water Ice crash** (a comet harvest flooded the market). Fixed contracts protect — or hurt — depending on timing.
- **Customers.** Contracts are fixed-price, index-linked with a premium, or spot via the Belt Commodity Exchange.
  One habitat co-op pays later and later.
- **People and safety.** Crews rotate through vessels on tours of duty (a many-to-many roster). Night (Gamma)
  shifts and worn equipment raise incident risk, and a **decompression cluster** hit Sector 7 for two months.
`,
  shapes: ['IoT telemetry & predictive maintenance', 'Production & geology', 'Supply chain / logistics', 'Commodity pricing & contracts', 'Safety (HSE)', 'SCD2 assets'],
  fiscalYearStartMonth: 4,
  holidays: [...GENERIC_HOLIDAYS, { name: 'First Strike Day', month: 6, day: 21 }, { name: 'Perihelion Festival', month: 2, weekday: 5, nth: 2 }],
  sources: GRAVELSTAR_SOURCES,
  issues: GRAVELSTAR_ISSUES,
  tables: GRAVELSTAR_TABLES,
  measures,
  fieldParameter: {
    name: 'Production Breakdown',
    fields: [
      { label: 'Belt', ref: "'Claim'[Belt]" },
      { label: 'Claim', ref: "'Claim'[Asteroid Name]" },
      { label: 'Spectral Class', ref: "'Claim'[Spectral Class]" },
      { label: 'Rig', ref: "'Vessel'[Vessel Name]" },
      { label: 'Drill Head', ref: "'Vessel'[Drill Head]" },
      { label: 'Shift', ref: "'Run Profile'[Shift]" },
      { label: 'Mode', ref: "'Run Profile'[Operating Mode]" },
      { label: 'Mineral', ref: "'Mineral'[Mineral Name]" }
    ]
  },
  report: [
    {
      name: 'Operations',
      visuals: [
        { type: 'slicer', field: { table: 'Claim', column: 'Belt' }, title: 'Belt' },
        { type: 'slicer', field: { table: 'Date', column: 'Year' }, title: 'Year', mode: 'Basic' },
        { type: 'card', measure: 'Ore Mined (t)' },
        { type: 'card', measure: 'Availability %' },
        { type: 'card', measure: 'MTBF (h)' },
        { type: 'card', measure: 'LTIFR' },
        { type: 'line', category: { table: 'Date', column: 'Month Start' }, measures: ['Ore Mined (t)', 'Ore Mined 30D Avg (t)'], title: 'Ore Mined by Month' },
        { type: 'column', category: { table: 'Vessel', column: 'Vessel Name' }, measures: ['Breakdowns'], title: 'Breakdowns by Rig' },
        { type: 'matrix', rows: [{ table: 'Claim', column: 'Asteroid Name' }], measures: ['Ore Mined (t)', 'Head Grade %', 'Strip Ratio', 'Ore per Drill Hour (t)'], title: 'Claim Scorecard' },
        { type: 'bar', category: { table: 'Run Profile', column: 'Shift' }, measures: ['Extraction Runs'], title: 'Runs by Shift' }
      ]
    },
    {
      name: 'Sales & Markets',
      visuals: [
        { type: 'slicer', field: { table: 'Mineral', column: 'Mineral Group' }, title: 'Mineral Group' },
        { type: 'card', measure: 'Revenue (Smart Units)', title: 'Revenue' },
        { type: 'card', measure: 'Revenue YoY %' },
        { type: 'card', measure: 'Avg Days to Pay' },
        { type: 'card', measure: 'Receivables Outstanding' },
        { type: 'line', category: { table: 'Date', column: 'Month Start' }, measures: ['Revenue', 'Revenue by Delivery Date'], title: 'Revenue: Loaded vs Delivered Date' },
        { type: 'column', category: { table: 'Mineral', column: 'Mineral Name' }, measures: ['Revenue'], title: 'Revenue by Mineral' },
        { type: 'matrix', rows: [{ table: 'Customer', column: 'Customer Name' }], columns: [{ table: 'Time Intelligence', column: 'Time Calculation' }], measures: ['Revenue'], title: 'Customers × Time Intelligence' },
        { type: 'table', columns: [{ table: 'Contract', column: 'Contract Type' }], measures: ['Revenue', 'Avg Realized Price (USD/kg)', 'Price vs Index %'], title: 'Contract Types' }
      ]
    }
  ],
  analyses: [
    { title: 'Predictive maintenance', question: 'How many days of rising vibration and bearing temperature precede a breakdown?', how: 'Line chart of Avg Vibration (mm/s) and Wear % (Latest) by date for one rig with Breakdowns as markers; compare the 14 days before each Is Failure day with normal days.' },
    { title: 'Old Rattler', question: 'Which rig defers maintenance, and what did it cost in breakdowns, downtime and incidents?', how: 'Planned Maintenance %, MTBF (h), Maintenance Cost and Incidents by Vessel; drill into RIG-01.' },
    { title: 'The Lumenite seam', question: 'When did the jackpot claim come online and how much did it change the product mix and revenue?', how: 'Estimated Ore Value and Head Grade % for Mineral = Lumenite by month and claim; Revenue by Mineral before/after.' },
    { title: 'Grade depletion', question: 'Are older claims mining poorer ore? Should rigs be reassigned?', how: 'Head Grade % by claim over time (filter one mineral); the Vessel SCD2 history shows each reassignment.' },
    { title: 'Iridium spike & ice crash', question: 'Who won and who lost from the price shocks — fixed, index-linked or spot?', how: 'Price vs Index % and Avg Realized Price by Contract Type over Date; silver_commodity_prices for the curve.' },
    { title: 'Loaded vs delivered revenue', question: 'How different does the revenue trend look by loading date vs delivery date, and how long are hauls in transit?', how: 'Revenue vs Revenue by Delivery Date (USERELATIONSHIP); average Transit Days by destination (inactive role-playing station).' },
    { title: 'Slow payer', question: 'Which customer is paying later and later, and how much cash is tied up?', how: 'Avg Days to Pay by customer by quarter; Receivables Outstanding.' },
    { title: 'Shift & autonomy', question: 'Do autonomous Gamma shifts cut as much ore as crewed ones — and are they safer?', how: 'Ore per Drill Hour and Incidents by Run Profile[Shift] × [Operating Mode].' },
    { title: 'Decompression cluster', question: 'Find the two-month safety cluster. Where was it and what category dominated?', how: 'Incidents by month × Station/Claim sector and Incident Type[Category]; LTIFR trend.' },
    { title: 'Drill-head upgrade ROI', question: 'Did Mk III Augerheads raise productivity and slow wear?', how: 'Ore per Drill Hour (t) and MTBF (h) by Vessel[Drill Head] (SCD2 version in effect).' },
    { title: 'Refinery recovery', question: 'Which refinery recovers the least of what it is fed?', how: 'silver_refinery_output: SUM(recovered_kg) / SUM(feed_contained_kg) by refinery and mineral.' },
    { title: 'Crew exposure', question: 'Which crew members served on the vessels with the most incidents?', how: 'Crew Who Served and Incidents through the Crew Roster bridge (bidirectional many-to-many).' },
    { title: 'Energy intensity', question: 'Does energy per tonne rise with wear and hardness?', how: 'Scatter of Energy per Tonne vs Wear % by rig-month; split by Claim[Spectral Class].' }
  ],
  notes: `
## Units & time

All timestamps are **Coordinated Belt Time** (stored as UTC). Masses are in tonnes for ore and kilograms for refined
product; money is in US dollars. Grades are fractions of ore mass (0.14 = 14 %, 0.00002 = 20 ppm).

## Volume note

The fleet size scales with \`--scale\`: \`small\` is one operating division (about 22 rigs and 8 freighters), \`large\`
the whole consortium. Per-vessel physics are identical, so rates (availability, MTBF, LTIFR, grades) do not depend on scale.
`,
  generate: generateGravelstar,
  invariants(t) {
    const errors: string[] = []
    // assays: the primary grade on the run equals the silver assay for the primary mineral
    const runs = t.get('gold_fact_extraction_run')
    errors.push(...checkRows('contained = ore × grade', runs, (r) => near(r.contained_primary_kg as number, (r.ore_tonnes as number) * 1000 * (r.primary_grade as number), 0.01)))
    // refinery: recovered ≤ contained; feed ore = Σ run ore per refinery-day
    errors.push(...checkRows('recovered ≤ contained', t.get('silver_refinery_output'), (r) => (r.recovered_kg as number) <= (r.feed_contained_kg as number) + 1e-6))
    const claimRef = new Map<string, string>()
    for (const c of rowsOf(t.get('silver_claims'))) claimRef.set(c.claim_code as string, c.refinery_code as string)
    const feedFromRuns = new Map<string, number>()
    for (const r of rowsOf(t.get('silver_extraction_runs'))) {
      const k = `${claimRef.get(r.claim_code as string)}|${(r.run_date as Date).getTime()}`
      feedFromRuns.set(k, (feedFromRuns.get(k) ?? 0) + (r.ore_tonnes as number))
    }
    errors.push(...compareSums('refinery feed = Σ run ore', groupSum(t.get('silver_refinery_batches'), ['refinery_code', 'batch_date'], 'feed_ore_tonnes'), feedFromRuns, 0.5))
    // contained per mineral in feed = Σ ore × assay grade
    const containedFromAssays = new Map<string, number>()
    const runOre = new Map<string, { ore: number; ref: string; date: number }>()
    for (const r of rowsOf(t.get('silver_extraction_runs'))) runOre.set(r.run_id as string, { ore: r.ore_tonnes as number, ref: claimRef.get(r.claim_code as string)!, date: (r.run_date as Date).getTime() })
    for (const a of rowsOf(t.get('silver_ore_assays'))) {
      const run = runOre.get(a.run_id as string)
      if (!run) continue
      const k = `${run.ref}|${run.date}|${a.mineral_code}`
      containedFromAssays.set(k, (containedFromAssays.get(k) ?? 0) + run.ore * 1000 * (a.grade as number))
    }
    errors.push(...compareSums('feed contained = Σ ore × grade', groupSum(t.get('silver_refinery_output'), ['refinery_code', 'batch_date', 'mineral_code'], 'feed_contained_kg'), containedFromAssays, 0.05))
    // cargo: delivered = loaded − loss; revenue = delivered × unit price; loads never exceed refinery output
    errors.push(...checkRows('delivered = loaded − loss', t.get('gold_fact_cargo_haul'), (r) => r.delivered_kg === null || near(r.delivered_kg as number, (r.loaded_kg as number) - (r.transit_loss_kg as number), 0.01)))
    errors.push(...checkRows('revenue = delivered × price', t.get('gold_fact_cargo_haul'), (r) => r.revenue_usd === null || near(r.revenue_usd as number, (r.delivered_kg as number) * (r.unit_price_usd_per_kg as number), 0.02)))
    errors.push(...checkRows('lifecycle', t.get('gold_fact_cargo_haul'), (r) => (r.status === 'Paid' ? r.paid_date_key !== null && r.delivered_date_key !== null : r.status === 'Delivered' ? r.delivered_date_key !== null && r.paid_date_key === null : r.delivered_date_key === null && r.revenue_usd === null)))
    const recovered = groupSum(t.get('silver_refinery_output'), ['refinery_code', 'mineral_code'], 'recovered_kg')
    const loaded = groupSum(t.get('silver_cargo_manifests'), ['origin_code', 'mineral_code'], 'loaded_kg')
    for (const [k, q] of loaded) if (q > (recovered.get(k) ?? 0) + 0.01) errors.push(`loaded ${k} ${q.toFixed(1)} > recovered ${(recovered.get(k) ?? 0).toFixed(1)}`)
    // equipment day: hours never exceed 24; failures have a breakdown work order
    errors.push(...checkRows('hours ≤ 24', t.get('gold_fact_equipment_day'), (r) => (r.operating_hours as number) + (r.downtime_hours as number) <= 24.0001))
    let failures = 0
    for (const r of rowsOf(t.get('gold_fact_equipment_day'))) if (r.is_failure) failures++
    let breakdownWos = 0
    for (const r of rowsOf(t.get('silver_work_orders'))) if (r.work_type === 'Breakdown') breakdownWos++
    if (failures !== breakdownWos) errors.push(`failures ${failures} ≠ breakdown work orders ${breakdownWos}`)
    // gold run ore = silver run ore
    errors.push(...compareSums('gold vs silver runs', groupSum(runs, ['run_id'], 'ore_tonnes'), groupSum(t.get('silver_extraction_runs'), ['run_id'], 'ore_tonnes'), 0.01))
    return errors
  }
}

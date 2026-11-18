/**
 * Moonwake Star Cruises — an interstellar cruise line and spaceport. Revenue management (dynamic
 * pricing, booking curves, occupancy, RevPAB), booking lifecycle, onboard spend, marketing funnel
 * and campaign attribution, crew rotations (SCD2).
 */
import { GENERIC_HOLIDAYS } from '../../calendar.ts'
import { checkRows, compareSums, groupCount, groupSum, near, rowsOf } from '../../check.ts'
import type { MeasureSpec, Universe } from '../../schema.ts'
import { generateMoonwake } from './generate.ts'
import { MOONWAKE_ISSUES, MOONWAKE_SOURCES, MOONWAKE_TABLES } from './tables.ts'

const B = "'Bookings'"
const SI = "'Sailing Inventory'"
const Q = "'Quotes'"
const DATE = "'Date'[Date]"
const CR = '₡#,0'

const latest = (col: string) =>
  `CALCULATE ( SUM ( ${SI}[${col}] ), LASTNONBLANK ( ${DATE}, CALCULATE ( COUNTROWS ( ${SI} ) ) ) )`

const measures: MeasureSpec[] = [
  // Bookings & revenue
  { name: 'Bookings', expr: `COUNTROWS ( ${B} )`, format: '#,0', folder: 'Bookings', description: 'Bookings made (by booking date).' },
  { name: 'Guests Booked', expr: `SUM ( ${B}[Passengers] )`, format: '#,0', folder: 'Bookings', description: 'Guests on those bookings.' },
  { name: 'Cancelled Bookings', expr: `CALCULATE ( [Bookings], ${B}[Is Cancelled] = TRUE () )`, format: '#,0', folder: 'Bookings', description: 'Bookings cancelled as of today.' },
  { name: 'Cancellation Rate %', expr: 'DIVIDE ( [Cancelled Bookings], [Bookings] )', format: '0.0%', folder: 'Bookings', description: 'Share of bookings cancelled.' },
  { name: 'No-Show Rate %', expr: `DIVIDE ( CALCULATE ( [Bookings], ${B}[Is No Show] = TRUE () ), CALCULATE ( [Bookings], ${B}[Status] IN { "Sailed", "No-Show" } ) )`, format: '0.0%', folder: 'Bookings', description: 'Guests who never boarded, among departed bookings.' },
  { name: 'Repeat Guest %', expr: `DIVIDE ( CALCULATE ( [Bookings], ${B}[Is Repeat Guest] = TRUE () ), [Bookings] )`, format: '0.0%', folder: 'Bookings', description: 'Bookings from households that had booked before.' },
  { name: 'Avg Lead Time (days)', expr: `AVERAGE ( ${B}[Lead Time Days] )`, format: '0', folder: 'Bookings', description: 'Average days between booking and departure.' },
  { name: 'Gross Booking Value', expr: `SUM ( ${B}[Total Amount] )`, format: CR, folder: 'Revenue', description: 'Total value booked incl. fees, levy and insurance (before cancellations).' },
  { name: 'Net Fare Revenue', expr: `CALCULATE ( SUM ( ${B}[Net Fare] ), ${B}[Is Cancelled] = FALSE () )`, format: CR, folder: 'Revenue', description: 'Cruise fare after discounts on bookings that stand.' },
  { name: 'Cancellation Fees', expr: `SUM ( ${B}[Cancellation Fee] )`, format: CR, folder: 'Revenue', description: 'Fees retained on cancelled bookings.' },
  { name: 'Net Revenue', expr: '[Net Fare Revenue] + [Cancellation Fees]', format: CR, folder: 'Revenue', description: 'Fare revenue plus retained cancellation fees.' },
  {
    name: 'Avg Fare per Berth Night',
    expr: `DIVIDE ( [Net Fare Revenue], CALCULATE ( SUM ( ${B}[Berth Nights] ), ${B}[Is Cancelled] = FALSE () ) )`,
    format: '₡#,0.00',
    folder: 'Revenue',
    description: 'Average net fare per guest per night (the cruise ADR).'
  },
  {
    name: 'Net Revenue (Smart Units)',
    expr: '[Net Revenue]',
    formatExpr: 'SWITCH ( TRUE (), ABS ( [Net Revenue] ) >= 1000000, "₡#,0.0,,""M""", ABS ( [Net Revenue] ) >= 1000, "₡#,0.0,""K""", "₡#,0" )',
    folder: 'Revenue',
    description: 'Net revenue with a dynamic format string (₡1.2M / ₡45.3K).'
  },
  // Time intelligence
  { name: 'Net Revenue YTD', expr: `TOTALYTD ( [Net Revenue], ${DATE} )`, format: CR, folder: 'Time Intelligence', description: 'Calendar year to date (by booking date).' },
  { name: 'Net Revenue FYTD', expr: `TOTALYTD ( [Net Revenue], ${DATE}, "3/31" )`, format: CR, folder: 'Time Intelligence', description: 'Fiscal year to date (Moonwake\'s fiscal year starts 1 April).' },
  { name: 'Net Revenue PY', expr: `CALCULATE ( [Net Revenue], SAMEPERIODLASTYEAR ( ${DATE} ) )`, format: CR, folder: 'Time Intelligence', description: 'Same period last year.' },
  { name: 'Net Revenue YoY %', expr: 'DIVIDE ( [Net Revenue] - [Net Revenue PY], [Net Revenue PY] )', format: '0.0%;-0.0%;0.0%', folder: 'Time Intelligence', description: 'Growth versus last year.' },
  { name: 'Bookings 30D Avg', expr: `AVERAGEX ( DATESINPERIOD ( ${DATE}, MAX ( ${DATE} ), -30, DAY ), [Bookings] )`, format: '#,0.0', folder: 'Time Intelligence', description: 'Rolling 30-day average of daily bookings.' },
  { name: 'Net Revenue by Sail Date', expr: `CALCULATE ( [Net Revenue], USERELATIONSHIP ( ${B}[Sail Date Key], 'Date'[Date Key] ) )`, format: CR, folder: 'Time Intelligence', description: 'Revenue dated by departure instead of booking (role-playing date).' },
  { name: 'Cancellations by Cancel Date', expr: `CALCULATE ( [Cancelled Bookings], USERELATIONSHIP ( ${B}[Cancel Date Key], 'Date'[Date Key] ) )`, format: '#,0', folder: 'Time Intelligence', description: 'Cancellations dated when they happened — spot the solar-storm wave.' },
  // Inventory / revenue management
  { name: 'Berths Sold (Latest)', expr: latest('Berths Sold'), format: '#,0', folder: 'Revenue Management', description: 'Semi-additive: berths sold on the last snapshot date in context.' },
  { name: 'Berth Capacity (Latest)', expr: latest('Berth Capacity'), format: '#,0', folder: 'Revenue Management', description: 'Semi-additive: capacity on the last snapshot date in context.' },
  { name: 'Occupancy % (Latest)', expr: 'DIVIDE ( [Berths Sold (Latest)], [Berth Capacity (Latest)] )', format: '0.0%', folder: 'Revenue Management', description: 'Load factor on the latest snapshot.' },
  { name: 'Final Occupancy %', expr: `CALCULATE ( DIVIDE ( SUM ( ${SI}[Berths Sold] ), SUM ( ${SI}[Berth Capacity] ) ), ${SI}[Days To Departure] = 0 )`, format: '0.0%', folder: 'Revenue Management', description: 'Load factor on departure day.' },
  { name: 'RevPAB at Departure', expr: `CALCULATE ( DIVIDE ( SUM ( ${SI}[Revenue On Books] ), SUM ( ${SI}[Berth Capacity] ) ), ${SI}[Days To Departure] = 0 )`, format: '₡#,0.00', folder: 'Revenue Management', description: 'Revenue per available berth on departure day.' },
  { name: 'Avg Occupancy %', expr: `AVERAGE ( ${SI}[Occupancy %] )`, format: '0.0%', folder: 'Revenue Management', description: 'Average load factor — plot against Days To Departure for the booking curve.' },
  { name: 'Lowest Fare on Sale', expr: `AVERAGE ( ${SI}[Lowest Fare Per Berth Night] )`, format: '₡#,0', folder: 'Revenue Management', description: 'Average cheapest published fare (dynamic pricing).' },
  // Onboard
  { name: 'Onboard Spend', expr: `SUM ( 'Onboard Charges'[Amount] )`, format: CR, folder: 'Onboard', description: 'Folio charges.' },
  { name: 'Guests Sailed', expr: `CALCULATE ( SUM ( ${B}[Passengers] ), ${B}[Status] = "Sailed" )`, format: '#,0', folder: 'Onboard', description: 'Guests who actually sailed.' },
  { name: 'Onboard Spend per Guest', expr: 'DIVIDE ( [Onboard Spend], [Guests Sailed] )', format: '₡#,0.00', folder: 'Onboard', description: 'Onboard spend per sailed guest.' },
  // Funnel
  { name: 'Quotes', expr: `COUNTROWS ( ${Q} )`, format: '#,0', folder: 'Funnel', description: 'Quote requests (factless event fact).' },
  { name: 'Converted Quotes', expr: `CALCULATE ( [Quotes], ${Q}[Is Converted] = TRUE () )`, format: '#,0', folder: 'Funnel', description: 'Quotes that became bookings.' },
  { name: 'Quote Conversion %', expr: 'DIVIDE ( [Converted Quotes], [Quotes] )', format: '0.0%', folder: 'Funnel', description: 'Quote → booking conversion.' },
  { name: 'Campaign Budget', expr: `SUM ( 'Campaign'[Budget] )`, format: CR, folder: 'Funnel', description: 'Media budget of the campaigns in context.' },
  {
    name: 'Cost per Booking',
    expr: `DIVIDE ( [Campaign Budget], CALCULATE ( [Bookings], 'Campaign'[Channel] <> "Organic", 'Campaign'[Channel] <> "Unknown" ) )`,
    format: '₡#,0',
    folder: 'Funnel',
    description: 'Media budget per campaign-attributed booking.'
  },
  // Rankings
  { name: 'Itinerary Rank', expr: `IF ( HASONEVALUE ( 'Sailing'[Itinerary Name] ), RANKX ( ALL ( 'Sailing'[Itinerary Name] ), [Net Revenue] ) )`, format: '0', folder: 'Rankings', description: 'Rank of the itinerary by net revenue.' },
  { name: 'Top Campaign', expr: `FIRSTNONBLANK ( TOPN ( 1, VALUES ( 'Campaign'[Campaign Name] ), [Converted Quotes] ), 1 )`, folder: 'Rankings', description: 'Campaign with the most converted quotes in context.' },
  { name: 'Ports Visited', expr: `DISTINCTCOUNT ( 'Sailing Port'[Port Key] )`, format: '#,0', folder: 'Rankings', description: 'Distinct ports of call (through the Sailing ↔ Port bridge).' }
]

export const moonwake: Universe = {
  id: 'moonwake',
  company: 'Moonwake Star Cruises',
  name: 'Moonwake',
  tagline: 'Boutique starliners from Vashti Moon to the Far Reach — where every berth has a price that changes by the hour.',
  premise: `
Moonwake Star Cruises sails a small fleet of **boutique starliners** out of the Moonwake Spaceport on Vashti Moon.
Itineraries range from the four-night *Halcyon Weekender* to the eighteen-night *Twin Suns Grand Voyage*, calling at
ring habitats, asteroid docks and ice moons across three regions: the **Inner Ring**, the **Outer Belt** and the **Far Reach**.

Moonwake lives and dies by **revenue management**. Every berth on every sailing is priced dynamically: the base fare
for the cabin class and itinerary, a season curve, and a load-factor curve that pushes prices up as a sailing fills —
plus last-minute discounts when a sailing is lagging. Quotes come in from the web, the app, the call center and
travel agents; marketing campaigns (search, social, e-mail, holo-ads, affiliates) drive them and some convert far better than others.

What you will find in the data:

- **Booking curves.** Every sailing's final weeks are snapshotted daily: berths sold, revenue on the books, the lowest fare on sale.
- **The solar storm.** A coronal mass ejection hit the Outer Belt. Watch cancellations spike (by *cancel date*), two sailings
  cancelled outright, fees waived, and quotes for the region collapse for weeks.
- **A pricing mistake.** For three days the Zero-G Suite was loaded at Interior Pod prices. Conversion went through the roof.
- **A campaign that sang** (*Zero-G Honeymoon*) and one that burned money (*Holo-Billboard Blitz* — lots of sessions, few quotes).
- **Go-live.** Bookings taken in the legacy system before history starts were migrated; their early milestones are stamped
  with the go-live date (\`is_migrated\`) — a classic trap when you count bookings by day.
- **People and ships.** Crew rotate between ships, get promoted and leave (SCD2); spa, zero-g casino, excursions, dining
  and bars fill the folios.
`,
  shapes: ['Revenue management', 'Booking curves (snapshot)', 'Accumulating snapshot lifecycle', 'Marketing funnel & attribution', 'Factless events', 'Onboard spend'],
  fiscalYearStartMonth: 4,
  holidays: [...GENERIC_HOLIDAYS, { name: 'Founders\' Launch Day', month: 5, day: 21 }, { name: 'Eclipse Festival', month: 10, weekday: 6, nth: 2 }],
  sources: MOONWAKE_SOURCES,
  issues: MOONWAKE_ISSUES,
  tables: MOONWAKE_TABLES,
  measures,
  fieldParameter: {
    name: 'Booking Breakdown',
    fields: [
      { label: 'Region', ref: "'Sailing'[Region]" },
      { label: 'Itinerary', ref: "'Sailing'[Itinerary Name]" },
      { label: 'Ship', ref: "'Sailing'[Ship Name]" },
      { label: 'Cabin Class', ref: "'Cabin Class'[Class Name]" },
      { label: 'Fare Class', ref: "'Fare Class'[Fare Name]" },
      { label: 'Channel', ref: "'Campaign'[Channel]" },
      { label: 'Party Type', ref: "'Booking Profile'[Party Type]" },
      { label: 'Booking Window', ref: "'Booking Profile'[Booking Window]" },
      { label: 'Loyalty Tier', ref: "'Household'[Loyalty Tier]" }
    ]
  },
  report: [
    {
      name: 'Revenue Management',
      visuals: [
        { type: 'slicer', field: { table: 'Sailing', column: 'Region' }, title: 'Region' },
        { type: 'slicer', field: { table: 'Date', column: 'Year' }, title: 'Year', mode: 'Basic' },
        { type: 'card', measure: 'Net Revenue (Smart Units)', title: 'Net Revenue' },
        { type: 'card', measure: 'Bookings' },
        { type: 'card', measure: 'Final Occupancy %' },
        { type: 'card', measure: 'Cancellation Rate %' },
        { type: 'line', category: { table: 'Date', column: 'Month Start' }, measures: ['Net Revenue', 'Net Revenue PY'], title: 'Net Revenue vs Prior Year' },
        { type: 'line', category: { table: 'Sailing Inventory', column: 'Days To Departure' }, measures: ['Avg Occupancy %'], title: 'Booking Curve' },
        { type: 'matrix', rows: [{ table: 'Sailing', column: 'Itinerary Name' }], measures: ['Bookings', 'Net Revenue', 'Avg Fare per Berth Night', 'Itinerary Rank'], title: 'Itinerary Scorecard' },
        { type: 'column', category: { table: 'Cabin Class', column: 'Class Name' }, measures: ['Net Revenue'], title: 'Net Revenue by Cabin Class' }
      ]
    },
    {
      name: 'Marketing & Onboard',
      visuals: [
        { type: 'slicer', field: { table: 'Campaign', column: 'Channel' }, title: 'Channel' },
        { type: 'card', measure: 'Quotes' },
        { type: 'card', measure: 'Quote Conversion %' },
        { type: 'card', measure: 'Cost per Booking' },
        { type: 'card', measure: 'Onboard Spend per Guest' },
        { type: 'bar', category: { table: 'Campaign', column: 'Campaign Name' }, measures: ['Quote Conversion %'], title: 'Conversion by Campaign' },
        { type: 'line', category: { table: 'Date', column: 'Month Start' }, measures: ['Quotes', 'Converted Quotes'], title: 'Quotes over Time' },
        { type: 'matrix', rows: [{ table: 'Sailing', column: 'Region' }], columns: [{ table: 'Time Intelligence', column: 'Time Calculation' }], measures: ['Net Revenue'], title: 'Time Intelligence (calculation group)' },
        { type: 'column', category: { table: 'Spend Category', column: 'Category' }, measures: ['Onboard Spend'], title: 'Onboard Spend by Category' }
      ]
    }
  ],
  analyses: [
    { title: 'Booking curves', question: 'How fast do sailings fill in their last 50 days, and which itineraries lag?', how: 'Line of Avg Occupancy % by Sailing Inventory[Days To Departure], legend Region; compare Final Occupancy % by itinerary.' },
    { title: 'Dynamic pricing at work', question: 'Does the lowest fare on sale rise as occupancy climbs? Where did last-minute discounts kick in?', how: 'Scatter of Lowest Fare on Sale vs Avg Occupancy % per sailing-day; filter Days To Departure ≤ 21.' },
    { title: 'The solar storm', question: 'When did the Outer Belt cancellation wave happen, how many sailings were lost and how much fee revenue was waived?', how: 'Cancellations by Cancel Date by week with Cancellation Reason; Sailing[Is Storm Affected]; Bookings[Cancellation Fee] = 0 for storm reasons.' },
    { title: 'The pricing mistake', question: 'Find the three days the Zero-G Suite sold at Interior Pod prices. What did it cost?', how: 'Avg Fare per Berth Night by Date (booking date) for Cabin Class = Zero-G Suite; compare bookings and revenue to a normal week.' },
    { title: 'Campaign effectiveness', question: 'Which campaign converts best, which burns budget, and what is the cost per booking?', how: 'Quote Conversion % and Cost per Booking by Campaign; sessions vs quote starts in silver_web_sessions_daily.' },
    { title: 'Lead time & fare class mix', question: 'Do Early Orbit fares really book earlier, and do Flex fares cancel more?', how: 'Avg Lead Time and Cancellation Rate % by Fare Class; Booking Profile[Booking Window] distribution.' },
    { title: 'Go-live trap', question: 'Why is there a huge spike of bookings on the first day of history?', how: 'Bookings by Date with Bookings[Is Migrated]; compare with Original Booking Date.' },
    { title: 'Revenue by booking vs sail date', question: 'How different does revenue look when dated by departure instead of booking?', how: 'Net Revenue vs Net Revenue by Sail Date by month (USERELATIONSHIP).' },
    { title: 'Onboard yield', question: 'Which itineraries and cabin classes spend most onboard per guest, and where does the money go?', how: 'Onboard Spend per Guest by itinerary / cabin class; decomposition tree by Spend Category and venue.' },
    { title: 'Port popularity', question: 'Which ports appear on the best-selling sailings?', how: 'Net Revenue by Port[Port Name] through the bidirectional Sailing Port bridge; Ports Visited.' },
    { title: 'Loyalty & repeat guests', question: 'Do Cosmos-tier households book earlier and pay more?', how: 'Repeat Guest %, Avg Lead Time and Avg Fare per Berth Night by Household[Loyalty Tier].' },
    { title: 'Crew rotations (SCD2)', question: 'Which crew served on which ship when, and do certain bartenders run bigger tabs?', how: 'Onboard Spend by Crew[Full Name] with Crew[Ship Name] as of the charge date (crew_sk points at the version in effect).' }
  ],
  notes: `
## Volume note

\`small\` is a realistic boutique line: three starliners (150–260 berths) and every quote, booking and folio charge.
\`tiny\` uses one pocket ship for tests; \`large\` runs eighteen bigger ships. The booking simulation warms up 420 days
before history starts so the first sailings have complete booking curves.

## Currency

All amounts are in Star Credits (STC, shown as ₡).
`,
  generate: generateMoonwake,
  invariants(t) {
    const errors: string[] = []
    // capacity
    errors.push(...checkRows('berths sold ≤ capacity', t.get('gold_fact_sailing_inventory'), (r) => (r.berths_sold as number) <= (r.berth_capacity as number) && (r.berths_sold as number) >= 0))
    // departure-day snapshot = guests on bookings that were not cancelled
    const dep = new Map<string, number>()
    for (const r of rowsOf(t.get('gold_fact_sailing_inventory'))) if (r.days_to_departure === 0) dep.set(String(r.sailing_key), r.berths_sold as number)
    const booked = new Map<string, number>()
    for (const r of rowsOf(t.get('gold_fact_booking'))) {
      if (!dep.has(String(r.sailing_key)) || r.is_cancelled) continue
      booked.set(String(r.sailing_key), (booked.get(String(r.sailing_key)) ?? 0) + (r.passengers as number))
    }
    for (const k of dep.keys()) if (!booked.has(k)) booked.set(k, 0)
    errors.push(...compareSums('departure snapshot = Σ active passengers', dep, booked, 0))
    // booking arithmetic & fare lines
    errors.push(...checkRows('booking arithmetic', t.get('gold_fact_booking'), (r) =>
      near(r.net_fare as number, (r.gross_fare as number) - (r.discount_amount as number)) &&
      near(r.total_amount as number, (r.net_fare as number) + (r.port_fees as number) + (r.transit_levy as number) + (r.insurance_amount as number), 0.03)))
    errors.push(...compareSums('Σ fare lines = booking total', groupSum(t.get('silver_booking_fare_lines'), ['booking_id'], 'amount'), groupSum(t.get('gold_fact_booking'), ['booking_id'], 'total_amount'), 0.03))
    // payments: never exceed the total; departed bookings are fully paid
    const paid = groupSum(t.get('silver_payments'), ['booking_id'], 'amount')
    errors.push(...checkRows('payments ≤ total', t.get('gold_fact_booking'), (r) => (paid.get(String(r.booking_id)) ?? 0) <= (r.total_amount as number) + 0.03))
    errors.push(...checkRows('departed bookings fully paid', t.get('gold_fact_booking'), (r) => !(r.status === 'Sailed' || r.status === 'No-Show') || near(paid.get(String(r.booking_id)) ?? 0, r.total_amount as number, 0.03)))
    // lifecycle
    errors.push(...checkRows('lifecycle keys', t.get('gold_fact_booking'), (r) => (r.status === 'Cancelled') === (r.cancel_date_key !== null) && (r.status !== 'Fully Paid' || r.final_payment_date_key !== null)))
    // funnel: sessions ≥ quote starts ≥ web quotes; converted quotes = non-migrated bookings
    errors.push(...checkRows('sessions ≥ quote starts', t.get('silver_web_sessions_daily'), (r) => (r.sessions as number) >= (r.quote_starts as number)))
    let quoteStarts = 0
    for (const r of rowsOf(t.get('silver_web_sessions_daily'))) quoteStarts += r.quote_starts as number
    let webQuotes = 0
    for (const r of rowsOf(t.get('silver_quotes'))) if (['Web Desktop', 'Web Mobile', 'Moonwake App'].includes(r.device as string)) webQuotes++
    if (quoteStarts < webQuotes) errors.push(`quote starts ${quoteStarts} < web quotes ${webQuotes}`)
    let converted = 0
    for (const r of rowsOf(t.get('gold_fact_quote'))) if (r.is_converted) converted++
    let live = 0
    for (const r of rowsOf(t.get('gold_fact_booking'))) if (!r.is_migrated) live++
    if (converted !== live) errors.push(`converted quotes ${converted} ≠ non-migrated bookings ${live}`)
    // onboard charges only on sailings that left
    const status = new Map<string, string>()
    for (const r of rowsOf(t.get('gold_dim_sailing'))) status.set(String(r.sailing_key), r.sailing_status as string)
    errors.push(...checkRows('charges on departed sailings', t.get('gold_fact_onboard_charge'), (r) => ['Completed', 'In Space'].includes(status.get(String(r.sailing_key)) ?? '')))
    // one booking row per booking in silver and gold
    const g = groupCount(t.get('gold_fact_booking'), [])
    const s = groupCount(t.get('silver_bookings'), [])
    errors.push(...compareSums('silver bookings = gold bookings', g, s, 0))
    return errors
  }
}

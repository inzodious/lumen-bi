/**
 * Pixel Pagoda Arcades — a retro arcade + esports chain. High-volume cabinet telemetry, cabinet
 * uptime & maintenance, a game-card wallet (top-ups, prizes, memberships), tournaments and
 * marketing promo nights.
 */
import { GENERIC_HOLIDAYS } from '../../calendar.ts'
import { checkRows, compareSums, groupCount, groupSum, near, rowsOf } from '../../check.ts'
import type { MeasureSpec, Universe } from '../../schema.ts'
import { generatePixelPagoda } from './generate.ts'
import { PIXELPAGODA_ISSUES, PIXELPAGODA_SOURCES, PIXELPAGODA_TABLES } from './tables.ts'

const P = "'Plays'"
const MD = "'Machine Day'"
const MT = "'Maintenance'"
const W = "'Wallet'"
const TE = "'Tournament Entries'"
const DATE = "'Date'[Date]"

const measures: MeasureSpec[] = [
  // Plays
  { name: 'Plays', expr: `COUNTROWS ( ${P} )`, format: '#,0', folder: 'Plays', description: 'Credit sessions played.' },
  { name: 'Play Revenue', expr: `SUM ( ${P}[Revenue] )`, format: '$#,0', folder: 'Plays', description: 'Credits spent × credit price.' },
  { name: 'Credits Played', expr: `SUM ( ${P}[Credits] )`, format: '#,0', folder: 'Plays', description: 'Credits spent on cabinets.' },
  { name: 'Avg Credits per Play', expr: 'DIVIDE ( [Credits Played], [Plays] )', format: '0.00', folder: 'Plays', description: 'Credits per session (continues push it up).' },
  { name: 'Avg Session Minutes', expr: `DIVIDE ( SUM ( ${P}[Duration Sec] ), [Plays] ) / 60`, format: '0.0', folder: 'Plays', description: 'Average session length in minutes.' },
  { name: 'Tickets Won', expr: `SUM ( ${P}[Tickets Won] )`, format: '#,0', folder: 'Plays', description: 'Redemption tickets dispensed.' },
  { name: 'Top Scores', expr: `CALCULATE ( [Plays], ${P}[Is Top Score] = TRUE () )`, format: '#,0', folder: 'Plays', description: 'Plays that set a new venue high score.' },
  { name: 'Member Play Share %', expr: `DIVIDE ( CALCULATE ( [Plays], 'Member'[Is Guest] = FALSE () ), [Plays] )`, format: '0.0%', folder: 'Plays', description: 'Share of plays on member cards.' },
  { name: 'Campaign Play Share %', expr: `DIVIDE ( CALCULATE ( [Plays], 'Campaign'[Campaign Type] <> "None" ), [Plays] )`, format: '0.0%', folder: 'Marketing', description: 'Share of plays made while a campaign was running.' },
  {
    name: 'Play Revenue (Smart Units)',
    expr: '[Play Revenue]',
    formatExpr: 'SWITCH ( TRUE (), ABS ( [Play Revenue] ) >= 1000000, "$#,0.0,,""M""", ABS ( [Play Revenue] ) >= 1000, "$#,0.0,""K""", "$#,0" )',
    folder: 'Plays',
    description: 'Play revenue with a dynamic format string ($1.2M / $45.3K / $950).'
  },
  // Time intelligence
  { name: 'Play Revenue YTD', expr: `TOTALYTD ( [Play Revenue], ${DATE} )`, format: '$#,0', folder: 'Time Intelligence', description: 'Year-to-date play revenue.' },
  { name: 'Play Revenue PY', expr: `CALCULATE ( [Play Revenue], SAMEPERIODLASTYEAR ( ${DATE} ) )`, format: '$#,0', folder: 'Time Intelligence', description: 'Same period last year.' },
  { name: 'Play Revenue YoY %', expr: 'DIVIDE ( [Play Revenue] - [Play Revenue PY], [Play Revenue PY] )', format: '0.0%;-0.0%;0.0%', folder: 'Time Intelligence', description: 'Growth vs the same period last year.' },
  { name: 'Plays 28D Avg', expr: `AVERAGEX ( DATESINPERIOD ( ${DATE}, MAX ( ${DATE} ), -28, DAY ), [Plays] )`, format: '#,0.0', folder: 'Time Intelligence', description: 'Rolling 28-day average of daily plays.' },
  // Cabinet operations
  { name: 'Machine Days', expr: `COUNTROWS ( ${MD} )`, format: '#,0', folder: 'Operations', description: 'Cabinet-days on the floor while the venue traded.' },
  { name: 'Revenue per Machine-Day', expr: `DIVIDE ( SUM ( ${MD}[Revenue] ), [Machine Days] )`, format: '$#,0.00', folder: 'Operations', description: 'Average daily take per cabinet.' },
  { name: 'Uptime %', expr: `DIVIDE ( SUM ( ${MD}[Uptime Hours] ), SUM ( ${MD}[Open Hours] ) )`, format: '0.0%', folder: 'Operations', description: 'Playable hours ÷ trading hours.' },
  { name: 'Downtime Hours', expr: `SUM ( ${MD}[Downtime Hours] )`, format: '#,0.0', folder: 'Operations', description: 'Trading hours lost to breakdowns.' },
  { name: 'Error Events', expr: `SUM ( ${MD}[Error Events] )`, format: '#,0', folder: 'Operations', description: 'Telemetry errors — they climb before breakdowns.' },
  {
    name: 'Cabinets on Floor',
    expr: `CALCULATE ( DISTINCTCOUNT ( ${MD}[Machine SK] ), LASTNONBLANK ( ${DATE}, CALCULATE ( COUNTROWS ( ${MD} ) ) ) )`,
    format: '#,0',
    folder: 'Operations',
    description: 'Cabinets installed on the last trading day in context (semi-additive).'
  },
  // Maintenance
  { name: 'Tickets', expr: `COUNTROWS ( ${MT} )`, format: '#,0', folder: 'Maintenance', description: 'Maintenance tickets opened.' },
  { name: 'Breakdowns', expr: `CALCULATE ( [Tickets], ${MT}[Ticket Type] = "Breakdown" )`, format: '#,0', folder: 'Maintenance', description: 'Breakdown tickets (excludes preventive visits).' },
  { name: 'MTBF Hours', expr: `DIVIDE ( SUM ( ${MD}[Uptime Hours] ), [Breakdowns] )`, format: '#,0', folder: 'Maintenance', description: 'Mean trading hours between breakdowns.' },
  {
    name: 'MTTR Hours',
    expr: `CALCULATE ( AVERAGEX ( ${MT}, ${MT}[Response Hours] + ${MT}[Repair Hours] ), ${MT}[Ticket Type] = "Breakdown", ${MT}[Status] = "Resolved" )`,
    format: '0.0',
    folder: 'Maintenance',
    description: 'Mean hours from breakdown to fix (incl. waiting for parts).'
  },
  { name: 'Maintenance Cost', expr: `SUM ( ${MT}[Parts Cost] ) + SUM ( ${MT}[Labor Cost] )`, format: '$#,0', folder: 'Maintenance', description: 'Parts + technician labor.' },
  {
    name: 'Tickets Resolved',
    expr: `CALCULATE ( [Tickets], USERELATIONSHIP ( ${MT}[Resolved Date Key], 'Date'[Date Key] ), ${MT}[Status] = "Resolved" )`,
    format: '#,0',
    folder: 'Maintenance',
    description: 'Tickets dated by resolution (role-playing date via USERELATIONSHIP).'
  },
  { name: 'Open Tickets', expr: `CALCULATE ( [Tickets], ${MT}[Status] = "Open" )`, format: '#,0', folder: 'Maintenance', description: 'Tickets not yet resolved.' },
  // Wallet
  { name: 'Cash Revenue', expr: `SUM ( ${W}[Amount USD] )`, format: '$#,0', folder: 'Wallet', description: 'All cash taken: top-ups, memberships, tournament fees.' },
  { name: 'Top-Up Sales', expr: `CALCULATE ( [Cash Revenue], ${W}[Txn Type] = "Top-Up" )`, format: '$#,0', folder: 'Wallet', description: 'Credit top-ups sold.' },
  { name: 'Membership Revenue', expr: `CALCULATE ( [Cash Revenue], ${W}[Txn Type] = "Membership Fee" )`, format: '$#,0', folder: 'Wallet', description: 'Monthly membership fees (MRR when sliced by month).' },
  { name: 'Tournament Fees', expr: `CALCULATE ( [Cash Revenue], ${W}[Txn Type] = "Tournament Entry" )`, format: '$#,0', folder: 'Wallet', description: 'Tournament entry fees.' },
  { name: 'Tickets Redeemed', expr: `SUM ( ${W}[Tickets Redeemed] )`, format: '#,0', folder: 'Wallet', description: 'Tickets exchanged for prizes.' },
  { name: 'Prize Cost', expr: `SUM ( ${W}[Prize Cost] )`, format: '$#,0', folder: 'Wallet', description: 'Cost of prizes handed out.' },
  { name: 'Ticket Payout %', expr: 'DIVIDE ( [Prize Cost], [Top-Up Sales] )', format: '0.0%', folder: 'Wallet', description: 'Prize cost as a share of top-up sales.' },
  { name: 'Paying Members', expr: `CALCULATE ( DISTINCTCOUNT ( ${W}[Member Key] ), ${W}[Txn Type] = "Membership Fee" )`, format: '#,0', folder: 'Wallet', description: 'Members billed in context.' },
  // Tournaments
  { name: 'Tournament Entries', expr: `COUNTROWS ( ${TE} )`, format: '#,0', folder: 'Esports', description: 'Entries (factless participation fact).' },
  { name: 'Unique Competitors', expr: `CALCULATE ( DISTINCTCOUNT ( ${TE}[Member Key] ), 'Member'[Is Guest] = FALSE () )`, format: '#,0', folder: 'Esports', description: 'Distinct members who entered.' },
  { name: 'Avg Field Size', expr: `DIVIDE ( [Tournament Entries], DISTINCTCOUNT ( ${TE}[Tournament Key] ) )`, format: '0.0', folder: 'Esports', description: 'Entrants per tournament.' },
  // Rankings
  { name: 'Game Rank', expr: `IF ( HASONEVALUE ( 'Game'[Title] ), RANKX ( ALL ( 'Game'[Title] ), [Play Revenue] ) )`, format: '0', folder: 'Rankings', description: 'Rank of the game by play revenue.' },
  { name: 'Top Game', expr: `FIRSTNONBLANK ( TOPN ( 1, VALUES ( 'Game'[Title] ), [Play Revenue] ), 1 )`, folder: 'Rankings', description: 'Highest-earning title in context.' }
]

export const pixelpagoda: Universe = {
  id: 'pixelpagoda',
  company: 'Pixel Pagoda Arcades',
  name: 'PixelPagoda',
  tagline: 'Insert coin to continue — a neon-lit chain of retro arcades, bar-cades and esports nights where every joystick waggle is logged.',
  premise: `
Pixel Pagoda Arcades runs **grand pagodas, mall arcades, adults-only bar-cades and a pop-up** across three
regions. Every cabinet — *Galaxy Gobbler*, *Neon Nunchucks*, *Turbo Tortoise Rally*, the *Pagoda Pinball
Deluxe* and the dangerously loud *Lucky Lantern Coin Pusher* — phones home a JSON event for each play.

What is going on behind the glow:

- **Cabinets wear out.** Every play adds wear; telemetry errors climb before a breakdown, technicians respond,
  parts sometimes take days, and a preventive visit every few months resets the clock.
- **A firmware update went badly.** For about three months, every *Dragon Drift GT* cabinet ran firmware 2.3 —
  watchdog errors exploded and the racers kept crashing until 2.4 shipped.
- **A game went viral.** *Kaiju Kitchen* launched mid-history with an influencer party and briefly ate the
  floor; its share of plays then settled at a healthy (but lower) level.
- **People come in waves.** Friday and Saturday nights, the bar-cades after 9 pm, the December holidays and the
  9 September *Founders' Pixel Day*. Retro Night Thursdays revive the Golden Age titles.
- **Money flows through a game card.** Players top up credits (members get bonus credits), win tickets, trade
  them for plush tanukis and neon signs, pay monthly Pagoda Pass fees and enter tournaments. Credit prices went
  up once — find out when.
- **Machines move.** Cabinets are rotated between venues, retired and replaced; the machine dimension keeps every
  version (SCD2), so revenue follows the cabinet *and* the venue it was in at the time.
`,
  shapes: ['High-volume events / telemetry', 'Asset uptime & maintenance', 'Memberships', 'Factless participation', 'Marketing campaigns', 'Wallet / redemption'],
  fiscalYearStartMonth: 4,
  holidays: [...GENERIC_HOLIDAYS, { name: "Founders' Pixel Day", month: 9, day: 9 }],
  timeDim: true,
  sources: PIXELPAGODA_SOURCES,
  issues: PIXELPAGODA_ISSUES,
  tables: PIXELPAGODA_TABLES,
  measures,
  fieldParameter: {
    name: 'Play Breakdown',
    fields: [
      { label: 'Region', ref: "'Venue'[Region]" },
      { label: 'Venue', ref: "'Venue'[Venue Name]" },
      { label: 'Venue Type', ref: "'Venue'[Venue Type]" },
      { label: 'Genre', ref: "'Game'[Genre]" },
      { label: 'Game', ref: "'Game'[Title]" },
      { label: 'Manufacturer', ref: "'Game'[Manufacturer]" },
      { label: 'Era', ref: "'Game'[Era]" },
      { label: 'Day Part', ref: "'Time'[Day Part]" },
      { label: 'Member Tier', ref: "'Member'[Current Tier]" },
      { label: 'Campaign', ref: "'Campaign'[Campaign Name]" }
    ]
  },
  report: [
    {
      name: 'Arcade Floor',
      visuals: [
        { type: 'slicer', field: { table: 'Venue', column: 'Region' }, title: 'Region' },
        { type: 'slicer', field: { table: 'Date', column: 'Year' }, title: 'Year', mode: 'Basic' },
        { type: 'card', measure: 'Play Revenue (Smart Units)', title: 'Play Revenue' },
        { type: 'card', measure: 'Plays' },
        { type: 'card', measure: 'Revenue per Machine-Day' },
        { type: 'card', measure: 'Uptime %' },
        { type: 'line', category: { table: 'Date', column: 'Month Start' }, measures: ['Play Revenue', 'Play Revenue PY'], title: 'Play Revenue vs Prior Year' },
        { type: 'column', category: { table: 'Game', column: 'Genre' }, measures: ['Play Revenue'], title: 'Play Revenue by Genre' },
        { type: 'matrix', rows: [{ table: 'Venue', column: 'Venue Name' }], measures: ['Play Revenue', 'Play Revenue YoY %', 'Uptime %', 'Cabinets on Floor'], title: 'Venue Scorecard' },
        { type: 'bar', category: { table: 'Time', column: 'Hour Label' }, measures: ['Plays'], title: 'Plays by Hour' }
      ]
    },
    {
      name: 'Maintenance & Members',
      visuals: [
        { type: 'slicer', field: { table: 'Game', column: 'Genre Group' }, title: 'Genre Group' },
        { type: 'card', measure: 'MTBF Hours' },
        { type: 'card', measure: 'MTTR Hours' },
        { type: 'card', measure: 'Ticket Payout %' },
        { type: 'card', measure: 'Tournament Entries' },
        { type: 'line', category: { table: 'Date', column: 'Month Start' }, measures: ['Error Events', 'Breakdowns'], title: 'Errors and Breakdowns' },
        { type: 'column', category: { table: 'Fault', column: 'Fault Category' }, measures: ['Breakdowns'], title: 'Breakdowns by Fault Category' },
        { type: 'matrix', rows: [{ table: 'Venue', column: 'Region' }], columns: [{ table: 'Time Intelligence', column: 'Time Calculation' }], measures: ['Play Revenue'], title: 'Time Intelligence (calculation group)' },
        { type: 'column', category: { table: 'Tier', column: 'Tier Name' }, measures: ['Membership Revenue'], title: 'Membership Revenue by Tier' }
      ]
    }
  ],
  analyses: [
    { title: 'The firmware disaster', question: 'When did Dragon Drift GT start crashing, how much revenue did the 2.3 firmware cost, and when was it fixed?', how: 'Error Events and Breakdowns by week for Game = Dragon Drift GT; slice Machine[Firmware Version]; compare Revenue per Machine-Day before/during/after.' },
    { title: 'Degradation before failure', question: 'Do error events and wear rise in the days before a breakdown?', how: 'Machine Day[Error Events] and Wear Index for the 14 days before each Maintenance[Opened Date Key]; average by days-before-failure.' },
    { title: 'Viral launch curve', question: 'How big was the Kaiju Kitchen spike and where did its share settle?', how: 'Plays by week with Game in the legend; Campaign Play Share % for the launch campaign; percent-of-total over time.' },
    { title: 'Retro Night ROI', question: 'Do Retro Night Thursdays lift Golden Age titles enough to cover the campaign budget?', how: 'Play Revenue on Thursdays during vs outside Retro Night campaigns by Game[Era]; compare with Campaign[Budget USD].' },
    { title: 'Weekly and hourly rhythm', question: 'When are the floors busiest — and how different are bar-cades from mall arcades?', how: 'Plays by Time[Hour Label] × Date[Day Name] heatmap, split by Venue Type.' },
    { title: 'Holiday surge', question: 'How much do the last ten days of December and Founders\' Pixel Day add?', how: 'Play Revenue YoY % and Plays 28D Avg around Date[Holiday Name].' },
    { title: 'Price increase elasticity', question: 'Credit prices rose once. Did plays drop, and did revenue per play rise?', how: 'Avg Credits per Play, Plays and Play Revenue per Plays by month; find the step in revenue per credit.' },
    { title: 'Uptime league table', question: 'Which venues and genres lose the most trading hours, and what is MTBF/MTTR by fault?', how: 'Uptime %, MTBF Hours and MTTR Hours by Venue and Fault Category; Tickets Resolved by resolution date (USERELATIONSHIP).' },
    { title: 'Cabinet rotation (SCD2)', question: 'Did cabinets earn more after being moved to another venue?', how: 'Revenue per Machine-Day by Machine[Venue Name] for cabinets with several versions; Machine[Version] in a matrix.' },
    { title: 'Prize economics', question: 'What share of top-up sales goes back out as prizes, and which prizes eat the tickets?', how: 'Ticket Payout % by venue type; Tickets Redeemed by Prize hierarchy; retired prize codes (Prize = Unknown).' },
    { title: 'Membership health', question: 'How does MRR evolve, who upgrades to Legend, and how many members churn?', how: 'Membership Revenue by month and Tier; Paying Members; silver_membership_events for upgrade/downgrade/cancel flows.' },
    { title: 'Esports community', question: 'Which games draw the biggest tournament fields and who keeps winning?', how: 'Avg Field Size by Game through the Tournament Game bridge (bidirectional); Tournament Entries by Member with is_winner; walk-ins (Member = Guest).' },
    { title: 'High-score chasers', question: 'Are top scores getting rarer as venue records climb?', how: 'Top Scores by month and game; ratio to Plays.' }
  ],
  notes: `
## Volume note

\`small\` samples roughly 1 in 50 real plays so the lakehouse stays around 100k fact rows; top-ups and
redemptions follow the sampled plays. Cabinet-days, wear, telemetry errors, breakdowns and maintenance are
**not** sampled, so uptime %, MTBF and MTTR are realistic while play and wallet totals are miniature.
\`large\` (×30) is close to full volume.
`,
  generate: generatePixelPagoda,
  invariants(t) {
    const errors: string[] = []
    const md = t.get('gold_fact_machine_day')
    const plays = t.get('gold_fact_play')
    for (const [mdCol, playCol] of [['plays', ''], ['credits', 'credits'], ['revenue', 'revenue'], ['tickets_out', 'tickets_won']] as const) {
      const fromPlays = playCol ? groupSum(plays, ['machine_sk', 'date_key'], playCol) : groupCount(plays, ['machine_sk', 'date_key'])
      errors.push(...compareSums(`machine-day ${mdCol} = Σ plays`, groupSum(md, ['machine_sk', 'date_key'], mdCol), fromPlays, mdCol === 'revenue' ? 0.02 : 0))
    }
    errors.push(...checkRows('uptime + downtime = open hours', md, (r) => near((r.uptime_hours as number) + (r.downtime_hours as number), r.open_hours as number, 0.001)))
    // downtime in the snapshot equals downtime on the tickets (per cabinet)
    const skToId = new Map<number, string>()
    for (const r of rowsOf(t.get('gold_dim_machine'))) skToId.set(r.machine_sk as number, r.machine_id as string)
    const byMachine = (rows: Iterable<Record<string, unknown>>) => {
      const m = new Map<string, number>()
      for (const r of rows) {
        const id = skToId.get(r.machine_sk as number)!
        m.set(id, (m.get(id) ?? 0) + ((r.downtime_hours as number) ?? 0))
      }
      return m
    }
    errors.push(...compareSums('Σ machine-day downtime = Σ ticket downtime', byMachine(rowsOf(md)), byMachine(rowsOf(t.get('gold_fact_maintenance_ticket'))), 0.01))
    errors.push(...checkRows('ticket lifecycle', t.get('gold_fact_maintenance_ticket'), (r) =>
      r.status === 'Resolved' ? r.resolved_at !== null && (r.resolved_at as Date).getTime() >= (r.opened_at as Date).getTime() && r.resolved_date_key !== null : r.resolved_at === null && r.resolved_date_key === null))
    errors.push(...checkRows('preventive visits cause no downtime', t.get('gold_fact_maintenance_ticket'), (r) => r.ticket_type !== 'Preventive' || r.downtime_hours === 0))
    // tickets: members never redeem more than they won; guests redeem from the same venue-day pool
    const wallet = t.get('gold_fact_wallet_txn')
    const won = groupSum(plays, ['member_key'], 'tickets_won')
    for (const [k, red] of groupSum(wallet, ['member_key'], 'tickets_redeemed')) {
      if (k !== '-1' && red > (won.get(k) ?? 0)) errors.push(`member ${k} redeemed ${red} tickets but won ${won.get(k) ?? 0}`)
    }
    const guestWon = new Map<string, number>()
    for (const r of rowsOf(plays)) if (r.member_key === -1) guestWon.set(`${r.venue_key}|${r.date_key}`, (guestWon.get(`${r.venue_key}|${r.date_key}`) ?? 0) + (r.tickets_won as number))
    for (const r of rowsOf(wallet)) {
      if (r.member_key !== -1 || r.txn_type !== 'Prize Redemption') continue
      const k = `${r.venue_key}|${r.date_key}`
      guestWon.set(k, (guestWon.get(k) ?? 0) - (r.tickets_redeemed as number))
      if (guestWon.get(k)! < 0) {
        errors.push(`guest redemptions exceed guest tickets won at ${k}`)
        break
      }
    }
    errors.push(...checkRows('wallet amounts', wallet, (r) => (r.txn_type === 'Prize Redemption' ? r.amount_usd === 0 && (r.tickets_redeemed as number) > 0 : (r.amount_usd as number) > 0)))
    errors.push(...checkRows('credit price', plays, (r) => near((r.revenue as number) / (r.credits as number), 0.25, 0.0001) || near((r.revenue as number) / (r.credits as number), 0.3, 0.0001)))
    // tournaments: entrants on the dimension = participation rows; fee rows = entries of paid tournaments
    const entries = groupCount(t.get('gold_fact_tournament_entry'), ['tournament_key'])
    const dimEntrants = new Map<string, number>()
    const paidEntries = new Map<string, number>()
    for (const r of rowsOf(t.get('gold_dim_tournament'))) {
      if (r.tournament_key === -1) continue
      dimEntrants.set(String(r.tournament_key), r.entrants as number)
      if ((r.entry_fee as number) > 0) paidEntries.set(String(r.tournament_key), r.entrants as number)
    }
    errors.push(...compareSums('tournament entrants', dimEntrants, entries, 0))
    const feeRows = new Map<string, number>()
    for (const r of rowsOf(wallet)) if (r.txn_type === 'Tournament Entry') feeRows.set(String(r.tournament_key), (feeRows.get(String(r.tournament_key)) ?? 0) + 1)
    errors.push(...compareSums('tournament fee rows', paidEntries, feeRows, 0))
    return errors
  }
}

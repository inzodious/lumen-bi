/**
 * Griffin & Gecko Creature Care — a veterinary network for fantastical creatures. Healthcare
 * operations (appointments, treatments, diagnoses, no-shows, utilization), insurance & receivables,
 * HR (staff SCD2, payroll) and finance (GL journals, monthly balances, budget vs actual).
 */
import { GENERIC_HOLIDAYS } from '../../calendar.ts'
import { checkRows, compareSums, groupSum, near, rowsOf } from '../../check.ts'
import type { MeasureSpec, Universe } from '../../schema.ts'
import { generateGriffinGecko } from './generate.ts'
import { GG_ISSUES, GG_SOURCES, GG_TABLES } from './tables.ts'

const AP = "'Appointments'"
const TR = "'Treatments'"
const CD = "'Clinic Day'"
const GL = "'GL'"
const DATE = "'Date'[Date]"

const measures: MeasureSpec[] = [
  // Revenue
  { name: 'Revenue', expr: `SUM ( ${TR}[Net Amount] )`, format: '$#,0', folder: 'Revenue', description: 'Invoiced revenue after care-plan discounts.' },
  { name: 'Gross Charges', expr: `SUM ( ${TR}[Gross Amount] )`, format: '$#,0', folder: 'Revenue', description: 'Charges before discounts.' },
  { name: 'Care Plan Discounts', expr: `SUM ( ${TR}[Discount Amount] )`, format: '$#,0', folder: 'Revenue', description: 'Discounts given to Hatchling / Hoard plan members.' },
  { name: 'Treatment Cost', expr: `SUM ( ${TR}[Cost Amount] )`, format: '$#,0', folder: 'Revenue', description: 'Standard cost of medications and supplies.' },
  { name: 'Clinical Margin', expr: '[Revenue] - [Treatment Cost]', format: '$#,0', folder: 'Revenue', description: 'Revenue minus treatment cost.' },
  { name: 'Clinical Margin %', expr: 'DIVIDE ( [Clinical Margin], [Revenue] )', format: '0.0%', folder: 'Revenue', description: 'Clinical margin as a share of revenue.' },
  {
    name: 'Revenue (Smart Units)',
    expr: '[Revenue]',
    formatExpr: 'SWITCH ( TRUE (), ABS ( [Revenue] ) >= 1000000, "$#,0.0,,""M""", ABS ( [Revenue] ) >= 1000, "$#,0.0,""K""", "$#,0" )',
    folder: 'Revenue',
    description: 'Revenue with a dynamic format string ($1.2M / $45.3K / $950).'
  },
  { name: 'Clinic Revenue Rank', expr: `IF ( HASONEVALUE ( 'Clinic'[Clinic Name] ), RANKX ( ALL ( 'Clinic'[Clinic Name] ), [Revenue] ) )`, format: '0', folder: 'Revenue', description: 'Rank of the clinic by revenue.' },
  // Visits
  { name: 'Appointments', expr: `COUNTROWS ( ${AP} )`, format: '#,0', folder: 'Visits', description: 'Appointments scheduled (incl. no-shows and cancellations).' },
  { name: 'Visits', expr: `CALCULATE ( COUNTROWS ( ${AP} ), ${AP}[Is Seen] = TRUE () )`, format: '#,0', folder: 'Visits', description: 'Patients actually seen.' },
  { name: 'Average Invoice', expr: 'DIVIDE ( [Revenue], [Visits] )', format: '$#,0.00', folder: 'Visits', description: 'Revenue per visit.' },
  { name: 'No-Show %', expr: `DIVIDE ( CALCULATE ( COUNTROWS ( ${AP} ), ${AP}[Is No Show] = TRUE () ), [Appointments] )`, format: '0.0%', folder: 'Visits', description: 'Booked appointments where the creature never arrived.' },
  { name: 'Avg Wait (min)', expr: `AVERAGE ( ${AP}[Wait Minutes] )`, format: '0.0', folder: 'Visits', description: 'Average minutes from check-in to being seen.' },
  { name: 'Patients Seen', expr: `CALCULATE ( DISTINCTCOUNT ( ${AP}[Patient Key] ), ${AP}[Is Seen] = TRUE () )`, format: '#,0', folder: 'Visits', description: 'Distinct patients seen (strays count once).' },
  { name: 'Emergency Share %', expr: `DIVIDE ( CALCULATE ( [Visits], 'Appointment Type'[Is Emergency] = TRUE () ), [Visits] )`, format: '0.0%', folder: 'Visits', description: 'Share of visits that were emergencies.' },
  { name: 'Vet Utilization %', expr: `DIVIDE ( SUM ( ${CD}[Booked Minutes] ), SUM ( ${CD}[Available Minutes] ) )`, format: '0.0%', folder: 'Visits', description: 'Vet minutes with patients ÷ rostered vet minutes.' },
  { name: 'Diagnosed Appointments', expr: `CALCULATE ( DISTINCTCOUNT ( 'Appointment Diagnosis'[Appointment Key] ) )`, format: '#,0', folder: 'Visits', description: 'Appointments carrying the diagnosis(es) in context (many-to-many bridge).' },
  { name: 'Bookings Made', expr: `CALCULATE ( [Appointments], USERELATIONSHIP ( ${AP}[Booked Date Key], 'Date'[Date Key] ) )`, format: '#,0', folder: 'Visits', description: 'Appointments by the date they were booked (role-playing date via USERELATIONSHIP).' },
  { name: 'Visits 28D Avg', expr: `AVERAGEX ( DATESINPERIOD ( ${DATE}, MAX ( ${DATE} ), -28, DAY ), [Visits] )`, format: '#,0.0', folder: 'Visits', description: 'Rolling 28-day average of daily visits.' },
  // Receivables
  { name: 'Outstanding Balance', expr: `SUM ( ${AP}[Outstanding Amount] )`, format: '$#,0', folder: 'Receivables', description: 'Invoiced amounts not yet paid (as of today).' },
  { name: 'Avg Days to Pay', expr: `AVERAGE ( ${AP}[Days To Pay] )`, format: '0.0', folder: 'Receivables', description: 'Average days from invoice to fully paid.' },
  { name: 'Collected by Paid Date', expr: `CALCULATE ( SUM ( ${AP}[Invoice Amount] ), USERELATIONSHIP ( ${AP}[Paid Date Key], 'Date'[Date Key] ) )`, format: '$#,0', folder: 'Receivables', description: 'Fully-paid invoices dated by payment (inactive Paid Date relationship).' },
  // Time intelligence
  { name: 'Revenue YTD', expr: `TOTALYTD ( [Revenue], ${DATE} )`, format: '$#,0', folder: 'Time Intelligence', description: 'Calendar year-to-date revenue.' },
  { name: 'Revenue FYTD', expr: `TOTALYTD ( [Revenue], ${DATE}, "3/31" )`, format: '$#,0', folder: 'Time Intelligence', description: 'Fiscal year-to-date revenue (fiscal year starts 1 April).' },
  { name: 'Revenue PY', expr: `CALCULATE ( [Revenue], SAMEPERIODLASTYEAR ( ${DATE} ) )`, format: '$#,0', folder: 'Time Intelligence', description: 'Same period last year.' },
  { name: 'Revenue YoY %', expr: 'DIVIDE ( [Revenue] - [Revenue PY], [Revenue PY] )', format: '0.0%;-0.0%;0.0%', folder: 'Time Intelligence', description: 'Growth versus the same period last year.' },
  // Finance
  { name: 'Actual', expr: `SUM ( ${GL}[Actual Amount] )`, format: '$#,0', folder: 'Finance', description: 'P&L actuals in natural sign (use with an Account filter).' },
  { name: 'Budget', expr: `SUM ( ${GL}[Budget Amount] )`, format: '$#,0', folder: 'Finance', description: 'P&L budget in natural sign.' },
  { name: 'Variance', expr: '[Actual] - [Budget]', format: '$#,0;($#,0);$#,0', folder: 'Finance', description: 'Actual minus budget (natural sign — positive is good for revenue, bad for costs).' },
  { name: 'Variance %', expr: 'DIVIDE ( [Variance], [Budget] )', format: '0.0%;-0.0%;0.0%', folder: 'Finance', description: 'Variance relative to budget.' },
  {
    name: 'Operating Profit',
    expr: `SUMX ( VALUES ( 'Account'[Account Code] ), CALCULATE ( [Actual] * MAX ( 'Account'[P&L Sign] ) ) )`,
    format: '$#,0;($#,0);$#,0',
    folder: 'Finance',
    description: 'Revenue minus all costs from the GL actuals.'
  },
  {
    name: 'Operating Profit Budget',
    expr: `SUMX ( VALUES ( 'Account'[Account Code] ), CALCULATE ( [Budget] * MAX ( 'Account'[P&L Sign] ) ) )`,
    format: '$#,0;($#,0);$#,0',
    folder: 'Finance',
    description: 'Budgeted revenue minus budgeted costs.'
  },
  {
    name: 'Profit Variance',
    expr: '[Operating Profit] - [Operating Profit Budget]',
    format: '$#,0;($#,0);$#,0',
    folder: 'Finance',
    description: 'Profit impact of all variances (positive = favourable).'
  },
  { name: 'Operating Margin %', expr: `DIVIDE ( [Operating Profit], CALCULATE ( [Actual], 'Account'[Account Type] = "Revenue" ) )`, format: '0.0%', folder: 'Finance', description: 'Operating profit ÷ GL revenue.' },
  { name: 'Payroll % of Revenue', expr: `DIVIDE ( CALCULATE ( [Actual], 'Account'[Account Group] = "Payroll" ), CALCULATE ( [Actual], 'Account'[Account Type] = "Revenue" ) )`, format: '0.0%', folder: 'Finance', description: 'Payroll cost (wages + benefits) relative to revenue.' },
  {
    name: 'AR Balance',
    expr: `CALCULATE ( SUM ( ${GL}[Closing Balance] ), 'Account'[Account Code] = "1100", LASTNONBLANK ( ${DATE}, CALCULATE ( SUM ( ${GL}[Closing Balance] ) ) ) )`,
    format: '$#,0',
    folder: 'Finance',
    description: 'Accounts receivable at the last month-end in context (semi-additive balance).'
  },
  {
    name: 'Cash Balance',
    expr: `CALCULATE ( SUM ( ${GL}[Closing Balance] ), 'Account'[Account Code] = "1000", LASTNONBLANK ( ${DATE}, CALCULATE ( SUM ( ${GL}[Closing Balance] ) ) ) )`,
    format: '$#,0;($#,0);$#,0',
    folder: 'Finance',
    description: 'Cash movement since the start of the history at the last month-end in context (semi-additive).'
  },
  // People
  { name: 'Active Staff', expr: `CALCULATE ( DISTINCTCOUNT ( 'Staff'[Staff ID] ), 'Staff'[Is Current] = TRUE (), 'Staff'[Employment Status] = "Active" )`, format: '#,0', folder: 'People', description: 'Current active headcount (current SCD2 versions).' }
]

export const griffingecko: Universe = {
  id: 'griffingecko',
  company: 'Griffin & Gecko Creature Care',
  name: 'GriffinGecko',
  tagline: 'Veterinary care for creatures great, small and occasionally on fire — eight clinics, one very nervous accountant.',
  premise: `
Griffin & Gecko began as a two-vet practice that would see *anything*: a moon gecko with a cough, a griffin with a
sprained wing, a dragon who had swallowed (most of) a treasure chest. Today it is a network of **creature hospitals,
neighbourhood clinics, an Aerie with a landing deck for large flyers and an Aquatic Center with kraken tanks**, run
from a small head office whose finance team would like everyone to stop setting the exam rooms on fire.

The data tells the whole story of a healthcare business:

- **Appointments** are booked by phone, online or walk-in, then seen, invoiced and paid — or not: online bookings
  no-show more, and one clinic's reminder system clearly broke after online booking launched.
- **Every visit has diagnoses** (a many-to-many bridge) and billed lines whose prices scale with the creature's size —
  an Emberback dragon's dental is a *lot* more than a gecko's.
- **Seasons matter.** Every winter brings **Ember Flu** to phoenixes and dragons; one winter it became an outbreak
  in the Highlands. Spring is molting season; summer brings sprained wings.
- **Insurers pay late.** Four fictional creature insurers cover part of the bill — and *Talon & Claw Assurance* takes
  longer to pay every quarter.
- **People and money are linked.** Staff are hired, promoted, certified, transferred and leave (SCD2); payroll flows
  from that history into the **general ledger**, alongside rents, fireproofing, repairs and marketing. Every journal
  balances, and a **budget** planned from the prior fiscal year lets you hunt for variances — like the winter the
  flagship hospital's fireproofing bill blew through budget.
`,
  shapes: ['Healthcare operations', 'Finance (GL & budget vs actual)', 'HR / payroll (SCD2)', 'Receivables & insurance', 'Seasonal outbreaks'],
  fiscalYearStartMonth: 4,
  holidays: [...GENERIC_HOLIDAYS, { name: 'Hatching Day', month: 3, day: 21 }, { name: 'Night of Long Embers', month: 12, day: 21 }],
  sources: GG_SOURCES,
  issues: GG_ISSUES,
  tables: GG_TABLES,
  measures,
  fieldParameter: {
    name: 'Clinical Breakdown',
    fields: [
      { label: 'Clinic', ref: "'Clinic'[Clinic Name]" },
      { label: 'Region', ref: "'Clinic'[Region]" },
      { label: 'Creature Class', ref: "'Species'[Creature Class]" },
      { label: 'Species', ref: "'Species'[Species]" },
      { label: 'Visit Type', ref: "'Appointment Type'[Visit Type]" },
      { label: 'Booking Channel', ref: "'Appointment Type'[Booking Channel]" },
      { label: 'Payer', ref: "'Payer'[Payer Name]" },
      { label: 'Procedure Group', ref: "'Procedure'[Procedure Group]" }
    ]
  },
  report: [
    {
      name: 'Clinical Operations',
      visuals: [
        { type: 'slicer', field: { table: 'Clinic', column: 'Region' }, title: 'Region' },
        { type: 'slicer', field: { table: 'Date', column: 'Fiscal Year Label' }, title: 'Fiscal Year', mode: 'Basic' },
        { type: 'card', measure: 'Revenue (Smart Units)', title: 'Revenue' },
        { type: 'card', measure: 'Visits' },
        { type: 'card', measure: 'Average Invoice' },
        { type: 'card', measure: 'No-Show %' },
        { type: 'line', category: { table: 'Date', column: 'Month Start' }, measures: ['Revenue', 'Revenue PY'], title: 'Revenue vs Prior Year' },
        { type: 'column', category: { table: 'Species', column: 'Creature Class' }, measures: ['Revenue'], title: 'Revenue by Creature Class' },
        { type: 'matrix', rows: [{ table: 'Clinic', column: 'Clinic Name' }], measures: ['Visits', 'Vet Utilization %', 'Avg Wait (min)', 'No-Show %', 'Clinic Revenue Rank'], title: 'Clinic Scorecard' },
        { type: 'bar', category: { table: 'Diagnosis', column: 'Diagnosis Name' }, measures: ['Diagnosed Appointments'], title: 'Appointments by Diagnosis' }
      ]
    },
    {
      name: 'Finance',
      visuals: [
        { type: 'slicer', field: { table: 'Clinic', column: 'Clinic Name' }, title: 'Cost Center' },
        { type: 'card', measure: 'Operating Profit' },
        { type: 'card', measure: 'Operating Profit Budget' },
        { type: 'card', measure: 'Payroll % of Revenue' },
        { type: 'card', measure: 'AR Balance' },
        { type: 'matrix', rows: [{ table: 'Account', column: 'Account Type' }, { table: 'Account', column: 'Account Name' }], measures: ['Actual', 'Budget', 'Variance', 'Variance %'], title: 'Budget vs Actual' },
        { type: 'line', category: { table: 'Date', column: 'Month Start' }, measures: ['Operating Profit', 'Operating Profit Budget'], title: 'Operating Profit vs Budget' },
        { type: 'column', category: { table: 'Clinic', column: 'Clinic Name' }, measures: ['Profit Variance'], title: 'Profit Variance by Cost Center' },
        { type: 'matrix', rows: [{ table: 'Clinic', column: 'Region' }], columns: [{ table: 'Time Intelligence', column: 'Time Calculation' }], measures: ['Revenue'], title: 'Time Intelligence (calculation group)' }
      ]
    }
  ],
  analyses: [
    { title: 'Ember Flu season', question: 'When does Ember Flu peak, which classes does it hit, and how much bigger was the Highlands outbreak winter?', how: 'Diagnosed Appointments for Ember Flu by Month Start and Region; compare winters with Revenue PY.' },
    { title: 'The broken reminders', question: 'One clinic\'s no-show rate jumped after online booking launched. Which one, and is it only online bookings?', how: 'No-Show % by Clinic × Booking Channel over time (Appointment Type junk dimension).' },
    { title: 'Size pricing', question: 'How much of revenue comes from Large and Colossal creatures, and how does average invoice scale with size?', how: 'Average Invoice by Species[Size Class]; Revenue by Creature Class with the Clinical Breakdown field parameter.' },
    { title: 'Talon & Claw slows down', question: 'Which insurer pays slower every quarter, and how much cash is stuck with them?', how: 'Avg Days to Pay and Outstanding Balance by Payer over Date; Collected by Paid Date via USERELATIONSHIP.' },
    { title: 'The Great Scorch', question: 'Which cost center blew its utilities & fireproofing budget, and when?', how: 'Variance and Variance % for account 6300 by Clinic and Month Start in the GL fact.' },
    { title: 'Budget vs actual', question: 'Which clinics beat their revenue plan and which overspent on payroll?', how: 'Budget vs Actual matrix by Account hierarchy; Profit Variance by cost center; Fiscal YTD with the Time Intelligence calculation group.' },
    { title: 'Waiting room blues', question: 'One clinic\'s waits doubled in the last third of the history. Was it staffing?', how: 'Avg Wait (min) and Vet Utilization % by clinic over time; Active Staff from the SCD2 Staff dimension.' },
    { title: 'Surgery at the Aerie', question: 'Surgical revenue at the Aerie stepped up mid-history. What changed?', how: 'Revenue for Procedure Group = Surgery by clinic and month; check Staff versions (senior vets, specialties).' },
    { title: 'Kraken tank wing', question: 'A coastal hospital opened a tank wing — how quickly did aquatic visits ramp up?', how: 'Visits for Creature Class = Sea Beasts by clinic and Month Start; Clinic[Tank Wing Opened].' },
    { title: 'Payroll vs revenue', question: 'Is payroll creeping up faster than revenue (April raises, promotions)?', how: 'Payroll % of Revenue by fiscal quarter; Staff annual salary by Valid From.' },
    { title: 'Receivables reconciliation', question: 'Does the GL AR balance equal the unpaid invoices in the appointment snapshot?', how: 'AR Balance (semi-additive GL measure) vs Outstanding Balance by clinic at the latest month-end.' },
    { title: 'Diagnosis mix', question: 'Which diagnoses co-occur, and which lead to surgery?', how: 'Appointment Diagnosis bridge: matrix of Diagnosis Name × Visit Type with Diagnosed Appointments; drill to Procedures.' },
    { title: 'Strays', question: 'How many unregistered strays are brought in, where, and who pays?', how: 'Visits for Patient = Unregistered Stray by clinic; Good Samaritan owner.' }
  ],
  notes: `
## Volume note

\`small\` simulates a quiet network (≈3 appointments per clinic per day). Staff headcount, rents and other
operating costs scale with the same factor, so **margins, payroll %, utilization and no-show rates are realistic**
while absolute totals are modest. \`large\` is roughly thirty times busier with proportionally larger clinics.

## Finance conventions

- Journals are posted monthly per cost center (REV, CASH, COGS, PAYROLL, EXPENSE, PAYOUT) and each one balances.
- \`gold_fact_gl_month.actual_amount\` uses the account's natural sign (revenue = credits − debits, costs = debits − credits);
  multiply by \`Account[P&L Sign]\` to get profit. Balance-sheet accounts carry \`closing_balance\` (debit positive) instead.
- The budget for each fiscal year (April–March) is planned from the prior fiscal year's actuals with a growth uplift; the
  first year's plan is the planners' own estimate. Months after today carry budget only.
`,
  generate: generateGriffinGecko,
  invariants(t) {
    const errors: string[] = []
    const lines = t.get('gold_fact_treatment_line')
    const appts = t.get('gold_fact_appointment')
    // invoice = Σ treatment lines; line arithmetic
    const lineByAppt = groupSum(lines, ['appointment_key'], 'net_amount')
    const invByAppt = new Map<string, number>()
    for (const r of rowsOf(appts)) if (r.is_seen) invByAppt.set(String(r.appointment_key), r.invoice_amount as number)
    errors.push(...compareSums('invoice = Σ treatment lines', invByAppt, lineByAppt, 0.02))
    errors.push(...checkRows('treatment line arithmetic', lines, (r) => near(r.gross_amount as number, (r.quantity as number) * (r.unit_price as number)) && near(r.net_amount as number, (r.gross_amount as number) - (r.discount_amount as number))))
    errors.push(...checkRows('appointment payments', appts, (r) => !r.is_seen || near((r.owner_paid_amount as number) + (r.insurer_paid_amount as number) + (r.outstanding_amount as number), r.invoice_amount as number)))
    // clinic-day revenue and visit counts tie to the facts
    errors.push(...compareSums('clinic-day revenue = Σ lines', groupSum(t.get('gold_fact_clinic_day'), ['clinic_key', 'date_key'], 'revenue'), groupSum(lines, ['clinic_key', 'date_key'], 'net_amount'), 0.05))
    const seenByDay = new Map<string, number>()
    for (const r of rowsOf(appts)) if (r.is_seen) seenByDay.set(`${r.clinic_key}|${r.appointment_date_key}`, (seenByDay.get(`${r.clinic_key}|${r.appointment_date_key}`) ?? 0) + 1)
    errors.push(...compareSums('clinic-day visits', groupSum(t.get('gold_fact_clinic_day'), ['clinic_key', 'date_key'], 'visits_seen'), seenByDay, 0))
    // every journal balances
    const jl = t.get('silver_gl_journal_lines')
    errors.push(...compareSums('journal debits = credits', groupSum(jl, ['journal_id'], 'debit'), groupSum(jl, ['journal_id'], 'credit'), 0.001))
    // GL revenue per clinic-month = Σ treatment lines
    const clinicKey = new Map<string, number>()
    for (const r of rowsOf(t.get('gold_dim_clinic'))) clinicKey.set(r.clinic_code as string, r.clinic_key as number)
    const glRev = new Map<string, number>()
    const glWages = new Map<string, number>()
    for (const r of rowsOf(jl)) {
      const d = r.posting_date as Date
      const k = `${clinicKey.get(r.clinic_code as string)}|${d.getUTCFullYear() * 100 + d.getUTCMonth() + 1}`
      const acct = r.account_code as string
      if (acct.startsWith('4')) glRev.set(k, (glRev.get(k) ?? 0) + (r.credit as number) - (r.debit as number))
      if (acct === '6000' || acct === '6010' || acct === '6020') glWages.set(k, (glWages.get(k) ?? 0) + (r.debit as number))
    }
    const lineRev = new Map<string, number>()
    for (const r of rowsOf(lines)) {
      const k = `${r.clinic_key}|${Math.floor((r.date_key as number) / 100)}`
      lineRev.set(k, (lineRev.get(k) ?? 0) + (r.net_amount as number))
    }
    errors.push(...compareSums('GL revenue = Σ treatment lines (clinic-month)', glRev, lineRev, 0.05))
    const payroll = new Map<string, number>()
    for (const r of rowsOf(t.get('silver_payroll_monthly'))) {
      const d = r.pay_month as Date
      const k = `${clinicKey.get(r.clinic_code as string)}|${d.getUTCFullYear() * 100 + d.getUTCMonth() + 1}`
      payroll.set(k, (payroll.get(k) ?? 0) + (r.gross_pay as number))
    }
    errors.push(...compareSums('GL wages = Σ payroll register (cost center-month)', glWages, payroll, 0.05))
    // GL snapshot: whole ledger balances each month; AR balance = outstanding invoices
    const netByMonth = groupSum(t.get('gold_fact_gl_month'), ['month_end_date_key'], 'net_change')
    for (const [k, v] of netByMonth) if (Math.abs(v) > 0.05) errors.push(`GL month ${k} does not balance: ${v.toFixed(2)}`)
    const arAccount = [...rowsOf(t.get('gold_dim_account'))].find((r) => r.account_code === '1100')!.account_key
    let lastKey = 0
    for (const r of rowsOf(t.get('gold_fact_gl_month'))) if (r.closing_balance !== null && (r.month_end_date_key as number) > lastKey) lastKey = r.month_end_date_key as number
    const arGl = new Map<string, number>()
    for (const r of rowsOf(t.get('gold_fact_gl_month'))) if (r.account_key === arAccount && r.month_end_date_key === lastKey && r.closing_balance !== null) arGl.set(String(r.clinic_key), r.closing_balance as number)
    const arFacts = new Map<string, number>()
    for (const r of rowsOf(appts)) if (r.is_seen) arFacts.set(String(r.clinic_key), (arFacts.get(String(r.clinic_key)) ?? 0) + (r.outstanding_amount as number))
    for (const k of arGl.keys()) if (!arFacts.has(k)) arFacts.set(k, 0)
    errors.push(...compareSums('GL AR balance = outstanding invoices', arGl, arFacts, 0.5))
    return errors
  }
}

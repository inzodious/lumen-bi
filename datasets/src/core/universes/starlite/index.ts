/**
 * Starlite Coffee Co. — a cosmic-diner coffee chain. Retail POS, inventory & waste, suppliers &
 * purchase orders, crew labor (SCD2), loyalty, promotions, surveys/NPS and weather-driven demand.
 */
import { GENERIC_HOLIDAYS } from '../../calendar.ts'
import { checkRows, compareSums, groupCount, groupSum, near, rowsOf } from '../../check.ts'
import type { MeasureSpec, Universe } from '../../schema.ts'
import { generateStarlite } from './generate.ts'
import { STARLITE_ISSUES, STARLITE_SOURCES, STARLITE_TABLES } from './tables.ts'

const S = "'Sales'"
const SD = "'Store Day'"
const INV = "'Inventory'"
const PO = "'Purchase Orders'"
const DATE = "'Date'[Date]"

const measures: MeasureSpec[] = [
  // Sales
  { name: 'Net Sales', expr: `SUM ( ${S}[Net Amount] )`, format: '$#,0', folder: 'Sales', description: 'Sales after discounts and rewards.' },
  { name: 'Gross Sales', expr: `SUM ( ${S}[Gross Amount] )`, format: '$#,0', folder: 'Sales', description: 'Sales at menu price before discounts.' },
  { name: 'Discounts', expr: `SUM ( ${S}[Discount Amount] )`, format: '$#,0', folder: 'Sales', description: 'Promotion and reward discounts.' },
  { name: 'Discount Rate %', expr: 'DIVIDE ( [Discounts], [Gross Sales] )', format: '0.0%', folder: 'Sales', description: 'Share of gross sales given away.' },
  { name: 'COGS', expr: `SUM ( ${S}[Cost Amount] )`, format: '$#,0', folder: 'Sales', description: 'Standard cost of goods sold.' },
  { name: 'Gross Margin', expr: '[Net Sales] - [COGS]', format: '$#,0', folder: 'Sales', description: 'Net sales minus COGS.' },
  { name: 'Gross Margin %', expr: 'DIVIDE ( [Gross Margin], [Net Sales] )', format: '0.0%', folder: 'Sales', description: 'Gross margin as a share of net sales.' },
  { name: 'Transactions', expr: `DISTINCTCOUNT ( ${S}[Transaction ID] )`, format: '#,0', folder: 'Sales', description: 'Number of tickets.' },
  { name: 'Items Sold', expr: `SUM ( ${S}[Quantity] )`, format: '#,0', folder: 'Sales', description: 'Units sold.' },
  { name: 'Average Ticket', expr: 'DIVIDE ( [Net Sales], [Transactions] )', format: '$#,0.00', folder: 'Sales', description: 'Net sales per transaction.' },
  { name: 'Items per Transaction', expr: 'DIVIDE ( [Items Sold], [Transactions] )', format: '0.00', folder: 'Sales', description: 'Basket size.' },
  {
    name: 'Net Sales (Smart Units)',
    expr: '[Net Sales]',
    formatExpr: 'SWITCH ( TRUE (), ABS ( [Net Sales] ) >= 1000000, "$#,0.0,,""M""", ABS ( [Net Sales] ) >= 1000, "$#,0.0,""K""", "$#,0" )',
    folder: 'Sales',
    description: 'Net sales with a dynamic format string: $1.2M / $45.3K / $950.'
  },
  // Time intelligence
  { name: 'Net Sales YTD', expr: `TOTALYTD ( [Net Sales], ${DATE} )`, format: '$#,0', folder: 'Time Intelligence', description: 'Calendar year-to-date net sales.' },
  { name: 'Net Sales FYTD', expr: `TOTALYTD ( [Net Sales], ${DATE}, "9/30" )`, format: '$#,0', folder: 'Time Intelligence', description: 'Fiscal year-to-date (Starlite\'s fiscal year starts 1 October).' },
  { name: 'Net Sales PY', expr: `CALCULATE ( [Net Sales], SAMEPERIODLASTYEAR ( ${DATE} ) )`, format: '$#,0', folder: 'Time Intelligence', description: 'Same period last year.' },
  { name: 'Net Sales YoY %', expr: 'DIVIDE ( [Net Sales] - [Net Sales PY], [Net Sales PY] )', format: '0.0%;-0.0%;0.0%', folder: 'Time Intelligence', description: 'Growth versus the same period last year.' },
  {
    name: 'Net Sales 28D Avg',
    expr: `AVERAGEX ( DATESINPERIOD ( ${DATE}, MAX ( ${DATE} ), -28, DAY ), [Net Sales] )`,
    format: '$#,0',
    folder: 'Time Intelligence',
    description: 'Rolling 28-day average of daily net sales (smooths weekday noise).'
  },
  // Customers & loyalty
  { name: 'Member Sales %', expr: `DIVIDE ( CALCULATE ( [Net Sales], 'Member'[Is Guest] = FALSE () ), [Net Sales] )`, format: '0.0%', folder: 'Loyalty', description: 'Share of sales from Starlite Stars members.' },
  { name: 'Active Members', expr: `CALCULATE ( DISTINCTCOUNT ( ${S}[Member Key] ), 'Member'[Is Guest] = FALSE () )`, format: '#,0', folder: 'Loyalty', description: 'Members with at least one purchase in context.' },
  { name: 'Stars Earned', expr: `SUM ( ${S}[Stars Earned] )`, format: '#,0', folder: 'Loyalty', description: 'Loyalty stars issued.' },
  { name: 'Promo Sales %', expr: `DIVIDE ( CALCULATE ( [Net Sales], 'Promotion'[Promotion Type] <> "None" ), [Net Sales] )`, format: '0.0%', folder: 'Loyalty', description: 'Share of sales on promotion.' },
  // Store operations
  { name: 'Visitors', expr: `SUM ( ${SD}[Visitors] )`, format: '#,0', folder: 'Operations', description: 'Door-count visitors.' },
  { name: 'Conversion %', expr: `DIVIDE ( SUM ( ${SD}[Transactions] ), [Visitors] )`, format: '0.0%', folder: 'Operations', description: 'Transactions per visitor.' },
  { name: 'Labor Hours', expr: `SUM ( ${SD}[Labor Hours] )`, format: '#,0', folder: 'Operations', description: 'Crew hours worked.' },
  { name: 'Labor Cost', expr: `SUM ( ${SD}[Labor Cost] )`, format: '$#,0', folder: 'Operations', description: 'Crew wages.' },
  { name: 'Labor Cost %', expr: `DIVIDE ( [Labor Cost], SUM ( ${SD}[Net Sales] ) )`, format: '0.0%', folder: 'Operations', description: 'Wages as a share of net sales.' },
  { name: 'Sales per Labor Hour', expr: `DIVIDE ( SUM ( ${SD}[Net Sales] ), [Labor Hours] )`, format: '$#,0.00', folder: 'Operations', description: 'Productivity.' },
  {
    name: 'NPS',
    expr: `VAR Responses = SUM ( ${SD}[Survey Responses] )\nRETURN\n    IF ( Responses > 0, DIVIDE ( SUM ( ${SD}[Promoters] ) - SUM ( ${SD}[Detractors] ), Responses ) * 100 )`,
    format: '0.0',
    folder: 'Operations',
    description: 'Net Promoter Score: % promoters − % detractors (−100…100).'
  },
  { name: 'Avg High Temp °C', expr: `AVERAGE ( ${SD}[Temp High C] )`, format: '0.0', folder: 'Operations', description: 'Average daily high temperature.' },
  { name: 'POS Outage Days', expr: `CALCULATE ( COUNTROWS ( ${SD} ), ${SD}[Is POS Outage] = TRUE () )`, format: '#,0', folder: 'Operations', description: 'Store-days with no sales recorded because the tills were down.' },
  // Inventory & procurement
  { name: 'Stock Value', expr: `CALCULATE ( SUM ( ${INV}[Closing Value] ), LASTDATE ( ${DATE} ) )`, format: '$#,0', folder: 'Inventory', description: 'Closing stock value on the last date in context (semi-additive).' },
  { name: 'Waste Cost', expr: `SUM ( ${INV}[Waste Value] )`, format: '$#,0', folder: 'Inventory', description: 'Value written off.' },
  { name: 'Waste % of Usage', expr: `DIVIDE ( [Waste Cost], SUM ( ${INV}[Used Value] ) )`, format: '0.0%', folder: 'Inventory', description: 'Waste relative to consumption.' },
  { name: 'PO Spend', expr: `SUM ( ${PO}[Line Amount] )`, format: '$#,0', folder: 'Procurement', description: 'Purchase-order value by order date.' },
  { name: 'PO Spend by Received Date', expr: `CALCULATE ( [PO Spend], USERELATIONSHIP ( ${PO}[Received Date Key], 'Date'[Date Key] ) )`, format: '$#,0', folder: 'Procurement', description: 'Same spend dated by delivery (role-playing date via USERELATIONSHIP).' },
  {
    name: 'On-Time Delivery %',
    expr: `DIVIDE ( CALCULATE ( COUNTROWS ( ${PO} ), ${PO}[Is On Time] = TRUE () ), CALCULATE ( COUNTROWS ( ${PO} ), NOT ISBLANK ( ${PO}[Received Date Key] ) ) )`,
    format: '0.0%',
    folder: 'Procurement',
    description: 'Delivered lines that arrived by the promised date.'
  },
  { name: 'Open PO Value', expr: `CALCULATE ( [PO Spend], ${PO}[Status] <> "Paid" )`, format: '$#,0', folder: 'Procurement', description: 'Ordered or received but not yet paid.' },
  // Rankings
  { name: 'Store Rank', expr: `IF ( HASONEVALUE ( 'Store'[Store Name] ), RANKX ( ALL ( 'Store'[Store Name] ), [Net Sales] ) )`, format: '0', folder: 'Rankings', description: 'Rank of the store by net sales.' },
  {
    name: 'Top Product',
    expr: `FIRSTNONBLANK ( TOPN ( 1, VALUES ( 'Product'[Product Name] ), [Net Sales] ), 1 )`,
    folder: 'Rankings',
    description: 'Best-selling menu item in context.'
  },
  { name: 'Recipes Using Ingredient', expr: `CALCULATE ( DISTINCTCOUNT ( 'Recipe'[Product Key] ) )`, format: '#,0', folder: 'Inventory', description: 'Menu items that use the ingredient(s) in context (many-to-many bridge).' }
]

export const starlite: Universe = {
  id: 'starlite',
  company: 'Starlite Coffee Co.',
  name: 'Starlite',
  tagline: 'Coffee at the speed of light — a cosmic diner & café chain where the weather, the menu and the night sky all move the numbers.',
  premise: `
Starlite Coffee Co. started as a single chrome-and-neon diner with a telescope on the roof. Today it runs a
small chain of **diners, cafés, commuter kiosks and drive-ins** across four constellation-named regions,
serving the *Supernova Latte*, the *Black Hole Cold Brew* and a *Red Giant Burger* that has its own fan club.

Everything is connected the way it is in a real food-service business:

- **Weather drives demand.** Hot days sell Lunar Lemonade and cold brew, rainy days empty the cafés (but not the
  drive-thrus), snow is brutal. A summer **heatwave** is hiding in the data.
- **The calendar matters.** Weekday commuters keep the kiosks alive; diners boom on weekends. Every 12 August is
  **Meteor Shower Night** and the diners stay packed until closing.
- **Promotions work — mostly.** BOGO pancakes, double-stars weeks and bakery bundles lift traffic and discount
  rates. Members (Comet → Nova → Supernova) earn and redeem stars.
- **Kitchens consume ingredients.** Every item has a recipe; sales draw stock down, crews log waste, stores order
  weekly from eight suppliers — one of which (*Orbit Packaging Supply*) gets steadily less reliable.
- **People change.** Crew members are hired, get April raises, convert to full-time, transfer and leave; the
  employee dimension keeps every version (SCD2).
- **Things go wrong.** One store's tills went down for a day, one store had a rough quarter (watch its NPS), and one
  location closed.
`,
  shapes: ['Retail POS', 'Inventory & waste', 'Supply chain', 'HR / labor (SCD2)', 'Loyalty', 'Weather-driven demand'],
  fiscalYearStartMonth: 10,
  holidays: [...GENERIC_HOLIDAYS, { name: "Founders' Day", month: 3, day: 14 }, { name: 'Meteor Shower Night', month: 8, day: 12 }],
  timeDim: true,
  sources: STARLITE_SOURCES,
  issues: STARLITE_ISSUES,
  tables: STARLITE_TABLES,
  measures,
  fieldParameter: {
    name: 'Sales Breakdown',
    fields: [
      { label: 'Region', ref: "'Store'[Region]" },
      { label: 'Store', ref: "'Store'[Store Name]" },
      { label: 'Format', ref: "'Store'[Store Format]" },
      { label: 'Category', ref: "'Product'[Category]" },
      { label: 'Product', ref: "'Product'[Product Name]" },
      { label: 'Day Part', ref: "'Time'[Day Part]" },
      { label: 'Channel', ref: "'Payment'[Order Channel]" },
      { label: 'Member Tier', ref: "'Member'[Tier]" }
    ]
  },
  report: [
    {
      name: 'Sales Overview',
      visuals: [
        { type: 'slicer', field: { table: 'Store', column: 'Region' }, title: 'Region' },
        { type: 'slicer', field: { table: 'Date', column: 'Year' }, title: 'Year', mode: 'Basic' },
        { type: 'card', measure: 'Net Sales (Smart Units)', title: 'Net Sales' },
        { type: 'card', measure: 'Transactions' },
        { type: 'card', measure: 'Average Ticket' },
        { type: 'card', measure: 'Gross Margin %' },
        { type: 'line', category: { table: 'Date', column: 'Month Start' }, measures: ['Net Sales', 'Net Sales PY'], title: 'Net Sales vs Prior Year' },
        { type: 'column', category: { table: 'Product', column: 'Category' }, measures: ['Net Sales'], title: 'Net Sales by Category' },
        { type: 'matrix', rows: [{ table: 'Store', column: 'Store Name' }], measures: ['Net Sales', 'Net Sales YoY %', 'Average Ticket', 'Store Rank'], title: 'Store Scorecard' },
        { type: 'bar', category: { table: 'Time', column: 'Hour Label' }, measures: ['Transactions'], title: 'Transactions by Hour' }
      ]
    },
    {
      name: 'Operations',
      visuals: [
        { type: 'slicer', field: { table: 'Store', column: 'Store Format' }, title: 'Format' },
        { type: 'card', measure: 'Visitors' },
        { type: 'card', measure: 'Conversion %' },
        { type: 'card', measure: 'Labor Cost %' },
        { type: 'card', measure: 'NPS' },
        { type: 'line', category: { table: 'Date', column: 'Month Start' }, measures: ['Sales per Labor Hour'], title: 'Sales per Labor Hour' },
        { type: 'column', category: { table: 'Ingredient', column: 'Ingredient Category' }, measures: ['Waste Cost'], title: 'Waste by Ingredient Category' },
        { type: 'matrix', rows: [{ table: 'Store', column: 'Region' }], columns: [{ table: 'Time Intelligence', column: 'Time Calculation' }], measures: ['Net Sales'], title: 'Time Intelligence (calculation group)' },
        { type: 'column', category: { table: 'Supplier', column: 'Supplier Name' }, measures: ['On-Time Delivery %'], title: 'Supplier On-Time %' }
      ]
    }
  ],
  analyses: [
    { title: 'Weather elasticity', question: 'How much do cold drinks gain per extra degree, and how much traffic does rain cost cafés vs drive-ins?', how: 'Scatter Avg High Temp °C vs Net Sales by Category (Store Day joined through Date/Store); split by Weather Condition and Store Format.' },
    { title: 'The heatwave', question: 'Find the 9-day summer heatwave. What happened to hot vs cold drinks and to traffic?', how: 'Line chart of Net Sales by Product[Temperature] over Date with a Weather Condition slicer.' },
    { title: 'Meteor Shower Night', question: 'How big is the 12 August spike and which hours/formats carry it?', how: 'Date[Holiday Name] filter + Time[Hour Label] columns; compare with the same weekday a week earlier.' },
    { title: 'Promotion lift & cannibalisation', question: 'Did BOGO pancakes and % off weeks grow the category or just give margin away?', how: 'Promo Sales %, Discount Rate % and Gross Margin % by Promotion; compare category sales during vs outside the promo window.' },
    { title: 'Loyalty value', question: 'Do Supernova members have bigger tickets and visit more often?', how: 'Average Ticket and Transactions by Member[Tier]; Active Members trend; Member Sales % by region.' },
    { title: 'Labor productivity', question: 'Which stores are over- or under-staffed for their traffic?', how: 'Sales per Labor Hour vs Labor Cost % by store; flag outliers with conditional formatting.' },
    { title: 'Rough quarter', question: 'One store had a bad stretch. When, and did NPS warn you before sales fell?', how: 'NPS and Net Sales YoY % by month per store; look for the dip and the topics in silver_survey_responses.' },
    { title: 'Waste hot spots', question: 'Which ingredients and reasons drive waste, and is it worse in low-volume stores?', how: 'Waste Cost and Waste % of Usage by Ingredient Category and Store Format; decomposition tree by reason (silver_waste_log).' },
    { title: 'Supplier reliability', question: 'Which supplier is getting worse at on-time delivery?', how: 'On-Time Delivery % by Supplier over Date (Order Date) — and repeat with the Received Date role via USERELATIONSHIP.' },
    { title: 'Inventory reconciliation', question: 'Prove opening + received − used − waste + adjustment = closing, and find the biggest unexplained adjustments.', how: 'Matrix on Inventory by Ingredient × month; DAX check column; Stock Value semi-additive measure.' },
    { title: 'Dayparts & menu engineering', question: 'Which items are stars (high margin, high volume) and which are dogs?', how: 'Scatter of Gross Margin % vs Items Sold by Product; the Sales Breakdown field parameter to switch axes.' },
    { title: 'Crew history (SCD2)', question: 'How did average hourly rates evolve, and what was each store\'s headcount on any date?', how: 'Use Employee valid_from/valid_to with a disconnected date or the Sales relationship to the version in effect.' },
    { title: 'POS outage detective work', question: 'Find the store-day where the tills were down. What did visitors look like?', how: 'POS Outage Days measure; Visitors vs Transactions by day for that store.' }
  ],
  notes: `
## Volume note

\`small\` simulates roughly a 1-in-30 sample of real Starlite traffic so the whole lakehouse stays around 100k fact
rows; labor hours, ingredient usage, waste and purchasing are scaled the same way, so **ratios (labor %, margin %,
waste %, conversion, NPS) are realistic** while absolute totals are miniature. \`large\` runs at full volume.
`,
  generate: generateStarlite,
  invariants(t) {
    const errors: string[] = []
    // POS: line items sum exactly to transaction headers
    errors.push(...compareSums('silver lines → transaction net', groupSum(t.get('silver_pos_lines'), ['transaction_id'], 'net_amount'), groupSum(t.get('silver_pos_transactions'), ['transaction_id'], 'net_amount')))
    errors.push(...compareSums('silver lines → line_count', groupCount(t.get('silver_pos_lines'), ['transaction_id']), groupSum(t.get('silver_pos_transactions'), ['transaction_id'], 'line_count'), 0))
    // gold lines: gross = qty × price, net = gross − discount
    errors.push(...checkRows('sales line arithmetic', t.get('gold_fact_sales_line'), (r) => near(r.gross_amount as number, (r.quantity as number) * (r.unit_price as number)) && near(r.net_amount as number, (r.gross_amount as number) - (r.discount_amount as number))))
    // store-day snapshot ties to the sales lines
    errors.push(...compareSums('store-day net = Σ lines', groupSum(t.get('gold_fact_store_day'), ['store_key', 'date_key'], 'net_sales'), groupSum(t.get('gold_fact_sales_line'), ['store_key', 'date_key'], 'net_amount'), 0.05))
    const txByDay = groupCount(t.get('gold_fact_sales_line'), ['store_key', 'date_key'], 'transaction_id')
    errors.push(...compareSums('store-day transactions', groupSum(t.get('gold_fact_store_day'), ['store_key', 'date_key'], 'transactions'), txByDay, 0))
    // inventory: opening + received − used − waste + adjustment = closing; opening = previous closing
    errors.push(...checkRows('inventory roll-forward', t.get('gold_fact_inventory_month'), (r) => near((r.opening_qty as number) + (r.received_qty as number) - (r.used_qty as number) - (r.waste_qty as number) + (r.adjustment_qty as number), r.closing_qty as number, 0.005)))
    const prev = new Map<string, number>()
    const inv = [...rowsOf(t.get('gold_fact_inventory_month'))].sort((a, b) => (a.snapshot_date_key as number) - (b.snapshot_date_key as number))
    for (const r of inv) {
      const key = `${r.store_key}|${r.ingredient_key}`
      if (prev.has(key) && !near(prev.get(key)!, r.opening_qty as number, 0.005)) {
        errors.push(`inventory opening ≠ previous closing for ${key} at ${r.snapshot_date_key}`)
        break
      }
      prev.set(key, r.closing_qty as number)
    }
    // purchase orders: lifecycle consistency
    errors.push(...checkRows('PO lifecycle', t.get('gold_fact_po_line'), (r) => (r.status === 'Paid' ? r.paid_date_key !== null && r.received_date_key !== null : r.status === 'Received' ? r.received_date_key !== null && r.paid_date_key === null : r.received_date_key === null)))
    // received quantities in inventory equal PO receipts (Σ over all months)
    errors.push(...compareSums('received qty = PO receipts', groupSum(t.get('gold_fact_inventory_month'), ['store_key', 'ingredient_key'], 'received_qty'), groupSum(t.get('gold_fact_po_line'), ['store_key', 'ingredient_key'], 'received_qty'), 0.05))
    return errors
  }
}

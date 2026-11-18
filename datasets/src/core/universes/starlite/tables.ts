/**
 * Starlite Coffee Co. — table specifications (silver + gold), bronze sources and planted issues.
 */
import { c } from '../../schema.ts'
import type { BronzeSourceDoc, IssueDoc, TableSpec } from '../../schema.ts'

const D = 'gold_dim_date'

// ---------------------------------------------------------------------------------------------
// Gold dimensions

const dimStore: TableSpec = {
  name: 'gold_dim_store',
  layer: 'gold',
  kind: 'dim',
  description: 'Starlite locations: diners, cafés, kiosks and drive-ins across four constellation-named regions.',
  grain: 'One row per store.',
  key: ['store_key'],
  columns: [
    c('store_key', 'int', 'Surrogate key.'),
    c('store_code', 'string', 'Business key, e.g. "SL-007".', { nullable: false }),
    c('store_name', 'string', 'Store name.'),
    c('store_format', 'string', 'Diner / Café / Kiosk / Drive-In.'),
    c('region', 'string', 'Sales region (constellation-themed).'),
    c('district', 'string', 'District within the region.'),
    c('city', 'string', 'City (fictional).', { category: 'City' }),
    c('latitude', 'double', 'Latitude (fictional placement).', { category: 'Latitude', summarize: 'none', format: '0.0000' }),
    c('longitude', 'double', 'Longitude (fictional placement).', { category: 'Longitude', summarize: 'none', format: '0.0000' }),
    c('opened_date', 'date', 'Opening date.'),
    c('closed_date', 'date', 'Closing date (blank while trading).'),
    c('seats', 'int', 'Seating capacity.'),
    c('square_feet', 'int', 'Floor area in square feet.'),
    c('has_drive_thru', 'bool', 'Has a drive-thru lane.'),
    c('store_status', 'string', 'Open / Closed.')
  ],
  model: { name: 'Store', hierarchies: [{ name: 'Geography', levels: ['region', 'district', 'store_name'] }] }
}

const dimProduct: TableSpec = {
  name: 'gold_dim_product',
  layer: 'gold',
  kind: 'dim',
  description: 'Menu items with category hierarchy, current price and cost. Key -1 = unknown / open-ring item.',
  grain: 'One row per menu item (plus the unknown member).',
  key: ['product_key'],
  columns: [
    c('product_key', 'int', 'Surrogate key (-1 = Unknown).'),
    c('sku', 'string', 'Business key, e.g. "SKU-1004".'),
    c('product_name', 'string', 'Menu name.'),
    c('category', 'string', 'Coffee / Tea & Matcha / Cold Drinks / Bakery / Diner Plates / Merch.'),
    c('subcategory', 'string', 'Subcategory.'),
    c('temperature', 'string', 'Hot / Cold / Food / Merch — drives weather sensitivity.'),
    c('list_price', 'decimal', 'Current menu price (USD).', { format: '$#,0.00' }),
    c('unit_cost', 'decimal', 'Current standard cost (USD).', { format: '$#,0.00' }),
    c('caffeine_mg', 'int', 'Caffeine per serving (mg).'),
    c('is_seasonal', 'bool', 'Seasonal (limited-time) item.'),
    c('launch_date', 'date', 'Date the item joined the menu.')
  ],
  model: { name: 'Product', hierarchies: [{ name: 'Menu', levels: ['category', 'subcategory', 'product_name'] }] }
}

const dimIngredient: TableSpec = {
  name: 'gold_dim_ingredient',
  layer: 'gold',
  kind: 'dim',
  description: 'Stocked ingredients and packaging with unit cost and preferred supplier.',
  grain: 'One row per ingredient.',
  key: ['ingredient_key'],
  columns: [
    c('ingredient_key', 'int', 'Surrogate key.'),
    c('ingredient_code', 'string', 'Business key, e.g. "ING-012".'),
    c('ingredient_name', 'string', 'Ingredient name.'),
    c('ingredient_category', 'string', 'Coffee & Tea / Dairy & Alt / Syrups & Sauces / Bakery / Kitchen / Packaging.'),
    c('unit_of_measure', 'string', 'kg / L / each.'),
    c('unit_cost', 'decimal', 'Standard cost per unit (USD).', { format: '$#,0.00' }),
    c('pack_size', 'double', 'Units per purchase pack.', { format: '#,0.##' }),
    c('shelf_life_days', 'int', 'Shelf life in days.'),
    c('is_perishable', 'bool', 'Shelf life under 30 days.'),
    c('supplier_name', 'string', 'Preferred supplier.')
  ],
  model: { name: 'Ingredient', hierarchies: [{ name: 'Ingredients', levels: ['ingredient_category', 'ingredient_name'] }] }
}

const dimSupplier: TableSpec = {
  name: 'gold_dim_supplier',
  layer: 'gold',
  kind: 'dim',
  description: 'Suppliers with payment terms and contracted lead time.',
  grain: 'One row per supplier.',
  key: ['supplier_key'],
  columns: [
    c('supplier_key', 'int', 'Surrogate key.'),
    c('supplier_code', 'string', 'Business key, e.g. "SUP-03".'),
    c('supplier_name', 'string', 'Supplier name (fictional).'),
    c('supplier_category', 'string', 'What they supply.'),
    c('city', 'string', 'Head office city (fictional).'),
    c('payment_terms_days', 'int', 'Net payment terms in days.'),
    c('contract_lead_time_days', 'int', 'Promised delivery lead time in days.'),
    c('quality_rating', 'double', 'Internal rating 1-5.', { format: '0.0', summarize: 'none' })
  ],
  model: { name: 'Supplier' }
}

const dimEmployee: TableSpec = {
  name: 'gold_dim_employee',
  layer: 'gold',
  kind: 'dim',
  description: 'Crew members with full history (SCD Type 2): role changes, raises, store transfers and terminations each open a new version.',
  grain: 'One row per employee version.',
  key: ['employee_sk'],
  scd2: { businessKey: 'employee_id', from: 'valid_from', to: 'valid_to', current: 'is_current' },
  columns: [
    c('employee_sk', 'int', 'Surrogate key of the version.'),
    c('employee_id', 'string', 'Business key, e.g. "E-0042".'),
    c('full_name', 'string', 'Name (fictional).'),
    c('role', 'string', 'Barista / Shift Lead / Store Manager / Line Cook.'),
    c('store_code', 'string', 'Home store in this version.'),
    c('store_name', 'string', 'Home store name in this version.'),
    c('hourly_rate', 'decimal', 'Hourly pay rate in this version (USD).', { format: '$#,0.00', summarize: 'none' }),
    c('employment_type', 'string', 'Full-time / Part-time.'),
    c('employment_status', 'string', 'Active / Terminated.'),
    c('hire_date', 'date', 'Original hire date.'),
    c('valid_from', 'date', 'Version start (inclusive).', { folder: 'SCD2' }),
    c('valid_to', 'date', 'Version end (inclusive; 9999-12-31 = open).', { folder: 'SCD2' }),
    c('is_current', 'bool', 'Current version flag.', { folder: 'SCD2' }),
    c('version', 'int', 'Version number per employee.', { folder: 'SCD2', summarize: 'none' })
  ],
  model: { name: 'Employee' }
}

const dimMember: TableSpec = {
  name: 'gold_dim_member',
  layer: 'gold',
  kind: 'dim',
  description: 'Starlite Stars loyalty members. Key -1 = guest (no member card).',
  grain: 'One row per member (plus the guest member).',
  key: ['member_key'],
  fks: [{ column: 'home_store_key', table: 'gold_dim_store', noModel: true, nullable: true }],
  columns: [
    c('member_key', 'int', 'Surrogate key (-1 = Guest).'),
    c('member_id', 'string', 'Business key, e.g. "M-000123".'),
    c('is_guest', 'bool', 'True for the guest member.'),
    c('tier', 'string', 'Comet / Nova / Supernova (Guest for -1).', { sortBy: 'tier_rank' }),
    c('tier_rank', 'int', 'Tier order 0-3.', { hidden: true }),
    c('join_date', 'date', 'Program join date.'),
    c('join_channel', 'string', 'App / In-store / Web.'),
    c('age_band', 'string', 'Age band.'),
    c('birth_month', 'int', 'Birth month (for birthday rewards).'),
    c('home_store_key', 'int', 'Store the member visits most.'),
    c('email_opt_in', 'bool', 'Marketing e-mail consent.')
  ],
  model: { name: 'Member' }
}

const dimPromotion: TableSpec = {
  name: 'gold_dim_promotion',
  layer: 'gold',
  kind: 'dim',
  description: 'Marketing promotions. Key -1 = no promotion.',
  grain: 'One row per promotion (plus "No Promotion").',
  key: ['promotion_key'],
  columns: [
    c('promotion_key', 'int', 'Surrogate key (-1 = none).'),
    c('promo_code', 'string', 'Business key.'),
    c('promotion_name', 'string', 'Campaign name.'),
    c('promotion_type', 'string', '% Off / BOGO / Double Stars / Bundle / None.'),
    c('target_category', 'string', 'Product category on promotion.'),
    c('discount_pct', 'double', 'Nominal discount.', { format: '0%', summarize: 'none' }),
    c('start_date', 'date', 'First day.'),
    c('end_date', 'date', 'Last day.')
  ],
  model: { name: 'Promotion' }
}

const dimPayment: TableSpec = {
  name: 'gold_dim_payment',
  layer: 'gold',
  kind: 'dim',
  description: 'Junk dimension: every combination of payment method and order channel.',
  grain: 'One row per payment method × order channel.',
  key: ['payment_key'],
  columns: [
    c('payment_key', 'int', 'Surrogate key.'),
    c('payment_method', 'string', 'Card / Cash / Mobile Wallet / Starlite App / Gift Card.'),
    c('order_channel', 'string', 'Counter / Drive-Thru / Mobile Order / Delivery.'),
    c('is_digital', 'bool', 'Order placed digitally (mobile order or delivery).')
  ],
  model: { name: 'Payment' }
}

const bridgeRecipe: TableSpec = {
  name: 'gold_bridge_recipe',
  layer: 'gold',
  kind: 'bridge',
  description: 'Bill of materials: which ingredients (and how much) go into each menu item. Many-to-many bridge between Product and Ingredient.',
  grain: 'One row per menu item × ingredient.',
  key: ['product_key', 'ingredient_key'],
  fks: [
    { column: 'product_key', table: 'gold_dim_product', bidirectional: true },
    { column: 'ingredient_key', table: 'gold_dim_ingredient' }
  ],
  columns: [
    c('product_key', 'int', 'Menu item.'),
    c('ingredient_key', 'int', 'Ingredient.'),
    c('quantity_per_unit', 'double', 'Ingredient units consumed per item sold.', { format: '0.000', summarize: 'none' })
  ],
  model: { name: 'Recipe' }
}

// ---------------------------------------------------------------------------------------------
// Gold facts

const factSales: TableSpec = {
  name: 'gold_fact_sales_line',
  layer: 'gold',
  kind: 'fact',
  factType: 'transaction',
  description: 'POS line items with header attributes (store, member, payment, barista, promotion). Lines sum exactly to transaction totals.',
  grain: 'One row per transaction line.',
  key: ['transaction_id', 'line_number'],
  partitionByYearOf: 'sale_date',
  fks: [
    { column: 'date_key', table: D },
    { column: 'time_key', table: 'gold_dim_time' },
    { column: 'store_key', table: 'gold_dim_store' },
    { column: 'product_key', table: 'gold_dim_product' },
    { column: 'member_key', table: 'gold_dim_member' },
    { column: 'promotion_key', table: 'gold_dim_promotion' },
    { column: 'payment_key', table: 'gold_dim_payment' },
    { column: 'employee_sk', table: 'gold_dim_employee' }
  ],
  columns: [
    c('transaction_id', 'string', 'POS transaction id.'),
    c('line_number', 'int', 'Line number within the transaction.', { summarize: 'none' }),
    c('sale_date', 'date', 'Business date (partition source).', { exclude: true }),
    c('date_key', 'int', 'Sale date.'),
    c('time_key', 'int', 'Sale time (15-minute slot).'),
    c('store_key', 'int', 'Store.'),
    c('product_key', 'int', 'Menu item (-1 = unknown SKU).'),
    c('member_key', 'int', 'Loyalty member (-1 = guest).'),
    c('promotion_key', 'int', 'Promotion applied (-1 = none).'),
    c('payment_key', 'int', 'Payment method × channel.'),
    c('employee_sk', 'int', 'Barista who rang the sale (SCD2 version in effect).'),
    c('quantity', 'int', 'Units sold.'),
    c('unit_price', 'decimal', 'Price per unit at time of sale (USD).', { format: '$#,0.00', summarize: 'none' }),
    c('gross_amount', 'decimal', 'quantity × unit_price.', { format: '$#,0.00' }),
    c('discount_amount', 'decimal', 'Promotion / reward discount.', { format: '$#,0.00' }),
    c('net_amount', 'decimal', 'gross_amount − discount_amount.', { format: '$#,0.00' }),
    c('cost_amount', 'decimal', 'Standard cost of goods sold.', { format: '$#,0.00' }),
    c('stars_earned', 'int', 'Loyalty stars earned on the line.')
  ],
  model: { name: 'Sales' }
}

const factStoreDay: TableSpec = {
  name: 'gold_fact_store_day',
  layer: 'gold',
  kind: 'fact',
  factType: 'periodic snapshot',
  description: 'Daily store scorecard: traffic, sales, labor, waste, survey results and the weather that drove them.',
  grain: 'One row per store per calendar day while the store is open.',
  key: ['store_key', 'date_key'],
  fks: [
    { column: 'date_key', table: D },
    { column: 'store_key', table: 'gold_dim_store' }
  ],
  columns: [
    c('store_key', 'int', 'Store.'),
    c('date_key', 'int', 'Business date.'),
    c('visitors', 'int', 'Door-count estimate of people entering (incl. drive-thru cars).'),
    c('transactions', 'int', 'POS transactions.'),
    c('items_sold', 'int', 'Units sold.'),
    c('net_sales', 'decimal', 'Net sales (equals the day\'s Sales lines).', { format: '$#,0.00' }),
    c('labor_hours', 'double', 'Worked crew hours.', { format: '#,0.0' }),
    c('labor_cost', 'decimal', 'Crew wages (USD).', { format: '$#,0.00' }),
    c('waste_cost', 'decimal', 'Cost of ingredients written off.', { format: '$#,0.00' }),
    c('survey_responses', 'int', 'Guest survey responses.'),
    c('promoters', 'int', 'Responses scoring 9-10.'),
    c('passives', 'int', 'Responses scoring 7-8.'),
    c('detractors', 'int', 'Responses scoring 0-6.'),
    c('temp_high_c', 'double', 'Daily high temperature (°C).', { summarize: 'average', format: '0.0', folder: 'Weather' }),
    c('precipitation_mm', 'double', 'Precipitation (mm).', { summarize: 'sum', format: '0.0', folder: 'Weather' }),
    c('weather_condition', 'string', 'Sunny / Cloudy / Rain / Snow / Storm / Heatwave.', { folder: 'Weather' }),
    c('is_pos_outage', 'bool', 'POS was down (no sales recorded).')
  ],
  model: { name: 'Store Day' }
}

const factInventory: TableSpec = {
  name: 'gold_fact_inventory_month',
  layer: 'gold',
  kind: 'fact',
  factType: 'periodic snapshot',
  description: 'Month-end stock position per store and ingredient. Reconciles: opening + received − used − wasted + adjustment = closing.',
  grain: 'One row per store × ingredient × month (snapshot on the last day of the month, or today for the current month).',
  key: ['store_key', 'ingredient_key', 'snapshot_date_key'],
  fks: [
    { column: 'snapshot_date_key', table: D },
    { column: 'store_key', table: 'gold_dim_store' },
    { column: 'ingredient_key', table: 'gold_dim_ingredient' }
  ],
  columns: [
    c('store_key', 'int', 'Store.'),
    c('ingredient_key', 'int', 'Ingredient.'),
    c('snapshot_date_key', 'int', 'Month-end snapshot date.'),
    c('opening_qty', 'double', 'Stock at start of month.', { summarize: 'none', format: '#,0.00' }),
    c('received_qty', 'double', 'Received from purchase orders.', { format: '#,0.00' }),
    c('used_qty', 'double', 'Consumed by sales (via recipes).', { format: '#,0.00' }),
    c('waste_qty', 'double', 'Written off (expired, spilled, unsold).', { format: '#,0.00' }),
    c('adjustment_qty', 'double', 'Stock-count adjustment (shrinkage − / found +).', { format: '#,0.00' }),
    c('closing_qty', 'double', 'Stock at end of month.', { summarize: 'none', format: '#,0.00' }),
    c('closing_value', 'decimal', 'closing_qty × unit cost.', { format: '$#,0.00', summarize: 'none' }),
    c('used_value', 'decimal', 'used_qty × unit cost.', { format: '$#,0.00' }),
    c('waste_value', 'decimal', 'waste_qty × unit cost.', { format: '$#,0.00' }),
    c('days_of_cover', 'double', 'Closing stock ÷ average daily usage.', { format: '0.0', summarize: 'none' })
  ],
  model: { name: 'Inventory' }
}

const factPo: TableSpec = {
  name: 'gold_fact_po_line',
  layer: 'gold',
  kind: 'fact',
  factType: 'accumulating snapshot',
  description: 'Purchase-order lines through their lifecycle (ordered → received → invoiced → paid) with one date key per milestone.',
  grain: 'One row per purchase-order line.',
  key: ['po_number', 'po_line'],
  fks: [
    { column: 'order_date_key', table: D, role: 'Order Date' },
    { column: 'received_date_key', table: D, role: 'Received Date', inactive: true, nullable: true },
    { column: 'paid_date_key', table: D, role: 'Paid Date', inactive: true, nullable: true },
    { column: 'store_key', table: 'gold_dim_store' },
    { column: 'supplier_key', table: 'gold_dim_supplier' },
    { column: 'ingredient_key', table: 'gold_dim_ingredient' }
  ],
  columns: [
    c('po_number', 'string', 'Purchase order number.'),
    c('po_line', 'int', 'Line number.', { summarize: 'none' }),
    c('store_key', 'int', 'Ordering store.'),
    c('supplier_key', 'int', 'Supplier.'),
    c('ingredient_key', 'int', 'Ingredient ordered.'),
    c('order_date_key', 'int', 'Order date (active relationship).'),
    c('expected_date_key', 'int', 'Promised delivery date.', { summarize: 'none' }),
    c('received_date_key', 'int', 'Delivery date (inactive relationship; blank until received).'),
    c('paid_date_key', 'int', 'Payment date (inactive relationship; blank until paid).'),
    c('ordered_qty', 'double', 'Quantity ordered.', { format: '#,0.00' }),
    c('received_qty', 'double', 'Quantity received.', { format: '#,0.00' }),
    c('unit_cost', 'decimal', 'Agreed unit cost (USD).', { format: '$#,0.00', summarize: 'none' }),
    c('line_amount', 'decimal', 'received (or ordered) qty × unit cost.', { format: '$#,0.00' }),
    c('lead_time_days', 'int', 'Days from order to delivery.', { summarize: 'average' }),
    c('days_late', 'int', 'Days delivered after the promised date (0 if on time).', { summarize: 'sum' }),
    c('is_on_time', 'bool', 'Delivered on or before the promised date.'),
    c('status', 'string', 'Ordered / Received / Paid.')
  ],
  model: { name: 'Purchase Orders' }
}

// ---------------------------------------------------------------------------------------------
// Silver

const silver = (name: string, description: string, grain: string, key: string[], columns: TableSpec['columns'], extra: Partial<TableSpec> = {}): TableSpec => ({
  name,
  layer: 'silver',
  kind: 'entity',
  description,
  grain,
  key,
  columns,
  ...extra
})

const silverTables: TableSpec[] = [
  silver('silver_stores', 'Cleaned store master (from the StarOps store API).', 'One row per store.', ['store_code'], [
    c('store_code', 'string', 'Store code (trimmed, upper-case).', { nullable: false }),
    c('store_name', 'string', 'Store name.'),
    c('store_format', 'string', 'Format.'),
    c('region', 'string', 'Region (title case).'),
    c('district', 'string', 'District.'),
    c('city', 'string', 'City.'),
    c('latitude', 'double', 'Latitude.'),
    c('longitude', 'double', 'Longitude.'),
    c('opened_date', 'date', 'Opening date.'),
    c('closed_date', 'date', 'Closing date.'),
    c('seats', 'int', 'Seats.'),
    c('square_feet', 'int', 'Square feet (missing values back-filled from format median).'),
    c('has_drive_thru', 'bool', 'Drive-thru lane.')
  ]),
  silver('silver_menu_items', 'Cleaned menu master (from the marketing Excel export).', 'One row per SKU.', ['sku'], [
    c('sku', 'string', 'SKU.', { nullable: false }),
    c('product_name', 'string', 'Name.'),
    c('category', 'string', 'Category (trimmed).'),
    c('subcategory', 'string', 'Subcategory.'),
    c('temperature', 'string', 'Hot / Cold / Food / Merch.'),
    c('list_price', 'decimal', 'Price parsed to a number.'),
    c('unit_cost', 'decimal', 'Standard cost.'),
    c('caffeine_mg', 'int', 'Caffeine mg.'),
    c('is_seasonal', 'bool', 'Seasonal item.'),
    c('launch_date', 'date', 'Launch date.')
  ]),
  silver('silver_ingredients', 'Ingredient master.', 'One row per ingredient.', ['ingredient_code'], [
    c('ingredient_code', 'string', 'Code.', { nullable: false }),
    c('ingredient_name', 'string', 'Name.'),
    c('ingredient_category', 'string', 'Category.'),
    c('unit_of_measure', 'string', 'Unit.'),
    c('unit_cost', 'decimal', 'Unit cost.'),
    c('pack_size', 'double', 'Units per pack.'),
    c('shelf_life_days', 'int', 'Shelf life.'),
    c('supplier_code', 'string', 'Preferred supplier.')
  ]),
  silver('silver_recipes', 'Recipe lines (semicolon-delimited kitchen-system export, parsed).', 'One row per SKU × ingredient.', ['sku', 'ingredient_code'], [
    c('sku', 'string', 'Menu SKU.'),
    c('ingredient_code', 'string', 'Ingredient.'),
    c('quantity_per_unit', 'double', 'Units per item sold.')
  ]),
  silver('silver_suppliers', 'Supplier master.', 'One row per supplier.', ['supplier_code'], [
    c('supplier_code', 'string', 'Code.'),
    c('supplier_name', 'string', 'Name.'),
    c('supplier_category', 'string', 'Category.'),
    c('city', 'string', 'City.'),
    c('payment_terms_days', 'int', 'Payment terms.'),
    c('contract_lead_time_days', 'int', 'Lead time.'),
    c('quality_rating', 'double', 'Rating.')
  ]),
  silver('silver_employee_snapshots', 'Month-end HR roster snapshots, de-duplicated with canonical dates — the input for the SCD2 employee dimension.', 'One row per employee per month-end snapshot.', ['snapshot_date', 'employee_id'], [
    c('snapshot_date', 'date', 'Snapshot (month-end) date.'),
    c('employee_id', 'string', 'Employee id.'),
    c('full_name', 'string', 'Name.'),
    c('role', 'string', 'Role.'),
    c('store_code', 'string', 'Home store.'),
    c('hourly_rate', 'decimal', 'Hourly rate.'),
    c('employment_type', 'string', 'Full-time / Part-time.'),
    c('employment_status', 'string', 'Active / Terminated.'),
    c('hire_date', 'date', 'Hire date (parsed from mixed formats).'),
    c('termination_date', 'date', 'Termination date.')
  ], { partitionByYearOf: 'snapshot_date' }),
  silver('silver_members', 'Loyalty members, de-duplicated (latest record wins).', 'One row per member.', ['member_id'], [
    c('member_id', 'string', 'Member id.'),
    c('tier', 'string', 'Tier (title case).'),
    c('join_date', 'date', 'Join date (parsed from mixed formats).'),
    c('join_channel', 'string', 'Channel.'),
    c('age_band', 'string', 'Age band.'),
    c('birth_month', 'int', 'Birth month.'),
    c('home_store_code', 'string', 'Home store.'),
    c('email', 'string', 'E-mail (blank = not provided).'),
    c('email_opt_in', 'bool', 'Consent.')
  ]),
  silver('silver_promotions', 'Promotion calendar.', 'One row per promotion.', ['promo_code'], [
    c('promo_code', 'string', 'Code.'),
    c('promotion_name', 'string', 'Name.'),
    c('promotion_type', 'string', 'Type.'),
    c('target_category', 'string', 'Category.'),
    c('discount_pct', 'double', 'Discount.'),
    c('start_date', 'date', 'Start.'),
    c('end_date', 'date', 'End.')
  ]),
  silver('silver_pos_transactions', 'POS transaction headers rebuilt from the daily line files (deduplicated, late rows merged into their real business date).', 'One row per transaction.', ['transaction_id'], [
    c('transaction_id', 'string', 'Transaction id.'),
    c('store_code', 'string', 'Store.'),
    c('sold_at', 'timestamp', 'Timestamp (store local time).'),
    c('business_date', 'date', 'Business date.'),
    c('member_id', 'string', 'Member (blank = guest).'),
    c('employee_id', 'string', 'Barista (column renamed from barista_id mid-history).'),
    c('payment_method', 'string', 'Payment method.'),
    c('order_channel', 'string', 'Channel.'),
    c('promo_code', 'string', 'Promotion applied.'),
    c('line_count', 'int', 'Number of lines.'),
    c('gross_amount', 'decimal', 'Sum of line gross.'),
    c('discount_amount', 'decimal', 'Sum of line discounts.'),
    c('net_amount', 'decimal', 'Sum of line net — equals the lines exactly.'),
    c('tip_amount', 'decimal', 'Tip (only captured after the POS upgrade).')
  ], { partitionByYearOf: 'business_date' }),
  silver('silver_pos_lines', 'POS line items (deduplicated; keying errors in quantity repaired from the line total).', 'One row per transaction line.', ['transaction_id', 'line_number'], [
    c('transaction_id', 'string', 'Transaction id.'),
    c('line_number', 'int', 'Line number.'),
    c('business_date', 'date', 'Business date.'),
    c('sku', 'string', 'SKU (unknown open-ring SKUs kept as-is).'),
    c('quantity', 'int', 'Quantity.'),
    c('unit_price', 'decimal', 'Unit price.'),
    c('discount_amount', 'decimal', 'Discount.'),
    c('net_amount', 'decimal', 'Line total.')
  ], { partitionByYearOf: 'business_date' }),
  silver('silver_weather_daily', 'Daily weather per city (sentinel -999 readings nulled).', 'One row per city per day.', ['city', 'observation_date'], [
    c('city', 'string', 'City.'),
    c('observation_date', 'date', 'Date.'),
    c('temp_max_c', 'double', 'High temperature °C.'),
    c('temp_min_c', 'double', 'Low temperature °C.'),
    c('precipitation_mm', 'double', 'Precipitation mm.'),
    c('condition', 'string', 'Condition.')
  ], { partitionByYearOf: 'observation_date' }),
  silver('silver_labor_daily', 'Worked hours and wages per store-day from the scheduling system.', 'One row per store per day.', ['store_code', 'work_date'], [
    c('store_code', 'string', 'Store.'),
    c('work_date', 'date', 'Date.'),
    c('crew_on_shift', 'int', 'Distinct crew members who worked.'),
    c('labor_hours', 'double', 'Worked hours.'),
    c('labor_cost', 'decimal', 'Wages.')
  ], { partitionByYearOf: 'work_date' }),
  silver('silver_purchase_orders', 'Purchase-order lines with their latest lifecycle state (dates normalised).', 'One row per PO line.', ['po_number', 'po_line'], [
    c('po_number', 'string', 'PO number.'),
    c('po_line', 'int', 'Line.'),
    c('store_code', 'string', 'Store.'),
    c('supplier_code', 'string', 'Supplier.'),
    c('ingredient_code', 'string', 'Ingredient.'),
    c('order_date', 'date', 'Ordered.'),
    c('expected_date', 'date', 'Promised.'),
    c('received_date', 'date', 'Received.'),
    c('paid_date', 'date', 'Paid.'),
    c('ordered_qty', 'double', 'Ordered qty.'),
    c('received_qty', 'double', 'Received qty.'),
    c('unit_cost', 'decimal', 'Unit cost.')
  ]),
  silver('silver_waste_log', 'Waste write-offs logged by crews.', 'One row per waste entry.', ['waste_id'], [
    c('waste_id', 'string', 'Entry id.'),
    c('store_code', 'string', 'Store.'),
    c('waste_date', 'date', 'Date.'),
    c('ingredient_code', 'string', 'Ingredient.'),
    c('quantity', 'double', 'Quantity.'),
    c('reason', 'string', 'Expired / Unsold / Spill / Quality.')
  ], { partitionByYearOf: 'waste_date' }),
  silver('silver_survey_responses', 'Guest survey responses (channel casing normalised).', 'One row per response.', ['response_id'], [
    c('response_id', 'string', 'Response id.'),
    c('store_code', 'string', 'Store.'),
    c('response_date', 'date', 'Date.'),
    c('transaction_id', 'string', 'Linked transaction.'),
    c('nps_score', 'int', '0-10 likelihood to recommend.'),
    c('channel', 'string', 'App / Receipt QR / Email.'),
    c('comment_topic', 'string', 'Main topic of the comment (blank = no comment).')
  ]),
  silver('silver_store_traffic_hourly', 'Door-counter readings (pilot started 90 days ago); negative glitches removed.', 'One row per store per hour.', ['store_code', 'count_hour'], [
    c('store_code', 'string', 'Store.'),
    c('count_hour', 'timestamp', 'Hour start.'),
    c('visitors', 'int', 'People counted entering.')
  ])
]

export const STARLITE_TABLES: TableSpec[] = [
  dimStore, dimProduct, dimIngredient, dimSupplier, dimEmployee, dimMember, dimPromotion, dimPayment, bridgeRecipe,
  factSales, factStoreDay, factInventory, factPo, ...silverTables
]

// ---------------------------------------------------------------------------------------------
// Bronze

export const STARLITE_SOURCES: BronzeSourceDoc[] = [
  { id: 'pos', system: 'OrbitPOS till export', pattern: 'pos/YYYY/MM/DD/pos_lines_YYYYMMDD.csv', format: 'csv', cadence: 'daily', description: 'Line-level till export with header fields repeated on every line. The POS upgrade renamed `barista_id` → `employee_id` and added `tip_amount`. Rows can land in a later day\'s file.' },
  { id: 'stores', system: 'StarOps store API', pattern: 'stores/stores_api_dump.json', format: 'json', cadence: 'snapshot', description: 'Paged REST response (envelope with `data` array).' },
  { id: 'menu', system: 'Marketing menu workbook', pattern: 'menu/menu_master.xlsx', format: 'xlsx', cadence: 'snapshot', description: 'Excel export with two title lines above the header; prices typed as text.' },
  { id: 'kitchen', system: 'GalleyBook recipe system', pattern: 'kitchen/{ingredients,recipes}.csv', format: 'csv', cadence: 'snapshot', description: 'Semicolon-delimited CSV with a UTF-8 BOM and CRLF line endings.' },
  { id: 'suppliers', system: 'ProcureNet', pattern: 'procurement/suppliers.csv', format: 'csv', cadence: 'snapshot', description: 'Supplier master.' },
  { id: 'purchase_orders', system: 'ProcureNet', pattern: 'procurement/YYYY/purchase_orders_YYYYMM.csv', format: 'csv', cadence: 'monthly', description: 'PO lines placed in the month, re-exported with their latest status.' },
  { id: 'hr', system: 'CrewDeck HR', pattern: 'hr/employees/employees_YYYYMM.csv', format: 'csv', cadence: 'monthly snapshot', description: 'Month-end roster snapshots — diff them to rebuild the SCD2 history.' },
  { id: 'labor', system: 'CrewDeck scheduling', pattern: 'hr/labor/labor_YYYYMM.csv', format: 'csv', cadence: 'monthly', description: 'Worked hours and wages per store-day.' },
  { id: 'loyalty', system: 'Starlite Stars CRM', pattern: 'loyalty/members_export.ndjson', format: 'ndjson', cadence: 'snapshot', description: 'Newline-delimited JSON member export.' },
  { id: 'promotions', system: 'Marketing calendar', pattern: 'marketing/promotions.json', format: 'json', cadence: 'snapshot', description: 'Promotion calendar.' },
  { id: 'weather', system: 'SkyLedger weather API', pattern: 'weather/YYYY/weather_YYYYMM.json', format: 'json', cadence: 'monthly', description: 'Daily observations per city wrapped in an API envelope.' },
  { id: 'inventory', system: 'GalleyBook stock', pattern: 'inventory/YYYY/{stock_counts,waste_log}_YYYYMM.csv', format: 'csv', cadence: 'monthly', description: 'Month-end stock counts and the crew waste log.' },
  { id: 'surveys', system: 'GuestPulse surveys', pattern: 'surveys/YYYY/responses_YYYYMM.ndjson', format: 'ndjson', cadence: 'monthly', description: 'Survey responses with nested `answers` object.' },
  { id: 'traffic', system: 'BeamCount door counters', pattern: 'traffic/YYYY/MM/DD/door_counts_YYYYMMDD.csv', format: 'csv', cadence: 'daily (pilot, last 90 days)', description: 'Hourly people counts per store.' }
]

export const STARLITE_ISSUES: IssueDoc[] = [
  { code: 'SL01', kind: 'duplicates', source: 'pos', description: 'Till re-sends: some lines appear twice (exact duplicates).', fix: 'Drop exact duplicates on (transaction_id, line_number).' },
  { code: 'SL02', kind: 'late_arriving', source: 'pos', column: 'sold_at', dateColumn: 'sold_at', description: 'Offline tills sync late: lines land 2-6 days after their sale.', fix: 'Union all daily files and use sold_at (not the file date) as the business date.' },
  { code: 'SL03', kind: 'casing', source: 'pos', column: 'store_code', description: 'store_code typed in mixed case by older tills ("sl-004").', fix: 'UPPER(TRIM(store_code)).' },
  { code: 'SL04', kind: 'whitespace', source: 'pos', column: 'sku', description: 'Leading/trailing spaces and tabs around SKUs.', fix: 'TRIM before joining to the menu.' },
  { code: 'SL05', kind: 'orphan_keys', source: 'pos', column: 'sku', ref: { table: 'silver_menu_items', column: 'sku' }, description: 'Open-ring and retired test SKUs that are not in the menu master.', fix: 'Keep the line; map to product_key -1 (Unknown) in gold.' },
  { code: 'SL06', kind: 'outliers', source: 'pos', column: 'qty', rule: 'extreme', description: 'Fat-finger quantities (×100) on a few lines; the line_total is still right.', fix: 'Recompute quantity = line_total ÷ unit_price when it disagrees.' },
  { code: 'SL07', kind: 'schema_drift', source: 'pos', description: 'POS upgrade: barista_id renamed to employee_id and a tip_amount column appears.', fix: 'Coalesce barista_id/employee_id; default tip_amount to null before the upgrade.' },
  { code: 'SL08', kind: 'formatted_numbers', source: 'menu', column: 'Price', description: 'Prices typed as text ("$4.50", "4,50", "4.50 USD").', fix: 'Strip currency symbols/codes and parse with the right decimal separator.' },
  { code: 'SL09', kind: 'nulls', source: 'stores', column: 'sq_ft', description: 'Missing floor area for some stores.', fix: 'Back-fill from the median of the same store format.' },
  { code: 'SL10', kind: 'casing', source: 'stores', column: 'region', description: 'Region names in inconsistent case.', fix: 'Title-case the region.' },
  { code: 'SL11', kind: 'mixed_date_formats', source: 'hr', column: 'hire_date', description: 'hire_date in ISO, US (m/d/yyyy), EU (dd.mm.yyyy) and "Mon d, yyyy" formats.', fix: 'Parse with a format list (try ISO, then US, EU, long).' },
  { code: 'SL12', kind: 'duplicates', source: 'loyalty', description: 'CRM export contains some members twice.', fix: 'Deduplicate on member_id.' },
  { code: 'SL13', kind: 'nulls', source: 'loyalty', column: 'email', description: 'E-mail blank or literally "NULL" / "n/a".', fix: 'Normalise placeholders to null.' },
  { code: 'SL14', kind: 'mixed_date_formats', source: 'loyalty', column: 'join_date', description: 'join_date in several formats incl. Unix epoch seconds.', fix: 'Parse each format; epoch = seconds since 1970-01-01.' },
  { code: 'SL15', kind: 'sentinel_values', source: 'weather', column: 'temp_max_c', sentinels: ['-999'], description: 'Missing readings sent as -999.', fix: 'Replace -999 with null (or interpolate).' },
  { code: 'SL16', kind: 'mixed_date_formats', source: 'purchase_orders', column: 'received_date', description: 'Supplier-portal dates in EU format next to ISO dates.', fix: 'Parse both formats.' },
  { code: 'SL17', kind: 'casing', source: 'surveys', column: 'channel', description: 'Channel names in mixed case ("APP", "receipt qr").', fix: 'Map to canonical channel names.' },
  { code: 'SL18', kind: 'outliers', source: 'traffic', column: 'people_in', rule: 'negative', description: 'Door-counter glitches report negative counts.', fix: 'Treat negatives as missing.' }
]

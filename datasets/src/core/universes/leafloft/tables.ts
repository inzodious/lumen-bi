/**
 * Leafloft Vertical Farms — table specifications (silver + gold), bronze sources and planted issues.
 */
import { c } from '../../schema.ts'
import type { BronzeSourceDoc, IssueDoc, TableSpec } from '../../schema.ts'

const D = 'gold_dim_date'

// ---------------------------------------------------------------------------------------------
// Gold dimensions

const dimFarm: TableSpec = {
  name: 'gold_dim_farm',
  layer: 'gold',
  kind: 'dim',
  description: 'Vertical farms (converted warehouses and one former parking garage).',
  grain: 'One row per farm.',
  key: ['farm_key'],
  columns: [
    c('farm_key', 'int', 'Surrogate key.'),
    c('farm_code', 'string', 'Business key, e.g. "FM-02".', { nullable: false }),
    c('farm_name', 'string', 'Farm name.'),
    c('city', 'string', 'City (fictional).', { category: 'City' }),
    c('region', 'string', 'Region.'),
    c('latitude', 'double', 'Latitude (fictional placement).', { category: 'Latitude', summarize: 'none', format: '0.0000' }),
    c('longitude', 'double', 'Longitude (fictional placement).', { category: 'Longitude', summarize: 'none', format: '0.0000' }),
    c('opened_date', 'date', 'First seeding date.'),
    c('floor_area_m2', 'int', 'Building floor area (m²).', { summarize: 'none', label: 'Floor Area m²' }),
    c('energy_source', 'string', 'Grid / Grid + Rooftop Solar.'),
    c('is_flagship', 'bool', 'The original farm.')
  ],
  model: { name: 'Farm' }
}

const dimRoom: TableSpec = {
  name: 'gold_dim_room',
  layer: 'gold',
  kind: 'dim',
  description: 'Climate-controlled grow rooms inside each farm.',
  grain: 'One row per grow room.',
  key: ['room_key'],
  fks: [{ column: 'farm_key', table: 'gold_dim_farm' }],
  columns: [
    c('room_key', 'int', 'Surrogate key.'),
    c('room_code', 'string', 'Business key, e.g. "FM-02-R3".', { nullable: false }),
    c('room_name', 'string', 'Room name.'),
    c('farm_key', 'int', 'Farm (snowflaked to Farm).'),
    c('farm_name', 'string', 'Farm name (denormalised for the hierarchy).'),
    c('room_type', 'string', 'Microgreens / Leafy & Herbs / Fruiting.'),
    c('rack_count', 'int', 'Racks installed.', { summarize: 'none' }),
    c('hvac_unit', 'string', 'HVAC unit model (fictional).'),
    c('temp_setpoint_c', 'double', 'Day-time temperature setpoint (°C).', { summarize: 'none', format: '0.0', label: 'Temp Setpoint °C' })
  ],
  model: { name: 'Room', hierarchies: [{ name: 'Farm Layout', levels: ['farm_name', 'room_name'] }] }
}

const dimRack: TableSpec = {
  name: 'gold_dim_rack',
  layer: 'gold',
  kind: 'dim',
  description: 'Grow racks with configuration history (SCD Type 2): LED retrofits, extra tiers and irrigation swaps open new versions.',
  grain: 'One row per rack configuration version.',
  key: ['rack_sk'],
  scd2: { businessKey: 'rack_id', from: 'valid_from', to: 'valid_to', current: 'is_current' },
  columns: [
    c('rack_sk', 'int', 'Surrogate key of the version.'),
    c('rack_id', 'string', 'Business key, e.g. "FM-01-R2-K05".'),
    c('farm_name', 'string', 'Farm.'),
    c('room_name', 'string', 'Room.'),
    c('rack_name', 'string', 'Rack label.'),
    c('light_type', 'string', 'LED Gen1 / LED Gen2.'),
    c('tiers', 'int', 'Growing tiers.', { summarize: 'none' }),
    c('growing_area_m2', 'double', 'Canopy area across tiers (m²).', { summarize: 'none', format: '0.0', label: 'Growing Area m²' }),
    c('irrigation_system', 'string', 'NFT / Deep Water / Aeroponic / Flood Tray.'),
    c('light_kw_per_tier', 'double', 'Lighting load per tier (kW).', { summarize: 'none', format: '0.00' }),
    c('valid_from', 'date', 'Version start (inclusive).', { folder: 'SCD2' }),
    c('valid_to', 'date', 'Version end (inclusive; 9999-12-31 = open).', { folder: 'SCD2' }),
    c('is_current', 'bool', 'Current version flag.', { folder: 'SCD2' }),
    c('version', 'int', 'Version number per rack.', { folder: 'SCD2', summarize: 'none' })
  ],
  model: { name: 'Rack', hierarchies: [{ name: 'Rack Layout', levels: ['farm_name', 'room_name', 'rack_name'] }] }
}

const dimCrop: TableSpec = {
  name: 'gold_dim_crop',
  layer: 'gold',
  kind: 'dim',
  description: 'Crop varieties with grow recipe targets.',
  grain: 'One row per variety.',
  key: ['crop_key'],
  columns: [
    c('crop_key', 'int', 'Surrogate key.'),
    c('crop_code', 'string', 'Business key, e.g. "CR-104".'),
    c('variety', 'string', 'Variety name (fictional cultivar).'),
    c('crop', 'string', 'Crop, e.g. Lettuce, Basil.'),
    c('crop_category', 'string', 'Leafy Greens / Herbs / Microgreens / Fruiting.'),
    c('germination_days', 'int', 'Days from seeding to germination.', { summarize: 'none' }),
    c('grow_days', 'int', 'Planned days from seeding to harvest.', { summarize: 'none' }),
    c('target_yield_kg_m2', 'double', 'Target yield per m² of canopy per cycle.', { summarize: 'none', format: '0.00', label: 'Target Yield kg/m²' }),
    c('price_per_kg', 'decimal', 'Internal transfer price (USD/kg).', { summarize: 'none', format: '$#,0.00' }),
    c('heat_sensitive', 'bool', 'Bolts or tip-burns when rooms run hot.')
  ],
  model: { name: 'Crop', hierarchies: [{ name: 'Crop Hierarchy', levels: ['crop_category', 'crop', 'variety'] }] }
}

const dimCustomer: TableSpec = {
  name: 'gold_dim_customer',
  layer: 'gold',
  kind: 'dim',
  description: 'Box subscribers: households, offices and restaurants.',
  grain: 'One row per customer.',
  key: ['customer_key'],
  columns: [
    c('customer_key', 'int', 'Surrogate key.'),
    c('customer_id', 'string', 'Business key, e.g. "C-004211".'),
    c('customer_name', 'string', 'Name (fictional).'),
    c('customer_type', 'string', 'Household / Office / Restaurant.'),
    c('delivery_zone', 'string', 'Delivery zone.'),
    c('city', 'string', 'City (fictional).', { category: 'City' }),
    c('acquisition_channel', 'string', 'Organic Search / Referral / Social Ads / Influencer / Farmers Market / Partner Grocery.'),
    c('signup_date', 'date', 'First subscription start.'),
    c('cohort_month', 'string', 'Signup cohort, e.g. "2025-03".', { sortBy: 'cohort_month_key' }),
    c('cohort_month_key', 'int', 'Sortable cohort yyyymm.', { hidden: true })
  ],
  model: { name: 'Customer' }
}

const dimPlan: TableSpec = {
  name: 'gold_dim_plan',
  layer: 'gold',
  kind: 'dim',
  description: 'Box subscription plans (size × frequency) with current pricing.',
  grain: 'One row per plan.',
  key: ['plan_key'],
  columns: [
    c('plan_key', 'int', 'Surrogate key.'),
    c('plan_code', 'string', 'Business key, e.g. "PL-CAN-W".'),
    c('plan_name', 'string', 'Plan name.', { sortBy: 'plan_rank' }),
    c('plan_rank', 'int', 'Plan order (small → large).', { hidden: true }),
    c('box_size', 'string', 'S / M / L / XL.'),
    c('frequency', 'string', 'Weekly / Biweekly.'),
    c('boxes_per_month', 'double', 'Average boxes per month (52/12 or 26/12).', { summarize: 'none', format: '0.00' }),
    c('launch_price_per_box', 'decimal', 'Price per box at launch.', { summarize: 'none', format: '$#,0.00' }),
    c('price_per_box', 'decimal', 'Current price per box (after the price rise).', { summarize: 'none', format: '$#,0.00' }),
    c('monthly_price', 'decimal', 'Current MRR contribution of the plan.', { summarize: 'none', format: '$#,0.00' })
  ],
  model: { name: 'Plan' }
}

const dimSubscription: TableSpec = {
  name: 'gold_dim_subscription',
  layer: 'gold',
  kind: 'dim',
  description: 'Subscriptions with their current state. Offices and restaurants may hold several.',
  grain: 'One row per subscription.',
  key: ['subscription_key'],
  columns: [
    c('subscription_key', 'int', 'Surrogate key.'),
    c('subscription_id', 'string', 'Business key, e.g. "S-0012345".'),
    c('customer_id', 'string', 'Owning customer (business key; filter customers through the facts).'),
    c('start_date', 'date', 'Original start date.'),
    c('churn_date', 'date', 'Latest churn date (blank if active or paused).'),
    c('status', 'string', 'Active / Paused / Churned.'),
    c('current_plan', 'string', 'Plan today (or at churn).'),
    c('churn_reason', 'string', 'Reason given at the latest churn.'),
    c('signup_promo', 'string', 'Signup promotion code (blank = none).'),
    c('times_reactivated', 'int', 'Win-backs after churn.', { summarize: 'sum' })
  ],
  model: { name: 'Subscription' }
}

const dimAddon: TableSpec = {
  name: 'gold_dim_addon',
  layer: 'gold',
  kind: 'dim',
  description: 'Optional add-ons a subscriber can attach to the box.',
  grain: 'One row per add-on.',
  key: ['addon_key'],
  columns: [
    c('addon_key', 'int', 'Surrogate key.'),
    c('addon_code', 'string', 'Business key.'),
    c('addon_name', 'string', 'Add-on name.'),
    c('addon_category', 'string', 'Grown In-House / Partner Product.'),
    c('monthly_price', 'decimal', 'MRR contribution (USD per month).', { summarize: 'none', format: '$#,0.00' })
  ],
  model: { name: 'Add-on' }
}

const bridgeAddon: TableSpec = {
  name: 'gold_bridge_subscription_addon',
  layer: 'gold',
  kind: 'bridge',
  description: 'Many-to-many bridge: which add-ons each subscription has had (attach/detach history).',
  grain: 'One row per subscription × add-on × attach date.',
  key: ['subscription_key', 'addon_key', 'added_date'],
  fks: [
    { column: 'subscription_key', table: 'gold_dim_subscription', bidirectional: true },
    { column: 'addon_key', table: 'gold_dim_addon' }
  ],
  columns: [
    c('subscription_key', 'int', 'Subscription.'),
    c('addon_key', 'int', 'Add-on.'),
    c('added_date', 'date', 'Attached on.'),
    c('removed_date', 'date', 'Detached on (blank = still attached).'),
    c('is_active', 'bool', 'Currently attached.')
  ],
  model: { name: 'Subscription Add-on' }
}

// ---------------------------------------------------------------------------------------------
// Gold facts

const factEnv: TableSpec = {
  name: 'gold_fact_room_env_day',
  layer: 'gold',
  kind: 'fact',
  factType: 'periodic snapshot',
  description: 'Daily climate & energy per grow room, aggregated from the 4-hourly sensor readings in silver.',
  grain: 'One row per grow room per day (from the day the farm opened).',
  key: ['room_key', 'date_key'],
  partitionByYearOf: 'reading_date',
  fks: [
    { column: 'date_key', table: D },
    { column: 'room_key', table: 'gold_dim_room' }
  ],
  columns: [
    c('room_key', 'int', 'Room.'),
    c('date_key', 'int', 'Day.'),
    c('reading_date', 'date', 'Day (partition source).', { exclude: true }),
    c('readings_count', 'int', 'Valid 4-hour readings (max 6).'),
    c('missing_readings', 'int', 'Readings dropped as sentinel / glitch values.'),
    c('avg_temp_c', 'double', 'Average air temperature (°C).', { summarize: 'average', format: '0.0', folder: 'Climate', label: 'Avg Temp °C' }),
    c('min_temp_c', 'double', 'Lowest reading (°C).', { summarize: 'min', format: '0.0', folder: 'Climate', label: 'Min Temp °C' }),
    c('max_temp_c', 'double', 'Highest reading (°C).', { summarize: 'max', format: '0.0', folder: 'Climate', label: 'Max Temp °C' }),
    c('avg_humidity_pct', 'double', 'Average relative humidity (%).', { summarize: 'average', format: '0.0', folder: 'Climate' }),
    c('avg_co2_ppm', 'double', 'Average CO2 (ppm) as reported by the sensor.', { summarize: 'average', format: '#,0', folder: 'Climate' }),
    c('avg_ppfd', 'double', 'Average photosynthetic photon flux density (µmol/m²/s).', { summarize: 'average', format: '#,0', folder: 'Light', label: 'Avg PPFD' }),
    c('dli_mol_m2', 'double', 'Daily light integral (mol/m²/day).', { summarize: 'average', format: '0.0', folder: 'Light', label: 'DLI mol/m²' }),
    c('avg_ph', 'double', 'Nutrient solution pH.', { summarize: 'average', format: '0.00', folder: 'Nutrients' }),
    c('avg_ec', 'double', 'Nutrient electrical conductivity (mS/cm).', { summarize: 'average', format: '0.00', folder: 'Nutrients' }),
    c('energy_kwh', 'double', 'Metered energy (lights + HVAC), kWh.', { format: '#,0.0', folder: 'Energy' }),
    c('energy_cost', 'decimal', 'energy_kwh × the farm\'s monthly tariff.', { format: '$#,0.00', folder: 'Energy' }),
    c('alert_count', 'int', 'Readings outside the climate band (16-26 °C, 50-85 % RH).'),
    c('is_hvac_fault', 'bool', 'HVAC fault logged by maintenance that day.')
  ],
  model: { name: 'Room Climate' }
}

const factBatch: TableSpec = {
  name: 'gold_fact_grow_batch',
  layer: 'gold',
  kind: 'fact',
  factType: 'accumulating snapshot',
  description: 'Grow batches through their lifecycle (seeded → germinated → transplanted → harvested / failed) with one date key per milestone. State as of "today".',
  grain: 'One row per grow batch.',
  key: ['batch_id'],
  partitionByYearOf: 'seeded_date',
  fks: [
    { column: 'seeded_date_key', table: D, role: 'Seeded Date' },
    { column: 'germinated_date_key', table: D, role: 'Germinated Date', inactive: true, nullable: true },
    { column: 'transplanted_date_key', table: D, role: 'Transplanted Date', inactive: true, nullable: true },
    { column: 'harvest_date_key', table: D, role: 'Harvest Date', inactive: true, nullable: true },
    { column: 'rack_sk', table: 'gold_dim_rack' },
    { column: 'room_key', table: 'gold_dim_room' },
    { column: 'crop_key', table: 'gold_dim_crop' }
  ],
  columns: [
    c('batch_id', 'string', 'Batch id, e.g. "B-24-000123".'),
    c('rack_sk', 'int', 'Rack configuration in effect at seeding (SCD2).'),
    c('room_key', 'int', 'Room.'),
    c('crop_key', 'int', 'Variety.'),
    c('seeded_date', 'date', 'Seeding date (partition source).', { exclude: true }),
    c('seeded_date_key', 'int', 'Seeded (active relationship).'),
    c('germinated_date_key', 'int', 'Germinated (inactive).'),
    c('transplanted_date_key', 'int', 'Moved to the grow rack (inactive; blank for microgreens).'),
    c('planned_harvest_date_key', 'int', 'Planned harvest date.', { summarize: 'none' }),
    c('harvest_date_key', 'int', 'Actual harvest (inactive; blank until harvested).'),
    c('trays', 'int', 'Trays in the batch.'),
    c('growing_area_m2', 'double', 'Canopy area (m²).', { format: '#,0.0', label: 'Growing Area m²' }),
    c('target_yield_kg', 'double', 'Target harvest weight (kg).', { format: '#,0.0' }),
    c('harvested_kg', 'double', 'Harvested weight (kg) — equals the weigh-ins.', { format: '#,0.0' }),
    c('yield_vs_target', 'double', 'harvested ÷ target (harvested batches).', { summarize: 'none', format: '0.0%' }),
    c('days_to_harvest', 'int', 'Seeding to harvest (days).', { summarize: 'average' }),
    c('harvest_value', 'decimal', 'harvested_kg × price per kg.', { format: '$#,0.00' }),
    c('status', 'string', 'Growing / Harvested / Failed.'),
    c('failure_reason', 'string', 'Why the batch was discarded (blank otherwise).')
  ],
  model: { name: 'Grow Batch' }
}

const factMrr: TableSpec = {
  name: 'gold_fact_subscription_month',
  layer: 'gold',
  kind: 'fact',
  factType: 'periodic snapshot',
  description: 'Monthly MRR movement per subscription. Bridges exactly: opening + new + expansion + reactivation − contraction − churned = closing.',
  grain: 'One row per subscription per month in which it was live or paused.',
  key: ['subscription_key', 'month_date_key'],
  partitionByYearOf: 'snapshot_date',
  fks: [
    { column: 'month_date_key', table: D, role: 'Snapshot Month End' },
    { column: 'cohort_date_key', table: D, role: 'Cohort Month', inactive: true },
    { column: 'subscription_key', table: 'gold_dim_subscription' },
    { column: 'customer_key', table: 'gold_dim_customer' },
    { column: 'plan_key', table: 'gold_dim_plan' }
  ],
  columns: [
    c('subscription_key', 'int', 'Subscription.'),
    c('customer_key', 'int', 'Customer.'),
    c('plan_key', 'int', 'Plan at month end.'),
    c('month_date_key', 'int', 'Snapshot date: month end (or today for the current month).'),
    c('cohort_date_key', 'int', 'First day of the signup cohort month (inactive).'),
    c('snapshot_date', 'date', 'Snapshot date (partition source).', { exclude: true }),
    c('tenure_month', 'int', 'Months since the cohort month (0 = signup month).', { summarize: 'none' }),
    c('opening_mrr', 'decimal', 'MRR at the start of the month.', { format: '$#,0.00', folder: 'MRR Bridge' }),
    c('new_mrr', 'decimal', 'MRR from first-time starts.', { format: '$#,0.00', folder: 'MRR Bridge' }),
    c('expansion_mrr', 'decimal', 'Upgrades, add-ons and price rises.', { format: '$#,0.00', folder: 'MRR Bridge' }),
    c('reactivation_mrr', 'decimal', 'Resumed pauses and win-backs.', { format: '$#,0.00', folder: 'MRR Bridge' }),
    c('contraction_mrr', 'decimal', 'Downgrades, removed add-ons and pauses.', { format: '$#,0.00', folder: 'MRR Bridge' }),
    c('churned_mrr', 'decimal', 'MRR lost to cancellations.', { format: '$#,0.00', folder: 'MRR Bridge' }),
    c('closing_mrr', 'decimal', 'MRR at month end (semi-additive: do not sum over time).', { format: '$#,0.00', summarize: 'none', folder: 'MRR Bridge' }),
    c('is_active_end', 'bool', 'Paying at month end.'),
    c('status_end', 'string', 'Active / Paused / Churned at month end.')
  ],
  model: { name: 'Subscription MRR' }
}

const factDelivery: TableSpec = {
  name: 'gold_fact_delivery',
  layer: 'gold',
  kind: 'fact',
  factType: 'transaction',
  description: 'Box deliveries (and skipped / failed drops) with billed amounts.',
  grain: 'One row per scheduled box drop.',
  key: ['delivery_id'],
  partitionByYearOf: 'delivery_date',
  fks: [
    { column: 'delivery_date_key', table: D },
    { column: 'subscription_key', table: 'gold_dim_subscription' },
    { column: 'customer_key', table: 'gold_dim_customer' },
    { column: 'plan_key', table: 'gold_dim_plan' },
    { column: 'farm_key', table: 'gold_dim_farm' }
  ],
  columns: [
    c('delivery_id', 'string', 'Drop id.'),
    c('delivery_date', 'date', 'Drop date (partition source).', { exclude: true }),
    c('delivery_date_key', 'int', 'Drop date.'),
    c('subscription_key', 'int', 'Subscription.'),
    c('customer_key', 'int', 'Customer.'),
    c('plan_key', 'int', 'Plan at the time of the drop.'),
    c('farm_key', 'int', 'Fulfilling farm.'),
    c('status', 'string', 'Delivered / Skipped / Failed.'),
    c('is_on_time', 'bool', 'Delivered inside the promised window.'),
    c('box_value', 'decimal', 'Box price.', { format: '$#,0.00' }),
    c('addon_value', 'decimal', 'Add-ons billed with this box.', { format: '$#,0.00' }),
    c('delivery_fee', 'decimal', 'Delivery fee.', { format: '$#,0.00' }),
    c('discount_amount', 'decimal', 'Signup promotion discount.', { format: '$#,0.00' }),
    c('net_amount', 'decimal', 'box + add-ons + fee − discount (0 when skipped or failed).', { format: '$#,0.00' }),
    c('weight_kg', 'double', 'Packed weight.', { format: '#,0.0' }),
    c('items_count', 'int', 'Produce items in the box.')
  ],
  model: { name: 'Deliveries' }
}

// ---------------------------------------------------------------------------------------------
// Silver

const silver = (name: string, description: string, grain: string, key: string[], columns: TableSpec['columns'], extra: Partial<TableSpec> = {}): TableSpec => ({
  name, layer: 'silver', kind: 'entity', description, grain, key, columns, ...extra
})

const silverTables: TableSpec[] = [
  silver('silver_farms', 'Farm master.', 'One row per farm.', ['farm_code'], [
    c('farm_code', 'string', 'Farm code.', { nullable: false }),
    c('farm_name', 'string', 'Name.'),
    c('city', 'string', 'City.'),
    c('region', 'string', 'Region.'),
    c('latitude', 'double', 'Latitude.'),
    c('longitude', 'double', 'Longitude.'),
    c('opened_date', 'date', 'Opened.'),
    c('floor_area_m2', 'int', 'Floor area.'),
    c('energy_source', 'string', 'Energy source.')
  ]),
  silver('silver_rooms', 'Grow rooms.', 'One row per room.', ['room_code'], [
    c('room_code', 'string', 'Room code.', { nullable: false }),
    c('farm_code', 'string', 'Farm.'),
    c('room_name', 'string', 'Name.'),
    c('room_type', 'string', 'Type.'),
    c('hvac_unit', 'string', 'HVAC unit.'),
    c('temp_setpoint_c', 'double', 'Setpoint.')
  ]),
  silver('silver_rack_config_history', 'Rack configuration changes from the asset registry (light_type casing normalised). Input for the SCD2 rack dimension.', 'One row per rack configuration change.', ['rack_id', 'effective_date'], [
    c('rack_id', 'string', 'Rack id.'),
    c('room_code', 'string', 'Room.'),
    c('effective_date', 'date', 'Configuration effective from.'),
    c('light_type', 'string', 'Light type.'),
    c('tiers', 'int', 'Tiers.'),
    c('growing_area_m2', 'double', 'Area.'),
    c('irrigation_system', 'string', 'Irrigation.')
  ]),
  silver('silver_crops', 'Crop plan (parsed from the agronomy workbook; prices parsed to numbers).', 'One row per variety.', ['crop_code'], [
    c('crop_code', 'string', 'Code.'),
    c('variety', 'string', 'Variety (trimmed).'),
    c('crop', 'string', 'Crop.'),
    c('crop_category', 'string', 'Category.'),
    c('germination_days', 'int', 'Germination days.'),
    c('grow_days', 'int', 'Grow days.'),
    c('target_yield_kg_m2', 'double', 'Target yield.'),
    c('price_per_kg', 'decimal', 'Price per kg.')
  ]),
  silver('silver_customers', 'CRM customers (names trimmed, phone placeholders nulled).', 'One row per customer.', ['customer_id'], [
    c('customer_id', 'string', 'Customer id.'),
    c('customer_name', 'string', 'Name.'),
    c('customer_type', 'string', 'Type.'),
    c('email', 'string', 'E-mail.'),
    c('phone', 'string', 'Phone (blank = not provided).'),
    c('delivery_zone', 'string', 'Zone.'),
    c('city', 'string', 'City.'),
    c('acquisition_channel', 'string', 'Channel.'),
    c('signup_date', 'date', 'Signup date.')
  ]),
  silver('silver_plans', 'Plan catalog with price history (launch and current).', 'One row per plan.', ['plan_code'], [
    c('plan_code', 'string', 'Code.'),
    c('plan_name', 'string', 'Name.'),
    c('box_size', 'string', 'Size.'),
    c('frequency', 'string', 'Frequency.'),
    c('launch_price_per_box', 'decimal', 'Launch price.'),
    c('price_per_box', 'decimal', 'Current price.'),
    c('price_change_date', 'date', 'Date of the price rise.')
  ]),
  silver('silver_addons', 'Add-on catalog.', 'One row per add-on.', ['addon_code'], [
    c('addon_code', 'string', 'Code.'),
    c('addon_name', 'string', 'Name.'),
    c('addon_category', 'string', 'Category.'),
    c('monthly_price', 'decimal', 'Monthly price.')
  ]),
  silver('silver_subscriptions', 'Subscriptions with current state (rebuilt from the event stream).', 'One row per subscription.', ['subscription_id'], [
    c('subscription_id', 'string', 'Subscription id.'),
    c('customer_id', 'string', 'Customer.'),
    c('start_date', 'date', 'Start.'),
    c('status', 'string', 'Status.'),
    c('plan_code', 'string', 'Current plan.'),
    c('current_mrr', 'decimal', 'MRR today.'),
    c('churn_date', 'date', 'Latest churn.'),
    c('churn_reason', 'string', 'Reason.'),
    c('signup_promo', 'string', 'Promo.')
  ]),
  silver('silver_subscription_events', 'Billing lifecycle events (webhook retries removed, types upper-cased consistently, timestamps parsed; cents → dollars).', 'One row per event.', ['event_id'], [
    c('event_id', 'string', 'Event id.'),
    c('subscription_id', 'string', 'Subscription.'),
    c('event_type', 'string', 'start / upgrade / downgrade / addon_added / addon_removed / pause / resume / churn / reactivate / price_change.'),
    c('occurred_at', 'timestamp', 'When.'),
    c('plan_code', 'string', 'Plan after the event.'),
    c('mrr_before', 'decimal', 'MRR before.'),
    c('mrr_after', 'decimal', 'MRR after.'),
    c('reason', 'string', 'Reason (churn / pause).')
  ], { partitionByYearOf: 'occurred_at' }),
  silver('silver_subscription_addons', 'Add-on attach/detach history.', 'One row per subscription × add-on × attach date.', ['subscription_id', 'addon_code', 'added_date'], [
    c('subscription_id', 'string', 'Subscription.'),
    c('addon_code', 'string', 'Add-on.'),
    c('added_date', 'date', 'Attached.'),
    c('removed_date', 'date', 'Detached.')
  ]),
  silver('silver_deliveries', 'Courier manifests merged across late files; status casing normalised.', 'One row per drop.', ['delivery_id'], [
    c('delivery_id', 'string', 'Drop id.'),
    c('subscription_id', 'string', 'Subscription.'),
    c('customer_id', 'string', 'Customer.'),
    c('plan_code', 'string', 'Plan.'),
    c('farm_code', 'string', 'Farm.'),
    c('scheduled_date', 'date', 'Scheduled date.'),
    c('delivered_at', 'timestamp', 'Delivered (blank if skipped / failed).'),
    c('status', 'string', 'Status.'),
    c('box_value', 'decimal', 'Box.'),
    c('addon_value', 'decimal', 'Add-ons.'),
    c('delivery_fee', 'decimal', 'Fee.'),
    c('discount_amount', 'decimal', 'Discount.'),
    c('net_amount', 'decimal', 'Net.'),
    c('weight_kg', 'double', 'Weight.'),
    c('items_count', 'int', 'Items.')
  ], { partitionByYearOf: 'scheduled_date' }),
  silver('silver_sensor_readings', 'Room telemetry at 4-hour resolution: deduplicated, late readings merged, sentinel temperatures and negative meter deltas nulled, renamed firmware fields coalesced.', 'One row per room per 4-hour slot.', ['room_code', 'reading_ts'], [
    c('room_code', 'string', 'Room.'),
    c('reading_ts', 'timestamp', 'Slot start.'),
    c('temp_c', 'double', 'Temperature °C (null = sentinel).'),
    c('humidity_pct', 'double', 'Relative humidity %.'),
    c('co2_ppm', 'double', 'CO2 ppm.'),
    c('ppfd', 'double', 'PPFD µmol/m²/s.'),
    c('ph', 'double', 'pH.'),
    c('ec', 'double', 'EC mS/cm.'),
    c('energy_kwh', 'double', 'Energy in the slot (null = meter rollover glitch).'),
    c('vpd_kpa', 'double', 'Vapour-pressure deficit (only after the firmware update).')
  ], { partitionByYearOf: 'reading_ts' }),
  silver('silver_grow_batches', 'Grow batches from the MES export (dates normalised).', 'One row per batch.', ['batch_id'], [
    c('batch_id', 'string', 'Batch id.'),
    c('rack_id', 'string', 'Rack.'),
    c('crop_code', 'string', 'Variety.'),
    c('seeded_date', 'date', 'Seeded.'),
    c('germinated_date', 'date', 'Germinated.'),
    c('transplanted_date', 'date', 'Transplanted.'),
    c('planned_harvest_date', 'date', 'Planned harvest.'),
    c('harvest_date', 'date', 'Harvested.'),
    c('trays', 'int', 'Trays.'),
    c('status', 'string', 'Status.'),
    c('failure_reason', 'string', 'Failure reason.'),
    c('harvested_kg', 'double', 'Harvested kg (= Σ weigh-ins).')
  ], { partitionByYearOf: 'seeded_date' }),
  silver('silver_harvest_weighins', 'Harvest bin weigh-ins (test scans with unknown batch ids dropped; grams → kg).', 'One row per weighed bin.', ['bin_id'], [
    c('bin_id', 'string', 'Bin id.'),
    c('batch_id', 'string', 'Batch.'),
    c('weighed_at', 'timestamp', 'Weighed at.'),
    c('net_kg', 'double', 'Net weight kg.')
  ], { partitionByYearOf: 'weighed_at' }),
  silver('silver_energy_tariffs', 'Utility tariffs per farm and month (parsed from formatted text).', 'One row per farm per month.', ['farm_code', 'month_start'], [
    c('farm_code', 'string', 'Farm.'),
    c('month_start', 'date', 'Month.'),
    c('rate_per_kwh', 'double', 'USD per kWh (4 decimals).')
  ])
]

export const LEAFLOFT_TABLES: TableSpec[] = [
  dimFarm, dimRoom, dimRack, dimCrop, dimCustomer, dimPlan, dimSubscription, dimAddon, bridgeAddon,
  factEnv, factBatch, factMrr, factDelivery, ...silverTables
]

// ---------------------------------------------------------------------------------------------
// Bronze

export const LEAFLOFT_SOURCES: BronzeSourceDoc[] = [
  { id: 'sensors', system: 'CanopyLink IoT gateway', pattern: 'sensors/YYYY/MM/DD/telemetry_YYYYMMDD.ndjson', format: 'ndjson', cadence: 'daily', description: 'One JSON object per room per 4-hour slot. A gateway firmware update renamed `rh_pct` → `humidity` and added `vpd_kpa`. Buffered readings can land days late.' },
  { id: 'billing', system: 'Ledgerleaf billing API', pattern: 'billing/YYYY/subscription_events_YYYYMM.json', format: 'json', cadence: 'monthly', description: 'Paged `list` envelope of lifecycle events; amounts in cents (`mrr_before_cents`, `mrr_after_cents`).' },
  { id: 'crm', system: 'Sproutbase CRM', pattern: 'crm/customers.csv', format: 'csv', cadence: 'snapshot', description: 'Customer export with quoted fields and CRLF line endings.' },
  { id: 'catalog', system: 'Ledgerleaf billing API', pattern: 'catalog/{plans,addons}.json', format: 'json', cadence: 'snapshot', description: 'Plan and add-on catalog.' },
  { id: 'crop_plan', system: 'Agronomy team workbook', pattern: 'planning/crop_plan.xlsx', format: 'xlsx', cadence: 'snapshot', description: 'Excel crop plan with title lines; prices typed as text.' },
  { id: 'assets', system: 'RackTrack asset registry', pattern: 'assets/rack_registry.json', format: 'json', cadence: 'snapshot', description: 'Farms, rooms and every rack configuration change.' },
  { id: 'mes', system: 'GrowOS MES', pattern: 'mes/YYYY/grow_batches_YYYYMM.csv', format: 'csv', cadence: 'monthly', description: 'Batches seeded in the month, re-exported with their latest status. Semicolon-delimited.' },
  { id: 'harvest', system: 'GrowOS scale terminals', pattern: 'harvest/YYYY/weighins_YYYYMM.csv', format: 'csv', cadence: 'monthly', description: 'Bin weigh-ins in grams, including scanner test scans.' },
  { id: 'logistics', system: 'Pedalpost courier manifests', pattern: 'logistics/YYYY/MM/deliveries_YYYYMMDD.csv', format: 'csv', cadence: 'daily', description: 'Drop manifests; a few arrive in a later day\'s file.' },
  { id: 'utilities', system: 'Utility e-bill export', pattern: 'utilities/energy_tariffs.csv', format: 'csv', cadence: 'snapshot', description: 'Monthly tariff per farm, copied from PDF bills as text.' }
]

export const LEAFLOFT_ISSUES: IssueDoc[] = [
  { code: 'LL01', kind: 'duplicates', source: 'sensors', description: 'MQTT redelivery: some readings appear twice.', fix: 'Deduplicate on (room, ts).' },
  { code: 'LL02', kind: 'late_arriving', source: 'sensors', column: 'ts', dateColumn: 'ts', description: 'Gateways that lose connectivity upload buffered readings 2-4 days late.', fix: 'Union all daily files; use ts, not the folder date.' },
  { code: 'LL03', kind: 'sentinel_values', source: 'sensors', column: 'temp_c', sentinels: ['-999', '9999'], description: 'Disconnected probes report -999 / 9999 °C.', fix: 'Null the reading (daily averages use the remaining slots).' },
  { code: 'LL04', kind: 'schema_drift', source: 'sensors', description: 'Firmware update: rh_pct renamed to humidity; vpd_kpa added.', fix: 'Coalesce rh_pct/humidity; vpd_kpa null before the update.' },
  { code: 'LL05', kind: 'outliers', source: 'sensors', column: 'kwh', rule: 'negative', description: 'Energy meter counter rollovers produce negative slot deltas.', fix: 'Null negative deltas.' },
  { code: 'LL06', kind: 'duplicates', source: 'billing', description: 'Webhook retries duplicate some events.', fix: 'Deduplicate on event id.' },
  { code: 'LL07', kind: 'casing', source: 'billing', column: 'type', description: 'Event types in mixed case ("UPGRADE", "Churn").', fix: 'Lower-case event types.' },
  { code: 'LL08', kind: 'mixed_date_formats', source: 'billing', column: 'occurred_at', description: 'Legacy events carry epoch seconds or US-format timestamps instead of ISO 8601.', fix: 'Parse each format.' },
  { code: 'LL09', kind: 'whitespace', source: 'crm', column: 'full_name', description: 'Names with leading/trailing spaces and tabs from web forms.', fix: 'TRIM / CLEAN.' },
  { code: 'LL10', kind: 'nulls', source: 'crm', column: 'phone', description: 'Missing phone numbers written as "", "NULL", "n/a" or "-".', fix: 'Normalise placeholders to null.' },
  { code: 'LL11', kind: 'formatted_numbers', source: 'crop_plan', column: 'Price / kg', description: 'Prices typed as "$14.00", "14,00" or "14.00 USD".', fix: 'Strip symbols and parse decimals.' },
  { code: 'LL12', kind: 'whitespace', source: 'crop_plan', column: 'Variety', description: 'Trailing spaces on variety names.', fix: 'TRIM.' },
  { code: 'LL13', kind: 'casing', source: 'assets', column: 'light_type', description: 'Light type typed as "led gen2", "LED GEN1"...', fix: 'Map to canonical values.' },
  { code: 'LL14', kind: 'mixed_date_formats', source: 'mes', column: 'harvest_date', description: 'Harvest dates keyed in EU format at one farm.', fix: 'Parse dd.mm.yyyy as well as ISO.' },
  { code: 'LL15', kind: 'orphan_keys', source: 'harvest', column: 'batch_id', ref: { table: 'silver_grow_batches', column: 'batch_id' }, description: 'Scanner test scans and mistyped batch ids that match no batch.', fix: 'Drop weigh-ins whose batch does not exist (log them).' },
  { code: 'LL16', kind: 'late_arriving', source: 'logistics', column: 'scheduled_date', dateColumn: 'scheduled_date', description: 'Courier manifests uploaded days after the drop.', fix: 'Merge on delivery_id regardless of file date.' },
  { code: 'LL17', kind: 'casing', source: 'logistics', column: 'status', description: 'Status values in mixed case ("DELIVERED", "skipped").', fix: 'Title-case statuses.' },
  { code: 'LL18', kind: 'formatted_numbers', source: 'utilities', column: 'rate', description: 'Tariffs copied from PDFs as "$0.1420" or "0,1420".', fix: 'Parse to decimal.' }
]

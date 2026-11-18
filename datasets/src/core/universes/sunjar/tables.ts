/**
 * Sunjar Fusion Labs — table specifications (silver + gold), bronze sources and planted issues.
 */
import { c } from '../../schema.ts'
import type { BronzeSourceDoc, IssueDoc, TableSpec } from '../../schema.ts'

const D = 'gold_dim_date'

// ---------------------------------------------------------------------------------------------
// Gold dimensions

const dimDevice: TableSpec = {
  name: 'gold_dim_device',
  layer: 'gold',
  kind: 'dim',
  description: 'Fusion devices and test stands: tokamaks, a spherical tokamak, a stellarator, a Z-pinch and the magnet test stand.',
  grain: 'One row per device.',
  key: ['device_key'],
  columns: [
    c('device_key', 'int', 'Surrogate key.'),
    c('device_code', 'string', 'Business key, e.g. "JB1".', { nullable: false }),
    c('device_name', 'string', 'Device nickname.'),
    c('device_type', 'string', 'Tokamak / Spherical Tokamak / Stellarator / Z-Pinch / Magnet Test Stand.'),
    c('confinement_concept', 'string', 'Magnetic / Pulsed / None (test stand).'),
    c('site', 'string', 'Campus.'),
    c('building', 'string', 'Building / hall.'),
    c('commissioned_date', 'date', 'First plasma (or first energisation for the test stand).'),
    c('major_radius_m', 'double', 'Major radius in metres (blank for non-toroidal devices).', { label: 'Major Radius (m)', summarize: 'none', format: '0.00' }),
    c('max_field_tesla', 'double', 'Peak magnetic field on axis (T).', { label: 'Max Field (T)', summarize: 'none', format: '0.0' }),
    c('plasma_volume_m3', 'double', 'Plasma volume (m³).', { label: 'Plasma Volume (m³)', summarize: 'none', format: '0.00' }),
    c('device_status', 'string', 'Operating / Commissioning.')
  ],
  model: { name: 'Device', hierarchies: [{ name: 'Fleet', levels: ['site', 'device_type', 'device_name'] }] }
}

const dimCampaign: TableSpec = {
  name: 'gold_dim_campaign',
  layer: 'gold',
  kind: 'dim',
  description: 'Experimental campaigns (blocks of run days on one device with one physics goal). Key -1 = no campaign.',
  grain: 'One row per campaign (plus the unknown member).',
  key: ['campaign_key'],
  columns: [
    c('campaign_key', 'int', 'Surrogate key.'),
    c('campaign_code', 'string', 'Business key, e.g. "JB1-C07".'),
    c('campaign_name', 'string', 'Campaign name.'),
    c('device_code', 'string', 'Device the campaign ran on.'),
    c('physics_goal', 'string', 'Main objective.'),
    c('start_date', 'date', 'First run day.'),
    c('end_date', 'date', 'Last planned run day.'),
    c('campaign_status', 'string', 'Completed / In Progress / Aborted.')
  ],
  model: { name: 'Campaign', hierarchies: [{ name: 'Campaigns', levels: ['device_code', 'campaign_name'] }] }
}

const dimProfile: TableSpec = {
  name: 'gold_dim_shot_profile',
  layer: 'gold',
  kind: 'dim',
  description: 'Junk dimension: heating scheme × fuel × shot mode.',
  grain: 'One row per heating scheme × fuel × shot mode.',
  key: ['profile_key'],
  columns: [
    c('profile_key', 'int', 'Surrogate key.'),
    c('heating_scheme', 'string', 'Ohmic / Neutral Beam / Ion Cyclotron / Electron Cyclotron / Hybrid / Capacitor Bank / Coil Ramp.'),
    c('fuel', 'string', 'D-D / D-T / D-He3 / None.'),
    c('shot_mode', 'string', 'Calibration / Scan / Performance / Record Attempt.', { sortBy: 'shot_mode_order' }),
    c('shot_mode_order', 'int', 'Sort order of the shot mode.', { hidden: true })
  ],
  model: { name: 'Shot Profile' }
}

const dimOutcome: TableSpec = {
  name: 'gold_dim_shot_outcome',
  layer: 'gold',
  kind: 'dim',
  description: 'Shot outcomes with disruption type.',
  grain: 'One row per outcome × disruption type.',
  key: ['outcome_key'],
  columns: [
    c('outcome_key', 'int', 'Surrogate key.'),
    c('outcome', 'string', 'Success / Partial / Disruption / Abort / Quench.'),
    c('outcome_group', 'string', 'Good / Degraded / Bad.'),
    c('disruption_type', 'string', 'Cause (None for clean shots).')
  ],
  model: { name: 'Shot Outcome', hierarchies: [{ name: 'Outcome', levels: ['outcome_group', 'outcome', 'disruption_type'] }] }
}

const dimStaff: TableSpec = {
  name: 'gold_dim_staff',
  layer: 'gold',
  kind: 'dim',
  description: 'Lab staff with full history (SCD Type 2): promotions, July merit raises, team transfers and departures each open a new version.',
  grain: 'One row per staff member version.',
  key: ['staff_sk'],
  scd2: { businessKey: 'staff_id', from: 'valid_from', to: 'valid_to', current: 'is_current' },
  columns: [
    c('staff_sk', 'int', 'Surrogate key of the version.'),
    c('staff_id', 'string', 'Business key, e.g. "SJ-0042".'),
    c('full_name', 'string', 'Name (fictional).'),
    c('role', 'string', 'Plasma Physicist / Engineer / Technician / Data Scientist / Operator / Safety Officer / Program Manager.'),
    c('team', 'string', 'Plasma Ops / Magnets / Diagnostics / Heating / Cryogenics / Safety / Plant Design / Finance & Admin.'),
    c('grade', 'string', 'Grade L1-L6.', { sortBy: 'grade_level' }),
    c('grade_level', 'int', 'Numeric grade 1-6.', { hidden: true }),
    c('annual_salary', 'decimal', 'Salary in this version (USD).', { format: '$#,0', summarize: 'none' }),
    c('site', 'string', 'Home campus.'),
    c('employment_status', 'string', 'Active / Departed.'),
    c('hire_date', 'date', 'Original hire date.'),
    c('valid_from', 'date', 'Version start (inclusive).', { folder: 'SCD2' }),
    c('valid_to', 'date', 'Version end (inclusive; 9999-12-31 = open).', { folder: 'SCD2' }),
    c('is_current', 'bool', 'Current version flag.', { folder: 'SCD2' }),
    c('version', 'int', 'Version number per staff member.', { folder: 'SCD2', summarize: 'none' })
  ],
  model: { name: 'Staff', hierarchies: [{ name: 'Org', levels: ['team', 'role', 'full_name'] }] }
}

const dimProject: TableSpec = {
  name: 'gold_dim_project',
  layer: 'gold',
  kind: 'dim',
  description: 'R&D projects grouped into programs, with milestone progress. Key -1 = unallocated overhead (legacy GL codes).',
  grain: 'One row per project (plus the unallocated member).',
  key: ['project_key'],
  columns: [
    c('project_key', 'int', 'Surrogate key.'),
    c('project_code', 'string', 'Business key, e.g. "PRJ-201".'),
    c('project_name', 'string', 'Project name.'),
    c('program', 'string', 'Program.'),
    c('project_manager', 'string', 'Project manager (fictional).'),
    c('start_date', 'date', 'Project start.'),
    c('planned_end_date', 'date', 'Baseline end date.'),
    c('project_status', 'string', 'Active / Completed / On Hold / Overhead.'),
    c('milestones_planned', 'int', 'Milestones in the plan.', { summarize: 'sum' }),
    c('milestones_completed', 'int', 'Milestones completed by today.', { summarize: 'sum' }),
    c('schedule_slip_days', 'int', 'Average slip of completed milestones vs baseline (days).', { summarize: 'average' })
  ],
  model: { name: 'Project', hierarchies: [{ name: 'Portfolio', levels: ['program', 'project_name'] }] }
}

const dimAccount: TableSpec = {
  name: 'gold_dim_gl_account',
  layer: 'gold',
  kind: 'dim',
  description: 'Chart of accounts used for project costs.',
  grain: 'One row per GL account.',
  key: ['account_key'],
  columns: [
    c('account_key', 'int', 'Surrogate key.'),
    c('account_code', 'string', 'GL account number.'),
    c('account_name', 'string', 'Account name.'),
    c('account_group', 'string', 'Personnel / Services / Materials / Facilities / Travel / Equipment.'),
    c('account_class', 'string', 'Opex / Capex.')
  ],
  model: { name: 'GL Account', hierarchies: [{ name: 'Accounts', levels: ['account_class', 'account_group', 'account_name'] }] }
}

const dimFunding: TableSpec = {
  name: 'gold_dim_funding_source',
  layer: 'gold',
  kind: 'dim',
  description: 'Where the money comes from: equity rounds, government grants, a strategic partnership and a PPA prepayment.',
  grain: 'One row per funding source.',
  key: ['funding_source_key'],
  columns: [
    c('funding_source_key', 'int', 'Surrogate key.'),
    c('funding_code', 'string', 'Business key, e.g. "FUND-SERIES-B".'),
    c('funding_name', 'string', 'Round / grant name.'),
    c('source_type', 'string', 'Equity Round / Government Grant / Strategic Partnership / PPA Prepayment.'),
    c('lead_investor', 'string', 'Lead investor or granting body (fictional).'),
    c('close_date', 'date', 'Close / award date.'),
    c('committed_amount', 'decimal', 'Total committed (USD). Equals the sum of investor commitments.', { format: '$#,0', summarize: 'sum' }),
    c('pre_money_valuation', 'decimal', 'Pre-money valuation for equity rounds (USD).', { format: '$#,0', summarize: 'none' }),
    c('investor_count', 'int', 'Number of participating investors.', { summarize: 'sum' })
  ],
  model: { name: 'Funding Source' }
}

const dimSupplier: TableSpec = {
  name: 'gold_dim_supplier',
  layer: 'gold',
  kind: 'dim',
  description: 'Magnet and plant component suppliers.',
  grain: 'One row per supplier.',
  key: ['supplier_key'],
  columns: [
    c('supplier_key', 'int', 'Surrogate key.'),
    c('supplier_code', 'string', 'Business key.'),
    c('supplier_name', 'string', 'Supplier (fictional).'),
    c('specialty', 'string', 'What they make.'),
    c('country', 'string', 'Country (fictional).'),
    c('contract_lead_time_days', 'int', 'Quoted lead time in days.'),
    c('quality_tier', 'string', 'Preferred / Approved / Probation.')
  ],
  model: { name: 'Supplier' }
}

const dimComponent: TableSpec = {
  name: 'gold_dim_component',
  layer: 'gold',
  kind: 'dim',
  description: 'Magnet-coil and plant components (HTS tape, winding packs, cryostat parts, power supplies, sensors, vessel segments).',
  grain: 'One row per part number.',
  key: ['component_key'],
  columns: [
    c('component_key', 'int', 'Surrogate key.'),
    c('part_number', 'string', 'Business key.'),
    c('component_name', 'string', 'Description.'),
    c('component_type', 'string', 'Component family.'),
    c('unit_of_measure', 'string', 'm / each / set.'),
    c('standard_cost', 'decimal', 'Standard cost per unit (USD).', { format: '$#,0.00', summarize: 'none' }),
    c('criticality', 'string', 'A (schedule-critical) / B / C.'),
    c('supplier_name', 'string', 'Sole/preferred supplier.')
  ],
  model: { name: 'Component', hierarchies: [{ name: 'Components', levels: ['component_type', 'component_name'] }] }
}

const dimPublication: TableSpec = {
  name: 'gold_dim_publication',
  layer: 'gold',
  kind: 'dim',
  description: 'Papers, preprints and patents by Sunjar staff.',
  grain: 'One row per publication.',
  key: ['publication_key'],
  columns: [
    c('publication_key', 'int', 'Surrogate key.'),
    c('publication_id', 'string', 'Business key, e.g. "SJ-PUB-0012".'),
    c('title', 'string', 'Title.'),
    c('venue', 'string', 'Journal / conference (fictional).'),
    c('publication_type', 'string', 'Journal Article / Conference Paper / Preprint / Patent.'),
    c('published_date', 'date', 'Publication date.'),
    c('author_count', 'int', 'Number of Sunjar authors.', { summarize: 'none' }),
    c('citations', 'int', 'Citations to date.', { summarize: 'sum' })
  ],
  model: { name: 'Publication' }
}

const dimPpa: TableSpec = {
  name: 'gold_dim_ppa',
  layer: 'gold',
  kind: 'dim',
  description: 'Power purchase agreements for the future pilot plant\'s output (contract register).',
  grain: 'One row per PPA.',
  key: ['ppa_key'],
  fks: [{ column: 'signed_date_key', table: D, role: 'Signed Date' }],
  columns: [
    c('ppa_key', 'int', 'Surrogate key.'),
    c('ppa_code', 'string', 'Business key.'),
    c('counterparty', 'string', 'Offtaker (fictional utility / industrial buyer).'),
    c('counterparty_type', 'string', 'Utility / Industrial / Data Center.'),
    c('signed_date_key', 'int', 'Signing date.'),
    c('delivery_start_year', 'int', 'First year of delivery.', { summarize: 'none', format: '0' }),
    c('term_years', 'int', 'Contract term.', { summarize: 'none' }),
    c('capacity_mw', 'double', 'Contracted capacity (MW).', { label: 'Capacity MW', summarize: 'sum', format: '#,0' }),
    c('price_per_mwh', 'decimal', 'Strike price (USD/MWh); blank where confidential.', { label: 'Price per MWh', summarize: 'none', format: '$#,0.00' }),
    c('ppa_status', 'string', 'Signed / Conditional / Terminated.')
  ],
  model: { name: 'PPA' }
}

const bridgeAuthors: TableSpec = {
  name: 'gold_bridge_publication_author',
  layer: 'gold',
  kind: 'bridge',
  description: 'Authorship: many-to-many bridge between Publication and Staff (the staff version in effect on the publication date).',
  grain: 'One row per publication × author.',
  key: ['publication_key', 'staff_sk'],
  fks: [
    { column: 'publication_key', table: 'gold_dim_publication', bidirectional: true },
    { column: 'staff_sk', table: 'gold_dim_staff' }
  ],
  columns: [
    c('publication_key', 'int', 'Publication.'),
    c('staff_sk', 'int', 'Author (staff version).'),
    c('author_position', 'int', 'Position in the author list (1 = first author).', { summarize: 'none' }),
    c('is_corresponding', 'bool', 'Corresponding author.')
  ],
  model: { name: 'Authorship' }
}

// ---------------------------------------------------------------------------------------------
// Gold facts

const factShot: TableSpec = {
  name: 'gold_fact_shot',
  layer: 'gold',
  kind: 'fact',
  factType: 'transaction',
  description: 'Every plasma shot (or magnet energisation on the test stand) with its performance metrics. Q = fusion power ÷ heating power.',
  grain: 'One row per shot.',
  key: ['shot_id'],
  partitionByYearOf: 'shot_date',
  fks: [
    { column: 'date_key', table: D },
    { column: 'time_key', table: 'gold_dim_time' },
    { column: 'device_key', table: 'gold_dim_device' },
    { column: 'campaign_key', table: 'gold_dim_campaign' },
    { column: 'profile_key', table: 'gold_dim_shot_profile' },
    { column: 'outcome_key', table: 'gold_dim_shot_outcome' },
    { column: 'physicist_sk', table: 'gold_dim_staff' }
  ],
  columns: [
    c('shot_id', 'string', 'Shot identifier, e.g. "JB1-012345".'),
    c('shot_number', 'int', 'Sequential shot number on the device.', { summarize: 'none', format: '0' }),
    c('shot_date', 'date', 'Shot date (partition source).', { exclude: true }),
    c('date_key', 'int', 'Shot date.'),
    c('time_key', 'int', 'Shot time (15-minute slot).'),
    c('device_key', 'int', 'Device.'),
    c('campaign_key', 'int', 'Campaign.'),
    c('profile_key', 'int', 'Heating × fuel × mode.'),
    c('outcome_key', 'int', 'Outcome.'),
    c('physicist_sk', 'int', 'Session leader (staff version in effect).'),
    c('duration_ms', 'double', 'Pulse duration (ms).', { label: 'Duration ms', summarize: 'average', format: '#,0.000' }),
    c('peak_temp_kev', 'double', 'Peak ion temperature (keV); blank for the test stand.', { summarize: 'average', format: '0.00' }),
    c('density_1e20', 'double', 'Line-averaged density (10²⁰ m⁻³).', { label: 'Density 1e20', summarize: 'average', format: '0.000' }),
    c('confinement_ms', 'double', 'Energy confinement time τE (ms); blank when not measured.', { summarize: 'average', format: '0.000' }),
    c('triple_product', 'double', 'n·T·τE (10²⁰ keV·s·m⁻³).', { summarize: 'max', format: '0.0000' }),
    c('heating_power_mw', 'double', 'Auxiliary heating power (MW).', { summarize: 'average', format: '#,0.0' }),
    c('fusion_power_mw', 'double', 'Fusion power (MW).', { summarize: 'max', format: '#,0.0000' }),
    c('q_factor', 'double', 'Scientific gain Q = fusion power ÷ heating power.', { summarize: 'max', format: '0.0000' }),
    c('energy_in_mj', 'double', 'Heating (or magnet) energy delivered (MJ).', { format: '#,0.00' }),
    c('energy_out_mj', 'double', 'Fusion energy released (MJ).', { format: '#,0.0000' }),
    c('neutron_yield_1e12', 'double', 'Neutrons produced (×10¹²).', { label: 'Neutron Yield 1e12', format: '#,0.0' }),
    c('is_record', 'bool', 'New device record for triple product.'),
    c('is_disruption', 'bool', 'Plasma disrupted.')
  ],
  model: { name: 'Shots' }
}

const factDeviceDay: TableSpec = {
  name: 'gold_fact_device_day',
  layer: 'gold',
  kind: 'fact',
  factType: 'periodic snapshot',
  description: 'Daily device scorecard: status, shots, run hours, grid energy, cryogenics and coil temperatures, inspections and safety.',
  grain: 'One row per device per day since commissioning.',
  key: ['device_key', 'date_key'],
  fks: [
    { column: 'date_key', table: D },
    { column: 'device_key', table: 'gold_dim_device' }
  ],
  columns: [
    c('device_key', 'int', 'Device.'),
    c('date_key', 'int', 'Date.'),
    c('device_status', 'string', 'Running / Maintenance / Idle / Outage.'),
    c('shots', 'int', 'Shots fired.'),
    c('good_shots', 'int', 'Shots with outcome Success.'),
    c('disruptions', 'int', 'Disrupted shots.'),
    c('run_hours', 'double', 'Hours in operation.', { format: '#,0.0' }),
    c('energy_drawn_mwh', 'double', 'Electricity drawn from the grid (MWh).', { label: 'Energy Drawn MWh', format: '#,0.00' }),
    c('cryo_uptime_pct', 'double', 'Share of the day the cryoplant held temperature.', { summarize: 'average', format: '0.0%' }),
    c('max_coil_temp_k', 'double', 'Highest coil temperature (K).', { label: 'Max Coil Temp K', summarize: 'max', format: '0.0' }),
    c('inspections', 'int', 'Inspections / audits on the day.'),
    c('findings_major', 'int', 'Major findings.'),
    c('findings_minor', 'int', 'Minor findings.'),
    c('safety_incidents', 'int', 'Recordable safety incidents.')
  ],
  model: { name: 'Device Day' }
}

const factFinance: TableSpec = {
  name: 'gold_fact_finance_month',
  layer: 'gold',
  kind: 'fact',
  factType: 'periodic snapshot',
  description: 'Monthly budget vs actual per project and GL account, charged to a funding source. Actuals equal the GL journal lines; budgets equal the budget workbooks. Months after today carry budget only.',
  grain: 'One row per project × GL account × month.',
  key: ['project_key', 'account_key', 'month_end_date_key'],
  fks: [
    { column: 'month_end_date_key', table: D },
    { column: 'project_key', table: 'gold_dim_project' },
    { column: 'account_key', table: 'gold_dim_gl_account' },
    { column: 'funding_source_key', table: 'gold_dim_funding_source' }
  ],
  columns: [
    c('project_key', 'int', 'Project (-1 = unallocated overhead).'),
    c('account_key', 'int', 'GL account.'),
    c('funding_source_key', 'int', 'Funding source the spend is charged to.'),
    c('month_end_date_key', 'int', 'Last day of the month.'),
    c('budget_amount', 'decimal', 'Budget (USD).', { format: '$#,0' }),
    c('actual_amount', 'decimal', 'Actual spend (USD); blank for future months.', { format: '$#,0' }),
    c('variance_amount', 'decimal', 'Actual − budget (blank for future months).', { format: '$#,0' }),
    c('journal_lines', 'int', 'GL lines behind the actual.')
  ],
  model: { name: 'Finance' }
}

const factOrders: TableSpec = {
  name: 'gold_fact_component_order',
  layer: 'gold',
  kind: 'fact',
  factType: 'accumulating snapshot',
  description: 'Component purchase-order lines through their lifecycle (ordered → shipped → received → installed) with a date key per milestone.',
  grain: 'One row per purchase-order line.',
  key: ['order_number', 'order_line'],
  fks: [
    { column: 'order_date_key', table: D, role: 'Order Date' },
    { column: 'received_date_key', table: D, role: 'Received Date', inactive: true, nullable: true },
    { column: 'installed_date_key', table: D, role: 'Installed Date', inactive: true, nullable: true },
    { column: 'supplier_key', table: 'gold_dim_supplier' },
    { column: 'component_key', table: 'gold_dim_component' },
    { column: 'project_key', table: 'gold_dim_project' }
  ],
  columns: [
    c('order_number', 'string', 'PO number.'),
    c('order_line', 'int', 'Line number.', { summarize: 'none' }),
    c('supplier_key', 'int', 'Supplier.'),
    c('component_key', 'int', 'Component.'),
    c('project_key', 'int', 'Project the part is for.'),
    c('order_date_key', 'int', 'Order date (active relationship).'),
    c('promised_date_key', 'int', 'Supplier-promised delivery date.', { summarize: 'none' }),
    c('shipped_date_key', 'int', 'Ship date (blank until shipped).', { summarize: 'none' }),
    c('received_date_key', 'int', 'Receipt date (inactive relationship).'),
    c('installed_date_key', 'int', 'Installation date (inactive relationship).'),
    c('ordered_qty', 'double', 'Quantity ordered.', { format: '#,0.##' }),
    c('received_qty', 'double', 'Quantity received.', { format: '#,0.##' }),
    c('rejected_qty', 'double', 'Quantity rejected at incoming QA.', { format: '#,0.##' }),
    c('unit_cost', 'decimal', 'Agreed unit cost (USD).', { format: '$#,0.00', summarize: 'none' }),
    c('line_amount', 'decimal', 'Ordered qty × unit cost (USD).', { format: '$#,0' }),
    c('lead_time_days', 'int', 'Order → receipt (days).', { summarize: 'average' }),
    c('days_late', 'int', 'Receipt after the promised date (days, 0 if on time).', { summarize: 'sum' }),
    c('is_on_time', 'bool', 'Received by the promised date.'),
    c('order_status', 'string', 'Ordered / Shipped / Received / Installed.')
  ],
  model: { name: 'Component Orders' }
}

// ---------------------------------------------------------------------------------------------
// Silver

const silver = (name: string, description: string, grain: string, key: string[], columns: TableSpec['columns'], extra: Partial<TableSpec> = {}): TableSpec => ({
  name, layer: 'silver', kind: 'entity', description, grain, key, columns, ...extra
})

const silverTables: TableSpec[] = [
  silver('silver_devices', 'Device register.', 'One row per device.', ['device_code'], [
    c('device_code', 'string', 'Device code (upper-case).', { nullable: false }),
    c('device_name', 'string', 'Name.'),
    c('device_type', 'string', 'Type.'),
    c('site', 'string', 'Site.'),
    c('building', 'string', 'Building.'),
    c('commissioned_date', 'date', 'Commissioned.'),
    c('major_radius_m', 'double', 'Major radius (m).'),
    c('max_field_tesla', 'double', 'Peak field (T).'),
    c('plasma_volume_m3', 'double', 'Plasma volume (m³).')
  ]),
  silver('silver_campaigns', 'Campaign plan from the run-planning tool.', 'One row per campaign.', ['campaign_code'], [
    c('campaign_code', 'string', 'Campaign code.'),
    c('device_code', 'string', 'Device.'),
    c('campaign_name', 'string', 'Name.'),
    c('physics_goal', 'string', 'Goal.'),
    c('start_date', 'date', 'Start.'),
    c('end_date', 'date', 'End.'),
    c('campaign_status', 'string', 'Status.')
  ]),
  silver('silver_shots', 'Shot log, deduplicated, late rows merged, renamed v2 columns mapped back, density unit glitches repaired, τE sentinels nulled.', 'One row per shot.', ['shot_id'], [
    c('shot_id', 'string', 'Shot id.'),
    c('device_code', 'string', 'Device.'),
    c('shot_time', 'timestamp', 'Trigger time (UTC).'),
    c('shot_date', 'date', 'Shot date.'),
    c('campaign_code', 'string', 'Campaign.'),
    c('session_leader_id', 'string', 'Physicist leading the session.'),
    c('heating_scheme', 'string', 'Heating scheme.'),
    c('fuel', 'string', 'Fuel.'),
    c('shot_mode', 'string', 'Mode.'),
    c('outcome', 'string', 'Outcome.'),
    c('disruption_type', 'string', 'Disruption cause.'),
    c('duration_ms', 'double', 'Duration (ms).'),
    c('peak_te_kev', 'double', 'Peak temperature (keV).'),
    c('density_1e20', 'double', 'Density (10²⁰ m⁻³).'),
    c('tau_e_ms', 'double', 'Confinement time (ms); null when the -1 sentinel was logged.'),
    c('heating_mw', 'double', 'Heating power (MW).'),
    c('fusion_mw', 'double', 'Fusion power (MW).')
  ], { partitionByYearOf: 'shot_date' }),
  silver('silver_diagnostic_channels', 'Diagnostic channel catalogue.', 'One row per channel.', ['channel_code'], [
    c('channel_code', 'string', 'Channel code.'),
    c('device_code', 'string', 'Device.'),
    c('diagnostic', 'string', 'Instrument.'),
    c('quantity', 'string', 'Measured quantity.'),
    c('unit', 'string', 'Unit.')
  ]),
  silver('silver_diagnostic_readings', 'Per-shot peak/mean readings from the diagnostic streams (glitched negative peaks and missing means are null).', 'One row per shot × channel.', ['shot_id', 'channel_code'], [
    c('shot_id', 'string', 'Shot.'),
    c('channel_code', 'string', 'Channel.'),
    c('reading_date', 'date', 'Shot date.'),
    c('peak_value', 'double', 'Peak reading.'),
    c('mean_value', 'double', 'Flat-top mean reading.'),
    c('sample_count', 'int', 'Samples digitised.'),
    c('quality_flag', 'string', 'OK / SUSPECT.')
  ], { partitionByYearOf: 'reading_date' }),
  silver('silver_device_ops_daily', 'Daily operations log per device.', 'One row per device per day.', ['device_code', 'ops_date'], [
    c('device_code', 'string', 'Device.'),
    c('ops_date', 'date', 'Date.'),
    c('device_status', 'string', 'Status.'),
    c('run_hours', 'double', 'Run hours.'),
    c('energy_drawn_mwh', 'double', 'Grid energy (MWh).'),
    c('cryo_uptime_pct', 'double', 'Cryoplant uptime share.'),
    c('max_coil_temp_k', 'double', 'Max coil temperature (K).')
  ], { partitionByYearOf: 'ops_date' }),
  silver('silver_staff_snapshots', 'Month-end HR snapshots (dates normalised) — input for the SCD2 staff dimension.', 'One row per staff member per month-end.', ['snapshot_date', 'staff_id'], [
    c('snapshot_date', 'date', 'Snapshot date.'),
    c('staff_id', 'string', 'Staff id.'),
    c('full_name', 'string', 'Name.'),
    c('role', 'string', 'Role.'),
    c('team', 'string', 'Team.'),
    c('grade', 'string', 'Grade.'),
    c('annual_salary', 'decimal', 'Salary.'),
    c('site', 'string', 'Site.'),
    c('employment_status', 'string', 'Active / Departed.'),
    c('hire_date', 'date', 'Hire date (parsed).'),
    c('departure_date', 'date', 'Departure date.')
  ], { partitionByYearOf: 'snapshot_date' }),
  silver('silver_projects', 'Project register from the PMO tool.', 'One row per project.', ['project_code'], [
    c('project_code', 'string', 'Code.'),
    c('project_name', 'string', 'Name.'),
    c('program', 'string', 'Program.'),
    c('project_manager', 'string', 'Manager.'),
    c('start_date', 'date', 'Start.'),
    c('planned_end_date', 'date', 'Baseline end.')
  ]),
  silver('silver_milestones', 'Project milestones with baseline and actual dates.', 'One row per milestone.', ['milestone_id'], [
    c('milestone_id', 'string', 'Milestone id.'),
    c('project_code', 'string', 'Project.'),
    c('milestone_name', 'string', 'Name.'),
    c('baseline_date', 'date', 'Baseline date.'),
    c('forecast_date', 'date', 'Current forecast / actual date.'),
    c('completed_date', 'date', 'Completion date (blank = open).'),
    c('slip_days', 'int', 'Forecast − baseline (days).')
  ]),
  silver('silver_gl_accounts', 'Chart of accounts.', 'One row per account.', ['account_code'], [
    c('account_code', 'string', 'Account.'),
    c('account_name', 'string', 'Name.'),
    c('account_group', 'string', 'Group.'),
    c('account_class', 'string', 'Opex / Capex.')
  ]),
  silver('silver_gl_lines', 'GL journal lines (amounts parsed from display text, account codes trimmed). Legacy project codes kept as-is.', 'One row per journal line.', ['journal_id', 'line_number'], [
    c('journal_id', 'string', 'Journal id.'),
    c('line_number', 'int', 'Line.'),
    c('posting_date', 'date', 'Posting date.'),
    c('project_code', 'string', 'Project code as booked (legacy codes = unallocated overhead).'),
    c('account_code', 'string', 'GL account.'),
    c('amount', 'decimal', 'Amount (USD).'),
    c('vendor', 'string', 'Counterparty.'),
    c('description', 'string', 'Line text.')
  ], { partitionByYearOf: 'posting_date' }),
  silver('silver_budget_monthly', 'Budget workbooks unpivoted from 12 month columns to rows.', 'One row per fiscal year × project × account × month.', ['project_code', 'account_code', 'month_start'], [
    c('fiscal_year', 'int', 'Fiscal year (July start).'),
    c('project_code', 'string', 'Project.'),
    c('account_code', 'string', 'Account.'),
    c('month_start', 'date', 'Month.'),
    c('budget_amount', 'decimal', 'Budget (USD).')
  ]),
  silver('silver_funding_sources', 'Funding rounds and grants from the cap-table export (type casing normalised).', 'One row per funding source.', ['funding_code'], [
    c('funding_code', 'string', 'Code.'),
    c('funding_name', 'string', 'Name.'),
    c('source_type', 'string', 'Type.'),
    c('close_date', 'date', 'Close date.'),
    c('committed_amount', 'decimal', 'Committed (USD).'),
    c('pre_money_valuation', 'decimal', 'Pre-money valuation (USD).')
  ]),
  silver('silver_funding_commitments', 'Investor commitments per round (flattened from the nested cap table).', 'One row per funding source × investor.', ['funding_code', 'investor_name'], [
    c('funding_code', 'string', 'Round / grant.'),
    c('investor_name', 'string', 'Investor (fictional).'),
    c('investor_type', 'string', 'Venture Capital / Sovereign Fund / Family Office / Corporate / Government / Utility.'),
    c('is_lead', 'bool', 'Lead investor.'),
    c('amount', 'decimal', 'Committed amount (USD).')
  ]),
  silver('silver_suppliers', 'Supplier master.', 'One row per supplier.', ['supplier_code'], [
    c('supplier_code', 'string', 'Code.'),
    c('supplier_name', 'string', 'Name.'),
    c('specialty', 'string', 'Specialty.'),
    c('country', 'string', 'Country.'),
    c('contract_lead_time_days', 'int', 'Lead time.'),
    c('quality_tier', 'string', 'Tier.')
  ]),
  silver('silver_components', 'Component master.', 'One row per part.', ['part_number'], [
    c('part_number', 'string', 'Part number.'),
    c('component_name', 'string', 'Name.'),
    c('component_type', 'string', 'Type.'),
    c('unit_of_measure', 'string', 'Unit.'),
    c('standard_cost', 'decimal', 'Standard cost.'),
    c('criticality', 'string', 'Criticality.'),
    c('supplier_code', 'string', 'Supplier.')
  ]),
  silver('silver_component_orders', 'Component order lines with their latest lifecycle dates (normalised).', 'One row per order line.', ['order_number', 'order_line'], [
    c('order_number', 'string', 'PO.'),
    c('order_line', 'int', 'Line.'),
    c('supplier_code', 'string', 'Supplier.'),
    c('part_number', 'string', 'Part.'),
    c('project_code', 'string', 'Project.'),
    c('order_date', 'date', 'Ordered.'),
    c('promised_date', 'date', 'Promised.'),
    c('shipped_date', 'date', 'Shipped.'),
    c('received_date', 'date', 'Received.'),
    c('installed_date', 'date', 'Installed.'),
    c('ordered_qty', 'double', 'Ordered.'),
    c('received_qty', 'double', 'Received.'),
    c('rejected_qty', 'double', 'Rejected.'),
    c('unit_cost', 'decimal', 'Unit cost.')
  ]),
  silver('silver_publications', 'Publications (duplicate records from the bibliography tool removed).', 'One row per publication.', ['publication_id'], [
    c('publication_id', 'string', 'Id.'),
    c('title', 'string', 'Title.'),
    c('venue', 'string', 'Venue.'),
    c('publication_type', 'string', 'Type.'),
    c('published_date', 'date', 'Date.'),
    c('citations', 'int', 'Citations.')
  ]),
  silver('silver_publication_authors', 'Author lists flattened from the publication records.', 'One row per publication × author.', ['publication_id', 'staff_id'], [
    c('publication_id', 'string', 'Publication.'),
    c('staff_id', 'string', 'Author.'),
    c('author_position', 'int', 'Position.'),
    c('is_corresponding', 'bool', 'Corresponding author.')
  ]),
  silver('silver_ppas', 'PPA register (confidential prices blank).', 'One row per PPA.', ['ppa_code'], [
    c('ppa_code', 'string', 'Code.'),
    c('counterparty', 'string', 'Offtaker.'),
    c('counterparty_type', 'string', 'Type.'),
    c('signed_date', 'date', 'Signed.'),
    c('delivery_start_year', 'int', 'Delivery start.'),
    c('term_years', 'int', 'Term.'),
    c('capacity_mw', 'double', 'Capacity (MW).'),
    c('price_per_mwh', 'decimal', 'Price (USD/MWh).'),
    c('ppa_status', 'string', 'Status.')
  ]),
  silver('silver_inspections', 'Regulatory inspections, internal audits and safety incidents (incl. ones on the decommissioned prototype, which is not in the device register).', 'One row per inspection / incident.', ['inspection_id'], [
    c('inspection_id', 'string', 'Id.'),
    c('device_code', 'string', 'Device inspected.'),
    c('event_date', 'date', 'Date.'),
    c('event_type', 'string', 'Regulatory Inspection / Internal Audit / Safety Incident.'),
    c('authority', 'string', 'Inspecting body (fictional) or reporting team.'),
    c('findings_major', 'int', 'Major findings.'),
    c('findings_minor', 'int', 'Minor findings.'),
    c('outcome', 'string', 'Pass / Pass with actions / Hold / Recordable / Near Miss.')
  ])
]

export const SUNJAR_TABLES: TableSpec[] = [
  dimDevice, dimCampaign, dimProfile, dimOutcome, dimStaff, dimProject, dimAccount, dimFunding, dimSupplier, dimComponent, dimPublication, dimPpa,
  bridgeAuthors, factShot, factDeviceDay, factFinance, factOrders, ...silverTables
]

// ---------------------------------------------------------------------------------------------
// Bronze

export const SUNJAR_SOURCES: BronzeSourceDoc[] = [
  { id: 'shotlog', system: 'JarControl plasma control system', pattern: 'shotlog/<DEV>/YYYY/MM/DD/shotlog_<DEV>_YYYYMMDD.csv', format: 'csv', cadence: 'daily per device', description: 'One row per shot. JarControl v2 renamed `te_kev` → `peak_te_kev`, `heating_mw` → `p_heat_mw` and added a `fuel` column. Shots logged during DAQ outages land in a later day\'s file.' },
  { id: 'diagnostics', system: 'GlowWire diagnostic DAQ', pattern: 'diagnostics/<DEV>/YYYY/MM/DD/stream_<DEV>_YYYYMMDD.ndjson', format: 'ndjson', cadence: 'daily per device', description: 'Newline-delimited JSON, one record per shot × channel with a nested `values` object.' },
  { id: 'operations', system: 'Facility ops logbook', pattern: 'operations/YYYY/device_ops_YYYYMM.json', format: 'json', cadence: 'monthly', description: 'Daily status, run hours, grid energy and cryogenics per device (API envelope with `records`).' },
  { id: 'registry', system: 'Run-planning tool', pattern: 'operations/{device_register,campaign_plan}.json', format: 'json', cadence: 'snapshot', description: 'Device register and campaign plan.' },
  { id: 'hr', system: 'PeopleOrbit HRIS', pattern: 'hr/staff_YYYYMM.csv', format: 'csv', cadence: 'monthly snapshot', description: 'Month-end staff roster — diff consecutive files to rebuild SCD2 history.' },
  { id: 'finance_gl', system: 'Ledgerline ERP', pattern: 'finance/gl/YYYY/gl_lines_YYYYMM.csv', format: 'csv', cadence: 'monthly', description: 'GL journal lines; amounts exported as display text by some cost centres.' },
  { id: 'budget', system: 'Finance budget workbooks', pattern: 'finance/budget/budget_FYxx.xlsx', format: 'xlsx', cadence: 'per fiscal year', description: 'Wide layout: one row per project × account with twelve month columns (Jul … Jun) and a Total — unpivot it.' },
  { id: 'pmo', system: 'PMO portfolio tool', pattern: 'pmo/projects.json', format: 'json', cadence: 'snapshot', description: 'Projects with a nested `milestones` array.' },
  { id: 'procurement_master', system: 'Ledgerline procurement', pattern: 'procurement/{suppliers,components}.csv', format: 'csv', cadence: 'snapshot', description: 'Semicolon-delimited supplier and component masters with a BOM.' },
  { id: 'procurement', system: 'Supplier portal', pattern: 'procurement/YYYY/component_orders_YYYYMM.json', format: 'json', cadence: 'monthly', description: 'Order lines placed in the month with their latest lifecycle dates.' },
  { id: 'funding', system: 'Cap-table manager', pattern: 'investor_relations/cap_table.json', format: 'json', cadence: 'snapshot', description: 'Funding sources with a nested `commitments` array per investor.' },
  { id: 'ppa', system: 'Commercial contracts register', pattern: 'commercial/ppa_register.csv', format: 'csv', cadence: 'snapshot', description: 'Power purchase agreements.' },
  { id: 'safety', system: 'SafeHarbor EHS', pattern: 'safety/YYYY/inspections_YYYYMM.csv', format: 'csv', cadence: 'monthly', description: 'Inspections, audits and incidents.' },
  { id: 'publications', system: 'BiblioJar reference manager', pattern: 'research/publications.json', format: 'json', cadence: 'snapshot', description: 'Publications with nested author lists.' }
]

export const SUNJAR_ISSUES: IssueDoc[] = [
  { code: 'SJ01', kind: 'duplicates', source: 'shotlog', description: 'JarControl re-logs a shot after a DAQ restart (exact duplicate rows).', fix: 'Deduplicate on shot_id.' },
  { code: 'SJ02', kind: 'late_arriving', source: 'shotlog', column: 'shot_time', dateColumn: 'shot_time', description: 'Shots fired during DAQ outages are uploaded 2-5 days later.', fix: 'Union all daily files; use shot_time, not the file date.' },
  { code: 'SJ03', kind: 'schema_drift', source: 'shotlog', description: 'JarControl v2 renamed te_kev/heating_mw and added a fuel column.', fix: 'Coalesce te_kev/peak_te_kev and heating_mw/p_heat_mw; derive fuel from the campaign before v2.' },
  { code: 'SJ04', kind: 'sentinel_values', source: 'shotlog', column: 'tau_e_ms', sentinels: ['-1'], description: 'τE logged as -1 when the equilibrium reconstruction failed.', fix: 'Replace -1 with null (the triple product is then unknown).' },
  { code: 'SJ05', kind: 'outliers', source: 'shotlog', column: 'ne_1e20', rule: 'extreme', description: 'Density occasionally written in raw 10¹⁸ m⁻³ units (×100).', fix: 'Divide values above 50 by 100 (Z-pinch densities stay below 50 after the fix).' },
  { code: 'SJ06', kind: 'casing', source: 'shotlog', column: 'device', description: 'Device code typed in lower case by one control-room console.', fix: 'UPPER(TRIM(device)).' },
  { code: 'SJ07', kind: 'nulls', source: 'diagnostics', column: 'values.mean', description: 'Flat-top mean missing when the digitiser buffer overflowed.', fix: 'Keep null; average only valid samples.' },
  { code: 'SJ08', kind: 'outliers', source: 'diagnostics', column: 'values.peak', rule: 'negative', description: 'Ground-loop glitches produce negative peaks.', fix: 'Null negative peaks and flag the reading SUSPECT.' },
  { code: 'SJ09', kind: 'mixed_date_formats', source: 'hr', column: 'hire_date', description: 'hire_date in ISO, US, EU and long formats.', fix: 'Parse with a format list.' },
  { code: 'SJ10', kind: 'formatted_numbers', source: 'finance_gl', column: 'amount', description: 'Amounts exported as "$12,345.00", "12.345,00" or "12345.00 USD".', fix: 'Strip symbols/codes and parse with the right decimal separator.' },
  { code: 'SJ11', kind: 'orphan_keys', source: 'finance_gl', column: 'project_code', ref: { table: 'silver_projects', column: 'project_code' }, description: 'Legacy project codes (PRJ-000, PRJ-099, OH-LEGACY) not in the PMO register.', fix: 'Map to the "Unallocated Overhead" project (key -1).' },
  { code: 'SJ12', kind: 'whitespace', source: 'finance_gl', column: 'account_code', description: 'Account codes padded with spaces.', fix: 'TRIM before joining to the chart of accounts.' },
  { code: 'SJ13', kind: 'mixed_date_formats', source: 'procurement', column: 'received_date', description: 'Supplier portal sends EU-format receipt dates for some vendors.', fix: 'Parse ISO and dd.mm.yyyy.' },
  { code: 'SJ14', kind: 'casing', source: 'funding', column: 'source_type', description: 'Funding type typed inconsistently ("equity round", "EQUITY ROUND").', fix: 'Map to canonical types.' },
  { code: 'SJ15', kind: 'orphan_keys', source: 'safety', column: 'device_code', ref: { table: 'silver_devices', column: 'device_code' }, description: 'Inspections of the decommissioned "Teacup-0" prototype (TC0), which is not in the device register.', fix: 'Keep in silver; exclude from the device-day scorecard.' },
  { code: 'SJ16', kind: 'duplicates', source: 'publications', description: 'The reference manager exports some papers twice.', fix: 'Deduplicate on publication_id.' },
  { code: 'SJ17', kind: 'nulls', source: 'ppa', column: 'price_usd_mwh', description: 'Confidential strike prices exported blank / "N/A".', fix: 'Keep null; weighted price measures ignore them.' }
]

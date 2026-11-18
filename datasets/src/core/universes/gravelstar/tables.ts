/**
 * Gravelstar Mining Consortium — table specifications (silver + gold), bronze sources and planted issues.
 */
import { c } from '../../schema.ts'
import type { BronzeSourceDoc, IssueDoc, TableSpec } from '../../schema.ts'

const D = 'gold_dim_date'

// ---------------------------------------------------------------------------------------------
// Gold dimensions

const dimStation: TableSpec = {
  name: 'gold_dim_station',
  layer: 'gold',
  kind: 'dim',
  description: 'Orbital stations: refineries, depots, habitats and customer ports, placed in belts and sectors.',
  grain: 'One row per station.',
  key: ['station_key'],
  columns: [
    c('station_key', 'int', 'Surrogate key.'),
    c('station_code', 'string', 'Business key, e.g. "STN-03".', { nullable: false }),
    c('station_name', 'string', 'Station name.'),
    c('station_type', 'string', 'Refinery / Depot / Habitat / Shipyard / Fuel Depot.'),
    c('belt', 'string', 'Belt (ring) the station orbits in.'),
    c('sector', 'string', 'Sector within the belt.'),
    c('orbit_radius_au', 'double', 'Mean orbital radius (AU).', { label: 'Orbit Radius (AU)', format: '0.000', summarize: 'none' }),
    c('docking_bays', 'int', 'Docking bays.', { summarize: 'none' }),
    c('population', 'int', 'Residents and crew on station.', { summarize: 'none' }),
    c('is_consortium_owned', 'bool', 'Operated by Gravelstar (refineries & depots).')
  ],
  model: { name: 'Station', hierarchies: [{ name: 'Geography', levels: ['belt', 'sector', 'station_name'] }] }
}

const dimClaim: TableSpec = {
  name: 'gold_dim_claim',
  layer: 'gold',
  kind: 'dim',
  description: 'Registered asteroid mining claims with spectral class, reserves and the refinery that processes their ore.',
  grain: 'One row per claim.',
  key: ['claim_key'],
  columns: [
    c('claim_key', 'int', 'Surrogate key.'),
    c('claim_code', 'string', 'Business key, e.g. "CLM-104".', { nullable: false }),
    c('asteroid_name', 'string', 'Nickname of the asteroid (prospectors are not serious people).'),
    c('designation', 'string', 'Catalogue designation.'),
    c('spectral_class', 'string', 'C-type (volatiles) / S-type (silicate) / M-type (metallic) / X-type (exotic).'),
    c('belt', 'string', 'Belt.'),
    c('sector', 'string', 'Sector.'),
    c('primary_mineral', 'string', 'Main mineral targeted.'),
    c('estimated_reserves_t', 'double', 'Estimated ore reserves at registration (tonnes).', { label: 'Estimated Reserves (t)', format: '#,0', summarize: 'none' }),
    c('hardness_index', 'double', 'Drilling hardness (1 = soft regolith, 2 = solid metal).', { format: '0.00', summarize: 'none' }),
    c('refinery_name', 'string', 'Refinery that receives the ore.'),
    c('registered_date', 'date', 'Claim registration date.'),
    c('claim_status', 'string', 'Active / Exhausted / Prospecting.')
  ],
  model: { name: 'Claim', hierarchies: [{ name: 'Claims', levels: ['belt', 'sector', 'asteroid_name'] }] }
}

const dimMineral: TableSpec = {
  name: 'gold_dim_mineral',
  layer: 'gold',
  kind: 'dim',
  description: 'Saleable minerals and their commodity groups.',
  grain: 'One row per mineral.',
  key: ['mineral_key'],
  columns: [
    c('mineral_key', 'int', 'Surrogate key.'),
    c('mineral_code', 'string', 'Business key, e.g. "PT".'),
    c('mineral_name', 'string', 'Mineral name.'),
    c('mineral_group', 'string', 'Base Metals / Precious Metals / Volatiles / Exotics.'),
    c('base_price_usd_per_kg', 'decimal', 'Long-run reference price (USD/kg).', { label: 'Base Price (USD/kg)', format: '$#,0.00', summarize: 'none' }),
    c('typical_grade', 'double', 'Typical ore grade (fraction of ore mass).', { format: '0.0000%', summarize: 'none' })
  ],
  model: { name: 'Mineral', hierarchies: [{ name: 'Commodities', levels: ['mineral_group', 'mineral_name'] }] }
}

const dimVessel: TableSpec = {
  name: 'gold_dim_vessel',
  layer: 'gold',
  kind: 'dim',
  description: 'Drill rigs and freighters with full configuration history (SCD Type 2): claim reassignments, drill-head upgrades, home-station moves and refits each open a new version.',
  grain: 'One row per vessel configuration version.',
  key: ['vessel_sk'],
  scd2: { businessKey: 'vessel_id', from: 'valid_from', to: 'valid_to', current: 'is_current' },
  columns: [
    c('vessel_sk', 'int', 'Surrogate key of the version.'),
    c('vessel_id', 'string', 'Business key, e.g. "RIG-07".'),
    c('vessel_name', 'string', 'Ship name.'),
    c('vessel_class', 'string', 'Drill Rig / Freighter.'),
    c('hull_series', 'string', 'Shipyard hull series.'),
    c('assigned_claim_code', 'string', 'Claim the rig works in this version (freighters: blank).'),
    c('home_station', 'string', 'Home station in this version.'),
    c('drill_head', 'string', 'Drill head model fitted (freighters: n/a).'),
    c('cargo_capacity_t', 'double', 'Cargo capacity (tonnes).', { label: 'Cargo Capacity (t)', format: '#,0', summarize: 'none' }),
    c('commissioned_date', 'date', 'Date the vessel entered service.'),
    c('valid_from', 'date', 'Version start (inclusive).', { folder: 'SCD2' }),
    c('valid_to', 'date', 'Version end (inclusive; 9999-12-31 = open).', { folder: 'SCD2' }),
    c('is_current', 'bool', 'Current version flag.', { folder: 'SCD2' }),
    c('version', 'int', 'Version number per vessel.', { folder: 'SCD2', summarize: 'none' })
  ],
  model: { name: 'Vessel' }
}

const dimCrew: TableSpec = {
  name: 'gold_dim_crew',
  layer: 'gold',
  kind: 'dim',
  description: 'Crew members (pilots, drillers, engineers, geologists, medics).',
  grain: 'One row per crew member.',
  key: ['crew_key'],
  columns: [
    c('crew_key', 'int', 'Surrogate key.'),
    c('crew_id', 'string', 'Business key, e.g. "CR-0042".'),
    c('full_name', 'string', 'Name (fictional).'),
    c('crew_role', 'string', 'Pilot / Driller / Engineer / Geologist / Medic.'),
    c('certification_level', 'string', 'Cadet / Certified / Senior / Master.', { sortBy: 'certification_rank' }),
    c('certification_rank', 'int', 'Certification order 1-4.', { hidden: true }),
    c('home_station', 'string', 'Home station.'),
    c('hire_date', 'date', 'Hire date.'),
    c('is_active', 'bool', 'Still with the consortium.')
  ],
  model: { name: 'Crew' }
}

const bridgeRoster: TableSpec = {
  name: 'gold_bridge_vessel_crew',
  layer: 'gold',
  kind: 'bridge',
  description: 'Crew rosters: which crew members served aboard each vessel configuration version (many-to-many between Vessel and Crew).',
  grain: 'One row per vessel version × crew member who served during it.',
  key: ['vessel_sk', 'crew_key'],
  fks: [
    { column: 'vessel_sk', table: 'gold_dim_vessel', bidirectional: true },
    { column: 'crew_key', table: 'gold_dim_crew' }
  ],
  columns: [
    c('vessel_sk', 'int', 'Vessel version.'),
    c('crew_key', 'int', 'Crew member.'),
    c('days_aboard', 'int', 'Days the crew member was aboard during the version.', { summarize: 'sum' })
  ],
  model: { name: 'Crew Roster' }
}

const dimCustomer: TableSpec = {
  name: 'gold_dim_customer',
  layer: 'gold',
  kind: 'dim',
  description: 'Buyers of refined product: shipyards, fuel depots, fabricators, habitats and the spot exchange.',
  grain: 'One row per customer.',
  key: ['customer_key'],
  columns: [
    c('customer_key', 'int', 'Surrogate key.'),
    c('customer_code', 'string', 'Business key.'),
    c('customer_name', 'string', 'Name (fictional).'),
    c('segment', 'string', 'Shipyard / Fuel Depot / Fabricator / Habitat / Exchange.'),
    c('home_station', 'string', 'Station where deliveries are made.'),
    c('payment_terms_days', 'int', 'Contractual payment terms.'),
    c('credit_rating', 'string', 'AAA … B (blank = unrated).')
  ],
  model: { name: 'Customer' }
}

const dimContract: TableSpec = {
  name: 'gold_dim_contract',
  layer: 'gold',
  kind: 'dim',
  description: 'Offtake contracts: fixed-price, index-linked (with premium) or spot.',
  grain: 'One row per contract.',
  key: ['contract_key'],
  fks: [
    { column: 'customer_key', table: 'gold_dim_customer', noModel: true },
    { column: 'mineral_key', table: 'gold_dim_mineral', noModel: true }
  ],
  columns: [
    c('contract_key', 'int', 'Surrogate key.'),
    c('contract_code', 'string', 'Business key, e.g. "K-2025-014".'),
    c('customer_key', 'int', 'Customer (kept for lineage; not a model relationship to avoid ambiguous paths).', { exclude: true }),
    c('customer_name', 'string', 'Customer (denormalised).'),
    c('mineral_key', 'int', 'Mineral (lineage only).', { exclude: true }),
    c('mineral_name', 'string', 'Mineral (denormalised).'),
    c('contract_type', 'string', 'Fixed / Index-Linked / Spot.'),
    c('fixed_price_usd_per_kg', 'decimal', 'Fixed price (Fixed contracts).', { label: 'Fixed Price (USD/kg)', format: '$#,0.00', summarize: 'none' }),
    c('index_premium_pct', 'double', 'Premium over index (Index-Linked).', { format: '0.0%', summarize: 'none' }),
    c('volume_commitment_kg', 'double', 'Committed volume over the term.', { format: '#,0', summarize: 'none' }),
    c('start_date', 'date', 'Term start.'),
    c('end_date', 'date', 'Term end.')
  ],
  model: { name: 'Contract' }
}

const dimRunProfile: TableSpec = {
  name: 'gold_dim_run_profile',
  layer: 'gold',
  kind: 'dim',
  description: 'Junk dimension for extraction runs: shift × operating mode.',
  grain: 'One row per shift × mode.',
  key: ['run_profile_key'],
  columns: [
    c('run_profile_key', 'int', 'Surrogate key.'),
    c('shift', 'string', 'Alpha (00-08) / Beta (08-16) / Gamma (16-24) — Coordinated Belt Time.', { sortBy: 'shift_order' }),
    c('shift_order', 'int', 'Shift order.', { hidden: true }),
    c('operating_mode', 'string', 'Crewed / Autonomous.')
  ],
  model: { name: 'Run Profile' }
}

const dimIncidentType: TableSpec = {
  name: 'gold_dim_incident_type',
  layer: 'gold',
  kind: 'dim',
  description: 'Junk dimension for safety incidents: category × severity.',
  grain: 'One row per category × severity.',
  key: ['incident_type_key'],
  columns: [
    c('incident_type_key', 'int', 'Surrogate key.'),
    c('category', 'string', 'Decompression / Tether Failure / Equipment Strike / Radiation Exposure / Fire / Collision / Chemical.'),
    c('severity', 'string', 'Near Miss / First Aid / Lost Time / Major.', { sortBy: 'severity_rank' }),
    c('severity_rank', 'int', 'Severity order 1-4.', { hidden: true }),
    c('is_recordable', 'bool', 'Counts towards recordable incident rates (First Aid and worse).')
  ],
  model: { name: 'Incident Type' }
}

// ---------------------------------------------------------------------------------------------
// Gold facts

const factExtraction: TableSpec = {
  name: 'gold_fact_extraction_run',
  layer: 'gold',
  kind: 'fact',
  factType: 'transaction',
  description: 'One drilling shift on a claim: ore and waste moved, drill hours, energy, and the assayed grade of the primary mineral.',
  grain: 'One row per extraction run (rig × shift).',
  key: ['run_id'],
  partitionByYearOf: 'run_date',
  fks: [
    { column: 'date_key', table: D },
    { column: 'claim_key', table: 'gold_dim_claim' },
    { column: 'vessel_sk', table: 'gold_dim_vessel' },
    { column: 'primary_mineral_key', table: 'gold_dim_mineral' },
    { column: 'run_profile_key', table: 'gold_dim_run_profile' }
  ],
  columns: [
    c('run_id', 'string', 'Run id, e.g. "RUN-RIG07-20250314-B".'),
    c('run_date', 'date', 'Run date (partition source).', { exclude: true }),
    c('date_key', 'int', 'Run date.'),
    c('claim_key', 'int', 'Claim drilled.'),
    c('vessel_sk', 'int', 'Rig (configuration version in effect).'),
    c('primary_mineral_key', 'int', 'Primary mineral of the claim.'),
    c('run_profile_key', 'int', 'Shift × operating mode.'),
    c('ore_tonnes', 'double', 'Ore delivered to the shuttle (t).', { format: '#,0.0' }),
    c('waste_tonnes', 'double', 'Waste rock moved (t).', { format: '#,0.0' }),
    c('drill_hours', 'double', 'Hours the drill head was cutting.', { format: '#,0.00' }),
    c('energy_mwh', 'double', 'Reactor energy drawn (MWh).', { format: '#,0.00' }),
    c('primary_grade', 'double', 'Assayed grade of the primary mineral (fraction).', { format: '0.0000%', summarize: 'none' }),
    c('contained_primary_kg', 'double', 'Primary mineral contained in the ore (kg) = ore × grade.', { format: '#,0.0' }),
    c('estimated_value_usd', 'decimal', 'Contained primary mineral at the day\'s index price.', { format: '$#,0' })
  ],
  model: { name: 'Extraction' }
}

const factEquipmentDay: TableSpec = {
  name: 'gold_fact_equipment_day',
  layer: 'gold',
  kind: 'fact',
  factType: 'periodic snapshot',
  description: 'Daily health and utilisation snapshot per vessel from the telemetry downlink and the maintenance system. Wear and vibration climb before breakdowns.',
  grain: 'One row per vessel per day in service.',
  key: ['vessel_id', 'date_key'],
  partitionByYearOf: 'snapshot_date',
  fks: [
    { column: 'date_key', table: D },
    { column: 'vessel_sk', table: 'gold_dim_vessel' }
  ],
  columns: [
    c('vessel_id', 'string', 'Vessel business key.', { hidden: true }),
    c('snapshot_date', 'date', 'Snapshot date (partition source).', { exclude: true }),
    c('date_key', 'int', 'Snapshot date.'),
    c('vessel_sk', 'int', 'Vessel version in effect.'),
    c('operating_hours', 'double', 'Hours operating (drilling or under thrust).', { format: '#,0.0' }),
    c('downtime_hours', 'double', 'Hours down for maintenance or breakdown.', { format: '#,0.0' }),
    c('crew_hours', 'double', 'Crew hours aboard (exposure for safety rates).', { format: '#,0' }),
    c('avg_vibration_mm_s', 'double', 'Mean vibration velocity (mm/s) of valid readings.', { label: 'Avg Vibration (mm/s)', format: '0.00', summarize: 'average' }),
    c('max_bearing_temp_c', 'double', 'Highest valid bearing temperature (°C).', { label: 'Max Bearing Temp (°C)', format: '0.0', summarize: 'max' }),
    c('drill_wear_pct', 'double', 'Drill-head / drive wear at end of day (0-100).', { format: '0.0', summarize: 'none' }),
    c('power_draw_mw', 'double', 'Mean reactor power draw (MW).', { format: '0.00', summarize: 'average' }),
    c('fault_codes', 'int', 'Fault codes raised.'),
    c('is_failure', 'bool', 'An unplanned breakdown started this day.'),
    c('is_planned_maintenance', 'bool', 'A planned maintenance window started this day.'),
    c('maintenance_cost_usd', 'decimal', 'Work-order cost booked this day (parts + labor).', { format: '$#,0' })
  ],
  model: { name: 'Equipment Day' }
}

const factCargo: TableSpec = {
  name: 'gold_fact_cargo_haul',
  layer: 'gold',
  kind: 'fact',
  factType: 'accumulating snapshot',
  description: 'Refined-product hauls from refineries to customer stations through their lifecycle (loaded → delivered → paid), priced per contract.',
  grain: 'One row per haul manifest line (haul × mineral).',
  key: ['haul_id', 'manifest_line'],
  partitionByYearOf: 'loaded_date',
  fks: [
    { column: 'loaded_date_key', table: D, role: 'Loaded Date' },
    { column: 'delivered_date_key', table: D, role: 'Delivered Date', inactive: true, nullable: true },
    { column: 'paid_date_key', table: D, role: 'Paid Date', inactive: true, nullable: true },
    { column: 'origin_station_key', table: 'gold_dim_station', role: 'Origin' },
    { column: 'destination_station_key', table: 'gold_dim_station', role: 'Destination', inactive: true },
    { column: 'vessel_sk', table: 'gold_dim_vessel' },
    { column: 'customer_key', table: 'gold_dim_customer' },
    { column: 'contract_key', table: 'gold_dim_contract' },
    { column: 'mineral_key', table: 'gold_dim_mineral' }
  ],
  columns: [
    c('haul_id', 'string', 'Haul id.'),
    c('manifest_line', 'int', 'Manifest line.', { summarize: 'none' }),
    c('loaded_date', 'date', 'Loading date (partition source).', { exclude: true }),
    c('loaded_date_key', 'int', 'Loaded at the refinery (active date).'),
    c('delivered_date_key', 'int', 'Delivered to the customer (inactive role).'),
    c('paid_date_key', 'int', 'Customer payment received (inactive role).'),
    c('origin_station_key', 'int', 'Refinery of origin.'),
    c('destination_station_key', 'int', 'Customer station (inactive role-playing station).'),
    c('vessel_sk', 'int', 'Freighter (version in effect).'),
    c('customer_key', 'int', 'Customer.'),
    c('contract_key', 'int', 'Contract.'),
    c('mineral_key', 'int', 'Mineral carried.'),
    c('loaded_kg', 'double', 'Quantity loaded (kg).', { format: '#,0' }),
    c('delivered_kg', 'double', 'Quantity delivered (kg); blank while in transit.', { format: '#,0' }),
    c('transit_loss_kg', 'double', 'Lost in transit (micrometeoroid breaches, venting).', { format: '#,0.0' }),
    c('index_price_usd_per_kg', 'decimal', 'Exchange index on the pricing date.', { label: 'Index Price (USD/kg)', format: '$#,0.00', summarize: 'none' }),
    c('unit_price_usd_per_kg', 'decimal', 'Price charged per kg under the contract.', { label: 'Unit Price (USD/kg)', format: '$#,0.00', summarize: 'none' }),
    c('revenue_usd', 'decimal', 'delivered_kg × unit price (blank until delivered).', { format: '$#,0' }),
    c('transit_days', 'int', 'Days from loading to delivery.', { summarize: 'average' }),
    c('days_to_pay', 'int', 'Days from delivery to payment.', { summarize: 'average' }),
    c('status', 'string', 'In Transit / Delivered / Paid.')
  ],
  model: { name: 'Cargo' }
}

const factSafety: TableSpec = {
  name: 'gold_fact_safety_incident',
  layer: 'gold',
  kind: 'fact',
  factType: 'factless',
  description: 'Safety events (near misses to major incidents) aboard vessels and on stations. Event fact: count rows; injuries and lost days add context.',
  grain: 'One row per reported incident.',
  key: ['incident_id'],
  partitionByYearOf: 'incident_date',
  fks: [
    { column: 'date_key', table: D },
    { column: 'vessel_sk', table: 'gold_dim_vessel', nullable: true },
    { column: 'station_key', table: 'gold_dim_station' },
    { column: 'incident_type_key', table: 'gold_dim_incident_type' }
  ],
  columns: [
    c('incident_id', 'string', 'Incident id.'),
    c('incident_date', 'date', 'Date (partition source).', { exclude: true }),
    c('date_key', 'int', 'Incident date.'),
    c('vessel_sk', 'int', 'Vessel involved (blank = station incident).'),
    c('station_key', 'int', 'Nearest / home station.'),
    c('incident_type_key', 'int', 'Category × severity.'),
    c('injuries', 'int', 'People injured.'),
    c('lost_time_days', 'int', 'Work days lost.'),
    c('root_cause', 'string', 'Equipment / Procedure / Human Factors / Environment.')
  ],
  model: { name: 'Safety Incidents' }
}

// ---------------------------------------------------------------------------------------------
// Silver

const silver = (name: string, description: string, grain: string, key: string[], columns: TableSpec['columns'], extra: Partial<TableSpec> = {}): TableSpec => ({
  name, layer: 'silver', kind: 'entity', description, grain, key, columns, ...extra
})

const silverTables: TableSpec[] = [
  silver('silver_stations', 'Station registry.', 'One row per station.', ['station_code'], [
    c('station_code', 'string', 'Code.', { nullable: false }), c('station_name', 'string', 'Name.'), c('station_type', 'string', 'Type.'),
    c('belt', 'string', 'Belt.'), c('sector', 'string', 'Sector.'), c('orbit_radius_au', 'double', 'Orbit radius.'), c('docking_bays', 'int', 'Bays.'),
    c('population', 'int', 'Population.')
  ]),
  silver('silver_claims', 'Claim register (whitespace trimmed).', 'One row per claim.', ['claim_code'], [
    c('claim_code', 'string', 'Code.', { nullable: false }), c('asteroid_name', 'string', 'Name.'), c('designation', 'string', 'Designation.'),
    c('spectral_class', 'string', 'Class.'), c('belt', 'string', 'Belt.'), c('sector', 'string', 'Sector.'), c('primary_mineral_code', 'string', 'Primary mineral.'),
    c('estimated_reserves_t', 'double', 'Reserves.'), c('hardness_index', 'double', 'Hardness.'), c('refinery_code', 'string', 'Refinery station.'),
    c('registered_date', 'date', 'Registered.')
  ]),
  silver('silver_claim_minerals', 'Block-model mineral content per claim.', 'One row per claim × mineral.', ['claim_code', 'mineral_code'], [
    c('claim_code', 'string', 'Claim.'), c('mineral_code', 'string', 'Mineral.'), c('mean_grade', 'double', 'Block-model mean grade (fraction).'), c('is_primary', 'bool', 'Primary mineral.')
  ]),
  silver('silver_minerals', 'Mineral master.', 'One row per mineral.', ['mineral_code'], [
    c('mineral_code', 'string', 'Code.'), c('mineral_name', 'string', 'Name.'), c('mineral_group', 'string', 'Group.'), c('base_price_usd_per_kg', 'decimal', 'Reference price.')
  ]),
  silver('silver_customers', 'Customer master (segment casing normalised; unrated customers keep a null rating).', 'One row per customer.', ['customer_code'], [
    c('customer_code', 'string', 'Code.'), c('customer_name', 'string', 'Name.'), c('segment', 'string', 'Segment.'), c('home_station_code', 'string', 'Delivery station.'),
    c('payment_terms_days', 'int', 'Terms.'), c('credit_rating', 'string', 'Rating (null = unrated).')
  ]),
  silver('silver_contracts', 'Contracts with dates parsed from mixed formats.', 'One row per contract.', ['contract_code'], [
    c('contract_code', 'string', 'Code.'), c('customer_code', 'string', 'Customer.'), c('mineral_code', 'string', 'Mineral.'), c('contract_type', 'string', 'Type.'),
    c('fixed_price_usd_per_kg', 'decimal', 'Fixed price.'), c('index_premium_pct', 'double', 'Premium.'), c('volume_commitment_kg', 'double', 'Commitment.'),
    c('start_date', 'date', 'Start.'), c('end_date', 'date', 'End.')
  ]),
  silver('silver_vessel_registry', 'Month-end fleet registry snapshots (names trimmed) — the input for the SCD2 vessel dimension.', 'One row per vessel per month-end snapshot.', ['snapshot_date', 'vessel_id'], [
    c('snapshot_date', 'date', 'Snapshot date.'), c('vessel_id', 'string', 'Vessel.'), c('vessel_name', 'string', 'Name.'), c('vessel_class', 'string', 'Class.'),
    c('assigned_claim_code', 'string', 'Claim.'), c('home_station_code', 'string', 'Home station.'), c('drill_head', 'string', 'Drill head.'), c('cargo_capacity_t', 'double', 'Capacity.')
  ], { partitionByYearOf: 'snapshot_date' }),
  silver('silver_crew', 'Crew register.', 'One row per crew member.', ['crew_id'], [
    c('crew_id', 'string', 'Crew id.'), c('full_name', 'string', 'Name.'), c('crew_role', 'string', 'Role.'), c('certification_level', 'string', 'Level.'),
    c('home_station_code', 'string', 'Home station.'), c('hire_date', 'date', 'Hired.'), c('leave_date', 'date', 'Left (null = active).')
  ]),
  silver('silver_crew_tours', 'Crew tours of duty aboard vessels.', 'One row per tour.', ['tour_id'], [
    c('tour_id', 'string', 'Tour id.'), c('crew_id', 'string', 'Crew.'), c('vessel_id', 'string', 'Vessel.'), c('tour_start', 'date', 'Boarded.'), c('tour_end', 'date', 'Disembarked (inclusive).')
  ]),
  silver('silver_extraction_runs', 'Shift reports, deduplicated; vessel ids upper-cased, claim codes trimmed, scale glitches repaired from the shuttle weighbridge.', 'One row per run.', ['run_id'], [
    c('run_id', 'string', 'Run id.'), c('run_date', 'date', 'Date.'), c('shift', 'string', 'Shift.'), c('operating_mode', 'string', 'Mode.'),
    c('vessel_id', 'string', 'Rig.'), c('claim_code', 'string', 'Claim.'), c('ore_tonnes', 'double', 'Ore.'), c('waste_tonnes', 'double', 'Waste.'),
    c('drill_hours', 'double', 'Drill hours.'), c('energy_mwh', 'double', 'Energy.')
  ], { partitionByYearOf: 'run_date' }),
  silver('silver_ore_assays', 'Lab assays per run and mineral (calibration samples without a run removed; dates normalised).', 'One row per run × mineral.', ['run_id', 'mineral_code'], [
    c('assay_id', 'string', 'Assay id.'), c('run_id', 'string', 'Run.'), c('run_date', 'date', 'Run date.'), c('mineral_code', 'string', 'Mineral.'),
    c('grade', 'double', 'Grade (fraction of ore mass).'), c('assayed_at', 'timestamp', 'Assay timestamp.'), c('lab', 'string', 'Lab.')
  ], { partitionByYearOf: 'run_date' }),
  silver('silver_refinery_batches', 'Daily refinery batches (feed).', 'One row per refinery per day with feed.', ['batch_id'], [
    c('batch_id', 'string', 'Batch id.'), c('refinery_code', 'string', 'Refinery.'), c('batch_date', 'date', 'Date.'), c('feed_ore_tonnes', 'double', 'Ore fed.'),
    c('energy_mwh', 'double', 'Energy.')
  ], { partitionByYearOf: 'batch_date' }),
  silver('silver_refinery_output', 'Refinery output per mineral: contained in feed vs recovered.', 'One row per batch × mineral.', ['batch_id', 'mineral_code'], [
    c('batch_id', 'string', 'Batch.'), c('batch_date', 'date', 'Date.'), c('refinery_code', 'string', 'Refinery.'), c('mineral_code', 'string', 'Mineral.'),
    c('feed_contained_kg', 'double', 'Mineral contained in the feed (assay-weighted).'), c('recovered_kg', 'double', 'Refined product recovered.')
  ], { partitionByYearOf: 'batch_date' }),
  silver('silver_equipment_telemetry', 'Telemetry readings (every 6 h), retransmits removed, -9999 sensor dropouts nulled, firmware field rename unified.', 'One row per vessel per reading.', ['vessel_id', 'reading_at'], [
    c('vessel_id', 'string', 'Vessel.'), c('reading_at', 'timestamp', 'Reading time (Coordinated Belt Time).'), c('vibration_mm_s', 'double', 'Vibration.'),
    c('bearing_temp_c', 'double', 'Bearing temperature (null = dropout).'), c('power_draw_mw', 'double', 'Power draw.'), c('wear_pct', 'double', 'Wear estimate.'),
    c('fault_code', 'string', 'Fault code raised (null = none).'), c('hull_temp_c', 'double', 'Hull temperature (firmware ≥ 4.2 only).')
  ], { partitionByYearOf: 'reading_at' }),
  silver('silver_work_orders', 'Maintenance work orders (CMMS), deduplicated.', 'One row per work order.', ['work_order_id'], [
    c('work_order_id', 'string', 'WO id.'), c('vessel_id', 'string', 'Vessel.'), c('work_type', 'string', 'Planned / Breakdown.'), c('failure_mode', 'string', 'Failure mode (breakdowns).'),
    c('opened_at', 'timestamp', 'Opened.'), c('closed_at', 'timestamp', 'Closed (null = open).'), c('downtime_hours', 'double', 'Downtime.'),
    c('parts_cost_usd', 'decimal', 'Parts.'), c('labor_hours', 'double', 'Technician hours.'), c('total_cost_usd', 'decimal', 'Parts + labor.')
  ]),
  silver('silver_commodity_prices', 'Daily exchange index per mineral (text prices parsed).', 'One row per mineral per day.', ['mineral_code', 'price_date'], [
    c('mineral_code', 'string', 'Mineral.'), c('price_date', 'date', 'Date.'), c('index_price_usd_per_kg', 'decimal', 'Index price.')
  ], { partitionByYearOf: 'price_date' }),
  silver('silver_cargo_manifests', 'Haul manifests with their latest lifecycle state.', 'One row per manifest line.', ['haul_id', 'manifest_line'], [
    c('haul_id', 'string', 'Haul.'), c('manifest_line', 'int', 'Line.'), c('vessel_id', 'string', 'Freighter.'), c('origin_code', 'string', 'Refinery.'),
    c('destination_code', 'string', 'Customer station.'), c('contract_code', 'string', 'Contract.'), c('mineral_code', 'string', 'Mineral.'),
    c('loaded_date', 'date', 'Loaded.'), c('delivered_date', 'date', 'Delivered.'), c('paid_date', 'date', 'Paid.'), c('loaded_kg', 'double', 'Loaded.'),
    c('delivered_kg', 'double', 'Delivered.'), c('unit_price_usd_per_kg', 'decimal', 'Price.'), c('revenue_usd', 'decimal', 'Revenue.')
  ], { partitionByYearOf: 'loaded_date' }),
  silver('silver_safety_incidents', 'Incident reports (blank lost-time days = 0).', 'One row per incident.', ['incident_id'], [
    c('incident_id', 'string', 'Id.'), c('incident_date', 'date', 'Date.'), c('vessel_id', 'string', 'Vessel (null = station).'), c('station_code', 'string', 'Station.'),
    c('category', 'string', 'Category.'), c('severity', 'string', 'Severity.'), c('injuries', 'int', 'Injured.'), c('lost_time_days', 'int', 'Days lost.'),
    c('root_cause', 'string', 'Root cause.'), c('summary', 'string', 'Short narrative.')
  ])
]

export const GRAVELSTAR_TABLES: TableSpec[] = [
  dimStation, dimClaim, dimMineral, dimVessel, dimCrew, bridgeRoster, dimCustomer, dimContract, dimRunProfile, dimIncidentType,
  factExtraction, factEquipmentDay, factCargo, factSafety, ...silverTables
]

// ---------------------------------------------------------------------------------------------
// Bronze

export const GRAVELSTAR_SOURCES: BronzeSourceDoc[] = [
  { id: 'telemetry', system: 'DeepLink fleet telemetry downlink', pattern: 'telemetry/YYYY/MM/DD/downlink_YYYYMMDD.ndjson', format: 'ndjson', cadence: 'daily', description: 'One JSON packet per vessel reading (every 6 h). Packets delayed by comms blackouts land in later days\' files; firmware 4.2 renamed `vib_rms` → `vibration_mm_s` and added `hull_temp_c`.' },
  { id: 'shift_reports', system: 'RigBoss shift reporting', pattern: 'operations/runs/YYYY/MM/shift_reports_YYYYMMDD.csv', format: 'csv', cadence: 'daily', description: 'One row per extraction run, typed by rig crews.' },
  { id: 'assays', system: 'Crucible assay lab LIMS', pattern: 'assay_lab/YYYY/assays_YYYYMM.csv', format: 'csv', cadence: 'monthly', description: 'Assay results per run sample and mineral (semicolon-delimited).' },
  { id: 'refinery', system: 'Smeltwise refinery MES API', pattern: 'refinery/YYYY/batches_YYYYMM.json', format: 'json', cadence: 'monthly', description: 'Batch records with a nested `outputs` array per mineral, wrapped in an API envelope.' },
  { id: 'prices', system: 'Belt Commodity Exchange price sheet', pattern: 'market/commodity_prices_YYYY.xlsx', format: 'xlsx', cadence: 'yearly workbook', description: 'Daily index prices per mineral; title rows above the header; prices typed as text.' },
  { id: 'customers', system: 'LedgerLoop CRM', pattern: 'sales/customers.json', format: 'json', cadence: 'snapshot', description: 'Customer master export.' },
  { id: 'contracts', system: 'LedgerLoop contracts', pattern: 'sales/contracts.csv', format: 'csv', cadence: 'snapshot', description: 'Offtake contracts.' },
  { id: 'logistics', system: 'HaulTrack dispatch', pattern: 'logistics/YYYY/manifests_YYYYMM.csv', format: 'csv', cadence: 'monthly', description: 'Haul manifest lines loaded in the month, re-exported with their latest status.' },
  { id: 'maintenance', system: 'WrenchWorks CMMS', pattern: 'maintenance/YYYY/work_orders_YYYYMM.ndjson', format: 'ndjson', cadence: 'monthly', description: 'Work orders opened in the month.' },
  { id: 'fleet', system: 'Fleet registry', pattern: 'fleet/registry_YYYYMM.csv', format: 'csv', cadence: 'monthly snapshot', description: 'Month-end vessel registry — diff consecutive snapshots to rebuild the SCD2 history.' },
  { id: 'crew', system: 'Bunkhouse HR', pattern: 'hr/{crew,tours}.csv', format: 'csv', cadence: 'snapshot', description: 'Crew register and tours of duty.' },
  { id: 'claims', system: 'Belt Claims Registry', pattern: 'claims/{stations,claims,claim_minerals,minerals}.csv', format: 'csv', cadence: 'snapshot', description: 'Stations, claims, block-model mineral content and the mineral list.' },
  { id: 'safety', system: 'SafeOrbit incident reporting', pattern: 'safety/incident_reports.json', format: 'json', cadence: 'snapshot', description: 'All incident reports.' }
]

export const GRAVELSTAR_ISSUES: IssueDoc[] = [
  { code: 'GS01', kind: 'duplicates', source: 'telemetry', description: 'Packet retransmits: identical readings appear twice.', fix: 'Deduplicate on (vessel_id, reading time).' },
  { code: 'GS02', kind: 'late_arriving', source: 'telemetry', column: 'ts', dateColumn: 'ts', description: 'Comms blackouts: packets land 2-9 days after they were recorded.', fix: 'Use the packet timestamp, not the file date; union all days.' },
  { code: 'GS03', kind: 'sentinel_values', source: 'telemetry', column: 'bearing_temp_c', sentinels: ['-9999'], description: 'Sensor dropouts reported as -9999.', fix: 'Null them; exclude from daily max.' },
  { code: 'GS04', kind: 'schema_drift', source: 'telemetry', description: 'Firmware 4.2 renamed vib_rms to vibration_mm_s and added hull_temp_c.', fix: 'Coalesce the two vibration fields; hull_temp_c null before the upgrade.' },
  { code: 'GS05', kind: 'casing', source: 'shift_reports', column: 'vessel_id', description: 'Rig ids typed in lower/mixed case ("rig-07").', fix: 'UPPER(vessel_id).' },
  { code: 'GS06', kind: 'whitespace', source: 'shift_reports', column: 'claim_code', description: 'Claim codes padded with spaces/tabs.', fix: 'TRIM.' },
  { code: 'GS07', kind: 'outliers', source: 'shift_reports', column: 'ore_t', rule: 'extreme', description: 'Weighbridge scale glitch reports ore ×1000 (kg typed as tonnes).', fix: 'Values > 10× the rig median are divided by 1000.' },
  { code: 'GS08', kind: 'duplicates', source: 'shift_reports', description: 'Some shift reports were submitted twice.', fix: 'Deduplicate on run_id.' },
  { code: 'GS09', kind: 'orphan_keys', source: 'assays', column: 'run_id', ref: { table: 'silver_extraction_runs', column: 'run_id' }, description: 'Calibration and test-core samples reference run ids that never existed.', fix: 'Drop assays whose run_id is not in the shift reports.' },
  { code: 'GS10', kind: 'mixed_date_formats', source: 'assays', column: 'assayed_at', description: 'Lab timestamps in ISO, US and EU formats.', fix: 'Parse with a format list.' },
  { code: 'GS11', kind: 'formatted_numbers', source: 'prices', column: 'Price (USD/kg)', description: 'Index prices typed as text: "$26,410.00", "26.410,00", "26410.00 USD".', fix: 'Strip symbols/codes, detect the decimal separator, cast to decimal.' },
  { code: 'GS12', kind: 'nulls', source: 'customers', column: 'creditRating', description: 'Unrated customers have no credit rating (null, "", "N/A").', fix: 'Normalise placeholders to null (= unrated).' },
  { code: 'GS13', kind: 'casing', source: 'customers', column: 'segment', description: 'Segment names in inconsistent case.', fix: 'Map to canonical segment names.' },
  { code: 'GS14', kind: 'mixed_date_formats', source: 'contracts', column: 'start_date', description: 'Contract start dates typed in several formats.', fix: 'Parse with a format list.' },
  { code: 'GS15', kind: 'duplicates', source: 'maintenance', description: 'CMMS exports re-send some work orders.', fix: 'Deduplicate on work_order_id.' },
  { code: 'GS16', kind: 'whitespace', source: 'fleet', column: 'vessel_name', description: 'Trailing spaces in vessel names break SCD2 change detection (false "changes").', fix: 'TRIM before comparing snapshots.' },
  { code: 'GS17', kind: 'nulls', source: 'safety', column: 'lost_time_days', description: 'Lost-time days left blank when no time was lost.', fix: 'Blank = 0.' },
  { code: 'GS18', kind: 'orphan_keys', source: 'logistics', column: 'contract', ref: { table: 'silver_contracts', column: 'contract_code' }, description: 'Spot loads booked against an ad-hoc "SPOT-ADHOC" code that is not in the contract register.', fix: 'Map to the mineral\'s exchange spot contract.' }
]

/**
 * Moonwake Star Cruises — table specifications (silver + gold), bronze sources and planted issues.
 */
import { c } from '../../schema.ts'
import type { BronzeSourceDoc, IssueDoc, TableSpec } from '../../schema.ts'

const D = 'gold_dim_date'
const CR = '₡#,0'
const CR2 = '₡#,0.00'

// ---------------------------------------------------------------------------------------------
// Gold dimensions

const dimShip: TableSpec = {
  name: 'gold_dim_ship',
  layer: 'gold',
  kind: 'dim',
  description: 'The Moonwake fleet of boutique starliners.',
  grain: 'One row per ship.',
  key: ['ship_key'],
  columns: [
    c('ship_key', 'int', 'Surrogate key.'),
    c('ship_code', 'string', 'Business key, e.g. "MSV-02".', { nullable: false }),
    c('ship_name', 'string', 'Ship name.'),
    c('ship_class', 'string', 'Skiff / Clipper / Galleon class.'),
    c('berth_capacity', 'int', 'Passenger berths.'),
    c('cabin_count', 'int', 'Number of cabins.'),
    c('decks', 'int', 'Passenger decks.'),
    c('launch_year', 'int', 'Year the ship entered service.', { format: '0' }),
    c('home_port', 'string', 'Home spaceport.'),
    c('has_gravity_ring', 'bool', 'Spin-gravity ring on board.')
  ],
  model: { name: 'Ship' }
}

const dimCabinClass: TableSpec = {
  name: 'gold_dim_cabin_class',
  layer: 'gold',
  kind: 'dim',
  description: 'Cabin classes from Interior Pods to the Captain\'s Nebula Suite.',
  grain: 'One row per cabin class.',
  key: ['cabin_class_key'],
  columns: [
    c('cabin_class_key', 'int', 'Surrogate key.'),
    c('class_code', 'string', 'Business key, e.g. "ZGS".'),
    c('class_name', 'string', 'Cabin class.', { sortBy: 'class_tier' }),
    c('class_tier', 'int', 'Tier 1 (cheapest) … 5 (most premium).', { hidden: true }),
    c('berths_per_cabin', 'int', 'Berths per cabin.'),
    c('has_window', 'bool', 'Has a view port.'),
    c('deck_band', 'string', 'Lower / Mid / Upper / Observation.')
  ],
  model: { name: 'Cabin Class' }
}

const dimPort: TableSpec = {
  name: 'gold_dim_port',
  layer: 'gold',
  kind: 'dim',
  description: 'Ports of call: fictional moons, ring habitats, asteroid docks and stations.',
  grain: 'One row per port.',
  key: ['port_key'],
  columns: [
    c('port_key', 'int', 'Surrogate key.'),
    c('port_code', 'string', 'Business key, e.g. "KST".'),
    c('port_name', 'string', 'Port name.'),
    c('body_type', 'string', 'Moon / Station / Ring / Asteroid.'),
    c('system_region', 'string', 'Inner Ring / Outer Belt / Far Reach.'),
    c('surface_gravity_g', 'double', 'Surface (or spin) gravity in g.', { summarize: 'none', format: '0.00' }),
    c('docking_fee_per_passenger', 'decimal', 'Port fee charged per passenger (credits).', { format: CR2, summarize: 'none' }),
    c('highlight', 'string', 'What guests come for.')
  ],
  model: { name: 'Port', hierarchies: [{ name: 'Ports', levels: ['system_region', 'port_name'] }] }
}

const dimSailing: TableSpec = {
  name: 'gold_dim_sailing',
  layer: 'gold',
  kind: 'dim',
  description: 'Individual voyages: a ship on an itinerary departing on a date.',
  grain: 'One row per sailing.',
  key: ['sailing_key'],
  columns: [
    c('sailing_key', 'int', 'Surrogate key.'),
    c('sailing_code', 'string', 'Business key, e.g. "MSV-02-20260314".'),
    c('ship_code', 'string', 'Ship.'),
    c('ship_name', 'string', 'Ship name.'),
    c('itinerary_code', 'string', 'Itinerary code.'),
    c('itinerary_name', 'string', 'Itinerary name.'),
    c('region', 'string', 'Region sailed.'),
    c('nights', 'int', 'Voyage length in nights.', { summarize: 'none' }),
    c('departure_date', 'date', 'Departure date.'),
    c('return_date', 'date', 'Return date.'),
    c('berth_capacity', 'int', 'Berths available on this sailing.', { summarize: 'none' }),
    c('sailing_status', 'string', 'Completed / In Space / Scheduled / Cancelled.'),
    c('is_storm_affected', 'bool', 'Sailing fell inside the solar-storm advisory window.')
  ],
  model: { name: 'Sailing', hierarchies: [{ name: 'Itineraries', levels: ['region', 'itinerary_name', 'sailing_code'] }] }
}

const bridgeSailingPort: TableSpec = {
  name: 'gold_bridge_sailing_port',
  layer: 'gold',
  kind: 'bridge',
  description: 'Ports of call per sailing (many-to-many bridge between Sailing and Port).',
  grain: 'One row per sailing × port call.',
  key: ['sailing_key', 'stop_sequence'],
  fks: [
    { column: 'sailing_key', table: 'gold_dim_sailing', bidirectional: true },
    { column: 'port_key', table: 'gold_dim_port' }
  ],
  columns: [
    c('sailing_key', 'int', 'Sailing.'),
    c('port_key', 'int', 'Port of call.'),
    c('stop_sequence', 'int', 'Order of the call (1 = first).', { summarize: 'none' }),
    c('voyage_day', 'int', 'Day of the voyage the ship docks.', { summarize: 'none' })
  ],
  model: { name: 'Sailing Port' }
}

const dimFareClass: TableSpec = {
  name: 'gold_dim_fare_class',
  layer: 'gold',
  kind: 'dim',
  description: 'Fare classes (price & refund rules).',
  grain: 'One row per fare class.',
  key: ['fare_class_key'],
  columns: [
    c('fare_class_key', 'int', 'Surrogate key.'),
    c('fare_code', 'string', 'Business key.'),
    c('fare_name', 'string', 'Fare class.'),
    c('is_refundable', 'bool', 'Deposit refundable on cancellation.'),
    c('deposit_pct', 'double', 'Deposit as share of the booking total.', { format: '0%', summarize: 'none' }),
    c('fare_multiplier', 'double', 'Multiplier on the dynamic base fare.', { format: '0.00', summarize: 'none' })
  ],
  model: { name: 'Fare Class' }
}

const dimHousehold: TableSpec = {
  name: 'gold_dim_household',
  layer: 'gold',
  kind: 'dim',
  description: 'Guest households (the booking party). Key -1 = anonymous web visitor.',
  grain: 'One row per household (plus anonymous).',
  key: ['household_key'],
  columns: [
    c('household_key', 'int', 'Surrogate key (-1 = anonymous).'),
    c('household_id', 'string', 'Business key, e.g. "H-0001234".'),
    c('lead_guest_name', 'string', 'Lead guest (fictional).'),
    c('home_world', 'string', 'Where the household lives.'),
    c('segment', 'string', 'Solo / Couple / Family / Group.'),
    c('loyalty_tier', 'string', 'Stardust / Comet / Galaxy / Cosmos (by sailings taken).', { sortBy: 'tier_rank' }),
    c('tier_rank', 'int', 'Tier order.', { hidden: true }),
    c('customer_since', 'date', 'First booking date.'),
    c('email_opt_in', 'bool', 'Marketing consent.')
  ],
  model: { name: 'Household' }
}

const dimCampaign: TableSpec = {
  name: 'gold_dim_campaign',
  layer: 'gold',
  kind: 'dim',
  description: 'Marketing campaigns. 0 = organic / direct, -1 = unknown campaign code in the clickstream.',
  grain: 'One row per campaign (plus organic and unknown).',
  key: ['campaign_key'],
  columns: [
    c('campaign_key', 'int', 'Surrogate key.'),
    c('campaign_code', 'string', 'UTM campaign code.'),
    c('campaign_name', 'string', 'Campaign name.'),
    c('channel', 'string', 'Search / Social / Email / Holo-Ads / Affiliate / Organic.'),
    c('target_region', 'string', 'Region promoted.'),
    c('offer_discount_pct', 'double', 'Promo discount offered.', { format: '0%', summarize: 'none' }),
    c('budget', 'decimal', 'Media budget (credits).', { format: CR, summarize: 'sum' }),
    c('start_date', 'date', 'Flight start.'),
    c('end_date', 'date', 'Flight end.')
  ],
  model: { name: 'Campaign' }
}

const dimSpend: TableSpec = {
  name: 'gold_dim_spend_category',
  layer: 'gold',
  kind: 'dim',
  description: 'Onboard revenue centers.',
  grain: 'One row per venue.',
  key: ['spend_category_key'],
  columns: [
    c('spend_category_key', 'int', 'Surrogate key.'),
    c('category', 'string', 'Spa / Zero-G Casino / Excursions / Dining / Bars / Shop.'),
    c('venue', 'string', 'Venue on board.'),
    c('department', 'string', 'Crew department running the venue.')
  ],
  model: { name: 'Spend Category', hierarchies: [{ name: 'Revenue Centers', levels: ['category', 'venue'] }] }
}

const dimCrew: TableSpec = {
  name: 'gold_dim_crew',
  layer: 'gold',
  kind: 'dim',
  description: 'Crew members with full history (SCD Type 2): ship rotations, promotions and departures each open a version.',
  grain: 'One row per crew member version.',
  key: ['crew_sk'],
  scd2: { businessKey: 'crew_id', from: 'valid_from', to: 'valid_to', current: 'is_current' },
  columns: [
    c('crew_sk', 'int', 'Surrogate key of the version.'),
    c('crew_id', 'string', 'Business key, e.g. "C-0042".'),
    c('full_name', 'string', 'Name (fictional).'),
    c('rank', 'string', 'Job title / rank in this version.'),
    c('department', 'string', 'Department.'),
    c('ship_code', 'string', 'Assigned ship in this version.'),
    c('ship_name', 'string', 'Assigned ship name.'),
    c('contract_type', 'string', 'Rotational / Permanent.'),
    c('employment_status', 'string', 'Active / Departed.'),
    c('hire_date', 'date', 'Original hire date.'),
    c('valid_from', 'date', 'Version start.', { folder: 'SCD2' }),
    c('valid_to', 'date', 'Version end (9999-12-31 = open).', { folder: 'SCD2' }),
    c('is_current', 'bool', 'Current version.', { folder: 'SCD2' }),
    c('version', 'int', 'Version number.', { folder: 'SCD2', summarize: 'none' })
  ],
  model: { name: 'Crew' }
}

const dimProfile: TableSpec = {
  name: 'gold_dim_booking_profile',
  layer: 'gold',
  kind: 'dim',
  description: 'Junk dimension: booking device × party type × booking window × insurance.',
  grain: 'One row per combination.',
  key: ['booking_profile_key'],
  columns: [
    c('booking_profile_key', 'int', 'Surrogate key.'),
    c('booking_device', 'string', 'Web Desktop / Web Mobile / Moonwake App / Call Center / Travel Agent.'),
    c('party_type', 'string', 'Solo / Couple / Family / Group.'),
    c('booking_window', 'string', 'Lead-time band.', { sortBy: 'booking_window_order' }),
    c('booking_window_order', 'int', 'Band order.', { hidden: true }),
    c('has_insurance', 'bool', 'Travel insurance purchased.')
  ],
  model: { name: 'Booking Profile' }
}

// ---------------------------------------------------------------------------------------------
// Gold facts

const factBooking: TableSpec = {
  name: 'gold_fact_booking',
  layer: 'gold',
  kind: 'fact',
  factType: 'accumulating snapshot',
  description: 'Bookings through their lifecycle (booked → deposit → final payment → sailed / cancelled / no-show), one date key per milestone. Events before the booking system went live are stamped with the go-live date (see is_migrated).',
  grain: 'One row per booking.',
  key: ['booking_id'],
  partitionByYearOf: 'sail_date',
  fks: [
    { column: 'booking_date_key', table: D, role: 'Booking Date' },
    { column: 'deposit_date_key', table: D, role: 'Deposit Date', inactive: true, nullable: true },
    { column: 'final_payment_date_key', table: D, role: 'Final Payment Date', inactive: true, nullable: true },
    { column: 'sail_date_key', table: D, role: 'Sail Date', inactive: true },
    { column: 'cancel_date_key', table: D, role: 'Cancel Date', inactive: true, nullable: true },
    { column: 'sailing_key', table: 'gold_dim_sailing' },
    { column: 'ship_key', table: 'gold_dim_ship' },
    { column: 'cabin_class_key', table: 'gold_dim_cabin_class' },
    { column: 'fare_class_key', table: 'gold_dim_fare_class' },
    { column: 'household_key', table: 'gold_dim_household' },
    { column: 'campaign_key', table: 'gold_dim_campaign' },
    { column: 'booking_profile_key', table: 'gold_dim_booking_profile' }
  ],
  columns: [
    c('booking_id', 'string', 'Booking reference, e.g. "BK-0012345".'),
    c('sail_date', 'date', 'Departure date (partition source).', { exclude: true }),
    c('booking_date_key', 'int', 'Booking date (active relationship).'),
    c('deposit_date_key', 'int', 'Deposit paid (inactive).'),
    c('final_payment_date_key', 'int', 'Final payment (inactive).'),
    c('sail_date_key', 'int', 'Departure (inactive).'),
    c('cancel_date_key', 'int', 'Cancellation (inactive).'),
    c('original_booking_date', 'date', 'True booking date (may precede the go-live date).'),
    c('sailing_key', 'int', 'Sailing.'),
    c('ship_key', 'int', 'Ship.'),
    c('cabin_class_key', 'int', 'Cabin class.'),
    c('fare_class_key', 'int', 'Fare class.'),
    c('household_key', 'int', 'Household.'),
    c('campaign_key', 'int', 'Attributed campaign (0 = organic).'),
    c('booking_profile_key', 'int', 'Device / party / window / insurance profile.'),
    c('passengers', 'int', 'Guests in the booking.'),
    c('nights', 'int', 'Voyage nights.', { summarize: 'none' }),
    c('berth_nights', 'int', 'passengers × nights.'),
    c('lead_time_days', 'int', 'Days from booking to departure.', { summarize: 'average' }),
    c('fare_per_berth_night', 'decimal', 'Price per guest per night at booking time.', { format: CR2, summarize: 'none' }),
    c('gross_fare', 'decimal', 'Cruise fare before discounts.', { format: CR2 }),
    c('discount_amount', 'decimal', 'Campaign / loyalty discount.', { format: CR2 }),
    c('net_fare', 'decimal', 'gross_fare − discount_amount.', { format: CR2 }),
    c('port_fees', 'decimal', 'Docking fees passed through.', { format: CR2 }),
    c('transit_levy', 'decimal', 'Interplanetary transit levy (8% of net fare).', { format: CR2 }),
    c('insurance_amount', 'decimal', 'Travel insurance.', { format: CR2 }),
    c('total_amount', 'decimal', 'Booking total = Σ fare lines.', { format: CR2 }),
    c('cancellation_fee', 'decimal', 'Fee retained on cancellation.', { format: CR2 }),
    c('is_cancelled', 'bool', 'Cancelled (as of today).'),
    c('is_no_show', 'bool', 'Did not board.'),
    c('is_repeat_guest', 'bool', 'Household had booked before.'),
    c('is_migrated', 'bool', 'Booked in the legacy system before go-live.'),
    c('status', 'string', 'Booked / Deposit Paid / Fully Paid / Sailed / No-Show / Cancelled.'),
    c('cancellation_reason', 'string', 'Why it was cancelled.')
  ],
  model: { name: 'Bookings' }
}

const factInventory: TableSpec = {
  name: 'gold_fact_sailing_inventory',
  layer: 'gold',
  kind: 'fact',
  factType: 'periodic snapshot',
  description: 'Daily booking curve per sailing over the final weeks before departure: berths sold, revenue on the books and the lowest fare on sale.',
  grain: 'One row per sailing per day in the final booking window (days_to_departure 0…N).',
  key: ['sailing_key', 'snapshot_date_key'],
  partitionByYearOf: 'snapshot_date',
  fks: [
    { column: 'snapshot_date_key', table: D },
    { column: 'sailing_key', table: 'gold_dim_sailing' },
    { column: 'ship_key', table: 'gold_dim_ship' }
  ],
  columns: [
    c('sailing_key', 'int', 'Sailing.'),
    c('ship_key', 'int', 'Ship.'),
    c('snapshot_date', 'date', 'Snapshot date (partition source).', { exclude: true }),
    c('snapshot_date_key', 'int', 'Snapshot date.'),
    c('days_to_departure', 'int', 'Days left before departure (0 = departure day).', { summarize: 'none' }),
    c('berth_capacity', 'int', 'Berths for sale.', { summarize: 'sum' }),
    c('berths_sold', 'int', 'Guests on active bookings.', { summarize: 'sum' }),
    c('active_bookings', 'int', 'Bookings not cancelled.', { summarize: 'sum' }),
    c('cancellations_to_date', 'int', 'Bookings cancelled so far.', { summarize: 'sum' }),
    c('occupancy_pct', 'double', 'berths_sold ÷ berth_capacity.', { format: '0.0%', summarize: 'average' }),
    c('revenue_on_books', 'decimal', 'Net fare of active bookings.', { format: CR }),
    c('lowest_fare_per_berth_night', 'decimal', 'Cheapest fare on sale (Interior Pod, Standard).', { format: CR2, summarize: 'average' }),
    c('revenue_per_available_berth', 'decimal', 'revenue_on_books ÷ berth_capacity (RevPAB).', { format: CR2, summarize: 'average' })
  ],
  model: { name: 'Sailing Inventory' }
}

const factOnboard: TableSpec = {
  name: 'gold_fact_onboard_charge',
  layer: 'gold',
  kind: 'fact',
  factType: 'transaction',
  description: 'Folio charges during the voyage (spa, zero-g casino, excursions, dining, bars, shop).',
  grain: 'One row per folio charge.',
  key: ['charge_id'],
  partitionByYearOf: 'charge_date',
  fks: [
    { column: 'charge_date_key', table: D },
    { column: 'sailing_key', table: 'gold_dim_sailing' },
    { column: 'ship_key', table: 'gold_dim_ship' },
    { column: 'spend_category_key', table: 'gold_dim_spend_category' },
    { column: 'household_key', table: 'gold_dim_household' },
    { column: 'crew_sk', table: 'gold_dim_crew' }
  ],
  columns: [
    c('charge_id', 'string', 'Folio charge id.'),
    c('booking_id', 'string', 'Booking (degenerate).'),
    c('charge_date', 'date', 'Charge date (partition source).', { exclude: true }),
    c('charge_date_key', 'int', 'Charge date.'),
    c('sailing_key', 'int', 'Sailing.'),
    c('ship_key', 'int', 'Ship.'),
    c('spend_category_key', 'int', 'Venue.'),
    c('household_key', 'int', 'Household.'),
    c('crew_sk', 'int', 'Crew member who served (SCD2 version in effect).'),
    c('voyage_day', 'int', 'Day of the voyage.', { summarize: 'none' }),
    c('quantity', 'int', 'Items / guests.'),
    c('amount', 'decimal', 'Charge amount (credits).', { format: CR2 })
  ],
  model: { name: 'Onboard Charges' }
}

const factQuote: TableSpec = {
  name: 'gold_fact_quote',
  layer: 'gold',
  kind: 'fact',
  factType: 'factless',
  description: 'Factless event fact: every price quote requested (web, app, call center, travel agents) and whether it converted.',
  grain: 'One row per quote request.',
  key: ['quote_id'],
  partitionByYearOf: 'quote_date',
  fks: [
    { column: 'quote_date_key', table: D },
    { column: 'sailing_key', table: 'gold_dim_sailing' },
    { column: 'cabin_class_key', table: 'gold_dim_cabin_class' },
    { column: 'household_key', table: 'gold_dim_household' },
    { column: 'campaign_key', table: 'gold_dim_campaign' }
  ],
  columns: [
    c('quote_id', 'string', 'Quote id.'),
    c('quote_date', 'date', 'Quote date (partition source).', { exclude: true }),
    c('quote_date_key', 'int', 'Quote date.'),
    c('sailing_key', 'int', 'Sailing quoted.'),
    c('cabin_class_key', 'int', 'Cabin class quoted.'),
    c('household_key', 'int', 'Household (-1 = anonymous).'),
    c('campaign_key', 'int', 'Attributed campaign (0 organic, -1 unknown code).'),
    c('device', 'string', 'Web Desktop / Web Mobile / Moonwake App / Call Center / Travel Agent / Unknown.'),
    c('booking_id', 'string', 'Booking created from this quote (blank = not converted).'),
    c('is_converted', 'bool', 'Quote became a booking.')
  ],
  model: { name: 'Quotes' }
}

// ---------------------------------------------------------------------------------------------
// Silver

const silver = (name: string, description: string, grain: string, key: string[], columns: TableSpec['columns'], extra: Partial<TableSpec> = {}): TableSpec => ({
  name, layer: 'silver', kind: 'entity', description, grain, key, columns, ...extra
})

const silverTables: TableSpec[] = [
  silver('silver_ships', 'Fleet registry (ship class casing normalised).', 'One row per ship.', ['ship_code'], [
    c('ship_code', 'string', 'Ship code.', { nullable: false }), c('ship_name', 'string', 'Name.'), c('ship_class', 'string', 'Class (title case).'),
    c('berth_capacity', 'int', 'Berths.'), c('cabin_count', 'int', 'Cabins.'), c('decks', 'int', 'Decks.'), c('launch_year', 'int', 'Launch year.'),
    c('home_port', 'string', 'Home port.'), c('has_gravity_ring', 'bool', 'Gravity ring.')
  ]),
  silver('silver_ship_cabins', 'Berths per ship and cabin class (from the nested fleet registry).', 'One row per ship × cabin class.', ['ship_code', 'class_code'], [
    c('ship_code', 'string', 'Ship.'), c('class_code', 'string', 'Cabin class.'), c('cabins', 'int', 'Cabins.'), c('berths', 'int', 'Berths.')
  ]),
  silver('silver_ports', 'Ports of call.', 'One row per port.', ['port_code'], [
    c('port_code', 'string', 'Port code (trimmed).'), c('port_name', 'string', 'Name.'), c('body_type', 'string', 'Body type.'), c('system_region', 'string', 'Region.'),
    c('surface_gravity_g', 'double', 'Gravity.'), c('docking_fee_per_passenger', 'decimal', 'Fee.'), c('highlight', 'string', 'Highlight.')
  ]),
  silver('silver_itineraries', 'Itinerary catalogue.', 'One row per itinerary.', ['itinerary_code'], [
    c('itinerary_code', 'string', 'Code.'), c('itinerary_name', 'string', 'Name.'), c('region', 'string', 'Region.'), c('nights', 'int', 'Nights.'),
    c('popularity_index', 'double', 'Planning demand index.'), c('offers_nebula_suite', 'bool', 'Captain\'s Nebula Suite offered.')
  ]),
  silver('silver_itinerary_ports', 'Port calls per itinerary (port codes trimmed).', 'One row per itinerary stop.', ['itinerary_code', 'stop_sequence'], [
    c('itinerary_code', 'string', 'Itinerary.'), c('stop_sequence', 'int', 'Stop number.'), c('port_code', 'string', 'Port.'), c('voyage_day', 'int', 'Day docked.')
  ]),
  silver('silver_sailings', 'Sailing schedule.', 'One row per sailing.', ['sailing_code'], [
    c('sailing_code', 'string', 'Sailing.'), c('ship_code', 'string', 'Ship.'), c('itinerary_code', 'string', 'Itinerary.'), c('departure_date', 'date', 'Departure.'),
    c('return_date', 'date', 'Return.'), c('berth_capacity', 'int', 'Berths.'), c('sailing_status', 'string', 'Status.')
  ]),
  silver('silver_fare_rates', 'Published base rates per itinerary × cabin class × year (sentinel rows for combinations not sold removed).', 'One row per itinerary × cabin class × fare year.', ['fare_year', 'itinerary_code', 'class_code'], [
    c('fare_year', 'int', 'Fare sheet year.'), c('itinerary_code', 'string', 'Itinerary.'), c('class_code', 'string', 'Cabin class.'),
    c('base_rate_per_berth_night', 'decimal', 'Base rate before dynamic pricing.')
  ]),
  silver('silver_campaigns', 'Campaign master.', 'One row per campaign.', ['campaign_code'], [
    c('campaign_code', 'string', 'UTM code.'), c('campaign_name', 'string', 'Name.'), c('channel', 'string', 'Channel.'), c('target_region', 'string', 'Region.'),
    c('offer_discount_pct', 'double', 'Discount.'), c('budget', 'decimal', 'Budget.'), c('start_date', 'date', 'Start.'), c('end_date', 'date', 'End.')
  ]),
  silver('silver_households', 'Households, de-duplicated (latest record wins), dates parsed.', 'One row per household.', ['household_id'], [
    c('household_id', 'string', 'Household id.'), c('lead_guest_name', 'string', 'Lead guest.'), c('home_world', 'string', 'Home world.'), c('segment', 'string', 'Segment.'),
    c('loyalty_tier', 'string', 'Tier.'), c('customer_since', 'date', 'First booking.'), c('email', 'string', 'E-mail (null = not provided).'), c('email_opt_in', 'bool', 'Consent.')
  ]),
  silver('silver_bookings', 'Booking headers (API v1/v2 merged, duplicates and late re-sends resolved, legacy migration appended).', 'One row per booking.', ['booking_id'], [
    c('booking_id', 'string', 'Booking.'), c('booked_at', 'timestamp', 'Booking timestamp.'), c('departure_date', 'date', 'Departure.'), c('sailing_code', 'string', 'Sailing.'),
    c('class_code', 'string', 'Cabin class.'), c('fare_code', 'string', 'Fare class.'), c('household_id', 'string', 'Household.'), c('campaign_code', 'string', 'Campaign (blank = organic).'),
    c('device', 'string', 'Device.'), c('passengers', 'int', 'Guests.'), c('has_insurance', 'bool', 'Insurance (API v2; derived from fare lines for v1).'),
    c('total_amount', 'decimal', 'Total.'), c('source_system', 'string', 'booking_api_v1 / booking_api_v2 / legacy_migration.'),
    c('cancelled_on', 'date', 'Cancellation date (null = active).'), c('cancellation_reason', 'string', 'Reason.')
  ], { partitionByYearOf: 'departure_date' }),
  silver('silver_booking_fare_lines', 'Price build-up per booking: fare, discount, port fees, levy, insurance. Lines sum to the booking total.', 'One row per booking × line type.', ['booking_id', 'line_type'], [
    c('booking_id', 'string', 'Booking.'), c('departure_date', 'date', 'Departure (partition).'), c('line_type', 'string', 'Cruise Fare / Discount / Port Fees / Transit Levy / Travel Insurance.'),
    c('amount', 'decimal', 'Line amount (discount negative).')
  ], { partitionByYearOf: 'departure_date' }),
  silver('silver_payments', 'Deposits and final payments (amounts parsed, dates normalised, references trimmed).', 'One row per payment.', ['payment_id'], [
    c('payment_id', 'string', 'Payment id.'), c('booking_id', 'string', 'Booking.'), c('paid_on', 'date', 'Payment date.'), c('payment_type', 'string', 'Deposit / Final / Full.'),
    c('amount', 'decimal', 'Amount.')
  ]),
  silver('silver_quotes', 'Quote requests from the clickstream (campaign codes upper-cased, unknown codes kept, missing devices = "Unknown").', 'One row per quote.', ['quote_id'], [
    c('quote_id', 'string', 'Quote.'), c('quoted_at', 'timestamp', 'Timestamp.'), c('quote_date', 'date', 'Date.'), c('sailing_code', 'string', 'Sailing.'),
    c('class_code', 'string', 'Cabin class.'), c('party_size', 'int', 'Guests.'), c('quoted_fare_per_berth_night', 'decimal', 'Fare shown.'),
    c('campaign_code', 'string', 'UTM campaign (blank = organic).'), c('device', 'string', 'Device.'), c('household_id', 'string', 'Logged-in household.'), c('booking_id', 'string', 'Converted booking.')
  ], { partitionByYearOf: 'quote_date' }),
  silver('silver_web_sessions_daily', 'Web/app sessions per day, campaign and device (bot spikes removed).', 'One row per date × campaign × device.', ['session_date', 'campaign_code', 'device'], [
    c('session_date', 'date', 'Date.'), c('campaign_code', 'string', 'Campaign ("ORGANIC" for direct).'), c('device', 'string', 'Web Desktop / Web Mobile / Moonwake App.'),
    c('sessions', 'int', 'Sessions.'), c('quote_starts', 'int', 'Sessions that opened the quote form.')
  ], { partitionByYearOf: 'session_date' }),
  silver('silver_onboard_charges', 'Folio charges (sign errors corrected).', 'One row per charge.', ['charge_id'], [
    c('charge_id', 'string', 'Charge.'), c('booking_id', 'string', 'Booking.'), c('sailing_code', 'string', 'Sailing.'), c('charged_at', 'timestamp', 'Timestamp.'),
    c('charge_date', 'date', 'Date.'), c('venue', 'string', 'Venue.'), c('crew_id', 'string', 'Crew member.'), c('quantity', 'int', 'Quantity.'), c('amount', 'decimal', 'Amount.')
  ], { partitionByYearOf: 'charge_date' }),
  silver('silver_crew_snapshots', 'Month-end crew roster snapshots (contract dates parsed) — input for the SCD2 crew dimension.', 'One row per crew member per month-end.', ['snapshot_date', 'crew_id'], [
    c('snapshot_date', 'date', 'Snapshot date.'), c('crew_id', 'string', 'Crew id.'), c('full_name', 'string', 'Name.'), c('rank', 'string', 'Rank.'), c('department', 'string', 'Department.'),
    c('ship_code', 'string', 'Ship.'), c('contract_type', 'string', 'Contract.'), c('employment_status', 'string', 'Status.'), c('contract_start', 'date', 'Hire date.')
  ], { partitionByYearOf: 'snapshot_date' }),
  silver('silver_space_weather', 'Space-weather advisories from the traffic authority feed.', 'One row per advisory.', ['advisory_id'], [
    c('advisory_id', 'string', 'Advisory.'), c('issued_on', 'date', 'Issued.'), c('region', 'string', 'Region affected.'), c('level', 'string', 'Watch / Warning / Severe.'),
    c('valid_until', 'date', 'Valid until.'), c('headline', 'string', 'Headline.')
  ])
]

export const MOONWAKE_TABLES: TableSpec[] = [
  dimShip, dimCabinClass, dimPort, dimSailing, bridgeSailingPort, dimFareClass, dimHousehold, dimCampaign, dimSpend, dimCrew, dimProfile,
  factBooking, factInventory, factOnboard, factQuote, ...silverTables
]

// ---------------------------------------------------------------------------------------------
// Bronze

export const MOONWAKE_SOURCES: BronzeSourceDoc[] = [
  { id: 'booking_api', system: 'StarBerth booking API', pattern: 'booking_api/YYYY/MM/bookings_YYYYMMDD.json', format: 'json', cadence: 'daily', description: 'Daily JSON envelope of booking-created events with nested passengers and an amounts object. API v2 renamed `fareClass` → `fare_code` and added `insurance`. Retries re-send events; offline agencies sync late.' },
  { id: 'legacy', system: 'Legacy reservations system', pattern: 'booking_api/legacy/legacy_bookings_export.csv', format: 'csv', cadence: 'one-off', description: 'Bookings taken before StarBerth went live (migrated on go-live day).' },
  { id: 'payments', system: 'CreditVault payments', pattern: 'payments/YYYY/payments_YYYYMM.csv', format: 'csv', cadence: 'monthly', description: 'Deposits and final payments; pre-go-live payments are in payments/legacy_payments.csv.' },
  { id: 'fare_sheet', system: 'Revenue management workbook', pattern: 'pricing/fare_sheet_YYYY.xlsx', format: 'xlsx', cadence: 'yearly', description: 'Base rate per itinerary × cabin class with title lines above the header.' },
  { id: 'clickstream', system: 'Beacon web analytics', pattern: 'web/YYYY/MM/DD/quotes_YYYYMMDD.ndjson', format: 'ndjson', cadence: 'daily', description: 'Quote-request events with UTM campaign code, device and (if logged in) household.' },
  { id: 'web_sessions', system: 'Beacon web analytics', pattern: 'web/sessions/sessions_YYYYMM.csv', format: 'csv', cadence: 'monthly', description: 'Sessions per day, campaign and device.' },
  { id: 'fleet', system: 'Fleet registry service', pattern: 'fleet/fleet_registry.json', format: 'json', cadence: 'snapshot', description: 'Ships with a nested cabin-class inventory.' },
  { id: 'itineraries', system: 'Voyage planning', pattern: 'itineraries/{ports,itineraries,port_calls,sailings}.csv', format: 'csv', cadence: 'snapshot', description: 'Ports, itineraries, port calls and the sailing schedule.' },
  { id: 'campaigns', system: 'Marketing planner', pattern: 'marketing/campaigns.json', format: 'json', cadence: 'snapshot', description: 'Campaign master with budgets.' },
  { id: 'crm', system: 'Orbit CRM', pattern: 'crm/households_export.ndjson', format: 'ndjson', cadence: 'snapshot', description: 'Household export as of today.' },
  { id: 'onboard', system: 'ShipBoard folio', pattern: 'onboard/<ship>/YYYY/folio_<sailing>.csv', format: 'csv', cadence: 'per sailing', description: 'Folio charges uploaded when a ship returns (or nightly while in space).' },
  { id: 'crew', system: 'CrewLink HR', pattern: 'crew/crew_roster_YYYYMM.csv', format: 'csv', cadence: 'monthly snapshot', description: 'Month-end crew roster — diff to rebuild SCD2 history.' },
  { id: 'space_weather', system: 'Traffic authority advisory feed', pattern: 'ops/space_weather_advisories.json', format: 'json', cadence: 'snapshot', description: 'Solar-storm watches and warnings.' }
]

export const MOONWAKE_ISSUES: IssueDoc[] = [
  { code: 'MW01', kind: 'duplicates', source: 'booking_api', description: 'API retries re-send booking events (exact duplicates).', fix: 'Deduplicate on bookingRef.' },
  { code: 'MW02', kind: 'late_arriving', source: 'booking_api', column: 'bookedAt', dateColumn: 'bookedAt', description: 'Travel-agent bookings sync 2-8 days late into a later daily file.', fix: 'Use bookedAt, not the file date.' },
  { code: 'MW03', kind: 'schema_drift', source: 'booking_api', description: 'API v2: fareClass renamed fare_code; insurance flag added.', fix: 'Coalesce the two field names; derive insurance from the amounts object for v1.' },
  { code: 'MW04', kind: 'mixed_date_formats', source: 'payments', column: 'paid_on', description: 'paid_on in ISO, US, EU and "Mon d, yyyy".', fix: 'Parse with a format list.' },
  { code: 'MW05', kind: 'formatted_numbers', source: 'payments', column: 'amount', description: 'Amounts exported as text ("₡1,234.50", "1.234,50", "1234.50 STC").', fix: 'Strip symbols/codes, normalise separators.' },
  { code: 'MW06', kind: 'whitespace', source: 'payments', column: 'booking_ref', description: 'Padded booking references.', fix: 'TRIM before joining.' },
  { code: 'MW07', kind: 'sentinel_values', source: 'fare_sheet', column: 'Rate', sentinels: ['N/A', '-1'], description: 'Cabin classes not sold on an itinerary carry "N/A" or -1.', fix: 'Drop sentinel rows.' },
  { code: 'MW08', kind: 'casing', source: 'clickstream', column: 'utm_campaign', description: 'UTM codes in mixed case.', fix: 'UPPER(TRIM(utm_campaign)).' },
  { code: 'MW09', kind: 'orphan_keys', source: 'clickstream', column: 'utm_campaign', ref: { table: 'silver_campaigns', column: 'campaign_code' }, description: 'Typo\'d UTM codes that match no campaign.', fix: 'Keep the code; attribute to campaign_key -1 (Unknown) in gold.' },
  { code: 'MW10', kind: 'nulls', source: 'clickstream', column: 'device', description: 'Device missing on some events.', fix: 'Map to "Unknown".' },
  { code: 'MW11', kind: 'outliers', source: 'web_sessions', column: 'sessions', rule: 'extreme', description: 'Bot storms inflate sessions ×100 for a campaign-day.', fix: 'Silver drops bot traffic (sessions restored from the bot-filtered feed).' },
  { code: 'MW12', kind: 'casing', source: 'fleet', column: 'ship.class', description: 'Ship class names in inconsistent case.', fix: 'Title-case.' },
  { code: 'MW13', kind: 'whitespace', source: 'itineraries', column: 'port_code', description: 'Padded port codes in the port-call list.', fix: 'TRIM.' },
  { code: 'MW14', kind: 'duplicates', source: 'crm', description: 'Households exported twice.', fix: 'Deduplicate on household_id.' },
  { code: 'MW15', kind: 'nulls', source: 'crm', column: 'email', description: 'E-mail blank or "NULL" / "n/a".', fix: 'Normalise placeholders to null.' },
  { code: 'MW16', kind: 'mixed_date_formats', source: 'crm', column: 'customer_since', description: 'customer_since in several formats incl. epoch seconds.', fix: 'Parse each format.' },
  { code: 'MW17', kind: 'outliers', source: 'onboard', column: 'amount', rule: 'negative', description: 'Sign-flipped charge amounts keyed by the folio terminal.', fix: 'ABS(amount) — charges are never negative.' },
  { code: 'MW18', kind: 'mixed_date_formats', source: 'crew', column: 'contract_start', description: 'contract_start in mixed formats.', fix: 'Parse with a format list.' }
]

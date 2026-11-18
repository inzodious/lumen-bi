/**
 * Pixel Pagoda Arcades — table specifications (silver + gold), bronze sources and planted issues.
 */
import { c } from '../../schema.ts'
import type { BronzeSourceDoc, IssueDoc, TableSpec } from '../../schema.ts'

const D = 'gold_dim_date'

// ---------------------------------------------------------------------------------------------
// Gold dimensions

const dimVenue: TableSpec = {
  name: 'gold_dim_venue',
  layer: 'gold',
  kind: 'dim',
  description: 'Arcade venues: flagship pagodas, mall arcades, bar-cades and pop-ups.',
  grain: 'One row per venue.',
  key: ['venue_key'],
  columns: [
    c('venue_key', 'int', 'Surrogate key.'),
    c('venue_code', 'string', 'Business key, e.g. "PP-V03".', { nullable: false }),
    c('venue_name', 'string', 'Venue name.'),
    c('venue_type', 'string', 'Flagship Pagoda / Mall Arcade / Bar-cade / Pop-up.'),
    c('city', 'string', 'City (fictional).', { category: 'City' }),
    c('region', 'string', 'Region (fictional).'),
    c('latitude', 'double', 'Latitude (fictional placement).', { category: 'Latitude', summarize: 'none', format: '0.0000' }),
    c('longitude', 'double', 'Longitude (fictional placement).', { category: 'Longitude', summarize: 'none', format: '0.0000' }),
    c('opened_date', 'date', 'Opening date.'),
    c('open_hour', 'int', 'Opening hour (24h clock).'),
    c('close_hour', 'int', 'Closing hour (24 = midnight).'),
    c('open_hours_per_day', 'int', 'Trading hours on an open day.'),
    c('closed_weekdays', 'string', 'Weekdays the venue is closed (blank = open daily).'),
    c('machine_capacity', 'int', 'Cabinet slots on the floor.'),
    c('is_21_plus', 'bool', 'Adults-only bar-cade.')
  ],
  model: { name: 'Venue', hierarchies: [{ name: 'Geography', levels: ['region', 'city', 'venue_name'] }] }
}

const dimGame: TableSpec = {
  name: 'gold_dim_game',
  layer: 'gold',
  kind: 'dim',
  description: 'Game titles (all invented) with genre hierarchy and fictional manufacturers.',
  grain: 'One row per game title.',
  key: ['game_key'],
  columns: [
    c('game_key', 'int', 'Surrogate key.'),
    c('game_code', 'string', 'Business key, e.g. "G-014".'),
    c('title', 'string', 'Game title.'),
    c('genre', 'string', 'Shooter / Fighter / Racer / Platformer / Puzzle / Rhythm / Pinball / Redemption.'),
    c('genre_group', 'string', 'Video / Pinball / Redemption.'),
    c('manufacturer', 'string', 'Cabinet maker (fictional).'),
    c('release_year', 'int', 'Original release year (in-universe).', { format: '0' }),
    c('era', 'string', 'Golden Age / 16-bit / Modern Retro / New Release.'),
    c('max_players', 'int', 'Players per cabinet.'),
    c('credits_per_play', 'int', 'Credits charged per play.'),
    c('chain_launch_date', 'date', 'Date the title first appeared in a Pixel Pagoda venue.')
  ],
  model: { name: 'Game', hierarchies: [{ name: 'Catalogue', levels: ['genre_group', 'genre', 'title'] }] }
}

const dimMachine: TableSpec = {
  name: 'gold_dim_machine',
  layer: 'gold',
  kind: 'dim',
  description: 'Physical cabinets with full history (SCD Type 2): venue moves, firmware updates and retirement each open a new version.',
  grain: 'One row per cabinet version.',
  key: ['machine_sk'],
  scd2: { businessKey: 'machine_id', from: 'valid_from', to: 'valid_to', current: 'is_current' },
  columns: [
    c('machine_sk', 'int', 'Surrogate key of the version.', { label: 'Machine SK' }),
    c('machine_id', 'string', 'Asset tag, e.g. "CAB-0042".', { label: 'Machine ID' }),
    c('serial_number', 'string', 'Manufacturer serial.'),
    c('game_code', 'string', 'Game the cabinet runs.'),
    c('game_title', 'string', 'Game title.'),
    c('venue_code', 'string', 'Venue in this version.'),
    c('venue_name', 'string', 'Venue name in this version.'),
    c('firmware_version', 'string', 'Firmware in this version.'),
    c('cabinet_status', 'string', 'Active / Retired.'),
    c('purchase_date', 'date', 'Acquisition date.'),
    c('purchase_cost', 'decimal', 'Acquisition cost (USD).', { format: '$#,0', summarize: 'none' }),
    c('valid_from', 'date', 'Version start (inclusive).', { folder: 'SCD2' }),
    c('valid_to', 'date', 'Version end (inclusive; 9999-12-31 = open).', { folder: 'SCD2' }),
    c('is_current', 'bool', 'Current version flag.', { folder: 'SCD2' }),
    c('version', 'int', 'Version number per cabinet.', { folder: 'SCD2', summarize: 'none' })
  ],
  model: { name: 'Machine' }
}

const dimMember: TableSpec = {
  name: 'gold_dim_member',
  layer: 'gold',
  kind: 'dim',
  description: 'Pagoda Pass members (current state). Key -1 = guest / walk-in player.',
  grain: 'One row per member (plus the guest member).',
  key: ['member_key'],
  columns: [
    c('member_key', 'int', 'Surrogate key (-1 = Guest).'),
    c('member_id', 'string', 'Business key, e.g. "PX-00042".', { label: 'Member ID' }),
    c('gamer_tag', 'string', 'Public gamer tag.'),
    c('is_guest', 'bool', 'True for the guest member.'),
    c('current_tier', 'string', 'Pixel / Sprite / Boss / Legend (Guest for -1).', { sortBy: 'tier_rank' }),
    c('tier_rank', 'int', 'Tier order 0-4.', { hidden: true }),
    c('membership_status', 'string', 'Active / Cancelled.'),
    c('join_date', 'date', 'Program join date.'),
    c('cancel_date', 'date', 'Date the member left the program (blank = still a member).'),
    c('home_venue_code', 'string', 'Venue the member plays at most.'),
    c('age_band', 'string', 'Age band.'),
    c('email_opt_in', 'bool', 'Marketing e-mail consent.')
  ],
  model: { name: 'Member' }
}

const dimTier: TableSpec = {
  name: 'gold_dim_tier',
  layer: 'gold',
  kind: 'dim',
  description: 'Membership tiers and their perks. Key -1 = no membership (guest).',
  grain: 'One row per tier.',
  key: ['tier_key'],
  columns: [
    c('tier_key', 'int', 'Surrogate key (-1 = Guest).'),
    c('tier_name', 'string', 'Tier name.', { sortBy: 'tier_rank' }),
    c('tier_rank', 'int', 'Tier order.', { hidden: true }),
    c('monthly_fee', 'decimal', 'Monthly fee (USD).', { format: '$#,0.00', summarize: 'none' }),
    c('bonus_credit_pct', 'double', 'Bonus credits on every top-up.', { format: '0%', summarize: 'none' }),
    c('ticket_multiplier', 'double', 'Multiplier on tickets won.', { format: '0.00', summarize: 'none' }),
    c('is_paid', 'bool', 'Paid tier.')
  ],
  model: { name: 'Tier' }
}

const dimCampaign: TableSpec = {
  name: 'gold_dim_campaign',
  layer: 'gold',
  kind: 'dim',
  description: 'Marketing campaigns and promo nights. Key -1 = no campaign.',
  grain: 'One row per campaign (plus "No Campaign").',
  key: ['campaign_key'],
  columns: [
    c('campaign_key', 'int', 'Surrogate key (-1 = none).'),
    c('campaign_code', 'string', 'Business key.'),
    c('campaign_name', 'string', 'Campaign name.'),
    c('campaign_type', 'string', 'Retro Night / Themed Weekend / Seasonal / Launch / None.'),
    c('channel', 'string', 'Social / Email / Influencer / In-venue.'),
    c('target_venue', 'string', 'Venue code or "All venues".'),
    c('theme_genre', 'string', 'Genre the campaign spotlights.'),
    c('start_date', 'date', 'First day.'),
    c('end_date', 'date', 'Last day.'),
    c('budget_usd', 'decimal', 'Marketing budget (USD).', { format: '$#,0', summarize: 'none' })
  ],
  model: { name: 'Campaign' }
}

const dimTournament: TableSpec = {
  name: 'gold_dim_tournament',
  layer: 'gold',
  kind: 'dim',
  description: 'Esports tournaments hosted in venues. Key -1 = not tournament related.',
  grain: 'One row per tournament (plus the "No Tournament" member).',
  key: ['tournament_key'],
  columns: [
    c('tournament_key', 'int', 'Surrogate key (-1 = none).'),
    c('tournament_code', 'string', 'Business key.'),
    c('tournament_name', 'string', 'Tournament name.'),
    c('bracket_format', 'string', 'Single Elimination / Double Elimination / Round Robin / Swiss.'),
    c('venue_code', 'string', 'Host venue.'),
    c('venue_name', 'string', 'Host venue name.'),
    c('tournament_date', 'date', 'Event date.'),
    c('entry_fee', 'decimal', 'Entry fee (USD, 0 = free).', { format: '$#,0.00', summarize: 'none' }),
    c('prize_pool', 'decimal', 'Prize pool (USD).', { format: '$#,0', summarize: 'none' }),
    c('max_entrants', 'int', 'Bracket size.', { summarize: 'none' }),
    c('entrants', 'int', 'Players who entered.', { summarize: 'none' })
  ],
  model: { name: 'Tournament' }
}

const bridgeTournamentGame: TableSpec = {
  name: 'gold_bridge_tournament_game',
  layer: 'gold',
  kind: 'bridge',
  description: 'Games played in each tournament (a tournament can feature several games and a game appears in many tournaments).',
  grain: 'One row per tournament × game.',
  key: ['tournament_key', 'game_key'],
  fks: [
    { column: 'tournament_key', table: 'gold_dim_tournament', bidirectional: true },
    { column: 'game_key', table: 'gold_dim_game' }
  ],
  columns: [
    c('tournament_key', 'int', 'Tournament.'),
    c('game_key', 'int', 'Game.'),
    c('is_final_game', 'bool', 'Game used for the grand final.')
  ],
  model: { name: 'Tournament Game' }
}

const dimPrize: TableSpec = {
  name: 'gold_dim_prize',
  layer: 'gold',
  kind: 'dim',
  description: 'Prize-counter catalogue. Key -1 = retired / unknown prize code.',
  grain: 'One row per prize (plus the unknown member).',
  key: ['prize_key'],
  columns: [
    c('prize_key', 'int', 'Surrogate key (-1 = unknown).'),
    c('prize_code', 'string', 'Business key.'),
    c('prize_name', 'string', 'Prize name.'),
    c('prize_category', 'string', 'Candy / Toys / Plush / Apparel / Gadgets.'),
    c('ticket_cost', 'int', 'Tickets needed.', { summarize: 'none' }),
    c('unit_cost', 'decimal', 'Cost to the company (USD).', { format: '$#,0.00', summarize: 'none' })
  ],
  model: { name: 'Prize', hierarchies: [{ name: 'Prizes', levels: ['prize_category', 'prize_name'] }] }
}

const dimPayment: TableSpec = {
  name: 'gold_dim_payment',
  layer: 'gold',
  kind: 'dim',
  description: 'Junk dimension: payment method × sales channel. Key -1 = not a cash transaction.',
  grain: 'One row per payment method × channel.',
  key: ['payment_key'],
  columns: [
    c('payment_key', 'int', 'Surrogate key (-1 = n/a).'),
    c('payment_method', 'string', 'Card / Cash / Mobile Wallet / Gift Card / n/a.'),
    c('sales_channel', 'string', 'Kiosk / Counter / App / n/a.'),
    c('is_digital', 'bool', 'Paid in the app.')
  ],
  model: { name: 'Payment' }
}

const dimFault: TableSpec = {
  name: 'gold_dim_fault',
  layer: 'gold',
  kind: 'dim',
  description: 'Fault codes used by technicians (incl. preventive maintenance).',
  grain: 'One row per fault code.',
  key: ['fault_key'],
  columns: [
    c('fault_key', 'int', 'Surrogate key.'),
    c('fault_code', 'string', 'Business key.'),
    c('fault_name', 'string', 'Fault description.'),
    c('fault_category', 'string', 'Mechanical / Electrical / Display / Software / Redemption / Pinball / Preventive.'),
    c('severity', 'string', 'Low / Medium / High.'),
    c('typical_repair_hours', 'double', 'Typical hands-on repair time.', { format: '0.0', summarize: 'none' })
  ],
  model: { name: 'Fault' }
}

// ---------------------------------------------------------------------------------------------
// Gold facts

const factPlay: TableSpec = {
  name: 'gold_fact_play',
  layer: 'gold',
  kind: 'fact',
  factType: 'transaction',
  description: 'Every credit session on every cabinet (cabinet telemetry play_end events).',
  grain: 'One row per play.',
  key: ['play_id'],
  partitionByYearOf: 'play_date',
  fks: [
    { column: 'date_key', table: D },
    { column: 'time_key', table: 'gold_dim_time' },
    { column: 'venue_key', table: 'gold_dim_venue' },
    { column: 'machine_sk', table: 'gold_dim_machine' },
    { column: 'game_key', table: 'gold_dim_game' },
    { column: 'member_key', table: 'gold_dim_member' },
    { column: 'campaign_key', table: 'gold_dim_campaign' }
  ],
  columns: [
    c('play_id', 'string', 'Play id.', { label: 'Play ID' }),
    c('play_date', 'date', 'Business date (partition source).', { exclude: true }),
    c('date_key', 'int', 'Play date.'),
    c('time_key', 'int', 'Play start (15-minute slot).'),
    c('venue_key', 'int', 'Venue.'),
    c('machine_sk', 'int', 'Cabinet version in effect.', { label: 'Machine SK' }),
    c('game_key', 'int', 'Game.'),
    c('member_key', 'int', 'Member (-1 = guest card).'),
    c('campaign_key', 'int', 'Campaign running at the time (-1 = none).'),
    c('credits', 'int', 'Credits spent.'),
    c('revenue', 'decimal', 'credits × credit price (USD).', { format: '$#,0.00' }),
    c('duration_sec', 'int', 'Session length (seconds).'),
    c('score', 'int', 'Final score (blank when the cabinet logged an overflow glitch).', { summarize: 'max' }),
    c('tickets_won', 'int', 'Redemption tickets dispensed.'),
    c('is_top_score', 'bool', 'Beat the venue high score for this game.')
  ],
  model: { name: 'Plays' }
}

const factMachineDay: TableSpec = {
  name: 'gold_fact_machine_day',
  layer: 'gold',
  kind: 'fact',
  factType: 'periodic snapshot',
  description: 'Daily cabinet scorecard: open hours, uptime, downtime, plays, revenue, tickets and error events. Uptime + downtime = open hours; plays/credits/revenue/tickets equal the day\'s Plays.',
  grain: 'One row per installed cabinet per day its venue is open.',
  key: ['machine_sk', 'date_key'],
  partitionByYearOf: 'snapshot_date',
  fks: [
    { column: 'date_key', table: D },
    { column: 'venue_key', table: 'gold_dim_venue' },
    { column: 'machine_sk', table: 'gold_dim_machine' },
    { column: 'game_key', table: 'gold_dim_game' }
  ],
  columns: [
    c('machine_sk', 'int', 'Cabinet version.', { label: 'Machine SK' }),
    c('date_key', 'int', 'Date.'),
    c('snapshot_date', 'date', 'Business date (partition source).', { exclude: true }),
    c('venue_key', 'int', 'Venue.'),
    c('game_key', 'int', 'Game.'),
    c('open_hours', 'double', 'Venue trading hours that day.', { format: '#,0.0' }),
    c('uptime_hours', 'double', 'Hours the cabinet was playable.', { format: '#,0.0' }),
    c('downtime_hours', 'double', 'Hours out of order during trading hours.', { format: '#,0.0' }),
    c('plays', 'int', 'Plays.'),
    c('credits', 'int', 'Credits spent.'),
    c('revenue', 'decimal', 'Credit revenue (USD).', { format: '$#,0.00' }),
    c('tickets_out', 'int', 'Tickets dispensed.'),
    c('error_events', 'int', 'Telemetry error events (rise before breakdowns).'),
    c('is_down_at_close', 'bool', 'Out of order at closing time.'),
    c('wear_index', 'double', 'Mechanical wear estimate 0-100+ (resets after repairs).', { format: '0.0', summarize: 'average' })
  ],
  model: { name: 'Machine Day' }
}

const factTicket: TableSpec = {
  name: 'gold_fact_maintenance_ticket',
  layer: 'gold',
  kind: 'fact',
  factType: 'accumulating snapshot',
  description: 'Maintenance tickets through their lifecycle (opened → assigned → resolved), with breakdown downtime and cost.',
  grain: 'One row per maintenance ticket.',
  key: ['ticket_id'],
  fks: [
    { column: 'opened_date_key', table: D, role: 'Opened Date' },
    { column: 'assigned_date_key', table: D, role: 'Assigned Date', inactive: true, nullable: true },
    { column: 'resolved_date_key', table: D, role: 'Resolved Date', inactive: true, nullable: true },
    { column: 'machine_sk', table: 'gold_dim_machine' },
    { column: 'venue_key', table: 'gold_dim_venue' },
    { column: 'game_key', table: 'gold_dim_game' },
    { column: 'fault_key', table: 'gold_dim_fault' }
  ],
  columns: [
    c('ticket_id', 'string', 'Helpdesk ticket id.', { label: 'Ticket ID' }),
    c('machine_sk', 'int', 'Cabinet version when the ticket opened.', { label: 'Machine SK' }),
    c('venue_key', 'int', 'Venue.'),
    c('game_key', 'int', 'Game.'),
    c('fault_key', 'int', 'Fault code.'),
    c('opened_date_key', 'int', 'Opened date (active relationship).'),
    c('assigned_date_key', 'int', 'Technician assigned (inactive relationship).'),
    c('resolved_date_key', 'int', 'Resolved date (inactive relationship; blank while open).'),
    c('opened_at', 'timestamp', 'Opened timestamp.'),
    c('resolved_at', 'timestamp', 'Resolved timestamp.'),
    c('ticket_type', 'string', 'Breakdown / Preventive.'),
    c('priority', 'string', 'P1 / P2 / P3.'),
    c('technician', 'string', 'Technician (Unassigned when the helpdesk sent "TBD").'),
    c('response_hours', 'double', 'Hours from open to assignment.', { format: '0.0', summarize: 'average' }),
    c('repair_hours', 'double', 'Hours from assignment to resolution (incl. waiting for parts).', { format: '0.0', summarize: 'average' }),
    c('downtime_hours', 'double', 'Trading hours lost while the cabinet was down.', { format: '#,0.0' }),
    c('parts_cost', 'decimal', 'Parts (USD).', { format: '$#,0.00' }),
    c('labor_cost', 'decimal', 'Technician labor (USD).', { format: '$#,0.00' }),
    c('status', 'string', 'Open / Resolved.')
  ],
  model: { name: 'Maintenance' }
}

const factEntry: TableSpec = {
  name: 'gold_fact_tournament_entry',
  layer: 'gold',
  kind: 'fact',
  factType: 'factless',
  description: 'Factless participation fact: who entered which tournament (count rows). Seed/placement are degenerate attributes.',
  grain: 'One row per tournament entry.',
  key: ['entry_id'],
  fks: [
    { column: 'tournament_key', table: 'gold_dim_tournament' },
    { column: 'member_key', table: 'gold_dim_member' },
    { column: 'venue_key', table: 'gold_dim_venue' },
    { column: 'date_key', table: D, role: 'Tournament Date' },
    { column: 'registered_date_key', table: D, role: 'Registered Date', inactive: true }
  ],
  columns: [
    c('entry_id', 'string', 'Entry id.', { label: 'Entry ID' }),
    c('tournament_key', 'int', 'Tournament.'),
    c('member_key', 'int', 'Player (-1 = walk-in without a membership).'),
    c('venue_key', 'int', 'Host venue.'),
    c('date_key', 'int', 'Tournament date (active).'),
    c('registered_date_key', 'int', 'Registration date (inactive).'),
    c('seed', 'int', 'Bracket seed.', { summarize: 'none' }),
    c('placement', 'int', 'Final placement (1 = winner).', { summarize: 'none' }),
    c('is_winner', 'bool', 'Won the tournament.')
  ],
  model: { name: 'Tournament Entries' }
}

const factWallet: TableSpec = {
  name: 'gold_fact_wallet_txn',
  layer: 'gold',
  kind: 'fact',
  factType: 'transaction',
  description: 'Game-card wallet ledger: credit top-ups, membership fees, tournament entry fees and prize redemptions.',
  grain: 'One row per wallet transaction.',
  key: ['txn_id'],
  partitionByYearOf: 'txn_date',
  fks: [
    { column: 'date_key', table: D },
    { column: 'time_key', table: 'gold_dim_time' },
    { column: 'venue_key', table: 'gold_dim_venue' },
    { column: 'member_key', table: 'gold_dim_member' },
    { column: 'tier_key', table: 'gold_dim_tier' },
    { column: 'payment_key', table: 'gold_dim_payment' },
    { column: 'prize_key', table: 'gold_dim_prize' },
    { column: 'tournament_key', table: 'gold_dim_tournament' }
  ],
  columns: [
    c('txn_id', 'string', 'Transaction id.', { label: 'Txn ID' }),
    c('txn_date', 'date', 'Business date (partition source).', { exclude: true }),
    c('date_key', 'int', 'Date.'),
    c('time_key', 'int', 'Time (15-minute slot).'),
    c('venue_key', 'int', 'Venue.'),
    c('member_key', 'int', 'Member (-1 = guest).'),
    c('tier_key', 'int', 'Member tier at the time (-1 = guest).'),
    c('payment_key', 'int', 'Payment method × channel (-1 = no payment).'),
    c('prize_key', 'int', 'Prize redeemed (-1 = none / unknown code).'),
    c('tournament_key', 'int', 'Tournament entered (-1 = none).'),
    c('txn_type', 'string', 'Top-Up / Membership Fee / Tournament Entry / Prize Redemption.'),
    c('amount_usd', 'decimal', 'Cash received (0 for redemptions).', { format: '$#,0.00' }),
    c('credits_issued', 'int', 'Credits loaded (incl. bonus).'),
    c('bonus_credits', 'int', 'Tier bonus credits included in credits_issued.'),
    c('tickets_redeemed', 'int', 'Tickets spent at the prize counter.'),
    c('prize_quantity', 'int', 'Prizes handed out.'),
    c('prize_cost', 'decimal', 'Cost of prizes handed out (USD).', { format: '$#,0.00' })
  ],
  model: { name: 'Wallet' }
}

// ---------------------------------------------------------------------------------------------
// Silver

const silver = (name: string, description: string, grain: string, key: string[], columns: TableSpec['columns'], extra: Partial<TableSpec> = {}): TableSpec => ({
  name, layer: 'silver', kind: 'entity', description, grain, key, columns, ...extra
})

const silverTables: TableSpec[] = [
  silver('silver_venues', 'Venue master (from the venues API).', 'One row per venue.', ['venue_code'], [
    c('venue_code', 'string', 'Venue code.', { nullable: false }),
    c('venue_name', 'string', 'Name.'),
    c('venue_type', 'string', 'Type.'),
    c('city', 'string', 'City.'),
    c('region', 'string', 'Region.'),
    c('latitude', 'double', 'Latitude.'),
    c('longitude', 'double', 'Longitude.'),
    c('opened_date', 'date', 'Opened.'),
    c('open_hour', 'int', 'Opening hour.'),
    c('close_hour', 'int', 'Closing hour.'),
    c('closed_weekdays', 'string', 'Closed weekdays.'),
    c('machine_capacity', 'int', 'Cabinet slots.')
  ]),
  silver('silver_games', 'Game catalogue.', 'One row per title.', ['game_code'], [
    c('game_code', 'string', 'Code.', { nullable: false }),
    c('title', 'string', 'Title.'),
    c('genre', 'string', 'Genre.'),
    c('genre_group', 'string', 'Genre group.'),
    c('manufacturer', 'string', 'Maker.'),
    c('release_year', 'int', 'Release year.'),
    c('max_players', 'int', 'Players.'),
    c('credits_per_play', 'int', 'Credits per play.'),
    c('chain_launch_date', 'date', 'Chain launch.')
  ]),
  silver('silver_cabinets', 'Current cabinet register (serials trimmed).', 'One row per cabinet.', ['machine_id'], [
    c('machine_id', 'string', 'Asset tag.', { nullable: false }),
    c('serial_number', 'string', 'Serial.'),
    c('game_code', 'string', 'Game.'),
    c('venue_code', 'string', 'Current / last venue.'),
    c('firmware_version', 'string', 'Current firmware.'),
    c('cabinet_status', 'string', 'Active / Retired.'),
    c('purchase_date', 'date', 'Purchased.'),
    c('purchase_cost', 'decimal', 'Cost.')
  ]),
  silver('silver_cabinet_history', 'Cabinet change log (install, move, firmware, retire) with normalised dates — the source of the SCD2 machine dimension.', 'One row per cabinet change.', ['machine_id', 'effective_date', 'change_seq'], [
    c('machine_id', 'string', 'Asset tag.'),
    c('effective_date', 'date', 'Date the change took effect (parsed from mixed formats).'),
    c('change_seq', 'int', 'Order of changes on the same day.'),
    c('change_type', 'string', 'Installed / Moved / Firmware / Retired.'),
    c('venue_code', 'string', 'Venue after the change.'),
    c('firmware_version', 'string', 'Firmware after the change.')
  ]),
  silver('silver_prizes', 'Active prize catalogue (names trimmed, ticket costs parsed).', 'One row per prize.', ['prize_code'], [
    c('prize_code', 'string', 'Code.'),
    c('prize_name', 'string', 'Name.'),
    c('prize_category', 'string', 'Category.'),
    c('ticket_cost', 'int', 'Tickets.'),
    c('unit_cost', 'decimal', 'Unit cost.')
  ]),
  silver('silver_campaigns', 'Marketing campaign calendar.', 'One row per campaign.', ['campaign_code'], [
    c('campaign_code', 'string', 'Code.'),
    c('campaign_name', 'string', 'Name.'),
    c('campaign_type', 'string', 'Type.'),
    c('channel', 'string', 'Channel.'),
    c('target_venue', 'string', 'Target venue.'),
    c('theme_genre', 'string', 'Theme genre.'),
    c('start_date', 'date', 'Start.'),
    c('end_date', 'date', 'End.'),
    c('budget_usd', 'decimal', 'Budget.')
  ]),
  silver('silver_members', 'Members (deduplicated, tiers title-cased, dates parsed, e-mail placeholders nulled).', 'One row per member.', ['member_id'], [
    c('member_id', 'string', 'Member id.'),
    c('gamer_tag', 'string', 'Gamer tag.'),
    c('current_tier', 'string', 'Tier.'),
    c('membership_status', 'string', 'Active / Cancelled.'),
    c('join_date', 'date', 'Joined.'),
    c('cancel_date', 'date', 'Cancelled.'),
    c('home_venue_code', 'string', 'Home venue.'),
    c('age_band', 'string', 'Age band.'),
    c('email', 'string', 'E-mail (blank = not provided).'),
    c('email_opt_in', 'bool', 'Consent.')
  ]),
  silver('silver_membership_events', 'Join / upgrade / downgrade / cancel events.', 'One row per membership event.', ['member_id', 'event_date', 'event_seq'], [
    c('member_id', 'string', 'Member.'),
    c('event_date', 'date', 'Date.'),
    c('event_seq', 'int', 'Order of events on the same day.'),
    c('event_type', 'string', 'Join / Upgrade / Downgrade / Cancel.'),
    c('from_tier', 'string', 'Tier before.'),
    c('to_tier', 'string', 'Tier after.')
  ]),
  silver('silver_membership_billing', 'Monthly membership charges.', 'One row per paid member per billing date.', ['member_id', 'billing_date'], [
    c('member_id', 'string', 'Member.'),
    c('billing_date', 'date', 'Charge date.'),
    c('tier', 'string', 'Tier billed.'),
    c('fee', 'decimal', 'Fee.'),
    c('venue_code', 'string', 'Home venue.')
  ], { partitionByYearOf: 'billing_date' }),
  silver('silver_tournaments', 'Tournament schedule (from the bracket API).', 'One row per tournament.', ['tournament_code'], [
    c('tournament_code', 'string', 'Code.'),
    c('tournament_name', 'string', 'Name.'),
    c('bracket_format', 'string', 'Format.'),
    c('venue_code', 'string', 'Host venue.'),
    c('tournament_date', 'date', 'Date.'),
    c('entry_fee', 'decimal', 'Fee.'),
    c('prize_pool', 'decimal', 'Prize pool.'),
    c('max_entrants', 'int', 'Bracket size.')
  ]),
  silver('silver_tournament_games', 'Games featured per tournament.', 'One row per tournament × game.', ['tournament_code', 'game_code'], [
    c('tournament_code', 'string', 'Tournament.'),
    c('game_code', 'string', 'Game.'),
    c('is_final_game', 'bool', 'Grand-final game.')
  ]),
  silver('silver_tournament_entries', 'Tournament registrations and results (walk-in ids kept as-is).', 'One row per entry.', ['entry_id'], [
    c('entry_id', 'string', 'Entry id.'),
    c('tournament_code', 'string', 'Tournament.'),
    c('player_id', 'string', 'Member id or walk-in id.'),
    c('registered_date', 'date', 'Registered.'),
    c('seed', 'int', 'Seed.'),
    c('placement', 'int', 'Placement.')
  ]),
  silver('silver_plays', 'Cabinet play_end events (deduplicated, late events merged, duration normalised to seconds, overflow scores nulled).', 'One row per play.', ['play_id'], [
    c('play_id', 'string', 'Play id.'),
    c('machine_id', 'string', 'Cabinet.'),
    c('venue_code', 'string', 'Venue.'),
    c('started_at', 'timestamp', 'Start timestamp.'),
    c('business_date', 'date', 'Business date.'),
    c('member_id', 'string', 'Member (blank = guest card).'),
    c('credits', 'int', 'Credits.'),
    c('duration_sec', 'int', 'Duration in seconds.'),
    c('score', 'int', 'Score (null = overflow glitch).'),
    c('tickets_won', 'int', 'Tickets.'),
    c('campaign_code', 'string', 'Campaign running.')
  ], { partitionByYearOf: 'business_date' }),
  silver('silver_cabinet_errors', 'Cabinet telemetry error events.', 'One row per error event.', ['error_id'], [
    c('error_id', 'string', 'Event id.'),
    c('machine_id', 'string', 'Cabinet.'),
    c('error_at', 'timestamp', 'Timestamp.'),
    c('business_date', 'date', 'Business date.'),
    c('error_code', 'string', 'Error code.'),
    c('firmware_version', 'string', 'Firmware at the time.')
  ], { partitionByYearOf: 'business_date' }),
  silver('silver_topups', 'Kiosk / counter / app credit top-ups (amounts parsed, payment methods canonicalised).', 'One row per top-up.', ['txn_id'], [
    c('txn_id', 'string', 'Transaction id.'),
    c('venue_code', 'string', 'Venue.'),
    c('sold_at', 'timestamp', 'Timestamp.'),
    c('business_date', 'date', 'Business date.'),
    c('member_id', 'string', 'Member (blank = guest).'),
    c('payment_method', 'string', 'Payment method.'),
    c('sales_channel', 'string', 'Channel.'),
    c('amount_usd', 'decimal', 'Amount.'),
    c('credits', 'int', 'Base credits.'),
    c('bonus_credits', 'int', 'Tier bonus credits.')
  ], { partitionByYearOf: 'business_date' }),
  silver('silver_redemptions', 'Prize-counter redemptions (retired prize codes kept as-is).', 'One row per redemption.', ['redemption_id'], [
    c('redemption_id', 'string', 'Redemption id.'),
    c('venue_code', 'string', 'Venue.'),
    c('redeemed_at', 'timestamp', 'Timestamp.'),
    c('business_date', 'date', 'Business date.'),
    c('member_id', 'string', 'Member (blank = guest).'),
    c('prize_code', 'string', 'Prize code.'),
    c('quantity', 'int', 'Quantity.'),
    c('tickets', 'int', 'Tickets spent.')
  ], { partitionByYearOf: 'business_date' }),
  silver('silver_maintenance_tickets', 'Helpdesk tickets ("TBD" technicians nulled).', 'One row per ticket.', ['ticket_id'], [
    c('ticket_id', 'string', 'Ticket id.'),
    c('machine_id', 'string', 'Cabinet.'),
    c('fault_code', 'string', 'Fault code.'),
    c('ticket_type', 'string', 'Breakdown / Preventive.'),
    c('priority', 'string', 'Priority.'),
    c('technician', 'string', 'Technician (null = unassigned).'),
    c('opened_at', 'timestamp', 'Opened.'),
    c('assigned_at', 'timestamp', 'Assigned.'),
    c('resolved_at', 'timestamp', 'Resolved.'),
    c('parts_cost', 'decimal', 'Parts cost.'),
    c('labor_cost', 'decimal', 'Labor cost.')
  ])
]

export const PIXELPAGODA_TABLES: TableSpec[] = [
  dimVenue, dimGame, dimMachine, dimMember, dimTier, dimCampaign, dimTournament, bridgeTournamentGame, dimPrize, dimPayment, dimFault,
  factPlay, factMachineDay, factTicket, factEntry, factWallet, ...silverTables
]

// ---------------------------------------------------------------------------------------------
// Bronze

export const PIXELPAGODA_SOURCES: BronzeSourceDoc[] = [
  { id: 'cabinet_events', system: 'PagodaLink cabinet telemetry agent', pattern: 'cabinets/YYYY/MM/DD/events_YYYYMMDD.ndjson', format: 'ndjson', cadence: 'daily', description: 'One JSON event per line (`play_end` and `error`). Agent v3 switched `duration_s` → `duration_ms` and added `cabinet_temp_c`. Offline cabinets upload days later.' },
  { id: 'kiosk', system: 'CoinCloud kiosk & counter POS', pattern: 'kiosk/YYYY/topups_YYYYMM.csv', format: 'csv', cadence: 'monthly', description: 'Credit top-ups with amounts sometimes exported as display text.' },
  { id: 'prize_counter', system: 'TicketTally prize counter', pattern: 'prize_counter/YYYY/redemptions_YYYYMM.csv', format: 'csv', cadence: 'monthly', description: 'Redemptions; retired prize codes still appear.' },
  { id: 'prize_catalogue', system: 'Merchandising workbook', pattern: 'catalogue/prize_catalogue.xlsx', format: 'xlsx', cadence: 'snapshot', description: 'Excel catalogue with a title line; ticket costs typed with thousands separators.' },
  { id: 'crm', system: 'Pagoda Pass CRM', pattern: 'crm/members_export.json', format: 'json', cadence: 'snapshot', description: 'Paged API export (`members` array in an envelope).' },
  { id: 'membership', system: 'Pagoda Pass CRM', pattern: 'crm/membership_events.ndjson + billing/YYYY/membership_billing_YYYYMM.csv', format: 'ndjson', cadence: 'snapshot + monthly', description: 'Tier change events and monthly billing runs.' },
  { id: 'assets', system: 'FloorPlan asset register', pattern: 'assets/{cabinet_register,cabinet_history}.csv', format: 'csv', cadence: 'snapshot', description: 'Current register plus the full install/move/firmware/retire log.' },
  { id: 'helpdesk', system: 'FixQuest helpdesk API', pattern: 'maintenance/YYYY/tickets_resolved_YYYYMM.json + maintenance/open_tickets.json', format: 'json', cadence: 'monthly', description: 'Resolved tickets per month and a snapshot of tickets still open.' },
  { id: 'esports', system: 'BracketBox', pattern: 'esports/tournaments.json + esports/YYYY/entries_YYYYMM.csv', format: 'csv', cadence: 'monthly', description: 'Tournament schedule and entries; walk-in players get ad-hoc ids.' },
  { id: 'marketing', system: 'Campaign planner', pattern: 'marketing/campaigns.csv', format: 'csv', cadence: 'snapshot', description: 'Semicolon-delimited CSV with BOM and CRLF.' },
  { id: 'venues', system: 'Venue ops API', pattern: 'venues/venues.json', format: 'json', cadence: 'snapshot', description: 'Venue master.' },
  { id: 'games', system: 'Game catalogue', pattern: 'catalogue/games.csv', format: 'csv', cadence: 'snapshot', description: 'Game titles and cabinet settings.' }
]

export const PIXELPAGODA_ISSUES: IssueDoc[] = [
  { code: 'PP01', kind: 'duplicates', source: 'cabinet_events', description: 'Agents retry uploads: some events appear twice.', fix: 'Deduplicate on (machine, ts, event).' },
  { code: 'PP02', kind: 'late_arriving', source: 'cabinet_events', column: 'ts', dateColumn: 'ts', description: 'Cabinets that lose connectivity upload 2-7 days late.', fix: 'Union all days; derive the business date from ts, not the folder.' },
  { code: 'PP03', kind: 'schema_drift', source: 'cabinet_events', description: 'Telemetry agent v3: duration_s became duration_ms and cabinet_temp_c appeared.', fix: 'duration_sec = coalesce(duration_s, duration_ms / 1000).' },
  { code: 'PP04', kind: 'outliers', source: 'cabinet_events', column: 'score', rule: 'extreme', description: 'Score counter overflow glitch logs 2147483647.', fix: 'Null scores equal to 2^31−1 and exclude them from high-score tables.' },
  { code: 'PP05', kind: 'formatted_numbers', source: 'kiosk', column: 'amount', description: 'Amounts exported as "$20.00", "20,00" or "20.00 USD".', fix: 'Strip currency and parse with the right decimal separator.' },
  { code: 'PP06', kind: 'casing', source: 'kiosk', column: 'method', description: 'Payment method in mixed case ("CARD", "mobile wallet").', fix: 'Map to canonical method names.' },
  { code: 'PP07', kind: 'orphan_keys', source: 'prize_counter', column: 'prize_code', ref: { table: 'silver_prizes', column: 'prize_code' }, description: 'Redemptions of retired prizes whose codes left the catalogue.', fix: 'Keep the row; map to prize_key -1 (Unknown / Retired).' },
  { code: 'PP08', kind: 'whitespace', source: 'prize_catalogue', column: 'Prize Name', description: 'Stray spaces/tabs around prize names.', fix: 'TRIM.' },
  { code: 'PP09', kind: 'duplicates', source: 'crm', description: 'Members exported twice across pages.', fix: 'Deduplicate on member_id.' },
  { code: 'PP10', kind: 'nulls', source: 'crm', column: 'email', description: 'E-mail blank or "NULL" / "n/a".', fix: 'Normalise placeholders to null.' },
  { code: 'PP11', kind: 'mixed_date_formats', source: 'crm', column: 'joined', description: 'Join dates in ISO, US, EU, long and epoch formats.', fix: 'Parse with a format list.' },
  { code: 'PP12', kind: 'casing', source: 'crm', column: 'tier', description: 'Tier names in mixed case ("LEGEND", "sprite").', fix: 'Title-case tiers.' },
  { code: 'PP13', kind: 'mixed_date_formats', source: 'assets', column: 'effective_date', description: 'Change-log dates typed by hand in several formats.', fix: 'Parse each format.' },
  { code: 'PP14', kind: 'sentinel_values', source: 'helpdesk', column: 'technician', sentinels: ['TBD', 'UNASSIGNED'], description: 'Technician placeholder values.', fix: 'Null them (shown as "Unassigned" in gold).' },
  { code: 'PP15', kind: 'orphan_keys', source: 'esports', column: 'player_id', ref: { table: 'silver_members', column: 'member_id' }, description: 'Walk-in players registered with ad-hoc ids that are not members.', fix: 'Keep the entry; map to member_key -1.' },
  { code: 'PP16', kind: 'whitespace', source: 'assets', column: 'serial_number', description: 'Serial numbers padded with spaces.', fix: 'TRIM.' }
]

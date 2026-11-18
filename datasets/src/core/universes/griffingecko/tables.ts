/**
 * Griffin & Gecko Creature Care — table specifications (silver + gold), bronze sources and planted issues.
 */
import { c } from '../../schema.ts'
import type { BronzeSourceDoc, IssueDoc, TableSpec } from '../../schema.ts'

const D = 'gold_dim_date'

// ---------------------------------------------------------------------------------------------
// Gold dimensions

const dimClinic: TableSpec = {
  name: 'gold_dim_clinic',
  layer: 'gold',
  kind: 'dim',
  description: 'Clinics, hospitals, aeries and aquatic centers — plus the Head Office cost center (which sees no patients).',
  grain: 'One row per clinic / cost center.',
  key: ['clinic_key'],
  columns: [
    c('clinic_key', 'int', 'Surrogate key.'),
    c('clinic_code', 'string', 'Business key, e.g. "GG-03" (GG-HQ = Head Office).', { nullable: false }),
    c('clinic_name', 'string', 'Clinic name.'),
    c('clinic_type', 'string', 'Creature Hospital / Creature Clinic / Aerie / Aquatic Center / Head Office.'),
    c('region', 'string', 'Region.'),
    c('district', 'string', 'District within the region.'),
    c('city', 'string', 'Town (fictional).', { category: 'City' }),
    c('opened_date', 'date', 'Opening date.'),
    c('exam_rooms', 'int', 'Exam rooms.'),
    c('has_flight_deck', 'bool', 'Landing deck for large flyers (dragons, griffins, pegasi).'),
    c('has_tank_wing', 'bool', 'Saltwater tank wing for krakens and sea serpents (as of today).'),
    c('tank_wing_opened', 'date', 'Date the tank wing opened (blank if none).'),
    c('is_patient_facing', 'bool', 'False for the Head Office cost center.')
  ],
  model: { name: 'Clinic', hierarchies: [{ name: 'Geography', levels: ['region', 'district', 'clinic_name'] }] }
}

const dimSpecies: TableSpec = {
  name: 'gold_dim_species',
  layer: 'gold',
  kind: 'dim',
  description: 'Creature taxonomy: Class → Species → Breed, with size class and typical lifespan.',
  grain: 'One row per breed.',
  key: ['species_key'],
  columns: [
    c('species_key', 'int', 'Surrogate key.'),
    c('breed_code', 'string', 'Business key, e.g. "BR-07".'),
    c('creature_class', 'string', 'Dragons / Griffins & Hippogriffs / Phoenixes & Firebirds / Basilisks / Sea Beasts / Garden Reptiles / Small Familiars / Legendary Equines.'),
    c('species', 'string', 'Species.'),
    c('breed', 'string', 'Breed.'),
    c('size_class', 'string', 'Tiny / Small / Large / Colossal — drives prices and visit length.', { sortBy: 'size_rank' }),
    c('size_rank', 'int', 'Size order 1-4.', { hidden: true }),
    c('typical_lifespan_years', 'int', 'Typical lifespan in years.'),
    c('is_aquatic', 'bool', 'Needs a tank wing.'),
    c('is_flyer', 'bool', 'Needs a flight deck when Large or bigger.'),
    c('is_fire_breathing', 'bool', 'Breathes fire (fireproof exam room required).')
  ],
  model: { name: 'Species', hierarchies: [{ name: 'Taxonomy', levels: ['creature_class', 'species', 'breed'] }] }
}

const dimOwner: TableSpec = {
  name: 'gold_dim_owner',
  layer: 'gold',
  kind: 'dim',
  description: 'Owners and households (wizard guilds and royal menageries included). Key -1 = Good Samaritan (strays brought in by the public).',
  grain: 'One row per owner (plus the unknown owner).',
  key: ['owner_key'],
  fks: [{ column: 'home_clinic_key', table: 'gold_dim_clinic', noModel: true, nullable: true }],
  columns: [
    c('owner_key', 'int', 'Surrogate key (-1 = Good Samaritan).'),
    c('owner_id', 'string', 'Business key, e.g. "OW-000123".'),
    c('household_name', 'string', 'Household / organisation name.'),
    c('owner_type', 'string', 'Household / Wizard Guild / Farm / Royal Menagerie / Sanctuary.'),
    c('city', 'string', 'Town.'),
    c('care_plan', 'string', 'None / Hatchling Plan / Hoard Plan (10% off services).'),
    c('payer_name', 'string', 'Creature insurance provider (or Self-Pay).'),
    c('join_date', 'date', 'First registration.'),
    c('home_clinic_key', 'int', 'Clinic the household usually visits.'),
    c('email_opt_in', 'bool', 'Reminder e-mail consent.')
  ],
  model: { name: 'Owner' }
}

const dimPatient: TableSpec = {
  name: 'gold_dim_patient',
  layer: 'gold',
  kind: 'dim',
  description: 'Creature patients. Key -1 = unregistered stray.',
  grain: 'One row per patient (plus the unknown patient).',
  key: ['patient_key'],
  fks: [
    { column: 'species_key', table: 'gold_dim_species', noModel: true },
    { column: 'owner_key', table: 'gold_dim_owner', noModel: true }
  ],
  columns: [
    c('patient_key', 'int', 'Surrogate key (-1 = unregistered stray).'),
    c('patient_id', 'string', 'Business key, e.g. "PT-000042".'),
    c('patient_name', 'string', 'Name.'),
    c('species_key', 'int', 'Breed (also on the facts).'),
    c('owner_key', 'int', 'Owner (also on the facts).'),
    c('sex', 'string', 'Female / Male / Unknown (some creatures decline to say).'),
    c('birth_date', 'date', 'Hatch / birth date.'),
    c('weight_kg', 'double', 'Last recorded weight (blank when the scale reported a sentinel).', { summarize: 'none', format: '#,0.0' }),
    c('temperament', 'string', 'Gentle / Skittish / Grumpy / Incendiary.'),
    c('is_rune_tagged', 'bool', 'Identification rune applied (like a microchip).'),
    c('registered_date', 'date', 'Registration date.')
  ],
  model: { name: 'Patient' }
}

const dimStaff: TableSpec = {
  name: 'gold_dim_staff',
  layer: 'gold',
  kind: 'dim',
  description: 'Veterinarians, nurses, handlers and admin staff with full history (SCD Type 2): raises, promotions, specialty certifications, transfers, terminations.',
  grain: 'One row per staff member version.',
  key: ['staff_sk'],
  scd2: { businessKey: 'staff_id', from: 'valid_from', to: 'valid_to', current: 'is_current' },
  columns: [
    c('staff_sk', 'int', 'Surrogate key of the version.'),
    c('staff_id', 'string', 'Business key, e.g. "ST-0042".'),
    c('full_name', 'string', 'Name (fictional).'),
    c('role', 'string', 'Veterinarian / Senior Veterinarian / Vet Nurse / Creature Handler / Receptionist / Clinic Manager / Head Office.'),
    c('role_group', 'string', 'Veterinary / Nursing & Handling / Admin — maps to the payroll GL accounts.'),
    c('specialty', 'string', 'Draconic Medicine / Avian & Griffin / Aquatic / Herpetology / General.'),
    c('clinic_code', 'string', 'Clinic in this version.'),
    c('clinic_name', 'string', 'Clinic name in this version.'),
    c('salary_band', 'string', 'Band 1-7.'),
    c('annual_salary', 'decimal', 'Annual salary in this version (USD).', { format: '$#,0', summarize: 'none' }),
    c('employment_status', 'string', 'Active / Terminated.'),
    c('hire_date', 'date', 'Original hire date.'),
    c('valid_from', 'date', 'Version start (inclusive).', { folder: 'SCD2' }),
    c('valid_to', 'date', 'Version end (inclusive; 9999-12-31 = open).', { folder: 'SCD2' }),
    c('is_current', 'bool', 'Current version flag.', { folder: 'SCD2' }),
    c('version', 'int', 'Version number per staff member.', { folder: 'SCD2', summarize: 'none' })
  ],
  model: { name: 'Staff' }
}

const dimProcedure: TableSpec = {
  name: 'gold_dim_procedure',
  layer: 'gold',
  kind: 'dim',
  description: 'Billable services, procedures and medications with list price (for a Small creature) and revenue account.',
  grain: 'One row per billing code.',
  key: ['procedure_key'],
  columns: [
    c('procedure_key', 'int', 'Surrogate key.'),
    c('procedure_code', 'string', 'Billing code, e.g. "PX-204".'),
    c('procedure_name', 'string', 'Name.'),
    c('procedure_group', 'string', 'Consultation / Vaccination / Diagnostics / Surgery / Fang & Beak / Medication / Boarding & Care.'),
    c('item_category', 'string', 'Service / Medication.'),
    c('revenue_account_code', 'string', 'GL revenue account the line posts to.'),
    c('base_price', 'decimal', 'List price for a Small creature today (Tiny ×0.6, Large ×2.6, Colossal ×5.5).', { format: '$#,0.00' }),
    c('cost_ratio', 'double', 'Standard cost as a share of price.', { format: '0%', summarize: 'none' })
  ],
  model: { name: 'Procedure', hierarchies: [{ name: 'Billing', levels: ['item_category', 'procedure_group', 'procedure_name'] }] }
}

const dimDiagnosis: TableSpec = {
  name: 'gold_dim_diagnosis',
  layer: 'gold',
  kind: 'dim',
  description: 'Diagnoses with clinical grouping and severity.',
  grain: 'One row per diagnosis code.',
  key: ['diagnosis_key'],
  columns: [
    c('diagnosis_key', 'int', 'Surrogate key.'),
    c('diagnosis_code', 'string', 'Code, e.g. "DX-014".'),
    c('diagnosis_name', 'string', 'Name.'),
    c('diagnosis_group', 'string', 'Routine / Infectious / Parasitic / Injury / Dental / Behavioral / Gastro / Chronic / Aquatic / Reproductive.'),
    c('severity', 'string', 'Mild / Moderate / Severe.'),
    c('is_seasonal', 'bool', 'Has a seasonal pattern.')
  ],
  model: { name: 'Diagnosis', hierarchies: [{ name: 'Diagnoses', levels: ['diagnosis_group', 'diagnosis_name'] }] }
}

const dimAccount: TableSpec = {
  name: 'gold_dim_account',
  layer: 'gold',
  kind: 'dim',
  description: 'Chart of accounts with statement / type / group hierarchy.',
  grain: 'One row per GL account.',
  key: ['account_key'],
  columns: [
    c('account_key', 'int', 'Surrogate key.'),
    c('account_code', 'string', 'GL account number.'),
    c('account_name', 'string', 'Account name.', { sortBy: 'sort_order' }),
    c('statement', 'string', 'Profit & Loss / Balance Sheet.'),
    c('account_type', 'string', 'Revenue / Cost of Sales / Operating Expense / Asset / Liability.', { sortBy: 'type_order' }),
    c('account_group', 'string', 'Reporting group (e.g. Payroll, Facilities).'),
    c('normal_balance', 'string', 'Debit / Credit.'),
    c('pl_sign', 'int', '+1 for revenue, -1 for costs (multiply P&L amounts to get profit).', { summarize: 'none', label: 'P&L Sign' }),
    c('sort_order', 'int', 'Statement order.', { hidden: true }),
    c('type_order', 'int', 'Type order.', { hidden: true })
  ],
  model: { name: 'Account', hierarchies: [{ name: 'Chart of Accounts', levels: ['statement', 'account_type', 'account_group', 'account_name'] }] }
}

const dimAppointmentType: TableSpec = {
  name: 'gold_dim_appointment_type',
  layer: 'gold',
  kind: 'dim',
  description: 'Junk dimension: every combination of visit type and booking channel.',
  grain: 'One row per visit type × booking channel.',
  key: ['appointment_type_key'],
  columns: [
    c('appointment_type_key', 'int', 'Surrogate key.'),
    c('visit_type', 'string', 'Wellness / Sick Visit / Emergency / Surgery / Follow-up.'),
    c('booking_channel', 'string', 'Phone / Online / Walk-in / Referral.'),
    c('is_emergency', 'bool', 'Emergency visit.'),
    c('is_scheduled', 'bool', 'Booked in advance (not walk-in).')
  ],
  model: { name: 'Appointment Type' }
}

const dimPayer: TableSpec = {
  name: 'gold_dim_payer',
  layer: 'gold',
  kind: 'dim',
  description: 'Creature insurance providers (fictional) and Self-Pay.',
  grain: 'One row per payer.',
  key: ['payer_key'],
  columns: [
    c('payer_key', 'int', 'Surrogate key.'),
    c('payer_code', 'string', 'Business key.'),
    c('payer_name', 'string', 'Payer name.'),
    c('payer_type', 'string', 'Insurer / Self-Pay.'),
    c('coverage_pct', 'double', 'Share of the invoice the insurer covers.', { format: '0%', summarize: 'none' }),
    c('contract_days_to_pay', 'int', 'Contractual claim payment days.')
  ],
  model: { name: 'Payer' }
}

const bridgeDiagnosis: TableSpec = {
  name: 'gold_bridge_appointment_diagnosis',
  layer: 'gold',
  kind: 'bridge',
  description: 'Diagnoses recorded per appointment (many-to-many). Filter appointments by diagnosis through this bridge (bidirectional).',
  grain: 'One row per appointment × diagnosis.',
  key: ['appointment_key', 'diagnosis_key'],
  partitionByYearOf: 'appointment_date',
  fks: [
    { column: 'appointment_key', table: 'gold_fact_appointment', bidirectional: true },
    { column: 'diagnosis_key', table: 'gold_dim_diagnosis' }
  ],
  columns: [
    c('appointment_key', 'int', 'Appointment.'),
    c('diagnosis_key', 'int', 'Diagnosis.'),
    c('appointment_date', 'date', 'Appointment date (partition source).', { exclude: true }),
    c('is_primary', 'bool', 'Primary diagnosis of the visit.'),
    c('diagnosis_rank', 'int', '1 = primary.', { summarize: 'none' })
  ],
  model: { name: 'Appointment Diagnosis' }
}

// ---------------------------------------------------------------------------------------------
// Gold facts

const factAppointment: TableSpec = {
  name: 'gold_fact_appointment',
  layer: 'gold',
  kind: 'fact',
  factType: 'accumulating snapshot',
  description: 'Appointments through their lifecycle: booked → seen (or no-show / cancelled) → invoiced → paid, with one date key per milestone.',
  grain: 'One row per appointment.',
  key: ['appointment_key'],
  partitionByYearOf: 'appointment_date',
  fks: [
    { column: 'appointment_date_key', table: D, role: 'Appointment Date' },
    { column: 'booked_date_key', table: D, role: 'Booked Date', inactive: true, nullable: true },
    { column: 'invoice_date_key', table: D, role: 'Invoice Date', inactive: true, nullable: true },
    { column: 'paid_date_key', table: D, role: 'Paid Date', inactive: true, nullable: true },
    { column: 'clinic_key', table: 'gold_dim_clinic' },
    { column: 'patient_key', table: 'gold_dim_patient' },
    { column: 'owner_key', table: 'gold_dim_owner' },
    { column: 'species_key', table: 'gold_dim_species' },
    { column: 'staff_sk', table: 'gold_dim_staff' },
    { column: 'appointment_type_key', table: 'gold_dim_appointment_type' },
    { column: 'payer_key', table: 'gold_dim_payer' }
  ],
  columns: [
    c('appointment_key', 'int', 'Surrogate key.'),
    c('appointment_id', 'string', 'Practice-management id.'),
    c('appointment_date', 'date', 'Appointment date (partition source).', { exclude: true }),
    c('appointment_date_key', 'int', 'Appointment date (active relationship).'),
    c('booked_date_key', 'int', 'Booking date (inactive; blank if booked before the history window).'),
    c('invoice_date_key', 'int', 'Invoice date (inactive; blank if not seen).'),
    c('paid_date_key', 'int', 'Fully-paid date (inactive; blank while money is outstanding).'),
    c('clinic_key', 'int', 'Clinic.'),
    c('patient_key', 'int', 'Patient (-1 = stray).'),
    c('owner_key', 'int', 'Owner (-1 = Good Samaritan).'),
    c('species_key', 'int', 'Breed.'),
    c('staff_sk', 'int', 'Attending veterinarian (SCD2 version in effect).'),
    c('appointment_type_key', 'int', 'Visit type × booking channel.'),
    c('payer_key', 'int', 'Payer.'),
    c('appointment_hour', 'int', 'Scheduled hour (0-23).', { summarize: 'none' }),
    c('status', 'string', 'Paid / Invoiced / No-Show / Cancelled.'),
    c('is_no_show', 'bool', 'Patient did not arrive.'),
    c('is_seen', 'bool', 'Patient was seen (invoiced).'),
    c('lead_time_days', 'int', 'Days between booking and appointment.', { summarize: 'average' }),
    c('wait_minutes', 'int', 'Minutes from check-in to being seen.', { summarize: 'average' }),
    c('duration_minutes', 'int', 'Vet time spent.'),
    c('diagnosis_count', 'int', 'Diagnoses recorded.'),
    c('invoice_amount', 'decimal', 'Invoice total (= Σ treatment lines).', { format: '$#,0.00' }),
    c('owner_paid_amount', 'decimal', 'Paid by the owner so far.', { format: '$#,0.00' }),
    c('insurer_paid_amount', 'decimal', 'Paid by the insurer so far.', { format: '$#,0.00' }),
    c('outstanding_amount', 'decimal', 'Still owed as of today.', { format: '$#,0.00' }),
    c('days_to_pay', 'int', 'Invoice → fully paid, in days.', { summarize: 'average' })
  ],
  model: { name: 'Appointments' }
}

const factTreatment: TableSpec = {
  name: 'gold_fact_treatment_line',
  layer: 'gold',
  kind: 'fact',
  factType: 'transaction',
  description: 'Invoice lines: every service, procedure and medication billed. Lines sum exactly to the appointment invoice.',
  grain: 'One row per invoice line.',
  key: ['invoice_number', 'line_number'],
  partitionByYearOf: 'service_date',
  fks: [
    { column: 'date_key', table: D },
    { column: 'appointment_key', table: 'gold_fact_appointment', noModel: true },
    { column: 'clinic_key', table: 'gold_dim_clinic' },
    { column: 'patient_key', table: 'gold_dim_patient' },
    { column: 'owner_key', table: 'gold_dim_owner' },
    { column: 'species_key', table: 'gold_dim_species' },
    { column: 'procedure_key', table: 'gold_dim_procedure' },
    { column: 'staff_sk', table: 'gold_dim_staff' },
    { column: 'payer_key', table: 'gold_dim_payer' }
  ],
  columns: [
    c('invoice_number', 'string', 'Invoice number.'),
    c('line_number', 'int', 'Line within the invoice.', { summarize: 'none' }),
    c('appointment_key', 'int', 'Appointment (degenerate link to the accumulating snapshot).'),
    c('service_date', 'date', 'Service date (partition source).', { exclude: true }),
    c('date_key', 'int', 'Service / invoice date.'),
    c('clinic_key', 'int', 'Clinic.'),
    c('patient_key', 'int', 'Patient.'),
    c('owner_key', 'int', 'Owner.'),
    c('species_key', 'int', 'Breed.'),
    c('procedure_key', 'int', 'Billing code.'),
    c('staff_sk', 'int', 'Staff member who performed / dispensed it.'),
    c('payer_key', 'int', 'Payer.'),
    c('quantity', 'int', 'Units (doses, nights, procedures).'),
    c('unit_price', 'decimal', 'Price per unit after the size multiplier.', { format: '$#,0.00', summarize: 'none' }),
    c('gross_amount', 'decimal', 'quantity × unit_price.', { format: '$#,0.00' }),
    c('discount_amount', 'decimal', 'Care-plan discount.', { format: '$#,0.00' }),
    c('net_amount', 'decimal', 'gross − discount (revenue).', { format: '$#,0.00' }),
    c('cost_amount', 'decimal', 'Standard cost (medications & supplies).', { format: '$#,0.00' })
  ],
  model: { name: 'Treatments' }
}

const factClinicDay: TableSpec = {
  name: 'gold_fact_clinic_day',
  layer: 'gold',
  kind: 'fact',
  factType: 'periodic snapshot',
  description: 'Daily clinic scorecard: vets on duty, capacity, booked minutes, visits, no-shows, waits and revenue.',
  grain: 'One row per patient-facing clinic per calendar day.',
  key: ['clinic_key', 'date_key'],
  fks: [
    { column: 'date_key', table: D },
    { column: 'clinic_key', table: 'gold_dim_clinic' }
  ],
  columns: [
    c('clinic_key', 'int', 'Clinic.'),
    c('date_key', 'int', 'Date.'),
    c('is_open', 'bool', 'Clinic open for scheduled visits (hospitals take emergencies every day).'),
    c('vets_on_duty', 'int', 'Veterinarians rostered.', { summarize: 'average' }),
    c('available_minutes', 'int', 'Vet capacity (vets × 480 minutes).'),
    c('booked_minutes', 'int', 'Vet minutes spent with patients.'),
    c('appointments', 'int', 'Appointments scheduled for the day.'),
    c('visits_seen', 'int', 'Patients seen.'),
    c('no_shows', 'int', 'No-shows.'),
    c('cancellations', 'int', 'Cancellations.'),
    c('emergencies', 'int', 'Emergency visits seen.'),
    c('total_wait_minutes', 'int', 'Sum of waits (divide by visits for the average).'),
    c('revenue', 'decimal', 'Invoiced revenue (= Σ treatment lines of the day).', { format: '$#,0.00' })
  ],
  model: { name: 'Clinic Day' }
}

const factGl: TableSpec = {
  name: 'gold_fact_gl_month',
  layer: 'gold',
  kind: 'fact',
  factType: 'periodic snapshot',
  description: 'Monthly GL activity and balances per account and cost center, with the budget for P&L accounts. Months after today carry budget only.',
  grain: 'One row per account × cost center × month (month-end date).',
  key: ['account_key', 'clinic_key', 'month_end_date_key'],
  fks: [
    { column: 'month_end_date_key', table: D },
    { column: 'account_key', table: 'gold_dim_account' },
    { column: 'clinic_key', table: 'gold_dim_clinic' }
  ],
  columns: [
    c('account_key', 'int', 'GL account.'),
    c('clinic_key', 'int', 'Cost center (clinic or Head Office).'),
    c('month_end_date_key', 'int', 'Last day of the month.'),
    c('debit_amount', 'decimal', 'Debits posted in the month.', { format: '$#,0.00' }),
    c('credit_amount', 'decimal', 'Credits posted in the month.', { format: '$#,0.00' }),
    c('net_change', 'decimal', 'Debits − credits.', { format: '$#,0.00' }),
    c('closing_balance', 'decimal', 'Balance-sheet accounts: cumulative balance at month end (debit positive). Blank for P&L.', { format: '$#,0.00', summarize: 'none' }),
    c('actual_amount', 'decimal', 'P&L accounts: activity in natural sign (revenue = credits − debits, costs = debits − credits). Blank for balance-sheet accounts and future months.', { format: '$#,0.00' }),
    c('budget_amount', 'decimal', 'P&L budget for the month (natural sign).', { format: '$#,0.00' })
  ],
  model: { name: 'GL' }
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
  silver('silver_clinics', 'Clinic master from the practice-management API.', 'One row per clinic / cost center.', ['clinic_code'], [
    c('clinic_code', 'string', 'Code.', { nullable: false }),
    c('clinic_name', 'string', 'Name.'),
    c('clinic_type', 'string', 'Type.'),
    c('region', 'string', 'Region.'),
    c('district', 'string', 'District.'),
    c('city', 'string', 'Town.'),
    c('opened_date', 'date', 'Opened.'),
    c('exam_rooms', 'int', 'Exam rooms.'),
    c('has_flight_deck', 'bool', 'Flight deck.'),
    c('tank_wing_opened', 'date', 'Tank wing opening.')
  ]),
  silver('silver_species', 'Creature taxonomy reference.', 'One row per breed.', ['breed_code'], [
    c('breed_code', 'string', 'Breed code.'),
    c('creature_class', 'string', 'Class.'),
    c('species', 'string', 'Species.'),
    c('breed', 'string', 'Breed.'),
    c('size_class', 'string', 'Size class.'),
    c('typical_lifespan_years', 'int', 'Lifespan.'),
    c('is_aquatic', 'bool', 'Aquatic.'),
    c('is_flyer', 'bool', 'Flyer.'),
    c('is_fire_breathing', 'bool', 'Fire-breathing.')
  ]),
  silver('silver_owners', 'Owners, de-duplicated, e-mail placeholders nulled, town names title-cased.', 'One row per owner.', ['owner_id'], [
    c('owner_id', 'string', 'Owner id.'),
    c('household_name', 'string', 'Household.'),
    c('owner_type', 'string', 'Type.'),
    c('city', 'string', 'Town.'),
    c('email', 'string', 'E-mail (blank = not provided).'),
    c('care_plan', 'string', 'Care plan.'),
    c('payer_code', 'string', 'Insurer.'),
    c('home_clinic_code', 'string', 'Home clinic.'),
    c('join_date', 'date', 'Joined.'),
    c('email_opt_in', 'bool', 'Consent.')
  ]),
  silver('silver_patients', 'Patients with parsed birth dates; sentinel weights (-1, 9999) nulled.', 'One row per patient.', ['patient_id'], [
    c('patient_id', 'string', 'Patient id.'),
    c('patient_name', 'string', 'Name.'),
    c('breed_code', 'string', 'Breed.'),
    c('owner_id', 'string', 'Owner.'),
    c('sex', 'string', 'Sex.'),
    c('birth_date', 'date', 'Birth / hatch date.'),
    c('weight_kg', 'double', 'Weight.'),
    c('temperament', 'string', 'Temperament.'),
    c('is_rune_tagged', 'bool', 'Rune-tagged.'),
    c('registered_date', 'date', 'Registered.')
  ]),
  silver('silver_procedures', 'Billing catalogue (procedure groups case-normalised).', 'One row per billing code.', ['procedure_code'], [
    c('procedure_code', 'string', 'Code.'),
    c('procedure_name', 'string', 'Name.'),
    c('procedure_group', 'string', 'Group.'),
    c('item_category', 'string', 'Service / Medication.'),
    c('revenue_account_code', 'string', 'Revenue account.'),
    c('base_price', 'decimal', 'Price today (Small creature).'),
    c('cost_ratio', 'double', 'Cost ratio.')
  ]),
  silver('silver_diagnoses', 'Diagnosis reference.', 'One row per diagnosis.', ['diagnosis_code'], [
    c('diagnosis_code', 'string', 'Code.'),
    c('diagnosis_name', 'string', 'Name.'),
    c('diagnosis_group', 'string', 'Group.'),
    c('severity', 'string', 'Severity.'),
    c('is_seasonal', 'bool', 'Seasonal.')
  ]),
  silver('silver_accounts', 'Chart of accounts.', 'One row per account.', ['account_code'], [
    c('account_code', 'string', 'Account.'),
    c('account_name', 'string', 'Name.'),
    c('statement', 'string', 'Statement.'),
    c('account_type', 'string', 'Type.'),
    c('account_group', 'string', 'Group.'),
    c('normal_balance', 'string', 'Debit / Credit.')
  ]),
  silver('silver_payers', 'Insurance providers.', 'One row per payer.', ['payer_code'], [
    c('payer_code', 'string', 'Payer.'),
    c('payer_name', 'string', 'Name.'),
    c('coverage_pct', 'double', 'Coverage.'),
    c('contract_days_to_pay', 'int', 'Contract days.')
  ]),
  silver('silver_staff_snapshots', 'Month-end HR roster snapshots (hire dates parsed) — the input for the SCD2 staff dimension.', 'One row per staff member per month-end.', ['snapshot_date', 'staff_id'], [
    c('snapshot_date', 'date', 'Month-end.'),
    c('staff_id', 'string', 'Staff id.'),
    c('full_name', 'string', 'Name.'),
    c('role', 'string', 'Role.'),
    c('specialty', 'string', 'Specialty.'),
    c('clinic_code', 'string', 'Clinic.'),
    c('salary_band', 'string', 'Band.'),
    c('annual_salary', 'decimal', 'Salary.'),
    c('employment_status', 'string', 'Status.'),
    c('hire_date', 'date', 'Hire date.')
  ], { partitionByYearOf: 'snapshot_date' }),
  silver('silver_appointments', 'Appointments (deduplicated, latest status, statuses title-cased, PMS v4 field renames merged).', 'One row per appointment.', ['appointment_id'], [
    c('appointment_id', 'string', 'Appointment id.'),
    c('clinic_code', 'string', 'Clinic.'),
    c('patient_id', 'string', 'Patient (STRAY-* ids are unregistered strays).'),
    c('vet_id', 'string', 'Attending vet (renamed clinician_id in PMS v4).'),
    c('visit_type', 'string', 'Visit type.'),
    c('booking_channel', 'string', 'Channel.'),
    c('booked_date', 'date', 'Booked.'),
    c('scheduled_at', 'timestamp', 'Scheduled start.'),
    c('appointment_date', 'date', 'Appointment date.'),
    c('status', 'string', 'Completed / No-Show / Cancelled.'),
    c('wait_minutes', 'int', 'Wait.'),
    c('duration_minutes', 'int', 'Duration.'),
    c('is_telehealth', 'bool', 'Scrying-glass consultation (PMS v4 only).')
  ], { partitionByYearOf: 'appointment_date' }),
  silver('silver_appointment_diagnoses', 'Diagnoses per appointment.', 'One row per appointment × diagnosis.', ['appointment_id', 'diagnosis_code'], [
    c('appointment_id', 'string', 'Appointment.'),
    c('diagnosis_code', 'string', 'Diagnosis.'),
    c('appointment_date', 'date', 'Date.'),
    c('diagnosis_rank', 'int', 'Rank (1 = primary).')
  ], { partitionByYearOf: 'appointment_date' }),
  silver('silver_invoice_lines', 'Invoice lines (amount text parsed, codes trimmed, fat-finger quantities repaired from the line total).', 'One row per invoice line.', ['invoice_number', 'line_number'], [
    c('invoice_number', 'string', 'Invoice.'),
    c('line_number', 'int', 'Line.'),
    c('appointment_id', 'string', 'Appointment.'),
    c('service_date', 'date', 'Date.'),
    c('clinic_code', 'string', 'Clinic.'),
    c('procedure_code', 'string', 'Billing code.'),
    c('staff_id', 'string', 'Performed by.'),
    c('quantity', 'int', 'Quantity.'),
    c('unit_price', 'decimal', 'Unit price.'),
    c('discount_amount', 'decimal', 'Discount.'),
    c('line_total', 'decimal', 'Net line total.'),
    c('cost_amount', 'decimal', 'Standard cost.')
  ], { partitionByYearOf: 'service_date' }),
  silver('silver_payments', 'Cash received against invoices (owner at the desk, insurer remittances).', 'One row per payment.', ['payment_id'], [
    c('payment_id', 'string', 'Payment id.'),
    c('appointment_id', 'string', 'Appointment.'),
    c('clinic_code', 'string', 'Clinic.'),
    c('payer_code', 'string', 'Who paid (SELF = owner).'),
    c('payment_date', 'date', 'Date received.'),
    c('amount', 'decimal', 'Amount.')
  ], { partitionByYearOf: 'payment_date' }),
  silver('silver_insurance_claims', 'Insurance claims (negative resubmission amounts made positive).', 'One row per claim.', ['claim_id'], [
    c('claim_id', 'string', 'Claim id.'),
    c('appointment_id', 'string', 'Appointment.'),
    c('payer_code', 'string', 'Insurer.'),
    c('submitted_date', 'date', 'Submitted.'),
    c('claim_amount', 'decimal', 'Claimed.'),
    c('paid_date', 'date', 'Paid (blank = pending).'),
    c('status', 'string', 'Paid / Pending.')
  ], { partitionByYearOf: 'submitted_date' }),
  silver('silver_payroll_monthly', 'Payroll register (gross pay parsed from text).', 'One row per staff member per pay month.', ['pay_month', 'staff_id'], [
    c('pay_month', 'date', 'Month-end of the pay period.'),
    c('staff_id', 'string', 'Staff id.'),
    c('clinic_code', 'string', 'Cost center charged.'),
    c('role_group', 'string', 'Veterinary / Nursing & Handling / Admin.'),
    c('days_paid', 'int', 'Days employed in the month.'),
    c('gross_pay', 'decimal', 'Gross pay.'),
    c('employer_benefits', 'decimal', 'Employer taxes & benefits (22%).')
  ], { partitionByYearOf: 'pay_month' }),
  silver('silver_gl_journal_lines', 'Posted GL journal lines (posting dates normalised). Every journal balances.', 'One row per journal line.', ['journal_id', 'line_number'], [
    c('journal_id', 'string', 'Journal id.'),
    c('line_number', 'int', 'Line.'),
    c('posting_date', 'date', 'Posting date (month end).'),
    c('journal_type', 'string', 'REV / CASH / COGS / PURCH / PAYROLL / EXPENSE / AP-PAY.'),
    c('clinic_code', 'string', 'Cost center.'),
    c('account_code', 'string', 'Account.'),
    c('debit', 'decimal', 'Debit.'),
    c('credit', 'decimal', 'Credit.'),
    c('description', 'string', 'Line description.')
  ], { partitionByYearOf: 'posting_date' }),
  silver('silver_budget', 'Budget unpivoted from the wide finance workbooks (one per fiscal year).', 'One row per fiscal year × cost center × P&L account × month.', ['clinic_code', 'account_code', 'budget_month'], [
    c('fiscal_year', 'int', 'Fiscal year (April start, named after the year it ends).'),
    c('clinic_code', 'string', 'Cost center.'),
    c('account_code', 'string', 'Account (trimmed).'),
    c('budget_month', 'date', 'Month end.'),
    c('budget_amount', 'decimal', 'Budget (natural sign).')
  ])
]

export const GG_TABLES: TableSpec[] = [
  dimClinic, dimSpecies, dimOwner, dimPatient, dimStaff, dimProcedure, dimDiagnosis, dimAccount, dimAppointmentType, dimPayer, bridgeDiagnosis,
  factAppointment, factTreatment, factClinicDay, factGl, ...silverTables
]

// ---------------------------------------------------------------------------------------------
// Bronze

export const GG_SOURCES: BronzeSourceDoc[] = [
  { id: 'pms_appointments', system: 'ClawSoft PMS API', pattern: 'pms/appointments/YYYY/MM/DD/appointments_YYYYMMDD.json', format: 'json', cadence: 'daily', description: 'Daily API page of appointment records (envelope with `results`). The PMS v4 upgrade renamed `vet_id` → `clinician_id` and added `telehealth`. Re-sent and late records are common.' },
  { id: 'pms_reference', system: 'ClawSoft PMS API', pattern: 'pms/reference/{clinics,procedures,diagnoses,species}.json', format: 'json', cadence: 'snapshot', description: 'Reference lists (clinics, billing codes, diagnoses, taxonomy).' },
  { id: 'billing', system: 'ClawSoft billing export', pattern: 'billing/YYYY/invoice_lines_YYYYMM.csv', format: 'csv', cadence: 'monthly', description: 'Invoice lines; amounts exported as display text by older terminals.' },
  { id: 'diagnoses', system: 'ClawSoft clinical notes', pattern: 'clinical/YYYY/appointment_diagnoses_YYYYMM.csv', format: 'csv', cadence: 'monthly', description: 'Diagnosis codes per appointment.' },
  { id: 'payments', system: 'TillTalon card terminals + insurer remittances', pattern: 'billing/payments/YYYY/payments_YYYYMM.csv', format: 'csv', cadence: 'monthly', description: 'Payments received.' },
  { id: 'patients', system: 'Creature registry', pattern: 'registry/patients.ndjson', format: 'ndjson', cadence: 'snapshot', description: 'Patient export; weights from the clinic scales (which send sentinels when a dragon sits on them).' },
  { id: 'owners', system: 'Creature registry', pattern: 'registry/owners.csv', format: 'csv', cadence: 'snapshot', description: 'Owner export: quoted CSV with CRLF line endings.' },
  { id: 'claims', system: 'ScaleClaim insurer gateway', pattern: 'insurance/YYYY/claims_YYYYMM.ndjson', format: 'ndjson', cadence: 'monthly', description: 'Insurance claims with nested payer object.' },
  { id: 'hr', system: 'PawRoll HR', pattern: 'hr/staff/staff_YYYYMM.csv', format: 'csv', cadence: 'monthly snapshot', description: 'Month-end staff roster snapshots — diff them to rebuild the SCD2 history.' },
  { id: 'payroll', system: 'PawRoll payroll', pattern: 'hr/payroll/YYYY/payroll_YYYYMM.csv', format: 'csv', cadence: 'monthly', description: 'Payroll register.' },
  { id: 'gl', system: 'LedgerLair GL', pattern: 'finance/gl/YYYY/journal_lines_YYYYMM.csv', format: 'csv', cadence: 'monthly', description: 'Posted journal lines plus the chart of accounts (finance/gl/chart_of_accounts.csv).' },
  { id: 'budget', system: 'Finance planning workbooks', pattern: 'finance/budget/budget_FYyy.xlsx', format: 'xlsx', cadence: 'yearly', description: 'One wide workbook per fiscal year: a row per cost center × account, a column per month (Apr … Mar), title lines on top.' }
]

export const GG_ISSUES: IssueDoc[] = [
  { code: 'GG01', kind: 'duplicates', source: 'pms_appointments', description: 'The API re-sends some appointment records (exact duplicates).', fix: 'Deduplicate on appointment_id.' },
  { code: 'GG02', kind: 'late_arriving', source: 'pms_appointments', column: 'scheduled_at', dateColumn: 'scheduled_at', description: 'Records synced from the mobile dragon-call van land 2-7 days late.', fix: 'Union all daily pages; use scheduled_at as the business date.' },
  { code: 'GG03', kind: 'schema_drift', source: 'pms_appointments', description: 'PMS v4: `vet_id` renamed `clinician_id`, new `telehealth` flag.', fix: 'Coalesce vet_id / clinician_id; telehealth = false before the upgrade.' },
  { code: 'GG04', kind: 'casing', source: 'pms_appointments', column: 'status', description: 'Status values in mixed case ("COMPLETED", "no-show").', fix: 'Map to the canonical status list.' },
  { code: 'GG05', kind: 'orphan_keys', source: 'pms_appointments', column: 'patient_id', ref: { table: 'silver_patients', column: 'patient_id' }, description: 'Strays brought in by the public get temporary STRAY-* ids that never reach the registry.', fix: 'Keep the visit; map to patient -1 (Unregistered Stray) and owner -1 in gold.' },
  { code: 'GG06', kind: 'formatted_numbers', source: 'billing', column: 'line_total', description: 'Line totals as display text ("$1,234.50", "1.234,50", "86.00 USD").', fix: 'Strip currency symbols/codes and parse with the right decimal separator.' },
  { code: 'GG07', kind: 'whitespace', source: 'billing', column: 'procedure_code', description: 'Padded billing codes.', fix: 'TRIM before joining to the catalogue.' },
  { code: 'GG08', kind: 'outliers', source: 'billing', column: 'qty', rule: 'extreme', description: 'Fat-finger quantities (×100); the line total is still right.', fix: 'quantity = (line_total + discount) ÷ unit_price.' },
  { code: 'GG09', kind: 'mixed_date_formats', source: 'patients', column: 'birth_date', description: 'Hatch dates in ISO, US, EU, long and epoch formats.', fix: 'Parse with a list of formats.' },
  { code: 'GG10', kind: 'sentinel_values', source: 'patients', column: 'weight_kg', sentinels: ['-1', '9999'], description: 'Scale errors: -1 (no reading) and 9999 (overload — usually a dragon).', fix: 'Replace sentinels with null.' },
  { code: 'GG11', kind: 'duplicates', source: 'owners', description: 'Some owners exported twice.', fix: 'Deduplicate on owner_id.' },
  { code: 'GG12', kind: 'nulls', source: 'owners', column: 'email', description: 'Missing e-mails as blanks, "NULL" or "n/a".', fix: 'Normalise placeholders to null.' },
  { code: 'GG13', kind: 'casing', source: 'owners', column: 'town', description: 'Town names in UPPER / lower case.', fix: 'Title-case the town.' },
  { code: 'GG14', kind: 'mixed_date_formats', source: 'hr', column: 'hire_date', description: 'Hire dates in several formats.', fix: 'Parse with a list of formats.' },
  { code: 'GG15', kind: 'formatted_numbers', source: 'payroll', column: 'gross_pay', description: 'Gross pay exported as currency text.', fix: 'Parse the currency text.' },
  { code: 'GG16', kind: 'mixed_date_formats', source: 'gl', column: 'posting_date', description: 'Posting dates from the old ledger in dd.mm.yyyy.', fix: 'Parse both formats.' },
  { code: 'GG17', kind: 'whitespace', source: 'budget', column: 'Account', description: 'Account codes typed with stray spaces in the planning workbook.', fix: 'TRIM before joining to the chart of accounts.' },
  { code: 'GG18', kind: 'outliers', source: 'claims', column: 'claim_amount', rule: 'negative', description: 'Resubmitted claims carry a negative sign.', fix: 'Use the absolute amount (status tells you it was a resubmission).' },
  { code: 'GG19', kind: 'casing', source: 'pms_reference', column: 'group', description: 'Procedure groups typed in inconsistent case in the billing catalogue.', fix: 'Map to canonical group names.' }
]

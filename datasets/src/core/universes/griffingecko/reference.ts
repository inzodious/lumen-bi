/**
 * Griffin & Gecko Creature Care — static reference data: taxonomy, billing catalogue, diagnoses,
 * chart of accounts, payers and clinic templates.
 */

export type Size = 'Tiny' | 'Small' | 'Large' | 'Colossal'

export interface BreedDef {
  code: string
  cls: string
  species: string
  breed: string
  size: Size
  life: number
  aquatic: boolean
  flyer: boolean
  fire: boolean
  weight: number
}

const B = (n: number, cls: string, species: string, breed: string, size: Size, life: number, weight: number, flags: { aquatic?: boolean; flyer?: boolean; fire?: boolean } = {}): BreedDef => ({
  code: `BR-${String(n).padStart(2, '0')}`, cls, species, breed, size, life, weight, aquatic: !!flags.aquatic, flyer: !!flags.flyer, fire: !!flags.fire
})

export const CLASS_DRAGON = 'Dragons'
export const CLASS_GRIFFIN = 'Griffins & Hippogriffs'
export const CLASS_PHOENIX = 'Phoenixes & Firebirds'
export const CLASS_BASILISK = 'Basilisks & Cockatrices'
export const CLASS_SEA = 'Sea Beasts'
export const CLASS_REPTILE = 'Garden Reptiles'
export const CLASS_FAMILIAR = 'Small Familiars'
export const CLASS_EQUINE = 'Legendary Equines'

export const BREEDS: BreedDef[] = [
  B(1, CLASS_DRAGON, 'Fire Dragon', 'Emberback', 'Colossal', 400, 2400, { flyer: true, fire: true }),
  B(2, CLASS_DRAGON, 'Fire Dragon', 'Cinderhorn', 'Large', 300, 900, { flyer: true, fire: true }),
  B(3, CLASS_DRAGON, 'Frost Dragon', 'Frostwing', 'Large', 320, 850, { flyer: true }),
  B(4, CLASS_DRAGON, 'Pocket Dragon', 'Teacup', 'Small', 60, 4, { flyer: true, fire: true }),
  B(5, CLASS_DRAGON, 'Pocket Dragon', 'Mossback', 'Small', 70, 6),
  B(6, CLASS_GRIFFIN, 'Griffin', 'Golden Griffin', 'Large', 80, 300, { flyer: true }),
  B(7, CLASS_GRIFFIN, 'Griffin', 'Snowy Griffin', 'Large', 75, 280, { flyer: true }),
  B(8, CLASS_GRIFFIN, 'Hippogriff', 'Dapple Hippogriff', 'Large', 50, 450, { flyer: true }),
  B(9, CLASS_PHOENIX, 'Phoenix', 'Scarlet Phoenix', 'Small', 500, 9, { flyer: true, fire: true }),
  B(10, CLASS_PHOENIX, 'Phoenix', 'Ash Phoenix', 'Small', 500, 8, { flyer: true, fire: true }),
  B(11, CLASS_PHOENIX, 'Firebird', 'Lantern Firebird', 'Tiny', 30, 1.2, { flyer: true, fire: true }),
  B(12, CLASS_BASILISK, 'Basilisk', 'Garden Basilisk', 'Small', 40, 12),
  B(13, CLASS_BASILISK, 'Basilisk', 'Royal Basilisk', 'Large', 120, 180),
  B(14, CLASS_BASILISK, 'Cockatrice', 'Barnyard Cockatrice', 'Small', 20, 3),
  B(15, CLASS_SEA, 'Kraken', 'Pocket Kraken', 'Small', 60, 15, { aquatic: true }),
  B(16, CLASS_SEA, 'Kraken', 'Reef Kraken', 'Large', 200, 600, { aquatic: true }),
  B(17, CLASS_SEA, 'Sea Serpent', 'Ribbon Serpent', 'Large', 150, 300, { aquatic: true }),
  B(18, CLASS_REPTILE, 'Gecko', 'Moon Gecko', 'Tiny', 15, 0.08),
  B(19, CLASS_REPTILE, 'Gecko', 'Leaf-tail Gecko', 'Tiny', 12, 0.06),
  B(20, CLASS_REPTILE, 'Salamander', 'Fire Salamander', 'Tiny', 20, 0.1, { fire: true }),
  B(21, CLASS_FAMILIAR, 'Jackalope', 'Prairie Jackalope', 'Small', 12, 3),
  B(22, CLASS_FAMILIAR, 'Wisp Fox', 'Silver Wisp Fox', 'Small', 14, 6),
  B(23, CLASS_FAMILIAR, 'Moon Hare', 'Moon Hare', 'Tiny', 10, 2),
  B(24, CLASS_FAMILIAR, 'Mimic', 'Chest Mimic', 'Small', 90, 25),
  B(25, CLASS_EQUINE, 'Unicorn', 'Highland Unicorn', 'Large', 120, 500),
  B(26, CLASS_EQUINE, 'Pegasus', 'Stormwing Pegasus', 'Large', 60, 550, { flyer: true })
]

export const CLASS_WEIGHTS: Record<string, number> = {
  [CLASS_REPTILE]: 0.2, [CLASS_FAMILIAR]: 0.24, [CLASS_PHOENIX]: 0.08, [CLASS_BASILISK]: 0.08,
  [CLASS_GRIFFIN]: 0.1, [CLASS_DRAGON]: 0.12, [CLASS_SEA]: 0.07, [CLASS_EQUINE]: 0.11
}

export const SIZE_PRICE: Record<Size, number> = { Tiny: 0.6, Small: 1, Large: 2.6, Colossal: 5.5 }
export const SIZE_TIME: Record<Size, number> = { Tiny: 0.7, Small: 1, Large: 1.6, Colossal: 2.4 }
export const SIZE_RANK: Record<Size, number> = { Tiny: 1, Small: 2, Large: 3, Colossal: 4 }

export interface ProcDef {
  code: string
  name: string
  group: string
  cat: 'Service' | 'Medication'
  account: string
  price: number
  cost: number
}

const PX = (n: number, name: string, group: string, account: string, price: number, cost: number, cat: 'Service' | 'Medication' = 'Service'): ProcDef => ({
  code: `PX-${n}`, name, group, cat, account, price, cost
})

export const PROCEDURES: ProcDef[] = [
  PX(101, 'Wellness Exam', 'Consultation', '4000', 85, 0.08),
  PX(102, 'Sick Consult', 'Consultation', '4000', 110, 0.08),
  PX(103, 'Emergency Consult', 'Consultation', '4000', 240, 0.1),
  PX(104, 'Recheck Consult', 'Consultation', '4000', 65, 0.08),
  PX(105, 'Scrying-Glass Telehealth', 'Consultation', '4000', 55, 0.05),
  PX(151, 'Ember Flu Vaccine', 'Vaccination', '4000', 45, 0.35),
  PX(152, 'Scale Rot Vaccine', 'Vaccination', '4000', 40, 0.35),
  PX(153, 'Moon Fever Vaccine', 'Vaccination', '4000', 35, 0.35),
  PX(154, 'Feather Mite Prevention', 'Vaccination', '4000', 30, 0.4),
  PX(201, 'Bloodwork Panel', 'Diagnostics', '4100', 160, 0.22),
  PX(202, 'Radiograph', 'Diagnostics', '4100', 220, 0.15),
  PX(203, 'Flame Output Test', 'Diagnostics', '4100', 180, 0.12),
  PX(204, 'Venom & Gaze Assay', 'Diagnostics', '4100', 210, 0.2),
  PX(205, 'Gill Function Test', 'Diagnostics', '4100', 190, 0.18),
  PX(206, 'Ultrasound', 'Diagnostics', '4100', 260, 0.12),
  PX(301, 'Wing Repair', 'Surgery', '4200', 2400, 0.2),
  PX(302, 'Scale Graft', 'Surgery', '4200', 1800, 0.22),
  PX(303, 'Tail Regrowth Assist', 'Surgery', '4200', 1500, 0.2),
  PX(304, 'Egg Binding Surgery', 'Surgery', '4200', 2100, 0.2),
  PX(305, 'Foreign Body Removal', 'Surgery', '4200', 1700, 0.18),
  PX(306, 'Anesthesia & Monitoring', 'Surgery', '4200', 380, 0.25),
  PX(351, 'Fang Polish', 'Fang & Beak', '4200', 260, 0.12),
  PX(352, 'Beak & Horn Trim', 'Fang & Beak', '4200', 140, 0.1),
  PX(353, 'Tooth Extraction', 'Fang & Beak', '4200', 520, 0.15),
  PX(401, 'Ember Flu Antivirals', 'Medication', '4300', 65, 0.45, 'Medication'),
  PX(402, 'Scale Salve', 'Medication', '4300', 38, 0.42, 'Medication'),
  PX(403, 'Pain Relief Draught', 'Medication', '4300', 42, 0.4, 'Medication'),
  PX(404, 'Antibiotic Course', 'Medication', '4300', 55, 0.45, 'Medication'),
  PX(405, 'Dewormer', 'Medication', '4300', 28, 0.4, 'Medication'),
  PX(406, 'Molting Supplement', 'Medication', '4300', 34, 0.5, 'Medication'),
  PX(407, 'Mirror-Calm Sedative', 'Medication', '4300', 48, 0.45, 'Medication'),
  PX(408, 'Ink Gland Flush', 'Medication', '4300', 52, 0.4, 'Medication'),
  PX(501, 'Overnight Stay', 'Boarding & Care', '4400', 120, 0.3),
  PX(502, 'Aerie Night (large flyer)', 'Boarding & Care', '4400', 260, 0.3),
  PX(503, 'Tank Night (aquatic)', 'Boarding & Care', '4400', 220, 0.35)
]

export interface DxDef {
  code: string
  name: string
  group: string
  severity: string
  seasonal: boolean
  classes: string[] | 'all'
  weight: number
  tests: string[]
  meds: string[]
  surgery?: string
}

const DX = (n: number, name: string, group: string, severity: string, classes: string[] | 'all', weight: number, tests: string[], meds: string[], extra: { seasonal?: boolean; surgery?: string } = {}): DxDef => ({
  code: `DX-${String(n).padStart(3, '0')}`, name, group, severity, classes, weight, tests, meds, seasonal: !!extra.seasonal, surgery: extra.surgery
})

export const DX_ROUTINE = 'DX-001'
export const DX_EMBER_FLU = 'DX-002'

export const DIAGNOSES: DxDef[] = [
  DX(1, 'Routine Wellness', 'Routine', 'Mild', 'all', 0, [], []),
  DX(2, 'Ember Flu', 'Infectious', 'Moderate', [CLASS_PHOENIX, CLASS_DRAGON], 1.2, ['PX-201', 'PX-203'], ['PX-401'], { seasonal: true }),
  DX(3, 'Scale Rot', 'Infectious', 'Moderate', [CLASS_DRAGON, CLASS_BASILISK, CLASS_REPTILE, CLASS_SEA], 1, ['PX-201'], ['PX-402', 'PX-404'], { surgery: 'PX-302' }),
  DX(4, 'Feather Mites', 'Parasitic', 'Mild', [CLASS_GRIFFIN, CLASS_PHOENIX, CLASS_EQUINE], 1, [], ['PX-405'], { seasonal: true }),
  DX(5, 'Wing Sprain', 'Injury', 'Moderate', [CLASS_DRAGON, CLASS_GRIFFIN, CLASS_PHOENIX, CLASS_EQUINE], 0.9, ['PX-202'], ['PX-403'], { seasonal: true, surgery: 'PX-301' }),
  DX(6, 'Tail Fracture', 'Injury', 'Severe', [CLASS_DRAGON, CLASS_REPTILE, CLASS_BASILISK, CLASS_FAMILIAR], 0.6, ['PX-202'], ['PX-403'], { surgery: 'PX-303' }),
  DX(7, 'Fang Decay', 'Dental', 'Moderate', [CLASS_DRAGON, CLASS_BASILISK, CLASS_FAMILIAR], 0.8, ['PX-202'], ['PX-404'], { surgery: 'PX-353' }),
  DX(8, 'Overgrown Beak or Horn', 'Dental', 'Mild', [CLASS_GRIFFIN, CLASS_PHOENIX, CLASS_EQUINE], 0.8, [], [], {}),
  DX(9, 'Hoard Anxiety', 'Behavioral', 'Mild', [CLASS_DRAGON], 0.7, [], ['PX-407']),
  DX(10, 'Gaze Overuse Fatigue', 'Behavioral', 'Mild', [CLASS_BASILISK], 1, ['PX-204'], ['PX-407']),
  DX(11, 'Molting Complications', 'Dermatology', 'Mild', [CLASS_DRAGON, CLASS_GRIFFIN, CLASS_PHOENIX, CLASS_REPTILE], 0.8, [], ['PX-406', 'PX-402'], { seasonal: true }),
  DX(12, 'Egg Binding', 'Reproductive', 'Severe', [CLASS_DRAGON, CLASS_PHOENIX, CLASS_BASILISK, CLASS_REPTILE], 0.4, ['PX-206'], ['PX-403'], { surgery: 'PX-304' }),
  DX(13, 'Ink Gland Blockage', 'Aquatic', 'Moderate', [CLASS_SEA], 1.2, ['PX-205'], ['PX-408']),
  DX(14, 'Fin & Tentacle Rot', 'Aquatic', 'Moderate', [CLASS_SEA], 1, ['PX-205'], ['PX-404', 'PX-402']),
  DX(15, 'Hoof Abscess', 'Injury', 'Moderate', [CLASS_EQUINE], 1, ['PX-202'], ['PX-404', 'PX-403']),
  DX(16, 'Swallowed Treasure', 'Gastro', 'Severe', [CLASS_DRAGON, CLASS_FAMILIAR], 0.6, ['PX-202', 'PX-206'], ['PX-403'], { surgery: 'PX-305' }),
  DX(17, 'Dietary Indiscretion', 'Gastro', 'Mild', 'all', 1, ['PX-201'], ['PX-403']),
  DX(18, 'Hairball of Holding', 'Gastro', 'Moderate', [CLASS_FAMILIAR], 0.9, ['PX-206'], ['PX-403'], { surgery: 'PX-305' }),
  DX(19, 'Ear Mites', 'Parasitic', 'Mild', [CLASS_FAMILIAR, CLASS_EQUINE], 1, [], ['PX-405']),
  DX(20, 'Arthritis', 'Chronic', 'Moderate', 'all', 0.6, ['PX-202'], ['PX-403']),
  DX(21, 'Low Flame Output', 'Chronic', 'Mild', [CLASS_DRAGON, CLASS_PHOENIX, CLASS_REPTILE], 0.7, ['PX-203'], ['PX-406']),
  DX(22, 'Moon Fever', 'Infectious', 'Moderate', [CLASS_FAMILIAR, CLASS_EQUINE, CLASS_GRIFFIN], 0.7, ['PX-201'], ['PX-404'])
]

export interface AccountDef {
  code: string
  name: string
  statement: 'Profit & Loss' | 'Balance Sheet'
  type: string
  group: string
  normal: 'Debit' | 'Credit'
}

const A = (code: string, name: string, type: string, group: string): AccountDef => {
  const statement = type === 'Asset' || type === 'Liability' ? 'Balance Sheet' : 'Profit & Loss'
  const normal = type === 'Revenue' || type === 'Liability' ? 'Credit' : 'Debit'
  return { code, name, statement, type, group, normal }
}

export const ACCOUNTS: AccountDef[] = [
  A('4000', 'Consultation & Vaccination Revenue', 'Revenue', 'Clinical Revenue'),
  A('4100', 'Diagnostics Revenue', 'Revenue', 'Clinical Revenue'),
  A('4200', 'Surgical & Dental Revenue', 'Revenue', 'Clinical Revenue'),
  A('4300', 'Medication Revenue', 'Revenue', 'Pharmacy Revenue'),
  A('4400', 'Boarding & Care Revenue', 'Revenue', 'Boarding Revenue'),
  A('5000', 'Cost of Medications', 'Cost of Sales', 'Cost of Sales'),
  A('5100', 'Clinical Supplies Used', 'Cost of Sales', 'Cost of Sales'),
  A('6000', 'Veterinary Salaries', 'Operating Expense', 'Payroll'),
  A('6010', 'Nursing & Handling Wages', 'Operating Expense', 'Payroll'),
  A('6020', 'Admin Wages', 'Operating Expense', 'Payroll'),
  A('6100', 'Payroll Taxes & Benefits', 'Operating Expense', 'Payroll'),
  A('6200', 'Rent & Lair Leases', 'Operating Expense', 'Facilities'),
  A('6300', 'Utilities & Fireproofing', 'Operating Expense', 'Facilities'),
  A('6400', 'Equipment Repairs', 'Operating Expense', 'Facilities'),
  A('6500', 'Marketing', 'Operating Expense', 'Sales & Marketing'),
  A('6600', 'Malpractice & Scorch Insurance', 'Operating Expense', 'Insurance'),
  A('6700', 'Training & Certification', 'Operating Expense', 'People'),
  A('1000', 'Cash at Bank', 'Asset', 'Cash'),
  A('1100', 'Accounts Receivable', 'Asset', 'Receivables'),
  A('1200', 'Medication & Supplies Inventory', 'Asset', 'Inventory'),
  A('2000', 'Accounts Payable', 'Liability', 'Payables'),
  A('2100', 'Accrued Benefits', 'Liability', 'Payroll Liabilities')
]

export const TYPE_ORDER: Record<string, number> = { Revenue: 1, 'Cost of Sales': 2, 'Operating Expense': 3, Asset: 4, Liability: 5 }

export const PAYERS = [
  { code: 'SELF', name: 'Self-Pay', type: 'Self-Pay', coverage: 0, days: 0 },
  { code: 'PY-01', name: 'Wyrmguard Mutual', type: 'Insurer', coverage: 0.8, days: 21 },
  { code: 'PY-02', name: 'Hoardsafe Beast Cover', type: 'Insurer', coverage: 0.75, days: 18 },
  { code: 'PY-03', name: 'Talon & Claw Assurance', type: 'Insurer', coverage: 0.7, days: 25 },
  { code: 'PY-04', name: 'Feather & Scale Cooperative', type: 'Insurer', coverage: 0.6, days: 14 }
]

export type ClinicType = 'Creature Hospital' | 'Creature Clinic' | 'Aerie' | 'Aquatic Center' | 'Head Office'

export const REGIONS = [
  { name: 'Highlands', districts: ['Crag District', 'Glen District'] },
  { name: 'Lowlands', districts: ['Fen District', 'Meadow District'] },
  { name: 'Coastal Reach', districts: ['Harbor District', 'Cliffside District'] }
]

export const VISIT_TYPES = ['Wellness', 'Sick Visit', 'Emergency', 'Surgery', 'Follow-up']
export const CHANNELS = ['Phone', 'Online', 'Walk-in', 'Referral']

export const PET_NAMES = [
  'Ember', 'Pip', 'Cinder', 'Moss', 'Bramble', 'Sprocket', 'Nimbus', 'Pickle', 'Biscuit', 'Sizzle', 'Zephyr', 'Clover', 'Tumble',
  'Quill', 'Saffron', 'Gizmo', 'Juniper', 'Pebble', 'Thistle', 'Mochi', 'Rune', 'Wisp', 'Fennel', 'Basil', 'Comet', 'Sparkle',
  'Grumble', 'Toast', 'Dumpling', 'Orbit', 'Marble', 'Puddle', 'Scorch', 'Velvet', 'Noodle', 'Flint', 'Hazel', 'Kelp', 'Ripple',
  'Sir Wiggles', 'Lady Ash', 'Captain Fluff', 'Professor Hoot', 'Duchess', 'Chompers', 'Glimmer', 'Turnip', 'Waffles', 'Bonfire'
]

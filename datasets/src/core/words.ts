/**
 * Word banks for fictional people, places and things. Person names are common given/family names
 * combined at random (no real individuals); place names are generated from invented syllables.
 */
import type { Rng } from './prng.ts'

export const FIRST_NAMES = [
  'Ada', 'Aiko', 'Alejandro', 'Amara', 'Anika', 'Arjun', 'Astrid', 'Bao', 'Beatriz', 'Bram', 'Caleb', 'Camila', 'Chidi',
  'Clara', 'Dalia', 'Dario', 'Dmitri', 'Elif', 'Elena', 'Emeka', 'Esme', 'Farah', 'Felix', 'Freya', 'Gabriel', 'Hana',
  'Hugo', 'Ibrahim', 'Ines', 'Isla', 'Ivan', 'Jae', 'Jonas', 'Juno', 'Kai', 'Kalani', 'Keira', 'Kofi', 'Lena', 'Leo',
  'Lina', 'Luca', 'Maya', 'Mateo', 'Mei', 'Milo', 'Nadia', 'Nia', 'Niko', 'Noor', 'Olu', 'Omar', 'Orla', 'Pavel',
  'Priya', 'Quinn', 'Rafael', 'Ravi', 'Rhea', 'Rosa', 'Sami', 'Sana', 'Sefa', 'Signe', 'Sora', 'Tariq', 'Thea', 'Tomas',
  'Uma', 'Vera', 'Viktor', 'Wren', 'Xin', 'Yara', 'Yusuf', 'Zara', 'Zeke', 'Zola', 'Ines', 'Arlo', 'Bianca', 'Cyrus',
  'Daphne', 'Ezra', 'Fatima', 'Gideon', 'Hollis', 'Iris', 'Jasper', 'Kenji', 'Lucia', 'Marlo', 'Nell', 'Otto', 'Pia'
]

export const LAST_NAMES = [
  'Abara', 'Adeyemi', 'Alvarez', 'Andersen', 'Bakker', 'Banerjee', 'Becker', 'Bianchi', 'Castillo', 'Chen', 'Costa',
  'Dahl', 'Diallo', 'Dubois', 'Eriksen', 'Fernandes', 'Fischer', 'Garcia', 'Gupta', 'Haddad', 'Hansen', 'Hernandez',
  'Ibarra', 'Ito', 'Jansen', 'Kaur', 'Kim', 'Kowalski', 'Kuznetsov', 'Laine', 'Larsen', 'Lopez', 'Mahlangu', 'Moreau',
  'Murphy', 'Nakamura', 'Nguyen', 'Novak', 'Okafor', 'Oliveira', 'Osei', 'Park', 'Patel', 'Petrov', 'Quispe', 'Rahman',
  'Reyes', 'Rossi', 'Sato', 'Schmidt', 'Silva', 'Singh', 'Sokolov', 'Tanaka', 'Torres', 'Usman', 'Valdez', 'Varga',
  'Vogel', 'Wagner', 'Walsh', 'Watanabe', 'Xu', 'Yamamoto', 'Yilmaz', 'Zhang', 'Zielinski', 'Mbeki', 'Lindqvist',
  'Achterberg', 'Brennan', 'Coelho', 'Duarte', 'Eklund', 'Fontaine', 'Grieve', 'Halvorsen', 'Iqbal', 'Jovanovic'
]

const SYL_A = ['Al', 'Bel', 'Cor', 'Dun', 'El', 'Fen', 'Gal', 'Har', 'Is', 'Jor', 'Kel', 'Lin', 'Mar', 'Nor', 'Or', 'Pel', 'Quil', 'Ros', 'Sal', 'Tam', 'Ul', 'Ver', 'Wil', 'Yar', 'Zan']
const SYL_B = ['a', 'e', 'i', 'o', 'ar', 'en', 'is', 'on', 'ul', 'ae', 'io', 'an']
const SYL_C = ['brook', 'by', 'dale', 'field', 'ford', 'gate', 'haven', 'holm', 'mere', 'mont', 'port', 'ridge', 'stead', 'ton', 'vale', 'wick', 'wood', 'crest', 'burgh', 'side']

/** Invented town/city name, e.g. "Belaford", "Korisvale". */
export function placeName(rng: Rng): string {
  return rng.pick(SYL_A) + rng.pick(SYL_B) + rng.pick(SYL_C)
}

/** n distinct place names. */
export function placeNames(rng: Rng, n: number): string[] {
  const out = new Set<string>()
  let guard = 0
  while (out.size < n && guard++ < n * 50) out.add(placeName(rng))
  return [...out]
}

export function personName(rng: Rng): { first: string; last: string; full: string } {
  const first = rng.pick(FIRST_NAMES)
  const last = rng.pick(LAST_NAMES)
  return { first, last, full: `${first} ${last}` }
}

/** Email on a fictional domain (".example" TLD is reserved for documentation). */
export function email(first: string, last: string, domain: string, rng: Rng): string {
  const style = rng.int(0, 3)
  const f = first.toLowerCase()
  const l = last.toLowerCase()
  const local = style === 0 ? `${f}.${l}` : style === 1 ? `${f[0]}${l}` : style === 2 ? `${f}${rng.int(1, 99)}` : `${f}_${l}${rng.int(1, 9)}`
  return `${local}@${domain}`
}

export const ADJECTIVES = [
  'Amber', 'Brisk', 'Cosmic', 'Dusky', 'Electric', 'Frosty', 'Golden', 'Hazy', 'Indigo', 'Jolly', 'Lunar', 'Midnight',
  'Nebular', 'Orbital', 'Polar', 'Quiet', 'Radiant', 'Solar', 'Twilight', 'Velvet', 'Wild', 'Zesty', 'Crimson', 'Silver'
]

export const NOUNS = [
  'Comet', 'Meteor', 'Nova', 'Orbit', 'Pulsar', 'Quasar', 'Rocket', 'Satellite', 'Star', 'Sun', 'Moon', 'Galaxy',
  'Nebula', 'Aurora', 'Eclipse', 'Horizon', 'Zenith', 'Lantern', 'Compass', 'Harbor', 'Beacon', 'Ember', 'Glacier'
]

export const GREEK = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta', 'Eta', 'Theta', 'Iota', 'Kappa', 'Lambda', 'Mu', 'Nu', 'Xi', 'Omicron', 'Pi', 'Rho', 'Sigma', 'Tau', 'Upsilon', 'Phi', 'Chi', 'Psi', 'Omega']

/** Fictional organisation name, e.g. "Quiet Harbor Holdings". */
export function orgName(rng: Rng, suffixes: string[] = ['Holdings', 'Partners', 'Industries', 'Collective', 'Works', 'Group', 'Labs', 'Trading Co.']): string {
  return `${rng.pick(ADJECTIVES)} ${rng.pick(NOUNS)} ${rng.pick(suffixes)}`
}

/** n distinct fictional organisation names. */
export function orgNames(rng: Rng, n: number, suffixes?: string[]): string[] {
  const out = new Set<string>()
  let guard = 0
  while (out.size < n && guard++ < n * 100) out.add(orgName(rng, suffixes))
  let i = 2
  while (out.size < n) out.add(`${orgName(rng, suffixes)} ${i++}`)
  return [...out]
}

/** Zero-padded code, e.g. code('ST', 7, 3) → "ST-007". */
export function code(prefix: string, n: number, width = 4): string {
  return `${prefix}-${String(n).padStart(width, '0')}`
}

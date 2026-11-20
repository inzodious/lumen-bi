/**
 * `0.CryptKey.bin`, the database key file every Desktop-written data model carries (144 bytes in all seven Microsoft
 * samples and the Desktop files on hand). Power BI Desktop 2.159 refuses a data model without one ("database crypto key
 * is missing in the database object filegroup though it must be present according to password encryption setting"),
 * whatever the backup log declares.
 *
 * Layout (identical first 60 and last 16 bytes in every file on hand):
 *   [0, 16)    a fixed GUID (98BC215D-2D8D-E64E-A8E5-D038AAC94441 in byte order)
 *   [16, 48)   u32 4, 48 (offset of the key blob), 80 (its length), 16, 1, 7, 0xFFFFFFFF, 0
 *   [48, 60)   a CryptoAPI SIMPLEBLOB header: type 1, version 2, key algorithm CALG_3DES (0x6603), encryption algorithm
 *              CALG_RSA_KEYX (0xA400)
 *   [60, 128)  the session key encrypted for the RSA key of the engine instance that wrote the file
 *   [128, 144) the GUID again
 * The encrypted part can only be decrypted by the engine instance that wrote it, so every file opened on another
 * computer (each Microsoft sample, for instance) carries a key that Desktop cannot decrypt; Desktop opens such files and
 * writes a key of its own on the next save. Lumen writes the same structure with random bytes in the encrypted part,
 * which is to Desktop the same as a key from another computer. The key protects stored data source passwords; a Lumen
 * file has none.
 */
const HEADER = [
  0x98, 0xbc, 0x21, 0x5d, 0x2d, 0x8d, 0xe6, 0x4e, 0xa8, 0xe5, 0xd0, 0x38, 0xaa, 0xc9, 0x44, 0x41, 0x04, 0x00, 0x00, 0x00, 0x30, 0x00, 0x00, 0x00, 0x50, 0x00, 0x00,
  0x00, 0x10, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x07, 0x00, 0x00, 0x00, 0xff, 0xff, 0xff, 0xff, 0x00, 0x00, 0x00, 0x00, 0x01, 0x02, 0x00, 0x00, 0x03, 0x66,
  0x00, 0x00, 0x00, 0xa4, 0x00, 0x00
]

export function databaseKeyFile(random: (n: number) => Uint8Array = randomBytes): Uint8Array {
  const out = new Uint8Array(144)
  out.set(HEADER, 0)
  out.set(random(68), 60)
  out.set(HEADER.slice(0, 16), 128)
  return out
}

function randomBytes(n: number): Uint8Array {
  const b = new Uint8Array(n)
  const c = (globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array } }).crypto
  if (c?.getRandomValues) c.getRandomValues(b)
  else for (let i = 0; i < n; i++) b[i] = Math.floor(Math.random() * 256)
  return b
}

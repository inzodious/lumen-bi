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
 * Desktop decrypts the key of a file saved on another computer (a key written on one machine opened on another in
 * Power BI Desktop 2.159), but rejects a key whose encrypted part it cannot decrypt ("Invalid cryptographic key").
 * Lumen therefore ships one key written by Power BI Desktop 2.159 when it saved a Lumen-written test model
 * (DESKTOP_KEY below). The key only protects stored data source passwords; Lumen files store none, and the key holds
 * no data.
 */
export const DESKTOP_KEY_BASE64 = 'mLwhXS2N5k6o5dA4qslEQQQAAAAwAAAAUAAAABAAAAABAAAABwAAAP////8AAAAAAQIAAANmAAAApAAA7KSwdjLLXYk4UiqFAlQE1qGMxBApZ0OwAPFkRIIwCUIW2jrldNzmyitZEnxdQ0ofjlAVwVjYoPaa591R0PcCAAAAAACYvCFdLY3mTqjl0DiqyURB'

/** The database key file written into every data model Lumen builds. */
export function databaseKeyFile(): Uint8Array {
  const s = atob(DESKTOP_KEY_BASE64)
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i)
  return out
}

/** Header shared by every key file on hand (checked in tests). */
export const HEADER = [
  0x98, 0xbc, 0x21, 0x5d, 0x2d, 0x8d, 0xe6, 0x4e, 0xa8, 0xe5, 0xd0, 0x38, 0xaa, 0xc9, 0x44, 0x41, 0x04, 0x00, 0x00, 0x00, 0x30, 0x00, 0x00, 0x00, 0x50, 0x00, 0x00,
  0x00, 0x10, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x07, 0x00, 0x00, 0x00, 0xff, 0xff, 0xff, 0xff, 0x00, 0x00, 0x00, 0x00, 0x01, 0x02, 0x00, 0x00, 0x03, 0x66,
  0x00, 0x00, 0x00, 0xa4, 0x00, 0x00
]

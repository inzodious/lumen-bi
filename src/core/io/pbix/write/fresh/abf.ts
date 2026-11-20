/**
 * A new Analysis Services backup (ABF) from a list of database files: the write-side counterpart of
 * `../../datamodel/abf.ts` for a database that Lumen built itself (`../abfwrite.ts` only re-packs an existing ABF).
 *
 * Layout, as in the November 2025 Desktop file (the 2023 samples differ only in versions and paths):
 *   [0, 72)          UTF-16LE BOM + "STREAM_STORAGE_SIGNATURE_)!@#$%^&*("
 *   [72, 4096)       BackupLogHeader: UTF-16LE XML, zero padded
 *   blobs            from 4096, back to back: ADDITIONAL_LOG, PARTITIONS, the database `.db.xml`, every database file,
 *                    then the BackupLog (`LOG`)
 *   zero padding     to a multiple of 4096
 *   VirtualDirectory UTF-8 XML (storage id, size, offset, timestamps of every blob)
 *   zero padding     to a multiple of 4096
 * The BackupLog (UTF-16LE with BOM) maps each file's logical path under the database folder to its storage id: file
 * group class 100002 holds the `.db.xml` (and the database key file when present), class 100069 every file of the
 * database folder.
 */

const PAGE = 4096
const SIGNATURE = 'STREAM_STORAGE_SIGNATURE_)!@#$%^&*('

export interface AbfInput {
  /** database id / name (a GUID, as Desktop names its workspace databases) */
  databaseId: string
  /** ObjectID GUIDs of the backup header, the database and its file group */
  backupObjectId: string
  databaseObjectId: string
  /** server data folder recorded in the log (any absolute path; Desktop restores into its own workspace) */
  serverRoot: string
  /** content of `<id>.0.db.xml` */
  dbXml: string
  /** files of the `.0.db` folder (folder relative to it, Windows separators) */
  files: Array<{ folder: string; name: string; bytes: Uint8Array }>
  /**
   * optional database key file (`0.CryptKey.bin`), listed with the `.db.xml`. Without one the log declares
   * `SvrEncryptPwdFlag` false: Power BI Desktop 2.159 refuses a backup whose log says passwords are encrypted
   * (`true`, every Desktop file) but that has no key file ("database crypto key is missing in the database object
   * filegroup though it must be present according to password encryption setting").
   */
  cryptKey?: Uint8Array
  /** FILETIME of the backup */
  fileTime: number
  /** storage id generator (20 upper-case hex characters per blob) */
  storageId?: () => string
}

function utf16(s: string, bom = false): Uint8Array {
  const out = new Uint8Array(s.length * 2 + (bom ? 2 : 0))
  let p = 0
  if (bom) {
    out[p++] = 0xff
    out[p++] = 0xfe
  }
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    out[p++] = c & 255
    out[p++] = c >>> 8
  }
  return out
}

function utf8(s: string): Uint8Array {
  return new TextEncoder().encode(s)
}

export function xmlEscape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

let counter = 0
/** Default storage ids: 20 hex characters, unique within a process. */
export function defaultStorageId(): string {
  counter = (counter + 1) % 0x100000
  const rnd = Array.from({ length: 15 }, () => Math.floor(Math.random() * 16).toString(16)).join('')
  return (rnd + counter.toString(16).padStart(5, '0')).toUpperCase()
}

export function buildAbf(input: AbfInput): Uint8Array {
  const sid = input.storageId ?? defaultStorageId
  const ft = input.fileTime
  const dbFolder = `${input.serverRoot}\\${input.databaseId}.0.db`
  interface Blob {
    path: string
    bytes: Uint8Array
    logPath?: string
    group?: 'db' | 'files'
  }
  const blobs: Blob[] = [
    { path: 'ADDITIONAL_LOG', bytes: utf16('<Property><ProductName>Default</ProductName></Property>', true) },
    { path: 'PARTITIONS', bytes: utf16('<Partitions/>', true) },
    { path: sid(), bytes: utf8(input.dbXml), logPath: `${input.serverRoot}\\${input.databaseId}.0.db.xml`, group: 'db' }
  ]
  if (input.cryptKey) blobs.push({ path: sid(), bytes: input.cryptKey, logPath: `${dbFolder}\\0.CryptKey.bin`, group: 'db' })
  for (const f of input.files) blobs.push({ path: sid(), bytes: f.bytes, logPath: `${dbFolder}\\${f.folder ? f.folder + '\\' : ''}${f.name}`, group: 'files' })

  const fileList = (group: 'db' | 'files'): string =>
    blobs
      .filter((b) => b.group === group)
      .map((b) => `<BackupFile><Path>${xmlEscape(b.logPath!)}</Path><StoragePath>${b.path}</StoragePath><LastWriteTime>${ft}</LastWriteTime><Size>${b.bytes.length}</Size></BackupFile>`)
      .join('')
  const log =
    `<BackupLog><BackupRestoreSyncVersion>11.53</BackupRestoreSyncVersion><ServerRoot>${xmlEscape(input.serverRoot)}</ServerRoot>` +
    `<SvrEncryptPwdFlag>${input.cryptKey ? 'true' : 'false'}</SvrEncryptPwdFlag><ServerEnableBinaryXML>false</ServerEnableBinaryXML><ServerEnableCompression>false</ServerEnableCompression>` +
    `<CompressionFlag>false</CompressionFlag><EncryptionFlag>false</EncryptionFlag><ObjectName>${input.databaseId}</ObjectName><ObjectId>${input.databaseId}</ObjectId>` +
    '<Write>ReadWrite</Write><OlapInfo>false</OlapInfo><IsTabular>true</IsTabular><Collations/><Languages><Language>1033</Language></Languages><FileGroups>' +
    `<FileGroup><Class>100002</Class><ID>${input.databaseId}</ID><Name>${input.databaseId}</Name><ObjectVersion>0</ObjectVersion><PersistLocation>0</PersistLocation>` +
    `<PersistLocationPath>${xmlEscape(dbFolder)}</PersistLocationPath><StorageLocationPath/><ObjectID>${input.databaseObjectId}</ObjectID><FileList>${fileList('db')}</FileList></FileGroup>` +
    `<FileGroup><Class>100069</Class><ID>${input.databaseId}</ID><Name>${input.databaseId}</Name><ObjectVersion>-1</ObjectVersion><PersistLocation>-1</PersistLocation>` +
    `<PersistLocationPath>${xmlEscape(dbFolder)}</PersistLocationPath><StorageLocationPath/><ObjectID>00000000-0000-0000-0000-000000000000</ObjectID><FileList>${fileList('files')}</FileList></FileGroup>` +
    '</FileGroups></BackupLog>'
  blobs.push({ path: 'LOG', bytes: utf16(log, true) })

  // blob offsets
  let off = PAGE
  const offsets: number[] = []
  for (const b of blobs) {
    offsets.push(off)
    off += b.bytes.length
  }
  const vdOffset = Math.ceil(off / PAGE) * PAGE
  const vd = utf8(
    '<VirtualDirectory>' +
      blobs
        .map(
          (b, i) =>
            `<BackupFile><Path>${b.path}</Path><Size>${b.bytes.length}</Size><m_cbOffsetHeader>${offsets[i]}</m_cbOffsetHeader><Delete>false</Delete>` +
            `<CreatedTimestamp>${ft}</CreatedTimestamp><Access>${ft}</Access><LastWriteTime>${ft}</LastWriteTime></BackupFile>`
        )
        .join('') +
      '</VirtualDirectory>'
  )
  const total = Math.ceil((vdOffset + vd.length) / PAGE) * PAGE
  const out = new Uint8Array(total)
  out.set(utf16(SIGNATURE, true), 0)
  const header =
    '<BackupLog><BackupRestoreSyncVersion>140</BackupRestoreSyncVersion><Fault>false</Fault><faultcode>0</faultcode><ErrorCode>false</ErrorCode>' +
    '<EncryptionFlag>false</EncryptionFlag><EncryptionKey>0</EncryptionKey><ApplyCompression>false</ApplyCompression>' +
    `<m_cbOffsetHeader>${vdOffset}</m_cbOffsetHeader><DataSize>${vd.length}</DataSize><Files>${blobs.length}</Files>` +
    `<ObjectID>${input.backupObjectId}</ObjectID><m_cbOffsetData>${PAGE}</m_cbOffsetData></BackupLog>`
  const hb = utf16(header)
  if (72 + hb.length > PAGE) throw new Error('ABF header too long')
  out.set(hb, 72)
  blobs.forEach((b, i) => out.set(b.bytes, offsets[i]))
  out.set(vd, vdOffset)
  return out
}

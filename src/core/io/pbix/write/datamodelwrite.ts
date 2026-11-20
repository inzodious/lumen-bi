/**
 * DataModel stream writer: wraps an Analysis Services backup (ABF) the way Power BI Desktop stores it in
 * the `DataModel` part of a `.pbix`. Mirrors the reader in `../datamodel/container.ts`.
 *
 * Framing written (as in every XPress9-compressed DataModel examined, including a file saved by
 * Power BI Desktop in November 2025 and the 2023 Microsoft samples):
 *   - 102 bytes: UTF-16LE "This backup was created using XPress9 compression." (50 characters, no BOM) + one NUL character
 *   - then one chunk per 2 MiB (2,097,152 bytes) of ABF, the last one shorter:
 *       [u32 LE uncompressed size][u32 LE compressed size][one XPress9 block]
 *     All blocks belong to ONE session (block index 0, 1, 2, …; one session signature), so back-references
 *     may reach into earlier chunks. Nothing follows the last chunk.
 * The multi-threaded framing ("…multithreaded XPrs9.") is read by Lumen but was not seen in any file
 * written by Power BI Desktop that is available here, so it is not written. Uncompressed DataModel streams
 * (bare ABF, 2017-era samples) are read too; Lumen always writes the XPress9 framing.
 */

import { decompressDataModel } from '../datamodel/container'
import { parseAbf } from '../datamodel/abf'
import { compressXpress9Blocks, type Xpress9EncodeOptions } from './xpress9enc'
import { rebuildAbf, type AbfRebuildOptions } from './abfwrite'

export const DATAMODEL_SIGNATURE = 'This backup was created using XPress9 compression.'
/** Byte length of the signature field (the text plus a terminating NUL character). */
export const DATAMODEL_SIGNATURE_BYTES = 102
/** Uncompressed bytes per chunk, as Power BI Desktop writes. */
export const DATAMODEL_CHUNK_SIZE = 2 * 1024 * 1024

export interface DataModelWriteOptions extends Xpress9EncodeOptions {
  onProgress?: (fraction: number) => void
}

/** Compress raw ABF bytes into a `DataModel` stream (single-threaded XPress9 framing). */
export function compressDataModel(abf: Uint8Array, opts: DataModelWriteOptions = {}): Uint8Array {
  const blocks = compressXpress9Blocks(abf, { ...opts, blockSize: opts.blockSize ?? DATAMODEL_CHUNK_SIZE })
  let total = DATAMODEL_SIGNATURE_BYTES
  for (const b of blocks) total += 8 + b.bytes.length
  const out = new Uint8Array(total)
  const dv = new DataView(out.buffer)
  let p = 0
  for (let i = 0; i < DATAMODEL_SIGNATURE.length; i++) {
    dv.setUint16(p, DATAMODEL_SIGNATURE.charCodeAt(i), true)
    p += 2
  }
  p = DATAMODEL_SIGNATURE_BYTES
  for (const b of blocks) {
    dv.setUint32(p, b.origSize, true)
    dv.setUint32(p + 4, b.bytes.length, true)
    out.set(b.bytes, p + 8)
    p += 8 + b.bytes.length
  }
  opts.onProgress?.(1)
  return out
}

export interface RepackOptions extends DataModelWriteOptions, AbfRebuildOptions {}

/**
 * Decode a `DataModel` stream, rebuild its ABF (replacing the inner files named in `replace`, keyed by
 * file name such as `metadata.sqlitedb`) and compress it again.
 */
export function repackDataModel(dataModel: Uint8Array, replace?: Map<string, Uint8Array>, opts: RepackOptions = {}): Uint8Array {
  const abf = decompressDataModel(dataModel)
  const rebuilt = rebuildAbf(parseAbf(abf), replace, opts)
  return compressDataModel(rebuilt, opts)
}

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { abfFileBytes, decompressDataModel, extractDataModelStream, parseAbf } from '../datamodel/index'
import { decompressXpress8Chunked } from '../datamodel/xpress8'
import { rebuildAbf, xpress8Stored } from './abfwrite'

const FIXTURES = join(import.meta.dirname, '../datamodel/__fixtures__')
const fixtureAbf = (name: string): Uint8Array => decompressDataModel(extractDataModelStream(new Uint8Array(readFileSync(join(FIXTURES, name)))))

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

/** Check that a rebuilt archive holds `replaced` for the named files and the original bytes for all others. */
function expectReplaced(original: Uint8Array, rebuilt: Uint8Array, replaced: Map<string, Uint8Array>): void {
  const a = parseAbf(original)
  const b = parseAbf(rebuilt)
  expect(b.files.map((f) => f.path)).toEqual(a.files.map((f) => f.path))
  expect(b.applyCompression).toBe(a.applyCompression)
  for (const f of a.files) {
    const want = replaced.get(f.fileName) ?? abfFileBytes(a, f.fileName)
    expect(sameBytes(abfFileBytes(b, f.fileName), want), f.fileName).toBe(true)
  }
  expect(rebuilt.length % 4096).toBe(0)
}

describe('ABF writer', () => {
  for (const name of ['data-profiling-demo.pbix', 'abc-multithreaded.pbix']) {
    it(`rebuilds ${name} byte-for-byte without replacements`, () => {
      const abf = fixtureAbf(name)
      expect(sameBytes(rebuildAbf(parseAbf(abf)), abf)).toBe(true)
    })
  }

  {
    const name = 'data-profiling-demo.pbix'

    it(`replaces files of ${name} with larger and smaller content`, () => {
      const abf = fixtureAbf(name)
      const a = parseAbf(abf)
      // the first and the largest non-log file, so every later blob, the directory and the log move
      const first = a.files[0]
      const largest = [...a.files].sort((x, y) => y.size - x.size)[0]
      const grown = new Uint8Array(abfFileBytes(a, first.fileName).length + 10_000).fill(0x5a)
      const shrunk = abfFileBytes(a, largest.fileName).subarray(0, 100).slice()
      const replace = new Map([
        [first.fileName, grown],
        [largest.fileName, shrunk]
      ])
      const rebuilt = rebuildAbf(a, replace)
      expectReplaced(abf, rebuilt, replace)
      // logical sizes in the backup log follow the new content
      const b = parseAbf(rebuilt)
      expect(b.byName.get(first.fileName)!.logSize).toBe(grown.length)
      expect(b.byName.get(largest.fileName)!.logSize).toBe(shrunk.length)
      // replacing with the same bytes reproduces the original
      expect(sameBytes(rebuildAbf(a, new Map([[first.fileName, abfFileBytes(a, first.fileName).slice()]])), abf)).toBe(true)
    })
  }

  it('refuses unknown files', () => {
    const a = parseAbf(fixtureAbf('data-profiling-demo.pbix'))
    expect(() => rebuildAbf(a, new Map([['no-such-file', new Uint8Array(1)]]))).toThrow(/not found/)
  })

  it('refuses to replace files of an archive with ErrorCode trailers (no Power BI file has them)', () => {
    // the abc fixture is an Analysis Services backup whose blobs end in a 4-byte trailer of unknown content
    const a = parseAbf(fixtureAbf('abc-multithreaded.pbix'))
    expect(a.errorCode).toBe(true)
    expect(() => rebuildAbf(a, new Map([[a.files[0].fileName, new Uint8Array(1)]]))).toThrow(/ErrorCode/)
  })

  it('writes XPress8 stored chunks that the reader decodes', () => {
    for (const n of [0, 1, 4095, 4096, 4097, 20_000]) {
      const data = new Uint8Array(n).map((_, i) => (i * 7) & 255)
      const enc = xpress8Stored(data)
      expect(enc.length).toBe(n + Math.ceil(n / 4096) * 4)
      expect(sameBytes(decompressXpress8Chunked(enc, n), data)).toBe(true)
    }
  })
})

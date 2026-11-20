/**
 * Huffman-compressed string page writer: the inverse of `decodeHuffmanPage` in `../../datamodel/vertipaq.ts`
 * ([MS-XLDM] 2.7.4; layout from pbixray / xmhuffman, MIT).
 *
 * Power BI Desktop stores a large string dictionary as one compressed page: every real file on hand keeps
 * uncompressed pages to 7,075 characters at most, and Desktop 2.159 rejects a much larger uncompressed page
 * ("Database consistency checks (DBCC) failed while checking the string store").
 *
 * Encoding: a canonical Huffman code over byte symbols, code lengths 1-15 nibble-packed in a 128-byte array (two
 * symbols per byte, low nibble first, 0 = unused). Charset-based pages (every UTF-16 unit shares one high byte,
 * `charsetUsed`; all real pages on hand, with high byte 0) encode the low bytes; general pages encode the UTF-16LE
 * bytes. Strings are concatenated without terminators; each string's handle is its first bit. Bits are written
 * most significant first, then every pair of bytes is swapped. The data is `2 * ceil(bits / 16) + 2` bytes long
 * (every real page), `bufferSize` equals that length, and `decodeBits` is `min(maxCodeLength, 10)` (real pages: equal to
 * the longest code up to 8, 8-10 above; the field is the decoder's first-level lookup width).
 */
import { HUFFMAN_CHARSET_BASED, HUFFMAN_GENERAL, type CompressedPage } from './dictionaryFormat'

const MAX_LEN = 15

/** Code lengths (1-15) for symbol frequencies; length-limited by flattening the frequencies until the code fits. */
export function codeLengths(freq: ArrayLike<number>): Uint8Array {
  const n = freq.length
  let f = Array.from(freq)
  for (;;) {
    const lengths = huffmanLengths(f)
    let max = 0
    for (let i = 0; i < n; i++) if (lengths[i] > max) max = lengths[i]
    if (max <= MAX_LEN) return lengths
    f = f.map((x) => (x ? Math.max(1, Math.ceil(x / 2)) : 0))
  }
}

function huffmanLengths(freq: number[]): Uint8Array {
  const n = freq.length
  const lengths = new Uint8Array(n)
  const used = freq.map((f, i) => [f, i] as [number, number]).filter(([f]) => f > 0)
  if (used.length === 0) return lengths
  if (used.length === 1) {
    lengths[used[0][1]] = 1
    return lengths
  }
  interface Node {
    w: number
    sym?: number
    l?: Node
    r?: Node
  }
  let nodes: Node[] = used.map(([w, sym]) => ({ w, sym }))
  // simple O(n^2) merge: at most 256 symbols
  while (nodes.length > 1) {
    nodes.sort((a, b) => a.w - b.w)
    const [a, b] = nodes
    nodes = [{ w: a.w + b.w, l: a, r: b }, ...nodes.slice(2)]
  }
  const walk = (node: Node, depth: number): void => {
    if (node.sym !== undefined) lengths[node.sym] = Math.max(1, depth)
    else {
      walk(node.l!, depth + 1)
      walk(node.r!, depth + 1)
    }
  }
  walk(nodes[0], 0)
  return lengths
}

/** Canonical codes in the order the decoder builds them (by length, then symbol). */
function canonicalCodes(lengths: Uint8Array): Uint32Array {
  const count = new Uint32Array(17)
  for (const L of lengths) if (L) count[L]++
  const next = new Uint32Array(17)
  let code = 0
  for (let L = 1; L <= 16; L++) {
    code = (code + count[L - 1]) << 1
    next[L] = code
  }
  const codes = new Uint32Array(lengths.length)
  for (let s = 0; s < lengths.length; s++) if (lengths[s]) codes[s] = next[lengths[s]]++
  return codes
}

export interface CompressedStrings {
  body: CompressedPage
  /** bit offset of each string */
  handles: number[]
}

/** Compress strings into one page. */
export function compressStrings(strings: readonly string[]): CompressedStrings {
  let hi = -1
  let charset = true
  for (const s of strings)
    for (let i = 0; i < s.length && charset; i++) {
      const h = s.charCodeAt(i) >>> 8
      if (hi < 0) hi = h
      else if (h !== hi) charset = false
    }
  if (hi < 0) hi = 0
  const symbolsOf = (s: string, out: number[]): void => {
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i)
      if (charset) out.push(c & 255)
      else out.push(c & 255, c >>> 8)
    }
  }
  const freq = new Array<number>(256).fill(0)
  const syms: number[][] = strings.map((s) => {
    const o: number[] = []
    symbolsOf(s, o)
    for (const b of o) freq[b]++
    return o
  })
  // a page whose strings are all empty still needs a code
  if (!freq.some((x) => x > 0)) freq[0] = 1
  const lengths = codeLengths(freq)
  const codes = canonicalCodes(lengths)
  let bits = 0
  for (const o of syms) for (const b of o) bits += lengths[b]
  const len = 2 * Math.ceil(bits / 16) + 2
  const raw = new Uint8Array(len)
  const handles: number[] = []
  let pos = 0
  for (const o of syms) {
    handles.push(pos)
    for (const b of o) {
      const L = lengths[b]
      const c = codes[b]
      for (let k = L - 1; k >= 0; k--) {
        if ((c >>> k) & 1) raw[pos >>> 3] |= 0x80 >>> (pos & 7)
        pos++
      }
    }
  }
  // pair-swap
  const data = new Uint8Array(len)
  for (let i = 0; i + 1 < len; i += 2) {
    data[i] = raw[i + 1]
    data[i + 1] = raw[i]
  }
  const encodeArray = new Uint8Array(128)
  for (let i = 0; i < 128; i++) encodeArray[i] = (lengths[2 * i] & 15) | ((lengths[2 * i + 1] & 15) << 4)
  let maxL = 0
  for (const L of lengths) if (L > maxL) maxL = L
  const body: CompressedPage = {
    compressed: true,
    totalBits: bits,
    charsetType: charset ? HUFFMAN_CHARSET_BASED : HUFFMAN_GENERAL,
    ...(charset ? { charsetUsed: hi } : {}),
    decodeBits: Math.min(maxL, 10),
    encodeArray,
    bufferSize: len,
    data
  }
  return { body, handles }
}

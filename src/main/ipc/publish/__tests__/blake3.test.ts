import { describe, expect, it } from 'vitest'
import { blake3Hex } from '../blake3'

/** Official BLAKE3 test vectors: input byte i = i % 251, hash mode, first 32 bytes of the extended output. */
const VECTORS: Array<[number, string]> = [
  [0, 'af1349b9f5f9a1a6a0404dea36dcc9499bcb25c9adc112b7cc9a93cae41f3262'],
  [1, '2d3adedff11b61f14c886e35afa036736dcd87a74d27b5c1510225d0f592e213'],
  [1023, '10108970eeda3eb932baac1428c7a2163b0e924c9a9e25b35bba72b28f70bd11'],
  [1024, '42214739f095a406f3fc83deb889744ac00df831c10daa55189b5d121c855af7'],
  [1025, 'd00278ae47eb27b34faecf67b4fe263f82d5412916c1ffd97c8cb7fb814b8444'],
  [2048, 'e776b6028c7cd22a4d0ba182a8bf62205d2ef576467e838ed6f2529b85fba24a'],
  [3072, 'b98cb0ff3623be03326b373de6b9095218513e64f1ee2edd2525c7ad1e5cffd2'],
  [4097, '9b4052b38f1c5fc8b1f9ff7ac7b27cd242487b3d890d15c96a1c25b8aa0fb995'],
  [31744, '62b6960e1a44bcc1eb1a611a8d6235b6b4b78f32e7abc4fb4c6cdcce94895c47']
]

describe('blake3', () => {
  it.each(VECTORS)('matches the official vector for %i bytes', (len, hex) => {
    const input = Uint8Array.from({ length: len }, (_, i) => i % 251)
    expect(blake3Hex(input)).toBe(hex)
  })
})

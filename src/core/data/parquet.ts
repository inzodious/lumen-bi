/**
 * Parquet decoding for `Parquet.Document` (via hyparquet). Produces a HostTable in the M host's
 * normalized value shape: INT64 (bigint) → number (values outside ±2^53 are converted with a precision
 * loss, like Power BI's Int64 → double for display — Power Query's Int64 is exact, an accepted gap),
 * DATE → 'date', TIMESTAMP → 'timestamp' (Date whose UTC fields carry the wall clock: UTC-adjusted
 * timestamps therefore show in UTC, which is what Power Query does for Parquet), DECIMAL → number.
 */
import { parquetMetadata, parquetRead, parquetSchema } from 'hyparquet'
import type { HostColumn, HostTable } from '../m/host.ts'

interface SchemaNode {
  element: { name: string; type?: string; converted_type?: string; logical_type?: { type: string; bitWidth?: number }; repetition_type?: string }
  children: SchemaNode[]
}

function logicalTypeOf(node: SchemaNode): string {
  const e = node.element
  if (node.children.length) return 'any'
  const lt = e.logical_type?.type
  const ct = e.converted_type
  if (lt === 'STRING' || lt === 'ENUM' || lt === 'UUID' || lt === 'JSON' || ct === 'UTF8' || ct === 'ENUM' || ct === 'JSON') return 'varchar'
  if (lt === 'DATE' || ct === 'DATE') return 'date'
  if (lt === 'TIMESTAMP' || ct === 'TIMESTAMP_MILLIS' || ct === 'TIMESTAMP_MICROS' || e.type === 'INT96') return 'timestamp'
  if (lt === 'TIME' || ct === 'TIME_MILLIS' || ct === 'TIME_MICROS') return 'time'
  if (lt === 'DECIMAL' || ct === 'DECIMAL') return 'decimal'
  switch (e.type) {
    case 'BOOLEAN':
      return 'boolean'
    case 'INT32':
      return 'integer'
    case 'INT64':
      return 'bigint'
    case 'FLOAT':
    case 'DOUBLE':
      return 'double'
    case 'BYTE_ARRAY':
    case 'FIXED_LEN_BYTE_ARRAY':
      return 'binary'
  }
  return 'any'
}

function normalize(v: unknown, type: string): unknown {
  if (v === undefined || v === null) return null
  if (typeof v === 'bigint') return Number(v)
  if (type === 'time') {
    if (typeof v === 'number') return msToTime(v)
    if (v instanceof Date) return msToTime(v.getTime() % 86_400_000)
  }
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v
  if (Array.isArray(v)) return v.map((x) => normalize(x, 'any'))
  if (v instanceof Uint8Array) return v
  if (typeof v === 'object') return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, normalize(x, 'any')]))
  return v
}

function msToTime(ms: number): string {
  const p = (n: number) => String(n).padStart(2, '0')
  const s = Math.floor(ms / 1000)
  return `${p(Math.floor(s / 3600) % 24)}:${p(Math.floor(s / 60) % 60)}:${p(s % 60)}`
}

export async function decodeParquet(bytes: Uint8Array): Promise<HostTable> {
  const buffer = bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength ? (bytes.buffer as ArrayBuffer) : (bytes.slice().buffer as ArrayBuffer)
  const metadata = parquetMetadata(buffer)
  const schema = parquetSchema(metadata) as unknown as SchemaNode
  const columns: HostColumn[] = schema.children.map((c) => ({ name: c.element.name, type: logicalTypeOf(c) }))
  const rows = await new Promise<unknown[][]>((resolve, reject) => {
    parquetRead({ file: buffer, metadata, rowFormat: 'array', onComplete: (data: unknown[][]) => resolve(data) }).catch(reject)
  })
  const types = columns.map((c) => c.type)
  for (const r of rows) for (let i = 0; i < r.length; i++) r[i] = normalize(r[i], types[i]!)
  return { columns, rows }
}

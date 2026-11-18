import type { Column, LogicalType, QueryResult, Value } from "./types.ts";

const T = {
  Null: 1,
  Int: 2,
  Float: 3,
  Binary: 4,
  Utf8: 5,
  Bool: 6,
  Decimal: 7,
  Date: 8,
  Time: 9,
  Timestamp: 10,
  Interval: 11,
  List: 12,
  Struct: 13,
  FixedSizeList: 16,
  Map: 17,
  Duration: 18,
  LargeBinary: 19,
  LargeUtf8: 20,
} as const;

interface ArrowType {
  typeId: number;
  bitWidth?: number;
  unit?: number;
  scale?: number;
  children?: { name: string; type: ArrowType }[];
  toString(): string;
}

interface ArrowField {
  name: string;
  type: ArrowType;
}

interface ArrowVector {
  length: number;
  get(i: number): unknown;
}

export interface ArrowTableLike {
  numRows: number;
  schema: { fields: ArrowField[] };
  getChildAt(i: number): ArrowVector | null;
}

export function logicalType(type: ArrowType): LogicalType {
  switch (type.typeId) {
    case T.Null:
      return "null";
    case T.Int:
      return (type.bitWidth ?? 32) > 32 ? "bigint" : "integer";
    case T.Float:
      return "double";
    case T.Decimal:
      return "decimal";
    case T.Utf8:
    case T.LargeUtf8:
      return "varchar";
    case T.Bool:
      return "boolean";
    case T.Date:
      return "date";
    case T.Timestamp:
      return "timestamp";
    case T.Time:
      return "time";
    case T.Interval:
    case T.Duration:
      return "interval";
    case T.List:
    case T.FixedSizeList:
      return "list";
    case T.Struct:
      return "struct";
    case T.Map:
      return "map";
    case T.Binary:
    case T.LargeBinary:
      return "blob";
    default:
      return "other";
  }
}

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

function formatDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

function formatTimestamp(ms: number): string {
  const whole = Math.floor(ms);
  const d = new Date(whole);
  const base = `${formatDate(whole)} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
  const micros = Math.round((ms - whole) * 1000) + d.getUTCMilliseconds() * 1000;
  if (micros === 0) return base;
  return `${base}.${String(micros).padStart(6, "0").replace(/0+$/, "")}`;
}

function formatTime(raw: unknown, unit: number): string {
  const perSecond = [1n, 1000n, 1000000n, 1000000000n][unit] ?? 1000000n;
  const ticks = typeof raw === "bigint" ? raw : BigInt(Math.round(Number(raw)));
  const seconds = Number(ticks / perSecond);
  const frac = ticks % perSecond;
  const base = `${pad(Math.floor(seconds / 3600))}:${pad(Math.floor(seconds / 60) % 60)}:${pad(seconds % 60)}`;
  if (frac === 0n) return base;
  return `${base}.${frac.toString().padStart(perSecond.toString().length - 1, "0").replace(/0+$/, "")}`;
}

function decimalToNumber(raw: unknown, scale: number): number {
  if (typeof raw === "number") return raw;
  if (typeof raw === "bigint") return Number(raw) / 10 ** scale;
  const words = raw as Uint32Array;
  let big = 0n;
  for (let i = words.length - 1; i >= 0; i--) big = (big << 32n) | BigInt(words[i] ?? 0);
  const bits = BigInt(words.length * 32);
  if (words.length && ((words[words.length - 1] ?? 0) & 0x80000000) !== 0) big -= 1n << bits;
  return Number(big) / 10 ** scale;
}

function toPlain(value: unknown, type: ArrowType): Value {
  if (value === null || value === undefined) return null;
  switch (type.typeId) {
    case T.Int:
      if (typeof value === "bigint") {
        return value <= BigInt(Number.MAX_SAFE_INTEGER) && value >= BigInt(Number.MIN_SAFE_INTEGER)
          ? Number(value)
          : value.toString();
      }
      return value as number;
    case T.Decimal:
      return decimalToNumber(value, type.scale ?? 0);
    case T.Date:
      return formatDate(Number(value));
    case T.Timestamp:
      return formatTimestamp(Number(value));
    case T.Time:
      return formatTime(value, type.unit ?? 2);
    case T.List:
    case T.FixedSizeList: {
      const child = type.children?.[0]?.type;
      const vec = value as ArrowVector;
      const out: Value[] = [];
      for (let i = 0; i < vec.length; i++) out.push(child ? toPlain(vec.get(i), child) : (vec.get(i) as Value));
      return out;
    }
    case T.Struct: {
      const rec = value as Record<string, unknown>;
      const out: Record<string, Value> = {};
      for (const c of type.children ?? []) out[c.name] = toPlain(rec[c.name], c.type);
      return out;
    }
    case T.Binary:
    case T.LargeBinary:
      return `<blob ${(value as Uint8Array).length} bytes>`;
    default:
      if (typeof value === "bigint") return value.toString();
      if (typeof value === "object") return JSON.parse(JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
      return value as Value;
  }
}

export function arrowToResult(table: ArrowTableLike): QueryResult {
  const fields = table.schema.fields;
  const columns: Column[] = fields.map((f) => ({ name: f.name, type: logicalType(f.type), rawType: String(f.type) }));
  const vectors = fields.map((_f, i) => table.getChildAt(i));
  const rows: Value[][] = [];
  for (let r = 0; r < table.numRows; r++) {
    rows.push(fields.map((f, c) => toPlain(vectors[c]?.get(r), f.type)));
  }
  return { columns, rows };
}

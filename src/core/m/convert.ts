import {
  formatCustom,
  formatDuration,
  formatOffset,
  parseDateTimeText,
  parseDurationText,
  parseTimeText,
} from "./calendar.ts";
import { EN_US, type Culture } from "./culture.ts";
import { MError } from "./errors.ts";
import {
  MBinary,
  MDate,
  MDateTime,
  MDateTimeZone,
  MDuration,
  MS_PER_DAY,
  MTime,
  MType,
  cannotConvert,
  formatNumber,
  kindOf,
  type MValue,
} from "./values.ts";

/** Days between the OLE Automation epoch (1899-12-30) and 1970-01-01, which is what Number.From(date) counts from. */
export const OA_EPOCH_OFFSET = 25569;

const decoder = new TextDecoder();

function dataFormat(message: string, detail: MValue): MError {
  return new MError("DataFormat.Error", message, detail);
}

export function roundHalfEven(n: number, digits = 0): number {
  const f = 10 ** digits;
  const x = n * f;
  const floor = Math.floor(x);
  const r = Math.abs(x - floor - 0.5) < 1e-9 ? (floor % 2 === 0 ? floor : floor + 1) : Math.round(x);
  return r / f;
}

export function toText(v: MValue, c: Culture = EN_US): string | null {
  if (v === null) return null;
  switch (kindOf(v)) {
    case "text":
      return v as string;
    case "number": {
      const s = formatNumber(v as number);
      return c.decimal === "." ? s : s.replace(".", c.decimal);
    }
    case "logical":
      return v ? "true" : "false";
    case "date":
      return formatCustom((v as MDate).days * MS_PER_DAY, c.shortDate, undefined, c);
    case "datetime":
      return formatCustom((v as MDateTime).ms, `${c.shortDate} ${c.longTime}`, undefined, c);
    case "datetimezone": {
      const z = v as MDateTimeZone;
      return `${formatCustom(z.ms, `${c.shortDate} ${c.longTime}`, undefined, c)} ${formatOffset(z.offsetMinutes)}`;
    }
    case "time":
      return formatCustom((v as MTime).ms, c.longTime, undefined, c);
    case "duration":
      return formatDuration((v as MDuration).ms);
    case "binary":
      return decoder.decode((v as MBinary).bytes);
    default:
      throw cannotConvert(v, "Text");
  }
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const numberPatterns = new Map<string, RegExp>();

/** Like .NET, group separators may appear anywhere in the integer part ("9,5" is 95 in en-US). */
function numberPattern(c: Culture): RegExp {
  let re = numberPatterns.get(c.name);
  if (!re) {
    const group = c.groupParse.map(escapeRe).join("|");
    re = new RegExp(`^([+-]?)(\\d(?:\\d|${group})*)?(?:${escapeRe(c.decimal)}(\\d*))?(?:[eE]([+-]?\\d+))?$`);
    numberPatterns.set(c.name, re);
  }
  return re;
}

export function numberFromText(s: string, c: Culture = EN_US): number {
  const t = s.trim();
  if (c.english && /^[+-]?infinity$/i.test(t)) return t.startsWith("-") ? -Infinity : Infinity;
  if (c.english && /^nan$/i.test(t)) return NaN;
  const m = numberPattern(c).exec(t);
  if (!m || (!m[2] && !m[3])) throw dataFormat("We couldn't convert to Number.", s);
  const int = (m[2] ?? "0").replace(/\D/g, "");
  return Number(`${m[1]}${int}.${m[3] || "0"}${m[4] ? `e${m[4]}` : ""}`);
}

export function toNumber(v: MValue, c: Culture = EN_US): number | null {
  if (v === null) return null;
  switch (kindOf(v)) {
    case "number":
      return v as number;
    case "text":
      return numberFromText(v as string, c);
    case "logical":
      return v ? 1 : 0;
    case "date":
      return (v as MDate).days + OA_EPOCH_OFFSET;
    case "datetime":
      return (v as MDateTime).ms / MS_PER_DAY + OA_EPOCH_OFFSET;
    case "datetimezone":
      return (v as MDateTimeZone).utcMs / MS_PER_DAY + OA_EPOCH_OFFSET;
    case "time":
      return (v as MTime).ms / MS_PER_DAY;
    case "duration":
      return (v as MDuration).ms / MS_PER_DAY;
    default:
      throw cannotConvert(v, "Number");
  }
}

export function toLogical(v: MValue): boolean | null {
  if (v === null) return null;
  switch (kindOf(v)) {
    case "logical":
      return v as boolean;
    case "number":
      return v !== 0;
    case "text": {
      const t = (v as string).trim().toLowerCase();
      if (t === "true") return true;
      if (t === "false") return false;
      throw dataFormat("We couldn't convert to Logical.", v);
    }
    default:
      throw cannotConvert(v, "Logical");
  }
}

function toLocalMs(z: MDateTimeZone, localOffsetMinutes: number): number {
  return z.utcMs + localOffsetMinutes * 60_000;
}

export function toDate(v: MValue, localOffsetMinutes = 0, c: Culture = EN_US): MDate | null {
  if (v === null) return null;
  switch (kindOf(v)) {
    case "date":
      return v as MDate;
    case "datetime":
      return new MDate(Math.floor((v as MDateTime).ms / MS_PER_DAY));
    case "datetimezone":
      return new MDate(Math.floor(toLocalMs(v as MDateTimeZone, localOffsetMinutes) / MS_PER_DAY));
    case "number":
      return new MDate(Math.floor(v as number) - OA_EPOCH_OFFSET);
    case "text": {
      const p = parseDateTimeText(v as string, c);
      if (!p) throw dataFormat("We couldn't parse the input provided as a Date value.", v);
      return new MDate(Math.floor(p.ms / MS_PER_DAY));
    }
    default:
      throw cannotConvert(v, "Date");
  }
}

export function toDateTime(v: MValue, localOffsetMinutes = 0, c: Culture = EN_US): MDateTime | null {
  if (v === null) return null;
  switch (kindOf(v)) {
    case "datetime":
      return v as MDateTime;
    case "date":
      return new MDateTime((v as MDate).days * MS_PER_DAY);
    case "datetimezone":
      return new MDateTime(toLocalMs(v as MDateTimeZone, localOffsetMinutes));
    case "time":
      return new MDateTime(-OA_EPOCH_OFFSET * MS_PER_DAY + (v as MTime).ms);
    case "number":
      return new MDateTime(Math.round(((v as number) - OA_EPOCH_OFFSET) * MS_PER_DAY));
    case "text": {
      const p = parseDateTimeText(v as string, c);
      if (!p) throw dataFormat("We couldn't parse the input provided as a DateTime value.", v);
      if (p.offsetMinutes !== undefined) return new MDateTime(p.ms - p.offsetMinutes * 60_000 + localOffsetMinutes * 60_000);
      return new MDateTime(p.ms);
    }
    default:
      throw cannotConvert(v, "DateTime");
  }
}

export function toDateTimeZone(v: MValue, localOffsetMinutes = 0, c: Culture = EN_US): MDateTimeZone | null {
  if (v === null) return null;
  switch (kindOf(v)) {
    case "datetimezone":
      return v as MDateTimeZone;
    case "datetime":
      return new MDateTimeZone((v as MDateTime).ms, localOffsetMinutes);
    case "date":
      return new MDateTimeZone((v as MDate).days * MS_PER_DAY, localOffsetMinutes);
    case "text": {
      const p = parseDateTimeText(v as string, c);
      if (!p) throw dataFormat("We couldn't parse the input provided as a DateTimeZone value.", v);
      return new MDateTimeZone(p.ms, p.offsetMinutes ?? localOffsetMinutes);
    }
    default:
      throw cannotConvert(v, "DateTimeZone");
  }
}

export function toTime(v: MValue, c: Culture = EN_US): MTime | null {
  if (v === null) return null;
  switch (kindOf(v)) {
    case "time":
      return v as MTime;
    case "datetime": {
      const ms = (v as MDateTime).ms;
      return new MTime(ms - Math.floor(ms / MS_PER_DAY) * MS_PER_DAY);
    }
    case "number": {
      const frac = (v as number) - Math.floor(v as number);
      return new MTime(Math.round(frac * MS_PER_DAY));
    }
    case "text": {
      const direct = parseTimeText(v as string, c);
      if (direct !== null) return new MTime(direct);
      const p = parseDateTimeText(v as string, c);
      if (p?.hasTime) return new MTime(p.ms - Math.floor(p.ms / MS_PER_DAY) * MS_PER_DAY);
      throw dataFormat("We couldn't parse the input provided as a Time value.", v);
    }
    default:
      throw cannotConvert(v, "Time");
  }
}

export function toDuration(v: MValue): MDuration | null {
  if (v === null) return null;
  switch (kindOf(v)) {
    case "duration":
      return v as MDuration;
    case "number":
      return new MDuration(Math.round((v as number) * MS_PER_DAY));
    case "text": {
      const ms = parseDurationText(v as string);
      if (ms === null) throw dataFormat("We couldn't parse the input provided as a Duration value.", v);
      return new MDuration(ms);
    }
    default:
      throw cannotConvert(v, "Duration");
  }
}

const INTEGER_FACETS = new Set(["Int64", "Int32", "Int16", "Int8", "Byte"]);

const BLANK_TO_NULL = new Set(["number", "date", "datetime", "datetimezone"]);

/**
 * The conversion Table.TransformColumnTypes applies to one cell. A blank text
 * cell becomes null in number and date columns (what Changed Type does to empty CSV fields).
 */
export function convertToType(v: MValue, t: MType, localOffsetMinutes = 0, c: Culture = EN_US): MValue {
  if (v === null) return null;
  if (v === "" && BLANK_TO_NULL.has(t.kind)) return null;
  switch (t.kind) {
    case "any":
    case "anynonnull":
      return v;
    case "text":
      return toText(v, c);
    case "number": {
      const n = toNumber(v, c)!;
      if (t.facet && INTEGER_FACETS.has(t.facet)) return roundHalfEven(n);
      if (t.facet === "Currency") return roundHalfEven(n, 4);
      return n;
    }
    case "logical":
      return toLogical(v);
    case "date":
      return toDate(v, localOffsetMinutes, c);
    case "datetime":
      return toDateTime(v, localOffsetMinutes, c);
    case "datetimezone":
      return toDateTimeZone(v, localOffsetMinutes, c);
    case "time":
      return toTime(v, c);
    case "duration":
      return toDuration(v);
    default:
      if (conformsTo(v, t)) return v;
      throw cannotConvert(v, t.kind === "list" ? "List" : t.kind === "record" ? "Record" : t.kind === "table" ? "Table" : t.kind);
  }
}

export function conformsTo(v: MValue, t: MType): boolean {
  if (t.kind === "any") return true;
  if (v === null) return t.nullable || t.kind === "null";
  if (t.kind === "anynonnull") return true;
  if (t.kind === "none") return false;
  return kindOf(v) === t.kind;
}

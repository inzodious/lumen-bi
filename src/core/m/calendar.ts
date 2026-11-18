import { EN_US, cultureUnsupported, type Culture } from "./culture.ts";
import { MError } from "./errors.ts";

const MS_PER_DAY = 86_400_000;

/** Days since 1970-01-01 for a proleptic Gregorian date (Hinnant's algorithm). */
export function daysFromCivil(y: number, m: number, d: number): number {
  const yy = m <= 2 ? y - 1 : y;
  const era = Math.floor(yy / 400);
  const yoe = yy - era * 400;
  const mp = (m + 9) % 12;
  const doy = Math.floor((153 * mp + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

export function civilFromDays(days: number): { y: number; m: number; d: number } {
  const z = days + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp < 10 ? mp + 3 : mp - 9;
  return { y: yoe + era * 400 + (m <= 2 ? 1 : 0), m, d };
}

export function isLeap(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

export function daysInMonth(y: number, m: number): number {
  return [31, isLeap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]!;
}

export function validDate(y: number, m: number, d: number): boolean {
  return (
    Number.isInteger(y) && Number.isInteger(m) && Number.isInteger(d) && y >= 1 && y <= 9999 && m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m)
  );
}

export interface DateTimeParts {
  y: number;
  m: number;
  d: number;
  h: number;
  mi: number;
  s: number;
  ms: number;
}

export function partsOf(ms: number): DateTimeParts {
  const days = Math.floor(ms / MS_PER_DAY);
  const rem = ms - days * MS_PER_DAY;
  const { y, m, d } = civilFromDays(days);
  return {
    y,
    m,
    d,
    h: Math.floor(rem / 3_600_000),
    mi: Math.floor((rem % 3_600_000) / 60_000),
    s: Math.floor((rem % 60_000) / 1000),
    ms: Math.round(rem % 1000),
  };
}

export function msFromParts(y: number, m: number, d: number, h = 0, mi = 0, s = 0): number {
  return daysFromCivil(y, m, d) * MS_PER_DAY + h * 3_600_000 + mi * 60_000 + Math.round(s * 1000);
}

const p2 = (n: number) => String(n).padStart(2, "0");
const p4 = (n: number) => String(n).padStart(4, "0");
const frac = (ms: number) => (ms ? `.${String(ms).padStart(3, "0").replace(/0+$/, "")}` : "");

export function formatDate(days: number): string {
  const { y, m, d } = civilFromDays(days);
  return `${p4(y)}-${p2(m)}-${p2(d)}`;
}

export function formatTime(ms: number): string {
  const p = partsOf(ms);
  return `${p2(p.h)}:${p2(p.mi)}:${p2(p.s)}${frac(p.ms)}`;
}

export function formatDateTime(ms: number): string {
  return `${formatDate(Math.floor(ms / MS_PER_DAY))}T${formatTime(ms - Math.floor(ms / MS_PER_DAY) * MS_PER_DAY)}`;
}

export function formatOffset(minutes: number): string {
  const sign = minutes < 0 ? "-" : "+";
  const a = Math.abs(minutes);
  return `${sign}${p2(Math.floor(a / 60))}:${p2(a % 60)}`;
}

export function durationParts(ms: number): { sign: number; d: number; h: number; mi: number; s: number; ms: number } {
  const sign = ms < 0 ? -1 : 1;
  const a = Math.abs(ms);
  return {
    sign,
    d: Math.floor(a / MS_PER_DAY),
    h: Math.floor((a % MS_PER_DAY) / 3_600_000),
    mi: Math.floor((a % 3_600_000) / 60_000),
    s: Math.floor((a % 60_000) / 1000),
    ms: Math.round(a % 1000),
  };
}

/** `d.hh:mm:ss`, the way Power Query shows a duration. */
export function formatDuration(ms: number): string {
  const p = durationParts(ms);
  return `${p.sign < 0 ? "-" : ""}${p.d}.${p2(p.h)}:${p2(p.mi)}:${p2(p.s)}${frac(p.ms)}`;
}

export function describeDateTimeArgs(ms: number): string {
  const p = partsOf(ms);
  return `${p.y}, ${p.m}, ${p.d}, ${p.h}, ${p.mi}, ${p.s + p.ms / 1000}`;
}

export function dayOfWeek(days: number): number {
  return (((days + 4) % 7) + 7) % 7;
}

/**
 * .NET custom date/time format strings: yyyy yy MMMM MMM MM M dddd ddd dd d
 * HH H hh h mm m ss s fff ff f tt, `/` and `:` separators, quoted literals and backslash escapes.
 */
export function formatCustom(ms: number, format: string, offsetMinutes?: number, c: Culture = EN_US): string {
  const p = partsOf(ms);
  const days = Math.floor(ms / MS_PER_DAY);
  let out = "";
  let i = 0;
  while (i < format.length) {
    const ch = format[i]!;
    if (ch === "'" || ch === '"') {
      const end = format.indexOf(ch, i + 1);
      out += format.slice(i + 1, end < 0 ? format.length : end);
      i = end < 0 ? format.length : end + 1;
      continue;
    }
    if (ch === "\\") {
      out += format[i + 1] ?? "";
      i += 2;
      continue;
    }
    if (ch === "%") {
      i++;
      continue;
    }
    let n = 1;
    while (format[i + n] === ch) n++;
    const h12 = p.h % 12 === 0 ? 12 : p.h % 12;
    switch (ch) {
      case "y":
        out += n <= 2 ? p2(p.y % 100) : String(p.y).padStart(n, "0");
        break;
      case "M":
        if (n === 3 && !c.monthsAbbr) throw cultureUnsupported(c, 'Abbreviated month names ("MMM")');
        out += n >= 4 ? c.months[p.m - 1] : n === 3 ? c.monthsAbbr![p.m - 1] : n === 2 ? p2(p.m) : String(p.m);
        break;
      case "d":
        if (n === 3 && !c.daysAbbr) throw cultureUnsupported(c, 'Abbreviated day names ("ddd")');
        out += n >= 4 ? c.days[dayOfWeek(days)] : n === 3 ? c.daysAbbr![dayOfWeek(days)] : n === 2 ? p2(p.d) : String(p.d);
        break;
      case "H":
        out += n >= 2 ? p2(p.h) : String(p.h);
        break;
      case "h":
        out += n >= 2 ? p2(h12) : String(h12);
        break;
      case "m":
        out += n >= 2 ? p2(p.mi) : String(p.mi);
        break;
      case "s":
        out += n >= 2 ? p2(p.s) : String(p.s);
        break;
      case "f":
      case "F":
        out += String(p.ms).padStart(3, "0").padEnd(n, "0").slice(0, n);
        break;
      case "t": {
        if (!c.amPm) throw cultureUnsupported(c, 'The AM/PM designator ("tt")');
        const mark = c.amPm[p.h < 12 ? 0 : 1];
        out += n >= 2 ? mark : mark.slice(0, 1);
        break;
      }
      case "z":
        out += offsetMinutes === undefined ? "" : n >= 3 ? formatOffset(offsetMinutes) : String(Math.trunc(offsetMinutes / 60));
        break;
      case "/":
        out += c.dateSep.repeat(n);
        break;
      default:
        out += ch.repeat(n);
    }
    i += n;
  }
  return out;
}

function num(s: string | undefined): number {
  return s === undefined ? 0 : Number(s);
}

export interface ParsedDateTime {
  ms: number;
  hasTime: boolean;
  offsetMinutes?: number;
}

const ISO = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d{1,7}))?)?)?\s*(Z|[+-]\d{2}:?\d{2})?$/i;
const NAMED = /^(?:(\d{1,2})\s+([A-Za-z]+)|([A-Za-z]+)\s+(\d{1,2}),?)\s+(\d{4})$/;
const TIME_TAIL = String.raw`(?:\s+(\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d{1,7}))?)?\s*(AM|PM)?)?`;

const numericDates = new Map<string, RegExp>();

/** The culture's numeric short date (`M/d/yyyy`, `d/M/yyyy`, `d.M.yyyy`) with an optional time. */
function numericDate(c: Culture): RegExp {
  let re = numericDates.get(c.name);
  if (!re) {
    const sep = c.dateSep === "." ? "\\." : c.dateSep;
    re = new RegExp(`^(\\d{1,2})${sep}(\\d{1,2})${sep}(\\d{4})${TIME_TAIL}$`, "i");
    numericDates.set(c.name, re);
  }
  return re;
}

function hasAmPm(c: Culture): boolean {
  return c.amPm !== null && c.amPm[0] !== "";
}

function monthByName(c: Culture, name: string): number | undefined {
  const n = name.toLowerCase();
  const full = c.months.findIndex((m) => m.toLowerCase() === n);
  if (full >= 0) return full + 1;
  const abbr = c.monthsAbbr?.findIndex((m) => m.toLowerCase() === n) ?? -1;
  if (abbr >= 0) return abbr + 1;
  return c.monthsAbbrAlt?.[n];
}

function build(y: number, m: number, d: number, h: number, mi: number, s: number, f: string | undefined): ParsedDateTime | null {
  if (!validDate(y, m, d) || h > 23 || mi > 59 || s > 59) return null;
  const ms = f ? Math.round(Number(`0.${f}`) * 1000) : 0;
  return { ms: msFromParts(y, m, d, h, mi, s) + ms, hasTime: true };
}

/** Best-effort parsing (no Format): ISO 8601 in every culture, plus the culture's own short date shape. */
export function parseDateTimeText(text: string, c: Culture = EN_US): ParsedDateTime | null {
  const s = text.trim();
  let m = ISO.exec(s);
  if (m) {
    const r = build(num(m[1]), num(m[2]), num(m[3]), num(m[4]), num(m[5]), num(m[6]), m[7]);
    if (!r) return null;
    r.hasTime = m[4] !== undefined;
    if (m[8]) {
      const z = m[8].toUpperCase();
      if (z === "Z") r.offsetMinutes = 0;
      else {
        const digits = z.replace(":", "");
        const sign = digits[0] === "-" ? -1 : 1;
        r.offsetMinutes = sign * (Number(digits.slice(1, 3)) * 60 + Number(digits.slice(3, 5)));
      }
    }
    return r;
  }
  m = numericDate(c).exec(s);
  if (m) {
    let h = num(m[4]);
    const ampm = m[8]?.toUpperCase();
    if (ampm) {
      if (!hasAmPm(c) || h < 1 || h > 12) return null;
      h = (h % 12) + (ampm === "PM" ? 12 : 0);
    }
    const [month, day] = c.dayFirst ? [num(m[2]), num(m[1])] : [num(m[1]), num(m[2])];
    const r = build(num(m[3]), month, day, h, num(m[5]), num(m[6]), m[7]);
    if (r) r.hasTime = m[4] !== undefined;
    return r;
  }
  m = c.english ? NAMED.exec(s) : null;
  if (m) {
    const month = monthByName(c, (m[2] ?? m[3])!);
    if (!month) return null;
    const r = build(num(m[5]), month, num(m[1] ?? m[4]), 0, 0, 0, undefined);
    if (r) r.hasTime = false;
    return r;
  }
  return null;
}

export function parseTimeText(text: string, c: Culture = EN_US): number | null {
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d{1,7}))?)?\s*(AM|PM)?$/i.exec(text.trim());
  if (!m) return null;
  let h = num(m[1]);
  const ampm = m[5]?.toUpperCase();
  if (ampm) {
    if (!hasAmPm(c) || h < 1 || h > 12) return null;
    h = (h % 12) + (ampm === "PM" ? 12 : 0);
  }
  const mi = num(m[2]);
  const s = num(m[3]);
  if (h > 23 || mi > 59 || s > 59) return null;
  return h * 3_600_000 + mi * 60_000 + s * 1000 + (m[4] ? Math.round(Number(`0.${m[4]}`) * 1000) : 0);
}

export type ExactKind = "Date" | "DateTime" | "Time";

const DATE_SPECIFIERS = "dMy";
const TIME_SPECIFIERS = "Hhmst";

function specifierUnsupported(spec: string, kind: ExactKind): MError {
  const time = kind === "Date" ? "" : ", H, HH, h, hh, m, mm, s, ss, tt";
  const date = kind === "Time" ? "" : "d, dd, M, MM, MMM, MMMM, yy, yyyy";
  return new MError(
    "Expression.Error",
    `${kind}.FromText: the format specifier "${spec}" is not supported in Lumen yet. Use ${date}${kind === "Time" ? time.slice(2) : time} and literal separators.`,
  );
}

/**
 * .NET ParseExact for a custom format: the whole input must match. Returns ms
 * (since 1970-01-01, or since midnight for Time), or null when the text doesn't fit.
 * Two-digit years use the 1950-2049 window that the Power Query docs show.
 */
export function parseExact(text: string, format: string, c: Culture, kind: ExactKind): number | null {
  if (format.length === 1) {
    if (format !== "d" || kind === "Time") {
      throw new MError("Expression.Error", `${kind}.FromText: the standard format "${format}" is not supported in Lumen yet. Use a custom format such as "dd/MM/yyyy".`);
    }
    format = c.shortDate;
  }
  let pos = 0;
  let y: number | undefined;
  let mo: number | undefined;
  let d: number | undefined;
  let h = 0;
  let mi = 0;
  let s = 0;
  let h12 = false;
  let pm: boolean | undefined;
  const digits = (min: number, max: number): number | null => {
    let j = pos;
    while (j < text.length && j - pos < max && text[j]! >= "0" && text[j]! <= "9") j++;
    if (j - pos < min) return null;
    const v = Number(text.slice(pos, j));
    pos = j;
    return v;
  };
  const literal = (lit: string): boolean => {
    if (!text.startsWith(lit, pos)) return false;
    pos += lit.length;
    return true;
  };
  const name = (names: string[], alt?: Record<string, number>): number | null => {
    const rest = text.slice(pos).toLowerCase();
    let best = -1;
    let len = 0;
    names.forEach((n, i) => {
      const l = n.toLowerCase();
      if (rest.startsWith(l) && l.length > len) [best, len] = [i + 1, l.length];
    });
    for (const [k, v] of Object.entries(alt ?? {})) if (rest.startsWith(k) && k.length > len) [best, len] = [v, k.length];
    if (best < 0) return null;
    pos += len;
    return best;
  };
  let i = 0;
  while (i < format.length) {
    const ch = format[i]!;
    if (ch === "'" || ch === '"') {
      const end = format.indexOf(ch, i + 1);
      if (!literal(format.slice(i + 1, end < 0 ? format.length : end))) return null;
      i = end < 0 ? format.length : end + 1;
      continue;
    }
    if (ch === "\\") {
      if (!literal(format[i + 1] ?? "")) return null;
      i += 2;
      continue;
    }
    if (ch === "%") {
      i++;
      continue;
    }
    let n = 1;
    while (format[i + n] === ch) n++;
    const spec = ch.repeat(n);
    const wrongKind = (kind === "Date" && TIME_SPECIFIERS.includes(ch)) || (kind === "Time" && DATE_SPECIFIERS.includes(ch));
    if (wrongKind || "fFgKz".includes(ch) || (ch === "t" && n !== 2) || (ch === "d" && n > 2) || (ch === "y" && (n === 3 || n > 4))) {
      throw specifierUnsupported(spec, kind);
    }
    let v: number | null;
    switch (ch) {
      case "d":
        v = digits(n, 2);
        if (v === null || (d !== undefined && d !== v)) return null;
        d = v;
        break;
      case "M":
        if (n === 3 && !c.monthsAbbr) throw cultureUnsupported(c, 'Parsing abbreviated month names ("MMM")');
        v = n <= 2 ? digits(n, 2) : n === 3 ? name(c.monthsAbbr!, c.monthsAbbrAlt) : name(c.months);
        if (v === null || (mo !== undefined && mo !== v)) return null;
        mo = v;
        break;
      case "y":
        v = n <= 2 ? digits(n, 2) : digits(4, 4);
        if (v === null) return null;
        if (n <= 2) v += v <= 49 ? 2000 : 1900;
        if (y !== undefined && y !== v) return null;
        y = v;
        break;
      case "H":
      case "h":
        v = digits(Math.min(n, 2), 2);
        if (v === null) return null;
        if (ch === "h") h12 = true;
        h = v;
        break;
      case "m":
        v = digits(Math.min(n, 2), 2);
        if (v === null) return null;
        mi = v;
        break;
      case "s":
        v = digits(Math.min(n, 2), 2);
        if (v === null) return null;
        s = v;
        break;
      case "t": {
        if (!c.amPm) throw cultureUnsupported(c, 'Parsing the AM/PM designator ("tt")');
        if (c.amPm[0] === "") break;
        const mark = name(c.amPm);
        if (mark === null) return null;
        pm = mark === 2;
        break;
      }
      case "/":
        for (let k = 0; k < n; k++) if (!literal(c.dateSep)) return null;
        break;
      default:
        if (!literal(spec)) return null;
    }
    i += n;
  }
  if (pos !== text.length) return null;
  if (h12 && h > 12) return null;
  if (pm !== undefined && h <= 12) h = (h % 12) + (pm ? 12 : 0);
  if (h > 23 || mi > 59 || s > 59) return null;
  const timeMs = h * 3_600_000 + mi * 60_000 + s * 1000;
  if (kind === "Time") return timeMs;
  if (y === undefined) {
    throw new MError(
      "Expression.Error",
      `${kind}.FromText: a format without a year (yyyy or yy) is not supported in Lumen yet, because Power Query fills the missing parts from today's date.`,
    );
  }
  mo ??= 1;
  d ??= 1;
  if (!validDate(y, mo, d)) return null;
  return daysFromCivil(y, mo, d) * MS_PER_DAY + timeMs;
}

/** `[-]d.hh:mm:ss[.fff]` or `hh:mm:ss`. */
export function parseDurationText(text: string): number | null {
  const m = /^(-)?(?:(\d+)\.)?(\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d{1,7}))?)?$/.exec(text.trim());
  if (!m) return null;
  const ms =
    num(m[2]) * MS_PER_DAY + num(m[3]) * 3_600_000 + num(m[4]) * 60_000 + num(m[5]) * 1000 + (m[6] ? Math.round(Number(`0.${m[6]}`) * 1000) : 0);
  return m[1] ? -ms : ms;
}

import { DaxError, unsupported } from "./errors.ts";
import { DaxDate, generalNumber, type Scalar } from "./values.ts";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const NAMED = new Set([
  "general number",
  "currency",
  "fixed",
  "standard",
  "percent",
  "scientific",
  "yes/no",
  "true/false",
  "on/off",
  "general date",
  "long date",
  "medium date",
  "short date",
  "long time",
  "medium time",
  "short time",
]);

type Piece = { t: "lit"; v: string } | { t: "code"; v: string };

/** Splits a format section into literal text and format codes, honoring \x escapes and "quoted" text. */
function tokenize(fmt: string): Piece[] {
  const out: Piece[] = [];
  let i = 0;
  while (i < fmt.length) {
    const ch = fmt[i]!;
    if (ch === "\\") {
      out.push({ t: "lit", v: fmt[i + 1] ?? "" });
      i += 2;
    } else if (ch === '"') {
      const end = fmt.indexOf('"', i + 1);
      if (end < 0) throw new DaxError("FORMAT", `The format string ${JSON.stringify(fmt)} has an unclosed quote.`);
      out.push({ t: "lit", v: fmt.slice(i + 1, end) });
      i = end + 1;
    } else {
      out.push({ t: "code", v: ch });
      i++;
    }
  }
  return out;
}

function splitSections(fmt: string): string[] {
  const sections: string[] = [];
  let cur = "";
  let inQuote = false;
  for (let i = 0; i < fmt.length; i++) {
    const ch = fmt[i]!;
    if (ch === "\\" && !inQuote) {
      cur += ch + (fmt[i + 1] ?? "");
      i++;
      continue;
    }
    if (ch === '"') inQuote = !inQuote;
    if (ch === ";" && !inQuote) {
      sections.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  sections.push(cur);
  return sections;
}

function roundHalfAway(n: number, decimals: number): number {
  const sign = n < 0 ? -1 : 1;
  const r = Math.round(Number(`${Math.abs(n)}e${decimals}`));
  return sign * Number(`${r}e-${decimals}`);
}

const NUMERIC_LITERALS = new Set(["$", "-", "+", "(", ")", " ", ":", "/", "€", "£"]);

function formatNumberSection(value: number, section: string, whole: string): string {
  const pieces = tokenize(section);
  let prefix = "";
  let suffix = "";
  let intPattern = "";
  let decPattern = "";
  let seenDigit = false;
  let seenDot = false;
  let afterDigits = false;
  let percent = 0;
  for (const p of pieces) {
    const isPlaceholder = p.t === "code" && (p.v === "0" || p.v === "#");
    const isStructural = p.t === "code" && (p.v === "," || p.v === ".");
    if (isPlaceholder || (isStructural && (seenDigit || p.v === "."))) {
      if (afterDigits) throw unsupported(`Literal text between digit placeholders, as in ${JSON.stringify(whole)},`);
      seenDigit = true;
      if (p.v === ".") {
        if (seenDot) throw unsupported(`More than one decimal point, as in ${JSON.stringify(whole)},`);
        seenDot = true;
      } else if (seenDot) {
        if (p.v === ",") throw unsupported(`A comma after the decimal point, as in ${JSON.stringify(whole)},`);
        decPattern += p.v;
      } else {
        intPattern += p.v;
      }
      continue;
    }
    let lit: string;
    if (p.t === "lit") lit = p.v;
    else if (p.v === "%") {
      percent++;
      lit = "%";
    } else if (NUMERIC_LITERALS.has(p.v)) lit = p.v;
    else if (/[eE]/.test(p.v)) throw unsupported(`Scientific format strings such as ${JSON.stringify(whole)}`);
    else throw unsupported(`The format code '${p.v}' in ${JSON.stringify(whole)}`);
    if (seenDigit) {
      afterDigits = true;
      suffix += lit;
    } else prefix += lit;
  }
  if (intPattern.endsWith(",")) throw unsupported(`Thousands scaling with a trailing comma in ${JSON.stringify(whole)}`);
  const grouping = intPattern.includes(",");
  const minInt = (intPattern.match(/0/g) ?? []).length;
  const maxDec = decPattern.length;
  const minDec = (decPattern.match(/0/g) ?? []).length;
  let n = Math.abs(value) * Math.pow(100, percent);
  n = roundHalfAway(n, maxDec);
  let [intStr, decStr = ""] = n.toFixed(maxDec).split(".") as [string, string?];
  while (decStr.length > minDec && decStr.endsWith("0")) decStr = decStr.slice(0, -1);
  if (intStr === "0" && minInt === 0) intStr = "";
  while (intStr.length < minInt) intStr = "0" + intStr;
  if (grouping) intStr = intStr.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const body = intStr + (decStr.length > 0 ? "." + decStr : seenDot && maxDec === 0 ? "." : "");
  return prefix + body + suffix;
}

export function formatNumber(value: number, fmt: string): string {
  if (!Number.isFinite(value)) return generalNumber(value);
  if (NAMED.has(fmt.trim().toLowerCase())) throw unsupported(`The named format "${fmt}"`);
  const sections = splitSections(fmt);
  if (sections.length > 4) throw new DaxError("FORMAT", `The format string ${JSON.stringify(fmt)} has more than four sections.`);
  if (value < 0 && sections.length >= 2) return formatNumberSection(value, sections[1]!, fmt);
  if (value === 0 && sections.length >= 3) return formatNumberSection(value, sections[2]!, fmt);
  const s = formatNumberSection(value, sections[0]!, fmt);
  if (value < 0 && roundHalfAway(Math.abs(value), 15) !== 0) return "-" + s;
  return s;
}

export function formatDate(d: DaxDate, fmt: string): string {
  if (NAMED.has(fmt.trim().toLowerCase())) throw unsupported(`The named format "${fmt}"`);
  const pieces = tokenize(fmt);
  let out = "";
  let lastWasHour = false;
  let i = 0;
  const run = (ch: string) => {
    let j = i;
    while (j < pieces.length && pieces[j]!.t === "code" && pieces[j]!.v.toLowerCase() === ch) j++;
    return j - i;
  };
  while (i < pieces.length) {
    const p = pieces[i]!;
    if (p.t === "lit") {
      out += p.v;
      i++;
      continue;
    }
    const rest = pieces
      .slice(i, i + 5)
      .map((x) => x.v)
      .join("");
    if (/^am\/pm/i.test(rest)) {
      out += rest.slice(0, 2) === "AM" ? "AM" : rest.slice(0, 2) === "am" ? "am" : "AM";
      i += 5;
      continue;
    }
    const ch = p.v.toLowerCase();
    const n = run(ch);
    switch (ch) {
      case "y":
        if (n === 2) out += String(d.year % 100).padStart(2, "0");
        else if (n === 4) out += String(d.year);
        else throw unsupported(`The date format code '${"y".repeat(n)}' in ${JSON.stringify(fmt)}`);
        lastWasHour = false;
        break;
      case "m":
        if (lastWasHour) {
          out += n >= 2 ? "00" : "0";
        } else if (n === 1) out += String(d.month);
        else if (n === 2) out += String(d.month).padStart(2, "0");
        else if (n === 3) out += MONTHS[d.month - 1]!.slice(0, 3);
        else out += MONTHS[d.month - 1]!;
        lastWasHour = false;
        break;
      case "d":
        if (n === 1) out += String(d.day);
        else if (n === 2) out += String(d.day).padStart(2, "0");
        else if (n === 3) out += DAYS[d.weekday]!.slice(0, 3);
        else out += DAYS[d.weekday]!;
        lastWasHour = false;
        break;
      case "q":
        out += String(Math.floor((d.month - 1) / 3) + 1);
        break;
      case "h":
        out += /am\/pm/i.test(fmt) ? "12" : n >= 2 ? "00" : "0";
        lastWasHour = true;
        break;
      case "n":
      case "s":
        out += n >= 2 ? "00" : "0";
        break;
      default:
        if (/[a-z0-9#%]/i.test(ch)) throw unsupported(`The date format code '${p.v}' in ${JSON.stringify(fmt)}`);
        out += p.v;
        i++;
        continue;
    }
    i += n;
  }
  return out;
}

export function formatValue(value: Scalar, fmt: string): string {
  if (value === null) return "";
  if (NAMED.has(fmt.trim().toLowerCase())) throw unsupported(`The named format "${fmt}"`);
  if (value instanceof DaxDate) return formatDate(value, fmt);
  if (typeof value === "boolean") return formatNumber(value ? 1 : 0, fmt);
  if (typeof value === "number") {
    if (/[ymd]/i.test(fmt.replace(/"[^"]*"|\\./g, ""))) throw unsupported(`FORMAT of a number with the date format ${JSON.stringify(fmt)}`);
    return formatNumber(value, fmt);
  }
  throw unsupported(`FORMAT of a text value`);
}

/** How a value shows in a grid cell when no format string applies. */
export function displayValue(value: Scalar, fmt: string | null): string {
  if (value === null) return "";
  if (fmt) return formatValue(value, fmt);
  if (value instanceof DaxDate) return value.toIso();
  if (typeof value === "boolean") return value ? "True" : "False";
  if (typeof value === "number") return generalNumber(value);
  return value;
}

import { DaxError, unsupported } from "./errors.ts";

const MS_PER_DAY = 86_400_000;
/** Days between the DAX/Excel serial epoch (1899-12-30) and 1970-01-01. */
const SERIAL_OFFSET = 25_569;

export class DaxDate {
  constructor(readonly days: number) {}

  static fromIso(s: string): DaxDate {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
    if (!m) throw new DaxError("TYPE", `Cannot convert value '${s}' of type Text to type Date.`);
    return DaxDate.fromParts(Number(m[1]), Number(m[2]), Number(m[3]));
  }

  /** Month and day overflow roll over, like DAX DATE ( ). */
  static fromParts(year: number, month: number, day: number): DaxDate {
    return new DaxDate(Math.round(Date.UTC(year, month - 1, day) / MS_PER_DAY));
  }

  static fromSerial(serial: number): DaxDate {
    return new DaxDate(serial - SERIAL_OFFSET);
  }

  get serial(): number {
    return this.days + SERIAL_OFFSET;
  }

  private get js(): Date {
    return new Date(this.days * MS_PER_DAY);
  }

  get year(): number {
    return this.js.getUTCFullYear();
  }

  get month(): number {
    return this.js.getUTCMonth() + 1;
  }

  get day(): number {
    return this.js.getUTCDate();
  }

  get weekday(): number {
    return this.js.getUTCDay();
  }

  toIso(): string {
    return this.js.toISOString().slice(0, 10);
  }

  toString(): string {
    return this.toIso();
  }
}

export type Scalar = null | number | string | boolean | DaxDate;

export function isBlank(v: Scalar): v is null {
  return v === null;
}

export function typeName(v: Scalar): string {
  if (v === null) return "Blank";
  if (v instanceof DaxDate) return "Date";
  if (typeof v === "number") return Number.isInteger(v) ? "Integer" : "Number";
  if (typeof v === "string") return "Text";
  return "True/False";
}

/** Identity key used for filters, DISTINCT and IN. Text is case-insensitive, like VertiPaq. */
export function keyOf(v: Scalar): string {
  if (v === null) return "∅";
  if (v instanceof DaxDate) return `n${v.serial}`;
  if (typeof v === "number") return `n${v}`;
  if (typeof v === "string") return `s${v.toLowerCase()}`;
  return v ? "b1" : "b0";
}

export function tupleKey(values: Scalar[]): string {
  return values.length === 1 ? keyOf(values[0]!) : values.map(keyOf).join("\u0001");
}

export function toNumber(v: Scalar, context = "arithmetic"): number {
  if (v === null) return 0;
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (v instanceof DaxDate) return v.serial;
  const n = Number(v.trim());
  if (v.trim() === "" || Number.isNaN(n)) {
    throw new DaxError("TYPE", `Cannot convert value '${v}' of type Text to type Number (in ${context}).`);
  }
  return n;
}

export function toBool(v: Scalar): boolean {
  if (v === null) return false;
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (v instanceof DaxDate) return v.serial !== 0;
  const u = v.toUpperCase();
  if (u === "TRUE") return true;
  if (u === "FALSE") return false;
  throw new DaxError("TYPE", `Cannot convert value '${v}' of type Text to type True/False.`);
}

export function generalNumber(n: number): string {
  if (Number.isNaN(n)) return "NaN";
  if (!Number.isFinite(n)) return n > 0 ? "Infinity" : "-Infinity";
  if (Number.isInteger(n)) return String(n);
  return String(Number(n.toPrecision(15)));
}

export function toText(v: Scalar): string {
  if (v === null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if (typeof v === "number") return generalNumber(v);
  throw unsupported("Implicit conversion of a date to text", 'Use FORMAT ( <date>, "yyyy-mm-dd" ) instead.');
}

type Kind = "blank" | "number" | "text" | "bool";

function kindOf(v: Scalar): Kind {
  if (v === null) return "blank";
  if (typeof v === "string") return "text";
  if (typeof v === "boolean") return "bool";
  return "number";
}

/** DAX `=`-style comparison: BLANK converts to the other operand's default (0, "", FALSE). */
export function compare(a: Scalar, b: Scalar): number {
  const ka = kindOf(a);
  const kb = kindOf(b);
  if (ka === "blank" && kb === "blank") return 0;
  const k = ka === "blank" ? kb : ka;
  if (ka !== "blank" && kb !== "blank" && ka !== kb) {
    throw new DaxError(
      "TYPE",
      `DAX comparison operations do not support comparing values of type ${typeName(a)} with values of type ${typeName(b)}. Consider using the VALUE or FORMAT function to convert one of the values.`,
    );
  }
  if (k === "text") {
    const x = ((a as string | null) ?? "").toLowerCase();
    const y = ((b as string | null) ?? "").toLowerCase();
    return x < y ? -1 : x > y ? 1 : 0;
  }
  if (k === "bool") {
    const x = a === null ? 0 : a ? 1 : 0;
    const y = b === null ? 0 : b ? 1 : 0;
    return x - y;
  }
  const x = toNumber(a);
  const y = toNumber(b);
  return x < y ? -1 : x > y ? 1 : 0;
}

/** Sort order for output grids: blanks first, then numbers/dates, text, booleans. */
export function sortCompare(a: Scalar, b: Scalar): number {
  const rank = (v: Scalar) => (v === null ? 0 : typeof v === "number" || v instanceof DaxDate ? 1 : typeof v === "string" ? 2 : 3);
  const ra = rank(a);
  const rb = rank(b);
  if (ra !== rb) return ra - rb;
  if (ra === 0) return 0;
  return compare(a, b);
}

export function arithmetic(op: string, a: Scalar, b: Scalar): Scalar {
  if (a === null && b === null) return null;
  if (op === "*" || op === "/") {
    if (op === "*" && (a === null || b === null)) return null;
    if (op === "/" && a === null) return null;
  }
  if (op === "^") {
    if (a === null) return null;
    return Math.pow(toNumber(a), toNumber(b));
  }
  const x = toNumber(a);
  const y = toNumber(b);
  switch (op) {
    case "+": {
      const r = x + y;
      if (a instanceof DaxDate && !(b instanceof DaxDate) && Number.isInteger(r)) return DaxDate.fromSerial(r);
      if (b instanceof DaxDate && !(a instanceof DaxDate) && Number.isInteger(r)) return DaxDate.fromSerial(r);
      return r;
    }
    case "-": {
      if (a instanceof DaxDate && b instanceof DaxDate) return x - y;
      const r = x - y;
      if (a instanceof DaxDate && Number.isInteger(r)) return DaxDate.fromSerial(r);
      return r;
    }
    case "*":
      return x * y;
    case "/":
      return x / y;
  }
  throw new DaxError("INTERNAL", `Unknown operator ${op}`);
}

export function toOutput(v: Scalar): null | number | string | boolean {
  return v instanceof DaxDate ? v.toIso() : v;
}

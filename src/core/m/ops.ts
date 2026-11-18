import type { BinaryOp } from "./ast.ts";
import { MError } from "./errors.ts";
import {
  MDate,
  MDateTime,
  MDateTimeZone,
  MDuration,
  MList,
  MRecord,
  MS_PER_DAY,
  MTime,
  cannotConvert,
  compareSameKind,
  kindOf,
  kindTitle,
  valuesEqual,
  type MValue,
} from "./values.ts";

function cannotApply(op: string, a: MValue, b: MValue): MError {
  return new MError("Expression.Error", `We cannot apply operator ${op} to types ${kindTitle(kindOf(a))} and ${kindTitle(kindOf(b))}.`, [a, b]);
}

function wrapTime(ms: number): number {
  return ((ms % MS_PER_DAY) + MS_PER_DAY) % MS_PER_DAY;
}

function add(a: MValue, b: MValue, sign: 1 | -1, op: string): MValue {
  const ka = kindOf(a);
  const kb = kindOf(b);
  if (ka === "number" && kb === "number") return sign === 1 ? (a as number) + (b as number) : (a as number) - (b as number);
  if (kb === "duration") {
    const d = (b as MDuration).ms * sign;
    switch (ka) {
      case "duration":
        return new MDuration((a as MDuration).ms + d);
      case "datetime":
        return new MDateTime((a as MDateTime).ms + d);
      case "date":
        return new MDate(Math.floor(((a as MDate).days * MS_PER_DAY + d) / MS_PER_DAY));
      case "datetimezone":
        return new MDateTimeZone((a as MDateTimeZone).ms + d, (a as MDateTimeZone).offsetMinutes);
      case "time":
        return new MTime(wrapTime((a as MTime).ms + d));
    }
  }
  if (sign === 1 && ka === "duration") return add(b, a, 1, op);
  if (sign === -1 && ka === kb) {
    switch (ka) {
      case "date":
        return new MDuration(((a as MDate).days - (b as MDate).days) * MS_PER_DAY);
      case "datetime":
      case "time":
        return new MDuration((a as MDateTime).ms - (b as MDateTime).ms);
      case "datetimezone":
        return new MDuration((a as MDateTimeZone).utcMs - (b as MDateTimeZone).utcMs);
    }
  }
  throw cannotApply(op, a, b);
}

function combine(a: MValue, b: MValue): MValue {
  const ka = kindOf(a);
  const kb = kindOf(b);
  if (ka === "text" && kb === "text") return (a as string) + (b as string);
  if (ka === "list" && kb === "list") return new MList([...(a as MList).cells, ...(b as MList).cells]);
  if (ka === "record" && kb === "record") {
    const x = a as MRecord;
    const y = b as MRecord;
    const names = [...x.names];
    const cells = [...x.cells];
    for (const n of y.names) {
      const i = names.indexOf(n);
      if (i >= 0) cells[i] = y.cell(n)!;
      else {
        names.push(n);
        cells.push(y.cell(n)!);
      }
    }
    return new MRecord(names, cells);
  }
  if (ka === "date" && kb === "time") return new MDateTime((a as MDate).days * MS_PER_DAY + (b as MTime).ms);
  throw cannotApply("&", a, b);
}

/** Every binary operator except the short-circuiting `and`, `or` and `??`. */
export function binaryOp(op: BinaryOp, a: MValue, b: MValue): MValue {
  switch (op) {
    case "=":
      return valuesEqual(a, b);
    case "<>":
      return !valuesEqual(a, b);
  }
  if (a === null || b === null) return null;
  switch (op) {
    case "<":
    case "<=":
    case ">":
    case ">=": {
      if (kindOf(a) !== kindOf(b)) throw cannotApply(op, a, b);
      const c = compareSameKind(a, b);
      if (c === null) throw cannotApply(op, a, b);
      if (typeof a === "number" && (Number.isNaN(a) || Number.isNaN(b as number))) return false;
      return op === "<" ? c < 0 : op === "<=" ? c <= 0 : op === ">" ? c > 0 : c >= 0;
    }
    case "+":
      return add(a, b, 1, "+");
    case "-":
      return add(a, b, -1, "-");
    case "*": {
      const ka = kindOf(a);
      const kb = kindOf(b);
      if (ka === "number" && kb === "number") return (a as number) * (b as number);
      if (ka === "duration" && kb === "number") return new MDuration(Math.round((a as MDuration).ms * (b as number)));
      if (ka === "number" && kb === "duration") return new MDuration(Math.round((b as MDuration).ms * (a as number)));
      throw cannotApply("*", a, b);
    }
    case "/": {
      const ka = kindOf(a);
      const kb = kindOf(b);
      if (ka === "number" && kb === "number") return (a as number) / (b as number);
      if (ka === "duration" && kb === "number") return new MDuration(Math.round((a as MDuration).ms / (b as number)));
      throw cannotApply("/", a, b);
    }
    case "&":
      return combine(a, b);
  }
  throw new MError("Expression.Error", `Operator ${op} is not supported in Lumen yet.`);
}

export function unaryOp(op: "+" | "-" | "not", v: MValue): MValue {
  if (v === null) return null;
  const k = kindOf(v);
  if (op === "not") {
    if (k !== "logical") throw cannotConvert(v, "Logical");
    return !v;
  }
  if (k === "number") return op === "-" ? -(v as number) : v;
  if (k === "duration") return op === "-" ? new MDuration(-(v as MDuration).ms) : v;
  throw new MError("Expression.Error", `We cannot apply operator ${op} to type ${kindTitle(k)}.`, v);
}

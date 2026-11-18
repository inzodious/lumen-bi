import { getCulture, type Culture } from "../culture.ts";
import { NeedData } from "../driver.ts";
import { MError } from "../errors.ts";
import type { MHost } from "../host.ts";
import {
  Lazy,
  MFunction,
  MList,
  MRecord,
  MTable,
  MType,
  cannotConvert,
  type Cell,
  type FunctionParam,
  type MValue,
} from "../values.ts";

export interface LibContext {
  call(f: MValue, args: MValue[]): MValue;
  /** Expression.Evaluate: evaluates M text in `env` (a record of names) or in the library scope. */
  evaluateSource?(source: string, env: MRecord | null): MValue;
  /** #shared: the library (and section members) as a record. */
  shared?(): MRecord;
  readonly host: MHost;
  readonly localOffsetMinutes: number;
}

export type Impl = (args: MValue[], ctx: LibContext) => MValue;

export class Library {
  readonly entries = new Map<string, Cell>();
  constructor(readonly ctx: LibContext) {}

  /** `sig` is a comma-separated parameter list; prefix optional ones with `?`. */
  def(name: string, sig: string, impl: Impl): void {
    const params: FunctionParam[] = sig
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => (s.startsWith("?") ? { name: s.slice(1), optional: true } : { name: s, optional: false }));
    const ctx = this.ctx;
    this.entries.set(
      name,
      new MFunction(name, params, (args) => {
        const padded = args.length < params.length ? [...args, ...Array<MValue>(params.length - args.length).fill(null)] : args;
        return impl(padded, ctx);
      }),
    );
  }

  constant(name: string, value: MValue): void {
    this.entries.set(name, value);
  }
}

export function text(v: MValue): string {
  if (typeof v !== "string") throw cannotConvert(v, "Text");
  return v;
}

export function textOrNull(v: MValue): string | null {
  return v === null ? null : text(v);
}

export function num(v: MValue): number {
  if (typeof v !== "number") throw cannotConvert(v, "Number");
  return v;
}

export function numOr(v: MValue, fallback: number): number {
  return v === null ? fallback : num(v);
}

export function bool(v: MValue): boolean {
  if (typeof v !== "boolean") throw cannotConvert(v, "Logical");
  return v;
}

export function list(v: MValue): MList {
  if (!(v instanceof MList)) throw cannotConvert(v, "List");
  return v;
}

export function record(v: MValue): MRecord {
  if (!(v instanceof MRecord)) throw cannotConvert(v, "Record");
  return v;
}

export function table(v: MValue): MTable {
  if (!(v instanceof MTable)) throw cannotConvert(v, "Table");
  return v;
}

export function fn(v: MValue): MFunction {
  if (!(v instanceof MFunction)) throw cannotConvert(v, "Function");
  return v;
}

export function type(v: MValue): MType {
  if (!(v instanceof MType)) throw cannotConvert(v, "Type");
  return v;
}

export function texts(v: MValue): string[] {
  if (typeof v === "string") return [v];
  return list(v).values().map(text);
}

/**
 * Runs `f` now; an M error becomes an error cell instead of failing the step, as Power Query does per cell.
 * A data miss (NeedData) also becomes an error cell, so a row-wise step records every row's missing data in
 * one evaluation pass (the driver discards passes that had misses, so these cells are never seen).
 */
export function cell(f: () => MValue): Cell {
  try {
    return f();
  } catch (e) {
    if (e instanceof MError || e instanceof NeedData) return Lazy.failed(e);
    throw e;
  }
}

/** `{"a", x}` or `{{"a", x}, {"b", y}}` → list of item lists. */
export function specList(v: MValue): MValue[][] {
  const l = list(v);
  if (l.length === 0) return [];
  if (typeof l.get(0) === "string") return [l.values()];
  return l.values().map((x) => list(x).values());
}

export function flag(options: MValue, name: string): MValue {
  if (options instanceof MRecord && options.has(name)) return options.get(name);
  return null;
}

export const MISSING_ERROR = 0;
export const MISSING_IGNORE = 1;
export const MISSING_USENULL = 2;

/** A `culture` argument: null is Culture.Current (en-US). */
export function cultureArg(v: MValue): Culture {
  return getCulture(textOrNull(v));
}

/**
 * The `options` of Date.FromText and friends: a record with Format and Culture,
 * or (legacy) a culture name, which means [Format = null, Culture = options].
 */
export function fromTextOptions(v: MValue): { format: string | null; culture: Culture } {
  if (v === null || typeof v === "string") return { format: null, culture: cultureArg(v) };
  const r = record(v);
  return { format: textOrNull(flag(r, "Format")), culture: cultureArg(flag(r, "Culture")) };
}

/** The `options, culture` of Date.ToText and friends: a record, or (legacy) a format text plus a culture text. */
export function toTextOptions(options: MValue, culture: MValue): { format: string | null; culture: Culture } {
  if (options === null || typeof options === "string") return { format: options, culture: cultureArg(culture) };
  const r = record(options);
  return { format: textOrNull(flag(r, "Format")), culture: cultureArg(r.has("Culture") ? r.get("Culture") : culture) };
}

/**
 * The rest of the Power Query standard library used by real models and by the Power Query Editor's
 * ribbon: splitters/combiners, more Table.* / List.* / Text.* / Date.* / Number.* / Record.* / Type.* /
 * Value.* functions, Expression.Evaluate and #shared.
 */
import { civilFromDays, dayOfWeek, daysFromCivil, formatCustom, isLeap } from "../calendar.ts";
import { toText } from "../convert.ts";
import { MError } from "../errors.ts";
import { binaryOp } from "../ops.ts";
import {
  Lazy,
  MDate,
  MDateTime,
  MDateTimeZone,
  MDuration,
  MFunction,
  MList,
  MRecord,
  MTable,
  MTime,
  MType,
  MS_PER_DAY,
  T,
  cannotConvert,
  force,
  hashKey,
  valueCompare,
  valuesEqual,
  type Cell,
  type MValue,
} from "../values.ts";
import { assertUnique, condition, defaultNames, missingMode, sortKeys } from "./table.ts";
import { MISSING_ERROR, cultureArg, fn, list, num, numOr, record, table, text, textOrNull, texts, type, type LibContext, type Library } from "./util.ts";

// ---------------------------------------------------------------------------------------------
// helpers

function equalityOf(ctx: LibContext, criteria: MValue): (a: MValue, b: MValue) => boolean {
  if (criteria === null) return valuesEqual;
  if (criteria instanceof MFunction) {
    if (criteria.name === "Comparer.OrdinalIgnoreCase") return (a, b) => (typeof a === "string" && typeof b === "string" ? a.toLowerCase() === b.toLowerCase() : valuesEqual(a, b));
    if (criteria.name === "Comparer.Ordinal") return valuesEqual;
    if (criteria.params.length === 1) return (a, b) => valuesEqual(ctx.call(criteria, [a]), ctx.call(criteria, [b]));
    return (a, b) => {
      const r = ctx.call(criteria, [a, b]);
      return r === 0 || r === true;
    };
  }
  return valuesEqual;
}

function keyOf(ctx: LibContext, criteria: MValue): (v: MValue) => string {
  if (criteria instanceof MFunction && criteria.name === "Comparer.OrdinalIgnoreCase") return (v) => hashKey(typeof v === "string" ? v.toLowerCase() : v);
  if (criteria instanceof MFunction && criteria.params.length === 1 && !criteria.name.startsWith("Comparer.")) return (v) => hashKey(ctx.call(criteria, [v]));
  return hashKey;
}

function numbers(l: MValue): number[] {
  return list(l)
    .values()
    .filter((v) => v !== null)
    .map((v) => num(v));
}

function nonNullValues(l: MValue): MValue[] {
  return list(l)
    .values()
    .filter((v) => v !== null);
}

function cellsOf(t: MTable, i: number): Cell[] {
  return t.rows.map((r) => r[i]!);
}

function dateParts(v: MValue): { days: number; timeMs: number } {
  if (v instanceof MDate) return { days: v.days, timeMs: 0 };
  if (v instanceof MDateTime || v instanceof MDateTimeZone) {
    const days = Math.floor(v.ms / MS_PER_DAY);
    return { days, timeMs: v.ms - days * MS_PER_DAY };
  }
  throw cannotConvert(v, "Date");
}

function rebuildDate(src: MValue, days: number, timeMs: number): MValue {
  if (src instanceof MDate) return new MDate(days);
  if (src instanceof MDateTime) return new MDateTime(days * MS_PER_DAY + timeMs);
  if (src instanceof MDateTimeZone) return new MDateTimeZone(days * MS_PER_DAY + timeMs, src.offsetMinutes);
  throw cannotConvert(src, "Date");
}

function addMonthsDays(days: number, n: number): number {
  const { y, m, d } = civilFromDays(days);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const dim = [31, isLeap(ny) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][nm - 1]!;
  return daysFromCivil(ny, nm, Math.min(d, dim));
}

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/** Ordinal-style comparison helper for List.Median etc. on non-numbers (dates/text). */
function medianValue(values: MValue[]): MValue {
  if (!values.length) return null;
  if (values.every((v) => typeof v === "number")) return median(values as number[]);
  const s = [...values].sort(valueCompare);
  return s[Math.floor((s.length - 1) / 2)]!;
}

// ---------------------------------------------------------------------------------------------
// Splitters / combiners (return functions, like Power Query)

function splitterFn(name: string, f: (s: string) => string[]): MFunction {
  return new MFunction(name, [{ name: "line", optional: false }], ([v]) => (v === null || v === undefined ? MList.of([null]) : MList.of(f(text(v)))));
}

function splitQuoted(s: string, delim: string, csv: boolean): string[] {
  if (!csv) return delim === "" ? [s] : s.split(delim);
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (c === '"') {
      if (q && s[i + 1] === '"') {
        cur += '"';
        i++;
      } else q = !q;
      continue;
    }
    if (!q && delim && s.startsWith(delim, i)) {
      out.push(cur);
      cur = "";
      i += delim.length - 1;
      continue;
    }
    cur += c;
  }
  out.push(cur);
  return out;
}

function installSplitters(lib: Library): void {
  lib.def("Splitter.SplitTextByDelimiter", "delimiter, ?quoteStyle, ?csvStyle", ([d, q]) => {
    const delim = text(d!);
    const csv = q === null ? true : num(q!) === 1;
    return splitterFn("Splitter", (s) => splitQuoted(s, delim, csv));
  });
  lib.def("Splitter.SplitTextByAnyDelimiter", "delimiters, ?quoteStyle, ?startAtEnd", ([d]) => {
    const delims = texts(d!).filter(Boolean).sort((a, b) => b.length - a.length);
    return splitterFn("Splitter", (s) => {
      const out: string[] = [];
      let cur = "";
      for (let i = 0; i < s.length; ) {
        const hit = delims.find((x) => s.startsWith(x, i));
        if (hit) {
          out.push(cur);
          cur = "";
          i += hit.length;
        } else cur += s[i++];
      }
      out.push(cur);
      return out;
    });
  });
  lib.def("Splitter.SplitTextByEachDelimiter", "delimiters, ?quoteStyle, ?startAtEnd", ([d, _q, end]) => {
    const delims = texts(d!);
    const fromEnd = end === true;
    return splitterFn("Splitter", (s) => {
      const out: string[] = [];
      if (!fromEnd) {
        let rest = s;
        for (const del of delims) {
          const i = rest.indexOf(del);
          if (i < 0) break;
          out.push(rest.slice(0, i));
          rest = rest.slice(i + del.length);
        }
        out.push(rest);
        return out;
      }
      let rest = s;
      const tail: string[] = [];
      for (const del of delims) {
        const i = rest.lastIndexOf(del);
        if (i < 0) break;
        tail.unshift(rest.slice(i + del.length));
        rest = rest.slice(0, i);
      }
      return [rest, ...tail];
    });
  });
  lib.def("Splitter.SplitTextByLengths", "lengths, ?startAtEnd", ([l]) => {
    const lens = list(l!).values().map(num);
    return splitterFn("Splitter", (s) => {
      const out: string[] = [];
      let at = 0;
      for (const n of lens) {
        out.push(s.slice(at, at + n));
        at += n;
      }
      return out;
    });
  });
  lib.def("Splitter.SplitTextByPositions", "positions, ?startAtEnd", ([p]) => {
    const pos = list(p!).values().map(num);
    return splitterFn("Splitter", (s) => pos.map((x, i) => s.slice(x, i + 1 < pos.length ? pos[i + 1] : undefined)));
  });
  lib.def("Splitter.SplitTextByRepeatedLengths", "length, ?startAtEnd", ([l, end]) => {
    const n = num(l!);
    if (n <= 0) throw new MError("Expression.Error", "The length must be greater than 0.");
    return splitterFn("Splitter", (s) => {
      const out: string[] = [];
      if (end === true) {
        for (let i = s.length; i > 0; i -= n) out.unshift(s.slice(Math.max(0, i - n), i));
        return out.length ? out : [""];
      }
      for (let i = 0; i < s.length; i += n) out.push(s.slice(i, i + n));
      return out.length ? out : [""];
    });
  });
  lib.def("Splitter.SplitTextByWhitespace", "?quoteStyle", () => splitterFn("Splitter", (s) => s.split(/\s+/).filter(Boolean)));
  lib.def("Splitter.SplitTextByCharacterTransition", "before, after", ([b, a], ctx) => {
    const test = (x: MValue, ch: string): boolean => (x instanceof MFunction ? ctx.call(x, [ch]) === true : list(x).values().includes(ch));
    return splitterFn("Splitter", (s) => {
      const out: string[] = [];
      let cur = "";
      for (let i = 0; i < s.length; i++) {
        if (i > 0 && test(b!, s[i - 1]!) && test(a!, s[i]!)) {
          out.push(cur);
          cur = "";
        }
        cur += s[i];
      }
      out.push(cur);
      return out;
    });
  });
  lib.def("Splitter.SplitByNothing", "", () => new MFunction("Splitter.SplitByNothing", [{ name: "value", optional: false }], ([v]) => MList.of([v ?? null])));

  const combiner = (f: (parts: string[]) => string) =>
    new MFunction("Combiner", [{ name: "texts", optional: false }], ([l]) => f(list(l!).values().map((v) => (v === null ? "" : (toText(v) ?? "")))));
  lib.def("Combiner.CombineTextByDelimiter", "delimiter, ?quoteStyle", ([d, q]) => {
    const delim = text(d!);
    const csv = q !== null && num(q!) === 1;
    return combiner((parts) => parts.map((p) => (csv && (p.includes(delim) || p.includes('"')) ? `"${p.replace(/"/g, '""')}"` : p)).join(delim));
  });
  lib.def("Combiner.CombineTextByEachDelimiter", "delimiters, ?quoteStyle", ([d]) => {
    const delims = texts(d!);
    return combiner((parts) => parts.map((p, i) => (i < parts.length - 1 ? p + (delims[i] ?? "") : p)).join(""));
  });
  lib.def("Combiner.CombineTextByLengths", "lengths, ?template", ([l]) => {
    const lens = list(l!).values().map(num);
    return combiner((parts) => parts.map((p, i) => p.slice(0, lens[i] ?? p.length).padEnd(lens[i] ?? 0)).join(""));
  });
  lib.def("Combiner.CombineTextByPositions", "positions, ?template", ([l]) => {
    const pos = list(l!).values().map(num);
    return combiner((parts) => {
      let out = "";
      parts.forEach((p, i) => {
        out = out.padEnd(pos[i] ?? out.length);
        out = out.slice(0, pos[i] ?? out.length) + p;
      });
      return out;
    });
  });
}

// ---------------------------------------------------------------------------------------------

function installTableExtra(lib: Library): void {
  lib.def("Table.FromList", "list, ?splitter, ?columns, ?default, ?extraValues", ([l, s, c, d, ev], ctx) => {
    const items = list(l!).values();
    const split = s === null ? null : fn(s!);
    const parts = items.map((v) => {
      if (split) return list(ctx.call(split, [v])).values();
      if (v === null) return [null];
      if (typeof v === "string") return splitQuoted(v, ",", true);
      if (v instanceof MList) return v.values();
      return [v];
    });
    let names: string[];
    let types: MType[];
    if (c === null) {
      const width = Math.max(1, ...parts.map((p) => p.length));
      names = defaultNames(width);
      types = names.map(() => T.any);
    } else if (typeof c === "number") {
      names = defaultNames(c);
      types = names.map(() => T.any);
    } else if (c instanceof MType && c.fields) {
      names = c.fields.map((f) => f.name);
      types = c.fields.map((f) => f.type);
    } else {
      names = list(c!).values().map(text);
      types = names.map(() => T.any);
    }
    const extra = ev === null ? 1 : num(ev!);
    const rows = parts.map((p): Cell[] => {
      if (p.length > names.length) {
        if (extra === 1) return names.map((_n, i) => (i === names.length - 1 ? Lazy.failed(new MError("Expression.Error", `There were more columns in the result than expected.`)) : p[i]!));
        if (extra === 0) return names.map((_n, i) => (i === names.length - 1 ? MList.of(p.slice(i)) : p[i]!));
      }
      return names.map((_n, i) => (i < p.length ? p[i]! : (d ?? null)));
    });
    return new MTable(names, types, rows);
  });

  lib.def("Table.FromColumns", "lists, ?columns", ([l, c]) => {
    const cols = list(l!).values().map((x) => list(x).cells);
    const height = Math.max(0, ...cols.map((x) => x.length));
    let names: string[];
    let types: MType[];
    if (c instanceof MType && c.fields) {
      names = c.fields.map((f) => f.name);
      types = c.fields.map((f) => f.type);
    } else {
      names = c === null ? defaultNames(cols.length) : list(c!).values().map(text);
      types = names.map(() => T.any);
    }
    const rows = Array.from({ length: height }, (_x, r) => names.map((_n, i) => cols[i]?.[r] ?? null));
    return new MTable(names, types, rows);
  });

  lib.def("Table.FromValue", "value, ?options", ([v]) => {
    if (v instanceof MTable) return v;
    if (v instanceof MRecord) return new MTable(["Name", "Value"], [T.text, T.any], v.names.map((n) => [n, v.cell(n)!]));
    if (v instanceof MList) return new MTable(["Value"], [T.any], v.cells.map((c) => [c]));
    return new MTable(["Value"], [T.any], [[v ?? null]]);
  });

  lib.def("Table.ToColumns", "table", ([t]) => {
    const tt = table(t!);
    return MList.of(tt.columns.map((_c, i) => new MList(cellsOf(tt, i))));
  });
  lib.def("Table.ToList", "table, ?combiner", ([t, c], ctx) => {
    const tt = table(t!);
    const comb = c === null ? new MFunction("Combiner", [{ name: "l", optional: false }], ([l]) => list(l!).values().map((v) => (v === null ? "" : toText(v))).join(",")) : fn(c!);
    return MList.of(tt.rows.map((r) => ctx.call(comb, [new MList(r)])));
  });

  lib.def("Table.Transpose", "table, ?columns", ([t, c]) => {
    const tt = table(t!);
    const width = tt.rows.length;
    const names = c === null ? defaultNames(width) : c instanceof MType && c.fields ? c.fields.map((f) => f.name) : list(c!).values().map(text);
    const rows = tt.columns.map((_c, ci) => names.map((_n, ri) => tt.rows[ri]?.[ci] ?? null));
    return new MTable(names, names.map(() => T.any), rows);
  });

  lib.def("Table.ReverseRows", "table", ([t]) => {
    const tt = table(t!);
    return new MTable(tt.columns, tt.types, [...tt.rows].reverse());
  });
  lib.def("Table.Range", "table, offset, ?count", ([t, o, c]) => {
    const tt = table(t!);
    const start = num(o!);
    return new MTable(tt.columns, tt.types, tt.rows.slice(start, c === null ? undefined : start + num(c!)));
  });
  const countOrCond = (tt: MTable, c: MValue, ctx: LibContext, fromEnd: boolean): number => {
    if (c === null) return 1;
    if (typeof c === "number") return c;
    const f = fn(c);
    let n = 0;
    const rows = fromEnd ? [...tt.rows.keys()].reverse() : [...tt.rows.keys()];
    for (const i of rows) {
      if (!condition(ctx, f, tt.row(i))) break;
      n++;
    }
    return n;
  };
  lib.def("Table.RemoveFirstN", "table, ?countOrCondition", ([t, c], ctx) => {
    const tt = table(t!);
    return new MTable(tt.columns, tt.types, tt.rows.slice(countOrCond(tt, c!, ctx, false)));
  });
  lib.def("Table.RemoveLastN", "table, ?countOrCondition", ([t, c], ctx) => {
    const tt = table(t!);
    const n = countOrCond(tt, c!, ctx, true);
    return new MTable(tt.columns, tt.types, tt.rows.slice(0, Math.max(0, tt.rows.length - n)));
  });
  lib.def("Table.AlternateRows", "table, offset, skip, take", ([t, o, s, k]) => {
    const tt = table(t!);
    const offset = num(o!);
    const skip = num(s!);
    const take = num(k!);
    const rows = tt.rows.slice(0, offset);
    for (let i = offset; i < tt.rows.length; i += skip + take) rows.push(...tt.rows.slice(i + skip, i + skip + take));
    return new MTable(tt.columns, tt.types, rows);
  });
  lib.def("Table.Repeat", "table, count", ([t, c]) => {
    const tt = table(t!);
    const rows: Cell[][] = [];
    for (let i = 0; i < num(c!); i++) rows.push(...tt.rows);
    return new MTable(tt.columns, tt.types, rows);
  });
  lib.def("Table.InsertRows", "table, offset, rows", ([t, o, r]) => {
    const tt = table(t!);
    const recs = list(r!).values().map(record);
    const rows = [...tt.rows];
    rows.splice(num(o!), 0, ...recs.map((rec) => tt.columns.map((c) => (rec.has(c) ? rec.cell(c)! : null))));
    return new MTable(tt.columns, tt.types, rows);
  });
  lib.def("Table.ReplaceRows", "table, offset, count, rows", ([t, o, c, r]) => {
    const tt = table(t!);
    const recs = list(r!).values().map(record);
    const rows = [...tt.rows];
    rows.splice(num(o!), num(c!), ...recs.map((rec) => tt.columns.map((col) => (rec.has(col) ? rec.cell(col)! : null))));
    return new MTable(tt.columns, tt.types, rows);
  });
  lib.def("Table.RemoveMatchingRows", "table, rows, ?equationCriteria", ([t, r, e]) => {
    const tt = table(t!);
    const recs = list(r!).values().map(record);
    const cols = e === null ? null : texts(e!);
    const keep = tt.rows.filter((_row, i) => {
      const rec = tt.row(i);
      return !recs.some((m) => (cols ?? m.names).every((n) => rec.has(n) && m.has(n) && valuesEqual(rec.get(n), m.get(n))));
    });
    return new MTable(tt.columns, tt.types, keep);
  });
  lib.def("Table.Contains", "table, row, ?equationCriteria", ([t, r, e]) => {
    const tt = table(t!);
    const m = record(r!);
    const cols = e === null ? m.names : texts(e!);
    return tt.records().some((rec) => cols.every((n) => rec.has(n) && valuesEqual(rec.get(n), m.get(n))));
  });
  lib.def("Table.PositionOf", "table, row, ?occurrence, ?equationCriteria", ([t, r, o, e]) => {
    const tt = table(t!);
    const m = record(r!);
    const cols = e === null ? m.names : texts(e!);
    const hits = tt.records().flatMap((rec, i) => (cols.every((n) => rec.has(n) && valuesEqual(rec.get(n), m.get(n))) ? [i] : []));
    const occ = o === null ? 0 : num(o!);
    if (occ === 2) return MList.of(hits);
    if (!hits.length) return -1;
    return occ === 1 ? hits[hits.length - 1]! : hits[0]!;
  });
  lib.def("Table.MatchesAllRows", "table, condition", ([t, c], ctx) => {
    const tt = table(t!);
    const f = fn(c!);
    return tt.records().every((r) => condition(ctx, f, r));
  });
  lib.def("Table.MatchesAnyRows", "table, condition", ([t, c], ctx) => {
    const tt = table(t!);
    const f = fn(c!);
    return tt.records().some((r) => condition(ctx, f, r));
  });
  lib.def("Table.FindText", "table, text", ([t, s]) => {
    const tt = table(t!);
    const needle = text(s!);
    return new MTable(tt.columns, tt.types, tt.rows.filter((r) => r.some((c) => {
      const v = force(c);
      return v !== null && typeof v !== "object" ? String(toText(v) ?? "").includes(needle) : false;
    })));
  });
  lib.def("Table.ColumnsOfType", "table, listOfTypes", ([t, l]) => {
    const tt = table(t!);
    const want = list(l!).values().map(type);
    return MList.of(tt.columns.filter((_c, i) => want.some((w) => w.kind === tt.types[i]!.kind && (w.facet ?? null) === (tt.types[i]!.facet ?? null))));
  });
  lib.def("Table.PrefixColumns", "table, prefix", ([t, p]) => {
    const tt = table(t!);
    const pre = text(p!);
    return new MTable(tt.columns.map((c) => `${pre}.${c}`), tt.types, tt.rows);
  });
  lib.def("Table.StopFolding", "table", ([t]) => {
    const tt = table(t!);
    return new MTable(tt.columns, tt.types, tt.rows);
  });
  lib.def("Table.AddKey", "table, columns, isPrimary", ([t]) => table(t!));
  lib.def("Table.ReplaceKeys", "table, keys", ([t]) => table(t!));
  lib.def("Table.Keys", "table", () => MList.of([]));
  lib.def("Table.ApproximateRowCount", "table", ([t]) => table(t!).rows.length);
  lib.def("Table.ConformToPageReader", "table, shapingFunction", ([t]) => table(t!));

  lib.def("Table.TransformRows", "table, transform", ([t, f], ctx) => {
    const tt = table(t!);
    const g = fn(f!);
    return MList.of(tt.records().map((r) => ctx.call(g, [r])));
  });

  lib.def("Table.SplitColumn", "table, sourceColumn, splitter, ?columnNamesOrNumber, ?default, ?extraColumns", ([t, col, s, names, d], ctx) => {
    const tt = table(t!);
    const name = text(col!);
    const at = tt.columnIndex(name);
    const split = fn(s!);
    const pieces = tt.rows.map((r) => {
      const v = force(r[at]!);
      return list(ctx.call(split, [v])).values();
    });
    let newNames: string[];
    let newTypes: MType[] | null = null;
    if (names === null) {
      const width = Math.max(1, ...pieces.map((p) => p.length));
      newNames = Array.from({ length: width }, (_x, i) => `${name}.${i + 1}`);
    } else if (typeof names === "number") newNames = Array.from({ length: names }, (_x, i) => `${name}.${i + 1}`);
    else if (names instanceof MType && names.fields) {
      newNames = names.fields.map((f) => f.name);
      newTypes = names.fields.map((f) => f.type);
    } else newNames = list(names!).values().map(text);
    const columns = [...tt.columns.slice(0, at), ...newNames, ...tt.columns.slice(at + 1)];
    assertUnique(columns);
    const types = [...tt.types.slice(0, at), ...(newTypes ?? newNames.map(() => T.any)), ...tt.types.slice(at + 1)];
    const rows = tt.rows.map((r, ri) => [...r.slice(0, at), ...newNames.map((_n, i) => (i < pieces[ri]!.length ? pieces[ri]![i]! : (d ?? null))), ...r.slice(at + 1)]);
    return new MTable(columns, types, rows);
  });

  lib.def("Table.CombineColumns", "table, sourceColumns, combiner, column", ([t, cols, c, n], ctx) => {
    const tt = table(t!);
    const src = texts(cols!);
    const idx = src.map((x) => tt.columnIndex(x));
    const comb = fn(c!);
    const name = text(n!);
    const at = Math.min(...idx);
    const keep = tt.columns.map((_c, i) => i).filter((i) => !idx.includes(i));
    const before = keep.filter((i) => i < at);
    const after = keep.filter((i) => i > at);
    const columns = [...before.map((i) => tt.columns[i]!), name, ...after.map((i) => tt.columns[i]!)];
    assertUnique(columns);
    const types = [...before.map((i) => tt.types[i]!), T.any, ...after.map((i) => tt.types[i]!)];
    const rows = tt.rows.map((r) => [...before.map((i) => r[i]!), new Lazy(() => ctx.call(comb, [new MList(idx.map((i) => r[i]!))])), ...after.map((i) => r[i]!)]);
    return new MTable(columns, types, rows);
  });

  lib.def("Table.Join", "table1, key1, table2, key2, ?joinKind, ?joinAlgorithm, ?keyEqualityComparers", ([a, k1, b, k2, jk]) => {
    const ta = table(a!);
    const tb = table(b!);
    const n1 = texts(k1!);
    const n2 = texts(k2!);
    const ka = n1.map((k) => ta.columnIndex(k));
    const kb = n2.map((k) => tb.columnIndex(k));
    const kind = jk === null ? 0 : num(jk!);
    // a key column with the same name on both sides appears once (its value comes from whichever side matched)
    const shared = new Map<number, number>();
    n1.forEach((n, i) => {
      if (n === n2[i]) shared.set(kb[i]!, ka[i]!);
    });
    const clash = tb.columns.find((c, i) => ta.index.has(c) && !shared.has(i));
    if (clash) throw new MError("Expression.Error", `A join operation cannot result in a table with duplicate column names ("${clash}").`, clash);
    const bCols = tb.columns.map((_c, i) => i).filter((i) => !shared.has(i));
    const keyA = (r: Cell[]) => ka.map((i) => hashKey(force(r[i]!))).join("\u0001");
    const keyB = (r: Cell[]) => kb.map((i) => hashKey(force(r[i]!))).join("\u0001");
    const nullKey = (r: Cell[], ks: number[]) => ks.some((i) => force(r[i]!) === null);
    const index = new Map<string, number[]>();
    tb.rows.forEach((r, i) => {
      if (nullKey(r, kb)) return;
      const k = keyB(r);
      index.set(k, [...(index.get(k) ?? []), i]);
    });
    const nullsB = bCols.map(() => null);
    const rightOnly = (r: Cell[]): Cell[] => {
      const left: Cell[] = ta.columns.map(() => null);
      for (const [bi, ai] of shared) left[ai] = r[bi]!;
      return [...left, ...bCols.map((i) => r[i]!)];
    };
    const rows: Cell[][] = [];
    const usedB = new Set<number>();
    for (const r of ta.rows) {
      const hits = nullKey(r, ka) ? [] : (index.get(keyA(r)) ?? []);
      if (kind === 4) {
        if (!hits.length) rows.push([...r, ...nullsB]);
        continue;
      }
      if (kind === 5) {
        hits.forEach((h) => usedB.add(h));
        continue;
      }
      if (hits.length) for (const h of hits) (usedB.add(h), rows.push([...r, ...bCols.map((i) => tb.rows[h]![i]!)]));
      else if (kind === 1 || kind === 3) rows.push([...r, ...nullsB]);
    }
    if (kind === 2 || kind === 3 || kind === 5) tb.rows.forEach((r, i) => !usedB.has(i) && rows.push(rightOnly(r)));
    return new MTable([...ta.columns, ...bCols.map((i) => tb.columns[i]!)], [...ta.types, ...bCols.map((i) => tb.types[i]!)], rows);
  });

  lib.def("Table.ExpandListColumn", "table, column", ([t, c]) => {
    const tt = table(t!);
    const i = tt.columnIndex(text(c!));
    const rows: Cell[][] = [];
    for (const r of tt.rows) {
      const v = force(r[i]!);
      if (v instanceof MList && v.length) for (const item of v.cells) rows.push(r.map((x, k) => (k === i ? item : x)));
      else rows.push(r.map((x, k) => (k === i ? (v instanceof MList ? null : x) : x)));
    }
    return new MTable(tt.columns, tt.columns.map((_c, k) => (k === i ? T.any : tt.types[k]!)), rows);
  });

  lib.def("Table.AggregateTableColumn", "table, column, aggregations", ([t, c, a], ctx) => {
    const tt = table(t!);
    const i = tt.columnIndex(text(c!));
    const aggs = list(a!).values().map((x) => list(x).values());
    const names = aggs.map((x) => text(x[2]!));
    const columns = [...tt.columns.slice(0, i), ...names, ...tt.columns.slice(i + 1)];
    const types = [...tt.types.slice(0, i), ...names.map(() => T.any), ...tt.types.slice(i + 1)];
    const rows = tt.rows.map((r) => {
      const nested = force(r[i]!);
      const vals = aggs.map((x) => new Lazy(() => (nested instanceof MTable ? ctx.call(fn(x[1]!), [nested.column(text(x[0]!))]) : null)));
      return [...r.slice(0, i), ...vals, ...r.slice(i + 1)];
    });
    return new MTable(columns, types, rows);
  });

  lib.def("Table.AddRankColumn", "table, newColumnName, comparisonCriteria, ?options", ([t, n, c, o], ctx) => {
    const tt = table(t!);
    const keys = sortKeys(tt, c!, ctx);
    const kind = o instanceof MRecord && o.has("RankKind") ? num(o.get("RankKind")) : 1;
    const order = tt.rows.map((_r, i) => i);
    const cmp = (a: number, b: number) => {
      for (const k of keys) {
        const c2 = valueCompare(k.key(tt.rows[a]!, a), k.key(tt.rows[b]!, b));
        if (c2) return k.desc ? -c2 : c2;
      }
      return 0;
    };
    order.sort((a, b) => cmp(a, b) || a - b);
    const rank = new Array<number>(order.length);
    let dense = 0;
    order.forEach((idx, pos) => {
      const tie = pos > 0 && cmp(order[pos - 1]!, idx) === 0;
      if (!tie) dense++;
      rank[idx] = kind === 0 ? pos + 1 : kind === 2 ? dense : tie ? rank[order[pos - 1]!]! : pos + 1;
    });
    const sortedRows = order.map((i) => [...tt.rows[i]!, rank[i]!]);
    return new MTable([...tt.columns, text(n!)], [...tt.types, T.int64], sortedRows);
  });
  lib.constant("RankKind.Competition", 1);
  lib.constant("RankKind.Dense", 2);
  lib.constant("RankKind.Ordinal", 0);

  lib.def("Table.MaxN", "table, comparisonCriteria, countOrCondition", ([t, c, n], ctx) => {
    const tt = table(t!);
    const keys = sortKeys(tt, c!, ctx);
    const order = tt.rows.map((_r, i) => i).sort((a, b) => {
      for (const k of keys) {
        const x = valueCompare(k.key(tt.rows[b]!, b), k.key(tt.rows[a]!, a));
        if (x) return x;
      }
      return a - b;
    });
    return new MTable(tt.columns, tt.types, order.slice(0, num(n!)).map((i) => tt.rows[i]!));
  });
  lib.def("Table.MinN", "table, comparisonCriteria, countOrCondition", ([t, c, n], ctx) => {
    const tt = table(t!);
    const keys = sortKeys(tt, c!, ctx);
    const order = tt.rows.map((_r, i) => i).sort((a, b) => {
      for (const k of keys) {
        const x = valueCompare(k.key(tt.rows[a]!, a), k.key(tt.rows[b]!, b));
        if (x) return x;
      }
      return a - b;
    });
    return new MTable(tt.columns, tt.types, order.slice(0, num(n!)).map((i) => tt.rows[i]!));
  });

  lib.def("Table.Partition", "table, column, groups, hash", ([t, c, g, h], ctx) => {
    const tt = table(t!);
    const i = tt.columnIndex(text(c!));
    const n = num(g!);
    const hf = fn(h!);
    const parts: Cell[][][] = Array.from({ length: n }, () => []);
    for (const r of tt.rows) parts[((num(ctx.call(hf, [force(r[i]!)])) % n) + n) % n]!.push(r);
    return MList.of(parts.map((rows) => new MTable(tt.columns, tt.types, rows)));
  });

  lib.def("Table.Schema", "table", ([t]) => {
    const tt = table(t!);
    const rows = tt.columns.map((c, i): Cell[] => {
      const ty = tt.types[i]!;
      const kind = ty.kind === "number" && ty.facet ? ty.facet : ty.kind;
      return [c, i, kind === "any" ? "Any" : kind.charAt(0).toUpperCase() + kind.slice(1), ty.nullable, ty.facet ? `${ty.facet}.Type` : null, `${ty.kind}`];
    });
    return new MTable(["Name", "Position", "TypeName", "IsNullable", "Kind", "Description"], [T.text, T.int64, T.text, T.logical, T.text, T.text], rows);
  });

  lib.def("Table.Profile", "table, ?additionalAggregates", ([t]) => {
    const tt = table(t!);
    const rows = tt.columns.map((c, i): Cell[] => {
      const vals = tt.rows.map((r) => force(r[i]!));
      const nn = vals.filter((v) => v !== null);
      const ordered = nn.filter((v) => typeof v !== "object" || v instanceof MDate || v instanceof MDateTime || v instanceof MDateTimeZone || v instanceof MTime || v instanceof MDuration);
      const sorted = [...ordered].sort(valueCompare);
      const ns = nn.filter((v): v is number => typeof v === "number");
      const avg = ns.length === nn.length && ns.length ? ns.reduce((a, b) => a + b, 0) / ns.length : null;
      const sd = avg !== null && ns.length > 1 ? Math.sqrt(ns.reduce((a, b) => a + (b - avg) ** 2, 0) / (ns.length - 1)) : null;
      return [c, sorted[0] ?? null, sorted[sorted.length - 1] ?? null, avg, sd, vals.length, vals.length - nn.length, new Set(nn.map(hashKey)).size];
    });
    return new MTable(["Column", "Min", "Max", "Average", "StandardDeviation", "Count", "NullCount", "DistinctCount"], [T.text, T.any, T.any, T.number, T.number, T.int64, T.int64, T.int64], rows);
  });

  lib.def("Table.View", "table, handlers", ([t]) => table(t!));
}

// ---------------------------------------------------------------------------------------------

function installListExtra(lib: Library): void {
  lib.def("List.FirstN", "list, countOrCondition", ([l, c], ctx) => {
    const v = list(l!).cells;
    if (typeof c === "number") return new MList(v.slice(0, c));
    const f = fn(c!);
    let n = 0;
    while (n < v.length && ctx.call(f, [force(v[n]!)]) === true) n++;
    return new MList(v.slice(0, n));
  });
  lib.def("List.LastN", "list, ?countOrCondition", ([l, c], ctx) => {
    const v = list(l!).cells;
    if (c === null) return v.length ? force(v[v.length - 1]!) : null;
    if (typeof c === "number") return new MList(v.slice(Math.max(0, v.length - c)));
    const f = fn(c!);
    let n = 0;
    while (n < v.length && ctx.call(f, [force(v[v.length - 1 - n]!)]) === true) n++;
    return new MList(v.slice(v.length - n));
  });
  const skipN = (cells: Cell[], c: MValue, ctx: LibContext): number => {
    if (c === null) return 1;
    if (typeof c === "number") return c;
    const f = fn(c);
    let n = 0;
    while (n < cells.length && ctx.call(f, [force(cells[n]!)]) === true) n++;
    return n;
  };
  lib.def("List.Skip", "list, ?countOrCondition", ([l, c], ctx) => {
    const v = list(l!).cells;
    return new MList(v.slice(skipN(v, c!, ctx)));
  });
  lib.def("List.RemoveFirstN", "list, ?countOrCondition", ([l, c], ctx) => {
    const v = list(l!).cells;
    return new MList(v.slice(skipN(v, c!, ctx)));
  });
  lib.def("List.RemoveLastN", "list, ?countOrCondition", ([l, c], ctx) => {
    const v = list(l!).cells;
    const rev = [...v].reverse();
    const n = skipN(rev, c!, ctx);
    return new MList(v.slice(0, Math.max(0, v.length - n)));
  });
  lib.def("List.Range", "list, offset, ?count", ([l, o, c]) => {
    const v = list(l!).cells;
    const s = num(o!);
    return new MList(v.slice(s, c === null ? undefined : s + num(c!)));
  });
  lib.def("List.RemoveRange", "list, index, ?count", ([l, o, c]) => {
    const v = [...list(l!).cells];
    v.splice(num(o!), c === null ? 1 : num(c!));
    return new MList(v);
  });
  lib.def("List.InsertRange", "list, index, values", ([l, o, x]) => {
    const v = [...list(l!).cells];
    v.splice(num(o!), 0, ...list(x!).cells);
    return new MList(v);
  });
  lib.def("List.ReplaceRange", "list, index, count, replaceWith", ([l, o, c, x]) => {
    const v = [...list(l!).cells];
    v.splice(num(o!), num(c!), ...list(x!).cells);
    return new MList(v);
  });
  lib.def("List.Repeat", "list, count", ([l, c]) => {
    const v = list(l!).cells;
    const out: Cell[] = [];
    for (let i = 0; i < num(c!); i++) out.push(...v);
    return new MList(out);
  });
  lib.def("List.Buffer", "list", ([l]) => MList.of(list(l!).values()));
  lib.def("List.Single", "list", ([l]) => {
    const v = list(l!);
    if (v.length !== 1) throw new MError("Expression.Error", "There were too many elements in the enumeration to complete the operation.");
    return v.get(0);
  });
  lib.def("List.SingleOrDefault", "list, ?default", ([l, d]) => {
    const v = list(l!);
    if (v.length > 1) throw new MError("Expression.Error", "There were too many elements in the enumeration to complete the operation.");
    return v.length ? v.get(0) : (d ?? null);
  });
  lib.def("List.Zip", "lists", ([l]) => {
    const ls = list(l!).values().map((x) => list(x).cells);
    const n = Math.max(0, ...ls.map((x) => x.length));
    return MList.of(Array.from({ length: n }, (_x, i) => new MList(ls.map((x) => x[i] ?? null))));
  });
  lib.def("List.Split", "list, pageSize", ([l, p]) => {
    const v = list(l!).cells;
    const n = num(p!);
    const out: MValue[] = [];
    for (let i = 0; i < v.length; i += n) out.push(new MList(v.slice(i, i + n)));
    return MList.of(out);
  });
  lib.def("List.Alternate", "list, count, ?repeatInterval, ?offset", ([l, c, r, o]) => {
    const v = list(l!).cells;
    const count = num(c!);
    const repeat = r === null ? 0 : num(r!);
    const offset = o === null ? 0 : num(o!);
    const out: Cell[] = v.slice(0, offset);
    if (repeat === 0) return new MList([...out, ...v.slice(offset + count)]);
    for (let i = offset; i < v.length; i += count + repeat) out.push(...v.slice(i + count, i + count + repeat));
    return new MList(out);
  });
  const setOp = (name: string, op: "union" | "intersect" | "difference") =>
    lib.def(name, op === "difference" ? "list1, list2, ?equationCriteria" : "lists, ?equationCriteria", (args, ctx) => {
      if (op === "difference") {
        const key = keyOf(ctx, args[2]!);
        const counts = new Map<string, number>();
        for (const v of list(args[1]!).values()) counts.set(key(v), (counts.get(key(v)) ?? 0) + 1);
        return MList.of(
          list(args[0]!)
            .values()
            .filter((v) => {
              const k = key(v);
              const n = counts.get(k) ?? 0;
              if (n > 0) {
                counts.set(k, n - 1);
                return false;
              }
              return true;
            }),
        );
      }
      const key = keyOf(ctx, args[1]!);
      const lists = list(args[0]!).values().map((x) => list(x).values());
      if (!lists.length) return MList.of([]);
      if (op === "union") {
        const best = new Map<string, { v: MValue; n: number }>();
        const order: string[] = [];
        for (const l of lists) {
          const local = new Map<string, number>();
          for (const v of l) {
            const k = key(v);
            local.set(k, (local.get(k) ?? 0) + 1);
            if (!best.has(k)) (best.set(k, { v, n: 0 }), order.push(k));
          }
          for (const [k, n] of local) best.get(k)!.n = Math.max(best.get(k)!.n, n);
        }
        return MList.of(order.flatMap((k) => Array<MValue>(best.get(k)!.n).fill(best.get(k)!.v)));
      }
      let acc = lists[0]!;
      for (const l of lists.slice(1)) {
        const counts = new Map<string, number>();
        for (const v of l) counts.set(key(v), (counts.get(key(v)) ?? 0) + 1);
        acc = acc.filter((v) => {
          const n = counts.get(key(v)) ?? 0;
          if (n > 0) {
            counts.set(key(v), n - 1);
            return true;
          }
          return false;
        });
      }
      return MList.of(acc);
    });
  setOp("List.Union", "union");
  setOp("List.Intersect", "intersect");
  setOp("List.Difference", "difference");
  lib.def("List.RemoveItems", "list1, list2", ([a, b]) => {
    const drop = list(b!).values();
    return MList.of(list(a!).values().filter((v) => !drop.some((d) => valuesEqual(d, v))));
  });
  lib.def("List.RemoveMatchingItems", "list1, list2, ?equationCriteria", ([a, b, e], ctx) => {
    const eq = equalityOf(ctx, e!);
    const drop = list(b!).values();
    return MList.of(list(a!).values().filter((v) => !drop.some((d) => eq(d, v))));
  });
  lib.def("List.ReplaceValue", "list, oldValue, newValue, replacer", ([l, o, n, r], ctx) => {
    const f = fn(r!);
    return MList.of(list(l!).values().map((v) => ctx.call(f, [v, o!, n!])));
  });
  lib.def("List.ReplaceMatchingItems", "list, replacements, ?equationCriteria", ([l, r, e], ctx) => {
    const eq = equalityOf(ctx, e!);
    const pairs = list(r!).values().map((p) => list(p).values());
    return MList.of(list(l!).values().map((v) => pairs.find((p) => eq(p[0]!, v))?.[1] ?? v));
  });
  lib.def("List.Positions", "list", ([l]) => MList.of(list(l!).cells.map((_c, i) => i)));
  lib.def("List.PositionOfAny", "list, values, ?occurrence, ?equationCriteria", ([l, v, o, e], ctx) => {
    const eq = equalityOf(ctx, e!);
    const vals = list(v!).values();
    const hits = list(l!).values().flatMap((x, i) => (vals.some((y) => eq(x, y)) ? [i] : []));
    const occ = o === null ? 0 : num(o!);
    if (occ === 2) return MList.of(hits);
    if (!hits.length) return -1;
    return occ === 1 ? hits[hits.length - 1]! : hits[0]!;
  });
  lib.def("List.ContainsAll", "list, values, ?equationCriteria", ([l, v, e], ctx) => {
    const eq = equalityOf(ctx, e!);
    const xs = list(l!).values();
    return list(v!).values().every((y) => xs.some((x) => eq(x, y)));
  });
  lib.def("List.ContainsAny", "list, values, ?equationCriteria", ([l, v, e], ctx) => {
    const eq = equalityOf(ctx, e!);
    const xs = list(l!).values();
    return list(v!).values().some((y) => xs.some((x) => eq(x, y)));
  });
  lib.def("List.IsDistinct", "list, ?equationCriteria", ([l, e], ctx) => {
    const key = keyOf(ctx, e!);
    const vs = list(l!).values();
    return new Set(vs.map(key)).size === vs.length;
  });
  lib.def("List.AllTrue", "list", ([l]) => list(l!).values().every((v) => v === true));
  lib.def("List.AnyTrue", "list", ([l]) => list(l!).values().some((v) => v === true));
  lib.def("List.MatchesAll", "list, condition", ([l, c], ctx) => list(l!).values().every((v) => ctx.call(fn(c!), [v]) === true));
  lib.def("List.MatchesAny", "list, condition", ([l, c], ctx) => list(l!).values().some((v) => ctx.call(fn(c!), [v]) === true));
  lib.def("List.NonNullCount", "list", ([l]) => nonNullValues(l!).length);
  lib.def("List.Product", "numbersList, ?precision", ([l]) => {
    const xs = numbers(l!);
    return xs.length ? xs.reduce((a, b) => a * b, 1) : null;
  });
  lib.def("List.Median", "list, ?comparisonCriteria", ([l]) => medianValue(nonNullValues(l!)));
  lib.def("List.Mode", "list, ?equationCriteria", ([l], ctx) => {
    const vs = list(l!).values();
    if (!vs.length) throw new MError("Expression.Error", "The list is empty.");
    const key = keyOf(ctx, null);
    const counts = new Map<string, { v: MValue; n: number }>();
    for (const v of vs) {
      const k = key(v);
      const e = counts.get(k) ?? { v, n: 0 };
      e.n++;
      counts.set(k, e);
    }
    let best: { v: MValue; n: number } | null = null;
    for (const e of counts.values()) if (!best || e.n > best.n) best = e;
    return best!.v;
  });
  lib.def("List.Modes", "list, ?equationCriteria", ([l]) => {
    const vs = list(l!).values();
    const counts = new Map<string, { v: MValue; n: number }>();
    for (const v of vs) {
      const e = counts.get(hashKey(v)) ?? { v, n: 0 };
      e.n++;
      counts.set(hashKey(v), e);
    }
    const max = Math.max(0, ...[...counts.values()].map((e) => e.n));
    return MList.of([...counts.values()].filter((e) => e.n === max).map((e) => e.v));
  });
  lib.def("List.StandardDeviation", "numbersList", ([l]) => {
    const xs = numbers(l!);
    if (xs.length < 2) return null;
    const avg = xs.reduce((a, b) => a + b, 0) / xs.length;
    return Math.sqrt(xs.reduce((a, b) => a + (b - avg) ** 2, 0) / (xs.length - 1));
  });
  lib.def("List.Covariance", "numberList1, numberList2", ([a, b]) => {
    const x = list(a!).values().map(num);
    const y = list(b!).values().map(num);
    if (x.length !== y.length || !x.length) return null;
    const mx = x.reduce((s, v) => s + v, 0) / x.length;
    const my = y.reduce((s, v) => s + v, 0) / y.length;
    return x.reduce((s, v, i) => s + (v - mx) * (y[i]! - my), 0) / x.length;
  });
  lib.def("List.Percentile", "list, percentiles, ?options", ([l, p]) => {
    const xs = numbers(l!).sort((a, b) => a - b);
    const at = (q: number) => {
      if (!xs.length) return null;
      const pos = (xs.length - 1) * q;
      const lo = Math.floor(pos);
      return xs[lo]! + (xs[Math.min(lo + 1, xs.length - 1)]! - xs[lo]!) * (pos - lo);
    };
    return p instanceof MList ? MList.of(p.values().map((q) => at(num(q)))) : at(num(p!));
  });
  const nByCriteria = (desc: boolean) => ([l, c, cr]: MValue[], ctx: LibContext) => {
    const vs = [...list(l!).values()];
    vs.sort((a, b) => (cr instanceof MFunction ? valueCompare(ctx.call(cr, [a]), ctx.call(cr, [b])) : valueCompare(a, b)) * (desc ? -1 : 1));
    if (typeof c === "number") return MList.of(vs.slice(0, c));
    const f = fn(c!);
    let n = 0;
    while (n < vs.length && ctx.call(f, [vs[n]!]) === true) n++;
    return MList.of(vs.slice(0, n));
  };
  lib.def("List.MaxN", "list, countOrCondition, ?comparisonCriteria, ?includeNulls", nByCriteria(true));
  lib.def("List.MinN", "list, countOrCondition, ?comparisonCriteria, ?includeNulls", nByCriteria(false));
  const seq = (name: string, make: (start: MValue, i: number, step: MValue) => MValue) =>
    lib.def(name, "start, count, step", ([s, c, st]) => MList.of(Array.from({ length: num(c!) }, (_x, i) => make(s!, i, st!))));
  seq("List.DateTimes", (s, i, st) => new MDateTime((s as MDateTime).ms + i * (st as MDuration).ms));
  seq("List.DateTimeZones", (s, i, st) => new MDateTimeZone((s as MDateTimeZone).ms + i * (st as MDuration).ms, (s as MDateTimeZone).offsetMinutes));
  seq("List.Times", (s, i, st) => new MTime(((((s as MTime).ms + i * (st as MDuration).ms) % MS_PER_DAY) + MS_PER_DAY) % MS_PER_DAY));
  seq("List.Durations", (s, i, st) => new MDuration((s as MDuration).ms + i * (st as MDuration).ms));
  lib.def("List.Random", "count, ?seed", ([c, s]) => {
    let seed = s === null ? 0x2f6b7c1 : num(s!) >>> 0;
    const next = () => {
      seed = (seed + 0x6d2b79f5) >>> 0;
      let t = seed;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    return MList.of(Array.from({ length: num(c!) }, next));
  });
  lib.def("List.FindText", "list, text", ([l, t]) => {
    const needle = text(t!);
    return MList.of(list(l!).values().filter((v) => (typeof v === "string" ? v.includes(needle) : v instanceof MRecord ? v.names.some((n) => typeof v.get(n) === "string" && (v.get(n) as string).includes(needle)) : false)));
  });
  lib.def("List.ConformToPageReader", "list, ?options", ([l]) => list(l!));
}

// ---------------------------------------------------------------------------------------------

function installTextExtra(lib: Library): void {
  lib.def("Text.Clean", "text", ([t]) => (t === null ? null : text(t!).replace(/[\u0000-\u001F\u007F-\u009F]/g, "")));
  lib.def("Text.ToList", "text", ([t]) => MList.of([...text(t!)]));
  lib.def("Text.Insert", "text, offset, newText", ([t, o, n]) => {
    if (t === null) return null;
    const s = text(t!);
    const i = num(o!);
    if (i > s.length) throw new MError("Expression.Error", "The offset is out of range.");
    return s.slice(0, i) + text(n!) + s.slice(i);
  });
  lib.def("Text.RemoveRange", "text, offset, ?count", ([t, o, c]) => {
    if (t === null) return null;
    const s = text(t!);
    const i = num(o!);
    return s.slice(0, i) + s.slice(i + (c === null ? 1 : num(c!)));
  });
  lib.def("Text.ReplaceRange", "text, offset, count, newText", ([t, o, c, n]) => {
    if (t === null) return null;
    const s = text(t!);
    const i = num(o!);
    return s.slice(0, i) + text(n!) + s.slice(i + num(c!));
  });
  lib.def("Text.Range", "text, offset, ?count", ([t, o, c]) => {
    if (t === null) return null;
    const s = text(t!);
    const i = num(o!);
    if (i > s.length || (c !== null && i + num(c!) > s.length)) throw new MError("Expression.Error", "The 'count' argument is out of range.");
    return c === null ? s.slice(i) : s.slice(i, i + num(c!));
  });
  lib.def("Text.At", "text, index", ([t, i]) => {
    const s = text(t!);
    const n = num(i!);
    if (n >= s.length) throw new MError("Expression.Error", "The index is out of range.");
    return s[n]!;
  });
  lib.def("Text.Repeat", "text, count", ([t, c]) => (t === null ? null : text(t!).repeat(num(c!))));
  lib.def("Text.Reverse", "text", ([t]) => (t === null ? null : [...text(t!)].reverse().join("")));
  lib.def("Text.NewGuid", "", () => {
    const b = new Uint8Array(16);
    crypto.getRandomValues(b);
    b[6] = (b[6]! & 0x0f) | 0x40;
    b[8] = (b[8]! & 0x3f) | 0x80;
    const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  });
  lib.def("Text.SplitAny", "text, separators", ([t, s]) => {
    const seps = new Set([...text(s!)]);
    const out: string[] = [];
    let cur = "";
    for (const ch of text(t!)) {
      if (seps.has(ch)) {
        out.push(cur);
        cur = "";
      } else cur += ch;
    }
    out.push(cur);
    return MList.of(out);
  });
  lib.def("Text.PositionOfAny", "text, characters, ?occurrence", ([t, c, o]) => {
    const s = text(t!);
    const chars = new Set(list(c!).values().map(text));
    const hits = [...s].flatMap((ch, i) => (chars.has(ch) ? [i] : []));
    const occ = o === null ? 0 : num(o!);
    if (occ === 2) return MList.of(hits);
    if (!hits.length) return -1;
    return occ === 1 ? hits[hits.length - 1]! : hits[0]!;
  });
  lib.def("Text.Format", "formatString, arguments, ?culture", ([f, a, c]) => {
    const fmt = text(f!);
    const culture = cultureArg(c!);
    const lookup = (key: string): MValue => {
      if (a instanceof MList) return a.get(Number(key));
      if (a instanceof MRecord) return a.get(key);
      throw cannotConvert(a!, "List");
    };
    return fmt.replace(/#\{([^}]*)\}/g, (_m, k: string) => {
      const v = lookup(k);
      return v === null ? "" : (toText(v, culture) ?? "");
    });
  });
  lib.def("Text.InferNumberType", "text, ?culture", ([t]) => (/^-?\d+$/.test(text(t!).trim()) ? T.int64 : T.number));
  lib.def("Character.FromNumber", "number", ([n]) => (n === null ? null : String.fromCodePoint(num(n!))));
  lib.def("Character.ToNumber", "character", ([c]) => (c === null ? null : text(c!).codePointAt(0)!));
  lib.def("Uri.EscapeDataString", "data", ([d]) => encodeURIComponent(text(d!)));
  lib.def("Uri.BuildQueryString", "query", ([q]) =>
    record(q!)
      .names.map((n) => `${encodeURIComponent(n)}=${encodeURIComponent(text(record(q!).get(n)))}`)
      .join("&"),
  );
  lib.def("Uri.Combine", "baseUri, relativeUri", ([b, r]) => new URL(text(r!), text(b!)).toString());
  lib.def("Uri.Parts", "absoluteUri", ([u]) => {
    const url = new URL(text(u!));
    return MRecord.from([
      ["Scheme", url.protocol.replace(/:$/, "")],
      ["Host", url.hostname],
      ["Port", url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80],
      ["Path", url.pathname],
      ["Query", MRecord.from([...url.searchParams.entries()])],
      ["Fragment", url.hash.replace(/^#/, "")],
      ["UserName", url.username],
      ["Password", url.password],
    ]);
  });
}

// ---------------------------------------------------------------------------------------------

function installDateExtra(lib: Library): void {
  lib.def("Date.AddQuarters", "dateTime, numberOfQuarters", ([v, n]) => {
    if (v === null) return null;
    const p = dateParts(v!);
    return rebuildDate(v!, addMonthsDays(p.days, 3 * num(n!)), p.timeMs);
  });
  lib.def("Date.IsLeapYear", "dateTime", ([v]) => (v === null ? null : isLeap(civilFromDays(dateParts(v!).days).y)));
  const startOfWeek = (days: number, first: number) => days - ((dayOfWeek(days) - first + 7) % 7);
  lib.def("Date.StartOfWeek", "dateTime, ?firstDayOfWeek", ([v, f]) => (v === null ? null : rebuildDate(v!, startOfWeek(dateParts(v!).days, numOr(f!, 0)), 0)));
  lib.def("Date.EndOfWeek", "dateTime, ?firstDayOfWeek", ([v, f]) => (v === null ? null : rebuildDate(v!, startOfWeek(dateParts(v!).days, numOr(f!, 0)) + 6, MS_PER_DAY - 1)));
  // Power Query's Date.WeekOfYear: week 1 is the week containing January 1st (weeks start on firstDayOfWeek)
  lib.def("Date.WeekOfYear", "dateTime, ?firstDayOfWeek", ([v, f]) => {
    if (v === null) return null;
    const days = dateParts(v!).days;
    const first = numOr(f!, 0);
    const jan1 = daysFromCivil(civilFromDays(days).y, 1, 1);
    return Math.floor((startOfWeek(days, first) - startOfWeek(jan1, first)) / 7) + 1;
  });
  lib.def("Date.WeekOfMonth", "dateTime, ?firstDayOfWeek", ([v, f]) => {
    if (v === null) return null;
    const days = dateParts(v!).days;
    const first = numOr(f!, 0);
    const { y, m } = civilFromDays(days);
    const d1 = daysFromCivil(y, m, 1);
    return Math.floor((startOfWeek(days, first) - startOfWeek(d1, first)) / 7) + 1;
  });
  lib.def("Date.MonthName", "date, ?culture", ([v, c]) => (v === null ? null : formatCustom(dateParts(v!).days * MS_PER_DAY, "MMMM", undefined, cultureArg(c!))));
  lib.def("Date.DayOfWeekName", "date, ?culture", ([v, c]) => (v === null ? null : formatCustom(dateParts(v!).days * MS_PER_DAY, "dddd", undefined, cultureArg(c!))));
  lib.def("Date.ToRecord", "date", ([v]) => {
    const { y, m, d } = civilFromDays(dateParts(v!).days);
    return MRecord.from([["Year", y], ["Month", m], ["Day", d]]);
  });
  lib.def("DateTime.ToRecord", "dateTime", ([v]) => {
    const p = dateParts(v!);
    const { y, m, d } = civilFromDays(p.days);
    return MRecord.from([["Year", y], ["Month", m], ["Day", d], ["Hour", Math.floor(p.timeMs / 3_600_000)], ["Minute", Math.floor(p.timeMs / 60_000) % 60], ["Second", (p.timeMs % 60_000) / 1000]]);
  });
  lib.def("DateTimeZone.ToRecord", "dateTimeZone", ([v]) => {
    const z = v as MDateTimeZone;
    if (!(z instanceof MDateTimeZone)) throw cannotConvert(v!, "DateTimeZone");
    const p = dateParts(z);
    const { y, m, d } = civilFromDays(p.days);
    const oh = Math.trunc(z.offsetMinutes / 60);
    return MRecord.from([["Year", y], ["Month", m], ["Day", d], ["Hour", Math.floor(p.timeMs / 3_600_000)], ["Minute", Math.floor(p.timeMs / 60_000) % 60], ["Second", (p.timeMs % 60_000) / 1000], ["ZoneHours", oh], ["ZoneMinutes", z.offsetMinutes - oh * 60]]);
  });
  lib.def("Time.ToRecord", "time", ([v]) => {
    const t = v as MTime;
    return MRecord.from([["Hour", Math.floor(t.ms / 3_600_000)], ["Minute", Math.floor(t.ms / 60_000) % 60], ["Second", (t.ms % 60_000) / 1000]]);
  });
  const timePart = (name: string, f: (ms: number) => number) =>
    lib.def(name, "dateTime", ([v]) => {
      if (v === null) return null;
      if (v instanceof MTime) return f(v.ms);
      return f(dateParts(v!).timeMs);
    });
  timePart("Time.Hour", (ms) => Math.floor(ms / 3_600_000));
  timePart("Time.Minute", (ms) => Math.floor(ms / 60_000) % 60);
  timePart("Time.Second", (ms) => (ms % 60_000) / 1000);
  const hourBound = (end: boolean) => ([v]: MValue[]) => {
    if (v === null) return null;
    if (v instanceof MTime) return new MTime(Math.floor(v.ms / 3_600_000) * 3_600_000 + (end ? 3_599_999 : 0));
    const p = dateParts(v!);
    return rebuildDate(v!, p.days, Math.floor(p.timeMs / 3_600_000) * 3_600_000 + (end ? 3_599_999 : 0));
  };
  lib.def("Time.StartOfHour", "dateTime", hourBound(false));
  lib.def("Time.EndOfHour", "dateTime", hourBound(true));

  // Date.IsIn* relative to the evaluation clock (local time, like Power Query)
  const today = (ctx: LibContext) => Math.floor((ctx.host.now().getTime() + ctx.localOffsetMinutes * 60_000) / MS_PER_DAY);
  const monthIndex = (days: number) => {
    const { y, m } = civilFromDays(days);
    return y * 12 + m - 1;
  };
  const quarterIndex = (days: number) => Math.floor(monthIndex(days) / 3);
  const yearIndex = (days: number) => civilFromDays(days).y;
  const weekIndex = (days: number) => Math.floor((days - ((dayOfWeek(days) + 7) % 7)) / 7);
  const units: Array<[string, (d: number) => number]> = [
    ["Day", (d) => d],
    ["Week", weekIndex],
    ["Month", monthIndex],
    ["Quarter", quarterIndex],
    ["Year", yearIndex],
  ];
  for (const [unit, idx] of units) {
    const rel = (test: (v: number, now: number, n: number) => boolean, withN: boolean) => ([v, n]: MValue[], ctx: LibContext) => {
      if (v === null) return null;
      return test(idx(dateParts(v!).days), idx(today(ctx)), withN ? num(n!) : 1);
    };
    const plural = unit === "Day" ? "Days" : `${unit}s`;
    lib.def(`Date.IsInCurrent${unit}`, "dateTime", rel((v, now) => v === now, false));
    lib.def(`Date.IsInPrevious${unit}`, "dateTime", rel((v, now) => v === now - 1, false));
    lib.def(`Date.IsInNext${unit}`, "dateTime", rel((v, now) => v === now + 1, false));
    lib.def(`Date.IsInPreviousN${plural}`, "dateTime, " + unit.toLowerCase() + "s", rel((v, now, n) => v < now && v >= now - n, true));
    lib.def(`Date.IsInNextN${plural}`, "dateTime, " + unit.toLowerCase() + "s", rel((v, now, n) => v > now && v <= now + n, true));
  }
  lib.def("Date.IsInYearToDate", "dateTime", ([v], ctx) => {
    if (v === null) return null;
    const d = dateParts(v!).days;
    const t = today(ctx);
    return civilFromDays(d).y === civilFromDays(t).y && d <= t;
  });
  lib.def("DateTime.IsInCurrentHour", "dateTime", ([v], ctx) => {
    if (v === null) return null;
    const p = dateParts(v!);
    const nowMs = ctx.host.now().getTime() + ctx.localOffsetMinutes * 60_000;
    return Math.floor((p.days * MS_PER_DAY + p.timeMs) / 3_600_000) === Math.floor(nowMs / 3_600_000);
  });
}

// ---------------------------------------------------------------------------------------------

function installNumberExtra(lib: Library): void {
  const unary = (name: string, f: (x: number) => number) => lib.def(name, "number", ([x]) => (x === null ? null : f(num(x!))));
  unary("Number.Ln", Math.log);
  unary("Number.Exp", Math.exp);
  unary("Number.Sin", Math.sin);
  unary("Number.Cos", Math.cos);
  unary("Number.Tan", Math.tan);
  unary("Number.Asin", Math.asin);
  unary("Number.Acos", Math.acos);
  unary("Number.Atan", Math.atan);
  unary("Number.Sinh", Math.sinh);
  unary("Number.Cosh", Math.cosh);
  unary("Number.Tanh", Math.tanh);
  unary("Number.Factorial", (n) => {
    let r = 1;
    for (let i = 2; i <= n; i++) r *= i;
    return r;
  });
  lib.def("Number.Log", "number, ?base", ([x, b]) => (x === null ? null : b === null ? Math.log(num(x!)) : Math.log(num(x!)) / Math.log(num(b!))));
  lib.def("Number.Log10", "number", ([x]) => (x === null ? null : Math.log10(num(x!))));
  lib.def("Number.Atan2", "y, x", ([y, x]) => Math.atan2(num(y!), num(x!)));
  lib.def("Number.IsEven", "number", ([x]) => num(x!) % 2 === 0);
  lib.def("Number.IsOdd", "number", ([x]) => Math.abs(num(x!) % 2) === 1);
  lib.def("Number.Combinations", "setSize, combinationSize", ([n, k]) => {
    let r = 1;
    for (let i = 0; i < num(k!); i++) r = (r * (num(n!) - i)) / (i + 1);
    return Math.round(r);
  });
  lib.def("Number.Permutations", "setSize, permutationSize", ([n, k]) => {
    let r = 1;
    for (let i = 0; i < num(k!); i++) r *= num(n!) - i;
    return r;
  });
  lib.def("Number.Random", "", () => Math.random());
  lib.def("Number.RandomBetween", "bottom, top", ([a, b]) => num(a!) + Math.random() * (num(b!) - num(a!)));
  lib.def("Number.BitwiseAnd", "number1, number2", ([a, b]) => num(a!) & num(b!));
  lib.def("Number.BitwiseOr", "number1, number2", ([a, b]) => num(a!) | num(b!));
  lib.def("Number.BitwiseXor", "number1, number2", ([a, b]) => num(a!) ^ num(b!));
  lib.def("Number.BitwiseNot", "number", ([a]) => ~num(a!));
  lib.def("Number.BitwiseShiftLeft", "number1, number2", ([a, b]) => num(a!) << num(b!));
  lib.def("Number.BitwiseShiftRight", "number1, number2", ([a, b]) => num(a!) >> num(b!));
  lib.constant("Number.E", Math.E);
  lib.constant("Number.PI", Math.PI);
  lib.constant("Number.Epsilon", Number.MIN_VALUE);
  lib.constant("Number.MaxValue", Number.MAX_VALUE);
  lib.constant("Number.MinValue", -Number.MAX_VALUE);
  lib.constant("Precision.Double", 0);
  lib.constant("Precision.Decimal", 1);
}

// ---------------------------------------------------------------------------------------------

function installValueExtra(lib: Library): void {
  const arith = (name: string, op: "+" | "-" | "*" | "/") => lib.def(name, "value1, value2, ?precision", ([a, b]) => binaryOp(op, a!, b!));
  arith("Value.Add", "+");
  arith("Value.Subtract", "-");
  arith("Value.Multiply", "*");
  arith("Value.Divide", "/");
  lib.def("Value.ReplaceType", "value, type", ([v, t]) => {
    const ty = type(t!);
    if (v instanceof MTable && ty.kind === "table" && ty.fields) {
      if (ty.fields.length !== v.columns.length) throw new MError("Expression.Error", "The number of columns in the type doesn't match the table.");
      return new MTable(ty.fields.map((f) => f.name), ty.fields.map((f) => f.type), v.rows);
    }
    return v!;
  });
  lib.def("Value.RemoveMetadata", "value, ?metaValue", ([v]) => v!);
  lib.def("Value.ReplaceMetadata", "value, metaValue", ([v]) => v!);
  lib.def("Value.FromText", "text, ?culture", ([t]) => {
    const s = text(t!);
    if (/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(s.trim())) return Number(s);
    if (/^(true|false)$/i.test(s.trim())) return s.trim().toLowerCase() === "true";
    return s;
  });
  lib.def("Value.Lineage", "value", () => null);
  lib.def("Value.Traits", "value", () => MRecord.from([]));
  lib.def("Value.Optimize", "value", ([v]) => v!);
  lib.def("Value.Alternates", "alternates", ([l]) => list(l!).get(0));
  lib.def("Value.As", "value, type", ([v]) => v!);
  lib.def("Value.VersionIdentity", "value", () => null);
  lib.def("Value.Versions", "value", () => MList.of([]));
  lib.def("Value.ViewError", "errorRecord", ([r]) => r!);
  lib.def("Value.Firewall", "key", () => null);
  lib.def("Function.InvokeAfter", "function, delay", ([f], ctx) => ctx.call(fn(f!), []));
  lib.def("Function.From", "functionType, function", ([, f]) => f!);
  lib.def("Function.IsDataSource", "function", () => false);
  lib.def("Diagnostics.Trace", "traceLevel, message, value, ?delayed", ([, , v], ctx) => (v instanceof MFunction && v.params.length === 0 ? ctx.call(v, []) : v!));
  for (const [k, v] of Object.entries({ "TraceLevel.Critical": 1, "TraceLevel.Error": 2, "TraceLevel.Warning": 3, "TraceLevel.Information": 4, "TraceLevel.Verbose": 5 })) lib.constant(k, v);

  lib.def("Record.TransformFields", "record, transformOperations, ?missingField", ([r, ops, m], ctx) => {
    const rec = record(r!);
    const mode = missingMode(m!);
    const list2 = list(ops!).values();
    const pairs = list2.length && typeof list2[0] === "string" ? [list2] : list2.map((x) => list(x).values());
    const cells = [...rec.cells];
    for (const [name, f] of pairs) {
      const i = rec.index.get(text(name!));
      if (i === undefined) {
        if (mode === MISSING_ERROR) throw new MError("Expression.Error", `The field '${text(name!)}' of the record wasn't found.`);
        continue;
      }
      const src = cells[i]!;
      cells[i] = new Lazy(() => ctx.call(fn(f!), [force(src)]));
    }
    return new MRecord(rec.names, cells, rec.index);
  });
  lib.def("Record.FromTable", "table", ([t]) => {
    const tt = table(t!);
    const n = tt.columnIndex("Name");
    const v = tt.columnIndex("Value");
    return new MRecord(tt.rows.map((r) => text(force(r[n]!))), tt.rows.map((r) => r[v]!));
  });
  lib.def("Record.ReorderFields", "record, fieldOrder, ?missingField", ([r, o]) => {
    const rec = record(r!);
    const order = texts(o!);
    let k = 0;
    const names = rec.names.map((n) => (order.includes(n) ? order[k++]! : n));
    return new MRecord(names, names.map((n) => rec.cell(n)!));
  });

  lib.def("Type.ForRecord", "fields, open", ([f, o]) => {
    const rec = record(f!);
    return new MType(
      "record",
      false,
      undefined,
      rec.names.map((n) => {
        const spec = record(rec.get(n));
        return { name: n, type: type(spec.get("Type")), optional: spec.has("Optional") ? spec.get("Optional") === true : false };
      }),
      undefined,
      o === true,
    );
  });
  lib.def("Type.ForFunction", "signature, min", () => T.function);
  lib.def("Type.TableSchema", "tableType", ([t]) => {
    const ty = type(t!);
    const rows = (ty.fields ?? []).map((f, i): Cell[] => [f.name, i, f.type.kind, f.type.nullable, f.type.facet ? `${f.type.facet}.Type` : null]);
    return new MTable(["Name", "Position", "TypeName", "IsNullable", "Kind"], [T.text, T.int64, T.text, T.logical, T.text], rows);
  });
  lib.def("Type.Is", "type1, type2", ([a, b]) => {
    const x = type(a!);
    const y = type(b!);
    if (y.kind === "any") return true;
    if (y.kind === "anynonnull") return !x.nullable && x.kind !== "null" && x.kind !== "any";
    return x.kind === y.kind && (!x.nullable || y.nullable);
  });
  lib.def("Type.IsNullable", "type", ([t]) => type(t!).nullable || type(t!).kind === "any" || type(t!).kind === "null");
  lib.def("Type.NonNullable", "type", ([t]) => {
    const x = type(t!);
    return new MType(x.kind, false, x.facet, x.fields, x.item, x.open);
  });
  lib.def("Type.ListItem", "type", ([t]) => type(t!).item ?? T.any);
  lib.def("Type.RecordFields", "type", ([t]) =>
    MRecord.from((type(t!).fields ?? []).map((f) => [f.name, MRecord.from([["Type", f.type], ["Optional", f.optional]])])),
  );
  lib.def("Type.TableColumn", "tableType, column", ([t, c]) => {
    const f = (type(t!).fields ?? []).find((x) => x.name === text(c!));
    if (!f) throw new MError("Expression.Error", `The column '${text(c!)}' of the table wasn't found.`);
    return f.type;
  });
  lib.def("Type.TableRow", "table", ([t]) => new MType("record", false, undefined, type(t!).fields ?? []));
  lib.def("Type.ForList", "type", ([t]) => new MType("list", false, undefined, undefined, type(t!)));
  lib.def("Type.Facets", "type", ([t]) => MRecord.from([["NumericPrecisionBase", null], ["NativeTypeName", type(t!).facet ?? null]]));
  lib.def("Type.ReplaceFacets", "type, facets", ([t]) => type(t!));
  lib.def("Type.ClosedRecord", "type", ([t]) => {
    const x = type(t!);
    return new MType("record", x.nullable, x.facet, x.fields, x.item, false);
  });
  lib.def("Type.OpenRecord", "type", ([t]) => {
    const x = type(t!);
    return new MType("record", x.nullable, x.facet, x.fields, x.item, true);
  });
  lib.def("Type.IsOpenRecord", "type", ([t]) => type(t!).open);
  lib.def("Type.Union", "types", ([l]) => {
    const ts = list(l!).values().map(type);
    return ts.every((x) => x.kind === ts[0]?.kind) && ts[0] ? ts[0] : T.any;
  });
  lib.def("Table.ColumnTypes", "table", ([t]) => MList.of(table(t!).types));
}

/** Expression.Evaluate and #shared need the interpreter's globals: installed by the engine. */
export function installEvaluate(lib: Library, evaluate: (source: string, env: MRecord | null) => MValue, shared: () => MRecord): void {
  lib.def("Expression.Evaluate", "document, ?environment", ([d, e]) => evaluate(text(d!), e === null ? null : record(e!)));
  lib.def("Expression.Constant", "value", ([v]) => (typeof v === "string" ? `"${v.replace(/"/g, '""')}"` : v === null ? "null" : (toText(v!) ?? "null")));
  lib.def("Expression.Identifier", "name", ([n]) => {
    const s = text(n!);
    return /^[A-Za-z_][A-Za-z0-9_.]*$/.test(s) ? s : `#"${s.replace(/"/g, '""')}"`;
  });
  lib.entries.set("#shared", new Lazy(shared));
  lib.entries.set("#sections", new Lazy(() => MRecord.from([["Section1", shared()]])));
}

export function installExtra(lib: Library): void {
  installSplitters(lib);
  installTableExtra(lib);
  installListExtra(lib);
  installTextExtra(lib);
  installDateExtra(lib);
  installNumberExtra(lib);
  installValueExtra(lib);
}

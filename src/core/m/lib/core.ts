import { toLogical } from "../convert.ts";
import { MError } from "../errors.ts";
import { metadataOf } from "../interpreter.ts";
import {
  Lazy,
  MDate,
  MDuration,
  MList,
  MRecord,
  MTable,
  MType,
  MS_PER_DAY,
  T,
  cannotConvert,
  fieldNotFound,
  hashKey,
  kindOf,
  valueCompare,
  valuesEqual,
  type Cell,
  type MValue,
} from "../values.ts";
import {
  MISSING_ERROR,
  MISSING_USENULL,
  bool,
  fn,
  list,
  num,
  numOr,
  record,
  specList,
  text,
  texts,
  type LibContext,
  type Library,
} from "./util.ts";

function alreadyExists(name: string): MError {
  return new MError("Expression.Error", `The field '${name}' already exists in the record.`, name);
}

function makeRecord(names: string[], cells: Cell[]): MRecord {
  const seen = new Set<string>();
  for (const n of names) {
    if (seen.has(n)) throw alreadyExists(n);
    seen.add(n);
  }
  return new MRecord(names, cells);
}

function recordTypeNames(t: MType): string[] {
  if (t.kind !== "record" || !t.fields) throw cannotConvert(t, "Record");
  return t.fields.map((f) => f.name);
}

function missingMode(v: MValue): number {
  return v === null ? MISSING_ERROR : num(v);
}

function comparerFn(v: MValue, ctx: LibContext): ((a: MValue, b: MValue) => boolean) | null {
  if (v === null) return null;
  const f = fn(v);
  return (a, b) => ctx.call(f, [a, b]) === 0;
}

function distinct(values: MValue[], eq: ((a: MValue, b: MValue) => boolean) | null): MValue[] {
  if (!eq) {
    const seen = new Set<string>();
    return values.filter((v) => {
      const k = hashKey(v);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }
  const out: MValue[] = [];
  for (const v of values) if (!out.some((o) => eq(o, v))) out.push(v);
  return out;
}

function sum(values: MValue[]): MValue {
  const vs = values.filter((v) => v !== null);
  if (vs.length === 0) return null;
  if (vs.every((v) => typeof v === "number")) return (vs as number[]).reduce((a, b) => a + b, 0);
  if (vs.every((v) => v instanceof MDuration)) return new MDuration((vs as MDuration[]).reduce((a, b) => a + b.ms, 0));
  const bad = vs.find((v) => typeof v !== "number")!;
  throw cannotConvert(bad, "Number");
}

function extreme(values: MValue[], dflt: MValue, sign: 1 | -1): MValue {
  const vs = values.filter((v) => v !== null);
  if (vs.length === 0) return dflt;
  let best = vs[0]!;
  for (const v of vs.slice(1)) if (valueCompare(v, best) * sign > 0) best = v;
  return best;
}

const PRIMITIVE_TYPE_NAMES: [string, MType][] = [
  ["Any.Type", T.any],
  ["None.Type", T.none],
  ["Null.Type", T.null],
  ["Logical.Type", T.logical],
  ["Number.Type", T.number],
  ["Text.Type", T.text],
  ["Date.Type", T.date],
  ["DateTime.Type", T.datetime],
  ["DateTimeZone.Type", T.datetimezone],
  ["Time.Type", T.time],
  ["Duration.Type", T.duration],
  ["Binary.Type", T.binary],
  ["List.Type", T.list],
  ["Record.Type", T.record],
  ["Table.Type", T.table],
  ["Function.Type", T.function],
  ["Type.Type", T.type],
];

const NUMBER_FACETS = ["Int64", "Int32", "Int16", "Int8", "Byte", "Double", "Single", "Decimal", "Currency", "Percentage"];

export function installCore(lib: Library): void {
  for (const [name, t] of PRIMITIVE_TYPE_NAMES) lib.constant(name, t);
  for (const facet of NUMBER_FACETS) lib.constant(`${facet}.Type`, new MType("number", true, facet));

  const constants: Record<string, number> = {
    "Order.Ascending": 0,
    "Order.Descending": 1,
    "JoinKind.Inner": 0,
    "JoinKind.LeftOuter": 1,
    "JoinKind.RightOuter": 2,
    "JoinKind.FullOuter": 3,
    "JoinKind.LeftAnti": 4,
    "JoinKind.RightAnti": 5,
    "Day.Sunday": 0,
    "Day.Monday": 1,
    "Day.Tuesday": 2,
    "Day.Wednesday": 3,
    "Day.Thursday": 4,
    "Day.Friday": 5,
    "Day.Saturday": 6,
    "QuoteStyle.None": 0,
    "QuoteStyle.Csv": 1,
    "MissingField.Error": 0,
    "MissingField.Ignore": 1,
    "MissingField.UseNull": 2,
    "RoundingMode.Up": 0,
    "RoundingMode.Down": 1,
    "RoundingMode.AwayFromZero": 2,
    "RoundingMode.TowardZero": 3,
    "RoundingMode.ToEven": 4,
    "GroupKind.Local": 0,
    "GroupKind.Global": 1,
    "ExtraValues.List": 0,
    "ExtraValues.Error": 1,
    "ExtraValues.Ignore": 2,
    "RelativePosition.FromStart": 0,
    "RelativePosition.FromEnd": 1,
    "Occurrence.First": 0,
    "Occurrence.Last": 1,
    "Occurrence.All": 2,
  };
  for (const [k, v] of Object.entries(constants)) lib.constant(k, v);
  lib.constant("Culture.Current", "en-US");

  lib.def("Comparer.Ordinal", "x, y", ([x, y]) => valueCompare(x!, y!));
  lib.def("Comparer.OrdinalIgnoreCase", "x, y", ([x, y]) =>
    valueCompare(typeof x === "string" ? x.toLowerCase() : x!, typeof y === "string" ? y.toLowerCase() : y!),
  );

  lib.def("List.Transform", "list, transform", ([l, f], ctx) => {
    const g = fn(f!);
    return MList.of(list(l!).values().map((v) => ctx.call(g, [v])));
  });
  lib.def("List.Select", "list, selection", ([l, f], ctx) => {
    const g = fn(f!);
    return MList.of(
      list(l!)
        .values()
        .filter((v) => {
          const keep = ctx.call(g, [v]);
          if (keep !== null && typeof keep !== "boolean") throw cannotConvert(keep, "Logical");
          return keep === true;
        }),
    );
  });
  lib.def("List.Sum", "list, ?precision", ([l]) => sum(list(l!).values()));
  lib.def("List.Average", "list, ?precision", ([l]) => {
    const vs = list(l!).values().filter((v) => v !== null);
    if (!vs.length) return null;
    return (sum(vs) as number) / vs.length;
  });
  lib.def("List.Max", "list, ?default, ?comparisonCriteria, ?includeNulls", ([l, d]) => extreme(list(l!).values(), d!, 1));
  lib.def("List.Min", "list, ?default, ?comparisonCriteria, ?includeNulls", ([l, d]) => extreme(list(l!).values(), d!, -1));
  lib.def("List.Count", "list", ([l]) => list(l!).length);
  lib.def("List.IsEmpty", "list", ([l]) => list(l!).length === 0);
  lib.def("List.Distinct", "list, ?equationCriteria", ([l, c], ctx) => MList.of(distinct(list(l!).values(), comparerFn(c!, ctx))));
  lib.def("List.Contains", "list, value, ?equationCriteria", ([l, v, c], ctx) => {
    const eq = comparerFn(c!, ctx);
    return list(l!).values().some((x) => (eq ? eq(x, v!) : valuesEqual(x, v!)));
  });
  lib.def("List.PositionOf", "list, value, ?occurrence, ?equationCriteria", ([l, v, o, c], ctx) => {
    const eq = comparerFn(c!, ctx);
    const xs = list(l!).values();
    const hits = xs.flatMap((x, i) => ((eq ? eq(x, v!) : valuesEqual(x, v!)) ? [i] : []));
    const occ = o === null ? 0 : num(o!);
    if (occ === 2) return new MList(hits);
    if (!hits.length) return -1;
    return occ === 1 ? hits[hits.length - 1]! : hits[0]!;
  });
  lib.def("List.First", "list, ?defaultValue", ([l, d]) => {
    const xs = list(l!);
    return xs.length ? xs.get(0) : d!;
  });
  lib.def("List.Last", "list, ?defaultValue", ([l, d]) => {
    const xs = list(l!);
    return xs.length ? xs.get(xs.length - 1) : d!;
  });
  lib.def("List.RemoveNulls", "list", ([l]) => MList.of(list(l!).values().filter((v) => v !== null)));
  lib.def("List.Reverse", "list", ([l]) => MList.of(list(l!).values().reverse()));
  lib.def("List.Combine", "lists", ([ls]) => new MList(list(ls!).values().flatMap((x) => list(x).cells)));
  lib.def("List.Numbers", "start, count, ?increment", ([s, c, inc]) => {
    const start = num(s!);
    const step = numOr(inc!, 1);
    return MList.of(Array.from({ length: num(c!) }, (_x, i) => start + i * step));
  });
  lib.def("List.Sort", "list, ?comparisonCriteria", ([l, c]) => {
    const desc = c === 1;
    if (c !== null && c !== 0 && c !== 1) throw new MError("Expression.Error", "List.Sort: only Order.Ascending / Order.Descending are supported in Lumen yet.");
    return MList.of([...list(l!).values()].sort((a, b) => valueCompare(a, b) * (desc ? -1 : 1)));
  });
  lib.def("List.Dates", "start, count, step", ([s, c, st]) => {
    if (!(s instanceof MDate)) throw cannotConvert(s!, "Date");
    if (!(st instanceof MDuration)) throw cannotConvert(st!, "Duration");
    const stepDays = st.ms / MS_PER_DAY;
    return MList.of(Array.from({ length: num(c!) }, (_x, i) => new MDate(s.days + Math.floor(i * stepDays))));
  });
  lib.def("List.Generate", "initial, condition, next, ?selector", ([init, cond, next, sel], ctx) => {
    const out: MValue[] = [];
    let state = ctx.call(fn(init!), []);
    for (let guard = 0; ; guard++) {
      if (guard > 1_000_000) throw new MError("Expression.Error", "List.Generate stopped after 1,000,000 items. Check that the condition eventually returns false.");
      const ok = ctx.call(fn(cond!), [state]);
      if (typeof ok !== "boolean") throw cannotConvert(ok, "Logical");
      if (!ok) break;
      out.push(sel ? ctx.call(fn(sel), [state]) : state);
      state = ctx.call(fn(next!), [state]);
    }
    return MList.of(out);
  });
  lib.def("List.Accumulate", "list, seed, accumulator", ([l, seed, acc], ctx) => {
    const f = fn(acc!);
    return list(l!).values().reduce<MValue>((state, current) => ctx.call(f, [state, current]), seed!);
  });

  lib.def("Record.Field", "record, field", ([r, f]) => {
    const rec = record(r!);
    const name = text(f!);
    if (!rec.has(name)) throw fieldNotFound(name);
    return rec.get(name);
  });
  lib.def("Record.FieldOrDefault", "record, field, ?defaultValue", ([r, f, d]) => {
    if (r === null) return d!;
    const rec = record(r!);
    const name = text(f!);
    return rec.has(name) ? rec.get(name) : d!;
  });
  lib.def("Record.FieldNames", "record", ([r]) => MList.of(record(r!).names));
  lib.def("Record.HasFields", "record, fields", ([r, f]) => {
    const rec = record(r!);
    const names = typeof f === "string" ? [f] : list(f!).values().map(text);
    return names.every((n) => rec.has(n));
  });
  lib.def("Record.FieldCount", "record", ([r]) => record(r!).names.length);
  lib.def("Record.FieldValues", "record", ([r]) => new MList([...record(r!).cells]));
  lib.def("Record.ToList", "record", ([r]) => new MList([...record(r!).cells]));
  lib.def("Record.ToTable", "record", ([r]) => {
    const rec = record(r!);
    return new MTable(["Name", "Value"], [T.text, T.any], rec.names.map((n, i) => [n, rec.cells[i]!]));
  });
  lib.def("Record.FromList", "list, fields", ([l, f]) => {
    const values = list(l!).cells;
    const names = f instanceof MType ? recordTypeNames(f) : list(f!).values().map(text);
    if (names.length !== values.length) {
      throw new MError("Expression.Error", `Record.FromList got ${values.length} values but ${names.length} field names. Pass one field name per value.`);
    }
    return makeRecord(names, [...values]);
  });
  lib.def("Record.AddField", "record, fieldName, value, ?delayed", ([r, n, v, delayed], ctx) => {
    const rec = record(r!);
    const name = text(n!);
    if (rec.has(name)) throw alreadyExists(name);
    let value: Cell = v!;
    if (delayed === true) {
      const f = fn(v!);
      value = new Lazy(() => ctx.call(f, []));
    } else if (delayed !== null) bool(delayed!);
    return new MRecord([...rec.names, name], [...rec.cells, value]);
  });
  lib.def("Record.RemoveFields", "record, fields, ?missingField", ([r, f, m]) => {
    const rec = record(r!);
    const drop = new Set(texts(f!));
    if (missingMode(m!) === MISSING_ERROR) for (const n of drop) if (!rec.has(n)) throw fieldNotFound(n);
    const keep = rec.names.flatMap((n, i) => (drop.has(n) ? [] : [i]));
    return new MRecord(
      keep.map((i) => rec.names[i]!),
      keep.map((i) => rec.cells[i]!),
    );
  });
  lib.def("Record.SelectFields", "record, fields, ?missingField", ([r, f, m]) => {
    const rec = record(r!);
    const mode = missingMode(m!);
    const names: string[] = [];
    const cells: Cell[] = [];
    for (const n of texts(f!)) {
      const c = rec.cell(n);
      if (c === undefined) {
        if (mode === MISSING_ERROR) throw fieldNotFound(n);
        if (mode !== MISSING_USENULL) continue;
      }
      if (names.includes(n)) continue;
      names.push(n);
      cells.push(c ?? null);
    }
    return new MRecord(names, cells);
  });
  lib.def("Record.RenameFields", "record, renames, ?missingField", ([r, specs, m]) => {
    const rec = record(r!);
    const mode = missingMode(m!);
    const names = [...rec.names];
    for (const [from, to] of specList(specs!)) {
      const idx = rec.index.get(text(from!));
      if (idx === undefined) {
        if (mode === MISSING_ERROR) throw fieldNotFound(text(from!));
        continue;
      }
      names[idx] = text(to!);
    }
    return makeRecord(names, [...rec.cells]);
  });
  lib.def("Record.Combine", "records", ([rs]) => {
    const names: string[] = [];
    const cells: Cell[] = [];
    const at = new Map<string, number>();
    for (const x of list(rs!).values()) {
      const rec = record(x);
      rec.names.forEach((n, i) => {
        const pos = at.get(n);
        if (pos === undefined) {
          at.set(n, names.length);
          names.push(n);
          cells.push(rec.cells[i]!);
        } else cells[pos] = rec.cells[i]!;
      });
    }
    return new MRecord(names, cells);
  });

  lib.def("Logical.From", "value", ([v]) => toLogical(v!));
  lib.def("Logical.FromText", "text", ([v]) => (v === null ? null : toLogical(text(v!))));
  lib.def("Logical.ToText", "logical", ([v]) => (v === null ? null : v ? "true" : "false"));

  lib.def("Value.Metadata", "value", ([v]) => metadataOf(v!) ?? new MRecord([], []));
  lib.def("Value.Is", "value, type", ([v, t]) => {
    if (!(t instanceof MType)) throw cannotConvert(t!, "Type");
    return t.kind === "any" || (v === null ? t.nullable || t.kind === "null" : kindOf(v!) === t.kind);
  });
  lib.def("Value.Type", "value", ([v]) => (T as Record<string, MType>)[kindOf(v!)] ?? T.any);
  lib.def("Value.Equals", "value1, value2, ?precision", ([a, b]) => valuesEqual(a!, b!));
  lib.def("Value.Compare", "value1, value2, ?precision", ([a, b]) => valueCompare(a!, b!));
  lib.def("Value.NativeQuery", "target, query, ?parameters, ?options", () => {
    throw new MError(
      "Expression.Error",
      "Value.NativeQuery is not supported in Lumen yet: Parity doesn't send native SQL to the endpoint. Navigate with Source{[Schema=\"...\", Item=\"...\"]}[Data] and filter with Table.SelectRows instead.",
    );
  });

  lib.def("Error.Record", "reason, ?message, ?detail", ([r, m, d]) =>
    MRecord.from([
      ["Reason", text(r!)],
      ["Message", m ?? null],
      ["Detail", d ?? null],
    ]),
  );

  lib.def("Function.Invoke", "function, args", ([f, a], ctx) => ctx.call(f!, list(a!).values()));
}

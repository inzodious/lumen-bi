import { convertToType, toText } from "../convert.ts";
import { MError } from "../errors.ts";
import {
  Lazy,
  MFunction,
  MList,
  MRecord,
  MTable,
  MType,
  T,
  cannotConvert,
  columnNotFound,
  fieldNotFound,
  force,
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
  cell,
  cultureArg,
  flag,
  fn,
  list,
  num,
  numOr,
  record,
  specList,
  table,
  text,
  texts,
  type,
  type LibContext,
  type Library,
} from "./util.ts";

export function alreadyExists(name: string): MError {
  return new MError("Expression.Error", `The field '${name}' already exists in the record.`, name);
}

export function missingMode(v: MValue): number {
  return v === null ? MISSING_ERROR : num(v);
}

export function assertUnique(names: string[]): void {
  const seen = new Set<string>();
  for (const n of names) {
    if (seen.has(n)) throw alreadyExists(n);
    seen.add(n);
  }
}

export function condition(ctx: LibContext, f: MFunction, rec: MRecord): boolean {
  const r = ctx.call(f, [rec]);
  if (r === null) return false;
  if (typeof r !== "boolean") throw cannotConvert(r, "Logical");
  return r;
}

export function tableFromType(t: MType, rows: Cell[][]): MTable {
  const fields = t.fields ?? [];
  return new MTable(
    fields.map((f) => f.name),
    fields.map((f) => f.type),
    rows,
  );
}

export function defaultNames(n: number): string[] {
  return Array.from({ length: n }, (_x, i) => `Column${i + 1}`);
}

function columnsArg(v: MValue, width: number): { names: string[]; types: MType[] } {
  if (v === null) {
    const names = defaultNames(width);
    return { names, types: names.map(() => T.any) };
  }
  if (v instanceof MType) {
    if (v.kind !== "table" || !v.fields) throw cannotConvert(v, "Table");
    return { names: v.fields.map((f) => f.name), types: v.fields.map((f) => f.type) };
  }
  if (typeof v === "number") {
    const names = defaultNames(v);
    return { names, types: names.map(() => T.any) };
  }
  const names = list(v).values().map(text);
  return { names, types: names.map(() => T.any) };
}

function rowsFromLists(rows: MValue, width: number): Cell[][] {
  return list(rows)
    .values()
    .map((r) => {
      const cells = list(r).cells;
      if (cells.length !== width) {
        throw new MError("Expression.Error", `The row has ${cells.length} values but the table has ${width} columns.`);
      }
      return cells;
    });
}

/** Parses Table.Sort criteria into per-row key extractors with a direction. */
export function sortKeys(t: MTable, criteria: MValue, ctx: LibContext): { key: (row: Cell[], i: number) => MValue; desc: boolean }[] {
  const byName = (name: string, desc: boolean) => {
    const idx = t.columnIndex(name);
    return { key: (row: Cell[]) => force(row[idx]!), desc };
  };
  const one = (c: MValue): { key: (row: Cell[], i: number) => MValue; desc: boolean } => {
    if (typeof c === "string") return byName(c, false);
    if (c instanceof MFunction) return { key: (_row, i) => ctx.call(c, [t.row(i)]), desc: false };
    const parts = list(c).values();
    const order = parts[1] ?? 0;
    if (order !== 0 && order !== 1) throw new MError("Expression.Error", "Table.Sort: the sort order must be Order.Ascending or Order.Descending.");
    const target = parts[0]!;
    if (target instanceof MFunction) return { key: (_row, i) => ctx.call(target, [t.row(i)]), desc: order === 1 };
    return byName(text(target), order === 1);
  };
  if (typeof criteria === "string" || criteria instanceof MFunction) return [one(criteria)];
  const items = list(criteria).values();
  if (items.length === 2 && typeof items[0] === "string" && typeof items[1] === "number") return [one(criteria)];
  return items.map(one);
}

function keyIndexes(t: MTable, keys: MValue): number[] {
  return texts(keys).map((k) => t.columnIndex(k));
}

function nestedTypeOf(values: Cell[]): MTable | null {
  for (const c of values) {
    if (c instanceof Lazy && c.failed) continue;
    const v = c instanceof Lazy ? (c.errorOf() ? null : c.get()) : c;
    if (v instanceof MTable) return v;
  }
  return null;
}

export function installTable(lib: Library): void {
  lib.def("#table", "columns, rows", ([c, r]) => {
    const firstRow = r instanceof MList && r.length ? list(r.get(0)).length : 0;
    const { names, types } = columnsArg(c!, firstRow);
    assertUnique(names);
    return new MTable(names, types, rowsFromLists(r!, names.length));
  });
  lib.def("Table.FromRows", "rows, ?columns", ([r, c]) => {
    const firstRow = r instanceof MList && r.length ? list(r.get(0)).length : 0;
    const { names, types } = columnsArg(c!, firstRow);
    assertUnique(names);
    return new MTable(names, types, rowsFromLists(r!, names.length));
  });
  lib.def("Table.FromRecords", "records, ?columns, ?missingField", ([rs, c, m]) => {
    const recs = list(rs!).values().map(record);
    const mode = missingMode(m!);
    const { names, types } = c === null ? { names: recs[0]?.names ?? [], types: (recs[0]?.names ?? []).map(() => T.any) } : columnsArg(c!, 0);
    const rows = recs.map((rec) =>
      names.map((n) => {
        const cc = rec.cell(n);
        if (cc === undefined) {
          if (mode === MISSING_ERROR) throw fieldNotFound(n);
          return null;
        }
        return cc;
      }),
    );
    return new MTable(names, types, rows);
  });
  lib.def("Table.ToRecords", "table", ([t]) => new MList(table(t!).records()));
  lib.def("Table.ToRows", "table", ([t]) => new MList(table(t!).rows.map((r) => new MList(r))));
  lib.def("Table.Column", "table, column", ([t, c]) => table(t!).column(text(c!)));
  lib.def("Table.ColumnNames", "table", ([t]) => MList.of(table(t!).columns));
  lib.def("Table.ColumnCount", "table", ([t]) => table(t!).columns.length);
  lib.def("Table.RowCount", "table", ([t]) => table(t!).rows.length);
  lib.def("Table.IsEmpty", "table", ([t]) => table(t!).rows.length === 0);
  lib.def("Table.HasColumns", "table, columns", ([t, c]) => texts(c!).every((n) => table(t!).index.has(n)));
  // buffering reads the rows now, so later steps no longer fold to the source (as in Power Query)
  lib.def("Table.Buffer", "table, ?options", ([t]) => {
    const tt = table(t!);
    return tt.fold ? new MTable(tt.columns, tt.types, tt.rows) : tt;
  });
  lib.def("Table.First", "table, ?default", ([t, d]) => {
    const tt = table(t!);
    return tt.rows.length ? tt.row(0) : d!;
  });
  lib.def("Table.Last", "table, ?default", ([t, d]) => {
    const tt = table(t!);
    return tt.rows.length ? tt.row(tt.rows.length - 1) : d!;
  });

  lib.def("Table.SelectRows", "table, condition", ([t, c], ctx) => {
    const tt = table(t!);
    const f = fn(c!);
    return new MTable(tt.columns, tt.types, tt.rows.filter((_r, i) => condition(ctx, f, tt.row(i))));
  });

  lib.def("Table.AddColumn", "table, newColumnName, columnGenerator, ?columnType", ([t, n, g, ty], ctx) => {
    const tt = table(t!);
    const name = text(n!);
    const f = fn(g!);
    if (tt.index.has(name)) throw alreadyExists(name);
    const colType = ty === null ? T.any : type(ty!);
    return new MTable(
      [...tt.columns, name],
      [...tt.types, colType],
      tt.rows.map((r, i) => [...r, cell(() => ctx.call(f, [tt.row(i)]))]),
    );
  });

  lib.def("Table.AddIndexColumn", "table, newColumnName, ?initialValue, ?increment, ?columnType", ([t, n, s, inc]) => {
    const tt = table(t!);
    const name = text(n!);
    if (tt.index.has(name)) throw alreadyExists(name);
    const start = numOr(s!, 0);
    const step = numOr(inc!, 1);
    return new MTable([...tt.columns, name], [...tt.types, T.int64], tt.rows.map((r, i) => [...r, start + i * step]));
  });

  lib.def("Table.DuplicateColumn", "table, columnName, newColumnName, ?columnType", ([t, c, n, ty]) => {
    const tt = table(t!);
    const idx = tt.columnIndex(text(c!));
    const name = text(n!);
    if (tt.index.has(name)) throw alreadyExists(name);
    return new MTable([...tt.columns, name], [...tt.types, ty === null ? tt.types[idx]! : type(ty!)], tt.rows.map((r) => [...r, r[idx]!]));
  });

  lib.def("Table.TransformColumnTypes", "table, typeTransformations, ?culture", ([t, specs, cultureOrOptions], ctx) => {
    const tt = table(t!);
    const opts = cultureOrOptions instanceof MRecord ? cultureOrOptions : null;
    const culture = cultureArg(opts ? flag(opts, "Culture") : cultureOrOptions!);
    const mode = missingMode(opts ? flag(opts, "MissingField") : null);
    const columns = [...tt.columns];
    const types = [...tt.types];
    const conversions = new Map<number, MType>();
    for (const [name, ty] of specList(specs!)) {
      const col = text(name!);
      const target = type(ty!);
      let idx = tt.index.get(col);
      if (idx === undefined) {
        if (mode === MISSING_ERROR) throw columnNotFound(col);
        if (mode !== MISSING_USENULL || columns.includes(col)) continue;
        idx = columns.length;
        columns.push(col);
      }
      conversions.set(idx, target);
      types[idx] = target;
    }
    const offset = ctx.localOffsetMinutes;
    const rows = tt.rows.map((r) =>
      columns.map((_n, i) => {
        const c = i < r.length ? r[i]! : null;
        const target = conversions.get(i);
        return target ? cell(() => convertToType(force(c), target, offset, culture)) : c;
      }),
    );
    return new MTable(columns, types, rows);
  });

  lib.def("Table.TransformColumns", "table, transformOperations, ?defaultTransformation, ?missingField", ([t, specs, dflt, m], ctx) => {
    const tt = table(t!);
    const mode = missingMode(m!);
    const types = [...tt.types];
    const transforms = new Map<number, MFunction>();
    for (const spec of specList(specs!)) {
      const name = text(spec[0]!);
      const idx = tt.index.get(name);
      if (idx === undefined) {
        if (mode === MISSING_ERROR) throw columnNotFound(name);
        continue;
      }
      transforms.set(idx, fn(spec[1]!));
      if (spec[2] !== undefined && spec[2] !== null) types[idx] = type(spec[2]);
    }
    const fallback = dflt === null ? null : fn(dflt!);
    const rows = tt.rows.map((r) =>
      r.map((c, i) => {
        const f = transforms.get(i) ?? fallback;
        return f ? cell(() => ctx.call(f, [force(c)])) : c;
      }),
    );
    return new MTable(tt.columns, types, rows);
  });

  lib.def("Table.RenameColumns", "table, renames, ?missingField", ([t, specs, m]) => {
    const tt = table(t!);
    const mode = missingMode(m!);
    const names = [...tt.columns];
    for (const [from, to] of specList(specs!)) {
      const idx = tt.index.get(text(from!));
      if (idx === undefined) {
        if (mode === MISSING_ERROR) throw columnNotFound(text(from!));
        continue;
      }
      names[idx] = text(to!);
    }
    assertUnique(names);
    return new MTable(names, tt.types, tt.rows);
  });

  lib.def("Table.TransformColumnNames", "table, nameGenerator, ?options", ([t, g], ctx) => {
    const tt = table(t!);
    const f = fn(g!);
    const names = tt.columns.map((c) => text(ctx.call(f, [c])));
    assertUnique(names);
    return new MTable(names, tt.types, tt.rows);
  });

  lib.def("Table.RemoveColumns", "table, columns, ?missingField", ([t, c, m]) => {
    const tt = table(t!);
    const mode = missingMode(m!);
    const drop = new Set<number>();
    for (const name of texts(c!)) {
      const idx = tt.index.get(name);
      if (idx === undefined) {
        if (mode === MISSING_ERROR) throw columnNotFound(name);
        continue;
      }
      drop.add(idx);
    }
    const keep = tt.columns.map((_c, i) => i).filter((i) => !drop.has(i));
    return new MTable(
      keep.map((i) => tt.columns[i]!),
      keep.map((i) => tt.types[i]!),
      tt.rows.map((r) => keep.map((i) => r[i]!)),
    );
  });

  lib.def("Table.SelectColumns", "table, columns, ?missingField", ([t, c, m]) => {
    const tt = table(t!);
    const mode = missingMode(m!);
    const picks: { name: string; idx: number }[] = [];
    for (const name of texts(c!)) {
      const idx = tt.index.get(name);
      if (idx === undefined) {
        if (mode === MISSING_ERROR) throw columnNotFound(name);
        if (mode === MISSING_USENULL) picks.push({ name, idx: -1 });
        continue;
      }
      picks.push({ name, idx });
    }
    assertUnique(picks.map((p) => p.name));
    return new MTable(
      picks.map((p) => p.name),
      picks.map((p) => (p.idx < 0 ? T.any : tt.types[p.idx]!)),
      tt.rows.map((r) => picks.map((p) => (p.idx < 0 ? null : r[p.idx]!))),
    );
  });

  lib.def("Table.ReorderColumns", "table, columnOrder, ?missingField", ([t, c, m]) => {
    const tt = table(t!);
    const mode = missingMode(m!);
    const order: number[] = [];
    for (const name of texts(c!)) {
      const idx = tt.index.get(name);
      if (idx === undefined) {
        if (mode === MISSING_ERROR) throw columnNotFound(name);
        continue;
      }
      order.push(idx);
    }
    const slots = [...order].sort((a, b) => a - b);
    const perm = tt.columns.map((_c, i) => i);
    slots.forEach((slot, k) => (perm[slot] = order[k]!));
    return new MTable(
      perm.map((i) => tt.columns[i]!),
      perm.map((i) => tt.types[i]!),
      tt.rows.map((r) => perm.map((i) => r[i]!)),
    );
  });

  lib.def("Table.PromoteHeaders", "table, ?options", ([t, o]) => {
    const tt = table(t!);
    if (tt.rows.length === 0) return tt;
    const all = flag(o!, "PromoteAllScalars") === true;
    const header = tt.rows[0]!.map(force);
    const names = header.map((v, i) => {
      if (typeof v === "string" && v !== "") return v;
      const scalar = v !== null && v !== "" && ["logical", "number", "date", "datetime", "datetimezone", "time", "duration"].includes(kindOf(v));
      return all && scalar ? toText(v)! : tt.columns[i]!;
    });
    const seen = new Map<string, number>();
    const unique = names.map((n) => {
      if (!seen.has(n)) {
        seen.set(n, 0);
        return n;
      }
      let k = seen.get(n)! + 1;
      while (names.includes(`${n}_${k}`) || seen.has(`${n}_${k}`)) k++;
      seen.set(n, k);
      seen.set(`${n}_${k}`, 0);
      return `${n}_${k}`;
    });
    return new MTable(unique, unique.map(() => T.any), tt.rows.slice(1));
  });

  lib.def("Table.DemoteHeaders", "table", ([t]) => {
    const tt = table(t!);
    return new MTable(defaultNames(tt.columns.length), tt.columns.map(() => T.any), [tt.columns, ...tt.rows]);
  });

  lib.def("Table.Sort", "table, comparisonCriteria", ([t, c], ctx) => {
    const tt = table(t!);
    const keys = sortKeys(tt, c!, ctx);
    const keyed = tt.rows.map((row, i) => ({ row, i, k: keys.map((k) => k.key(row, i)) }));
    keyed.sort((a, b) => {
      for (let j = 0; j < keys.length; j++) {
        const cmp = valueCompare(a.k[j]!, b.k[j]!);
        if (cmp !== 0) return keys[j]!.desc ? -cmp : cmp;
      }
      return a.i - b.i;
    });
    return new MTable(tt.columns, tt.types, keyed.map((k) => k.row));
  });

  lib.def("Table.Distinct", "table, ?equationCriteria", ([t, c]) => {
    const tt = table(t!);
    const idx = c === null ? tt.columns.map((_c, i) => i) : keyIndexes(tt, c!);
    const seen = new Set<string>();
    return new MTable(
      tt.columns,
      tt.types,
      tt.rows.filter((r) => {
        const k = idx.map((i) => hashKey(force(r[i]!))).join("\u0001");
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      }),
    );
  });

  const takeWhile = (tt: MTable, v: MValue, ctx: LibContext): number => {
    if (v instanceof MFunction) {
      let n = 0;
      while (n < tt.rows.length && condition(ctx, v, tt.row(n))) n++;
      return n;
    }
    return Math.max(0, num(v));
  };
  lib.def("Table.Skip", "table, ?countOrCondition", ([t, c], ctx) => {
    const tt = table(t!);
    return new MTable(tt.columns, tt.types, tt.rows.slice(takeWhile(tt, c ?? 1, ctx)));
  });
  lib.def("Table.FirstN", "table, countOrCondition", ([t, c], ctx) => {
    const tt = table(t!);
    return new MTable(tt.columns, tt.types, tt.rows.slice(0, takeWhile(tt, c!, ctx)));
  });
  lib.def("Table.LastN", "table, countOrCondition", ([t, c]) => {
    const tt = table(t!);
    return new MTable(tt.columns, tt.types, tt.rows.slice(Math.max(0, tt.rows.length - num(c!))));
  });

  lib.def("Table.Group", "table, key, aggregatedColumns, ?groupKind, ?comparer", ([t, k, aggs, kind, comparer], ctx) => {
    const tt = table(t!);
    const keyNames = texts(k!);
    const idx = keyNames.map((n) => tt.columnIndex(n));
    const ignoreCase = comparer instanceof MFunction && comparer.name === "Comparer.OrdinalIgnoreCase";
    if (comparer !== null && !(comparer instanceof MFunction && (ignoreCase || comparer.name === "Comparer.Ordinal"))) {
      throw new MError("Expression.Error", "Table.Group: only Comparer.Ordinal and Comparer.OrdinalIgnoreCase are supported in Lumen yet.");
    }
    const specs = specList(aggs!).map((s) => ({ name: text(s[0]!), f: fn(s[1]!), type: s[2] === undefined || s[2] === null ? T.any : type(s[2]) }));
    assertUnique([...keyNames, ...specs.map((s) => s.name)]);
    const local = kind === 0;
    const groups: { key: MValue[]; rows: Cell[][] }[] = [];
    const byKey = new Map<string, number>();
    let lastKey: string | null = null;
    for (const row of tt.rows) {
      const key = idx.map((i) => force(row[i]!));
      const hk = key.map((v) => hashKey(ignoreCase && typeof v === "string" ? v.toLowerCase() : v)).join("\u0001");
      if (local) {
        if (hk !== lastKey || groups.length === 0) groups.push({ key, rows: [] });
        groups[groups.length - 1]!.rows.push(row);
        lastKey = hk;
        continue;
      }
      let g = byKey.get(hk);
      if (g === undefined) {
        g = groups.length;
        byKey.set(hk, g);
        groups.push({ key, rows: [] });
      }
      groups[g]!.rows.push(row);
    }
    const rows = groups.map((g) => {
      const sub = new MTable(tt.columns, tt.types, g.rows);
      return [...g.key, ...specs.map((s) => cell(() => ctx.call(s.f, [sub])))];
    });
    return new MTable(
      [...keyNames, ...specs.map((s) => s.name)],
      [...idx.map((i) => tt.types[i]!), ...specs.map((s) => s.type)],
      rows,
    );
  });

  lib.def("Table.NestedJoin", "table1, key1, table2, key2, newColumnName, ?joinKind, ?keyEqualityComparers", ([a, k1, b, k2, n, jk]) => {
    const left = table(a!);
    const right = table(b!);
    const li = keyIndexes(left, k1!);
    const ri = keyIndexes(right, k2!);
    if (li.length !== ri.length) throw new MError("Expression.Error", "Table.NestedJoin: both key lists need the same number of columns.");
    const name = text(n!);
    if (left.index.has(name)) throw alreadyExists(name);
    const kind = jk === null ? 1 : num(jk!);
    if (kind < 0 || kind > 5) throw new MError("Expression.Error", "Table.NestedJoin: unknown JoinKind.");
    const keyOf = (row: Cell[], idx: number[]) => idx.map((i) => hashKey(force(row[i]!))).join("\u0001");
    const rightGroups = new Map<string, Cell[][]>();
    for (const row of right.rows) {
      const k = keyOf(row, ri);
      const g = rightGroups.get(k);
      if (g) g.push(row);
      else rightGroups.set(k, [row]);
    }
    const nested = (rows: Cell[][]) => new MTable(right.columns, right.types, rows);
    const matched = new Set<string>();
    const out: Cell[][] = [];
    for (const row of left.rows) {
      const k = keyOf(row, li);
      const g = rightGroups.get(k);
      if (g) matched.add(k);
      const include = kind === 0 || kind === 2 ? !!g : kind === 4 ? !g : kind === 5 ? false : true;
      if (include) out.push([...row, nested(g ?? [])]);
    }
    if (kind === 2 || kind === 3 || kind === 5) {
      for (const [k, g] of rightGroups) {
        if (!matched.has(k)) out.push([...left.columns.map(() => null), nested(g)]);
      }
    }
    const rowType = new MType("table", false, undefined, right.columns.map((c, i) => ({ name: c, type: right.types[i]!, optional: false })));
    return new MTable([...left.columns, name], [...left.types, rowType], out);
  });

  lib.def("Table.ExpandTableColumn", "table, column, columnNames, ?newColumnNames", ([t, c, names, newNames]) => {
    const tt = table(t!);
    const col = text(c!);
    const idx = tt.columnIndex(col);
    const pick = texts(names!);
    const renamed = newNames === null ? pick : texts(newNames!);
    if (renamed.length !== pick.length) throw new MError("Expression.Error", "Table.ExpandTableColumn: newColumnNames must have one name per expanded column.");
    const outNames = [...tt.columns.slice(0, idx), ...renamed, ...tt.columns.slice(idx + 1)];
    assertUnique(outNames);
    const declared = tt.types[idx]!;
    const sample = declared.fields ? null : nestedTypeOf(tt.rows.map((r) => r[idx]!));
    const pickTypes = pick.map((p) => {
      const f = declared.fields?.find((x) => x.name === p);
      if (f) return f.type;
      const si = sample?.index.get(p);
      return si === undefined ? T.any : sample!.types[si]!;
    });
    const rows: Cell[][] = [];
    for (const r of tt.rows) {
      const v = force(r[idx]!);
      const before = r.slice(0, idx);
      const after = r.slice(idx + 1);
      if (v === null) {
        rows.push([...before, ...pick.map(() => null), ...after]);
        continue;
      }
      // A nested table without one of the listed columns expands it to null (it isn't an error).
      if (v instanceof MList) {
        const recs = v.values().map((x) => record(x));
        if (recs.length === 0) rows.push([...before, ...pick.map(() => null), ...after]);
        for (const rec of recs) rows.push([...before, ...pick.map((p) => rec.cell(p) ?? null), ...after]);
        continue;
      }
      const inner = table(v);
      const inIdx = pick.map((p) => inner.index.get(p));
      if (inner.rows.length === 0) rows.push([...before, ...pick.map(() => null), ...after]);
      for (const ir of inner.rows) rows.push([...before, ...inIdx.map((i) => (i === undefined ? null : ir[i]!)), ...after]);
    }
    return new MTable(outNames, [...tt.types.slice(0, idx), ...pickTypes, ...tt.types.slice(idx + 1)], rows);
  });

  lib.def("Table.ExpandRecordColumn", "table, column, fieldNames, ?newColumnNames", ([t, c, names, newNames]) => {
    const tt = table(t!);
    const idx = tt.columnIndex(text(c!));
    const pick = texts(names!);
    const renamed = newNames === null ? pick : texts(newNames!);
    const outNames = [...tt.columns.slice(0, idx), ...renamed, ...tt.columns.slice(idx + 1)];
    assertUnique(outNames);
    const rows = tt.rows.map((r) => {
      const v = force(r[idx]!);
      const rec = v === null ? null : record(v);
      return [...r.slice(0, idx), ...pick.map((p) => rec?.cell(p) ?? null), ...r.slice(idx + 1)];
    });
    return new MTable(outNames, [...tt.types.slice(0, idx), ...pick.map(() => T.any), ...tt.types.slice(idx + 1)], rows);
  });

  lib.def("Replacer.ReplaceValue", "value, old, new", ([v, o, n]) => (valuesEqual(v!, o!) ? n! : v!));
  lib.def("Replacer.ReplaceText", "text, old, new", ([v, o, n]) => {
    if (v === null) return null;
    if (typeof v !== "string") throw cannotConvert(v!, "Text");
    const old = text(o!);
    return old === "" ? v : v.split(old).join(text(n!));
  });

  lib.def("Table.ReplaceValue", "table, oldValue, newValue, replacer, columnsToSearch", ([t, o, n, r, cols], ctx) => {
    const tt = table(t!);
    const f = fn(r!);
    const targets = new Set(texts(cols!).map((c) => tt.columnIndex(c)));
    const rows = tt.rows.map((row, i) => {
      const rec = o instanceof MFunction || n instanceof MFunction ? tt.row(i) : null;
      const oldV = o instanceof MFunction ? ctx.call(o, [rec]) : o!;
      const newV = n instanceof MFunction ? ctx.call(n, [rec]) : n!;
      return row.map((c, j) => (targets.has(j) ? cell(() => ctx.call(f, [force(c), oldV, newV])) : c));
    });
    return new MTable(tt.columns, tt.types, rows);
  });

  lib.def("Table.ReplaceErrorValues", "table, errorReplacement", ([t, specs]) => {
    const tt = table(t!);
    const repl = new Map<number, MValue>();
    for (const [c, v] of specList(specs!)) repl.set(tt.columnIndex(text(c!)), v ?? null);
    const rows = tt.rows.map((row) => row.map((c, j) => (repl.has(j) && c instanceof Lazy && c.errorOf() ? repl.get(j)! : c)));
    return new MTable(tt.columns, tt.types, rows);
  });

  lib.def("Table.RemoveRowsWithErrors", "table, ?columns", ([t, c]) => {
    const tt = table(t!);
    const idx = c === null ? tt.columns.map((_x, i) => i) : keyIndexes(tt, c!);
    return new MTable(
      tt.columns,
      tt.types,
      tt.rows.filter((row) => !idx.some((i) => row[i] instanceof Lazy && (row[i] as Lazy).errorOf() !== undefined)),
    );
  });

  lib.def("Table.SelectRowsWithErrors", "table, ?columns", ([t, c]) => {
    const tt = table(t!);
    const idx = c === null ? tt.columns.map((_x, i) => i) : keyIndexes(tt, c!);
    return new MTable(
      tt.columns,
      tt.types,
      tt.rows.filter((row) => idx.some((i) => row[i] instanceof Lazy && (row[i] as Lazy).errorOf() !== undefined)),
    );
  });

  /** Table.Max / Table.Min: the first row with the largest (smallest) key under Table.Sort-style criteria. */
  const extremeRow = (t: MValue, criteria: MValue, dflt: MValue, ctx: LibContext, sign: 1 | -1): MValue => {
    const tt = table(t);
    if (tt.rows.length === 0) return dflt;
    const keys = sortKeys(tt, criteria, ctx);
    const keyOf = (i: number) => keys.map((k) => k.key(tt.rows[i]!, i));
    const compare = (a: MValue[], b: MValue[]) => {
      for (let j = 0; j < keys.length; j++) {
        const cmp = valueCompare(a[j]!, b[j]!);
        if (cmp !== 0) return keys[j]!.desc ? -cmp : cmp;
      }
      return 0;
    };
    let best = 0;
    let bestKey = keyOf(0);
    for (let i = 1; i < tt.rows.length; i++) {
      const k = keyOf(i);
      if (compare(k, bestKey) * sign > 0) [best, bestKey] = [i, k];
    }
    return tt.row(best);
  };
  lib.def("Table.Max", "table, comparisonCriteria, ?default", ([t, c, d], ctx) => extremeRow(t!, c!, d!, ctx, 1));
  lib.def("Table.Min", "table, comparisonCriteria, ?default", ([t, c, d], ctx) => extremeRow(t!, c!, d!, ctx, -1));

  const fill = (tt: MTable, cols: MValue, reverse: boolean) => {
    const idx = keyIndexes(tt, cols);
    const rows = tt.rows.map((r) => [...r]);
    const order = reverse ? [...rows.keys()].reverse() : [...rows.keys()];
    const last = new Map<number, Cell>();
    for (const r of order) {
      for (const i of idx) {
        const c = rows[r]![i]!;
        if (force(c) === null) {
          if (last.has(i)) rows[r]![i] = last.get(i)!;
        } else last.set(i, c);
      }
    }
    return new MTable(tt.columns, tt.types, rows);
  };
  /** Unpivot keeps the other columns in place, appends attribute and value, and drops null values, as Power Query does. */
  const unpivot = (tt: MTable, pivot: Set<string>, attr: string, val: string): MTable => {
    for (const p of pivot) tt.columnIndex(p);
    const keep = tt.columns.map((_c, i) => i).filter((i) => !pivot.has(tt.columns[i]!));
    const moved = tt.columns.map((_c, i) => i).filter((i) => pivot.has(tt.columns[i]!));
    const names = [...keep.map((i) => tt.columns[i]!), attr, val];
    assertUnique(names);
    const types = moved.map((i) => tt.types[i]!.toString());
    const valueType = moved.length && types.every((t) => t === types[0]) ? tt.types[moved[0]!]! : T.any;
    const rows: Cell[][] = [];
    for (const row of tt.rows) {
      for (const i of moved) {
        const v = force(row[i]!);
        if (v !== null) rows.push([...keep.map((k) => row[k]!), tt.columns[i]!, v]);
      }
    }
    return new MTable(names, [...keep.map((i) => tt.types[i]!), T.text, valueType], rows);
  };

  lib.def("Table.Unpivot", "table, pivotColumns, attributeColumn, valueColumn", ([t, p, a, v]) => unpivot(table(t!), new Set(texts(p!)), text(a!), text(v!)));

  lib.def("Table.UnpivotOtherColumns", "table, pivotColumns, attributeColumn, valueColumn", ([t, p, a, v]) => {
    const tt = table(t!);
    const stay = new Set(texts(p!));
    for (const s of stay) tt.columnIndex(s);
    return unpivot(tt, new Set(tt.columns.filter((c) => !stay.has(c))), text(a!), text(v!));
  });

  lib.def("Table.Pivot", "table, pivotValues, attributeColumn, valueColumn, ?aggregationFunction", ([t, pv, a, v, agg], ctx) => {
    const tt = table(t!);
    const values = list(pv!).values().map(text);
    assertUnique(values);
    const ai = tt.columnIndex(text(a!));
    const vi = tt.columnIndex(text(v!));
    const keep = tt.columns.map((_c, i) => i).filter((i) => i !== ai && i !== vi);
    const f = agg === null || agg === undefined ? null : fn(agg);
    const groups: { key: Cell[]; cells: MValue[][] }[] = [];
    const byKey = new Map<string, number>();
    for (const row of tt.rows) {
      const key = keep.map((i) => force(row[i]!));
      const hk = key.map(hashKey).join("\u0001");
      let g = byKey.get(hk);
      if (g === undefined) {
        g = groups.length;
        byKey.set(hk, g);
        groups.push({ key, cells: values.map(() => []) });
      }
      const attr = toText(force(row[ai]!));
      const at = attr === null ? -1 : values.indexOf(attr);
      if (at >= 0) groups[g]!.cells[at]!.push(force(row[vi]!));
    }
    const rows = groups.map((g) => [
      ...g.key,
      ...g.cells.map((xs) => {
        if (f) return cell(() => ctx.call(f, [new MList(xs)]));
        // Several values for one cell is an error in that cell, not in the whole table.
        if (xs.length > 1) return cell(() => {
          throw new MError("Expression.Error", "There were too many elements in the enumeration to complete the operation.", new MList(xs));
        });
        return xs[0] ?? null;
      }),
    ]);
    return new MTable([...keep.map((i) => tt.columns[i]!), ...values], [...keep.map((i) => tt.types[i]!), ...values.map(() => T.any)], rows);
  });

  lib.def("Table.FillDown", "table, columns", ([t, c]) => fill(table(t!), c!, false));
  lib.def("Table.FillUp", "table, columns", ([t, c]) => fill(table(t!), c!, true));

  lib.def("Table.Combine", "tables, ?columns", ([ts, c]) => {
    const tables = list(ts!).values().map(table);
    const names: string[] = c === null ? [] : texts(c!);
    const types = new Map<string, MType>();
    if (c === null) {
      for (const tt of tables) {
        tt.columns.forEach((n, i) => {
          if (!types.has(n)) {
            names.push(n);
            types.set(n, tt.types[i]!);
          } else if (types.get(n)!.kind !== tt.types[i]!.kind) types.set(n, T.any);
        });
      }
    }
    const rows = tables.flatMap((tt) => tt.rows.map((r) => names.map((n) => (tt.index.has(n) ? r[tt.index.get(n)!]! : null))));
    return new MTable(names, names.map((n) => types.get(n) ?? T.any), rows);
  });
}

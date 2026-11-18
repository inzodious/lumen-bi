/**
 * Query folding. A navigation read (`Source{[Schema=…,Item=…]}[Data]`, a Firestore collection, …) is a
 * table whose rows are not read yet and that carries `fold` info. These steps, applied directly to such a
 * table, are pushed to the source instead of being evaluated locally (when the source can do them):
 *   Table.SelectColumns / Table.RemoveColumns → column list
 *   Table.SelectRows with a simple `each` predicate → filter (comparisons with constants, and/or/not,
 *       `= null`, List.Contains({…}, [c]), Text.StartsWith/EndsWith/Contains with a constant)
 *   Table.Sort by columns → ORDER BY (stable: earlier sort keys become tie-breakers, like M's stable sort)
 *   Table.Skip(n) → OFFSET, Table.FirstN(n) → TOP / LIMIT
 *   Table.NestedJoin of two reads of the same server and database, then Table.ExpandTableColumn of the joined
 *       column → one SELECT … FROM (left) JOIN (right) ON … (inner / left / right / full outer; null keys match
 *       like in M; the row order is the server's, as in Power BI's folded merges); later steps fold on top of it
 * Anything else (or anything after a non-foldable step) runs locally, exactly as before.
 * The predicate is kept as a structured `FoldPred`; each source renders it (SQL dialects: ./sqldialect.ts).
 * Like Power BI, folded text comparisons follow the server's collation.
 */
import type { Expr } from "../ast.ts";
import { MFunction, MList, MTable, MType, type FoldPred, type FoldSpec, type MValue } from "../values.ts";
import { DIALECTS, nullSafeEquals, TSQL, type SqlDialect, type SqlDialectName } from "./sqldialect.ts";
import type { Library } from "./util.ts";

/** Translates an `each` predicate to a structured filter, or undefined when it can't be folded. */
export function predicateToFilter(f: MFunction, columns: string[]): { pred: FoldPred; computed: boolean } | undefined {
  const origin = f.origin;
  if (!origin || f.params.length !== 1) return undefined;
  const fn = origin.expr as Extract<Expr, { t: "func" }>;
  const param = fn.params[0]!.name;
  const cols = new Set(columns);
  let computed = false;

  const column = (e: Expr): string | undefined => {
    if (e.t !== "field" || e.optional) return undefined;
    if (e.target && !(e.target.t === "ident" && e.target.name === param)) return undefined;
    if (!e.target && param !== "_") return undefined;
    return cols.has(e.name) ? e.name : undefined;
  };
  const mentionsRow = (e: unknown): boolean => {
    if (!e || typeof e !== "object") return false;
    if (Array.isArray(e)) return e.some(mentionsRow);
    const n = e as Expr;
    if (n.t === "field" && !n.target) return true;
    if (n.t === "project" && !n.target) return true;
    if (n.t === "ident" && n.name === param) return true;
    if (n.t === "func") return true; // conservative
    return Object.entries(n).some(([k, v]) => k !== "pos" && v && typeof v === "object" && mentionsRow(v));
  };
  /** Identifiers other than library constructors (#date, …) mean the value comes from another step / query. */
  const usesNames = (e: unknown): boolean => {
    if (!e || typeof e !== "object") return false;
    if (Array.isArray(e)) return e.some(usesNames);
    const n = e as Expr;
    if (n.t === "invoke" && n.callee.t === "ident" && n.callee.name.startsWith("#")) return n.args.some(usesNames);
    if (n.t === "ident") return true;
    return Object.entries(n).some(([k, v]) => k !== "pos" && v && typeof v === "object" && usesNames(v));
  };
  const constant = (e: Expr): MValue | undefined => {
    if (mentionsRow(e)) return undefined;
    try {
      const v = origin.evaluate(e);
      if (usesNames(e)) computed = true;
      return v;
    } catch {
      return undefined;
    }
  };
  const flip: Record<string, string> = { "=": "=", "<>": "<>", "<": ">", "<=": ">=", ">": "<", ">=": "<=" };
  const scalar = (v: MValue): boolean => v === null || typeof v !== "object" || !(v instanceof MList || v instanceof MTable || v instanceof MFunction);

  const tr = (e: Expr): FoldPred | undefined => {
    switch (e.t) {
      case "binary": {
        if (e.op === "and" || e.op === "or") {
          const a = tr(e.left);
          const b = tr(e.right);
          return a && b ? { op: e.op, left: a, right: b } : undefined;
        }
        if (!(e.op in flip)) return undefined;
        let col = column(e.left);
        let other = e.right;
        let op: string = e.op;
        if (!col) {
          col = column(e.right);
          other = e.left;
          op = flip[e.op]!;
        }
        if (!col) return undefined;
        const v = constant(other);
        if (v === undefined || !scalar(v)) return undefined;
        if (v === null) return op === "=" ? { op: "null", column: col, negate: false } : op === "<>" ? { op: "null", column: col, negate: true } : { op: "const", value: false };
        return { op: "cmp", column: col, cmp: op as "=", value: v };
      }
      case "unary": {
        if (e.op !== "not") return undefined;
        const a = tr(e.expr);
        return a ? { op: "not", expr: a } : undefined;
      }
      case "literal":
        return e.value === true || e.value === false ? { op: "const", value: e.value } : undefined;
      case "invoke": {
        if (e.callee.t !== "ident") return undefined;
        const name = e.callee.name;
        if (name === "List.Contains" && e.args.length === 2) {
          const col = column(e.args[1]!);
          const list = constant(e.args[0]!);
          if (!col || !(list instanceof MList)) return undefined;
          const vals = list.values();
          if (!vals.every(scalar)) return undefined;
          if (vals.length === 0) return { op: "const", value: false };
          return { op: "in", column: col, values: vals.filter((x) => x !== null), orNull: vals.some((x) => x === null) };
        }
        if ((name === "Text.StartsWith" || name === "Text.EndsWith" || name === "Text.Contains") && e.args.length === 2) {
          const col = column(e.args[0]!);
          const v = constant(e.args[1]!);
          if (!col || typeof v !== "string") return undefined;
          return { op: "like", column: col, mode: name === "Text.StartsWith" ? "starts" : name === "Text.EndsWith" ? "ends" : "contains", text: v };
        }
        return undefined;
      }
      default:
        return undefined;
    }
  };
  const pred = tr(fn.body);
  return pred ? { pred, computed } : undefined;
}

/** Renders a folded filter as a WHERE clause in a dialect; undefined when a value can't be expressed. */
export function renderPredicate(p: FoldPred, d: SqlDialect): string | undefined {
  switch (p.op) {
    case "and":
    case "or": {
      const a = renderPredicate(p.left, d);
      const b = renderPredicate(p.right, d);
      return a && b ? `(${a} ${p.op.toUpperCase()} ${b})` : undefined;
    }
    case "not": {
      const a = renderPredicate(p.expr, d);
      return a ? `NOT (${a})` : undefined;
    }
    case "const":
      return p.value ? "1 = 1" : "1 = 0";
    case "null":
      return `${d.ident(p.column)} IS ${p.negate ? "NOT " : ""}NULL`;
    case "cmp": {
      const c = d.ident(p.column);
      const lit = d.literal(p.value);
      if (lit === undefined) return undefined;
      // M: null <> "x" is true; SQL: NULL <> 'x' is unknown
      if (p.cmp === "<>") return `(${c} <> ${lit} OR ${c} IS NULL)`;
      return `${c} ${p.cmp} ${lit}`;
    }
    case "in": {
      const c = d.ident(p.column);
      const lits = p.values.map((v) => d.literal(v));
      if (lits.some((x) => x === undefined)) return undefined;
      const parts: string[] = [];
      if (lits.length) parts.push(`${c} IN (${lits.join(", ")})`);
      if (p.orNull) parts.push(`${c} IS NULL`);
      return parts.length === 1 ? parts[0] : `(${parts.join(" OR ")})`;
    }
    case "like":
      return d.like(d.ident(p.column), p.mode, p.text);
  }
}

/** Translates an `each` predicate to a WHERE clause (T-SQL by default), or undefined when it can't be folded. */
export function predicateToSql(f: MFunction, columns: string[], dialect: SqlDialect = TSQL): string | undefined {
  const r = predicateToFilter(f, columns);
  return r ? renderPredicate(r.pred, dialect) : undefined;
}

function folded(t: MTable, spec: FoldSpec, columns?: string[]): MTable {
  const src = t.fold!;
  const names = columns ?? t.columns;
  const types = names.map((n) => t.types[t.index.get(n)!]!);
  const out = new MTable(names, types, () => src.read(spec));
  out.fold = { ...src, spec };
  return out;
}

const canFold = (t: MValue): t is MTable => t instanceof MTable && !!t.fold && t.deferred;

/** Sort criteria made only of column names (with an optional Order) → keys; undefined otherwise. */
function sortCriteria(t: MTable, c: MValue): { column: string; desc: boolean }[] | undefined {
  const one = (x: MValue): { column: string; desc: boolean } | undefined => {
    if (typeof x === "string") return t.index.has(x) ? { column: x, desc: false } : undefined;
    if (!(x instanceof MList)) return undefined;
    const [name, order] = x.values();
    if (typeof name !== "string" || !t.index.has(name) || (order !== undefined && order !== 0 && order !== 1)) return undefined;
    return { column: name, desc: order === 1 };
  };
  if (typeof c === "string") return [one(c)!].filter(Boolean);
  if (!(c instanceof MList)) return undefined;
  const items = c.values();
  if (items.length === 2 && typeof items[0] === "string" && typeof items[1] === "number") {
    const k = one(c);
    return k ? [k] : undefined;
  }
  const keys = items.map(one);
  return keys.every((k) => k) && keys.length ? (keys as { column: string; desc: boolean }[]) : undefined;
}

/** Wraps the table functions with folding fast paths (call after installTable). */
export function installFolding(lib: Library): void {
  const wrap = (name: string, fast: (args: MValue[]) => MValue | undefined, applies: (t: MValue) => boolean = canFold) => {
    const orig = lib.entries.get(name);
    if (!(orig instanceof MFunction)) return;
    lib.entries.set(
      name,
      new MFunction(name, orig.params, (args) => {
        if (lib.ctx.host.folding && applies(args[0] ?? null)) {
          const r = fast(args);
          if (r !== undefined) return r;
        }
        return orig.impl(args);
      }),
    );
  };
  const caps = (t: MTable) => t.fold!.caps ?? {};
  // the unwrapped NestedJoin (a pending join that is not expanded right away evaluates locally)
  const nj = lib.entries.get("Table.NestedJoin");
  const localNestedJoin = nj instanceof MFunction ? (args: MValue[]) => nj.impl(args) : null;

  wrap("Table.SelectColumns", ([t, c, m]) => {
    const tt = t as MTable;
    if ((m !== undefined && m !== null) || caps(tt).columns === false) return undefined;
    const cols = typeof c === "string" ? [c] : c instanceof MList ? c.values() : null;
    if (!cols || !cols.every((x): x is string => typeof x === "string" && tt.index.has(x))) return undefined;
    if (new Set(cols).size !== cols.length) return undefined;
    return folded(tt, { ...tt.fold!.spec, columns: cols }, cols);
  });

  wrap("Table.RemoveColumns", ([t, c, m]) => {
    const tt = t as MTable;
    if ((m !== undefined && m !== null) || caps(tt).columns === false) return undefined;
    const cols = typeof c === "string" ? [c] : c instanceof MList ? c.values() : null;
    if (!cols || !cols.every((x): x is string => typeof x === "string" && tt.index.has(x))) return undefined;
    const keep = tt.columns.filter((x) => !cols.includes(x));
    if (!keep.length) return undefined;
    return folded(tt, { ...tt.fold!.spec, columns: keep }, keep);
  });

  wrap("Table.SelectRows", ([t, f]) => {
    const tt = t as MTable;
    const spec = tt.fold!.spec;
    if (!(f instanceof MFunction) || spec.top !== undefined || spec.skip) return undefined;
    const r = predicateToFilter(f, tt.columns);
    if (!r) return undefined;
    // privacy levels: values computed from other sources must not be sent to this one
    if (r.computed && lib.ctx.host.foldComputed === false) return undefined;
    const filter = caps(tt).filter;
    if (filter && !filter(r.pred)) return undefined;
    return folded(tt, { ...spec, filter: spec.filter ? { op: "and", left: spec.filter, right: r.pred } : r.pred, computed: spec.computed || r.computed || undefined });
  });

  wrap("Table.Sort", ([t, c]) => {
    const tt = t as MTable;
    const spec = tt.fold!.spec;
    if (spec.top !== undefined || spec.skip) return undefined;
    const keys = sortCriteria(tt, c ?? null);
    if (!keys) return undefined;
    const ob = caps(tt).orderBy;
    if (ob ? !ob(keys, spec) : caps(tt).sort === false) return undefined;
    const prev = (spec.orderBy ?? []).filter((p) => !keys.some((k) => k.column === p.column));
    return folded(tt, { ...spec, orderBy: [...keys, ...prev] });
  });

  wrap("Table.Skip", ([t, n]) => {
    const tt = t as MTable;
    const spec = tt.fold!.spec;
    const count = n === null || n === undefined ? 1 : n;
    if (typeof count !== "number" || !Number.isInteger(count) || count < 0 || caps(tt).skip === false) return undefined;
    if (!spec.orderBy?.length && !caps(tt).skip) return undefined;
    return folded(tt, { ...spec, skip: (spec.skip ?? 0) + count, top: spec.top === undefined ? undefined : Math.max(0, spec.top - count) });
  });

  wrap("Table.NestedJoin", (args) => {
    const [a, k1, b, k2, n, jk] = args;
    const left = a as MTable;
    if (!canFold(b ?? null) || !left.fold?.sql || !(b as MTable).fold?.sql) return undefined;
    const right = b as MTable;
    if (left.fold.sql!.key !== right.fold!.sql!.key || args[6] !== undefined && args[6] !== null) return undefined;
    const kind = jk === null || jk === undefined ? 1 : jk;
    if (typeof kind !== "number" || ![0, 1, 2, 3].includes(kind) || typeof n !== "string" || left.index.has(n)) return undefined;
    const d = DIALECTS[left.fold.sql!.dialect as SqlDialectName];
    // MySQL has no FULL OUTER JOIN; SQLite builds may lack RIGHT / FULL
    if (!d || (kind === 3 && d.name === "mysql") || (kind >= 2 && d.name === "sqlite")) return undefined;
    const keys = (k: MValue | undefined, t: MTable) => {
      const ks = typeof k === "string" ? [k] : k instanceof MList ? k.values() : null;
      return ks && ks.length && ks.every((x): x is string => typeof x === "string" && t.index.has(x)) ? ks : null;
    };
    const lk = keys(k1, left);
    const rk = keys(k2, right);
    if (!lk || !rk || lk.length !== rk.length) return undefined;
    const rowType = new MType("table", false, undefined, right.columns.map((c, i) => ({ name: c, type: right.types[i]!, optional: false })));
    // the local NestedJoin when the joined column is not expanded right away
    const out = new MTable([...left.columns, n], [...left.types, rowType], () => (localNestedJoin!(args) as MTable).rows);
    out.pendingJoin = { left, right, leftKeys: lk, rightKeys: rk, kind, column: n };
    return out;
  });

  wrap("Table.ExpandTableColumn", ([t, c, names, newNames]) => {
    const tt = t as MTable;
    const j = tt.pendingJoin;
    if (!j || c !== j.column) return undefined;
    const pick = names instanceof MList ? names.values() : typeof names === "string" ? [names] : null;
    if (!pick || !pick.every((p): p is string => typeof p === "string" && j.right.index.has(p))) return undefined;
    const renamed = newNames === null || newNames === undefined ? pick : newNames instanceof MList ? newNames.values() : null;
    if (!renamed || renamed.length !== pick.length || !renamed.every((x): x is string => typeof x === "string")) return undefined;
    const outNames = [...j.left.columns, ...renamed];
    if (new Set(outNames).size !== outNames.length) return undefined;
    const ls = j.left.fold!.sql!;
    const rs = j.right.fold!.sql!;
    const d = DIALECTS[ls.dialect as SqlDialectName]!;
    // an ORDER BY inside a joined subquery is meaningless (and invalid in T-SQL without TOP)
    const inner = (spec: FoldSpec): FoldSpec => (spec.top === undefined && !spec.skip ? { ...spec, orderBy: undefined } : spec);
    const L = d.ident("$l");
    const R = d.ident("$r");
    const cols = [...j.left.columns.map((x) => `${L}.${d.ident(x)} AS ${d.ident(x)}`), ...pick.map((p, i) => `${R}.${d.ident(p)} AS ${d.ident(renamed[i]!)}`)];
    const on = j.leftKeys.map((k, i) => nullSafeEquals(d, `${L}.${d.ident(k)}`, `${R}.${d.ident(j.rightKeys[i]!)}`)).join(" AND ");
    const lSql = ls.select(inner(j.left.fold!.spec));
    const rSql = rs.select(inner(j.right.fold!.spec));
    const kindSql = ["INNER JOIN", "LEFT OUTER JOIN", "RIGHT OUTER JOIN", "FULL OUTER JOIN"][j.kind]!;
    // a FULL JOIN on a null-safe condition isn't hash- or merge-joinable (PostgreSQL and SQL Server refuse it): the
    // left join plus the right rows without a match (DuckDB runs the FULL JOIN as is)
    const joinSql =
      j.kind === 3 && d.name !== "duckdb"
        ? `SELECT ${cols.join(", ")} FROM (${lSql}) AS ${L} LEFT OUTER JOIN (${rSql}) AS ${R} ON ${on} UNION ALL ` +
          `SELECT ${[...j.left.columns.map((x) => `NULL AS ${d.ident(x)}`), ...pick.map((p, i) => `${R}.${d.ident(p)} AS ${d.ident(renamed[i]!)}`)].join(", ")} FROM (${rSql}) AS ${R} ` +
          `WHERE NOT EXISTS (SELECT 1 FROM (${lSql}) AS ${L} WHERE ${on})`
        : `SELECT ${cols.join(", ")} FROM (${lSql}) AS ${L} ${kindSql} (${rSql}) AS ${R} ON ${on}`;
    const select = (spec: FoldSpec) =>
      d.select({ item: "", fromSql: joinSql, columns: spec.columns, where: spec.filter ? renderPredicate(spec.filter, d) : undefined, orderBy: spec.orderBy, skip: spec.skip, top: spec.top });
    const types = [...j.left.types, ...pick.map((p) => j.right.types[j.right.index.get(p)!]!)];
    const read = (spec: FoldSpec) => ls.run(select(spec));
    const out = new MTable(outNames, types, () => read({}));
    out.fold = {
      read,
      spec: {},
      columns: outNames,
      caps: { filter: (p) => renderPredicate(p, d) !== undefined, sort: true, skip: d.skipWithoutOrder },
      sql: { key: ls.key, dialect: ls.dialect, select, run: ls.run },
    };
    void rs;
    return out;
  }, (t) => t instanceof MTable && !!t.pendingJoin);

  wrap("Table.FirstN", ([t, n]) => {
    const tt = t as MTable;
    if (typeof n !== "number" || !Number.isInteger(n) || n < 0) return undefined;
    const prev = tt.fold!.spec.top;
    return folded(tt, { ...tt.fold!.spec, top: prev === undefined ? n : Math.min(prev, n) });
  });
}

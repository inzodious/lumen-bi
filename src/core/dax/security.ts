import { DaxError } from "./errors.ts";
import { Evaluator, type EvalOptions } from "./evaluator.ts";
import { FilterContext } from "./filters.ts";
import { checkFunctions } from "./functions.ts";
import { Model, type TableData } from "./model.ts";
import { parse } from "./parser.ts";
import { keyOf, type Scalar } from "./values.ts";

export interface TablePermission {
  table: string;
  /** A DAX boolean evaluated in each row's context, e.g. `[region] = "North"`. */
  filterExpression: string;
}

export interface SecurityRole {
  name: string;
  tablePermissions: TablePermission[];
}

export interface SecuredModel {
  model: Model;
  /** Rows each restricted table keeps, by table name, after propagation. */
  visibleRows: Map<string, number>;
}

function truthy(v: Scalar, where: string): boolean {
  if (v === null) return false;
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  throw new DaxError("TYPE", `The row-level security filter on ${where} returned the text '${String(v)}'. A table filter must return TRUE or FALSE for each row.`);
}

/**
 * Applies a role the way the service does for a user in it: each table permission keeps the rows where its filter is
 * true, and the restriction flows from the one side to the many side of active relationships (and back up a
 * relationship marked `securityFilteringBehavior: bothDirections`). Hidden rows are gone, so ALL and REMOVEFILTERS
 * can't bring them back. Calculated columns keep the values they got at refresh, before security.
 */
export function securedModel(model: Model, role: SecurityRole, options: EvalOptions = {}): SecuredModel {
  model.prepare();
  const ev = new Evaluator(model, options);
  const keep = new Map<TableData, boolean[]>();

  for (const p of role.tablePermissions) {
    const t = model.table(p.table);
    let ast;
    try {
      ast = parse(p.filterExpression);
      checkFunctions(ast);
    } catch (e) {
      if (e instanceof DaxError) throw new DaxError(e.code, `Role '${role.name}', table '${t.name}': ${e.message}`);
      throw e;
    }
    const values = ev.rowValues(t, ast, new FilterContext(model));
    const mask = values.map((v) => truthy(v, `'${t.name}' in role '${role.name}'`));
    const prior = keep.get(t);
    keep.set(t, prior ? prior.map((k, i) => k && mask[i]!) : mask);
  }

  const active = model.relationships.filter((r) => r.isActive);
  for (let changed = true; changed; ) {
    changed = false;
    for (const r of active) {
      const one = keep.get(r.to.table);
      if (one) {
        const allowed = new Set<string>();
        r.to.table.rows.forEach((row, i) => one[i] && allowed.add(keyOf(row[r.to.index] ?? null)));
        const many = keep.get(r.from.table) ?? r.from.table.rows.map(() => true);
        let hit = false;
        r.from.table.rows.forEach((row, i) => {
          if (many[i] && !allowed.has(keyOf(row[r.from.index] ?? null))) {
            many[i] = false;
            hit = true;
          }
        });
        if (hit || !keep.has(r.from.table)) {
          keep.set(r.from.table, many);
          changed ||= hit;
        }
      }
      const manyMask = keep.get(r.from.table);
      if (manyMask && r.securityFilteringBehavior === "both") {
        const present = new Set<string>();
        r.from.table.rows.forEach((row, i) => manyMask[i] && present.add(keyOf(row[r.from.index] ?? null)));
        const oneMask = keep.get(r.to.table) ?? r.to.table.rows.map(() => true);
        let hit = false;
        r.to.table.rows.forEach((row, i) => {
          if (oneMask[i] && !present.has(keyOf(row[r.to.index] ?? null))) {
            oneMask[i] = false;
            hit = true;
          }
        });
        if (hit || !keep.has(r.to.table)) {
          keep.set(r.to.table, oneMask);
          changed ||= hit;
        }
      }
    }
  }

  const out = new Model();
  const calcTables = new Set(model.calculationGroups.map((g) => g.table));
  const visibleRows = new Map<string, number>();
  for (const t of model.tables.values()) {
    if (calcTables.has(t)) continue;
    const mask = keep.get(t);
    const rows = mask ? t.rows.filter((_, i) => mask[i]) : t.rows;
    if (mask) visibleRows.set(t.name, rows.length);
    out.addTable(
      t.name,
      t.columns.map((c) => ({ name: c.name, dataType: c.dataType, isHidden: c.isHidden, ...(c.formatString ? { formatString: c.formatString } : {}) })),
      rows.map((r) => [...r]),
    );
  }
  for (const r of model.relationships) {
    out.addRelationship({
      id: r.id,
      fromColumn: { table: r.from.table.name, column: r.from.name },
      toColumn: { table: r.to.table.name, column: r.to.name },
      isActive: r.isActive,
      crossFilteringBehavior: r.crossFilteringBehavior,
      securityFilteringBehavior: r.securityFilteringBehavior,
      cardinality: r.cardinality,
    });
  }
  for (const t of model.tables.values()) {
    for (const c of t.columns) {
      if (c.sortBy) out.column({ table: t.name, column: c.name }).sortBy = out.column({ table: t.name, column: c.sortBy.name });
    }
  }
  if (model.dateTable) {
    const t = out.table(model.dateTable.table.name);
    out.dateTable = { table: t, column: t.column(model.dateTable.column.name)! };
  }
  for (const g of model.calculationGroups) {
    out.addCalculationGroup({ name: g.table.name, column: g.column.name, ordinalColumn: g.table.columns[1]?.name, precedence: g.precedence, items: g.items });
  }
  for (const m of model.measures.values()) out.measures.set(m.name.toLowerCase(), m);
  return { model: out, visibleRows };
}

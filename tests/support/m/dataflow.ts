import { quoteIdent, quoteLiteral, type Workspace } from "@parity/lakehouse";
import { errorInfo, evaluateSection, toJs, type ErrorInfo, type ParameterValue } from "../../../src/core/m/engine.ts";
import { MError } from "../../../src/core/m/errors.ts";
import type { MHost } from "../../../src/core/m/host.ts";
import { MTable, type MType } from "../../../src/core/m/values.ts";

export interface DataflowDestination {
  lakehouse: string;
  schema: string;
  table: string;
  /** Replace overwrites the table on every refresh; Append adds the rows. */
  method: "Replace" | "Append";
}

export interface DataflowQuery {
  name: string;
  /** The query's M expression, usually `let … in`. */
  code: string;
  destination?: DataflowDestination;
}

export interface DataflowQueryResult {
  name: string;
  ok: boolean;
  /** Rows written to the destination. */
  rows?: number;
  target?: string;
  error?: ErrorInfo;
}

const SQL_TYPE: Record<string, string> = {
  Int64: "BIGINT",
  Int32: "INTEGER",
  Int16: "SMALLINT",
  Int8: "TINYINT",
  Byte: "UTINYINT",
  Decimal: "DOUBLE",
  Currency: "DECIMAL(19,4)",
  Percentage: "DOUBLE",
  Double: "DOUBLE",
  Single: "DOUBLE",
};

function sqlType(t: MType, column: string, query: string): string {
  switch (t.kind) {
    case "number":
      return SQL_TYPE[t.facet ?? ""] ?? "DOUBLE";
    case "text":
      return "VARCHAR";
    case "logical":
      return "BOOLEAN";
    case "date":
      return "DATE";
    case "datetime":
    case "datetimezone":
      return "TIMESTAMP";
    case "time":
      return "TIME";
    default:
      throw new MError(
        "Expression.Error",
        `Column '${column}' of query '${query}' has type ${t.kind}, and a Lakehouse destination needs a type for every column. Set its type in a Changed Type step (Table.TransformColumnTypes).`,
      );
  }
}

function literal(v: unknown, type: string): string {
  if (v === null || v === undefined) return `CAST(NULL AS ${type})`;
  if (typeof v === "number" || typeof v === "boolean") return `CAST(${String(v)} AS ${type})`;
  return `CAST(${quoteLiteral(String(v))} AS ${type})`;
}

/** The query's rows as a SELECT, typed as the M columns are. */
function selectOf(t: MTable, query: string): string {
  t.columns.forEach((c) => {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(c)) {
      throw new MError("Expression.Error", `Column '${c}' of query '${query}' isn't a lakehouse-safe name, which is not supported in Parity yet for Lakehouse destinations. Rename it (Table.RenameColumns) to letters, digits and underscores.`);
    }
  });
  const types = t.columns.map((c, i) => sqlType(t.types[i]!, c, query));
  const rows = toJs(t) as Record<string, unknown>[];
  const cols = t.columns.map(quoteIdent).join(", ");
  if (rows.length === 0) return `SELECT ${t.columns.map((c, i) => `CAST(NULL AS ${types[i]}) AS ${quoteIdent(c)}`).join(", ")} WHERE false`;
  const values = rows.map((r, i) => {
    const cells = t.columns.map((c, k) => {
      const v = r[c];
      if (v && typeof v === "object") {
        if ("$error" in v) throw new MError("Expression.Error", `Row ${i + 1}, column '${c}' of query '${query}' holds an error: ${(v as { $error: ErrorInfo }).$error.message}`);
        throw new MError("Expression.Error", `Column '${c}' of query '${query}' holds nested values (a table, list or record). Expand it before writing to a Lakehouse destination.`);
      }
      return literal(v, types[k]!);
    });
    return `(${cells.join(", ")})`;
  });
  return `SELECT * FROM (VALUES ${values.join(", ")}) AS t(${cols})`;
}

/**
 * Refreshes a Dataflow Gen2: the queries are one section document, so they can reference each other, and every
 * query with a Lakehouse destination is written there (Replace overwrites, Append adds). One failing query is
 * reported and the others still write, as in a real refresh.
 */
export function refreshDataflow(ws: Workspace, host: MHost, queries: DataflowQuery[], parameters: Record<string, ParameterValue> = {}): DataflowQueryResult[] {
  const doc = `section Section1;\n\n${queries.map((q) => `shared ${/^[A-Za-z_][A-Za-z0-9_]*$/.test(q.name) ? q.name : `#"${q.name.replace(/"/g, '""')}"`} = ${q.code.trim()};`).join("\n\n")}\n`;
  const ev = evaluateSection(doc, host, { parameters, previewSteps: false });
  if (ev.error) return queries.map((q) => ({ name: q.name, ok: false, error: ev.error! }));
  return queries.map((q): DataflowQueryResult => {
    const r = ev.queries.find((x) => x.name === q.name);
    if (!r) return { name: q.name, ok: false, error: { reason: "Expression.Error", message: `The query '${q.name}' wasn't found in the dataflow.` } };
    if (!r.result.ok) return { name: q.name, ok: false, error: r.result.error };
    if (!q.destination) return { name: q.name, ok: true };
    const d = q.destination;
    const target = `${d.lakehouse}.${d.schema}.${d.table}`;
    try {
      if (!(r.result.value instanceof MTable)) throw new MError("Expression.Error", `The query '${q.name}' returns a ${r.result.kind}, and only a table can be written to a Lakehouse destination.`);
      if (!ws.listSchemas(d.lakehouse).includes(d.schema)) ws.createSchema(d.lakehouse, d.schema);
      const w = ws.saveAsTable(target, selectOf(r.result.value, q.name), { mode: d.method === "Append" ? "append" : "overwrite", overwriteSchema: d.method === "Replace" });
      return { name: q.name, ok: true, rows: w.numOutputRows, target };
    } catch (e) {
      return { name: q.name, ok: false, target, error: e instanceof MError ? errorInfo(e) : { reason: "DataSource.Error", message: e instanceof Error ? e.message : String(e) } };
    }
  });
}

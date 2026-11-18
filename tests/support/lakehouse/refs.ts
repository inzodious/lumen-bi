import { LakehouseError, type TableRef } from "./types.ts";

export function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

export function quoteLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function unwrap(part: string): string {
  const p = part.trim();
  if ((p.startsWith("`") && p.endsWith("`")) || (p.startsWith('"') && p.endsWith('"')) || (p.startsWith("[") && p.endsWith("]"))) {
    return p.slice(1, -1);
  }
  return p;
}

/**
 * Resolves `table`, `schema.table` or `lakehouse.schema.table` the way Fabric does:
 * a missing lakehouse is the default lakehouse, a missing schema is `dbo`.
 */
export function parseRef(ref: string, defaultLakehouse: string): TableRef {
  const parts = ref.split(".").map(unwrap);
  if (parts.some((p) => p === "")) throw new LakehouseError("INVALID_REF", `Invalid table reference: ${ref}`);
  const norm = parts.map((p) => p.toLowerCase());
  if (norm.length === 1) return { lakehouse: defaultLakehouse, schema: "dbo", table: norm[0]! };
  if (norm.length === 2) return { lakehouse: defaultLakehouse, schema: norm[0]!, table: norm[1]! };
  if (norm.length === 3) return { lakehouse: norm[0]!, schema: norm[1]!, table: norm[2]! };
  throw new LakehouseError("INVALID_REF", `Invalid table reference: ${ref}`);
}

export function refKey(ref: TableRef): string {
  return `${ref.lakehouse}.${ref.schema}.${ref.table}`;
}

export function sqlName(ref: TableRef): string {
  return `${quoteIdent(ref.lakehouse)}.${quoteIdent(ref.schema)}.${quoteIdent(ref.table)}`;
}

import { evaluate, evaluateScalar, type Model, type OutValue, type QuerySpec } from "../index.ts";

/** Grid as { "key1|key2": value }, with "TOTAL" for the grand total and "(Blank)" for blank keys. */
export function cells(model: Model, spec: QuerySpec): Record<string, OutValue> {
  const out: Record<string, OutValue> = {};
  for (const r of evaluate(model, spec).rows) {
    out[r.level === 0 ? "TOTAL" : r.keys.map((k) => (k === null ? "(Blank)" : String(k))).join("|")] = r.value;
  }
  return out;
}

export function scalar(model: Model, expression: string, filters: QuerySpec["filters"] = []): OutValue {
  return evaluateScalar(model, expression, filters);
}

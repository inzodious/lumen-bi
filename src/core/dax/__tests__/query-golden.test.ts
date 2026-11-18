import type { Workspace } from "@parity/lakehouse";
import { beforeAll, describe, expect, it } from "vitest";
import { evaluate, runQuery, type DaxResultTable, type Model, type OutValue, type SlicerFilter } from "../index.ts";
import { REF, starlane } from "./fixture.ts";
import { from } from "./oracle.ts";

// Differential tests for DAX queries: each query's result set is compared with an independent DuckDB SQL query over
// the same lakehouse tables, and SUMMARIZECOLUMNS with slicers passed as filter tables is compared with the visual
// grid (evaluate), which is SUMMARIZECOLUMNS plus totals.

let ws: Workspace;
let model: Model;

beforeAll(async () => {
  ({ ws, model } = await starlane());
  model.addMeasure({ name: "kpi_transmissions", expression: "COUNTROWS ( fact_transmissions )", formatString: "#,0" });
  model.addMeasure({ name: "kpi_duration_total", expression: "SUM ( fact_transmissions[duration_seconds] )" });
  model.addMeasure({ name: "kpi_resolved", expression: "CALCULATE ( [kpi_transmissions], USERELATIONSHIP ( fact_transmissions[resolved_date], dim_calendar[date] ) )" });
  model.addMeasure({ name: "kpi_avg_duration", expression: "AVERAGE ( fact_transmissions[duration_seconds] )" });
});

function close(a: OutValue, b: OutValue): boolean {
  if (typeof a === "number" && typeof b === "number") return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
  return a === b;
}

/** Rows as a multiset, numbers rounded so float noise doesn't split equal rows. */
function bag(rows: OutValue[][]): string[] {
  return rows.map((r) => JSON.stringify(r.map((v) => (typeof v === "number" ? Number(v.toPrecision(12)) : v)))).sort();
}

function sql(q: string): OutValue[][] {
  return ws.query(q).rows.map((r) => r.map((v) => (typeof v === "bigint" ? Number(v) : (v as OutValue))));
}

function dax(q: string): DaxResultTable {
  const r = runQuery(model, q);
  expect(r.results).toHaveLength(1);
  return r.results[0]!;
}

const lit = (v: OutValue) => (typeof v === "string" ? `"${v}"` : String(v));
const treatas = (s: SlicerFilter) => `TREATAS ( { ${s.values.map(lit).join(", ")} }, ${String(s.column)} )`;

describe("SUMMARIZECOLUMNS agrees with the SQL oracle", () => {
  it("two group-by tables and a year filter: GROUP BY over existing fact rows", () => {
    const t = dax(`EVALUATE
SUMMARIZECOLUMNS (
    dim_accounts[region],
    fact_transmissions[channel],
    TREATAS ( { 2026 }, dim_calendar[year] ),
    "Transmissions", [kpi_transmissions],
    "Duration", [kpi_duration_total]
)`);
    expect(t.columns.map((c) => c.name)).toEqual(["dim_accounts[region]", "fact_transmissions[channel]", "[Transmissions]", "[Duration]"]);
    const expected = sql(`SELECT a.region, f.channel, count(*)::INTEGER, sum(f.duration_seconds)::DOUBLE ${from()} WHERE c.year = 2026 GROUP BY ALL`);
    expect(expected.length).toBeGreaterThan(5);
    expect(bag(t.rows)).toEqual(bag(expected));
  });

  it("a filter on the fact reaches a dimension over the bidirectional product relationship", () => {
    const t = dax(`EVALUATE
SUMMARIZECOLUMNS (
    dim_products[product_name],
    TREATAS ( { "voice" }, fact_transmissions[channel] ),
    "Accounts", DISTINCTCOUNT ( fact_transmissions[account_id] ),
    "Products", COUNTROWS ( dim_products )
)`);
    const expected = sql(`SELECT p.product_name, count(DISTINCT f.account_id)::INTEGER, 1 ${from()} WHERE f.channel = 'voice' GROUP BY ALL`);
    expect(bag(t.rows)).toEqual(bag(expected));
  });

  it("an inactive relationship activated in a measure, by quarter, with the blank row for unresolved rows", () => {
    const t = dax(`EVALUATE
SUMMARIZECOLUMNS ( dim_calendar[year_quarter], "Resolved", [kpi_resolved] )`);
    // Unresolved transmissions have a blank resolved_date: they land on the calendar's blank row.
    const expected = sql(`SELECT c.year_quarter, count(*)::INTEGER FROM ${REF.fact} f LEFT JOIN ${REF.cal} c ON c.date = f.resolved_date GROUP BY ALL`);
    expect(expected.some((r) => r[0] === null)).toBe(true);
    expect(bag(t.rows)).toEqual(bag(expected));
  });
});

describe("ADDCOLUMNS, TOPN, SUMMARIZE and ORDER BY agree with the SQL oracle", () => {
  it("ADDCOLUMNS over VALUES keeps accounts with no transmissions, as blanks", () => {
    const t = dax(`EVALUATE
ADDCOLUMNS ( VALUES ( dim_accounts[account_name] ), "Transmissions", [kpi_transmissions], "Avg", [kpi_avg_duration] )`);
    const expected = sql(`SELECT a.account_name, NULLIF(count(f.transmission_id), 0)::INTEGER, avg(f.duration_seconds)::DOUBLE
FROM ${REF.acc} a LEFT JOIN ${REF.fact} f ON f.account_id = a.account_id GROUP BY ALL`);
    expect(expected.some((r) => r[1] === null)).toBe(true);
    expect(bag(t.rows)).toEqual(bag(expected));
  });

  it("TOPN matches rank() <= n, ties included", () => {
    for (const n of [1, 3, 5]) {
      const t = dax(`EVALUATE TOPN ( ${n}, VALUES ( dim_accounts[account_name] ), [kpi_transmissions] )`);
      const expected = sql(`SELECT account_name FROM (
  SELECT a.account_name, rank() OVER (ORDER BY count(f.transmission_id) DESC) AS r
  FROM ${REF.acc} a LEFT JOIN ${REF.fact} f ON f.account_id = a.account_id GROUP BY ALL
) WHERE r <= ${n}`);
      expect(bag(t.rows)).toEqual(bag(expected));
    }
    // By month within 2025, where several months tie on the count.
    const months = dax(`EVALUATE
CALCULATETABLE ( TOPN ( 4, VALUES ( dim_calendar[month] ), [kpi_transmissions], ASC ), dim_calendar[year] = 2025 )`);
    const expected = sql(`SELECT month FROM (
  SELECT c.month, rank() OVER (ORDER BY count(*)) AS r FROM ${REF.fact} f JOIN ${REF.cal} c ON c.date = f.opened_date WHERE c.year = 2025 GROUP BY ALL
) WHERE r <= 4`);
    expect(bag(months.rows)).toEqual(bag(expected));
  });

  it("SUMMARIZE lists the combinations present in the fact, over relationships", () => {
    const t = dax("EVALUATE SUMMARIZE ( fact_transmissions, dim_products[product_line], dim_calendar[year], fact_transmissions[channel] )");
    const expected = sql(`SELECT DISTINCT p.product_line, c.year, f.channel ${from()}`);
    expect(bag(t.rows)).toEqual(bag(expected));
  });

  it("ORDER BY matches SQL ORDER BY with a total order", () => {
    const t = dax(`EVALUATE
SUMMARIZECOLUMNS ( dim_accounts[account_name], "Transmissions", [kpi_transmissions] )
ORDER BY [Transmissions] DESC, dim_accounts[account_name]`);
    const expected = sql(`SELECT a.account_name, count(*)::INTEGER AS n ${from()} GROUP BY ALL ORDER BY n DESC, a.account_name`);
    expect(t.rows).toEqual(expected);
  });
});

describe("SUMMARIZECOLUMNS is the visual grid without totals", () => {
  const cases: { groupBy: string[]; measure: string; slicers: SlicerFilter[] }[] = [
    { groupBy: ["dim_accounts[region]", "fact_transmissions[channel]"], measure: "kpi_transmissions", slicers: [] },
    { groupBy: ["dim_calendar[year]", "dim_products[product_line]"], measure: "kpi_duration_total", slicers: [{ column: "fact_transmissions[channel]", values: ["relay", "beacon"] }] },
    { groupBy: ["dim_accounts[account_name]"], measure: "kpi_resolved", slicers: [{ column: "dim_accounts[region]", values: ["Core", "Rim"] }, { column: "dim_calendar[year]", values: [2025] }] },
    { groupBy: ["dim_products[product_name]", "dim_accounts[tier]"], measure: "kpi_avg_duration", slicers: [{ column: "dim_products[product_line]", values: ["freight"] }] },
  ];

  it.each(cases.map((c, i) => [i, c] as const))("case %i", (_i, c) => {
    const grid = evaluate(model, { measure: c.measure, groupBy: c.groupBy, filters: c.slicers });
    const q = `EVALUATE SUMMARIZECOLUMNS ( ${[...c.groupBy, ...c.slicers.map(treatas), `"v", [${c.measure}]`].join(", ")} )`;
    const t = dax(q);
    const want = grid.rows.map((r) => [...r.keys, r.value]);
    expect(want.length).toBeGreaterThan(2);
    expect(t.rows.length).toBe(want.length);
    const byKey = new Map(t.rows.map((r) => [JSON.stringify(r.slice(0, -1)), r[r.length - 1]!]));
    for (const w of want) expect(close(byKey.get(JSON.stringify(w.slice(0, -1))) ?? null, w[w.length - 1]!), JSON.stringify(w)).toBe(true);
  });
});

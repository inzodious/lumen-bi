import { describe, expect, it } from "vitest";
import { isDaxQuery, lintDaxQuery, Model, parseDaxQuery, runQuery, type DaxResultTable, type OutValue } from "../index.ts";

// Hand-verified micro-fixtures for DAX queries. Every expected result was worked out on paper from the rows below.
//
// dim_ship:   1 Vega  Core | 2 Orion Core | 3 Lyra Rim | 4 Nova Rim (no jumps)
// fact_jumps: ship 1 fuel 10 voice | ship 1 fuel 20 relay | ship 2 fuel 5 voice | ship 3 fuel (blank) relay
// With `orphan`, one more jump for ship 99 (fuel 7, beacon) has no ship, so dim_ship gets a blank row.

function fleet(orphan = false): Model {
  const m = new Model();
  m.addTable(
    "dim_ship",
    [
      { name: "ship_id", dataType: "int" },
      { name: "ship", dataType: "string" },
      { name: "region", dataType: "string" },
    ],
    [
      [1, "Vega", "Core"],
      [2, "Orion", "Core"],
      [3, "Lyra", "Rim"],
      [4, "Nova", "Rim"],
    ],
  );
  m.addTable(
    "fact_jumps",
    [
      { name: "ship_id", dataType: "int" },
      { name: "fuel", dataType: "int" },
      { name: "channel", dataType: "string" },
    ],
    [[1, 10, "voice"], [1, 20, "relay"], [2, 5, "voice"], [3, null, "relay"], ...(orphan ? [[99, 7, "beacon"]] : [])],
  );
  m.addRelationship({ fromColumn: "fact_jumps[ship_id]", toColumn: "dim_ship[ship_id]" });
  m.addMeasure({ name: "kpi_jumps", expression: "COUNTROWS ( fact_jumps )" });
  m.addMeasure({ name: "kpi_fuel", expression: "SUM ( fact_jumps[fuel] )" });
  m.addMeasure({ name: "kpi_jumps_plus_one", expression: "[kpi_jumps] + 1" });
  return m;
}

function one(model: Model, query: string): DaxResultTable {
  const r = runQuery(model, query);
  expect(r.results).toHaveLength(1);
  return r.results[0]!;
}

const names = (t: DaxResultTable) => t.columns.map((c) => c.name);
/** Rows as a set, for results without ORDER BY. */
const set = (rows: OutValue[][]) => rows.map((r) => JSON.stringify(r)).sort();

describe("Q1 SUMMARIZECOLUMNS", () => {
  it("names group-by columns table[column] and expressions [name], and drops rows where every expression is blank", () => {
    const t = one(fleet(), 'EVALUATE SUMMARIZECOLUMNS ( dim_ship[ship], "Jumps", [kpi_jumps] )');
    expect(names(t)).toEqual(["dim_ship[ship]", "[Jumps]"]);
    expect(t.columns.map((c) => c.dataType)).toEqual(["string", "int"]);
    // Nova has no jumps: its only expression is blank, so the row is dropped.
    expect(set(t.rows)).toEqual(set([["Lyra", 1], ["Orion", 1], ["Vega", 2]]));
    expect(t.ordered).toBe(false);
  });

  it("keeps a row when at least one expression is non-blank", () => {
    // Lyra's one jump has no fuel: Fuel is blank but Jumps is 1, so Lyra stays. Nova has neither.
    const t = one(fleet(), 'EVALUATE SUMMARIZECOLUMNS ( dim_ship[ship], "Jumps", [kpi_jumps], "Fuel", [kpi_fuel] )');
    expect(set(t.rows)).toEqual(set([["Lyra", 1, null], ["Orion", 1, 5], ["Vega", 2, 30]]));
    const fuelOnly = one(fleet(), 'EVALUATE SUMMARIZECOLUMNS ( dim_ship[ship], "Fuel", [kpi_fuel] )');
    expect(set(fuelOnly.rows)).toEqual(set([["Orion", 5], ["Vega", 30]]));
  });

  it("with no expressions returns every combination: auto-exist within a table, a cross join across tables", () => {
    expect(one(fleet(), "EVALUATE SUMMARIZECOLUMNS ( dim_ship[ship] )").rows).toHaveLength(4);
    // Same table: only the (region, ship) pairs that exist, 4 of the 2 x 4 possible.
    expect(one(fleet(), "EVALUATE SUMMARIZECOLUMNS ( dim_ship[region], dim_ship[ship] )").rows).toHaveLength(4);
    // Different tables: {Core, Rim} x {voice, relay} = 4, although no Rim ship used voice.
    expect(set(one(fleet(), "EVALUATE SUMMARIZECOLUMNS ( dim_ship[region], fact_jumps[channel] )").rows)).toEqual(
      set([["Core", "relay"], ["Core", "voice"], ["Rim", "relay"], ["Rim", "voice"]]),
    );
    // With a measure, Rim/voice (no jumps) is blank and dropped. Core/voice: Vega 1 + Orion 1 = 2.
    const t = one(fleet(), 'EVALUATE SUMMARIZECOLUMNS ( dim_ship[region], fact_jumps[channel], "Jumps", [kpi_jumps] )');
    expect(set(t.rows)).toEqual(set([["Core", "relay", 1], ["Core", "voice", 2], ["Rim", "relay", 1]]));
  });

  it("applies filter tables: TREATAS, FILTER, a VAR, and KEEPFILTERS against an outer CALCULATETABLE filter", () => {
    const voice = one(fleet(), 'EVALUATE SUMMARIZECOLUMNS ( dim_ship[ship], TREATAS ( { "voice" }, fact_jumps[channel] ), "Jumps", [kpi_jumps] )');
    expect(set(voice.rows)).toEqual(set([["Orion", 1], ["Vega", 1]]));
    // FILTER over fuel values: 10 and 20 are >= 10, both Vega's.
    const big = one(fleet(), 'EVALUATE SUMMARIZECOLUMNS ( dim_ship[ship], FILTER ( ALL ( fact_jumps[fuel] ), fact_jumps[fuel] >= 10 ), "Jumps", [kpi_jumps] )');
    expect(big.rows).toEqual([["Vega", 2]]);
    const viaVar = one(fleet(), 'DEFINE VAR Picked = TREATAS ( { "Vega", "Lyra" }, dim_ship[ship] ) EVALUATE SUMMARIZECOLUMNS ( dim_ship[region], Picked, "Jumps", [kpi_jumps] )');
    expect(set(viaVar.rows)).toEqual(set([["Core", 2], ["Rim", 1]]));
    // The outer filter keeps Vega only. A plain filter table overrides it ({Vega, Lyra}); KEEPFILTERS intersects (Vega).
    const outer = (arg: string) => `EVALUATE CALCULATETABLE ( SUMMARIZECOLUMNS ( dim_ship[region], ${arg}, "Jumps", [kpi_jumps] ), dim_ship[ship] = "Vega" )`;
    expect(set(one(fleet(), outer('TREATAS ( { "Vega", "Lyra" }, dim_ship[ship] )')).rows)).toEqual(set([["Core", 2], ["Rim", 1]]));
    expect(one(fleet(), outer('KEEPFILTERS ( TREATAS ( { "Vega", "Lyra" }, dim_ship[ship] ) )')).rows).toEqual([["Core", 2]]);
  });

  it("restores the filter tables for ALLSELECTED, like slicers in a visual", () => {
    // Selected: Vega (2 jumps) and Orion (1). ALLSELECTED over ship gives 3, so the shares are 2/3 and 1/3.
    const t = one(
      fleet(),
      'EVALUATE SUMMARIZECOLUMNS ( dim_ship[ship], TREATAS ( { "Vega", "Orion" }, dim_ship[ship] ), "Share", DIVIDE ( [kpi_jumps], CALCULATE ( [kpi_jumps], ALLSELECTED ( dim_ship[ship] ) ) ) )',
    );
    expect(set(t.rows)).toEqual(set([["Orion", 1 / 3], ["Vega", 2 / 3]]));
  });

  it("puts ISINSCOPE on the group-by columns", () => {
    const t = one(fleet(), 'EVALUATE SUMMARIZECOLUMNS ( dim_ship[region], "Region in scope", ISINSCOPE ( dim_ship[region] ), "Ship in scope", ISINSCOPE ( dim_ship[ship] ) )');
    expect(set(t.rows)).toEqual(set([["Core", true, false], ["Rim", true, false]]));
  });

  it("shows the blank row when facts have keys missing from the dimension", () => {
    // The orphan jump (ship 99) lands on the blank row of dim_ship: region blank, 1 jump.
    const t = one(fleet(true), 'EVALUATE SUMMARIZECOLUMNS ( dim_ship[region], "Jumps", [kpi_jumps] )');
    expect(set(t.rows)).toEqual(set([[null, 1], ["Core", 3], ["Rim", 1]]));
  });
});

describe("Q2 ADDCOLUMNS, SELECTCOLUMNS, ROW, DATATABLE", () => {
  it("ADDCOLUMNS evaluates in each row with context transition and keeps blank rows", () => {
    const t = one(fleet(), 'EVALUATE ADDCOLUMNS ( VALUES ( dim_ship[ship] ), "Jumps", [kpi_jumps], "Twice", [kpi_jumps] * 2 )');
    expect(names(t)).toEqual(["dim_ship[ship]", "[Jumps]", "[Twice]"]);
    // Nova stays, with blanks: ADDCOLUMNS doesn't drop rows. BLANK * 2 is BLANK.
    expect(set(t.rows)).toEqual(set([["Vega", 2, 4], ["Orion", 1, 2], ["Lyra", 1, 2], ["Nova", null, null]]));
    // VALUES includes the blank row when facts don't match; the blank row's jump count is the orphan's 1.
    expect(set(one(fleet(true), 'EVALUATE ADDCOLUMNS ( VALUES ( dim_ship[region] ), "Jumps", [kpi_jumps] )').rows)).toEqual(set([[null, 1], ["Core", 3], ["Rim", 1]]));
  });

  it("ADDCOLUMNS can refer to an earlier result column by name", () => {
    const t = one(fleet(), 'EVALUATE ADDCOLUMNS ( SUMMARIZECOLUMNS ( dim_ship[ship], "Jumps", [kpi_jumps] ), "Plus", [Jumps] + 100 )');
    expect(set(t.rows)).toEqual(set([["Lyra", 1, 101], ["Orion", 1, 101], ["Vega", 2, 102]]));
  });

  it("SELECTCOLUMNS renames with a name and keeps a bare column's name", () => {
    const t = one(fleet(), 'EVALUATE SELECTCOLUMNS ( dim_ship, "Name", dim_ship[ship], dim_ship[region] )');
    expect(names(t)).toEqual(["[Name]", "dim_ship[region]"]);
    expect(t.columns.map((c) => c.dataType)).toEqual(["string", "string"]);
    expect(t.rows).toHaveLength(4);
    // SELECTCOLUMNS keeps duplicates: four ships, two regions each twice.
    expect(one(fleet(), "EVALUATE SELECTCOLUMNS ( dim_ship, dim_ship[region] )").rows).toHaveLength(4);
  });

  it("ROW and DATATABLE build one-off tables", () => {
    const r = one(fleet(), 'EVALUATE ROW ( "Jumps", [kpi_jumps], "Fuel", [kpi_fuel] )');
    expect(names(r)).toEqual(["[Jumps]", "[Fuel]"]);
    expect(r.rows).toEqual([[4, 35]]);
    // Types follow the expression, not just the value: DIVIDE is a Double even when the quotient is whole.
    const typed = one(fleet(), 'EVALUATE ROW ( "Half", DIVIDE ( [kpi_jumps], 2 ), "Label", FORMAT ( [kpi_jumps], "0" ), "Big", [kpi_fuel] > 30 )');
    expect(typed.columns.map((c) => c.dataType)).toEqual(["double", "string", "boolean"]);
    expect(typed.rows).toEqual([[2, "4", true]]);
    const d = one(fleet(), 'EVALUATE DATATABLE ( "Ship", STRING, "Target", DOUBLE, "Since", DATETIME, { { "Vega", 2, "2026-01-01" }, { "Orion", 1.5, BLANK () } } )');
    expect(d.columns).toEqual([
      { name: "[Ship]", dataType: "string" },
      { name: "[Target]", dataType: "double" },
      { name: "[Since]", dataType: "date" },
    ]);
    expect(d.rows).toEqual([["Vega", 2, "2026-01-01"], ["Orion", 1.5, null]]);
  });

  it("a table constructor shows [Value] columns", () => {
    const t = one(fleet(), "EVALUATE { [kpi_jumps], [kpi_fuel] }");
    expect(names(t)).toEqual(["[Value]"]);
    expect(t.rows).toEqual([[4], [35]]);
  });
});

describe("Q3 TOPN, SUMMARIZE, set functions and joins", () => {
  it("TOPN keeps every row tied at the cut", () => {
    // Vega 2, then Orion 1 and Lyra 1 tie for second place: TOP 2 returns all three.
    expect(set(one(fleet(), "EVALUATE TOPN ( 1, VALUES ( dim_ship[ship] ), [kpi_jumps] )").rows)).toEqual(set([["Vega"]]));
    expect(one(fleet(), "EVALUATE TOPN ( 2, VALUES ( dim_ship[ship] ), [kpi_jumps] )").rows).toHaveLength(3);
    // A second sort key breaks the tie: Orion before Lyra, descending by name.
    expect(set(one(fleet(), "EVALUATE TOPN ( 2, VALUES ( dim_ship[ship] ), [kpi_jumps], DESC, dim_ship[ship], DESC )").rows)).toEqual(set([["Vega"], ["Orion"]]));
    expect(one(fleet(), "EVALUATE TOPN ( 0, VALUES ( dim_ship[ship] ), [kpi_jumps] )").rows).toEqual([]);
  });

  it("SUMMARIZE returns only combinations that exist in the table, through relationships", () => {
    // Core ships used voice and relay, Rim only relay: 3 rows (SUMMARIZECOLUMNS without measures gives 4).
    const t = one(fleet(), "EVALUATE SUMMARIZE ( fact_jumps, dim_ship[region], fact_jumps[channel] )");
    expect(names(t)).toEqual(["dim_ship[region]", "fact_jumps[channel]"]);
    expect(set(t.rows)).toEqual(set([["Core", "relay"], ["Core", "voice"], ["Rim", "relay"]]));
    // The orphan jump's ship is the blank row.
    expect(set(one(fleet(true), "EVALUATE SUMMARIZE ( fact_jumps, dim_ship[region] )").rows)).toEqual(set([[null], ["Core"], ["Rim"]]));
  });

  it("UNION, EXCEPT, INTERSECT, CROSSJOIN and GENERATE", () => {
    const u = one(fleet(), "EVALUATE UNION ( VALUES ( dim_ship[region] ), VALUES ( dim_ship[region] ) )");
    expect(u.rows).toHaveLength(4);
    // Regions minus the regions that used voice (Core): Rim.
    const used = 'CALCULATETABLE ( SUMMARIZE ( fact_jumps, dim_ship[region] ), fact_jumps[channel] = "voice" )';
    expect(one(fleet(), `EVALUATE EXCEPT ( VALUES ( dim_ship[region] ), ${used} )`).rows).toEqual([["Rim"]]);
    expect(one(fleet(), `EVALUATE INTERSECT ( VALUES ( dim_ship[region] ), ${used} )`).rows).toEqual([["Core"]]);
    const x = one(fleet(), "EVALUATE CROSSJOIN ( VALUES ( dim_ship[region] ), VALUES ( fact_jumps[channel] ) )");
    expect(names(x)).toEqual(["dim_ship[region]", "fact_jumps[channel]"]);
    expect(x.rows).toHaveLength(4);
    // For each region, its ships' TOP 1 by jumps: Core -> Vega (2), Rim -> Lyra (1; Nova has none, blank sorts last).
    const g = one(fleet(), "EVALUATE GENERATE ( VALUES ( dim_ship[region] ), TOPN ( 1, CALCULATETABLE ( VALUES ( dim_ship[ship] ) ), [kpi_jumps] ) )");
    expect(set(g.rows)).toEqual(set([["Core", "Vega"], ["Rim", "Lyra"]]));
  });

  it("the new table functions work inside measures too", () => {
    // Regions with at least one jump: Core and Rim.
    const t = one(fleet(), "EVALUATE { COUNTROWS ( SUMMARIZE ( fact_jumps, dim_ship[region] ) ) }");
    expect(t.rows).toEqual([[2]]);
    // The best ship's jumps: MAXX over TOPN 1.
    expect(one(fleet(), 'EVALUATE { MAXX ( TOPN ( 1, ADDCOLUMNS ( VALUES ( dim_ship[ship] ), "J", [kpi_jumps] ), [J] ), [J] ) }').rows).toEqual([[2]]);
  });
});

describe("Q4 DEFINE, ORDER BY, START AT and several EVALUATEs", () => {
  it("a query measure overrides the model's everywhere in the query, including in model measures that reference it", () => {
    const t = one(
      fleet(),
      `DEFINE
    MEASURE _measures_kpi[kpi_jumps] = COUNTROWS ( fact_jumps ) * 10
    MEASURE _measures_kpi[kpi_double] = [kpi_jumps] * 2
EVALUATE
    ROW ( "Jumps", [kpi_jumps], "Double", [kpi_double], "Plus one", [kpi_jumps_plus_one] )`,
    );
    // 4 jumps x 10 = 40; doubled 80; the model's kpi_jumps_plus_one now sees 40, so 41.
    expect(t.rows).toEqual([[40, 80, 41]]);
    // The model itself is unchanged.
    expect(one(fleet(), 'EVALUATE ROW ( "Jumps", [kpi_jumps] )').rows).toEqual([[4]]);
  });

  it("query variables are visible to EVALUATE and to query measures, and evaluate outside any filter", () => {
    const t = one(
      fleet(),
      `DEFINE
    VAR Threshold = 10
    VAR TotalJumps = [kpi_jumps]
    MEASURE _measures_kpi[kpi_big] = CALCULATE ( [kpi_jumps], fact_jumps[fuel] >= Threshold )
EVALUATE
    SUMMARIZECOLUMNS ( dim_ship[ship], "Big", [kpi_big], "Of all", DIVIDE ( [kpi_jumps], TotalJumps ) )`,
    );
    // Big jumps (fuel >= 10): Vega's two. TotalJumps is 4 in every row, because a query VAR ignores the row's filters.
    expect(set(t.rows)).toEqual(set([["Lyra", null, 0.25], ["Orion", null, 0.25], ["Vega", 2, 0.5]]));
  });

  it("ORDER BY sorts by result columns or expressions, ascending by default; START AT skips ahead", () => {
    const q = 'EVALUATE SUMMARIZECOLUMNS ( dim_ship[ship], "Jumps", [kpi_jumps] ) ORDER BY [Jumps] DESC, dim_ship[ship]';
    const t = one(fleet(), q);
    expect(t.ordered).toBe(true);
    expect(t.rows).toEqual([["Vega", 2], ["Lyra", 1], ["Orion", 1]]);
    // [kpi_jumps] here is the measure in each row's context: the same order.
    expect(one(fleet(), 'EVALUATE VALUES ( dim_ship[ship] ) ORDER BY [kpi_jumps] DESC, dim_ship[ship] ASC').rows).toEqual([["Vega"], ["Lyra"], ["Orion"], ["Nova"]]);
    expect(one(fleet(), "EVALUATE VALUES ( dim_ship[ship] ) ORDER BY dim_ship[ship] START AT \"O\"").rows).toEqual([["Orion"], ["Vega"]]);
    expect(one(fleet(), "EVALUATE VALUES ( dim_ship[ship] ) ORDER BY dim_ship[ship] DESC START AT \"O\"").rows).toEqual([["Nova"], ["Lyra"]]);
  });

  it("returns one result per EVALUATE", () => {
    const r = runQuery(fleet(), 'EVALUATE { 1 }\nEVALUATE ROW ( "Jumps", [kpi_jumps] )');
    expect(r.results.map((x) => x.rows)).toEqual([[[1]], [[4]]]);
  });

  it("parses keywords case-insensitively and knows a query from an expression", () => {
    expect(isDaxQuery("  evaluate { 1 }")).toBe(true);
    expect(isDaxQuery("-- a check\nDEFINE VAR X = 1 EVALUATE { X }")).toBe(true);
    expect(isDaxQuery("SUM ( fact_jumps[fuel] )")).toBe(false);
    const q = parseDaxQuery("define measure dim_ship[m] = 1 evaluate { [m] } order by [Value] desc");
    expect(q.definitions[0]).toMatchObject({ kind: "measure", table: "dim_ship", name: "m" });
    expect(q.evaluates[0]!.orderBy[0]!.desc).toBe(true);
  });
});

describe("Q5 errors say what Power BI says and what to do next", () => {
  const err = (q: string, model = fleet()) => {
    try {
      runQuery(model, q);
    } catch (e) {
      return (e as Error).message;
    }
    return "no error";
  };

  it("syntax", () => {
    expect(err("SUM ( fact_jumps[fuel] )")).toMatch(/starts with EVALUATE .*EVALUATE \{ <expression> \}/);
    expect(err("DEFINE MEASURE [m] = 1 EVALUATE { 1 }")).toMatch(/with its table, as table\[m\]/);
    expect(err("DEFINE VAR X = 1")).toMatch(/DEFINE must be followed by EVALUATE/);
    expect(err("EVALUATE { 1 } ORDER [Value]")).toMatch(/expected BY after ORDER/);
    expect(err("EVALUATE { 1 } START AT 1")).toMatch(/unexpected 'START'|START AT can only follow ORDER BY/);
  });

  it("a scalar EVALUATE", () => {
    expect(err("EVALUATE [kpi_jumps]")).toMatch(/is not a valid table expression\. To see a single value, wrap it in braces/);
  });

  it("refusals", () => {
    expect(err('EVALUATE SUMMARIZE ( fact_jumps, dim_ship[region], "Jumps", [kpi_jumps] )')).toMatch(/SUMMARIZE with extension columns .* is not supported in Parity yet\. .*ADDCOLUMNS/);
    expect(err("DEFINE COLUMN dim_ship[x] = 1 EVALUATE { 1 }")).toMatch(/DEFINE COLUMN .* is not supported in Parity yet\. Add the column in the EVALUATE with ADDCOLUMNS/);
    expect(err("DEFINE TABLE t = { 1 } EVALUATE t")).toMatch(/DEFINE TABLE .* not supported in Parity yet\. Use DEFINE VAR/);
    expect(err("EVALUATE FILTER ( VALUES ( dim_ship[ship] ), dim_ship[ship] = @Ship )")).toBe("Query parameters (@name) is not supported in Parity yet. Write the value into the query instead.");
    expect(err("EVALUATE NATURALLEFTOUTERJOIN ( dim_ship, fact_jumps )")).toMatch(/NATURALLEFTOUTERJOIN is not supported in Parity yet\. Add the related values/);
    expect(err('EVALUATE SUMMARIZECOLUMNS ( dim_ship[ship], fact_jumps[channel] = "voice", "Jumps", [kpi_jumps] )')).toMatch(/filter argument .* not supported in Parity yet\. Pass a table instead/);
    expect(err('EVALUATE SUMMARIZECOLUMNS ( dim_ship[ship], ROLLUPADDISSUBTOTAL ( dim_ship[ship], "T" ), "J", [kpi_jumps] )')).toMatch(/ROLLUPADDISSUBTOTAL is not supported in Parity yet/);
    expect(err('DEFINE MEASURE dim_ship[m] = COUNTROWS ( SUMMARIZECOLUMNS ( dim_ship[ship], "J", [kpi_jumps] ) ) EVALUATE { [m] }')).toMatch(/SUMMARIZECOLUMNS inside a measure.*not supported in Parity yet/);
  });

  it("naming and definition mistakes", () => {
    expect(err('EVALUATE ADDCOLUMNS ( VALUES ( dim_ship[ship] ), "J", 1, "J", 2 )')).toBe("Function 'ADDCOLUMNS' cannot add column [J] since it already exists.");
    expect(err("EVALUATE ADDCOLUMNS ( VALUES ( dim_ship[ship] ), J, 1 )")).toMatch(/expects a column name in double quotes as argument number 2/);
    expect(err("DEFINE MEASURE dim_ship[kpi_jumps] = 1 EVALUATE { [kpi_jumps] }")).toMatch(/already exists in table '_measures_kpi'\. To override it in the query, define it as MEASURE '_measures_kpi'\[kpi_jumps\]/);
    expect(err("DEFINE MEASURE nowhere[m] = 1 EVALUATE { [m] }")).toMatch(/Cannot find table 'nowhere'/);
    expect(err("DEFINE VAR dim_ship = 1 EVALUATE { 1 }")).toMatch(/already the name of a table/);
    expect(err('EVALUATE SUMMARIZECOLUMNS ( dim_ship[ship], [kpi_jumps] )')).toMatch(/Give \[kpi_jumps\] a column name .*"kpi_jumps", \[kpi_jumps\]/);
  });
});

describe("Q6 query lint", () => {
  it("runs the token rules over the text and the expression rules per expression", () => {
    const codes = (q: string) => lintDaxQuery(q).map((d) => d.code);
    expect(codes('EVALUATE\nSUMMARIZECOLUMNS ( dim_ship[ship], "Jumps", [kpi_jumps], "Twice", [kpi_jumps] * 2 )')).toEqual([]);
    expect(codes("EVALUATE\n{ [kpi_fuel] / [kpi_jumps] }")).toEqual(["DX-006"]);
    expect(codes("DEFINE\n    VAR total_jumps = [kpi_jumps]\nEVALUATE\n{ total_jumps }")).toEqual(["DX-002"]);
    expect(codes("-- check\nEVALUATE\n{ 1 }")).toEqual(["PB-007"]);
    expect(codes("EVALUATE {SUM(fact_jumps[fuel])}")).toEqual(["DX-001", "DX-001"]);
  });
});

import { describe, expect, it } from "vitest";
import { evaluate, Model } from "../index.ts";
import { cells, scalar } from "./helpers.ts";

// Hand-verified micro-fixtures: every expected value below was worked out on paper; the reasoning is next to it.

function blanksModel(): Model {
  const m = new Model();
  m.addTable(
    "sales",
    [
      { name: "id", dataType: "int" },
      { name: "store", dataType: "string" },
      { name: "amount", dataType: "double" },
    ],
    [
      [1, "A", 10],
      [2, "A", null],
      [3, "B", 5],
      [4, "B", null],
      [5, "C", null],
    ],
  );
  return m;
}

function shipsModel(orphan = false): Model {
  const m = new Model();
  m.addTable(
    "dim_ship",
    [
      { name: "ship_id", dataType: "int" },
      { name: "ship", dataType: "string" },
    ],
    [
      [1, "Vega"],
      [2, "Orion"],
      [3, "Lyra"],
    ],
  );
  m.addTable(
    "fact_jumps",
    [
      { name: "ship_id", dataType: "int" },
      { name: "fuel", dataType: "int" },
    ],
    [[1, 10], [1, 20], [2, 5], ...(orphan ? [[99, 7]] : [])],
  );
  m.addRelationship({ fromColumn: "fact_jumps[ship_id]", toColumn: "dim_ship[ship_id]" });
  m.addMeasure({ name: "kpi_jumps", expression: "COUNTROWS ( fact_jumps )" });
  return m;
}

function callsModel(): Model {
  const m = new Model();
  const rows: [number, string, string][] = [
    [1, "voice", "N"],
    [2, "voice", "N"],
    [3, "voice", "S"],
    [4, "relay", "N"],
    [5, "relay", "S"],
    [6, "relay", "S"],
    [7, "beacon", "N"],
    [8, "beacon", "N"],
    [9, "beacon", "N"],
    [10, "voice", "N"],
  ];
  m.addTable(
    "fact_calls",
    [
      { name: "id", dataType: "int" },
      { name: "channel", dataType: "string" },
      { name: "region", dataType: "string" },
    ],
    rows,
  );
  m.addMeasure({ name: "kpi_calls", expression: "COUNTROWS ( fact_calls )" });
  m.addMeasure({ name: "kpi_voice", expression: 'CALCULATE ( [kpi_calls], fact_calls[channel] = "voice" )' });
  m.addMeasure({ name: "kpi_voice_keep", expression: 'CALCULATE ( [kpi_calls], KEEPFILTERS ( fact_calls[channel] = "voice" ) )' });
  m.addMeasure({
    name: "kpi_channel_pct",
    expression: "VAR Denominator = CALCULATE ( [kpi_calls], ALLSELECTED ( fact_calls[channel] ) )\nRETURN\nDIVIDE ( [kpi_calls], Denominator )",
  });
  m.addMeasure({ name: "kpi_channel_pct_all", expression: "DIVIDE ( [kpi_calls], CALCULATE ( [kpi_calls], REMOVEFILTERS ( fact_calls[channel] ) ) )" });
  return m;
}

describe("M1 blanks in aggregation, arithmetic, comparison and DIVIDE", () => {
  it("aggregates skip blanks and a group of only blanks is dropped", () => {
    const m = blanksModel();
    // SUM: A = 10 + blank = 10, B = 5, C = only blank -> BLANK -> row dropped; total 15.
    expect(cells(m, { expression: "SUM ( sales[amount] )", groupBy: ["sales[store]"], includeTotals: true })).toEqual({ A: 10, B: 5, TOTAL: 15 });
    // AVERAGE ignores blanks: (10 + 5) / 2. COUNT counts non-blank values; COUNTROWS counts rows.
    expect(scalar(m, "AVERAGE ( sales[amount] )")).toBe(7.5);
    expect(scalar(m, "COUNT ( sales[amount] )")).toBe(2);
    expect(scalar(m, "COUNTROWS ( sales )")).toBe(5);
    // BLANK - 20 = -20, so store C appears; BLANK * 2 = BLANK, so it does not.
    expect(cells(m, { expression: "SUM ( sales[amount] ) - 20", groupBy: ["sales[store]"] })).toEqual({ A: -10, B: -15, C: -20 });
    expect(cells(m, { expression: "SUM ( sales[amount] ) * 2", groupBy: ["sales[store]"] })).toEqual({ A: 20, B: 10 });
    // DIVIDE with a blank denominator is BLANK (store C: blank / blank).
    expect(cells(m, { expression: "DIVIDE ( SUM ( sales[amount] ), COUNT ( sales[amount] ) )", groupBy: ["sales[store]"] })).toEqual({ A: 10, B: 5 });
  });

  it("follows the documented BLANK operator table", () => {
    const m = blanksModel();
    expect(scalar(m, "BLANK () + 5")).toBe(5);
    expect(scalar(m, "BLANK () - 5")).toBe(-5);
    expect(scalar(m, "BLANK () * 5")).toBe(null);
    expect(scalar(m, "5 / BLANK ()")).toBe(Infinity);
    expect(scalar(m, "0 / BLANK ()")).toBeNaN();
    expect(scalar(m, "BLANK () / BLANK ()")).toBe(null);
    expect(scalar(m, "-BLANK ()")).toBe(null);
    expect(scalar(m, "BLANK () = 0")).toBe(true);
    expect(scalar(m, 'BLANK () = ""')).toBe(true);
    expect(scalar(m, "BLANK () == 0")).toBe(false);
    expect(scalar(m, "BLANK () < 1")).toBe(true);
    expect(scalar(m, "TRUE () && BLANK ()")).toBe(false);
    expect(scalar(m, "TRUE () || BLANK ()")).toBe(true);
    expect(scalar(m, "FALSE () || BLANK ()")).toBe(false);
    expect(scalar(m, "BLANK () && BLANK ()")).toBe(null);
    expect(scalar(m, "NOT BLANK ()")).toBe(true);
    expect(scalar(m, 'IF ( BLANK (), "yes", "no" )')).toBe("no");
    expect(scalar(m, '"a" & BLANK ()')).toBe("a");
    expect(scalar(m, "DIVIDE ( 5, BLANK () )")).toBe(null);
    expect(scalar(m, "DIVIDE ( 5, 0, -1 )")).toBe(-1);
    expect(scalar(m, "DIVIDE ( BLANK (), 5 )")).toBe(null);
    expect(scalar(m, "COALESCE ( BLANK (), BLANK (), 3 )")).toBe(3);
    expect(scalar(m, "MIN ( 1, BLANK () )")).toBe(0);
    expect(scalar(m, '"abc" = "ABC"')).toBe(true);
    expect(() => scalar(m, '1 = "1"')).toThrow(
      "DAX comparison operations do not support comparing values of type Integer with values of type Text. Consider using the VALUE or FORMAT function to convert one of the values.",
    );
  });
});

describe("M2 row context and context transition", () => {
  it("only CALCULATE or a measure reference turns the row into a filter", () => {
    const m = shipsModel();
    // No transition: COUNTROWS sees all 3 jumps on each of the 3 ship rows -> 3 * 3.
    expect(scalar(m, "SUMX ( dim_ship, COUNTROWS ( fact_jumps ) )")).toBe(9);
    // Transition: Vega 2 + Orion 1 + Lyra blank = 3, with CALCULATE or with the measure.
    expect(scalar(m, "SUMX ( dim_ship, CALCULATE ( COUNTROWS ( fact_jumps ) ) )")).toBe(3);
    expect(scalar(m, "SUMX ( dim_ship, [kpi_jumps] )")).toBe(3);
    // AVERAGEX ignores Lyra's blank: (2 + 1) / 2.
    expect(scalar(m, "AVERAGEX ( dim_ship, [kpi_jumps] )")).toBe(1.5);
    // Inside CALCULATE ( ..., ALL ( dim_ship ) ) the measure sees every ship: 3 rows * 3 jumps.
    expect(scalar(m, "SUMX ( dim_ship, CALCULATE ( [kpi_jumps], ALL ( dim_ship ) ) )")).toBe(9);
    // In a grid the outer filter keeps one ship per row; Lyra has no jumps so its row is dropped.
    expect(cells(m, { expression: "SUMX ( dim_ship, [kpi_jumps] )", groupBy: ["dim_ship[ship]"], includeTotals: true })).toEqual({
      Orion: 1,
      Vega: 2,
      TOTAL: 3,
    });
  });

  it("transition over duplicate rows counts each duplicate once per row", () => {
    const m = new Model();
    m.addTable(
      "fuel_log",
      [
        { name: "ship", dataType: "string" },
        { name: "liters", dataType: "int" },
      ],
      [
        ["Vega", 10],
        ["Vega", 10],
        ["Orion", 5],
      ],
    );
    // Row values are 10 + 10 + 5 = 25 without transition.
    expect(scalar(m, "SUMX ( fuel_log, fuel_log[liters] )")).toBe(25);
    // Each Vega row filters ship=Vega, liters=10, which both duplicates satisfy: 20 + 20 + 5.
    expect(scalar(m, "SUMX ( fuel_log, CALCULATE ( SUM ( fuel_log[liters] ) ) )")).toBe(45);
  });
});

describe("M3 ALLSELECTED under multiple slicers", () => {
  it("restores the slicer selection on the column, not the whole table", () => {
    const m = callsModel();
    const filters = [
      { column: "fact_calls[channel]", values: ["voice", "relay"] },
      { column: "fact_calls[region]", values: ["N"] },
    ];
    // Region N and voice/relay: voice = ids 1, 2, 10 (3), relay = id 4 (1). Denominator restores both channels: 4.
    expect(cells(m, { measure: "kpi_channel_pct", groupBy: ["fact_calls[channel]"], filters, includeTotals: true })).toEqual({
      relay: 0.25,
      voice: 0.75,
      TOTAL: 1,
    });
    // REMOVEFILTERS ignores the channel slicer too: region N has 7 calls in all channels.
    expect(cells(m, { measure: "kpi_channel_pct_all", groupBy: ["fact_calls[channel]"], filters, includeTotals: true })).toEqual({
      relay: 1 / 7,
      voice: 3 / 7,
      TOTAL: 4 / 7,
    });
  });

  it("keeps the other group-by column's filter and removes only the channel's", () => {
    const m = callsModel();
    const filters = [{ column: "fact_calls[channel]", values: ["voice", "relay"] }];
    // (voice, N) = 3 / (voice+relay in N = 4); (voice, S) = 1 / (1 + 2); (relay, N) = 1 / 4; (relay, S) = 2 / 3.
    // Subtotal voice (region not in scope) = 4 / 7; relay = 3 / 7; total 7 / 7.
    expect(cells(m, { measure: "kpi_channel_pct", groupBy: ["fact_calls[channel]", "fact_calls[region]"], filters, includeTotals: true })).toEqual({
      "relay|N": 0.25,
      "relay|S": 2 / 3,
      relay: 3 / 7,
      "voice|N": 0.75,
      "voice|S": 1 / 3,
      voice: 4 / 7,
      TOTAL: 1,
    });
  });
});

describe("M4 bidirectional filtering", () => {
  function tripsModel(): Model {
    const m = new Model();
    m.addTable(
      "dim_crew",
      [
        { name: "crew_id", dataType: "int" },
        { name: "name", dataType: "string" },
      ],
      [
        [1, "Ada"],
        [2, "Bo"],
        [3, "Cy"],
      ],
    );
    m.addTable(
      "dim_route",
      [
        { name: "route_id", dataType: "int" },
        { name: "route", dataType: "string" },
      ],
      [
        [10, "Mars"],
        [20, "Titan"],
        [30, "Io"],
      ],
    );
    m.addTable(
      "fact_trip",
      [
        { name: "crew_id", dataType: "int" },
        { name: "route_id", dataType: "int" },
      ],
      [
        [1, 10],
        [1, 20],
        [2, 10],
      ],
    );
    m.addRelationship({ fromColumn: "fact_trip[crew_id]", toColumn: "dim_crew[crew_id]" });
    m.addRelationship({ fromColumn: "fact_trip[route_id]", toColumn: "dim_route[route_id]", crossFilteringBehavior: "bothDirections" });
    return m;
  }

  it("a crew filter reaches routes through the fact table", () => {
    const m = tripsModel();
    const routes = "DISTINCTCOUNT ( dim_route[route_id] )";
    // Ada flew Mars and Titan; Bo only Mars; Cy flew nothing, so the routes are filtered to nothing (BLANK).
    expect(scalar(m, routes, [{ column: "dim_crew[name]", values: ["Ada"] }])).toBe(2);
    expect(scalar(m, routes, [{ column: "dim_crew[name]", values: ["Bo"] }])).toBe(1);
    expect(scalar(m, routes, [{ column: "dim_crew[name]", values: ["Cy"] }])).toBe(null);
    // With no filter at all, routes are not filtered: Io counts even without trips.
    expect(scalar(m, routes)).toBe(3);
    // The crew relationship is single-direction: a route filter does not reach crews.
    expect(scalar(m, "COUNTROWS ( dim_crew )", [{ column: "dim_route[route]", values: ["Mars"] }])).toBe(3);
    // ...unless CROSSFILTER makes it BOTH: Mars was flown by Ada and Bo.
    expect(scalar(m, "CALCULATE ( COUNTROWS ( dim_crew ), CROSSFILTER ( fact_trip[crew_id], dim_crew[crew_id], BOTH ) )", [{ column: "dim_route[route]", values: ["Mars"] }])).toBe(2);
    // CROSSFILTER ONEWAY turns the bidirectional relationship back into one-way: all 3 routes.
    expect(scalar(m, "CALCULATE ( DISTINCTCOUNT ( dim_route[route_id] ), CROSSFILTER ( fact_trip[route_id], dim_route[route_id], ONEWAY ) )", [{ column: "dim_crew[name]", values: ["Ada"] }])).toBe(3);
  });

  it("group-by values of the bidirectional dimension follow the other slicers", () => {
    const m = tripsModel();
    // Even a measure that is never blank only gets Mars and Titan rows under Ada: the route values are filtered.
    expect(cells(m, { expression: '"x"', groupBy: ["dim_route[route]"], filters: [{ column: "dim_crew[name]", values: ["Ada"] }], includeTotals: true })).toEqual({
      Mars: "x",
      Titan: "x",
      TOTAL: "x",
    });
  });
});

describe("M5 inactive relationship and USERELATIONSHIP", () => {
  function ticketsModel(): Model {
    const m = new Model();
    m.addTable(
      "cal",
      [{ name: "date", dataType: "date" }],
      ["2026-01-01", "2026-01-02", "2026-01-03", "2026-01-04", "2026-01-05"].map((d) => [d]),
    );
    m.markAsDateTable("cal", "date");
    m.addTable(
      "tickets",
      [
        { name: "id", dataType: "int" },
        { name: "opened", dataType: "date" },
        { name: "closed", dataType: "date" },
      ],
      [
        [1, "2026-01-01", "2026-01-02"],
        [2, "2026-01-01", null],
        [3, "2026-01-02", "2026-01-04"],
        [4, "2026-01-03", "2026-01-04"],
      ],
    );
    m.addRelationship({ fromColumn: "tickets[opened]", toColumn: "cal[date]" });
    m.addRelationship({ fromColumn: "tickets[closed]", toColumn: "cal[date]", isActive: false });
    m.addMeasure({ name: "kpi_opened", expression: "COUNTROWS ( tickets )" });
    m.addMeasure({ name: "kpi_closed", expression: "CALCULATE ( [kpi_opened], USERELATIONSHIP ( tickets[closed], cal[date] ) )" });
    m.addMeasure({
      name: "kpi_closed_nb",
      expression: "CALCULATE ( [kpi_opened], USERELATIONSHIP ( tickets[closed], cal[date] ), NOT ISBLANK ( tickets[closed] ) )",
    });
    return m;
  }

  it("counts by the active date, or by the inactive one when asked", () => {
    const m = ticketsModel();
    const g = { groupBy: ["cal[date]"], includeTotals: true };
    // Opened: Jan 1 has tickets 1, 2; Jan 2 ticket 3; Jan 3 ticket 4.
    expect(cells(m, { measure: "kpi_opened", ...g })).toEqual({ "2026-01-01": 2, "2026-01-02": 1, "2026-01-03": 1, TOTAL: 4 });
    // Closed: Jan 2 ticket 1; Jan 4 tickets 3, 4; ticket 2 has no close date so it lands on the blank member.
    expect(cells(m, { measure: "kpi_closed", ...g })).toEqual({ "(Blank)": 1, "2026-01-02": 1, "2026-01-04": 2, TOTAL: 4 });
    // Excluding blank close dates removes the blank member and one ticket from the total.
    expect(cells(m, { measure: "kpi_closed_nb", ...g })).toEqual({ "2026-01-02": 1, "2026-01-04": 2, TOTAL: 3 });
  });
});

describe("M6 boolean filters replace, KEEPFILTERS intersects", () => {
  it("shows the difference per channel", () => {
    const m = callsModel();
    const g = { groupBy: ["fact_calls[channel]"], includeTotals: true };
    // The boolean filter replaces the row's channel filter: every row shows the 4 voice calls.
    expect(cells(m, { measure: "kpi_voice", ...g })).toEqual({ beacon: 4, relay: 4, voice: 4, TOTAL: 4 });
    // KEEPFILTERS intersects: beacon and relay become empty (BLANK, dropped).
    expect(cells(m, { measure: "kpi_voice_keep", ...g })).toEqual({ voice: 4, TOTAL: 4 });
    // Two columns of one table in one predicate: voice in region N = ids 1, 2, 10.
    expect(scalar(m, 'CALCULATE ( [kpi_calls], fact_calls[channel] = "voice" && fact_calls[region] = "N" )')).toBe(3);
    expect(() => scalar(m, "CALCULATE ( [kpi_calls], 1 = 1 )")).toThrow(/does not specify a column/);
  });
});

describe("M7 ALL on an expanded table and table filters", () => {
  it("ALL ( fact ) also removes filters on the dimensions it relates to", () => {
    const m = shipsModel();
    const g = { groupBy: ["dim_ship[ship]"], includeTotals: true };
    // fact_jumps' expanded table contains dim_ship, so the ship filter is removed: 3 everywhere, even Lyra.
    expect(cells(m, { expression: "CALCULATE ( [kpi_jumps], ALL ( fact_jumps ) )", ...g })).toEqual({ Lyra: 3, Orion: 3, Vega: 3, TOTAL: 3 });
    // ALL on a fact column keeps the ship filter.
    expect(cells(m, { expression: "CALCULATE ( [kpi_jumps], ALL ( fact_jumps[fuel] ) )", ...g })).toEqual({ Orion: 1, Vega: 2, TOTAL: 3 });
    // A table filter on the fact filters the dimension through the expanded table: 2 ships have jumps.
    expect(scalar(m, "CALCULATE ( COUNTROWS ( dim_ship ), fact_jumps )")).toBe(2);
    // Only Vega has jumps with fuel > 8.
    expect(scalar(m, "CALCULATE ( COUNTROWS ( dim_ship ), FILTER ( fact_jumps, fact_jumps[fuel] > 8 ) )")).toBe(1);
    // FILTER ( ALL ( fact ) ) overrides the ship filter (its rows carry dim_ship's columns): Vega's 2 jumps on every row.
    expect(cells(m, { expression: "CALCULATE ( [kpi_jumps], FILTER ( ALL ( fact_jumps ), fact_jumps[fuel] >= 10 ) )", ...g })).toEqual({
      Lyra: 2,
      Orion: 2,
      Vega: 2,
      TOTAL: 2,
    });
  });
});

describe("M8 TREATAS + CROSSFILTER NONE descendant roll-up", () => {
  function orgModel(): Model {
    const m = new Model();
    m.addTable(
      "dim_org",
      [
        { name: "org_id", dataType: "int" },
        { name: "org", dataType: "string" },
        { name: "parent_id", dataType: "int" },
        { name: "grandparent_id", dataType: "int" },
      ],
      [
        [1, "Starlane", null, null],
        [2, "Freight", 1, null],
        [3, "Passenger", 1, null],
        [4, "Cargo Bay 7", 2, 1],
      ],
    );
    m.addTable("fact_ops", [{ name: "org_id", dataType: "int" }], [[1], [2], [3], [3], [4], [4]]);
    m.addRelationship({ fromColumn: "fact_ops[org_id]", toColumn: "dim_org[org_id]" });
    m.addMeasure({ name: "kpi_ops", expression: "COUNTROWS ( fact_ops )" });
    const ids = `VAR ContextIDs = VALUES ( dim_org[org_id] )
VAR ValidIDs =
    DISTINCT (
        UNION (
            ContextIDs,
            CALCULATETABLE ( VALUES ( dim_org[org_id] ), REMOVEFILTERS ( dim_org ), TREATAS ( ContextIDs, dim_org[parent_id] ) ),
            CALCULATETABLE ( VALUES ( dim_org[org_id] ), REMOVEFILTERS ( dim_org ), TREATAS ( ContextIDs, dim_org[grandparent_id] ) )
        )
    )
RETURN
`;
    m.addMeasure({ name: "kpi_ops_agg", expression: `${ids}CALCULATE ( [kpi_ops], CROSSFILTER ( dim_org[org_id], fact_ops[org_id], NONE ), TREATAS ( ValidIDs, fact_ops[org_id] ) )` });
    m.addMeasure({ name: "kpi_ops_agg_no_cf", expression: `${ids}CALCULATE ( [kpi_ops], TREATAS ( ValidIDs, fact_ops[org_id] ) )` });
    return m;
  }

  it("rolls each org up over its descendants", () => {
    const m = orgModel();
    // Rows per org: 1 -> 1, 2 -> 1, 3 -> 2, 4 -> 2.
    // Starlane = {1} + children {2, 3} + grandchildren {4} = 6; Freight = {2} + child {4} = 3; Passenger = 2; Cargo Bay 7 = 2.
    expect(cells(m, { measure: "kpi_ops_agg", groupBy: ["dim_org[org]"], includeTotals: true })).toEqual({
      "Cargo Bay 7": 2,
      Freight: 3,
      Passenger: 2,
      Starlane: 6,
      TOTAL: 6,
    });
    // Freight + Passenger selected: {2, 3} + child {4} = 1 + 2 + 2.
    expect(scalar(m, "[kpi_ops_agg]", [{ column: "dim_org[org]", values: ["Freight", "Passenger"] }])).toBe(5);
    // Without CROSSFILTER NONE the org filter still reaches the fact, so Freight only keeps its own row.
    expect(scalar(m, "[kpi_ops_agg_no_cf]", [{ column: "dim_org[org]", values: ["Freight"] }])).toBe(1);
  });
});

function salesTiModel(sideways = false, mark = true): Model {
  const m = new Model();
  const dates: [string, number, string][] = [];
  for (let d = Date.UTC(2025, 0, 1); d <= Date.UTC(2026, 11, 31); d += 86_400_000) {
    const x = new Date(d);
    const me = new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + 1, 0));
    dates.push([x.toISOString().slice(0, 10), x.getUTCFullYear(), me.toISOString().slice(0, 10)]);
  }
  m.addTable(
    "cal2",
    [
      { name: "date", dataType: "date" },
      { name: "year", dataType: "int" },
      { name: "month_end", dataType: "date" },
    ],
    dates,
  );
  if (mark) m.markAsDateTable("cal2", "date");
  m.addTable(
    "sales2",
    [
      { name: "date", dataType: "date" },
      { name: "amount", dataType: "int" },
    ],
    [
      ["2025-01-10", 100],
      ["2025-03-31", 50],
      ["2025-04-15", 20],
      ["2025-06-15", 40],
      ["2026-01-05", 10],
      ["2026-03-31", 7],
      ["2026-04-30", 3],
    ],
  );
  m.addRelationship({ fromColumn: "sales2[date]", toColumn: "cal2[date]" });
  m.addMeasure({ name: "kpi_amount", expression: "SUM ( sales2[amount] )", formatString: "#,0" });
  m.addMeasure({ name: "kpi_amount_x2", expression: "[kpi_amount] * 2" });
  m.addCalculationGroup({
    name: "cg_time",
    column: "time_calculation",
    precedence: 10,
    items: [
      { name: "Current", expression: "SELECTEDMEASURE ()" },
      { name: "PY", expression: "CALCULATE ( SELECTEDMEASURE (), SAMEPERIODLASTYEAR ( cal2[date] ) )" },
      {
        name: "YoY",
        expression: "VAR Current_ = SELECTEDMEASURE ()\nVAR Prior = CALCULATE ( SELECTEDMEASURE (), SAMEPERIODLASTYEAR ( cal2[date] ) )\nRETURN\nIF ( NOT ISBLANK ( Current_ ) && NOT ISBLANK ( Prior ), Current_ - Prior )",
      },
      {
        name: "YoY %",
        expression: "VAR Current_ = SELECTEDMEASURE ()\nVAR Prior = CALCULATE ( SELECTEDMEASURE (), SAMEPERIODLASTYEAR ( cal2[date] ) )\nRETURN\nDIVIDE ( Current_ - Prior, Prior )",
        formatStringDefinition: '"0.0%;-0.0%;0.0%"',
      },
      ...(sideways
        ? [
            { name: "YTD", expression: "CALCULATE ( SELECTEDMEASURE (), DATESYTD ( cal2[date] ) )" },
            { name: "PY YTD", expression: 'CALCULATE ( SELECTEDMEASURE (), SAMEPERIODLASTYEAR ( cal2[date] ), cg_time[time_calculation] = "YTD" )' },
            { name: "Loop", expression: 'CALCULATE ( SELECTEDMEASURE (), cg_time[time_calculation] = "Loop2" )' },
            { name: "Loop2", expression: 'CALCULATE ( SELECTEDMEASURE (), cg_time[time_calculation] = "Loop" )' },
          ]
        : []),
    ],
  });
  return m;
}

describe("M21 an unmarked calendar related on a date column", () => {
  it("still clears the month filter under DATESYTD, because the relationship key is date-typed", () => {
    const m = salesTiModel(false, false);
    // Same numbers as the marked table: YTD at Mar 2025 = 100 + 50.
    expect(cells(m, { expression: "CALCULATE ( [kpi_amount], DATESYTD ( cal2[date] ) )", groupBy: ["cal2[month_end]"] })["2025-03-31"]).toBe(150);
  });
});

describe("M20 sideways recursion in calculation groups (Microsoft Learn's PY YTD example)", () => {
  it("an item that filters its group to another item applies that item; an item reaching itself is an error", () => {
    const m = salesTiModel(true);
    const byItem = (item: string) => cells(m, { measure: "kpi_amount", groupBy: ["cal2[month_end]"], filters: [{ column: "cg_time[time_calculation]", values: [item] }] });
    // PY YTD at Apr 2026 = YTD of Apr 2025 = Jan 100 + Mar 50 + Apr 20 = 170; plain PY would be 20.
    expect(byItem("PY YTD")["2026-04-30"]).toBe(170);
    expect(byItem("PY")["2026-04-30"]).toBe(20);
    expect(byItem("YTD")["2026-04-30"]).toBe(20);
    expect(() => byItem("Loop")).toThrow(/calls itself/);
  });
});

describe("M9 time intelligence over the marked date table", () => {
  it("YTD, MTD, QTD, PY and DATEADD by month end", () => {
    const m = salesTiModel();
    const g = (expression: string) => cells(m, { expression, groupBy: ["cal2[month_end]"] });
    // YTD at Mar 2025 = Jan 100 + Mar 50; at Apr 2026 = 10 + 7 + 3 (the month filter is replaced by the date set).
    const ytd = g("CALCULATE ( [kpi_amount], DATESYTD ( cal2[date] ) )");
    expect(ytd["2025-03-31"]).toBe(150);
    expect(ytd["2026-04-30"]).toBe(20);
    expect(ytd["2025-02-28"]).toBe(100);
    // QTD at Apr 2025 = Apr 1..30 only = 20; MTD at Mar 2025 = 50.
    expect(g("CALCULATE ( [kpi_amount], DATESQTD ( cal2[date] ) )")["2025-04-30"]).toBe(20);
    expect(g("CALCULATE ( [kpi_amount], DATESMTD ( cal2[date] ) )")["2025-03-31"]).toBe(50);
    // PY of Apr 2026 = Apr 2025 = 20; months of 2025 shift into 2024, which is not in the calendar: BLANK.
    const py = g("CALCULATE ( [kpi_amount], SAMEPERIODLASTYEAR ( cal2[date] ) )");
    expect(py["2026-04-30"]).toBe(20);
    expect(py["2026-03-31"]).toBe(50);
    expect(py["2025-04-30"]).toBeUndefined();
    // Previous month of Apr 2025 is the whole of March (Apr 30 is a month end, so Mar 31 is included): 50.
    const pm = g("CALCULATE ( [kpi_amount], DATEADD ( cal2[date], -1, MONTH ) )");
    expect(pm["2025-04-30"]).toBe(50);
    expect(pm["2026-05-31"]).toBe(3);
    // Previous quarter of Apr 2025 is January (Apr 30 -> Jan 30, extended to Jan 31): 100.
    expect(g("CALCULATE ( [kpi_amount], DATEADD ( cal2[date], -1, QUARTER ) )")["2025-04-30"]).toBe(100);
    // Shifting Apr 2026 back one day covers Mar 31..Apr 29: 7 (Mar 31); Apr 30's 3 falls out.
    expect(g("CALCULATE ( [kpi_amount], DATEADD ( cal2[date], -1, DAY ) )")["2026-04-30"]).toBe(7);
  });

  it("the grand total PY is the part of last year inside the calendar", () => {
    const m = salesTiModel();
    // All dates 2025-2026 shift to 2024-2025; only 2025 exists: 100 + 50 + 20 + 40 = 210. YTD total = 2026 YTD = 20.
    expect(cells(m, { expression: "CALCULATE ( [kpi_amount], SAMEPERIODLASTYEAR ( cal2[date] ) )", groupBy: ["cal2[year]"], includeTotals: true })).toEqual({
      "2026": 210,
      TOTAL: 210,
    });
    expect(scalar(m, "CALCULATE ( [kpi_amount], DATESYTD ( cal2[date] ) )")).toBe(20);
  });

  it("refuses to shift a non-contiguous selection", () => {
    const m = salesTiModel();
    expect(() => scalar(m, "CALCULATE ( [kpi_amount], DATEADD ( cal2[date], -1, MONTH ) )", [{ column: "cal2[month_end]", values: ["2025-01-31", "2025-03-31"] }])).toThrow(
      /contiguous interval/,
    );
  });
});

describe("M10 calculation group items", () => {
  it("YoY % treats a blank current value as 0 - prior, YoY stays blank", () => {
    const m = salesTiModel();
    const item = (name: string) => [{ column: "cg_time[time_calculation]", values: [name] }];
    const g = (name: string) => cells(m, { measure: "kpi_amount", groupBy: ["cal2[month_end]"], filters: item(name) });
    // Jun 2026: current BLANK, prior 40. YoY % = (BLANK - 40) / 40 = -1. YoY needs both, so BLANK.
    expect(g("YoY %")["2026-06-30"]).toBe(-1);
    expect(g("YoY")["2026-06-30"]).toBeUndefined();
    // Jan 2026: (10 - 100) / 100.
    expect(g("YoY %")["2026-01-31"]).toBeCloseTo(-0.9, 12);
    expect(g("YoY")["2026-01-31"]).toBe(-90);
    // Year level: 2026 = 20 vs 2025 = 210.
    expect(cells(m, { measure: "kpi_amount", groupBy: ["cal2[year]"], filters: item("YoY %"), includeTotals: true })).toEqual({
      "2026": (20 - 210) / 210,
      TOTAL: (230 - 210) / 210,
    });
    // The item's formatStringDefinition wins over the measure's "#,0".
    const row = evaluate(m, { measure: "kpi_amount", groupBy: ["cal2[month_end]"], filters: item("YoY %") }).rows.find((r) => r.keys[0] === "2026-06-30")!;
    expect(row.formatted).toBe("-100.0%");
  });

  it("the total row of a grid grouped by item shows the untransformed measure", () => {
    const m = salesTiModel();
    // Current 230, PY 210 (see M9), YoY 20, YoY % 20 / 210; the total has no single item selected: 230.
    expect(cells(m, { measure: "kpi_amount", groupBy: ["cg_time[time_calculation]"], includeTotals: true })).toEqual({
      Current: 230,
      PY: 210,
      YoY: 20,
      "YoY %": 20 / 210,
      TOTAL: 230,
    });
  });

  it("refuses the cases whose semantics Parity does not model", () => {
    const m = salesTiModel();
    expect(() => scalar(m, "[kpi_amount_x2]", [{ column: "cg_time[time_calculation]", values: ["PY"] }])).toThrow(/calculation item over a measure that references other measures/);
    expect(() => scalar(m, "[kpi_amount]", [{ column: "cg_time[time_calculation]", values: ["PY", "YoY"] }])).toThrow(/2 items at once/);
  });
});

describe("M11 totals are evaluated, not summed", () => {
  it("DISTINCTCOUNT total is the distinct count over all rows", () => {
    const m = callsModel();
    // voice {N, S} = 2, relay {N, S} = 2, beacon {N} = 1; the total is {N, S} = 2, not 5.
    expect(cells(m, { expression: "DISTINCTCOUNT ( fact_calls[region] )", groupBy: ["fact_calls[channel]"], includeTotals: true })).toEqual({
      beacon: 1,
      relay: 2,
      voice: 2,
      TOTAL: 2,
    });
  });
});

describe("M12 selector table with a SWITCH harvester and dynamic format string", () => {
  it("switches value and format by the selected metric", () => {
    const m = callsModel();
    m.addTable(
      "sel_metric",
      [
        { name: "metric_order", dataType: "int" },
        { name: "metric", dataType: "string" },
      ],
      [
        [0, "Calls"],
        [1, "Voice share"],
      ],
    );
    m.addMeasure({
      name: "sel_metric_value",
      expression: "SWITCH ( SELECTEDVALUE ( sel_metric[metric_order], 0 ), 0, [kpi_calls], 1, DIVIDE ( [kpi_voice], [kpi_calls] ), BLANK () )",
      formatStringDefinition: 'SWITCH ( SELECTEDVALUE ( sel_metric[metric_order], 0 ), 0, "#,0", "0.0%" )',
    });
    const at = (order: number | null) => evaluate(m, { measure: "sel_metric_value", filters: order === null ? [] : [{ column: "sel_metric[metric_order]", values: [order] }] }).rows[0]!;
    // 10 calls; voice share 4 / 10.
    expect([at(0).value, at(0).formatted]).toEqual([10, "10"]);
    expect([at(1).value, at(1).formatted]).toEqual([0.4, "40.0%"]);
    // No selection: SELECTEDVALUE falls back to 0.
    expect([at(null).value, at(null).formatted]).toEqual([10, "10"]);
  });
});

describe("M13 the blank row from orphaned keys", () => {
  it("VALUES shows it, DISTINCT does not, and the grid gets a (Blank) member", () => {
    const m = shipsModel(true);
    // Ship 99 has no dim_ship row, so dim_ship gains a blank row.
    expect(scalar(m, "COUNTROWS ( VALUES ( dim_ship[ship_id] ) )")).toBe(4);
    expect(scalar(m, "COUNTROWS ( DISTINCT ( dim_ship[ship_id] ) )")).toBe(3);
    expect(scalar(m, "COUNTROWS ( ALL ( dim_ship[ship] ) )")).toBe(4);
    expect(cells(m, { measure: "kpi_jumps", groupBy: ["dim_ship[ship]"], includeTotals: true })).toEqual({ "(Blank)": 1, Orion: 1, Vega: 2, TOTAL: 4 });
    // With the blank row visible, SELECTEDVALUE sees 4 values, so it returns the alternate.
    expect(scalar(m, 'SELECTEDVALUE ( dim_ship[ship], "many" )')).toBe("many");
    // A slicer hides the blank row, so the table reference is safe again.
    expect(scalar(m, "COUNTROWS ( dim_ship )", [{ column: "dim_ship[ship]", values: ["Vega"] }])).toBe(1);
    expect(() => scalar(m, "COUNTROWS ( dim_ship )")).toThrow(/blank row/);
  });
});

describe("M14 scope, single values and lookups", () => {
  it("ISINSCOPE, HASONEVALUE, SELECTEDVALUE and LOOKUPVALUE", () => {
    const m = shipsModel();
    expect(cells(m, { expression: 'IF ( ISINSCOPE ( dim_ship[ship] ), "row", "total" )', groupBy: ["dim_ship[ship]"], includeTotals: true })).toEqual({
      Lyra: "row",
      Orion: "row",
      Vega: "row",
      TOTAL: "total",
    });
    // A slicer is a filter but not a grouping: HASONEVALUE is true, ISINSCOPE is false.
    const one = [{ column: "dim_ship[ship]", values: ["Orion"] }];
    expect(scalar(m, "HASONEVALUE ( dim_ship[ship] )", one)).toBe(true);
    expect(scalar(m, "ISINSCOPE ( dim_ship[ship] )", one)).toBe(false);
    expect(scalar(m, 'SELECTEDVALUE ( dim_ship[ship], "All ships" )')).toBe("All ships");
    expect(scalar(m, 'SELECTEDVALUE ( dim_ship[ship], "All ships" )', one)).toBe("Orion");
    expect(scalar(m, "LOOKUPVALUE ( dim_ship[ship], dim_ship[ship_id], 2 )")).toBe("Orion");
    expect(scalar(m, 'LOOKUPVALUE ( dim_ship[ship], dim_ship[ship_id], 42, "none" )')).toBe("none");
    expect(() => scalar(m, "LOOKUPVALUE ( dim_ship[ship], dim_ship[ship_id], 2 )", one)).toThrow(/LOOKUPVALUE on table 'dim_ship' while the current filter context filters it/);
  });
});

describe("M15 filters on the marked date column", () => {
  it("replace the other date-table filters, and combine with each other", () => {
    const m = salesTiModel();
    // A filter on cal2[date] removes the month filter: Jan 10 2025 shows 100 on every month row.
    expect(cells(m, { expression: "CALCULATE ( [kpi_amount], cal2[date] = DATE ( 2025, 1, 10 ) )", groupBy: ["cal2[month_end]"] })["2026-12-31"]).toBe(100);
    // Filter arguments of one CALCULATE intersect; the automatic ALL ( cal2 ) must not drop the year argument.
    // YTD of Dec 2025 is all of 2025 (210); intersected with year 2026 it is empty (BLANK).
    const dec = [{ column: "cal2[month_end]", values: ["2025-12-31"] }];
    expect(scalar(m, "CALCULATE ( [kpi_amount], DATESYTD ( cal2[date] ) )", dec)).toBe(210);
    expect(scalar(m, "CALCULATE ( [kpi_amount], cal2[year] = 2026, DATESYTD ( cal2[date] ) )", dec)).toBe(null);
  });
});

describe("M16 rolling windows and whole periods", () => {
  it("TOTALYTD, DATESINPERIOD, DATESBETWEEN, PREVIOUS* and PARALLELPERIOD", () => {
    const m = salesTiModel();
    const g = (expression: string, groupBy = ["cal2[month_end]"]) => cells(m, { expression, groupBy });
    // Sales: 2025-01-10 100, 03-31 50, 04-15 20, 06-15 40; 2026-01-05 10, 03-31 7, 04-30 3.
    // TOTALYTD is CALCULATE over DATESYTD: Mar 2025 = 100 + 50; Apr 2026 = 10 + 7 + 3.
    const ytd = g("TOTALYTD ( [kpi_amount], cal2[date] )");
    expect(ytd["2025-03-31"]).toBe(150);
    expect(ytd["2026-04-30"]).toBe(20);
    // Back 3 months from MAX = Apr 30 2025 is (Jan 30, Apr 30]: Mar 31 50 + Apr 15 20; Jan 10 falls outside.
    const roll = g("CALCULATE ( [kpi_amount], DATESINPERIOD ( cal2[date], MAX ( cal2[date] ), -3, MONTH ) )");
    expect(roll["2025-04-30"]).toBe(70);
    // From Jun 30: (Mar 30, Jun 30] = 50 + 20 + 40.
    expect(roll["2025-06-30"]).toBe(110);
    // Forward 3 months from Jan 10 is [Jan 10, Apr 10): 100 + 50.
    expect(scalar(m, "CALCULATE ( [kpi_amount], DATESINPERIOD ( cal2[date], DATE ( 2025, 1, 10 ), 3, MONTH ) )")).toBe(150);
    // DATESBETWEEN is inclusive; a blank start means the first date in the column.
    expect(scalar(m, "CALCULATE ( [kpi_amount], DATESBETWEEN ( cal2[date], DATE ( 2025, 3, 1 ), DATE ( 2025, 4, 30 ) ) )")).toBe(70);
    expect(scalar(m, "CALCULATE ( [kpi_amount], DATESBETWEEN ( cal2[date], BLANK (), DATE ( 2025, 3, 31 ) ) )")).toBe(150);
    // PREVIOUSMONTH of April 2025 is all of March; January 2025 has no previous month in the calendar.
    const pm = g("CALCULATE ( [kpi_amount], PREVIOUSMONTH ( cal2[date] ) )");
    expect(pm["2025-04-30"]).toBe(50);
    expect(pm["2025-02-28"]).toBe(100);
    expect(pm["2025-01-31"]).toBeUndefined();
    // PREVIOUSQUARTER of April 2025 is Q1 2025; PREVIOUSYEAR of 2026 is all of 2025.
    expect(g("CALCULATE ( [kpi_amount], PREVIOUSQUARTER ( cal2[date] ) )")["2025-04-30"]).toBe(150);
    expect(g("CALCULATE ( [kpi_amount], PREVIOUSYEAR ( cal2[date] ) )", ["cal2[year]"])).toEqual({ "2026": 210 });
    // PARALLELPERIOD fills whole periods: April 2026 back a year is all of 2025; June 2025 back a quarter is Q1.
    expect(g("CALCULATE ( [kpi_amount], PARALLELPERIOD ( cal2[date], -1, YEAR ) )")["2026-04-30"]).toBe(210);
    expect(g("CALCULATE ( [kpi_amount], PARALLELPERIOD ( cal2[date], -1, QUARTER ) )")["2025-06-30"]).toBe(150);
  });
});

describe("M17 ALLEXCEPT, ISFILTERED and ISCROSSFILTERED", () => {
  it("ALLEXCEPT keeps the listed columns, across the expanded table", () => {
    const m = salesTiModel();
    const y2025 = [{ column: "cal2[year]", values: [2025] }];
    // Year slicer 2025, rows by month: ALLEXCEPT ( cal2, cal2[year] ) drops the month filter but keeps the year: 210.
    expect(cells(m, { expression: "CALCULATE ( [kpi_amount], ALLEXCEPT ( cal2, cal2[year] ) )", groupBy: ["cal2[month_end]"], filters: y2025 })["2025-04-30"]).toBe(210);
    // ALL ( cal2 ) drops the year too: every sale, 230.
    expect(cells(m, { expression: "CALCULATE ( [kpi_amount], ALL ( cal2 ) )", groupBy: ["cal2[month_end]"], filters: y2025 })["2025-04-30"]).toBe(230);
    // On the fact table, cal2 is part of the expanded table, so cal2[year] can be the kept column: 2026 = 20.
    expect(cells(m, { expression: "CALCULATE ( [kpi_amount], ALLEXCEPT ( sales2, cal2[year] ) )", groupBy: ["cal2[month_end]"], filters: [{ column: "cal2[year]", values: [2026] }] })["2026-01-31"]).toBe(20);
  });

  it("ISFILTERED is direct, ISCROSSFILTERED follows relationships in the filter direction", () => {
    const m = salesTiModel();
    const f = cells(m, { expression: "IF ( ISFILTERED ( cal2[year] ), 1, 0 )", groupBy: ["cal2[year]"], includeTotals: true });
    expect(f).toEqual({ "2025": 1, "2026": 1, TOTAL: 0 });
    // A year filter reaches the sales rows through the relationship.
    expect(cells(m, { expression: "IF ( ISCROSSFILTERED ( sales2[amount] ), 1, 0 )", groupBy: ["cal2[year]"], includeTotals: true })).toEqual({ "2025": 1, "2026": 1, TOTAL: 0 });
    // A filter on the fact does not flow back to the single-direction dimension.
    expect(scalar(m, "IF ( ISCROSSFILTERED ( cal2[date] ), 1, 0 )", [{ column: "sales2[amount]", values: [100] }])).toBe(0);
  });
});

describe("M18 iterators, counts and scalar helpers", () => {
  it("COUNTX, MINX, MAXX, COUNTA and COUNTBLANK", () => {
    const m = salesTiModel();
    expect(scalar(m, "COUNTX ( sales2, sales2[amount] )")).toBe(7);
    expect(scalar(m, "MINX ( sales2, sales2[amount] )")).toBe(3);
    expect(scalar(m, "MAXX ( sales2, sales2[amount] )")).toBe(100);
    // Only March 2026 (7): one row.
    expect(scalar(m, "MAXX ( sales2, sales2[amount] )", [{ column: "cal2[month_end]", values: ["2026-03-31"] }])).toBe(7);
    const b = blanksModel();
    // amounts 10, blank, 5, blank, blank.
    expect(scalar(b, "COUNTA ( sales[amount] )")).toBe(2);
    expect(scalar(b, "COUNTBLANK ( sales[amount] )")).toBe(3);
    // Store A has one blank; store C has no non-blank amount, so COUNTA is BLANK there.
    expect(cells(b, { expression: "COUNTA ( sales[amount] )", groupBy: ["sales[store]"] })).toEqual({ A: 1, B: 1 });
  });

  it("ROUND away from zero, INT down, DATEDIFF by boundaries crossed, text slices", () => {
    const m = salesTiModel();
    expect(scalar(m, "ROUND ( 2.5, 0 )")).toBe(3);
    expect(scalar(m, "ROUND ( -2.5, 0 )")).toBe(-3);
    expect(scalar(m, "ROUND ( 1234.567, -2 )")).toBe(1200);
    expect(scalar(m, "INT ( -8.9 )")).toBe(-9);
    expect(scalar(m, "ABS ( -3 )")).toBe(3);
    // One day apart but a month boundary is crossed.
    expect(scalar(m, "DATEDIFF ( DATE ( 2025, 1, 31 ), DATE ( 2025, 2, 1 ), MONTH )")).toBe(1);
    expect(scalar(m, "DATEDIFF ( DATE ( 2025, 3, 31 ), DATE ( 2025, 4, 1 ), QUARTER )")).toBe(1);
    expect(scalar(m, "DATEDIFF ( DATE ( 2025, 12, 31 ), DATE ( 2026, 1, 1 ), YEAR )")).toBe(1);
    expect(scalar(m, "DATEDIFF ( DATE ( 2025, 2, 1 ), DATE ( 2025, 1, 31 ), DAY )")).toBe(-1);
    expect(scalar(m, 'LEFT ( "Starlane", 4 ) & "|" & RIGHT ( "Starlane", 4 ) & "|" & UPPER ( "ops" )')).toBe("Star|lane|OPS");
    expect(scalar(m, 'LEN ( "Starlane" )')).toBe(8);
    expect(scalar(m, "DAY ( DATE ( 2025, 3, 31 ) )")).toBe(31);
  });
});

describe("M19 calculated columns", () => {
  it("RELATED in a fact row, a measure by context transition in a dimension row", () => {
    const m = shipsModel();
    // fact_jumps rows: ship 1 fuel 10, ship 1 fuel 20, ship 2 fuel 5.
    m.addCalculatedColumn({ table: "fact_jumps", name: "ship_name", expression: "RELATED ( dim_ship[ship] )" });
    expect(cells(m, { expression: "SUM ( fact_jumps[fuel] )", groupBy: ["fact_jumps[ship_name]"] })).toEqual({ Vega: 30, Orion: 5 });
    // [kpi_jumps] in a dim_ship row transitions to that ship: Vega 2, Orion 1, Lyra has none (BLANK).
    const jumps = m.addCalculatedColumn({ table: "dim_ship", name: "jumps", expression: "[kpi_jumps]" });
    expect(jumps.dataType).toBe("int");
    expect(m.table("dim_ship").rows.map((r) => r[jumps.index])).toEqual([2, 1, null]);
    // A plain aggregation in a row context has no filter, so every row gets the table total.
    const total = m.addCalculatedColumn({ table: "dim_ship", name: "all_jumps", expression: "COUNTROWS ( fact_jumps )" });
    expect(m.table("dim_ship").rows.map((r) => r[total.index])).toEqual([3, 3, 3]);
    // RELATEDTABLE is CALCULATETABLE with the row turned into a filter.
    const rt = m.addCalculatedColumn({ table: "dim_ship", name: "rt", expression: "COUNTROWS ( RELATEDTABLE ( fact_jumps ) )" });
    expect(m.table("dim_ship").rows.map((r) => r[rt.index])).toEqual([2, 1, null]);
  });

  it("refuses a column whose rows mix types", () => {
    const m = shipsModel();
    expect(() => m.addCalculatedColumn({ table: "dim_ship", name: "x", expression: 'IF ( dim_ship[ship_id] = 1, "one", 2 )' })).toThrow(/mixes string and int/);
  });
});

describe("CALCULATE filter arguments on the same column", () => {
  // Hand-verified: fuel by jump is 10, 20 (Vega) and 5 (Orion); the arguments intersect, as separate filters do in DAX.
  it("intersect instead of the last one winning", () => {
    const m = new Model();
    m.addTable("fact_jumps", [{ name: "fuel", dataType: "int" }], [[10], [20], [5], [40]]);
    m.addMeasure({ name: "kpi_fuel", expression: "SUM ( fact_jumps[fuel] )" });
    expect(scalar(m, "CALCULATE ( [kpi_fuel], fact_jumps[fuel] >= 10, fact_jumps[fuel] <= 20 )")).toBe(30);
    expect(scalar(m, "CALCULATE ( CALCULATE ( [kpi_fuel], fact_jumps[fuel] <= 20 ), fact_jumps[fuel] >= 10 )")).toBe(35);
    expect(scalar(m, "CALCULATE ( CALCULATE ( [kpi_fuel], KEEPFILTERS ( fact_jumps[fuel] <= 20 ) ), fact_jumps[fuel] >= 10 )")).toBe(30);
  });
});

describe("a FILTER over the fact table next to a dimension filter", () => {
  // Hand-verified: quarter A has jumps of 10 (Vega) and 20 (Orion); excluding Orion leaves 10.
  it("keeps both filters", () => {
    const m = new Model();
    m.addTable("dim_q", [{ name: "q", dataType: "string" }], [["A"], ["B"]]);
    m.addTable("fact_jumps", [{ name: "q", dataType: "string" }, { name: "ship", dataType: "string" }, { name: "fuel", dataType: "int" }], [["A", "Vega", 10], ["A", "Orion", 20], ["B", "Vega", 5]]);
    m.addRelationship({ fromColumn: "fact_jumps[q]", toColumn: "dim_q[q]" });
    m.addMeasure({ name: "kpi_fuel", expression: "SUM ( fact_jumps[fuel] )" });
    expect(scalar(m, 'CALCULATE ( [kpi_fuel], dim_q[q] = "A", FILTER ( fact_jumps, fact_jumps[ship] <> "Orion" ) )')).toBe(10);
  });
});

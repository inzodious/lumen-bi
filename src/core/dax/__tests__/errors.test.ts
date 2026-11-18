import { describe, expect, it } from "vitest";
import { evaluate, loadQueryResult, Model } from "../index.ts";
import { scalar } from "./helpers.ts";

function model(): Model {
  const m = new Model();
  m.addTable(
    "dim_port",
    [
      { name: "port_id", dataType: "int" },
      { name: "port", dataType: "string" },
    ],
    [
      { port_id: 1, port: "Ceres" },
      { port_id: 2, port: "Europa" },
    ],
  );
  m.addTable(
    "fact_dock",
    [
      { name: "port_id", dataType: "int" },
      { name: "berth_port_id", dataType: "int" },
      { name: "hours", dataType: "double" },
    ],
    [
      [1, 2, 3.5],
      [2, 2, 1],
    ],
  );
  m.addRelationship({ fromColumn: "fact_dock.port_id", toColumn: "dim_port.port_id" });
  m.addRelationship({ fromColumn: "fact_dock[berth_port_id]", toColumn: "dim_port[port_id]", isActive: false });
  m.addMeasure({ name: "kpi_hours", expression: "SUM ( fact_dock[hours] )" });
  return m;
}

describe("unsupported functions fail loudly", () => {
  it("at measure definition and at evaluation", () => {
    const m = model();
    expect(() => m.addMeasure({ name: "kpi_rank", expression: "RANKX ( ALL ( dim_port ), [kpi_hours] )" })).toThrow(
      "Measure 'kpi_rank': DAX function RANKX is not supported in Parity yet.",
    );
    expect(() => scalar(m, "IF ( TRUE (), COUNTROWS ( TOPN ( 1, dim_port ) ) )")).toThrow(/^TOPN without an order-by expression is not supported in Parity yet\. Add the expression to rank by/);
    expect(() => scalar(m, "COUNTROWS ( SUMMARIZECOLUMNS ( dim_port[port] ) )")).toThrow(/^SUMMARIZECOLUMNS inside a measure, an iterator or a calculated column is not supported in Parity yet\./);
    expect(() => scalar(m, "COUNTROWS ( GROUPBY ( fact_dock, dim_port[port] ) )")).toThrow("DAX function GROUPBY is not supported in Parity yet. Use SUMMARIZECOLUMNS, or ADDCOLUMNS ( SUMMARIZE ( ... ), ... ), instead.");
    expect(() => scalar(m, "COUNTROWS ( ALLEXCEPT ( dim_port, dim_port[port] ) )")).toThrow(/^ALLEXCEPT used as a table expression is not supported in Parity yet\./);
    expect(() => scalar(m, "IF ( TRUE (), PATH ( dim_port[port], dim_port[port] ) )")).toThrow("DAX function PATH is not supported in Parity yet.");
    expect(() => scalar(m, "COUNTROWS ( FILTER ( ALLSELECTED ( dim_port ), TRUE () ) )")).toThrow(/^ALLSELECTED used as a table expression is not supported in Parity yet\. Use it as a CALCULATE filter modifier/);
    expect(() => scalar(m, "DATESYTD ( dim_port[port], \"6/30\" )")).toThrow(/year-end date argument is not supported/);
  });

  it("ALLSELECTED inside an iterator is refused rather than guessed", () => {
    const m = model();
    m.addMeasure({ name: "kpi_share", expression: "DIVIDE ( [kpi_hours], CALCULATE ( [kpi_hours], ALLSELECTED ( dim_port ) ) )" });
    expect(scalar(m, "[kpi_share]", [{ column: "dim_port[port]", values: ["Ceres"] }])).toBe(1);
    expect(() => scalar(m, "SUMX ( VALUES ( dim_port[port] ), [kpi_share] )")).toThrow(/ALLSELECTED inside an iterator/);
  });
});

describe("errors read like Power BI's", () => {
  it("names the column, table or measure involved", () => {
    const m = model();
    expect(() => scalar(m, "fact_dock[hours]")).toThrow(
      "A single value for column 'hours' in table 'fact_dock' cannot be determined. This can happen when a measure formula refers to a column that contains many values without specifying an aggregation such as min, max, count, or sum to get a single result.",
    );
    expect(() => scalar(m, "SUM ( fact_dock[minutes] )")).toThrow("Column 'minutes' in table 'fact_dock' cannot be found or may not be used in this expression.");
    expect(() => scalar(m, "COUNTROWS ( fact_docks )")).toThrow("Failed to resolve name 'fact_docks'. It is not a valid table, variable, or function name.");
    expect(() => scalar(m, "[kpi_missing]")).toThrow(/The value for 'kpi_missing' cannot be determined/);
    expect(() => scalar(m, "VALUES ( dim_port[port] ) & \"\"")).toThrow("A table of multiple values was supplied where a single value was expected.");
    expect(() => scalar(m, "SUM ( [kpi_hours] )")).toThrow("SUM expects a column reference, but [kpi_hours] is a measure.");
    expect(() => scalar(m, "DIVIDE ( 1 )")).toThrow("Too few arguments were passed to the DIVIDE function. It takes 2 to 3 argument(s); you passed 1.");
    expect(() => scalar(m, "USERELATIONSHIP ( fact_dock[berth_port_id], dim_port[port_id] )")).toThrow(
      "USERELATIONSHIP can only be used as a filter argument of CALCULATE or CALCULATETABLE.",
    );
    expect(() => scalar(m, "CALCULATE ( [kpi_hours], USERELATIONSHIP ( fact_dock[hours], dim_port[port_id] ) )")).toThrow(/there is no relationship between 'fact_dock'\[hours\] and 'dim_port'\[port_id\]/);
    expect(() => scalar(m, "CALCULATE ( [kpi_hours], CROSSFILTER ( fact_dock[berth_port_id], dim_port[port_id], BOTH ) )")).toThrow(/CROSSFILTER on the inactive relationship/);
    expect(() => scalar(m, 'CALCULATE ( [kpi_hours], dim_port[port] = "Ceres" && fact_dock[hours] > 1 )')).toThrow(/uses columns from more than one table/);
    expect(() => scalar(m, 'SUM ( dim_port[port] )')).toThrow("The function SUM cannot work with values of type String.");
  });

  it("uses the inactive relationship only when asked", () => {
    const m = model();
    // Active: Ceres docks 3.5 hours. Via the berth relationship, both rows berth at Europa, so Ceres has none.
    expect(scalar(m, "[kpi_hours]", [{ column: "dim_port[port]", values: ["Ceres"] }])).toBe(3.5);
    expect(scalar(m, "CALCULATE ( [kpi_hours], USERELATIONSHIP ( fact_dock[berth_port_id], dim_port[port_id] ) )", [{ column: "dim_port[port]", values: ["Ceres"] }])).toBe(null);
    expect(scalar(m, "CALCULATE ( [kpi_hours], USERELATIONSHIP ( dim_port[port_id], fact_dock[berth_port_id] ) )", [{ column: "dim_port[port]", values: ["Europa"] }])).toBe(4.5);
  });

  it("detects circular measures", () => {
    const m = model();
    m.addMeasure({ name: "kpi_a", expression: "[kpi_b] + 1" });
    m.addMeasure({ name: "kpi_b", expression: "[kpi_a] + 1" });
    expect(() => scalar(m, "[kpi_a]")).toThrow("A circular dependency was detected: kpi_a -> kpi_b -> kpi_a.");
  });
});

describe("model validation", () => {
  it("rejects bad relationships, date tables and types", () => {
    const m = model();
    expect(() => m.addRelationship({ fromColumn: "fact_dock[port_id]", toColumn: "fact_dock[berth_port_id]" })).toThrow(
      "Column 'berth_port_id' in table 'fact_dock' contains a duplicate value '2', so it cannot be the one side of a relationship.",
    );
    expect(() => m.addRelationship({ fromColumn: "fact_dock[berth_port_id]", toColumn: "dim_port[port_id]" })).toThrow(/already an active relationship between 'fact_dock' and 'dim_port'/);
    m.addTable("cal", [{ name: "date", dataType: "date" }], [["2026-01-01"], ["2026-01-03"]]);
    expect(() => m.markAsDateTable("cal", "date")).toThrow(/has gaps/);
    expect(() => m.addTable("bad", [{ name: "n", dataType: "int" }], [[1.5]])).toThrow("Cannot convert value '1.5' to Whole Number for column 'n' in table 'bad'.");
    expect(() =>
      loadQueryResult(m, "ts", { columns: [{ name: "at", type: "timestamp", rawType: "TIMESTAMP" }], rows: [["2026-01-01 00:00:00"]] }),
    ).toThrow("Loading column 'at' of type TIMESTAMP into a semantic model is not supported in Parity yet.");
  });

  it("keeps measure metadata", () => {
    const m = model();
    const kpi = m.addMeasure({ name: "kpi_hours_fmt", expression: "[kpi_hours]", formatString: "#,0.00", displayFolder: "Docking" });
    expect([kpi.table, kpi.displayFolder, kpi.formatString]).toEqual(["_measures_kpi", "Docking", "#,0.00"]);
    const g = evaluate(m, { measure: "kpi_hours_fmt", groupBy: ["dim_port[port]"], includeTotals: true });
    expect(g.rows.map((r) => [r.keys, r.formatted])).toEqual([
      [["Ceres"], "3.50"],
      [["Europa"], "1.00"],
      [[], "4.50"],
    ]);
  });
});

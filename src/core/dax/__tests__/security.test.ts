import { describe, expect, it } from "vitest";
import { evaluate, evaluateScalar, Model, securedModel } from "../index.ts";

// Hand-verified: each expected value is counted from the rows below.

function regionsModel(bothDirections = false): Model {
  const m = new Model();
  m.addTable(
    "dim_region",
    [
      { name: "region_id", dataType: "int" },
      { name: "region", dataType: "string" },
      { name: "manager_email", dataType: "string" },
    ],
    [
      [1, "North", "vega@starlane.mock"],
      [2, "South", "orion@starlane.mock"],
      [3, "East", "vega@starlane.mock"],
    ],
  );
  m.addTable(
    "dim_ship",
    [
      { name: "ship_id", dataType: "int" },
      { name: "ship", dataType: "string" },
    ],
    [
      [10, "Lyra"],
      [11, "Draco"],
    ],
  );
  m.addTable(
    "fact_jumps",
    [
      { name: "region_id", dataType: "int" },
      { name: "ship_id", dataType: "int" },
      { name: "fuel", dataType: "int" },
    ],
    [
      [1, 10, 10],
      [1, 11, 20],
      [2, 10, 5],
      [3, 11, 7],
      [99, 10, 100], // no matching region: the blank row
    ],
  );
  m.addRelationship({ fromColumn: "fact_jumps[region_id]", toColumn: "dim_region[region_id]" });
  m.addRelationship({ fromColumn: "fact_jumps[ship_id]", toColumn: "dim_ship[ship_id]", securityFilteringBehavior: bothDirections ? "both" : "single" });
  m.addMeasure({ name: "kpi_fuel", expression: "SUM ( fact_jumps[fuel] )" });
  m.addMeasure({ name: "kpi_fuel_all", expression: "CALCULATE ( [kpi_fuel], ALL ( dim_region ) )" });
  m.addMeasure({ name: "kpi_ships", expression: "COUNTROWS ( dim_ship )" });
  return m;
}

describe("row-level security", () => {
  it("unrestricted: every row, including the unmatched one", () => {
    expect(evaluateScalar(regionsModel(), "[kpi_fuel]")).toBe(142);
  });

  it("a static role keeps North and flows to the fact table, hiding the blank-row facts too", () => {
    const { model } = securedModel(regionsModel(), { name: "North", tablePermissions: [{ table: "dim_region", filterExpression: '[region] = "North"' }] });
    expect(evaluateScalar(model, "[kpi_fuel]")).toBe(30); // 10 + 20
  });

  it("ALL can't bring hidden rows back", () => {
    const { model } = securedModel(regionsModel(), { name: "North", tablePermissions: [{ table: "dim_region", filterExpression: '[region] = "North"' }] });
    expect(evaluateScalar(model, "[kpi_fuel_all]")).toBe(30);
    expect(evaluateScalar(model, "COUNTROWS ( ALL ( dim_region ) )")).toBe(1);
  });

  it("dynamic RLS with USERPRINCIPALNAME", () => {
    const role = { name: "Managers", tablePermissions: [{ table: "dim_region", filterExpression: "[manager_email] = USERPRINCIPALNAME ()" }] };
    const vega = securedModel(regionsModel(), role, { userPrincipalName: "vega@starlane.mock" }).model;
    expect(evaluateScalar(vega, "[kpi_fuel]")).toBe(37); // North 30 + East 7
    const grid = evaluate(vega, { measure: "kpi_fuel", groupBy: ["dim_region[region]"] });
    expect(grid.rows.map((r) => [r.keys[0], r.value])).toEqual([
      ["East", 7],
      ["North", 30],
    ]);
    const nobody = securedModel(regionsModel(), role, { userPrincipalName: "someone@else.mock" }).model;
    expect(evaluateScalar(nobody, "[kpi_fuel]")).toBe(null);
  });

  it("the filter doesn't flow up to other dimensions unless the relationship says so", () => {
    const role = { name: "South", tablePermissions: [{ table: "dim_region", filterExpression: '[region] = "South"' }] };
    // South's only jump is on Lyra, but dim_ship isn't filtered by a single-direction relationship.
    expect(evaluateScalar(securedModel(regionsModel(false), role).model, "[kpi_ships]")).toBe(2);
    expect(evaluateScalar(securedModel(regionsModel(true), role).model, "[kpi_ships]")).toBe(1);
  });

  it("two permissions in one role intersect", () => {
    const role = {
      name: "North Lyra",
      tablePermissions: [
        { table: "dim_region", filterExpression: '[region] = "North"' },
        { table: "dim_ship", filterExpression: '[ship] = "Lyra"' },
      ],
    };
    expect(evaluateScalar(securedModel(regionsModel(), role).model, "[kpi_fuel]")).toBe(10);
  });

  it("a filter that returns text is an error", () => {
    expect(() => securedModel(regionsModel(), { name: "Bad", tablePermissions: [{ table: "dim_region", filterExpression: "[region]" }] })).toThrow(/must return TRUE or FALSE/);
  });
});

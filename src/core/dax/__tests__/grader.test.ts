import type { Workspace } from "@parity/lakehouse";
import { beforeAll, describe, expect, it } from "vitest";
import { buildContextGrid, compareMeasures, type Model } from "../index.ts";
import { starlane } from "./fixture.ts";

let model: Model;
let ws: Workspace;

beforeAll(async () => {
  ({ ws, model } = await starlane());
  model.addMeasure({ name: "kpi_transmissions", expression: "COUNTROWS ( fact_transmissions )", formatString: "#,0" });
  model.addMeasure({ name: "kpi_accounts_active", expression: "DISTINCTCOUNT ( fact_transmissions[account_id] )" });
  model.addMeasure({
    name: "kpi_channel_pct",
    expression: "VAR Denominator = CALCULATE ( [kpi_transmissions], ALLSELECTED ( fact_transmissions[channel] ) )\nRETURN\nDIVIDE ( [kpi_transmissions], Denominator )",
  });
});

const grid = () =>
  buildContextGrid(model, {
    groupBy: ["fact_transmissions[channel]"],
    slicers: [{ column: "fact_transmissions[channel]" }, { column: "dim_accounts[region]", members: ["Core", "Rim"] }],
  });

describe("buildContextGrid", () => {
  it("covers no selection, each member, and a multi-select per slicer", () => {
    // Channel: none, 3 singles, 1 pair = 5 states. Region: none, 2 singles (only 2 members, so no default pair) = 3.
    expect(grid().states).toHaveLength(15);
    expect(grid().states).toContainEqual([
      { column: "fact_transmissions[channel]", values: ["beacon", "relay"] },
      { column: "dim_accounts[region]", values: ["Rim"] },
    ]);
  });
});

describe("compareMeasures", () => {
  it("accepts an equivalent formulation", () => {
    const r = compareMeasures(model, "DIVIDE ( [kpi_transmissions], CALCULATE ( [kpi_transmissions], ALLSELECTED ( fact_transmissions[channel] ) ) )", { measure: "kpi_channel_pct" }, grid());
    expect(r.equal).toBe(true);
    expect(r.cellsCompared).toBeGreaterThan(30);
    expect(r.summary).toMatch(/^All \d+ cells match\.$/);
  });

  it("catches REMOVEFILTERS where ALLSELECTED was needed, but only under a channel slicer", () => {
    const r = compareMeasures(model, "DIVIDE ( [kpi_transmissions], CALCULATE ( [kpi_transmissions], REMOVEFILTERS ( fact_transmissions[channel] ) ) )", { measure: "kpi_channel_pct" }, grid());
    expect(r.equal).toBe(false);
    expect(r.mismatches.every((m) => m.filters.some((f) => f.column === "fact_transmissions[channel]"))).toBe(true);
    expect(r.summary).toMatch(/^At the row \["beacon"\] with fact_transmissions\[channel\] = \["beacon"\], expected 1 but your measure returned 0\.\d+/);
  });

  it("catches a total that was summed instead of evaluated", () => {
    const r = compareMeasures(model, "SUMX ( VALUES ( fact_transmissions[channel] ), [kpi_accounts_active] )", { measure: "kpi_accounts_active" }, grid());
    expect(r.equal).toBe(false);
    expect(r.mismatches.every((m) => m.level === 0)).toBe(true);
  });

  it("reports a candidate that fails to evaluate", () => {
    const r = compareMeasures(model, "RANKX ( ALL ( dim_accounts ), [kpi_transmissions] )", { measure: "kpi_transmissions" }, { groupBy: ["dim_accounts[region]"] });
    expect(r.equal).toBe(false);
    expect(r.summary).toBe("At the grand total with no slicers, your measure failed: DAX function RANKX is not supported in Parity yet.");
  });

  it("the Workspace and the model hold the same rows", () => {
    const sql = ws.query("SELECT count(*), count(DISTINCT account_id) FROM lh_gold.beacon.fact_transmissions").rows[0]!;
    const g = compareMeasures(model, "COUNTROWS ( fact_transmissions )", `${sql[0]}`, { groupBy: [] });
    expect(g.equal).toBe(true);
  });
});

describe("mismatch messages", () => {
  it("shows Infinity and NaN instead of JSON's null", async () => {
    const { shown } = await import("../index.ts");
    expect([shown(Infinity), shown(-Infinity), shown(NaN), shown(null), shown(3), shown("a")]).toEqual(["Infinity", "-Infinity", "NaN", "(Blank)", "3", '"a"']);
  });
});

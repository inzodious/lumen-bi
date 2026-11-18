import { describe, expect, it } from "vitest";
import { Workspace } from "@parity/lakehouse";
import { createNodeDb } from "@parity/lakehouse/node";
import { evaluateQuery } from "../index.ts";
import { refreshDataflow } from "../../../../tests/support/m/dataflow.ts";
import { workspaceHost } from "../../../../tests/support/m/workspace-host.ts";

describe("refreshDataflow", () => {
  it("writes queries with a Lakehouse destination, lets queries reference each other, and reports failures per query", async () => {
    const ws = Workspace.create(await createNodeDb(), { lakehouses: { lh_bronze: ["dbo"], lh_silver: ["dbo"] }, defaultLakehouse: "lh_bronze" });
    ws.files.put("lh_bronze/Files/leads.csv", "Team,Lead,Shift\nRelay Alpha,Nova Quill,Day\nNight Watch,Orin Vale,Night\n");
    const host = workspaceHost(ws);
    const leads = `let
    Source = Csv.Document(File.Contents("lh_bronze/Files/leads.csv"), [Delimiter = ","]),
    #"Promoted Headers" = Table.PromoteHeaders(Source),
    #"Changed Type" = Table.TransformColumnTypes(#"Promoted Headers", {{"Team", type text}, {"Lead", type text}, {"Shift", type text}}),
    #"Renamed Columns" = Table.RenameColumns(#"Changed Type", {{"Team", "team"}, {"Lead", "lead"}, {"Shift", "shift"}})
in
    #"Renamed Columns"`;
    const dest = { lakehouse: "lh_silver", schema: "dbo", table: "team_leads", method: "Replace" as const };
    const r = refreshDataflow(ws, host, [
      { name: "leads", code: leads, destination: dest },
      { name: "night", code: 'Table.SelectRows(leads, each [shift] = "Night")', destination: { ...dest, table: "night_leads" } },
      { name: "untyped", code: 'Table.PromoteHeaders(Csv.Document(File.Contents("lh_bronze/Files/leads.csv")))', destination: { ...dest, table: "raw" } },
    ]);
    expect(r.map((x) => [x.name, x.ok, x.rows ?? null])).toEqual([
      ["leads", true, 2],
      ["night", true, 1],
      ["untyped", false, null],
    ]);
    expect(r[2]!.error!.message).toMatch(/Column 'Team' of query 'untyped' has type any, and a Lakehouse destination needs a type for every column/);
    expect(ws.query("SELECT lead FROM lh_silver.dbo.night_leads").rows).toEqual([["Orin Vale"]]);
    // Replace overwrites; Append adds.
    refreshDataflow(ws, host, [{ name: "leads", code: leads, destination: { ...dest, method: "Append" } }]);
    expect(Number(ws.query("SELECT count(*) FROM lh_silver.dbo.team_leads").rows[0]![0])).toBe(4);
    refreshDataflow(ws, host, [{ name: "leads", code: leads, destination: dest }]);
    expect(Number(ws.query("SELECT count(*) FROM lh_silver.dbo.team_leads").rows[0]![0])).toBe(2);
    expect(ws.history("lh_silver.dbo.team_leads").length).toBe(3);
  });
});

describe("evaluateQuery with sibling queries", () => {
  it("resolves other queries by name and reports cycles", () => {
    const e = evaluateQuery("let\n    Source = base,\n    Doubled = List.Transform(Source, each _ * 2)\nin\n    Doubled", { queries: { base: "{1, 2, 3}" } });
    expect(e.result.ok && e.result.preview).toMatchObject({ kind: "list" });
    expect(e.steps.map((s) => s.name)).toEqual(["Source", "Doubled"]);
    const cyc = evaluateQuery("a", { queries: { a: "b", b: "a" } });
    expect(cyc.result.ok).toBe(false);
  });
});

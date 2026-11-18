import { Workspace } from "@parity/lakehouse";
import { createNodeDb } from "@parity/lakehouse/node";
import { beforeAll, describe, expect, it } from "vitest";
import { evaluateSection, toJs, type MHost } from "../index.ts";
import { mockGuid, workspaceHost } from "../../../../tests/support/m/workspace-host.ts";

let host: MHost;
const WS = mockGuid("workspace:Starlane Data Ops");
const BRONZE = mockGuid("lakehouse:lh_bronze");
const GOLD = mockGuid("lakehouse:lh_curated");

beforeAll(async () => {
  const db = await createNodeDb();
  const ws = Workspace.create(db, { lakehouses: { lh_bronze: ["dbo", "ops"], lh_curated: ["dbo", "ops"] }, defaultLakehouse: "lh_bronze" });
  ws.files.put("lh_bronze/Files/data/helper_tables/dim_ship_classes.csv", "class_code,class_name,is_cargo\nTUG,Tug,false\nFRG,Freighter,true\n");
  ws.saveAsTable("lh_curated.ops.dim_crew_roles", "SELECT 'pilot' AS role");
  host = workspaceHost(ws, { now: () => new Date("2026-09-27T12:00:00Z") });
});

const MASHUP = () => `[StagingDefinition = [Kind = "FastCopy"]]
section Section1;
[DataDestinations = {[Definition = [Kind = "Reference", QueryName = "dim_ship_classes_DataDestination", IsNewTarget = true], Settings = [Kind = "Automatic", TypeSettings = [Kind = "Table"]]]}]
shared dim_ship_classes = let
  Source = Lakehouse.Contents(null),
  Navigation = Source{[workspaceId = "${WS}"]}[Data],
  #"Navigation 1" = Navigation{[lakehouseId = "${BRONZE}"]}[Data],
  #"Navigation 2" = #"Navigation 1"{[Id = "Files", ItemKind = "Folder"]}[Data],
  #"Navigation 3" = #"Navigation 2"{[Name = "data"]}[Content],
  #"Navigation 4" = #"Navigation 3"{[Name = "helper_tables"]}[Content],
  #"Navigation 5" = #"Navigation 4"{[Name = "dim_ship_classes.csv"]}[Content],
  #"Imported CSV" = Csv.Document(#"Navigation 5", [Delimiter = ",", Columns = 3, QuoteStyle = QuoteStyle.None]),
  #"Promoted headers" = Table.PromoteHeaders(#"Imported CSV", [PromoteAllScalars = true]),
  #"Changed column type" = Table.TransformColumnTypes(#"Promoted headers", {{"class_code", type text}, {"class_name", type text}, {"is_cargo", type logical}}),
  #"Sorted rows" = Table.Sort(#"Changed column type", {{"class_code", Order.Ascending}})
in
  #"Sorted rows";
shared dim_ship_classes_DataDestination = let
  Pattern = Lakehouse.Contents([CreateNavigationProperties = false, EnableFolding = false, HierarchicalNavigation = true, EnableVorder = true, OutputMetadataRefresh = true]),
  Navigation_1 = Pattern{[workspaceId = "${WS}"]}[Data],
  Navigation_2 = Navigation_1{[lakehouseId = "${GOLD}"]}[Data],
  Navigation_3 = Navigation_2{[Id = "ops", ItemKind = "Schema"]}[Data],
  TableNavigation = Navigation_3{[Id = "dim_ship_classes", ItemKind = "Table"]}?[Data]?
in
  TableNavigation;
[DataDestinations = {[Definition = [Kind = "Reference", QueryName = "dim_crew_roles_DataDestination", IsNewTarget = false], Settings = [Kind = "Manual", AllowCreation = false, ColumnSettings = [Mappings = {[SourceColumnName = "role", DestinationColumnName = "role"]}], DynamicSchema = false, UpdateMethod = [Kind = "Replace"], TypeSettings = [Kind = "Table"]]]}]
shared dim_crew_roles = let
  Source = #table(type table [role = text], {{"pilot"}, {"navigator"}}),
  Upper = Table.TransformColumns(Source, {{"role", Text.Upper, type text}}),
  Unused = error "never evaluated by the result"
in
  Upper;
shared dim_crew_roles_DataDestination = let
  Pattern = Lakehouse.Contents([CreateNavigationProperties = false, EnableFolding = false, HierarchicalNavigation = null]),
  Navigation_1 = Pattern{[workspaceId = "${WS}"]}[Data],
  Navigation_2 = Navigation_1{[lakehouseId = "${GOLD}"]}[Data],
  Navigation_3 = Navigation_2{[Id = "ops", ItemKind = "Schema"]}[Data],
  TableNavigation = Navigation_3{[Id = "dim_crew_roles", ItemKind = "Table"]}[Data]
in
  TableNavigation;
shared helper_count = Table.RowCount(dim_ship_classes);
`;

describe("section documents (Dataflow Gen2 mashup.pq)", () => {
  it("evaluates each shared query and pairs it with its _DataDestination", () => {
    const r = evaluateSection(MASHUP(), host);
    expect(r.error).toBeUndefined();
    expect(r.ok).toBe(true);
    expect(r.section).toBe("Section1");
    expect(r.attributes).toEqual({ StagingDefinition: { Kind: "FastCopy" } });
    expect(r.issues).toEqual([]);
    expect(r.queries.map((q) => [q.name, q.isDestinationQuery, q.result.ok])).toEqual([
      ["dim_ship_classes", false, true],
      ["dim_ship_classes_DataDestination", true, true],
      ["dim_crew_roles", false, true],
      ["dim_crew_roles_DataDestination", true, true],
      ["helper_count", false, true],
    ]);

    const classes = r.queries[0]!;
    expect(classes.result.ok && toJs(classes.result.value)).toEqual([
      { class_code: "FRG", class_name: "Freighter", is_cargo: true },
      { class_code: "TUG", class_name: "Tug", is_cargo: false },
    ]);
    expect(classes.steps.map((s) => s.name).slice(-3)).toEqual(["Promoted headers", "Changed column type", "Sorted rows"]);
    expect(classes.destination).toEqual({
      queryName: "dim_ship_classes_DataDestination",
      found: true,
      isNewTarget: true,
      settingsKind: "Automatic",
      updateMethod: "Replace",
      columnMappings: null,
      target: { workspaceId: WS, lakehouseId: GOLD, lakehouse: "lh_curated", schema: "ops", table: "dim_ship_classes" },
    });
    // A new target doesn't exist yet: the optional navigation `?[Data]?` yields null rather than an error.
    expect(r.queries[1]!.result).toMatchObject({ ok: true, kind: "null" });
  });

  it("reads Manual destination settings with column mappings; unused failing steps stay visible but harmless", () => {
    const r = evaluateSection(MASHUP(), host);
    const roles = r.queries.find((q) => q.name === "dim_crew_roles")!;
    expect(roles.destination).toMatchObject({
      isNewTarget: false,
      settingsKind: "Manual",
      updateMethod: "Replace",
      columnMappings: [{ source: "role", destination: "role" }],
      target: { lakehouse: "lh_curated", schema: "ops", table: "dim_crew_roles" },
    });
    expect(roles.result.ok && toJs(roles.result.value)).toEqual([{ role: "PILOT" }, { role: "NAVIGATOR" }]);
    expect(roles.steps.find((s) => s.name === "Unused")).toMatchObject({ ok: false, value: { message: "never evaluated by the result" } });
    const existing = r.queries.find((q) => q.name === "dim_crew_roles_DataDestination")!;
    expect(existing.result.ok && toJs(existing.result.value)).toEqual([{ role: "pilot" }]);
    expect(r.queries.find((q) => q.name === "helper_count")!.result).toMatchObject({ ok: true, value: 2 });
  });

  it("flags a destination that points at a missing query", () => {
    const doc = `section Section1;
[DataDestinations = {[Definition = [Kind = "Reference", QueryName = "orphan_DataDestination", IsNewTarget = true], Settings = [Kind = "Automatic"]]}]
shared orphan = #table({"a"}, {{1}});`;
    const r = evaluateSection(doc, host);
    expect(r.issues).toEqual(["Query 'orphan' points its data destination at 'orphan_DataDestination', but the section has no query with that name."]);
    expect(r.queries[0]!.destination).toMatchObject({ found: false, target: {} });
  });

  it("reports syntax errors in a section with line and column", () => {
    const r = evaluateSection("section Section1;\nshared a = let x = 1 y = 2 in x;", host);
    expect(r.ok).toBe(false);
    expect(r.error).toMatchObject({ reason: "Expression.SyntaxError", message: "Token Comma expected.", line: 2, col: 22 });
  });
});

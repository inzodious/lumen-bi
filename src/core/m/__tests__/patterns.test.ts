import { Workspace } from "@parity/lakehouse";
import { createNodeDb } from "@parity/lakehouse/node";
import { beforeAll, describe, expect, it } from "vitest";
import { MTable, evaluateQuery, mdate, noHost, toJs, type MHost, type MockWorkbook, type QueryEvaluation } from "../index.ts";
import { DEFAULT_ENDPOINT, mockGuid, workspaceHost } from "../../../../tests/support/m/workspace-host.ts";

let ws: Workspace;
let clock = new Date("2026-09-27T15:00:00Z");
let host: MHost;

const PORT_WORKBOOK: MockWorkbook = {
  sheets: [{ name: "Notes", rows: [["read me"], ["lookup of mock ports"]] }],
  tables: [
    {
      name: "Table1",
      columns: ["Port Code", "Port Name", "Dock Count", "Region", "Harbor Master"],
      rows: [
        ["  CER ", " Ceres Hub", 12, "belt ", 4401],
        ["VES", "Vesta Ring  ", 4, " belt", "Quill"],
        [null, null, null, null, null],
        ["TIT", "Titan Deep", 9, "outer", null],
        ["", "blank code row", 1, "inner", "x"],
        ["CER", "Ceres Hub (dup)", 12, "belt", "Quill"],
      ],
    },
  ],
};

beforeAll(async () => {
  const db = await createNodeDb();
  ws = Workspace.create(db, {
    lakehouses: { lh_bronze: ["dbo", "beacon", "ops"], lh_curated: ["dbo", "beacon", "ops"] },
    defaultLakehouse: "lh_bronze",
    now: () => new Date("2026-09-01T06:00:00Z"),
  });
  ws.saveAsTable(
    "lh_curated.dbo.dim_calendar",
    "SELECT CAST(d AS DATE) AS date, year(d)::INTEGER AS year, month(d)::INTEGER AS month FROM range(TIMESTAMP '2022-01-01', TIMESTAMP '2028-01-01', INTERVAL 1 DAY) t(d)",
  );
  ws.saveAsTable(
    "lh_curated.beacon.fact_transmissions",
    `SELECT * FROM (VALUES
      (5001::BIGINT, 0, 71, TIMESTAMP '2026-09-01 08:15:00', 310.0, false),
      (5001::BIGINT, 1, 72, TIMESTAMP '2026-09-01 08:20:10', 45.5, false),
      (5002::BIGINT, 0, 71, TIMESTAMP '2026-09-02 23:59:59', 12.0, true),
      (5003::BIGINT, 0, 73, TIMESTAMP '2026-09-03 00:00:01', 600.25, false)
    ) v(transmission_id, segment_index, agent_id, transmission_date, duration_sec, is_deleted)`,
  );
  ws.refreshSqlEndpoint("lh_curated");
  ws.saveAsTable("lh_curated.beacon.dim_agents", "SELECT 71 AS agent_id, 'Vega' AS agent_name");

  ws.files.put(
    "lh_bronze/Files/data/helper_tables/dim_ship_classes.csv",
    "class_code,class_name,is_cargo\r\nTUG,Tug,false\r\nFRG,Freighter,true\r\nLNR,Liner,false\r\n",
  );
  ws.files.put("lh_bronze/Files/data/helper_tables/readme.txt", "not a csv");
  ws.files.put("lh_bronze/Files/sharepoint/ops/lookups/port_directory.xlsx", new Uint8Array([0x50, 0x4b, 3, 4]));
  ws.files.put(
    "lh_bronze/Files/sharepoint/ops/lookups/fleet_roster.xlsx",
    JSON.stringify({ parityMockWorkbook: 1, sheets: [{ name: "Roster", rows: [["ship", "class"], ["Aurora", "LNR"], ["Mule", "FRG"]] }] }),
  );
  host = workspaceHost(ws, {
    endpointServer: DEFAULT_ENDPOINT,
    now: () => clock,
    workbooks: { "Files/sharepoint/ops/lookups/port_directory.xlsx": PORT_WORKBOOK },
  });
});

function table(r: QueryEvaluation): Record<string, unknown>[] {
  if (!r.result.ok) throw new Error(`${r.result.error.reason}: ${r.result.error.message}`);
  expect(r.result.value).toBeInstanceOf(MTable);
  return toJs(r.result.value) as Record<string, unknown>[];
}

function oaDate(iso: string): number {
  return (Date.parse(`${iso}T00:00:00Z`) - Date.UTC(1899, 11, 30)) / 86_400_000;
}

const PARAMS = { p_server: DEFAULT_ENDPOINT, p_database: "lh_curated", p_from_date: mdate(2023, 1, 1) };

const DIM_CALENDAR = `let
    Source = Sql.Database(p_server, p_database),
    dim_calendar = Source{[Schema="dbo", Item="dim_calendar"]}[Data],
    RangeStart = p_from_date,
    RangeEnd = Date.EndOfQuarter(DateTime.Date(DateTime.LocalNow())),
    #"Filtered Rows" = Table.SelectRows(dim_calendar, each [date] >= RangeStart and [date] <= RangeEnd),
    #"Added date_sort_desc" = Table.AddColumn(#"Filtered Rows", "date_sort_desc", each - Number.From([date]), Int64.Type),
    #"Added month_end" = Table.AddColumn(#"Added date_sort_desc", "month_end", each Date.EndOfMonth([date]), type date),
    #"Added month_end_sort_desc" = Table.AddColumn(#"Added month_end", "month_end_sort_desc", each - Number.From(Date.EndOfMonth([date])), Int64.Type)
in
    #"Added month_end_sort_desc"`;

describe("semantic model partitions over the SQL endpoint", () => {
  it("dim_calendar: filtered from p_from_date to the end of the current quarter, with sort-desc helpers", () => {
    clock = new Date("2026-09-27T15:00:00Z");
    const r = evaluateQuery(DIM_CALENDAR, { host, parameters: PARAMS });
    const rows = table(r);
    const expectedDays = (Date.UTC(2026, 8, 30) - Date.UTC(2023, 0, 1)) / 86_400_000 + 1;
    expect(rows.length).toBe(expectedDays);
    expect(rows[0]).toEqual({
      date: "2023-01-01",
      year: 2023,
      month: 1,
      date_sort_desc: -oaDate("2023-01-01"),
      month_end: "2023-01-31",
      month_end_sort_desc: -oaDate("2023-01-31"),
    });
    expect(rows.at(-1)).toMatchObject({ date: "2026-09-30", date_sort_desc: -46295, month_end: "2026-09-30" });
    expect(r.steps.map((s) => s.name)).toEqual([
      "Source",
      "dim_calendar",
      "RangeStart",
      "RangeEnd",
      "Filtered Rows",
      "Added date_sort_desc",
      "Added month_end",
      "Added month_end_sort_desc",
    ]);
    expect(r.steps[3]).toMatchObject({ kind: "date", value: { text: "#date(2026, 9, 30)" } });
    const last = r.steps.at(-1)!;
    expect(last.ok && last.value.kind === "table" && last.value.columns.map((c) => c.type)).toEqual([
      "nullable date",
      "Int64.Type",
      "Int64.Type",
      "Int64.Type",
      "date",
      "Int64.Type",
    ]);
    expect(last.ok && last.value.kind === "table" && [last.value.rows.length, last.value.truncated]).toEqual([100, true]);
  });

  it("dim_calendar moves with the injected clock (a new quarter extends the range)", () => {
    clock = new Date("2026-10-01T00:30:00Z");
    const rows = table(evaluateQuery(DIM_CALENDAR, { host, parameters: PARAMS }));
    expect(rows.at(-1)!.date).toBe("2026-12-31");
    clock = new Date("2026-09-27T15:00:00Z");
  });

  it("fact partition: Sql.Database navigation + soft-delete filter + cast after navigation", () => {
    const r = evaluateQuery(
      `let
    Source = Sql.Database(p_server, p_database),
    fact_transmissions = Source{[Schema="beacon", Item="fact_transmissions"]}[Data],
    #"Filtered Rows" = Table.SelectRows(fact_transmissions, each [is_deleted] = false),
    #"Cast Dates" = Table.TransformColumnTypes(#"Filtered Rows", {{"transmission_date", type date}})
in
    #"Cast Dates"`,
      { host, parameters: PARAMS },
    );
    const rows = table(r);
    expect(rows.map((x) => [x.transmission_id, x.segment_index, x.transmission_date])).toEqual([
      [5001, 0, "2026-09-01"],
      [5001, 1, "2026-09-01"],
      [5003, 0, "2026-09-03"],
    ]);
    const nav = r.steps[1]!;
    expect(nav.ok && nav.value.kind === "table" && nav.value.columns.map((c) => `${c.name}:${c.type}`)).toEqual([
      "transmission_id:Int64.Type",
      "segment_index:Int64.Type",
      "agent_id:Int64.Type",
      "transmission_date:nullable datetime",
      "duration_sec:nullable number",
      "is_deleted:nullable logical",
    ]);
    expect(r.result.ok && r.result.preview.kind === "table" && r.result.preview.columns[3]).toEqual({ name: "transmission_date", type: "date" });
  });

  it("simulates SQL endpoint metadata lag and explains it", () => {
    const src = `let Source = Sql.Database("${DEFAULT_ENDPOINT}", "lh_curated"), agents = Source{[Schema="beacon", Item="dim_agents"]}[Data] in agents`;
    const before = evaluateQuery(src, { host });
    expect(before.result.ok).toBe(false);
    if (!before.result.ok) {
      expect(before.result.error.message).toBe(
        "The key didn't match any rows in the table. (Parity: lh_curated.beacon.dim_agents exists in the lakehouse, but the SQL analytics endpoint hasn't synced it yet. Refresh the SQL endpoint, then refresh this query.)",
      );
    }
    ws.refreshSqlEndpoint("lh_curated");
    expect(table(evaluateQuery(src, { host }))).toEqual([{ agent_id: 71, agent_name: "Vega" }]);
  });

  it("rejects an unknown server or database with SQL Server-style errors", () => {
    const bad = evaluateQuery('Sql.Database("prod-sql.example", "lh_curated")', { host });
    expect(bad.result).toMatchObject({ ok: false, error: { reason: "DataSource.Error" } });
    if (!bad.result.ok) expect(bad.result.error.message).toContain("parity-sql.starlane.fabric.mock");
    const db = evaluateQuery(`Sql.Database("${DEFAULT_ENDPOINT}", "lh_platinum")`, { host });
    if (!db.result.ok) expect(db.result.error.message).toMatch(/^Microsoft SQL: Cannot open database "lh_platinum" requested by the login\. The login failed\./);
    expect(db.result.ok).toBe(false);
  });
});

const LAST_REFRESH = `let
    UtcNow = DateTimeZone.UtcNow(),
    Utc = DateTime.From(UtcNow),
    Year = Date.Year(Utc),

    Mar1Dow = Date.DayOfWeek(#datetime(Year, 3, 1, 0, 0, 0), Day.Sunday),
    FirstSunMar = 1 + (if Mar1Dow = 0 then 0 else 7 - Mar1Dow),
    DstStartUtc = #datetime(Year, 3, FirstSunMar + 7, 7, 0, 0),

    Nov1Dow = Date.DayOfWeek(#datetime(Year, 11, 1, 0, 0, 0), Day.Sunday),
    FirstSunNov = 1 + (if Nov1Dow = 0 then 0 else 7 - Nov1Dow),
    DstEndUtc = #datetime(Year, 11, FirstSunNov, 6, 0, 0),

    IsDst = Utc >= DstStartUtc and Utc < DstEndUtc,
    Offset = if IsDst then #duration(0, 4, 0, 0) else #duration(0, 5, 0, 0),
    Eastern = Utc - Offset,

    OutputTable = #table(type table [last_refresh = datetime], {{Eastern}})
in
    OutputTable`;

function refreshStamp(instant: string): string {
  const h: MHost = { ...noHost(), now: () => new Date(instant) };
  const rows = table(evaluateQuery(LAST_REFRESH, { host: h }));
  return rows[0]!.last_refresh as string;
}

const newYork = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York",
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

function newYorkWallClock(ms: number): string {
  const p = Object.fromEntries(newYork.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`;
}

describe("DST-aware last-refresh stamp (injected clock)", () => {
  it.each([
    ["2026-03-08T06:59:59Z", "2026-03-08T01:59:59"],
    ["2026-03-08T07:00:00Z", "2026-03-08T03:00:00"],
    ["2026-11-01T05:59:59Z", "2026-11-01T01:59:59"],
    ["2026-11-01T06:00:00Z", "2026-11-01T01:00:00"],
    ["2027-03-14T06:59:59Z", "2027-03-14T01:59:59"],
    ["2027-03-14T07:00:00Z", "2027-03-14T03:00:00"],
    ["2027-11-07T05:59:59Z", "2027-11-07T01:59:59"],
    ["2027-11-07T06:00:00Z", "2027-11-07T01:00:00"],
    ["2026-07-04T16:00:00Z", "2026-07-04T12:00:00"],
    ["2026-01-01T03:00:00Z", "2025-12-31T22:00:00"],
  ])("at %s the stamp reads %s", (instant, expected) => {
    expect(refreshStamp(instant)).toBe(expected);
  });

  it("agrees with the America/New_York tz database on 150 instants across 2024-2030", () => {
    const start = Date.UTC(2024, 0, 1);
    const step = (Date.UTC(2031, 0, 1) - start) / 150 + 3_607_000;
    for (let i = 0; i < 150; i++) {
      const ms = start + Math.floor(i * step) - ((i * 7919) % 86_400) * 1000;
      expect(refreshStamp(new Date(ms).toISOString())).toBe(newYorkWallClock(ms));
    }
  });
});

describe("dataflow-style sources", () => {
  const WS_ID = () => mockGuid("workspace:Starlane Data Ops");
  const BRONZE_ID = () => mockGuid("lakehouse:lh_bronze");

  it("CSV in lakehouse Files → PromoteHeaders → TransformColumnTypes → Sort", () => {
    const r = evaluateQuery(
      `let
  Source = Lakehouse.Contents(null),
  Navigation = Source{[workspaceId = "${WS_ID()}"]}[Data],
  #"Navigation 1" = Navigation{[lakehouseId = "${BRONZE_ID()}"]}[Data],
  #"Navigation 2" = #"Navigation 1"{[Id = "Files", ItemKind = "Folder"]}[Data],
  #"Navigation 3" = #"Navigation 2"{[Name = "data"]}[Content],
  #"Navigation 4" = #"Navigation 3"{[Name = "helper_tables"]}[Content],
  #"Navigation 5" = #"Navigation 4"{[Name = "dim_ship_classes.csv"]}[Content],
  #"Imported CSV" = Csv.Document(#"Navigation 5", [Delimiter = ",", Columns = 3, QuoteStyle = QuoteStyle.None]),
  #"Promoted headers" = Table.PromoteHeaders(#"Imported CSV", [PromoteAllScalars = true]),
  #"Changed column type" = Table.TransformColumnTypes(#"Promoted headers", {{"class_code", type text}, {"class_name", type text}, {"is_cargo", type logical}}),
  #"Sorted rows" = Table.Sort(#"Changed column type", {{"class_code", Order.Ascending}})
in
  #"Sorted rows"`,
      { host },
    );
    expect(table(r)).toEqual([
      { class_code: "FRG", class_name: "Freighter", is_cargo: true },
      { class_code: "LNR", class_name: "Liner", is_cargo: false },
      { class_code: "TUG", class_name: "Tug", is_cargo: false },
    ]);
    const nav4 = r.steps.find((s) => s.name === "Navigation 4")!;
    expect(nav4.ok && nav4.value.kind === "table" && nav4.value.rows.map((row) => row[1])).toEqual(["dim_ship_classes.csv", "readme.txt"]);
    expect(r.steps.find((s) => s.name === "Navigation 5")).toMatchObject({ kind: "binary" });
  });

  it("navigates by lakehouseName too, and a fixed Columns count silently drops new CSV fields", () => {
    ws.files.put("lh_bronze/Files/data/beacon/drift.csv", 'a,b,c,new_col\n1,"x, y",3,surprise\n');
    const r = evaluateQuery(
      `let
  Files = Lakehouse.Contents(null){[workspaceName = "Starlane Data Ops"]}[Data]{[lakehouseName = "lh_bronze"]}[Data]{[Id = "Files", ItemKind = "Folder"]}[Data],
  Csv = Csv.Document(Files{[Name = "data"]}[Content]{[Name = "beacon"]}[Content]{[Name = "drift.csv"]}[Content], [Delimiter = ",", Columns = 3, Encoding = 65001, QuoteStyle = QuoteStyle.Csv])
in
  Table.PromoteHeaders(Csv, [PromoteAllScalars = true])`,
      { host },
    );
    expect(table(r)).toEqual([{ a: "1", b: "x, y", c: "3" }]);
  });

  it("QuoteStyle.Csv keeps quoted line breaks; QuoteStyle.None splits them", () => {
    ws.files.put("lh_bronze/Files/data/beacon/notes.csv", 'id,note\n1,"line one\nline two"\n');
    const read = (style: string) =>
      table(evaluateQuery(`Csv.Document(File.Contents("Files/data/beacon/notes.csv"), [Delimiter = ",", Columns = 2, QuoteStyle = ${style}])`, { host }));
    expect(read("QuoteStyle.Csv")).toEqual([
      { Column1: "id", Column2: "note" },
      { Column1: "1", Column2: "line one\nline two" },
    ]);
    expect(read("QuoteStyle.None")).toHaveLength(3);
  });

  it("SharePoint/Excel: rename, null-safe Text.Trim(Text.From(_)), type, drop blanks, dedupe, sort", () => {
    const r = evaluateQuery(
      `let
  Source = SharePoint.Files("https://starlane.sharepoint.mock/sites/ops", [ApiVersion = 15]),
  Navigation = Source{[Name = "port_directory.xlsx", #"Folder Path" = "https://starlane.sharepoint.mock/sites/ops/Shared Documents/lookups/"]}[Content],
  #"Imported Excel workbook" = Excel.Workbook(Navigation, null, true),
  Table1 = #"Imported Excel workbook"{[Item = "Table1", Kind = "Table"]}[Data],
  #"Renamed columns" = Table.RenameColumns(Table1, {
    {"Port Code", "port_code"},
    {"Port Name", "port_name"},
    {"Dock Count", "dock_count"},
    {"Region", "region"},
    {"Harbor Master", "harbor_master"}
  }),
  #"Coerced mixed columns" = Table.TransformColumns(#"Renamed columns", {
    {"harbor_master", each if _ = null then null else Text.From(_), type nullable text}
  }),
  #"Trimmed text" = Table.TransformColumns(#"Coerced mixed columns", {
    {"port_code", each if _ = null then null else Text.Trim(Text.From(_)), type nullable text},
    {"port_name", each if _ = null then null else Text.Trim(Text.From(_)), type nullable text},
    {"region", each if _ = null then null else Text.Trim(Text.From(_)), type nullable text},
    {"harbor_master", each if _ = null then null else Text.Trim(_), type nullable text}
  }),
  #"Changed column type" = Table.TransformColumnTypes(#"Trimmed text", {
    {"port_code", type text}, {"port_name", type text}, {"dock_count", Int64.Type}, {"region", type text}, {"harbor_master", type text}
  }),
  #"Removed blank rows" = Table.SelectRows(#"Changed column type", each [port_code] <> null and [port_code] <> ""),
  #"Removed duplicates" = Table.Distinct(#"Removed blank rows", {"port_code"}),
  #"Sorted rows" = Table.Sort(#"Removed duplicates", {{"port_code", Order.Ascending}})
in
  #"Sorted rows"`,
      { host },
    );
    expect(table(r)).toEqual([
      { port_code: "CER", port_name: "Ceres Hub", dock_count: 12, region: "belt", harbor_master: "4401" },
      { port_code: "TIT", port_name: "Titan Deep", dock_count: 9, region: "outer", harbor_master: null },
      { port_code: "VES", port_name: "Vesta Ring", dock_count: 4, region: "belt", harbor_master: "Quill" },
    ]);
    const wb = r.steps.find((s) => s.name === "Imported Excel workbook")!;
    expect(wb.ok && wb.value.kind === "table" && wb.value.rows.map((row) => [row[0], row[3]])).toEqual([
      ["Notes", "Sheet"],
      ["Table1", "Table"],
    ]);
  });

  it("without the null guard, Text.Trim on a number is a per-cell error", () => {
    const r = evaluateQuery(
      `let
  Wb = Excel.Workbook(File.Contents("Files/sharepoint/ops/lookups/port_directory.xlsx"), null, true),
  T = Wb{[Item = "Table1", Kind = "Table"]}[Data],
  Trimmed = Table.TransformColumns(T, {{"Harbor Master", Text.Trim, type nullable text}})
in
  Trimmed[Harbor Master]`,
      { host },
    );
    expect(r.result.ok && r.result.preview.kind === "list" && r.result.preview.items.slice(0, 2)).toEqual([
      { $error: { reason: "Expression.Error", message: "We cannot convert the value 4401 to type Text.", detail: "4401" } },
      "Quill",
    ]);
  });

  it("Excel.Workbook reads a Parity mock-workbook file with headers, and refuses real xlsx bytes clearly", () => {
    const roster = evaluateQuery(`Excel.Workbook(File.Contents("Files/sharepoint/ops/lookups/fleet_roster.xlsx"), true){[Item = "Roster", Kind = "Sheet"]}[Data]`, { host });
    expect(table(roster)).toEqual([
      { ship: "Aurora", class: "LNR" },
      { ship: "Mule", class: "FRG" },
    ]);
    ws.files.put("lh_bronze/Files/sharepoint/ops/lookups/real.xlsx", new Uint8Array([0x50, 0x4b, 3, 4, 0]));
    const real = evaluateQuery(`Excel.Workbook(File.Contents("Files/sharepoint/ops/lookups/real.xlsx"))`, { host });
    expect(real.result.ok).toBe(false);
    if (!real.result.ok) expect(real.result.error.message).toMatch(/^Excel\.Workbook can't read real \.xlsx files in Parity yet/);
  });

  it("File.Contents on a missing file uses Power Query's not-found wording", () => {
    const r = evaluateQuery(`File.Contents("Files/data/nope.csv")`, { host });
    expect(r.result).toMatchObject({ ok: false, error: { reason: "DataSource.NotFound", message: "File or Folder: Could not find file 'Files/data/nope.csv'." } });
  });
});

describe("advanced M patterns", () => {
  it("record-map rating conversion via List.Transform + TransformColumns", () => {
    const r = evaluateQuery(`let
    Source = #table({"passenger_id", "rating_boarding", "rating_cabin", "rating_meals"}, {
      {"P1", "Excellent", "Good", "Not Applicable"},
      {"P2", "Very Good", null, "Poor"},
      {"P3", "Fair", "Superb", "Good"}
    }),
    RatingMap = [Poor = 1, Fair = 2, Good = 3, #"Very Good" = 4, Excellent = 5],
    RatingCols = {"rating_boarding", "rating_cabin", "rating_meals"},
    TransformOperations = List.Transform(RatingCols, each {_, (val) => if val = null or val = "Not Applicable" then null else Record.FieldOrDefault(RatingMap, val, val), Int64.Type}),
    #"Replaced Ratings" = Table.TransformColumns(Source, TransformOperations)
in
    #"Replaced Ratings"`);
    expect(table(r)).toEqual([
      { passenger_id: "P1", rating_boarding: 5, rating_cabin: 3, rating_meals: null },
      { passenger_id: "P2", rating_boarding: 4, rating_cabin: null, rating_meals: 1 },
      { passenger_id: "P3", rating_boarding: 2, rating_cabin: "Superb", rating_meals: 3 },
    ]);
    const ops = r.steps.find((s) => s.name === "TransformOperations")!;
    expect(ops).toMatchObject({ kind: "list", value: { count: 3, items: [{ $kind: "List" }, { $kind: "List" }, { $kind: "List" }] } });
  });

  it("Group + NestedJoin dedupe keeps the latest row per key", () => {
    const r = evaluateQuery(`let
    Source = #table(type table [port_code = text, dock_count = number, modified_date = datetime], {
      {"CER", 10, #datetime(2026, 8, 1, 9, 0, 0)},
      {"CER", 12, #datetime(2026, 9, 1, 9, 0, 0)},
      {"TIT", 9, #datetime(2026, 7, 1, 9, 0, 0)},
      {"VES", 3, #datetime(2026, 6, 1, 9, 0, 0)},
      {"VES", 4, #datetime(2026, 6, 2, 9, 0, 0)},
      {"VES", 5, #datetime(2026, 6, 1, 12, 0, 0)}
    }),
    #"Latest Dates" = Table.Group(Source, {"port_code"}, {{"latest", each List.Max([modified_date]), type datetime}}),
    #"Merged Latest" = Table.NestedJoin(Source, {"port_code", "modified_date"}, #"Latest Dates", {"port_code", "latest"}, "LatestTable", JoinKind.Inner),
    #"Expanded Latest" = Table.ExpandTableColumn(#"Merged Latest", "LatestTable", {"latest"}),
    #"Removed Columns" = Table.RemoveColumns(#"Expanded Latest", {"latest"}),
    #"Sorted Rows" = Table.Sort(#"Removed Columns", {{"port_code", Order.Ascending}})
in
    #"Sorted Rows"`);
    expect(table(r)).toEqual([
      { port_code: "CER", dock_count: 12, modified_date: "2026-09-01T09:00:00" },
      { port_code: "TIT", dock_count: 9, modified_date: "2026-07-01T09:00:00" },
      { port_code: "VES", dock_count: 4, modified_date: "2026-06-02T09:00:00" },
    ]);
    const grouped = r.steps.find((s) => s.name === "Latest Dates")!;
    expect(grouped.ok && grouped.value.kind === "table" && grouped.value.columns).toEqual([
      { name: "port_code", type: "text" },
      { name: "latest", type: "datetime" },
    ]);
  });

  it("Group with each _ keeps nested tables, and Table.First picks a row per group", () => {
    const rows = table(
      evaluateQuery(`let
    Source = #table({"ip", "at", "score"}, {{"a", 2, 9}, {"a", 1, 7}, {"b", 5, 3}}),
    Grouped = Table.Group(Source, {"ip"}, {{"rows", each _, type table}, {"first", each Table.First(Table.Sort(_, {{"at", Order.Ascending}}))}}),
    Expanded = Table.ExpandRecordColumn(Grouped, "first", {"at", "score"}),
    Counted = Table.AddColumn(Expanded, "n", each Table.RowCount([rows]), Int64.Type)
in
    Table.RemoveColumns(Counted, {"rows"})`),
    );
    expect(rows).toEqual([
      { ip: "a", at: 1, score: 7, n: 2 },
      { ip: "b", at: 5, score: 3, n: 1 },
    ]);
  });
});

import { describe, expect, it } from "vitest";
import { MError, evaluate, evaluateQuery, noHost, toJs } from "../index.ts";

const js = (src: string) => toJs(evaluate(src));

function mError(src: string): MError {
  try {
    toJs(evaluate(src));
  } catch (e) {
    if (e instanceof MError) return e;
    throw e;
  }
  throw new Error(`expected an M error from: ${src}`);
}

const PORTS = `#table(type table [port_code = text, port_name = text, dock_count = number, region = text], {
  {"CER", "Ceres Hub", 12, "belt"},
  {"VES", "Vesta Ring", 4, "belt"},
  {"TIT", "Titan Deep", 9, "outer"},
  {"LUN", "Luna Gate", 20, "inner"}
})`;

describe("Table functions", () => {
  it("SelectRows, AddColumn with a type, and SelectColumns", () => {
    const r = js(`let
      t = ${PORTS},
      #"Filtered Rows" = Table.SelectRows(t, each [dock_count] >= 9),
      #"Added docks_x2" = Table.AddColumn(#"Filtered Rows", "docks_x2", each [dock_count] * 2, Int64.Type),
      #"Removed Other Columns" = Table.SelectColumns(#"Added docks_x2", {"port_code", "docks_x2"})
    in #"Removed Other Columns"`);
    expect(r).toEqual([
      { port_code: "CER", docks_x2: 24 },
      { port_code: "TIT", docks_x2: 18 },
      { port_code: "LUN", docks_x2: 40 },
    ]);
  });

  it("RenameColumns, RemoveColumns, ReorderColumns, ColumnNames", () => {
    expect(js(`Table.ColumnNames(Table.RenameColumns(${PORTS}, {{"port_name", "name"}, {"dock_count", "docks"}}))`)).toEqual(["port_code", "name", "docks", "region"]);
    expect(js(`Table.ColumnNames(Table.RenameColumns(${PORTS}, {"port_name", "name"}))`)).toEqual(["port_code", "name", "dock_count", "region"]);
    expect(js(`Table.ColumnNames(Table.RemoveColumns(${PORTS}, {"region", "dock_count"}))`)).toEqual(["port_code", "port_name"]);
    expect(js(`Table.ColumnNames(Table.ReorderColumns(${PORTS}, {"region", "port_code"}))`)).toEqual(["region", "port_name", "dock_count", "port_code"]);
    expect(js(`Table.ColumnNames(Table.RenameColumns(${PORTS}, {{"nope", "x"}}, MissingField.Ignore))`)).toEqual(["port_code", "port_name", "dock_count", "region"]);
  });

  it("Sort ascending/descending with multiple keys, stable, nulls first", () => {
    expect(js(`Table.Column(Table.Sort(${PORTS}, {{"region", Order.Ascending}, {"dock_count", Order.Descending}}), "port_code")`)).toEqual(["CER", "VES", "LUN", "TIT"]);
    expect(js(`Table.Column(Table.Sort(${PORTS}, "port_code"), "port_code")`)).toEqual(["CER", "LUN", "TIT", "VES"]);
    expect(js(`Table.Column(Table.Sort(#table({"a"}, {{3}, {null}, {1}}), {{"a", Order.Ascending}}), "a")`)).toEqual([null, 1, 3]);
  });

  it("Group with List.Sum, Table.RowCount and a kept nested table", () => {
    const r = evaluateQuery(`let
      t = ${PORTS},
      #"Grouped Rows" = Table.Group(t, {"region"}, {
        {"ports", each Table.RowCount(_), Int64.Type},
        {"docks", each List.Sum([dock_count]), type number},
        {"all", each _, type table}
      })
    in #"Grouped Rows"`);
    expect(r.result.ok).toBe(true);
    if (!r.result.ok) return;
    expect(r.result.preview).toMatchObject({
      kind: "table",
      columns: [
        { name: "region", type: "text" },
        { name: "ports", type: "Int64.Type" },
        { name: "docks", type: "number" },
        { name: "all", type: "table" },
      ],
      rows: [
        ["belt", 2, 16, { $kind: "Table" }],
        ["outer", 1, 9, { $kind: "Table" }],
        ["inner", 1, 20, { $kind: "Table" }],
      ],
    });
  });

  it("NestedJoin (LeftOuter / Inner / LeftAnti) and ExpandTableColumn", () => {
    const base = `let
      ports = ${PORTS},
      crews = #table({"port_code", "crew"}, {{"CER", "Ada"}, {"CER", "Lin"}, {"TIT", "Oso"}, {"MAR", "Kai"}}),
      j = Table.NestedJoin(ports, {"port_code"}, crews, {"port_code"}, "crews", KIND)
    in Table.ExpandTableColumn(j, "crews", {"crew"}, {"crew_name"})`;
    const pick = (kind: string) => (js(base.replace("KIND", kind)) as Record<string, unknown>[]).map((r) => [r.port_code, r.crew_name]);
    expect(pick("JoinKind.LeftOuter")).toEqual([
      ["CER", "Ada"],
      ["CER", "Lin"],
      ["VES", null],
      ["TIT", "Oso"],
      ["LUN", null],
    ]);
    expect(pick("JoinKind.Inner")).toEqual([
      ["CER", "Ada"],
      ["CER", "Lin"],
      ["TIT", "Oso"],
    ]);
    expect(pick("JoinKind.LeftAnti")).toEqual([
      ["VES", null],
      ["LUN", null],
    ]);
    expect(pick("JoinKind.FullOuter")).toContainEqual([null, "Kai"]);
  });

  it("Distinct, Skip, FirstN, RowCount, ToRecords, FromRecords, FromRows", () => {
    expect(js(`Table.RowCount(Table.Distinct(${PORTS}, {"region"}))`)).toBe(3);
    expect(js(`Table.Column(Table.Skip(${PORTS}, 2), "port_code")`)).toEqual(["TIT", "LUN"]);
    expect(js(`Table.Column(Table.FirstN(${PORTS}, each [region] = "belt"), "port_code")`)).toEqual(["CER", "VES"]);
    expect(js(`Table.ToRecords(Table.FirstN(${PORTS}, 1))`)).toEqual([{ port_code: "CER", port_name: "Ceres Hub", dock_count: 12, region: "belt" }]);
    expect(js(`Table.FromRecords({[a = 1, b = "x"], [a = 2, b = "y"]})`)).toEqual([
      { a: 1, b: "x" },
      { a: 2, b: "y" },
    ]);
    expect(js(`Table.FromRows({{1, "x"}}, {"n", "s"})`)).toEqual([{ n: 1, s: "x" }]);
    expect(js(`Table.RowCount(Table.FromRows({}, type table [placeholder = text]))`)).toBe(0);
  });

  it("ReplaceValue with ReplaceValue and ReplaceText replacers; Combine", () => {
    const t = `#table({"a", "b"}, {{"", "x-1"}, {"k", "x-2"}, {null, "y"}})`;
    expect(js(`Table.Column(Table.ReplaceValue(${t}, "", null, Replacer.ReplaceValue, {"a"}), "a")`)).toEqual([null, "k", null]);
    expect(js(`Table.Column(Table.ReplaceValue(${t}, "x-", "X", Replacer.ReplaceText, {"b"}), "b")`)).toEqual(["X1", "X2", "y"]);
    expect(js(`Table.Combine({#table({"a"}, {{1}}), #table({"b", "a"}, {{"z", 2}})})`)).toEqual([
      { a: 1, b: null },
      { a: 2, b: "z" },
    ]);
  });

  it("TransformColumnTypes turns bad cells into cell errors, and ignores the culture argument", () => {
    const r = evaluateQuery(`let
      Source = #table({"id", "qty", "day"}, {{"1", "3.5", "2026-01-15"}, {"2", "abc", "1/31/2026"}}),
      #"Changed Type" = Table.TransformColumnTypes(Source, {{"id", Int64.Type}, {"qty", type number}, {"day", type date}}, "en-US")
    in #"Changed Type"`);
    expect(r.result.ok).toBe(true);
    if (!r.result.ok) return;
    expect(r.result.preview).toMatchObject({
      columns: [
        { name: "id", type: "Int64.Type" },
        { name: "qty", type: "number" },
        { name: "day", type: "date" },
      ],
      rows: [
        [1, 3.5, "2026-01-15"],
        [2, { $error: { reason: "DataFormat.Error", message: "We couldn't convert to Number.", detail: "abc" } }, "2026-01-31"],
      ],
    });
    expect(js(`Table.RowCount(Table.RemoveRowsWithErrors(Table.TransformColumnTypes(#table({"q"}, {{"1"}, {"x"}}), {{"q", type number}})))`)).toBe(1);
    expect(js(`Table.TransformColumnTypes(#table({"n"}, {{"2.5"}, {"3.5"}}), {{"n", Int64.Type}})[n]`)).toEqual([2, 4]);
  });

  it("an error cell only fails the step when a later step needs that value", () => {
    const r = evaluateQuery(`let
      Source = Table.TransformColumnTypes(#table({"q"}, {{"1"}, {"x"}}), {{"q", type number}}),
      Total = List.Sum(Source[q])
    in Total`);
    expect(r.result).toMatchObject({ ok: false, error: { reason: "DataFormat.Error", message: "We couldn't convert to Number." } });
    expect(r.steps[0]!.ok).toBe(true);
  });

  it("uses Power Query's wording for missing columns and fields", () => {
    expect(mError(`Table.SelectColumns(${PORTS}, {"port_id"})`).message).toBe("The column 'port_id' of the table wasn't found.");
    expect(mError(`Table.RenameColumns(${PORTS}, {{"Port Code", "port_code"}})`).message).toBe("The column 'Port Code' of the table wasn't found.");
    expect(mError(`Table.Sort(${PORTS}, {{"docks", Order.Ascending}})`).message).toBe("The column 'docks' of the table wasn't found.");
    expect(mError(`Table.AddColumn(${PORTS}, "region", each 1)`).message).toBe("The field 'region' already exists in the record.");
    expect(mError(`${PORTS}[docks]`).message).toBe("The column 'docks' of the table wasn't found.");
    const cellErr = js(`Table.AddColumn(${PORTS}, "x", each [docks])`) as Record<string, unknown>[];
    expect(cellErr[0]!.x).toEqual({ $error: { reason: "Expression.Error", message: "The field 'docks' of the record wasn't found.", detail: "docks", line: 6, col: 15 } });
  });

  it("PromoteHeaders with PromoteAllScalars and de-duplicated names", () => {
    expect(js(`Table.PromoteHeaders(#table({"Column1", "Column2", "Column3"}, {{"id", 2026, "id"}, {"a", "b", "c"}}), [PromoteAllScalars = true])`)).toEqual([{ id: "a", "2026": "b", id_1: "c" }]);
    expect(js(`Table.ColumnNames(Table.PromoteHeaders(#table({"Column1", "Column2"}, {{"id", 5}}), [PromoteAllScalars = false]))`)).toEqual(["id", "Column2"]);
  });

  it("TransformColumns with a default transformation and FillDown", () => {
    expect(js(`Table.TransformColumns(#table({"a", "b"}, {{1, 2}}), {{"a", each _ + 1}}, each _ * 100)`)).toEqual([{ a: 2, b: 200 }]);
    expect(js(`Table.FillDown(#table({"a"}, {{1}, {null}, {3}, {null}}), {"a"})[a]`)).toEqual([1, 1, 3, 3]);
  });
});

describe("List and Record functions", () => {
  it("aggregates ignore nulls", () => {
    expect(js("List.Sum({1, null, 2})")).toBe(3);
    expect(js("List.Sum({})")).toBe(null);
    expect(js("List.Max({3, null, 7, 1})")).toBe(7);
    expect(js("List.Min({#date(2026, 2, 1), #date(2026, 1, 1)})")).toBe("2026-01-01");
    expect(js("List.Max({}, -1)")).toBe(-1);
    expect(js("List.Count({1, null})")).toBe(2);
  });

  it("Distinct, Contains, First, Last, Dates, Generate, Accumulate", () => {
    expect(js('List.Distinct({1, 1, "1", null, null})')).toEqual([1, "1", null]);
    expect(js('List.Contains({"Ceres", "Titan"}, "titan")')).toBe(false);
    expect(js('List.Contains({"Ceres", "Titan"}, "titan", Comparer.OrdinalIgnoreCase)')).toBe(true);
    expect(js("List.First({})")).toBe(null);
    expect(js("List.Last({1, 2, 3})")).toBe(3);
    expect(js("List.Dates(#date(2026, 2, 27), 3, #duration(1, 0, 0, 0))")).toEqual(["2026-02-27", "2026-02-28", "2026-03-01"]);
    expect(js("List.Generate(() => 1, each _ <= 16, each _ * 2)")).toEqual([1, 2, 4, 8, 16]);
    expect(js("List.Generate(() => [i = 0], each [i] < 3, each [i = [i] + 1], each [i] * 10)")).toEqual([0, 10, 20]);
    expect(js("List.Accumulate({1, 2, 3, 4}, 0, (state, current) => state + current)")).toBe(10);
  });

  it("Record.Field and Record.FieldOrDefault", () => {
    expect(js('Record.Field([a = 1], "a")')).toBe(1);
    expect(js('Record.FieldOrDefault([a = 1], "b", "none")')).toBe("none");
    expect(js('Record.FieldOrDefault([a = 1], "b")')).toBe(null);
    expect(mError('Record.Field([a = 1], "b")').message).toBe("The field 'b' of the record wasn't found.");
  });
});

describe("Text, Number, Date and Logical functions", () => {
  it("text functions are null-safe and match Power Query results", () => {
    expect(js('Text.Trim("  Ceres Hub  ")')).toBe("Ceres Hub");
    expect(js("Text.Trim(null)")).toBe(null);
    expect(js('Text.Upper("ab") & Text.Lower("CD") & Text.Proper("hELLO wORLD")')).toBe("ABcdHello World");
    expect(js('Text.Start("Starlane", 4) & "|" & Text.End("Starlane", 4)')).toBe("Star|lane");
    expect(js('Text.Contains("Starlane", "lane")')).toBe(true);
    expect(js('Text.Replace("a-b-c", "-", "/")')).toBe("a/b/c");
    expect(js('Text.Split("a,b,,c", ",")')).toEqual(["a", "b", "", "c"]);
    expect(js('Text.Combine({"a", null, "b"}, ", ")')).toBe("a, b");
    expect(js('Text.PadStart("7", 3, "0")')).toBe("007");
    expect(js('Text.Length("Parity")')).toBe(6);
    expect(js('Text.BeforeDelimiter("Delayed - weather", "-")')).toBe("Delayed ");
    expect(js('Text.AfterDelimiter("a-b-c", "-", 1)')).toBe("c");
    expect(js('Text.AfterDelimiter("a-b-c", "-", {0, RelativePosition.FromEnd})')).toBe("c");
    expect(js('Text.BeforeDelimiter("no delimiter", "-")')).toBe("no delimiter");
    expect(js("Text.From(true) & Text.From(12.5) & Text.From(#date(2026, 9, 27))")).toBe("true12.59/27/2026");
  });

  it("number conversion, rounding (banker's by default) and formatting", () => {
    expect(js('Number.From("1,234.5")')).toBe(1234.5);
    expect(js("Number.From(#date(2026, 9, 30))")).toBe(46295);
    expect(js("Number.Round(2.5)")).toBe(2);
    expect(js("Number.Round(3.5)")).toBe(4);
    expect(js("Number.Round(2.345, 2)")).toBe(2.34);
    expect(js("Number.Round(1.2345, 3)")).toBe(1.234);
    expect(js("Number.Round(2.5, 0, RoundingMode.AwayFromZero)")).toBe(3);
    expect(js('Number.ToText(1234.5, "N2")')).toBe("1,234.50");
    expect(js('Number.ToText(0.125, "P1")')).toBe("12.5%");
    expect(js('Number.ToText(42, "D5")')).toBe("00042");
    expect(js('Number.ToText(3.14159, "0.00")')).toBe("3.14");
    expect(mError('Number.From("abc")')).toMatchObject({ reason: "DataFormat.Error", message: "We couldn't convert to Number." });
    expect(mError('Number.Round("abc")').message).toBe('We cannot convert the value "abc" to type Number.');
  });

  it("date functions", () => {
    expect(js("Date.EndOfMonth(#date(2024, 2, 10))")).toBe("2024-02-29");
    expect(js("Date.StartOfMonth(#date(2026, 9, 27))")).toBe("2026-09-01");
    expect(js("Date.EndOfQuarter(#date(2026, 9, 27))")).toBe("2026-09-30");
    expect(js("Date.EndOfQuarter(#date(2026, 10, 1))")).toBe("2026-12-31");
    expect(js("Date.AddMonths(#date(2026, 1, 31), 1)")).toBe("2026-02-28");
    expect(js("Date.AddDays(#date(2026, 12, 31), 1)")).toBe("2027-01-01");
    expect(js("{Date.Year(#date(2026, 9, 27)), Date.Month(#date(2026, 9, 27)), Date.Day(#date(2026, 9, 27))}")).toEqual([2026, 9, 27]);
    expect(js("Date.DayOfWeek(#date(2026, 3, 1), Day.Sunday)")).toBe(0);
    expect(js("Date.DayOfWeek(#date(2026, 3, 1), Day.Monday)")).toBe(6);
    expect(js('Date.ToText(#date(2026, 9, 27), "yyyy-MM-dd")')).toBe("2026-09-27");
    expect(js('Date.ToText(#date(2026, 9, 27), [Format = "MMM yyyy", Culture = "en-US"])')).toBe("Sep 2026");
    expect(js("Date.EndOfMonth(#datetime(2026, 2, 3, 10, 0, 0))")).toBe("2026-02-28T23:59:59.999");
    expect(js('Date.From("2026-02-03")')).toBe("2026-02-03");
    expect(mError('Date.From("not a date")')).toMatchObject({ reason: "DataFormat.Error", message: "We couldn't parse the input provided as a Date value." });
    expect(mError("#date(2026, 2, 30)").message).toBe("The arguments provided do not represent a valid Date value.");
  });

  it("datetime, datetimezone and duration functions", () => {
    expect(js("DateTime.Date(#datetime(2026, 3, 8, 23, 30, 0))")).toBe("2026-03-08");
    expect(js("DateTime.From(#date(2026, 3, 8))")).toBe("2026-03-08T00:00:00");
    expect(js("DateTimeZone.SwitchZone(#datetimezone(2026, 3, 8, 7, 0, 0, 0, 0), -4)")).toBe("2026-03-08T03:00:00-04:00");
    expect(js("DateTimeZone.RemoveZone(#datetimezone(2026, 3, 8, 7, 0, 0, -5, 0))")).toBe("2026-03-08T07:00:00");
    expect(js("DateTime.AddZone(#datetime(2026, 3, 8, 7, 0, 0), 5, 30)")).toBe("2026-03-08T07:00:00+05:30");
    expect(js("Duration.Days(#duration(2, 23, 0, 0))")).toBe(2);
    expect(js('Duration.From("1.02:30:00")')).toBe("1.02:30:00");
    expect(js("Duration.TotalHours(Duration.From(0.5))")).toBe(12);
    expect(js('Logical.From("TRUE") and Logical.From(1) and not Logical.From(0)')).toBe(true);
    expect(mError('Logical.From("maybe")').message).toBe("We couldn't convert to Logical.");
  });
});

describe("sources and clocks without a lakehouse", () => {
  it("Json.Document parses text into records and lists, and reports bad JSON", () => {
    expect(js(`Json.Document("{""ship"": ""Aurora"", ""decks"": [1, 2], ""active"": true, ""captain"": null}")`)).toEqual({
      ship: "Aurora",
      decks: [1, 2],
      active: true,
      captain: null,
    });
    expect(js(`Table.FromRecords(Json.Document("[{""a"": 1}, {""a"": 2}]"))[a]`)).toEqual([1, 2]);
    expect(mError(`Json.Document("{oops")`)).toMatchObject({ reason: "DataFormat.Error", message: "We found an unexpected character in the JSON input." });
  });

  it("Csv.Document accepts text directly and positional arguments", () => {
    expect(js(`Csv.Document("a;b#(lf)1;2", 2, ";")`)).toEqual([
      { Column1: "a", Column2: "b" },
      { Column1: "1", Column2: "2" },
    ]);
  });

  it("every clock function reads host.now(); local time follows localOffsetMinutes (UTC by default, like the service)", () => {
    const at = new Date("2026-07-04T16:00:00Z");
    const service = { host: { ...noHost(), now: () => at } };
    const desktop = { host: { ...noHost(), now: () => at, localOffsetMinutes: -240 } };
    const q = "{DateTime.LocalNow(), DateTimeZone.UtcNow(), DateTimeZone.LocalNow(), DateTime.From(DateTimeZone.UtcNow())}";
    expect(toJs(evaluate(q, service))).toEqual(["2026-07-04T16:00:00", "2026-07-04T16:00:00+00:00", "2026-07-04T16:00:00+00:00", "2026-07-04T16:00:00"]);
    expect(toJs(evaluate(q, desktop))).toEqual(["2026-07-04T12:00:00", "2026-07-04T16:00:00+00:00", "2026-07-04T12:00:00-04:00", "2026-07-04T12:00:00"]);
  });

  it("a non-let query has no steps; syntax errors come back as results, not exceptions", () => {
    expect(evaluateQuery("1 + 1")).toMatchObject({ steps: [], result: { ok: true, kind: "number", value: 2 } });
    expect(evaluateQuery("let a = in a").result).toMatchObject({ ok: false, error: { reason: "Expression.SyntaxError", message: "Token Literal expected. Found 'in'.", line: 1, col: 9 } });
  });

  it("more exact error wording", () => {
    expect(mError(`Table.FromRecords({[a = 1], [b = 2]})`).message).toBe("The field 'a' of the record wasn't found.");
    expect(mError(`Table.ExpandTableColumn(#table({"k"}, {{1}}), "zzz", {"a"})`).message).toBe("The column 'zzz' of the table wasn't found.");
    expect(mError(`Table.RenameColumns(#table({"a", "b"}, {}), {{"a", "b"}})`).message).toBe("The field 'b' already exists in the record.");
    expect(mError("1(2)").message).toBe("We cannot convert the value 1 to type Function.");
    expect(mError('"abc"[x]').message).toBe("We cannot apply field access to the type Text.");
    expect(mError("not 1").message).toBe("We cannot convert the value 1 to type Logical.");
    expect(mError('Table.SelectRows(#table({"a"}, {{1}}), each [a] + 1)').message).toBe("We cannot convert the value 2 to type Logical.");
  });
});

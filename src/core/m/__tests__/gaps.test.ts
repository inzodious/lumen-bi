import { describe, expect, it } from "vitest";
import { MError, evaluate, evaluateParameter, evaluateQuery, evaluateSection, toJs } from "../index.ts";

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

describe("metadata on primitive values", () => {
  it("survives a let binding, a record field and an if", () => {
    expect(js('let p = "lh_curated" meta [Type = "Text"] in Value.Metadata(p)[Type]')).toBe("Text");
    expect(js('let p = 5 meta [IsParameterQuery = true], q = p in Value.Metadata(q)')).toEqual({ IsParameterQuery: true });
    expect(js('let r = [a = "x" meta [T = 1]] in Value.Metadata(r[a])')).toEqual({ T: 1 });
    expect(js('let p = if true then "a" meta [T = 1] else "b" in Value.Metadata(p)')).toEqual({ T: 1 });
    expect(js('let p = "lh_curated" meta [Type = "Text"] in p & "_x"')).toBe("lh_curated_x");
  });

  it("merges metadata records (x meta a meta b), later fields winning", () => {
    expect(js('Value.Metadata("x" meta [a = 1, b = 1] meta [b = 2])')).toEqual({ a: 1, b: 2 });
    expect(js('let p = "x" meta [a = 1], q = p meta [b = 2] in Value.Metadata(q)')).toEqual({ a: 1, b: 2 });
  });

  it("works for section members, sibling queries and evaluateParameter", () => {
    const doc = `section Section1;
shared lakehouse_name = "lh_curated" meta [IsParameterQuery = true, Type = "Text", IsParameterQueryRequired = true];
shared wrapped = let x = "lh_silver" meta [Type = "Text"] in x;
shared kind = Value.Metadata(lakehouse_name)[Type] & "/" & Value.Metadata(wrapped)[Type];`;
    const ev = evaluateSection(doc);
    expect(ev.queries.find((q) => q.name === "kind")!.result).toMatchObject({ ok: true, value: "Text/Text" });

    const q = evaluateQuery("Value.Metadata(lh)[Type]", { queries: { lh: '"lh_curated" meta [IsParameterQuery = true, Type = "Text"]' } });
    expect(q.result).toMatchObject({ ok: true, value: "Text" });

    const p = evaluateParameter('let v = "lh_curated" meta [IsParameterQuery = true, Type = "Text"] in v');
    expect(p).toMatchObject({ value: "lh_curated", isParameterQuery: true, meta: { Type: "Text" } });
  });
});

describe("Date.FromText / DateTime.FromText Format and Culture", () => {
  it("honours Format strictly", () => {
    const e = mError('Date.FromText("09/15/2026", [Format = "yyyy-MM-dd", Culture = "en-US"])');
    expect(e.reason).toBe("DataFormat.Error");
    expect(e.message).toBe("We couldn't parse the input provided as a Date value.");
    expect(js('Date.FromText("03/04/2026", [Format = "dd/MM/yyyy"])')).toBe("2026-04-03");
    expect(js('Date.FromText("3/4/2026", [Format = "d/M/yyyy"])')).toBe("2026-04-03");
    expect(mError('Date.FromText("3/04/2026", [Format = "dd/MM/yyyy"])').reason).toBe("DataFormat.Error");
    expect(mError('Date.FromText("31/02/2026", [Format = "dd/MM/yyyy"])').reason).toBe("DataFormat.Error");
    expect(js('Date.FromText("15-Sep-2026", [Format = "dd-MMM-yyyy"])')).toBe("2026-09-15");
    expect(js('Date.FromText("September 15, 2026", [Format = "MMMM d, yyyy"])')).toBe("2026-09-15");
    expect(js('Date.FromText("2026", [Format = "yyyy"])')).toBe("2026-01-01");
  });

  it("reads two-digit years with the 1950-2049 window from the docs", () => {
    expect(js('{Date.FromText("24-Jan-49", [Format = "dd-MMM-yy"]), Date.FromText("24-Jan-50", [Format = "dd-MMM-yy"])}')).toEqual(["2049-01-24", "1950-01-24"]);
    const r = js(`List.Transform({"30-12-2011", "12-30-2011", "30-12-11", "12-30-11"}, each try DateTime.FromText(_, [Format = "MM-dd-yy"]) otherwise null)`);
    expect(r).toEqual([null, null, null, "2011-12-30T00:00:00"]);
  });

  it("parses times in DateTime.FromText", () => {
    expect(js('DateTime.FromText("2026-09-15 14:05", [Format = "yyyy-MM-dd HH:mm"])')).toBe("2026-09-15T14:05:00");
    expect(js('DateTime.FromText("09/15/2026 02:05:09 PM", [Format = "MM/dd/yyyy hh:mm:ss tt"])')).toBe("2026-09-15T14:05:09");
    expect(js('DateTime.FromText("2026-09-15T12:00:00", [Format = "yyyy-MM-ddTHH:mm:ss"])')).toBe("2026-09-15T12:00:00");
    expect(js('Time.FromText("7:30 PM", [Format = "h:mm tt"])')).toBe("19:30:00");
  });

  it("maps / to the culture's date separator", () => {
    expect(js('Date.FromText("30.12.2010", [Format = "dd/MM/yyyy", Culture = "de-DE"])')).toBe("2010-12-30");
    expect(js('Date.FromText("30 Dezember 2010", [Format = "dd MMMM yyyy", Culture = "de-DE"])')).toBe("2010-12-30");
    expect(js('Date.FromText("15 août 2026", [Format = "d MMMM yyyy", Culture = "fr-FR"])')).toBe("2026-08-15");
  });

  it("uses the legacy text culture argument for best-effort parsing", () => {
    expect(js('Date.FromText("15/09/2026", "en-GB")')).toBe("2026-09-15");
    expect(js('Date.FromText("15/09/2026", [Culture = "fr-FR"])')).toBe("2026-09-15");
    expect(js('Date.FromText("15.09.2026", "de-DE")')).toBe("2026-09-15");
    expect(js('Date.FromText("2026-09-15", "de-DE")')).toBe("2026-09-15");
    expect(js('DateTime.FromText("15/03/2026 14:30:00", "en-GB")')).toBe("2026-03-15T14:30:00");
    expect(mError('Date.FromText("15/09/2026")').reason).toBe("DataFormat.Error");
    expect(mError('Date.FromText("09/15/2026", "en-GB")').reason).toBe("DataFormat.Error");
  });

  it("refuses what Parity can't reproduce exactly", () => {
    expect(mError('Date.FromText("30 Dez 2010", [Format = "dd MMM yyyy", Culture = "de-DE"])').message).toMatch(/not supported in Lumen yet/);
    expect(mError('Date.FromText("09-15", [Format = "MM-dd"])').message).toMatch(/without a year .* not supported in Lumen yet/);
    expect(mError('Date.FromText("2026-09-15 10:00", [Format = "yyyy-MM-dd HH:mm"])').message).toMatch(/"HH" is not supported in Lumen yet/);
    expect(mError('Date.FromText("Tue 15/09/2026", [Format = "ddd dd/MM/yyyy"])').message).toMatch(/"ddd" is not supported in Lumen yet/);
    expect(mError('Date.FromText("15/09/2026", [Format = "D"])').message).toMatch(/standard format "D" is not supported in Lumen yet/);
  });
});

describe("cultures", () => {
  it("parses numbers per culture", () => {
    expect(js('Number.FromText("1.234,5", "de-DE")')).toBe(1234.5);
    expect(js('Number.From("1,5", "fr-FR")')).toBe(1.5);
    expect(js('Number.FromText("1 234,5", "fr-FR")')).toBe(1234.5);
    expect(js('Number.FromText("1#(00A0)234,5", "fr-FR")')).toBe(1234.5);
    expect(js('Number.FromText("1#(202F)234,5", "fr-FR")')).toBe(1234.5);
    expect(js('Number.FromText("3,423.10", "en-GB")')).toBe(3423.1);
    expect(js('Number.From("9,5")')).toBe(95);
    expect(js('Number.FromText("1.5", "de-DE")')).toBe(15);
    expect(js('Int64.From("2,5", "de-DE")')).toBe(2);
    expect(mError('Number.FromText("1,2.5", "de-DE")').reason).toBe("DataFormat.Error");
  });

  it("formats numbers and dates per culture", () => {
    expect(js('Text.From(1.5, "de-DE")')).toBe("1,5");
    expect(js('Number.ToText(1234.5, "N2", "de-DE")')).toBe("1.234,50");
    expect(js('Number.ToText(1234.5, "F1", "fr-FR")')).toBe("1234,5");
    expect(js('Date.ToText(#date(2024, 3, 24), [Culture = "fr-FR"])')).toBe("24/03/2024");
    expect(js('Date.ToText(#date(2024, 3, 12), null, "de-DE")')).toBe("12.03.2024");
    expect(js('Date.ToText(#date(2024, 3, 12), [Format = "dd/MM/yyyy", Culture = "de-DE"])')).toBe("12.03.2024");
    expect(mError('Number.ToText(0.5, "P1", "de-DE")').message).toMatch(/not supported in Lumen yet/);
  });

  it("fails loudly on other cultures", () => {
    const e = mError('Number.FromText("1", "ja-JP")');
    expect(e.message).toBe("The culture 'ja-JP' is not supported in Lumen yet. Lumen supports en-US, en-GB, de-DE and fr-FR.");
    expect(mError('Table.TransformColumnTypes(#table({"a"}, {{"1"}}), {{"a", type number}}, "nl-NL")').message).toMatch(/not supported in Lumen yet/);
  });

  it("Table.TransformColumnTypes honours its culture argument", () => {
    expect(js('Table.TransformColumnTypes(#table({"a"}, {{"15/03/2026"}}), {{"a", type date}}, "en-GB")')).toEqual([{ a: "2026-03-15" }]);
    expect(js('Table.TransformColumnTypes(#table({"a", "b"}, {{"15.03.2026", "1.234,5"}}), {{"a", type date}, {"b", type number}}, "de-DE")')).toEqual([
      { a: "2026-03-15", b: 1234.5 },
    ]);
    // Microsoft Learn Table.TransformColumnTypes examples 2-4.
    expect(js('Table.TransformColumnTypes(#table(type table [Date = date], {{#date(2024, 3, 24)}, {#date(2023, 12, 31)}}), {"Date", type text}, "fr-FR")')).toEqual([
      { Date: "24/03/2024" },
      { Date: "31/12/2023" },
    ]);
    expect(js('Table.TransformColumnTypes(#table(type table [Date = date, Value = number], {{#date(2024, 3, 12), .24368}}), {{"Date", type text}, {"Value", Percentage.Type}}, "de-DE")')).toEqual([
      { Date: "12.03.2024", Value: 0.24368 },
    ]);
    expect(
      js('Table.TransformColumnTypes(#table(type table [Date = date], {{#date(2024, 10, 5)}}), {{"Date", type text}, {"NewColumn", type number}}, [Culture = "fr-FR", MissingField = MissingField.UseNull])'),
    ).toEqual([{ Date: "05/10/2024", NewColumn: null }]);
    expect(mError('Table.TransformColumnTypes(#table({"a"}, {{"1"}}), {{"b", type number}}, "en-GB")').message).toBe("The column 'b' of the table wasn't found.");
  });
});

describe("Csv.Document QuoteStyle default", () => {
  it("defaults to QuoteStyle.Csv with or without an options record", () => {
    const src = '"id,note#(lf)1,""line one#(lf)line two"""';
    expect(js(`Csv.Document("id,note#(lf)1,""line one#(lf)line two""", [Delimiter = ","])`)).toEqual([
      { Column1: "id", Column2: "note" },
      { Column1: "1", Column2: "line one\nline two" },
    ]);
    expect(js(`Csv.Document(${src})`)).toHaveLength(2);
    expect(js(`Csv.Document(${src}, [Delimiter = ",", QuoteStyle = QuoteStyle.None])`)).toHaveLength(3);
  });
});

describe("large inputs", () => {
  // Widths and counts were taken with Math.max(...rows): a spread of more than ~100k arguments overflows the stack.
  it("Csv.Document reads 200,000 rows", () => {
    const csv = Array.from({ length: 200000 }, (_x, i) => `${i},x`).join("#(lf)");
    expect(js(`Table.RowCount(Csv.Document("${csv}", [Delimiter = ","]))`)).toBe(200000);
  });
  it("Table.FromColumns and List.Mode take long lists", () => {
    expect(js(`Table.RowCount(Table.FromColumns({List.Numbers(1, 200000)}))`)).toBe(200000);
    expect(js(`List.Mode(List.Repeat({1, 2, 2}, 70000))`)).toBe(2);
  });
});

describe("blank text in Changed Type", () => {
  it("turns blank text into null in number and date columns", () => {
    expect(js('Table.TransformColumnTypes(#table({"n", "d", "t"}, {{"", "", ""}}), {{"n", Int64.Type}, {"d", type date}, {"t", type text}})')).toEqual([
      { n: null, d: null, t: "" },
    ]);
  });

  it("leaves Number.From(\"\") as a DataFormat.Error (unverified)", () => {
    expect(mError('Number.From("")').reason).toBe("DataFormat.Error");
  });
});

describe("Text.Split", () => {
  it("rejects null text like its `text as text` signature", () => {
    const e = mError('Text.Split(null, ",")');
    expect(e.reason).toBe("Expression.Error");
    expect(e.message).toBe("We cannot convert the value null to type Text.");
  });
});

describe("Record functions", () => {
  it("FieldValues, ToList, FieldNames, ToTable", () => {
    expect(js('Record.FieldValues([a = 1, b = "x"])')).toEqual([1, "x"]);
    expect(js('Record.ToList([a = 1, b = "x"])')).toEqual([1, "x"]);
    expect(js('Record.FieldNames([a = 1, b = "x"])')).toEqual(["a", "b"]);
    expect(js('Record.ToTable([OrderID = 1, Item = "Fishing rod"])')).toEqual([
      { Name: "OrderID", Value: 1 },
      { Name: "Item", Value: "Fishing rod" },
    ]);
  });

  it("SelectFields, RemoveFields, RenameFields with MissingField", () => {
    const r = '[First = "Ava", Last = "Khan", City = "Pune", Age = 30]';
    expect(js(`Record.SelectFields(${r}, {"City", "Last", "First"})`)).toEqual({ City: "Pune", Last: "Khan", First: "Ava" });
    expect(Object.keys(js(`Record.SelectFields(${r}, {"City", "First"})`) as object)).toEqual(["City", "First"]);
    expect(mError(`Record.SelectFields(${r}, {"City", "Tropical"})`).message).toBe("The field 'Tropical' of the record wasn't found.");
    expect(js(`Record.SelectFields(${r}, {"City", "Tropical"}, MissingField.Ignore)`)).toEqual({ City: "Pune" });
    expect(js(`Record.SelectFields(${r}, {"City", "Tropical"}, MissingField.UseNull)`)).toEqual({ City: "Pune", Tropical: null });
    expect(js(`Record.RemoveFields(${r}, {"Age", "City"})`)).toEqual({ First: "Ava", Last: "Khan" });
    expect(js(`Record.RemoveFields(${r}, "Age")`)).toEqual({ First: "Ava", Last: "Khan", City: "Pune" });
    expect(mError(`Record.RemoveFields(${r}, "Zip")`).message).toBe("The field 'Zip' of the record wasn't found.");
    expect(js(`Record.RemoveFields(${r}, {"Zip", "Age"}, MissingField.Ignore)`)).toEqual({ First: "Ava", Last: "Khan", City: "Pune" });
    expect(js('Record.RenameFields([OrderNum = 1, UnitPrice = 100], {{"UnitPrice", "Price"}, {"OrderNum", "OrderID"}})')).toEqual({ OrderID: 1, Price: 100 });
    expect(mError('Record.RenameFields([a = 1, b = 2], {"a", "b"})').message).toBe("The field 'b' already exists in the record.");
  });

  it("AddField, Combine, FromList", () => {
    expect(js('Record.AddField([CustomerID = 1], "Address", "123 Main St.")')).toEqual({ CustomerID: 1, Address: "123 Main St." });
    expect(js('Record.AddField([a = 1], "b", () => 2, true)')).toEqual({ a: 1, b: 2 });
    expect(mError('Record.AddField([a = 1], "a", 2)').message).toBe("The field 'a' already exists in the record.");
    expect(js('Record.Combine({[Name = "Rick", Nationality = "Dutch"], [Name = "Danny"], [Height = 1.91]})')).toEqual({ Name: "Danny", Nationality: "Dutch", Height: 1.91 });
    expect(mError("Record.Combine({[a = 1], 20})").message).toBe("We cannot convert the value 20 to type Record.");
    expect(js('Record.FromList({1, "Bob", "123-4567"}, {"CustomerID", "Name", "Phone"})')).toEqual({ CustomerID: 1, Name: "Bob", Phone: "123-4567" });
    expect(js('Record.FromList({1, "Bob"}, type [CustomerID = number, Name = text])')).toEqual({ CustomerID: 1, Name: "Bob" });
    expect(mError('Record.FromList({1, 2}, {"a", "a"})').message).toBe("The field 'a' already exists in the record.");
  });
});

describe("Table.Max, Table.Min, Table.SelectRowsWithErrors", () => {
  it("follow the Microsoft Learn examples", () => {
    expect(js('Table.Max(Table.FromRecords({[a = 2, b = 4], [a = 6, b = 8]}), "a")')).toEqual({ a: 6, b: 8 });
    expect(js('Table.Max(#table({"a"}, {}), "a", -1)')).toBe(-1);
    expect(js('Table.Min(Table.FromRecords({[a = 2, b = 4], [a = 6, b = 8]}), "a")')).toEqual({ a: 2, b: 4 });
    expect(js('Table.Min(Table.FromRecords({[a = 2, b = 4], [a = 6, b = 8]}), each -[a])')).toEqual({ a: 6, b: 8 });
    expect(
      js(`Table.SelectRowsWithErrors(Table.FromRecords({
        [CustomerID = error "bad", Name = "Bob"],
        [CustomerID = 2, Name = "Jim"]
      }))[Name]`),
    ).toEqual(["Bob"]);
    expect(js('Table.RowCount(Table.SelectRowsWithErrors(Table.FromRecords({[a = error "x", b = 1]}), {"b"}))')).toBe(0);
  });
});

describe("Table.ExpandTableColumn", () => {
  it("expands a column a nested table lacks to null", () => {
    const r = js(`Table.ExpandTableColumn(#table({"k", "t"}, {
      {1, #table({"a", "b"}, {{"x", "y"}})},
      {2, #table({"a"}, {{"z"}})}
    }), "t", {"a", "b"})`);
    expect(r).toEqual([
      { k: 1, a: "x", b: "y" },
      { k: 2, a: "z", b: null },
    ]);
  });

  it("expands nested lists of records", () => {
    expect(js('Table.ExpandTableColumn(#table({"k", "t"}, {{1, {[a = "x"], [a = "y", b = 2]}}}), "t", {"a", "b"})')).toEqual([
      { k: 1, a: "x", b: null },
      { k: 1, a: "y", b: 2 },
    ]);
  });
});

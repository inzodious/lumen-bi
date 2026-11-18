import { describe, expect, it } from "vitest";
import { evaluateQuery, type Preview } from "../index.ts";

function run(src: string): Preview {
  const e = evaluateQuery(src);
  if (!e.result.ok) throw new Error(e.result.error.message);
  return e.result.preview;
}

describe("unpivot and pivot", () => {
  it("UnpivotOtherColumns matches the Microsoft Learn example and drops nulls", () => {
    const p = run(`Table.UnpivotOtherColumns(Table.FromRecords({[key = "key1", attribute1 = 1, attribute2 = 2, attribute3 = 3], [key = "key2", attribute1 = 4, attribute2 = null, attribute3 = 6]}), {"key"}, "column1", "column2")`);
    expect(p.kind === "table" && p.columns.map((c) => c.name)).toEqual(["key", "column1", "column2"]);
    expect(p.kind === "table" && p.rows).toEqual([
      ["key1", "attribute1", 1],
      ["key1", "attribute2", 2],
      ["key1", "attribute3", 3],
      ["key2", "attribute1", 4],
      ["key2", "attribute3", 6],
    ]);
  });

  it("Unpivot keeps a shared column type, and Pivot turns it back", () => {
    const src = `let
    Source = #table(type table [team = text, Voice = Int64.Type, Chat = Int64.Type], {{"Relay", 3, 4}, {"Night", 5, 1}}),
    Long = Table.Unpivot(Source, {"Voice", "Chat"}, "channel", "n"),
    Wide = Table.Pivot(Long, {"Voice", "Chat"}, "channel", "n")
in
    Wide`;
    const long = run(src.replace("in\n    Wide", "in\n    Long"));
    expect(long.kind === "table" && long.columns).toEqual([
      { name: "team", type: "text" },
      { name: "channel", type: "text" },
      { name: "n", type: "Int64.Type" },
    ]);
    const wide = run(src);
    expect(wide.kind === "table" && wide.rows).toEqual([
      ["Relay", 3, 4],
      ["Night", 5, 1],
    ]);
  });

  it("Pivot without an aggregation errors in a cell with several values; with one it aggregates", () => {
    const base = `#table({"team", "channel", "n"}, {{"Relay", "Voice", 1}, {"Relay", "Voice", 2}, {"Night", "Chat", 5}})`;
    const p = run(`Table.Pivot(${base}, {"Voice", "Chat"}, "channel", "n")`);
    expect(p.kind === "table" && p.rows[0]![1]).toMatchObject({ $error: { message: "There were too many elements in the enumeration to complete the operation." } });
    const s = run(`Table.Pivot(${base}, {"Voice", "Chat"}, "channel", "n", List.Sum)`);
    expect(s.kind === "table" && s.rows).toEqual([
      ["Relay", 3, null],
      ["Night", null, 5],
    ]);
  });

  it("Text.Remove, Text.Select and List.PositionOf", () => {
    expect(run(`Text.Remove(" 1,250.00 ", {",", " "})`)).toMatchObject({ value: "1250.00" });
    expect(run(`Text.Select("AG-0042", {"0".."9"})`)).toMatchObject({ value: "0042" });
    expect(() => run(`Text.Remove("abc", "ab")`)).toThrow(/single-character/);
    expect(run(`List.PositionOf({"a", "b", "a"}, "a", Occurrence.Last)`)).toMatchObject({ value: 2 });
    expect(run(`List.PositionOf({"a"}, "z")`)).toMatchObject({ value: -1 });
  });
});

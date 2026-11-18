import { describe, expect, it } from "vitest";
import { deleteStep, evaluateQuery, insertStep, outlineQuery } from "../index.ts";

const Q = `let
    Source = #table({"team", "calls"}, {{"Alpha", 3}, {"Beta", 5}, {"Alpha", 2}}),
    #"Filtered Rows" = Table.SelectRows(Source, each [calls] > 2)
in
    #"Filtered Rows"`;

describe("Applied Steps editing", () => {
  it("outlines a query into its steps and result", () => {
    expect(outlineQuery(Q)).toEqual({
      steps: [
        { name: "Source", formula: '#table({"team", "calls"}, {{"Alpha", 3}, {"Beta", 5}, {"Alpha", 2}})' },
        { name: "Filtered Rows", formula: "Table.SelectRows(Source, each [calls] > 2)" },
      ],
      result: '#"Filtered Rows"',
    });
    expect(outlineQuery("1 + 1")).toBeNull();
  });

  it("appends a step and makes it the result, numbering repeats like Power Query", () => {
    const a = insertStep(Q, null, "Sorted Rows", (p) => `Table.Sort(${p}, {{"calls", Order.Descending}})`)!;
    expect(a.name).toBe("Sorted Rows");
    expect(a.source).toBe(`let
    Source = #table({"team", "calls"}, {{"Alpha", 3}, {"Beta", 5}, {"Alpha", 2}}),
    #"Filtered Rows" = Table.SelectRows(Source, each [calls] > 2),
    #"Sorted Rows" = Table.Sort(#"Filtered Rows", {{"calls", Order.Descending}})
in
    #"Sorted Rows"`);
    const b = insertStep(a.source, null, "Sorted Rows", (p) => `Table.Sort(${p}, {{"team", Order.Ascending}})`)!;
    expect(b.name).toBe("Sorted Rows1");
    const r = evaluateQuery(b.source);
    expect(r.result.ok && r.result.preview.kind === "table" && r.result.preview.rows).toEqual([["Alpha", 3], ["Beta", 5]]);
  });

  it("inserts in the middle and rewires the next step; deleting rewires it back", () => {
    const m = insertStep(Q, "Source", "Removed Duplicates", (p) => `Table.Distinct(${p}, {"team"})`)!;
    const o = outlineQuery(m.source)!;
    expect(o.steps.map((s) => s.name)).toEqual(["Source", "Removed Duplicates", "Filtered Rows"]);
    expect(o.steps[2]!.formula).toBe('Table.SelectRows(#"Removed Duplicates", each [calls] > 2)');
    expect(o.result).toBe('#"Filtered Rows"');
    const d = deleteStep(m.source, "Removed Duplicates")!;
    expect(outlineQuery(d)!.steps[1]!.formula).toBe("Table.SelectRows(Source, each [calls] > 2)");
  });
});

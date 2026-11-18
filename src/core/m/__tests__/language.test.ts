import { describe, expect, it } from "vitest";
import {
  MError,
  MSyntaxError,
  MTable,
  evaluate,
  evaluateParameter,
  evaluateQuery,
  parseExpression,
  parseSection,
  toJs,
  tokenize,
  type MValue,
} from "../index.ts";

const js = (src: string) => toJs(evaluate(src));

function mError(src: string): MError {
  try {
    evaluate(src);
  } catch (e) {
    if (e instanceof MError) return e;
    throw e;
  }
  throw new Error(`expected an M error from: ${src}`);
}

describe("lexer", () => {
  it("tokenizes dotted names, quoted identifiers, hash literals and ranges", () => {
    const t = tokenize('#"Changed Type" = Table.SelectRows(x, each [a] >= #date(2026, 1, 1)), r = {1..5}');
    expect(t.map((x) => `${x.kind}:${x.value}`).slice(0, 6)).toEqual([
      "quoted:Changed Type",
      "op:=",
      "ident:Table.SelectRows",
      "op:(",
      "ident:x",
      "op:,",
    ]);
    expect(t.some((x) => x.kind === "hash" && x.value === "#date")).toBe(true);
    expect(t.filter((x) => x.value === "..").length).toBe(1);
  });

  it("handles text escapes and comments", () => {
    expect(evaluate('"a""b#(tab)c" // trailing\n')).toBe('a"b\tc');
    expect(evaluate("/* block\ncomment */ 1 + 1")).toBe(2);
  });

  it("reports unterminated strings with line and column", () => {
    try {
      tokenize('let\n  x = "oops\n in x');
      throw new Error("no error");
    } catch (e) {
      expect(e).toBeInstanceOf(MSyntaxError);
      expect((e as MSyntaxError).line).toBe(2);
      expect((e as MSyntaxError).col).toBe(7);
    }
  });
});

describe("parser", () => {
  it("reports a missing comma between steps at the next step", () => {
    const src = 'let\n    Source = 1\n    #"Next" = Source + 1\nin\n    #"Next"';
    const r = evaluateQuery(src);
    expect(r.result.ok).toBe(false);
    if (!r.result.ok) {
      expect(r.result.error).toMatchObject({ reason: "Expression.SyntaxError", message: "Token Comma expected.", line: 3, col: 5 });
    }
  });

  it("parses functions with optional and typed parameters", () => {
    expect(evaluate("let f = (a as number, optional b as nullable number) as number => a + (b ?? 10) in {f(1), f(1, 2)}")).toMatchObject({});
    expect(js("let f = (a as number, optional b as nullable number) as number => a + (b ?? 10) in {f(1), f(1, 2)}")).toEqual([11, 3]);
    expect(js("((x) => x * 2)(21)")).toBe(42);
    expect(js("let f = () => 7 in f()")).toBe(7);
  });

  it("parses type expressions", () => {
    const t = evaluate("type table [a = text, b = nullable number, #\"c d\" = Int64.Type]");
    expect(String(t)).toBe("table [a = text, b = nullable number, c d = Int64.Type]");
    expect(String(evaluate("type nullable text"))).toBe("nullable text");
    expect(evaluate("1 is number")).toBe(true);
    expect(evaluate('"a" is nullable number')).toBe(false);
    expect(evaluate("null is nullable text")).toBe(true);
  });

  it("parses a section document with attributes before members", () => {
    const doc = parseSection(`[StagingDefinition = [Kind = "FastCopy"]]
section Section1;
[DataDestinations = {[Definition = [Kind = "Reference", QueryName = "q_DataDestination", IsNewTarget = true]]}]
shared q = let a = 1 in a;
shared q_DataDestination = 2;`);
    expect(doc.name).toBe("Section1");
    expect(doc.attributes?.t).toBe("record");
    expect(doc.members.map((m) => [m.name, m.shared, m.attributes !== null])).toEqual([
      ["q", true, true],
      ["q_DataDestination", true, false],
    ]);
  });

  it("supports generalized identifiers in field access and record keys", () => {
    expect(js('[Folder Path = "x"][Folder Path]')).toBe("x");
    expect(js('[#"Very Good" = 4][#"Very Good"]')).toBe(4);
    expect(js("[type = 1][type]")).toBe(1);
  });
});

describe("evaluation", () => {
  it("evaluates let bindings lazily: an unused failing step doesn't fail the query", () => {
    const r = evaluateQuery('let\n  Broken = error "boom",\n  Good = 40 + 2\nin\n  Good');
    expect(r.result).toMatchObject({ ok: true, value: 42 });
    expect(r.steps.map((s) => [s.name, s.ok])).toEqual([
      ["Broken", false],
      ["Good", true],
    ]);
    expect(r.steps[0]!.value).toMatchObject({ reason: "Expression.Error", message: "boom" });
    expect(r.steps[1]!.formula).toBe("40 + 2");
  });

  it("keeps record fields and list items lazy", () => {
    expect(js('[a = error "x", b = 2][b]')).toBe(2);
    expect(js('List.Count({error "x", 1})')).toBe(2);
    expect(js("[a = 1, b = a + 1][b]")).toBe(2);
  });

  it("detects cyclic references", () => {
    expect(mError("let a = b, b = a in a").message).toBe("A cyclic reference was encountered during evaluation.");
  });

  it("implements try / otherwise / catch and error records", () => {
    expect(js('try error "bad" otherwise "fallback"')).toBe("fallback");
    expect(js("try 1 otherwise 2")).toBe(1);
    expect(js('try Number.From("abc")')).toEqual({
      HasError: true,
      Error: { Reason: "DataFormat.Error", Message: "We couldn't convert to Number.", Detail: "abc" },
    });
    expect(js("try 5")).toEqual({ HasError: false, Value: 5 });
    expect(js('try error [Reason = "Custom.Error", Message = "nope", Detail = 3] catch (e) => e[Reason] & ": " & e[Message]')).toBe("Custom.Error: nope");
    expect(js('(try error Error.Record("X", "y"))[Error][Message]')).toBe("y");
  });

  it("follows M operator precedence", () => {
    expect(js("1 + 2 * 3")).toBe(7);
    expect(js("(1 + 2) * 3")).toBe(9);
    expect(js("-2 * -3")).toBe(6);
    expect(js("1 + 1 = 2 and 2 < 3")).toBe(true);
    expect(js("true or false and false")).toBe(true);
    expect(js('"a" & "b" = "ab"')).toBe(true);
    expect(js("null ?? 1 + 1")).toBe(2);
    expect(js("10 - 2 - 3")).toBe(5);
    expect(js("8 / 2 / 2")).toBe(2);
    expect(js("not true = false")).toBe(true);
  });

  it("implements M equality and comparison edge cases", () => {
    expect(js("null = null")).toBe(true);
    expect(js("null <> null")).toBe(false);
    expect(js('1 = "1"')).toBe(false);
    expect(js("1 = 1.0")).toBe(true);
    expect(js("null < 1")).toBe(null);
    expect(js("null + 1")).toBe(null);
    expect(js("#date(2026, 1, 1) = #datetime(2026, 1, 1, 0, 0, 0)")).toBe(false);
    expect(js("{1, 2} = {1, 2}")).toBe(true);
    expect(js("[a = 1, b = 2] = [b = 2, a = 1]")).toBe(true);
    expect(js('"B" < "a"')).toBe(true);
    expect(js("null and false")).toBe(false);
    expect(js("null or true")).toBe(true);
    expect(js("null and true")).toBe(null);
    expect(js("0.1 + 0.2 = 0.3")).toBe(false);
    expect(js("Text.From(0.1 + 0.2)")).toBe("0.3");
    expect(mError('1 < "a"').message).toBe("We cannot apply operator < to types Number and Text.");
    expect(mError('1 + "a"').message).toBe("We cannot apply operator + to types Number and Text.");
  });

  it("combines text, lists and records with &", () => {
    expect(js('"Star" & "lane"')).toBe("Starlane");
    expect(js("{1} & {2, 3}")).toEqual([1, 2, 3]);
    expect(js("[a = 1, b = 2] & [b = 3, c = 4]")).toEqual({ a: 1, b: 3, c: 4 });
    expect(js("#date(2026, 3, 8) & #time(7, 0, 0)")).toBe("2026-03-08T07:00:00");
  });

  it("does date, datetime and duration arithmetic", () => {
    expect(js("#datetime(2026, 3, 8, 7, 0, 0) - #duration(0, 5, 0, 0)")).toBe("2026-03-08T02:00:00");
    expect(js("#date(2026, 3, 1) - #date(2026, 2, 1)")).toBe("28.00:00:00");
    expect(js("Duration.Days(#date(2026, 3, 1) - #date(2026, 2, 1))")).toBe(28);
    expect(js("#date(2026, 1, 31) + #duration(1, 0, 0, 0)")).toBe("2026-02-01");
    expect(js("Duration.TotalHours(#duration(1, 6, 0, 0))")).toBe(30);
  });

  it("supports field, optional field, item and record-lookup access", () => {
    expect(js("{10, 20, 30}{1}")).toBe(20);
    expect(js("{10}{5}?")).toBe(null);
    expect(js("[a = 1][b]?")).toBe(null);
    expect(js('#table({"k", "v"}, {{"x", 1}, {"y", 2}}){[k = "y"]}[v]')).toBe(2);
    expect(js('#table({"k", "v"}, {{"x", 1}}){[k = "z"]}?[v]?')).toBe(null);
    expect(js('#table({"k", "v"}, {{"x", 1}, {"y", 2}})[v]')).toEqual([1, 2]);
    expect(js("[a = 1, b = 2, c = 3][[a], [c]]")).toEqual({ a: 1, c: 3 });
    expect(mError("{1}{3}").message).toBe("There weren't enough elements in the enumeration to complete the operation.");
    expect(mError("[a = 1][b]").message).toBe("The field 'b' of the record wasn't found.");
    expect(mError('#table({"k"}, {{"x"}}){[k = "z"]}').message).toBe("The key didn't match any rows in the table.");
    expect(mError('#table({"k"}, {{"x"}, {"x"}}){[k = "x"]}').message).toBe("The key matched more than one row in the table.");
  });

  it("builds lists with ranges and each/_ functions", () => {
    expect(js("{1..4, 10}")).toEqual([1, 2, 3, 4, 10]);
    expect(js('{"a".."c"}')).toEqual(["a", "b", "c"]);
    expect(js("List.Transform({1, 2, 3}, each _ * 10)")).toEqual([10, 20, 30]);
    expect(js("List.Select({1, 2, 3, 4}, each _ > 2)")).toEqual([3, 4]);
  });

  it("keeps meta records for parameters", () => {
    const p = evaluateParameter('"parity-sql.starlane.fabric.mock" meta [IsParameterQuery = true, Type = "Text", IsParameterQueryRequired = true]');
    expect(p.value).toBe("parity-sql.starlane.fabric.mock");
    expect(p.isParameterQuery).toBe(true);
    expect(p.meta).toEqual({ IsParameterQuery: true, Type: "Text", IsParameterQueryRequired: true });
    expect(js('let p = #date(2023, 1, 1) meta [IsParameterQuery = true, Type = "Date"] in Value.Metadata(p)[Type]')).toBe("Date");
    expect(js("let p = 5 meta [a = 1] in p + 1")).toBe(6);
  });

  it("gives Power Query errors for names, arity and type assertions", () => {
    expect(mError("Tabel.SelectRows").message).toBe("The name 'Tabel.SelectRows' wasn't recognized. Make sure it's spelled correctly.");
    expect(mError("Text.Upper()").message).toBe("0 arguments were passed to a function which expects between 1 and 2.");
    expect(mError('"abc" as number').message).toBe('We cannot convert the value "abc" to type Number.');
    expect(mError('((x as number) => x)("abc")').message).toBe('We cannot convert the value "abc" to type Number.');
    expect(mError("Text.Trim(1)").message).toBe("We cannot convert the value 1 to type Text.");
    expect(mError("if 1 then 2 else 3").message).toBe("We cannot convert the value 1 to type Logical.");
    expect(mError('Table.FuzzyJoin(x, "a", x, "b")').message).toContain("not supported in Lumen yet");
    const e = mError('let\n  a = 1,\n  b = Text.Upper(a)\nin b');
    expect(e.pos).toEqual({ line: 3, col: 7 });
  });

  it("rejects Value.NativeQuery on a non-SQL target with a clear message", () => {
    expect(mError('Value.NativeQuery(null, "SELECT 1")').message).toMatch(/^Value\.NativeQuery: native queries are only supported on a database/);
  });

  it("returns tables with typed columns from #table", () => {
    const t = evaluate("#table(type table [last_refresh = datetime], {{#datetime(2026, 1, 1, 0, 0, 0)}})") as MValue;
    expect(t).toBeInstanceOf(MTable);
    expect((t as MTable).types[0]!.toString()).toBe("datetime");
    expect(toJs(t)).toEqual([{ last_refresh: "2026-01-01T00:00:00" }]);
  });

  it("parses the whole reference-style expression grammar without error", () => {
    expect(() =>
      parseExpression(`let
  Source = Sql.Database(p_server, p_database),
  Nav = Source{[Schema = "dbo", Item = "dim_calendar"]}[Data],
  #"Filtered Rows" = Table.SelectRows(Nav, each [date] >= p_from_date and not ([date] > #date(2030, 1, 1))),
  #"Added x" = Table.AddColumn(#"Filtered Rows", "x", each - Number.From([date]), Int64.Type),
  Ops = List.Transform({"a"}, each {_, (val) => if val = null then null else Record.FieldOrDefault([A = 1], val, val), Int64.Type}),
  Out = try #"Added x" otherwise #table(type table [a = text], {})
in
  Out`),
    ).not.toThrow();
  });
});

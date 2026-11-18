import { describe, expect, it } from "vitest";
import { DaxSyntaxError, lintDax, parse, parseDax, type Node } from "../index.ts";

function show(n: Node): string {
  switch (n.kind) {
    case "number":
      return String(n.value);
    case "string":
      return JSON.stringify(n.value);
    case "bool":
      return n.value ? "TRUE" : "FALSE";
    case "column":
      return `${n.table ?? ""}[${n.name}]`;
    case "ident":
      return n.name;
    case "call":
      return `${n.name.toUpperCase()}(${n.args.map(show).join(", ")})`;
    case "binary":
      return `(${show(n.left)} ${n.op} ${show(n.right)})`;
    case "unary":
      return `(${n.op} ${show(n.operand)})`;
    case "var":
      return `VAR{${n.decls.map((d) => `${d.name}=${show(d.expr)}`).join("; ")}} ${show(n.body)}`;
    case "tableCtor":
      return `{${n.rows.map((r) => (r.length === 1 ? show(r[0]!) : `(${r.map(show).join(", ")})`)).join(", ")}}`;
    case "tuple":
      return `(${n.items.map(show).join(", ")})`;
  }
}

describe("parser", () => {
  it("parses references of every shape", () => {
    expect(show(parse("'Quoted Table'[Col] + fact_transmissions[duration_seconds] + [kpi_transmissions]"))).toBe(
      "((Quoted Table[Col] + fact_transmissions[duration_seconds]) + [kpi_transmissions])",
    );
    expect(show(parse("'It''s'[a]]b]"))).toBe("It's[a]b]");
  });

  it("follows DAX operator precedence", () => {
    expect(show(parse("1 + 2 * 3 ^ 2"))).toBe("(1 + (2 * (3 ^ 2)))");
    expect(show(parse("-2 ^ 2"))).toBe("(- (2 ^ 2))");
    expect(show(parse('"a" & 1 + 2 = "a3"'))).toBe('(("a" & (1 + 2)) = "a3")');
    expect(show(parse("NOT ISBLANK ( [a] ) && NOT ISBLANK ( [b] ) || [c] > 1"))).toBe("(((NOT ISBLANK([a])) && (NOT ISBLANK([b]))) || ([c] > 1))");
    expect(show(parse("NOT t[x] IN { 1, 2 }"))).toBe("(NOT (t[x] IN {1, 2}))");
    expect(show(parse("a[b] <> 1 && a[c] >= 2 && a[d] == BLANK ( )"))).toBe("(((a[b] <> 1) && (a[c] >= 2)) && (a[d] == BLANK()))");
  });

  it("parses nested VAR / RETURN, table constructors and row tuples", () => {
    const src = `
      VAR Outer = 1
      VAR Inner =
          VAR Deep = Outer + 1
          RETURN
          Deep * 2
      RETURN
      IF ( ( 1, "a" ) IN { ( 1, "a" ), ( 2, "b" ) }, Inner, BLANK () )`;
    expect(show(parse(src))).toBe('VAR{Outer=1; Inner=VAR{Deep=(Outer + 1)} (Deep * 2)} IF(((1, "a") IN {(1, "a"), (2, "b")}), Inner, BLANK())');
  });

  it("accepts TRUE / FALSE with and without parentheses, and numbers of every form", () => {
    expect(show(parse("TRUE () && FALSE || TRUE"))).toBe("((TRUE && FALSE) || TRUE)");
    expect(show(parse(".5 + 1.25e2 + 3"))).toBe("((0.5 + 125) + 3)");
  });

  it("accepts comments (the lint flags them)", () => {
    const r = parseDax("-- leading\nSUM ( t[x] ) // trailing\n/* block */ + 1");
    expect(show(r.ast)).toBe("(SUM(t[x]) + 1)");
    expect(r.comments.map((c) => c.style)).toEqual(["--", "//", "/*"]);
  });

  it("reports syntax errors with line:col", () => {
    const err = (src: string) => {
      try {
        parse(src);
      } catch (e) {
        expect(e).toBeInstanceOf(DaxSyntaxError);
        return (e as Error).message;
      }
      throw new Error("expected a syntax error");
    };
    expect(err("CALCULATE ( [x],\n  t[a] = 1")).toBe("Syntax error at 2:11: expected ')' to close CALCULATE ( opened at 1:11, but found the end of the expression.");
    expect(err("VAR X = 1\nX + 1")).toMatch(/^Syntax error at 2:1: expected RETURN after the VAR definitions that start at 1:1/);
    expect(err("SUM ( t[x] ) )")).toBe("Syntax error at 1:14: unexpected ')' without a matching '('.");
    expect(err("t[x] NOT IN { 1 }")).toMatch(/1:6: DAX has no NOT IN operator/);
    expect(err('"abc')).toBe('Syntax error at 1:1: the text literal is never closed with ".');
    expect(err("DIVIDE ( 1, , 2 )")).toBe("Syntax error at 1:13: argument 2 of DIVIDE is missing.");
    expect(err("{ 1, ( 2, 3 ) }")).toMatch(/row 2 of the table constructor has 2 values/);
    expect(err("1 +")).toMatch(/expected an expression after '\+'/);
  });
});

describe("lintDax", () => {
  it("passes house-style DAX", () => {
    const src = `VAR Denominator =
    CALCULATE (
        [kpi_transmissions],
        ALLSELECTED ( fact_transmissions[channel] )
    )
RETURN
DIVIDE ( [kpi_transmissions], Denominator )`;
    expect(lintDax(src)).toEqual([]);
    expect(lintDax("BLANK ()")).toEqual([]);
    expect(lintDax("BLANK()")).toEqual([]);
  });

  it("flags every DX rule and comments", () => {
    const src = `-- why
VAR total_calls = SUM(t[x])
VAR Current_ = 1
VAR _pick = 2 RETURN total_calls / 2`;
    expect(lintDax(src).map((d) => `${d.code}@${d.line}:${d.col}`)).toEqual([
      "PB-007@1:1",
      "DX-002@2:5",
      "DX-001@2:22",
      "DX-001@2:27",
      "DX-002@4:5",
      "DX-003@4:15",
      "DX-004@4:34",
    ]);
    expect(lintDax(src).find((d) => d.code === "DX-002")!.message).toBe("Name the variable 'total_calls' in PascalCase, for example TotalCalls.");
  });

  it("practice rules: repeats in one context, risky denominators, SELECTEDVALUE in text", () => {
    const codes = (src: string) => lintDax(src).map((d) => `${d.code}@${d.line}:${d.col}`);
    // The second [kpi_calls] at the same level is the repeat; the one inside CALCULATE runs in another context.
    expect(codes("IF ( [kpi_calls] > 0, [kpi_calls] )")).toEqual(["DX-005@1:23"]);
    expect(codes("DIVIDE ( [kpi_calls], CALCULATE ( [kpi_calls], REMOVEFILTERS () ) )")).toEqual([]);
    // A measure denominator can be blank or 0: practice. A constant one is only Starlane's house rule.
    expect(codes("[kpi_calls] / [kpi_days]")).toEqual(["DX-006@1:13"]);
    expect(codes("[kpi_seconds] / 60")).toEqual(["DX-004@1:15"]);
    expect(codes('"Calls for " & SELECTEDVALUE ( t[channel] )')).toEqual(["DX-007@1:16"]);
    expect(codes('"Calls for " & SELECTEDVALUE ( t[channel], "all channels" )')).toEqual([]);
  });

  it("returns a DX-000 diagnostic for text that does not lex", () => {
    expect(lintDax('"open')).toEqual([{ code: "DX-000", message: 'Syntax error at 1:1: the text literal is never closed with ".', line: 1, col: 1 }]);
  });
});

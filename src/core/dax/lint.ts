import { DaxError, DaxSyntaxError } from "./errors.ts";
import { lex, type Comment, type Token } from "./lexer.ts";
import { queryExpressions } from "./daxquery.ts";
import { parse, parseDaxQuery, type DaxQuery, type Node } from "./parser.ts";

export interface DaxDiagnostic {
  code: string;
  message: string;
  line: number;
  col: number;
}

function pascal(name: string): string {
  const parts = name.split(/_+/).filter(Boolean);
  return parts.map((p) => p[0]!.toUpperCase() + p.slice(1)).join("") || name;
}

const PASCAL = /^[A-Z][A-Za-z0-9]*_?$/;

/**
 * DAX lint. Practice rules (DX-005 to DX-007) are widely taught; house rules (DX-001 to DX-004, PB-007) are the
 * Starlane team's style (PARITY_PLAN §3.10). The grader's scope table says which is which.
 */
export function lintDax(expr: string): DaxDiagnostic[] {
  const out = tokenRules(expr);
  if (!out) return [syntaxDiagnostic(expr)];
  let ast: Node | null = null;
  try {
    ast = parse(expr);
  } catch (e) {
    if (!(e instanceof DaxError)) throw e;
  }
  if (ast) out.push(...astRules(ast));
  return out.sort((a, b) => a.line - b.line || a.col - b.col);
}

/** DX lint for a whole DAX query: the token rules over the text, the expression rules per definition and EVALUATE. */
export function lintDaxQuery(text: string): DaxDiagnostic[] {
  const out = tokenRules(text);
  if (!out) return [syntaxDiagnostic(text)];
  let q: DaxQuery | null = null;
  try {
    q = parseDaxQuery(text);
  } catch (e) {
    if (!(e instanceof DaxError)) throw e;
  }
  if (q) for (const e of queryExpressions(q)) out.push(...astRules(e));
  return out.sort((a, b) => a.line - b.line || a.col - b.col);
}

function syntaxDiagnostic(src: string): DaxDiagnostic {
  try {
    lex(src);
  } catch (e) {
    if (e instanceof DaxSyntaxError) return { code: "DX-000", message: e.message, line: e.line, col: e.col };
    if (e instanceof DaxError) return { code: "DX-000", message: e.message, line: 1, col: 1 };
    throw e;
  }
  throw new Error("The text lexes; there is no syntax diagnostic.");
}

/** Comment, spacing, VAR-name and RETURN rules; null when the text doesn't lex. */
function tokenRules(expr: string): DaxDiagnostic[] | null {
  let tokens: Token[];
  let comments: Comment[];
  try {
    ({ tokens, comments } = lex(expr));
  } catch (e) {
    if (e instanceof DaxError) return null;
    throw e;
  }
  const out: DaxDiagnostic[] = [];
  for (const c of comments) {
    out.push({
      code: "PB-007",
      message: `Remove this ${c.style} comment. The model carries no comments; put the rationale in the model's doc panel.`,
      line: c.line,
      col: c.col,
    });
  }
  const stack: { fn: Token | null; open: Token }[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    const prev = tokens[i - 1];
    const next = tokens[i + 1];
    if (t.type === "punct" && t.value === "(") {
      const fn = prev && prev.type === "ident" && !["VAR", "RETURN", "IN", "NOT"].includes(prev.value.toUpperCase()) ? prev : null;
      stack.push({ fn, open: t });
      if (fn && next && !(next.type === "punct" && next.value === ")") && !next.spaceBefore) {
        out.push({
          code: "DX-001",
          message: `Put a space after the opening parenthesis of ${fn.value.toUpperCase()}: write ${fn.value} ( ... ).`,
          line: t.line,
          col: t.col,
        });
      }
    } else if (t.type === "punct" && t.value === ")") {
      const open = stack.pop();
      if (open?.fn && prev && prev !== open.open && !t.spaceBefore) {
        out.push({
          code: "DX-001",
          message: `Put a space before the closing parenthesis of ${open.fn.value.toUpperCase()}: write ${open.fn.value} ( ... ).`,
          line: t.line,
          col: t.col,
        });
      }
    } else if (t.type === "ident" && t.value.toUpperCase() === "VAR" && next?.type === "ident") {
      if (!PASCAL.test(next.value)) {
        out.push({
          code: "DX-002",
          message: `Name the variable '${next.value}' in PascalCase, for example ${pascal(next.value)}.`,
          line: next.line,
          col: next.col,
        });
      }
    } else if (t.type === "ident" && t.value.toUpperCase() === "RETURN") {
      if (!t.lineBreakBefore || (next && next.type !== "eof" && !next.lineBreakBefore)) {
        out.push({
          code: "DX-003",
          message: "Put RETURN on its own line, with the result expression on the next line.",
          line: t.line,
          col: t.col,
        });
      }
    }
  }
  return out;
}

const TRIVIAL_CALLS = new Set(["BLANK", "TRUE", "FALSE", "TODAY", "SELECTEDMEASURE", "SELECTEDMEASUREFORMATSTRING"]);
/** Arguments of these run in another filter or row context, so a repeat inside them is not the same computation. */
const CONTEXT_CHANGERS = new Set(["CALCULATE", "CALCULATETABLE", "SUMX", "AVERAGEX", "MINX", "MAXX", "COUNTX", "FILTER", "TOTALYTD", "TOTALQTD", "TOTALMTD", "RELATEDTABLE",
  "SUMMARIZECOLUMNS", "ADDCOLUMNS", "SELECTCOLUMNS", "TOPN", "ROW", "GENERATE"]);

function keyOfNode(n: Node): string {
  return JSON.stringify(n, (k, v) => (k === "pos" ? undefined : typeof v === "string" && k !== "value" ? v.toLowerCase() : v));
}

function children(n: Node): Node[] {
  switch (n.kind) {
    case "call":
      return n.args;
    case "binary":
      return [n.left, n.right];
    case "unary":
      return [n.operand];
    case "var":
      return [...n.decls.map((d) => d.expr), n.body];
    case "tableCtor":
      return n.rows.flat();
    case "tuple":
      return n.items;
    default:
      return [];
  }
}

function isConstantDenominator(n: Node): boolean {
  if (n.kind === "number") return n.value !== 0;
  if (n.kind === "unary" && n.op === "-") return isConstantDenominator(n.operand);
  return false;
}

function astRules(ast: Node): DaxDiagnostic[] {
  const out: DaxDiagnostic[] = [];
  const counts = new Map<string, number>();
  const eligible = (n: Node) => (n.kind === "call" && !TRIVIAL_CALLS.has(n.name.toUpperCase())) || (n.kind === "column" && n.table === null);
  const changesContext = (n: Node) => n.kind === "call" && CONTEXT_CHANGERS.has(n.name.toUpperCase());
  const count = (n: Node): void => {
    if (eligible(n)) counts.set(keyOfNode(n), (counts.get(keyOfNode(n)) ?? 0) + 1);
    if (!changesContext(n)) children(n).forEach(count);
  };
  count(ast);
  const sameContextOnly = new Set<Node>();
  const markInner = (n: Node, inner: boolean): void => {
    if (inner) sameContextOnly.add(n);
    children(n).forEach((c) => markInner(c, inner || changesContext(n)));
  };
  markInner(ast, false);
  const seen = new Map<string, number>();
  const visit = (n: Node, parent: Node | null): void => {
    if (eligible(n) && (counts.get(keyOfNode(n)) ?? 0) >= 2 && !sameContextOnly.has(n)) {
      const k = keyOfNode(n);
      const nth = (seen.get(k) ?? 0) + 1;
      seen.set(k, nth);
      if (nth === 2) {
        const what = n.kind === "column" ? `[${n.name}]` : n.kind === "call" ? `this ${n.name.toUpperCase()} ( ... )` : "This expression";
        out.push({ code: "DX-005", message: `${what} is evaluated more than once. Store it in a VAR and use the variable, so it's computed once and reads as one idea.`, line: n.pos.line, col: n.pos.col });
      }
      return;
    }
    if (n.kind === "binary" && n.op === "/") {
      if (isConstantDenominator(n.right)) {
        out.push({ code: "DX-004", message: "Use DIVIDE ( numerator, denominator ) instead of '/'. Starlane uses DIVIDE everywhere, even for a constant denominator.", line: n.pos.line, col: n.pos.col });
      } else {
        out.push({
          code: "DX-006",
          message: "This denominator can be 0 or blank. Use DIVIDE ( numerator, denominator ), which returns BLANK there instead of an error or Infinity.",
          line: n.pos.line,
          col: n.pos.col,
        });
      }
    }
    if (n.kind === "call" && n.name.toUpperCase() === "SELECTEDVALUE" && n.args.length === 1 && parent && ((parent.kind === "binary" && parent.op === "&") || (parent.kind === "call" && parent.name.toUpperCase() === "CONCATENATE"))) {
      out.push({
        code: "DX-007",
        message: "Give SELECTEDVALUE a default as its second argument here. With several values (or none) selected it returns BLANK, and the text reads as if something is missing.",
        line: n.pos.line,
        col: n.pos.col,
      });
    }
    children(n).forEach((c) => visit(c, n));
  };
  visit(ast, null);
  return out;
}

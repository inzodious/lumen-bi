import { tokenize, type Token } from "./lexer.ts";
import { parseExpression } from "./parser.ts";

const KEYWORDS = new Set(["and", "as", "each", "else", "error", "false", "if", "in", "is", "let", "meta", "not", "null", "or", "otherwise", "section", "shared", "then", "true", "try", "type"]);

/** How Power Query writes a step name: plain when it's a valid identifier, `#"..."` otherwise. */
export function stepRef(name: string): string {
  return /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/.test(name) && !KEYWORDS.has(name) ? name : `#"${name.replace(/"/g, '""')}"`;
}

export interface QueryOutline {
  steps: { name: string; formula: string }[];
  /** The `in` expression's text. */
  result: string;
}

/** The Applied Steps of a `let … in` query, or null when the text isn't one (or doesn't parse). */
export function outlineQuery(source: string): QueryOutline | null {
  let expr;
  try {
    expr = parseExpression(source);
  } catch {
    return null;
  }
  if (expr.t !== "let") return null;
  const bodyStart = expr.body.pos;
  const lines = source.split("\n");
  let offset = 0;
  for (let i = 0; i < bodyStart.line - 1; i++) offset += lines[i]!.length + 1;
  offset += bodyStart.col - 1;
  return {
    steps: expr.bindings.map((b) => ({ name: b.name, formula: source.slice(b.span[0], b.span[1]).trim() })),
    result: source.slice(offset).trim(),
  };
}

/** Rebuilds a query from its steps in Power Query's Advanced Editor layout. */
export function renderQuery(outline: QueryOutline): string {
  const body = outline.steps.map((s) => `    ${stepRef(s.name)} = ${s.formula.replace(/\n/g, "\n    ")}`).join(",\n");
  return `let\n${body}\nin\n    ${outline.result}`;
}

/** `Removed Columns`, then `Removed Columns1`, `Removed Columns2`… as Power Query numbers repeats. */
export function uniqueStepName(outline: QueryOutline, base: string): string {
  const taken = new Set(outline.steps.map((s) => s.name));
  if (!taken.has(base)) return base;
  for (let n = 1; ; n++) if (!taken.has(`${base}${n}`)) return `${base}${n}`;
}

function renameRefs(formula: string, from: string, to: string): string {
  let tokens: Token[];
  try {
    tokens = tokenize(formula);
  } catch {
    return formula;
  }
  let out = "";
  let last = 0;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    const field = tokens[i - 1]?.kind === "op" && tokens[i - 1]!.value === "[";
    if ((t.kind === "ident" || t.kind === "quoted") && t.value === from && !field) {
      out += formula.slice(last, t.start) + stepRef(to);
      last = t.end;
    }
  }
  return out + formula.slice(last);
}

/**
 * Inserts a step after `after` (the last step when null), as a ribbon button does. `formula` gets the previous
 * step's reference. The step that used to follow now reads the new one; inserting at the end makes the new step
 * the query's result, when the result was the last step.
 */
export function insertStep(source: string, after: string | null, base: string, formula: (prev: string) => string): { source: string; name: string } | null {
  const q = outlineQuery(source);
  if (!q || q.steps.length === 0) return null;
  const index = after === null ? q.steps.length - 1 : q.steps.findIndex((s) => s.name === after);
  if (index < 0) return null;
  const prev = q.steps[index]!.name;
  const name = uniqueStepName(q, base);
  const steps = [...q.steps];
  steps.splice(index + 1, 0, { name, formula: formula(stepRef(prev)) });
  const next = steps[index + 2];
  if (next) next.formula = renameRefs(next.formula, prev, name);
  const resultIsPrev = q.result === stepRef(prev) || q.result === prev;
  return { source: renderQuery({ steps, result: resultIsPrev ? stepRef(name) : q.result }), name };
}

/** Removes a step; the step after it reads the removed step's input instead. */
export function deleteStep(source: string, name: string): string | null {
  const q = outlineQuery(source);
  if (!q) return null;
  const index = q.steps.findIndex((s) => s.name === name);
  if (index <= 0) return null;
  const prev = q.steps[index - 1]!.name;
  const steps = q.steps.filter((_, i) => i !== index);
  const next = steps[index];
  if (next) next.formula = renameRefs(next.formula, name, prev);
  const result = q.result === stepRef(name) || q.result === name ? stepRef(prev) : q.result;
  return renderQuery({ steps, result });
}

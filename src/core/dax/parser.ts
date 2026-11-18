import { DaxSyntaxError, unsupported, type SourcePos } from "./errors.ts";
import { lex, type Comment, type Token } from "./lexer.ts";

export type Node =
  | { kind: "number"; value: number; pos: SourcePos }
  | { kind: "string"; value: string; pos: SourcePos }
  | { kind: "bool"; value: boolean; pos: SourcePos }
  | { kind: "column"; table: string | null; name: string; pos: SourcePos }
  | { kind: "ident"; name: string; quoted: boolean; pos: SourcePos }
  | { kind: "call"; name: string; args: Node[]; pos: SourcePos }
  | { kind: "binary"; op: string; left: Node; right: Node; pos: SourcePos }
  | { kind: "unary"; op: "-" | "+" | "NOT"; operand: Node; pos: SourcePos }
  | { kind: "var"; decls: { name: string; expr: Node; pos: SourcePos }[]; body: Node; pos: SourcePos }
  | { kind: "tableCtor"; rows: Node[][]; pos: SourcePos }
  | { kind: "tuple"; items: Node[]; pos: SourcePos };

export interface ParseResult {
  ast: Node;
  comments: Comment[];
}

export type QueryDefinition =
  | { kind: "measure"; table: string; name: string; expr: Node; pos: SourcePos }
  | { kind: "var"; name: string; expr: Node; pos: SourcePos };

export interface OrderKey {
  expr: Node;
  desc: boolean;
}

export interface EvaluateStatement {
  expr: Node;
  orderBy: OrderKey[];
  startAt: Node[] | null;
  pos: SourcePos;
}

/** A DAX query: DEFINE ( MEASURE | VAR | ... )* then one or more EVALUATE statements. */
export interface DaxQuery {
  definitions: QueryDefinition[];
  evaluates: EvaluateStatement[];
  comments: Comment[];
}

const QUERY_KEYWORDS = new Set(["DEFINE", "EVALUATE", "MEASURE", "VAR", "COLUMN", "TABLE", "FUNCTION", "ORDER", "START"]);

const INFIX_BP: Record<string, number> = {
  "||": 10,
  "&&": 20,
  "=": 40,
  "==": 40,
  "<": 40,
  ">": 40,
  "<=": 40,
  ">=": 40,
  "<>": 40,
  IN: 40,
  "&": 50,
  "+": 60,
  "-": 60,
  "*": 70,
  "/": 70,
  "^": 90,
};
const NOT_BP = 30;
const SIGN_BP = 80;

function describe(t: Token): string {
  switch (t.type) {
    case "eof":
      return "the end of the expression";
    case "string":
      return `"${t.value}"`;
    case "table":
      return `'${t.value}'`;
    case "column":
      return `[${t.value}]`;
    default:
      return `'${t.value}'`;
  }
}

class Parser {
  private i = 0;
  constructor(private readonly tokens: Token[]) {}

  private get t(): Token {
    return this.tokens[this.i]!;
  }

  private peek(n = 1): Token {
    return this.tokens[Math.min(this.i + n, this.tokens.length - 1)]!;
  }

  private atEof(): boolean {
    return this.tokens[this.i]!.type === "eof";
  }

  private next(): Token {
    const t = this.t;
    if (t.type !== "eof") this.i++;
    return t;
  }

  private isKeyword(t: Token, kw: string): boolean {
    return t.type === "ident" && t.value.toUpperCase() === kw;
  }

  private isPunct(t: Token, p: string): boolean {
    return t.type === "punct" && t.value === p;
  }

  private fail(msg: string, t: Token = this.t): never {
    throw new DaxSyntaxError(msg, t.line, t.col);
  }

  private expectPunct(p: string, opener?: { what: string; tok: Token }): Token {
    if (this.isPunct(this.t, p)) return this.next();
    const ctx = opener ? ` to close ${opener.what} opened at ${opener.tok.line}:${opener.tok.col}` : "";
    return this.fail(`expected '${p}'${ctx}, but found ${describe(this.t)}.`);
  }

  parseProgram(): Node {
    if (this.atEof()) this.fail("the expression is empty.");
    const node = this.expr(0);
    if (!this.atEof()) {
      if (this.isPunct(this.t, ")")) this.fail("unexpected ')' without a matching '('.");
      if (this.isKeyword(this.t, "RETURN")) this.fail("RETURN must follow one or more VAR definitions.");
      this.fail(`unexpected ${describe(this.t)}. Did you miss an operator or a comma?`);
    }
    return node;
  }

  parseQuery(): Omit<DaxQuery, "comments"> {
    const definitions: QueryDefinition[] = [];
    const evaluates: EvaluateStatement[] = [];
    if (this.atEof()) this.fail("the query is empty. A DAX query starts with EVALUATE.");
    if (this.isKeyword(this.t, "DEFINE")) {
      this.next();
      while (!this.isKeyword(this.t, "EVALUATE")) {
        if (this.atEof()) this.fail("DEFINE must be followed by EVALUATE. Add EVALUATE and a table expression after the definitions.");
        definitions.push(this.definition());
      }
      if (definitions.length === 0) this.fail("DEFINE needs at least one MEASURE or VAR definition before EVALUATE.");
    }
    if (!this.isKeyword(this.t, "EVALUATE")) {
      this.fail(`a DAX query starts with EVALUATE (or DEFINE, then EVALUATE), but found ${describe(this.t)}. To test a measure expression, write EVALUATE { <expression> }.`);
    }
    while (this.isKeyword(this.t, "EVALUATE")) {
      const start = this.next();
      if (this.atEof() || this.startsClause(this.t)) this.fail("EVALUATE needs a table expression.");
      const expr = this.expr(0);
      const orderBy: OrderKey[] = [];
      let startAt: Node[] | null = null;
      if (this.isKeyword(this.t, "ORDER")) {
        this.next();
        if (!this.isKeyword(this.t, "BY")) this.fail(`expected BY after ORDER, but found ${describe(this.t)}.`);
        this.next();
        for (;;) {
          if (this.atEof() || this.startsClause(this.t)) this.fail("ORDER BY needs at least one expression.");
          const e = this.expr(0);
          let desc = false;
          if (this.isKeyword(this.t, "ASC") || this.isKeyword(this.t, "DESC")) desc = this.next().value.toUpperCase() === "DESC";
          orderBy.push({ expr: e, desc });
          if (!this.isPunct(this.t, ",")) break;
          this.next();
        }
      }
      if (this.isKeyword(this.t, "START")) {
        if (orderBy.length === 0) this.fail("START AT can only follow ORDER BY.");
        this.next();
        if (!this.isKeyword(this.t, "AT")) this.fail(`expected AT after START, but found ${describe(this.t)}.`);
        this.next();
        startAt = [];
        for (;;) {
          startAt.push(this.expr(0));
          if (!this.isPunct(this.t, ",")) break;
          this.next();
        }
        if (startAt.length > orderBy.length) this.fail(`START AT has ${startAt.length} values, but ORDER BY has only ${orderBy.length} expressions.`);
      }
      evaluates.push({ expr, orderBy, startAt, pos: { line: start.line, col: start.col } });
      if (!this.atEof() && !this.isKeyword(this.t, "EVALUATE")) {
        if (this.isKeyword(this.t, "DEFINE")) this.fail("DEFINE must come once, before the first EVALUATE.");
        if (this.isKeyword(this.t, "ORDER")) this.fail("ORDER BY must come before START AT, once per EVALUATE.");
        this.fail(`unexpected ${describe(this.t)} after the EVALUATE expression. Did you miss an operator or a comma?`);
      }
    }
    return { definitions, evaluates };
  }

  private startsClause(t: Token): boolean {
    return t.type === "ident" && ["EVALUATE", "ORDER", "START", "DEFINE"].includes(t.value.toUpperCase());
  }

  private definition(): QueryDefinition {
    const t = this.t;
    const pos = { line: t.line, col: t.col };
    const kw = t.type === "ident" ? t.value.toUpperCase() : "";
    if (kw === "MEASURE") {
      this.next();
      const ref = this.t;
      let table: string | null = null;
      if ((ref.type === "ident" || ref.type === "table") && this.peek().type === "column") table = ref.value;
      else if (ref.type === "column") this.fail(`write the measure with its table, as table[${ref.value}], after MEASURE.`);
      if (table === null) this.fail(`expected table[measure name] after MEASURE, but found ${describe(ref)}.`);
      this.next();
      const name = this.next().value;
      this.expectEquals(`MEASURE ${table}[${name}]`);
      return { kind: "measure", table, name, expr: this.definitionExpr(`MEASURE ${table}[${name}]`), pos };
    }
    if (kw === "VAR") {
      this.next();
      const nameTok = this.t;
      if (nameTok.type !== "ident" || QUERY_KEYWORDS.has(nameTok.value.toUpperCase()) || nameTok.value.toUpperCase() === "RETURN") {
        this.fail(`expected a variable name after VAR, but found ${describe(nameTok)}.`);
      }
      this.next();
      this.expectEquals(`VAR ${nameTok.value}`);
      return { kind: "var", name: nameTok.value, expr: this.definitionExpr(`VAR ${nameTok.value}`), pos };
    }
    if (kw === "COLUMN") throw unsupported("DEFINE COLUMN (a query-scoped calculated column)", "Add the column in the EVALUATE with ADDCOLUMNS instead.");
    if (kw === "TABLE") throw unsupported("DEFINE TABLE (a query-scoped calculated table)", "Use DEFINE VAR <name> = <table expression> instead.");
    if (kw === "FUNCTION") throw unsupported("DEFINE FUNCTION (a user-defined function)", "Write the logic in a MEASURE or VAR instead.");
    return this.fail(`expected MEASURE, VAR or EVALUATE after DEFINE, but found ${describe(t)}.`);
  }

  private expectEquals(what: string): void {
    if (!(this.t.type === "op" && this.t.value === "=")) this.fail(`expected '=' after ${what}, but found ${describe(this.t)}.`);
    this.next();
  }

  private definitionExpr(what: string): Node {
    if (this.atEof() || (this.t.type === "ident" && ["MEASURE", "EVALUATE", "DEFINE"].includes(this.t.value.toUpperCase()))) this.fail(`${what} has no expression after '='.`);
    return this.expr(0);
  }

  private infixOp(t: Token): string | null {
    if (t.type === "op") return t.value;
    if (this.isKeyword(t, "IN")) return "IN";
    return null;
  }

  private expr(minBp: number): Node {
    let left = this.prefix();
    for (;;) {
      const t = this.t;
      if (this.isKeyword(t, "NOT") && this.isKeyword(this.peek(), "IN")) {
        this.fail("DAX has no NOT IN operator. Write NOT ( <value> IN { ... } ) instead.");
      }
      const op = this.infixOp(t);
      if (!op) break;
      const bp = INFIX_BP[op];
      if (bp === undefined || bp <= minBp) break;
      this.next();
      if (this.atEof()) this.fail(`expected an expression after '${op}', but found the end of the expression.`);
      const right = this.expr(bp);
      left = { kind: "binary", op, left, right, pos: { line: t.line, col: t.col } };
    }
    return left;
  }

  private prefix(): Node {
    const t = this.t;
    const pos = { line: t.line, col: t.col };
    switch (t.type) {
      case "number":
        this.next();
        return { kind: "number", value: Number(t.value), pos };
      case "string":
        this.next();
        return { kind: "string", value: t.value, pos };
      case "column":
        this.next();
        return { kind: "column", table: null, name: t.value, pos };
      case "table": {
        this.next();
        if (this.t.type === "column") {
          const c = this.next();
          return { kind: "column", table: t.value, name: c.value, pos };
        }
        return { kind: "ident", name: t.value, quoted: true, pos };
      }
      case "op":
        if (t.value === "-" || t.value === "+") {
          this.next();
          const operand = this.expr(SIGN_BP);
          return { kind: "unary", op: t.value, operand, pos };
        }
        return this.fail(`unexpected operator '${t.value}'. An operator needs a value on its left.`);
      case "punct":
        if (t.value === "(") return this.paren();
        if (t.value === "{") return this.tableCtor();
        if (t.value === ")") return this.fail("unexpected ')'. Is there an extra closing parenthesis or a missing argument?");
        if (t.value === ",") return this.fail("unexpected ','. Is an argument missing?");
        return this.fail(`unexpected ${describe(t)}.`);
      case "eof":
        return this.fail("the expression ended unexpectedly. Is an argument or a closing parenthesis missing?");
      case "ident":
        return this.identExpr();
    }
  }

  private identExpr(): Node {
    const t = this.t;
    const pos = { line: t.line, col: t.col };
    const upper = t.value.toUpperCase();
    if (upper === "VAR") return this.varBlock();
    if (upper === "RETURN") this.fail("RETURN must follow one or more VAR definitions.");
    if (upper === "NOT") {
      this.next();
      const operand = this.expr(NOT_BP);
      return { kind: "unary", op: "NOT", operand, pos };
    }
    this.next();
    if (this.t.type === "column") {
      const c = this.next();
      return { kind: "column", table: t.value, name: c.value, pos };
    }
    if (this.isPunct(this.t, "(")) {
      const open = this.next();
      const args: Node[] = [];
      if (!this.isPunct(this.t, ")")) {
        for (;;) {
          if (this.isPunct(this.t, ",") || this.isPunct(this.t, ")")) {
            this.fail(`argument ${args.length + 1} of ${t.value} is missing.`);
          }
          args.push(this.expr(0));
          if (this.isPunct(this.t, ",")) {
            this.next();
            continue;
          }
          break;
        }
      }
      this.expectPunct(")", { what: `${t.value} (`, tok: open });
      if ((upper === "TRUE" || upper === "FALSE") && args.length === 0) return { kind: "bool", value: upper === "TRUE", pos };
      return { kind: "call", name: t.value, args, pos };
    }
    if (upper === "TRUE" || upper === "FALSE") return { kind: "bool", value: upper === "TRUE", pos };
    return { kind: "ident", name: t.value, quoted: false, pos };
  }

  private varBlock(): Node {
    const start = this.t;
    const decls: { name: string; expr: Node; pos: SourcePos }[] = [];
    while (this.isKeyword(this.t, "VAR")) {
      this.next();
      const nameTok = this.t;
      if (nameTok.type !== "ident" || ["VAR", "RETURN"].includes(nameTok.value.toUpperCase())) {
        this.fail(`expected a variable name after VAR, but found ${describe(nameTok)}.`);
      }
      this.next();
      if (!(this.t.type === "op" && this.t.value === "=")) this.fail(`expected '=' after VAR ${nameTok.value}, but found ${describe(this.t)}.`);
      this.next();
      if (this.isKeyword(this.t, "RETURN") || this.atEof()) this.fail(`VAR ${nameTok.value} has no expression after '='.`);
      const expr = this.expr(0);
      decls.push({ name: nameTok.value, expr, pos: { line: nameTok.line, col: nameTok.col } });
    }
    if (!this.isKeyword(this.t, "RETURN")) {
      this.fail(`expected RETURN after the VAR definitions that start at ${start.line}:${start.col}, but found ${describe(this.t)}.`);
    }
    this.next();
    if (this.atEof()) this.fail("RETURN needs an expression.");
    const body = this.expr(0);
    return { kind: "var", decls, body, pos: { line: start.line, col: start.col } };
  }

  private paren(): Node {
    const open = this.next();
    const pos = { line: open.line, col: open.col };
    const first = this.expr(0);
    if (this.isPunct(this.t, ",")) {
      const items = [first];
      while (this.isPunct(this.t, ",")) {
        this.next();
        items.push(this.expr(0));
      }
      this.expectPunct(")", { what: "the row tuple (", tok: open });
      return { kind: "tuple", items, pos };
    }
    this.expectPunct(")", { what: "'('", tok: open });
    return first;
  }

  private tableCtor(): Node {
    const open = this.next();
    const pos = { line: open.line, col: open.col };
    const rows: Node[][] = [];
    if (!this.isPunct(this.t, "}")) {
      for (;;) {
        const item = this.expr(0);
        rows.push(item.kind === "tuple" ? item.items : [item]);
        if (this.isPunct(this.t, ",")) {
          this.next();
          continue;
        }
        break;
      }
    }
    this.expectPunct("}", { what: "the table constructor {", tok: open });
    const width = rows[0]?.length ?? 1;
    rows.forEach((r, k) => {
      if (r.length !== width) this.fail(`row ${k + 1} of the table constructor has ${r.length} values, but row 1 has ${width}.`, open);
    });
    return { kind: "tableCtor", rows, pos };
  }
}

export function parseDax(src: string): ParseResult {
  const { tokens, comments } = lex(src);
  const ast = new Parser(tokens).parseProgram();
  return { ast, comments };
}

export function parseDaxQuery(src: string): DaxQuery {
  const { tokens, comments } = lex(src);
  return { ...new Parser(tokens).parseQuery(), comments };
}

/** Whether the text is a DAX query (starts with DEFINE or EVALUATE) rather than an expression. */
export function isDaxQuery(src: string): boolean {
  try {
    const t = lex(src).tokens[0]!;
    return t.type === "ident" && ["DEFINE", "EVALUATE"].includes(t.value.toUpperCase());
  } catch {
    return /^\s*(define|evaluate)\b/i.test(src);
  }
}

export function parse(src: string): Node {
  return parseDax(src).ast;
}

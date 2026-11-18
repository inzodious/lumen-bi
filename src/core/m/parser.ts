import type { Binding, Expr, Param, SectionDocument, SectionMember, TypeNode } from "./ast.ts";
import { MSyntaxError, type SourcePos } from "./errors.ts";
import { tokenize, type Token } from "./lexer.ts";

const PRIMITIVE_TYPES = new Set([
  "any",
  "anynonnull",
  "binary",
  "date",
  "datetime",
  "datetimezone",
  "duration",
  "function",
  "list",
  "logical",
  "none",
  "null",
  "number",
  "record",
  "table",
  "text",
  "time",
  "type",
]);

const TOKEN_NAMES: Record<string, string> = {
  ",": "Comma",
  ";": "Semicolon",
  "(": "LeftParen",
  ")": "RightParen",
  "[": "LeftBracket",
  "]": "RightBracket",
  "{": "LeftBrace",
  "}": "RightBrace",
  "=": "Equal",
  "=>": "FatArrow",
  in: "In",
  then: "Then",
  else: "Else",
  "": "Eof",
};

class Parser {
  private i = 0;
  constructor(
    private readonly tokens: Token[],
    private readonly src: string,
  ) {}

  private get tok(): Token {
    return this.tokens[this.i]!;
  }

  private peek(n = 1): Token {
    return this.tokens[Math.min(this.i + n, this.tokens.length - 1)]!;
  }

  private pos(t: Token = this.tok): SourcePos {
    return { line: t.line, col: t.col };
  }

  private fail(message: string, t: Token = this.tok): never {
    throw new MSyntaxError(message, t.line, t.col);
  }

  private is(value: string, kind?: Token["kind"]): boolean {
    const t = this.tok;
    return t.value === value && (kind ? t.kind === kind : t.kind === "op" || t.kind === "keyword");
  }

  private accept(value: string): boolean {
    if (this.is(value)) {
      this.i++;
      return true;
    }
    return false;
  }

  private expect(value: string): Token {
    if (!this.is(value)) this.fail(`Token ${TOKEN_NAMES[value] ?? `'${value}'`} expected.`);
    return this.tokens[this.i++]!;
  }

  private isContextual(word: string): boolean {
    return this.tok.kind === "ident" && this.tok.value === word;
  }

  parseDocumentOrExpression(): Expr {
    const e = this.expression();
    if (this.tok.kind !== "eof") this.fail("Token Eof expected.");
    return e;
  }

  identifierName(): string {
    const t = this.tok;
    if (t.kind === "ident" || t.kind === "quoted") {
      this.i++;
      return t.value;
    }
    return this.fail("Token Identifier expected.");
  }

  /** A generalized identifier, as allowed for record keys and field access: `[Folder Path]`, `[type]`. */
  private generalizedName(): string {
    const t = this.tok;
    if (t.kind === "quoted") {
      this.i++;
      return t.value;
    }
    if (t.kind !== "ident" && t.kind !== "keyword" && t.kind !== "number") this.fail("Token Identifier expected.");
    const first = this.tokens[this.i++]!;
    let last = first;
    while (
      (this.tok.kind === "ident" || this.tok.kind === "keyword" || this.tok.kind === "number") &&
      /^[ \t]+$/.test(this.src.slice(last.end, this.tok.start))
    ) {
      last = this.tokens[this.i++]!;
    }
    return this.src.slice(first.start, last.end).replace(/[ \t]+/g, " ");
  }

  expression(): Expr {
    const t = this.tok;
    const pos = this.pos();
    if (t.kind === "keyword") {
      switch (t.value) {
        case "let":
          return this.letExpr();
        case "if": {
          this.i++;
          const cond = this.expression();
          this.expect("then");
          const then = this.expression();
          this.expect("else");
          return { t: "if", cond, then, else: this.expression(), pos };
        }
        case "each":
          this.i++;
          return { t: "func", params: [{ name: "_", optional: false }], body: this.expression(), each: true, pos };
        case "try": {
          this.i++;
          const body = this.expression();
          if (this.accept("otherwise")) return { t: "try", body, otherwise: this.expression(), pos };
          if (this.accept("catch")) return { t: "try", body, catchFn: this.expression(), pos };
          return { t: "try", body, pos };
        }
        case "error":
          this.i++;
          return { t: "error", expr: this.expression(), pos };
      }
    }
    if (this.is("(")) {
      const fn = this.tryFunction();
      if (fn) return fn;
    }
    return this.coalesce();
  }

  private letExpr(): Expr {
    const pos = this.pos();
    this.expect("let");
    const bindings: Binding[] = [];
    // A comma needs another binding after it: `Step = …, in Step` is a syntax error in Power Query.
    do {
      bindings.push(this.binding(false));
      this.unique(bindings);
    } while (this.accept(","));
    if (!this.is("in")) this.fail("Token Comma expected.");
    this.i++;
    return { t: "let", bindings, body: this.expression(), pos };
  }

  private unique(bindings: Binding[]): void {
    const last = bindings[bindings.length - 1]!;
    if (bindings.slice(0, -1).some((b) => b.name === last.name)) throw new MSyntaxError(`The name '${last.name}' is defined more than once.`, last.pos.line, last.pos.col);
  }

  private binding(generalized: boolean): Binding {
    const pos = this.pos();
    const name = generalized ? this.generalizedName() : this.identifierName();
    this.expect("=");
    const start = this.tok.start;
    const expr = this.expression();
    return { name, expr, pos, span: [start, this.tokens[this.i - 1]!.end] };
  }

  /** `(a, optional b as text) as number => body`; returns null (and rewinds) if this is a parenthesized expression. */
  private tryFunction(): Expr | null {
    const save = this.i;
    const pos = this.pos();
    const header = this.functionHeader();
    if (!header) {
      this.i = save;
      return null;
    }
    return { t: "func", params: header.params, returnType: header.returnType, body: this.expression(), each: false, pos };
  }

  private functionHeader(): { params: Param[]; returnType?: TypeNode } | null {
    try {
      this.expect("(");
      const params: Param[] = [];
      if (!this.is(")")) {
        do {
          const optional = this.isContextual("optional") && (this.peek().kind === "ident" || this.peek().kind === "quoted");
          if (optional) this.i++;
          if (this.tok.kind !== "ident" && this.tok.kind !== "quoted") return null;
          const name = this.tokens[this.i++]!.value;
          let type: TypeNode | undefined;
          if (this.accept("as")) type = this.primitiveOrNullableType();
          params.push({ name, optional, type });
        } while (this.accept(","));
      }
      if (!this.accept(")")) return null;
      let returnType: TypeNode | undefined;
      if (this.accept("as")) returnType = this.primitiveOrNullableType();
      if (!this.accept("=>")) return null;
      return { params, returnType };
    } catch (e) {
      if (e instanceof MSyntaxError) return null;
      throw e;
    }
  }

  private coalesce(): Expr {
    const left = this.logicalOr();
    if (this.is("??")) {
      const pos = this.pos();
      this.i++;
      return { t: "binary", op: "??", left, right: this.coalesceRight(), pos };
    }
    return left;
  }

  private coalesceRight(): Expr {
    if (this.tok.kind === "keyword" && ["let", "if", "each", "try", "error"].includes(this.tok.value)) return this.expression();
    return this.coalesce();
  }

  private logicalOr(): Expr {
    let left = this.logicalAnd();
    while (this.is("or")) {
      const pos = this.pos();
      this.i++;
      left = { t: "binary", op: "or", left, right: this.logicalAnd(), pos };
    }
    return left;
  }

  private logicalAnd(): Expr {
    let left = this.isExpr();
    while (this.is("and")) {
      const pos = this.pos();
      this.i++;
      left = { t: "binary", op: "and", left, right: this.isExpr(), pos };
    }
    return left;
  }

  private isExpr(): Expr {
    let left = this.asExpr();
    while (this.is("is")) {
      const pos = this.pos();
      this.i++;
      left = { t: "is", expr: left, type: this.primitiveOrNullableType(), pos };
    }
    return left;
  }

  private asExpr(): Expr {
    let left = this.equality();
    while (this.is("as")) {
      const pos = this.pos();
      this.i++;
      left = { t: "as", expr: left, type: this.primitiveOrNullableType(), pos };
    }
    return left;
  }

  private equality(): Expr {
    let left = this.relational();
    while (this.is("=") || this.is("<>")) {
      const pos = this.pos();
      const op = this.tokens[this.i++]!.value as "=" | "<>";
      left = { t: "binary", op, left, right: this.relational(), pos };
    }
    return left;
  }

  private relational(): Expr {
    let left = this.additive();
    while (this.is("<") || this.is("<=") || this.is(">") || this.is(">=")) {
      const pos = this.pos();
      const op = this.tokens[this.i++]!.value as "<" | "<=" | ">" | ">=";
      left = { t: "binary", op, left, right: this.additive(), pos };
    }
    return left;
  }

  private additive(): Expr {
    let left = this.multiplicative();
    while (this.is("+") || this.is("-") || this.is("&")) {
      const pos = this.pos();
      const op = this.tokens[this.i++]!.value as "+" | "-" | "&";
      left = { t: "binary", op, left, right: this.multiplicative(), pos };
    }
    return left;
  }

  private multiplicative(): Expr {
    let left = this.metadata();
    while (this.is("*") || this.is("/")) {
      const pos = this.pos();
      const op = this.tokens[this.i++]!.value as "*" | "/";
      left = { t: "binary", op, left, right: this.metadata(), pos };
    }
    return left;
  }

  private metadata(): Expr {
    let left = this.unary();
    while (this.is("meta")) {
      const pos = this.pos();
      this.i++;
      left = { t: "meta", expr: left, meta: this.unary(), pos };
    }
    return left;
  }

  private unary(): Expr {
    const pos = this.pos();
    if (this.is("-") || this.is("+") || this.is("not")) {
      const op = this.tokens[this.i++]!.value as "+" | "-" | "not";
      return { t: "unary", op, expr: this.unary(), pos };
    }
    if (this.is("type")) {
      this.i++;
      return { t: "type", type: this.primaryType(), pos };
    }
    // Lenient: allow `1 + if ...` and similar without parentheses.
    if (this.tok.kind === "keyword" && ["let", "if", "each", "try", "error"].includes(this.tok.value)) return this.expression();
    return this.postfix(this.primary());
  }

  private postfix(e: Expr): Expr {
    for (;;) {
      const pos = this.pos();
      if (this.is("[")) {
        e = this.fieldAccess(e);
        continue;
      }
      if (this.is("{")) {
        this.i++;
        const key = this.expression();
        this.expect("}");
        const optional = this.accept("?");
        e = { t: "item", target: e, key, optional, pos };
        continue;
      }
      if (this.is("(")) {
        this.i++;
        const args: Expr[] = [];
        if (!this.is(")")) {
          do args.push(this.expression());
          while (this.accept(","));
        }
        this.expect(")");
        e = { t: "invoke", callee: e, args, pos: e.pos };
        continue;
      }
      return e;
    }
  }

  /** `[name]`, `[name]?`, `[[a], [b]]` after `target` (null = implicit `_`). */
  private fieldAccess(target: Expr | null): Expr {
    const pos = this.pos();
    this.expect("[");
    if (this.is("[")) {
      const names: string[] = [];
      do {
        this.expect("[");
        names.push(this.generalizedName());
        this.expect("]");
      } while (this.accept(","));
      this.expect("]");
      return { t: "project", target, names, optional: this.accept("?"), pos };
    }
    const name = this.generalizedName();
    this.expect("]");
    return { t: "field", target, name, optional: this.accept("?"), pos };
  }

  private primary(): Expr {
    const t = this.tok;
    const pos = this.pos();
    switch (t.kind) {
      case "number":
        this.i++;
        return { t: "literal", value: t.num!, pos };
      case "text":
        this.i++;
        return { t: "literal", value: t.value, pos };
      case "ident":
      case "quoted":
      case "hash":
        this.i++;
        return { t: "ident", name: t.value, inclusive: false, pos };
      case "keyword":
        if (t.value === "true" || t.value === "false") {
          this.i++;
          return { t: "literal", value: t.value === "true", pos };
        }
        if (t.value === "null") {
          this.i++;
          return { t: "literal", value: null, pos };
        }
        break;
      case "op":
        if (t.value === "@") {
          this.i++;
          const name = this.identifierName();
          return { t: "ident", name, inclusive: true, pos };
        }
        if (t.value === "(") {
          this.i++;
          const e = this.expression();
          this.expect(")");
          return e;
        }
        if (t.value === "[") return this.recordOrField();
        if (t.value === "{") return this.listLiteral();
        if (t.value === "...") {
          this.i++;
          return { t: "notimpl", pos };
        }
        break;
    }
    if (t.kind === "eof") return this.fail("Token Literal expected.");
    return this.fail(`Token Literal expected. Found '${t.value}'.`);
  }

  private recordOrField(): Expr {
    const pos = this.pos();
    if (this.peek().value === "]" && this.peek().kind === "op") {
      this.i += 2;
      return { t: "record", fields: [], pos };
    }
    if (this.peek().value === "[" && this.peek().kind === "op") return this.fieldAccess(null);
    const save = this.i;
    this.i++;
    this.generalizedName();
    const isField = this.is("]");
    this.i = save;
    if (isField) return this.fieldAccess(null);
    this.expect("[");
    const fields: Binding[] = [];
    do {
      if (this.is("]")) break;
      fields.push(this.binding(true));
      this.unique(fields);
    } while (this.accept(","));
    this.expect("]");
    return { t: "record", fields, pos };
  }

  private listLiteral(): Expr {
    const pos = this.pos();
    this.expect("{");
    const items: ({ range: false; expr: Expr } | { range: true; from: Expr; to: Expr })[] = [];
    if (!this.is("}")) {
      do {
        const from = this.expression();
        if (this.accept("..")) items.push({ range: true, from, to: this.expression() });
        else items.push({ range: false, expr: from });
      } while (this.accept(","));
    }
    this.expect("}");
    return { t: "list", items, pos };
  }

  private primitiveOrNullableType(): TypeNode {
    let nullable = false;
    if (this.isContextual("nullable")) {
      this.i++;
      nullable = true;
    }
    const t = this.tok;
    if ((t.kind === "ident" || t.kind === "keyword") && PRIMITIVE_TYPES.has(t.value)) {
      this.i++;
      return { k: "prim", name: t.value, nullable };
    }
    return this.fail("Token Identifier expected. Expected a primitive type such as text, number or date.");
  }

  /** The operand of `type`: primitive names, `nullable T`, `table [..]`, `[..]` record types, `{T}` list types. */
  private primaryType(): TypeNode {
    const t = this.tok;
    if (this.isContextual("nullable")) {
      this.i++;
      const inner = this.primaryType();
      return { ...inner, nullable: true };
    }
    if (t.kind === "ident" && t.value === "table") {
      this.i++;
      if (this.is("[")) return { k: "table", row: this.recordType(), nullable: false };
      if (this.is("(") || this.tok.kind === "ident") {
        const expr = this.postfix(this.primary());
        return { k: "table", row: { k: "expr", expr, nullable: false }, nullable: false };
      }
      return { k: "prim", name: "table", nullable: false };
    }
    if (t.kind === "ident" && t.value === "function" && this.peek().value === "(") {
      this.i++;
      this.expect("(");
      let depth = 1;
      while (depth > 0 && this.tok.kind !== "eof") {
        if (this.is("(")) depth++;
        if (this.is(")")) depth--;
        this.i++;
      }
      if (this.accept("as")) this.primitiveOrNullableType();
      return { k: "function", nullable: false };
    }
    if ((t.kind === "ident" || t.kind === "keyword") && PRIMITIVE_TYPES.has(t.value)) {
      this.i++;
      return { k: "prim", name: t.value, nullable: false };
    }
    if (this.is("[")) return this.recordType();
    if (this.is("{")) {
      this.i++;
      const item = this.primaryType();
      this.expect("}");
      return { k: "list", item, nullable: false };
    }
    const expr = this.postfix(this.primary());
    return { k: "expr", expr, nullable: false };
  }

  private recordType(): TypeNode {
    this.expect("[");
    const fields: { name: string; type: TypeNode; optional: boolean }[] = [];
    let open = false;
    if (!this.is("]")) {
      do {
        if (this.accept("...")) {
          open = true;
          break;
        }
        const optional = this.isContextual("optional") && this.peek().value !== "=";
        if (optional) this.i++;
        const name = this.generalizedName();
        let type: TypeNode = { k: "prim", name: "any", nullable: false };
        if (this.accept("=")) type = this.primaryType();
        fields.push({ name, type, optional });
      } while (this.accept(","));
    }
    this.expect("]");
    return { k: "record", fields, open, nullable: false };
  }

  section(): SectionDocument {
    const attributes = this.is("[") ? this.recordOrField() : null;
    if (!this.is("section")) this.fail("Token 'section' expected.");
    this.i++;
    const name = this.identifierName();
    this.expect(";");
    const members: SectionMember[] = [];
    while (this.tok.kind !== "eof") {
      const pos = this.pos();
      const attrs = this.is("[") ? this.recordOrField() : null;
      const shared = this.accept("shared");
      const name = this.identifierName();
      this.expect("=");
      const start = this.tok.start;
      const expr = this.expression();
      const end = this.tokens[this.i - 1]!.end;
      this.expect(";");
      members.push({ name, shared, attributes: attrs, expr, pos, span: [start, end] });
    }
    return { attributes, name, members, source: this.src };
  }
}

export function parseExpression(src: string): Expr {
  return new Parser(tokenize(src), src).parseDocumentOrExpression();
}

export function parseSection(src: string): SectionDocument {
  return new Parser(tokenize(src), src).section();
}

/** True if the text is a `section` document (optionally preceded by an attribute record). */
export function looksLikeSection(src: string): boolean {
  const tokens = tokenize(src);
  let depth = 0;
  for (const t of tokens) {
    if (t.kind === "op" && (t.value === "[" || t.value === "{" || t.value === "(")) depth++;
    else if (t.kind === "op" && (t.value === "]" || t.value === "}" || t.value === ")")) depth--;
    else if (depth === 0) return t.kind === "keyword" && t.value === "section";
  }
  return false;
}

import { DaxSyntaxError, unsupported } from "./errors.ts";

export type TokenType = "ident" | "number" | "string" | "table" | "column" | "op" | "punct" | "eof";

export interface Token {
  type: TokenType;
  /** Unquoted value: identifier text, string contents, table or column name, operator text. */
  value: string;
  line: number;
  col: number;
  /** Whitespace or a comment separates this token from the previous one. */
  spaceBefore: boolean;
  /** A line break separates this token from the previous one (or it is the first token). */
  lineBreakBefore: boolean;
}

export interface Comment {
  style: "--" | "//" | "/*";
  text: string;
  line: number;
  col: number;
}

export interface LexResult {
  tokens: Token[];
  comments: Comment[];
}

const TWO_CHAR_OPS = new Set(["&&", "||", "==", "<=", ">=", "<>"]);
const ONE_CHAR_OPS = new Set(["=", "<", ">", "+", "-", "*", "/", "^", "&"]);
const PUNCT = new Set(["(", ")", "{", "}", ","]);

function isIdentStart(ch: string): boolean {
  return /[\p{L}_]/u.test(ch);
}

function isIdentPart(ch: string): boolean {
  return /[\p{L}\p{N}_.]/u.test(ch);
}

export function lex(src: string): LexResult {
  const tokens: Token[] = [];
  const comments: Comment[] = [];
  let i = 0;
  let line = 1;
  let col = 1;
  let spaceBefore = false;
  let lineBreakBefore = true;

  const advance = (n: number) => {
    for (let k = 0; k < n; k++) {
      if (src[i] === "\n") {
        line++;
        col = 1;
      } else {
        col++;
      }
      i++;
    }
  };

  const push = (type: TokenType, value: string, l: number, c: number) => {
    tokens.push({ type, value, line: l, col: c, spaceBefore, lineBreakBefore });
    spaceBefore = false;
    lineBreakBefore = false;
  };

  while (i < src.length) {
    const ch = src[i]!;
    const next = src[i + 1] ?? "";
    if (ch === "\n") {
      spaceBefore = true;
      lineBreakBefore = true;
      advance(1);
      continue;
    }
    if (/\s/.test(ch)) {
      spaceBefore = true;
      advance(1);
      continue;
    }
    const l = line;
    const c = col;
    if ((ch === "-" && next === "-") || (ch === "/" && next === "/")) {
      let j = i;
      while (j < src.length && src[j] !== "\n") j++;
      comments.push({ style: ch === "-" ? "--" : "//", text: src.slice(i + 2, j), line: l, col: c });
      advance(j - i);
      spaceBefore = true;
      continue;
    }
    if (ch === "/" && next === "*") {
      const end = src.indexOf("*/", i + 2);
      if (end < 0) throw new DaxSyntaxError("the /* comment is never closed with */.", l, c);
      comments.push({ style: "/*", text: src.slice(i + 2, end), line: l, col: c });
      const text = src.slice(i, end + 2);
      advance(end + 2 - i);
      spaceBefore = true;
      if (text.includes("\n")) lineBreakBefore = true;
      continue;
    }
    if (ch === '"') {
      let j = i + 1;
      let value = "";
      for (;;) {
        if (j >= src.length) throw new DaxSyntaxError('the text literal is never closed with ".', l, c);
        if (src[j] === '"') {
          if (src[j + 1] === '"') {
            value += '"';
            j += 2;
            continue;
          }
          break;
        }
        value += src[j];
        j++;
      }
      advance(j + 1 - i);
      push("string", value, l, c);
      continue;
    }
    if (ch === "'") {
      let j = i + 1;
      let value = "";
      for (;;) {
        if (j >= src.length) throw new DaxSyntaxError("the quoted table name is never closed with '.", l, c);
        if (src[j] === "'") {
          if (src[j + 1] === "'") {
            value += "'";
            j += 2;
            continue;
          }
          break;
        }
        value += src[j];
        j++;
      }
      advance(j + 1 - i);
      push("table", value, l, c);
      continue;
    }
    if (ch === "[") {
      let j = i + 1;
      let value = "";
      for (;;) {
        if (j >= src.length) throw new DaxSyntaxError("the column or measure name is never closed with ].", l, c);
        if (src[j] === "]") {
          if (src[j + 1] === "]") {
            value += "]";
            j += 2;
            continue;
          }
          break;
        }
        value += src[j];
        j++;
      }
      advance(j + 1 - i);
      push("column", value, l, c);
      continue;
    }
    if (/[0-9]/.test(ch) || (ch === "." && /[0-9]/.test(next))) {
      const m = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(src.slice(i))!;
      advance(m[0].length);
      push("number", m[0], l, c);
      continue;
    }
    if (isIdentStart(ch)) {
      let j = i + 1;
      while (j < src.length && isIdentPart(src[j]!)) j++;
      const value = src.slice(i, j);
      advance(j - i);
      push("ident", value, l, c);
      continue;
    }
    const two = ch + next;
    if (TWO_CHAR_OPS.has(two)) {
      advance(2);
      push("op", two, l, c);
      continue;
    }
    if (ONE_CHAR_OPS.has(ch)) {
      advance(1);
      push("op", ch, l, c);
      continue;
    }
    if (PUNCT.has(ch)) {
      advance(1);
      push("punct", ch, l, c);
      continue;
    }
    if (ch === "]") throw new DaxSyntaxError("unexpected ']' without a matching '['.", l, c);
    if (ch === "@" && isIdentStart(next)) throw unsupported("Query parameters (@name)", "Write the value into the query instead.");
    throw new DaxSyntaxError(`unexpected character '${ch}'.`, l, c);
  }
  tokens.push({ type: "eof", value: "", line, col, spaceBefore, lineBreakBefore });
  return { tokens, comments };
}

import { MSyntaxError } from "./errors.ts";

export type TokenKind = "ident" | "quoted" | "hash" | "keyword" | "number" | "text" | "op" | "eof";

export interface Token {
  kind: TokenKind;
  value: string;
  num?: number;
  line: number;
  col: number;
  start: number;
  end: number;
}

export const KEYWORDS = new Set([
  "and",
  "as",
  "each",
  "else",
  "error",
  "false",
  "if",
  "in",
  "is",
  "let",
  "meta",
  "not",
  "null",
  "or",
  "otherwise",
  "section",
  "shared",
  "then",
  "true",
  "try",
  "type",
  "catch",
]);

const OPS = ["...", "..", "=>", "<=", ">=", "<>", "??", "=", "<", ">", "+", "-", "*", "/", "&", "(", ")", "[", "]", "{", "}", ",", ";", "?", "!", "@"];

const isIdStart = (c: string) => /[A-Za-z_À-￿]/.test(c);
const isIdPart = (c: string) => /[A-Za-z0-9_À-￿]/.test(c);

const ESCAPES: Record<string, string> = { cr: "\r", lf: "\n", tab: "\t", "#": "#" };

export function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  let line = 1;
  let lineStart = 0;
  const fail = (msg: string, at = i): never => {
    throw new MSyntaxError(msg, line, at - lineStart + 1);
  };
  const advanceLines = (from: number, to: number) => {
    for (let k = from; k < to; k++) {
      if (src[k] === "\n") {
        line++;
        lineStart = k + 1;
      }
    }
  };

  while (i < src.length) {
    const c = src[i]!;
    if (c === "\n") {
      line++;
      i++;
      lineStart = i;
      continue;
    }
    if (/\s/.test(c) || c === "﻿") {
      i++;
      continue;
    }
    if (c === "/" && src[i + 1] === "/") {
      while (i < src.length && src[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2);
      if (end < 0) fail("Unterminated comment.");
      advanceLines(i, end + 2);
      i = end + 2;
      continue;
    }
    const col = i - lineStart + 1;
    const startLine = line;
    const startLineStart = lineStart;
    const start = i;

    if (c === '"' || (c === "#" && src[i + 1] === '"')) {
      const quoted = c === "#";
      i += quoted ? 2 : 1;
      let text = "";
      for (;;) {
        if (i >= src.length) {
          line = startLine;
          lineStart = startLineStart;
          fail(quoted ? "Invalid identifier." : "Unterminated string literal.", start);
        }
        const ch = src[i]!;
        if (ch === '"') {
          if (src[i + 1] === '"') {
            text += '"';
            i += 2;
            continue;
          }
          i++;
          break;
        }
        if (ch === "#" && src[i + 1] === "(") {
          const close = src.indexOf(")", i + 2);
          if (close < 0) fail("Invalid escape sequence.");
          const parts = src.slice(i + 2, close).split(",").map((s) => s.trim());
          for (const part of parts) {
            if (ESCAPES[part] !== undefined) text += ESCAPES[part];
            else if (/^[0-9A-Fa-f]{4}$/.test(part) || /^[0-9A-Fa-f]{8}$/.test(part)) text += String.fromCodePoint(parseInt(part, 16));
            else fail("Invalid escape sequence.");
          }
          i = close + 1;
          continue;
        }
        if (ch === "\n") {
          line++;
          lineStart = i + 1;
        }
        text += ch;
        i++;
      }
      tokens.push({ kind: quoted ? "quoted" : "text", value: text, line: startLine, col, start, end: i });
      continue;
    }

    if (c === "#" && /[a-z]/i.test(src[i + 1] ?? "")) {
      i++;
      while (i < src.length && isIdPart(src[i]!)) i++;
      tokens.push({ kind: "hash", value: src.slice(start, i), line, col, start, end: i });
      continue;
    }

    if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(src[i + 1] ?? ""))) {
      let n: number;
      if (c === "0" && /[xX]/.test(src[i + 1] ?? "")) {
        i += 2;
        while (/[0-9a-fA-F]/.test(src[i] ?? "")) i++;
        n = parseInt(src.slice(start + 2, i), 16);
      } else {
        while (/[0-9]/.test(src[i] ?? "")) i++;
        if (src[i] === "." && /[0-9]/.test(src[i + 1] ?? "")) {
          i++;
          while (/[0-9]/.test(src[i] ?? "")) i++;
        }
        if (/[eE]/.test(src[i] ?? "") && /[0-9+-]/.test(src[i + 1] ?? "")) {
          i++;
          if (/[+-]/.test(src[i]!)) i++;
          while (/[0-9]/.test(src[i] ?? "")) i++;
        }
        n = Number(src.slice(start, i));
      }
      if (isIdStart(src[i] ?? "")) fail("Invalid literal.", start);
      tokens.push({ kind: "number", value: src.slice(start, i), num: n, line, col, start, end: i });
      continue;
    }

    if (isIdStart(c)) {
      i++;
      for (;;) {
        while (i < src.length && isIdPart(src[i]!)) i++;
        if (src[i] === "." && isIdStart(src[i + 1] ?? "")) {
          i++;
          continue;
        }
        break;
      }
      const word = src.slice(start, i);
      tokens.push({ kind: KEYWORDS.has(word) ? "keyword" : "ident", value: word, line, col, start, end: i });
      continue;
    }

    const op = OPS.find((o) => src.startsWith(o, i));
    if (!op) fail(`Unexpected character '${c}'.`);
    i += op!.length;
    tokens.push({ kind: "op", value: op!, line, col, start, end: i });
  }
  tokens.push({ kind: "eof", value: "", line, col: i - lineStart + 1, start: i, end: i });
  return tokens;
}

import type { SourcePos } from "./errors.ts";

export type BinaryOp = "+" | "-" | "*" | "/" | "&" | "=" | "<>" | "<" | "<=" | ">" | ">=" | "and" | "or" | "??";

export interface Binding {
  name: string;
  expr: Expr;
  pos: SourcePos;
  /** Source span of the binding's expression (used by the Applied Steps formula bar). */
  span: [number, number];
}

export interface Param {
  name: string;
  optional: boolean;
  type?: TypeNode;
}

export type TypeNode =
  | { k: "prim"; name: string; nullable: boolean }
  | { k: "record"; fields: { name: string; type: TypeNode; optional: boolean }[]; open: boolean; nullable: boolean }
  | { k: "list"; item: TypeNode; nullable: boolean }
  | { k: "table"; row: TypeNode; nullable: boolean }
  | { k: "function"; nullable: boolean }
  | { k: "expr"; expr: Expr; nullable: boolean };

export type Expr = { pos: SourcePos } & (
  | { t: "literal"; value: null | boolean | number | string }
  | { t: "ident"; name: string; inclusive: boolean }
  | { t: "let"; bindings: Binding[]; body: Expr }
  | { t: "record"; fields: Binding[] }
  | { t: "list"; items: ({ range: false; expr: Expr } | { range: true; from: Expr; to: Expr })[] }
  | { t: "func"; params: Param[]; returnType?: TypeNode; body: Expr; each: boolean }
  | { t: "if"; cond: Expr; then: Expr; else: Expr }
  | { t: "try"; body: Expr; otherwise?: Expr; catchFn?: Expr }
  | { t: "error"; expr: Expr }
  | { t: "binary"; op: BinaryOp; left: Expr; right: Expr }
  | { t: "unary"; op: "+" | "-" | "not"; expr: Expr }
  | { t: "field"; target: Expr | null; name: string; optional: boolean }
  | { t: "project"; target: Expr | null; names: string[]; optional: boolean }
  | { t: "item"; target: Expr; key: Expr; optional: boolean }
  | { t: "invoke"; callee: Expr; args: Expr[] }
  | { t: "type"; type: TypeNode }
  | { t: "is"; expr: Expr; type: TypeNode }
  | { t: "as"; expr: Expr; type: TypeNode }
  | { t: "meta"; expr: Expr; meta: Expr }
  | { t: "notimpl" }
);

export interface SectionMember {
  name: string;
  shared: boolean;
  attributes: Expr | null;
  expr: Expr;
  pos: SourcePos;
  span: [number, number];
}

export interface SectionDocument {
  attributes: Expr | null;
  name: string;
  members: SectionMember[];
  source: string;
}

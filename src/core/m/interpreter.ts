import type { Binding, Expr, TypeNode } from "./ast.ts";
import { conformsTo } from "./convert.ts";
import { MError } from "./errors.ts";
import type { MHost } from "./host.ts";
import { binaryOp, unaryOp } from "./ops.ts";
import {
  Lazy,
  MFunction,
  MList,
  MRecord,
  MTable,
  MType,
  T,
  cannotConvert,
  columnNotFound,
  describeValue,
  fieldNotFound,
  force,
  kindOf,
  kindTitle,
  typeTitle,
  valuesEqual,
  type Cell,
  type FunctionParam,
  type MValue,
} from "./values.ts";

export class Env {
  constructor(
    readonly vars: Map<string, Cell>,
    readonly parent: Env | null,
  ) {}

  lookup(name: string): Cell | undefined {
    for (let e: Env | null = this; e; e = e.parent) {
      const v = e.vars.get(name);
      if (v !== undefined) return v;
    }
    return undefined;
  }

  child(vars: Map<string, Cell>): Env {
    return new Env(vars, this);
  }
}

const metadata = new WeakMap<object, MRecord>();

export function metadataOf(v: MValue): MRecord | undefined {
  return v !== null && typeof v === "object" ? metadata.get(v) : undefined;
}

/** Attaches a metadata record to a (non-primitive) value, as `v meta m` does. */
export function setMetadata(v: MValue, meta: MRecord): void {
  if (v !== null && typeof v === "object") metadata.set(v, meta);
}

export function noHost(): MHost {
  return {
    request: (req) => {
      throw new MError(
        "DataSource.Error",
        `No data source is attached to this evaluation, so the ${req.kind} source can't be read. Evaluate the query through the refresh / preview driver to reach files, databases and the web.`,
      );
    },
    now: () => new Date(),
  };
}

export class Interpreter {
  readonly globals: Env;

  constructor(
    readonly host: MHost,
    library: Map<string, Cell>,
    private readonly unsupported: Map<string, string> = new Map(),
  ) {
    this.globals = new Env(library, null);
  }

  get localOffsetMinutes(): number {
    return this.host.localOffsetMinutes ?? 0;
  }

  evaluate(e: Expr, env: Env): MValue {
    try {
      return this.eval(e, env);
    } catch (err) {
      if (err instanceof MError && !err.pos) err.pos = e.pos;
      throw err;
    }
  }

  /** Lazily binds a group of mutually visible names (let, record literal, section). */
  bindGroup(bindings: { name: string; expr: Expr }[], env: Env): { env: Env; cells: Lazy[] } {
    const vars = new Map<string, Cell>();
    const scope = env.child(vars);
    const cells = bindings.map((b) => {
      const lazy = new Lazy(() => {
        const { value, meta } = this.evaluateWithMeta(b.expr, scope);
        lazy.meta = meta;
        return value;
      });
      vars.set(b.name, lazy);
      return lazy;
    });
    return { env: scope, cells };
  }

  private eval(e: Expr, env: Env): MValue {
    switch (e.t) {
      case "literal":
        return e.value;
      case "ident": {
        const cell = env.lookup(e.name);
        if (cell === undefined) {
          const unsupported = this.unsupported.get(e.name);
          if (unsupported) throw new MError("Expression.Error", unsupported, e.name);
          throw new MError("Expression.Error", `The name '${e.name}' wasn't recognized. Make sure it's spelled correctly.`, e.name);
        }
        return force(cell);
      }
      case "let": {
        const { env: scope } = this.bindGroup(e.bindings, env);
        return this.evaluate(e.body, scope);
      }
      case "record":
        return this.recordLiteral(e.fields, env);
      case "list": {
        const cells: Cell[] = [];
        for (const item of e.items) {
          if (!item.range) {
            const expr = item.expr;
            cells.push(expr.t === "literal" ? expr.value : new Lazy(() => this.evaluate(expr, env)));
            continue;
          }
          cells.push(...this.range(this.evaluate(item.from, env), this.evaluate(item.to, env)));
        }
        return new MList(cells);
      }
      case "func":
        return this.closure(e, env);
      case "if": {
        const c = this.evaluate(e.cond, env);
        if (typeof c !== "boolean") throw cannotConvert(c, "Logical");
        return this.evaluate(c ? e.then : e.else, env);
      }
      case "try":
        return this.tryExpr(e, env);
      case "error":
        throw this.raise(this.evaluate(e.expr, env));
      case "binary":
        return this.binary(e, env);
      case "unary":
        return unaryOp(e.op, this.evaluate(e.expr, env));
      case "field":
        return this.field(e.target ? this.evaluate(e.target, env) : this.implicit(env), e.name, e.optional);
      case "project":
        return this.project(e.target ? this.evaluate(e.target, env) : this.implicit(env), e.names, e.optional);
      case "item":
        return this.item(this.evaluate(e.target, env), this.evaluate(e.key, env), e.optional);
      case "invoke":
        return this.invoke(e, env);
      case "type":
        return this.typeOf(e.type, env);
      case "is":
        return conformsTo(this.evaluate(e.expr, env), this.typeOf(e.type, env));
      case "as": {
        const v = this.evaluate(e.expr, env);
        const t = this.typeOf(e.type, env);
        if (!conformsTo(v, t)) throw cannotConvert(v, typeTitle(t));
        return v;
      }
      case "meta":
        return this.evaluateWithMeta(e, env).value;
      case "notimpl":
        throw new MError("Expression.Error", "Not Implemented");
    }
  }

  private implicit(env: Env): MValue {
    const cell = env.lookup("_");
    if (cell === undefined) {
      throw new MError("Expression.Error", "The name '_' wasn't recognized. A bare [field] reference only works inside `each` or a function with a parameter named _.");
    }
    return force(cell);
  }

  recordLiteral(fields: Binding[], env: Env): MRecord {
    const seen = new Set<string>();
    for (const f of fields) {
      if (seen.has(f.name)) throw new MError("Expression.Error", `The field '${f.name}' already exists in the record.`, f.name);
      seen.add(f.name);
    }
    const { cells } = this.bindGroup(
      fields.map((f) => ({ name: f.name, expr: f.expr })),
      env,
    );
    return new MRecord(
      fields.map((f) => f.name),
      cells.map((c, i) => (fields[i]!.expr.t === "literal" ? (fields[i]!.expr as { value: MValue }).value : c)),
    );
  }

  private range(from: MValue, to: MValue): MValue[] {
    if (typeof from === "number" && typeof to === "number") {
      if (!Number.isInteger(from) || !Number.isInteger(to)) {
        throw new MError("Expression.Error", "List ranges need whole numbers, e.g. {1..5}.", [from, to]);
      }
      const out: number[] = [];
      for (let n = from; n <= to; n++) out.push(n);
      return out;
    }
    if (typeof from === "string" && typeof to === "string" && from.length === 1 && to.length === 1) {
      const out: string[] = [];
      for (let c = from.charCodeAt(0); c <= to.charCodeAt(0); c++) out.push(String.fromCharCode(c));
      return out;
    }
    throw new MError("Expression.Error", `We cannot apply operator .. to types ${kindTitle(kindOf(from))} and ${kindTitle(kindOf(to))}.`, [from, to]);
  }

  private closure(e: Extract<Expr, { t: "func" }>, env: Env): MFunction {
    const params: FunctionParam[] = e.params.map((p) => ({ name: p.name, optional: p.optional, type: p.type ? this.typeOf(p.type, env) : undefined }));
    const returnType = e.returnType ? this.typeOf(e.returnType, env) : undefined;
    const fnValue = new MFunction(e.each ? "each" : "function", params, (args) => {
      const vars = new Map<string, Cell>();
      params.forEach((p, i) => {
        const v = args[i] ?? null;
        if (p.type && !conformsTo(v, p.type)) throw cannotConvert(v, typeTitle(p.type));
        vars.set(p.name, v);
      });
      const result = this.evaluate(e.body, env.child(vars));
      if (returnType && !conformsTo(result, returnType)) throw cannotConvert(result, typeTitle(returnType));
      return result;
    });
    fnValue.origin = { expr: e, env, evaluate: (x) => this.evaluate(x as Expr, env) };
    return fnValue;
  }

  call(f: MValue, args: MValue[]): MValue {
    if (!(f instanceof MFunction)) throw cannotConvert(f, "Function");
    const min = f.minArgs;
    const max = f.params.length;
    if (args.length < min || args.length > max) {
      const expects = min === max ? `${max}` : `between ${min} and ${max}`;
      throw new MError("Expression.Error", `${args.length} arguments were passed to a function which expects ${expects}.`);
    }
    return f.impl(args);
  }

  private invoke(e: Extract<Expr, { t: "invoke" }>, env: Env): MValue {
    if (e.callee.t === "ident" && e.callee.name === "Value.Metadata" && e.args.length === 1 && env.lookup("Value.Metadata") === this.globals.vars.get("Value.Metadata")) {
      return this.valueMetadata(e.args[0]!, env);
    }
    const f = this.evaluate(e.callee, env);
    if (!(f instanceof MFunction)) throw cannotConvert(f, "Function");
    const args = e.args.map((a) => this.evaluate(a, env));
    return this.call(f, args);
  }

  private valueMetadata(arg: Expr, env: Env): MValue {
    return this.evaluateWithMeta(arg, env).meta ?? new MRecord([], []);
  }

  /**
   * Evaluates `e` and also returns its metadata record. Text, number and logical
   * values can't carry metadata themselves, so it travels on the Lazy cell of the
   * binding (let variable, record field or section member) that holds them.
   */
  evaluateWithMeta(e: Expr, env: Env): { value: MValue; meta?: MRecord } {
    try {
      return this.evalWithMeta(e, env);
    } catch (err) {
      if (err instanceof MError && !err.pos) err.pos = e.pos;
      throw err;
    }
  }

  private evalWithMeta(e: Expr, env: Env): { value: MValue; meta?: MRecord } {
    switch (e.t) {
      case "meta": {
        const inner = this.evaluateWithMeta(e.expr, env);
        const m = this.evaluate(e.meta, env);
        if (!(m instanceof MRecord)) throw cannotConvert(m, "Record");
        const meta = inner.meta ? mergeRecords(inner.meta, m) : m;
        if (inner.value !== null && typeof inner.value === "object") metadata.set(inner.value, meta);
        return { value: inner.value, meta };
      }
      case "ident": {
        const cell = env.lookup(e.name);
        if (cell instanceof Lazy) {
          const value = cell.get();
          return { value, meta: cell.meta ?? metadataOf(value) };
        }
        break;
      }
      case "let": {
        const { env: scope } = this.bindGroup(e.bindings, env);
        return this.evaluateWithMeta(e.body, scope);
      }
      case "field": {
        const target = e.target ? this.evaluate(e.target, env) : this.implicit(env);
        const cell = target instanceof MRecord ? target.cell(e.name) : undefined;
        if (cell instanceof Lazy) {
          const value = cell.get();
          return { value, meta: cell.meta ?? metadataOf(value) };
        }
        const value = this.field(target, e.name, e.optional);
        return { value, meta: metadataOf(value) };
      }
      case "if": {
        const c = this.evaluate(e.cond, env);
        if (typeof c !== "boolean") throw cannotConvert(c, "Logical");
        return this.evaluateWithMeta(c ? e.then : e.else, env);
      }
    }
    const value = this.evaluate(e, env);
    return { value, meta: metadataOf(value) };
  }

  private binary(e: Extract<Expr, { t: "binary" }>, env: Env): MValue {
    switch (e.op) {
      case "and": {
        const a = this.evaluate(e.left, env);
        if (a === false) return false;
        if (a !== true && a !== null) throw cannotConvert(a, "Logical");
        const b = this.evaluate(e.right, env);
        if (b !== true && b !== false && b !== null) throw cannotConvert(b, "Logical");
        if (b === false) return false;
        return a === null || b === null ? null : true;
      }
      case "or": {
        const a = this.evaluate(e.left, env);
        if (a === true) return true;
        if (a !== false && a !== null) throw cannotConvert(a, "Logical");
        const b = this.evaluate(e.right, env);
        if (b !== true && b !== false && b !== null) throw cannotConvert(b, "Logical");
        if (b === true) return true;
        return a === null || b === null ? null : false;
      }
      case "??": {
        const a = this.evaluate(e.left, env);
        return a === null ? this.evaluate(e.right, env) : a;
      }
      default:
        return binaryOp(e.op, this.evaluate(e.left, env), this.evaluate(e.right, env));
    }
  }

  private tryExpr(e: Extract<Expr, { t: "try" }>, env: Env): MValue {
    try {
      const v = this.evaluate(e.body, env);
      if (e.otherwise || e.catchFn) return v;
      return MRecord.from([
        ["HasError", false],
        ["Value", v],
      ]);
    } catch (err) {
      if (!(err instanceof MError)) throw err;
      if (e.otherwise) return this.evaluate(e.otherwise, env);
      const rec = errorRecord(err);
      if (e.catchFn) {
        const f = this.evaluate(e.catchFn, env);
        if (!(f instanceof MFunction)) throw cannotConvert(f, "Function");
        return this.call(f, f.params.length === 0 ? [] : [rec]);
      }
      return MRecord.from([
        ["HasError", true],
        ["Error", rec],
      ]);
    }
  }

  raise(v: MValue): MError {
    if (typeof v === "string") return new MError("Expression.Error", v);
    if (v instanceof MRecord) {
      const reason = v.has("Reason") ? v.get("Reason") : "Expression.Error";
      const message = v.has("Message") ? v.get("Message") : "";
      return new MError(typeof reason === "string" ? reason : "Expression.Error", typeof message === "string" ? message : describeValue(message), v.has("Detail") ? v.get("Detail") : null);
    }
    throw cannotConvert(v, "Record");
  }

  field(target: MValue, name: string, optional: boolean): MValue {
    if (target instanceof MRecord) {
      const cell = target.cell(name);
      if (cell === undefined) {
        if (optional) return null;
        throw fieldNotFound(name);
      }
      return force(cell);
    }
    if (target instanceof MTable) {
      if (!target.index.has(name)) {
        if (optional) return null;
        throw columnNotFound(name);
      }
      return target.column(name);
    }
    if (target === null && optional) return null;
    throw new MError("Expression.Error", `We cannot apply field access to the type ${kindTitle(kindOf(target))}.`, target);
  }

  private project(target: MValue, names: string[], optional: boolean): MValue {
    if (target instanceof MRecord) {
      const cells = names.map((n) => {
        const c = target.cell(n);
        if (c === undefined) {
          if (optional) return null;
          throw fieldNotFound(n);
        }
        return c;
      });
      return new MRecord(names, cells);
    }
    if (target instanceof MTable) {
      const idx = names.map((n) => (target.index.has(n) ? target.index.get(n)! : optional ? -1 : target.columnIndex(n)));
      return new MTable(
        names,
        idx.map((i) => (i < 0 ? T.any : target.types[i]!)),
        target.rows.map((r) => idx.map((i) => (i < 0 ? null : r[i]!))),
      );
    }
    if (target === null && optional) return null;
    throw new MError("Expression.Error", `We cannot apply field access to the type ${kindTitle(kindOf(target))}.`, target);
  }

  item(target: MValue, key: MValue, optional: boolean): MValue {
    if (target instanceof MList) {
      if (typeof key !== "number") throw cannotConvert(key, "Number");
      if (key < 0 || !Number.isInteger(key)) throw new MError("Expression.Error", "The index must be a non-negative whole number.", key);
      if (key >= target.length) {
        if (optional) return null;
        throw notEnoughElements();
      }
      return target.get(key);
    }
    if (target instanceof MTable) {
      if (typeof key === "number") {
        if (key >= target.rows.length || key < 0) {
          if (optional) return null;
          throw notEnoughElements();
        }
        return target.row(key);
      }
      if (key instanceof MRecord) {
        const hit = target.navLookup?.(key);
        if (hit) return hit;
        return lookupRow(target, key, optional);
      }
      throw cannotConvert(key, "Record");
    }
    if (target === null && optional) return null;
    throw cannotConvert(target, "List");
  }

  typeOf(node: TypeNode, env: Env): MType {
    const t = this.typeOfInner(node, env);
    return node.nullable ? t.asNullable() : t;
  }

  private typeOfInner(node: TypeNode, env: Env): MType {
    switch (node.k) {
      case "prim":
        return (T as Record<string, MType>)[node.name] ?? T.any;
      case "list":
        return new MType("list", false, undefined, undefined, this.typeOf(node.item, env));
      case "function":
        return T.function;
      case "record":
        return new MType(
          "record",
          false,
          undefined,
          node.fields.map((f) => ({ name: f.name, type: this.typeOf(f.type, env), optional: f.optional })),
          undefined,
          node.open,
        );
      case "table": {
        const row = this.typeOf(node.row, env);
        if (row.kind !== "record" || !row.fields) throw cannotConvert(row, "Record");
        return new MType("table", false, undefined, row.fields);
      }
      case "expr": {
        const v = this.evaluate(node.expr, env);
        if (!(v instanceof MType)) throw cannotConvert(v, "Type");
        return v;
      }
    }
  }
}

/** `x meta a meta b`: later fields win, like the `&` operator on records. */
function mergeRecords(a: MRecord, b: MRecord): MRecord {
  const names = [...a.names];
  const cells = [...a.cells];
  b.names.forEach((n, i) => {
    const at = a.index.get(n);
    if (at === undefined) {
      names.push(n);
      cells.push(b.cells[i]!);
    } else cells[at] = b.cells[i]!;
  });
  return new MRecord(names, cells);
}

export function notEnoughElements(): MError {
  return new MError("Expression.Error", "There weren't enough elements in the enumeration to complete the operation.");
}

export function lookupRow(table: MTable, key: MRecord, optional: boolean): MValue {
  const keyNames = key.names;
  const idx = keyNames.map((n) => table.index.get(n));
  const keyValues = keyNames.map((n) => key.get(n));
  let found = -1;
  if (idx.every((i) => i !== undefined)) {
    for (let r = 0; r < table.rows.length; r++) {
      const row = table.rows[r]!;
      if (idx.every((i, k) => valuesEqual(force(row[i!]!), keyValues[k]!))) {
        if (found >= 0) throw new MError("Expression.Error", "The key matched more than one row in the table.", key);
        found = r;
      }
    }
  }
  if (found < 0) {
    if (optional) return null;
    const hint = table.navHint?.(key);
    throw new MError("Expression.Error", `The key didn't match any rows in the table.${hint ? ` ${hint}` : ""}`, key);
  }
  return table.row(found);
}

export function errorRecord(err: MError): MRecord {
  const detail = err.detail;
  return MRecord.from([
    ["Reason", err.reason],
    ["Message", err.message],
    ["Detail", isMValue(detail) ? detail : detail === undefined ? null : String(detail)],
  ]);
}

function isMValue(v: unknown): v is MValue {
  return v === null || typeof v === "string" || typeof v === "number" || typeof v === "boolean" || (typeof v === "object" && !Array.isArray(v));
}

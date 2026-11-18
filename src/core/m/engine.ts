import type { Expr, SectionDocument } from "./ast.ts";
import { formatDate, formatDateTime, formatDuration, formatOffset, formatTime } from "./calendar.ts";
import { MError, type SourcePos } from "./errors.ts";
import type { MHost } from "./host.ts";
import { Env, Interpreter, noHost } from "./interpreter.ts";
import { createLibrary } from "./lib/index.ts";
import type { LibContext } from "./lib/util.ts";
import { looksLikeSection, parseExpression, parseSection } from "./parser.ts";
import {
  Lazy,
  MBinary,
  MDate,
  MDateTime,
  MDateTimeZone,
  MDuration,
  MFunction,
  MList,
  MRecord,
  MTable,
  MTime,
  MType,
  describeValue,
  kindOf,
  type Cell,
  type MValue,
  type ValueKind,
} from "./values.ts";

export const PREVIEW_ROWS = 100;

export interface ErrorInfo {
  reason: string;
  message: string;
  detail?: string;
  line?: number;
  col?: number;
}

export type PreviewCell =
  | null
  | boolean
  | number
  | string
  | { $kind: "Table" | "List" | "Record" | "Function" | "Type" | "Binary" }
  | { $error: ErrorInfo };

export type Preview =
  | { kind: "table"; columns: { name: string; type: string }[]; rows: PreviewCell[][]; rowCount: number; truncated: boolean }
  | { kind: "list"; items: PreviewCell[]; count: number; truncated: boolean }
  | { kind: "record"; fields: { name: string; value: PreviewCell }[] }
  | { kind: Exclude<ValueKind, "table" | "list" | "record">; value: PreviewCell; text: string };

export type StepResult =
  | { name: string; formula: string; pos: SourcePos; ok: true; kind: ValueKind; value: Preview }
  | { name: string; formula: string; pos: SourcePos; ok: false; kind: "error"; value: ErrorInfo };

export type QueryResult = { ok: true; kind: ValueKind; value: MValue; preview: Preview } | { ok: false; error: ErrorInfo };

export interface QueryEvaluation {
  steps: StepResult[];
  result: QueryResult;
}

export type ParameterValue = MValue | Date | unknown[] | Record<string, unknown>;

export interface EvaluateOptions {
  parameters?: Record<string, ParameterValue>;
  host?: MHost;
  /** Build a preview for every step (default true). */
  previewSteps?: boolean;
  /** Other queries this one can reference by name, as in a dataflow or a Power Query file (name → M source). */
  queries?: Record<string, string>;
}

export function errorInfo(e: unknown): ErrorInfo {
  if (e instanceof MError) {
    const info: ErrorInfo = { reason: e.reason, message: e.message };
    if (e.detail !== undefined && e.detail !== null) info.detail = detailText(e.detail);
    if (e.pos) {
      info.line = e.pos.line;
      info.col = e.pos.col;
    }
    return info;
  }
  throw e;
}

function detailText(d: unknown): string {
  if (typeof d === "string") return d;
  if (d instanceof MRecord) return `[${d.names.map((n) => `${n} = ${safeDescribe(d.cell(n)!)}`).join(", ")}]`;
  if (Array.isArray(d)) return d.map((x) => safeDescribe(x as MValue)).join(", ");
  return safeDescribe(d as MValue);
}

function safeDescribe(c: Cell): string {
  try {
    const v = c instanceof Lazy ? c.get() : c;
    return typeof v === "string" ? v : describeValue(v);
  } catch {
    return "[Error]";
  }
}

/** Converts a JS value (or an existing M value) to M. */
export function fromJs(v: ParameterValue): MValue {
  if (v === null || v === undefined) return null;
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return v;
  if (v instanceof Date) return new MDateTime(v.getTime());
  if (
    v instanceof MDate ||
    v instanceof MDateTime ||
    v instanceof MDateTimeZone ||
    v instanceof MTime ||
    v instanceof MDuration ||
    v instanceof MBinary ||
    v instanceof MList ||
    v instanceof MRecord ||
    v instanceof MTable ||
    v instanceof MFunction ||
    v instanceof MType
  ) {
    return v;
  }
  if (Array.isArray(v)) return MList.of(v.map((x) => fromJs(x as ParameterValue)));
  return MRecord.from(Object.entries(v).map(([k, x]) => [k, fromJs(x as ParameterValue)]));
}

function scalarJs(v: MValue): PreviewCell | undefined {
  if (v === null || typeof v === "boolean" || typeof v === "number" || typeof v === "string") return v;
  if (v instanceof MDate) return formatDate(v.days);
  if (v instanceof MDateTime) return formatDateTime(v.ms);
  if (v instanceof MDateTimeZone) return `${formatDateTime(v.ms)}${formatOffset(v.offsetMinutes)}`;
  if (v instanceof MTime) return formatTime(v.ms);
  if (v instanceof MDuration) return formatDuration(v.ms);
  return undefined;
}

/** A deep, plain-JS copy: tables become arrays of row objects; error cells become `{ $error }`. */
export function toJs(v: MValue): unknown {
  const s = scalarJs(v);
  if (s !== undefined) return s;
  if (v instanceof MList) return v.cells.map(cellJs);
  if (v instanceof MRecord) return Object.fromEntries(v.names.map((n) => [n, cellJs(v.cell(n)!)]));
  if (v instanceof MTable) return v.rows.map((r) => Object.fromEntries(v.columns.map((c, i) => [c, cellJs(r[i]!)])));
  return { $kind: kindTitle(v) };
}

function cellJs(c: Cell): unknown {
  try {
    return toJs(c instanceof Lazy ? c.get() : c);
  } catch (e) {
    return { $error: errorInfo(e) };
  }
}

function kindTitle(v: MValue): "Table" | "List" | "Record" | "Function" | "Type" | "Binary" {
  const k = kindOf(v);
  return (k.charAt(0).toUpperCase() + k.slice(1)) as "Table";
}

export function previewCell(c: Cell): PreviewCell {
  try {
    const v = c instanceof Lazy ? c.get() : c;
    const s = scalarJs(v);
    return s !== undefined ? s : { $kind: kindTitle(v) };
  } catch (e) {
    return { $error: errorInfo(e) };
  }
}

export function preview(v: MValue, limit = PREVIEW_ROWS): Preview {
  if (v instanceof MTable) {
    return {
      kind: "table",
      columns: v.columns.map((c, i) => ({ name: c, type: v.types[i]!.toString() })),
      rows: v.rows.slice(0, limit).map((r) => r.map(previewCell)),
      rowCount: v.rows.length,
      truncated: v.rows.length > limit,
    };
  }
  if (v instanceof MList) {
    return { kind: "list", items: v.cells.slice(0, limit).map(previewCell), count: v.length, truncated: v.length > limit };
  }
  if (v instanceof MRecord) return { kind: "record", fields: v.names.map((n) => ({ name: n, value: previewCell(v.cell(n)!) })) };
  const kind = kindOf(v) as Exclude<ValueKind, "table" | "list" | "record">;
  return { kind, value: previewCell(v), text: typeof v === "string" ? v : describeValue(v) };
}

export interface Session {
  interp: Interpreter;
  env: Env;
}

/** An interpreter plus an environment holding the parameters. */
export function createSession(host: MHost = noHost(), parameters: Record<string, ParameterValue> = {}): Session {
  let interp: Interpreter | null = null;
  const ctx: LibContext = {
    call: (f, args) => interp!.call(f, args),
    evaluateSource: (src, envRecord) => {
      const expr = parseExpression(src);
      if (!envRecord) return interp!.evaluate(expr, interp!.globals);
      const vars = new Map<string, Cell>(envRecord.names.map((n) => [n, envRecord.cell(n)!]));
      return interp!.evaluate(expr, new Env(vars, null));
    },
    shared: () => {
      const names = [...interp!.globals.vars.keys()].filter((n) => !n.startsWith("#"));
      return new MRecord(names, names.map((n) => interp!.globals.vars.get(n)!));
    },
    host,
    get localOffsetMinutes() {
      return host.localOffsetMinutes ?? 0;
    },
  };
  const { entries, unsupported } = createLibrary(ctx);
  interp = new Interpreter(host, entries, unsupported);
  const vars = new Map<string, Cell>(Object.entries(parameters).map(([k, v]) => [k, fromJs(v)]));
  return { interp, env: interp.globals.child(vars) };
}

function resultOf(fn: () => MValue): QueryResult {
  try {
    const value = fn();
    return { ok: true, kind: kindOf(value), value, preview: preview(value) };
  } catch (e) {
    return { ok: false, error: errorInfo(e) };
  }
}

function stepsOf(
  bindings: { name: string; pos: SourcePos; span: [number, number] }[],
  cells: Lazy[],
  source: string,
): StepResult[] {
  return bindings.map((b, i) => {
    const formula = source.slice(b.span[0], b.span[1]);
    try {
      const v = cells[i]!.get();
      return { name: b.name, formula, pos: b.pos, ok: true, kind: kindOf(v), value: preview(v) };
    } catch (e) {
      return { name: b.name, formula, pos: b.pos, ok: false, kind: "error", value: errorInfo(e) };
    }
  });
}

/** Evaluates one query. A top-level `let` becomes Applied Steps, one per binding; unused steps never fail the query. */
export function evaluateQuery(source: string, options: EvaluateOptions = {}): QueryEvaluation {
  let expr: Expr;
  try {
    expr = parseExpression(source);
  } catch (e) {
    return { steps: [], result: { ok: false, error: errorInfo(e) } };
  }
  const { interp, env: base } = createSession(options.host, options.parameters);
  let env = base;
  if (options.queries) {
    const vars = new Map<string, Cell>();
    env = base.child(vars);
    const scope = env;
    for (const [name, src] of Object.entries(options.queries)) {
      const query: Lazy = new Lazy(() => {
        const { value, meta } = interp.evaluateWithMeta(parseExpression(src), scope);
        query.meta = meta;
        return value;
      });
      vars.set(name, query);
    }
  }
  if (expr.t !== "let") return { steps: [], result: resultOf(() => interp.evaluate(expr, env)) };
  const { env: scope, cells } = interp.bindGroup(expr.bindings, env);
  const result = resultOf(() => interp.evaluate(expr.body, scope));
  const steps = options.previewSteps === false ? [] : stepsOf(expr.bindings, cells, source);
  return { steps, result };
}

/** Evaluates an expression and returns the raw M value (throws MError). */
export function evaluate(source: string, options: EvaluateOptions = {}): MValue {
  const { interp, env } = createSession(options.host, options.parameters);
  return interp.evaluate(parseExpression(source), env);
}

export interface ParameterEvaluation {
  value: MValue;
  meta: Record<string, unknown>;
  isParameterQuery: boolean;
}

/** An `expressions.tmdl`-style parameter: `"lh_curated" meta [IsParameterQuery=true, Type="Text", ...]`. */
export function evaluateParameter(source: string, host?: MHost): ParameterEvaluation {
  const expr = parseExpression(source);
  const { interp, env } = createSession(host);
  const { value, meta: metaValue } = interp.evaluateWithMeta(expr, env);
  const meta = (metaValue ? toJs(metaValue) : {}) as Record<string, unknown>;
  return { value, meta, isParameterQuery: meta.IsParameterQuery === true };
}

export interface DestinationInfo {
  queryName: string;
  found: boolean;
  isNewTarget: boolean | null;
  settingsKind: string | null;
  updateMethod: string;
  columnMappings: { source: string; destination: string }[] | null;
  target: {
    workspaceId?: string;
    workspaceName?: string;
    lakehouseId?: string;
    lakehouse?: string;
    schema?: string;
    table?: string;
  };
}

export interface SectionQuery {
  name: string;
  shared: boolean;
  attributes: Record<string, unknown> | null;
  /** True for `<query>_DataDestination` helpers referenced by another query's DataDestinations. */
  isDestinationQuery: boolean;
  steps: StepResult[];
  result: QueryResult;
  destination?: DestinationInfo;
}

export interface SectionEvaluation {
  ok: boolean;
  section: string;
  attributes: Record<string, unknown> | null;
  queries: SectionQuery[];
  issues: string[];
  error?: ErrorInfo;
}

function literalKeys(e: Expr, out: Record<string, MValue>[]): void {
  const visit = (x: unknown): void => {
    if (!x || typeof x !== "object") return;
    if (Array.isArray(x)) {
      x.forEach(visit);
      return;
    }
    const node = x as Expr;
    if (node.t === "item" && node.key.t === "record" && node.key.fields.every((f) => f.expr.t === "literal")) {
      visit(node.target);
      out.push(Object.fromEntries(node.key.fields.map((f) => [f.name, (f.expr as { value: MValue }).value])));
      return;
    }
    for (const v of Object.values(node)) if (v && typeof v === "object" && v !== node.pos) visit(v);
  };
  visit(e);
}

function destinationTarget(expr: Expr, host: MHost): DestinationInfo["target"] {
  const keys: Record<string, MValue>[] = [];
  literalKeys(expr, keys);
  const target: DestinationInfo["target"] = {};
  for (const k of keys) {
    if (typeof k.workspaceId === "string") target.workspaceId = k.workspaceId;
    if (typeof k.workspaceName === "string") target.workspaceName = k.workspaceName;
    if (typeof k.lakehouseId === "string") target.lakehouseId = k.lakehouseId;
    if (typeof k.lakehouseName === "string") target.lakehouse = k.lakehouseName;
    if (k.ItemKind === "Schema" && typeof k.Id === "string") target.schema = k.Id;
    if (k.ItemKind === "Table" && typeof k.Id === "string") target.table = k.Id;
  }
  if (target.lakehouseId && !target.lakehouse) {
    try {
      for (const ws of host.request({ kind: "lakehouse-contents" })) {
        const lh = ws.lakehouses.find((l) => l.id === target.lakehouseId);
        if (lh) target.lakehouse = lh.name;
      }
    } catch {
      /* host without lakehouses: leave the id unresolved */
    }
  }
  return target;
}

function field(v: unknown, ...path: string[]): unknown {
  let cur = v;
  for (const p of path) cur = cur && typeof cur === "object" ? (cur as Record<string, unknown>)[p] : undefined;
  return cur;
}

/**
 * Evaluates a dataflow `section` document: every member is a query, all members
 * see each other, and `[DataDestinations = ...]` attributes are paired with
 * their `<query>_DataDestination` members.
 */
export function evaluateSection(doc: string | SectionDocument, host: MHost = noHost(), options: Omit<EvaluateOptions, "host"> = {}): SectionEvaluation {
  let section: SectionDocument;
  try {
    if (typeof doc === "string" && !looksLikeSection(doc)) {
      throw new MError("Expression.SyntaxError", "Expected a section document (`section Section1;` followed by `shared` queries).");
    }
    section = typeof doc === "string" ? parseSection(doc) : doc;
  } catch (e) {
    return { ok: false, section: "", attributes: null, queries: [], issues: [], error: errorInfo(e) };
  }
  const { interp, env } = createSession(host, options.parameters);
  const attrs = (e: Expr | null): Record<string, unknown> | null => {
    if (!e) return null;
    try {
      return toJs(interp.evaluate(e, interp.globals)) as Record<string, unknown>;
    } catch {
      return null;
    }
  };

  const stash = new Map<string, Lazy[]>();
  const vars = new Map<string, Cell>();
  const sectionEnv = env.child(vars);
  for (const m of section.members) {
    const expr = m.expr;
    const member: Lazy = new Lazy(() => {
      let evaluated: { value: MValue; meta?: MRecord };
      if (expr.t !== "let") evaluated = interp.evaluateWithMeta(expr, sectionEnv);
      else {
        const { env: scope, cells } = interp.bindGroup(expr.bindings, sectionEnv);
        stash.set(m.name, cells);
        evaluated = interp.evaluateWithMeta(expr.body, scope);
      }
      member.meta = evaluated.meta;
      return evaluated.value;
    });
    vars.set(m.name, member);
  }

  const memberNames = new Set(section.members.map((m) => m.name));
  const destinationNames = new Set<string>();
  const issues: string[] = [];
  const queries: SectionQuery[] = section.members.map((m) => {
    const attributes = attrs(m.attributes);
    const result = resultOf(() => (vars.get(m.name) as Lazy).get());
    const cells = stash.get(m.name);
    const steps = m.expr.t === "let" && cells && options.previewSteps !== false ? stepsOf(m.expr.bindings, cells, section.source) : [];
    const q: SectionQuery = { name: m.name, shared: m.shared, attributes, isDestinationQuery: false, steps, result };
    const dests = field(attributes, "DataDestinations");
    if (Array.isArray(dests) && dests.length) {
      const d = dests[0];
      const queryName = String(field(d, "Definition", "QueryName") ?? "");
      destinationNames.add(queryName);
      const found = memberNames.has(queryName);
      if (!found) issues.push(`Query '${m.name}' points its data destination at '${queryName}', but the section has no query with that name.`);
      if (dests.length > 1) issues.push(`Query '${m.name}' has ${dests.length} data destinations; only the first is used.`);
      const mappings = field(d, "Settings", "ColumnSettings", "Mappings");
      const member = section.members.find((x) => x.name === queryName);
      q.destination = {
        queryName,
        found,
        isNewTarget: (field(d, "Definition", "IsNewTarget") as boolean | undefined) ?? null,
        settingsKind: (field(d, "Settings", "Kind") as string | undefined) ?? null,
        updateMethod: (field(d, "Settings", "UpdateMethod", "Kind") as string | undefined) ?? "Replace",
        columnMappings: Array.isArray(mappings)
          ? mappings.map((x) => ({ source: String(field(x, "SourceColumnName")), destination: String(field(x, "DestinationColumnName")) }))
          : null,
        target: member ? destinationTarget(member.expr, host) : {},
      };
      if (result.ok && result.kind !== "table") issues.push(`Query '${m.name}' has a data destination but returns a ${result.kind}, not a table.`);
    }
    return q;
  });
  for (const q of queries) q.isDestinationQuery = destinationNames.has(q.name);
  return {
    ok: queries.every((q) => q.result.ok || q.isDestinationQuery),
    section: section.name,
    attributes: attrs(section.attributes),
    queries,
    issues,
  };
}

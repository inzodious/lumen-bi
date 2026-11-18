/**
 * Fetch-and-replay driver: runs the synchronous M interpreter against async data sources.
 *
 * Evaluation asks the host for external data through `MHost.request`. A `CachingHost` answers from its
 * cache; on a miss it records the request and throws `NeedData`. Library code that evaluates per cell
 * (e.g. Table.AddColumn) may swallow that exception into an error cell, which is why the driver does not
 * rely on the exception reaching it: any pass that recorded a miss is discarded. The driver then fetches
 * every recorded request (in parallel, bounded), caches answers — or the failure, as a DataSource.Error —
 * and evaluates again. Passes are deterministic (the clock is frozen per run), so the final pass sees
 * exactly the data the earlier passes asked for. Batching misses per pass keeps the pass count low
 * (typically 2–4) even for queries that read many files.
 */
import { MError } from "./errors.ts";
import type { DataAnswers, DataRequest, MHost } from "./host.ts";

export class NeedData extends Error {
  constructor(readonly request: DataRequest) {
    super(`Waiting for data: ${describeRequest(request)}`);
    this.name = "NeedData";
  }
}

export function describeRequest(r: DataRequest): string {
  switch (r.kind) {
    case "file":
      return `file ${r.path}`;
    case "folder":
      return `folder ${r.path}`;
    case "sql-items":
      return `SQL navigation ${r.server};${r.database}`;
    case "sql-databases":
      return `SQL databases on ${r.server}`;
    case "sql":
      return r.query ? `SQL query on ${r.server};${r.database}` : `SQL table ${r.server};${r.database} [${r.schema}].[${r.item}]`;
    case "http":
      return `${r.method} ${r.url}`;
    case "decode":
      return `${r.format} decoding`;
    case "db-items":
      return `${r.driver} navigation ${r.server};${r.database}`;
    case "db-databases":
      return `${r.driver} databases on ${r.server}`;
    case "db":
      return `${r.driver} query on ${r.server};${r.database}`;
    case "firestore-collections":
      return `Firestore collections of ${r.project}${r.parent ? `/${r.parent}` : ""}`;
    case "firestore-query":
      return `Firestore ${r.parent ? `${r.parent}/` : ""}${r.collection}`;
    case "s3-list":
      return `s3://${r.bucket}/${r.prefix}`;
    case "s3-object":
      return `s3://${r.bucket}/${r.key}`;
    default:
      return r.kind;
  }
}

/** FNV-1a over bytes (cache keys for decoded binaries). */
export function bytesKey(bytes: Uint8Array): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < bytes.length; i++) {
    h1 = Math.imul(h1 ^ bytes[i]!, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ bytes[i]!, 0x5bd1e995) >>> 0;
  }
  return `${bytes.length.toString(36)}-${h1.toString(36)}-${h2.toString(36)}`;
}

/** Stable cache key of a request (bytes of decode requests are represented by their key). */
export function requestKey(r: DataRequest): string {
  if (r.kind === "decode") return `decode:${r.format}:${r.key}`;
  if (r.kind === "http") return `http:${r.method}:${r.url}:${JSON.stringify(Object.entries(r.headers).sort())}:${r.body ?? ""}`;
  const parts: string[] = [r.kind];
  for (const [k, v] of Object.entries(r).sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (k === "kind" || v === undefined) continue;
    // server names are case-insensitive (SQLite's "server" is a file path, which isn't)
    const lower = k === "server" && !("driver" in r && (r.driver === "sqlite" || r.driver === "duckdb"));
    parts.push(`${k}=${typeof v === "string" ? (lower ? v.toLowerCase() : v) : JSON.stringify(v)}`);
  }
  return parts.join("|");
}

type CacheEntry = { ok: true; value: unknown } | { ok: false; reason: string; message: string; detail?: string };

/** A request cache shared across evaluations (e.g. one per Power Query Editor session or refresh run). */
export class DataCache {
  private readonly entries = new Map<string, CacheEntry>();
  get(key: string): CacheEntry | undefined {
    return this.entries.get(key);
  }
  set(key: string, entry: CacheEntry): void {
    this.entries.set(key, entry);
  }
  delete(key: string): void {
    this.entries.delete(key);
  }
  clear(): void {
    this.entries.clear();
  }
  /** Forget failures (so a retry, e.g. after entering credentials, fetches again). */
  clearErrors(): void {
    for (const [k, v] of this.entries) if (!v.ok) this.entries.delete(k);
  }
  get size(): number {
    return this.entries.size;
  }
}

/** Synchronous host backed by a DataCache; misses are recorded and reported with NeedData. */
export class CachingHost implements MHost {
  readonly pending = new Map<string, DataRequest>();
  readonly folding = true;
  constructor(
    readonly cache: DataCache,
    private readonly clock: Date,
    readonly localOffsetMinutes = 0,
    readonly foldComputed = true,
    private readonly onRequest?: (req: DataRequest) => void,
  ) {}

  now(): Date {
    return this.clock;
  }

  request<K extends DataRequest["kind"]>(req: Extract<DataRequest, { kind: K }>): DataAnswers[K] {
    this.onRequest?.(req);
    const key = requestKey(req);
    const hit = this.cache.get(key);
    if (hit) {
      if (hit.ok) return hit.value as DataAnswers[K];
      throw new MError(hit.reason, hit.message, hit.detail ?? null);
    }
    this.pending.set(key, req);
    throw new NeedData(req);
  }
}

/** Performs one request asynchronously. Throw an MError (or any Error → DataSource.Error) for a failure. */
export type DataFetcher = (req: DataRequest, signal?: AbortSignal) => Promise<unknown>;

export interface DriverOptions {
  cache?: DataCache;
  /** Frozen clock for the whole run (default: now). */
  now?: Date;
  localOffsetMinutes?: number;
  /** Maximum evaluation passes (default 512: paged APIs fetch one page per pass). */
  maxPasses?: number;
  /** Parallel fetches (default 4). */
  concurrency?: number;
  signal?: AbortSignal;
  /** Called before each fetch batch (UI progress: "Waiting for …"). */
  onFetch?: (requests: DataRequest[]) => void;
  /** Called for every request of the final pass (cache hits included): which sources a query read. */
  onRequest?: (req: DataRequest) => void;
  /** See MHost.foldComputed (privacy levels). */
  foldComputed?: boolean;
}

export class DriverError extends Error {}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new DOMException("The operation was aborted.", "AbortError");
}

function failureOf(e: unknown): CacheEntry {
  if (e instanceof MError) return { ok: false, reason: e.reason, message: e.message, detail: typeof e.detail === "string" ? e.detail : undefined };
  const message = e instanceof Error ? e.message : String(e);
  return { ok: false, reason: "DataSource.Error", message };
}

/**
 * Runs `evaluate` until it completes without data misses. `evaluate` receives a fresh-pass host each
 * time and must be a pure function of the host's data (build interpreter state inside it).
 */
export async function runWithData<T>(evaluate: (host: CachingHost) => T, fetch: DataFetcher, opts: DriverOptions = {}): Promise<T> {
  const cache = opts.cache ?? new DataCache();
  const clock = opts.now ?? new Date();
  const maxPasses = opts.maxPasses ?? 512;
  const concurrency = Math.max(1, opts.concurrency ?? 4);
  for (let pass = 0; pass < maxPasses; pass++) {
    throwIfAborted(opts.signal);
    const seen: DataRequest[] = [];
    const host = new CachingHost(cache, clock, opts.localOffsetMinutes ?? 0, opts.foldComputed ?? true, opts.onRequest ? (r) => seen.push(r) : undefined);
    let result: T | undefined;
    let error: unknown;
    let threw = false;
    try {
      result = evaluate(host);
    } catch (e) {
      threw = true;
      error = e;
    }
    if (host.pending.size === 0) {
      for (const r of seen) opts.onRequest?.(r);
      if (threw) throw error;
      return result as T;
    }
    const batch = [...host.pending.entries()];
    opts.onFetch?.(batch.map(([, r]) => r));
    let next = 0;
    const worker = async () => {
      while (next < batch.length) {
        const [key, req] = batch[next++]!;
        throwIfAborted(opts.signal);
        try {
          cache.set(key, { ok: true, value: await fetch(req, opts.signal) });
        } catch (e) {
          throwIfAborted(opts.signal);
          cache.set(key, failureOf(e));
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, batch.length) }, worker));
  }
  throw new DriverError(`The query needed more than ${maxPasses} rounds of data fetching; it was stopped. Simplify the query (e.g. Table.Buffer a source that is read per row).`);
}

/** A synchronous host over a fixed answer table (tests, previews of pure queries). */
export function staticHost(answers: (req: DataRequest) => unknown, now: Date = new Date(), localOffsetMinutes = 0): MHost {
  return {
    now: () => now,
    localOffsetMinutes,
    request: (req) => answers(req) as never,
  };
}

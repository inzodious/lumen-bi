import { DuckSyncDb, type BlockingBindings } from "./duck.ts";
import type { SyncDb } from "./types.ts";

export interface BrowserBundleUrls {
  mvpModule: string;
  ehModule: string;
}

export interface BlockingDuckModule {
  createDuckDB(bundles: unknown, logger: unknown, runtime: unknown): Promise<BlockingBindings & { instantiate(progress: () => void): Promise<unknown> }>;
  VoidLogger: new () => unknown;
  BROWSER_RUNTIME: unknown;
}

/**
 * Must run inside a Web Worker: the blocking bindings execute synchronously,
 * which is what lets Pyodide call into the same DuckDB instance without awaiting.
 * The caller passes `@duckdb/duckdb-wasm/dist/duckdb-browser-blocking.mjs` (aliased in Vite,
 * because the package does not export that path).
 */
export async function createBrowserDb(duckdb: BlockingDuckModule, urls: BrowserBundleUrls): Promise<SyncDb> {
  const bundles = {
    mvp: { mainModule: urls.mvpModule, mainWorker: "" },
    eh: { mainModule: urls.ehModule, mainWorker: "" },
  };
  const bindings = await duckdb.createDuckDB(bundles, new duckdb.VoidLogger(), duckdb.BROWSER_RUNTIME);
  await bindings.instantiate(() => {});
  return new DuckSyncDb(bindings);
}

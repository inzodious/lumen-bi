import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { DuckSyncDb, type BlockingBindings } from "./duck.ts";
import type { SyncDb } from "./types.ts";

const require = createRequire(import.meta.url);

export async function createNodeDb(): Promise<SyncDb> {
  const entry = require.resolve("@duckdb/duckdb-wasm/dist/duckdb-node-blocking.cjs");
  const dist = dirname(entry);
  const duckdb = require(entry);
  const bundles = {
    mvp: { mainModule: join(dist, "duckdb-mvp.wasm"), mainWorker: join(dist, "duckdb-node-mvp.worker.cjs") },
    eh: { mainModule: join(dist, "duckdb-eh.wasm"), mainWorker: join(dist, "duckdb-node-eh.worker.cjs") },
  };
  const bindings = await duckdb.createDuckDB(bundles, new duckdb.VoidLogger(), duckdb.NODE_RUNTIME);
  await bindings.instantiate(() => {});
  return new DuckSyncDb(bindings as BlockingBindings);
}

import { describe, expect, it } from "vitest";
import { MError, evaluateQuery, runWithData, toJs, type DataRequest, type FirestoreDocument, type HostFileEntry, type HostTable } from "../index.ts";
import { evaluate } from "../engine.ts";
import { predicateToFilter, renderPredicate } from "../lib/fold.ts";
import { MYSQL, POSTGRESQL, SQLITE, TSQL } from "../lib/sqldialect.ts";
import { firestoreFilters, firestoreValueToM, mToFirestoreValue, parseS3Url } from "../lib/connectors.ts";
import { MDateTime, MDateTimeZone, MFunction, MRecord } from "../values.ts";

const enc = new TextEncoder();
const dec = new TextDecoder();

type Fetch = (req: DataRequest) => unknown;

async function run(source: string, answer: Fetch, log: DataRequest[] = []) {
  return runWithData(
    (host) => {
      const ev = evaluateQuery(source, { host, previewSteps: false });
      if (!ev.result.ok) throw new MError(ev.result.error.reason, ev.result.error.message);
      return toJs(ev.result.value);
    },
    async (req) => {
      log.push(req);
      return answer(req);
    },
    { now: new Date(Date.UTC(2026, 10, 17, 12)) },
  );
}

// ---------------------------------------------------------------------------------------------

describe("SQL dialects", () => {
  const f = (src: string) => evaluate(src) as MFunction;
  const cols = ["a", "b"];
  const render = (src: string, d = POSTGRESQL) => {
    const r = predicateToFilter(f(src), cols);
    return r ? renderPredicate(r.pred, d) : undefined;
  };

  it("quotes identifiers and literals per dialect", () => {
    expect(render(`each [a] = "it's"`)).toBe(`"a" = 'it''s'`);
    expect(render(`each [a] = "it's \\ x"`, MYSQL)).toBe("`a` = 'it''s \\\\ x'");
    expect(render(`each [a] = true`, POSTGRESQL)).toBe(`"a" = TRUE`);
    expect(render(`each [a] = true`, SQLITE)).toBe(`"a" = 1`);
    expect(render(`each [a] >= #date(2024, 1, 31)`)).toBe(`"a" >= DATE '2024-01-31'`);
    expect(render(`each [a] < #datetime(2024, 1, 31, 10, 5, 0)`)).toBe(`"a" < TIMESTAMP '2024-01-31 10:05:00'`);
    expect(render(`each [a] < #datetimezone(2024, 1, 31, 10, 5, 0, 2, 0)`)).toBe(`"a" < TIMESTAMPTZ '2024-01-31 10:05:00+02:00'`);
    expect(render(`each [a] < #datetime(2024, 1, 31, 10, 5, 0)`, MYSQL)).toBe("`a` < '2024-01-31 10:05:00'");
    expect(render(`each [a] = #time(10, 5, 0)`, TSQL)).toBeUndefined();
  });

  it("escapes LIKE patterns", () => {
    expect(render(`each Text.Contains([a], "50%_\\")`)).toBe(`"a" LIKE '%50\\%\\_\\\\%'`);
    expect(render(`each Text.StartsWith([a], "x")`, SQLITE)).toBe(`"a" LIKE 'x%' ESCAPE '\\'`);
    expect(render(`each Text.EndsWith([a], "o'k")`, MYSQL)).toBe("`a` LIKE '%o''k'");
    expect(render(`each Text.StartsWith([a], "a[b")`, TSQL)).toBe(`[a] LIKE N'a[[]b%'`);
  });

  it("keeps M's null semantics", () => {
    expect(render(`each [a] <> 1`)).toBe(`("a" <> 1 OR "a" IS NULL)`);
    expect(render(`each [a] = null or not ([b] = 2)`)).toBe(`("a" IS NULL OR NOT ("b" = 2))`);
    expect(render(`each List.Contains({1, null}, [a])`)).toBe(`("a" IN (1) OR "a" IS NULL)`);
  });

  it("marks values computed from other steps", () => {
    const fn = evaluate(`let limit = 5 in each [a] > limit`) as MFunction;
    expect(predicateToFilter(fn, cols)?.computed).toBe(true);
    expect(predicateToFilter(f(`each [a] > #date(2024,1,1)`), cols)?.computed).toBe(false);
  });

  it("renders SELECT shapes", () => {
    const spec = { schema: "s", item: "t", columns: ["a"], where: "x", orderBy: [{ column: "a", desc: true }], skip: 10, top: 5 };
    expect(POSTGRESQL.select(spec)).toBe(`SELECT "a" FROM "s"."t" WHERE x ORDER BY "a" DESC NULLS LAST LIMIT 5 OFFSET 10`);
    expect(MYSQL.select(spec)).toBe("SELECT `a` FROM `s`.`t` WHERE x ORDER BY `a` DESC LIMIT 5 OFFSET 10");
    expect(SQLITE.select({ item: "t", skip: 3 })).toBe(`SELECT * FROM "t" LIMIT -1 OFFSET 3`);
    expect(TSQL.select(spec)).toBe("SELECT [a] FROM [s].[t] WHERE x ORDER BY [a] DESC OFFSET 10 ROWS FETCH NEXT 5 ROWS ONLY");
    expect(TSQL.select({ item: "t", top: 2 })).toBe("SELECT TOP (2) * FROM [t]");
  });
});

// ---------------------------------------------------------------------------------------------

describe("PostgreSQL / MySQL / SQLite navigation and folding", () => {
  const orders: HostTable = {
    columns: [
      { name: "id", type: "integer" },
      { name: "region", type: "varchar" },
      { name: "amount", type: "decimal" },
      { name: "meta", type: "json" },
      { name: "tags", type: "list" },
      { name: "at", type: "timestamptz" },
    ],
    rows: [
      [1, "East", 10.5, '{"vip":true}', ["a", "b"], new Date(Date.UTC(2026, 0, 2, 3, 4, 5))],
      [2, "West", 20, null, [], null],
    ],
  };
  const db = (log: DataRequest[]): Fetch => (req) => {
    if (req.kind === "db-items") return [{ schema: "public", item: "orders", kind: "Table" }, { schema: "sales", item: "v", kind: "View" }];
    if (req.kind === "db") {
      if (/LIMIT 0$/.test(req.query)) return { columns: orders.columns, rows: [] };
      return orders;
    }
    throw new Error(`unexpected ${req.kind}`);
    void log;
  };

  it("navigates with Schema/Item and maps types", async () => {
    const log: DataRequest[] = [];
    const v = await run(`let Source = PostgreSQL.Database("pg:5432", "shop"), t = Source{[Schema="public",Item="orders"]}[Data] in t`, db(log), log);
    expect(v).toEqual([
      { id: 1, region: "East", amount: 10.5, meta: '{"vip":true}', tags: ["a", "b"], at: "2026-01-02T03:04:05+00:00" },
      { id: 2, region: "West", amount: 20, meta: null, tags: [], at: null },
    ]);
    expect(log.some((r) => r.kind === "db-items")).toBe(false);
    expect(log.map((r) => (r.kind === "db" ? r.query : r.kind))).toEqual([`SELECT * FROM "public"."orders" LIMIT 0`, `SELECT * FROM "public"."orders"`]);
  });

  it("folds columns, filters, sort, skip and FirstN into one statement", async () => {
    const log: DataRequest[] = [];
    await run(
      `let Source = PostgreSQL.Database("pg", "shop"), t = Source{[Schema="public",Item="orders"]}[Data],
         f = Table.SelectRows(t, each [region] = "East" and [amount] >= 10),
         s = Table.Sort(f, {{"amount", Order.Descending}}),
         k = Table.Skip(s, 2), n = Table.FirstN(k, 10),
         c = Table.SelectColumns(n, {"id", "amount"}) in c`,
      db(log),
      log,
    );
    const q = log.filter((r): r is Extract<DataRequest, { kind: "db" }> => r.kind === "db").map((r) => r.query);
    expect(q[1]).toBe(`SELECT "id", "amount" FROM "public"."orders" WHERE ("region" = 'East' AND "amount" >= 10) ORDER BY "amount" DESC NULLS LAST LIMIT 10 OFFSET 2`);
  });

  it("stops folding at a non-foldable step and evaluates the rest locally", async () => {
    const log: DataRequest[] = [];
    const v = await run(
      `let t = PostgreSQL.Database("pg", "shop"){[Schema="public",Item="orders"]}[Data],
         a = Table.AddColumn(t, "x", each [id] * 2), f = Table.SelectRows(a, each [x] = 4) in Table.SelectColumns(f, {"id"})`,
      db(log),
      log,
    );
    expect(v).toEqual([{ id: 2 }]);
    expect(log.filter((r) => r.kind === "db").map((r) => (r as { query: string }).query)[1]).toBe(`SELECT * FROM "public"."orders"`);
  });

  it("lists items, runs native queries with dialect parameters and parses JSON on request", async () => {
    const log: DataRequest[] = [];
    const nav = (await run(`Table.SelectColumns(MySQL.Database("my", "shop"), {"Name", "Schema", "Item", "Kind"})`, db(log), log)) as unknown[];
    expect(nav).toEqual([
      { Name: "orders", Schema: "public", Item: "orders", Kind: "Table" },
      { Name: "v", Schema: "sales", Item: "v", Kind: "View" },
    ]);
    await run(`Value.NativeQuery(MySQL.Database("my", "shop"), "SELECT * FROM t WHERE r = @r AND d > @d", [r = "O'Neil", d = #date(2024,1,2)])`, db(log), log);
    expect(log.at(-1)).toMatchObject({ kind: "db", driver: "mysql", query: "SELECT * FROM t WHERE r = 'O''Neil' AND d > '2024-01-02'" });
    const v = (await run(`PostgreSQL.Database("pg", "shop", [Query="select 1", JsonAsRecords=true])`, db(log), log)) as Array<{ meta: unknown }>;
    expect(v[0]!.meta).toEqual({ vip: true });
    expect(log.at(-1)).toMatchObject({ kind: "db", driver: "postgresql", query: "select 1" });
  });

  it("uses the SQLite dialect and the default schema", async () => {
    const log: DataRequest[] = [];
    await run(`Table.FirstN(SQLite.Database("/data/app.db"){[Item="orders"]}[Data], 3)`, db(log), log);
    const q = log.filter((r) => r.kind === "db") as Extract<DataRequest, { kind: "db" }>[];
    expect(q.map((r) => r.query)).toEqual([`SELECT * FROM "main"."orders" LIMIT 0`, `SELECT * FROM "main"."orders" LIMIT 3`]);
    expect(q[0]!.table).toEqual({ schema: "main", item: "orders" });
    expect(q[0]!.server).toBe("/data/app.db");
  });
});

// ---------------------------------------------------------------------------------------------

describe("Firestore", () => {
  const doc = (id: string, fields: Record<string, unknown>): FirestoreDocument => ({
    name: `projects/p/databases/(default)/documents/users/${id}`,
    fields: fields as FirestoreDocument["fields"],
    createTime: "2026-01-01T00:00:00Z",
    updateTime: "2026-02-01T10:00:00.500Z",
  });
  const users = [
    doc("a", {
      name: { stringValue: "Ann" },
      age: { integerValue: "41" },
      score: { doubleValue: 1.5 },
      address: { mapValue: { fields: { city: { stringValue: "Oslo" }, geo: { geoPointValue: { latitude: 59.9, longitude: 10.7 } } } } },
      tags: { arrayValue: { values: [{ stringValue: "x" }, { integerValue: "2" }] } },
      boss: { referenceValue: "projects/p/databases/(default)/documents/users/b" },
      seen: { timestampValue: "2026-03-04T05:06:07Z" },
    }),
    doc("b", { name: { stringValue: "Bob" }, age: { integerValue: "35" }, score: { integerValue: "2" }, address: { mapValue: { fields: { city: { stringValue: "Rome" } } } }, active: { booleanValue: true } }),
  ];

  it("converts typed values", () => {
    expect(firestoreValueToM({ integerValue: "12" })).toBe(12);
    expect(firestoreValueToM({ timestampValue: "2026-03-04T05:06:07Z" })).toEqual(new MDateTimeZone(Date.UTC(2026, 2, 4, 5, 6, 7), 0));
    expect(firestoreValueToM({ referenceValue: "projects/p/databases/(default)/documents/a/b" })).toBe("a/b");
    expect(toJs(firestoreValueToM({ geoPointValue: { latitude: 1, longitude: 2 } }))).toEqual({ Latitude: 1, Longitude: 2 });
    expect(mToFirestoreValue(new MDateTime(Date.UTC(2026, 0, 1)))).toEqual({ timestampValue: "2026-01-01T00:00:00Z" });
    expect(mToFirestoreValue(3)).toEqual({ integerValue: "3" });
    expect(mToFirestoreValue(3.5)).toEqual({ doubleValue: 3.5 });
  });

  const fs = (docs: FirestoreDocument[]): Fetch => (req) => {
    if (req.kind === "firestore-collections") return req.parent ? ["orders"] : ["users", "teams"];
    if (req.kind === "firestore-query") return req.limit !== undefined ? docs.slice(0, req.limit) : docs;
    throw new Error(req.kind);
  };

  it("lists collections and flattens documents to typed columns", async () => {
    const log: DataRequest[] = [];
    const nav = (await run(`Table.SelectColumns(Firestore.Collections("p"), {"Name", "Kind", "Path"})`, fs(users), log)) as unknown[];
    expect(nav).toEqual([
      { Name: "users", Kind: "Collection", Path: "users" },
      { Name: "teams", Kind: "Collection", Path: "teams" },
    ]);
    const ev = await runWithData(
      (host) => {
        const r = evaluateQuery(`Firestore.Collections("p"){[Name="users"]}[Data]`, { host, previewSteps: false });
        if (!r.result.ok) throw new Error(r.result.error.message);
        return r.result.value;
      },
      async (req) => fs(users)(req),
    );
    const t = ev as import("../values.ts").MTable;
    expect(t.columns).toEqual(["_id", "_path", "_createTime", "_updateTime", "active", "address.city", "address.geo", "age", "boss", "name", "score", "seen", "tags"]);
    expect(t.types.map((x) => x.toString?.() ?? "")).toBeDefined();
    const rows = toJs(t) as Array<Record<string, unknown>>;
    expect(rows[0]).toMatchObject({ _id: "a", _path: "users/a", name: "Ann", age: 41, "address.city": "Oslo", "address.geo": { Latitude: 59.9, Longitude: 10.7 }, tags: ["x", 2], boss: "users/b", seen: "2026-03-04T05:06:07+00:00" });
    expect(rows[1]).toMatchObject({ _id: "b", score: 2, active: true, tags: null, "address.geo": null });
  });

  it("keeps nested maps as records on request, and expands lists to rows", async () => {
    const v = (await run(`Table.SelectColumns(Firestore.Query("p", "users", [NestedMaps="Record", Metadata=false]), {"_id", "address"})`, fs(users))) as unknown[];
    expect(v).toEqual([
      { _id: "a", address: { city: "Oslo", geo: { Latitude: 59.9, Longitude: 10.7 } } },
      { _id: "b", address: { city: "Rome" } },
    ]);
    const x = (await run(`Table.SelectColumns(Table.ExpandListColumn(Firestore.Query("p", "users"), "tags"), {"_id", "tags"})`, fs(users))) as unknown[];
    expect(x).toEqual([
      { _id: "a", tags: "x" },
      { _id: "a", tags: 2 },
      { _id: "b", tags: null },
    ]);
  });

  it("folds simple filters and FirstN into the structured query", async () => {
    const log: DataRequest[] = [];
    await run(
      `let d = Firestore.Query("p", "users", [Where={{"active", "=", true}}]), f = Table.SelectRows(d, each [age] >= 30 and [address.city] = "Oslo"), n = Table.FirstN(f, 5) in n`,
      fs(users),
      log,
    );
    const reads = log.filter((r): r is Extract<DataRequest, { kind: "firestore-query" }> => r.kind === "firestore-query");
    expect(reads[0]).toMatchObject({ limit: 1000, filters: [{ field: "active", op: "EQUAL", value: { booleanValue: true } }] });
    expect(reads[1]).toMatchObject({
      limit: 5,
      filters: [
        { field: "active", op: "EQUAL", value: { booleanValue: true } },
        { field: "age", op: "GREATER_THAN_OR_EQUAL", value: { integerValue: "30" } },
        { field: "address.city", op: "EQUAL", value: { stringValue: "Oslo" } },
      ],
    });
  });

  it("does not fold filters Firestore can't match exactly", () => {
    const f = (src: string) => predicateToFilter(evaluate(src) as MFunction, ["a", "b"])!.pred;
    const fieldOf = (c: string) => [c];
    expect(firestoreFilters(f(`each [a] <> 1`), fieldOf)).toBeUndefined();
    expect(firestoreFilters(f(`each [a] = null`), fieldOf)).toBeUndefined();
    expect(firestoreFilters(f(`each not ([a] = 1)`), fieldOf)).toBeUndefined();
    expect(firestoreFilters(f(`each [a] = 1 or [b] <> 2`), fieldOf)).toBeUndefined();
    expect(firestoreFilters(f(`each List.Contains({"x","y"}, [a])`), fieldOf)).toEqual([{ field: "a", op: "IN", value: { arrayValue: { values: [{ stringValue: "x" }, { stringValue: "y" }] } } }]);
  });

  it("folds or (composite OR) and <> null (IS_NOT_NULL)", () => {
    const f = (src: string) => predicateToFilter(evaluate(src) as MFunction, ["a", "b"])!.pred;
    const fieldOf = (c: string) => [c];
    const eq = (field: string, n: number) => ({ field, op: "EQUAL", value: { integerValue: String(n) } });
    expect(firestoreFilters(f(`each [a] <> null`), fieldOf)).toEqual([{ field: "a", op: "IS_NOT_NULL" }]);
    expect(firestoreFilters(f(`each [a] = 1 or [b] = 2`), fieldOf)).toEqual([{ op: "OR", filters: [eq("a", 1), eq("b", 2)] }]);
    expect(firestoreFilters(f(`each [a] = 1 or [b] = 2 or [a] = 3`), fieldOf)).toEqual([{ op: "OR", filters: [eq("a", 1), eq("b", 2), eq("a", 3)] }]);
    expect(firestoreFilters(f(`each ([a] = 1 and [b] = 2) or [a] = 3`), fieldOf)).toEqual([{ op: "OR", filters: [{ op: "AND", filters: [eq("a", 1), eq("b", 2)] }, eq("a", 3)] }]);
  });

  it("folds or / <> null / sort end to end and keeps M's results", async () => {
    const people = [
      doc("a", { age: { integerValue: "40" }, name: { stringValue: "Bo" }, ref: { referenceValue: "projects/p/databases/(default)/documents/x/1" } }),
      doc("b", { age: { integerValue: "25" }, name: { stringValue: "Al" } }),
      doc("c", { age: { nullValue: null }, name: { stringValue: "Cy" } }),
      doc("d", { name: { stringValue: "Di" } }),
      doc("e", { age: { doubleValue: 31.5 }, name: { stringValue: "Ed" } }),
    ];
    // a tiny Firestore: filters / orderBy / limit as the REST API applies them (orderBy drops documents without the field)
    const valueOf = (d: FirestoreDocument, field: string) => d.fields?.[field];
    const num = (v: Record<string, unknown> | undefined) => (v && "integerValue" in v ? Number(v["integerValue"]) : v && "doubleValue" in v ? (v["doubleValue"] as number) : undefined);
    const cmp = (x: Record<string, unknown> | undefined, y: Record<string, unknown> | undefined) => {
      const a = num(x) ?? (x?.["stringValue"] as string);
      const b = num(y) ?? (y?.["stringValue"] as string);
      return a < b ? -1 : a > b ? 1 : 0;
    };
    const test = (d: FirestoreDocument, f: any): boolean => {
      if (f.op === "AND") return f.filters.every((g: any) => test(d, g));
      if (f.op === "OR") return f.filters.some((g: any) => test(d, g));
      const v = valueOf(d, f.field);
      if (f.op === "IS_NOT_NULL") return !!v && !("nullValue" in v);
      if (!v || "nullValue" in v) return false;
      const c = cmp(v, f.value);
      return f.op === "EQUAL" ? c === 0 : f.op === "GREATER_THAN" ? c > 0 : f.op === "LESS_THAN" ? c < 0 : f.op === "GREATER_THAN_OR_EQUAL" ? c >= 0 : c <= 0;
    };
    const fake: Fetch = (req) => {
      if (req.kind !== "firestore-query") return [];
      let out = people.filter((d) => (req.filters ?? []).every((g) => test(d, g)));
      for (const o of req.orderBy ?? []) out = out.filter((d) => valueOf(d, o.field) !== undefined);
      const keys = req.orderBy ?? [];
      out = [...out].sort((x, y) => {
        for (const o of keys) {
          const c = cmp(valueOf(x, o.field), valueOf(y, o.field));
          if (c) return o.desc ? -c : c;
        }
        return 0;
      });
      return req.limit !== undefined ? out.slice(0, req.limit) : out;
    };
    const big = (n: number) => [...people, ...Array.from({ length: n }, (_x, i) => doc(`z${i}`, { name: { stringValue: "Zz" } }))];
    const q = `Firestore.Query("p", "people", [Metadata=false])`;
    const cases: [string, string[], boolean][] = [
      [`Table.SelectRows(${q}, each [age] = 25 or [name] = "Di")`, ["b", "d"], false],
      [`Table.SelectRows(${q}, each [age] <> null)`, ["a", "b", "e"], false],
      [`Table.Sort(Table.SelectRows(${q}, each [age] <> null), {{"age", Order.Descending}})`, ["a", "e", "b"], true],
      [`Table.FirstN(Table.Sort(Table.SelectRows(${q}, each [age] > 20), "age"), 2)`, ["b", "e"], true],
      // not folded: sorting a field some documents lack (M puts nulls first), or of a type Firestore orders differently
      [`Table.Sort(${q}, "age")`, ["c", "d", "b", "e", "a"], false],
      [`Table.Sort(Table.SelectRows(${q}, each [ref] <> null), "ref")`, ["a"], false],
    ];
    for (const [src, ids, sorted] of cases) {
      const log: DataRequest[] = [];
      const v = (await run(`Table.SelectColumns(${src}, {"_id"})`, fake, log)) as { _id: string }[];
      expect(v.map((r) => r._id), src).toEqual(ids);
      expect(log.some((r) => r.kind === "firestore-query" && !!r.orderBy?.length), src).toBe(sorted);
    }
    const log: DataRequest[] = [];
    // more documents than the sample so the reads really go to the source
    const fakeBig: Fetch = (req) => {
      const save = people.splice(0, people.length, ...big(1000));
      try {
        return fake(req);
      } finally {
        people.splice(0, people.length, ...save);
      }
    };
    await run(`Table.FirstN(Table.Sort(Table.SelectRows(${q}, each [age] <> null or [age] = 1), {{"name", Order.Descending}}), 1)`, fakeBig, log);
    await run(`Table.FirstN(Table.Sort(Table.SelectRows(${q}, each [age] <> null), {{"age", Order.Descending}}), 1)`, fakeBig, log);
    const reads = log.filter((r): r is Extract<DataRequest, { kind: "firestore-query" }> => r.kind === "firestore-query" && r.limit === 1);
    expect(reads).toEqual([expect.objectContaining({ filters: [{ field: "age", op: "IS_NOT_NULL" }], orderBy: [{ field: "age", desc: true }] })]);
  });

  it("queries collection groups and subcollections, and collects fields beyond the sample", async () => {
    const log: DataRequest[] = [];
    const many = Array.from({ length: 1000 }, (_x, i) => doc(String(i), { n: { integerValue: String(i) } }));
    many.push(doc("late", { n: { integerValue: "1000" }, extra: { stringValue: "!" } }));
    const v = (await run(`Table.Last(Firestore.Query("p", "orders", [AllDescendants=true, Parent="users/a", Metadata=false]))`, fs(many), log)) as Record<string, unknown>;
    expect(v).toEqual({ _id: "late", _path: "users/late", n: 1000, _otherFields: { extra: "!" } });
    expect(log[0]).toMatchObject({ kind: "firestore-query", collection: "orders", allDescendants: true, parent: "users/a" });
    const sub = (await run(`Table.SelectColumns(Firestore.Collections("p", [Parent="users/a"]), {"Name", "Path"})`, fs(users))) as unknown[];
    expect(sub).toEqual([{ Name: "orders", Path: "users/a/orders" }]);
  });

  it("validates Where options", async () => {
    await expect(run(`Firestore.Query("p", "users", [Where={{"a", "like", 1}}])`, fs(users))).rejects.toThrow(/operator 'like'/);
  });
});

// ---------------------------------------------------------------------------------------------

/** Parquet stand-in: a "parquet" file is the JSON of a HostTable (the decode request returns it). */
function pq(t: HostTable): Uint8Array {
  return enc.encode(JSON.stringify(t));
}

function storage(files: Record<string, Uint8Array | string>) {
  const entries = (prefix: string, recursive: boolean): HostFileEntry[] => {
    const p = prefix.endsWith("/") ? prefix : `${prefix}/`;
    const out = new Map<string, HostFileEntry>();
    for (const path of Object.keys(files).sort()) {
      if (!path.startsWith(p)) continue;
      const rest = path.slice(p.length);
      if (recursive || !rest.includes("/")) out.set(path, { name: rest.split("/").pop()!, path, isFolder: false, size: 1, modified: Date.UTC(2026, 0, 1) });
      else {
        const dir = `${p}${rest.split("/")[0]}`;
        out.set(dir, { name: rest.split("/")[0]!, path: dir, isFolder: true });
      }
    }
    if (!out.size && !Object.keys(files).some((f) => f.startsWith(p))) throw new MError("DataSource.NotFound", `not found ${prefix}`);
    return [...out.values()];
  };
  const bytes = (path: string) => {
    const f = files[path];
    if (f === undefined) throw new MError("DataSource.NotFound", `File or Folder: We couldn't find the file '${path}'.`);
    return typeof f === "string" ? enc.encode(f) : f;
  };
  const fetch: Fetch = (req) => {
    switch (req.kind) {
      case "folder":
        return entries(req.path, req.recursive);
      case "file":
        return bytes(req.path);
      case "s3-list":
        return entries(`s3://${req.bucket}/${req.prefix}`.replace(/\/$/, ""), req.recursive);
      case "s3-object":
        return bytes(`s3://${req.bucket}/${req.key}`);
      case "decode":
        return JSON.parse(dec.decode(req.bytes)) as HostTable;
      default:
        throw new Error(req.kind);
    }
  };
  return fetch;
}

const commit = (...actions: unknown[]) => actions.map((a) => JSON.stringify(a)).join("\n");
const schema = (fields: Array<[string, string, Record<string, unknown>?]>) => JSON.stringify({ type: "struct", fields: fields.map(([name, type, metadata]) => ({ name, type, nullable: true, metadata: metadata ?? {} })) });

describe("object storage, Delta and lakehouse folders", () => {
  it("parses s3 URLs", () => {
    expect(parseS3Url("s3://bucket/a/b")).toEqual({ bucket: "bucket", key: "a/b" });
    expect(parseS3Url("s3://bucket")).toEqual({ bucket: "bucket", key: "" });
    expect(parseS3Url("/local")).toBeNull();
  });

  it("lists a bucket like Folder.Files and combines CSV contents", async () => {
    const log: DataRequest[] = [];
    const fetch = storage({ "s3://bk/in/a.csv": "x\n1\n", "s3://bk/in/sub/b.csv": "x\n2\n", "s3://bk/other.txt": "no" });
    const v = await run(
      `let s = AmazonS3.Contents("bk", [Endpoint="http://nas:9000/", Prefix="in/"]),
           t = Table.AddColumn(s, "T", each Table.PromoteHeaders(Csv.Document([Content]))),
           x = Table.ExpandTableColumn(Table.SelectColumns(t, {"Name", "Folder Path", "T"}), "T", {"x"}) in x`,
      fetch,
      log,
    );
    expect(v).toEqual([
      { Name: "a.csv", "Folder Path": "s3://bk/in/", x: "1" },
      { Name: "b.csv", "Folder Path": "s3://bk/in/sub/", x: "2" },
    ]);
    expect(log[0]).toEqual({ kind: "s3-list", bucket: "bk", prefix: "in/", recursive: true, endpoint: "http://nas:9000", forcePathStyle: true });
    expect(log.find((r) => r.kind === "s3-object")).toMatchObject({ key: "in/a.csv", endpoint: "http://nas:9000" });
  });

  const salesTable = (root: string, extra: Record<string, Uint8Array | string> = {}) => ({
    [`${root}/_delta_log/00000000000000000000.json`]: commit(
      { protocol: { minReaderVersion: 1, minWriterVersion: 2 } },
      { metaData: { schemaString: schema([["id", "long"], ["amount", "double"], ["day", "date"]]), partitionColumns: ["day"], configuration: {} } },
      { add: { path: "day=2026-01-01/p0.parquet", partitionValues: { day: "2026-01-01" } } },
      { add: { path: "day=2026-01-02/p1.parquet", partitionValues: { day: "2026-01-02" } } },
    ),
    [`${root}/_delta_log/00000000000000000001.json`]: commit({ remove: { path: "day=2026-01-01/p0.parquet" } }, { add: { path: "day=2026-01-01/p2.parquet", partitionValues: { day: "2026-01-01" } } }),
    [`${root}/day=2026-01-01/p0.parquet`]: pq({ columns: [{ name: "id", type: "bigint" }, { name: "amount", type: "double" }], rows: [[1, 999]] }),
    [`${root}/day=2026-01-01/p2.parquet`]: pq({ columns: [{ name: "id", type: "bigint" }, { name: "amount", type: "double" }], rows: [[1, 10]] }),
    [`${root}/day=2026-01-02/p1.parquet`]: pq({ columns: [{ name: "id", type: "bigint" }, { name: "amount", type: "double" }], rows: [[2, 20], [3, 30]] }),
    ...extra,
  });

  it("reads a Delta table from a bucket path with typed partitions", async () => {
    const v = await run(`DeltaLake.Table("s3://lake/Tables/sales", [Endpoint="http://minio:9000"])`, storage(salesTable("s3://lake/Tables/sales")));
    expect(v).toEqual([
      { id: 1, amount: 10, day: "2026-01-01" },
      { id: 2, amount: 20, day: "2026-01-02" },
      { id: 3, amount: 30, day: "2026-01-02" },
    ]);
  });

  it("reads all data files in two passes (batched misses)", async () => {
    let passes = 0;
    const fetch = storage(salesTable("/lake/Tables/sales"));
    await runWithData(
      (host) => {
        passes++;
        const ev = evaluateQuery(`DeltaLake.Table("/lake/Tables/sales")`, { host, previewSteps: false });
        if (!ev.result.ok) throw new Error(ev.result.error.message);
        return toJs(ev.result.value);
      },
      async (req) => fetch(req),
    );
    // listing, commits, data files, decodes, done
    expect(passes).toBe(5);
  });

  it("applies checkpoints and column mapping, and refuses deletion vectors", async () => {
    const root = "/lake/Tables/mapped";
    const files = {
      [`${root}/_delta_log/_last_checkpoint`]: '{"version":1,"size":3}',
      [`${root}/_delta_log/00000000000000000001.checkpoint.parquet`]: pq({
        columns: [
          { name: "add", type: "any" },
          { name: "remove", type: "any" },
          { name: "metaData", type: "any" },
        ],
        rows: [
          [null, null, { schemaString: schema([["Customer Name", "string", { "delta.columnMapping.physicalName": "col-1" }]]), partitionColumns: [], configuration: [{ key: "delta.columnMapping.mode", value: "name" }] }],
          [{ path: "a.parquet", partitionValues: [] }, null, null],
        ],
      }),
      // commit 0 was cleaned up; commit 2 comes after the checkpoint
      [`${root}/_delta_log/00000000000000000001.json`]: commit({ add: { path: "ignored.parquet" } }),
      [`${root}/_delta_log/00000000000000000002.json`]: commit({ add: { path: "b.parquet" } }),
      [`${root}/a.parquet`]: pq({ columns: [{ name: "col-1", type: "varchar" }], rows: [["Ann"]] }),
      [`${root}/b.parquet`]: pq({ columns: [{ name: "col-1", type: "varchar" }], rows: [["Bob"]] }),
    };
    expect(await run(`DeltaLake.Table("${root}")`, storage(files))).toEqual([{ "Customer Name": "Ann" }, { "Customer Name": "Bob" }]);
    const dv = { ...files, [`${root}/_delta_log/00000000000000000003.json`]: commit({ add: { path: "c.parquet", deletionVector: { storageType: "u", pathOrInlineDv: "x" } } }) };
    await expect(run(`DeltaLake.Table("${root}")`, storage(dv))).rejects.toThrow(/deletion vectors/);
    const gap: Record<string, Uint8Array | string> = { ...files };
    delete gap[`${root}/_delta_log/_last_checkpoint`];
    delete gap[`${root}/_delta_log/00000000000000000001.checkpoint.parquet`];
    await expect(run(`DeltaLake.Table("${root}")`, storage(gap))).rejects.toThrow(/first commit/);
  });

  it("navigates a lakehouse folder (tables, schemas, Files) on disk and in a bucket", async () => {
    for (const root of ["/data/Starlite.Lakehouse", "s3://lake/Starlite.Lakehouse"]) {
      const files = {
        ...salesTable(`${root}/Tables/gold_sales`),
        ...salesTable(`${root}/Tables/dbo/fact`),
        [`${root}/Files/bronze/a.csv`]: "x\n1\n",
        [`${root}/Files/readme.txt`]: "hi",
      };
      const fetch = storage(files);
      const nav = await run(`Table.SelectColumns(Lakehouse.Folder("${root}"), {"Id", "ItemKind", "IsLeaf"})`, fetch);
      expect(nav).toEqual([
        { Id: "gold_sales", ItemKind: "Table", IsLeaf: true },
        { Id: "dbo", ItemKind: "Schema", IsLeaf: false },
        { Id: "Files", ItemKind: "Folder", IsLeaf: false },
      ]);
      expect(await run(`Table.RowCount(Lakehouse.Folder("${root}"){[Id="gold_sales",ItemKind="Table"]}[Data])`, fetch)).toBe(3);
      expect(await run(`Table.RowCount(Lakehouse.Folder("${root}"){[Id="dbo"]}[Data]{[Id="fact"]}[Data])`, fetch)).toBe(3);
      const filesNav = await run(`Table.SelectColumns(Lakehouse.Folder("${root}"){[Id="Files"]}[Data], {"Name", "Extension"})`, fetch);
      expect(filesNav).toEqual([
        { Name: "bronze", Extension: "" },
        { Name: "readme.txt", Extension: ".txt" },
      ]);
      expect(await run(`Text.FromBinary(Lakehouse.Folder("${root}"){[Id="Files"]}[Data]{[Name="bronze"]}[Content]{0}[Content])`, fetch)).toBe("x\n1\n");
    }
  });

  it("an empty lakehouse folder lists only Files", async () => {
    const v = await run(`Table.Column(Lakehouse.Folder("/empty"), "Id")`, storage({ "/empty/Files/x.txt": "1" }));
    expect(v).toEqual(["Files"]);
  });
});

describe("records", () => {
  it("MRecord helper sanity", () => {
    expect(toJs(MRecord.from([["a", 1]]))).toEqual({ a: 1 });
  });
});

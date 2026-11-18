import { describe, expect, it } from "vitest";
import { deflateSync, gzipSync } from "fflate";
import { DataCache, MError, MTable, NeedData, evaluateQuery, requestKey, runWithData, toJs, type DataRequest, type MHost } from "../index.ts";
import { predicateToSql } from "../lib/fold.ts";
import { evaluate } from "../engine.ts";
import { MFunction } from "../values.ts";

const enc = new TextEncoder();

/** An async fetcher over an in-memory "world" that records every request. */
function world(files: Record<string, string | Uint8Array>, sql: Record<string, { columns: { name: string; type: string }[]; rows: unknown[][] }> = {}) {
  const log: DataRequest[] = [];
  const fetch = async (req: DataRequest): Promise<unknown> => {
    log.push(req);
    await new Promise((r) => setTimeout(r, 1));
    switch (req.kind) {
      case "file": {
        const f = files[req.path];
        if (f === undefined) throw new MError("DataSource.NotFound", `File or Folder: We couldn't find the file '${req.path}'.`);
        return typeof f === "string" ? enc.encode(f) : f;
      }
      case "folder":
        return Object.keys(files)
          .filter((p) => p.startsWith(req.path.replace(/\/?$/, "/")))
          .sort()
          .map((p) => ({ name: p.split("/").pop()!, path: p, isFolder: false, size: 1, modified: Date.UTC(2026, 0, 1) }));
      case "sql-items":
        return Object.keys(sql).map((k) => ({ schema: k.split(".")[0], item: k.split(".")[1], kind: "Table" }));
      case "sql": {
        if (req.query) return { columns: [{ name: "n", type: "integer" }], rows: [[42]] };
        const t = sql[`${req.schema}.${req.item}`];
        if (!t) throw new MError("DataSource.Error", `Microsoft SQL: Invalid object name '${req.schema}.${req.item}'.`);
        if (req.top === 0) return { columns: t.columns, rows: [] };
        let rows = t.rows;
        if (req.where === "[region] = N'East'") rows = rows.filter((r) => r[1] === "East");
        const idx = req.columns ? req.columns.map((c) => t.columns.findIndex((x) => x.name === c)) : t.columns.map((_c, i) => i);
        return { columns: idx.map((i) => t.columns[i]), rows: rows.map((r) => idx.map((i) => r[i])) };
      }
      default:
        throw new MError("DataSource.Error", `unsupported ${req.kind}`);
    }
  };
  return { fetch, log };
}

async function run(source: string, w: ReturnType<typeof world>, opts: { cache?: DataCache } = {}) {
  let passes = 0;
  const value = await runWithData(
    (host) => {
      passes++;
      const ev = evaluateQuery(source, { host, previewSteps: false });
      if (!ev.result.ok) throw new MError(ev.result.error.reason, ev.result.error.message);
      return toJs(ev.result.value);
    },
    w.fetch,
    { cache: opts.cache, now: new Date(Date.UTC(2026, 10, 17, 12)) },
  );
  return { value, passes };
}

describe("fetch-and-replay driver", () => {
  it("fetches what evaluation asks for and replays until done", async () => {
    const w = world({ "/data/a.csv": "id,name\n1,Ann\n2,Bob\n" });
    const r = await run(`let s = Csv.Document(File.Contents("/data/a.csv"), [Delimiter=","]), p = Table.PromoteHeaders(s) in p`, w);
    expect(r.value).toEqual([
      { id: "1", name: "Ann" },
      { id: "2", name: "Bob" },
    ]);
    expect(r.passes).toBe(2);
    expect(w.log.map((x) => x.kind)).toEqual(["file"]);
  });

  it("batches misses of one pass (combine files) and reuses the cache", async () => {
    const w = world({ "/in/1.csv": "a\n1\n", "/in/2.csv": "a\n2\n", "/in/3.csv": "a\n3\n" });
    const src = `let
      Source = Folder.Files("/in"),
      Added = Table.AddColumn(Source, "T", each Table.PromoteHeaders(Csv.Document([Content]))),
      Expanded = Table.ExpandTableColumn(Table.SelectColumns(Added, {"Name", "T"}), "T", {"a"})
    in Expanded`;
    const cache = new DataCache();
    const r = await run(src, w, { cache });
    expect(r.value).toEqual([
      { Name: "1.csv", a: "1" },
      { Name: "2.csv", a: "2" },
      { Name: "3.csv", a: "3" },
    ]);
    // pass 1: folder listing; pass 2: all three files at once; pass 3: done
    expect(r.passes).toBe(3);
    const again = await run(src, w, { cache });
    expect(again.passes).toBe(1);
  });

  it("turns a failed fetch into a DataSource error of the query", async () => {
    const w = world({});
    await expect(run(`Csv.Document(File.Contents("/nope.csv"))`, w)).rejects.toThrow(/couldn't find the file '\/nope.csv'/);
    const tried = await run(`try Csv.Document(File.Contents("/nope.csv")) otherwise "fallback"`, w);
    expect(tried.value).toBe("fallback");
  });

  it("is deterministic about the clock across passes", async () => {
    const w = world({ "/x.txt": "x" });
    const r = await run(`[t = DateTime.LocalNow(), b = Text.FromBinary(File.Contents("/x.txt"))]`, w);
    expect(r.value).toEqual({ t: "2026-11-17T12:00:00", b: "x" });
  });

  it("stops after maxPasses", async () => {
    let n = 0;
    await expect(
      runWithData(
        (host: MHost) => host.request({ kind: "file", path: `/f${n++}` }),
        async () => new Uint8Array(),
        { maxPasses: 3 },
      ),
    ).rejects.toThrow(/more than 3 rounds/);
  });

  it("keys requests stably", () => {
    expect(requestKey({ kind: "sql", server: "S", database: "d", schema: "dbo", item: "t" })).toBe(requestKey({ kind: "sql", item: "t", schema: "dbo", database: "d", server: "s" }));
    expect(new NeedData({ kind: "file", path: "/a" }).message).toContain("/a");
  });
});

describe("SQL navigation, native queries and folding", () => {
  const sales = {
    columns: [
      { name: "id", type: "integer" },
      { name: "region", type: "varchar" },
      { name: "amount", type: "decimal" },
      { name: "at", type: "date" },
    ],
    rows: [
      [1, "East", 10.5, new Date(Date.UTC(2026, 0, 2))],
      [2, "West", 20, new Date(Date.UTC(2026, 0, 3))],
      [3, "East", 5, null],
    ],
  };

  it("navigates Source{[Schema,Item]}[Data] without listing items, with typed columns", async () => {
    const w = world({}, { "dbo.sales": sales });
    const r = await run(`let Source = Sql.Database("srv", "db"), t = Source{[Schema="dbo",Item="sales"]}[Data] in t`, w);
    expect(r.value).toEqual([
      { id: 1, region: "East", amount: 10.5, at: "2026-01-02" },
      { id: 2, region: "West", amount: 20, at: "2026-01-03" },
      { id: 3, region: "East", amount: 5, at: null },
    ]);
    expect(w.log.some((x) => x.kind === "sql-items")).toBe(false);
  });

  it("folds SelectColumns and SelectRows into the SELECT", async () => {
    const w = world({}, { "dbo.sales": sales });
    const r = await run(
      `let Source = Sql.Database("srv", "db"), t = Source{[Schema="dbo",Item="sales"]}[Data],
         f = Table.SelectRows(t, each [region] = "East"), c = Table.SelectColumns(f, {"id", "amount"}) in c`,
      w,
    );
    expect(r.value).toEqual([
      { id: 1, amount: 10.5 },
      { id: 3, amount: 5 },
    ]);
    const reads = w.log.filter((x): x is Extract<DataRequest, { kind: "sql" }> => x.kind === "sql" && x.top !== 0);
    expect(reads).toEqual([{ kind: "sql", server: "srv", database: "db", schema: "dbo", item: "sales", columns: ["id", "amount"], where: "[region] = N'East'" }]);
  });

  it("runs native queries (Query option and Value.NativeQuery)", async () => {
    const w = world({}, { "dbo.sales": sales });
    expect((await run(`Sql.Database("srv", "db", [Query="SELECT 42 AS n"])`, w)).value).toEqual([{ n: 42 }]);
    expect((await run(`Value.NativeQuery(Sql.Database("srv", "db"), "SELECT 42 AS n", null, [EnableFolding=true])`, w)).value).toEqual([{ n: 42 }]);
  });

  it("translates simple predicates to SQL and refuses the rest", () => {
    const f = (src: string) => evaluate(src) as MFunction;
    const cols = ["a", "b", "c"];
    expect(predicateToSql(f(`each [a] <> "x" and ([b] > 3 or [c] = null)`), cols)).toBe("((a_ne) AND ([b] > 3 OR [c] IS NULL))".replace("(a_ne)", "([a] <> N'x' OR [a] IS NULL)"));
    expect(predicateToSql(f(`each List.Contains({"p", "q"}, [a])`), cols)).toBe("[a] IN (N'p', N'q')");
    expect(predicateToSql(f(`each Text.StartsWith([a], "ab%")`), cols)).toBe("[a] LIKE N'ab[%]%'");
    expect(predicateToSql(f(`each [a] >= #date(2024, 1, 31)`), cols)).toBe("[a] >= '2024-01-31'");
    expect(predicateToSql(f(`each Text.Length([a]) > 3`), cols)).toBeUndefined();
    expect(predicateToSql(f(`each [zzz] = 1`), cols)).toBeUndefined();
  });
});

describe("binary, text and structured sources", () => {
  it("decodes Enter data tables (Base64 + Deflate + JSON)", () => {
    const rows = [["Won", "1"], ["Lost", "2"]];
    const b64 = Buffer.from(deflateSync(enc.encode(JSON.stringify(rows)))).toString("base64");
    const v = evaluate(
      `let Source = Table.FromRows(Json.Document(Binary.Decompress(Binary.FromText("${b64}", BinaryEncoding.Base64), Compression.Deflate)), let _t = ((type nullable text) meta [Serialized.Text = true]) in type table [Status = _t, Rank = _t]),
        Typed = Table.TransformColumnTypes(Source, {{"Rank", Int64.Type}}) in Typed`,
    ) as MTable;
    expect(v.columns).toEqual(["Status", "Rank"]);
    expect(toJs(v)).toEqual([
      { Status: "Won", Rank: 1 },
      { Status: "Lost", Rank: 2 },
    ]);
  });

  it("round-trips Binary.ToText / FromText (Base64, Hex) and GZip", () => {
    const gz = Buffer.from(gzipSync(enc.encode("hello"))).toString("base64");
    expect(evaluate(`Text.FromBinary(Binary.Decompress(Binary.FromText("${gz}"), Compression.GZip))`)).toBe("hello");
    expect(evaluate(`Binary.ToText(Text.ToBinary("hi"), BinaryEncoding.Hex)`)).toBe("6869");
    expect(evaluate(`Text.FromBinary(Binary.FromText("6869", BinaryEncoding.Hex))`)).toBe("hi");
    expect(evaluate(`Binary.Length(Binary.Compress(Text.ToBinary("aaaa"), Compression.Deflate)) > 0`)).toBe(true);
  });

  it("reads lines, JSON and XML", () => {
    expect(toJs(evaluate(`Lines.FromText("a#(cr,lf)b#(lf)c")`))).toEqual(["a", "b", "c"]);
    expect(toJs(evaluate(`Json.Document("{""a"": [1, {""b"": null}]}")`))).toEqual({ a: [1, { b: null }] });
    expect(evaluate(`Text.FromBinary(Json.FromValue([a = 1, b = {true, "x"}]))`)).toBe('{"a":1,"b":[true,"x"]}');
    const xml = `"<root><row id=""1""><name>Ann</name></row><row id=""2""><name>Bob &amp; co</name></row></root>"`;
    expect(toJs(evaluate(`Xml.Tables(${xml}){0}[Table]`))).toEqual([
      { name: "Ann", "Attribute:id": "1" },
      { name: "Bob & co", "Attribute:id": "2" },
    ]);
    const doc = evaluate(`Xml.Document(${xml})`) as MTable;
    expect(doc.columns).toEqual(["Name", "Namespace", "Value", "Attributes"]);
    expect(toJs(evaluate(`Xml.Document(${xml}){0}[Value]{0}[Value]{0}[Value]`))).toBe("Ann");
  });

  it("reports unsupported service sources with guidance", () => {
    expect(() => evaluate(`PowerBI.Dataflows(null)`)).toThrow(/can't be read offline/);
    expect(() => evaluate(`Web.Page("<html/>")`)).toThrow(/Web.Page isn't available/);
  });
});

describe("web sources", () => {
  const pages: Record<string, unknown> = {
    "https://api.test/v1/items?page=1&q=a%20b": { items: [1, 2] },
    "https://svc.test/odata": { "@odata.context": "https://svc.test/odata/$metadata", value: [{ name: "People", url: "People" }] },
    "https://svc.test/odata/People": { value: [{ "@odata.etag": "x", Id: 1, Name: "Ann" }], "@odata.nextLink": "https://svc.test/odata/People?$skip=1" },
    "https://svc.test/odata/People?$skip=1": { value: [{ Id: 2, Name: "Bob", Extra: true }] },
  };
  const fetch = async (req: DataRequest) => {
    if (req.kind !== "http") throw new Error("unexpected");
    const body = pages[req.url];
    if (!body) return { status: 404, headers: {}, body: new Uint8Array() };
    return { status: 200, headers: { "content-type": "application/json" }, body: enc.encode(JSON.stringify(body)) };
  };
  const evalWeb = (src: string) =>
    runWithData(
      (host) => {
        const ev = evaluateQuery(src, { host, previewSteps: false });
        if (!ev.result.ok) throw new MError(ev.result.error.reason, ev.result.error.message);
        return toJs(ev.result.value);
      },
      fetch,
    );

  it("Web.Contents builds RelativePath / Query and fails on HTTP errors", async () => {
    expect(await evalWeb(`Json.Document(Web.Contents("https://api.test", [RelativePath="v1/items", Query=[page="1", q="a b"]]))`)).toEqual({ items: [1, 2] });
    await expect(evalWeb(`Web.Contents("https://api.test/missing")`)).rejects.toThrow(/\(404\)/);
    expect(await evalWeb(`Value.Metadata(Web.Contents("https://api.test/missing", [ManualStatusHandling={404}]))[Response.Status]`)).toBe(404);
  });

  it("OData.Feed navigates the service document and follows nextLink", async () => {
    expect(await evalWeb(`OData.Feed("https://svc.test/odata"){[Name="People"]}[Data]`)).toEqual([
      { Id: 1, Name: "Ann", Extra: null },
      { Id: 2, Name: "Bob", Extra: true },
    ]);
  });
});

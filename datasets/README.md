# Lumen datasets — fictional lakehouses for BI portfolios

Seven made-up companies, each shipped as a **complete Microsoft Fabric–style lakehouse**: messy bronze landing
files, cleaned silver tables, a gold star schema in **Delta Lake**, a ready-to-open **Power BI / Lumen semantic
model (TMDL)** with 38–40 measures, and a starter **PBIR report**. Pair them with your own report templates for
portfolio work, use them to practise Power Query cleaning, or point DuckDB/Spark at them.

Everything is generated deterministically from a seed (same seed ⇒ byte-identical files), and every company,
person, place, product and number is **fiction**.

## Gallery

| Universe | Company | The pitch | Analytic shapes | Gold facts | Measures |
|---|---|---|---|---|---:|
| [`starlite`](docs/starlite.md) | **Starlite Coffee Co.** | Coffee at the speed of light: a cosmic diner & café chain where the weather, the menu and the night sky all move the numbers. | Retail POS · inventory & waste · purchasing · labor (SCD2) · loyalty · weather-driven demand | sales lines (transaction), store-day (periodic), inventory month (periodic), PO lines (accumulating) | 40 |
| [`gravelstar`](docs/gravelstar.md) | **Gravelstar Mining Consortium** | Asteroid mining: drill rigs, refineries and freighters working three rings of very grumpy rocks. | IoT telemetry & predictive maintenance · geology & grades · logistics · commodity prices · safety | extraction runs (transaction), equipment-day (periodic), cargo hauls (accumulating), safety incidents (event) | 39 |
| [`sunjar`](docs/sunjar.md) | **Sunjar Fusion Labs** | "We put a small sun in a very strong jar": five machines, thousands of shots, one breakeven day. | R&D experiments · diagnostics · budget vs actual · funding & investors · procurement · staff & publications | shots (transaction), device-day (periodic), finance month (periodic), component orders (accumulating) | 39 |
| [`moonwake`](docs/moonwake.md) | **Moonwake Star Cruises** | Boutique starliners from Vashti Moon to the Far Reach, where every berth has a price that changes by the hour. | Revenue management · booking curves · marketing funnel & attribution · onboard spend | bookings (accumulating), sailing inventory (periodic), onboard charges (transaction), quotes (factless) | 38 |
| [`leafloft`](docs/leafloft.md) | **Leafloft Vertical Farms** | Salad grown sixteen tiers high, delivered by bicycle, and billed like a SaaS company. | Subscription / MRR & cohorts · IoT environment telemetry · grow batches · energy | deliveries (transaction), subscription month (periodic), room-env day (periodic), grow batches (accumulating) | 40 |
| [`pixelpagoda`](docs/pixelpagoda.md) | **Pixel Pagoda Arcades** | Insert coin to continue: retro arcades, bar-cades and esports nights where every joystick waggle is logged. | High-volume events · asset uptime & maintenance · memberships & wallet · tournaments (factless) | plays, wallet txns (transaction), machine-day (periodic), maintenance tickets (accumulating), tournament entries (factless) | 40 |
| [`griffingecko`](docs/griffingecko.md) | **Griffin & Gecko Creature Care** | Veterinary care for creatures great, small and occasionally on fire: eight clinics, one very nervous accountant. | Healthcare ops · GL & budget vs actual · payroll (SCD2) · receivables & insurance · outbreaks | appointments (accumulating), treatment lines (transaction), clinic-day (periodic), GL month (periodic) | 38 |

Each universe also has 9–14 dimensions (conformed `Date` with fiscal calendar, holidays and "today" offsets;
SCD Type 2 history; junk and role-playing dimensions), one many-to-many **bridge**, 12–21 silver tables,
10–14 bronze sources with **16–19 documented data-quality issues**, a time-intelligence **calculation group**, a
**field parameter**, a measure with a **dynamic format string**, and 12–14 suggested analyses with findings
planted in the data. Click a universe for its story, ER diagram, table catalog, issue list and measure list.

### Sizes at the default `small` scale (seed 42, today 2026-11-30)

| Universe | Gold rows (facts) | Generate | On disk (delta + csv) |
|---|---:|---:|---:|
| starlite | 116,832 (111,702) | 2.1 s | 52 MB |
| gravelstar | 103,179 (99,306) | 2.7 s | 96 MB |
| sunjar | 96,102 (93,629) | 2.9 s | 125 MB |
| moonwake | 139,055 (119,409) | 2.3 s | 80 MB |
| leafloft | 114,401 (107,892) | 2.0 s | 65 MB |
| pixelpagoda | 129,875 (127,945) | 1.5 s | 47 MB |
| griffingecko | 145,751 (110,009) | 2.1 s | 62 MB |

Most of the disk is bronze: thousands of small daily files, as a real landing zone has.

## Quick start

Node 24 runs the TypeScript directly (no build step):

```bash
node datasets/src/node/cli.ts list
node datasets/src/node/cli.ts generate starlite                  # small scale → datasets/out/starlite
node datasets/src/node/cli.ts generate all --scale small --seed 42 --out datasets/out --today 2026-11-30 --formats delta,csv
node datasets/src/node/cli.ts validate all --scale small         # grain, FKs, SCD2, planted issues
node datasets/src/node/cli.ts docs                               # refresh datasets/docs/*.md from a small build
```

| Option | Default | Meaning |
|---|---|---|
| `--scale` | `small` | `tiny` (1 year, < 5k gold rows: tests and in-app samples) · `small` (3 years, ~100k fact rows) · `large` (3 years, ×30 volume, millions of rows; written in streaming batches) |
| `--seed` | `42` | Any number. Same seed ⇒ identical output. |
| `--today` | `2026-11-30` | Last day of history. Years start on 1 January. |
| `--formats` | `delta` | `delta`, `csv` or both. CSV exports land in `<universe>/csv/`. |
| `--out` | `datasets/out` | Output root (gitignored). |

## What you get

```text
datasets/out/<universe>/
├── <Name>.Lakehouse/
│   ├── Files/bronze/…            raw landing files: CSV (quirky delimiters, BOMs, CRLF), JSON API envelopes,
│   │                             NDJSON streams, XLSX exports, daily/monthly partitioned folders
│   └── Tables/
│       ├── silver_*/             cleaned, conformed Delta tables (natural keys)
│       └── gold_*/               star schema Delta tables (surrogate keys); big facts partitioned by year=YYYY
│           ├── _delta_log/00000000000000000000.json
│           └── [year=YYYY/]part-00000-<uuid>-c000.snappy.parquet
├── <Name>.SemanticModel/         PBIP semantic model (definition.pbism, .platform, definition/*.tmdl)
├── <Name>.Report/                PBIR starter report (2 pages: cards, line, column, matrix, slicers)
├── <Name>.pbip                   open this
├── csv/                          plain CSV of every silver/gold table (with --formats csv)
└── README.md                     the universe's README with this build's row counts
```

**Data conventions**

- Delta protocol 1/2, one commit per table with `commitInfo`, `metaData` (Spark `schemaString` with column comments) and `add` actions carrying size, partition values and min/max/null-count stats.
- Types: `string`, `long` (all integers), `double`, `decimal(18,2)` (money), `boolean`, `date`, `timestamp`. Timestamps are wall-clock values stored as UTC, so no reader shifts them.
- Gold keys are integers. Date keys are `yyyymmdd` and join `Date[Date Key]`; time keys are `hhmm` at 15-minute grain. `-1` rows are unknown/guest/none members.
- SCD2 dimensions carry `valid_from`, `valid_to` (9999-12-31 = open), `is_current` and `version`, with no gaps or overlaps.
- Partitioned tables store the `year` partition column in the folder name (`year=2025/`), not in the Parquet file, as Spark does.

**Volumes.** `small` keeps every universe around 100k fact rows. Some universes reach that by sampling high-volume
events (for example, 1 in 30 coffee tickets); in those, labor, stock and other related flows are scaled to match,
so ratios stay realistic. Each universe's README explains its scaling. `large` runs at ~30× and is written in
monthly batches, with partition buffers capped, so memory stays bounded.

## Using the datasets

### Lumen

Open `<universe>/<Name>.pbip` (File ▸ Open). The model and report load directly. To get data in the app without
touching disk, generate a sample in memory (pure TypeScript, works in the renderer or a worker):

```ts
import { findUniverse } from './datasets/src/core/universes/index.ts'
import { sampleProject } from './datasets/src/core/sample.ts'
const { model, data } = sampleProject(findUniverse('starlite')!, { scale: 'tiny' }) // SemanticModel + DataStore
```

### Power BI Desktop

1. Enable *File ▸ Options ▸ Preview features ▸ Power BI Project (.pbip) save option* and *Store semantic model using TMDL format* on older Desktop builds.
2. Open `<Name>.pbip`. When prompted, or under *Transform data ▸ Edit parameters*, set **LakehousePath** to the absolute path of `<Name>.Lakehouse`. The generator pre-fills it with the folder it wrote to.
3. Click **Refresh**. The tables are import mode and read the gold Parquet files with `Parquet.Document(File.Contents(...))`; partitioned facts combine their yearly files.

The model is ready to build on: the date table is marked, the calculation group is **Time Intelligence** (put
*Time Calculation* on columns), the field parameter switches breakdowns, and measures live in `_Measures`, grouped in display folders.

### Microsoft Fabric

Create a lakehouse, then upload `<Name>.Lakehouse/Files/*` to **Files** and each `Tables/<table>` folder to
**Tables**. The OneLake file explorer or Azure Storage Explorer keeps the folder structure. Fabric detects the
`_delta_log` and registers the Delta tables. You can also upload everything to Files and register tables from a notebook:

```python
for t in mssparkutils.fs.ls("Files/upload/Tables"):
    spark.read.format("delta").load(t.path).write.format("delta").mode("overwrite").saveAsTable(t.name)
```

Then rebuild your own pipelines against `Files/bronze` and compare your output with the generated silver tables.

### DuckDB

```sql
INSTALL delta; LOAD delta;
SELECT s.region, SUM(f.net_amount) AS net_sales
FROM delta_scan('datasets/out/starlite/Starlite.Lakehouse/Tables/gold_fact_sales_line') f
JOIN delta_scan('datasets/out/starlite/Starlite.Lakehouse/Tables/gold_dim_store') s USING (store_key)
GROUP BY ALL ORDER BY net_sales DESC;

-- bronze is just files:
SELECT * FROM read_csv('datasets/out/starlite/Starlite.Lakehouse/Files/bronze/pos/2025/*/*/*.csv', union_by_name = true);
SELECT * FROM read_json('datasets/out/starlite/Starlite.Lakehouse/Files/bronze/loyalty/members_export.ndjson');
```

`union_by_name` matters: the POS export changes its columns halfway through history (schema drift).

### Spark / Delta Lake

```python
base = "datasets/out/moonwake/Moonwake.Lakehouse/Tables"
bookings = spark.read.format("delta").load(f"{base}/gold_fact_booking")
bookings.groupBy("year").count().show()          # partition column comes from the folder
```

## Data-quality practice

Every universe documents its planted bronze issues in its README, with a code, source, column, the kind of
problem, how many instances were planted and how silver fixes them. The kinds are: duplicates, nulls and
placeholder blanks, stray whitespace, inconsistent casing, mixed date formats (ISO, US, EU, epoch, "Mon d, yyyy"),
orphan keys, outliers (sign flips, fat-finger ×100), late-arriving records, schema drift between files, sentinel
values (-999) and numbers stored as formatted text ("$1,234.50", "1.234,50", "4.50 USD").

Lossy issues are decided before silver is derived. Silver is therefore exactly what a correct cleaning pipeline
could recover, so you can diff your result against it.

## Code

```text
datasets/src/
├── core/                 pure TypeScript (no Node APIs): usable from the Lumen renderer
│   ├── prng.ts           seeded sfc32 + distributions (normal, log-normal, Poisson, gamma/beta, Zipf…)
│   ├── calendar.ts       date math, fiscal calendars, holidays, date/time dimension rows
│   ├── scd2.ts           SCD Type 2 rows + point-in-time key lookup
│   ├── chaos.ts          bronze issue injectors and the detectors that prove them
│   ├── schema.ts         TableSpec / IssueDoc / Universe contract, column → model-name labels
│   ├── runner.ts         context, framework date/time dims, batches → TableData (Lumen's value contract)
│   ├── validate.ts       grain, FK, SCD2 and non-null validation; check.ts helps write invariants
│   ├── semantic/         SemanticModel builder, TMDL writer, PBIP/PBIR files
│   ├── readme.ts         per-universe README (Mermaid ER, catalog, issues, measures)
│   ├── sample.ts         sampleProject(): model + DataStore in memory
│   └── universes/<id>/   tables.ts (specs, sources, issues), generate.ts (simulation), index.ts (story, measures, report, invariants)
└── node/                 Parquet (hyparquet-writer), Delta log, CSV/JSON/NDJSON/XLSX writers, orchestrator, CLI
```

To add a universe, copy `universes/starlite/`, register it in `universes/index.ts`, and run
`npx vitest run datasets -t <id>`. The generic suite then enforces the rules: determinism, the tiny budget,
grain/FK/SCD2 validity, `invariants()`, every documented issue detectable, every DAX reference resolving and
evaluating in Lumen's engine, TMDL round-trip, Delta/Parquet validity and byte-identical regeneration.

## Tests

```bash
npx vitest run datasets
```

There are 166 tests. Core unit tests cover the PRNG, calendar, SCD2, injectors and detectors, and TMDL writing.
Each universe then gets 13 checks at tiny scale and 8 on-disk checks: Delta logs against the Parquet files,
hyparquet round-trip, CSV/XLSX/JSON validity, `openProject` on the `.pbip`, and regenerating byte-identical output.

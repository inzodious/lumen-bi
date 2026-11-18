import { Workspace } from "@parity/lakehouse";
import { createNodeDb } from "@parity/lakehouse/node";
import { loadTableFromWorkspace, Model } from "../index.ts";

type Row = (number | string | null)[];

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const START = Date.UTC(2025, 0, 1);
const END = Date.UTC(2026, 11, 31);

export const CHANNELS = ["voice", "relay", "beacon"];

export function calendarRows(): Row[] {
  const rows: Row[] = [];
  for (let d = START; d <= END; d += DAY) {
    const x = new Date(d);
    const y = x.getUTCFullYear();
    const m = x.getUTCMonth() + 1;
    rows.push([iso(d), y, m, iso(Date.UTC(y, m, 0)), `${y}-Q${Math.floor((m - 1) / 3) + 1}`]);
  }
  return rows;
}

export const ACCOUNTS: Row[] = [
  [1, "Starlane Holdings", "Core", "Prime", null, null],
  [2, "Vega Freight Lines", "Core", "Prime", 1, null],
  [3, "Orion Passenger Co", "Rim", "Standard", 1, null],
  [4, "Kepler Dock Services", "Core", "Standard", 2, 1],
  [5, "Lyra Cargo Bay", "Rim", "Standard", 2, 1],
  [6, "Titan Relay Station", "Rim", "Prime", 3, 1],
  [7, "Outer Belt Cooperative", "Frontier", "Prime", null, null],
  [8, "Ceres Mining Haul", "Frontier", "Standard", 7, null],
  [9, "Io Shuttle Works", "Frontier", "Standard", 7, null],
  [10, "Nomad Charter", "Frontier", "Standard", null, null],
];

export const PRODUCTS: Row[] = [
  [1, "Cargo Priority", "freight"],
  [2, "Cargo Standard", "freight"],
  [3, "Passenger Express", "passenger"],
  [4, "Passenger Economy", "passenger"],
  [5, "Diplomatic Courier", "special"],
];

export function transmissionRows(): Row[] {
  const rnd = mulberry32(20260927);
  const pick = <T>(xs: T[]) => xs[Math.floor(rnd() * xs.length)]!;
  const accountWeights = [1, 2, 2, 3, 3, 3, 4, 5, 5, 6, 6, 7, 8, 8, 9];
  const rows: Row[] = [];
  const span = (END - START) / DAY;
  for (let id = 1; id <= 720; id++) {
    const account = pick(accountWeights);
    const product = pick([1, 1, 2, 3, 3, 4]);
    let opened = START + Math.floor(rnd() * (span + 1)) * DAY;
    if (account === 9 && new Date(opened).getUTCMonth() === 7) opened -= 40 * DAY;
    const r = rnd();
    let resolved: string | null = null;
    if (r < 0.8) {
      const t = opened + Math.floor(rnd() * 45) * DAY;
      resolved = t <= END ? iso(t) : null;
    }
    const duration = rnd() < 0.06 ? null : 30 + Math.floor(rnd() * 1800);
    rows.push([id, account, product, iso(opened), resolved, duration, pick(CHANNELS)]);
  }
  return rows;
}

function lit(v: number | string | null): string {
  if (v === null) return "NULL";
  if (typeof v === "number") return String(v);
  return `'${v.replace(/'/g, "''")}'`;
}

function save(ws: Workspace, ref: string, cols: [string, string][], rows: Row[]): void {
  const values = rows.map((r) => `(${r.map(lit).join(", ")})`).join(",\n");
  const aliases = cols.map((_, i) => `c${i}`).join(", ");
  const select = cols.map(([name, type], i) => `CAST(c${i} AS ${type}) AS ${name}`).join(", ");
  ws.saveAsTable(ref, `SELECT ${select} FROM (VALUES ${values}) AS t(${aliases})`);
}

export const REF = {
  cal: "lh_gold.dbo.dim_calendar",
  acc: "lh_gold.orbitcrm.dim_accounts",
  prod: "lh_gold.beacon.dim_products",
  fact: "lh_gold.beacon.fact_transmissions",
};

export const SEL_METRIC: Row[] = [
  [0, "Transmissions"],
  [1, "Avg duration"],
  [2, "Resolved %"],
];

export const CG_ITEMS = ["Current", "MTD", "QTD", "YTD", "PY", "PY YTD", "YoY", "YoY %"];

/** Loads the Starlane star schema into DuckDB through the Workspace, then imports it into a semantic model. */
export async function starlane(): Promise<{ ws: Workspace; model: Model }> {
  const db = await createNodeDb();
  const ws = Workspace.create(db, {
    lakehouses: { lh_gold: ["dbo", "orbitcrm", "beacon"] },
    defaultLakehouse: "lh_gold",
    now: () => new Date(Date.UTC(2026, 8, 27)),
  });
  save(
    ws,
    REF.cal,
    [
      ["date", "DATE"],
      ["year", "INTEGER"],
      ["month", "INTEGER"],
      ["month_end", "DATE"],
      ["year_quarter", "VARCHAR"],
    ],
    calendarRows(),
  );
  save(
    ws,
    REF.acc,
    [
      ["account_id", "INTEGER"],
      ["account_name", "VARCHAR"],
      ["region", "VARCHAR"],
      ["tier", "VARCHAR"],
      ["parent_id", "INTEGER"],
      ["grandparent_id", "INTEGER"],
    ],
    ACCOUNTS,
  );
  save(
    ws,
    REF.prod,
    [
      ["product_id", "INTEGER"],
      ["product_name", "VARCHAR"],
      ["product_line", "VARCHAR"],
    ],
    PRODUCTS,
  );
  save(
    ws,
    REF.fact,
    [
      ["transmission_id", "INTEGER"],
      ["account_id", "INTEGER"],
      ["product_id", "INTEGER"],
      ["opened_date", "DATE"],
      ["resolved_date", "DATE"],
      ["duration_seconds", "INTEGER"],
      ["channel", "VARCHAR"],
    ],
    transmissionRows(),
  );

  const model = new Model();
  loadTableFromWorkspace(model, ws, "dim_calendar", REF.cal);
  loadTableFromWorkspace(model, ws, "dim_accounts", REF.acc);
  loadTableFromWorkspace(model, ws, "dim_products", REF.prod);
  loadTableFromWorkspace(model, ws, "fact_transmissions", `SELECT * FROM ${REF.fact} ORDER BY transmission_id`);
  model.markAsDateTable("dim_calendar", "date");
  model.addRelationship({ fromColumn: "fact_transmissions[account_id]", toColumn: "dim_accounts[account_id]" });
  model.addRelationship({ fromColumn: "fact_transmissions[product_id]", toColumn: "dim_products[product_id]", crossFilteringBehavior: "bothDirections" });
  model.addRelationship({ fromColumn: "fact_transmissions[opened_date]", toColumn: "dim_calendar[date]" });
  model.addRelationship({ fromColumn: "fact_transmissions[resolved_date]", toColumn: "dim_calendar[date]", isActive: false });
  model.addTable(
    "sel_metric",
    [
      { name: "metric_order", dataType: "int" },
      { name: "metric", dataType: "string" },
    ],
    SEL_METRIC,
  );
  model.addCalculationGroup({
    name: "cg_time_intelligence",
    column: "time_calculation",
    ordinalColumn: "time_ordinal",
    precedence: 10,
    items: [
      { name: "Current", expression: "SELECTEDMEASURE ()" },
      { name: "MTD", expression: "CALCULATE ( SELECTEDMEASURE (), DATESMTD ( dim_calendar[date] ) )" },
      { name: "QTD", expression: "CALCULATE ( SELECTEDMEASURE (), DATESQTD ( dim_calendar[date] ) )" },
      { name: "YTD", expression: "CALCULATE ( SELECTEDMEASURE (), DATESYTD ( dim_calendar[date] ) )" },
      { name: "PY", expression: "CALCULATE ( SELECTEDMEASURE (), SAMEPERIODLASTYEAR ( dim_calendar[date] ) )" },
      { name: "PY YTD", expression: "CALCULATE ( SELECTEDMEASURE (), DATESYTD ( SAMEPERIODLASTYEAR ( dim_calendar[date] ) ) )" },
      {
        name: "YoY",
        expression: `VAR Current_ = SELECTEDMEASURE ()
VAR Prior =
    CALCULATE ( SELECTEDMEASURE (), SAMEPERIODLASTYEAR ( dim_calendar[date] ) )
RETURN
IF ( NOT ISBLANK ( Current_ ) && NOT ISBLANK ( Prior ), Current_ - Prior )`,
      },
      {
        name: "YoY %",
        expression: `VAR Current_ = SELECTEDMEASURE ()
VAR Prior =
    CALCULATE ( SELECTEDMEASURE (), SAMEPERIODLASTYEAR ( dim_calendar[date] ) )
RETURN
DIVIDE ( Current_ - Prior, Prior )`,
        formatStringDefinition: '"0.0%;-0.0%;0.0%"',
      },
    ],
  });
  return { ws, model };
}

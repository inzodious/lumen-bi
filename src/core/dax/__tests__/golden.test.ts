import type { Workspace } from "@parity/lakehouse";
import { beforeAll, describe, expect, it } from "vitest";
import { lintDax, type Model, type OutValue, type SlicerFilter } from "../index.ts";
import { SEL_METRIC, starlane } from "./fixture.ts";
import {
  checkAgainstOracle,
  count,
  descendants,
  divide,
  from,
  inDates,
  isAcc,
  isCal,
  isFact,
  isProd,
  shiftDays,
  shiftMonths,
  tableWhere,
  toDateSet,
  visibleDates,
  where,
  type Cell,
  type Grid,
  type Oracle,
  type OracleCtx,
} from "./oracle.ts";
import { REF } from "./fixture.ts";

const S: Record<string, SlicerFilter[]> = {
  none: [],
  voice: [{ column: "fact_transmissions[channel]", values: ["voice"] }],
  multi: [
    { column: "fact_transmissions[channel]", values: ["relay", "beacon"] },
    { column: "dim_accounts[region]", values: ["Core", "Rim"] },
  ],
  y2025: [{ column: "dim_calendar[year]", values: [2025] }],
  y2026: [{ column: "dim_calendar[year]", values: [2026] }],
  freight: [{ column: "dim_products[product_line]", values: ["freight"] }],
  rim: [{ column: "dim_accounts[region]", values: ["Rim"] }],
  core: [{ column: "dim_accounts[region]", values: ["Core"] }],
  frontier: [{ column: "dim_accounts[region]", values: ["Frontier"] }],
  q1: [{ column: "dim_calendar[month_end]", values: ["2025-01-31", "2025-02-28", "2025-03-31"] }],
};

const FACT_GRIDS: Grid[] = [
  { groupBy: ["dim_accounts[region]", "fact_transmissions[channel]"], states: [S.none!, S.voice!, S.multi!, S.y2026!, S.freight!] },
  { groupBy: ["dim_calendar[year_quarter]"], states: [S.none!, S.rim!] },
];
const TI_GRIDS: Grid[] = [
  { groupBy: ["dim_calendar[year]", "dim_calendar[month_end]"], states: [S.none!, S.frontier!, S.voice!] },
  { groupBy: ["dim_calendar[year_quarter]"], states: [S.y2026!, S.q1!] },
];
const ACC_GRIDS: Grid[] = [
  { groupBy: ["dim_accounts[account_name]"], states: [S.none!, S.voice!, S.y2025!, S.core!] },
  { groupBy: ["dim_accounts[region]", "dim_accounts[account_name]"], states: [S.none!] },
];

interface Golden {
  name: string;
  expression: string;
  formatString?: string;
  formatStringDefinition?: string;
  oracle: Oracle;
  grids: Grid[];
  format?: (o: OracleCtx) => string | null;
}

const n = (sql: string) => `(${sql})`;
const sumDur = (cell: Cell) => `SELECT sum(f.duration_seconds)::DOUBLE ${from()} WHERE ${where(cell)}`;
const avgDur = (cell: Cell) => `SELECT avg(f.duration_seconds)::DOUBLE ${from()} WHERE ${where(cell)}`;
const resolvedPct = (cell: Cell) => divide(`SELECT NULLIF(count(f.resolved_date), 0) ${from()} WHERE ${where(cell)}`, count(cell));
const channelSlicer = (o: OracleCtx) => o.slicers.get("fact_transmissions[channel]");

function withKey(cell: Cell, key: string, vals: OutValue[] | undefined): Cell {
  const c = new Map(cell);
  if (vals === undefined) c.delete(key);
  else c.set(key, vals);
  return c;
}

function itemSql(item: string, cell: Cell, agg: string): string {
  const vis = visibleDates(cell);
  const base = `SELECT ${agg} ${from()} WHERE ${where(cell)}`;
  const py = `SELECT (v.date - INTERVAL 1 YEAR)::DATE AS date FROM (${vis}) v WHERE (v.date - INTERVAL 1 YEAR)::DATE IN (SELECT date FROM ${REF.cal})`;
  const prior = inDates(agg, cell, py);
  switch (item) {
    case "Current":
      return base;
    case "MTD":
      return inDates(agg, cell, toDateSet(vis, "month"));
    case "QTD":
      return inDates(agg, cell, toDateSet(vis, "quarter"));
    case "YTD":
      return inDates(agg, cell, toDateSet(vis, "year"));
    case "PY":
      return prior;
    case "PY YTD":
      return inDates(agg, cell, toDateSet(py, "year"));
    case "YoY":
      return `SELECT CASE WHEN cur IS NOT NULL AND pr IS NOT NULL THEN cur - pr END FROM (SELECT (${base}) cur, (${prior}) pr)`;
    case "YoY %":
      return `SELECT CASE WHEN pr IS NULL OR pr = 0 THEN NULL ELSE (COALESCE(cur, 0) - pr)::DOUBLE / pr END FROM (SELECT (${base}) cur, (${prior}) pr)`;
  }
  throw new Error(item);
}

const COUNT_AGG = "NULLIF(count(*), 0)::DOUBLE";
const cgItem = (o: OracleCtx) => (o.cell.get("cg_time_intelligence[time_calculation]")?.[0] as string | undefined) ?? "Current";

/** SELECTEDVALUE ( sel_metric[metric_order], 0 ), whichever sel_metric column the cell filters. */
function selPick(o: OracleCtx): OutValue {
  let rows = SEL_METRIC;
  const byOrder = o.cell.get("sel_metric[metric_order]");
  const byName = o.cell.get("sel_metric[metric]");
  if (byOrder) rows = rows.filter((r) => byOrder.includes(r[0]!));
  if (byName) rows = rows.filter((r) => byName.includes(r[1]!));
  return rows.length === 1 ? rows[0]![0]! : 0;
}
const cgGrids = (item: string): Grid[] => [
  {
    groupBy: ["dim_calendar[year]", "dim_calendar[month_end]"],
    states: [[{ column: "cg_time_intelligence[time_calculation]", values: [item] }], [{ column: "cg_time_intelligence[time_calculation]", values: [item] }, ...S.rim!]],
  },
];

const GOLDENS: Golden[] = [
  { name: "kpi_transmissions", expression: "COUNTROWS ( fact_transmissions )", formatString: "#,0", oracle: (o) => count(o.cell), grids: FACT_GRIDS },
  { name: "kpi_duration_total", expression: "SUM ( fact_transmissions[duration_seconds] )", oracle: (o) => sumDur(o.cell), grids: FACT_GRIDS },
  { name: "kpi_duration_avg", expression: "AVERAGE ( fact_transmissions[duration_seconds] )", oracle: (o) => avgDur(o.cell), grids: FACT_GRIDS },
  {
    name: "kpi_duration_max",
    expression: "MAX ( fact_transmissions[duration_seconds] )",
    oracle: (o) => `SELECT max(f.duration_seconds) ${from()} WHERE ${where(o.cell)}`,
    grids: FACT_GRIDS,
  },
  {
    name: "kpi_duration_count",
    expression: "COUNT ( fact_transmissions[duration_seconds] )",
    oracle: (o) => `SELECT NULLIF(count(f.duration_seconds), 0) ${from()} WHERE ${where(o.cell)}`,
    grids: FACT_GRIDS,
  },
  {
    name: "kpi_accounts_active",
    expression: "DISTINCTCOUNT ( fact_transmissions[account_id] )",
    oracle: (o) => `SELECT NULLIF(count(DISTINCT f.account_id), 0) ${from()} WHERE ${where(o.cell)}`,
    grids: FACT_GRIDS,
  },
  {
    name: "kpi_resolved_pct",
    expression: "DIVIDE ( CALCULATE ( [kpi_transmissions], NOT ISBLANK ( fact_transmissions[resolved_date] ) ), [kpi_transmissions] )",
    oracle: (o) => resolvedPct(o.cell),
    grids: FACT_GRIDS,
  },
  {
    name: "kpi_voice",
    expression: 'CALCULATE ( [kpi_transmissions], fact_transmissions[channel] = "voice" )',
    oracle: (o) => count(o.cell, { skip: (k) => k === "fact_transmissions[channel]", extra: ["f.channel = 'voice'"] }),
    grids: FACT_GRIDS,
  },
  {
    name: "kpi_voice_keep",
    expression: 'CALCULATE ( [kpi_transmissions], KEEPFILTERS ( fact_transmissions[channel] = "voice" ) )',
    oracle: (o) => count(o.cell, { extra: ["f.channel = 'voice'"] }),
    grids: FACT_GRIDS,
  },
  {
    name: "kpi_long_voice_relay",
    expression: 'CALCULATE ( [kpi_transmissions], fact_transmissions[channel] IN { "voice", "relay" }, fact_transmissions[duration_seconds] > 600 )',
    oracle: (o) =>
      count(o.cell, {
        skip: (k) => k === "fact_transmissions[channel]" || k === "fact_transmissions[duration_seconds]",
        extra: ["f.channel IN ('voice', 'relay')", "f.duration_seconds > 600"],
      }),
    grids: FACT_GRIDS,
  },
  {
    name: "kpi_channel_pct",
    expression: `VAR Denominator =
    CALCULATE (
        [kpi_transmissions],
        ALLSELECTED ( fact_transmissions[channel] )
    )
RETURN
DIVIDE ( [kpi_transmissions], Denominator )`,
    formatString: "0.00%;-0.00%;0.00%",
    oracle: (o) => divide(count(o.cell), count(withKey(o.cell, "fact_transmissions[channel]", channelSlicer(o)))),
    grids: FACT_GRIDS,
  },
  {
    name: "kpi_account_share",
    expression: "DIVIDE ( [kpi_transmissions], CALCULATE ( [kpi_transmissions], ALL ( dim_accounts ) ) )",
    oracle: (o) => divide(count(o.cell), count(o.cell, { skip: isAcc })),
    grids: FACT_GRIDS,
  },
  {
    name: "kpi_channel_share_removefilters",
    expression: "DIVIDE ( [kpi_transmissions], CALCULATE ( [kpi_transmissions], REMOVEFILTERS ( fact_transmissions[channel] ) ) )",
    oracle: (o) => divide(count(o.cell), count(o.cell, { skip: (k) => k === "fact_transmissions[channel]" })),
    grids: FACT_GRIDS,
  },
  {
    name: "kpi_grand_share",
    expression: "DIVIDE ( [kpi_transmissions], CALCULATE ( [kpi_transmissions], ALL ( fact_transmissions ) ) )",
    oracle: (o) => divide(count(o.cell), count(o.cell, { skip: (k) => isFact(k) || isAcc(k) || isProd(k) || isCal(k) })),
    grids: FACT_GRIDS,
  },
  {
    name: "kpi_resolved",
    expression: `CALCULATE (
    [kpi_transmissions],
    USERELATIONSHIP ( fact_transmissions[resolved_date], dim_calendar[date] ),
    NOT ISBLANK ( fact_transmissions[resolved_date] )
)`,
    oracle: (o) => count(o.cell, { extra: ["f.resolved_date IS NOT NULL"] }, "resolved_date"),
    grids: [...FACT_GRIDS, ...TI_GRIDS],
  },
  {
    name: "kpi_resolved_any",
    expression: "CALCULATE ( [kpi_transmissions], USERELATIONSHIP ( fact_transmissions[resolved_date], dim_calendar[date] ) )",
    oracle: (o) => count(o.cell, {}, "resolved_date"),
    grids: TI_GRIDS,
  },
  {
    name: "kpi_transmissions_agg",
    expression: `VAR ContextIDs = VALUES ( dim_accounts[account_id] )
VAR ValidAccountIDs =
    DISTINCT (
        UNION (
            ContextIDs,
            CALCULATETABLE ( VALUES ( dim_accounts[account_id] ), REMOVEFILTERS ( dim_accounts ), TREATAS ( ContextIDs, dim_accounts[parent_id] ) ),
            CALCULATETABLE ( VALUES ( dim_accounts[account_id] ), REMOVEFILTERS ( dim_accounts ), TREATAS ( ContextIDs, dim_accounts[grandparent_id] ) )
        )
    )
RETURN
CALCULATE (
    [kpi_transmissions],
    CROSSFILTER ( dim_accounts[account_id], fact_transmissions[account_id], NONE ),
    TREATAS ( ValidAccountIDs, fact_transmissions[account_id] )
)`,
    oracle: (o) => count(o.cell, { skip: isAcc, extra: [`f.account_id IN (${descendants(o.cell)})`] }),
    grids: [...ACC_GRIDS, FACT_GRIDS[0]!],
  },
  {
    name: "kpi_resolved_agg",
    expression: `CALCULATE (
    [kpi_transmissions_agg],
    USERELATIONSHIP ( fact_transmissions[resolved_date], dim_calendar[date] ),
    NOT ISBLANK ( fact_transmissions[resolved_date] )
)`,
    oracle: (o) => count(o.cell, { skip: isAcc, extra: [`f.account_id IN (${descendants(o.cell)})`, "f.resolved_date IS NOT NULL"] }, "resolved_date"),
    grids: [...ACC_GRIDS, { groupBy: ["dim_accounts[account_name]", "dim_calendar[year]"], states: [S.none!, S.voice!] }],
  },
  {
    name: "kpi_avg_per_account",
    expression: "AVERAGEX ( VALUES ( dim_accounts[account_id] ), [kpi_transmissions] )",
    oracle: (o) => `SELECT avg(cnt)::DOUBLE FROM (SELECT f.account_id, count(*) AS cnt ${from()} WHERE ${where(o.cell)} GROUP BY f.account_id)`,
    grids: FACT_GRIDS,
  },
  {
    name: "kpi_channel_max_sum",
    expression: "SUMX ( VALUES ( fact_transmissions[channel] ), CALCULATE ( MAX ( fact_transmissions[duration_seconds] ) ) )",
    oracle: (o) => `SELECT sum(mx)::DOUBLE FROM (SELECT f.channel, max(f.duration_seconds) AS mx ${from()} WHERE ${where(o.cell)} GROUP BY f.channel)`,
    grids: FACT_GRIDS,
  },
  {
    name: "kpi_duration_minutes",
    expression: "SUMX ( fact_transmissions, DIVIDE ( fact_transmissions[duration_seconds], 60 ) )",
    oracle: (o) => `SELECT sum(f.duration_seconds / 60.0)::DOUBLE ${from()} WHERE ${where(o.cell)}`,
    grids: FACT_GRIDS,
  },
  {
    name: "fmt_region",
    expression: 'SELECTEDVALUE ( dim_accounts[region], "All regions" )',
    oracle: (o) => `SELECT CASE WHEN count(DISTINCT a.region) = 1 THEN max(a.region) ELSE 'All regions' END FROM ${REF.acc} a WHERE ${tableWhere(o.cell, isAcc)}`,
    grids: [{ groupBy: ["dim_accounts[region]", "fact_transmissions[channel]"], states: [S.none!, S.rim!, S.multi!] }],
  },
  {
    name: "kpi_volume_band",
    expression: `VAR Transmissions = [kpi_transmissions]
RETURN
SWITCH (
    TRUE (),
    Transmissions >= 100, "High",
    Transmissions >= 20, "Medium",
    Transmissions > 0, "Low"
)`,
    oracle: (o) => `SELECT CASE WHEN x >= 100 THEN 'High' WHEN x >= 20 THEN 'Medium' WHEN x > 0 THEN 'Low' END FROM (SELECT ${n(count(o.cell))} AS x)`,
    grids: FACT_GRIDS,
  },
  {
    name: "sel_metric_value",
    expression: `VAR Pick = SELECTEDVALUE ( sel_metric[metric_order], 0 )
RETURN
SWITCH (
    Pick,
    0, [kpi_transmissions],
    1, [kpi_duration_avg],
    2, [kpi_resolved_pct],
    BLANK ()
)`,
    formatStringDefinition: `SWITCH (
    SELECTEDVALUE ( sel_metric[metric_order], 0 ),
    0, "#,0",
    1, "#,0.0",
    "0.0%;-0.0%;0.0%"
)`,
    oracle: (o) => {
      const pick = selPick(o);
      return pick === 0 ? count(o.cell) : pick === 1 ? avgDur(o.cell) : resolvedPct(o.cell);
    },
    format: (o) => {
      const pick = selPick(o);
      return pick === 0 ? "#,0" : pick === 1 ? "#,0.0" : "0.0%;-0.0%;0.0%";
    },
    grids: [
      {
        groupBy: ["fact_transmissions[channel]"],
        states: [
          [],
          ...[0, 1, 2].map((v) => [{ column: "sel_metric[metric_order]", values: [v] }]),
          [{ column: "sel_metric[metric_order]", values: [2] }, ...S.rim!],
          [{ column: "sel_metric[metric_order]", values: [1, 2] }],
        ],
      },
      { groupBy: ["sel_metric[metric]", "dim_accounts[region]"], states: [S.none!] },
    ],
  },
  {
    name: "kpi_ytd",
    expression: "CALCULATE ( [kpi_transmissions], DATESYTD ( dim_calendar[date] ) )",
    oracle: (o) => inDates(COUNT_AGG, o.cell, toDateSet(visibleDates(o.cell), "year")),
    grids: TI_GRIDS,
  },
  {
    name: "kpi_qtd_duration",
    expression: "CALCULATE ( [kpi_duration_total], DATESQTD ( dim_calendar[date] ) )",
    oracle: (o) => inDates("sum(f.duration_seconds)::DOUBLE", o.cell, toDateSet(visibleDates(o.cell), "quarter")),
    grids: TI_GRIDS,
  },
  {
    name: "kpi_py",
    expression: "CALCULATE ( [kpi_transmissions], SAMEPERIODLASTYEAR ( dim_calendar[date] ) )",
    oracle: (o) => inDates(COUNT_AGG, o.cell, `SELECT (v.date - INTERVAL 1 YEAR)::DATE FROM (${visibleDates(o.cell)}) v`),
    grids: TI_GRIDS,
  },
  {
    name: "kpi_prev_month",
    expression: "CALCULATE ( [kpi_transmissions], DATEADD ( dim_calendar[date], -1, MONTH ) )",
    oracle: (o) => inDates(COUNT_AGG, o.cell, shiftMonths(visibleDates(o.cell), -1)),
    grids: TI_GRIDS,
  },
  {
    name: "kpi_prev_quarter",
    expression: "CALCULATE ( [kpi_transmissions], DATEADD ( dim_calendar[date], -1, QUARTER ) )",
    oracle: (o) => inDates(COUNT_AGG, o.cell, shiftMonths(visibleDates(o.cell), -3)),
    grids: TI_GRIDS,
  },
  {
    name: "kpi_next_year",
    expression: "CALCULATE ( [kpi_transmissions], DATEADD ( dim_calendar[date], 1, YEAR ) )",
    oracle: (o) => inDates(COUNT_AGG, o.cell, shiftMonths(visibleDates(o.cell), 12)),
    grids: TI_GRIDS,
  },
  {
    name: "kpi_prev_week",
    expression: "CALCULATE ( [kpi_transmissions], DATEADD ( dim_calendar[date], -7, DAY ) )",
    oracle: (o) => inDates(COUNT_AGG, o.cell, shiftDays(visibleDates(o.cell), -7)),
    grids: TI_GRIDS,
  },
  {
    name: "fmt_date_range",
    expression: `VAR MinDate = CALCULATE ( MIN ( dim_calendar[date] ), ALLSELECTED ( dim_calendar ) )
VAR MaxDate = CALCULATE ( MAX ( dim_calendar[date] ), ALLSELECTED ( dim_calendar ) )
RETURN
FORMAT ( MinDate, "mmm d, yyyy" ) & " - " & FORMAT ( MaxDate, "mmm d, yyyy" )`,
    oracle: (o) =>
      `SELECT strftime(min(c.date), '%b %-d, %Y') || ' - ' || strftime(max(c.date), '%b %-d, %Y') FROM ${REF.cal} c WHERE ${tableWhere(o.slicers, isCal)}`,
    grids: [
      { groupBy: ["fact_transmissions[channel]"], states: [S.none!, S.y2026!, [{ column: "dim_calendar[month_end]", values: ["2025-03-31", "2025-04-30"] }]] },
      { groupBy: ["dim_calendar[year]"], states: [S.none!, S.voice!] },
    ],
  },
  {
    name: "kpi_level",
    expression: `SWITCH (
    TRUE (),
    ISINSCOPE ( dim_accounts[account_name] ), "Account",
    ISINSCOPE ( dim_accounts[region] ), "Region",
    "Total"
)`,
    oracle: (o) => `SELECT '${o.grouped.has("dim_accounts[account_name]") ? "Account" : o.grouped.has("dim_accounts[region]") ? "Region" : "Total"}'`,
    grids: [{ groupBy: ["dim_accounts[region]", "dim_accounts[account_name]"], states: [S.none!, S.voice!, S.rim!] }],
  },
  {
    name: "kpi_single_region",
    expression: "IF ( HASONEVALUE ( dim_accounts[region] ), [kpi_transmissions] )",
    oracle: (o) =>
      `SELECT CASE WHEN (SELECT count(DISTINCT a.region) FROM ${REF.acc} a WHERE ${tableWhere(o.cell, isAcc)}) = 1 THEN (${count(o.cell)}) END`,
    grids: FACT_GRIDS,
  },
  {
    name: "fmt_top_account",
    expression: "LOOKUPVALUE ( dim_accounts[account_name], dim_accounts[account_id], MAX ( fact_transmissions[account_id] ) )",
    oracle: (o) => `SELECT a.account_name FROM ${REF.acc} a WHERE a.account_id = (SELECT max(f.account_id) ${from()} WHERE ${where(o.cell)})`,
    grids: [{ groupBy: ["fact_transmissions[channel]", "dim_calendar[year]"], states: [S.none!, [{ column: "fact_transmissions[channel]", values: ["relay", "beacon"] }], S.freight!] }],
  },
  {
    name: "kpi_resolved_or_zero",
    expression: "COALESCE ( [kpi_resolved], 0 )",
    oracle: (o) => `SELECT COALESCE((${count(o.cell, { extra: ["f.resolved_date IS NOT NULL"] }, "resolved_date")}), 0)`,
    grids: FACT_GRIDS,
  },
  {
    name: "kpi_products_used",
    expression: "DISTINCTCOUNT ( dim_products[product_id] )",
    oracle: (o) => {
      const others = [...o.cell.keys()].some((k) => isFact(k) || isAcc(k) || isCal(k));
      const bidi = others ? `p.product_id IN (SELECT f.product_id ${from()} WHERE ${where(o.cell, { skip: isProd })})` : "TRUE";
      return `SELECT NULLIF(count(DISTINCT p.product_id), 0) FROM ${REF.prod} p WHERE ${tableWhere(o.cell, isProd)} AND ${bidi}`;
    },
    grids: [{ groupBy: ["dim_accounts[region]", "dim_products[product_line]"], states: [S.none!, S.voice!, S.y2026!, S.freight!] }],
  },
];

const CG_GOLDENS = ["Current", "MTD", "QTD", "YTD", "PY", "PY YTD", "YoY", "YoY %"];

let ws: Workspace;
let model: Model;

beforeAll(async () => {
  ({ ws, model } = await starlane());
  for (const g of GOLDENS) {
    model.addMeasure({ name: g.name, expression: g.expression, formatString: g.formatString, formatStringDefinition: g.formatStringDefinition, displayFolder: "Golden" });
  }
});

describe("golden measures agree with the SQL oracle on every cell", () => {
  it.each(GOLDENS.map((g) => [g.name, g] as const))("%s", (_name, g) => {
    let total = 0;
    for (const grid of g.grids) {
      const { cells, mismatches } = checkAgainstOracle(ws, model, g.name, g.oracle, grid, g.format);
      total += cells;
      expect(mismatches.slice(0, 5), `${g.name} over ${grid.groupBy.join(", ")}`).toEqual([]);
    }
    expect(total).toBeGreaterThan(10);
  });

  it.each(CG_GOLDENS)("cg_time_intelligence item %s over kpi_transmissions", (item) => {
    for (const grid of cgGrids(item)) {
      const { mismatches } = checkAgainstOracle(ws, model, "kpi_transmissions", (o) => itemSql(item, o.cell, COUNT_AGG), grid, () =>
        item === "YoY %" ? "0.0%;-0.0%;0.0%" : "#,0",
      );
      expect(mismatches.slice(0, 5)).toEqual([]);
    }
  });

  it("cg_time_intelligence items as a group-by axis, with totals showing the base measure", () => {
    const grid: Grid = { groupBy: ["cg_time_intelligence[time_calculation]", "dim_calendar[year]"], states: [S.none!, S.voice!] };
    const { mismatches } = checkAgainstOracle(ws, model, "kpi_duration_total", (o) => itemSql(cgItem(o), o.cell, "sum(f.duration_seconds)::DOUBLE"), grid);
    expect(mismatches.slice(0, 5)).toEqual([]);
  });
});

describe("golden measures are written in house style", () => {
  it("every golden expression passes lintDax", () => {
    const failing = GOLDENS.flatMap((g) => lintDax(g.expression).map((d) => `${g.name}: ${d.code} ${d.message}`));
    expect(failing).toEqual([]);
  });
});

describe("the fixture exercises the cases it is meant to", () => {
  it("has blanks, an inactive relationship with nulls, and members without facts", () => {
    const q = (sql: string) => ws.query(sql).rows[0]![0];
    expect(q(`SELECT count(*) FROM ${REF.fact} WHERE resolved_date IS NULL`)).toBeGreaterThan(50);
    expect(q(`SELECT count(*) FROM ${REF.fact} WHERE duration_seconds IS NULL`)).toBeGreaterThan(10);
    expect(q(`SELECT count(*) FROM ${REF.fact} WHERE account_id = 10 OR product_id = 5`)).toBe(0);
    expect(model.table("dim_calendar").hasBlankRow).toBe(true);
    expect(model.table("dim_accounts").hasBlankRow).toBe(false);
  });
});

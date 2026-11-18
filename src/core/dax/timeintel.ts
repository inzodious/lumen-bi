import { DaxError, unsupported } from "./errors.ts";
import { DaxDate } from "./values.ts";

export type Interval = "DAY" | "MONTH" | "QUARTER" | "YEAR";

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function inCalendar(all: readonly number[], from: number, to: number): number[] {
  return all.filter((d) => d >= from && d <= to);
}

export function datesToDate(visible: readonly number[], all: readonly number[], period: "YEAR" | "QUARTER" | "MONTH"): number[] {
  if (visible.length === 0) return [];
  const last = Math.max(...visible);
  const d = new DaxDate(last);
  const startMonth = period === "YEAR" ? 1 : period === "QUARTER" ? Math.floor((d.month - 1) / 3) * 3 + 1 : d.month;
  return inCalendar(all, DaxDate.fromParts(d.year, startMonth, 1).days, last);
}

/**
 * Shifts a contiguous set of dates. For MONTH/QUARTER/YEAR a day past the end of the target month clamps to its
 * last day, and a source month-end extends to the end of the target month, so whole months map to whole months.
 */
export function dateAdd(visible: readonly number[], n: number, interval: Interval, all: readonly number[], fn = "DATEADD"): number[] {
  if (visible.length === 0) return [];
  const sorted = [...visible].sort((a, b) => a - b);
  if (sorted[sorted.length - 1]! - sorted[0]! + 1 !== sorted.length) {
    throw new DaxError(
      "TIME",
      `${fn} needs the dates in the current context to form a contiguous interval, but they do not. Filter a contiguous range (for example a whole month or year) before shifting it.`,
    );
  }
  const out = new Set<number>();
  if (interval === "DAY") {
    for (const d of sorted) out.add(d + n);
  } else {
    const months = n * (interval === "MONTH" ? 1 : interval === "QUARTER" ? 3 : 12);
    for (const days of sorted) {
      const d = new DaxDate(days);
      const total = d.year * 12 + (d.month - 1) + months;
      const ty = Math.floor(total / 12);
      const tm = (total % 12) + 1;
      const last = daysInMonth(ty, tm);
      const start = DaxDate.fromParts(ty, tm, Math.min(d.day, last)).days;
      out.add(start);
      if (d.day === daysInMonth(d.year, d.month)) {
        for (let x = start + 1; x <= DaxDate.fromParts(ty, tm, last).days; x++) out.add(x);
      }
    }
  }
  const allSet = new Set(all);
  return [...out].filter((d) => allSet.has(d)).sort((a, b) => a - b);
}

export function parseInterval(name: string, fn = "DATEADD"): Interval {
  const u = name.toUpperCase();
  if (u === "DAY" || u === "MONTH" || u === "QUARTER" || u === "YEAR") return u;
  throw unsupported(`The ${fn} interval ${name}`);
}

/** One date moved by whole months, clamped to the target month's last day (DATEADD's PRECISE end behavior). */
export function shiftDay(days: number, n: number, interval: Interval): number {
  if (interval === "DAY") return days + n;
  const d = new DaxDate(days);
  const total = d.year * 12 + (d.month - 1) + n * (interval === "MONTH" ? 1 : interval === "QUARTER" ? 3 : 12);
  const ty = Math.floor(total / 12);
  const tm = (total % 12) + 1;
  return DaxDate.fromParts(ty, tm, Math.min(d.day, daysInMonth(ty, tm))).days;
}

/** DATESINPERIOD: [start, end) going forward, (end, start] going back, limited to dates in the column. */
export function datesInPeriod(all: readonly number[], start: number, n: number, interval: Interval): number[] {
  const end = shiftDay(start, n, interval);
  return n >= 0 ? all.filter((d) => d >= start && d < end) : all.filter((d) => d > end && d <= start);
}

function periodStart(days: number, period: "YEAR" | "QUARTER" | "MONTH"): number {
  const d = new DaxDate(days);
  const m = period === "YEAR" ? 1 : period === "QUARTER" ? Math.floor((d.month - 1) / 3) * 3 + 1 : d.month;
  return DaxDate.fromParts(d.year, m, 1).days;
}

function periodEnd(days: number, period: "YEAR" | "QUARTER" | "MONTH"): number {
  const start = new DaxDate(periodStart(days, period));
  const months = period === "YEAR" ? 12 : period === "QUARTER" ? 3 : 1;
  return DaxDate.fromParts(start.year, start.month + months, 0).days;
}

/** PREVIOUSMONTH/QUARTER/YEAR: the whole period before the one holding the first date in context. */
export function previousPeriod(visible: readonly number[], all: readonly number[], period: "YEAR" | "QUARTER" | "MONTH"): number[] {
  if (visible.length === 0) return [];
  const first = Math.min(...visible);
  const prevEnd = periodStart(first, period) - 1;
  return inCalendar(all, periodStart(prevEnd, period), prevEnd);
}

/** PARALLELPERIOD: shift the first and last dates, then fill out to whole periods. */
export function parallelPeriod(visible: readonly number[], all: readonly number[], n: number, interval: Interval): number[] {
  if (visible.length === 0) return [];
  if (interval === "DAY") throw unsupported("PARALLELPERIOD with the DAY interval", "Use DATEADD to shift by days.");
  const first = shiftDay(Math.min(...visible), n, interval);
  const last = shiftDay(Math.max(...visible), n, interval);
  return inCalendar(all, periodStart(first, interval), periodEnd(last, interval));
}

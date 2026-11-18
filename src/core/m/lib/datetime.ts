import { civilFromDays, dayOfWeek, daysFromCivil, daysInMonth, formatCustom, parseExact, validDate, type ExactKind } from "../calendar.ts";
import type { Culture } from "../culture.ts";
import { toDate, toDateTime, toDateTimeZone, toDuration, toText, toTime } from "../convert.ts";
import { MError } from "../errors.ts";
import {
  MDate,
  MDateTime,
  MDateTimeZone,
  MDuration,
  MRecord,
  MS_PER_DAY,
  MTime,
  cannotConvert,
  type MValue,
} from "../values.ts";
import { cultureArg, fromTextOptions, num, numOr, text, toTextOptions, type LibContext, type Library } from "./util.ts";

type DateLike = MDate | MDateTime | MDateTimeZone;

interface Parts {
  days: number;
  timeMs: number;
  src: DateLike;
}

function parts(v: MValue): Parts {
  if (v instanceof MDate) return { days: v.days, timeMs: 0, src: v };
  if (v instanceof MDateTime || v instanceof MDateTimeZone) {
    const days = Math.floor(v.ms / MS_PER_DAY);
    return { days, timeMs: v.ms - days * MS_PER_DAY, src: v };
  }
  throw cannotConvert(v, "Date");
}

/** Rebuilds a value of the same kind as `src` (date stays date, datetime keeps its time unless replaced). */
function rebuild(src: DateLike, days: number, timeMs: number): DateLike {
  if (src instanceof MDate) return new MDate(days);
  if (src instanceof MDateTime) return new MDateTime(days * MS_PER_DAY + timeMs);
  return new MDateTimeZone(days * MS_PER_DAY + timeMs, src.offsetMinutes);
}

const END_OF_DAY = MS_PER_DAY - 1;

function addMonths(days: number, n: number): number {
  const { y, m, d } = civilFromDays(days);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return daysFromCivil(ny, nm, Math.min(d, daysInMonth(ny, nm)));
}

function invalid(kind: string): MError {
  return new MError("Expression.Error", `The arguments provided do not represent a valid ${kind} value.`);
}

function nowUtcMs(ctx: LibContext): number {
  return ctx.host.now().getTime();
}

const EN_US_STANDARD: Record<string, string> = { d: "M/d/yyyy", D: "dddd, MMMM d, yyyy", t: "h:mm tt", T: "h:mm:ss tt", g: "M/d/yyyy h:mm tt", G: "M/d/yyyy h:mm:ss tt", o: "yyyy-MM-ddTHH:mm:ss.fffffff", s: "yyyy-MM-ddTHH:mm:ss", Y: "MMMM yyyy", y: "MMMM yyyy", M: "MMMM d", m: "MMMM d" };

function toTextWithFormat(v: MValue, options: MValue, culture: MValue): MValue {
  if (v === null) return null;
  const { format, culture: c } = toTextOptions(options, culture);
  let fmt = format;
  if (fmt === null) return toText(v, c);
  if (/^[a-zA-Z]$/.test(fmt)) {
    const std: Record<string, string> =
      c.name === "en-US" ? EN_US_STANDARD : { d: c.shortDate, T: c.longTime, G: `${c.shortDate} ${c.longTime}`, o: EN_US_STANDARD.o!, s: EN_US_STANDARD.s! };
    if (!std[fmt]) throw new MError("Expression.Error", `The standard format '${fmt}' is not supported in Lumen yet${c.name === "en-US" ? "" : ` for the ${c.name} culture`}.`);
    fmt = std[fmt]!;
  }
  if (v instanceof MDate) return formatCustom(v.days * MS_PER_DAY, fmt, undefined, c);
  if (v instanceof MDateTime) return formatCustom(v.ms, fmt, undefined, c);
  if (v instanceof MDateTimeZone) return formatCustom(v.ms, fmt, v.offsetMinutes, c);
  if (v instanceof MTime) return formatCustom(v.ms, fmt, undefined, c);
  throw cannotConvert(v, "Date");
}

/** Date.FromText / DateTime.FromText / Time.FromText: a Format is parsed exactly, otherwise best effort in the culture. */
function fromText(v: MValue, options: MValue, kind: ExactKind, bestEffort: (s: string, c: Culture) => MValue): MValue {
  if (v === null) return null;
  const s = text(v);
  const { format, culture } = fromTextOptions(options);
  if (format === null) return bestEffort(s, culture);
  const ms = parseExact(s, format, culture, kind);
  if (ms === null) throw new MError("DataFormat.Error", `We couldn't parse the input provided as a ${kind} value.`, s);
  if (kind === "Date") return new MDate(Math.floor(ms / MS_PER_DAY));
  return kind === "DateTime" ? new MDateTime(ms) : new MTime(ms);
}

export function installDateTime(lib: Library): void {
  lib.def("#date", "year, month, day", ([y, m, d]) => {
    const [yy, mm, dd] = [num(y!), num(m!), num(d!)];
    if (!validDate(yy, mm, dd)) throw invalid("Date");
    return new MDate(daysFromCivil(yy, mm, dd));
  });
  const dateTimeMs = (args: MValue[]) => {
    const [y, mo, d, h, mi, s] = args.map((a) => num(a!));
    if (!validDate(y!, mo!, d!) || h! < 0 || h! > 23 || mi! < 0 || mi! > 59 || s! < 0 || s! >= 60) throw invalid("DateTime");
    return daysFromCivil(y!, mo!, d!) * MS_PER_DAY + h! * 3_600_000 + mi! * 60_000 + Math.round(s! * 1000);
  };
  lib.def("#datetime", "year, month, day, hour, minute, second", (args) => new MDateTime(dateTimeMs(args)));
  lib.def("#datetimezone", "year, month, day, hour, minute, second, offsetHours, offsetMinutes", (args) => {
    const oh = num(args[6]!);
    const om = num(args[7]!);
    return new MDateTimeZone(dateTimeMs(args.slice(0, 6)), oh * 60 + (oh < 0 ? -Math.abs(om) : om));
  });
  lib.def("#time", "hour, minute, second", ([h, m, s]) => {
    const [hh, mm, ss] = [num(h!), num(m!), num(s!)];
    if (hh < 0 || hh > 24 || mm < 0 || mm > 59 || ss < 0 || ss >= 60 || (hh === 24 && (mm || ss))) throw invalid("Time");
    return new MTime(hh * 3_600_000 + mm * 60_000 + Math.round(ss * 1000));
  });
  lib.def("#duration", "days, hours, minutes, seconds", ([d, h, m, s]) =>
    new MDuration(Math.round(num(d!) * MS_PER_DAY + num(h!) * 3_600_000 + num(m!) * 60_000 + num(s!) * 1000)),
  );

  lib.def("Date.From", "value, ?culture", ([v, c], ctx) => toDate(v!, ctx.localOffsetMinutes, cultureArg(c!)));
  lib.def("Date.FromText", "text, ?options", ([v, o], ctx) => fromText(v!, o!, "Date", (s, c) => toDate(s, ctx.localOffsetMinutes, c)));
  lib.def("Date.ToText", "date, ?options, ?culture", ([v, f, c]) => toTextWithFormat(v!, f!, c!));
  const part = (name: string, f: (p: Parts) => MValue) =>
    lib.def(name, "dateTime", ([v]) => (v === null ? null : f(parts(v!))));
  part("Date.Year", (p) => civilFromDays(p.days).y);
  part("Date.Month", (p) => civilFromDays(p.days).m);
  part("Date.Day", (p) => civilFromDays(p.days).d);
  part("Date.QuarterOfYear", (p) => Math.ceil(civilFromDays(p.days).m / 3));
  part("Date.DaysInMonth", (p) => {
    const { y, m } = civilFromDays(p.days);
    return daysInMonth(y, m);
  });
  part("Date.DayOfYear", (p) => p.days - daysFromCivil(civilFromDays(p.days).y, 1, 1) + 1);
  part("Date.StartOfMonth", (p) => {
    const { y, m } = civilFromDays(p.days);
    return rebuild(p.src, daysFromCivil(y, m, 1), 0);
  });
  part("Date.EndOfMonth", (p) => {
    const { y, m } = civilFromDays(p.days);
    return rebuild(p.src, daysFromCivil(y, m, daysInMonth(y, m)), END_OF_DAY);
  });
  part("Date.StartOfQuarter", (p) => {
    const { y, m } = civilFromDays(p.days);
    return rebuild(p.src, daysFromCivil(y, Math.floor((m - 1) / 3) * 3 + 1, 1), 0);
  });
  part("Date.EndOfQuarter", (p) => {
    const { y, m } = civilFromDays(p.days);
    const qm = Math.ceil(m / 3) * 3;
    return rebuild(p.src, daysFromCivil(y, qm, daysInMonth(y, qm)), END_OF_DAY);
  });
  part("Date.StartOfYear", (p) => rebuild(p.src, daysFromCivil(civilFromDays(p.days).y, 1, 1), 0));
  part("Date.EndOfYear", (p) => rebuild(p.src, daysFromCivil(civilFromDays(p.days).y, 12, 31), END_OF_DAY));
  part("Date.StartOfDay", (p) => rebuild(p.src, p.days, 0));
  part("Date.EndOfDay", (p) => rebuild(p.src, p.days, END_OF_DAY));
  part("Date.MonthName", (p) => formatCustom(p.days * MS_PER_DAY, "MMMM"));
  part("Date.DayOfWeekName", (p) => formatCustom(p.days * MS_PER_DAY, "dddd"));
  lib.def("Date.DayOfWeek", "dateTime, ?firstDayOfWeek", ([v, first]) => {
    if (v === null) return null;
    const p = parts(v!);
    return (dayOfWeek(p.days) - numOr(first!, 0) + 7) % 7;
  });
  lib.def("Date.AddDays", "dateTime, numberOfDays", ([v, n]) => {
    if (v === null) return null;
    const p = parts(v!);
    return rebuild(p.src, p.days + num(n!), p.timeMs);
  });
  lib.def("Date.AddWeeks", "dateTime, numberOfWeeks", ([v, n]) => {
    if (v === null) return null;
    const p = parts(v!);
    return rebuild(p.src, p.days + 7 * num(n!), p.timeMs);
  });
  lib.def("Date.AddMonths", "dateTime, numberOfMonths", ([v, n]) => {
    if (v === null) return null;
    const p = parts(v!);
    return rebuild(p.src, addMonths(p.days, num(n!)), p.timeMs);
  });
  lib.def("Date.AddYears", "dateTime, numberOfYears", ([v, n]) => {
    if (v === null) return null;
    const p = parts(v!);
    return rebuild(p.src, addMonths(p.days, 12 * num(n!)), p.timeMs);
  });

  lib.def("DateTime.Date", "dateTime", ([v]) => {
    if (v === null) return null;
    if (v instanceof MDate) return v;
    return new MDate(parts(v!).days);
  });
  lib.def("DateTime.Time", "dateTime", ([v]) => {
    if (v === null) return null;
    return new MTime(parts(v!).timeMs);
  });
  lib.def("DateTime.LocalNow", "", (_a, ctx) => new MDateTime(nowUtcMs(ctx) + ctx.localOffsetMinutes * 60_000));
  lib.def("DateTime.FixedLocalNow", "", (_a, ctx) => new MDateTime(nowUtcMs(ctx) + ctx.localOffsetMinutes * 60_000));
  lib.def("DateTime.From", "value, ?culture", ([v, c], ctx) => toDateTime(v!, ctx.localOffsetMinutes, cultureArg(c!)));
  lib.def("DateTime.FromText", "text, ?options", ([v, o], ctx) => fromText(v!, o!, "DateTime", (s, c) => toDateTime(s, ctx.localOffsetMinutes, c)));
  lib.def("DateTime.ToText", "dateTime, ?options, ?culture", ([v, f, c]) => toTextWithFormat(v!, f!, c!));
  lib.def("DateTime.AddZone", "dateTime, timezoneHours, ?timezoneMinutes", ([v, h, m]) => {
    if (v === null) return null;
    if (!(v instanceof MDateTime)) throw cannotConvert(v!, "DateTime");
    const hours = num(h!);
    return new MDateTimeZone(v.ms, hours * 60 + (hours < 0 ? -numOr(m!, 0) : numOr(m!, 0)));
  });

  lib.def("DateTimeZone.UtcNow", "", (_a, ctx) => new MDateTimeZone(nowUtcMs(ctx), 0));
  lib.def("DateTimeZone.FixedUtcNow", "", (_a, ctx) => new MDateTimeZone(nowUtcMs(ctx), 0));
  lib.def("DateTimeZone.LocalNow", "", (_a, ctx) => new MDateTimeZone(nowUtcMs(ctx) + ctx.localOffsetMinutes * 60_000, ctx.localOffsetMinutes));
  lib.def("DateTimeZone.FixedLocalNow", "", (_a, ctx) => new MDateTimeZone(nowUtcMs(ctx) + ctx.localOffsetMinutes * 60_000, ctx.localOffsetMinutes));
  lib.def("DateTimeZone.From", "value, ?culture", ([v, c], ctx) => toDateTimeZone(v!, ctx.localOffsetMinutes, cultureArg(c!)));
  lib.def("DateTimeZone.SwitchZone", "dateTimeZone, timezoneHours, ?timezoneMinutes", ([v, h, m]) => {
    if (v === null) return null;
    if (!(v instanceof MDateTimeZone)) throw cannotConvert(v!, "DateTimeZone");
    const hours = num(h!);
    const offset = hours * 60 + (hours < 0 ? -numOr(m!, 0) : numOr(m!, 0));
    return new MDateTimeZone(v.utcMs + offset * 60_000, offset);
  });
  lib.def("DateTimeZone.ToUtc", "dateTimeZone", ([v]) => {
    if (v === null) return null;
    if (!(v instanceof MDateTimeZone)) throw cannotConvert(v!, "DateTimeZone");
    return new MDateTimeZone(v.utcMs, 0);
  });
  lib.def("DateTimeZone.ToLocal", "dateTimeZone", ([v], ctx) => {
    if (v === null) return null;
    if (!(v instanceof MDateTimeZone)) throw cannotConvert(v!, "DateTimeZone");
    return new MDateTimeZone(v.utcMs + ctx.localOffsetMinutes * 60_000, ctx.localOffsetMinutes);
  });
  lib.def("DateTimeZone.RemoveZone", "dateTimeZone", ([v]) => {
    if (v === null) return null;
    if (!(v instanceof MDateTimeZone)) throw cannotConvert(v!, "DateTimeZone");
    return new MDateTime(v.ms);
  });
  lib.def("DateTimeZone.ZoneHours", "dateTimeZone", ([v]) => (v instanceof MDateTimeZone ? Math.trunc(v.offsetMinutes / 60) : v === null ? null : (() => { throw cannotConvert(v!, "DateTimeZone"); })()));
  lib.def("DateTimeZone.ToText", "dateTimeZone, ?options, ?culture", ([v, f, c]) => toTextWithFormat(v!, f!, c!));

  const dur = (name: string, f: (ms: number) => number) =>
    lib.def(name, "duration", ([v]) => {
      if (v === null) return null;
      if (!(v instanceof MDuration)) throw cannotConvert(v!, "Duration");
      return f(v.ms);
    });
  dur("Duration.Days", (ms) => Math.trunc(ms / MS_PER_DAY));
  dur("Duration.Hours", (ms) => Math.trunc((ms % MS_PER_DAY) / 3_600_000));
  dur("Duration.Minutes", (ms) => Math.trunc((ms % 3_600_000) / 60_000));
  dur("Duration.Seconds", (ms) => (ms % 60_000) / 1000);
  dur("Duration.TotalDays", (ms) => ms / MS_PER_DAY);
  dur("Duration.TotalHours", (ms) => ms / 3_600_000);
  dur("Duration.TotalMinutes", (ms) => ms / 60_000);
  dur("Duration.TotalSeconds", (ms) => ms / 1000);
  lib.def("Duration.From", "value", ([v]) => toDuration(v!));
  lib.def("Duration.FromText", "text", ([v]) => (v === null ? null : toDuration(text(v!))));
  lib.def("Duration.ToText", "duration, ?format", ([v]) => toText(v!));

  lib.def("Time.From", "value, ?culture", ([v, c]) => toTime(v!, cultureArg(c!)));
  lib.def("Time.FromText", "text, ?options", ([v, o]) => fromText(v!, o!, "Time", (s, c) => toTime(s, c)));
  lib.def("Time.ToText", "time, ?options, ?culture", ([v, f, c]) => toTextWithFormat(v!, f!, c!));
  const timePart = (name: string, f: (ms: number) => number) =>
    lib.def(name, "dateTime", ([v]) => {
      if (v === null) return null;
      if (v instanceof MTime) return f(v.ms);
      return f(parts(v!).timeMs);
    });
  timePart("Time.Hour", (ms) => Math.floor(ms / 3_600_000));
  timePart("Time.Minute", (ms) => Math.floor((ms % 3_600_000) / 60_000));
  timePart("Time.Second", (ms) => (ms % 60_000) / 1000);
}

import { numberFromText, roundHalfEven, toNumber, toText } from "../convert.ts";
import { cultureUnsupported, type Culture } from "../culture.ts";
import { MError } from "../errors.ts";
import { MFunction, MList, cannotConvert, formatNumber, type MValue } from "../values.ts";
import { cultureArg, list, num, numOr, text, textOrNull, type Library } from "./util.ts";

function ignoreCase(comparer: MValue, fname: string): boolean {
  if (comparer === null) return false;
  if (comparer instanceof MFunction && comparer.name === "Comparer.OrdinalIgnoreCase") return true;
  if (comparer instanceof MFunction && comparer.name === "Comparer.Ordinal") return false;
  throw new MError("Expression.Error", `${fname}: only Comparer.Ordinal and Comparer.OrdinalIgnoreCase are supported in Lumen yet.`);
}

function trimChars(v: MValue): Set<string> | null {
  if (v === null) return null;
  if (typeof v === "string") return new Set([...v]);
  return new Set(list(v).values().map(text));
}

/** Text.Remove / Text.Select take one character or a list of them (`{"a".."z"}` expands to one). */
function charSet(v: MValue): Set<string> {
  const items = typeof v === "string" ? [v] : list(v).values().map(text);
  for (const ch of items) if ([...ch].length !== 1) throw new MError("Expression.Error", `The value "${ch}" isn't a single-character string.`, ch);
  return new Set(items);
}

function trim(s: string, chars: Set<string> | null, start: boolean, end: boolean): string {
  if (!chars) {
    let out = s;
    if (start) out = out.replace(/^\s+/, "");
    if (end) out = out.replace(/\s+$/, "");
    return out;
  }
  let a = 0;
  let b = s.length;
  if (start) while (a < b && chars.has(s[a]!)) a++;
  if (end) while (b > a && chars.has(s[b - 1]!)) b--;
  return s.slice(a, b);
}

/** The `index` argument of Text.BeforeDelimiter / AfterDelimiter: a number or {index, RelativePosition.*}. */
function delimiterIndex(v: MValue): { index: number; fromEnd: boolean } {
  if (v === null) return { index: 0, fromEnd: false };
  if (typeof v === "number") return { index: v, fromEnd: false };
  const parts = list(v).values();
  return { index: num(parts[0] ?? 0), fromEnd: parts[1] === 1 };
}

function findDelimiter(s: string, delim: string, idx: { index: number; fromEnd: boolean }): number {
  const positions: number[] = [];
  for (let p = s.indexOf(delim); p >= 0 && delim; p = s.indexOf(delim, p + delim.length)) positions.push(p);
  const pick = idx.fromEnd ? positions[positions.length - 1 - idx.index] : positions[idx.index];
  return pick ?? -1;
}

function roundMode(n: number, digits: number, mode: number): number {
  const f = 10 ** digits;
  const x = n * f;
  switch (mode) {
    case 0:
      return Math.ceil(x - 1e-9) / f;
    case 1:
      return Math.floor(x + 1e-9) / f;
    case 2:
      return (Math.sign(x) * Math.round(Math.abs(x))) / f;
    case 3:
      return Math.trunc(x) / f;
    default:
      return roundHalfEven(n, digits);
  }
}

function group(intPart: string): string {
  return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** A subset of .NET numeric format strings: G, D, F, N, P (with precision) and simple custom patterns like 0.00 / #,##0. */
export function formatNumberText(n: number, format: string | null): string {
  if (format === null || format === "" || /^[Gg]$/.test(format)) return formatNumber(n);
  const std = /^([DdFfNnPp])(\d{0,2})$/.exec(format);
  if (std) {
    const kind = std[1]!.toUpperCase();
    const precision = std[2] === "" ? (kind === "D" ? 0 : 2) : Number(std[2]);
    if (kind === "D") {
      if (!Number.isInteger(n)) throw new MError("Expression.Error", `The format 'D' only applies to whole numbers; got ${formatNumber(n)}.`);
      return (n < 0 ? "-" : "") + String(Math.abs(n)).padStart(precision, "0");
    }
    const value = kind === "P" ? n * 100 : n;
    const fixed = Math.abs(value).toFixed(precision);
    const [i, f] = fixed.split(".");
    const body = kind === "F" ? fixed : `${group(i!)}${f ? `.${f}` : ""}`;
    return `${value < 0 && Number(fixed) !== 0 ? "-" : ""}${body}${kind === "P" ? "%" : ""}`;
  }
  const custom = /^([#0,]*)(?:\.([0#]+))?(%?)$/.exec(format);
  if (custom && /[0#]/.test(format)) {
    const intPattern = custom[1]!;
    const fracPattern = custom[2] ?? "";
    const value = custom[3] ? n * 100 : n;
    const minInt = (intPattern.match(/0/g) ?? []).length;
    const minFrac = (fracPattern.match(/0/g) ?? []).length;
    const maxFrac = fracPattern.length;
    let fixed = Math.abs(value).toFixed(maxFrac);
    if (maxFrac > minFrac) fixed = fixed.replace(new RegExp(`0{1,${maxFrac - minFrac}}$`), "").replace(/\.$/, "");
    let [i, f] = fixed.split(".");
    i = i === "0" && minInt === 0 ? "" : i!.padStart(minInt, "0");
    if (intPattern.includes(",")) i = group(i);
    return `${value < 0 && Number(fixed) !== 0 ? "-" : ""}${i}${f ? `.${f}` : ""}${custom[3]}`;
  }
  throw new MError("Expression.Error", `Number.ToText: the format '${format}' is not supported in Lumen yet. Use G, D, F, N or P (e.g. "N2"), or a simple custom pattern like "0.00" or "#,##0".`);
}

/** Swaps the en-US separators Number.ToText produced for the culture's own. */
function localizeNumber(s: string, format: string | null, c: Culture): string {
  if (c.decimal === ".") return s;
  if (format !== null && /^[Pp]\d{0,2}$|%/.test(format)) throw cultureUnsupported(c, "Percent formatting");
  if (c.name === "fr-FR" && s.includes(",")) throw cultureUnsupported(c, "Digit grouping");
  return s.replace(/[.,]/g, (ch) => (ch === "." ? c.decimal : c.group));
}

export function installText(lib: Library): void {
  const nullSafe = (name: string, sig: string, f: (s: string, rest: MValue[]) => MValue) =>
    lib.def(name, sig, (args) => {
      const s = textOrNull(args[0]!);
      return s === null ? null : f(s, args.slice(1));
    });

  lib.def("Text.From", "value, ?culture", ([v, c]) => toText(v!, cultureArg(c!)));
  nullSafe("Text.Trim", "text, ?trim", (s, [c]) => trim(s, trimChars(c!), true, true));
  nullSafe("Text.TrimStart", "text, ?trim", (s, [c]) => trim(s, trimChars(c!), true, false));
  nullSafe("Text.TrimEnd", "text, ?trim", (s, [c]) => trim(s, trimChars(c!), false, true));
  nullSafe("Text.Remove", "text, removeChars", (s, [c]) => {
    const chars = charSet(c!);
    return [...s].filter((ch) => !chars.has(ch)).join("");
  });
  nullSafe("Text.Select", "text, selectChars", (s, [c]) => {
    const chars = charSet(c!);
    return [...s].filter((ch) => chars.has(ch)).join("");
  });
  nullSafe("Text.Upper", "text, ?culture", (s) => s.toUpperCase());
  nullSafe("Text.Lower", "text, ?culture", (s) => s.toLowerCase());
  nullSafe("Text.Proper", "text, ?culture", (s) => s.toLowerCase().replace(/(^|[^\p{L}])(\p{L})/gu, (_m, pre: string, ch: string) => pre + ch.toUpperCase()));
  nullSafe("Text.Length", "text", (s) => s.length);
  nullSafe("Text.Start", "text, count", (s, [c]) => s.slice(0, num(c!)));
  nullSafe("Text.End", "text, count", (s, [c]) => (num(c!) === 0 ? "" : s.slice(-num(c!))));
  nullSafe("Text.Middle", "text, start, ?count", (s, [st, c]) => s.substr(num(st!), c === null ? undefined : num(c!)));
  nullSafe("Text.Contains", "text, substring, ?comparer", (s, [sub, c]) => {
    const needle = text(sub!);
    return ignoreCase(c!, "Text.Contains") ? s.toLowerCase().includes(needle.toLowerCase()) : s.includes(needle);
  });
  nullSafe("Text.StartsWith", "text, substring, ?comparer", (s, [sub, c]) => {
    const needle = text(sub!);
    return ignoreCase(c!, "Text.StartsWith") ? s.toLowerCase().startsWith(needle.toLowerCase()) : s.startsWith(needle);
  });
  nullSafe("Text.EndsWith", "text, substring, ?comparer", (s, [sub, c]) => {
    const needle = text(sub!);
    return ignoreCase(c!, "Text.EndsWith") ? s.toLowerCase().endsWith(needle.toLowerCase()) : s.endsWith(needle);
  });
  nullSafe("Text.PositionOf", "text, substring, ?occurrence, ?comparer", (s, [sub, occ]) => {
    const needle = text(sub!);
    return occ === 1 ? s.lastIndexOf(needle) : s.indexOf(needle);
  });
  nullSafe("Text.Replace", "text, old, new", (s, [o, n]) => {
    const old = text(o!);
    if (old === "") throw new MError("Expression.Error", "Text.Replace: the text to find can't be empty.");
    return s.split(old).join(text(n!));
  });
  lib.def("Text.Split", "text, separator", ([s, sep]) => MList.of(text(s!).split(text(sep!))));
  lib.def("Text.Combine", "texts, ?separator", ([ts, sep]) =>
    list(ts!)
      .values()
      .filter((v) => v !== null)
      .map((v) => {
        if (typeof v !== "string") throw cannotConvert(v, "Text");
        return v;
      })
      .join(textOrNull(sep!) ?? ""),
  );
  nullSafe("Text.PadStart", "text, count, ?character", (s, [c, ch]) => {
    const pad = textOrNull(ch!) ?? " ";
    if (pad.length !== 1) throw new MError("Expression.Error", "Text.PadStart: the pad character must be a single character.");
    return s.padStart(num(c!), pad);
  });
  nullSafe("Text.PadEnd", "text, count, ?character", (s, [c, ch]) => {
    const pad = textOrNull(ch!) ?? " ";
    if (pad.length !== 1) throw new MError("Expression.Error", "Text.PadEnd: the pad character must be a single character.");
    return s.padEnd(num(c!), pad);
  });
  nullSafe("Text.BeforeDelimiter", "text, delimiter, ?index", (s, [d, i]) => {
    const pos = findDelimiter(s, text(d!), delimiterIndex(i!));
    return pos < 0 ? s : s.slice(0, pos);
  });
  nullSafe("Text.AfterDelimiter", "text, delimiter, ?index", (s, [d, i]) => {
    const delim = text(d!);
    const pos = findDelimiter(s, delim, delimiterIndex(i!));
    return pos < 0 ? "" : s.slice(pos + delim.length);
  });
  nullSafe("Text.BetweenDelimiters", "text, startDelimiter, endDelimiter, ?startIndex, ?endIndex", (s, [a, b]) => {
    const start = text(a!);
    const p = s.indexOf(start);
    if (p < 0) return "";
    const rest = s.slice(p + start.length);
    const q = rest.indexOf(text(b!));
    return q < 0 ? rest : rest.slice(0, q);
  });

  lib.def("Number.From", "value, ?culture", ([v, c]) => toNumber(v!, cultureArg(c!)));
  lib.def("Number.FromText", "text, ?culture", ([v, c]) => {
    const culture = cultureArg(c!);
    return v === null ? null : numberFromText(text(v!), culture);
  });
  lib.def("Number.ToText", "number, ?format, ?culture", ([n, f, c]) => {
    const culture = cultureArg(c!);
    if (n === null) return null;
    const format = textOrNull(f!);
    return localizeNumber(formatNumberText(num(n!), format), format, culture);
  });
  lib.def("Number.Round", "number, ?digits, ?roundingMode", ([n, d, m]) => (n === null ? null : roundMode(num(n!), numOr(d!, 0), numOr(m!, 4))));
  lib.def("Number.RoundUp", "number, ?digits", ([n, d]) => (n === null ? null : roundMode(num(n!), numOr(d!, 0), 0)));
  lib.def("Number.RoundDown", "number, ?digits", ([n, d]) => (n === null ? null : roundMode(num(n!), numOr(d!, 0), 1)));
  lib.def("Number.RoundAwayFromZero", "number, ?digits", ([n, d]) => (n === null ? null : roundMode(num(n!), numOr(d!, 0), 2)));
  lib.def("Number.RoundTowardZero", "number, ?digits", ([n, d]) => (n === null ? null : roundMode(num(n!), numOr(d!, 0), 3)));
  lib.def("Number.IntegerDivide", "number1, number2, ?precision", ([a, b]) => {
    if (a === null || b === null) return null;
    const d = num(b!);
    if (d === 0) throw new MError("Expression.Error", "Number.IntegerDivide: division by zero.");
    return Math.trunc(num(a!) / d);
  });
  lib.def("Number.Mod", "number, divisor, ?precision", ([a, b]) => (a === null || b === null ? null : num(a!) % num(b!)));
  lib.def("Number.Abs", "number", ([n]) => (n === null ? null : Math.abs(num(n!))));
  lib.def("Number.Sign", "number", ([n]) => (n === null ? null : Math.sign(num(n!))));
  lib.def("Number.Power", "number, power", ([n, p]) => (n === null || p === null ? null : num(n!) ** num(p!)));
  lib.def("Number.Sqrt", "number", ([n]) => (n === null ? null : Math.sqrt(num(n!))));
  lib.def("Number.IsNaN", "number", ([n]) => Number.isNaN(num(n!)));
  for (const facet of ["Int64", "Int32", "Int16", "Int8", "Byte"]) {
    lib.def(`${facet}.From`, "value, ?culture, ?roundingMode", ([v, c, m]) => {
      const n = toNumber(v!, cultureArg(c!));
      return n === null ? null : roundMode(n, 0, numOr(m!, 4));
    });
  }
  lib.def("Decimal.From", "value, ?culture", ([v, c]) => toNumber(v!, cultureArg(c!)));
  lib.def("Double.From", "value, ?culture", ([v, c]) => toNumber(v!, cultureArg(c!)));
  lib.def("Currency.From", "value, ?culture, ?roundingMode", ([v, c]) => {
    const n = toNumber(v!, cultureArg(c!));
    return n === null ? null : roundHalfEven(n, 4);
  });
  lib.constant("Number.PositiveInfinity", Infinity);
  lib.constant("Number.NegativeInfinity", -Infinity);
  lib.constant("Number.NaN", NaN);
  lib.constant("#infinity", Infinity);
  lib.constant("#nan", NaN);
}

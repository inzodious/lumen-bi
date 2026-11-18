import { MError } from "./errors.ts";

const EN_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const EN_DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/**
 * The slice of a .NET CultureInfo that Lumen models. A `null` list or designator
 * means Lumen doesn't know the culture's exact wording, so using it fails loudly.
 */
export interface Culture {
  name: string;
  decimal: string;
  group: string;
  /** Characters accepted as a group separator when parsing numbers. */
  groupParse: string[];
  dateSep: string;
  dayFirst: boolean;
  shortDate: string;
  longTime: string;
  amPm: [string, string] | null;
  months: string[];
  monthsAbbr: string[] | null;
  /** Extra spellings accepted when parsing abbreviated month names. */
  monthsAbbrAlt?: Record<string, number>;
  days: string[];
  daysAbbr: string[] | null;
  /** Whether English month names and Infinity/NaN spellings parse in best-effort mode. */
  english: boolean;
}

export const EN_US: Culture = {
  name: "en-US",
  decimal: ".",
  group: ",",
  groupParse: [","],
  dateSep: "/",
  dayFirst: false,
  shortDate: "M/d/yyyy",
  longTime: "h:mm:ss tt",
  amPm: ["AM", "PM"],
  months: EN_MONTHS,
  monthsAbbr: EN_MONTHS.map((m) => m.slice(0, 3)),
  days: EN_DAYS,
  daysAbbr: EN_DAYS.map((d) => d.slice(0, 3)),
  english: true,
};

const EN_GB: Culture = {
  ...EN_US,
  name: "en-GB",
  dayFirst: true,
  shortDate: "dd/MM/yyyy",
  longTime: "HH:mm:ss",
  monthsAbbrAlt: { sept: 9 },
};

const DE_DE: Culture = {
  name: "de-DE",
  decimal: ",",
  group: ".",
  groupParse: ["."],
  dateSep: ".",
  dayFirst: true,
  shortDate: "dd.MM.yyyy",
  longTime: "HH:mm:ss",
  amPm: null,
  months: ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"],
  monthsAbbr: null,
  days: ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"],
  daysAbbr: null,
  english: false,
};

const FR_FR: Culture = {
  name: "fr-FR",
  decimal: ",",
  group: "\u00a0",
  groupParse: ["\u00a0", "\u202f", " "],
  dateSep: "/",
  dayFirst: true,
  shortDate: "dd/MM/yyyy",
  longTime: "HH:mm:ss",
  amPm: ["", ""],
  months: ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"],
  monthsAbbr: null,
  days: ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"],
  daysAbbr: null,
  english: false,
};

const CULTURES = new Map([EN_US, EN_GB, DE_DE, FR_FR].map((c) => [c.name.toLowerCase(), c]));

/** `null` is Culture.Current, which is en-US in Lumen. */
export function getCulture(name: string | null): Culture {
  if (name === null) return EN_US;
  const c = CULTURES.get(name.toLowerCase());
  if (!c) {
    throw new MError(
      "Expression.Error",
      `The culture '${name}' is not supported in Lumen yet. Lumen supports en-US, en-GB, de-DE and fr-FR.`,
      name,
    );
  }
  return c;
}

export function cultureUnsupported(c: Culture, what: string): MError {
  return new MError("Expression.Error", `${what} for the ${c.name} culture is not supported in Lumen yet.`);
}

import { daysFromCivil, msFromParts } from "./calendar.ts";
import { MDate, MDateTime, MDuration, MS_PER_DAY } from "./values.ts";

export function mdate(y: number, m: number, d: number): MDate {
  return new MDate(daysFromCivil(y, m, d));
}

export function mdatetime(y: number, m: number, d: number, h = 0, mi = 0, s = 0): MDateTime {
  return new MDateTime(msFromParts(y, m, d, h, mi, s));
}

export function mduration(days: number, hours = 0, minutes = 0, seconds = 0): MDuration {
  return new MDuration(Math.round(days * MS_PER_DAY + hours * 3_600_000 + minutes * 60_000 + seconds * 1000));
}

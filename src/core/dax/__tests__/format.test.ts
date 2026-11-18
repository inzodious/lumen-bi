import { describe, expect, it } from "vitest";
import { DaxDate, formatValue } from "../index.ts";

describe("FORMAT patterns", () => {
  it.each([
    [1234.5, "#,0", "1,235"],
    [-1234.5, "#,0", "-1,235"],
    [0, "#,0", "0"],
    [1234567.125, "#,0.00", "1,234,567.13"],
    [0.1234, "0.0%", "12.3%"],
    [0.12345, "0.00%", "12.35%"],
    [-0.056, "0.0%;-0.0%;0.0%", "-5.6%"],
    [0, "0.0%;-0.0%;0.0%", "0.0%"],
    [98765.4, "$#,0", "$98,765"],
    [1234, "\\$#,0;(\\$#,0);\\$#,0", "$1,234"],
    [-1234, "\\$#,0;(\\$#,0);\\$#,0", "($1,234)"],
    [0, "\\$#,0;(\\$#,0);\\$#,0", "$0"],
    [2.5, "0", "3"],
    [7, "0.0", "7.0"],
    [0.5, "#.00", ".50"],
    [12, '0" days"', "12 days"],
  ])("FORMAT ( %s, %j ) = %j", (v, fmt, want) => {
    expect(formatValue(v, fmt)).toBe(want);
  });

  it.each([
    ["2025-03-07", "mmm d, yyyy", "Mar 7, 2025"],
    ["2025-12-31", "yyyy-mm-dd", "2025-12-31"],
    ["2026-01-15", "mmm yyyy", "Jan 2026"],
    ["2026-01-15", "MM/yyyy", "01/2026"],
    ["2026-09-27", "ddd, mmmm d, yyyy", "Sun, September 27, 2026"],
    ["2026-02-03", "yyyy-mm-dd hh:mm AM/PM", "2026-02-03 12:00 AM"],
  ])("FORMAT ( DATE %s, %j ) = %j", (d, fmt, want) => {
    expect(formatValue(DaxDate.fromIso(d), fmt)).toBe(want);
  });

  it("formats BLANK as empty text and refuses what it cannot do", () => {
    expect(formatValue(null, "#,0")).toBe("");
    expect(() => formatValue(1, "Currency")).toThrow('The named format "Currency" is not supported in Parity yet.');
    expect(() => formatValue(1, "0.00E+00")).toThrow(/not supported in Parity yet/);
    expect(() => formatValue(1000, "#,0,")).toThrow(/Thousands scaling/);
    expect(() => formatValue(45000, "yyyy-mm-dd")).toThrow(/FORMAT of a number with the date format/);
  });
});

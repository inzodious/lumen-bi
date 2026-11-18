import { describe, expect, it } from 'vitest'
import { makeDate } from '../../model/data'
import { dateToSerial, formatGeneral, formatValue, serialToDate } from '../index'

/** Wednesday 2024-01-31 13:05:09 */
const D = makeDate(2024, 1, 31, 13, 5, 9)
/** 2024-01-31 00:00:00 */
const DD = makeDate(2024, 1, 31)

const f = formatValue

function table(rows: Array<[unknown, string, string]>): void {
  for (const [v, fmt, want] of rows) {
    it(`${String(v instanceof Date ? v.toISOString() : JSON.stringify(v))} | ${fmt} -> ${want}`, () => {
      expect(f(v as never, fmt)).toBe(want)
    })
  }
}

describe('named formats', () => {
  table([
    [1234.567, 'General Number', '1234.567'],
    [1234.567, 'Currency', '$1,234.57'],
    [-1234.567, 'Currency', '($1,234.57)'],
    [0, 'Currency', '$0.00'],
    [1234.567, 'currency', '$1,234.57'],
    [1234.567, 'Fixed', '1234.57'],
    [-1234.567, 'Fixed', '-1234.57'],
    [0.5, 'Fixed', '0.50'],
    [1234.567, 'Standard', '1,234.57'],
    [0.12345, 'Percent', '12.35%'],
    [-0.5, 'Percent', '-50.00%'],
    [1234.5, 'Scientific', '1.23E+03'],
    [0.000123, 'Scientific', '1.23E-04'],
    [1, 'Yes/No', 'Yes'],
    [0, 'Yes/No', 'No'],
    [-3, 'Yes/No', 'Yes'],
    [0, 'True/False', 'False'],
    [5, 'On/Off', 'On'],
    [0, 'on/off', 'Off'],
    [D, 'General Date', '1/31/2024 1:05:09 PM'],
    [DD, 'General Date', '1/31/2024'],
    [D, 'Long Date', 'Wednesday, January 31, 2024'],
    [D, 'Medium Date', '31-Jan-24'],
    [D, 'Short Date', '1/31/2024'],
    [D, 'SHORT DATE', '1/31/2024'],
    [D, 'Long Time', '1:05:09 PM'],
    [D, 'Medium Time', '01:05 PM'],
    [D, 'Short Time', '13:05'],
    [makeDate(2024, 3, 5, 9, 7, 3), 'Long Time', '9:07:03 AM'],
    [makeDate(2024, 3, 5, 0, 7), 'Medium Time', '12:07 AM']
  ])
})

describe('.NET standard numeric specifiers', () => {
  table([
    [1234.567, 'C', '$1,234.57'],
    [1234.567, 'C0', '$1,235'],
    [-1234.567, 'C2', '($1,234.57)'],
    [1234, 'D', '1234'],
    [42, 'D5', '00042'],
    [-42, 'D5', '-00042'],
    [1234.5678, 'E', '1.234568E+003'],
    [1234.5678, 'E2', '1.23E+003'],
    [1234.5678, 'e2', '1.23e+003'],
    [0.00012345, 'E2', '1.23E-004'],
    [-1234.5678, 'E2', '-1.23E+003'],
    [1234.567, 'F', '1234.57'],
    [1234.567, 'F0', '1235'],
    [2.5, 'F3', '2.500'],
    [1234.5, 'G', '1234.5'],
    [1234.5, 'G3', '1.23E+03'],
    [0.000012345, 'G4', '1.235E-05'],
    [123.456, 'G5', '123.46'],
    [1234.567, 'N', '1,234.57'],
    [1234.567, 'N0', '1,235'],
    [-1234.567, 'N2', '-1,234.57'],
    [0.12345, 'P', '12.35%'],
    [0.12345, 'P0', '12%'],
    [0.12345, 'P1', '12.3%'],
    [-0.12345, 'P1', '-12.3%'],
    [12.345, 'P0', '1,235%'],
    [255, 'X', 'FF'],
    [255, 'x', 'ff'],
    [255, 'X4', '00FF'],
    [-1, 'X', 'FFFFFFFF']
  ])
})

describe('custom numeric formats (Power BI model corpus)', () => {
  table([
    [1234567.89, '\\$#,0;(\\$#,0);\\$#,0', '$1,234,568'],
    [-1234.5, '\\$#,0;(\\$#,0);\\$#,0', '($1,235)'],
    [0, '\\$#,0;(\\$#,0);\\$#,0', '$0'],
    [0.1234, '0.0%;-0.0%;0.0%', '12.3%'],
    [-0.1234, '0.0%;-0.0%;0.0%', '-12.3%'],
    [0, '0.0%;-0.0%;0.0%', '0.0%'],
    [1234567890, '#,##0,,.0M', '1,234.6M'],
    [0, '#,##0,,.0M', '0.0M'],
    [1234567890, '$#,##0,,.0M', '$1,234.6M'],
    [2500000, '$#,##0,,.0M', '$2.5M'],
    [1234567.891, '#,0.00', '1,234,567.89'],
    [-0.5, '#,0.00', '-0.50'],
    [2.5, '0', '3'],
    [-2.5, '0', '-3'],
    [0.4, '0', '0'],
    [2.675, '0.00', '2.68'],
    [1.005, '0.00', '1.01'],
    [1.004, '0.00', '1.00'],
    [1.0005, '0.000', '1.001'],
    [0.1 + 0.2, '0.00', '0.30'],
    [1234, '#,0', '1,234'],
    [0, '#,0', '0'],
    [999.5, '#,0', '1,000'],
    [1234567.5, '#,##0', '1,234,568'],
    [-1234.5, '\\$#,0.00;(\\$#,0.00);\\$#,0.00', '($1,234.50)'],
    [0, '\\$#,0.00;(\\$#,0.00);\\$#,0.00', '$0.00'],
    [1234.5, '\\$#,0.00;(\\$#,0.00);\\$#,0.00', '$1,234.50'],
    [0.256, '0%', '26%'],
    [1.5, '0%', '150%'],
    [1234567, '#,##0.0,K', '1,234.6K'],
    [1234567, '#,0,', '1,235'],
    [1234567, '0.0,,', '1.2'],
    [1234.5, '0.00 %;-0.00 %;0.00 %', '123450.00 %']
  ])
})

describe('custom numeric formats: placeholders, literals, sections', () => {
  table([
    [0.5, '#.00', '.50'],
    [0.5, '#.##', '.5'],
    [5, '0.##', '5'],
    [5.1, '0.##', '5.1'],
    [5.126, '0.##', '5.13'],
    [5, '0.0#', '5.0'],
    [1.5, '0.0?', '1.5 '],
    [0, '#', ''],
    [42, '00000', '00042'],
    [123456789, '000-00-0000', '123-45-6789'],
    [5, '000-00-0000', '000-00-0005'],
    [5551234567, '(###) ###-####', '(555) 123-4567'],
    [1234567, '(###) ###-####', '() 123-4567'],
    [1234567, '0', '1234567'],
    [5, '"Total: "0', 'Total: 5'],
    [5, '0 "units"', '5 units'],
    [5, '0 days', '5 days'],
    [1234, '#,0 \\x', '1,234 x'],
    [1234.5, '€#,0.00', '€1,234.50'],
    [1234.5, '£#,0', '£1,235'],
    [1234.5, '[$€-2] #,##0.00', '€ 1,234.50'],
    [-1234.5, '$#,0.00', '-$1,234.50'],
    [12, '+0;-0', '+12'],
    [-12, '+0;-0', '-12'],
    [1234, '#,##0_);(#,##0)', '1,234 '],
    [-1234, '#,##0_);(#,##0)', '(1,234)'],
    [0.0123, '0.0‰', '12.3‰'],
    [0.01, '0%%', '100%%'],
    [5, '[Red]0.00', '5.00'],
    [5, '0 "abc', '5 abc'],
    // sections
    [0, '0;(0);"zero";"null"', 'zero'],
    [5, '0;(0);"zero";"null"', '5'],
    [-5, '0;(0);"zero";"null"', '(5)'],
    [-5, '0.0;;"z"', '-5.0'],
    [0, '0.0;;"z"', 'z'],
    [-5, '0;(0);"z";"n";"extra"', '(5)'],
    [-5, '0;(0)', '(5)'],
    [0, '0;(0)', '0'],
    [-0.001, '0.0', '0.0'],
    [-0.001, '0.0;(0.0)', '(0.0)'],
    [-0, '0.00', '0.00'],
    [-0, '0;(0);"z"', 'z'],
    [-5, '0.00;', '-5.00']
  ])
})

describe('custom numeric formats: scientific and extremes', () => {
  table([
    [12345, '0.00E+00', '1.23E+04'],
    [0.000123, '0.00E+00', '1.23E-04'],
    [9999, '0.00E+00', '1.00E+04'],
    [0, '0.00E+00', '0.00E+00'],
    [-12345, '0.00E+00', '-1.23E+04'],
    [12345, '0.0E-0', '1.2E4'],
    [0.00012, '0.0E-0', '1.2E-4'],
    [12345, '##0.0E+0', '12.3E+3'],
    [12345, '0.00e+00', '1.23e+04'],
    [1e20, '#,0', '100,000,000,000,000,000,000'],
    [1e21, '0', '1000000000000000000000'],
    [1e-20, '0.00', '0.00'],
    [123456789.123, '#,0.000', '123,456,789.123'],
    [NaN, '0.00', 'NaN'],
    [Infinity, '#,0', 'Infinity'],
    [-Infinity, '#,0', '-Infinity']
  ])
})

describe('custom date/time formats', () => {
  table([
    [D, 'm/d/yyyy', '1/31/2024'],
    [D, 'mm/dd/yyyy', '01/31/2024'],
    [D, 'yyyy-mm-dd', '2024-01-31'],
    [D, 'dd/mm/yyyy', '31/01/2024'],
    [D, 'mmm yyyy', 'Jan 2024'],
    [D, 'mmmm yyyy', 'January 2024'],
    [D, 'mmm-yy', 'Jan-24'],
    [D, 'mmm', 'Jan'],
    [D, 'mmmm', 'January'],
    [D, 'mmmmm', 'J'],
    [D, 'ddd', 'Wed'],
    [D, 'dddd', 'Wednesday'],
    [D, 'yyyy', '2024'],
    [D, 'yy', '24'],
    [D, 'yyy', '2024'],
    [D, 'hh:mm AM/PM', '01:05 PM'],
    [D, 'h:nn AM/PM', '1:05 PM'],
    [D, 'hh:mm:ss', '13:05:09'],
    [D, 'mm/dd/yyyy hh:mm:ss AM/PM', '01/31/2024 01:05:09 PM'],
    [D, 'dd-mmm-yyyy', '31-Jan-2024'],
    [D, 'MMM yyyy', 'Jan 2024'],
    [D, 'MMMM d, yyyy', 'January 31, 2024'],
    [D, 'DD/MM/YYYY', '31/01/2024'],
    [D, 'yyyy-MM-dd HH:mm:ss', '2024-01-31 13:05:09'],
    [D, '\\Qq', 'Q1'],
    [D, '"Q"q yyyy', 'Q1 2024'],
    [makeDate(2024, 11, 5), 'q', '4'],
    [D, 'hh:mm am/pm', '01:05 pm'],
    [D, 'h:mm a/p', '1:05 p'],
    [D, 'h:mm A/P', '1:05 P'],
    [D, 'h:mm AMPM', '1:05 PM'],
    [D, 'h:mm tt', '1:05 PM'],
    [D, 'H:mm', '13:05'],
    [D, 'h:mm', '13:05'],
    [D, 'HH:mm AM/PM', '13:05 PM'],
    [makeDate(2024, 1, 1, 0, 30), 'h:nn AM/PM', '12:30 AM'],
    [makeDate(2024, 1, 1, 12), 'h AM/PM', '12 PM'],
    [D, 'y', '31'],
    [makeDate(2024, 12, 31), 'y', '366'],
    [D, 'w', '4'],
    [D, 'ww', '5'],
    [makeDate(2024, 1, 1), 'ww', '1'],
    [D, 'ddddd', '1/31/2024'],
    [D, 'dddddd', 'Wednesday, January 31, 2024'],
    [D, 'ttttt', '1:05:09 PM'],
    [D, 'c', '1/31/2024 1:05:09 PM'],
    [D, 'm', '1'],
    [D, 'mm:ss', '05:09'],
    [D, 'n', '5'],
    [D, 's', '9'],
    [D, 'd', '31'],
    [makeDate(2024, 1, 31, 13, 5, 9, 123), 'hh:mm:ss.000', '13:05:09.123'],
    [makeDate(2024, 1, 31, 13, 5, 9, 123), 'HH:mm:ss.fff', '13:05:09.123'],
    [makeDate(2024, 1, 31, 13, 5, 9, 123), 'ss.0', '09.1'],
    [D, 'dddd, d \\o\\f mmmm', 'Wednesday, 31 of January'],
    [D, 'd"th" mmmm', '31th January'],
    [new Date('0005-03-01T00:00:00Z'), 'yyyy-mm-dd', '0005-03-01']
  ])
})

describe('type crossovers', () => {
  table([
    [45322, 'yyyy-mm-dd', '2024-01-31'],
    [45322.5, 'General Date', '1/31/2024 12:00:00 PM'],
    [45322, 'Long Date', 'Wednesday, January 31, 2024'],
    [0.5, 'General Date', '12:00:00 PM'],
    [0, 'Short Date', '12/30/1899'],
    [61, 'Short Date', '3/1/1900'],
    [DD, '0', '45322'],
    [D, '0.00', '45322.55'],
    [DD, '#,0', '45,322'],
    [DD, 'Currency', '$45,322.00'],
    [DD, 'N2', '45,322.00'],
    [DD, 'G', '1/31/2024'],
    [45322, 'd', '45322'],
    [true, '0', '1'],
    [false, '0', '0'],
    [true, '0.00', '1.00'],
    [true, 'Yes/No', 'Yes'],
    [false, 'True/False', 'False'],
    [true, 'On/Off', 'On'],
    ['abc', '0.00', 'abc'],
    ['abc', 'yyyy', 'abc'],
    ['abc', 'Currency', 'abc'],
    ['abc', '>', 'ABC'],
    ['ABC', '<', 'abc'],
    ['abc', '@@@@@', '  abc'],
    ['abc', '!@@@@@', 'abc  '],
    ['5551234', '@@@-@@@@', '555-1234'],
    ['abc', '"[" @ "]"', '[ abc ]'],
    ['abcdef', '@@@', 'abcdef'],
    ['ab', '&&&&', 'ab'],
    [5, '@', '5']
  ])
})

describe('serial helpers', () => {
  it('converts serials to UTC-naive dates', () => {
    expect(serialToDate(45322).toISOString()).toBe('2024-01-31T00:00:00.000Z')
    expect(serialToDate(45322 + 47109 / 86400).toISOString()).toBe('2024-01-31T13:05:09.000Z')
    expect(serialToDate(0).toISOString()).toBe('1899-12-30T00:00:00.000Z')
    expect(serialToDate(-1.25).toISOString()).toBe('1899-12-29T06:00:00.000Z')
    expect(serialToDate(2).toISOString()).toBe('1900-01-01T00:00:00.000Z')
    expect(Number.isNaN(serialToDate(NaN).getTime())).toBe(true)
  })
  it('converts dates to serials', () => {
    expect(dateToSerial(DD)).toBe(45322)
    expect(dateToSerial(D)).toBeCloseTo(45322 + 47109 / 86400, 10)
    expect(dateToSerial(makeDate(1899, 12, 29, 6))).toBe(-1.25)
    expect(dateToSerial(makeDate(1899, 12, 30))).toBe(0)
    expect(Number.isNaN(dateToSerial(new Date(NaN)))).toBe(true)
  })
  it('round-trips', () => {
    for (const s of [1, 2.5, 45322.545243055556, 60, 61, -700.75, 2958465]) {
      expect(dateToSerial(serialToDate(s))).toBeCloseTo(s, 8)
    }
  })
})

describe('formatGeneral', () => {
  it('numbers', () => {
    expect(formatGeneral(1234)).toBe('1234')
    expect(formatGeneral(-1234.5)).toBe('-1234.5')
    expect(formatGeneral(0.1 + 0.2)).toBe('0.3')
    expect(formatGeneral(1 / 3)).toBe('0.333333333333333')
    expect(formatGeneral(2 / 3)).toBe('0.666666666666667')
    expect(formatGeneral(123456789012.345)).toBe('123456789012.345')
    expect(formatGeneral(1e20)).toBe('1E+20')
    expect(formatGeneral(1e20, 'int64')).toBe('100000000000000000000')
    expect(formatGeneral(1.5e-7)).toBe('1.5E-07')
    expect(formatGeneral(0.0001)).toBe('0.0001')
    expect(formatGeneral(0.00001)).toBe('1E-05')
    expect(formatGeneral(-0)).toBe('0')
    expect(formatGeneral(NaN)).toBe('NaN')
    expect(formatGeneral(-Infinity)).toBe('-Infinity')
  })
  it('other types', () => {
    expect(formatGeneral(true)).toBe('True')
    expect(formatGeneral(false)).toBe('False')
    expect(formatGeneral(D)).toBe('1/31/2024 1:05:09 PM')
    expect(formatGeneral(DD, 'dateTime')).toBe('1/31/2024')
    expect(formatGeneral(45322, 'dateTime')).toBe('1/31/2024')
    expect(formatGeneral('abc')).toBe('abc')
    expect(formatGeneral(new Uint8Array([1, 2]))).toBe('')
    expect(formatGeneral(null)).toBe('')
    expect(formatGeneral(new Date(NaN))).toBe('')
  })
  it('formatValue without a format falls back to general', () => {
    expect(f(1234.5, null)).toBe('1234.5')
    expect(f(1234.5, '')).toBe('1234.5')
    expect(f(1234.5)).toBe('1234.5')
    expect(f(1234.5, 'General')).toBe('1234.5')
    expect(f(DD, undefined, { dataType: 'dateTime', culture: 'fr-FR' })).toBe('1/31/2024')
    expect(f(null, '0.00')).toBe('')
    expect(f(new Uint8Array([1]), '0')).toBe('')
  })
})

describe('robustness', () => {
  it('never throws on odd format strings', () => {
    const fmts = ['"', '\\', '[', ']', ';;;;;;', 'E+', '0E+', '.', ',', '%', '@#$%^&*()', '[$', 'yyyy;0;@', '0.0.0', '#,', ',0', 'AM/PM', 'tt', 'f']
    const values = [0, -1.5, 1e300, -1e-300, NaN, true, D, 'x', new Date(NaN)]
    for (const fmt of fmts) for (const v of values) expect(typeof f(v, fmt)).toBe('string')
  })
  it('caches many distinct formats without growing unbounded', () => {
    for (let i = 0; i < 2500; i++) expect(f(i, `0 "${i}"`)).toBe(`${i} ${i}`)
  })
  it('invalid dates render empty', () => {
    expect(f(new Date(NaN), 'yyyy')).toBe('')
    expect(f(1e300, 'yyyy')).toBe('1E+300')
  })
})

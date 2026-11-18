/** Excel-style bracket conditions and color codes in format strings. */
import { describe, expect, it } from 'vitest'
import { formatColor, formatValue } from '../index'

describe('bracket conditions', () => {
  const kmb = '[>=1000000]#,##0.0,,"M";[>=1000]#,##0.0,"K";0'
  it('select the section by condition', () => {
    expect(formatValue(2_500_000, kmb)).toBe('2.5M')
    expect(formatValue(12_345, kmb)).toBe('12.3K')
    expect(formatValue(999, kmb)).toBe('999')
    expect(formatValue(0, kmb)).toBe('0')
  })
  it('the else section keeps the minus sign', () => {
    expect(formatValue(-5, kmb)).toBe('-5')
    expect(formatValue(-12_345, '[>=1000]#,##0,"K";0')).toBe('-12345')
  })
  it('a negative-only conditional section shows the absolute value', () => {
    expect(formatValue(-42, '[<0]"(" 0 ")";0')).toBe('( 42 )')
    expect(formatValue(42, '[<0]"(" 0 ")";0')).toBe('42')
  })
  it('second section can carry its own condition; the third is the else', () => {
    const f = '[>100]"big "0;[<-100]"small "0;"mid "0'
    expect(formatValue(150, f)).toBe('big 150')
    expect(formatValue(-150, f)).toBe('small 150')
    expect(formatValue(50, f)).toBe('mid 50')
    expect(formatValue(-50, f)).toBe('-mid 50')
  })
  it('conditions with decimals and <> / =', () => {
    expect(formatValue(0.5, '[<1]0.00;0')).toBe('0.50')
    expect(formatValue(3, '[=3]"three";0')).toBe('three')
    expect(formatValue(4, '[<>3]"not three";0')).toBe('not three')
  })
})

describe('color codes', () => {
  it('are not printed', () => {
    expect(formatValue(5, '[Green]0;[Red]-0')).toBe('5')
    expect(formatValue(-5, '[Green]0;[Red]-0')).toBe('-5')
    expect(formatValue(-5, '[Blue]#,##0;[Red](#,##0)')).toBe('(5)')
  })
  it('formatColor returns the selected section color', () => {
    expect(formatColor(5, '[Green]0;[Red]-0')).toBe('#00FF00')
    expect(formatColor(-5, '[Green]0;[Red]-0')).toBe('#FF0000')
    expect(formatColor(0, '[Green]0;[Red]-0;[Color10]0')).toBe('#008000')
    expect(formatColor(2000, '[Blue][>=1000]0,"K";0')).toBe('#0000FF')
    expect(formatColor(20, '[Blue][>=1000]0,"K";0')).toBeNull()
    expect(formatColor(5, '0.00')).toBeNull()
    expect(formatColor(null, '[Red]0')).toBeNull()
  })
  it('literal brackets inside quotes are not codes', () => {
    expect(formatValue(5, '"[Red]"0')).toBe('[Red]5')
    expect(formatColor(5, '"[Red]"0')).toBeNull()
  })
})

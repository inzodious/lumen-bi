import { emptyReport } from '@core/report/types'
import { resolveTheme } from '@core/report/theme'
import { customVisualDisplayName, customVisualLabel, stripVisualGuid } from '../customVisualInfo'
import { POWER_AUTOMATE_TYPE, readPowerAutomateFormat } from '../PowerAutomate'
import { getVisual } from '../../registry'
import '../index'

const GUID = 'FlowVisual_C29F1DCC_81F5_4973_94AD_0517D44CC06A'

describe('custom visual metadata', () => {
  it('strips both GUID spellings', () => {
    expect(stripVisualGuid(GUID)).toBe('FlowVisual')
    expect(stripVisualGuid('htmlContent443BE3AD55E043BF878BED274D3A6865')).toBe('htmlContent')
    expect(stripVisualGuid('lineChart')).toBe('lineChart')
  })
  it('reads the display name from package.json (string or bytes), else the pbiviz.json resource', () => {
    const r = emptyReport()
    expect(customVisualDisplayName(r, GUID)).toBeUndefined()
    r.extraFiles[`CustomVisuals/${GUID}/resources/${GUID}.pbiviz.json`] = JSON.stringify({ visual: { displayName: 'From pbiviz' } })
    expect(customVisualDisplayName(r, GUID)).toBe('From pbiviz')
    r.extraFiles[`CustomVisuals/${GUID}/package.json`] = new TextEncoder().encode('﻿' + JSON.stringify({ visual: { guid: GUID, displayName: 'Power Automate for Power BI' } }))
    expect(customVisualDisplayName(r, GUID)).toBe('Power Automate for Power BI')
    expect(customVisualLabel(r, GUID)).toBe('Power Automate for Power BI')
  })
  it('accepts Report/-prefixed paths and ignores malformed json', () => {
    const r = emptyReport()
    r.extraFiles[`Report/CustomVisuals/chicletSlicer1448559807354/package.json`] = '{not json'
    expect(customVisualDisplayName(r, 'chicletSlicer1448559807354')).toBeUndefined()
    r.extraFiles[`Report/CustomVisuals/WordCloud1447959067750/package.json`] = JSON.stringify({ visual: { displayName: 'Word Cloud' } })
    expect(customVisualDisplayName(r, 'WordCloud1447959067750')).toBe('Word Cloud')
  })
  it('humanizes the visualType when no package is embedded', () => {
    expect(customVisualLabel(emptyReport(), 'chicletSlicer' + 'A'.repeat(32))).toBe('Chiclet Slicer')
    expect(customVisualLabel(undefined, GUID)).toBe('Flow Visual')
  })
})

describe('Power Automate button visual', () => {
  const theme = resolveTheme()
  const lit = (v: string) => ({ expr: { Literal: { Value: v } } })
  const color = (c: string) => ({ solid: { color: lit(`'${c}'`) } })
  it('is registered under its exact (underscore GUID) visualType', () => {
    expect(getVisual(POWER_AUTOMATE_TYPE)?.displayName).toBe('Power Automate for Power BI')
  })
  it('defaults to the Learn look: blue fill, white "Run flow"', () => {
    const f = readPowerAutomateFormat({ visual: { visualType: POWER_AUTOMATE_TYPE } }, theme)
    expect(f).toMatchObject({ text: 'Run flow', fill: '#0066FF', fontColor: '#FFFFFF', hAlign: 'center', vAlign: 'middle', showText: true })
  })
  it('reads buttonText / buttonFill with state selectors falling back to default', () => {
    const json = {
      visual: {
        visualType: POWER_AUTOMATE_TYPE,
        objects: {
          buttonFill: [
            { properties: { color: color('#3B5E96') }, selector: { id: 'default' } },
            { properties: { color: color('#22406E') }, selector: { id: 'hover' } }
          ],
          buttonText: [{ properties: { text: lit("'Enroll owners'"), fontSize: lit('12D'), horizontalAlignment: lit("'left'") }, selector: { id: 'default' } }]
        }
      }
    }
    const d = readPowerAutomateFormat(json, theme)
    expect(d).toMatchObject({ text: 'Enroll owners', fill: '#3B5E96', fontSize: 12, hAlign: 'left' })
    const h = readPowerAutomateFormat(json, theme, 'hover')
    expect(h).toMatchObject({ text: 'Enroll owners', fill: '#22406E', fontSize: 12 })
  })
  it('fill can be turned off', () => {
    const f = readPowerAutomateFormat({ visual: { visualType: POWER_AUTOMATE_TYPE, objects: { buttonFill: [{ properties: { show: lit('false') } }] } } }, theme)
    expect(f.fill).toBeUndefined()
  })
})

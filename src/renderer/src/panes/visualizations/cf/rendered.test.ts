import { cfRendered, type CFTarget } from './target'

const t = (object: string, prop: string, container = false): CFTarget => ({ pageName: 'p', visualName: 'v', container, object, prop } as CFTarget)

describe('cfRendered (which fx properties Lumen previews)', () => {
  it('charts evaluate data colors and data label colors', () => {
    expect(cfRendered('clusteredColumnChart', t('dataPoint', 'fill'))).toBe(true)
    expect(cfRendered('lineChart', t('labels', 'color'))).toBe(true)
    expect(cfRendered('donutChart', t('labels', 'color'))).toBe(true)
  })
  it('container colors and titles are evaluated for every visual', () => {
    for (const [o, p] of [['title', 'fontColor'], ['background', 'color'], ['border', 'color'], ['subTitle', 'text'], ['visualHeader', 'background']])
      expect(cfRendered('gauge', t(o, p, true))).toBe(true)
  })
  it('unsupported combinations stay flagged', () => {
    expect(cfRendered('gauge', t('labels', 'color'))).toBe(false)
    expect(cfRendered('scatterChart', t('categoryAxis', 'labelColor'))).toBe(false)
  })
})

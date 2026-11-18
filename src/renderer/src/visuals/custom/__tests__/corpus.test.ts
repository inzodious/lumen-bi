import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { readDenebSettings } from '../denebModel'
import { readHtmlContentOptions } from '../htmlContentModel'
import { buildParagraphs } from '../../elements/textboxModel'
import { readAction } from '../../elements/actions'
import { readImageSource } from '../../elements/Image'

const ROOT = process.env.LUMEN_CORPUS_DIR ?? ''

function* visuals(dir: string): Generator<any> {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) yield* visuals(p)
    else if (e === 'visual.json') yield JSON.parse(readFileSync(p, 'utf8'))
  }
}

describe.skipIf(!existsSync(ROOT))('corpus: elements & custom visuals parse', () => {
  const all = existsSync(ROOT) ? [...visuals(ROOT)] : []
  const of = (prefix: string) => all.filter((v) => String(v.visual?.visualType ?? '').startsWith(prefix))

  it('every textbox yields paragraphs with runs', () => {
    const tbs = of('textbox')
    expect(tbs.length).toBeGreaterThan(100)
    for (const v of tbs) {
      const ps = buildParagraphs(v.visual.objects.general[0].properties.paragraphs)
      expect(ps.length).toBeGreaterThan(0)
      for (const p of ps) for (const r of p.runs) expect(r.style.fontSize).toBeGreaterThan(4)
    }
  })

  it('every Deneb spec parses', () => {
    for (const v of of('deneb')) {
      const s = readDenebSettings(v)
      expect(s.specError).toBeUndefined()
      expect(s.provider).toBe('vegaLite')
    }
  })

  it('every HTML Content visual has options', () => {
    for (const v of of('htmlContent')) {
      const o = readHtmlContentOptions(v)
      expect(o.fontSize).toBeGreaterThan(0)
    }
  })

  it('every action button has an action and every image a source', () => {
    for (const v of of('actionButton')) expect(readAction(v)?.type).toBeTruthy()
    for (const v of of('image')) expect(readImageSource(v, (r) => `res://${r.resource ?? r}`).url).toMatch(/^res:\/\//)
  })
})

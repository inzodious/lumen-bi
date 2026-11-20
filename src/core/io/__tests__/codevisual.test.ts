/** Code visuals in saved projects: code files beside visual.json (PBIP), round trips (PBIP, .wbi), untouched re-save. */
import { describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { nodeFs } from '../nodefs'
import { openProject, saveProject } from '../open'
import { createSampleProject } from '../../data/sample'
import { CODE_VISUAL_TYPE, newCodeVisualJson, readCodeSource, readParamDefs } from '../../codevisual/model'
import { BAR_LIST, applyTemplate } from '../../codevisual/templates'

function projectWithCodeVisual() {
  const p = createSampleProject()
  const page = p.report!.pages[0]
  const json = newCodeVisualJson('c0de0000000000000001', { html: '', css: '', jsx: '' })
  applyTemplate(json, BAR_LIST)
  json.visual.objects.lumenCode[0].properties.jsx = { expr: { Literal: { Value: "'export default () => <b>it''s JSX</b>\n'" } } }
  json.visual.objects.lumenCode[0].properties.drill = { expr: { Literal: { Value: `'{"level":1,"path":[]}'` } } }
  json.visual.query.queryState = {
    Category: { projections: [{ field: { Column: { Expression: { SourceRef: { Entity: 'Product' } }, Property: 'Category' } }, queryRef: 'Product.Category', active: true }] },
    Y: { projections: [{ field: { Measure: { Expression: { SourceRef: { Entity: '_Measures' } }, Property: 'Total Sales' } }, queryRef: '_Measures.Total Sales' }] }
  }
  page.visuals.push({ name: json.name, json })
  return { p, page: page.name, json }
}

function walk(dir: string, base = dir): string[] {
  return readdirSync(dir).flatMap((f) => {
    const full = join(dir, f)
    return statSync(full).isDirectory() ? walk(full, base) : [full.slice(base.length + 1)]
  })
}

describe('code visual persistence', () => {
  it('writes the code as files beside visual.json and reads it back', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lumen-cv-'))
    try {
      const { p, page, json } = projectWithCodeVisual()
      const target = join(dir, 'Code.pbip')
      await saveProject(p, target, nodeFs, { format: 'pbip' })
      const vdir = join(dir, 'Code.Report', 'definition', 'pages', page, 'visuals', 'c0de0000000000000001')
      expect(readdirSync(vdir).sort()).toEqual(['code.css', 'code.html', 'code.jsx', 'visual.json'])
      expect(readFileSync(join(vdir, 'code.html'), 'utf8')).toBe(BAR_LIST.html)
      expect(readFileSync(join(vdir, 'code.jsx'), 'utf8')).toBe("export default () => <b>it's JSX</b>\n")
      const onDisk = JSON.parse(readFileSync(join(vdir, 'visual.json'), 'utf8'))
      expect(onDisk.visual.visualType).toBe(CODE_VISUAL_TYPE)
      const props = onDisk.visual.objects.lumenCode[0].properties
      expect(props.html).toBeUndefined()
      expect(props.version).toEqual({ expr: { Literal: { Value: '1L' } } })
      expect(JSON.parse(props.files.expr.Literal.Value.slice(1, -1))).toEqual({ html: 'code.html', css: 'code.css', jsx: 'code.jsx' })

      const back = await openProject(target, nodeFs)
      const v = back.report!.pages.find((x) => x.name === page)!.visuals.find((x) => x.name === 'c0de0000000000000001')!
      expect(readCodeSource(v.json)).toEqual(readCodeSource(json))
      expect(readParamDefs(v.json)).toEqual(BAR_LIST.params)
      expect(v.json.visual.objects.lumenCode[0].properties.drill).toEqual(json.visual.objects.lumenCode[0].properties.drill)
      expect(Object.keys(back.report!.extraFiles).some((f) => f.endsWith('code.html'))).toBe(false)

      // an untouched re-save changes no file
      const before = walk(join(dir, 'Code.Report')).map((f) => [f, statSync(join(dir, 'Code.Report', f)).mtimeMs] as const)
      await saveProject(back, target, nodeFs, { format: 'pbip' })
      const after = walk(join(dir, 'Code.Report')).map((f) => [f, statSync(join(dir, 'Code.Report', f)).mtimeMs] as const)
      expect(after).toEqual(before)

      // removing the JSX removes its file on the next save
      const vj = back.report!.pages.find((x) => x.name === page)!.visuals.find((x) => x.name === 'c0de0000000000000001')!.json
      delete vj.visual.objects.lumenCode[0].properties.jsx
      await saveProject(back, target, nodeFs, { format: 'pbip' })
      expect(existsSync(join(vdir, 'code.jsx'))).toBe(false)
      expect(existsSync(join(vdir, 'code.html'))).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('round-trips through a .wbi bundle', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lumen-cv-'))
    try {
      const { p, page, json } = projectWithCodeVisual()
      const target = join(dir, 'Code.wbi')
      await saveProject(p, target, nodeFs, { format: 'wbi' })
      const back = await openProject(target, nodeFs)
      const v = back.report!.pages.find((x) => x.name === page)!.visuals.find((x) => x.name === 'c0de0000000000000001')!
      expect(readCodeSource(v.json)).toEqual(readCodeSource(json))
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

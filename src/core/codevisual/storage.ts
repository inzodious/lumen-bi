/**
 * Code visual: code files beside visual.json in PBIR folders (PBIP projects and the PBIP part of `.wbi` bundles).
 *
 *   definition/pages/<page>/visuals/<visual>/visual.json   lumenCode.files = '{"html":"code.html","css":"code.css"}'
 *   definition/pages/<page>/visuals/<visual>/code.html     the template
 *   definition/pages/<page>/visuals/<visual>/code.css      the stylesheet
 *   definition/pages/<page>/visuals/<visual>/code.jsx      the JSX component
 *
 * Only the layers in use are written. On read the files are put back into the visual's JSON (model.ts), so every
 * in-memory operation (copy / paste, duplicate page, undo, bookmarks) handles a code visual like any other visual.
 * Whether Power BI Desktop accepts extra files in a visual folder is not verified (docs/developer/code-visual-internals.md).
 */
import { cloneDeep } from '../clone'
import { decodeLiteral, encodeLiteral } from '../report/literal'
import { CODE_OBJECT, isCodeVisual } from './model'

export const CODE_FILES = { html: 'code.html', css: 'code.css', jsx: 'code.jsx' } as const
type Layer = keyof typeof CODE_FILES

const LAYERS: Layer[] = ['html', 'css', 'jsx']

/** visual.json as written to disk plus the code files (names relative to the visual's folder). */
export function externalizeCode(visualJson: any): { json: any; files: Record<string, string> } {
  if (!isCodeVisual(visualJson)) return { json: visualJson, files: {} }
  const props = visualJson?.visual?.objects?.[CODE_OBJECT]?.[0]?.properties
  if (!props) return { json: visualJson, files: {} }
  const json = cloneDeep(visualJson)
  const p = json.visual.objects[CODE_OBJECT][0].properties
  const files: Record<string, string> = {}
  const index: Record<string, string> = {}
  for (const k of LAYERS) {
    const raw = p[k]?.expr?.Literal?.Value
    if (raw === undefined) continue
    const text = decodeLiteral(raw)
    delete p[k]
    if (typeof text !== 'string' || !text) continue
    files[CODE_FILES[k]] = text
    index[k] = CODE_FILES[k]
  }
  if (Object.keys(index).length) p.files = { expr: { Literal: { Value: encodeLiteral(JSON.stringify(index)) } } }
  return { json, files }
}

const enc = new TextEncoder()
const dec = new TextDecoder()

/**
 * Put code files back into the code visuals of a report read from PBIR files. `extraFiles` holds every report file
 * the reader did not recognise (paths relative to the `.Report` folder); the code files used are removed from it.
 */
export function internalizeCode(
  pages: Array<{ name: string; visuals: Array<{ name: string; json: any }> }>,
  extraFiles: Record<string, Uint8Array | string>,
  diagnostics: string[]
): void {
  for (const page of pages) {
    for (const v of page.visuals) {
      if (!isCodeVisual(v.json)) continue
      const p = v.json?.visual?.objects?.[CODE_OBJECT]?.[0]?.properties
      const raw = p?.files?.expr?.Literal?.Value
      if (raw === undefined) continue
      let index: Record<string, unknown> = {}
      try {
        const parsed = JSON.parse(String(decodeLiteral(raw)))
        if (parsed && typeof parsed === 'object') index = parsed
      } catch {
        diagnostics.push(`Code visual ${v.name}: unreadable list of code files`)
      }
      delete p.files
      for (const k of LAYERS) {
        const file = index[k]
        if (typeof file !== 'string' || !/^[\w.-]+$/.test(file)) continue
        const path = `definition/pages/${page.name}/visuals/${v.name}/${file}`
        const content = extraFiles[path]
        if (content === undefined) {
          diagnostics.push(`Code visual ${v.name}: ${file} is missing`)
          continue
        }
        delete extraFiles[path]
        const text = typeof content === 'string' ? content : dec.decode(content)
        p[k] = { expr: { Literal: { Value: encodeLiteral(text) } } }
      }
    }
  }
}

/** UTF-8 bytes of a code file (helper for writers that want bytes). */
export function codeFileBytes(text: string): Uint8Array {
  return enc.encode(text)
}

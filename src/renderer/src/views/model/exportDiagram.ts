/**
 * Export of a model diagram layout as an image: `diagramSvg` builds a standalone SVG of what the view shows —
 * group containers (and collapsed chips), relationship lines with their markers, table cards with their fields —
 * and `exportDiagram` saves it as SVG, or rasterised (2×) as PNG.
 */
import type { GroupColor } from '@core/io/diagramSidecar'
import { toast } from '../../app/ui'
import { useApp } from '../../state/store'
import { bounds, type Rect } from './edges'
import { GROUP_PALETTE } from './groups'
import { HEADER_HEIGHT, ROW_HEIGHT } from './layout'
import type { EdgeDecor } from './routing'

export interface DiagramImageSpec {
  /** layout name (file name suggestion + title) */
  name: string
  /** `rows`: field names in display order, null = the separator before the measures */
  cards: Array<{ name: string; rect: Rect; collapsed: boolean; rows: Array<string | null> }>
  groups: Array<{ name: string; color: GroupColor; rect: Rect; collapsed: boolean; count: number }>
  edges: Array<{ d: string; inactive: boolean; from: string; to: string; decor: EdgeDecor; both: boolean; towardTo: boolean }>
}

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const n = (v: number): string => String(Math.round(v * 100) / 100)
/** Rough text clipping (the SVG has no layout engine): keep what fits the width at ~`charW` px per character. */
const clip = (s: string, width: number, charW: number): string => {
  const max = Math.max(1, Math.floor(width / charW))
  return s.length > max ? `${s.slice(0, Math.max(1, max - 1))}…` : s
}

const FONT = `'Segoe UI', 'Selawik', 'Open Sans', 'Noto Sans', system-ui, sans-serif`
const MARGIN = 32

/** Standalone SVG of the diagram. Returns the markup and its pixel size. */
export function diagramSvg(spec: DiagramImageSpec): { svg: string; width: number; height: number } {
  const all = bounds([...spec.cards.map((c) => c.rect), ...spec.groups.map((g) => g.rect)]) ?? { x: 0, y: 0, width: 200, height: 100 }
  const width = Math.ceil(all.width + MARGIN * 2)
  const height = Math.ceil(all.height + MARGIN * 2)
  const out: string[] = []
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${n(all.x - MARGIN)} ${n(all.y - MARGIN)} ${width} ${height}" font-family="${esc(FONT)}">`)
  out.push(`<rect x="${n(all.x - MARGIN)}" y="${n(all.y - MARGIN)}" width="${width}" height="${height}" fill="#f0f0f0"/>`)
  // containers sit behind lines and cards
  for (const g of spec.groups) {
    const c = GROUP_PALETTE[g.color]
    const r = g.rect
    out.push(`<rect x="${n(r.x)}" y="${n(r.y)}" width="${n(r.width)}" height="${n(r.height)}" rx="10" fill="${c.fill}" stroke="${c.border}"/>`)
    const label = g.collapsed ? `${g.name}  ·  ${g.count === 1 ? '1 table' : `${g.count} tables`}` : g.name
    out.push(`<text x="${n(r.x + 14)}" y="${n(r.y + (g.collapsed ? r.height / 2 : 17))}" dominant-baseline="central" font-size="13" font-weight="600" fill="${c.text}">${esc(clip(label, r.width - 28, 7.2))}</text>`)
  }
  for (const e of spec.edges) {
    out.push(`<path d="${e.d}" fill="none" stroke="#8a8886" stroke-width="1.5"${e.inactive ? ' stroke-dasharray="6 4"' : ''}/>`)
    for (const [p, text] of [
      [e.decor.l1, e.from],
      [e.decor.l2, e.to]
    ] as const)
      out.push(`<text x="${n(p.x)}" y="${n(p.y)}" text-anchor="middle" dominant-baseline="central" font-size="13" font-weight="600" fill="#605e5c">${esc(text)}</text>`)
    const angle = e.towardTo ? e.decor.mid.angle : e.decor.mid.angle + 180
    const arrow = e.both ? `<path d="M-11,-5 L-3,0 L-11,5 z"/><path d="M11,-5 L3,0 L11,5 z"/>` : `<path d="M-4,-5 L4,0 L-4,5 z"/>`
    out.push(`<g transform="translate(${n(e.decor.mid.x)},${n(e.decor.mid.y)}) rotate(${n(angle)})" fill="#8a8886">${arrow}</g>`)
  }
  spec.cards.forEach((c, i) => {
    const r = c.rect
    out.push(`<clipPath id="c${i}"><rect x="${n(r.x)}" y="${n(r.y)}" width="${n(r.width)}" height="${n(r.height)}" rx="4"/></clipPath>`)
    out.push(`<rect x="${n(r.x)}" y="${n(r.y)}" width="${n(r.width)}" height="${n(r.height)}" rx="4" fill="#ffffff" stroke="#c8c6c4"/>`)
    out.push(`<g clip-path="url(#c${i})">`)
    out.push(`<rect x="${n(r.x)}" y="${n(r.y)}" width="${n(r.width)}" height="4" fill="#e8e6e4"/>`)
    out.push(`<text x="${n(r.x + 12)}" y="${n(r.y + 4 + (HEADER_HEIGHT - 4) / 2)}" dominant-baseline="central" font-size="14" font-weight="600" fill="#252423">${esc(clip(c.name, r.width - 24, 7.6))}</text>`)
    if (!c.collapsed) {
      out.push(`<line x1="${n(r.x)}" y1="${n(r.y + HEADER_HEIGHT)}" x2="${n(r.x + r.width)}" y2="${n(r.y + HEADER_HEIGHT)}" stroke="#e1dfdd"/>`)
      let y = r.y + HEADER_HEIGHT + 2
      for (const row of c.rows) {
        if (y > r.y + r.height) break
        if (row === null) {
          out.push(`<line x1="${n(r.x + 10)}" y1="${n(y + 3.5)}" x2="${n(r.x + r.width - 10)}" y2="${n(y + 3.5)}" stroke="#edebe9"/>`)
          y += 7
          continue
        }
        out.push(`<text x="${n(r.x + 12)}" y="${n(y + ROW_HEIGHT / 2)}" dominant-baseline="central" font-size="12" fill="#252423">${esc(clip(row, r.width - 24, 6.4))}</text>`)
        y += ROW_HEIGHT
      }
    }
    out.push('</g>')
  })
  out.push('</svg>')
  return { svg: out.join(''), width, height }
}

/** Rasterise the SVG in the renderer (no external resources, so the canvas stays readable). */
async function svgToPng(svg: string, width: number, height: number): Promise<Uint8Array> {
  const scale = Math.max(0.25, Math.min(2, 8192 / Math.max(width, height)))
  const img = new Image()
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve()
    img.onerror = () => reject(new Error('The diagram could not be rendered.'))
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
  })
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(width * scale)
  canvas.height = Math.round(height * scale)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('No 2D canvas available.')
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('The diagram could not be encoded as PNG.')
  return new Uint8Array(await blob.arrayBuffer())
}

const safeName = (s: string): string => s.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'Model diagram'

/**
 * Ask where to save (PNG or SVG, by extension) and write the diagram image. `path` skips the dialog.
 * Returns the written path, or null when cancelled / failed (a toast explains failures).
 */
export async function exportDiagram(spec: DiagramImageSpec, path?: string): Promise<string | null> {
  if (!spec.cards.length && !spec.groups.length) {
    toast({ kind: 'warning', message: 'This layout has nothing to export.' })
    return null
  }
  try {
    const project = useApp.getState().project
    let target = path ?? null
    if (!target) {
      const baseDir = project?.source.path ? project.source.path.replace(/\/[^/]*\/?$/, '') : await window.wbi.app.getPath('documents').catch(() => '')
      target = await window.wbi.dialog.saveFile({
        title: 'Export diagram as image',
        defaultPath: `${baseDir}/${safeName(`${project?.name ?? 'Model'} - ${spec.name}`)}.png`,
        filters: [
          { name: 'PNG image', extensions: ['png'] },
          { name: 'SVG image', extensions: ['svg'] }
        ]
      })
    }
    if (!target) return null
    if (!/\.(png|svg)$/i.test(target)) target += '.png'
    const { svg, width, height } = diagramSvg(spec)
    if (/\.svg$/i.test(target)) await window.wbi.fs.writeFile(target, svg)
    else await window.wbi.fs.writeFile(target, await svgToPng(svg, width, height))
    toast({ kind: 'success', message: `Diagram exported to ${target}` })
    return target
  } catch (e) {
    toast({ kind: 'error', message: `Could not export the diagram: ${e instanceof Error ? e.message : String(e)}` })
    return null
  }
}

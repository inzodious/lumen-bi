import { useState } from 'react'
import type { VisualProps } from '../contract'
import { decodeLiteral } from '@core/report/literal'
import { useAction } from './useAction'

export interface ImageSource {
  /** resolved URL (data:, blob:, http(s):, file:) */
  url?: string
  name?: string
  scaling: 'Normal' | 'Fit' | 'Fill'
}

function lit(raw: any): any {
  if (raw?.expr?.Literal) return decodeLiteral(raw.expr.Literal.Value)
  if (raw?.Literal) return decodeLiteral(raw.Literal.Value)
  return undefined
}

function normScaling(v: unknown): ImageSource['scaling'] {
  const s = String(v ?? '').toLowerCase()
  return s === 'fit' ? 'Fit' : s === 'fill' ? 'Fill' : 'Normal'
}

/**
 * Image source from PBIR: `objects.image[0].properties.sourceFile.image = { name, url: { expr: ResourcePackageItem }, scaling }`
 * (current format), `sourceType`/`sourceUrl` (URL images), or legacy `general.imageUrl` + `imageScaling.imageScalingType`.
 */
export function readImageSource(visualJson: any, resolve: (ref: any) => string | undefined): ImageSource {
  const objects = visualJson?.visual?.objects ?? {}
  const imgProps = objects.image?.[0]?.properties ?? {}
  const legacyScaling = lit(objects.imageScaling?.[0]?.properties?.imageScalingType)
  const sf = imgProps.sourceFile?.image
  if (sf) {
    const rpi = sf.url?.expr?.ResourcePackageItem
    const url = rpi ? resolve({ resource: rpi.ItemName, package: rpi.PackageName, packageType: rpi.PackageType }) : (lit(sf.url) as string | undefined)
    return { url, name: lit(sf.name), scaling: normScaling(lit(sf.scaling) ?? legacyScaling) }
  }
  const srcUrl = lit(imgProps.sourceUrl) ?? lit(imgProps.imageUrl)
  if (typeof srcUrl === 'string' && srcUrl) return { url: srcUrl, scaling: normScaling(lit(imgProps.scaling) ?? legacyScaling) }
  const gen = objects.general?.[0]?.properties ?? {}
  const imageUrl = gen.imageUrl
  if (imageUrl) {
    const rpi = imageUrl.expr?.ResourcePackageItem
    const v = rpi ? resolve({ resource: rpi.ItemName, package: rpi.PackageName, packageType: rpi.PackageType }) : lit(imageUrl)
    if (typeof v === 'string') {
      // legacy reports store a bare resource name in imageUrl
      const url = /^(data:|blob:|https?:|file:)/i.test(v) ? v : resolve(v) ?? v
      return { url, scaling: normScaling(legacyScaling) }
    }
  }
  return { scaling: normScaling(legacyScaling) }
}

/** CSS object-fit for PBI scaling: Normal keeps aspect inside the box, Fit stretches, Fill covers (crops). */
export function objectFit(scaling: ImageSource['scaling']): 'contain' | 'fill' | 'cover' {
  return scaling === 'Fit' ? 'fill' : scaling === 'Fill' ? 'cover' : 'contain'
}

export function ImageVisual({ visual, width, height, ctx }: VisualProps) {
  const src = readImageSource(visual.json, (ref) => ctx.report.resolveImage(ref))
  const action = useAction(visual.json, ctx)
  const [failed, setFailed] = useState<string | undefined>()
  const broken = !src.url || failed === src.url
  return (
    <div
      style={{ width, height, overflow: 'hidden', cursor: action.interactive ? 'pointer' : undefined, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={action.onClick}
      title={action.interactive ? action.title : undefined}
    >
      {broken ? (
        <div style={{ color: '#A19F9D', fontSize: 11, textAlign: 'center', padding: 4 }}>
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#A19F9D" strokeWidth="1.3">
            <rect x="3" y="4" width="18" height="16" rx="1.5" />
            <circle cx="9" cy="10" r="1.8" />
            <path d="M3.5 18l5.5-5.5 4 4 3-3 4.5 4.5" />
          </svg>
          {src.name && <div style={{ marginTop: 4, maxWidth: width - 8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{src.name}</div>}
        </div>
      ) : (
        <img
          src={src.url}
          alt={src.name ?? ''}
          draggable={false}
          onError={() => setFailed(src.url)}
          style={{ width: '100%', height: '100%', objectFit: objectFit(src.scaling), display: 'block', userSelect: 'none' }}
        />
      )}
    </div>
  )
}

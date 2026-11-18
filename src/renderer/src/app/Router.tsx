/**
 * Tiny hash router (no dependency):
 *   #/            the app shell (query options for headless captures, see App.tsx `applyRouteOptions`)
 *   #/gallery     visuals gallery (charts workstream; lazy, placeholder when missing)
 *   #/canvas-test report canvas test harness (canvas workstream; lazy — keeps its mock engine out of the main bundle)
 *   #/modeling-test  modeling views harness (?view=data|model|dax&field=…&dialog=…&query=…&run=1)
 *   #/print       export layout (PDF / image capture); the store survives because only the hash changes
 */
import { lazy, Suspense, useEffect, useState, type ComponentType } from 'react'
import { App } from './App'
import { PrintLayout } from '../export/PrintLayout'

export function parseHash(hash: string): { path: string; params: URLSearchParams } {
  const h = hash.replace(/^#/, '')
  const [path, query = ''] = h.split('?')
  return { path: path || '/', params: new URLSearchParams(query) }
}

export function useHashRoute(): { path: string; params: URLSearchParams } {
  const [hash, setHash] = useState(() => window.location.hash)
  useEffect(() => {
    const on = () => setHash(window.location.hash)
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  return parseHash(hash)
}

type LazyModule = Record<string, unknown>
const galleryModules = import.meta.glob<LazyModule>('../visuals/gallery/Gallery.tsx')
const canvasTestModules = import.meta.glob<LazyModule>('../report/dev/CanvasTest.tsx')
const modelingTestModules = import.meta.glob<LazyModule>('../views/dev/ModelingDev.tsx')

function lazyFrom(mods: Record<string, () => Promise<LazyModule>>, exportName: string, missing: string): ComponentType {
  const load = Object.values(mods)[0]
  if (!load) return () => <Placeholder text={missing} />
  return lazy(async () => {
    const m = await load()
    const C = (m[exportName] ?? m.default) as ComponentType | undefined
    return { default: C ?? (() => <Placeholder text={missing} />) }
  })
}

const Gallery = lazyFrom(galleryModules, 'Gallery', 'The visuals gallery is not available in this build.')
const CanvasTest = lazyFrom(canvasTestModules, 'CanvasTest', 'The canvas test harness is not available in this build.')
const ModelingDev = lazyFrom(modelingTestModules, 'ModelingDev', 'The modeling test harness is not available in this build.')

function Placeholder({ text }: { text: string }) {
  useEffect(() => {
    document.body.dataset.wbiReady = '1'
  }, [])
  return <div style={{ display: 'grid', placeItems: 'center', height: '100%', color: 'var(--wbi-fg-3)', fontSize: 14 }}>{text}</div>
}

function Scrollable({ children }: { children: React.ReactNode }) {
  return <div style={{ height: '100%', overflow: 'auto', background: '#fff', userSelect: 'text' }}>{children}</div>
}

export function Root() {
  const { path } = useHashRoute()
  if (path === '/gallery')
    return (
      <Scrollable>
        <Suspense fallback={null}>
          <Gallery />
        </Suspense>
      </Scrollable>
    )
  if (path === '/canvas-test')
    return (
      <Suspense fallback={null}>
        <CanvasTest />
      </Suspense>
    )
  if (path === '/modeling-test')
    return (
      <Suspense fallback={null}>
        <ModelingDev />
      </Suspense>
    )
  if (path === '/print') return <PrintLayout />
  return <App />
}

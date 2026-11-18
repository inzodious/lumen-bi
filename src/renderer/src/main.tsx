import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import initSqlJs from 'sql.js'
import wasmUrl from 'sql.js/dist/sql-wasm-browser.wasm?url'
import { setSqlJsFactory } from '@core/io/pbix/datamodel'
import './assets/fonts/selawik/selawik.css'
import '@fontsource/open-sans/400.css'
import '@fontsource/open-sans/600.css'
import '@fontsource/open-sans/700.css'
import './styles/global.css'
import './app/ui/ui.css'
import './app/shell.css'
import './panes/panes.css'
import { Root } from './app/Router'
import { maybeStartSweep } from './app/sweep/sweep'
// register the Table/Column/Measure tools contextual ribbon tabs at startup (not only when a modeling view loads)
import './dialogs/modeling/ribbonTabs'
// icons: theme-change re-bakes and set preloading (docs/ICONS.md)
import './icons/actions'

// PBIX DataModel decoding reads metadata.sqlitedb with sql.js; point it at the bundled wasm.
setSqlJsFactory(() => initSqlJs({ locateFile: () => wasmUrl }))

/**
 * Load the Segoe UI–metric fonts (Selawik aliases) before the first render so visuals measure text with the right
 * metrics (font-display: block). Bounded wait: never block startup for more than ~1.5 s.
 */
function fontsReady(): Promise<unknown> {
  if (typeof document === 'undefined' || !document.fonts) return Promise.resolve()
  const loads = ['300', '400', '600', '700'].map((w) => document.fonts.load(`${w} 12px "Segoe UI"`).catch(() => undefined))
  loads.push(document.fonts.load('12px "Segoe UI Semibold"').catch(() => undefined), document.fonts.load('12px "Selawik"').catch(() => undefined))
  return Promise.race([Promise.all(loads).then(() => document.fonts.ready), new Promise((r) => setTimeout(r, 1500))])
}

void fontsReady().then(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <Root />
    </StrictMode>
  )
  // `#/?sweep=<outdir>&open=<path>`: headless render sweep (scripts/sweep.sh)
  maybeStartSweep()
})

/** Entry of the published-dashboard viewer (src/renderer/viewer/index.html; built by viewer.vite.config.ts into out/viewer). */
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../assets/fonts/selawik/selawik.css'
import '@fontsource/open-sans/400.css'
import '@fontsource/open-sans/600.css'
import '@fontsource/open-sans/700.css'
import '@fontsource/barlow/400.css'
import '@fontsource/barlow/600.css'
import '@fontsource/barlow/700.css'
import '@fontsource/barlow/800.css'
import '@fontsource/barlow/900.css'
import '@fontsource/barlow/800-italic.css'
import '@fontsource/barlow/900-italic.css'
import '@fontsource/roboto-condensed/400.css'
import '@fontsource/roboto-condensed/700.css'
import '../styles/global.css'
import '../app/ui/ui.css'
import './viewer.css'
import { installBrowserHost } from './browserHost'
import { Viewer } from './Viewer'

installBrowserHost()

function fontsReady(): Promise<unknown> {
  if (!document.fonts) return Promise.resolve()
  const loads = ['400', '600', '700'].map((w) => document.fonts.load(`${w} 12px "Segoe UI"`).catch(() => undefined))
  return Promise.race([Promise.all(loads).then(() => document.fonts.ready), new Promise((r) => setTimeout(r, 1500))])
}

void fontsReady().then(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <Viewer />
    </StrictMode>
  )
})

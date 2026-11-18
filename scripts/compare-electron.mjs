// Electron helper for scripts/compare.mjs (no image library is installed; Electron can decode and print):
//   electron scripts/compare-electron.mjs decode <in.jpg|png|…> <out.png>   any image Chromium decodes → PNG
//   electron scripts/compare-electron.mjs pdf <in.png> <out.pdf>             one PDF page of the image's size
//                                                                            (96 px = 1 in), no margins — a
//                                                                            stand-in for Power BI's Export to PDF
import { app, nativeImage, BrowserWindow } from 'electron'
import { readFileSync, writeFileSync } from 'node:fs'

app.disableHardwareAcceleration()
const [mode, input, output] = process.argv.slice(2).filter((a) => !a.startsWith('--'))

async function main() {
  await app.whenReady()
  const img = nativeImage.createFromPath(input)
  if (img.isEmpty()) throw new Error(`cannot decode ${input}`)
  if (mode === 'decode') {
    writeFileSync(output, img.toPNG())
    return
  }
  if (mode === 'pdf') {
    const { width, height } = img.getSize()
    const win = new BrowserWindow({ show: false, width, height, webPreferences: { offscreen: true } })
    const src = `data:image/png;base64,${readFileSync(input).toString('base64')}`
    const html = `<!doctype html><style>@page{size:${width}px ${height}px;margin:0}html,body{margin:0}img{display:block;width:${width}px;height:${height}px}</style><img src="${src}">`
    await win.loadURL(`data:text/html;base64,${Buffer.from(html).toString('base64')}`)
    const pdf = await win.webContents.printToPDF({ printBackground: true, preferCSSPageSize: true, margins: { marginType: 'none' } })
    writeFileSync(output, pdf)
    return
  }
  throw new Error(`unknown mode ${mode}`)
}

main().then(
  () => app.exit(0),
  (e) => {
    console.error(e instanceof Error ? e.message : String(e))
    app.exit(1)
  }
)

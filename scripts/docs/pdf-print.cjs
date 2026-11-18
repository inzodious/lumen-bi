/*
 * Electron entry used by scripts/docs/build-pdf.mjs: prints HTML files to PDF with Chromium's printToPDF.
 *
 *   electron scripts/docs/pdf-print.cjs <jobs.json>
 *   jobs.json: [{ "html": "/abs/in.html", "pdf": "/abs/out.pdf", "footer": "Section title" }, ...]
 *
 * A4, footer with the edition title and "page n of m", PDF outline (bookmarks) from the headings, tagged PDF.
 * Run with ELECTRON_RUN_AS_NODE unset and a display (build-pdf.mjs uses xvfb-run when available).
 */
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')

const jobsPath = process.argv.find((a) => a.endsWith('.json'))
if (!jobsPath) {
  console.error('usage: electron pdf-print.cjs <jobs.json>')
  process.exit(2)
}
const jobs = JSON.parse(fs.readFileSync(jobsPath, 'utf8'))

app.disableHardwareAcceleration()
// the jobs open and close windows one after another: do not quit when the last one closes
app.on('window-all-closed', () => {})
app.commandLine.appendSwitch('disable-gpu')

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
}

function footer(title) {
  return `<div style="width:100%;font-family:Selawik,'Segoe UI','Noto Sans','DejaVu Sans',sans-serif;font-size:7.5pt;color:#605e5c;padding:0 16mm;display:flex;justify-content:space-between;">
    <span>${esc(title)}</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`
}

async function printOne(job) {
  const win = new BrowserWindow({ show: false, width: 1000, height: 1400, webPreferences: { offscreen: false, javascript: true } })
  await win.loadFile(job.html)
  // wait for web fonts and images
  await win.webContents.executeJavaScript(`(async () => {
    await document.fonts.ready;
    await Promise.all(Array.from(document.images).map((i) => i.complete ? null : new Promise((r) => { i.onload = i.onerror = r })));
    return Array.from(document.images).filter((i) => !i.naturalWidth).map((i) => i.getAttribute('src'));
  })()`).then((broken) => {
    for (const b of broken) console.warn(`  image not loaded: ${b}`)
  })
  const data = await win.webContents.printToPDF({
    pageSize: 'A4',
    printBackground: true,
    preferCSSPageSize: false,
    displayHeaderFooter: true,
    headerTemplate: '<span></span>',
    footerTemplate: footer(job.footer),
    margins: { top: 0.7, bottom: 0.75, left: 0.72, right: 0.72 },
    generateTaggedPDF: true,
    generateDocumentOutline: true
  })
  fs.writeFileSync(job.pdf, data)
  win.destroy()
}

app.whenReady().then(async () => {
  let failed = 0
  for (const job of jobs) {
    try {
      await printOne(job)
      console.log(`  printed ${job.pdf}`)
    } catch (e) {
      failed++
      console.error(`  failed ${job.pdf}: ${e && e.message ? e.message : e}`)
    }
  }
  app.exit(failed ? 1 : 0)
})

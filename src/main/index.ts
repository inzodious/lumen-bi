import { app, BrowserWindow, dialog, ipcMain, shell, nativeTheme } from 'electron'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promises as fsp } from 'node:fs'
import { tmpdir } from 'node:os'
import { registerFsIpc } from './ipc/fs'
import { registerConnectorIpc } from './ipc/connectors'
import { buildMenu } from './menu'
import { blockCacheArgs } from '../shared/cacheGuard'
import { guardFrameNavigation, handleCodeFrameScheme, registerCodeFrameScheme } from './codeFrame'

const here = dirname(fileURLToPath(import.meta.url))
const isDev = !!process.env['ELECTRON_RENDERER_URL']
let mainWindow: BrowserWindow | null = null
let allowClose = false

/**
 * Headless capture mode (for development / automated visual checks):
 *   WBI_CAPTURE=/abs/out.png [WBI_ROUTE='#/gallery'] [WBI_OPEN=/path/to/report] [WBI_SIZE=1600x1000] [WBI_TIMEOUT=60000]
 * Loads the renderer (hidden), waits until `document.body.dataset.wbiReady === '1'` (or timeout),
 * writes the PNG plus `<out>.log` (renderer console + errors), then quits.
 */
const capturePath = process.env['WBI_CAPTURE']
// Captures start from a clean profile (default pane layout, canvas prefs, no recents) so one capture's route options
// (e.g. `panes=…`) don't leak into the next through localStorage. WBI_CAPTURE_PROFILE=keep reuses the real profile.
if (capturePath && process.env['WBI_CAPTURE_PROFILE'] !== 'keep') {
  app.setPath('userData', join(tmpdir(), `lumen-capture-${process.pid}`))
  app.on('quit', () => void fsp.rm(app.getPath('userData'), { recursive: true, force: true }).catch(() => undefined))
}
const captureLog: string[] = []

/**
 * End-to-end test mode (`LUMEN_E2E=1`, set by e2e/harness.ts): a throwaway profile (`LUMEN_USER_DATA` or a temp dir, so
 * recents / pane layout / options never leak between runs or from the user's real profile), the window is shown
 * inactive (never steals focus) and keeps painting while unfocused, and closing never prompts (the harness owns the
 * process lifetime).
 */
const e2eMode = !capturePath && process.env['LUMEN_E2E'] === '1'
if (e2eMode) {
  const dir = process.env['LUMEN_USER_DATA'] || join(tmpdir(), `lumen-e2e-${process.pid}`)
  app.setPath('userData', dir)
  if (!process.env['LUMEN_USER_DATA']) app.on('quit', () => void fsp.rm(dir, { recursive: true, force: true }).catch(() => undefined))
}

function recentFile(): string {
  return join(app.getPath('userData'), 'recent.json')
}

async function readRecent(): Promise<Array<{ path: string; name: string; openedAt: number }>> {
  try {
    return JSON.parse(await fsp.readFile(recentFile(), 'utf8'))
  } catch {
    return []
  }
}

function launchFiles(): string[] {
  const args = process.argv.slice(isDev ? 2 : 1)
  return args.filter((a) => !a.startsWith('-') && /\.(pbix|pbit|pbip|wbi)$|\.Report\/?$|\.SemanticModel\/?$/i.test(a))
}

function createWindow(): void {
  nativeTheme.themeSource = 'light'
  const [cw, ch] = (process.env['WBI_SIZE'] ?? '1600x1000').split('x').map(Number)
  mainWindow = new BrowserWindow({
    width: capturePath || sweepMode || e2eMode ? cw : 1600,
    height: capturePath || sweepMode || e2eMode ? ch : 980,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#F3F2F1',
    title: 'Lumen',
    icon: join(here, '../../resources/icon.png'),
    webPreferences: {
      preload: join(here, '../preload/index.cjs'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      // WBI_BLOCK_CACHE=1: the preload sets __LUMEN_BLOCK_CACHE_ABF__ so PBIP .pbi/cache.abf is never decoded
      additionalArguments: blockCacheArgs(process.env),
      // capture / sweep: keep rendering/painting while hidden (else capturePage returns a stale frame)
      ...(capturePath || sweepMode || e2eMode ? { backgroundThrottling: false } : {})
    }
  })
  mainWindow.on('ready-to-show', () => {
    if (e2eMode) mainWindow?.showInactive()
    else if (!capturePath && !sweepMode) mainWindow?.show()
  })
  if (e2eMode) allowClose = true
  mainWindow.on('maximize', () => mainWindow?.webContents.send('win:maximized', true))
  mainWindow.on('unmaximize', () => mainWindow?.webContents.send('win:maximized', false))
  mainWindow.on('close', (e) => {
    if (allowClose) return
    e.preventDefault()
    mainWindow?.webContents.send('win:closeRequested')
  })
  // developer shortcuts (no visible menu in the frameless window)
  mainWindow.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return
    const ctrl = input.control || input.meta
    if (input.key === 'F12' || (ctrl && input.shift && input.key.toLowerCase() === 'i')) {
      mainWindow?.webContents.toggleDevTools()
      e.preventDefault()
    } else if (isDev && ctrl && !input.shift && input.key.toLowerCase() === 'r') {
      mainWindow?.webContents.reload()
      e.preventDefault()
    }
  })
  guardFrameNavigation(mainWindow.webContents)
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })
  const route = process.env['WBI_ROUTE'] ?? ''
  if (isDev) mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']! + route)
  else mainWindow.loadFile(join(here, '../renderer/index.html'), route ? { hash: route.replace(/^#/, '') } : undefined)
  buildMenu(mainWindow)
  if (capturePath) runCapture(mainWindow, capturePath)
  else if (sweepMode) runSweepHost(mainWindow)
}

/**
 * Headless modes running on a private Xvfb display (capture.sh / sweep.sh set `<envVar>=1`): show the window there
 * without focusing it. A never-shown window stops producing frames after the first few, so capturePage would return a
 * stale frame (e.g. an earlier layout or the open progress overlay).
 */
function showOnPrivateDisplay(win: BrowserWindow, envVar: string): void {
  if (process.env[envVar]) win.once('ready-to-show', () => win.showInactive())
}

function runCapture(win: BrowserWindow, out: string): void {
  allowClose = true
  showOnPrivateDisplay(win, 'WBI_CAPTURE_SHOW')
  win.webContents.on('console-message', (e: any) => captureLog.push(`[${e.level ?? ''}] ${e.message ?? ''}`))
  win.webContents.on('render-process-gone', (_e, d) => captureLog.push(`[crash] ${d.reason}`))
  win.webContents.once('did-finish-load', async () => {
    const deadline = Date.now() + Number(process.env['WBI_TIMEOUT'] ?? 60000)
    let ready = false
    let stable = 0
    while (Date.now() < deadline) {
      // wbiBusy: the renderer is opening a project or doing scripted work (e.g. `#/?export=pdf&exportPath=…` self-tests).
      // Require the condition on two consecutive polls so a transient state between two operations doesn't trigger.
      const ok = await win.webContents.executeJavaScript("document.body.dataset.wbiReady === '1' && document.body.dataset.wbiBusy !== '1'").catch(() => false)
      stable = ok ? stable + 1 : 0
      if (stable >= 2) {
        ready = true
        break
      }
      await new Promise((r) => setTimeout(r, 250))
    }
    await new Promise((r) => setTimeout(r, 600))
    if (!ready) captureLog.push('[capture] timed out waiting for document.body.dataset.wbiReady')
    const img = await win.webContents.capturePage()
    await fsp.writeFile(out, img.toPNG())
    await fsp.writeFile(out + '.log', captureLog.join('\n'))
    app.exit(0)
  })
}

/**
 * Sweep mode (scripts/sweep.sh, `WBI_SWEEP=1` + `WBI_ROUTE='#/?sweep=…'`): the renderer drives itself
 * (opens the project, renders every page, writes PNG + JSON) and closes the window when done. Main only
 * forwards the renderer console to `WBI_SWEEP_LOG` and enforces an overall timeout (`WBI_TIMEOUT`, ms).
 */
const sweepMode = !capturePath && !!process.env['WBI_SWEEP']

function runSweepHost(win: BrowserWindow): void {
  allowClose = true
  // A hidden window stops producing frames, so capturePage would return a stale image. scripts/sweep.sh runs on a
  // private Xvfb display and sets WBI_SWEEP_SHOW=1: show the window there (never focused, nothing on the desktop).
  showOnPrivateDisplay(win, 'WBI_SWEEP_SHOW')
  const logPath = process.env['WBI_SWEEP_LOG']
  const lines: string[] = []
  const flush = () => (logPath ? fsp.writeFile(logPath, lines.join('\n')).catch(() => undefined) : Promise.resolve())
  win.webContents.on('console-message', (e: any) => lines.push(`[${e.level ?? ''}] ${e.message ?? ''}`))
  win.webContents.on('render-process-gone', (_e, d) => {
    lines.push(`[crash] ${d.reason}`)
    void flush().then(() => app.exit(2))
  })
  win.on('closed', () => void flush().then(() => app.exit(0)))
  setTimeout(() => {
    lines.push('[sweep] overall timeout')
    void flush().then(() => app.exit(3))
  }, Number(process.env['WBI_TIMEOUT'] ?? 900000))
}

function registerAppIpc(): void {
  ipcMain.handle('dialog:openFile', async (_e, opts: any = {}) => {
    const r = await dialog.showOpenDialog(mainWindow!, { title: opts.title, defaultPath: opts.defaultPath, filters: opts.filters, properties: ['openFile', ...(opts.multi ? (['multiSelections'] as const) : [])] })
    return r.canceled ? null : r.filePaths
  })
  ipcMain.handle('dialog:openDirectory', async (_e, opts: any = {}) => {
    const r = await dialog.showOpenDialog(mainWindow!, { title: opts.title, defaultPath: opts.defaultPath, properties: ['openDirectory'] })
    return r.canceled ? null : r.filePaths[0]
  })
  ipcMain.handle('dialog:saveFile', async (_e, opts: any = {}) => {
    const r = await dialog.showSaveDialog(mainWindow!, { title: opts.title, defaultPath: opts.defaultPath, filters: opts.filters })
    return r.canceled ? null : r.filePath
  })
  ipcMain.handle('dialog:message', async (_e, opts: any) => {
    const r = await dialog.showMessageBox(mainWindow!, { type: opts.type ?? 'info', title: opts.title, message: opts.message, detail: opts.detail, buttons: opts.buttons ?? ['OK'] })
    return r.response
  })
  ipcMain.handle('app:getPath', (_e, name: any) => app.getPath(name))
  ipcMain.handle('app:getRecent', () => readRecent())
  ipcMain.handle('app:addRecent', async (_e, path: string, name: string) => {
    const list = (await readRecent()).filter((r) => r.path !== path)
    list.unshift({ path, name, openedAt: Date.now() })
    await fsp.mkdir(app.getPath('userData'), { recursive: true })
    await fsp.writeFile(recentFile(), JSON.stringify(list.slice(0, 20), null, 2))
  })
  ipcMain.handle('app:openExternal', (_e, url: string) => shell.openExternal(url))
  ipcMain.handle('app:showItemInFolder', (_e, p: string) => shell.showItemInFolder(p))
  ipcMain.handle('app:setTitle', (_e, t: string) => mainWindow?.setTitle(t))
  ipcMain.handle('app:getLaunchFiles', () => (process.env['WBI_OPEN'] ? [process.env['WBI_OPEN']] : launchFiles()))
  ipcMain.handle('win:minimize', () => mainWindow?.minimize())
  ipcMain.handle('win:toggleMaximize', () => (mainWindow?.isMaximized() ? mainWindow.unmaximize() : mainWindow?.maximize()))
  ipcMain.handle('win:close', () => mainWindow?.close())
  ipcMain.handle('win:isMaximized', () => mainWindow?.isMaximized() ?? false)
  ipcMain.handle('win:confirmClose', (_e, allow: boolean) => {
    if (allow) {
      allowClose = true
      mainWindow?.close()
    }
  })
  ipcMain.handle('export:printToPDF', async (_e, opts: any) => {
    const data = await mainWindow!.webContents.printToPDF({
      printBackground: opts.printBackground ?? true,
      landscape: opts.landscape ?? false,
      preferCSSPageSize: opts.preferCSSPageSize ?? true,
      pageSize: { width: opts.width, height: opts.height },
      margins: { top: 0, bottom: 0, left: 0, right: 0 }
    })
    return new Uint8Array(data)
  })
  ipcMain.handle('export:capturePng', async (_e, rect?: any) => {
    const img = await mainWindow!.webContents.capturePage(rect)
    return new Uint8Array(img.toPNG())
  })
}

// code visuals: the sandboxed frames' scheme must be registered before the app is ready
registerCodeFrameScheme()

app.whenReady().then(() => {
  app.setName('Lumen')
  handleCodeFrameScheme(join(here, '../renderer'))
  registerFsIpc()
  registerConnectorIpc()
  registerAppIpc()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

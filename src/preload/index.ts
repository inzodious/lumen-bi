import { contextBridge, ipcRenderer } from 'electron'
import type { WbiHost } from '../shared/host'
import { BLOCK_CACHE_GLOBAL, blockCacheFromArgv } from '../shared/cacheGuard'

const invoke = (ch: string, ...args: unknown[]) => ipcRenderer.invoke(ch, ...args)

function on<T extends unknown[]>(channel: string, cb: (...args: T) => void): () => void {
  const listener = (_e: unknown, ...args: unknown[]) => cb(...(args as T))
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const host: WbiHost = {
  fs: {
    readFile: (p) => invoke('fs:readFile', p),
    readText: (p) => invoke('fs:readText', p),
    writeFile: (p, d) => invoke('fs:writeFile', p, d),
    list: (p) => invoke('fs:list', p),
    exists: (p) => invoke('fs:exists', p),
    stat: (p) => invoke('fs:stat', p),
    mkdirp: (p) => invoke('fs:mkdirp', p),
    remove: (p) => invoke('fs:remove', p)
  },
  dialog: {
    openFile: (o) => invoke('dialog:openFile', o),
    openDirectory: (o) => invoke('dialog:openDirectory', o),
    saveFile: (o) => invoke('dialog:saveFile', o),
    message: (o) => invoke('dialog:message', o)
  },
  app: {
    platform: process.platform,
    version: process.env['npm_package_version'] ?? '0.1.0',
    getPath: (n) => invoke('app:getPath', n),
    getRecent: () => invoke('app:getRecent'),
    addRecent: (p, n) => invoke('app:addRecent', p, n),
    openExternal: (u) => invoke('app:openExternal', u),
    showItemInFolder: (p) => invoke('app:showItemInFolder', p),
    setTitle: (t) => invoke('app:setTitle', t),
    getLaunchFiles: () => invoke('app:getLaunchFiles')
  },
  window: {
    minimize: () => invoke('win:minimize'),
    toggleMaximize: () => invoke('win:toggleMaximize'),
    close: () => invoke('win:close'),
    isMaximized: () => invoke('win:isMaximized'),
    onMaximizeChange: (cb) => on('win:maximized', cb),
    onMenuCommand: (cb) => on('menu:command', cb),
    onCloseRequested: (cb) => on('win:closeRequested', cb),
    confirmClose: (allow) => invoke('win:confirmClose', allow)
  },
  connectors: {
    sqlQuery: (r) => invoke('conn:sqlQuery', r),
    sqlListItems: (r) => invoke('conn:sqlListItems', r),
    http: (r) => invoke('conn:http', r),
    onAuthPrompt: (cb) => on('conn:authPrompt', cb),
    clearCredentials: (t) => invoke('conn:clearCredentials', t),
    cancel: (id) => invoke('conn:cancel', id),
    request: (r) => invoke('conn:request', r),
    credentials: {
      status: () => invoke('cred:status'),
      list: () => invoke('cred:list'),
      set: (i) => invoke('cred:set', i),
      clear: (k) => invoke('cred:clear', k),
      signIn: (k) => invoke('cred:signIn', k),
      test: (r) => invoke('cred:test', r)
    },
    shares: {
      list: () => invoke('shares:list'),
      mount: (r) => invoke('shares:mount', r),
      resolve: (p) => invoke('shares:resolve', p)
    }
  },
  exporter: {
    printToPDF: (o) => invoke('export:printToPDF', o),
    capturePng: (r) => invoke('export:capturePng', r)
  }
}

contextBridge.exposeInMainWorld('wbi', host)
// WBI_BLOCK_CACHE=1 (main passes --wbi-block-cache): never decode PBIP .pbi/cache.abf (see src/core/io/open.ts).
// Exposed before any page script runs; the exposed property is read-only in the page.
if (blockCacheFromArgv(process.argv)) contextBridge.exposeInMainWorld(BLOCK_CACHE_GLOBAL, true)

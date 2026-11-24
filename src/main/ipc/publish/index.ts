/**
 * Publish IPC: write a published dashboard to a folder or a zip (./site.ts), or upload it to a saved destination
 * (./destinations.ts, ./targets/*). Upload progress goes to the requesting window as `publish:progress`.
 */
import { app, ipcMain, shell } from 'electron'
import { promises as fsp, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { PublishDeployRequest, PublishDestinationInput, PublishFilesRequest, PublishResult } from '../../../shared/host'
import { safeStorageCipher } from '../connectors'
import { DestinationStore } from './destinations'
import { assembleSite, siteBytes, writeSiteFolder, zipSite } from './site'
import { PublishError, TARGETS, slugify, type DeployContext } from './targets'
import { lumenServer } from './targets/lumenServer'
import { connectLumenServer } from './lumenConnect'
import { withPreviews } from './preview'

let store: DestinationStore | null = null

/** Created on first use (safeStorage needs the app to be ready). */
function destinations(): DestinationStore {
  store ??= new DestinationStore(join(app.getPath('userData'), 'publish-destinations.json'), safeStorageCipher())
  return store
}

function context(send: (p: unknown) => void): DeployContext {
  return { fetch: (u, i) => fetch(u, i), progress: (p) => send(p), sleep: (ms) => new Promise((r) => setTimeout(r, ms)) }
}

/** out/viewer next to out/main (dev, preview and the packaged app's asar). */
export function viewerDir(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '..', 'viewer')
}

function viewerMissing(): PublishResult {
  return { ok: false, reason: 'no-viewer', message: 'The dashboard viewer is not built. Run "npm run build" and try again.' }
}

function failure(e: unknown): PublishResult {
  const code = (e as { code?: string })?.code
  return { ok: false, reason: code === 'not-empty' ? 'not-empty' : 'failed', message: e instanceof Error ? e.message : String(e) }
}

export function registerPublishIpc(): void {
  ipcMain.handle('publish:status', () => ({ viewer: existsSync(join(viewerDir(), 'index.html')) }))
  ipcMain.handle('publish:folder', async (_e, req: PublishFilesRequest & { replace?: boolean }): Promise<PublishResult> => {
    if (!existsSync(join(viewerDir(), 'index.html'))) return viewerMissing()
    try {
      const files = await assembleSite(viewerDir(), req.files)
      await writeSiteFolder(req.path, files, { replace: req.replace })
      return { ok: true, location: req.path, files: Object.keys(files).length, bytes: siteBytes(files) }
    } catch (e) {
      return failure(e)
    }
  })
  ipcMain.handle('publish:lumen:connect', async (_e, url: string) => {
    try {
      return { ok: true, ...(await connectLumenServer(url, (u) => shell.openExternal(u))) }
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) }
    }
  })
  ipcMain.handle('publish:dest:list', () => destinations().list())
  ipcMain.handle('publish:dest:set', (_e, input: PublishDestinationInput) => destinations().set(input))
  ipcMain.handle('publish:dest:remove', (_e, id: string) => destinations().remove(id))
  ipcMain.handle('publish:dest:test', async (e, id: string, site?: string) => {
    const dest = destinations().get(id)
    const target = dest && TARGETS[dest.kind]
    if (!dest || !target) return { ok: false, message: 'This destination no longer exists.' }
    try {
      return { ok: true, message: await target.test(dest, site ? slugify(site) : undefined, context((p) => e.sender.send('publish:progress', p))) }
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) }
    }
  })
  ipcMain.handle('publish:deploy', async (e, req: PublishDeployRequest): Promise<PublishResult> => {
    if (!existsSync(join(viewerDir(), 'index.html'))) return viewerMissing()
    const dest = destinations().get(req.destinationId)
    const target = dest && TARGETS[dest.kind]
    if (!dest || !target) return { ok: false, reason: 'failed', message: 'This destination no longer exists.' }
    try {
      const files = await assembleSite(viewerDir(), req.files)
      const site = dest.kind === 'github-pages' || dest.kind === 's3' ? req.site.split('/').map((s) => (s ? slugify(s) : '')).filter(Boolean).join('/') : slugify(req.site)
      const ctx = context((p) => e.sender.send('publish:progress', p))
      let out: { url: string }
      if (dest.kind === 'lumen-server') {
        // page previews for the server's home page (best effort; see ./preview.ts)
        ctx.progress({ message: 'Making page previews', fraction: 0.05 })
        const withPics = await withPreviews(files, (f) => ctx.progress({ message: 'Making page previews', fraction: 0.05 + f * 0.2 }))
        out = await lumenServer.deployWithAccess(dest, site, withPics, req.title, ctx, req.access)
      } else out = await target.deploy(dest, site, files, req.title, ctx)
      return { ok: true, location: dest.name, url: out.url, files: Object.keys(files).length, bytes: siteBytes(files) }
    } catch (err) {
      return { ok: false, reason: 'failed', message: err instanceof PublishError || err instanceof Error ? err.message : String(err) }
    }
  })
  ipcMain.handle('publish:zip', async (_e, req: PublishFilesRequest): Promise<PublishResult> => {
    if (!existsSync(join(viewerDir(), 'index.html'))) return viewerMissing()
    try {
      const files = await assembleSite(viewerDir(), req.files)
      const zip = zipSite(files)
      await fsp.mkdir(dirname(req.path), { recursive: true })
      await fsp.writeFile(req.path, zip)
      return { ok: true, location: req.path, files: Object.keys(files).length, bytes: zip.byteLength }
    } catch (e) {
      return failure(e)
    }
  })
}

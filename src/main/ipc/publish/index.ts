/** Publish IPC: write a published dashboard to a folder or a zip (src/main/ipc/publish/site.ts). */
import { ipcMain } from 'electron'
import { promises as fsp, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { PublishFilesRequest, PublishResult } from '../../../shared/host'
import { assembleSite, siteBytes, writeSiteFolder, zipSite } from './site'

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

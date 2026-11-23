/**
 * Publishing a dashboard (File ▸ Publish, Home ▸ Publish, command search):
 *
 *   openPublishDialog()            — the Publish dialog (publish/PublishDialog.tsx)
 *   publishReport(opts)            — builds the publish files (src/core/publish) and hands them to a target in the
 *                                    main process (src/main/ipc/publish), which adds the web viewer (out/viewer)
 *
 * Targets: a folder any web server can serve, a zip for drag-and-drop hosting, or a saved hosted destination
 * (GitHub Pages, Netlify, Cloudflare Pages, S3-compatible storage; publish/destinations.ts).
 */
import { create } from 'zustand'
import { buildPublishBundle, type PublishOptions } from '@core/publish/bundle'
import type { PublishResult } from '@shared/host'
import { useApp } from '../state/store'
import { toast } from '../app/ui/Notify'
import { confirmDialog } from '../app/ui/Modal'

/** 'folder', 'zip', or the id of a saved destination */
export type PublishTargetId = string

export interface PublishTargetInfo {
  id: 'folder' | 'zip'
  label: string
  description: string
}

export const PUBLISH_TARGETS: PublishTargetInfo[] = [
  { id: 'folder', label: 'Folder', description: 'Writes the site into a folder. Serve it with any web server, or copy it to your host.' },
  { id: 'zip', label: 'Zip file', description: 'One archive of the site, ready to upload to a static host that takes a zip (Netlify Drop, Cloudflare Pages).' }
]

export interface PublishPrefs {
  target: PublishTargetId
  trimData: boolean
  stripQueries: boolean
}

const PREFS_KEY = 'lumen.publish'

function readPrefs(): PublishPrefs {
  const fallback: PublishPrefs = { target: 'folder', trimData: true, stripQueries: true }
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) ?? 'null') as Partial<PublishPrefs> | null
    if (!raw) return fallback
    return {
      target: typeof raw.target === 'string' && raw.target ? raw.target : fallback.target,
      trimData: raw.trimData !== false,
      stripQueries: raw.stripQueries !== false
    }
  } catch {
    return fallback
  }
}

/** The publisher's last choices (per user). */
export const usePublishPrefs = create<PublishPrefs & { set(p: Partial<PublishPrefs>): void }>((set, get) => ({
  ...readPrefs(),
  set: (p) => {
    set(p)
    const { target, trimData, stripQueries } = get()
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ target, trimData, stripQueries }))
    } catch {
      /* ignore */
    }
  }
}))

export const usePublishDialog = create<{ open: boolean; set(open: boolean): void }>((set) => ({ open: false, set: (open) => set({ open }) }))

export function openPublishDialog(): void {
  if (!useApp.getState().project?.report) {
    toast({ kind: 'warning', message: 'Open a report to publish it.' })
    return
  }
  usePublishDialog.getState().set(true)
}

export interface PublishRunOptions extends PublishOptions {
  target: PublishTargetId
  /** folder (folder target) or .zip path; asked with a dialog when absent */
  path?: string
  /** saved destinations: the dashboard's folder, site or project name there */
  site?: string
  /** write into a folder that holds other files without asking */
  replace?: boolean
}

function safeName(s: string): string {
  return s.replace(/[\\/:*?"<>|]/g, '_').trim() || 'Dashboard'
}

function sizeText(bytes: number): string {
  return bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`
}

let publishing = false

/** Publish the open report. Returns the target's result, or null when cancelled or failed (failures are shown). */
export async function publishReport(opts: PublishRunOptions): Promise<PublishResult | null> {
  const project = useApp.getState().project
  const host = window.wbi.publish
  if (!project?.report || publishing) return null
  if (!host) {
    toast({ kind: 'error', title: 'Publish failed', message: 'This build of Lumen cannot publish dashboards.' })
    return null
  }
  const title = (opts.title ?? '').trim() || project.name
  if (opts.target !== 'folder' && opts.target !== 'zip') return publishToDestination(opts, title)
  let target = opts.path ?? null
  if (!target) {
    const baseDir = project.source.path ? project.source.path.replace(/\/[^/]*\/?$/, '') : await window.wbi.app.getPath('documents').catch(() => '')
    if (opts.target === 'folder') target = await window.wbi.dialog.openDirectory({ title: 'Publish dashboard to a folder', defaultPath: baseDir })
    else {
      target = await window.wbi.dialog.saveFile({ title: 'Publish dashboard as a zip file', defaultPath: `${baseDir}/${safeName(title)}.zip`, filters: [{ name: 'Zip archive', extensions: ['zip'] }] })
      if (target && !/\.zip$/i.test(target)) target += '.zip'
    }
  }
  if (!target) return null
  publishing = true
  const app = useApp.getState()
  app.setBusy({ message: `Publishing ${title}…` })
  try {
    const bundle = buildPublishBundle(project, { ...opts, title })
    let result: PublishResult
    if (opts.target === 'folder') {
      result = await host.toFolder({ path: target, files: bundle.files, replace: opts.replace })
      if (!result.ok && result.reason === 'not-empty') {
        useApp.getState().setBusy(null)
        const choice = await confirmDialog({
          title: 'Publish into this folder?',
          message: `${target} already holds other files. Publishing writes index.html, an assets folder, report.wbi and lumen-publish.json into it, replacing files with those names.`,
          buttons: ['Publish', 'Cancel'],
          primary: 0
        })
        if (choice !== 0) return null
        useApp.getState().setBusy({ message: `Publishing ${title}…` })
        result = await host.toFolder({ path: target, files: bundle.files, replace: true })
      }
    } else result = await host.toZip({ path: target, files: bundle.files })
    if (!result.ok) {
      toast({ kind: 'error', title: 'Publish failed', message: result.message })
      return null
    }
    const where = result.location
    toast({
      kind: 'success',
      title: 'Dashboard published',
      message: `${where} (${sizeText(result.bytes)}). ${opts.target === 'folder' ? 'Serve the folder with a web server to open it; browsers do not run it straight from disk.' : 'Upload the zip to your static host.'}`,
      duration: 12000,
      action: { label: 'Show in folder', onClick: () => void window.wbi.app.showItemInFolder(opts.target === 'folder' ? `${where}/index.html` : where) }
    })
    return result
  } catch (e) {
    toast({ kind: 'error', title: 'Publish failed', message: e instanceof Error ? e.message : String(e) })
    return null
  } finally {
    useApp.getState().setBusy(null)
    publishing = false
  }
}

/** Upload to a saved destination, with the main process's progress in the busy overlay. */
async function publishToDestination(opts: PublishRunOptions, title: string): Promise<PublishResult | null> {
  const project = useApp.getState().project!
  const host = window.wbi.publish!
  publishing = true
  useApp.getState().setBusy({ message: `Publishing ${title}…` })
  const off = host.onProgress((p) => useApp.getState().setBusy({ message: p.message, ...(p.fraction !== undefined ? { progress: p.fraction } : {}) }))
  try {
    const bundle = buildPublishBundle(project, { ...opts, title })
    const result = await host.deploy({ destinationId: opts.target, site: opts.site ?? '', title, files: bundle.files })
    if (!result.ok) {
      toast({ kind: 'error', title: 'Publish failed', message: result.message, duration: 0 })
      return null
    }
    const url = result.url
    toast({
      kind: 'success',
      title: 'Dashboard published',
      message: `${url ?? result.location} (${sizeText(result.bytes)}).`,
      duration: 15000,
      ...(url ? { action: { label: 'Open', onClick: () => void window.wbi.app.openExternal(url) } } : {})
    })
    return result
  } catch (e) {
    toast({ kind: 'error', title: 'Publish failed', message: e instanceof Error ? e.message : String(e), duration: 0 })
    return null
  } finally {
    off()
    useApp.getState().setBusy(null)
    publishing = false
  }
}

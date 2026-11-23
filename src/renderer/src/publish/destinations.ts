/**
 * Hosted publish destinations as the renderer sees them: the kinds and their fields (for the destination editor),
 * the saved list (secrets stay in the main process), and the per-report site names.
 */
import { create } from 'zustand'
import type { PublishDestination, PublishDestinationKind } from '@shared/host'

export interface DestinationField {
  key: string
  label: string
  placeholder?: string
  hint?: string
  secret?: boolean
  required?: boolean
}

export interface DestinationKindInfo {
  kind: PublishDestinationKind
  label: string
  /** one line under the kind in the editor */
  help: string
  fields: DestinationField[]
  /** what the per-publish "site" is called for this kind */
  siteLabel: string
  siteHint: string
  /** site may contain folders (a/b) */
  siteIsPath: boolean
}

export const DESTINATION_KINDS: DestinationKindInfo[] = [
  {
    kind: 'github-pages',
    label: 'GitHub Pages',
    help: 'Commits the dashboard to a branch of a repository and turns on GitHub Pages for it. Use a token with Contents and Pages write access to the repository.',
    fields: [
      { key: 'owner', label: 'Owner', placeholder: 'user or organization', required: true },
      { key: 'repo', label: 'Repository', placeholder: 'dashboards', required: true },
      { key: 'branch', label: 'Branch', placeholder: 'gh-pages' },
      { key: 'folder', label: 'Folder', placeholder: 'optional, e.g. reports', hint: 'Dashboards go into subfolders of this folder.' },
      { key: 'token', label: 'Access token', secret: true, required: true, hint: 'GitHub ▸ Settings ▸ Developer settings ▸ Personal access tokens.' }
    ],
    siteLabel: 'Folder',
    siteHint: 'Folder of this dashboard inside the branch. Leave empty to publish at the root.',
    siteIsPath: true
  },
  {
    kind: 'netlify',
    label: 'Netlify',
    help: 'One Netlify site per dashboard, created on first publish. Use a personal access token (User settings ▸ Applications).',
    fields: [{ key: 'token', label: 'Personal access token', secret: true, required: true }],
    siteLabel: 'Site name',
    siteHint: 'The address becomes https://<site name>.netlify.app. Names are unique across Netlify.',
    siteIsPath: false
  },
  {
    kind: 'cloudflare-pages',
    label: 'Cloudflare Pages',
    help: 'One Pages project per dashboard, created on first publish. Use an API token with Account ▸ Cloudflare Pages ▸ Edit.',
    fields: [
      { key: 'accountId', label: 'Account ID', required: true, hint: 'Shown on the right of the account home page in the Cloudflare dashboard.' },
      { key: 'token', label: 'API token', secret: true, required: true }
    ],
    siteLabel: 'Project name',
    siteHint: 'The address becomes https://<project name>.pages.dev.',
    siteIsPath: false
  },
  {
    kind: 's3',
    label: 'S3-compatible storage',
    help: 'Uploads into a bucket served as a website (AWS S3 static hosting, Cloudflare R2, MinIO…). Website hosting is set up on the bucket itself.',
    fields: [
      { key: 'bucket', label: 'Bucket', required: true },
      { key: 'endpoint', label: 'Endpoint', placeholder: 'leave empty for AWS', hint: 'For R2, MinIO and others, e.g. https://<account>.r2.cloudflarestorage.com.' },
      { key: 'region', label: 'Region', placeholder: 'us-east-1' },
      { key: 'prefix', label: 'Prefix', placeholder: 'optional, e.g. dashboards' },
      { key: 'publicUrl', label: 'Public URL', placeholder: 'https://dashboards.example.com', hint: 'The address the bucket is served at, used for the link after publishing.' },
      { key: 'accessKeyId', label: 'Access key ID', secret: true, hint: 'Leave both keys empty to use the AWS default credentials (environment, ~/.aws).' },
      { key: 'secretAccessKey', label: 'Secret access key', secret: true }
    ],
    siteLabel: 'Folder',
    siteHint: 'Key prefix of this dashboard inside the bucket.',
    siteIsPath: true
  }
]

export function kindInfo(kind: PublishDestinationKind): DestinationKindInfo | undefined {
  return DESTINATION_KINDS.find((k) => k.kind === kind)
}

/** Lower-case letters, digits and hyphens (the main process applies the same rule). */
export function slugify(s: string, max = 58): string {
  const slug = s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/g, '')
  return slug || 'dashboard'
}

export function normalizeSite(kind: PublishDestinationKind, site: string): string {
  if (kindInfo(kind)?.siteIsPath)
    return site
      .split('/')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => slugify(s))
      .join('/')
  return slugify(site)
}

export const useDestinations = create<{ list: PublishDestination[]; loaded: boolean; refresh(): Promise<void> }>((set) => ({
  list: [],
  loaded: false,
  refresh: async () => {
    const api = window.wbi.publish?.destinations
    if (!api) return set({ list: [], loaded: true })
    try {
      set({ list: await api.list(), loaded: true })
    } catch {
      set({ loaded: true })
    }
  }
}))

const SITES_KEY = 'lumen.publish.sites'

/** The site name last used for this report at this destination (per user). */
export function rememberedSite(reportKey: string, destinationId: string): string | undefined {
  try {
    const all = JSON.parse(localStorage.getItem(SITES_KEY) ?? '{}') as Record<string, string>
    return all[`${reportKey}\u0000${destinationId}`]
  } catch {
    return undefined
  }
}

export function rememberSite(reportKey: string, destinationId: string, site: string): void {
  try {
    const all = JSON.parse(localStorage.getItem(SITES_KEY) ?? '{}') as Record<string, string>
    all[`${reportKey}\u0000${destinationId}`] = site
    localStorage.setItem(SITES_KEY, JSON.stringify(all))
  } catch {
    /* ignore */
  }
}

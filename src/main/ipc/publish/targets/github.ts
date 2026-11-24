/**
 * GitHub Pages: commits the site into a branch (default `gh-pages`) through the Git Data API, then turns Pages on for
 * that branch when it is off. Settings: owner, repo, branch, folder (where dashboards go inside the branch). Secret:
 * a token with Contents and Pages write access (fine-grained) or `repo` scope (classic).
 *
 * Each publish is one commit. Files whose content is unchanged are not uploaded again (git blob ids are compared),
 * and stale files under the dashboard's own folder are deleted, so other dashboards in the branch are untouched.
 */
import { createHash } from 'node:crypto'
import type { DestinationEntry } from '../destinations'
import type { SiteFiles } from '../site'
import { PublishError, b64, joinKey, requestJson, requireSecret, requireSetting, type DeployContext, type PublishTarget } from './common'

const API = 'https://api.github.com'

interface TreeEntry {
  path: string
  mode: string
  type: string
  sha: string | null
}

function headers(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'content-type': 'application/json' }
}

/** git's blob id: sha1("blob <len>\0" + content). */
export function gitBlobSha(bytes: Uint8Array): string {
  return createHash('sha1').update(`blob ${bytes.byteLength}\0`).update(bytes).digest('hex')
}

function repoOf(dest: DestinationEntry): { owner: string; repo: string; branch: string; folder: string; token: string } {
  return {
    owner: requireSetting(dest, 'owner', 'The repository owner'),
    repo: requireSetting(dest, 'repo', 'The repository'),
    branch: dest.settings['branch']?.trim() || 'gh-pages',
    folder: joinKey(dest.settings['folder'] ?? ''),
    token: requireSecret(dest, 'token', 'GitHub token')
  }
}

export function githubPagesUrl(owner: string, repo: string, path: string, htmlUrl?: string): string {
  const base = (htmlUrl ?? (repo.toLowerCase() === `${owner.toLowerCase()}.github.io` ? `https://${owner.toLowerCase()}.github.io/` : `https://${owner.toLowerCase()}.github.io/${repo}/`)).replace(/\/?$/, '/')
  return path ? `${base}${path.split('/').map(encodeURIComponent).join('/')}/` : base
}

async function ensurePages(ctx: DeployContext, r: ReturnType<typeof repoOf>): Promise<string | undefined> {
  const h = headers(r.token)
  const base = `${API}/repos/${r.owner}/${r.repo}/pages`
  try {
    const pages = await requestJson<{ html_url?: string; source?: { branch?: string } }>(ctx, 'GitHub', base, { headers: h })
    if (pages.source?.branch && pages.source.branch !== r.branch)
      ctx.progress({ message: `GitHub Pages serves the ${pages.source.branch} branch of ${r.owner}/${r.repo}, not ${r.branch}. Change it in the repository's Pages settings.` })
    return pages.html_url
  } catch (e) {
    if (!(e instanceof PublishError) || e.status !== 404) throw e
  }
  ctx.progress({ message: 'Turning on GitHub Pages' })
  const created = await requestJson<{ html_url?: string }>(ctx, 'GitHub Pages', base, { method: 'POST', headers: h, body: JSON.stringify({ source: { branch: r.branch, path: '/' } }) })
  return created.html_url
}

export const githubPages: PublishTarget = {
  async test(dest, _site, ctx) {
    const r = repoOf(dest)
    const repo = await requestJson<{ full_name: string; permissions?: { push?: boolean } }>(ctx, 'GitHub', `${API}/repos/${r.owner}/${r.repo}`, { headers: headers(r.token) })
    if (repo.permissions && !repo.permissions.push) throw new PublishError(`The token can read ${repo.full_name} but cannot push to it.`)
    return `Signed in. Dashboards go to the ${r.branch} branch of ${repo.full_name}${r.folder ? `, folder ${r.folder}` : ''}.`
  },

  async deploy(dest, site, files, title, ctx) {
    const r = repoOf(dest)
    const h = headers(r.token)
    const repoUrl = `${API}/repos/${r.owner}/${r.repo}`
    const root = joinKey(r.folder, site)
    ctx.progress({ message: `Reading ${r.owner}/${r.repo}` })
    await requestJson(ctx, 'GitHub', repoUrl, { headers: h })

    const readBranch = async (): Promise<{ parentSha: string; baseTree: string } | null> => {
      try {
        const ref = await requestJson<{ object: { sha: string } }>(ctx, 'GitHub', `${repoUrl}/git/ref/heads/${encodeURIComponent(r.branch)}`, { headers: h })
        const commit = await requestJson<{ tree: { sha: string } }>(ctx, 'GitHub', `${repoUrl}/git/commits/${ref.object.sha}`, { headers: h })
        return { parentSha: ref.object.sha, baseTree: commit.tree.sha }
      } catch (e) {
        if (e instanceof PublishError && (e.status === 404 || e.status === 409)) return null
        throw e
      }
    }
    let head = await readBranch()
    if (!head) {
      // an empty repository has no Git Data API until its first commit: make one through the contents API
      const empty = await requestJson(ctx, 'GitHub', `${repoUrl}/commits?per_page=1`, { headers: h }).then(
        () => false,
        (e: unknown) => {
          if (e instanceof PublishError && e.status === 409) return true
          throw e
        }
      )
      if (empty) {
        await requestJson(ctx, 'GitHub', `${repoUrl}/contents/.nojekyll`, { method: 'PUT', headers: h, body: JSON.stringify({ message: 'Start GitHub Pages', content: '', branch: r.branch }) })
        head = await readBranch()
      }
    }
    const parentSha = head?.parentSha ?? null
    const baseTree = head?.baseTree ?? null
    const existing = new Map<string, string>()
    if (baseTree) {
      const tree = await requestJson<{ tree: Array<{ path: string; type: string; sha: string }> }>(ctx, 'GitHub', `${repoUrl}/git/trees/${baseTree}?recursive=1`, { headers: h })
      for (const e of tree.tree) if (e.type === 'blob') existing.set(e.path, e.sha)
    }

    const entries: TreeEntry[] = []
    const paths = Object.keys(files)
    let uploaded = 0
    for (let i = 0; i < paths.length; i++) {
      const rel = paths[i]
      const path = joinKey(root, rel)
      const bytes = files[rel]
      const sha = gitBlobSha(bytes)
      if (existing.get(path) !== sha) {
        ctx.progress({ message: `Uploading ${rel}`, fraction: i / paths.length })
        const blob = await requestJson<{ sha: string }>(ctx, 'GitHub', `${repoUrl}/git/blobs`, { method: 'POST', headers: h, body: JSON.stringify({ content: b64(bytes), encoding: 'base64' }) })
        if (blob.sha !== sha) throw new PublishError(`GitHub stored ${rel} with an unexpected id. Try publishing again.`)
        uploaded++
      }
      entries.push({ path, mode: '100644', type: 'blob', sha })
    }
    // Jekyll would hide files and folders that start with an underscore
    if (!existing.has('.nojekyll')) {
      const blob = await requestJson<{ sha: string }>(ctx, 'GitHub', `${repoUrl}/git/blobs`, { method: 'POST', headers: h, body: JSON.stringify({ content: '', encoding: 'utf-8' }) })
      entries.push({ path: '.nojekyll', mode: '100644', type: 'blob', sha: blob.sha })
    }
    // stale files of this dashboard (old hashed assets): only inside its own folder, never the whole branch
    const own = new Set(entries.map((e) => e.path))
    const prefix = root ? `${root}/` : ''
    for (const path of existing.keys()) {
      if (own.has(path) || !path.startsWith(prefix)) continue
      const rel = path.slice(prefix.length)
      if (rel.startsWith('assets/') || rel === 'index.html' || rel === 'report.wbi' || rel === 'lumen-publish.json') entries.push({ path, mode: '100644', type: 'blob', sha: null })
    }

    ctx.progress({ message: 'Committing', fraction: 0.95 })
    const tree = await requestJson<{ sha: string }>(ctx, 'GitHub', `${repoUrl}/git/trees`, {
      method: 'POST',
      headers: h,
      body: JSON.stringify({ ...(baseTree ? { base_tree: baseTree } : {}), tree: entries.filter((e) => e.sha !== null || baseTree) })
    })
    const commit = await requestJson<{ sha: string }>(ctx, 'GitHub', `${repoUrl}/git/commits`, {
      method: 'POST',
      headers: h,
      body: JSON.stringify({ message: `Publish ${title}`, tree: tree.sha, parents: parentSha ? [parentSha] : [] })
    })
    if (parentSha) await requestJson(ctx, 'GitHub', `${repoUrl}/git/refs/heads/${encodeURIComponent(r.branch)}`, { method: 'PATCH', headers: h, body: JSON.stringify({ sha: commit.sha }) })
    else await requestJson(ctx, 'GitHub', `${repoUrl}/git/refs`, { method: 'POST', headers: h, body: JSON.stringify({ ref: `refs/heads/${r.branch}`, sha: commit.sha }) })

    const htmlUrl = await ensurePages(ctx, r)
    ctx.progress({ message: `Published (${uploaded} of ${paths.length} files changed). GitHub Pages usually updates within a minute.`, fraction: 1 })
    return { url: githubPagesUrl(r.owner, r.repo, root, htmlUrl) }
  }
}

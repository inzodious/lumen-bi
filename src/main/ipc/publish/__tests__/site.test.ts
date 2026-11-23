import { describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { unzipSync } from 'fflate'
import { assembleSite, checkFolder, isSafeRelative, writeSiteFolder, zipSite } from '../site'

function viewer(): string {
  const dir = mkdtempSync(join(tmpdir(), 'lumen-viewer-'))
  mkdirSync(join(dir, 'assets'))
  writeFileSync(join(dir, 'index.html'), '<!doctype html>')
  writeFileSync(join(dir, 'assets', 'index-abc.js'), 'console.log(1)')
  return dir
}

describe('published site', () => {
  it('adds the publish files to the viewer', async () => {
    const files = await assembleSite(viewer(), { 'lumen-publish.json': '{}', 'report.wbi': new Uint8Array([1, 2, 3]) })
    expect(Object.keys(files).sort()).toEqual(['assets/index-abc.js', 'index.html', 'lumen-publish.json', 'report.wbi'])
    expect(new TextDecoder().decode(files['lumen-publish.json'])).toBe('{}')
  })

  it('refuses file names that leave the site', async () => {
    expect(isSafeRelative('report.wbi')).toBe(true)
    expect(isSafeRelative('a/b.json')).toBe(true)
    for (const bad of ['../x', '/etc/passwd', 'a/../../x', 'C:/x', '', 'a//b']) expect(isSafeRelative(bad)).toBe(false)
    await expect(assembleSite(viewer(), { '../evil': 'x' })).rejects.toThrow(/Invalid file name/)
  })

  it('writes into an empty folder, replaces an earlier publish and asks before a folder with other files', async () => {
    const site = await assembleSite(viewer(), { 'lumen-publish.json': '{}', 'report.wbi': 'x' })
    const root = mkdtempSync(join(tmpdir(), 'lumen-site-'))
    const target = join(root, 'out')
    expect(await checkFolder(target)).toBe('empty')
    await writeSiteFolder(target, site)
    expect(await checkFolder(target)).toBe('published')
    // a stale hashed asset from an earlier publish is removed
    writeFileSync(join(target, 'assets', 'old-123.js'), '')
    await writeSiteFolder(target, site)
    expect(readdirSync(join(target, 'assets'))).toEqual(['index-abc.js'])

    const other = join(root, 'other')
    mkdirSync(other)
    writeFileSync(join(other, 'notes.txt'), 'keep')
    expect(await checkFolder(other)).toBe('other')
    await expect(writeSiteFolder(other, site)).rejects.toMatchObject({ code: 'not-empty' })
    await writeSiteFolder(other, site, { replace: true })
    expect(readFileSync(join(other, 'notes.txt'), 'utf8')).toBe('keep')
    expect(existsSync(join(other, 'index.html'))).toBe(true)
  })

  it('zips the site with its files at the root', async () => {
    const site = await assembleSite(viewer(), { 'report.wbi': 'x' })
    expect(Object.keys(unzipSync(zipSite(site))).sort()).toEqual(['assets/index-abc.js', 'index.html', 'report.wbi'])
  })
})

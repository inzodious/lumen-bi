/**
 * S3-compatible storage (AWS S3, Cloudflare R2, MinIO, Backblaze B2…) serving a static website: each dashboard is a
 * key prefix in the bucket. The bucket's website hosting or a CDN in front of it is set up outside Lumen; `publicUrl`
 * is the address it serves the bucket at. Stale files of the dashboard (old hashed assets) are deleted.
 * Settings: bucket, endpoint (non-AWS), region, prefix, publicUrl. Secrets: accessKeyId, secretAccessKey (without
 * them the AWS default credential chain is used).
 */
import { DeleteObjectsCommand, HeadBucketCommand, ListObjectsV2Command, PutObjectCommand } from '@aws-sdk/client-s3'
import { explainS3Error, s3Client, type S3Target } from '../../connectors/s3'
import type { DestinationEntry } from '../destinations'
import { PublishError, contentType, joinKey, requireSetting, type PublishTarget } from './common'

function targetOf(dest: DestinationEntry): S3Target {
  const accessKeyId = dest.secrets['accessKeyId']
  const secretAccessKey = dest.secrets['secretAccessKey']
  return {
    bucket: requireSetting(dest, 'bucket', 'The bucket'),
    endpoint: dest.settings['endpoint'] || undefined,
    region: dest.settings['region'] || undefined,
    auth: accessKeyId && secretAccessKey ? { kind: 'aws-keys', accessKeyId, secretAccessKey } : { kind: 'aws-default' }
  }
}

function wrap(e: unknown, t: S3Target): PublishError {
  return new PublishError(explainS3Error(e, t).message.replace(/ \(Data source settings ▸ Edit Permissions\)| Check the credentials in Data source settings ▸ Edit Permissions\./, ' Check the keys of the destination.'))
}

export function s3PublicUrl(dest: DestinationEntry, key: string): string {
  const base = dest.settings['publicUrl']?.trim()
  const path = key ? `${key.split('/').map(encodeURIComponent).join('/')}/` : ''
  if (base) return `${base.replace(/\/?$/, '/')}${path}`
  const t = targetOf(dest)
  if (t.endpoint) return `${(/^https?:\/\//i.test(t.endpoint) ? t.endpoint : `https://${t.endpoint}`).replace(/\/?$/, '/')}${t.bucket}/${path}index.html`
  return `https://${t.bucket}.s3.${t.region || 'us-east-1'}.amazonaws.com/${path}index.html`
}

export const s3: PublishTarget = {
  async test(dest) {
    const t = targetOf(dest)
    try {
      await s3Client(t).send(new HeadBucketCommand({ Bucket: t.bucket }))
    } catch (e) {
      throw wrap(e, t)
    }
    return `Signed in. Dashboards go to the bucket ${t.bucket}${dest.settings['prefix'] ? ` under ${joinKey(dest.settings['prefix'])}/` : ''}.`
  },

  async deploy(dest, site, files, _title, ctx) {
    const t = targetOf(dest)
    const root = joinKey(dest.settings['prefix'] ?? '', site)
    const client = s3Client(t)
    const paths = Object.keys(files)
    try {
      for (let i = 0; i < paths.length; i++) {
        const rel = paths[i]
        ctx.progress({ message: `Uploading ${rel}`, fraction: i / paths.length })
        // the bundle and manifest change every publish; hashed assets never do
        const cache = rel.startsWith('assets/') ? 'public, max-age=31536000, immutable' : 'no-cache'
        await client.send(new PutObjectCommand({ Bucket: t.bucket, Key: joinKey(root, rel), Body: files[rel], ContentType: contentType(rel), CacheControl: cache }))
      }
      const own = new Set(paths.map((p) => joinKey(root, p)))
      const prefix = joinKey(root, 'assets') + '/'
      const stale: string[] = []
      let token: string | undefined
      do {
        const r = await client.send(new ListObjectsV2Command({ Bucket: t.bucket, Prefix: prefix, ContinuationToken: token }))
        for (const o of r.Contents ?? []) if (o.Key && !own.has(o.Key)) stale.push(o.Key)
        token = r.IsTruncated ? r.NextContinuationToken : undefined
      } while (token)
      for (let i = 0; i < stale.length; i += 1000) await client.send(new DeleteObjectsCommand({ Bucket: t.bucket, Delete: { Objects: stale.slice(i, i + 1000).map((Key) => ({ Key })) } }))
    } catch (e) {
      if (e instanceof PublishError) throw e
      throw wrap(e, t)
    }
    return { url: s3PublicUrl(dest, root) }
  }
}

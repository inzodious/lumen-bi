import type { PublishDestinationKind } from '../../../../shared/host'
import type { PublishTarget } from './common'
import { cloudflarePages } from './cloudflare'
import { githubPages } from './github'
import { lumenServer } from './lumenServer'
import { netlify } from './netlify'
import { s3 } from './s3'

export const TARGETS: Partial<Record<PublishDestinationKind, PublishTarget>> = {
  'github-pages': githubPages,
  netlify,
  'cloudflare-pages': cloudflarePages,
  s3,
  'lumen-server': lumenServer
}

export * from './common'

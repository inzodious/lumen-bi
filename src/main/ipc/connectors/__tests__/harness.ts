/**
 * Test harness: evaluates M end to end through the fetch-and-replay driver, the renderer's fetcher and
 * the main-process connector service (no Electron, no IPC), with a credential store in a temp dir.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createFetcher } from '../../../../core/data/fetcher'
import { nodeFs } from '../../../../core/io/nodefs'
import { MError, evaluateQuery, runWithData, toJs, type DataRequest } from '../../../../core/m/index.ts'
import type { MTable } from '../../../../core/m/values.ts'
import type { WbiHost } from '../../../../shared/host'
import { CredentialStore, type Cipher } from '../credstore'
import { createConnectorService, type ConnectorService } from '../service'
import type { ShareEnv } from '../shares'

/** A reversible stand-in for safeStorage. */
export const testCipher: Cipher = {
  available: () => true,
  backend: () => 'test',
  encrypt: (s) => Buffer.from(`enc:${Buffer.from(s, 'utf8').toString('base64')}`),
  decrypt: (b) => {
    const t = b.toString('utf8')
    if (!t.startsWith('enc:')) throw new Error('bad ciphertext')
    return Buffer.from(t.slice(4), 'base64').toString('utf8')
  }
}

export interface Harness {
  dir: string
  store: CredentialStore
  service: ConnectorService
  /** every data request of the last `m()` call */
  log: DataRequest[]
  /** evaluates M; returns the plain JS value (tables → arrays of records) */
  m(source: string): Promise<unknown>
  /** evaluates M and returns the MTable (types included) */
  table(source: string): Promise<MTable>
  dispose(): Promise<void>
}

export function harness(opts: { openExternal?: (url: string) => Promise<void> | void; shareEnv?: ShareEnv } = {}): Harness {
  const dir = mkdtempSync(join(tmpdir(), 'lumen-conn-'))
  const store = new CredentialStore(join(dir, 'credentials.json'), testCipher)
  const service = createConnectorService({ store, openExternal: opts.openExternal ?? (() => undefined), shareEnv: opts.shareEnv })
  const connectors: WbiHost['connectors'] = {
    sqlQuery: () => Promise.reject(new Error('SQL Server is not part of these tests')),
    sqlListItems: () => Promise.reject(new Error('SQL Server is not part of these tests')),
    http: (r) => service.http(r),
    request: (r) => service.request(r),
    shares: { list: () => service.shares.list(), mount: (r) => service.shares.mount(r), resolve: (p) => service.shares.resolve(p) }
  }
  const fetcher = createFetcher({ fs: nodeFs, connectors, now: () => new Date() })
  const h: Harness = {
    dir,
    store,
    service,
    log: [],
    async table(source: string) {
      h.log = []
      return runWithData(
        (host) => {
          const ev = evaluateQuery(source, { host, previewSteps: false })
          if (!ev.result.ok) throw new MError(ev.result.error.reason, ev.result.error.message, ev.result.error.detail ?? null)
          const v = ev.result.value as MTable
          void v.rows // materialize inside the pass
          return v
        },
        (req) => {
          h.log.push(req)
          return fetcher(req)
        }
      )
    },
    async m(source: string) {
      h.log = []
      return runWithData(
        (host) => {
          const ev = evaluateQuery(source, { host, previewSteps: false })
          if (!ev.result.ok) throw new MError(ev.result.error.reason, ev.result.error.message, ev.result.error.detail ?? null)
          return toJs(ev.result.value)
        },
        (req) => {
          h.log.push(req)
          return fetcher(req)
        }
      )
    },
    async dispose() {
      await service.close()
      rmSync(dir, { recursive: true, force: true })
    }
  }
  return h
}

/** SQL statements sent by the last evaluation (db requests only). */
export function sqlSent(h: Harness): string[] {
  return h.log.filter((r): r is Extract<DataRequest, { kind: 'db' }> => r.kind === 'db').map((r) => r.query)
}

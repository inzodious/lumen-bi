/**
 * Docker helpers for the live connector integration tests (LUMEN_IT=1): start a throwaway container
 * with a random host port, wait until it answers, remove it afterwards.
 */
import { execFileSync } from 'node:child_process'

export function dockerAvailable(): boolean {
  try {
    execFileSync('docker', ['info', '--format', '{{.ServerVersion}}'], { stdio: 'pipe', timeout: 15_000 })
    return true
  } catch {
    return false
  }
}

export function imagePresent(image: string): boolean {
  try {
    execFileSync('docker', ['image', 'inspect', image], { stdio: 'pipe' })
    return true
  } catch {
    return false
  }
}

export interface Container {
  id: string
  name: string
  host: string
  port: number
  remove(): void
}

/** Runs `image` detached with `containerPort` published on a random 127.0.0.1 port. */
export function startContainer(opts: { name: string; image: string; port: number; env?: Record<string, string>; args?: string[]; cmd?: string[] }): Container {
  const name = `lumen-it-${opts.name}-${process.pid}`
  try {
    execFileSync('docker', ['rm', '-f', name], { stdio: 'pipe' })
  } catch {
    /* not there */
  }
  const env = Object.entries(opts.env ?? {}).flatMap(([k, v]) => ['-e', `${k}=${v}`])
  const id = execFileSync('docker', ['run', '-d', '--rm', '--name', name, '-p', `127.0.0.1::${opts.port}`, ...env, ...(opts.args ?? []), opts.image, ...(opts.cmd ?? [])], { stdio: 'pipe', timeout: 120_000 })
    .toString()
    .trim()
  const mapped = execFileSync('docker', ['port', name, `${opts.port}/tcp`], { stdio: 'pipe' }).toString().trim().split('\n')[0]!
  const port = Number(mapped.slice(mapped.lastIndexOf(':') + 1))
  return {
    id,
    name,
    host: '127.0.0.1',
    port,
    remove: () => {
      try {
        execFileSync('docker', ['rm', '-f', name], { stdio: 'pipe', timeout: 60_000 })
      } catch {
        /* already gone */
      }
    }
  }
}

/** Retries `probe` until it resolves (or the deadline passes, rethrowing the last error). */
export async function waitFor<T>(probe: () => Promise<T>, timeoutMs: number, stepMs = 500): Promise<T> {
  const deadline = Date.now() + timeoutMs
  let last: unknown
  while (Date.now() < deadline) {
    try {
      return await probe()
    } catch (e) {
      last = e
      await new Promise((r) => setTimeout(r, stepMs))
    }
  }
  throw last instanceof Error ? last : new Error(String(last))
}

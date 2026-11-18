/** Shared bits of the main-process connectors. */

export const DEFAULT_MAX_ROWS = 5_000_000

export interface DbRunOptions {
  maxRows?: number
  timeoutMs?: number
}

/**
 * A connector failure. `kind` lets the renderer offer "Edit Credentials" ('credentials') or report a
 * missing object ('notFound'); the message is shown to the user as is.
 */
export class ConnectorError extends Error {
  constructor(
    message: string,
    readonly kind: 'credentials' | 'notFound' | 'error' = 'error'
  ) {
    super(message)
    this.name = 'ConnectorError'
  }
}

/** Marker text the renderer recognizes (Power BI's wording) for sources that have no stored credential. */
export function credentialsRequired(sourceLabel: string, path: string): ConnectorError {
  return new ConnectorError(`Credentials are required to connect to the ${sourceLabel} source. (Source at ${path}.)`, 'credentials')
}

/** `host`, `host:port`, `host,port`, `[v6]:port` → host + port. */
export function hostPort(server: string, defaultPort: number): { host: string; port: number } {
  const s = server.trim().replace(/^[a-z]+:\/\//i, '')
  const v6 = /^\[([^\]]+)\](?::(\d+))?$/.exec(s)
  if (v6) return { host: v6[1]!, port: Number(v6[2] ?? defaultPort) }
  const m = /^([^:,]+)[:,](\d+)$/.exec(s)
  if (m) return { host: m[1]!, port: Number(m[2]) }
  return { host: s, port: defaultPort }
}

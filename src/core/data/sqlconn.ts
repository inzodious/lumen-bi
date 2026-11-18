/**
 * Pure helpers for the main-process SQL Server connector (src/main/ipc/connectors.ts): server-string
 * parsing, SQL Server → normalized host type names, value normalization. Kept here so they're testable
 * without Electron.
 */

export interface ServerAddress {
  host: string
  port: number
  instanceName?: string
}

/**
 * Parses the Power Query server argument: `host`, `host,port`, `tcp:host,port`, `host\instance`,
 * `host:port`. Fabric SQL analytics endpoints / warehouses and Azure SQL use port 1433.
 */
export function parseServer(server: string): ServerAddress {
  let s = server.trim().replace(/^tcp:/i, '')
  let port = 1433
  let instanceName: string | undefined
  const comma = s.lastIndexOf(',')
  if (comma > 0) {
    port = Number(s.slice(comma + 1)) || 1433
    s = s.slice(0, comma)
  } else {
    const m = /^([^:\\]+):(\d+)$/.exec(s)
    if (m) {
      s = m[1]!
      port = Number(m[2])
    }
  }
  const bs = s.indexOf('\\')
  if (bs > 0) {
    instanceName = s.slice(bs + 1)
    s = s.slice(0, bs)
  }
  return { host: s, port, instanceName }
}

/** Azure / Fabric hosts that need Microsoft Entra ID and encryption. */
export function isAzureHost(host: string): boolean {
  return /\.(database\.windows\.net|datawarehouse\.fabric\.microsoft\.com|database\.fabric\.microsoft\.com|sql\.azuresynapse\.net|pbidedicated\.windows\.net|database\.usgovcloudapi\.net)$/i.test(host)
}

/** tedious data type name (e.g. 'IntN', 'NVarChar', 'DateTime2') → host logical type (src/core/m/host.ts). */
export function hostTypeOf(tediousType: string): string {
  const t = tediousType.replace(/N$/, '').toLowerCase()
  switch (t) {
    case 'tinyint':
    case 'smallint':
    case 'int':
      return 'integer'
    case 'bigint':
      return 'bigint'
    case 'bit':
      return 'boolean'
    case 'float':
    case 'real':
      return 'double'
    case 'decimal':
    case 'numeric':
      return 'decimal'
    case 'money':
    case 'smallmoney':
      return 'money'
    case 'date':
      return 'date'
    case 'datetime':
    case 'datetime2':
    case 'smalldatetime':
      return 'timestamp'
    case 'datetimeoffset':
      return 'datetimeoffset'
    case 'time':
      return 'time'
    case 'binary':
    case 'varbinary':
    case 'image':
    case 'udt':
      return 'binary'
    case 'uniqueidentifier':
      return 'guid'
    default:
      return 'varchar'
  }
}

/** Normalizes a tedious value for IPC (bigint arrives as string; Buffers become Uint8Array). */
export function normalizeSqlValue(v: unknown, hostType: string): unknown {
  if (v === null || v === undefined) return null
  if (hostType === 'bigint' && typeof v === 'string') return Number(v)
  if (hostType === 'guid' && typeof v === 'string') return v.toLowerCase()
  if (typeof v === 'bigint') return Number(v)
  if (v instanceof Uint8Array) return new Uint8Array(v)
  return v
}

/** Friendlier text for common connection / sign-in failures. */
export function explainSqlError(message: string, host: string): string {
  if (/AADSTS|Login failed for user '<token-identified principal>'|token-identified/i.test(message)) {
    return `${message} — sign in with an account that has access to ${host} (Data source settings → Edit Permissions).`
  }
  if (/ENOTFOUND|getaddrinfo/i.test(message)) return `The server '${host}' was not found or was not accessible (${message}).`
  if (/ETIMEOUT|timeout/i.test(message)) return `Connecting to '${host}' timed out (${message}).`
  return message
}

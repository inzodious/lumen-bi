import { describe, expect, it } from 'vitest'
import { explainSqlError, hostTypeOf, isAzureHost, normalizeSqlValue, parseServer } from '../sqlconn'

describe('SQL connector helpers', () => {
  it('parses Power Query server strings', () => {
    expect(parseServer('abc.datawarehouse.fabric.microsoft.com')).toEqual({ host: 'abc.datawarehouse.fabric.microsoft.com', port: 1433, instanceName: undefined })
    expect(parseServer('tcp:srv.database.windows.net,1444')).toEqual({ host: 'srv.database.windows.net', port: 1444, instanceName: undefined })
    expect(parseServer('localhost\\SQLEXPRESS')).toMatchObject({ host: 'localhost', instanceName: 'SQLEXPRESS' })
    expect(parseServer('localhost:14330')).toMatchObject({ host: 'localhost', port: 14330 })
  })
  it('recognizes Azure / Fabric hosts', () => {
    expect(isAzureHost('x.datawarehouse.fabric.microsoft.com')).toBe(true)
    expect(isAzureHost('x.database.windows.net')).toBe(true)
    expect(isAzureHost('localhost')).toBe(false)
  })
  it('maps tedious types and values', () => {
    expect(hostTypeOf('IntN')).toBe('integer')
    expect(hostTypeOf('BigInt')).toBe('bigint')
    expect(hostTypeOf('NVarChar')).toBe('varchar')
    expect(hostTypeOf('DateTime2')).toBe('timestamp')
    expect(hostTypeOf('Date')).toBe('date')
    expect(hostTypeOf('BitN')).toBe('boolean')
    expect(hostTypeOf('DecimalN')).toBe('decimal')
    expect(hostTypeOf('MoneyN')).toBe('money')
    expect(hostTypeOf('UniqueIdentifier')).toBe('guid')
    expect(normalizeSqlValue('9007199254740991', 'bigint')).toBe(9007199254740991)
    expect(normalizeSqlValue('ABC-D', 'guid')).toBe('abc-d')
  })
  it('explains sign-in failures', () => {
    expect(explainSqlError("Login failed for user '<token-identified principal>'.", 'h')).toMatch(/Edit Permissions/)
  })
})

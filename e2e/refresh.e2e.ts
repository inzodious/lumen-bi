/**
 * Refresh → Cancel while a source never answers (a hung server or a sign-in nobody completes): the dialog
 * stops at once, keeps the previous data, and the main process abandons the request (the socket closes).
 */
import { createServer, type Server } from 'node:http'
import type { AddressInfo, Socket } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { useLumen, lumenEval, untilNode, waitIdle } from './harness'

describe('refresh', () => {
  const lumen = useLumen({ route: { sample: '1' } })
  let server: Server
  let url = ''
  const sockets: Socket[] = []
  let requests = 0

  beforeAll(async () => {
    // accepts requests and never responds
    server = createServer(() => void requests++)
    server.on('connection', (s) => sockets.push(s))
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/hang`
  })
  afterAll(async () => {
    for (const s of sockets) s.destroy()
    await new Promise((r) => server.close(r))
  })

  it('Cancel stops a refresh whose source never answers', async () => {
    const { page } = lumen()
    // setup (not under test): point the Product query at the hanging endpoint
    const rowsBefore = await lumenEval(
      page,
      (l, u) => {
        l.useApp.getState().mutateModel('e2e: hanging source', (m) => {
          const t = m.tables.find((x) => x.name === 'Product')!
          t.partitions[0]!.expression = `Table.FromRecords(Json.Document(Web.Contents("${u}")))`
        })
        return l.useApp.getState().project!.data.tables.get('Product')!.rowCount
      },
      url
    )
    expect(rowsBefore).toBeGreaterThan(0)

    await lumenEval(page, (l) => l.useShell.getState().openDialog({ id: 'refresh', tables: ['Product'] }))
    const dialog = page.locator('.wbi-modal')
    await dialog.waitFor()
    await untilNode(() => requests > 0, 30_000, 'the refresh to reach the hanging server')

    // the footer button (the title bar's X is labelled Close too)
    const closeBtn = dialog.locator('.wbi-btn--primary', { hasText: /^Close$/ })
    const t0 = Date.now()
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    await closeBtn.waitFor({ timeout: 5_000 })
    expect(Date.now() - t0).toBeLessThan(5_000)
    await expect.poll(() => dialog.locator('.wbi-refresh__row').filter({ hasText: 'Product' }).innerText()).toMatch(/Cancelled/)

    // main aborted the fetch: the server sees its connection closed
    await untilNode(() => sockets.length > 0 && sockets.every((s) => s.destroyed || s.closed), 10_000, 'the cancelled request to be dropped')

    // previous data kept
    expect(await lumenEval(page, (l) => l.useApp.getState().project!.data.tables.get('Product')!.rowCount)).toBe(rowsBefore)
    await closeBtn.click()
    await expect.poll(() => dialog.count()).toBe(0)
    await waitIdle(page)
  })
})

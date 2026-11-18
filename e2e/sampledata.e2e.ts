/**
 * Sample data journeys on a PBIP project without data (e2e/fixtures/survey.ts): fill the model, browse it in
 * Table view, regenerate it, edit an existing relationship, save it as a .wbi bundle and reopen it. Then a report
 * filled with sample data is interactive (e2e/fixtures/accounts.ts): dropdown slicers offer items, picking one
 * filters the page, and a slicer saved to a real-looking name shows a generated stand-in, marked as such.
 */
import { beforeAll, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { Page } from 'playwright-core'
import { OUT_DIR, dataPaneRow, goToPage, lumenEval, openFile, settle, stubSaveDialog, untilNode, untilVisualText, useLumen, visualByTitle, visualText, waitIdle } from './harness'
import { SURVEY_TABLES as T, writeSurveyProject } from './fixtures/survey'
import { PINNED_ACCOUNT, previousQuarter, writeAccountsProject } from './fixtures/accounts'

const dir = mkdtempSync(join(OUT_DIR, 'survey-'))
const pbip = join(dir, 'Survey.pbip')

/** Row counts of every table in the store. */
const rowCounts = (page: Page) => lumenEval(page, (l) => Object.fromEntries([...l.useApp.getState().project!.data.tables].map(([n, t]) => [n, t.rowCount])))
const statusOf = (page: Page, table: string) => lumenEval(page, (l, t) => l.useApp.getState().project!.data.status.get(t) ?? null, table)
const columnSample = (page: Page, table: string, column: string) =>
  lumenEval(page, (l, a) => (l.useApp.getState().project!.data.tables.get(a.table)?.columns.find((c) => c.name === a.column)?.values ?? []).slice(0, 200).map((v) => (v instanceof Date ? v.getTime() : v)), { table, column })
const measure = (page: Page, name: string) => lumenEval(page, (l, n) => Number(l.useApp.getState().engine!.evaluateScalar(`[${n}]`).value), name)
const view = (page: Page, name: 'Report view' | 'Table view' | 'Model view') => page.getByRole('navigation', { name: 'Views' }).getByRole('button', { name }).click()
const grid = (page: Page, table: string) => page.getByRole('grid', { name: `Table ${table}` })
const statusBar = (page: Page) => page.locator('.wbi-statusbar')

async function openRelationshipEditor(page: Page, from: string): Promise<void> {
  await (await dataPaneRow(page, [T.clinics])).click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Manage relationships' }).click()
  const manage = page.getByRole('dialog', { name: 'Manage relationships' })
  await manage.locator('.wbi-rels__row', { hasText: from }).dblclick()
  await page.getByRole('dialog', { name: 'Edit relationship' }).waitFor()
}

describe('sample data', () => {
  beforeAll(async () => {
    await writeSurveyProject(dir)
  })
  const lumen = useLumen({ open: pbip })

  it('the project opens without data and offers sample data', async () => {
    const { page } = lumen()
    // the fixture really has the shape under test: calculated-table columns without a declared data type
    const tmdl = readFileSync(join(dir, 'Survey.SemanticModel', 'definition', 'tables', `${T.combined}.tmdl`), 'utf8')
    expect(tmdl).toMatch(/column clinic_id/)
    expect(tmdl).not.toMatch(/dataType/)
    expect(await lumenEval(page, (l) => l.useApp.getState().project!.model.tables.find((t) => t.name === 'responses')!.columns.map((c) => c.dataType))).toEqual(new Array(7).fill('unknown'))
    const notice = page.locator('.wbi-notice', { hasText: 'No data loaded' })
    await notice.waitFor()
    await notice.getByRole('button', { name: 'Use sample data' }).click()
    await expect.poll(() => statusOf(page, T.web)).toMatchObject({ state: 'loaded', source: 'synthetic' })
    await waitIdle(page)
    // every imported table has rows; the calculated table is computed from them; the measure table has none
    const rows = await rowCounts(page)
    for (const t of [T.calendar, T.clinics, T.web, T.kiosk]) expect(rows[t], t).toBeGreaterThan(0)
    expect(rows[T.combined]).toBe(rows[T.web] + rows[T.kiosk])
    expect(rows[T.measures] ?? 0).toBe(0)
    const toast = page.locator('.wbi-toast', { hasText: 'Sample data' })
    await expect.poll(() => toast.innerText()).toMatch(/Generated sample rows for 4 tables \(seed \d+\)\. 1 calculated table is computed from them; 1 measure table has no rows by design\./)
    await expect.poll(() => notice.count()).toBe(0)
    // survey scores are realistic: promoters outnumber detractors, the score is clearly positive
    const nps = await measure(page, 'NPS')
    expect(nps).toBeGreaterThan(25)
    expect(nps).toBeLessThan(75)
  })

  it('Table view always has the Data pane, opens on a table with rows and lists hidden tables', async () => {
    const { page } = lumen()
    // close the Data pane in Report view, as a user might: Table view must still offer it
    await page.getByRole('toolbar', { name: 'Panes' }).getByRole('button', { name: 'Data', exact: true }).click()
    await expect.poll(() => page.locator('[data-pane="data"]').count()).toBe(0)
    await view(page, 'Table view')
    await page.locator('[data-pane="data"] .wbi-dtree').waitFor()
    // not the measure table the model lists first: the first table that has rows
    const g = grid(page, T.calendar)
    await g.waitFor()
    const rows = await rowCounts(page)
    expect(Number(await g.getAttribute('aria-rowcount'))).toBe(rows[T.calendar])
    expect(await g.locator('.wbi-dv__row').count()).toBeGreaterThan(10)
    await expect.poll(() => statusBar(page).innerText()).toMatch(new RegExp(`Table: ${T.calendar} \\(${rows[T.calendar].toLocaleString('en-US')} rows\\)`))
    // hidden tables are listed (dimmed) in this view, and clicking one shows its rows
    const names = await page.locator('.wbi-dtree > [role="treeitem"] > .wbi-dtree__row .wbi-dtree__name').allInnerTexts()
    expect(names).toEqual(expect.arrayContaining(Object.values(T)))
    const hidden = await dataPaneRow(page, [T.web])
    expect(await hidden.getAttribute('class')).toMatch(/is-hidden/)
    await hidden.click()
    await grid(page, T.web).waitFor()
    expect(Number(await grid(page, T.web).getAttribute('aria-rowcount'))).toBe(rows[T.web])
    // the pane can collapse to a strip and come back, but never disappears here
    await page.getByRole('button', { name: 'Collapse Data' }).click()
    await page.getByRole('button', { name: 'Expand Data' }).first().click()
    await page.locator('[data-pane="data"] .wbi-dtree').waitFor()
  })

  it('a calculated table shows its computed rows with typed, untruncated headers; sort and filter work', async () => {
    const { page } = lumen()
    await (await dataPaneRow(page, [T.combined])).click()
    const g = grid(page, T.combined)
    await g.waitFor()
    const rows = await rowCounts(page)
    expect(Number(await g.getAttribute('aria-rowcount'))).toBe(rows[T.combined])
    // header names are never cut ("Colum…")
    const cut = await g.locator('.wbi-dv__thname').evaluateAll((els) => els.filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => e.textContent))
    expect(cut).toEqual([])
    // the model declares no data types for these columns: icons and alignment come from the computed data
    const header = (name: string) => g.locator('.wbi-dv__th').filter({ has: page.locator('.wbi-dv__thname', { hasText: new RegExp(`^${name}$`) }) })
    expect(await header('answered_on').locator('[aria-label="Date"]').count()).toBe(1)
    expect(await header('recommend').getAttribute('class')).toMatch(/is-num/)
    expect(await header('feed').locator('[aria-label="Text"]').count()).toBe(1)
    // the formula bar shows the table's DAX, as in Power BI Desktop
    await expect.poll(() => page.getByTestId('formula-bar').innerText()).toMatch(/responses\s*=[\s\S]*UNION/)
    // selecting a column reports its distinct values
    await header('promoter_group').click()
    await expect.poll(() => statusBar(page).innerText()).toMatch(/Column: promoter_group \(3 distinct values\)/)
    // sort descending through the header menu
    const firstCell = () => g.locator('.wbi-dv__row').first().locator('.wbi-dv__td').nth(3).innerText()
    // (the chevron appears on hover, like in Power BI Desktop)
    const openMenu = async (name: string) => {
      await header(name).hover()
      await header(name).getByRole('button', { name: `Sort and filter ${name}` }).click()
      await page.locator('.wbi-dvf').waitFor()
    }
    await openMenu('recommend')
    await page.locator('.wbi-dvf__item').nth(1).click()
    await expect.poll(firstCell).toBe('10')
    await openMenu('recommend')
    await page.locator('.wbi-dvf__item').nth(0).click()
    await expect.poll(async () => Number(await firstCell())).toBeLessThan(7)
    // filter the feed column to one value
    await openMenu('feed')
    const menu = page.locator('.wbi-dvf')
    await menu.locator('.wbi-dvf__check', { hasText: 'Kiosk' }).click()
    await menu.getByRole('button', { name: 'OK' }).click()
    await expect.poll(async () => Number(await g.getAttribute('aria-rowcount'))).toBe(rows[T.web])
  })

  it('a measure table says it only holds measures; selecting a measure shows its formula', async () => {
    const { page } = lumen()
    await (await dataPaneRow(page, [T.measures])).click()
    const g = grid(page, T.measures)
    await g.waitFor()
    const empty = g.locator('.wbi-dv__noRows')
    expect(await empty.getAttribute('data-empty-kind')).toBe('measures')
    expect(await empty.innerText()).toMatch(/only holds measures \(4\)/)
    expect(await empty.innerText()).not.toMatch(/No data is loaded/)
    expect(await empty.getByRole('button').count()).toBe(0)
    await (await dataPaneRow(page, [T.measures, 'NPS'])).click()
    await expect.poll(() => page.getByTestId('formula-bar').innerText()).toMatch(/NPS\s*=\s*\(\s*\[Promoters %\]/)
  })

  it('editing an existing relationship shows no errors and can be saved', async () => {
    const { page, tmp } = lumen()
    const before = await lumenEval(page, (l) => JSON.stringify(l.useApp.getState().project!.model.relationships))
    for (const from of [`${T.combined} (clinic_id)`, `${T.combined} (answered_on)`]) {
      await openRelationshipEditor(page, from)
      const dlg = page.getByRole('dialog', { name: 'Edit relationship' })
      // both previews show rows
      expect(await dlg.locator('.wbi-relgrid tbody tr').count()).toBeGreaterThan(5)
      expect(await dlg.locator('.wbi-form__error').count()).toBe(0)
      expect(await dlg.locator('.wbi-form__warning').count()).toBe(0)
      expect(await dlg.getByText('Many to one (*:1)').count()).toBeGreaterThan(0)
      const save = dlg.getByRole('button', { name: 'Save' })
      expect(await save.isEnabled()).toBe(true)
      if (from.includes('clinic_id')) await page.screenshot({ path: join(tmp, 'edit-relationship.png') })
      await save.click()
      await expect.poll(() => page.getByRole('dialog', { name: 'Edit relationship' }).count()).toBe(0)
      await page.getByRole('dialog', { name: 'Manage relationships' }).getByRole('button', { name: 'Close' }).last().click()
      await expect.poll(() => page.getByRole('dialog').count()).toBe(0)
    }
    expect(await lumenEval(page, (l) => JSON.stringify(l.useApp.getState().project!.model.relationships))).toBe(before)
    // the "one" sides are unique and the keys of the feeds exist in the dimension
    const guids = await columnSample(page, T.clinics, 'clinic_guid')
    expect(new Set(guids).size).toBe(guids.length)
    const orphans = await lumenEval(page, (l) => {
      const d = l.useApp.getState().project!.data.tables
      const one = new Set(d.get('clinics')!.columns.find((c) => c.name === 'clinic_guid')!.values)
      return d.get('web_responses')!.columns.find((c) => c.name === 'clinic_id')!.values.filter((v) => !one.has(v)).length
    })
    expect(orphans).toBe(0)
  })

  it('a changed relationship is still validated: duplicates on the one side block Save, mixed data types only add a note', async () => {
    const { page } = lumen()
    await openRelationshipEditor(page, `${T.combined} (clinic_id)`)
    const dlg = page.getByRole('dialog', { name: 'Edit relationship' })
    const right = dlg.locator('.wbi-reled__side').nth(1)
    // region repeats across clinics: not a valid "one" side
    await right.locator('th', { hasText: /^region$/ }).click()
    await expect.poll(() => dlg.locator('.wbi-form__error').allInnerTexts()).toEqual([expect.stringMatching(/'region' contains duplicate values/)])
    expect(await dlg.getByRole('button', { name: 'Save' }).isEnabled()).toBe(false)
    // text related to a whole number: allowed like in Power BI, with a note
    const left = dlg.locator('.wbi-reled__side').nth(0)
    await right.locator('th', { hasText: /^clinic_guid$/ }).click()
    await left.locator('th', { hasText: /^recommend$/ }).click()
    await expect.poll(() => dlg.locator('.wbi-form__warning').allInnerTexts()).toEqual([expect.stringMatching(/different data types \(Whole number and Text\)/)])
    expect(await dlg.locator('.wbi-form__error').count()).toBe(0)
    expect(await dlg.getByRole('button', { name: 'Save' }).isEnabled()).toBe(true)
    await dlg.getByRole('button', { name: 'Cancel' }).click()
    await page.getByRole('dialog', { name: 'Manage relationships' }).getByRole('button', { name: 'Close' }).last().click()
    await expect.poll(() => page.getByRole('dialog').count()).toBe(0)
  })

  it('Regenerate sample data gives a different, equally consistent dataset', async () => {
    const { page } = lumen()
    const seed = await lumenEval(page, (l) => l.useShell.getState().options.syntheticSeed)
    const before = await columnSample(page, T.web, 'recommend_score')
    const rows = await rowCounts(page)
    await statusBar(page).getByRole('button', { name: /Sample data/ }).click()
    const item = page.getByRole('menuitem', { name: 'Regenerate sample data' })
    await item.waitFor()
    // the menu opens above the status bar, fully inside the window
    const box = await page.locator('.wbi-popover', { has: item }).evaluate((el) => {
      const r = el.getBoundingClientRect()
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, w: window.innerWidth, h: window.innerHeight }
    })
    expect(box.left).toBeGreaterThanOrEqual(0)
    expect(box.top).toBeGreaterThanOrEqual(0)
    expect(box.right).toBeLessThanOrEqual(box.w)
    expect(box.bottom).toBeLessThanOrEqual(box.h)
    await item.click()
    await expect.poll(() => lumenEval(page, (l) => l.useShell.getState().options.syntheticSeed)).not.toBe(seed)
    const newSeed = await lumenEval(page, (l) => l.useShell.getState().options.syntheticSeed)
    await expect.poll(() => page.locator('.wbi-toast', { hasText: `seed ${newSeed}` }).count()).toBeGreaterThan(0)
    await waitIdle(page)
    expect(await columnSample(page, T.web, 'recommend_score')).not.toEqual(before)
    const after = await rowCounts(page)
    // all sample tables were regenerated (not only empty ones); the calculated table follows
    expect(after[T.combined]).toBe(after[T.web] + after[T.kiosk])
    expect(after[T.calendar]).toBe(rows[T.calendar])
    expect(await statusOf(page, T.clinics)).toMatchObject({ state: 'loaded', source: 'synthetic' })
    const nps = await measure(page, 'NPS')
    expect(nps).toBeGreaterThan(25)
    expect(nps).toBeLessThan(75)
    // the grid on screen shows the new rows of the calculated table
    await (await dataPaneRow(page, [T.combined])).click()
    await expect.poll(async () => Number(await grid(page, T.combined).getAttribute('aria-rowcount'))).toBe(after[T.combined])
  })

  it('Save As .wbi keeps the sample data: reopening shows the same rows without generating anything', async () => {
    const { page, app, tmp } = lumen()
    const rows = await rowCounts(page)
    const scores = await columnSample(page, T.web, 'recommend_score')
    const days = await columnSample(page, T.calendar, 'date')
    const nps = await measure(page, 'NPS')
    const target = join(tmp, 'Survey showcase.wbi')
    await stubSaveDialog(app, target)
    await page.locator('.wbi-ribbon').getByRole('button', { name: 'File', exact: true }).first().click()
    await page.getByRole('dialog', { name: 'File' }).locator('.wbi-backstage__item', { hasText: /^Save as$/ }).click()
    await page.getByRole('button', { name: /bundle \(\.wbi\)/ }).click()
    await untilNode(() => existsSync(target) && statSync(target).size > 10_000, 30_000, '.wbi file')
    await expect.poll(() => lumenEval(page, (l) => l.useApp.getState().project!.source.kind)).toBe('wbi')
    await openFile(page, target)
    expect(await lumenEval(page, (l) => l.useApp.getState().project!.source.kind)).toBe('wbi')
    expect(await rowCounts(page)).toEqual(rows)
    expect(await columnSample(page, T.web, 'recommend_score')).toEqual(scores)
    expect(await columnSample(page, T.calendar, 'date')).toEqual(days)
    expect(await measure(page, 'NPS')).toBeCloseTo(nps, 9)
    expect(await statusOf(page, T.web)).toMatchObject({ state: 'loaded', source: 'synthetic' })
    // no "no data" notice; the status bar still marks the data as sample data
    expect(await page.locator('.wbi-notice', { hasText: 'No data loaded' }).count()).toBe(0)
    await statusBar(page).getByRole('button', { name: /Sample data/ }).waitFor()
    await view(page, 'Table view')
    await (await dataPaneRow(page, [T.web])).click()
    await expect.poll(async () => Number(await grid(page, T.web).getAttribute('aria-rowcount'))).toBe(rows[T.web])
  })
})

const accountsDir = mkdtempSync(join(OUT_DIR, 'accounts-'))

describe('a report filled with sample data is interactive', () => {
  beforeAll(async () => {
    await writeAccountsProject(accountsDir)
  })
  const lumen = useLumen({ open: join(accountsDir, 'Accounts.pbip') })
  const slicer = (page: Page, name: string) => page.locator(`.wbi-page [data-visual="${name}"]`)
  const popup = (page: Page) => page.locator('.wbi-slicer-popup')
  const hasNumber = (t: string) => /\d{2,}/.test(t)
  async function clearSlicer(page: Page, name: string): Promise<void> {
    // the header eraser (the hover header layer above a slicer at the top of the page covers it for pointer clicks)
    await slicer(page, name).hover()
    await slicer(page, name).locator('button[title="Clear selections"]').dispatchEvent('click')
    await settle(page)
  }
  async function openDropdown(page: Page, name: string): Promise<string[]> {
    await slicer(page, name).getByRole('combobox').click()
    await popup(page).waitFor()
    await expect.poll(() => popup(page).getByRole('option').count()).toBeGreaterThan(0)
    return popup(page).getByRole('option').allInnerTexts()
  }

  it('dropdown slicers offer items and picking one filters the other visuals; a saved real name reads as a marked stand-in', async () => {
    const { page } = lumen()
    const notice = page.locator('.wbi-notice', { hasText: 'No data loaded' })
    await notice.waitFor()
    await notice.getByRole('button', { name: 'Use sample data' }).click()
    await waitIdle(page)
    await settle(page)
    await expect.poll(() => page.locator('.wbi-toast', { hasText: 'Sample data' }).innerText()).toMatch(/invented stand-in value/)

    // the saved account selection: the real-looking name is not in the data; the slicer shows the stand-in, marked
    const standIn = await lumenEval(page, (l) => {
      const s = l.useApp.getState().project!.data.literalStandIns?.find((x) => x.column === 'account_name')
      return s ? String([...s.values.values()][0]) : null
    })
    expect(standIn).toBeTruthy()
    const account = slicer(page, 'slicerAccount')
    await expect.poll(() => account.innerText()).toContain(standIn!)
    expect(await account.innerText()).not.toContain(PINNED_ACCOUNT)
    const badge = account.getByRole('note', { name: 'Sample stand-in selection' })
    expect(await badge.count()).toBe(1)
    expect(await badge.getAttribute('title')).not.toContain(PINNED_ACCOUNT)
    const table = await visualByTitle(page, 'Amount by segment')
    const pinned = await untilVisualText(page, table, hasNumber)

    // a quarter on another slicer cuts the facts, and the account list (a dimension shared by two facts) keeps its accounts
    const quarters = await openDropdown(page, 'slicerQuarter')
    await popup(page).getByRole('option', { name: quarters[quarters.length - 2], exact: true }).click()
    await page.keyboard.press('Escape')
    await untilVisualText(page, table, (t) => t !== pinned && hasNumber(t))
    await settle(page)
    const accounts = await openDropdown(page, 'slicerAccount')
    expect(accounts.length).toBeGreaterThan(10)
    expect(accounts).not.toContain(PINNED_ACCOUNT)
    await page.keyboard.press('Escape')
    await clearSlicer(page, 'slicerQuarter')
    await untilVisualText(page, table, (t) => t === pinned)

    // pick another account (one with visits): the table changes and still has data; the selection is the user's own, no badge
    const shown = (await openDropdown(page, 'slicerAccount')).filter((n) => n !== standIn && n !== 'Select all')
    const other = await lumenEval(
      page,
      (l, names) => {
        const e = l.useApp.getState().engine!
        const amount = (n: string) => Number(e.evaluateScalar(`CALCULATE ( [Amount], accounts[account_name] = "${n.replace(/"/g, '""')}" )`).value ?? 0)
        return names.reduce((best, n) => (amount(n) > amount(best) ? n : best))
      },
      shown
    )
    await popup(page).getByRole('option', { name: other, exact: true }).click()
    await page.keyboard.press('Escape')
    const picked = await untilVisualText(page, table, (t) => t !== pinned && hasNumber(t))
    await settle(page)
    expect(await badge.count()).toBe(0)
    expect(await visualText(page, 'slicerAccount')).toContain(other)

    // a calculated-column slicer on the dimension cuts the facts too
    await clearSlicer(page, 'slicerAccount')
    const all = await untilVisualText(page, table, (t) => t !== pinned && t !== picked && hasNumber(t))
    // cleared means cleared: the slicer does not fall back to (and show) the saved selection
    expect(await badge.count()).toBe(0)
    expect(await visualText(page, 'slicerAccount')).toMatch(/\bAll\b/)
    const statuses = await openDropdown(page, 'slicerStatus')
    expect(statuses).toEqual(expect.arrayContaining(['Active', 'Inactive']))
    await popup(page).getByRole('option', { name: 'Inactive', exact: true }).click()
    await page.keyboard.press('Escape')
    await untilVisualText(page, table, (t) => t !== all && hasNumber(t))
  })

  it('under the saved quarter, any account picked keeps the table populated', async () => {
    const { page } = lumen()
    await goToPage(page, 'By account')
    const table = await visualByTitle(page, 'Amount by account')
    const quarter = slicer(page, 'slicerQuarter2')
    await expect.poll(() => quarter.innerText()).toContain(previousQuarter())
    await untilVisualText(page, table, hasNumber)
    // first, middle and last accounts of the list, plus two more: each has visits in the saved quarter
    const names = (await openDropdown(page, 'slicerAccount2')).filter((n) => n !== 'Select all')
    await page.keyboard.press('Escape')
    expect(names.length).toBeGreaterThan(8)
    const picks = [...new Set([0, 3, Math.floor(names.length / 2), names.length - 4, names.length - 1].map((i) => names[i]))]
    let previous = ''
    for (const name of picks) {
      await openDropdown(page, 'slicerAccount2')
      await popup(page).getByRole('option', { name, exact: true }).click()
      await page.keyboard.press('Escape')
      // the table shows that account's row, with an amount
      const text = await untilVisualText(page, table, (t) => t !== previous && t.includes(name) && hasNumber(t))
      expect(text, name).toContain(name)
      previous = text
      await settle(page)
    }
  })

  /**
   * Every item of a virtualized list (a slicer popup's listbox, a table's body), read by scrolling it to the end. Each
   * step waits for the list to render the new window (two animation frames) before reading it.
   */
  async function scrollCollect(page: Page, scroller: string, read: 'options' | 'tableRows'): Promise<string[]> {
    return page.evaluate(
      async ({ scroller, read }) => {
        const el = document.querySelector<HTMLElement>(scroller)
        if (!el) return []
        const frames = () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))
        const seen = new Map<number, string>()
        const grab = () => {
          if (read === 'options') {
            for (const o of el.querySelectorAll<HTMLElement>('[role="option"]')) {
              const top = Math.round(o.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop)
              seen.set(top, o.innerText.trim())
            }
          } else {
            const body = el.firstElementChild?.children[1]
            for (const row of Array.from(body?.children ?? []) as HTMLElement[]) {
              const m = /translateY\(([\d.]+)px\)/.exec(row.style.transform)
              if (m) seen.set(Math.round(Number(m[1])), (row.firstElementChild as HTMLElement | null)?.innerText.trim() ?? '')
            }
          }
        }
        let stable = 0
        for (let step = 0; step < 2000 && stable < 3; step++) {
          await frames()
          grab()
          const before = el.scrollTop
          const atEnd = el.scrollTop + el.clientHeight >= el.scrollHeight - 1
          el.scrollTop = before + Math.max(20, el.clientHeight * 0.7)
          stable = atEnd ? stable + 1 : 0
        }
        el.scrollTop = 0
        return [...seen.entries()].sort((a, b) => a[0] - b[0]).map(([, t]) => t)
      },
      { scroller, read }
    )
  }

  /** Pick one item of a dropdown slicer by its position in the (virtualized) list. */
  async function pickByIndex(page: Page, name: string, index: number, label: string): Promise<void> {
    await slicer(page, name).getByRole('combobox').click()
    await popup(page).waitFor()
    const option = popup(page).getByRole('option', { name: label, exact: true })
    await page.evaluate(
      async ({ index }) => {
        const list = document.querySelector<HTMLElement>('.wbi-slicer-popup [role="listbox"]')
        const first = list?.querySelector<HTMLElement>('[role="option"]')
        if (!list || !first) return
        list.scrollTop = Math.max(0, index * first.getBoundingClientRect().height - list.clientHeight / 2)
        await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))
      },
      { index }
    )
    await option.waitFor()
    await option.click()
    await page.keyboard.press('Escape')
  }

  it('a measure that only counts flagged accounts: the table lists every account offered and keeps the row of each one picked', async () => {
    const { page } = lumen()
    await goToPage(page, 'Account list')
    const table = await visualByTitle(page, 'Counted amount by account')
    await untilVisualText(page, table, hasNumber)
    await settle(page)
    // the flag the measure filters on is not shown anywhere: every generated account holds the literal
    const flags = await columnSample(page, 'accounts', 'counted')
    expect(new Set(flags)).toEqual(new Set(['count_this_account']))
    // the accounts the slicer offers (the whole virtualized list) …
    await slicer(page, 'slicerAccount3').getByRole('combobox').click()
    await popup(page).waitFor()
    const options = await scrollCollect(page, '.wbi-slicer-popup [role="listbox"]', 'options')
    const offset = options[0] === 'Select all' ? 1 : 0
    const offered = options.slice(offset)
    await page.keyboard.press('Escape')
    expect(offered.length).toBeGreaterThan(100)
    // … are exactly the accounts the table lists with nothing selected
    const listed = await scrollCollect(page, `.wbi-page [data-visual="${table}"] .wbi-table-scroll`, 'tableRows')
    expect(listed.length).toBe(offered.length)
    expect(new Set(listed)).toEqual(new Set(offered))
    // each of 24 accounts spread over the list (first and last included) keeps exactly its own row
    const picks = [...new Set(Array.from({ length: 24 }, (_, k) => Math.round((k * (offered.length - 1)) / 23)))]
    expect(picks[0]).toBe(0)
    expect(picks[picks.length - 1]).toBe(offered.length - 1)
    let previous = ''
    for (const i of picks) {
      const name = offered[i]
      await pickByIndex(page, 'slicerAccount3', i + offset, name)
      // the table shows that account's row, alone, with an amount
      const text = await untilVisualText(page, table, (t) => t !== previous && t.includes(name) && hasNumber(t))
      await expect.poll(() => scrollCollect(page, `.wbi-page [data-visual="${table}"] .wbi-table-scroll`, 'tableRows'), { message: name }).toEqual([name])
      previous = text
      await settle(page)
    }
  })
})

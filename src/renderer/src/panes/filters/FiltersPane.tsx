/**
 * Filters pane (PBI Desktop): "Filters on this visual" / "Filters on this page" / "Filters on all pages",
 * filter cards with Basic / Advanced / Top N / Relative date editors, lock / hide / clear / remove,
 * search, and drop zones for fields dragged from the Data pane. Writes PBIR `filterConfig.filters`
 * on report.json / page.json / visual.json through `mutateReport` (undoable).
 */
import { useMemo, useState } from 'react'
import { useApp } from '../../state/store'
import { fieldKey, type SQExpr } from '@core/report/sq'
import { filterPaneStyle } from './paneStyle'
import { findPage, findVisual, filterCards, newObjectName, visualFields, type FilterCard } from '../../report/pbir'
export { mutateCards, scopeJson, type FilterScope } from './scope'
import { SearchBox, cx } from '../../app/ui'
import { mutateCards, type FilterScope } from './scope'
import { PaneFrame } from '../PaneFrame'
import { draggingField, fieldToSQ, isFieldDrag, readFieldDrag } from '../fieldDrag'
import { newCard } from './filterModel'
import { FilterCardView } from './FilterCardView'
import './filters.css'

interface CardEntry {
  card: FilterCard
  /** visual-level card generated from the visual's fields (not yet in filterConfig) */
  implicit: boolean
}

export function FiltersPane() {
  const report = useApp((s) => s.project?.report)
  const activePage = useApp((s) => s.activePage)
  const selected = useApp((s) => s.selectedVisuals)
  const editMode = useApp((s) => s.editMode)
  const theme = useApp((s) => s.theme)
  const [q, setQ] = useState('')

  const page = findPage(report, activePage)
  const visual = editMode && selected.length === 1 ? findVisual(page, selected[0]) : undefined

  const visualEntries = useMemo<CardEntry[]>(() => {
    if (!visual) return []
    const cards = filterCards(visual.json).map((card) => ({ card, implicit: false }))
    const have = new Set(cards.filter((c) => c.card.field).map((c) => fieldKey(c.card.field)))
    // PBI lists every field of the visual as a (possibly empty) visual-level filter card
    for (const f of visualFields(visual.json)) {
      if (!f.expr) continue
      const k = fieldKey(f.expr)
      if (have.has(k)) continue
      have.add(k)
      cards.push({ card: { ...newCard(`auto:${k}`, f.expr), howCreated: 'Auto' }, implicit: true })
    }
    return cards
  }, [visual])
  const pageEntries = useMemo<CardEntry[]>(() => filterCards(page?.json).map((card) => ({ card, implicit: false })), [page])
  const reportEntries = useMemo<CardEntry[]>(() => filterCards(report?.report).map((card) => ({ card, implicit: false })), [report])

  if (!report) {
    return (
      <PaneFrame id="filters" title="Filters" collapsible>
        <div className="wbi-pane__empty">Open or create a report to add filters.</div>
      </PaneFrame>
    )
  }
  const paneStyle = filterPaneStyle(page, theme)
  const activeCount = [...pageEntries, ...reportEntries].filter((e) => e.card.filter?.Where?.length).length
  return (
    <PaneFrame
      id="filters"
      title="Filters"
      collapsible
      subheader={
        <div className="wbi-pane__search">
          <SearchBox value={q} onChange={setQ} placeholder="Search" size="small" />
        </div>
      }
      collapsedExtra={activeCount ? <span className="wbi-filters__badge">{activeCount}</span> : undefined}
    >
      <div className="wbi-filters" style={paneStyle}>
        {visual && page && <FilterSection title="Filters on this visual" scope={{ level: 'visual', page: page.name, visual: visual.name }} entries={visualEntries} query={q} editMode={editMode} />}
        {page && <FilterSection title="Filters on this page" scope={{ level: 'page', page: page.name }} entries={pageEntries} query={q} editMode={editMode} />}
        <FilterSection title="Filters on all pages" scope={{ level: 'report' }} entries={reportEntries} query={q} editMode={editMode} />
      </div>
    </PaneFrame>
  )
}

function FilterSection({ title, scope, entries, query, editMode }: { title: string; scope: FilterScope; entries: CardEntry[]; query: string; editMode: boolean }) {
  const [over, setOver] = useState(false)
  const model = useApp((s) => s.project?.model)
  const visible = entries.filter((e) => (editMode || !e.card.isHiddenInViewMode) && e.card.howCreated !== 'Drillthrough')
  const ql = query.trim().toLowerCase()
  const acceptsMeasures = scope.level === 'visual'

  const canAccept = (): boolean => {
    const f = draggingField()
    if (!f) return true
    if (f.kind === 'table') return false
    if (f.kind === 'measure' && !acceptsMeasures) return false
    return true
  }
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setOver(false)
    const f = readFieldDrag(e.dataTransfer)
    if (!f || f.kind === 'table') return
    if (f.kind === 'measure' && !acceptsMeasures) return
    const exprs = fieldToSQ(f, { model })
    if (!exprs.length) return
    mutateCards(scope, 'Add filter', (cards) => {
      for (const expr of exprs) {
        if (cards.some((c) => c.field && fieldKey(c.field) === fieldKey(expr))) continue
        cards.push(newCard(newObjectName(), expr))
      }
    })
  }
  if (!editMode && !visible.length) return null
  return (
    <section className="wbi-filters__section">
      <h3 className="wbi-filters__title">{title}</h3>
      <div className="wbi-filters__cards">
        {visible.map((e) => (
          <FilterCardView key={e.card.name} card={e.card} implicit={e.implicit} scope={scope} editMode={editMode} query={ql} />
        ))}
      </div>
      {editMode && (
        <div
          className={cx('wbi-filters__drop', over && 'is-over')}
          onDragOver={(e) => {
            if (!isFieldDrag(e) || !canAccept()) return
            e.preventDefault()
            e.dataTransfer.dropEffect = 'copy'
            setOver(true)
          }}
          onDragLeave={() => setOver(false)}
          onDrop={onDrop}
        >
          Add data fields here
        </div>
      )}
    </section>
  )
}

/** Field expression helper re-exported for other panes (e.g. "Add to filters" in the Data pane). */
export function addFilterCard(scope: FilterScope, expr: SQExpr): void {
  mutateCards(scope, 'Add filter', (cards) => {
    if (cards.some((c) => c.field && fieldKey(c.field) === fieldKey(expr))) return
    cards.push(newCard(newObjectName(), expr))
  })
}

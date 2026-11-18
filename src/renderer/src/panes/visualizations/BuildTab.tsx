/**
 * Build tab of the Visualizations pane: visual-type gallery + field wells for the selected visual
 * (drag fields from the Data pane, reorder, move between wells, per-field menu) and, when no visual
 * is selected, the page's drill-through wells.
 */
import { useMemo, useState, type DragEvent } from 'react'
import { ChevronDownRegular, DismissRegular, ArrowRightRegular } from '@fluentui/react-icons'
import { fieldInfo, fieldKey, type SQExpr } from '@core/report/sq'
import type { PageDocument, VisualDocument } from '@core/report/types'
import type { DataRoleDef } from '../../visuals/contract'
import { useApp } from '../../state/store'
import { findPage, findVisual, visualTypeOf, filterCards, drillthroughFields, keepsAllFilters, newObjectName } from '../../report/pbir'
import { addVisual } from '../../report/editOps'
import { allVisuals, getVisual } from '../../visuals/registry'
import { changeVisualType, insertVisual, runModelingCommand } from '../../app/commands'
import { cx, promptDialog, showContextMenu, Tip, Toggle, type MenuItem } from '../../app/ui'
import { draggingField, endFieldDrag, fieldToSQ, isFieldDrag, readFieldDrag, type DraggedField } from '../fieldDrag'
import { CATALOG, catalogEntry, ICONS } from './catalog'
import { AGG_MENU, addProjection, applyDateSlicerDefault, getShowAll, getShowValueAs, isValueProjection, moveProjection, nativeName, removeProjection, renameProjection, roleProjections, setAggregation, setShowAll, setShowValueAs, type ProjectionJson } from './wells'
import { propagateSlicerFields } from '../syncslicers/sync'

const PROJ_MIME = 'application/x-lumen-projection'

interface GalleryItem {
  type: string
  displayName: string
  icon: string
  registered: boolean
}

export function galleryItems(): GalleryItem[] {
  const registered = allVisuals().filter((d) => d.inGallery !== false)
  const out: GalleryItem[] = []
  const seen = new Set<string>()
  for (const c of CATALOG) {
    const def = getVisual(c.type)
    out.push({ type: c.type, displayName: def?.displayName ?? c.displayName, icon: def?.icon || c.icon, registered: !!def })
    seen.add(c.type.toLowerCase())
    for (const a of def?.aliases ?? []) seen.add(a.toLowerCase())
    if (def) seen.add(def.type.toLowerCase())
  }
  for (const d of registered) {
    if (seen.has(d.type.toLowerCase())) continue
    seen.add(d.type.toLowerCase())
    out.push({ type: d.type, displayName: d.displayName, icon: d.icon || ICONS.generic, registered: true })
  }
  return out
}

/** Roles of a visual type: registry → catalog → whatever the visual JSON already uses. */
export function rolesFor(type: string, visualJson?: any): DataRoleDef[] {
  const roles = getVisual(type)?.roles ?? catalogEntry(type)?.roles ?? []
  const used = Object.keys(visualJson?.visual?.query?.queryState ?? {})
  const extra = used.filter((u) => !roles.some((r) => r.name === u)).map((u): DataRoleDef => ({ name: u, displayName: u, kind: 'both' }))
  return [...roles, ...extra]
}

export function Gallery({ selectedType, targetVisual }: { selectedType?: string; targetVisual?: string }) {
  const items = useMemo(galleryItems, [allVisuals().length])
  return (
    <div className="wbi-viz__gallery" role="listbox" aria-label="Visual types">
      {items.map((it) => {
        const same = selectedType && (selectedType === it.type || getVisual(selectedType) === getVisual(it.type)) && getVisual(it.type)
        const active = selectedType === it.type || !!same
        return (
          <Tip key={it.type} title={it.displayName} description={it.registered ? undefined : 'Preview: rendering for this visual is limited.'}>
            <button
              type="button"
              role="option"
              aria-selected={active}
              aria-label={it.displayName}
              className={cx('wbi-viz__gtile', active && 'is-selected', !it.registered && 'is-unregistered')}
              onClick={() => (targetVisual ? changeVisualType([targetVisual], it.type) : insertVisual(it.type))}
              dangerouslySetInnerHTML={{ __html: it.icon }}
            />
          </Tip>
        )
      })}
    </div>
  )
}

export function BuildTab() {
  const project = useApp((s) => s.project)
  const activePage = useApp((s) => s.activePage)
  const selected = useApp((s) => s.selectedVisuals)
  const page = findPage(project?.report, activePage)
  const visual = selected.length === 1 ? findVisual(page, selected[0]) : undefined
  const type = visual ? visualTypeOf(visual) : undefined
  return (
    <div className="wbi-viz__build">
      <Gallery selectedType={type} targetVisual={visual && type !== 'group' ? visual.name : undefined} />
      {visual && type !== 'group' && page && <Wells page={page} visual={visual} type={type!} />}
      {!visual && page && <DrillthroughWells page={page} />}
      {!page && <div className="wbi-pane__empty">Select a visual type to add it to the page.</div>}
    </div>
  )
}

// ---------------------------------------------------------------------------------------------
// Field wells
// ---------------------------------------------------------------------------------------------

function edit(page: string, visual: string, label: string, fn: (visualJson: any) => void): void {
  useApp.getState().mutateReport(label, (r) => {
    const v = findVisual(findPage(r, page), visual)
    if (!v) return
    fn(v.json)
    // synced slicers with "Sync field changes" follow (same undo step)
    propagateSlicerFields(r, page, visual)
  })
}

function canDrop(role: DataRoleDef, f: DraggedField | null, type: string): boolean {
  if (!f || f.kind === 'table') return false
  if (role.kind === 'grouping' && f.kind === 'measure') return false
  if (role.kind === 'measure' && (f.kind === 'hierarchy' || f.kind === 'hierarchyLevel')) return false
  void type
  return true
}

function asValueFor(role: DataRoleDef, type: string): boolean {
  return role.kind === 'measure' || (role.kind === 'both' && /card|kpi|gauge/i.test(type))
}

function Wells({ page, visual, type }: { page: PageDocument; visual: VisualDocument; type: string }) {
  const roles = rolesFor(type, visual.json)
  if (!roles.length) return <div className="wbi-pane__empty">This visual has no data fields.</div>
  return (
    <div className="wbi-viz__wells">
      {roles.map((role) => (
        <Well key={role.name} role={role} roles={roles} page={page} visual={visual} type={type} />
      ))}
    </div>
  )
}

function Well({ role, roles, page, visual, type }: { role: DataRoleDef; roles: DataRoleDef[]; page: PageDocument; visual: VisualDocument; type: string }) {
  const engine = useApp((s) => s.engine)
  const model = useApp((s) => s.project?.model)
  const [over, setOver] = useState<number | null>(null)
  const projections = roleProjections(visual.json, role.name)
  const full = role.max !== undefined && role.max > 1 && projections.length >= role.max

  const labelOf = (p: ProjectionJson): string => {
    if (p.displayName) return p.displayName
    const pct = getShowValueAs(p) === 'percentOfGrandTotal'
    const d = !pct ? engine?.describeField(p.field) : undefined
    return d?.displayName ?? p.nativeQueryRef ?? nativeName(p.field)
  }

  const onDragOver = (e: DragEvent, index: number) => {
    const isProj = e.dataTransfer.types.includes(PROJ_MIME)
    if (isProj || (isFieldDrag(e) && canDrop(role, draggingField(), type))) {
      e.preventDefault()
      e.dataTransfer.dropEffect = isProj ? 'move' : 'copy'
      setOver(index)
    }
  }
  const onDrop = (e: DragEvent, index: number) => {
    e.preventDefault()
    setOver(null)
    const projRaw = e.dataTransfer.getData(PROJ_MIME)
    if (projRaw) {
      const src = JSON.parse(projRaw) as { role: string; index: number; page: string; visual: string }
      if (src.visual !== visual.name) return
      edit(page.name, visual.name, 'Move field', (vj) => moveProjection(vj, src.role, src.index, role.name, index, { max: role.max }))
      return
    }
    const f = readFieldDrag(e.dataTransfer)
    endFieldDrag()
    if (!canDrop(role, f, type)) return
    const exprs = fieldToSQ(f!, { asValue: asValueFor(role, type), model })
    edit(page.name, visual.name, 'Add field', (vj) => {
      let at = index
      for (const x of exprs) if (addProjection(vj, role.name, x, { index: at, max: role.max, active: role.drillable && f!.kind.startsWith('hierarchy') ? true : undefined })) at++
      applyDateSlicerDefault(vj, model)
    })
  }

  const menu = (p: ProjectionJson, i: number): MenuItem[] => {
    const info = fieldInfo(getShowValueAs(p) === 'percentOfGrandTotal' ? p.field.Arithmetic.Left : p.field)
    const isCol = info.kind === 'column' || info.kind === 'aggregation'
    const curAgg = info.kind === 'aggregation' ? info.aggregation : null
    const items: MenuItem[] = [
      { label: 'Remove field', onClick: () => edit(page.name, visual.name, 'Remove field', (vj) => removeProjection(vj, role.name, i)) },
      {
        label: 'Rename for this visual',
        onClick: async () => {
          const name = await promptDialog({ title: 'Rename for this visual', label: 'Name', value: labelOf(p) })
          if (name !== null) edit(page.name, visual.name, 'Rename field', (vj) => renameProjection(vj, role.name, i, name))
        }
      },
      {
        label: 'Move',
        submenu: [
          { label: 'Up', disabled: i === 0, onClick: () => edit(page.name, visual.name, 'Move field', (vj) => moveProjection(vj, role.name, i, role.name, i - 1)) },
          { label: 'Down', disabled: i === projections.length - 1, onClick: () => edit(page.name, visual.name, 'Move field', (vj) => moveProjection(vj, role.name, i, role.name, i + 2)) },
          ...roles
            .filter((r) => r.name !== role.name && !(r.kind === 'grouping' && info.kind === 'measure'))
            .map((r): MenuItem => ({ label: `To ${r.displayName}`, onClick: () => edit(page.name, visual.name, 'Move field', (vj) => moveProjection(vj, role.name, i, r.name, roleProjections(vj, r.name).length, { max: r.max })) }))
        ]
      }
    ]
    if (isCol) {
      items.push({ separator: true })
      if (role.kind !== 'measure') items.push({ label: "Don't summarize", checked: curAgg === null, onClick: () => edit(page.name, visual.name, 'Change aggregation', (vj) => setAggregation(vj, role.name, i, null)) })
      for (const a of AGG_MENU) items.push({ label: a.label, checked: curAgg === a.fn, onClick: () => edit(page.name, visual.name, 'Change aggregation', (vj) => setAggregation(vj, role.name, i, a.fn)) })
    }
    items.push({ separator: true })
    if (role.kind !== 'measure' && !isValueProjection(p.field)) {
      const on = getShowAll(visual.json, role.name)
      items.push({ label: 'Show items with no data', checked: on, onClick: () => edit(page.name, visual.name, 'Show items with no data', (vj) => setShowAll(vj, role.name, !on)) })
    }
    if (isValueProjection(p.field) && info.kind !== 'visualCalc') {
      const mode = getShowValueAs(p)
      items.push({
        label: 'Show value as',
        submenu: [
          { label: 'No calculation', checked: mode === 'none', onClick: () => edit(page.name, visual.name, 'Show value as', (vj) => setShowValueAs(vj, role.name, i, 'none')) },
          { label: 'Percent of grand total', checked: mode === 'percentOfGrandTotal', onClick: () => edit(page.name, visual.name, 'Show value as', (vj) => setShowValueAs(vj, role.name, i, 'percentOfGrandTotal')) }
        ]
      })
    }
    items.push({ label: 'New quick measure', onClick: () => void runModelingCommand('quickMeasure', { table: info.table, field: p.field }) })
    return items
  }

  return (
    <div className="wbi-well" onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setOver(null)}>
      <div className="wbi-well__title">
        {role.displayName}
        {role.name === 'Tooltips' || role.max === undefined ? null : role.max === 1 ? null : <span className="wbi-muted"> (max {role.max})</span>}
      </div>
      {projections.map((p, i) => (
        <div
          key={`${fieldKey(p.field)}${i}`}
          className={cx('wbi-well__pill', over === i && 'is-dropbefore')}
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData(PROJ_MIME, JSON.stringify({ role: role.name, index: i, page: page.name, visual: visual.name }))
            e.dataTransfer.effectAllowed = 'move'
          }}
          onDragOver={(e) => onDragOver(e, i)}
          onDrop={(e) => onDrop(e, i)}
          onContextMenu={(e) => showContextMenu(e, menu(p, i))}
          title={p.queryRef}
        >
          <span className="wbi-well__name">{labelOf(p)}</span>
          {p.displayName && <span className="wbi-well__renamed" title={`Renamed from ${p.nativeQueryRef ?? ''}`} />}
          <button type="button" className="wbi-well__btn" aria-label="Field options" onClick={(e) => showContextMenu(e.currentTarget.getBoundingClientRect(), menu(p, i))}>
            <ChevronDownRegular fontSize={12} />
          </button>
          <button type="button" className="wbi-well__btn" aria-label="Remove field" onClick={() => edit(page.name, visual.name, 'Remove field', (vj) => removeProjection(vj, role.name, i))}>
            <DismissRegular fontSize={12} />
          </button>
        </div>
      ))}
      {!full && (
        <div className={cx('wbi-well__drop', over === projections.length && 'is-over')} onDragOver={(e) => onDragOver(e, projections.length)} onDrop={(e) => onDrop(e, projections.length)}>
          Add data fields here
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------------------------
// Drill-through wells (page level)
// ---------------------------------------------------------------------------------------------

function editPage(page: string, label: string, fn: (pageJson: any) => void): void {
  useApp.getState().mutateReport(label, (r) => {
    const p = findPage(r, page)
    if (p) fn(p.json)
  })
}

/**
 * PBIR drill-through binding:
 *   page.json.pageBinding = { name, type: 'Drillthrough', referenceScope: 'Default' | 'CrossReport',
 *     parameters: [{ name, boundFilter: <filter card name>, fieldExpr }], acceptsFilterContext?: 'None' }
 *   + page filter card { name, field, type: 'Categorical', howCreated: 'Drillthrough' }.
 */
export function addDrillthroughField(pageJson: any, expr: SQExpr): boolean {
  const key = fieldKey(expr)
  const cards = filterCards(pageJson)
  if (cards.some((c) => c.howCreated === 'Drillthrough' && c.field && fieldKey(c.field) === key)) return false
  const cardName = newObjectName()
  pageJson.filterConfig ??= {}
  pageJson.filterConfig.filters ??= []
  pageJson.filterConfig.filters.push({ name: cardName, field: structuredClone(expr), type: 'Categorical', howCreated: 'Drillthrough' })
  const pb = (pageJson.pageBinding ??= { name: newObjectName(), type: 'Drillthrough', referenceScope: 'Default' })
  if (pb.type !== 'Drillthrough') {
    pb.type = 'Drillthrough'
    pb.referenceScope ??= 'Default'
  }
  pb.parameters ??= []
  pb.parameters.push({ name: newObjectName(), boundFilter: cardName, fieldExpr: structuredClone(expr) })
  return true
}

/**
 * PBI Desktop adds a Back button to the top-left corner of a page when its first drill-through field is added (unless
 * the page already has a button with a Back action), so users can return to the source page.
 */
export function addDrillthroughBackButton(page: PageDocument): string | undefined {
  const hasBack = page.visuals.some((v) => {
    const link = v.json?.visual?.visualContainerObjects?.visualLink?.[0]?.properties
    return link?.type?.expr?.Literal?.Value === "'Back'"
  })
  if (hasBack) return undefined
  const lit = (v: string | boolean) => ({ expr: { Literal: { Value: typeof v === 'string' ? `'${v}'` : String(v) } } })
  return addVisual(page, 'actionButton', { x: 16, y: 16, width: 32, height: 32 }, {
    objects: { icon: [{ properties: { shapeType: lit('back') }, selector: { id: 'default' } }] },
    visualContainerObjects: { visualLink: [{ properties: { show: lit(true), type: lit('Back') } }] }
  })
}

export function removeDrillthroughField(pageJson: any, cardName: string): void {
  if (pageJson.filterConfig?.filters) pageJson.filterConfig.filters = pageJson.filterConfig.filters.filter((f: any) => f.name !== cardName)
  const pb = pageJson.pageBinding
  if (pb?.parameters) {
    pb.parameters = pb.parameters.filter((p: any) => p.boundFilter !== cardName)
    if (!pb.parameters.length && pb.type === 'Drillthrough' && pb.referenceScope !== 'CrossReport') delete pageJson.pageBinding
  }
}

function DrillthroughWells({ page }: { page: PageDocument }) {
  const engine = useApp((s) => s.engine)
  const [over, setOver] = useState(false)
  const pj = page.json ?? {}
  if (pj.pageBinding?.type === 'Tooltip' || pj.type === 'Tooltip') return null
  const fields = drillthroughFields(page)
  const cross = pj.pageBinding?.referenceScope === 'CrossReport'
  const keepAll = keepsAllFilters(page)
  return (
    <div className="wbi-viz__drill">
      <div className="wbi-well__section">Drill through</div>
      <div className="wbi-fmt__row is-inline">
        <div className="wbi-fmt__label">
          <span>Cross-report</span>
        </div>
        <Toggle
          size="small"
          on={cross}
          onChange={(on) =>
            editPage(page.name, 'Drill through', (j) => {
              const pb = (j.pageBinding ??= { name: newObjectName(), type: 'Drillthrough', parameters: [] })
              pb.referenceScope = on ? 'CrossReport' : 'Default'
              if (!on && !(pb.parameters ?? []).length) delete j.pageBinding
            })
          }
        />
      </div>
      <div className="wbi-fmt__row is-inline">
        <div className="wbi-fmt__label">
          <span>Keep all filters</span>
        </div>
        <Toggle
          size="small"
          on={keepAll}
          onChange={(on) =>
            editPage(page.name, 'Drill through', (j) => {
              if (!j.pageBinding) return
              if (on) delete j.pageBinding.acceptsFilterContext
              else j.pageBinding.acceptsFilterContext = 'None'
            })
          }
        />
      </div>
      <div className="wbi-well">
        {fields.map((f) => (
          <div key={f.card.name} className="wbi-well__pill">
            <span className="wbi-well__name">{engine?.describeField(f.field)?.displayName ?? nativeName(f.field)}</span>
            <ArrowRightRegular fontSize={12} className="wbi-muted" />
            <button type="button" className="wbi-well__btn" aria-label="Remove drill-through field" onClick={() => editPage(page.name, 'Remove drill-through field', (j) => removeDrillthroughField(j, f.card.name))}>
              <DismissRegular fontSize={12} />
            </button>
          </div>
        ))}
        <div
          className={cx('wbi-well__drop', over && 'is-over')}
          onDragOver={(e) => {
            const f = draggingField()
            if (isFieldDrag(e) && f && f.kind !== 'table' && f.kind !== 'hierarchy') {
              e.preventDefault()
              setOver(true)
            }
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault()
            setOver(false)
            const f = readFieldDrag(e.dataTransfer)
            endFieldDrag()
            if (!f || f.kind === 'table' || f.kind === 'hierarchy') return
            const expr = fieldToSQ(f)[0]
            useApp.getState().mutateReport('Add drill-through field', (r) => {
              const p = findPage(r, page.name)
              if (!p) return
              const first = !drillthroughFields(p).length
              if (addDrillthroughField(p.json, expr) && first) addDrillthroughBackButton(p)
            })
          }}
        >
          Add drill-through fields here
        </div>
      </div>
    </div>
  )
}


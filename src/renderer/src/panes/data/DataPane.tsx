/**
 * Data pane (PBI Desktop): searchable model tree (tables → display folders → columns / measures /
 * hierarchies) with PBI icons, field checkboxes that add fields to the selected visual (or create
 * one), drag sources for wells / filters / canvas, inline rename, and context menus.
 */
import { useMemo, useState, type ReactNode } from 'react'
import { ChevronDownRegular, ChevronRightRegular, EyeOffRegular, MoreHorizontalRegular } from '@fluentui/react-icons'
import { useApp, type FieldSelection } from '../../state/store'
import { columnExpr } from '@core/report/sq'
import { findPage, findVisual } from '../../report/pbir'
import { Checkbox, IconButton, SearchBox, cx, showContextMenu, confirmDialog, promptDialog, toast, type MenuItem } from '../../app/ui'
import { insertVisual, refreshAll, runModelingCommand } from '../../app/commands'
import { PaneFrame } from '../PaneFrame'
import { endFieldDrag, startFieldDrag, type DraggedField } from '../fieldDrag'
import { addFilterCard } from '../filters/FiltersPane'
import { buildTree, expandableKeys, type TreeNode } from './tree'
import { ColumnIcon, FolderIcon, HierarchyIcon, MeasureIcon, TableIcon, isCalculatedTable } from './icons'
import { addFieldToVisual, newVisualForField, pickRole, removeFieldFromVisual, visualUsesField } from './visualFieldOps'
import { renameSelected } from '../../dialogs/modeling/fieldEdits'
import { addHierarchy, daxReference, deleteObject, isHidden, setDisplayFolder, setHidden, unhideAll, validateName, type ModelTarget } from './modelOps'
import './data.css'
import { propagateSlicerFields } from '../syncslicers/sync'

function dragFieldOf(n: TreeNode): DraggedField | null {
  switch (n.kind) {
    case 'table':
      return { kind: 'table', table: n.table.name }
    case 'column':
      return { kind: 'column', table: n.table, name: n.column.name }
    case 'measure':
      return { kind: 'measure', table: n.table, name: n.measure.name }
    case 'hierarchy':
      return { kind: 'hierarchy', table: n.table, name: n.hierarchy.name, levels: n.children.map((l) => (l.kind === 'level' ? l.level.name : '')).filter(Boolean) }
    case 'level':
      return { kind: 'hierarchyLevel', table: n.table, hierarchy: n.hierarchy, name: n.level.name }
    default:
      return null
  }
}

function targetOf(n: TreeNode): ModelTarget | null {
  switch (n.kind) {
    case 'table':
      return { kind: 'table', table: n.table.name }
    case 'column':
      return { kind: 'column', table: n.table, name: n.column.name }
    case 'measure':
      return { kind: 'measure', table: n.table, name: n.measure.name }
    case 'hierarchy':
      return { kind: 'hierarchy', table: n.table, name: n.hierarchy.name }
    default:
      return null
  }
}

function selectionOf(n: TreeNode): FieldSelection | null {
  switch (n.kind) {
    case 'table':
      return { kind: 'table', table: n.table.name }
    case 'column':
      return { kind: 'column', table: n.table, name: n.column.name }
    case 'measure':
      return { kind: 'measure', table: n.table, name: n.measure.name }
    case 'hierarchy':
      return { kind: 'hierarchy', table: n.table, name: n.hierarchy.name }
    case 'level':
      return n.column ? { kind: 'column', table: n.table, name: n.column.name } : { kind: 'hierarchy', table: n.table, name: n.hierarchy }
    default:
      return null
  }
}

function sameSelection(a: FieldSelection | null, b: FieldSelection | null): boolean {
  if (!a || !b || a.kind !== b.kind || a.table !== b.table) return false
  return a.kind === 'table' || (a as { name: string }).name === (b as { name: string }).name
}

function nodeLabel(n: TreeNode): string {
  switch (n.kind) {
    case 'table':
      return n.table.name
    case 'folder':
      return n.name
    case 'column':
      return n.column.name
    case 'measure':
      return n.measure.name
    case 'hierarchy':
      return n.hierarchy.name
    case 'level':
      return n.level.name
  }
}

export function DataPane() {
  const project = useApp((s) => s.project)
  const view = useApp((s) => s.view)
  const editMode = useApp((s) => s.editMode)
  const selectedField = useApp((s) => s.selectedField)
  const selectedVisuals = useApp((s) => s.selectedVisuals)
  const activePage = useApp((s) => s.activePage)
  const [search, setSearch] = useState('')
  const [showHidden, setShowHidden] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const [renaming, setRenaming] = useState<string | null>(null)

  const model = project?.model
  const report = project?.report
  const tree = useMemo(() => buildTree(model, { search, showHidden }), [model, search, showHidden])
  const page = findPage(report, activePage)
  const selVisual = view === 'report' && editMode && selectedVisuals.length === 1 ? findVisual(page, selectedVisuals[0]) : undefined
  const showChecks = view === 'report' && !!report && editMode && (!selVisual || !!selVisual.json?.visual)
  const searching = !!search.trim()
  const isOpen = (key: string) => searching || expanded.has(key)
  const toggle = (key: string) =>
    setExpanded((s) => {
      const n = new Set(s)
      if (n.has(key)) n.delete(key)
      else n.add(key)
      return n
    })

  const paneMenu = (): MenuItem[] => [
    { label: 'View hidden', checked: showHidden, onClick: () => setShowHidden(!showHidden) },
    { label: 'Unhide all', disabled: !model, onClick: () => useApp.getState().mutateModel('Unhide all', unhideAll) },
    { separator: true },
    { label: 'Expand all', onClick: () => setExpanded(new Set(expandableKeys(buildTree(model, { showHidden })))) },
    { label: 'Collapse all', onClick: () => setExpanded(new Set()) }
  ]

  // ---------------------------------------------------------------- field ↔ visual
  const toggleField = (f: DraggedField) => {
    const app = useApp.getState()
    if (selVisual && activePage) {
      const used = visualUsesField(selVisual.json, f)
      if (!used && !pickRole(selVisual.json, f, model)) {
        toast({ kind: 'info', message: "This visual doesn't have a field well for that field." })
        return
      }
      app.mutateReport(used ? 'Remove field' : 'Add field', (r) => {
        const v = findVisual(findPage(r, activePage), selVisual.name)
        if (!v) return
        if (used) removeFieldFromVisual(v.json, f)
        else addFieldToVisual(v.json, f, model)
        propagateSlicerFields(r, activePage, selVisual.name)
      })
    } else {
      const { visualType, visual } = newVisualForField(f, model)
      insertVisual(visualType, visual)
    }
  }

  // ---------------------------------------------------------------- rename
  const commitRename = (target: ModelTarget, value: string) => {
    setRenaming(null)
    if (!model) return
    const old = target.kind === 'table' ? target.table : target.name
    if (value.trim() === old) return
    const err = validateName(model, target, value)
    if (err) {
      toast({ kind: 'error', title: "Couldn't rename", message: err })
      return
    }
    // Full rename refactor: DAX expressions, relationships, sort-by, hierarchies, roles, diagram layout and PBIR field references.
    if (!renameSelected(target as FieldSelection, value)) return
    const sel = useApp.getState().selectedField
    if (sel && sel.table === target.table) {
      if (target.kind === 'table') useApp.getState().selectField({ ...sel, table: value.trim() } as FieldSelection)
      else if (sel.kind === target.kind && (sel as { name: string }).name === target.name) useApp.getState().selectField({ ...sel, name: value.trim() } as FieldSelection)
    }
  }

  // ---------------------------------------------------------------- context menus
  const deleteTarget = async (t: ModelTarget) => {
    const what = t.kind === 'table' ? `the table '${t.table}'` : `'${t.name}'`
    const r = await confirmDialog({ title: `Delete ${t.kind}`, message: `Are you sure you want to delete ${what}? Visuals that use it will show an error.`, buttons: ['Delete', 'Cancel'] })
    if (r !== 0) return
    useApp.getState().mutateModel(`Delete ${t.kind}`, (m) => deleteObject(m, t))
    useApp.getState().selectField(null)
  }
  const hideItem = (t: ModelTarget): MenuItem => {
    const hidden = model ? isHidden(model, t) : false
    return { label: hidden ? 'Unhide' : 'Hide', checked: hidden, onClick: () => useApp.getState().mutateModel(hidden ? 'Unhide' : 'Hide', (m) => setHidden(m, t, !hidden)) }
  }
  const copyItem = (t: ModelTarget): MenuItem => ({ label: 'Copy name', onClick: () => void navigator.clipboard?.writeText(daxReference(t)).catch(() => undefined) })
  const viewItems = (): MenuItem[] => [{ separator: true }, ...paneMenu()]

  const menuFor = (n: TreeNode): MenuItem[] => {
    const app = useApp.getState()
    const sel = selectionOf(n)
    const target = targetOf(n)
    const modeling = (cmd: Parameters<typeof runModelingCommand>[0]) => () => {
      if (sel) app.selectField(sel)
      void runModelingCommand(cmd)
    }
    if (n.kind === 'table' && target) {
      const calc = isCalculatedTable(n.table)
      return [
        { label: 'New measure', onClick: modeling('newMeasure') },
        { label: 'New column', onClick: modeling('newColumn') },
        { label: 'New quick measure', onClick: modeling('quickMeasure') },
        { separator: true },
        { label: 'Refresh data', disabled: calc, onClick: () => refreshAll([n.table.name]) },
        { label: 'Edit query', disabled: calc, onClick: () => (app.selectField({ kind: 'table', table: n.table.name }), app.setView('powerquery')) },
        { label: 'Manage relationships', onClick: modeling('manageRelationships') },
        { separator: true },
        { label: 'Rename', onClick: () => setRenaming(n.key) },
        { label: 'Delete from model', onClick: () => void deleteTarget(target) },
        hideItem(target),
        { label: 'Mark as date table', onClick: () => (app.selectField({ kind: 'table', table: n.table.name }), void runModelingCommand('markAsDateTable', n.table.name)) },
        copyItem(target),
        ...viewItems()
      ]
    }
    if (n.kind === 'column' && target && target.kind === 'column') {
      const expr = columnExpr(n.table, n.column.name)
      const filterItems: MenuItem[] = [
        { label: 'Visual-level filters', disabled: !selVisual || !activePage, onClick: () => selVisual && activePage && addFilterCard({ level: 'visual', page: activePage, visual: selVisual.name }, expr) },
        { label: 'Page-level filters', disabled: !activePage || !report, onClick: () => activePage && addFilterCard({ level: 'page', page: activePage }, expr) },
        { label: 'Report-level filters', disabled: !report, onClick: () => addFilterCard({ level: 'report' }, expr) }
      ]
      return [
        { label: 'New hierarchy', onClick: () => app.mutateModel('New hierarchy', (m) => void addHierarchy(m, n.table, n.column.name)) },
        { label: 'New measure', onClick: modeling('newMeasure') },
        { label: 'New column', onClick: modeling('newColumn') },
        { separator: true },
        { label: 'Rename', onClick: () => setRenaming(n.key) },
        { label: 'Delete from model', onClick: () => void deleteTarget(target) },
        hideItem(target),
        { label: 'Add to filters', disabled: !report, submenu: filterItems },
        copyItem(target),
        ...viewItems()
      ]
    }
    if (n.kind === 'measure' && target) {
      return [
        { label: 'New measure', onClick: modeling('newMeasure') },
        { label: 'New quick measure', onClick: modeling('quickMeasure') },
        { separator: true },
        { label: 'Rename', onClick: () => setRenaming(n.key) },
        { label: 'Delete from model', onClick: () => void deleteTarget(target) },
        hideItem(target),
        {
          label: 'Display folder…',
          onClick: async () => {
            const v = await promptDialog({ title: 'Display folder', label: 'Folder (use \\ for subfolders)', value: n.measure.displayFolder ?? '' })
            if (v !== null) app.mutateModel('Set display folder', (m) => setDisplayFolder(m, target, v))
          }
        },
        copyItem(target),
        ...viewItems()
      ]
    }
    if (n.kind === 'hierarchy' && target) {
      return [{ label: 'Rename', onClick: () => setRenaming(n.key) }, { label: 'Delete from model', onClick: () => void deleteTarget(target) }, hideItem(target), ...viewItems()]
    }
    return paneMenu()
  }

  // ---------------------------------------------------------------- rows
  const renderNode = (n: TreeNode, depth: number): ReactNode => {
    const expandable = n.kind === 'table' || n.kind === 'folder' || n.kind === 'hierarchy'
    const open = expandable && isOpen(n.key)
    const sel = selectionOf(n)
    const field = dragFieldOf(n)
    const target = targetOf(n)
    const hidden = n.kind === 'table' ? !!n.table.isHidden : n.kind === 'column' ? !!n.column.isHidden : n.kind === 'measure' ? !!n.measure.isHidden : n.kind === 'hierarchy' ? !!n.hierarchy.isHidden : false
    const checkable = showChecks && n.kind !== 'table' && n.kind !== 'folder' && !!field
    const used = checkable && selVisual && field ? visualUsesField(selVisual.json, field) : false
    const label = nodeLabel(n)
    const icon =
      n.kind === 'table' ? <TableIcon table={n.table} /> : n.kind === 'folder' ? <FolderIcon /> : n.kind === 'column' ? <ColumnIcon column={n.column} /> : n.kind === 'measure' ? <MeasureIcon /> : n.kind === 'hierarchy' ? <HierarchyIcon /> : n.column ? <ColumnIcon column={n.column} /> : null
    const tip = n.kind === 'measure' ? n.measure.description || n.measure.expression : n.kind === 'column' ? n.column.description || (n.column.kind === 'calculated' ? n.column.expression : undefined) : n.kind === 'table' ? n.table.description : undefined
    return (
      <div key={n.key} role="treeitem" aria-expanded={expandable ? open : undefined}>
        <div
          className={cx('wbi-dtree__row', n.kind === 'table' && 'is-table', sameSelection(sel, selectedField) && 'is-selected', hidden && 'is-hidden')}
          style={{ paddingLeft: 6 + depth * 14 }}
          draggable={!!field && n.kind !== 'table' && renaming !== n.key}
          onDragStart={(e) => field && startFieldDrag(e, field)}
          onDragEnd={endFieldDrag}
          onClick={() => {
            if (expandable) toggle(n.key)
            if (sel) useApp.getState().selectField(sel)
          }}
          onDoubleClick={() => target && editMode && setRenaming(n.key)}
          onContextMenu={(e) => showContextMenu(e, menuFor(n))}
          title={tip}
        >
          <span className="wbi-dtree__chev">{expandable ? open ? <ChevronDownRegular fontSize={12} /> : <ChevronRightRegular fontSize={12} /> : null}</span>
          {showChecks && <span className="wbi-dtree__check">{checkable && field ? <Checkbox checked={used} onChange={() => toggleField(field)} title={used ? 'Remove from visual' : 'Add to visual'} /> : null}</span>}
          <span className="wbi-dtree__icon">{icon}</span>
          {renaming === n.key && target ? (
            <input
              autoFocus
              className="wbi-dtree__rename"
              defaultValue={label}
              onClick={(e) => e.stopPropagation()}
              onFocus={(e) => e.currentTarget.select()}
              onBlur={(e) => commitRename(target, e.currentTarget.value)}
              onKeyDown={(e) => {
                e.stopPropagation()
                if (e.key === 'Enter') e.currentTarget.blur()
                if (e.key === 'Escape') setRenaming(null)
              }}
            />
          ) : (
            <span className="wbi-dtree__name">{label}</span>
          )}
          {hidden && <EyeOffRegular className="wbi-dtree__hidden" fontSize={14} />}
        </div>
        {open && 'children' in n && <div role="group">{n.children.map((c) => renderNode(c, depth + 1))}</div>}
      </div>
    )
  }

  return (
    <PaneFrame
      id="data"
      title="Data"
      collapsible
      actions={
        model ? (
          <IconButton
            icon={<MoreHorizontalRegular fontSize={16} />}
            label="More options"
            onClick={(e) => {
              const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
              showContextMenu({ x: r.left, y: r.bottom }, paneMenu())
            }}
          />
        ) : undefined
      }
      subheader={
        model ? (
          <div className="wbi-pane__search">
            <SearchBox value={search} onChange={setSearch} placeholder="Search" size="small" />
          </div>
        ) : undefined
      }
    >
      {!model || !model.tables.length ? (
        <div className="wbi-pane__empty">{model ? 'Once loaded, your data will appear here.' : 'Open a report or semantic model to see its tables and fields.'}</div>
      ) : (
        <div className="wbi-dtree" role="tree" aria-label="Data" onContextMenu={(e) => e.target === e.currentTarget && showContextMenu(e, paneMenu())}>
          {tree.map((n) => renderNode(n, 0))}
          {!tree.length && <div className="wbi-pane__empty">No fields match "{search}".</div>}
        </div>
      )}
    </PaneFrame>
  )
}

/**
 * Queries pane (left): "Queries [N]" with the collapse arrow, queries grouped by query group (folder
 * rows, "Other Queries" for ungrouped ones when groups exist), per-kind icons (table / parameter /
 * function), italic names for queries with load disabled, a warning icon when the last preview
 * failed, inline rename (F2 / double-click) and Power BI's right-click menu.
 */
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { BracesVariableRegular, ChevronDownRegular, ChevronLeftRegular, ChevronRightRegular, FolderRegular, TableRegular, WarningFilled, DocumentTextRegular } from '@fluentui/react-icons'
import { cx, showContextMenu, type MenuItem } from '../../app/ui'
import { groupsOf, type DraftQuery } from './logic/draft'
import { usePq } from './pqStore'
import { openPqDialog } from './pqDialogs'
import { deleteQueryAction, duplicateQueryAction, newBlankQuery, newGroupAction, patchQuery, referenceQueryAction, renameQueryAction, selectQuery, setQueryGroup, toggleLoad } from './actions'

const OTHER = '\u0000other'

export function QueryIcon({ q }: { q: Pick<DraftQuery, 'kind' | 'source'> }) {
  if (q.kind === 'function') return <span className="wbi-pq-fx">fx</span>
  if (q.kind === 'parameter') return <BracesVariableRegular fontSize={16} className="wbi-pq-qicon wbi-pq-qicon--param" />
  if (q.kind === 'query' && !/^\s*let\b/.test(q.source) && /^\s*"/.test(q.source)) return <DocumentTextRegular fontSize={16} className="wbi-pq-qicon" />
  return <TableRegular fontSize={16} className="wbi-pq-qicon" />
}

function queryMenu(q: DraftQuery, groups: string[], rename: () => void): MenuItem[] {
  const canLoad = q.kind !== 'parameter' && q.kind !== 'function'
  return [
    { label: 'Copy', disabled: true },
    { label: 'Paste', disabled: true },
    { separator: true },
    { label: 'Delete', shortcut: 'Del', onClick: () => void deleteQueryAction(q.id) },
    { label: 'Rename', shortcut: 'F2', onClick: rename },
    { label: 'Enable load', checked: canLoad && q.loadEnabled, disabled: !canLoad, onClick: () => toggleLoad(q.id) },
    { label: 'Include in report refresh', checked: canLoad && q.loadEnabled, disabled: true, title: 'Follows Enable load in Lumen' },
    { separator: true },
    { label: 'Duplicate', onClick: () => duplicateQueryAction(q.id) },
    { label: 'Reference', onClick: () => referenceQueryAction(q.id) },
    { separator: true },
    {
      label: 'Move To Group',
      submenu: [
        ...groups.map<MenuItem>((g) => ({ label: g, checked: q.group === g, onClick: () => setQueryGroup(q.id, g) })),
        { label: 'Other Queries', checked: !q.group, onClick: () => setQueryGroup(q.id, undefined) },
        { separator: true },
        { label: 'New Group…', onClick: () => void newGroupAction(q.id) }
      ]
    },
    { separator: true },
    { label: 'Advanced Editor', onClick: () => openPqDialog({ id: 'advanced', queryId: q.id }) },
    { label: 'Properties…', onClick: () => openPqDialog({ id: 'properties', queryId: q.id }) }
  ]
}

function groupMenu(group: string | null, queries: DraftQuery[], collapseAll: (v: boolean) => void): MenuItem[] {
  const items: MenuItem[] = [
    { label: 'New Query', submenu: [{ label: 'Blank Query', onClick: newBlankQuery }, { label: 'Enter Data', onClick: () => openPqDialog({ id: 'enterData' }) }] },
    { label: 'New Group…', onClick: () => void newGroupAction() },
    { separator: true },
    { label: 'Collapse All', onClick: () => collapseAll(true) },
    { label: 'Expand All', onClick: () => collapseAll(false) }
  ]
  if (group) {
    items.splice(2, 0, {
      label: 'Ungroup',
      onClick: () => {
        for (const q of queries) if (q.group === group) patchQuery(q.id, { group: undefined })
        const s = usePq.getState()
        usePq.setState({ draft: { ...s.draft, groups: s.draft.groups.filter((g) => g !== group) } })
      }
    })
  }
  return items
}

function RenameInput({ value, onDone }: { value: string; onDone(v: string | null): void }) {
  const ref = useRef<HTMLInputElement>(null)
  const [v, setV] = useState(value)
  useEffect(() => {
    ref.current?.focus()
    ref.current?.select()
  }, [])
  const key = (e: KeyboardEvent<HTMLInputElement>) => {
    e.stopPropagation()
    if (e.key === 'Enter') onDone(v)
    if (e.key === 'Escape') onDone(null)
  }
  return <input ref={ref} className="wbi-pq-rename" value={v} onChange={(e) => setV(e.target.value)} onKeyDown={key} onBlur={() => onDone(v)} spellCheck={false} />
}

function QueryRow({ q, groups, indent }: { q: DraftQuery; groups: string[]; indent: boolean }) {
  const selected = usePq((s) => s.selectedId === q.id)
  const failed = usePq((s) => !!s.errors[q.id])
  const renaming = usePq((s) => s.renamingQuery === q.id)
  const startRename = () => usePq.setState({ renamingQuery: q.id })
  return (
    <div
      role="treeitem"
      aria-selected={selected}
      tabIndex={selected ? 0 : -1}
      className={cx('wbi-pq-qrow', selected && 'is-selected', indent && 'is-indented')}
      onClick={() => selectQuery(q.id)}
      onDoubleClick={startRename}
      onContextMenu={(e) => {
        selectQuery(q.id)
        showContextMenu(e, queryMenu(q, groups, startRename))
      }}
      onKeyDown={(e) => {
        if (renaming) return
        if (e.key === 'F2') startRename()
        if (e.key === 'Delete') void deleteQueryAction(q.id)
      }}
      title={q.description || q.name}
    >
      <QueryIcon q={q} />
      {renaming ? (
        <RenameInput
          value={q.name}
          onDone={(v) => {
            usePq.setState({ renamingQuery: null })
            if (v !== null) renameQueryAction(q.id, v)
          }}
        />
      ) : (
        <span className={cx('wbi-pq-qname', !q.loadEnabled && q.kind !== 'parameter' && q.kind !== 'function' && 'is-noload')}>{q.name}</span>
      )}
      {failed && <WarningFilled fontSize={14} className="wbi-pq-qwarn" />}
    </div>
  )
}

export function QueriesPane() {
  const draft = usePq((s) => s.draft)
  const collapsed = usePq((s) => s.view.queriesCollapsed)
  const setView = usePq((s) => s.setView)
  const [closed, setClosed] = useState<Record<string, boolean>>({})
  const groups = groupsOf(draft)
  const n = draft.queries.length

  if (collapsed)
    return (
      <aside className="wbi-pq-queries is-collapsed" onClick={() => setView({ queriesCollapsed: false })} title="Expand the Queries pane">
        <button type="button" className="wbi-pq-pane-toggle" aria-label="Expand">
          <ChevronRightRegular fontSize={14} />
        </button>
        <span className="wbi-pq-vertical">Queries</span>
      </aside>
    )

  const sections: Array<{ key: string; label: string | null; items: DraftQuery[] }> = groups.length
    ? [...groups.map((g) => ({ key: g, label: g, items: draft.queries.filter((q) => q.group === g) })), { key: OTHER, label: 'Other Queries', items: draft.queries.filter((q) => !q.group || !groups.includes(q.group)) }]
    : [{ key: OTHER, label: null, items: draft.queries }]
  const setAll = (v: boolean) => setClosed(Object.fromEntries(sections.map((s) => [s.key, v])))

  return (
    <aside className="wbi-pq-queries" onContextMenu={(e) => e.target === e.currentTarget && showContextMenu(e, groupMenu(null, draft.queries, setAll))}>
      <div className="wbi-pq-pane-head">
        <span className="wbi-pq-pane-title">
          Queries <span className="wbi-pq-count">[{n}]</span>
        </span>
        <button type="button" className="wbi-pq-pane-toggle" aria-label="Collapse the Queries pane" title="Collapse" onClick={() => setView({ queriesCollapsed: true })}>
          <ChevronLeftRegular fontSize={14} />
        </button>
      </div>
      <div className="wbi-pq-qlist" role="tree" onContextMenu={(e) => e.target === e.currentTarget && showContextMenu(e, groupMenu(null, draft.queries, setAll))}>
        {sections.map((sec) => {
          if (sec.label === null) return sec.items.map((q) => <QueryRow key={q.id} q={q} groups={groups} indent={false} />)
          if (sec.key === OTHER && !sec.items.length) return null
          const isClosed = !!closed[sec.key]
          return (
            <div key={sec.key} className="wbi-pq-qgroup">
              <div
                className="wbi-pq-qgroup__head"
                onClick={() => setClosed((c) => ({ ...c, [sec.key]: !isClosed }))}
                onContextMenu={(e) => showContextMenu(e, groupMenu(sec.key === OTHER ? null : sec.key, draft.queries, setAll))}
              >
                {isClosed ? <ChevronRightRegular fontSize={12} /> : <ChevronDownRegular fontSize={12} />}
                <FolderRegular fontSize={16} className="wbi-pq-folder" />
                <span className="wbi-pq-qname">{sec.label}</span>
                <span className="wbi-pq-count">[{sec.items.length}]</span>
              </div>
              {!isClosed && sec.items.map((q) => <QueryRow key={q.id} q={q} groups={groups} indent />)}
            </div>
          )
        })}
      </div>
    </aside>
  )
}

/**
 * PBI Navigator: tree of items (tables / sheets / views) with checkboxes on the left, a preview of the
 * focused item on the right, and Load / Transform data / Cancel.
 */
import { useEffect, useMemo, useState, type ReactElement } from 'react'
import { DocumentTableRegular, TableRegular, EyeRegular, FolderRegular, DocumentRegular, CodeRegular, ChevronDownRegular } from '@fluentui/react-icons'
import type { Scalar } from '@core/model/data'
import type { DataType } from '@core/model/types'
import { Button, Checkbox, Modal, SearchBox, Spinner } from '../../app/ui'
import { cx } from '../../app/ui/cx'
import type { NavItem } from './readers'
import type { ParsedTable } from './parsers'

const ICON: Record<NavItem['kind'], ReactElement> = {
  sheet: <DocumentTableRegular fontSize={16} />,
  table: <TableRegular fontSize={16} />,
  view: <EyeRegular fontSize={16} />,
  file: <DocumentRegular fontSize={16} />,
  folder: <FolderRegular fontSize={16} />,
  query: <CodeRegular fontSize={16} />
}

const TYPE_LABEL: Record<DataType, string> = {
  string: 'ABC',
  int64: '123',
  double: '1.2',
  decimal: '$',
  boolean: 'T/F',
  dateTime: 'DATE',
  binary: 'BIN',
  variant: 'ANY',
  unknown: 'ANY'
}

export function formatCell(v: Scalar): string {
  if (v === null || v === undefined) return 'null'
  if (v instanceof Date) {
    const p = (n: number) => String(n).padStart(2, '0')
    const d = `${v.getUTCMonth() + 1}/${v.getUTCDate()}/${v.getUTCFullYear()}`
    return v.getUTCHours() || v.getUTCMinutes() || v.getUTCSeconds() ? `${d} ${p(v.getUTCHours())}:${p(v.getUTCMinutes())}:${p(v.getUTCSeconds())}` : d
  }
  if (v instanceof Uint8Array) return 'Binary'
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE'
  return String(v)
}

export function PreviewTable({ table, max = 30 }: { table: ParsedTable; max?: number }) {
  return (
    <table className="wbi-table">
      <thead>
        <tr>
          {table.columns.map((c, i) => (
            <th key={i}>
              <span className="wbi-typechip">{TYPE_LABEL[table.types[i]] ?? 'ANY'}</span>
              {c}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {table.rows.slice(0, max).map((r, i) => (
          <tr key={i}>
            {table.columns.map((_, c) => (
              <td key={c} style={r[c] === null ? { color: 'var(--wbi-fg-4)', fontStyle: 'italic' } : typeof r[c] === 'number' ? { textAlign: 'right' } : undefined}>
                {formatCell(r[c])}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export interface NavigatorProps {
  title: string
  items: NavItem[]
  onLoad(items: NavItem[], previews: Map<string, ParsedTable>, transform: boolean): Promise<void> | void
  onCancel(): void
  busy?: string | null
}

export function Navigator({ title, items, onLoad, onCancel, busy }: NavigatorProps) {
  const [q, setQ] = useState('')
  const [checked, setChecked] = useState<Set<string>>(() => new Set(items.length === 1 ? [items[0].id] : []))
  const [focus, setFocus] = useState<string | null>(items[0]?.id ?? null)
  const [previews, setPreviews] = useState<Map<string, ParsedTable>>(() => new Map(items.filter((i) => i.data).map((i) => [i.id, i.data!])))
  const [loading, setLoading] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  const focused = items.find((i) => i.id === focus)
  useEffect(() => {
    if (!focused || previews.has(focused.id) || !focused.load) return
    let cancelled = false
    setLoading(focused.id)
    setError(null)
    focused
      .load()
      .then((t) => !cancelled && setPreviews((m) => new Map(m).set(focused.id, t)))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)))
      // not guarded by `cancelled`: storing the preview re-runs this effect (previews is a dependency), whose cleanup
      // cancels this run before `finally` — the spinner would stay forever. Only clear our own loading marker.
      .finally(() => setLoading((l) => (l === focused.id ? null : l)))
    return () => {
      cancelled = true
    }
  }, [focused, previews])

  const visible = useMemo(() => (q ? items.filter((i) => i.label.toLowerCase().includes(q.toLowerCase())) : items), [items, q])
  const groups = useMemo(() => {
    const m = new Map<string, NavItem[]>()
    for (const i of visible) {
      const g = i.group ?? ''
      if (!m.has(g)) m.set(g, [])
      m.get(g)!.push(i)
    }
    return [...m]
  }, [visible])

  const toggle = (id: string, on: boolean) =>
    setChecked((s) => {
      const n = new Set(s)
      if (on) n.add(id)
      else n.delete(id)
      return n
    })
  const selected = items.filter((i) => checked.has(i.id))
  const preview = focused ? previews.get(focused.id) : undefined

  return (
    <Modal
      title="Navigator"
      onClose={onCancel}
      width="min(1100px, calc(100vw - 64px))"
      height="min(720px, calc(100vh - 64px))"
      footerLeft={busy ? <Spinner label={busy} /> : <span className="wbi-nav__note">{selected.length ? `${selected.length} item${selected.length === 1 ? '' : 's'} selected` : 'Select one or more items to load'}</span>}
      footer={
        <>
          <Button variant="primary" disabled={!selected.length || !!busy} onClick={() => void onLoad(selected, previews, false)}>
            Load
          </Button>
          <Button disabled={!selected.length || !!busy} onClick={() => void onLoad(selected, previews, true)}>
            Transform data
          </Button>
          <Button onClick={onCancel}>Cancel</Button>
        </>
      }
    >
      <div className="wbi-nav">
        <div className="wbi-nav__left">
          <SearchBox value={q} onChange={setQ} />
          <div className="wbi-nav__note">Display options: {items.length} item{items.length === 1 ? '' : 's'} in {title}</div>
          <div className="wbi-nav__tree" role="tree">
            {groups.map(([g, list]) => (
              <div key={g || '_'} role="group">
                {g && (
                  <div
                    className="wbi-nav__group"
                    onClick={() =>
                      setCollapsed((s) => {
                        const n = new Set(s)
                        if (n.has(g)) n.delete(g)
                        else n.add(g)
                        return n
                      })
                    }
                  >
                    <ChevronDownRegular fontSize={12} style={{ transform: collapsed.has(g) ? 'rotate(-90deg)' : undefined }} />
                    <DocumentTableRegular fontSize={14} /> {g} [{list.length}]
                  </div>
                )}
                {!collapsed.has(g) &&
                  list.map((i) => (
                    <div key={i.id} role="treeitem" aria-selected={focus === i.id} className={cx('wbi-nav__item', focus === i.id && 'is-focused')} style={g ? undefined : { paddingLeft: 8 }} onClick={() => setFocus(i.id)}>
                      <Checkbox checked={checked.has(i.id)} onChange={(on) => toggle(i.id, on)} />
                      <span className="wbi-nav__item-icon">{ICON[i.kind]}</span>
                      <span className="wbi-nav__item-label" title={i.label}>
                        {i.label}
                      </span>
                    </div>
                  ))}
              </div>
            ))}
            {!visible.length && <div className="wbi-pane__empty">No items match your search.</div>}
          </div>
        </div>
        <div className="wbi-nav__right">
          <div className="wbi-nav__title">
            {focused ? ICON[focused.kind] : null}
            {focused?.label ?? ''}
          </div>
          <div className="wbi-nav__preview">
            {loading ? (
              <div className="wbi-nav__empty">
                <Spinner label="Loading preview…" />
              </div>
            ) : error ? (
              <div className="wbi-nav__empty">
                <div className="wbi-dlg-error">{error}</div>
              </div>
            ) : preview ? (
              <PreviewTable table={preview} />
            ) : (
              <div className="wbi-nav__empty">Select an item to preview its data.</div>
            )}
          </div>
          {preview && (
            <div className="wbi-nav__note">
              {preview.truncated || preview.rows.length > 30 ? `The preview shows the first 30 of ${preview.truncated ? 'many' : preview.rows.length.toLocaleString()} rows.` : `${preview.rows.length.toLocaleString()} rows.`}
            </div>
          )}
        </div>
      </div>
    </Modal>
  )
}

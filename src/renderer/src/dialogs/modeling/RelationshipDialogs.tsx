/** Manage relationships + Create/Edit relationship dialogs (Power BI Desktop layout). */
import { useMemo, useState } from 'react'
import { Button, Checkbox, Dropdown, Modal } from '../../app/ui'
import { useApp } from '../../state/store'
import type { RelationshipDef, SemanticModel } from '@core/model/types'
import type { ColumnData, Scalar } from '@core/model/data'
import { CARDINALITY_LABELS, detectCardinality, draftFromRelationship, isUnique, relationshipFromDraft, suggestColumns, uiCardinality, validateDraft, type RelationshipDraft, type UiCardinality } from './logic/relationships'
import { columnValues, tableData } from './context'
import { formatCell } from '../../views/data/formatCell'
import { cx } from '../../app/ui'
import { confirmDialog } from '../../app/ui/Modal'
import './modeling.css'

/** A column's stored data (values + the data type the engine inferred when the definition declares none). */
function columnData(table: string, column: string): ColumnData | undefined {
  const lower = column.toLowerCase()
  return tableData(table)?.columns.find((c) => c.name.toLowerCase() === lower)
}

const relLabel = (r: RelationshipDef): { from: string; to: string } => ({ from: `${r.fromTable} (${r.fromColumn})`, to: `${r.toTable} (${r.toColumn})` })

export function ManageRelationshipsDialog({ onClose }: { onClose(): void }) {
  const model = useApp((s) => s.project?.model)
  const [selected, setSelected] = useState<string[]>([])
  const [editing, setEditing] = useState<{ name?: string } | null>(null)
  if (!model) return null
  const rels = [...model.relationships].sort((a, b) => `${a.fromTable}${a.fromColumn}`.localeCompare(`${b.fromTable}${b.fromColumn}`))
  const toggleActive = (r: RelationshipDef) => {
    if (r.isActive === false) {
      const draft = { ...draftFromRelationship(r), isActive: true }
      const check = validateDraft(model, draft, {}, r)
      const blocking = check.errors.find((e) => e.includes('active'))
      if (blocking) {
        void confirmDialog({ title: 'Manage relationships', message: blocking, buttons: ['OK'] })
        return
      }
    }
    useApp.getState().mutateModel(r.isActive === false ? 'Activate relationship' : 'Deactivate relationship', (m) => {
      const x = m.relationships.find((y) => y.name === r.name)
      if (x) x.isActive = x.isActive === false
    })
  }
  const remove = async () => {
    if (!selected.length) return
    const ok = await confirmDialog({ title: 'Delete relationship', message: `Are you sure you want to delete ${selected.length === 1 ? 'this relationship' : `these ${selected.length} relationships`}?`, buttons: ['Delete', 'Cancel'] })
    if (ok !== 0) return
    useApp.getState().mutateModel('Delete relationship', (m) => {
      m.relationships = m.relationships.filter((r) => !selected.includes(r.name))
    })
    setSelected([])
  }
  const autodetect = () => {
    const found = autodetectRelationships(model)
    if (!found.length) {
      void confirmDialog({ title: 'Autodetect', message: 'Found no new relationships.', buttons: ['Close'] })
      return
    }
    useApp.getState().mutateModel('Autodetect relationships', (m) => m.relationships.push(...found))
    void confirmDialog({ title: 'Autodetect', message: `Found ${found.length} new relationship${found.length > 1 ? 's' : ''}.`, buttons: ['Close'] })
  }
  return (
    <>
      <Modal
        title="Manage relationships"
        onClose={onClose}
        width={860}
        footerLeft={
          <div style={{ display: 'flex', gap: 8 }}>
            <Button onClick={() => setEditing({})}>New…</Button>
            <Button onClick={autodetect}>Autodetect…</Button>
            <Button disabled={selected.length !== 1} onClick={() => setEditing({ name: selected[0] })}>
              Edit…
            </Button>
            <Button disabled={!selected.length} onClick={remove}>
              Delete
            </Button>
          </div>
        }
        footer={<Button onClick={onClose}>Close</Button>}
      >
        <div className="wbi-rels">
          <div className="wbi-rels__head">
            <span>Active</span>
            <span>From: Table (Column)</span>
            <span>To: Table (Column)</span>
            <span>Cardinality</span>
            <span>Cross-filter</span>
          </div>
          <div className="wbi-rels__body">
            {!rels.length && <div className="wbi-rels__empty">There are no relationships defined yet.</div>}
            {rels.map((r) => {
              const l = relLabel(r)
              const sel = selected.includes(r.name)
              return (
                <div
                  key={r.name}
                  className={cx('wbi-rels__row', sel && 'is-selected')}
                  onClick={(e) => setSelected(e.ctrlKey || e.metaKey ? (sel ? selected.filter((n) => n !== r.name) : [...selected, r.name]) : [r.name])}
                  onDoubleClick={() => setEditing({ name: r.name })}
                >
                  <span onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" checked={r.isActive !== false} onChange={() => toggleActive(r)} aria-label="Active" />
                  </span>
                  <span title={l.from}>{l.from}</span>
                  <span title={l.to}>{l.to}</span>
                  <span>{CARDINALITY_LABELS[uiCardinality(r)].replace(/ \(.*\)/, '')}</span>
                  <span>{r.crossFilteringBehavior === 'bothDirections' ? 'Both' : 'Single'}</span>
                </div>
              )
            })}
          </div>
        </div>
      </Modal>
      {editing && <RelationshipEditorDialog editName={editing.name} onClose={() => setEditing(null)} />}
    </>
  )
}

/** Autodetect: same-named columns of compatible type where one side is unique (and not already related). */
export function autodetectRelationships(model: SemanticModel): RelationshipDef[] {
  const out: RelationshipDef[] = []
  const exists = (a: string, b: string) => [...model.relationships, ...out].some((r) => (r.fromTable === a && r.toTable === b) || (r.fromTable === b && r.toTable === a))
  const tables = model.tables.filter((t) => !t.isPrivate && !t.calculationGroup && !t.showAsVariationsOnly)
  for (const t1 of tables)
    for (const t2 of tables) {
      if (t1 === t2 || exists(t1.name, t2.name)) continue
      for (const c1 of t1.columns) {
        const c2 = t2.columns.find((c) => c.name.toLowerCase() === c1.name.toLowerCase() && c.dataType === c1.dataType)
        if (!c2 || c1.dataType === 'boolean' || c1.dataType === 'double') continue
        const v1 = columnValues(t1.name, c1.name)
        const v2 = columnValues(t2.name, c2.name)
        if (!v1?.length || !v2?.length) continue
        // t1 many → t2 one
        if (!isUnique(v2) || isUnique(v1)) continue
        out.push(relationshipFromDraft({ table1: t1.name, column1: c1.name, table2: t2.name, column2: c2.name, cardinality: 'manyToOne', crossFilter: 'single', isActive: true, relyOnReferentialIntegrity: false, securityBoth: false }))
        break
      }
    }
  return out
}

function PreviewGrid({ table, column, onPick }: { table: string; column: string; onPick(c: string): void }) {
  const model = useApp((s) => s.project?.model)
  const engine = useApp((s) => s.engine)
  const t = model?.tables.find((x) => x.name === table)
  const data = tableData(table)
  if (!t) return <div className="wbi-relgrid wbi-relgrid--empty" />
  const cols = t.columns.filter((c) => c.kind !== 'rowNumber' && !c.isHidden)
  const rows = Math.min(5, data?.rowCount ?? 0)
  const value = (col: string, r: number): Scalar => data?.columns.find((c) => c.name === col)?.values[r] ?? null
  return (
    <div className="wbi-relgrid" role="grid">
      <table>
        <thead>
          <tr>
            {cols.map((c) => (
              <th key={c.name} className={cx(c.name === column && 'is-selected')} onClick={() => onPick(c.name)} title="Select this column">
                {c.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }, (_, r) => (
            <tr key={r}>
              {cols.map((c) => (
                <td key={c.name} className={cx(c.name === column && 'is-selected')} onClick={() => onPick(c.name)}>
                  {formatCell(value(c.name, r), c, engine)}
                </td>
              ))}
            </tr>
          ))}
          {!rows && (
            <tr>
              <td colSpan={Math.max(1, cols.length)} className="wbi-relgrid__nodata">
                No data loaded — select a column by clicking its header.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

export function RelationshipEditorDialog({ onClose, editName, prefill }: { onClose(): void; editName?: string; prefill?: { table1?: string; column1?: string; table2?: string; column2?: string } }) {
  const model = useApp((s) => s.project?.model)
  const editing = editName ? model?.relationships.find((r) => r.name === editName) : undefined
  const [d, setD] = useState<RelationshipDraft>(() =>
    editing
      ? draftFromRelationship(editing)
      : { table1: prefill?.table1 ?? '', column1: prefill?.column1 ?? '', table2: prefill?.table2 ?? '', column2: prefill?.column2 ?? '', cardinality: 'manyToOne', crossFilter: 'single', isActive: true, relyOnReferentialIntegrity: false, securityBoth: false }
  )
  const [touchedCard, setTouchedCard] = useState(!!editing)
  const data1 = d.table1 && d.column1 ? columnData(d.table1, d.column1) : undefined
  const data2 = d.table2 && d.column2 ? columnData(d.table2, d.column2) : undefined
  const v1 = data1?.values
  const v2 = data2?.values
  const effective: RelationshipDraft = useMemo(() => {
    if (touchedCard || !v1 || !v2) return d
    const card = detectCardinality(v1, v2)
    return { ...d, cardinality: card, crossFilter: card === 'oneToOne' || card === 'manyToMany' ? 'both' : d.crossFilter }
  }, [d, v1, v2, touchedCard])
  if (!model) return null
  const check = validateDraft(model, effective, { v1, v2, type1: data1?.type, type2: data2?.type }, editing)
  const tables = model.tables.filter((t) => !t.isPrivate && !t.showAsVariationsOnly && !t.calculationGroup).map((t) => ({ value: t.name, label: t.name }))
  const setTable = (side: 1 | 2, table: string) => {
    const next = side === 1 ? { ...d, table1: table, column1: '' } : { ...d, table2: table, column2: '' }
    const other = side === 1 ? next.table2 : next.table1
    if (other) {
      const s = suggestColumns(model, next.table1, next.table2)
      if (s) {
        next.column1 = next.column1 || s.column1
        next.column2 = next.column2 || s.column2
      }
    }
    setD(next)
  }
  const ok = () => {
    if (check.errors.length) return
    const rel = relationshipFromDraft(effective, editing)
    useApp.getState().mutateModel(editing ? 'Edit relationship' : 'New relationship', (m) => {
      if (editing) {
        const i = m.relationships.findIndex((r) => r.name === editing.name)
        if (i >= 0) m.relationships[i] = rel
      } else m.relationships.push(rel)
    })
    onClose()
  }
  const cardOptions = (Object.keys(CARDINALITY_LABELS) as UiCardinality[]).map((k) => ({ value: k, label: CARDINALITY_LABELS[k] }))
  const crossOptions =
    effective.cardinality === 'oneToOne'
      ? [{ value: 'both' as const, label: 'Both' }]
      : [
          { value: 'single' as const, label: 'Single' },
          { value: 'both' as const, label: 'Both' }
        ]
  return (
    <Modal
      title={editing ? 'Edit relationship' : 'New relationship'}
      subtitle="Select tables and columns that are related."
      onClose={onClose}
      width={900}
      footer={
        <>
          <Button variant="primary" disabled={check.errors.length > 0} onClick={ok}>
            Save
          </Button>
          <Button onClick={onClose}>Cancel</Button>
        </>
      }
    >
      <div className="wbi-reled">
        <div className="wbi-reled__side">
          <Dropdown label="From table" value={d.table1 || undefined} options={tables} onChange={(v) => setTable(1, v)} searchable placeholder="Select a table" />
          {d.table1 && <PreviewGrid table={d.table1} column={d.column1} onPick={(c) => setD({ ...d, column1: c })} />}
        </div>
        <div className="wbi-reled__side">
          <Dropdown label="To table" value={d.table2 || undefined} options={tables} onChange={(v) => setTable(2, v)} searchable placeholder="Select a table" />
          {d.table2 && <PreviewGrid table={d.table2} column={d.column2} onPick={(c) => setD({ ...d, column2: c })} />}
        </div>
        <div className="wbi-reled__opts">
          <Dropdown
            label="Cardinality"
            value={effective.cardinality}
            options={cardOptions}
            onChange={(v) => {
              setTouchedCard(true)
              setD({ ...effective, cardinality: v, crossFilter: v === 'oneToOne' ? 'both' : effective.crossFilter })
            }}
          />
          <Dropdown label="Cross-filter direction" value={effective.crossFilter} options={crossOptions} onChange={(v) => setD({ ...effective, crossFilter: v })} />
          <div className="wbi-reled__checks">
            <Checkbox checked={effective.isActive} onChange={(v) => setD({ ...effective, isActive: v })} label="Make this relationship active" />
            <Checkbox checked={effective.securityBoth} disabled={effective.crossFilter !== 'both'} onChange={(v) => setD({ ...effective, securityBoth: v })} label="Apply security filter in both directions" />
            <Checkbox checked={effective.relyOnReferentialIntegrity} disabled={effective.cardinality === 'manyToMany'} onChange={(v) => setD({ ...effective, relyOnReferentialIntegrity: v })} label="Assume referential integrity" />
          </div>
        </div>
        {(check.errors.length > 0 || check.warnings.length > 0) && !!(d.table1 && d.table2) && (
          <div className="wbi-reled__msgs">
            {check.errors.map((e) => (
              <div key={e} className="wbi-form__error">
                {e}
              </div>
            ))}
            {check.warnings.map((e) => (
              <div key={e} className="wbi-form__warning">
                {e}
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  )
}

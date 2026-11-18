/**
 * Properties pane (Model view right side; also usable elsewhere) for a table / column / measure /
 * hierarchy / relationship, with PBI's collapsible cards: General, Formatting, Advanced.
 */
import { useEffect, useState, type ReactNode } from 'react'
import { CollapsibleCard, Button, Dropdown, TextField, Toggle } from '../../app/ui'
import { useApp, type FieldSelection } from '../../state/store'
import type { DataType, PartitionMode, SummarizeBy } from '@core/model/types'
import { DATA_CATEGORIES, DATA_TYPE_LABELS, SUMMARIZE_LABELS } from './logic/formats'
import { FormatControls } from './FormatControls'
import { changeDataType, editColumn, editMeasure, editTable, findSelected, getSynonyms, moveMeasure, renameSelected, setSynonymsOn } from './fieldEdits'
import { CARDINALITY_LABELS, draftFromRelationship, relationshipFromDraft, validateDraft, type UiCardinality } from './logic/relationships'
import { isCalculatedTable } from './context'
import { isEnterDataPartition } from './logic/enterData'
import { isFieldParameterTable } from './logic/parameters'
import { openCalculationGroup, openEditRelationship, openEnterData, openFieldParameter, openMarkAsDateTable } from './commands'
import { dateTableColumn } from './logic/modelOps'
import { toast } from '../../app/ui/Notify'
import './modeling.css'

export type PropertiesSelection = FieldSelection | { kind: 'relationship'; name: string }

/** Text box that commits on Enter/blur (PBI properties behave this way). */
function CommitText({ label, value, onCommit, multiline, placeholder }: { label: string; value: string; onCommit(v: string): void; multiline?: boolean; placeholder?: string }) {
  const [v, setV] = useState(value)
  useEffect(() => setV(value), [value])
  return <TextField label={label} value={v} onChange={setV} onCommit={(x) => x !== value && onCommit(x)} multiline={multiline} rows={multiline ? 3 : undefined} placeholder={placeholder} size="small" />
}

const DATA_TYPES: DataType[] = ['string', 'int64', 'double', 'decimal', 'dateTime', 'boolean', 'binary']

export function PropertiesPane({ selection }: { selection: PropertiesSelection | null }) {
  const model = useApp((s) => s.project?.model)
  if (!model || !selection) return <div className="wbi-props__empty">Select a table, column, measure or relationship to see its properties.</div>
  if (selection.kind === 'relationship') return <RelationshipProps name={selection.name} />
  const { table, column, measure } = findSelected(model, selection)
  if (!table) return <div className="wbi-props__empty">The selected item no longer exists.</div>
  let body: ReactNode
  if (selection.kind === 'table') {
    const calc = isCalculatedTable(table)
    const mode = table.partitions[0]?.mode ?? 'import'
    body = (
      <>
        <CollapsibleCard title="General" defaultOpen>
          <div className="wbi-props__stack">
            <CommitText label="Name" value={table.name} onCommit={(v) => renameSelected(selection, v)} />
            <CommitText label="Description" value={table.description ?? ''} multiline placeholder="Enter a description" onCommit={(v) => editTable(table.name, 'Edit description', (t) => (v.trim() ? (t.description = v) : delete t.description))} />
            <CommitText label="Synonyms" value={getSynonyms(table)} placeholder="Comma-separated" onCommit={(v) => editTable(table.name, 'Edit synonyms', (t) => setSynonymsOn(t, v))} />
            <Toggle size="small" label="Is hidden" showState on={!!table.isHidden} onChange={(on) => editTable(table.name, on ? 'Hide table' : 'Unhide table', (t) => (on ? (t.isHidden = true) : delete t.isHidden))} />
            {table.dataCategory === 'Time' && <div className="wbi-props__note">Marked as date table ({dateTableColumn(table) ?? '?'}).</div>}
            <div className="wbi-props__buttons">
              {!table.calculationGroup && (
                <Button size="small" onClick={() => openMarkAsDateTable(table.name)}>
                  Mark as date table
                </Button>
              )}
              {table.calculationGroup && (
                <Button size="small" onClick={() => openCalculationGroup(table.name)}>
                  Edit calculation group
                </Button>
              )}
              {isFieldParameterTable(table) && (
                <Button size="small" onClick={() => openFieldParameter(table.name)}>
                  Edit parameter
                </Button>
              )}
              {isEnterDataPartition(table.partitions[0]) && (
                <Button size="small" onClick={() => openEnterData(table.name)}>
                  Edit data
                </Button>
              )}
            </div>
          </div>
        </CollapsibleCard>
        <CollapsibleCard title="Advanced" defaultOpen>
          <div className="wbi-props__stack">
            <Dropdown
              label="Storage mode"
              size="small"
              value={mode}
              disabled={calc || !!table.calculationGroup}
              options={[
                { value: 'import', label: 'Import' },
                { value: 'directQuery', label: 'DirectQuery' },
                { value: 'dual', label: 'Dual' },
                { value: 'directLake', label: 'Direct Lake' }
              ]}
              onChange={(v: PartitionMode) => {
                if (v === 'directQuery' || v === 'dual' || v === 'directLake') toast({ kind: 'info', message: 'Storage mode is saved to the model; this app always queries the loaded (cached) data.' })
                editTable(table.name, 'Change storage mode', (t) => t.partitions.forEach((p) => (p.mode = v)))
              }}
            />
            <div className="wbi-props__kv">
              <span>Source</span>
              <span>{table.calculationGroup ? 'Calculation group' : calc ? 'Calculated table' : (table.partitions[0]?.sourceType ?? '—')}</span>
              <span>Columns</span>
              <span>{table.columns.filter((c) => c.kind !== 'rowNumber').length}</span>
              <span>Measures</span>
              <span>{table.measures.length}</span>
            </div>
          </div>
        </CollapsibleCard>
      </>
    )
  } else if (selection.kind === 'column' && column) {
    const isNum = column.dataType === 'int64' || column.dataType === 'double' || column.dataType === 'decimal'
    body = (
      <>
        <CollapsibleCard title="General" defaultOpen>
          <div className="wbi-props__stack">
            <CommitText label="Name" value={column.name} onCommit={(v) => renameSelected(selection, v)} />
            <CommitText label="Description" value={column.description ?? ''} multiline placeholder="Enter a description" onCommit={(v) => editColumn(table.name, column.name, 'Edit description', (c) => (v.trim() ? (c.description = v) : delete c.description))} />
            <CommitText label="Synonyms" value={getSynonyms(column)} placeholder="Comma-separated" onCommit={(v) => editColumn(table.name, column.name, 'Edit synonyms', (c) => setSynonymsOn(c, v))} />
            <CommitText label="Display folder" value={column.displayFolder ?? ''} placeholder="Enter the display folder" onCommit={(v) => editColumn(table.name, column.name, 'Edit display folder', (c) => (v.trim() ? (c.displayFolder = v.trim()) : delete c.displayFolder))} />
            <Toggle size="small" label="Is hidden" showState on={!!column.isHidden} onChange={(on) => editColumn(table.name, column.name, on ? 'Hide column' : 'Unhide column', (c) => (on ? (c.isHidden = true) : delete c.isHidden))} />
          </div>
        </CollapsibleCard>
        <CollapsibleCard title="Formatting" defaultOpen>
          <div className="wbi-props__stack">
            <Dropdown
              label="Data type"
              size="small"
              value={column.dataType}
              disabled={column.kind === 'calculatedTableColumn'}
              options={DATA_TYPES.map((d) => ({ value: d, label: DATA_TYPE_LABELS[d] ?? d }))}
              onChange={(v: DataType) => changeDataType(table.name, column.name, v)}
            />
            <FormatControls formatString={column.formatString} dataType={column.dataType} onChange={(f) => editColumn(table.name, column.name, 'Change format', (c) => (f ? (c.formatString = f) : delete c.formatString))} />
          </div>
        </CollapsibleCard>
        <CollapsibleCard title="Advanced" defaultOpen>
          <div className="wbi-props__stack">
            <Dropdown
              label="Sort by column"
              size="small"
              value={column.sortByColumn ?? column.name}
              options={table.columns.filter((c) => c.kind !== 'rowNumber').map((c) => ({ value: c.name, label: c.name }))}
              onChange={(v) => editColumn(table.name, column.name, 'Sort by column', (c) => (v === c.name ? delete c.sortByColumn : (c.sortByColumn = v)))}
              searchable
            />
            <Dropdown label="Data category" size="small" value={column.dataCategory ?? ''} options={DATA_CATEGORIES} onChange={(v) => editColumn(table.name, column.name, 'Data category', (c) => (v ? (c.dataCategory = v) : delete c.dataCategory))} />
            <Dropdown
              label="Summarize by"
              size="small"
              value={column.summarizeBy && column.summarizeBy !== 'default' ? column.summarizeBy : isNum ? 'sum' : 'none'}
              options={SUMMARIZE_LABELS.filter((o) => isNum || ['none', 'count', 'distinctCount'].includes(o.value))}
              onChange={(v: SummarizeBy) =>
                editColumn(table.name, column.name, 'Summarize by', (c) => {
                  c.summarizeBy = v
                  c.annotations = { ...(c.annotations ?? {}), SummarizationSetBy: 'User' }
                })
              }
            />
            <Toggle size="small" label="Is nullable" showState on={column.isNullable !== false} onChange={(on) => editColumn(table.name, column.name, 'Is nullable', (c) => (on ? delete c.isNullable : (c.isNullable = false)))} />
          </div>
        </CollapsibleCard>
      </>
    )
  } else if (selection.kind === 'measure' && measure) {
    body = (
      <>
        <CollapsibleCard title="General" defaultOpen>
          <div className="wbi-props__stack">
            <CommitText label="Name" value={measure.name} onCommit={(v) => renameSelected(selection, v)} />
            <CommitText label="Description" value={measure.description ?? ''} multiline placeholder="Enter a description" onCommit={(v) => editMeasure(table.name, measure.name, 'Edit description', (me) => (v.trim() ? (me.description = v) : delete me.description))} />
            <CommitText label="Synonyms" value={getSynonyms(measure)} placeholder="Comma-separated" onCommit={(v) => editMeasure(table.name, measure.name, 'Edit synonyms', (me) => setSynonymsOn(me, v))} />
            <CommitText label="Display folder" value={measure.displayFolder ?? ''} placeholder="Enter the display folder" onCommit={(v) => editMeasure(table.name, measure.name, 'Edit display folder', (me) => (v.trim() ? (me.displayFolder = v.trim()) : delete me.displayFolder))} />
            <Dropdown label="Home table" size="small" value={table.name} options={model.tables.filter((t) => !t.isPrivate && !t.showAsVariationsOnly).map((t) => ({ value: t.name, label: t.name }))} onChange={(v) => moveMeasure(table.name, measure.name, v)} searchable />
            <Toggle size="small" label="Is hidden" showState on={!!measure.isHidden} onChange={(on) => editMeasure(table.name, measure.name, on ? 'Hide measure' : 'Unhide measure', (me) => (on ? (me.isHidden = true) : delete me.isHidden))} />
          </div>
        </CollapsibleCard>
        <CollapsibleCard title="Formatting" defaultOpen>
          <div className="wbi-props__stack">
            {measure.formatStringDefinition ? (
              <div className="wbi-props__note">This measure uses a dynamic format string.</div>
            ) : (
              <FormatControls formatString={measure.formatString} dataType={measure.dataType ?? 'double'} onChange={(f) => editMeasure(table.name, measure.name, 'Change format', (me) => (f ? (me.formatString = f) : delete me.formatString))} />
            )}
          </div>
        </CollapsibleCard>
      </>
    )
  } else if (selection.kind === 'hierarchy') {
    const h = table.hierarchies.find((x) => x.name === selection.name)
    body = h ? (
      <CollapsibleCard title="General" defaultOpen>
        <div className="wbi-props__stack">
          <CommitText label="Name" value={h.name} onCommit={(v) => renameSelected(selection, v)} />
          <div className="wbi-field__label">Levels</div>
          <ol className="wbi-props__levels">
            {[...h.levels].sort((a, b) => a.ordinal - b.ordinal).map((l) => (
              <li key={l.name}>
                {l.name} <span className="wbi-props__muted">({l.column})</span>
              </li>
            ))}
          </ol>
        </div>
      </CollapsibleCard>
    ) : null
  }
  return <div className="wbi-props">{body}</div>
}

function RelationshipProps({ name }: { name: string }) {
  const model = useApp((s) => s.project?.model)
  const rel = model?.relationships.find((r) => r.name === name)
  if (!model || !rel) return <div className="wbi-props__empty">The relationship no longer exists.</div>
  const d = draftFromRelationship(rel)
  const update = (patch: Partial<typeof d>, label: string) => {
    const next = { ...d, ...patch }
    const check = validateDraft(model, next, {}, rel)
    const blocking = check.errors.find((e) => !e.includes('already exists'))
    if (blocking) {
      toast({ kind: 'error', message: blocking })
      return
    }
    useApp.getState().mutateModel(label, (m) => {
      const i = m.relationships.findIndex((r) => r.name === rel.name)
      if (i >= 0) m.relationships[i] = relationshipFromDraft(next, m.relationships[i])
    })
  }
  return (
    <div className="wbi-props">
      <CollapsibleCard title="Relationship" defaultOpen>
        <div className="wbi-props__stack">
          <div className="wbi-props__kv">
            <span>From</span>
            <span>
              {rel.fromTable} ({rel.fromColumn})
            </span>
            <span>To</span>
            <span>
              {rel.toTable} ({rel.toColumn})
            </span>
          </div>
          <Dropdown
            label="Cardinality"
            size="small"
            value={d.cardinality}
            options={(Object.keys(CARDINALITY_LABELS) as UiCardinality[]).map((k) => ({ value: k, label: CARDINALITY_LABELS[k] }))}
            onChange={(v) => update({ cardinality: v, crossFilter: v === 'oneToOne' ? 'both' : d.crossFilter }, 'Edit relationship')}
          />
          <Dropdown
            label="Cross-filter direction"
            size="small"
            value={d.crossFilter}
            options={[
              { value: 'single', label: 'Single' },
              { value: 'both', label: 'Both' }
            ]}
            onChange={(v) => update({ crossFilter: v }, 'Edit relationship')}
          />
          <Toggle size="small" label="Make this relationship active" showState on={d.isActive} onChange={(on) => update({ isActive: on }, on ? 'Activate relationship' : 'Deactivate relationship')} />
          <Toggle size="small" label="Assume referential integrity" showState on={d.relyOnReferentialIntegrity} onChange={(on) => update({ relyOnReferentialIntegrity: on }, 'Edit relationship')} />
          <Button size="small" onClick={() => openEditRelationship(rel.name)}>
            Open relationship editor
          </Button>
        </div>
      </CollapsibleCard>
    </div>
  )
}

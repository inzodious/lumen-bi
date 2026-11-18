/**
 * One filter card: header (name, summary, chevron, lock / eye / eraser / × on hover) and, when
 * expanded, the editor for its filter type.
 */
import { useEffect, useMemo, useState } from 'react'
import { ChevronDownRegular, ChevronUpRegular, DismissRegular, EraserRegular, EyeOffRegular, EyeRegular, LockClosedRegular, LockOpenRegular } from '@fluentui/react-icons'
import type { Scalar } from '@core/model/data'
import { makeDate } from '@core/model/data'
import { useApp } from '../../state/store'
import { newObjectName, type FilterCard } from '../../report/pbir'
import { Button, Checkbox, Dropdown, NumberField, Radio, SearchBox, TextField, Toggle, Tip, cx } from '../../app/ui'
import { fieldToSQ, isFieldDrag, readFieldDrag } from '../fieldDrag'
import {
  applyModelToCard,
  emptyModel,
  formatValue,
  opNeedsValue,
  opsFor,
  parseCard,
  RELATIVE_UNITS,
  summarize,
  valueTypeOf,
  type AdvancedCondition,
  type AdvancedModel,
  type BasicModel,
  type FieldValueType,
  type FilterKind,
  type FilterModel,
  type RelativeDateModel,
  type TopNModel
} from './filterModel'
import { distinctValues, fieldMeta, scalarKey, type FieldMeta } from './fieldValues'
import { mutateCards, type FilterScope } from './scope'
import { cloneDeep } from '@core/clone'

interface Props {
  card: FilterCard
  implicit: boolean
  scope: FilterScope
  editMode: boolean
  query: string
}

export function FilterCardView({ card, implicit, scope, editMode, query }: Props) {
  const project = useApp((s) => s.project)
  const engine = useApp((s) => s.engine)
  const [open, setOpen] = useState(false)
  const meta = useMemo(() => (card.field ? fieldMeta(project, engine, card.field) : undefined), [project?.model, engine, card.field])
  const parsed = useMemo(() => parseCard(card), [card])
  const byName = useMemo(() => (parsed.model.kind === 'topN' && parsed.model.by ? fieldMeta(project, engine, parsed.model.by).displayName : undefined), [parsed, project?.model, engine])
  if (!card.field || !meta) return null
  if (query && !meta.displayName.toLowerCase().includes(query)) return null
  const locked = !!card.isLockedInViewMode
  const readOnly = !editMode && locked
  const filtering = !!card.filter?.Where?.length
  const type = valueTypeOf(meta.dataType)
  const summary = summarize(parsed.model, { byName, unsupported: parsed.unsupported, rawFilter: filtering })

  /** Write to this card (materializing implicit visual-field cards on first edit). */
  const update = (label: string, fn: (c: FilterCard) => void) => {
    mutateCards(scope, label, (cards) => {
      let c = cards.find((x) => x.name === card.name)
      if (!c && implicit) {
        c = { ...cloneDeep(card), name: newObjectName() }
        cards.push(c)
      }
      if (c) fn(c)
    })
  }
  const applyModel = (model: FilterModel) => update('Edit filter', (c) => applyModelToCard(c, model, type))

  return (
    <div className={cx('wbi-fcard', open && 'is-open', filtering && 'is-filtering', card.isHiddenInViewMode && editMode && 'is-hidden-vm')}>
      <div className="wbi-fcard__header" onClick={() => !readOnly && setOpen(!open)}>
        <div className="wbi-fcard__text">
          <div className="wbi-fcard__name" title={meta.displayName}>
            {meta.displayName}
          </div>
          <div className="wbi-fcard__summary" title={summary}>
            {summary}
          </div>
        </div>
        <div className="wbi-fcard__icons" onClick={(e) => e.stopPropagation()}>
          {editMode ? (
            <>
              <Tip title={locked ? 'Unlock filter' : 'Lock filter'} description="Locked filters can't be changed in reading view">
                <button type="button" className={cx('wbi-fcard__icon', locked && 'is-on')} aria-label={locked ? 'Unlock filter' : 'Lock filter'} onClick={() => update(locked ? 'Unlock filter' : 'Lock filter', (c) => (locked ? delete c.isLockedInViewMode : (c.isLockedInViewMode = true)))}>
                  {locked ? <LockClosedRegular fontSize={14} /> : <LockOpenRegular fontSize={14} />}
                </button>
              </Tip>
              <Tip title={card.isHiddenInViewMode ? 'Show filter in reading view' : 'Hide filter in reading view'}>
                <button
                  type="button"
                  className={cx('wbi-fcard__icon', card.isHiddenInViewMode && 'is-on')}
                  aria-label="Toggle visibility in reading view"
                  onClick={() => update('Hide filter', (c) => (c.isHiddenInViewMode ? delete c.isHiddenInViewMode : (c.isHiddenInViewMode = true)))}
                >
                  {card.isHiddenInViewMode ? <EyeOffRegular fontSize={14} /> : <EyeRegular fontSize={14} />}
                </button>
              </Tip>
            </>
          ) : (
            locked && <LockClosedRegular fontSize={14} className="wbi-fcard__lockmark" />
          )}
          {filtering && !readOnly && (
            <Tip title="Clear filter">
              <button type="button" className="wbi-fcard__icon" aria-label="Clear filter" onClick={() => update('Clear filter', (c) => applyModelToCard(c, emptyModel(parsed.model.kind), type))}>
                <EraserRegular fontSize={14} />
              </button>
            </Tip>
          )}
          {editMode && !implicit && (
            <Tip title="Remove filter">
              <button type="button" className="wbi-fcard__icon" aria-label="Remove filter" onClick={() =>
                  mutateCards(scope, 'Remove filter', (cards) => {
                    const i = cards.findIndex((c) => c.name === card.name)
                    if (i >= 0) cards.splice(i, 1)
                  })
                }>
                <DismissRegular fontSize={14} />
              </button>
            </Tip>
          )}
          {!readOnly && (
            <button type="button" className="wbi-fcard__icon" aria-label={open ? 'Collapse' : 'Expand'} onClick={() => setOpen(!open)}>
              {open ? <ChevronUpRegular fontSize={14} /> : <ChevronDownRegular fontSize={14} />}
            </button>
          )}
        </div>
      </div>
      {open && !readOnly && <FilterEditor card={card} meta={meta} type={type} parsed={parsed} onApply={applyModel} />}
    </div>
  )
}

const KIND_LABEL: Record<FilterKind, string> = { basic: 'Basic filtering', advanced: 'Advanced filtering', topN: 'Top N', relativeDate: 'Relative date' }

function FilterEditor({ card, meta, type, parsed, onApply }: { card: FilterCard; meta: FieldMeta; type: FieldValueType; parsed: { model: FilterModel; unsupported?: boolean }; onApply(m: FilterModel): void }) {
  const kinds: FilterKind[] = meta.isMeasure ? ['advanced'] : type === 'date' ? ['basic', 'advanced', 'relativeDate', 'topN'] : type === 'boolean' ? ['basic'] : ['basic', 'advanced', 'topN']
  const [kind, setKind] = useState<FilterKind>(kinds.includes(parsed.model.kind) ? parsed.model.kind : kinds[0])
  const base = parsed.model.kind === kind && !parsed.unsupported ? parsed.model : emptyModel(kind)
  return (
    <div className="wbi-fcard__body">
      {parsed.unsupported && <div className="wbi-fcard__note">This filter uses a condition the pane can't edit. Applying a new filter replaces it.</div>}
      {kinds.length > 1 && (
        <div className="wbi-fcard__row">
          <span className="wbi-fcard__label">Filter type</span>
          <Dropdown size="small" value={kind} options={kinds.map((k) => ({ value: k, label: KIND_LABEL[k] }))} onChange={(k) => setKind(k)} />
        </div>
      )}
      {kind === 'basic' && <BasicEditor key={card.name} card={card} meta={meta} model={base as BasicModel} onApply={onApply} />}
      {kind === 'advanced' && <AdvancedEditor key={card.name + kind} type={meta.isMeasure ? 'number' : type} model={base as AdvancedModel} onApply={onApply} />}
      {kind === 'topN' && <TopNEditor key={card.name + kind} model={base as TopNModel} onApply={onApply} />}
      {kind === 'relativeDate' && <RelativeEditor key={card.name + kind} model={base as RelativeDateModel} onApply={onApply} />}
    </div>
  )
}

// ---------------------------------------------------------------------------------------------
// Basic
// ---------------------------------------------------------------------------------------------

function BasicEditor({ card, meta, model, onApply }: { card: FilterCard; meta: FieldMeta; model: BasicModel; onApply(m: FilterModel): void }) {
  const project = useApp((s) => s.project)
  const engine = useApp((s) => s.engine)
  const revision = useApp((s) => s.revision)
  const [search, setSearch] = useState('')
  const list = useMemo(() => distinctValues(project, engine, card.field, meta, search), [project?.data, engine, revision, card.field, search])
  const keys = new Set(model.values.map(scalarKey))
  const isChecked = (v: Scalar) => (model.inverted ? !keys.has(scalarKey(v)) : keys.has(scalarKey(v)))
  const allState: boolean | 'mixed' = model.inverted ? (model.values.length ? 'mixed' : true) : model.values.length ? 'mixed' : false
  const toggle = (v: Scalar) => {
    const k = scalarKey(v)
    if (model.requireSingleSelection) {
      onApply({ ...model, inverted: false, values: keys.has(k) && !model.inverted ? [] : [v] })
      return
    }
    const has = keys.has(k)
    const values = has ? model.values.filter((x) => scalarKey(x) !== k) : [...model.values, v]
    onApply({ ...model, values })
  }
  return (
    <>
      <SearchBox value={search} onChange={setSearch} size="small" />
      <div className="wbi-fcard__list" role="listbox">
        {!model.requireSingleSelection && !search && (
          <div className="wbi-fcard__item">
            <Checkbox checked={allState} label="Select all" onChange={(on) => onApply({ ...model, inverted: on, values: [] })} />
          </div>
        )}
        {list.values.map((v, i) => (
          <div key={scalarKey(v)} className="wbi-fcard__item">
            <Checkbox checked={isChecked(v)} label={<span className="wbi-fcard__value">{formatValue(v)}</span>} onChange={() => toggle(v)} />
            {list.counts?.[i] != null && <span className="wbi-fcard__count">{list.counts[i]!.toLocaleString()}</span>}
          </div>
        ))}
        {!list.values.length && <div className="wbi-fcard__note">{list.fallback && !search ? 'No data loaded for this field.' : 'No matches.'}</div>}
        {list.truncated && <div className="wbi-fcard__note">Showing the first {list.values.length.toLocaleString()} values. Search to find more.</div>}
      </div>
      <div className="wbi-fcard__row wbi-fcard__row--between">
        <span>Require single selection</span>
        <Toggle size="small" on={model.requireSingleSelection} onChange={(on) => onApply({ ...model, requireSingleSelection: on, inverted: false, values: on ? model.values.slice(0, 1) : model.values })} />
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------------------------
// Advanced
// ---------------------------------------------------------------------------------------------

function parseInput(text: string, type: FieldValueType): Scalar {
  if (text === '') return null
  if (type === 'number') {
    const n = Number(text)
    return Number.isFinite(n) ? n : null
  }
  if (type === 'date') {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text)
    return m ? makeDate(+m[1], +m[2], +m[3]) : null
  }
  return text
}

function inputText(v: Scalar): string {
  if (v === null || v === undefined) return ''
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  return String(v)
}

function ConditionRow({ cond, type, onChange }: { cond: AdvancedCondition | null; type: FieldValueType; onChange(c: AdvancedCondition | null): void }) {
  const ops = opsFor(type)
  const [text, setText] = useState(inputText(cond?.value ?? null))
  useEffect(() => setText(inputText(cond?.value ?? null)), [cond?.value])
  return (
    <div className="wbi-fcard__cond">
      <Dropdown
        size="small"
        value={cond?.op ?? ('' as any)}
        placeholder="(None)"
        options={[{ value: '' as any, label: '(None)' }, ...ops]}
        onChange={(op) => onChange(op ? { op, value: opNeedsValue(op) ? parseInput(text, type) : op === 'isEmpty' || op === 'isNotEmpty' ? '' : null } : null)}
      />
      {cond && opNeedsValue(cond.op) && (
        <TextField
          size="small"
          type={type === 'number' ? 'number' : 'text'}
          value={text}
          placeholder={type === 'date' ? 'YYYY-MM-DD' : ''}
          onChange={(t) => {
            setText(t)
            onChange({ ...cond, value: parseInput(t, type) })
          }}
        />
      )}
    </div>
  )
}

function AdvancedEditor({ type, model, onApply }: { type: FieldValueType; model: AdvancedModel; onApply(m: FilterModel): void }) {
  const [draft, setDraft] = useState<AdvancedModel>(model)
  const dirty = JSON.stringify(draft) !== JSON.stringify(model)
  return (
    <>
      <div className="wbi-fcard__label">Show items when the value</div>
      <ConditionRow cond={draft.first} type={type} onChange={(first) => setDraft({ ...draft, first })} />
      <div className="wbi-row" style={{ gap: 16 }}>
        <Radio checked={draft.logic === 'and'} label="And" onChange={() => setDraft({ ...draft, logic: 'and' })} />
        <Radio checked={draft.logic === 'or'} label="Or" onChange={() => setDraft({ ...draft, logic: 'or' })} />
      </div>
      <ConditionRow cond={draft.second} type={type} onChange={(second) => setDraft({ ...draft, second })} />
      <div className="wbi-fcard__apply">
        <Button size="small" disabled={!dirty} onClick={() => onApply(draft)}>
          Apply filter
        </Button>
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------------------------
// Top N
// ---------------------------------------------------------------------------------------------

function TopNEditor({ model, onApply }: { model: TopNModel; onApply(m: FilterModel): void }) {
  const project = useApp((s) => s.project)
  const engine = useApp((s) => s.engine)
  const [draft, setDraft] = useState<TopNModel>(model)
  const [over, setOver] = useState(false)
  const dirty = JSON.stringify(draft) !== JSON.stringify(model)
  const byName = draft.by ? fieldMeta(project, engine, draft.by).displayName : null
  return (
    <>
      <div className="wbi-fcard__label">Show items</div>
      <div className="wbi-fcard__cond wbi-fcard__cond--inline">
        <Dropdown
          size="small"
          value={draft.direction}
          options={[
            { value: 'top', label: 'Top' },
            { value: 'bottom', label: 'Bottom' }
          ]}
          onChange={(direction) => setDraft({ ...draft, direction })}
        />
        <NumberField size="small" value={draft.count} min={1} onChange={(n) => setDraft({ ...draft, count: n ?? 1 })} />
      </div>
      <div className="wbi-fcard__label">By value</div>
      <div
        className={cx('wbi-fcard__well', over && 'is-over', draft.by && 'is-filled')}
        onDragOver={(e) => {
          if (!isFieldDrag(e)) return
          e.preventDefault()
          setOver(true)
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setOver(false)
          const f = readFieldDrag(e.dataTransfer)
          if (!f || (f.kind !== 'measure' && f.kind !== 'column')) return
          const [expr] = fieldToSQ(f, { asValue: true, model: project?.model })
          if (expr) setDraft({ ...draft, by: expr })
        }}
      >
        {byName ? (
          <>
            <span className="wbi-fcard__wellname">{byName}</span>
            <button type="button" className="wbi-fcard__icon" aria-label="Remove field" onClick={() => setDraft({ ...draft, by: null })}>
              <DismissRegular fontSize={12} />
            </button>
          </>
        ) : (
          'Add data fields here'
        )}
      </div>
      <div className="wbi-fcard__apply">
        <Button size="small" disabled={!dirty || !draft.by} onClick={() => onApply(draft)}>
          Apply filter
        </Button>
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------------------------
// Relative date
// ---------------------------------------------------------------------------------------------

function RelativeEditor({ model, onApply }: { model: RelativeDateModel; onApply(m: FilterModel): void }) {
  const [draft, setDraft] = useState<RelativeDateModel>(model)
  const dirty = JSON.stringify(draft) !== JSON.stringify(model)
  const units = draft.operator === 'this' ? RELATIVE_UNITS.filter((u) => u.value === 'days' || u.value.endsWith('Calendar')) : RELATIVE_UNITS
  const calendar = draft.unit.endsWith('Calendar') || draft.operator === 'this'
  return (
    <>
      <div className="wbi-fcard__label">Show items when the value</div>
      <Dropdown
        size="small"
        value={draft.operator}
        options={[
          { value: 'last', label: 'is in the last' },
          { value: 'this', label: 'is in this' },
          { value: 'next', label: 'is in the next' }
        ]}
        onChange={(operator) =>
          setDraft({ ...draft, operator, unit: operator === 'this' && !draft.unit.endsWith('Calendar') && draft.unit !== 'days' ? (`${draft.unit}Calendar` as RelativeDateModel['unit']) : draft.unit })
        }
      />
      <div className="wbi-fcard__cond wbi-fcard__cond--inline">
        {draft.operator !== 'this' && <NumberField size="small" value={draft.count} min={1} onChange={(n) => setDraft({ ...draft, count: n ?? 1 })} />}
        <Dropdown size="small" value={draft.unit} options={units.map((u) => ({ value: u.value, label: u.label }))} onChange={(unit) => setDraft({ ...draft, unit })} />
      </div>
      {!calendar && <Checkbox checked={draft.includeToday} label="Include today" onChange={(includeToday) => setDraft({ ...draft, includeToday })} />}
      <div className="wbi-fcard__apply">
        <Button size="small" disabled={!dirty} onClick={() => onApply(draft)}>
          Apply filter
        </Button>
      </div>
    </>
  )
}

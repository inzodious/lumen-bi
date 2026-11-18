/**
 * Home ▸ Manage Parameters (Power BI layout): parameter list on the left (New / delete), the selected
 * parameter's Name, Description, Required, Type, Suggested Values (Any value / List of values) and
 * Current Value on the right. OK writes every edit to the draft at once.
 */
import { useMemo, useState } from 'react'
import { AddRegular, DismissRegular, ArrowUpRegular, ArrowDownRegular } from '@fluentui/react-icons'
import { Button, Checkbox, Dropdown, IconButton, Modal, TextField, cx } from '../../../app/ui'
import { addQuery, deleteQuery, renameQuery, updateQuery } from '../logic/draft'
import { PARAM_TYPES, parameterExpression, readParameter, type ParamSpec, type ParamType } from '../logic/params'
import { closePqDialog } from '../pqDialogs'
import { usePq } from '../pqStore'
import { Field } from './common'

interface Entry {
  key: string
  /** draft query id (existing parameters) */
  id?: string
  original?: { name: string; source: string; description: string }
  name: string
  description: string
  spec: ParamSpec
  deleted?: boolean
}

let seq = 0

function entriesFromDraft(): Entry[] {
  return usePq
    .getState()
    .draft.queries.filter((q) => q.kind === 'parameter')
    .map((q) => ({
      key: `p${++seq}`,
      id: q.id,
      original: { name: q.name, source: q.source, description: q.description ?? '' },
      name: q.name,
      description: q.description ?? '',
      spec: readParameter(q.source) ?? { type: 'Any', required: true, value: '' }
    }))
}

function newEntry(entries: Entry[]): Entry {
  const taken = new Set([...usePq.getState().draft.queries.map((q) => q.name.toLowerCase()), ...entries.map((e) => e.name.toLowerCase())])
  let n = 1
  while (taken.has(`parameter${n}`)) n++
  return { key: `p${++seq}`, name: `Parameter${n}`, description: '', spec: { type: 'Text', required: true, value: '' } }
}

export function ParametersDialog({ queryId, create }: { queryId?: string; create?: boolean }) {
  const [entries, setEntries] = useState<Entry[]>(() => {
    const list = entriesFromDraft()
    return create || !list.length ? [...list, newEntry(list)] : list
  })
  const visible = entries.filter((e) => !e.deleted)
  const [sel, setSel] = useState<string | null>(() => {
    if (create || !entries.some((e) => e.id)) return entries[entries.length - 1]?.key ?? null
    return entries.find((e) => e.id === queryId)?.key ?? entries[0]?.key ?? null
  })
  const cur = visible.find((e) => e.key === sel) ?? null
  const patch = (p: Partial<Entry>) => setEntries((es) => es.map((e) => (e.key === sel ? { ...e, ...p } : e)))
  const patchSpec = (p: Partial<ParamSpec>) => cur && patch({ spec: { ...cur.spec, ...p } })

  const nameError = useMemo(() => {
    if (!cur) return null
    const n = cur.name.trim()
    if (!n) return 'The parameter name cannot be empty.'
    if (/["\t\n\r]/.test(n)) return 'The parameter name contains invalid characters.'
    const others = usePq.getState().draft.queries.filter((q) => q.kind !== 'parameter').map((q) => q.name.toLowerCase())
    if (others.includes(n.toLowerCase()) || visible.some((e) => e.key !== cur.key && e.name.trim().toLowerCase() === n.toLowerCase())) return `A query with the name '${n}' already exists.`
    return null
  }, [cur, visible])
  const anyInvalid = visible.some((e) => !e.name.trim()) || !!nameError

  const ok = () => {
    let draft = usePq.getState().draft
    for (const e of entries) {
      if (e.deleted) {
        if (e.id) draft = deleteQuery(draft, e.id)
        continue
      }
      const source = parameterExpression(e.spec)
      const name = e.name.trim()
      if (e.id && e.original) {
        if (name !== e.original.name) draft = renameQuery(draft, e.id, name)
        // rewrite only when the dialog changed something, keeping hand-written meta otherwise
        const specChanged = JSON.stringify(readParameter(e.original.source)) !== JSON.stringify(e.spec)
        if (specChanged) draft = updateQuery(draft, e.id, { source })
        if (e.description !== e.original.description) draft = updateQuery(draft, e.id, { description: e.description || undefined })
      } else {
        draft = addQuery(draft, { name, kind: 'parameter', source, loadEnabled: false, ...(e.description ? { description: e.description } : {}) }).draft
      }
    }
    usePq.setState({ draft })
    closePqDialog()
  }

  const list = cur?.spec.list
  const listMode = list !== undefined
  return (
    <Modal title="Manage Parameters" onClose={closePqDialog} width={760} height={560} footer={<><Button variant="primary" disabled={anyInvalid} onClick={ok}>OK</Button><Button onClick={closePqDialog}>Cancel</Button></>}>
      <div className="wbi-pq-dlg__params">
        <div className="wbi-pq-dlg__params-left">
          <Button
            size="small"
            icon={<AddRegular fontSize={16} />}
            onClick={() => {
              const e = newEntry(entries)
              setEntries((es) => [...es, e])
              setSel(e.key)
            }}
          >
            New
          </Button>
          <div className="wbi-pq-dlg__list" role="listbox">
            {visible.map((e) => (
              <div key={e.key} role="option" aria-selected={e.key === sel} className={cx('wbi-pq-dlg__param', e.key === sel && 'is-selected')} onClick={() => setSel(e.key)}>
                <span className="wbi-pq-dlg__param-name">{e.name || '(no name)'}</span>
                <IconButton
                  label="Delete"
                  icon={<DismissRegular fontSize={12} />}
                  className="wbi-pq-dlg__param-del"
                  onClick={(ev) => {
                    ev.stopPropagation()
                    setEntries((es) => (e.id ? es.map((x) => (x.key === e.key ? { ...x, deleted: true } : x)) : es.filter((x) => x.key !== e.key)))
                    if (sel === e.key) setSel(visible.find((x) => x.key !== e.key)?.key ?? null)
                  }}
                />
              </div>
            ))}
            {!visible.length && <div className="wbi-pq-dlg__empty">No parameters. Select New to add one.</div>}
          </div>
        </div>
        {cur ? (
          <div className="wbi-pq-dlg__params-form">
            <TextField label="Name" value={cur.name} onChange={(v) => patch({ name: v })} error={nameError ?? undefined} />
            <TextField label="Description" value={cur.description} onChange={(v) => patch({ description: v })} />
            <Checkbox label="Required" checked={cur.spec.required} onChange={(v) => patchSpec({ required: v })} />
            <Dropdown label="Type" value={cur.spec.type} options={PARAM_TYPES.map((t) => ({ value: t.id, label: t.label }))} onChange={(v: ParamType) => patchSpec({ type: v })} />
            <Dropdown
              label="Suggested Values"
              value={listMode ? 'list' : 'any'}
              options={[
                { value: 'any', label: 'Any value' },
                { value: 'list', label: 'List of values' }
              ]}
              onChange={(v) => patchSpec({ list: v === 'list' ? (cur.spec.value ? [cur.spec.value] : ['']) : undefined })}
            />
            {listMode && (
              <Field label="">
                <div className="wbi-pq-dlg__listedit">
                  {list!.map((item, i) => (
                    <div key={i} className="wbi-row" style={{ gap: 4 }}>
                      <span className="wbi-pq-dlg__listnum">{i + 1}</span>
                      <TextField size="small" value={item} onChange={(v) => patchSpec({ list: list!.map((x, j) => (j === i ? v : x)) })} className="wbi-pq-dlg__grow" />
                      <IconButton label="Move up" icon={<ArrowUpRegular fontSize={12} />} disabled={i === 0} onClick={() => patchSpec({ list: swap(list!, i, i - 1) })} />
                      <IconButton label="Move down" icon={<ArrowDownRegular fontSize={12} />} disabled={i === list!.length - 1} onClick={() => patchSpec({ list: swap(list!, i, i + 1) })} />
                      <IconButton label="Delete" icon={<DismissRegular fontSize={12} />} onClick={() => patchSpec({ list: list!.filter((_, j) => j !== i) })} />
                    </div>
                  ))}
                  <Button size="small" variant="subtle" icon={<AddRegular fontSize={14} />} onClick={() => patchSpec({ list: [...list!, ''] })}>
                    Add value
                  </Button>
                </div>
              </Field>
            )}
            {listMode && list!.some((x) => x.trim()) ? (
              <Dropdown
                label="Current Value"
                value={cur.spec.value}
                options={[...new Set(list!.filter((x) => x.trim()))].map((x) => ({ value: x, label: x }))}
                onChange={(v) => patchSpec({ value: v })}
                placeholder="Select a value"
              />
            ) : (
              <TextField label="Current Value" value={cur.spec.value} onChange={(v) => patchSpec({ value: v })} placeholder={placeholderFor(cur.spec.type)} />
            )}
          </div>
        ) : (
          <div className="wbi-pq-dlg__params-form wbi-pq-dlg__empty">Select a parameter, or select New to create one.</div>
        )}
      </div>
    </Modal>
  )
}

function swap<T>(a: T[], i: number, j: number): T[] {
  const b = [...a]
  ;[b[i], b[j]] = [b[j]!, b[i]!]
  return b
}

function placeholderFor(t: ParamType): string {
  switch (t) {
    case 'Date':
      return '1/31/2024'
    case 'DateTime':
      return '1/31/2024 10:00:00 AM'
    case 'Time':
      return '10:00:00'
    case 'Duration':
      return '1.02:00:00'
    case 'Logical':
      return 'TRUE'
    case 'Number':
      return '0'
    default:
      return ''
  }
}

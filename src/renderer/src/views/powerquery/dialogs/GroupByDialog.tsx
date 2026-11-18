/**
 * Group By (Home / Transform ▸ Group By): Basic (one grouping column, one aggregation) or Advanced
 * (several groupings and aggregations), as in Power Query.
 */
import { useMemo, useState } from 'react'
import { AddRegular, DismissRegular } from '@fluentui/react-icons'
import { Button, Dropdown, IconButton, Modal, Radio, TextField } from '../../../app/ui'
import { parseGroupBy } from '../logic/stepSettings'
import { GROUP_OPS, groupBy, type GroupAgg, type GroupOp } from '../logic/transforms'
import { closePqDialog } from '../pqDialogs'
import { usePq } from '../pqStore'
import { columnOptions, commit, OkCancel, stepFormula, useInputTable } from './common'

const OP_ORDER: GroupOp[] = ['count', 'countDistinct', 'sum', 'average', 'median', 'min', 'max', 'all']
const OPS = OP_ORDER.map((id) => GROUP_OPS.find((o) => o.id === id)!)

const DEFAULT_NAME: Record<GroupOp, string> = { count: 'Count', countDistinct: 'Count', sum: 'Sum', average: 'Average', median: 'Median', min: 'Min', max: 'Max', all: 'All Rows' }

export function GroupByDialog({ step }: { step?: string }) {
  const input = useInputTable(step)
  const parsed = useMemo(() => (step ? parseGroupBy(stepFormula(step) ?? '') : null), [step])
  const selected = usePq((s) => s.selectedCols)
  const [keys, setKeys] = useState<string[]>(() => parsed?.keys ?? (selected.length ? selected : []))
  const [aggs, setAggs] = useState<GroupAgg[]>(() => parsed?.aggs ?? [{ name: 'Count', op: 'count' }])
  const [advanced, setAdvanced] = useState(() => (parsed ? parsed.keys.length > 1 || parsed.aggs.length > 1 : selected.length > 1))
  const cols = input.columns
  const effKeys = keys.length ? keys : cols[0] ? [cols[0].name] : []
  const opts = columnOptions(cols)

  const setAgg = (i: number, p: Partial<GroupAgg>) =>
    setAggs((as) =>
      as.map((a, j) => {
        if (j !== i) return a
        const next = { ...a, ...p }
        // follow the default name while the user hasn't typed one
        if (p.op && a.name === DEFAULT_NAME[a.op]) next.name = DEFAULT_NAME[p.op]
        if (p.op && GROUP_OPS.find((o) => o.id === p.op)?.needsColumn && !next.column) next.column = cols.find((c) => !effKeys.includes(c.name))?.name ?? cols[0]?.name
        return next
      })
    )
  const shownAggs = advanced ? aggs : aggs.slice(0, 1)
  const shownKeys = advanced ? effKeys : effKeys.slice(0, 1)
  const valid = shownKeys.length > 0 && shownAggs.length > 0 && shownAggs.every((a) => a.name.trim() && (!GROUP_OPS.find((o) => o.id === a.op)?.needsColumn || a.column)) && new Set(shownAggs.map((a) => a.name.trim())).size === shownAggs.length
  const ok = () => {
    if (!valid) return
    void commit(
      groupBy(
        shownKeys,
        shownAggs.map((a) => ({ ...a, name: a.name.trim(), column: GROUP_OPS.find((o) => o.id === a.op)?.needsColumn ? a.column : undefined })),
        cols
      ),
      step
    )
  }

  return (
    <Modal title="Group By" subtitle="Specify the columns to group by and one or more outputs." onClose={closePqDialog} width={advanced ? 680 : 520} onSubmit={ok} footer={<OkCancel onOk={ok} disabled={!valid} />}>
      <div className="wbi-col" style={{ gap: 12 }}>
        <div className="wbi-row" style={{ gap: 16 }}>
          <Radio checked={!advanced} onChange={() => setAdvanced(false)} label="Basic" />
          <Radio checked={advanced} onChange={() => setAdvanced(true)} label="Advanced" />
        </div>
        <div className="wbi-col" style={{ gap: 6 }}>
          <div className="wbi-pq-dlg__label">Group by</div>
          {shownKeys.map((k, i) => (
            <div key={i} className="wbi-row" style={{ gap: 6 }}>
              <Dropdown className="wbi-pq-dlg__w240" value={k} options={opts} onChange={(v) => setKeys(effKeys.map((x, j) => (j === i ? v : x)))} />
              {advanced && shownKeys.length > 1 && <IconButton label="Delete" icon={<DismissRegular fontSize={14} />} onClick={() => setKeys(effKeys.filter((_, j) => j !== i))} />}
            </div>
          ))}
          {advanced && (
            <Button size="small" variant="subtle" icon={<AddRegular fontSize={14} />} disabled={effKeys.length >= cols.length} onClick={() => setKeys([...effKeys, cols.find((c) => !effKeys.includes(c.name))?.name ?? cols[0]!.name])}>
              Add grouping
            </Button>
          )}
        </div>
        <div className="wbi-pq-dlg__aggs">
          <div className="wbi-pq-dlg__label">New column name</div>
          <div className="wbi-pq-dlg__label">Operation</div>
          <div className="wbi-pq-dlg__label">Column</div>
          <div />
          {shownAggs.map((a, i) => {
            const needs = !!GROUP_OPS.find((o) => o.id === a.op)?.needsColumn
            return [
              <TextField key={`n${i}`} value={a.name} onChange={(v) => setAgg(i, { name: v })} />,
              <Dropdown key={`o${i}`} value={a.op} options={OPS.map((o) => ({ value: o.id, label: o.label }))} onChange={(v) => setAgg(i, { op: v })} />,
              <Dropdown key={`c${i}`} value={needs ? a.column : undefined} disabled={!needs} options={opts} onChange={(v) => setAgg(i, { column: v })} placeholder="" />,
              <span key={`d${i}`}>{advanced && shownAggs.length > 1 && <IconButton label="Delete" icon={<DismissRegular fontSize={14} />} onClick={() => setAggs(aggs.filter((_, j) => j !== i))} />}</span>
            ]
          })}
        </div>
        {advanced && (
          <Button size="small" variant="subtle" icon={<AddRegular fontSize={14} />} onClick={() => setAggs([...aggs, { name: uniqueAggName(aggs), op: 'count' }])}>
            Add aggregation
          </Button>
        )}
      </div>
    </Modal>
  )
}

function uniqueAggName(aggs: GroupAgg[]): string {
  const taken = new Set(aggs.map((a) => a.name))
  if (!taken.has('Count')) return 'Count'
  for (let n = 1; ; n++) if (!taken.has(`Count.${n}`)) return `Count.${n}`
}

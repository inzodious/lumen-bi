/**
 * Query Properties, Step Properties, Move To Group and Rename Column dialogs.
 */
import { useState } from 'react'
import { Button, Checkbox, Modal, Radio, TextField } from '../../../app/ui'
import { newGroupAction, patchQuery, renameQueryAction, renameStepAction, setQueryGroup, updateSelectedSource } from '../actions'
import { groupsOf, queryNameError } from '../logic/draft'
import { readStepDescription, writeStepDescription } from '../logic/stepSettings'
import { renameColumns } from '../logic/transforms'
import { closePqDialog } from '../pqDialogs'
import { selectedQuery, usePq } from '../pqStore'
import { commit, OkCancel, useInputTable } from './common'

export function PropertiesDialog({ queryId }: { queryId: string }) {
  const q = usePq((s) => s.draft.queries.find((x) => x.id === queryId))
  const [name, setName] = useState(q?.name ?? '')
  const [description, setDescription] = useState(q?.description ?? '')
  const [load, setLoad] = useState(q?.loadEnabled ?? true)
  const [includeRefresh, setIncludeRefresh] = useState(true)
  if (!q) return null
  const err = name.trim() !== q.name ? queryNameError(usePq.getState().draft, name, q.id) : null
  const canLoad = q.kind !== 'parameter' && q.kind !== 'function'
  const ok = () => {
    if (err) return
    if (name.trim() !== q.name && !renameQueryAction(q.id, name)) return
    const patch: Parameters<typeof patchQuery>[1] = {}
    if ((q.description ?? '') !== description) patch.description = description || undefined
    if (canLoad && load !== q.loadEnabled) patch.loadEnabled = load
    if (Object.keys(patch).length) patchQuery(q.id, patch)
    closePqDialog()
  }
  return (
    <Modal title="Query Properties" onClose={closePqDialog} width={480} onSubmit={ok} footer={<OkCancel onOk={ok} disabled={!!err || !name.trim()} />}>
      <div className="wbi-col" style={{ gap: 12 }}>
        <TextField label="Name" value={name} onChange={setName} error={err ?? undefined} autoFocus />
        <TextField label="Description" value={description} onChange={setDescription} multiline rows={4} />
        <Checkbox label="Enable load to report" checked={canLoad && load} disabled={!canLoad} onChange={setLoad} />
        {/* Approximation: Lumen refreshes every loaded table; the flag is shown for parity but not stored. */}
        <Checkbox label="Include in report refresh" checked={canLoad && load && includeRefresh} disabled={!canLoad || !load} onChange={setIncludeRefresh} title="Lumen refreshes every loaded query; this setting is not stored." />
      </div>
    </Modal>
  )
}

export function StepPropertiesDialog({ step }: { step: string }) {
  const q = selectedQuery()
  const [name, setName] = useState(step)
  const [description, setDescription] = useState(() => readStepDescription(q?.source ?? '', step))
  if (!q) return null
  const ok = () => {
    const n = name.trim()
    if (!n) return
    if (n !== step && !renameStepAction(step, n)) return
    const cur = selectedQuery()
    if (cur && description !== readStepDescription(cur.source, n)) {
      const next = writeStepDescription(cur.source, n, description)
      if (next) updateSelectedSource(next)
    }
    closePqDialog()
  }
  return (
    <Modal title="Step Properties" onClose={closePqDialog} width={480} onSubmit={ok} footer={<OkCancel onOk={ok} disabled={!name.trim()} />}>
      <div className="wbi-col" style={{ gap: 12 }}>
        <TextField label="Name" value={name} onChange={setName} autoFocus />
        <TextField label="Description" value={description} onChange={setDescription} multiline rows={4} />
      </div>
    </Modal>
  )
}

const UNGROUPED = '\u0000other'

export function MoveToGroupDialog({ queryId }: { queryId: string }) {
  const draft = usePq((s) => s.draft)
  const q = draft.queries.find((x) => x.id === queryId)
  const [group, setGroup] = useState(q?.group ?? UNGROUPED)
  if (!q) return null
  const ok = () => {
    setQueryGroup(queryId, group === UNGROUPED ? undefined : group)
    closePqDialog()
  }
  return (
    <Modal
      title="Move To Group"
      subtitle={`Choose the group for '${q.name}'.`}
      onClose={closePqDialog}
      width={420}
      onSubmit={ok}
      footerLeft={
        <Button
          onClick={() => {
            closePqDialog()
            void newGroupAction(queryId)
          }}
        >
          New Group…
        </Button>
      }
      footer={<OkCancel onOk={ok} />}
    >
      <div className="wbi-col" style={{ gap: 6 }}>
        {groupsOf(draft).map((g) => (
          <Radio key={g} checked={group === g} label={g} onChange={() => setGroup(g)} />
        ))}
        <Radio checked={group === UNGROUPED} label="Other Queries" onChange={() => setGroup(UNGROUPED)} />
      </div>
    </Modal>
  )
}

export function RenameColumnDialog({ column }: { column: string }) {
  const input = useInputTable()
  const [name, setName] = useState(column)
  const n = name.trim()
  const err = !n ? 'The column name cannot be empty.' : n !== column && input.columns.some((c) => c.name.toLowerCase() === n.toLowerCase() && c.name !== column) ? `A column named '${n}' already exists.` : undefined
  const ok = () => {
    if (err) return
    if (n === column) return closePqDialog()
    void commit(renameColumns([[column, n]]))
  }
  return (
    <Modal title="Rename Column" onClose={closePqDialog} width={420} onSubmit={ok} footer={<OkCancel onOk={ok} disabled={!!err} />}>
      <TextField label="New name" value={name} onChange={setName} error={n !== column ? err : undefined} autoFocus />
    </Modal>
  )
}

/** Modeling ▸ Manage roles (RLS) and View as. */
import { useMemo, useState } from 'react'
import { AddRegular, CopyRegular, DeleteRegular, EditRegular, FilterRegular, ShieldPersonRegular } from '@fluentui/react-icons'
import { Button, Checkbox, Modal, NotificationBar, cx } from '../../app/ui'
import { promptDialog } from '../../app/ui/Modal'
import { useApp } from '../../state/store'
import type { RoleDef } from '@core/model/types'
import type { ExpressionDiagnostic } from '@core/engine/api'
import { DaxEditor } from '../../editors/dax/DaxEditor'
import { schemaFromModel } from '../../editors/dax/schema'
import { uniqueName } from './logic/modelOps'
import './modeling.css'
import { cloneDeep } from '@core/clone'

export function ManageRolesDialog({ onClose }: { onClose(): void }) {
  const model = useApp((s) => s.project?.model)
  const [roles, setRoles] = useState<RoleDef[]>(() => cloneDeep(model?.roles ?? []))
  const [roleIdx, setRoleIdx] = useState(0)
  const [table, setTable] = useState<string | null>(null)
  const [errors, setErrors] = useState<Record<string, ExpressionDiagnostic[]>>({})
  const tables = useMemo(() => (model?.tables ?? []).filter((t) => !t.isPrivate && !t.showAsVariationsOnly), [model])
  const role = roles[roleIdx]
  const currentTable = table ?? role?.tablePermissions.find((tp) => tp.filterExpression)?.table ?? tables[0]?.name ?? null
  const schema = useMemo(() => schemaFromModel(model, currentTable ?? undefined), [model, currentTable])
  if (!model) return null
  const filterOf = (r: RoleDef | undefined, t: string | null) => r?.tablePermissions.find((tp) => tp.table === t)?.filterExpression ?? ''
  const setFilter = (expr: string) => {
    if (!role || !currentTable) return
    setRoles(
      roles.map((r, i) => {
        if (i !== roleIdx) return r
        const others = r.tablePermissions.filter((tp) => tp.table !== currentTable)
        return { ...r, tablePermissions: expr.trim() ? [...others, { table: currentTable, filterExpression: expr }] : others }
      })
    )
  }
  const newRole = () => {
    const name = uniqueName('Untitled', roles.map((r) => r.name))
    setRoles([...roles, { name, modelPermission: 'read', tablePermissions: [] }])
    setRoleIdx(roles.length)
  }
  const rename = async () => {
    if (!role) return
    const name = await promptDialog({ title: 'Rename role', label: 'Role name', value: role.name, validate: (v) => (!v.trim() ? 'Enter a name.' : roles.some((r, i) => i !== roleIdx && r.name.toLowerCase() === v.trim().toLowerCase()) ? 'A role with this name already exists.' : undefined) })
    if (name) setRoles(roles.map((r, i) => (i === roleIdx ? { ...r, name: name.trim() } : r)))
  }
  const duplicate = () => {
    if (!role) return
    setRoles([...roles, { ...cloneDeep(role), name: uniqueName(`${role.name} copy`, roles.map((r) => r.name)) }])
    setRoleIdx(roles.length)
  }
  const remove = () => {
    if (!role) return
    setRoles(roles.filter((_, i) => i !== roleIdx))
    setRoleIdx(Math.max(0, roleIdx - 1))
  }
  const validate = (text: string): ExpressionDiagnostic[] => {
    const engine = useApp.getState().engine
    if (!engine || !currentTable) return []
    return engine.validateExpression(text, { kind: 'calculatedColumn', table: currentTable })
  }
  const hasErrors = Object.values(errors).some((d) => d.some((x) => x.severity === 'error'))
  const save = () => {
    useApp.getState().mutateModel('Manage roles', (m) => {
      m.roles = roles
    })
    onClose()
  }
  return (
    <Modal
      title="Manage security roles"
      subtitle="Create roles and define row-level security filters (DAX expressions that return TRUE for the rows a member can see)."
      onClose={onClose}
      width={980}
      height={600}
      footer={
        <>
          <Button variant="primary" disabled={hasErrors} onClick={save}>
            Save
          </Button>
          <Button onClick={onClose}>Cancel</Button>
        </>
      }
    >
      <div className="wbi-roles">
        <div className="wbi-roles__col">
          <div className="wbi-roles__title">
            Roles
            <span className="wbi-roles__tools">
              <button type="button" className="wbi-iconbtn" onClick={newRole} title="New" aria-label="New role">
                <AddRegular />
              </button>
              <button type="button" className="wbi-iconbtn" onClick={rename} disabled={!role} title="Rename" aria-label="Rename role">
                <EditRegular />
              </button>
              <button type="button" className="wbi-iconbtn" onClick={duplicate} disabled={!role} title="Duplicate" aria-label="Duplicate role">
                <CopyRegular />
              </button>
              <button type="button" className="wbi-iconbtn" onClick={remove} disabled={!role} title="Delete" aria-label="Delete role">
                <DeleteRegular />
              </button>
            </span>
          </div>
          <div className="wbi-roles__list">
            {!roles.length && <div className="wbi-roles__empty">No roles yet. Select New to create one.</div>}
            {roles.map((r, i) => (
              <button key={i} type="button" className={cx('wbi-roles__item', i === roleIdx && 'is-selected')} onClick={() => setRoleIdx(i)} onDoubleClick={rename}>
                <ShieldPersonRegular /> {r.name}
              </button>
            ))}
          </div>
        </div>
        <div className="wbi-roles__col">
          <div className="wbi-roles__title">Select tables</div>
          <div className="wbi-roles__list">
            {tables.map((t) => (
              <button key={t.name} type="button" className={cx('wbi-roles__item', t.name === currentTable && 'is-selected')} onClick={() => setTable(t.name)} disabled={!role}>
                <span style={{ flex: 1 }}>{t.name}</span>
                {filterOf(role, t.name) && <FilterRegular aria-label="Has filter" />}
              </button>
            ))}
          </div>
        </div>
        <div className="wbi-roles__col wbi-roles__editor">
          <div className="wbi-roles__title">Filter data{currentTable ? ` — ${currentTable}` : ''}</div>
          {role && currentTable ? (
            <>
              <DaxEditor
                wrap
                key={`${roleIdx}:${currentTable}`}
                value={filterOf(role, currentTable)}
                onChange={setFilter}
                schema={schema}
                validate={validate}
                onDiagnostics={(d) => setErrors((e) => ({ ...e, [`${roleIdx}:${currentTable}`]: d }))}
                lineNumbers
                placeholder={`e.g. [Region] = "West"   or   ${currentTable}[Email] = USERPRINCIPALNAME()`}
              />
              <div className="wbi-form__hint">The expression is evaluated for each row of {currentTable}; rows where it returns TRUE are visible to members of {role.name}. Filters propagate along relationships.</div>
            </>
          ) : (
            <div className="wbi-roles__empty">Select a role and a table to define a filter.</div>
          )}
        </div>
      </div>
    </Modal>
  )
}

export function ViewAsDialog({ onClose }: { onClose(): void }) {
  const model = useApp((s) => s.project?.model)
  const current = useApp((s) => s.viewAsRoles)
  const engine = useApp((s) => s.engine)
  const [sel, setSel] = useState<string[]>(current ?? [])
  if (!model) return null
  const ok = () => {
    useApp.getState().setViewAsRoles(sel.length ? sel : null)
    onClose()
  }
  const supported = !engine || typeof engine.setViewAsRoles === 'function'
  return (
    <Modal
      title="View as roles"
      onClose={onClose}
      onSubmit={ok}
      width={440}
      footer={
        <>
          <Button variant="primary" onClick={ok}>
            OK
          </Button>
          <Button onClick={onClose}>Cancel</Button>
        </>
      }
    >
      <div className="wbi-form">
        {!supported && <NotificationBar kind="warning">The query engine in this build does not apply row-level security yet; visuals will still show all data.</NotificationBar>}
        <Checkbox checked={sel.length === 0} onChange={() => setSel([])} label="None" />
        <Checkbox checked={false} disabled onChange={() => undefined} label="Other user (USERPRINCIPALNAME is not simulated)" />
        {!model.roles.length && <div className="wbi-form__hint">This model has no roles. Use Manage roles to create one.</div>}
        {model.roles.map((r) => (
          <Checkbox key={r.name} checked={sel.includes(r.name)} onChange={(v) => setSel(v ? [...sel, r.name] : sel.filter((n) => n !== r.name))} label={r.name} />
        ))}
      </div>
    </Modal>
  )
}

/** "Now viewing as: …  Stop viewing" bar (PBI shows it above the canvas). Renders nothing when not viewing. */
export function ViewAsBanner() {
  const roles = useApp((s) => s.viewAsRoles)
  if (!roles?.length) return null
  return (
    <div className="wbi-viewas" role="status">
      <ShieldPersonRegular />
      <span>
        Now viewing as: <b>{roles.join(', ')}</b>
      </span>
      <button type="button" className="wbi-viewas__stop" onClick={() => useApp.getState().setViewAsRoles(null)}>
        Stop viewing
      </button>
    </div>
  )
}

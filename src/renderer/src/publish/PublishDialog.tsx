/**
 * File ▸ Publish: where the dashboard goes, its title, and what data it carries. The summary and warnings come from
 * src/core/publish (publishPreview) so the publisher sees what will be readable before anything is written.
 * Destinations: a folder, a zip, or a saved hosted destination (publish/destinations.ts, DestinationEditor).
 */
import { useEffect, useMemo, useState } from 'react'
import { AddRegular, WarningRegular, InfoRegular } from '@fluentui/react-icons'
import type { PublishDestination } from '@shared/host'
import { publishPreview } from '@core/publish/bundle'
import { Button, Checkbox, Modal, Radio, TextField } from '../app/ui'
import { confirmDialog } from '../app/ui/Modal'
import { useApp } from '../state/store'
import { PUBLISH_TARGETS, publishReport, usePublishDialog, usePublishPrefs } from '.'
import { kindInfo, normalizeSite, rememberSite, rememberedSite, slugify, useDestinations } from './destinations'
import { DestinationEditor } from './DestinationEditor'
import './publish.css'

export function PublishDialog() {
  const open = usePublishDialog((s) => s.open)
  const project = useApp((s) => s.project)
  if (!open || !project?.report) return null
  return <PublishBody key={project.id} />
}

/** Per-report key for remembered site names: the opened file, else the project name. */
function reportKey(project: { name: string; source: { path?: string } }): string {
  return project.source.path || project.name
}

function DestinationRow({ d, checked, onSelect }: { d: PublishDestination; checked: boolean; onSelect(): void }) {
  return (
    <div className="wbi-pub__target">
      <Radio checked={checked} onChange={onSelect} label={d.name} />
      <div className="wbi-pub__desc">{kindInfo(d.kind)?.label ?? d.kind}</div>
    </div>
  )
}

function PublishBody() {
  const project = useApp((s) => s.project)!
  const prefs = usePublishPrefs()
  const dests = useDestinations((s) => s.list)
  const hosted = !!window.wbi.publish?.destinations
  const [title, setTitle] = useState(project.name)
  const [editing, setEditing] = useState<PublishDestination | 'new' | null>(null)
  const [sites, setSites] = useState<Record<string, string>>({})
  const [access, setAccess] = useState<'keep' | 'public' | 'password'>('keep')
  const [password, setPassword] = useState('')
  const [check, setCheck] = useState<{ id: string; ok: boolean; message: string } | 'running' | null>(null)
  useEffect(() => {
    void useDestinations.getState().refresh()
  }, [])
  const close = () => usePublishDialog.getState().set(false)
  const selected = dests.find((d) => d.id === prefs.target)
  const target = selected ? selected.id : prefs.target === 'zip' ? 'zip' : 'folder'
  const info = selected ? kindInfo(selected.kind) : undefined
  const site = selected ? (sites[selected.id] ?? rememberedSite(reportKey(project), selected.id) ?? slugify(title)) : ''

  const preview = useMemo(() => {
    try {
      return { summary: publishPreview(project, { trimData: prefs.trimData, stripQueries: prefs.stripQueries }), error: null }
    } catch (e) {
      return { summary: null, error: e instanceof Error ? e.message : String(e) }
    }
  }, [project, prefs.trimData, prefs.stripQueries])
  const needsPassword = selected?.kind === 'lumen-server' && access === 'password' && !password
  const go = () => {
    if (!preview.summary || needsPassword) return
    let finalSite: string | undefined
    if (selected) {
      finalSite = normalizeSite(selected.kind, site)
      rememberSite(reportKey(project), selected.id, finalSite)
    }
    close()
    const lumenAccess = selected?.kind === 'lumen-server' && access !== 'keep' ? { mode: access, ...(access === 'password' ? { password } : {}) } : undefined
    void publishReport({ target, title, site: finalSite, access: lumenAccess, trimData: prefs.trimData, stripQueries: prefs.stripQueries })
  }
  const test = async () => {
    if (!selected) return
    setCheck('running')
    const r = await window.wbi.publish!.destinations.test(selected.id, normalizeSite(selected.kind, site) || undefined)
    setCheck({ id: selected.id, ...r })
  }
  const remove = async () => {
    if (!selected) return
    const choice = await confirmDialog({ title: 'Remove destination?', message: `"${selected.name}" and its saved token are removed from Lumen. Dashboards already published stay online.`, buttons: ['Remove', 'Cancel'], primary: 0 })
    if (choice !== 0) return
    await window.wbi.publish!.destinations.remove(selected.id)
    prefs.set({ target: 'folder' })
    await useDestinations.getState().refresh()
  }

  if (editing)
    return (
      <DestinationEditor
        existing={editing === 'new' ? undefined : editing}
        onClose={(saved) => {
          setEditing(null)
          if (saved) prefs.set({ target: saved.id })
        }}
      />
    )

  const s = preview.summary
  const shownCheck = check && check !== 'running' && check.id === selected?.id ? check : null
  return (
    <Modal
      title="Publish dashboard"
      onClose={close}
      width={580}
      onSubmit={go}
      className="wbi-pub"
      footerLeft={preview.error ? <span className="wbi-pub__reason">{preview.error}</span> : undefined}
      footer={
        <>
          <Button variant="primary" disabled={!s || needsPassword} onClick={go}>
            Publish
          </Button>
          <Button onClick={close}>Cancel</Button>
        </>
      }
    >
      <div className="wbi-col wbi-pub__body">
        <div className="wbi-dlg-help">An interactive web version of this report: page navigation, slicers, cross-filtering, drill and tooltips, calculated in the viewer's browser.</div>
        <TextField label="Title" value={title} onChange={setTitle} />
        <div className="wbi-pub__section" role="radiogroup" aria-label="Destination">
          <div className="wbi-pub__label">Destination</div>
          {PUBLISH_TARGETS.map((t) => (
            <div key={t.id} className="wbi-pub__target">
              <Radio checked={target === t.id} onChange={() => prefs.set({ target: t.id })} label={t.label} />
              <div className="wbi-pub__desc">{t.description}</div>
            </div>
          ))}
          {dests.map((d) => (
            <DestinationRow key={d.id} d={d} checked={target === d.id} onSelect={() => prefs.set({ target: d.id })} />
          ))}
          {hosted ? (
            <div>
              <Button size="small" icon={<AddRegular />} onClick={() => setEditing('new')}>
                Add destination
              </Button>
              <span className="wbi-pub__hint"> GitHub Pages, Netlify, Cloudflare Pages, S3-compatible storage, Lumen Server</span>
            </div>
          ) : null}
        </div>
        {selected && info ? (
          <div className="wbi-pub__section wbi-pub__dest">
            <TextField label={info.siteLabel} value={site} hint={info.siteHint} onChange={(v) => setSites((x) => ({ ...x, [selected.id]: v }))} />
            <div className="wbi-pub__row">
              <Button size="small" onClick={() => void test()} disabled={check === 'running'}>
                {check === 'running' ? 'Checking…' : 'Check connection'}
              </Button>
              <Button size="small" onClick={() => setEditing(selected)}>
                Edit
              </Button>
              <Button size="small" onClick={() => void remove()}>
                Remove
              </Button>
            </div>
            {selected.kind === 'lumen-server' ? (
              <div className="wbi-pub__access" role="radiogroup" aria-label="Who can open it">
                <div className="wbi-pub__label">Who can open it</div>
                <Radio checked={access === 'keep'} onChange={() => setAccess('keep')} label="Keep the current setting (anyone with the link for a new dashboard)" />
                <Radio checked={access === 'public'} onChange={() => setAccess('public')} label="Anyone with the link" />
                <Radio checked={access === 'password'} onChange={() => setAccess('password')} label="People with a password" />
                {access === 'password' ? <TextField label="Password" type="password" value={password} onChange={setPassword} hint="Viewers type it once per browser. The server stores only a hash." /> : null}
              </div>
            ) : null}
            {shownCheck ? <div className={shownCheck.ok ? 'wbi-pub__ok' : 'wbi-pub__reason'}>{shownCheck.message}</div> : null}
          </div>
        ) : null}
        <div className="wbi-pub__section">
          <div className="wbi-pub__label">Data</div>
          <Checkbox checked={prefs.trimData} onChange={(v) => prefs.set({ trimData: !!v })} label="Leave out columns the report and its measures never use" />
          <Checkbox checked={prefs.stripQueries} onChange={(v) => prefs.set({ stripQueries: !!v })} label="Leave out Power Query queries (server names, paths and parameters)" />
          {s ? (
            <div className="wbi-pub__summary">
              {s.tables} {s.tables === 1 ? 'table' : 'tables'}, {s.rows.toLocaleString()} rows, {s.columns - s.columnsLeftOut} of {s.columns} columns with data
              {s.queriesRemoved ? `, ${s.queriesRemoved} ${s.queriesRemoved === 1 ? 'query' : 'queries'} left out` : ''}.
            </div>
          ) : null}
        </div>
        <div className="wbi-pub__note">
          <InfoRegular fontSize={16} />
          <span>Anyone who can open the published site can read the data it carries, the way Publish to web works in Power BI. Publish only what you are allowed to share.</span>
        </div>
        {s?.warnings.map((w) => (
          <div key={w} className="wbi-pub__note wbi-pub__note--warn">
            <WarningRegular fontSize={16} />
            <span>{w}</span>
          </div>
        ))}
      </div>
    </Modal>
  )
}

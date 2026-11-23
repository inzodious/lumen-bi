/**
 * File ▸ Publish: where the dashboard goes, its title, and what data it carries. The summary and warnings come from
 * src/core/publish (publishPreview) so the publisher sees what will be readable before anything is written.
 */
import { useMemo, useState } from 'react'
import { WarningRegular, InfoRegular } from '@fluentui/react-icons'
import { publishPreview } from '@core/publish/bundle'
import { Button, Checkbox, Modal, Radio, TextField } from '../app/ui'
import { useApp } from '../state/store'
import { PUBLISH_TARGETS, publishReport, usePublishDialog, usePublishPrefs } from '.'
import './publish.css'

export function PublishDialog() {
  const open = usePublishDialog((s) => s.open)
  const project = useApp((s) => s.project)
  if (!open || !project?.report) return null
  return <PublishBody key={project.id} />
}

function PublishBody() {
  const project = useApp((s) => s.project)!
  const prefs = usePublishPrefs()
  const [title, setTitle] = useState(project.name)
  const close = () => usePublishDialog.getState().set(false)
  const preview = useMemo(() => {
    try {
      return { summary: publishPreview(project, { trimData: prefs.trimData, stripQueries: prefs.stripQueries }), error: null }
    } catch (e) {
      return { summary: null, error: e instanceof Error ? e.message : String(e) }
    }
  }, [project, prefs.trimData, prefs.stripQueries])
  const go = () => {
    if (!preview.summary) return
    close()
    void publishReport({ target: prefs.target, title, trimData: prefs.trimData, stripQueries: prefs.stripQueries })
  }
  const s = preview.summary
  return (
    <Modal
      title="Publish dashboard"
      onClose={close}
      width={560}
      onSubmit={go}
      className="wbi-pub"
      footerLeft={preview.error ? <span className="wbi-pub__reason">{preview.error}</span> : undefined}
      footer={
        <>
          <Button variant="primary" disabled={!s} onClick={go}>
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
              <Radio checked={prefs.target === t.id} onChange={() => prefs.set({ target: t.id })} label={t.label} />
              <div className="wbi-pub__desc">{t.description}</div>
            </div>
          ))}
        </div>
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

/**
 * DEV ONLY — #/modeling-test harness for the modeling workstream: loads a small sample project, uses the
 * real engine when available (else a dev adapter over src/core/dax), and renders the Table / Model /
 * DAX query views with their contextual ribbon tabs and dialogs. Hash params:
 *   view=data|model|dax   field=Table | Table.Column | Table.[Measure]   dialog=<modeling command>
 *   query=<DAX>&run=1     complete=1 (open IntelliSense at the end of the editor)
 */
import { useEffect, useState } from 'react'
import { useApp, type AppView } from '../../state/store'
import { createDevProject } from './devProject'
import { createDevEngine } from './devEngine'
import { DataView } from '../data/DataView'
import { FormulaBar } from '../../editors/FormulaBar'
import { ModelView } from '../model/ModelView'
import { DaxQueryView } from '../dax/DaxQueryView'
import { ModelingDialogHost, openModelingDialog } from '../../dialogs/modeling'
import { useRibbonRegistry, visibleTabs } from '../../app/ribbon/registry'
import { ContextMenuHost, DialogHost, ToastHost } from '../../app/ui'
import { useDaxQueries } from '../dax/queriesState'
import { parseHash } from '../../app/Router'
import { EditorView } from '@codemirror/view'
import { startCompletion } from '@codemirror/autocomplete'

function ensureEngine(): void {
  const s = useApp.getState()
  if (s.project && !s.engine) useApp.setState({ engine: createDevEngine(s.project.model, s.project.data) })
}

export function ModelingDev() {
  const [ready, setReady] = useState(false)
  const view = useApp((s) => s.view)
  const state = useApp()
  const tabs = useRibbonRegistry((s) => s.tabs)
  useEffect(() => {
    const params = parseHash(window.location.hash).params
    useApp.getState().setProject(createDevProject())
    ensureEngine()
    const unsub = useApp.subscribe(() => ensureEngine())
    const v = (params.get('view') ?? 'model') as AppView
    useApp.getState().setView(v)
    const field = params.get('field')
    if (field) {
      const m = /^(.+?)\.\[(.+)\]$/.exec(field)
      if (m) useApp.getState().selectField({ kind: 'measure', table: m[1], name: m[2] })
      else {
        const [t, ...c] = field.split('.')
        useApp.getState().selectField(c.length ? { kind: 'column', table: t, name: c.join('.') } : { kind: 'table', table: t })
      }
    }
    const query = params.get('query')
    if (query) {
      useDaxQueries.getState().init('dev-modeling', {})
      const id = useDaxQueries.getState().tabs[0].id
      useDaxQueries.getState().update(id, { text: query })
      if (params.get('run') === '1') {
        try {
          const res = useApp.getState().engine!.runDaxQuery(query)
          useDaxQueries.getState().update(id, { result: { tables: res.tables, durationMs: res.durationMs, at: Date.now() } })
        } catch (e) {
          useDaxQueries.getState().update(id, { error: { message: e instanceof Error ? e.message : String(e) } })
        }
      }
    }
    // complete=1: open IntelliSense at the end of the first DAX editor (screenshots of the completion list)
    if (params.get('complete') === '1')
      setTimeout(() => {
        const el = document.querySelector('.wbi-dq .cm-editor, .wbi-formula-bar .cm-editor') as HTMLElement | null
        const view = el ? EditorView.findFromDOM(el) : null
        if (!view) return
        view.focus()
        view.dispatch({ selection: { anchor: view.state.doc.length } })
        startCompletion(view)
      }, 400)
    const dialog = params.get('dialog')
    if (dialog) setTimeout(() => openModelingDialog(dialog, params.get('arg') ?? undefined), 50)
    setReady(true)
    const t = setTimeout(() => (document.body.dataset.wbiReady = '1'), 1500)
    return () => {
      unsub()
      clearTimeout(t)
    }
  }, [])
  if (!ready) return null
  const ctx = visibleTabs(tabs, state).filter((t) => t.contextual)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#fff' }}>
      <div style={{ display: 'flex', gap: 4, alignItems: 'center', padding: '4px 8px', borderBottom: '1px solid #e1dfdd', background: '#f3f2f1', fontSize: 12 }}>
        <b style={{ marginRight: 8 }}>Modeling test</b>
        {(['data', 'model', 'dax'] as AppView[]).map((v) => (
          <button key={v} type="button" onClick={() => useApp.getState().setView(v)} style={{ fontWeight: view === v ? 700 : 400 }}>
            {v}
          </button>
        ))}
        <span style={{ marginLeft: 16, color: '#605e5c' }}>{state.engineError ? 'engine: dev adapter' : 'engine: real'}</span>
      </div>
      {ctx.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'stretch', gap: 0, borderBottom: '1px solid #e1dfdd', background: '#fff', minHeight: 92 }} className="wbi-ribbon__body">
          <div style={{ writingMode: 'vertical-rl', fontSize: 11, color: '#605e5c', padding: 4 }}>{ctx[0].label}</div>
          <div style={{ display: 'flex', alignItems: 'stretch' }}>{ctx[0].render()}</div>
        </div>
      )}
      {view !== 'dax' && <FormulaBar />}
      <div style={{ flex: 1, minHeight: 0 }}>
        {view === 'data' && <DataView />}
        {view === 'model' && <ModelView />}
        {view === 'dax' && <DaxQueryView />}
      </div>
      <ModelingDialogHost />
      <ContextMenuHost />
      <DialogHost />
      <ToastHost />
    </div>
  )
}

export default ModelingDev

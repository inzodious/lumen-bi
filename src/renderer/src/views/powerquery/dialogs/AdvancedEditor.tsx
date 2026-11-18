/**
 * Advanced Editor (Home / View ▸ Advanced Editor): the query's full M text in a code editor, as in
 * Power BI Desktop — title = query name, "Display Options" menu (line numbers, word wrap, render
 * whitespace; remembered), the syntax status line ("No syntax errors have been detected." or the
 * first parse error) and Done / Cancel. Done is allowed with syntax errors, like Power Query (the
 * query then fails with Expression.SyntaxError).
 */
import { useShallow } from 'zustand/react/shallow'
import { useMemo, useState } from 'react'
import { CheckmarkRegular, ChevronDownRegular, WarningRegular } from '@fluentui/react-icons'
import { Button, MenuButton, Modal } from '../../../app/ui'
import { mSyntaxCheck } from '../../../editors/m-lang'
import { patchQuery } from '../actions'
import { outlineQuery } from '../logic/steps'
import { MEditor, type MDiagnostic } from '../MEditor'
import { usePq } from '../pqStore'

interface DisplayOptions {
  lineNumbers: boolean
  wrap: boolean
  whitespace: boolean
}

const OPTIONS_KEY = 'lumen.pq.advancedEditor'
const DEFAULT_OPTIONS: DisplayOptions = { lineNumbers: true, wrap: false, whitespace: false }

function loadOptions(): DisplayOptions {
  try {
    const raw = localStorage.getItem(OPTIONS_KEY)
    return raw ? { ...DEFAULT_OPTIONS, ...(JSON.parse(raw) as Partial<DisplayOptions>) } : DEFAULT_OPTIONS
  } catch {
    return DEFAULT_OPTIONS
  }
}

function saveOptions(o: DisplayOptions): void {
  try {
    localStorage.setItem(OPTIONS_KEY, JSON.stringify(o))
  } catch {
    /* storage unavailable */
  }
}

export function AdvancedEditor({ queryId, onClose }: { queryId: string; onClose(): void }) {
  const query = usePq((s) => s.draft.queries.find((q) => q.id === queryId) ?? null)
  const queryNames = usePq(useShallow((s) => s.draft.queries.map((q) => q.name)))
  const [text, setText] = useState(query?.source ?? '')
  const [opts, setOpts] = useState<DisplayOptions>(loadOptions)
  // the lint pass reports asynchronously; compute synchronously too so the status is right on open
  const [diags, setDiags] = useState<MDiagnostic[] | null>(null)
  const syntax = useMemo(() => {
    if (diags) return diags[0] ?? null
    return text.trim() ? mSyntaxCheck(text) : null
  }, [diags, text])
  const steps = useMemo(() => outlineQuery(text)?.steps.map((s) => s.name) ?? [], [text])

  const toggle = (k: keyof DisplayOptions) => {
    const next = { ...opts, [k]: !opts[k] }
    setOpts(next)
    saveOptions(next)
  }

  const done = () => {
    if (query && text !== query.source) patchQuery(query.id, { source: text })
    onClose()
  }

  if (!query) return null
  return (
    <Modal
      title={query.name}
      onClose={onClose}
      width={900}
      height={600}
      className="wbi-pq-adv"
      footerLeft={
        <div className="wbi-pq-adv__status" role="status">
          {syntax ? (
            <>
              <WarningRegular className="wbi-pq-adv__warn" fontSize={16} />
              <span className="wbi-pq-adv__status-text" title={syntax.message}>
                {syntax.message} (line {syntax.line}, column {syntax.col})
              </span>
            </>
          ) : (
            <>
              <CheckmarkRegular className="wbi-pq-adv__ok" fontSize={16} />
              <span className="wbi-pq-adv__status-text">No syntax errors have been detected.</span>
            </>
          )}
        </div>
      }
      footer={
        <>
          <Button variant="primary" onClick={done}>
            Done
          </Button>
          <Button onClick={onClose}>Cancel</Button>
        </>
      }
    >
      <div className="wbi-pq-adv__bar">
        <MenuButton
          className="wbi-pq-adv__opts"
          placement="bottom-end"
          items={() => [
            { label: 'Display line numbers', checked: opts.lineNumbers, onClick: () => toggle('lineNumbers') },
            { label: 'Render whitespace', checked: opts.whitespace, onClick: () => toggle('whitespace') },
            { label: 'Enable word wrap', checked: opts.wrap, onClick: () => toggle('wrap') }
          ]}
        >
          Display Options <ChevronDownRegular fontSize={12} />
        </MenuButton>
      </div>
      <div className="wbi-pq-adv__editor">
        <MEditor
          value={text}
          onChange={(v) => {
            setText(v)
            setDiags(null)
          }}
          onSubmit={done}
          lineNumbers={opts.lineNumbers}
          wrap={opts.wrap}
          showWhitespace={opts.whitespace}
          autoFocus
          completions={{ steps, queries: queryNames.filter((n) => n !== query.name) }}
          onDiagnostics={setDiags}
        />
      </div>
    </Modal>
  )
}

/**
 * <DaxEditor/> — reusable CodeMirror 6 DAX editor (formula bar, dialogs, DAX query view).
 *
 * Features: PBI-like syntax colors, IntelliSense (functions / tables / columns / measures / VARs),
 * parameter hints, bracket matching & auto-close, auto-indent, Ctrl+/ comment toggle,
 * Shift+Alt+F format, error squiggles (local checks + optional engine validation).
 */
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { Compartment, EditorState, Prec, type Extension } from '@codemirror/state'
import {
  EditorView,
  drawSelection,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  placeholder as cmPlaceholder
} from '@codemirror/view'
import { bracketMatching, indentOnInput, indentUnit } from '@codemirror/language'
import { acceptCompletion, autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap, completionStatus } from '@codemirror/autocomplete'
import { defaultKeymap, history, historyKeymap, indentWithTab, insertNewlineAndIndent, toggleComment } from '@codemirror/commands'
import { linter, lintGutter, type Diagnostic } from '@codemirror/lint'
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search'
import type { ExpressionDiagnostic } from '@core/engine/api'
import { dax } from './language'
import { daxCompletionSource } from './completion'
import { daxSignatureHelp } from './signatureHelp'
import { localDaxDiagnostics, mergeDiagnostics, type DaxDiagnostic } from './diagnostics'
import { daxHover } from './hover'
import { formatDax } from './formatter'
import type { DaxSchema } from './schema'
import './dax-editor.css'

export interface DaxEditorHandle {
  focus(): void
  /** Format the whole document (DAX Formatter rules). */
  format(): void
  insertText(text: string): void
  getValue(): string
  setValue(text: string): void
  view(): EditorView | null
}

export interface DaxEditorProps {
  value: string
  onChange?(value: string): void
  /** Ctrl+Enter (and Enter when `enterSubmits`) */
  onSubmit?(value: string): void
  /** F5 (DAX query view "Run") */
  onRun?(value: string): void
  /** Escape */
  onCancel?(): void
  /** Model metadata for completion + reference checks. */
  schema?: DaxSchema
  /** Extra validation (e.g. engine.validateExpression), offsets relative to the editor text. */
  validate?(text: string): ExpressionDiagnostic[]
  /** Called with the merged diagnostics after each lint pass. */
  onDiagnostics?(diags: ExpressionDiagnostic[]): void
  /** Plain Enter submits (formula bar); Shift+Enter inserts a new line. */
  enterSubmits?: boolean
  query?: boolean
  lineNumbers?: boolean
  readOnly?: boolean
  placeholder?: string
  autoFocus?: boolean
  className?: string
  minHeight?: number
  maxHeight?: number
  /** custom formatter for the whole text (formula bar uses formatDaxDefinition) */
  formatter?(text: string): string
  /** disable local reference/syntax checks */
  noLocalLint?: boolean
  /** soft-wrap long lines */
  wrap?: boolean
  /** offset where the DAX starts (formula bar: after `Name =`); local lint ignores the text before it */
  lintFrom?(text: string): number
}

export const DaxEditor = forwardRef<DaxEditorHandle, DaxEditorProps>(function DaxEditor(props, ref) {
  const host = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const propsRef = useRef(props)
  propsRef.current = props
  const readOnlyComp = useRef(new Compartment())

  const doFormat = (view: EditorView): boolean => {
    const text = view.state.doc.toString()
    const fmt = (propsRef.current.formatter ?? ((s: string) => formatDax(s)))(text)
    if (fmt !== text) view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: fmt } })
    return true
  }

  useEffect(() => {
    if (!host.current) return
    const p = propsRef.current
    const extensions: Extension[] = [
      highlightSpecialChars(),
      history(),
      drawSelection(),
      indentOnInput(),
      indentUnit.of('    '),
      bracketMatching(),
      closeBrackets(),
      highlightSelectionMatches(),
      dax(),
      autocompletion({
        override: [daxCompletionSource({ schema: () => propsRef.current.schema ?? { tables: [] }, query: propsRef.current.query })],
        icons: true,
        activateOnTyping: true,
        maxRenderedOptions: 80,
        closeOnBlur: true
      }),
      daxSignatureHelp,
      daxHover(() => propsRef.current.schema ?? { tables: [] }),
      linter(
        (view) => {
          const text = view.state.doc.toString()
          const cur = propsRef.current
          const from = cur.lintFrom ? Math.max(0, cur.lintFrom(text)) : 0
          let diags: DaxDiagnostic[] = cur.noLocalLint
            ? []
            : localDaxDiagnostics(text.slice(from), cur.schema).map((d) => ({ ...d, start: d.start !== undefined ? d.start + from : undefined, end: d.end !== undefined ? d.end + from : undefined }))
          if (cur.validate && text.trim()) {
            try {
              diags = mergeDiagnostics(cur.validate(text), diags)
            } catch {
              /* engine failure → local diagnostics only */
            }
          }
          cur.onDiagnostics?.(diags)
          const len = text.length
          return diags.map<Diagnostic>((d) => {
            const from = Math.min(Math.max(0, d.start ?? 0), len)
            let to = Math.min(Math.max(from, d.end ?? (d.start !== undefined ? d.start + 1 : len)), len)
            if (to === from && len > 0) to = Math.min(len, from + 1)
            const f0 = to === from && from > 0 ? from - 1 : from
            return {
              from: f0,
              to,
              severity: d.severity,
              message: d.message,
              actions: (d.fixes ?? []).map((fix) => ({
                name: `Change to ${fix}`,
                apply: (v: EditorView, a: number, b: number) => v.dispatch({ changes: { from: a, to: b, insert: fix } })
              }))
            }
          })
        },
        { delay: 350 }
      ),
      Prec.highest(
        keymap.of([
          // Tab / Enter accept the highlighted completion; otherwise Tab indents (indentWithTab below)
          { key: 'Tab', run: acceptCompletion },
          {
            key: 'Enter',
            run: (view) => {
              if (completionStatus(view.state) === 'active') return acceptCompletion(view)
              // formula bar: Enter commits a single-line formula (like PBI); multi-line → new indented line
              if (!propsRef.current.enterSubmits || view.state.doc.lines > 1) return false
              propsRef.current.onSubmit?.(view.state.doc.toString())
              return true
            }
          },
          { key: 'Shift-Enter', run: insertNewlineAndIndent },
          {
            key: 'Mod-Enter',
            run: (view) => {
              const cur = propsRef.current
              if (cur.onSubmit) cur.onSubmit(view.state.doc.toString())
              else if (cur.onRun) cur.onRun(view.state.doc.toString())
              else return false
              return true
            }
          },
          {
            key: 'F5',
            run: (view) => {
              if (!propsRef.current.onRun) return false
              propsRef.current.onRun(view.state.doc.toString())
              return true
            }
          },
          {
            key: 'Escape',
            run: (view) => {
              if (completionStatus(view.state) !== null || !propsRef.current.onCancel) return false
              propsRef.current.onCancel()
              return true
            }
          },
          { key: 'Mod-/', run: toggleComment },
          { key: 'Shift-Alt-f', run: doFormat }
        ])
      ),
      keymap.of([...closeBracketsKeymap, ...completionKeymap, ...defaultKeymap, ...searchKeymap, ...historyKeymap, indentWithTab]),
      readOnlyComp.current.of(EditorState.readOnly.of(!!p.readOnly)),
      EditorView.updateListener.of((u) => {
        if (u.docChanged) propsRef.current.onChange?.(u.state.doc.toString())
      }),
      EditorView.theme({
        '&': { ...(p.minHeight ? { minHeight: `${p.minHeight}px` } : {}), ...(p.maxHeight ? { maxHeight: `${p.maxHeight}px` } : {}) },
        '.cm-scroller': { overflow: 'auto' }
      })
    ]
    if (p.lineNumbers) extensions.push(lineNumbers(), highlightActiveLineGutter(), highlightActiveLine(), lintGutter())
    if (p.placeholder) extensions.push(cmPlaceholder(p.placeholder))
    if (p.wrap) extensions.push(EditorView.lineWrapping)
    const view = new EditorView({ state: EditorState.create({ doc: p.value, extensions }), parent: host.current })
    viewRef.current = view
    if (p.autoFocus) {
      view.focus()
      view.dispatch({ selection: { anchor: view.state.doc.length } })
    }
    return () => {
      view.destroy()
      viewRef.current = null
    }
  }, [])

  // external value changes
  useEffect(() => {
    const view = viewRef.current
    if (view && view.state.doc.toString() !== props.value) {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: props.value } })
    }
  }, [props.value])

  useEffect(() => {
    viewRef.current?.dispatch({ effects: readOnlyComp.current.reconfigure(EditorState.readOnly.of(!!props.readOnly)) })
  }, [props.readOnly])

  useImperativeHandle(ref, () => ({
    focus: () => viewRef.current?.focus(),
    format: () => {
      if (viewRef.current) doFormat(viewRef.current)
    },
    insertText: (text) => {
      const view = viewRef.current
      if (!view) return
      const sel = view.state.selection.main
      view.dispatch({ changes: { from: sel.from, to: sel.to, insert: text }, selection: { anchor: sel.from + text.length } })
      view.focus()
    },
    getValue: () => viewRef.current?.state.doc.toString() ?? '',
    setValue: (text) => {
      const view = viewRef.current
      if (view) view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } })
    },
    view: () => viewRef.current
  }))

  return <div ref={host} className={`wbi-dax-editor ${props.className ?? ''}`} />
})

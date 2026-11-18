/**
 * <MEditor/> — CodeMirror 6 Power Query M editor used by the formula bar, the Advanced Editor and the
 * Custom Column dialog.
 *
 * Features: PBI Advanced Editor colors, auto-indent (let / in / brackets), bracket matching and
 * auto-close, Ctrl+/ comment toggle, autocomplete (M library + steps / queries / columns), syntax
 * squiggles from the engine's parser. `singleLine` = formula bar behaviour (Enter commits,
 * Shift+Enter inserts a line break, Escape cancels). Display options (line numbers, word wrap,
 * whitespace, read-only) are live-reconfigurable.
 */
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { Compartment, EditorState, Prec, type Extension } from '@codemirror/state'
import { EditorView, drawSelection, highlightActiveLine, highlightActiveLineGutter, highlightSpecialChars, highlightWhitespace, keymap, lineNumbers, placeholder as cmPlaceholder } from '@codemirror/view'
import { getIndentation } from '@codemirror/language'
import { acceptCompletion, closeBracketsKeymap, completionKeymap, completionStatus } from '@codemirror/autocomplete'
import { defaultKeymap, history, historyKeymap, indentWithTab, insertNewlineAndIndent, toggleComment } from '@codemirror/commands'
import { lintGutter } from '@codemirror/lint'
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search'
import { mExtensions } from '../../editors/m-lang'
import './m-editor.css'

export interface MDiagnostic {
  message: string
  line: number
  col: number
}

export interface MEditorProps {
  value: string
  onChange?(value: string): void
  /** formula bar: Enter commits (Shift+Enter = new line); elsewhere Ctrl+Enter */
  onSubmit?(value: string): void
  onCancel?(): void
  /** formula bar mode: Enter submits, no line numbers, compact */
  singleLine?: boolean
  lineNumbers?: boolean
  wrap?: boolean
  showWhitespace?: boolean
  autoFocus?: boolean
  readOnly?: boolean
  className?: string
  minHeight?: number
  maxHeight?: number
  placeholder?: string
  /** extra completion names: step names, query names, column names (inserted as [Column]) */
  completions?: { steps?: string[]; queries?: string[]; columns?: string[] }
  /** parse diagnostics after each lint pass (empty = no syntax errors) */
  onDiagnostics?(diags: MDiagnostic[]): void
  /** the text is an expression body (formula bar `= …`, custom column) rather than a whole query */
  expression?: boolean
}

export interface MEditorHandle {
  focus(): void
  insertText(text: string): void
  getValue(): string
}

/** Enter on a line holding only `in`: put `in` at its `let`'s indentation first, then break the line. */
function newlineReindentingIn(view: EditorView): boolean {
  const head = view.state.selection.main.head
  const line = view.state.doc.lineAt(head)
  if (/^\s*in\s*$/.test(line.text)) {
    const want = getIndentation(view.state, line.from)
    const cur = /^\s*/.exec(line.text)![0].length
    if (want !== null && want !== cur) view.dispatch({ changes: { from: line.from, to: line.from + cur, insert: ' '.repeat(want) } })
  }
  return insertNewlineAndIndent(view)
}

export const MEditor = forwardRef<MEditorHandle, MEditorProps>(function MEditor(props, ref) {
  const host = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const propsRef = useRef(props)
  propsRef.current = props
  const gutterComp = useRef(new Compartment())
  const wrapComp = useRef(new Compartment())
  const wsComp = useRef(new Compartment())
  const roComp = useRef(new Compartment())

  const gutterExt = (on: boolean): Extension => (on ? [lineNumbers(), highlightActiveLineGutter(), highlightActiveLine(), lintGutter()] : [])

  useEffect(() => {
    if (!host.current) return
    const p = propsRef.current
    const extensions: Extension[] = [
      highlightSpecialChars(),
      history(),
      drawSelection(),
      highlightSelectionMatches(),
      mExtensions({
        get expression() {
          return !!propsRef.current.expression
        },
        names: () => propsRef.current.completions ?? {},
        onDiagnostics: (d) => propsRef.current.onDiagnostics?.(d)
      }),
      Prec.highest(
        keymap.of([
          { key: 'Tab', run: acceptCompletion },
          {
            key: 'Enter',
            run: (view) => {
              if (completionStatus(view.state) === 'active') return acceptCompletion(view)
              const cur = propsRef.current
              if (cur.singleLine && cur.onSubmit) {
                cur.onSubmit(view.state.doc.toString())
                return true
              }
              return newlineReindentingIn(view)
            }
          },
          { key: 'Shift-Enter', run: newlineReindentingIn },
          {
            key: 'Mod-Enter',
            run: (view) => {
              const cur = propsRef.current
              if (!cur.onSubmit) return false
              cur.onSubmit(view.state.doc.toString())
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
          { key: 'Mod-/', run: toggleComment }
        ])
      ),
      keymap.of([...closeBracketsKeymap, ...completionKeymap, ...defaultKeymap, ...searchKeymap, ...historyKeymap, indentWithTab]),
      gutterComp.current.of(gutterExt(!!p.lineNumbers && !p.singleLine)),
      wrapComp.current.of(p.wrap || p.singleLine ? EditorView.lineWrapping : []),
      wsComp.current.of(p.showWhitespace ? highlightWhitespace() : []),
      roComp.current.of(EditorState.readOnly.of(!!p.readOnly)),
      EditorView.updateListener.of((u) => {
        if (u.docChanged) propsRef.current.onChange?.(u.state.doc.toString())
      }),
      EditorView.theme({
        '&': { ...(p.minHeight ? { minHeight: `${p.minHeight}px` } : {}), ...(p.maxHeight ? { maxHeight: `${p.maxHeight}px` } : {}) },
        '.cm-scroller': { overflow: 'auto' }
      })
    ]
    if (p.placeholder) extensions.push(cmPlaceholder(p.placeholder))
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
    if (view && view.state.doc.toString() !== props.value) view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: props.value } })
  }, [props.value])

  useEffect(() => {
    viewRef.current?.dispatch({ effects: gutterComp.current.reconfigure(gutterExt(!!props.lineNumbers && !props.singleLine)) })
  }, [props.lineNumbers, props.singleLine])
  useEffect(() => {
    viewRef.current?.dispatch({ effects: wrapComp.current.reconfigure(props.wrap || props.singleLine ? EditorView.lineWrapping : []) })
  }, [props.wrap, props.singleLine])
  useEffect(() => {
    viewRef.current?.dispatch({ effects: wsComp.current.reconfigure(props.showWhitespace ? highlightWhitespace() : []) })
  }, [props.showWhitespace])
  useEffect(() => {
    viewRef.current?.dispatch({ effects: roComp.current.reconfigure(EditorState.readOnly.of(!!props.readOnly)) })
  }, [props.readOnly])

  useImperativeHandle(ref, () => ({
    focus: () => viewRef.current?.focus(),
    insertText: (text) => {
      const view = viewRef.current
      if (!view) return
      const sel = view.state.selection.main
      view.dispatch({ changes: { from: sel.from, to: sel.to, insert: text }, selection: { anchor: sel.from + text.length } })
      view.focus()
    },
    getValue: () => viewRef.current?.state.doc.toString() ?? props.value
  }))

  return <div ref={host} className={`wbi-pq-me${props.singleLine ? ' wbi-pq-me--single' : ''} ${props.className ?? ''}`} />
})

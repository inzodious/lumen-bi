/**
 * One CodeMirror editor of the code visual editor (HTML, CSS or JSX). Keyboard shortcuts follow the DAX editor:
 * Ctrl+Enter applies, Ctrl+/ toggles a comment, Tab accepts a completion or indents, Ctrl+F searches, Ctrl+Z / Ctrl+Y
 * undo and redo the typing (the editor's own history).
 */
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { EditorState, Prec, type Extension } from '@codemirror/state'
import { EditorView, drawSelection, highlightActiveLine, highlightActiveLineGutter, highlightSpecialChars, keymap, lineNumbers } from '@codemirror/view'
import { bracketMatching, defaultHighlightStyle, indentOnInput, indentUnit, syntaxHighlighting } from '@codemirror/language'
import { acceptCompletion, autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap, type CompletionSource } from '@codemirror/autocomplete'
import { defaultKeymap, history, historyKeymap, indentWithTab, toggleComment } from '@codemirror/commands'
import { lintGutter, setDiagnostics, type Diagnostic } from '@codemirror/lint'
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search'
import { html } from '@codemirror/lang-html'
import { css } from '@codemirror/lang-css'
import { javascript } from '@codemirror/lang-javascript'
import '../../../editors/dax/dax-editor.css'

export type CodeLang = 'html' | 'css' | 'jsx'

export interface CodeProblem {
  severity: 'error' | 'warning'
  message: string
  line?: number
  column?: number
}

export interface CodeAreaHandle {
  focus(): void
  /** move the cursor to a 1-based line / column */
  reveal(line: number, column?: number): void
  insert(text: string): void
}

export interface CodeAreaProps {
  lang: CodeLang
  value: string
  onChange(v: string): void
  onApply?(): void
  completions?: CompletionSource
  problems?: CodeProblem[]
  label: string
}

function language(lang: CodeLang): Extension {
  if (lang === 'html') return html({ autoCloseTags: true, selfClosingTags: true })
  if (lang === 'css') return css()
  return javascript({ jsx: true, typescript: true })
}

export const CodeArea = forwardRef<CodeAreaHandle, CodeAreaProps>(function CodeArea(props, ref) {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  const p = useRef(props)
  p.current = props

  useEffect(() => {
    if (!host.current) return
    const lang = language(props.lang)
    const extensions: Extension[] = [
      lineNumbers(),
      highlightActiveLineGutter(),
      highlightActiveLine(),
      highlightSpecialChars(),
      history(),
      drawSelection(),
      indentOnInput(),
      indentUnit.of('  '),
      bracketMatching(),
      closeBrackets(),
      highlightSelectionMatches(),
      syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
      lang,
      // field / variable completions next to the language's own (tags, properties, keywords)
      EditorState.languageData.of(() => [{ autocomplete: (ctx: Parameters<CompletionSource>[0]) => p.current.completions?.(ctx) ?? null }]),
      autocompletion({ activateOnTyping: true, maxRenderedOptions: 80, icons: true }),
      lintGutter(),
      Prec.highest(
        keymap.of([
          { key: 'Tab', run: acceptCompletion },
          {
            key: 'Mod-Enter',
            run: () => {
              p.current.onApply?.()
              return !!p.current.onApply
            }
          },
          { key: 'Mod-/', run: toggleComment }
        ])
      ),
      keymap.of([...closeBracketsKeymap, ...completionKeymap, ...defaultKeymap, ...searchKeymap, ...historyKeymap, indentWithTab]),
      EditorView.updateListener.of((u) => {
        if (u.docChanged) p.current.onChange(u.state.doc.toString())
      }),
      EditorView.contentAttributes.of({ 'aria-label': props.label }),
      EditorView.theme({ '&': { height: '100%' }, '.cm-scroller': { overflow: 'auto' } })
    ]
    const v = new EditorView({ state: EditorState.create({ doc: props.value, extensions }), parent: host.current })
    view.current = v
    return () => {
      v.destroy()
      view.current = null
    }
    // the language never changes for one instance (the dialog keys editors by tab)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const v = view.current
    if (v && v.state.doc.toString() !== props.value) v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: props.value } })
  }, [props.value])

  // problems → inline diagnostics (squiggles + gutter markers)
  useEffect(() => {
    const v = view.current
    if (!v) return
    const doc = v.state.doc
    const diags: Diagnostic[] = []
    for (const pr of props.problems ?? []) {
      if (!pr.line) continue
      const line = doc.line(Math.min(Math.max(1, pr.line), doc.lines))
      const from = Math.min(line.to, line.from + Math.max(0, (pr.column ?? 1) - 1))
      const to = Math.min(line.to, Math.max(from + 1, from))
      diags.push({ from: to === from && from > line.from ? from - 1 : from, to: Math.max(to, from), severity: pr.severity, message: pr.message })
    }
    v.dispatch(setDiagnostics(v.state, diags))
  }, [props.problems])

  useImperativeHandle(ref, () => ({
    focus: () => view.current?.focus(),
    reveal(line, column = 1) {
      const v = view.current
      if (!v) return
      const l = v.state.doc.line(Math.min(Math.max(1, line), v.state.doc.lines))
      const pos = Math.min(l.to, l.from + Math.max(0, column - 1))
      v.dispatch({ selection: { anchor: pos }, scrollIntoView: true })
      v.focus()
    },
    insert(text) {
      const v = view.current
      if (!v) return
      const s = v.state.selection.main
      v.dispatch({ changes: { from: s.from, to: s.to, insert: text }, selection: { anchor: s.from + text.length } })
      v.focus()
    }
  }))

  return <div ref={host} className="wbi-dax-editor wbi-cve__code" data-lang={props.lang} />
})

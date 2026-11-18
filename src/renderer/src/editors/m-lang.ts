/**
 * Power Query M language support for CodeMirror 6 (Advanced Editor, formula bar, Custom Column).
 *
 *   mLanguage()        tokenizer + PBI Advanced Editor colors + indentation
 *   mExtensions(opts)  language + bracket matching / auto-close + autocomplete + syntax lint
 *   mSyntaxCheck(text) pure parser check (Advanced Editor status line)
 */
import type { Extension } from '@codemirror/state'
import { bracketMatching, indentOnInput, indentUnit } from '@codemirror/language'
import { autocompletion, closeBrackets } from '@codemirror/autocomplete'
import { linter } from '@codemirror/lint'
import { mLanguage } from './m-lang/language'
import { mCompletionSource, type MNames } from './m-lang/completion'
import { mLintSource, type MSyntaxDiagnostic, type MSyntaxOptions } from './m-lang/lint'

export { mLanguage, mHighlightStyle, mStreamLanguage, mStreamParser, mTags, tokenizeM, mIndentAfter, indentFor, M_KEYWORDS, M_INTRINSICS, type MState, type MToken } from './m-lang/language'
export { mCompletionSource, mCompletionsFor, mWordContext, mLibrary, mFieldRef, mFieldName, type MCandidate, type MNames, type LibraryEntry } from './m-lang/completion'
export { mSyntaxCheck, mLintSource, diagnosticRange, expressionOffset, type MSyntaxDiagnostic, type MSyntaxOptions } from './m-lang/lint'

export interface MExtensionOptions extends MSyntaxOptions {
  /** host names for autocomplete (read on every request) */
  names?: () => Omit<MNames, 'library'>
  onDiagnostics?(d: MSyntaxDiagnostic[]): void
  /** lint delay (ms), default 300 */
  lintDelay?: number
  /** disable syntax lint */
  noLint?: boolean
}

/** The M language with editing helpers: auto-indent, brackets, autocomplete, syntax diagnostics. */
export function mExtensions(opts: MExtensionOptions = {}): Extension[] {
  const ext: Extension[] = [
    mLanguage(),
    indentUnit.of('    '),
    indentOnInput(),
    bracketMatching(),
    closeBrackets(),
    autocompletion({
      override: [mCompletionSource(() => opts.names?.() ?? {})],
      icons: true,
      activateOnTyping: true,
      maxRenderedOptions: 80,
      closeOnBlur: true
    })
  ]
  if (!opts.noLint) ext.push(linter(mLintSource(() => opts), { delay: opts.lintDelay ?? 300 }))
  return ext
}

/**
 * Code visual: entry points that open its dialogs (the code editor, the template picker). The dialogs and CodeMirror's
 * HTML / CSS / JavaScript languages are lazy chunks: they load the first time a dialog opens.
 */
import { CODE_VISUAL_TYPE } from '@core/codevisual/model'
import { applyTemplate, type StarterTemplate } from '@core/codevisual/templates'
import { showModelingDialog } from '../../dialogs/modeling/host'
import { useApp } from '../../state/store'
import { findPage, findVisual } from '../../report/pbir'
import { insertVisual } from '../../app/commands'
import { setCodeVisualActions } from './actions'

/** Open the code editor for a code visual of the active page (or of `pageName`). */
export function openCodeEditor(visualName: string, pageName?: string): void {
  const page = pageName ?? useApp.getState().activePage
  if (!page) return
  void import('./editor/CodeEditorDialog').then(({ CodeEditorDialog }) => {
    showModelingDialog((close) => <CodeEditorDialog pageName={page} visualName={visualName} onClose={close} />)
  })
}

/** Ask for a starter template. Resolves null when cancelled. */
export function pickCodeTemplate(opts: { title?: string; okText?: string } = {}): Promise<StarterTemplate | null> {
  return import('./editor/TemplatePicker').then(
    ({ TemplatePicker }) =>
      new Promise<StarterTemplate | null>((resolve) => {
        let done = false
        const finish = (t: StarterTemplate | null) => {
          if (done) return
          done = true
          resolve(t)
        }
        showModelingDialog((close) => (
          <TemplatePicker
            title={opts.title}
            okText={opts.okText}
            onPick={(t) => {
              close()
              finish(t)
            }}
            onClose={() => {
              close()
              finish(null)
            }}
          />
        ))
      })
  )
}

/** Insert ▸ Code visual: pick a starter template, then insert the visual with it (one undo step). */
export async function insertCodeVisual(visual: Record<string, any> = {}): Promise<string | undefined> {
  const t = await pickCodeTemplate({ title: 'New code visual', okText: 'Insert' })
  if (!t) return undefined
  const json: any = { visual: { visualType: CODE_VISUAL_TYPE, objects: { ...(visual.objects ?? {}) } } }
  applyTemplate(json, t)
  return insertVisual(CODE_VISUAL_TYPE, { ...visual, objects: json.visual.objects }, t.size, 'Insert code visual')
}

/** Replace a code visual's code with a template (one undo step). */
export async function chooseTemplateFor(pageName: string, visualName: string): Promise<void> {
  const t = await pickCodeTemplate({ title: 'Choose a template', okText: 'Use template' })
  if (!t) return
  useApp.getState().mutateReport('Apply code template', (r) => {
    const v = findVisual(findPage(r, pageName), visualName)
    if (v) applyTemplate(v.json, t)
  })
}

setCodeVisualActions({ openEditor: openCodeEditor, chooseTemplate: (p, v) => void chooseTemplateFor(p, v) })

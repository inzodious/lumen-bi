/**
 * Code visual: editor actions the renderer calls (open the code editor, choose a template). The visual layer must not
 * import the app shell (dialogs, commands), so the shell registers the implementations (editorHost.tsx, imported by
 * app/commands.ts) and the visual calls them through this module.
 */
export interface CodeVisualActions {
  openEditor(visualName: string, pageName?: string): void
  chooseTemplate(pageName: string, visualName: string): void
}

const actions: CodeVisualActions = { openEditor: () => undefined, chooseTemplate: () => undefined }

export function setCodeVisualActions(a: CodeVisualActions): void {
  Object.assign(actions, a)
}

export function codeVisualActions(): CodeVisualActions {
  return actions
}

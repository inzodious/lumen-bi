/**
 * Save as Power BI file (.pbix) / Power BI template (.pbit): states the path the writer will use
 * (core/io/pbix/write/package.ts `planPackage`), marks paths not yet confirmed in Power BI Desktop as experimental,
 * and explains why a `.pbix` cannot be written when it can't (with .pbit / PBIP as the way out).
 * Also the scripted (headless) save used by scripts/export-pbix.sh: `#/?export=pbix|pbit&exportPath=/abs[&refresh=1]`.
 */
import { planPackageSave, saveProject } from '@core/io/open'
import { describePlan, type PackageKind, type PackagePlan } from '@core/io/pbix/write/package'
import { basename } from '@core/io/fs'
import { useApp } from '../state/store'
import { confirmDialog, alertDialog } from './ui/Modal'
import { toast } from './ui/Notify'
import { rebakeIconsBeforeSave } from '../icons/actions'
import { holdBusy } from './readiness'

function host() {
  if (!window.wbi) throw new Error('No host bridge')
  return window.wbi
}

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

const KIND_LABEL: Record<PackageKind, string> = { pbix: 'Power BI file (.pbix)', pbit: 'Power BI template (.pbit)' }

function PlanMessage({ plan }: { plan: PackagePlan }) {
  return (
    <div className="wbi-col" data-testid="package-plan" data-path={plan.path ?? ''} data-experimental={plan.experimental ? '1' : '0'}>
      {plan.path && <strong>{plan.title}</strong>}
      <div>{plan.detail}</div>
      {plan.blockers.length > 0 && (
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          {plan.blockers.map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
      )}
      {plan.path && plan.experimental && (
        <div className="wbi-bs-note" data-testid="package-experimental">
          Experimental: not yet verified in Power BI Desktop. Keep your original file, and open the saved file in Power BI Desktop to check it before you
          share it.
        </div>
      )}
    </div>
  )
}

/**
 * Write the project as `.pbix` / `.pbit` to `target` after showing the plan. Resolves true when written.
 * `confirm: false` skips the dialog (scripted runs); a `.pbix` that cannot be written still fails with the reason.
 */
export async function savePackage(kind: PackageKind, target: string, opts: { confirm?: boolean } = {}): Promise<boolean> {
  let project = useApp.getState().project
  if (!project) return false
  let plan: PackagePlan
  try {
    plan = await planPackageSave(project, kind, host().fs)
  } catch (e) {
    await alertDialog(`Couldn't save as ${KIND_LABEL[kind]}`, errMessage(e))
    return false
  }
  if (!plan.path) {
    if (opts.confirm === false) throw new Error(describePlan(plan))
    await alertDialog(`Can't save as ${KIND_LABEL[kind]}`, <PlanMessage plan={plan} />)
    return false
  }
  if (opts.confirm !== false) {
    const choice = await confirmDialog({ title: `Save as ${KIND_LABEL[kind]}`, message: <PlanMessage plan={plan} />, buttons: ['Save', 'Cancel'] })
    if (choice !== 0) return false
  }
  const app = useApp.getState()
  app.setBusy({ message: `Saving ${basename(target)}…` })
  try {
    await rebakeIconsBeforeSave()
    if (useApp.getState().project?.id === project.id) project = useApp.getState().project!
    const before = project.diagnostics.length
    await saveProject(project, target, host().fs, { format: kind })
    // what the writer could not carry over (e.g. PBIR-only settings without a place in the legacy layout)
    const notes = project.diagnostics.slice(before).map((d) => d.message)
    if (kind === 'pbix') useApp.getState().markSaved({ kind: 'pbix', path: target }, basename(target).replace(/\.pbix$/i, ''))
    host()
      .app.addRecent(target, basename(target))
      .catch(() => undefined)
    toast({ kind: 'success', message: `Saved to ${target}${plan.experimental ? ' (experimental: not yet verified in Power BI Desktop)' : ''}`, duration: 5000 })
    for (const n of notes) console.warn(`[export] note: ${n}`)
    if (notes.length && opts.confirm !== false)
      await alertDialog(
        'Saved, with notes',
        <div className="wbi-col" data-testid="package-notes">
          <div>The file was saved. Lumen could not carry over everything:</div>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {notes.slice(0, 12).map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
          {notes.length > 12 && <div>…and {notes.length - 12} more.</div>}
        </div>
      )
    return true
  } catch (e) {
    if (opts.confirm === false) throw e
    await alertDialog("Couldn't save", errMessage(e))
    return false
  } finally {
    useApp.getState().setBusy(null)
  }
}

/**
 * Scripted save for headless runs (scripts/export-pbix.sh): `export=pbix|pbit&exportPath=/abs/out[&refresh=1]`.
 * With `refresh=1` the model is refreshed from its sources first (a PBIP project has no data until then; only a
 * `.pbit` can be written from it). Returns true when the params asked for a package (handled here).
 */
export async function runScriptedPackageSave(params: URLSearchParams): Promise<boolean> {
  const kind = params.get('export')
  if (kind !== 'pbix' && kind !== 'pbit') return false
  const path = params.get('exportPath')
  if (!path) return true
  const release = holdBusy('scripted package save')
  try {
    if (params.get('refresh') === '1') {
      const { refreshProjectHeadless } = await import('./savePackageRefresh')
      await refreshProjectHeadless()
    }
    await savePackage(kind, path, { confirm: false })
    console.info(`[export] ${kind} → ${path}`)
  } catch (e) {
    console.error(`[export] ${kind} failed: ${errMessage(e).replace(/\s*\n\s*/g, ' ')}`)
  } finally {
    release()
  }
  return true
}

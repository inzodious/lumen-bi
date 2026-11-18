/**
 * What a project's data looked like when it was read from a `.pbix`, so a later save can tell whether the embedded
 * `DataModel` still matches the document (stage B of the PBIX writer, docs/developer/file-format-io.md).
 *
 * The model is compared by re-reading the source file (no state needed). Data has no cheap content comparison, so the
 * reader records which `TableData` objects it produced: every data change in Lumen (refresh, Enter data, sample data,
 * a `.wbi` load) replaces a table's `TableData` object, never edits one in place (see `DataStore`). A store without a
 * record (or any replaced / added / removed table) counts as changed. Tables computed from the model (calculated
 * tables, calculation groups) are excluded: the engine rebuilds them from definitions that the model comparison checks.
 */
import type { DataStore, TableData } from '../../../model/data'
import type { SemanticModel } from '../../../model/types'

export interface PackageFileInfo {
  path: string
  size: number
  mtime: number
}

const loaded = new WeakMap<DataStore, { tables: Map<string, TableData>; file?: PackageFileInfo }>()

/** Record the tables a `.pbix` read produced (called by the loader), and the file they came from. */
export function rememberPackageData(data: DataStore, file?: PackageFileInfo): void {
  loaded.set(data, { tables: new Map(data.tables), file })
}

/** Update the file a store's data is known to match (after Lumen wrote that data into a new `.pbix`). */
export function movePackageData(data: DataStore, file: PackageFileInfo): void {
  const rec = loaded.get(data)
  if (rec) rec.file = file
}

/** The file the store's data was read from (path, size, mtime at read time). */
export function packageFileOf(data: DataStore): PackageFileInfo | undefined {
  return loaded.get(data)?.file
}

function derived(model: SemanticModel, name: string): boolean {
  const t = model.tables.find((x) => x.name.toLowerCase() === name.toLowerCase())
  if (!t) return false
  return !!t.calculationGroup || (t.partitions.length > 0 && t.partitions.every((p) => p.sourceType === 'calculated' || p.sourceType === 'calculationGroup'))
}

/**
 * Tables whose data differs from what was read from the package (empty = unchanged), or `undefined` when the store
 * was not read from a package in this session.
 */
export function dataChangedSinceRead(data: DataStore, model: SemanticModel): string[] | undefined {
  const snap = loaded.get(data)?.tables
  if (!snap) return undefined
  const changed: string[] = []
  for (const [name, td] of snap) if (!derived(model, name) && data.tables.get(name) !== td) changed.push(name)
  for (const name of data.tables.keys()) if (!snap.has(name) && !derived(model, name)) changed.push(name)
  return changed
}

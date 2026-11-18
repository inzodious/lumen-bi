/**
 * Argument dialogs of Transform / Add Column operations (pure metadata): which ops ask for input
 * before running (Add Prefix, Extract First Characters, Round, Multiply…), with PBI's titles and
 * field labels; plus the Split Column ▸ By Number of Characters "once" specs.
 */
import { mText, mTextList } from './mtext'
import type { ColumnOp, StepSpec } from './transforms'

export interface ColumnOpField {
  label: string
  /** numeric field (validated as a number) */
  numeric?: boolean
  defaultValue?: string
}

export interface ColumnOpDialogDef {
  title: string
  description?: string
  fields: ColumnOpField[]
}

const num = (label: string, defaultValue?: string): ColumnOpField => ({ label, numeric: true, defaultValue })
const txt = (label: string, defaultValue?: string): ColumnOpField => ({ label, defaultValue })

const DEFS: Partial<Record<ColumnOp, ColumnOpDialogDef>> = {
  prefix: { title: 'Prefix', description: 'Enter a text value to add to the beginning of each value in the column.', fields: [txt('Value')] },
  suffix: { title: 'Suffix', description: 'Enter a text value to add to the end of each value in the column.', fields: [txt('Value')] },
  first: { title: 'Extract First Characters', description: 'Enter how many starting characters to keep.', fields: [num('Count')] },
  last: { title: 'Extract Last Characters', description: 'Enter how many ending characters to keep.', fields: [num('Count')] },
  range: { title: 'Extract Text Range', description: 'Enter the index of the first character, and the number of characters to keep.', fields: [num('Starting Index', '0'), num('Number of Characters')] },
  beforeDelimiter: { title: 'Text Before Delimiter', description: 'Enter the delimiter that marks the end of the text to extract.', fields: [txt('Delimiter')] },
  afterDelimiter: { title: 'Text After Delimiter', description: 'Enter the delimiter that marks the start of the text to extract.', fields: [txt('Delimiter')] },
  betweenDelimiters: { title: 'Text Between Delimiters', description: 'Enter the delimiters that mark the start and end of the text to extract.', fields: [txt('Start delimiter'), txt('End delimiter')] },
  add: { title: 'Add', description: 'Enter a value to add to each value in the column.', fields: [num('Value')] },
  multiply: { title: 'Multiply', description: 'Enter a value to multiply by each value in the column.', fields: [num('Value')] },
  subtract: { title: 'Subtract', description: 'Enter a value to subtract from each value in the column.', fields: [num('Value')] },
  divide: { title: 'Divide', description: 'Enter a value to divide each value in the column by.', fields: [num('Value')] },
  integerDivide: { title: 'Integer-Divide', description: 'Enter a value to integer-divide each value in the column by.', fields: [num('Value')] },
  modulo: { title: 'Modulo', description: 'Enter a value to calculate the modulo of each value in the column.', fields: [num('Value')] },
  power: { title: 'Power', description: 'Enter a value to raise each value in the column to.', fields: [num('Value')] },
  round: { title: 'Round', description: 'Enter the number of decimal places to round to.', fields: [num('Decimal Places', '0')] }
}

/** Does this op open an argument dialog first (true) or run directly (false)? */
export function columnOpNeedsArgs(op: ColumnOp): boolean {
  return op in DEFS
}

export function columnOpDialog(op: ColumnOp): ColumnOpDialogDef | null {
  return DEFS[op] ?? null
}

/** Are the typed values acceptable (numeric fields are numbers, required text fields non-empty)? */
export function columnOpArgsValid(op: ColumnOp, values: string[]): boolean {
  const d = DEFS[op]
  if (!d) return true
  return d.fields.every((f, i) => {
    const v = (values[i] ?? '').trim()
    if (f.numeric) return v !== '' && Number.isFinite(Number(v))
    // delimiters must not be empty; a prefix/suffix may be any text, but empty does nothing
    return v !== '' || (values[i] ?? '') !== ''
  })
}

/**
 * Split Column ▸ By Number of Characters ▸ "Once, as far left/right as possible":
 * `Splitter.SplitTextByPositions({0, n}, startAtEnd)` into `Col.1`, `Col.2`.
 */
export function splitOnceAtPosition(col: string, n: number, from: 'left' | 'right'): StepSpec {
  return {
    name: 'Split Column by Position',
    formula: (p) => `Table.SplitColumn(${p}, ${mText(col)}, Splitter.SplitTextByPositions({0, ${n}}, ${from === 'right' ? 'true' : 'false'}), ${mTextList([`${col}.1`, `${col}.2`])})`
  }
}

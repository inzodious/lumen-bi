/**
 * Quick measures — templates and the DAX Power BI Desktop generates for them (same variable
 * names and structure as PBI's quick-measure output, so results look familiar).
 */
import { quoteColumn, quoteTable } from '../../../editors/dax/tokenizer'

export type QuickAgg = 'sum' | 'average' | 'min' | 'max' | 'count' | 'distinctCount'

/** A field dropped in a quick-measure well. */
export type QuickField =
  | { kind: 'measure'; table: string; name: string }
  | { kind: 'column'; table: string; name: string; agg?: QuickAgg }

export interface QuickSlot {
  id: string
  label: string
  /** 'value' accepts measures or aggregated columns; 'column' accepts columns only; 'date' a date column */
  accepts: 'value' | 'column' | 'date'
  optional?: boolean
}

export interface QuickParam {
  id: string
  label: string
  kind: 'number' | 'text' | 'choice'
  default: string
  choices?: Array<{ value: string; label: string }>
}

export interface QuickMeasureTemplate {
  id: string
  group: 'Aggregate per category' | 'Filters' | 'Time intelligence' | 'Totals' | 'Mathematical operations' | 'Text'
  label: string
  description: string
  slots: QuickSlot[]
  params?: QuickParam[]
  /** generated measure name */
  name(f: Record<string, QuickField | undefined>, p: Record<string, string>): string
  build(f: Record<string, QuickField>, p: Record<string, string>): string
  /** suggested format string */
  formatString?: string
}

const AGG_FN: Record<QuickAgg, string> = { sum: 'SUM', average: 'AVERAGE', min: 'MIN', max: 'MAX', count: 'COUNTA', distinctCount: 'DISTINCTCOUNT' }
const AGG_LABEL: Record<QuickAgg, string> = { sum: 'Sum of', average: 'Average of', min: 'Min of', max: 'Max of', count: 'Count of', distinctCount: 'Count of' }

export function colRef(f: { table: string; name: string }): string {
  return `${quoteTable(f.table)}${quoteColumn(f.name)}`
}

/** DAX for a value well: `[Measure]` or `SUM('T'[c])`. */
export function valueExpr(f: QuickField): string {
  if (f.kind === 'measure') return quoteColumn(f.name)
  return `${AGG_FN[f.agg ?? 'sum']}(${colRef(f)})`
}

/** Display name used in generated measure names ("Sum of Amount" style for columns → PBI uses the bare column name). */
export function fieldLabel(f: QuickField | undefined): string {
  if (!f) return '…'
  if (f.kind === 'measure') return f.name
  return f.agg && f.agg !== 'sum' ? `${AGG_LABEL[f.agg]} ${f.name}` : f.name
}

const perCategory = (id: string, label: string, fn: 'AVERAGEX' | 'MINX' | 'MAXX' | 'VAR'): QuickMeasureTemplate => ({
  id,
  group: 'Aggregate per category',
  label,
  description: `Calculate the ${label.toLowerCase()} of the base value within the category.`,
  slots: [
    { id: 'base', label: 'Base value', accepts: 'value' },
    { id: 'category', label: 'Category', accepts: 'column' }
  ],
  name: (f) => `${fieldLabel(f.base)} ${fn === 'AVERAGEX' ? 'average' : fn === 'MINX' ? 'min' : fn === 'MAXX' ? 'max' : 'variance'} per ${f.category?.name ?? '…'}`,
  build: (f) =>
    fn === 'VAR'
      ? `VARX.P(\n    KEEPFILTERS(VALUES(${colRef(f.category)})),\n    CALCULATE(${valueExpr(f.base)})\n)`
      : `${fn}(\n    KEEPFILTERS(VALUES(${colRef(f.category)})),\n    CALCULATE(${valueExpr(f.base)})\n)`
})

export const QUICK_MEASURES: QuickMeasureTemplate[] = [
  perCategory('avgPerCategory', 'Average per category', 'AVERAGEX'),
  perCategory('varPerCategory', 'Variance per category', 'VAR'),
  perCategory('maxPerCategory', 'Max per category', 'MAXX'),
  perCategory('minPerCategory', 'Min per category', 'MINX'),
  {
    id: 'weightedAverage',
    group: 'Aggregate per category',
    label: 'Weighted average per category',
    description: 'Calculate a weighted average of the base value for each category.',
    slots: [
      { id: 'base', label: 'Base value', accepts: 'value' },
      { id: 'weight', label: 'Weight', accepts: 'value' },
      { id: 'category', label: 'Category', accepts: 'column' }
    ],
    name: (f) => `${fieldLabel(f.base)} weighted by ${fieldLabel(f.weight)} per ${f.category?.name ?? '…'}`,
    build: (f) =>
      [
        `VAR __CATEGORY_VALUES = VALUES(${colRef(f.category)})`,
        'RETURN',
        '    DIVIDE(',
        `        SUMX(`,
        `            KEEPFILTERS(__CATEGORY_VALUES),`,
        `            CALCULATE(${valueExpr(f.base)} * ${valueExpr(f.weight)})`,
        '        ),',
        `        SUMX(KEEPFILTERS(__CATEGORY_VALUES), CALCULATE(${valueExpr(f.weight)}))`,
        '    )'
      ].join('\n')
  },
  {
    id: 'filteredValue',
    group: 'Filters',
    label: 'Filtered value',
    description: 'Calculate the base value with a filter applied.',
    slots: [
      { id: 'base', label: 'Base value', accepts: 'value' },
      { id: 'filter', label: 'Filter', accepts: 'column' }
    ],
    params: [{ id: 'value', label: 'Filter value', kind: 'text', default: '' }],
    name: (f, p) => `${fieldLabel(f.base)} for ${p.value || '…'}`,
    build: (f, p) => `CALCULATE(\n    ${valueExpr(f.base)},\n    KEEPFILTERS(${colRef(f.filter)} = ${literal(p.value)})\n)`
  },
  {
    id: 'differenceFromFiltered',
    group: 'Filters',
    label: 'Difference from filtered value',
    description: 'Calculate the difference between the base value and the base value with a filter applied.',
    slots: [
      { id: 'base', label: 'Base value', accepts: 'value' },
      { id: 'filter', label: 'Filter', accepts: 'column' }
    ],
    params: [{ id: 'value', label: 'Filter value', kind: 'text', default: '' }],
    name: (f, p) => `${fieldLabel(f.base)} difference from ${p.value || '…'}`,
    build: (f, p) =>
      [
        `VAR __BASELINE_VALUE = CALCULATE(${valueExpr(f.base)}, ${colRef(f.filter)} = ${literal(p.value)})`,
        `VAR __VALUE_TO_COMPARE = ${valueExpr(f.base)}`,
        'RETURN',
        '    IF(',
        '        NOT ISBLANK(__VALUE_TO_COMPARE),',
        '        __VALUE_TO_COMPARE - __BASELINE_VALUE',
        '    )'
      ].join('\n')
  },
  {
    id: 'percentDifferenceFromFiltered',
    group: 'Filters',
    label: 'Percentage difference from filtered value',
    description: 'Calculate the percentage difference between the base value and the base value with a filter applied.',
    slots: [
      { id: 'base', label: 'Base value', accepts: 'value' },
      { id: 'filter', label: 'Filter', accepts: 'column' }
    ],
    params: [{ id: 'value', label: 'Filter value', kind: 'text', default: '' }],
    name: (f, p) => `${fieldLabel(f.base)} % difference from ${p.value || '…'}`,
    formatString: '0.00%',
    build: (f, p) =>
      [
        `VAR __BASELINE_VALUE = CALCULATE(${valueExpr(f.base)}, ${colRef(f.filter)} = ${literal(p.value)})`,
        `VAR __VALUE_TO_COMPARE = ${valueExpr(f.base)}`,
        'RETURN',
        '    IF(',
        '        NOT ISBLANK(__VALUE_TO_COMPARE),',
        '        DIVIDE(__VALUE_TO_COMPARE - __BASELINE_VALUE, __BASELINE_VALUE)',
        '    )'
      ].join('\n')
  },
  {
    id: 'ytd',
    group: 'Time intelligence',
    label: 'Year-to-date total',
    description: 'Calculate the year-to-date total of the base value.',
    slots: [
      { id: 'base', label: 'Base value', accepts: 'value' },
      { id: 'date', label: 'Date', accepts: 'date' }
    ],
    name: (f) => `${fieldLabel(f.base)} YTD`,
    build: (f) => `TOTALYTD(${valueExpr(f.base)}, ${colRef(f.date)})`
  },
  {
    id: 'yoy',
    group: 'Time intelligence',
    label: 'Year-over-year change',
    description: 'Calculate the percentage change of the base value compared with the same period of the previous year.',
    slots: [
      { id: 'base', label: 'Base value', accepts: 'value' },
      { id: 'date', label: 'Date', accepts: 'date' }
    ],
    name: (f) => `${fieldLabel(f.base)} YoY%`,
    formatString: '0.00%',
    build: (f) =>
      [
        `VAR __PREV_YEAR = CALCULATE(${valueExpr(f.base)}, DATEADD(${colRef(f.date)}, -1, YEAR))`,
        'RETURN',
        `    DIVIDE(${valueExpr(f.base)} - __PREV_YEAR, __PREV_YEAR)`
      ].join('\n')
  },
  {
    id: 'mom',
    group: 'Time intelligence',
    label: 'Month-over-month change',
    description: 'Calculate the percentage change of the base value compared with the previous month.',
    slots: [
      { id: 'base', label: 'Base value', accepts: 'value' },
      { id: 'date', label: 'Date', accepts: 'date' }
    ],
    name: (f) => `${fieldLabel(f.base)} MoM%`,
    formatString: '0.00%',
    build: (f) =>
      [
        `VAR __PREV_MONTH = CALCULATE(${valueExpr(f.base)}, DATEADD(${colRef(f.date)}, -1, MONTH))`,
        'RETURN',
        `    DIVIDE(${valueExpr(f.base)} - __PREV_MONTH, __PREV_MONTH)`
      ].join('\n')
  },
  {
    id: 'rollingAverage',
    group: 'Time intelligence',
    label: 'Rolling average',
    description: 'Calculate the average of the base value over a rolling period of days before and after the current date.',
    slots: [
      { id: 'base', label: 'Base value', accepts: 'value' },
      { id: 'date', label: 'Date', accepts: 'date' }
    ],
    params: [
      { id: 'before', label: 'Periods before', kind: 'number', default: '30' },
      { id: 'after', label: 'Periods after', kind: 'number', default: '0' }
    ],
    name: (f) => `${fieldLabel(f.base)} rolling average`,
    // PBI's template relies on the auto date/time hierarchy (.[Date]); this equivalent works on any date column.
    build: (f, p) =>
      [
        `VAR __LAST_DATE = LASTDATE(${colRef(f.date)})`,
        'RETURN',
        '    AVERAGEX(',
        `        DATESBETWEEN(${colRef(f.date)}, __LAST_DATE - ${int(p.before)}, __LAST_DATE + ${int(p.after)}),`,
        `        CALCULATE(${valueExpr(f.base)})`,
        '    )'
      ].join('\n')
  },
  {
    id: 'runningTotal',
    group: 'Totals',
    label: 'Running total',
    description: 'Calculate a running total of the base value, accumulating along the order of the field.',
    slots: [
      { id: 'base', label: 'Base value', accepts: 'value' },
      { id: 'field', label: 'Field', accepts: 'column' }
    ],
    name: (f) => `${fieldLabel(f.base)} running total in ${f.field?.name ?? '…'}`,
    build: (f) =>
      [
        'CALCULATE(',
        `    ${valueExpr(f.base)},`,
        '    FILTER(',
        `        ALLSELECTED(${colRef(f.field)}),`,
        `        ISONORAFTER(${colRef(f.field)}, MAX(${colRef(f.field)}), DESC)`,
        '    )',
        ')'
      ].join('\n')
  },
  {
    id: 'totalForCategory',
    group: 'Totals',
    label: 'Total for category (filters applied)',
    description: 'Calculate the total of the base value for the category, keeping other filters.',
    slots: [
      { id: 'base', label: 'Base value', accepts: 'value' },
      { id: 'category', label: 'Category', accepts: 'column' }
    ],
    name: (f) => `${fieldLabel(f.base)} total for ${f.category?.name ?? '…'}`,
    build: (f) => `CALCULATE(${valueExpr(f.base)}, ALLSELECTED(${colRef(f.category)}))`
  },
  {
    id: 'totalForCategoryAll',
    group: 'Totals',
    label: 'Total for category (filters not applied)',
    description: 'Calculate the total of the base value for the category, removing filters on it.',
    slots: [
      { id: 'base', label: 'Base value', accepts: 'value' },
      { id: 'category', label: 'Category', accepts: 'column' }
    ],
    name: (f) => `${fieldLabel(f.base)} total for ${f.category?.name ?? '…'} (no filters)`,
    build: (f) => `CALCULATE(${valueExpr(f.base)}, ALL(${colRef(f.category)}))`
  },
  ...(['Addition', 'Subtraction', 'Multiplication', 'Division', 'Percentage difference'] as const).map<QuickMeasureTemplate>((op) => ({
    id: op.toLowerCase().replace(/ /g, ''),
    group: 'Mathematical operations',
    label: op,
    description: `${op} of two values.`,
    slots: [
      { id: 'base', label: 'Base value', accepts: 'value' },
      { id: 'second', label: 'Second value', accepts: 'value' }
    ],
    formatString: op === 'Percentage difference' ? '0.00%' : undefined,
    name: (f) =>
      op === 'Addition'
        ? `${fieldLabel(f.base)} plus ${fieldLabel(f.second)}`
        : op === 'Subtraction'
          ? `${fieldLabel(f.base)} minus ${fieldLabel(f.second)}`
          : op === 'Multiplication'
            ? `${fieldLabel(f.base)} multiplied by ${fieldLabel(f.second)}`
            : op === 'Division'
              ? `${fieldLabel(f.base)} divided by ${fieldLabel(f.second)}`
              : `${fieldLabel(f.base)} % difference from ${fieldLabel(f.second)}`,
    build: (f) =>
      op === 'Addition'
        ? `${valueExpr(f.base)} + ${valueExpr(f.second)}`
        : op === 'Subtraction'
          ? `${valueExpr(f.base)} - ${valueExpr(f.second)}`
          : op === 'Multiplication'
            ? `${valueExpr(f.base)} * ${valueExpr(f.second)}`
            : op === 'Division'
              ? `DIVIDE(${valueExpr(f.base)}, ${valueExpr(f.second)})`
              : [`VAR __BASELINE_VALUE = ${valueExpr(f.second)}`, `VAR __VALUE_TO_COMPARE = ${valueExpr(f.base)}`, 'RETURN', '    IF(', '        NOT ISBLANK(__VALUE_TO_COMPARE),', '        DIVIDE(__VALUE_TO_COMPARE - __BASELINE_VALUE, __BASELINE_VALUE)', '    )'].join('\n')
  })),
  {
    id: 'starRating',
    group: 'Text',
    label: 'Star rating',
    description: 'Display the base value as a star rating (★★★☆☆).',
    slots: [{ id: 'base', label: 'Base value', accepts: 'value' }],
    params: [
      { id: 'stars', label: 'Number of stars', kind: 'number', default: '5' },
      { id: 'min', label: 'Minimum rated value', kind: 'number', default: '0' },
      { id: 'max', label: 'Maximum rated value', kind: 'number', default: '100' }
    ],
    name: (f) => `${fieldLabel(f.base)} star rating`,
    build: (f, p) =>
      [
        `VAR __MAX_NUMBER_OF_STARS = ${int(p.stars, 5)}`,
        `VAR __MIN_RATED_VALUE = ${num(p.min, 0)}`,
        `VAR __MAX_RATED_VALUE = ${num(p.max, 100)}`,
        `VAR __BASE_VALUE = ${valueExpr(f.base)}`,
        'VAR __NORMALIZED_BASE_VALUE =',
        '    MIN(',
        '        MAX(',
        '            DIVIDE(',
        '                __BASE_VALUE - __MIN_RATED_VALUE,',
        '                __MAX_RATED_VALUE - __MIN_RATED_VALUE',
        '            ),',
        '            0',
        '        ),',
        '        1',
        '    )',
        'VAR __STAR_RATING = ROUND(__NORMALIZED_BASE_VALUE * __MAX_NUMBER_OF_STARS, 0)',
        'RETURN',
        '    IF(',
        '        NOT ISBLANK(__BASE_VALUE),',
        '        REPT(UNICHAR(9733), __STAR_RATING)',
        '        & REPT(UNICHAR(9734), __MAX_NUMBER_OF_STARS - __STAR_RATING)',
        '    )'
      ].join('\n')
  },
  {
    id: 'concatenatedList',
    group: 'Text',
    label: 'Concatenated list of values',
    description: 'Display a comma-separated list of the selected values, truncated after a number of values.',
    slots: [{ id: 'field', label: 'Field', accepts: 'column' }],
    params: [{ id: 'count', label: 'Number of values before truncation', kind: 'number', default: '3' }],
    name: (f) => `List of ${f.field?.name ?? '…'} values`,
    build: (f, p) =>
      [
        `VAR __DISTINCT_VALUES_COUNT = DISTINCTCOUNT(${colRef(f.field)})`,
        `VAR __MAX_VALUES_TO_SHOW = ${int(p.count, 3)}`,
        'RETURN',
        '    IF(',
        '        __DISTINCT_VALUES_COUNT > __MAX_VALUES_TO_SHOW,',
        '        CONCATENATE(',
        '            CONCATENATEX(',
        `                TOPN(__MAX_VALUES_TO_SHOW, VALUES(${colRef(f.field)}), ${colRef(f.field)}, ASC),`,
        `                ${colRef(f.field)},`,
        '                ", ",',
        `                ${colRef(f.field)},`,
        '                ASC',
        '            ),',
        '            ", etc."',
        '        ),',
        `        CONCATENATEX(VALUES(${colRef(f.field)}), ${colRef(f.field)}, ", ", ${colRef(f.field)}, ASC)`,
        '    )'
      ].join('\n')
  }
]

function int(s: string | undefined, dflt = 0): string {
  const n = Math.round(Number(s))
  return String(Number.isFinite(n) ? Math.abs(n) : dflt)
}
function num(s: string | undefined, dflt = 0): string {
  const n = Number(s)
  return String(Number.isFinite(n) ? n : dflt)
}

/** DAX literal for a filter value typed by the user: numbers stay numbers, TRUE/FALSE booleans, else a string. */
export function literal(v: string | undefined): string {
  const s = (v ?? '').trim()
  if (/^-?\d+(\.\d+)?$/.test(s)) return s
  if (/^(true|false)$/i.test(s)) return `${s.toUpperCase()}()`
  return `"${s.replace(/"/g, '""')}"`
}

export function missingSlots(t: QuickMeasureTemplate, fields: Record<string, QuickField | undefined>): string[] {
  return t.slots.filter((s) => !s.optional && !fields[s.id]).map((s) => s.label)
}

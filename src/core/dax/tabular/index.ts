/**
 * Tabular DAX engine (columnar, dictionary-encoded). This is the production engine behind
 * src/core/engine; the older Parity engine in ../ (Model/Evaluator) is kept for its tests and the grader.
 */
export { DaxError, DaxSyntaxError } from './errors.ts'
export { lex, type Token } from './lexer.ts'
export { parseExpression, parseQuery, isQueryText, walk, type Node, type DaxQuery, type QueryDefinition } from './parser.ts'
export { DaxModel, Tbl, Col, buildModel, loadTableData, type Measure, type CalcGroup, type CalcItem, type Rel, type BuildIssue } from './model.ts'
export { FilterContext, RelConfig, colFilter, eqFilter, rowsFilter, valuesFilter, type Filter } from './filters.ts'
export { Evaluator } from './evaluator.ts'
export { FUNCTIONS, FN_META, isTableFunction, type Env, type EvalOptions } from './registry.ts'
export { TableValue, isTable, type TCol } from './table.ts'
export { summarizeColumnsCore, type SummarizeExt, type SummarizeOptions } from './fn-table.ts'
export { parseNameRef } from './fn-filter.ts'
export { processCalculated, assignTable, computeColumn, type ProcessIssue } from './process.ts'
export { runQuery, resultColumnName, type QueryTable, type QueryColumn } from './query.ts'
export * from './values.ts'
export { setGroupingEnabled } from './groups.ts'
export { setFusionEnabled } from './fusion.ts'

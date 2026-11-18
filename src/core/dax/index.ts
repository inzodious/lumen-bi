export { DaxError, DaxSyntaxError, type SourcePos } from "./errors.ts";
export { lex, type Comment, type LexResult, type Token, type TokenType } from "./lexer.ts";
export { isDaxQuery, parse, parseDax, parseDaxQuery, type DaxQuery, type EvaluateStatement, type Node, type OrderKey, type ParseResult, type QueryDefinition } from "./parser.ts";
export { runQuery, type DaxQueryResult, type DaxResultColumn, type DaxResultTable } from "./daxquery.ts";
export { DaxDate, type Scalar } from "./values.ts";
export { formatValue, displayValue } from "./format.ts";
export { SUPPORTED_FUNCTIONS } from "./functions.ts";
export {
  Model,
  TableData,
  loadQueryResult,
  loadTableFromWorkspace,
  parseColumnRef,
  type CalculatedColumnSpec,
  type CalculationGroup,
  type CalculationGroupSpec,
  type CalculationItem,
  type ColumnInfo,
  type ColumnRef,
  type ColumnSpec,
  type DataType,
  type Measure,
  type MeasureSpec,
  type Relationship,
  type RelationshipSpec,
} from "./model.ts";
export { FilterContext, makeFilter, type Filter } from "./filters.ts";
export { Evaluator, type EvalOptions, type TableValue } from "./evaluator.ts";
export { evaluate, evaluateScalar, columnLabel, type GridRow, type OutValue, type QueryGrid, type QuerySpec, type SlicerFilter } from "./query.ts";
export {
  buildContextGrid,
  compareMeasures,
  shown,
  type CompareResult,
  type ContextGrid,
  type ContextGridSpec,
  type MeasureInput,
  type Mismatch,
  type SlicerAxis,
} from "./grader.ts";
export { lintDax, lintDaxQuery, type DaxDiagnostic } from "./lint.ts";
export { securedModel, type SecuredModel, type SecurityRole, type TablePermission } from "./security.ts";
/** The production engine (columnar, broad DAX coverage) used by src/core/engine. */
export * as tabular from "./tabular/index.ts";

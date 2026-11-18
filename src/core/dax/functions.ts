import { DaxError, unsupportedFunction } from "./errors.ts";
import type { Node } from "./parser.ts";

/** Functions Parity evaluates. Everything else is refused before evaluation starts. */
export const SUPPORTED_FUNCTIONS = new Set([
  "SUM",
  "AVERAGE",
  "MIN",
  "MAX",
  "COUNT",
  "COUNTROWS",
  "DISTINCTCOUNT",
  "SUMX",
  "AVERAGEX",
  "CALCULATE",
  "CALCULATETABLE",
  "FILTER",
  "ALL",
  "ALLSELECTED",
  "REMOVEFILTERS",
  "KEEPFILTERS",
  "VALUES",
  "DISTINCT",
  "SELECTEDVALUE",
  "HASONEVALUE",
  "ISINSCOPE",
  "USERELATIONSHIP",
  "CROSSFILTER",
  "TREATAS",
  "IF",
  "SWITCH",
  "COALESCE",
  "ISBLANK",
  "BLANK",
  "AND",
  "OR",
  "NOT",
  "TRUE",
  "FALSE",
  "DIVIDE",
  "FORMAT",
  "CONCATENATE",
  "UNICHAR",
  "DATE",
  "EOMONTH",
  "YEAR",
  "MONTH",
  "TODAY",
  "DATESYTD",
  "DATESMTD",
  "DATESQTD",
  "SAMEPERIODLASTYEAR",
  "DATEADD",
  "LOOKUPVALUE",
  "UNION",
  "NAMEOF",
  "SELECTEDMEASURE",
  "SELECTEDMEASUREFORMATSTRING",
  "RELATED",
  "RELATEDTABLE",
  "COUNTA",
  "COUNTBLANK",
  "COUNTX",
  "MINX",
  "MAXX",
  "ALLEXCEPT",
  "ISFILTERED",
  "ISCROSSFILTERED",
  "TOTALYTD",
  "TOTALQTD",
  "TOTALMTD",
  "DATESBETWEEN",
  "DATESINPERIOD",
  "PREVIOUSMONTH",
  "PREVIOUSQUARTER",
  "PREVIOUSYEAR",
  "PARALLELPERIOD",
  "ROUND",
  "ABS",
  "INT",
  "DAY",
  "DATEDIFF",
  "UPPER",
  "LOWER",
  "LEN",
  "LEFT",
  "RIGHT",
  "USERPRINCIPALNAME",
  "USERNAME",
  "SUMMARIZECOLUMNS",
  "ADDCOLUMNS",
  "SELECTCOLUMNS",
  "TOPN",
  "ROW",
  "DATATABLE",
  "SUMMARIZE",
  "GENERATE",
  "CROSSJOIN",
  "EXCEPT",
  "INTERSECT",
]);

/** Unsupported functions whose refusal can say what to write instead. */
const INSTEAD: Record<string, string> = {
  NATURALLEFTOUTERJOIN: "Add the related values with ADDCOLUMNS and RELATED or LOOKUPVALUE instead.",
  NATURALINNERJOIN: "Add the related values with ADDCOLUMNS and RELATED or LOOKUPVALUE instead.",
  GROUPBY: "Use SUMMARIZECOLUMNS, or ADDCOLUMNS ( SUMMARIZE ( ... ), ... ), instead.",
  ROLLUPADDISSUBTOTAL: "Evaluate the total in a second EVALUATE (without the group-by column) instead.",
  ROLLUP: "Evaluate the total in a second EVALUATE (without the group-by column) instead.",
  ROLLUPGROUP: "Evaluate the total in a second EVALUATE (without the group-by column) instead.",
  IGNORE: 'Filter the rows afterwards with FILTER ( SUMMARIZECOLUMNS ( ... ), NOT ISBLANK ( [name] ) ) instead.',
  NONVISUAL: "Pass the filter as a SUMMARIZECOLUMNS filter table or use CALCULATETABLE instead.",
  TOPNSKIP: "Use TOPN instead.",
  GENERATEALL: "Use GENERATE, or ADDCOLUMNS over the first table, instead.",
  ADDMISSINGITEMS: "Use SUMMARIZECOLUMNS, which returns the existing combinations, instead.",
};

export function checkFunctions(node: Node): void {
  switch (node.kind) {
    case "call":
      if (!SUPPORTED_FUNCTIONS.has(node.name.toUpperCase())) {
        const instead = INSTEAD[node.name.toUpperCase()];
        if (instead) throw new DaxError("UNSUPPORTED_FUNCTION", `DAX function ${node.name.toUpperCase()} is not supported in Parity yet. ${instead}`);
        throw unsupportedFunction(node.name);
      }
      node.args.forEach(checkFunctions);
      return;
    case "binary":
      checkFunctions(node.left);
      checkFunctions(node.right);
      return;
    case "unary":
      checkFunctions(node.operand);
      return;
    case "var":
      node.decls.forEach((d) => checkFunctions(d.expr));
      checkFunctions(node.body);
      return;
    case "tableCtor":
      node.rows.forEach((r) => r.forEach(checkFunctions));
      return;
    case "tuple":
      node.items.forEach(checkFunctions);
      return;
    default:
      return;
  }
}

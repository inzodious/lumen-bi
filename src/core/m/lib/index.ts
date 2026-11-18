import { MError } from "../errors.ts";
import { MRecord, type Cell } from "../values.ts";
import { installCore } from "./core.ts";
import { installDateTime } from "./datetime.ts";
import { installEvaluate, installExtra } from "./extra.ts";
import { installFolding } from "./fold.ts";
import { installSources } from "./sources.ts";
import { installConnectors } from "./connectors.ts";
import { installTable } from "./table.ts";
import { installText } from "./text.ts";
import { Library, type LibContext } from "./util.ts";

/** Real Power Query functions that Parity recognizes but doesn't implement yet. */
const KNOWN_UNSUPPORTED = [
  "Table.Join",
  "Table.SplitColumn",
  "Table.CombineColumns",
  "Table.TransformRows",
  "Table.FromList",
  "Table.FromColumns",
  "Table.FromValue",
  "Table.Profile",
  "Table.Schema",
  "Table.AddKey",
  "Table.Keys",
  "Table.MatchesAllRows",
  "Table.MatchesAnyRows",
  "Table.Range",
  "Table.RemoveFirstN",
  "Table.RemoveLastN",
  "Table.RemoveMatchingRows",
  "Table.InsertRows",
  "Table.ReplaceRows",
  "Table.Repeat",
  "Table.ExpandListColumn",
  "Table.AggregateTableColumn",
  "Table.FuzzyNestedJoin",
  "Table.FuzzyJoin",
  "Table.FuzzyGroup",
  "Table.View",
  "Table.Partition",
  "Table.PartitionValues",
  "List.Zip",
  "List.Split",
  "List.Union",
  "List.Intersect",
  "List.Difference",
  "List.Range",
  "List.Repeat",
  "List.Buffer",
  "List.MinN",
  "List.MaxN",
  "List.Mode",
  "List.Median",
  "List.StandardDeviation",
  "List.DateTimes",
  "Record.TransformFields",
  "Record.FromTable",
  "Text.Format",
  "Text.Clean",
  "Text.ToList",
  "Text.Insert",
  "Text.RemoveRange",
  "Text.ReplaceRange",
  "Text.Repeat",
  "Text.Reverse",
  "Text.NewGuid",
  "Splitter.SplitTextByDelimiter",
  "Splitter.SplitTextByEachDelimiter",
  "Splitter.SplitByNothing",
  "Combiner.CombineTextByDelimiter",
  "Web.Contents",
  "Web.Page",
  "OData.Feed",
  "SharePoint.Contents",
  "SharePoint.Tables",
  "Folder.Files",
  "Folder.Contents",
  "Odbc.DataSource",
  "Odbc.Query",
  "OleDb.DataSource",
  "Excel.CurrentWorkbook",
  "Xml.Tables",
  "Xml.Document",
  "Json.FromValue",
  "Binary.Decompress",
  "Binary.Buffer",
  "Binary.FromText",
  "Binary.ToText",
  "AzureStorage.DataLake",
  "AzureStorage.Blobs",
  "PowerPlatform.Dataflows",
  "PowerBI.Dataflows",
  "Fabric.Warehouse",
  "Lakehouse.Tables",
  "Expression.Evaluate",
  "Function.InvokeAfter",
  "Diagnostics.Trace",
  "Value.Add",
  "Value.Subtract",
  "Value.Multiply",
  "Value.Divide",
  "Value.ReplaceType",
  "Value.RemoveMetadata",
  "Value.ReplaceMetadata",
  "Type.ForRecord",
  "Type.TableSchema",
  "Type.Is",
  "Date.WeekOfYear",
  "Date.WeekOfMonth",
  "Date.StartOfWeek",
  "Date.EndOfWeek",
  "Date.IsInPreviousNMonths",
  "Date.IsInCurrentMonth",
  "Date.IsInPreviousMonth",
  "Date.AddQuarters",
  "DateTimeZone.ToRecord",
  "#binary",
  "#shared",
  "#sections",
];

export function createLibrary(ctx: LibContext): { entries: Map<string, Cell>; unsupported: Map<string, string> } {
  const lib = new Library(ctx);
  installCore(lib);
  installText(lib);
  installDateTime(lib);
  installTable(lib);
  installSources(lib);
  installConnectors(lib);
  installExtra(lib);
  installEvaluate(
    lib,
    (src, env) => {
      if (!ctx.evaluateSource) throw new MError("Expression.Error", "Expression.Evaluate isn't available in this context.");
      return ctx.evaluateSource(src, env);
    },
    () => (ctx.shared ? ctx.shared() : new MRecord([], [])),
  );
  installFolding(lib);
  const unsupported = new Map<string, string>();
  for (const name of KNOWN_UNSUPPORTED) {
    if (lib.entries.has(name)) continue;
    unsupported.set(name, `${name} is a real Power Query function, but it is not supported in Lumen yet.`);
  }
  return { entries: lib.entries, unsupported };
}

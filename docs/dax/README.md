# DAX in Lumen

> **Applies to:** Analysts · Creators · Developers

DAX (Data Analysis Expressions) is the formula language of Power BI semantic models: measures, calculated columns, calculated tables, row-level security filters and DAX queries are all written in it. Lumen evaluates DAX with its own engine, written from scratch, so the articles in this section describe what that engine does today, show every example with the result it produces on Lumen's built-in sample, and say where it differs from Power BI.

> [!NOTE]
> The examples run on the built-in sample report (**Sample - Sales**), whose data is generated from a fixed seed. Open it from the start screen with **Try a sample**, then paste an example into **DAX query view** to reproduce the numbers.

## Articles

| Type | Article | What it covers |
|---|---|---|
| Overview | [DAX in Lumen](dax-in-lumen-overview.md) | What the engine is, how accuracy is checked, performance, where it runs |
| How-to | [Create measures](create-measures.md) | New measure, the formula bar, home table, format, display folder |
| How-to | [Create calculated columns](calculated-columns.md) | Row context, RELATED, data type inference, when columns are computed |
| How-to | [Create calculated tables](calculated-tables.md) | New table, DATATABLE, CALENDAR, SUMMARIZE; how columns are inferred |
| How-to | [Field parameters and what-if parameters](field-parameters-and-what-if-parameters.md) | **Modeling > New parameter** (Numeric range, Fields) |
| How-to | [Quick measures](quick-measures.md) | The Quick measures dialog and its 22 templates |
| Concept | [The formula bar and the DAX editor](the-formula-bar-and-dax-editor.md) | Autocomplete, parameter hints, errors, live value, formatting, where the bar appears |
| How-to | [DAX query view](dax-query-view.md) | Write and run `EVALUATE`, results grid, quick queries, history, limits |
| Concept | [Evaluation context in Lumen](evaluation-context-in-lumen.md) | Filter context, row context, context transition, relationships and cross-filter direction |
| Concept | [Time intelligence](time-intelligence.md) | Date tables, YTD / QTD / MTD, same period last year, fiscal years, rolling periods |
| Concept | [Visual calculations](visual-calculations.md) | How Lumen evaluates visual calculations stored in a report; window functions |
| How-to | [User-defined functions](user-defined-functions.md) | `DEFINE FUNCTION` in queries and model functions from TMDL |
| Reference | [Known differences from the Power BI engine](known-differences-from-the-power-bi-engine.md) | Everything known to behave differently |
| How-to | [Troubleshoot a measure](troubleshoot-a-measure.md) | Blank results, errors, circular dependencies, slow visuals, the query a visual sends |

## Reference

- [DAX function support](../reference/dax-function-support.md): every function in Microsoft's DAX reference with its status in Lumen (generated from the engine).

## Not supported

- **Calendar-based time intelligence** (calendars defined on the model, week-based functions such as `TOTALWTD`): not implemented. See [Time intelligence](time-intelligence.md).
- **INFO functions** (`INFO.TABLES`, `INFO.VIEW.MEASURES`, …) and **financial functions** (`PMT`, `XIRR`, …): not implemented. See the [function support reference](../reference/dax-function-support.md).
- **Creating or editing visual calculations**: Lumen evaluates the visual calculations a report already contains, but has no command to add or edit one.
- **Creating model user-defined functions**: functions defined in a model's TMDL are read and evaluated; there is no editor for them. Query-scoped `DEFINE FUNCTION` works in DAX query view.
- **Copilot** and **DAX query view's "Update model with changes"**: not available.

## Related content

- [Model data](../model-data/README.md)
- [Connect and transform data](../connect-and-transform/README.md)
- [DAX function support](../reference/dax-function-support.md)
- [Glossary](../reference/glossary.md)
- [DAX reference on Microsoft Learn](https://learn.microsoft.com/dax/)

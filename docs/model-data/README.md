# Model data in Lumen

> **Applies to:** Creators · Analysts

Modeling is where you shape the semantic model that every report visual queries: tables, columns, measures, the relationships between tables, hierarchies, date tables, security roles and calculation groups. Lumen has two views for this work, **Table view** and **Model view**, plus the **Properties** pane, the contextual **Table tools**, **Column tools** and **Measure tools** ribbon tabs, and a set of modeling dialogs. Start with [Model view overview](model-view-overview.md) if you are new to Lumen, or pick a task below.

Every example and screenshot in this section uses the built-in sample report (**Sample - Sales**, opened from the start screen with **Try a sample**). Its numbers come from Lumen's fictional sample data, so you can reproduce them on your own machine.

## Articles

| Type | Article | What it covers |
|---|---|---|
| Overview | [Model view overview](model-view-overview.md) | The diagram, its toolbar, panning and zooming, layouts, the Properties pane |
| Overview | [Table view](table-view.md) | Browse a table's rows, sort and filter them, change column properties |
| How-to | [Create and edit relationships](create-and-edit-relationships.md) | Drag a column, the relationship dialogs, cardinality, cross-filter direction, active and inactive relationships, key types |
| How-to | [Arrange the diagram](arrange-the-diagram.md) | Auto arrange (star, layered, grid), layouts, fit, card size |
| How-to | [Relationship lines and pinch points](relationship-lines-and-pinch-points.md) | Line styles, bending lines, moving line ends, snapping |
| How-to | [Table groups](table-groups.md) | Group tables in labelled containers, rename, recolour, collapse |
| How-to | [Export the diagram](export-the-diagram.md) | Save a layout as a PNG or SVG image |
| How-to | [Column and table properties](column-and-table-properties.md) | Names, descriptions, data type, format, summarization, sort by column, data category, hiding, display folders |
| How-to | [Hierarchies](hierarchies.md) | Use and create hierarchies (partial support) |
| How-to | [Date tables](date-tables.md) | Mark a table as a date table and what that changes in DAX |
| How-to | [Row-level security](row-level-security.md) | Define roles and test them with **View as** |
| How-to | [Calculation groups](calculation-groups.md) | Create a calculation group and its items |

## Lumen additions to the Model view

Power BI Desktop's Model view draws relationship lines automatically. Lumen adds editable lines (three line styles, pinch points, movable line ends), labelled table groups, an **Auto arrange** command and image export. These are stored in a separate file that Power BI Desktop does not read; see [Model view overview](model-view-overview.md#what-lumen-saves-where).

## Not supported

- **Perspectives and translations.** Lumen reads perspectives and cultures (translations) from TMDL and writes them back when you save a PBIP project, but it has no screen to view or edit them, and the app always shows the model's own (untranslated) names.
- **Adding levels to a hierarchy.** You can create a one-level hierarchy, rename, hide and delete hierarchies, but not add, remove or reorder levels in the app. See [Hierarchies](hierarchies.md).
- **Role members.** **Manage roles** edits role names and DAX filters only; members are assigned in the Power BI service.
- **Auto date/time option.** Lumen has no setting that adds Power BI Desktop's hidden per-column date tables to a model. Models that already contain them keep them, and report visuals that use a date column's automatic Year / Quarter / Month / Day levels are still computed (Lumen derives those levels from the date column when the hidden table is missing).

## Related content

- [Create measures](../dax/create-measures.md)
- [Calculated columns](../dax/calculated-columns.md)
- [Connect and transform data](../connect-and-transform/README.md)
- [DAX in Lumen](../dax/README.md)
- [Architecture: model diagram sidecar](../ARCHITECTURE.md#model-diagram-sidecar-diagramlayoutlumenjson)

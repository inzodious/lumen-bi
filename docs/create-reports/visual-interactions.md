# Visual interactions

> **Applies to:** Creators · Analysts

Selecting a data point in one visual filters or highlights the other visuals on the page. This article explains
cross-filtering and cross-highlighting in Lumen, how to select several points, how to clear a selection, and what you
can and can't change about the interactions.

![The Overview page of the sample after selecting the Bikes slice of the Sales by category donut: the cards show bike figures only, the bars of Sales by country and Sales by year and channel show a dark highlighted part for bikes over a pale full bar, and the other donut slices are dimmed.](../images/create-reports/visual-interactions-cross-highlight.png)

## Cross-filter and cross-highlight

When you select a data point (a bar, a slice, a line point, a table row header), each other visual on the page reacts
in one of three ways:

| Interaction | What the target visual does |
|---|---|
| **Cross-highlight** | Keeps its full values pale and draws the part that belongs to the selection in full color. Used by default for visuals that support highlighting: column, bar, line, area, combo, ribbon, pie, donut, funnel, treemap, gauge, scatter and the map visuals. |
| **Cross-filter** | Shows only the data of the selection. Used for the visuals that can't highlight (cards, KPI, tables, matrices, waterfall, the AI visuals and others), and always when the source is a slicer. |
| **None** | Ignores the selection. |

The default is decided per pair of visuals, as Power BI does: highlight when the target can highlight and the source is
not a slicer, otherwise filter. If the report setting *cross-filter by default* (`defaultFilterActionIsDataFilter`) is
on in the report file, filter is used instead of highlight.

## Use interactions

The steps use the **Overview** page of the built-in sample.

1. Select the **Bikes** slice of **Sales by category**. The KPI cards show bike figures ($3M total sales instead of
   $6M), the bar and column charts highlight the bike part of each bar, and the **Stores** table is filtered.
2. Hold Ctrl and select another slice to add it to the selection. Ctrl-select a selected point to remove it.
3. To clear the selection, select the same single point again, or select an empty area inside the source visual.

In edit mode, the first click on a visual that is not selected both selects the visual and makes the data point
selection, as in Power BI Desktop.

Report-page tooltips, drill-down and drill-through also use the selected point; see
[Tooltips](tooltips.md) and [Drill down and drill through](drill-down-and-drillthrough.md).

## Drill filters on other visuals

When you drill down in a visual (for example from **Category** to **Subcategory**), the drilled path can filter the
other visuals on the page too. Select the visual, then on the contextual **Format** ribbon tab use
**Apply drill down filters to**:

- **Entire page**: drilling also filters the other visuals (the default for new visuals).
- **Selected visual**: drilling affects only this visual.

## Edit interactions

> [!IMPORTANT]
> Lumen has no **Edit interactions** mode in this version: you can't change how one visual affects another from the
> ribbon. Interactions saved in a report (Power BI's `visualInteractions` list in the page definition, set with
> **Format > Edit interactions** in Power BI Desktop) are read and applied: *Filter*, *Highlight* and *None* for each
> source and target pair.

The same applies to the report setting that makes cross-filtering the default instead of cross-highlighting: Lumen
honors it when the file has it, but has no option to change it. (The **Options > Report settings** page of the current
file only shows a note.)

## Considerations and limitations

- A visual that can't highlight receives a cross-filter even when the saved interaction says *Highlight*, as in
  Power BI.
- Interactions apply within one page. Selections are not kept when you switch pages; [bookmarks](bookmarks.md) can
  save and restore them.
- Export (PDF, PowerPoint, images, HTML) renders pages from their saved state; see
  [Export a report](export-a-report.md).

## Differences from Power BI Desktop

- No **Edit interactions** mode and no report setting for the default interaction (see above).
- In Power BI Desktop, Ctrl also adds to a selection across several visuals; Lumen keeps one source visual at a
  time.

## Related content

- [Slicers](slicers.md)
- [Filters pane](filters-pane.md)
- [Drill down and drill through](drill-down-and-drillthrough.md)
- [Bookmarks](bookmarks.md)
- [Change how visuals interact on Microsoft Learn](https://learn.microsoft.com/power-bi/create-reports/service-reports-visual-interactions)

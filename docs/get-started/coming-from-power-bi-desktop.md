# Coming from Power BI Desktop

> **Applies to:** Creators · Analysts

If you know Power BI Desktop, you already know most of Lumen. This article lists what works the same way, what
works differently, what Lumen adds, and what is missing, so that you know where to be careful. Each item links to
the article with the details.

## What is the same

- **The window**: title bar with quick access buttons and search, ribbon with **File**, **Home**, **Insert**,
  **Modeling**, **View**, **Optimize** and **Help**, contextual tabs, the view switcher on the left, the canvas with
  page tabs, and the Filters, Visualizations and Data panes on the right. See the
  [tour of the interface](tour-of-the-interface.md).
- **The views**: Report, Table, Model and DAX query view, and a Power Query editor behind **Transform data**.
- **The files**: Lumen opens the `.pbix`, `.pbit` and PBIP files that Power BI Desktop writes, and draws the report
  from the same definitions and theme.
- **The building blocks**: the Power BI visual types, field wells, the Format pane with Visual and General tabs,
  conditional formatting, slicers, filters, cross-filtering and cross-highlighting, drill, drill-through, tooltip
  pages, bookmarks, the selection and sync slicers panes, mobile layout, themes and the performance analyzer.
- **The languages**: DAX for measures, calculated columns, calculated tables and queries; Power Query M for queries.
- **Many keyboard shortcuts**: Ctrl+S, Ctrl+Z, Ctrl+Y, Ctrl+F1, Ctrl+G, Ctrl+Page Down, Alt+Shift+F11, F5 in the
  DAX query view. See [Keyboard shortcuts](../reference/keyboard-shortcuts.md).

## What works differently

### Files, data and the window

| Area | Power BI Desktop | Lumen |
|---|---|---|
| Saving | Saves `.pbix`, `.pbit` or PBIP | Saves PBIP or a Lumen bundle (`.wbi`); cannot write `.pbix` or `.pbit`. See [Save your work and file types](save-and-file-types.md). |
| Data in a PBIP project | Kept in the project's local cache | Read from that cache when it is present; otherwise the report opens empty and you refresh or use sample data. See [Reports without data and sample data](../files-and-compatibility/reports-without-data-and-sample-data.md). |
| Engines | Microsoft's Analysis Services and Power Query engines | Lumen's own DAX and M engines, written in TypeScript. Results are meant to match. Of the 460 functions in Microsoft's DAX function list, 289 are implemented and 8 partly; of the 660 in its M function list, 472 are implemented. See [DAX function support](../reference/dax-function-support.md), [M function support](../reference/m-function-support.md) and [Known differences from the Power BI engine](../dax/known-differences-from-the-power-bi-engine.md). |
| Font | Segoe UI | Segoe UI if installed, otherwise the metric-compatible Selawik. See [A visual looks different from Power BI](../troubleshooting/a-visual-looks-different-from-power-bi.md#fonts-the-segoe-ui-stand-in). |
| Title-bar search | Searches commands, fields and help | Searches commands only |
| Power Query editor | A separate window | Replaces the main window's contents until **Close & Apply** |
| Ribbon in Table, Model and DAX query view | Home, Help and the tools tabs | **Home**, **Help** and the contextual tools tabs; the **Modeling** tab is in Report view only |
| SQL Server sign-in | Windows, database or Microsoft account | Microsoft Entra ID (several methods) or SQL Server authentication; no Windows authentication on Linux. See [Refresh and connection problems](../troubleshooting/refresh-and-connection-problems.md). |
| Several files | Each file opens in its own window | Each launch opens its own window, too; files opened from the file manager do not go to a running Lumen |

### Building reports

| Area | Power BI Desktop | Lumen |
|---|---|---|
| Field wells | Drop a field on the canvas to create a visual | Tick the field's check box with no visual selected instead. See [The Data pane and field wells](../create-reports/the-data-pane-and-field-wells.md). |
| Format pane | Colors per category or legend item can be set | The **Series** list holds the visual's measures only; per-item colors saved by Power BI Desktop are drawn but can't be edited. A few labels in the pane are not final. See [Format a visual](../create-reports/format-a-visual.md#differences-from-power-bi-desktop). |
| Conditional formatting | Percent and percentile limits | **Percent** and **Percentile** minimum, maximum and rule values are shown disabled. See [Conditional formatting](../create-reports/conditional-formatting.md). |
| Themes | Built-in themes are referenced by name | A built-in theme is written into the report as a custom theme. Some built-in palettes are approximations, and the `header` text class (**Tab headers**) is saved but not drawn. See [Report themes](../create-reports/themes.md#differences-from-power-bi-desktop). |
| Text boxes | Rich text: fonts, colors per word, lists, links, dynamic values | Plain text only. See [Text boxes, shapes and images](../create-reports/text-boxes-shapes-and-images.md). |
| Interactions | **Edit interactions** mode; Ctrl adds to a selection across visuals | No **Edit interactions** mode (saved interactions are honoured); a selection stays in one visual. See [Visual interactions](../create-reports/visual-interactions.md). |
| Filters | Optional **Apply** button (query reduction) | Filters apply immediately. **Include** and **Exclude** filters work but are not listed as their own cards. See [Filters pane](../create-reports/filters-pane.md#differences-from-power-bi-desktop). |
| Sort | Sort by a field in **Tooltips** | Not offered. See [Sort and Top N](../create-reports/sort-and-top-n.md). |
| Drill-through | Cross-report drill-through; **Show data point as a table** lists the underlying rows | No cross-report drill-through; **Show data point as a table** shows the visual's data limited to the point. See [Drill down and drill through](../create-reports/drill-down-and-drillthrough.md#differences-from-power-bi-desktop). |
| Tooltips | Tooltip page chosen from a list | **Page** is a text box that takes the page's internal name. See [Tooltips](../create-reports/tooltips.md). |
| Buttons and bookmarks | Destinations from lists; button states editable; a command to insert a bookmark navigator | Destinations are text boxes; only the default button state can be edited; **Q&A** and **Apply all slicers** actions do nothing; no command inserts a bookmark navigator (one already in a report works). See [Buttons and page navigation](../create-reports/buttons-and-page-navigation.md) and [Bookmarks](../create-reports/bookmarks.md). |
| Slicers | **Tile** style; the Format pane shows the cards of the current style | No **Tile** entry (use a horizontal orientation); the Visual tab shows every card of the slicer type. See [Slicers](../create-reports/slicers.md#differences-from-power-bi-desktop). |
| Mobile layout | Auto-create arranges the page | Auto-create is simpler. See [Mobile layout](../create-reports/mobile-layout.md). |
| Export to PDF | Visible pages | You choose the pages; hidden pages are included by default. PowerPoint export works offline and puts filters in the slide notes. See [Export a report](../create-reports/export-a-report.md). |
| Export data | Summarized or underlying data | Summarized data only (`.xlsx` or `.csv`). See [Export data from a visual](../create-reports/export-data-from-a-visual.md). |
| Performance analyzer | Times Analysis Services queries | Times Lumen's own engine, so the durations do not predict Power BI's. See [Performance analyzer](../create-reports/performance-analyzer.md). |

### Visuals

The [visual support reference](../reference/visual-support.md) gives a status to every visual type:

- **Native** (38 types, including every bar, column, line, area, combo, ribbon, waterfall, funnel, scatter, pie, donut,
  treemap, gauge, KPI, card, table, matrix and slicer type): Lumen's own renderer, aiming to match Power BI Desktop.
  Small differences, such as text measured with a Segoe UI-like approximation, are listed in each article of the
  [Visuals](../visuals/README.md) section. **Forecast** and **Find anomalies** on line charts are approximations of
  Power BI's algorithms; sparklines saved in a table render but can't be added.
- **Approximate** (9 types): the four map visuals draw an
  [approximate basemap with offline geocoding](../visuals/maps.md#differences-from-power-bi-desktop) instead of map
  tiles; the decomposition tree, key influencers, Narrative and Q&A use
  [transparent statistics and templates](../visuals/ai-visuals.md) instead of Microsoft's AI services; Power Automate
  is a [re-implementation](../visuals/custom-visuals.md).
- **Placeholder** (5 types): R and Python script visuals, Metrics and Paginated report draw a hatched box and are kept
  unchanged when you save. The gallery also shows **Stacked bar chart** twice; the first tile inserts a placeholder
  (see [Bar and column charts](../visuals/bar-and-column-charts.md#differences-from-power-bi-desktop)).
- **Unsupported**: any other custom visual from AppSource or an organization shows a placeholder.

## What Lumen adds

- **Sample data** for reports whose sources you cannot reach, with privacy defaults for names and identifiers.
  See [Reports without data and sample data](../files-and-compatibility/reports-without-data-and-sample-data.md).
- **A gallery of designed report templates** with sample data, some Power BI compatible and some using Lumen-only
  container effects (frosted glass, gradients, glow, rotation) and bundled fonts (Barlow, Roboto Condensed, Open Sans).
  See [Start from a report template](../create-reports/start-from-a-template.md).
- **The `.wbi` bundle**, a single file with the project and its data. See [The .wbi bundle](../files-and-compatibility/the-wbi-bundle.md).
- **Export to PNG images and to a self-contained HTML page**, besides PDF and PowerPoint. See
  [Export a report](../create-reports/export-a-report.md).
- **Built-in icons** (Lucide and Fluent Color) for image visuals and cards, saved as ordinary pictures plus a
  reference that keeps them editable in Lumen. See [Add icons to a report](../create-reports/icons.md).
- **Canvas layout aids**: layout guides (margins and gutters), equal-spacing and match-size snapping, the **Size &
  spacing** menu with **Tidy up** (Ctrl+Alt+T), and aligning to a key object or to the page. See
  [Add and arrange visuals](../create-reports/add-and-arrange-visuals.md).
- **Model view extras**: line styles, bend points, manually placed line ends, table groups and an
  **Auto arrange** command. See [Model data](../model-data/README.md).
- **Lumen-only slicer options** (the **Lumen options** card), such as the summary style of a dropdown slicer. See
  [Slicers](../create-reports/slicers.md).
- **A compare tool and a report sweep** for developers who check Lumen against Power BI. See
  [A visual looks different from Power BI](../troubleshooting/a-visual-looks-different-from-power-bi.md).

The additions that need storage in the report or model are stored where Power BI's formats allow extensions;
see [Working with PBIP projects](../files-and-compatibility/working-with-pbip-projects.md#files-and-properties-lumen-adds).

## What is missing

- **Publishing and the Power BI service**: the **Publish** button is disabled. No workspaces, apps, dashboards,
  sharing, subscriptions or scheduled refresh.
- **Writing `.pbix` and `.pbit` files.**
- **Live connections** to semantic models in the Power BI service, Analysis Services or Microsoft Fabric: such reports
  open without data.
- **Custom visuals from AppSource or your organization**: not executed, and no `.pbiviz` import. Lumen draws its own
  HTML Content, Deneb and Power Automate implementations; other custom visuals show a placeholder. R and Python
  scripts never run. See [Custom and script visuals](../visuals/custom-visuals.md).
- **Smart narrative from the ribbon**: **Insert > AI visuals > Narrative** is disabled ("Smart narrative isn't
  available in Lumen"). The **Narrative** visual itself can be added from the Visualizations pane; it writes template
  sentences, not Copilot text. See [AI visuals](../visuals/ai-visuals.md).
- **AI features that need Microsoft's services**, such as Copilot. The AI visuals that Lumen draws (key influencers,
  decomposition tree, Narrative, Q&A) and **Find anomalies** use Lumen's own statistics and templates where Power BI
  uses its models; the [Visuals](../visuals/README.md) section says how each one differs.
- **Map tiles from online map services**: map visuals use an offline basemap, which looks different, and offline
  geocoding, which places fewer kinds of location. See [Maps](../visuals/maps.md).
- **Underlying data export** and **Edit interactions** mode (see [Building reports](#building-reports)).
- **Auto-recovery**: Lumen does not save recovery information. The **Store auto-recovery information** option is
  stored but has no effect in this version, and the same is true of **Auto date/time** for new models and the
  **Locale for import** setting (queries use `en-US` unless they name a culture).
- **Working row-level security preview**: **Modeling > View as** exists, but in this version it does not filter the
  report's visuals or the DAX query view. See [Row-level security](../model-data/row-level-security.md).
- **Perspectives and translations editing**: they are kept when a model is saved, but Lumen has no user interface for
  them. See [Model data](../model-data/README.md).
- **Windows and macOS versions.**

## Before you rely on Lumen for a shared report

1. Keep the original `.pbix` or the project in version control.
2. Save as PBIP into a new folder and review the changes.
3. Check the result in Power BI Desktop before you hand it on: a PBIP saved by Lumen is designed to open there but
   that is not verified by this project. See
   [Round-trip with Power BI Desktop](../files-and-compatibility/round-trip-with-power-bi-desktop.md).

## Related content

- [What is Lumen?](what-is-lumen.md)
- [Tour of the interface](tour-of-the-interface.md)
- [Round-trip with Power BI Desktop](../files-and-compatibility/round-trip-with-power-bi-desktop.md)
- [Frequently asked questions](../troubleshooting/faq.md)
- [Glossary](../reference/glossary.md)

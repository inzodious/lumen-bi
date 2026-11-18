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
| Export to PDF | Visible pages | You choose the pages; hidden pages are included by default |
| Several files | Each file opens in its own window | Each launch opens its own window, too; files opened from the file manager do not go to a running Lumen |

## What Lumen adds

- **Sample data** for reports whose sources you cannot reach, with privacy defaults for names and identifiers.
  See [Reports without data and sample data](../files-and-compatibility/reports-without-data-and-sample-data.md).
- **The `.wbi` bundle**, a single file with the project and its data. See [The .wbi bundle](../files-and-compatibility/the-wbi-bundle.md).
- **Export to PNG images and to a self-contained HTML page**, besides PDF and PowerPoint. See
  [Export problems](../troubleshooting/export-problems.md).
- **Built-in icons** (Lucide and Fluent Color) that are saved as ordinary images. See [Create reports](../create-reports/README.md).
- **Canvas layout aids**: layout guides (margins and gutters), equal-spacing and match-size snapping, and
  **Tidy up** (Ctrl+Alt+T).
- **Model view extras**: line styles, bend points, manually placed line ends, table groups and an
  **Auto arrange** command. See [Model data](../model-data/README.md).
- **Lumen-only slicer options**, such as the summary style of a dropdown slicer.
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
- **Custom visuals from AppSource or your organisation**: not executed. Lumen draws its own HTML Content and Deneb
  implementations; other custom visuals show a placeholder.
- **Smart narrative**: the **Narrative** button on the **Insert** tab is disabled ("Smart narrative isn't available
  in Lumen").
- **AI features that need Microsoft's services**, such as Copilot. The AI visuals that Lumen draws (key influencers,
  decomposition tree, Q&A, anomaly detection) use Lumen's own statistical stand-ins where Power BI uses its models;
  the [Visuals](../visuals/README.md) section says how each one differs.
- **Map tiles from online map services**: map visuals use offline basemaps, which look different.
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

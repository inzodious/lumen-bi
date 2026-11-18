# Glossary

> **Applies to:** Creators · Analysts · Developers

Terms used in the Lumen documentation and in the app, in alphabetical order. Terms that come from Power BI keep
their Power BI meaning; where Lumen uses a term in its own way, the entry says so.

| Term | Meaning |
|---|---|
| **ABF** | Analysis Services backup file: the container inside a `.pbix` file's `DataModel` part (and in a PBIP project's `cache.abf`) that holds the model metadata and the column data. See [How Lumen reads PBIX files](../files-and-compatibility/how-lumen-reads-pbix.md). |
| **Accuracy oracle** | In Lumen's tests: the published values of Microsoft's public sample reports, against which the DAX engine's results are checked. See [Testing](../developer/testing.md). |
| **Applied steps** | The list of transformation steps of a query in the Power Query editor. Each step is one M expression. |
| **Approximate basemap** | The caption the map visuals show in Lumen. Instead of Bing or Azure Maps tiles, Lumen draws vector outlines of the world's countries and of the US states, coloured to evoke the selected map style. See [Maps](../visuals/maps.md). |
| **Auto arrange** | The Model view command that lays out the tables of a diagram automatically, as **Star / snowflake**, **Layered** or **Compact grid**. See [Model data](../model-data/README.md). |
| **Auto-exist** | The rule that a visual or `SUMMARIZECOLUMNS` only shows combinations of grouping values that exist in the data, and drops rows whose values are all blank. |
| **Axis and reset (visual calculations)** | In a visual calculation, the axis is the direction (rows or columns of the visual matrix) along which a function such as `RUNNINGSUM` moves; reset says at which level it starts again. |
| **Backstage** | The full-window **File** menu (Home, New, Open, Save, Save as, Export, Options and settings, About, Close). |
| **Baking (icons), baked icon picture** | Storing a picture of a built-in icon in the report in the form Power BI uses for images (an SVG image resource, or an SVG data URI in a card's image slot), so that other tools can show the icon as an ordinary image. Power BI Desktop is designed to show it; this has not been verified. See [Add icons to a report](../create-reports/icons.md#what-is-saved). |
| **Base theme, custom theme** | A report's base theme (for example `CY24SU10`) sets Power BI's defaults; a custom theme, stored in the report's registered resources, overrides them. Lumen merges both, as Power BI does. |
| **Bookmark** | A saved state of a report page (filters, slicer selections, visibility, drill), applied from the Bookmarks pane or a button. |
| **Built-in icons (Lucide, Fluent Color)** | The two open-source icon libraries that Lumen draws itself and offers in **Insert > Icon**: **Lucide** (single-colour line icons with a colour and a stroke width) and **Fluent Color** (Microsoft's multi-colour Fluent icons, which keep their own colours). A Lumen addition; see [Add icons to a report](../create-reports/icons.md). |
| **Calculated column** | A column whose values a DAX expression computes for each row of its table. |
| **Calculated table** | A table whose rows a DAX table expression computes. |
| **Calculation group** | A model table whose items (calculation items) change how measures are evaluated, through `SELECTEDMEASURE()`. |
| **Calculation item** | One row of a calculation group: a named DAX expression, usually built around `SELECTEDMEASURE()`, that replaces the measure being evaluated. |
| **Canvas** | The area in Report view where the current report page is drawn and edited. |
| **Cardinality** | The kind of a relationship: one-to-many, many-to-one, one-to-one or many-to-many. |
| **Cell elements** | The card of a table's or matrix's **Visual** tab where conditional formatting is set for one value column at a time: **Background color**, **Font color**, **Data bars**, **Icons** and **Web URL**. See [Conditional formatting](../create-reports/conditional-formatting.md). |
| **CF target** | In Lumen's code: what a conditional formatting (fx) rule applies to, that is the format property (such as a font or background colour) together with the selector of the objects-bag entry it is written to (all values, one series, …). |
| **Chip (table group)** | The small box a collapsed table group shrinks to in Model view, showing its name and number of tables. |
| **Compare tool** | `scripts/compare.sh`: puts a Power BI reference image next to Lumen's render of the same page, visual by visual, and ranks the differences. See [Comparing Lumen with Power BI](../COMPARE.md). |
| **Conditional formatting (fx)** | A format property that takes its value from the data, set with the **fx** button next to it. **Gradient** colours by value between a minimum and a maximum (optionally with a middle colour); **Rules** picks a colour from *if value … then* rules; **Field value** takes the colour, or a title's text, from a field or measure. See [Conditional formatting](../create-reports/conditional-formatting.md). |
| **Container chrome** | Everything a visual container draws around the visual itself: background, border, shadow, title, subtitle, divider, padding and header icons. See [Container chrome and text](../developer/container-chrome-and-text.md). |
| **Context transition** | The DAX behaviour by which a row context becomes an equivalent filter context, for example when a measure is evaluated inside an iterator or `CALCULATE`. |
| **Contextual tab** | A ribbon tab that appears only when it applies, such as **Format** when a visual is selected or **Measure tools** when a measure is selected. |
| **Coverage rows** | Extra fact rows the sample-data generator adds so that every member of a sliced dimension has data in every period of the report's date-slicer grain. |
| **Credential store** | Where Lumen keeps saved data source credentials and privacy levels, encrypted with the desktop keyring. See [Credentials and privacy](../connect-and-transform/credentials-and-privacy.md). |
| **Cross-filter direction** | Whether a relationship filters in one direction (single) or both directions. |
| **Cross-filtering, cross-highlighting** | Selecting a data point in one visual filters (or highlights) the other visuals on the page. |
| **Culture** | A locale name such as `en-US` or `de-DE` that M functions use to read and write numbers and dates as text. |
| **Custom function** | A Power Query query written as an M function that other queries call. |
| **Custom visual** | A visual from AppSource or an organization, packaged with the report. Lumen cannot run custom visual packages: it re-implements HTML Content, Deneb and Power Automate and shows a placeholder for any other. See [Custom and script visuals](../visuals/custom-visuals.md). |
| **Data bars** | Conditional formatting that draws a bar, proportional to the value, behind each cell of a table or matrix column. Set in **Cell elements**. |
| **Data windowing** | Loading the rows of a table or matrix 500 at a time and more as you scroll, as Power BI does. Totals are computed by their own queries; automatic minimum and maximum values of conditional formatting are computed over the rows loaded. See [Tables and matrices](../visuals/tables-and-matrices.md). |
| **DataMashup** | The part of a `.pbix` or `.pbit` file that holds the Power Query package; its `Formulas/Section1.m` file contains every query in M. |
| **Data pane** | The pane that lists the model's tables, columns, measures and hierarchies. |
| **Data source key** | The identifier under which Lumen stores a data source's credentials and privacy level, for example `postgresql:db.example.com:5432` or `web:https://api.example.com`. |
| **Date table** | A table marked with **Mark as date table**, with one row per day, used by time-intelligence functions. |
| **DAX** | Data Analysis Expressions, the formula language of Power BI measures, calculated columns and tables, and queries. Lumen evaluates DAX with its own engine. |
| **DAX query view** | The view where you write and run DAX queries (`EVALUATE …`) against the model. |
| **Default sort** | The sort a chart gets when you add fields: bar, column, pie, donut, funnel and treemap charts sort by their first value, descending; line, area and combo charts by their axis, ascending. Sorting from the visual's **More options** menu replaces it. See [Visuals in Lumen](../visuals/README.md). |
| **Diagram sidecar** | `diagramLayout.lumen.json`, the file next to `diagramLayout.json` in which Lumen stores Model view extras (line styles, bend points, table groups). Power BI Desktop does not read it. |
| **Display folder** | A folder that groups measures or columns in the Data pane. |
| **Drill mode** | A state of a visual with a hierarchy, turned on with the down-arrow header icon or **Data / Drill > Drill mode**, in which clicking a data point drills into it instead of cross-filtering. See [Drill down and drill through](../create-reports/drill-down-and-drillthrough.md). |
| **Drill-through, drill-through page** | Navigating from a data point to a target page that is filtered to that data point. A drill-through page is a page with one or more drill-through fields; right-click a data point of a visual that uses one of them to open it. See [Drill down and drill through](../create-reports/drill-down-and-drillthrough.md). |
| **Edit mode, reading view** | Edit mode lets you change the report; reading view (**View > Reading view**) shows it as a reader would, with hidden pages and locked filters honoured. |
| **Effective value, Auto** | What the Format pane shows for a property you have not set: the theme's value for the visual type, then the theme's value for all visuals, then the value the visual falls back to; **Auto** when the visual decides while drawing (for example series colours taken from the theme in order). See [Format a visual](../create-reports/format-a-visual.md#what-an-unset-property-shows) and **Renderer default**. |
| **Enter data** | The command that creates a table by typing or pasting values. The rows are stored in the model definition. |
| **Entry (objects bag)** | One element of a formatting object's array in PBIR: a `properties` map, optionally with a `selector` that says which data point, series or state it applies to. |
| **Equal spacing** | A **View > Layout** option, on by default, that snaps a dragged visual to the same gaps as its neighbours and shows distance guides. A Lumen addition; see [Add and arrange visuals](../create-reports/add-and-arrange-visuals.md). |
| **Expanded table** | A DAX concept: a table together with every table it reaches through many-to-one relationships. A filter on a column of the expanded table filters the table. |
| **Field parameter** | A calculated table that lets a report reader switch the field a visual shows, through a slicer. |
| **Field well, data role** | A drop area in the Build visual tab (for example **X-axis**, **Y-axis**, **Legend**) that holds the fields of a visual. |
| **File map** | In Lumen's code: an in-memory map from relative file paths to file contents, used to read and write PBIP folders, PBIX parts and `.wbi` bundles with the same functions. |
| **Filter context** | The set of filters under which a DAX expression is evaluated: from slicers, filters, the visual's own groups, and `CALCULATE`. |
| **Filters pane** | The pane that shows filters on the visual, on the page and on all pages. |
| **Fiscal year end** | The year-end date argument of year-to-date functions such as `TOTALYTD ( …, "6/30" )`. See [Known differences from the Power BI engine](../dax/known-differences-from-the-power-bi-engine.md) for how Lumen interprets it. |
| **Focus mode** | Shows one visual enlarged to fill the page canvas, opened from the visual header or **Data / Drill > Focus mode**; **Back to report** or Esc returns. |
| **Format painter** | The command that copies the formatting of one visual to another. |
| **Format pane** | The **Format visual** (or **Format page**) tab of the Visualizations pane, with format cards such as **Title** and **Data labels**. For a visual it has a **Visual** tab (the visual's own cards) and a **General** tab (title, effects, header icons, tooltips, alt text), which is the same for every visual. See [Format a visual](../create-reports/format-a-visual.md). |
| **Highlight filter** | The filter a cross-highlighting selection applies to another visual: the visual shows the highlighted part of its values against the full values instead of being filtered. |
| **Host bridge** | `window.wbi`, the typed interface through which the application's user interface reaches the file system, dialogs, connectors and export (`src/shared/host.ts`). See [The host bridge and IPC](../developer/the-host-bridge-and-ipc.md). |
| **Icon binding, `Lumen_Icon` annotation** | The `Lumen_Icon` annotation of a visual that ties a baked icon picture to the icon it came from (library, name, colour, stroke width, padding), so Lumen can edit it again. Power BI is designed to keep and ignore it (not verified). |
| **Include / Exclude filter** | A visual-level filter added by right-clicking a data point and selecting **Include** (keep only that point) or **Exclude** (remove it). See [Filters pane](../create-reports/filters-pane.md#filters-from-the-visual-context-menu) for how Lumen shows it. |
| **Journey** | An end-to-end test that drives the real application through a user task (`e2e/*.e2e.ts`). See [End-to-end tests](../developer/end-to-end-tests.md). |
| **Keep all filters** | A switch of a drill-through page, on by default: the target page receives the whole filter context of the source visual (slicers, page and visual filters, the point's other fields). Off, it receives only the drill-through field values. |
| **Key influencers** | An AI visual (`keyDriversVisual`) that shows which values of its **Explain by** fields go with a higher or lower value of the field you analyse. Lumen computes it offline with transparent statistics instead of Microsoft's machine-learning service. See [AI visuals](../visuals/ai-visuals.md). |
| **Key object** | The align reference **Key object (first selected)** in **Format > Align**: the first visual you selected stays put and the others align to it. A Lumen addition. |
| **Layer order** | Which of several overlapping visuals is on top, changed with **Format > Bring forward** and **Send backward** or in the **Layer order** tab of the Selection pane. |
| **Layout guides** | A **View > Layout** option that sets a page margin and a gutter between visuals for them to snap to (**None**, **Compact**, **Comfortable**, **Spacious**, **Wide** or **Custom…**). Saved with the report as `objects.lumenLayout` in `report.json`. A Lumen addition. |
| **Layout (Model view tab)** | One named diagram of the model in Model view (such as **All tables**), with its own card positions and line routing. |
| **Limited relationship** | A relationship (for example many-to-many) that filters by matching key values instead of through a regular one-to-many join, as in Power BI. |
| **Line end, line style (Model view)** | Where a relationship line meets a table card (placed automatically or manually), and how the line is drawn: **Curved**, **Orthogonal** or **Straight**. |
| **Literal** | A constant value in PBIR JSON, such as `'text'`, `12L` (whole number), `1.5D` (decimal) or `datetime'2024-01-01T00:00:00'`. |
| **Live connection** | A report that uses a semantic model in the Power BI service or Analysis Services instead of its own. Lumen opens such reports without data. |
| **Lock objects** | A **View > Page options** switch that prevents moving and resizing visuals. It is not remembered after Lumen is closed. |
| **Lumen bundle (.wbi)** | Lumen's single-file format: a PBIP project plus the loaded data. See [The .wbi bundle](../files-and-compatibility/the-wbi-bundle.md). |
| **Lumen extension functions** | Excel-style DAX functions that Lumen's engine accepts but Microsoft's DAX reference does not document. Power BI Desktop is not expected to accept them. See [DAX function support](dax-function-support.md). |
| **Match size** | A **View > Layout** option, on by default, that snaps a visual you resize to the width or height of other visuals. A Lumen addition. |
| **Measure** | A named DAX expression evaluated in the filter context of a visual. |
| **metadata.sqlitedb** | The SQLite database inside a `.pbix` data model that holds the model's metadata (tables, columns, measures, relationships…). |
| **Mobile layout** | A phone-portrait arrangement of a report page's visuals, edited with the **Mobile layout** switch. |
| **model.bim** | A semantic model stored as one JSON file in the TMSL format. |
| **Model view** | The view that shows the model's tables and relationships as a diagram. |
| **M, Power Query M** | The formula language of Power BI queries. Lumen evaluates M with its own engine. |
| **Navigator** | The dialog of Get data that lists the tables of a source to choose from. |
| **Notice bar** | The coloured bar under the ribbon that reports a condition, such as **No data loaded**. |
| **Objects bag** | A formatting object collection in PBIR: a visual's `objects` or `visualContainerObjects`, or a page's `objects`. Each object is an array of entries. |
| **Offline geocoding** | How Lumen places map locations without an online service: from built-in tables of countries, states, regions, about 21,000 cities and places, and US ZIP3 centroids. Other values are reported as not located; add **Latitude** and **Longitude** for exact placement. See [Maps](../visuals/maps.md). |
| **Parameter (query parameter)** | A named Power Query value that queries can refer to, edited with **Manage Parameters**. |
| **PBIP** | Power BI project: a `.pbip` file with a `*.Report` folder (PBIR) and a `*.SemanticModel` folder (TMDL or `model.bim`). Lumen's main save format. |
| **PBIR** | Power BI enhanced report format: a report stored as a folder of JSON files (`definition/report.json`, `pages/…/page.json`, `visuals/…/visual.json`). |
| **PBIR-legacy** | The older single-file report layout (`report.json` at the root of a report folder, or `Report/Layout` inside a `.pbix`). Lumen converts it to PBIR. |
| **.pbit** | A Power BI template: report and model without data. |
| **.pbix** | A Power BI Desktop file: report, model and data in one zip container. Lumen opens it but cannot save it. |
| **Performance analyzer** | The pane that records how long each visual takes to query and draw. |
| **Per-series property** | A format property set for one series (measure) of a chart. Cards with such properties start with a **Series** list: **All** edits the setting for every series, a measure edits it for that measure only. |
| **Phone canvas** | The phone-shaped canvas of the mobile layout editor, on which you place and format a page's visuals for phones. See [Mobile layout](../create-reports/mobile-layout.md). |
| **Pinch point** | A bend point on a relationship line in Model view. |
| **Placeholder visual** | The hatched box Lumen draws instead of a visual type it does not render (R and Python script visuals, Metrics, Paginated report, unsupported custom visuals). The visual is kept unchanged when you save. See [Visual support](visual-support.md). |
| **Precedence (calculation groups)** | The order in which several calculation groups apply to the same measure. |
| **Privacy level** | A data source setting (None, Public, Organizational, Private) that controls which sources' data may be combined in one query, as in Power BI. |
| **Projection** | One field in a visual's field well in PBIR: an SQ expression plus its `queryRef` and options such as a display name. |
| **Query folding** | Translating Power Query steps into the source's own query language (such as SQL), so the source does the work. |
| **queryRef** | The name by which a visual's query refers to one of its projections, such as `Product.Category` or `Sum(Sales.Amount)`. |
| **Query-scoped definition** | A measure, variable, column or table defined with `DEFINE` in a DAX query, which exists only for that query. |
| **Query time budget** | The 15-second limit on a visual's query; a visual that exceeds it shows partial results with a warning. The DAX query view has no budget. |
| **Quick measure** | A measure created from a template (for example a running total) instead of being typed. |
| **Readiness signals** | The `data-wbi-ready` and `data-wbi-busy` attributes Lumen sets on the page while it renders; headless captures, the sweep and end-to-end tests wait on them. |
| **Refresh** | Running the model's Power Query queries to load data from the sources. |
| **Regenerate sample data** | The command that draws a new random seed and generates new sample rows. See [Reports without data and sample data](../files-and-compatibility/reports-without-data-and-sample-data.md). |
| **Relationship** | A link between a column of one table and a column of another that lets filters flow between them. |
| **Renderer default** | The value a visual uses for a format property when neither the report nor the theme sets it; the Format pane shows it for unset properties. |
| **Reset to default** | The link at the bottom of a Format pane card that clears every property the card set on the visual, in one undo step. The reset arrow next to a single property clears that property. |
| **Ribbon** | The tabbed command bar at the top of the window. |
| **Row context** | The current row during an iteration in DAX (a calculated column, or an iterator such as `SUMX`). |
| **Row-level security (RLS), role** | Rules that restrict which rows a role's members see. See **View as** for the current limitation in Lumen. |
| **Sample data (synthetic data)** | Values Lumen generates for tables that have no data, from the model's definitions only. Shown by the **Sample data** badge. See [Reports without data and sample data](../files-and-compatibility/reports-without-data-and-sample-data.md). |
| **Sample report** | Lumen's built-in fictional report "Sample - Sales", opened from **Try a sample** or **File > New > Sample report**. |
| **Sample stand-in** | An invented value Lumen uses in memory when a filter or saved slicer selection is pinned to a real name or identifier that sample data does not copy. Slicers that use one are marked **Sample stand-in**. |
| **Selawik** | Microsoft's open-source font with the same metrics as Segoe UI, which Lumen ships and uses when Segoe UI is not installed. |
| **Selection audit** | An option of the sweep (`--selections`) that applies a sample of each slicer's items and counts the visuals that had data and lose it. See [SWEEP.md](../SWEEP.md). |
| **Selector, `{ id: 'default' }` group** | A selector limits an objects-bag entry to a data point, series or state. An entry with `{ id: 'default' }` counts as having no selector; Lumen writes such properties to the first entry of that group, the one readers use. |
| **Semantic model** | The tables, relationships, measures and other definitions that a report queries (formerly "dataset"). |
| **Show as a table** | A command of the visual context menu and the **Data / Drill** tab (Alt+Shift+F11) that shows the visual full-size with a table of its data below it; **Back to report** or Esc returns. |
| **Sidecar file** | A file Lumen keeps beside the model definition and carries through open and save without interpreting it (for example `diagramLayout.json`), or one Lumen adds itself (`diagramLayout.lumen.json`). |
| **Slicer** | A visual that filters other visuals by the values a reader selects. |
| **Small multiples** | A field well of some charts that draws one small chart per value of its field, in a grid. |
| **Smart guides** | The red guide lines shown while you drag a visual, marking the page and visual edges and centres it lines up and snaps to. Hold Alt to move freely. |
| **Sparkline** | A small line or column chart in a table or matrix cell. Lumen draws sparklines saved in a report but has no command to add one. |
| **Spotlight** | A context-menu command that dims every other visual on the page. Select it again, or press Esc, to turn it off. |
| **SQ expression** | PBIR's semantic-query notation for a field: a column, a measure, an aggregation, a hierarchy level or a visual calculation. |
| **SQ filter** | PBIR's semantic-query filter JSON (`{ Version, From, Where }`). Report, page and visual filters, slicer selections, cross-filters and drill-through filters are all SQ filters in Lumen. |
| **Status bar** | The bar at the bottom of the window with the page number, data status and zoom. |
| **Sweep** | `scripts/sweep.sh`: renders every page of one or more reports headlessly and records each visual's status, for regression checks. See [SWEEP.md](../SWEEP.md). |
| **Sync group** | The group name stored on a slicer (`syncGroup`); slicers with the same group name are synced. See [Sync slicers](../create-reports/sync-slicers.md). |
| **Tab order** | The order in which keyboard users move through the visuals of a page, set in the **Tab order** tab of the Selection pane. |
| **Table group** | A labelled, tinted container drawn behind table cards in Model view to keep related tables together. |
| **Table view** | The view that shows the rows of a table. |
| **Text class, `textClasses`** | A named text style in a theme (for example title, label, callout) that sets the font, size and colour of a group of text elements. The theme file's `textClasses` section holds them. See [Themes and text classes](../developer/themes-and-text-classes.md). |
| **Theme color** | A colour chosen by its position in the theme (**Theme color 1**, …) instead of as a fixed value, so it changes when another theme is applied. |
| **Theme, report theme** | A JSON file of colours and default formatting that a report applies to all visuals: a built-in theme from **View > Themes**, an imported theme file, or the current theme customized. See [Report themes](../create-reports/themes.md) and **Base theme, custom theme**. |
| **Tidy up** | A **Format > Size & spacing** command (Ctrl+Alt+T) that arranges the selected visuals into an even row or grid with the current median spacing; **Tidy up with gap** uses a fixed gap. A Lumen addition. |
| **Time intelligence** | DAX functions that compare periods, such as `TOTALYTD`, `SAMEPERIODLASTYEAR` and `DATEADD`; they need a date table. |
| **TMDL** | Tabular Model Definition Language: a semantic model stored as indented text files (`definition/model.tmdl`, `tables/*.tmdl`, …). |
| **TMSL** | Tabular Model Scripting Language: the JSON format of `model.bim` and of a `.pbit`'s `DataModelSchema`. |
| **Tooltip page** | A report page used as the custom tooltip of visuals. |
| **Top N filter** | A filter type that keeps the *N* items with the highest (or lowest) value of a measure. See [Sort and Top N](../create-reports/sort-and-top-n.md). |
| **User-defined function** | A DAX function defined in the model, or with `DEFINE FUNCTION` in a query, that other expressions can call. |
| **Vega, Vega-Lite** | Declarative chart specification languages. The Deneb custom visual draws a Vega or Vega-Lite specification; Lumen renders it with the Vega library. |
| **VertiPaq** | The column-store format in which Power BI keeps imported data. Lumen decodes it when it opens a `.pbix`. |
| **View as** | The **Modeling** command that shows the report as members of chosen roles would see it. In this version it does not filter the visuals or the DAX query view; see [Row-level security](../model-data/row-level-security.md). |
| **Virtual blank row** | The extra blank row that a table on the one side of a relationship gets when the many side has keys without a match, as in Power BI. |
| **Visual calculation** | A DAX calculation defined on a visual and evaluated over the visual's own result. |
| **Visual container** | The element of a report page that holds one visual: its position and size, its container formatting and the visual definition itself (`visual.json` in PBIR). |
| **Visual header** | The row of icons that appears above a visual on hover (filters, focus mode, more options, drill buttons). |
| **Visualizations pane** | The pane with the **Build visual**, **Format visual** and analytics tabs. |
| **Visual matrix** | The grid of values a visual shows, over which visual calculations are evaluated. |
| **visualStyles** | The section of a theme that sets default format properties per visual type and object. |
| **.wbi** | See **Lumen bundle**. |
| **What-if parameter** | A calculated table of values plus a measure that returns the selected value, so a slicer can drive a scenario. |
| **Window function** | A DAX function such as `OFFSET`, `INDEX` or `WINDOW` that refers to rows relative to the current one, with `ORDERBY` and `PARTITIONBY`. |
| **Withheld literal** | A name, identifier or free-text value from formulas or filters that sample data does not copy (see **Sample stand-in**). |
| **XPress9, XPress8** | Microsoft compression formats used for the data model inside `.pbix` files (XPress8 in older files). Lumen ships TypeScript ports of the decoders. |

> [!NOTE]
> Terms from the report, data and DAX sections are added as those sections grow. Developer terms describe Lumen's
> source code; the [developer guide](../developer/README.md) explains them in context.

## Related content

- [What is Lumen?](../get-started/what-is-lumen.md)
- [Tour of the interface](../get-started/tour-of-the-interface.md)
- [Supported file formats](../files-and-compatibility/supported-file-formats.md)
- [Power BI glossary on Microsoft Learn](https://learn.microsoft.com/power-bi/consumer/end-user-glossary)

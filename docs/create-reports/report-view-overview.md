# Report view overview

> **Applies to:** Creators · Analysts

Report view is where you build and read report pages in Lumen. This article names each part of the window, says what
it is for and points you to the article that covers it in detail. Read it first if you have not used Lumen before.

![The Lumen window with the built-in sample open in Report view: title bar with search box at the top, the ribbon with the Home tab, the Overview page on the canvas with a line chart selected, the Filters, Visualizations and Data panes on the right, page tabs at the bottom left and the status bar with the zoom slider at the bottom.](../images/create-reports/report-view-overview-window.png)

## Parts of the window

| Part | Where | What it does |
|---|---|---|
| **Title bar** | Top | **Save** (Ctrl+S), **Undo** (Ctrl+Z) and **Redo** (Ctrl+Y) buttons, the report name (an asterisk means unsaved changes) and a **Search** box that finds commands, for example *Export to PDF*, *New page* or *Selection pane*. |
| **Ribbon** | Below the title bar | Tabs **File**, **Home**, **Insert**, **Modeling**, **View**, **Optimize** and **Help**. Contextual tabs appear when they apply: **Format** and **Data / Drill** when a visual is selected; **Table tools**, **Column tools** or **Measure tools** when a table, column or measure is selected in the Data pane. |
| **View switcher** | Left edge | **Report view**, **Table view**, **Model view** and **DAX query view**. This article is about Report view. |
| **Canvas** | Center | The current report page. Select, move and resize visuals here. See [Add and arrange visuals](add-and-arrange-visuals.md). |
| **Page tabs** | Below the canvas | One tab per page, a **+** button to add a page, and two buttons to switch between the desktop layout (**Web layout**) and the **Mobile layout**. See [Pages](pages.md) and [Mobile layout](mobile-layout.md). |
| **Panes** | Right | **Filters**, **Visualizations** and **Data** are open by default. **Bookmarks**, **Selection**, **Sync slicers** and **Performance analyzer** open from **View > Show panes** or from the pane bar. |
| **Pane bar** | Right edge | One button per pane to open or close it. |
| **Status bar** | Bottom | The page number (*Page 1 of 3*), the data status (*Data loaded*, or a *Sample data* badge when tables hold generated rows), and the zoom control: **Zoom out**, a slider from 10% to 400%, **Zoom in** and **Fit to page**. |

## The panes

| Pane | Use it to | Article |
|---|---|---|
| **Filters** | Add and edit visual, page and report filters. | [Filters pane](filters-pane.md) |
| **Visualizations** | Choose a visual type and fill its field wells (**Build visual**), format the selected visual or the page (**Format visual**), add analytics lines (**Add further analyses to your visual**). | [Format a visual](format-a-visual.md) |
| **Data** | Browse tables, columns, measures and hierarchies; add fields to visuals. | [The Data pane and field wells](the-data-pane-and-field-wells.md) |
| **Bookmarks** | Capture and apply page states. | [Bookmarks](bookmarks.md) |
| **Selection** | Show, hide, rename and re-stack the visuals of a page; set the tab order. | [Add and arrange visuals](add-and-arrange-visuals.md#use-the-selection-pane) |
| **Sync slicers** | Keep a slicer's selection the same on several pages. | [Sync slicers](sync-slicers.md) |
| **Performance analyzer** | Time how long each visual takes to query and draw. | [Performance analyzer](performance-analyzer.md) |

Each pane has a **>>** button in its header that collapses it to a narrow strip; select the strip to expand it again.

## Edit mode and reading view

Lumen opens a report in edit mode, where you can change it. **View > Reading view** switches to reading view, which
behaves like a published report: hidden pages are not listed in the page tabs, locked filters can't be changed, and
the contextual **Format** ribbon tab is not shown. The same button, now labelled **Edit report**, switches back.

## The ribbon tabs at a glance

| Tab | Groups |
|---|---|
| **Home** | Clipboard (Paste, Cut, Copy, Format painter), Data, Queries, Insert (New visual, Text box, More visuals), Calculations, Share |
| **Insert** | Pages (New page), Visuals (New visual, More visuals), AI visuals (Key influencers, Decomposition tree, Q&A, Narrative), Elements (Text box, Buttons, Shapes, Image, Icon) |
| **Modeling** | Relationships, Calculations, Parameters, Calculation groups, Security, Date table |
| **View** | Themes, Scale to fit (Page view), Mobile, Page options (Gridlines, Snap to grid, Lock objects), Layout (Layout guides, Equal spacing, Match size), Show panes, Reading view |
| **Optimize** | Visuals (Refresh visuals, Start recording), Show panes (Performance analyzer) |
| **Help** | Links to Microsoft's Power BI documentation and community, and **About** |
| **Format** (contextual) | Arrange (Bring forward, Send backward, Align, Size & spacing, Group, Selection), Interactions (Apply drill down filters to) |
| **Data / Drill** (contextual) | Data (Show as a table, Focus mode, Export data), Drill actions (Drill mode, Drill up, Go to next level, Expand next level) |

**Home > Publish** is disabled: Lumen does not publish to the Power BI service. Save the report as a Power BI project
instead; see [Files and compatibility](../files-and-compatibility/README.md).

## Differences from Power BI Desktop

- The view switcher has four views (Report, Table, Model, DAX query). There is no TMDL view. Power Query opens from
  **Home > Transform data** as a full-window editor.
- **Insert > AI visuals > Narrative** is disabled. The Narrative visual itself exists and can be added from the
  Visualizations pane; see [AI visuals](../visuals/ai-visuals.md).
- **Publish** to the Power BI service is not available.
- **View > Layout** (Layout guides, Equal spacing, Match size) and the Format tab's **Size & spacing** menu are Lumen
  additions with no Power BI Desktop equivalent.

## Related content

- [Pages](pages.md)
- [Add and arrange visuals](add-and-arrange-visuals.md)
- [Format a visual](format-a-visual.md)
- [Tutorial: design a dashboard page](tutorial-design-a-dashboard-page.md)
- [Keyboard and context menus](keyboard-and-context-menus.md)
- [Visuals in Lumen](../visuals/README.md)

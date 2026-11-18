# Bookmarks

> **Applies to:** Creators · Analysts

A bookmark saves the current state of a report page (filters, slicer selections, the visible page, drill state,
selected data points and which visuals are shown) so you or your readers can return to it with one click. This article
shows how to add, apply, update and organize bookmarks in Lumen.

![The Bookmarks pane with two bookmarks, Bikes only and All categories, and the More options menu of the first one open: Update, Rename, Delete, Group, Move up, Move down, the Data, Display and Current page options (ticked), All visuals (ticked) and Selected visuals.](../images/create-reports/bookmarks-pane-menu.png)

## Prerequisites

- A report open in Lumen. The steps use the **Products** page of the built-in sample.
- The **Bookmarks** pane open: **View > Bookmarks**, or the **Bookmarks** icon on the pane switcher at the right edge
  of the window.

## Add a bookmark

1. Set up the page the way the bookmark should capture it. For example, on **Products** select **Bikes** in the
   **Category** slicer.
2. In the **Bookmarks** pane, select **Add**. A bookmark named **Bookmark 1** (the next free number) is added with its
   name ready to edit.
3. Type a name, for example *Bikes only*, and press **Enter**.

Add a second bookmark after clearing the slicer (*All categories*) to switch between the two.

## Apply a bookmark

Select the bookmark in the pane. Lumen restores the captured state: in the example, **Bikes** is selected again in the
**Category** slicer and the visuals show bikes only. The applied bookmark is highlighted in the pane.

To step through all bookmarks like a slide show, select **View** in the pane. A bar at the bottom of the pane shows the
bookmark name and its position (*1 / 2*), with **Previous bookmark**, **Next bookmark** and **Exit view** buttons.

Buttons can apply bookmarks too: see [Buttons and page navigation](buttons-and-page-navigation.md).

## What a bookmark captures

| Captured | Details |
|---|---|
| Current page | The page that was active (option **Current page**). |
| Filters | Report, page and visual filters, and slicer selections (option **Data**). |
| Selected data points | Cross-filter and cross-highlight selections. |
| Drill state | The drill level and drill path of each visual. |
| Sort | The sort order of each visual. |
| Visual display | Hidden visuals, spotlight, focus mode and **Show as a table** (option **Display**). |

Open **More options** (**...**) on a bookmark, or right-click it, to change what it applies:

- **Data**, **Display**, **Current page**: clear one to make the bookmark leave that part alone. For example, a
  bookmark with **Current page** cleared applies its filters to whatever page is open.
- **All visuals** or **Selected visuals**: with **Selected visuals**, the bookmark applies only to the visuals that
  were selected on the canvas when you chose the option (their number is shown). Select the visuals first.

## Update, rename, delete and organize

Open **More options** (**...**) on a bookmark, or right-click it:

| Command | What it does |
|---|---|
| **Update** | Replaces the captured state with the current state of the report. |
| **Rename** | Edits the name (double-clicking the bookmark does the same). |
| **Delete** | Removes the bookmark after a confirmation. |
| **Group** | Puts the selected bookmarks (Ctrl-select several rows) into a group named *Group*. Rename the group by double-clicking it. |
| **Ungroup** | On a bookmark in a group, or on a group: removes the group. |
| **Move up**, **Move down** | Changes the order, which is also the order of **View** and of bookmark navigators. |

Select a group's row to collapse or expand it.

## Considerations and limitations

- Bookmarks are saved in the report (PBIR `bookmarks` folder) in the format Power BI Desktop uses, including the
  compressed form of saved data point selections. Opening a Lumen-saved bookmark in Power BI Desktop has not been
  verified.
- **Insert** has no **Bookmark navigator** entry. A bookmark navigator that a report already contains is shown and
  works (it marks the bookmark applied last). Use buttons with the **Bookmark** action instead to build a bookmark menu
  in Lumen.
- Personal bookmarks (Power BI service) don't exist in Lumen.

## Differences from Power BI Desktop

- No **Bookmark navigator** in **Insert > Buttons** (see above).
- **View** shows its navigation bar at the bottom of the **Bookmarks** pane rather than over the canvas.

## Related content

- [Buttons and page navigation](buttons-and-page-navigation.md)
- [Slicers](slicers.md)
- [Filters pane](filters-pane.md)
- [Visual interactions](visual-interactions.md)
- [Bookmarks on Microsoft Learn](https://learn.microsoft.com/power-bi/create-reports/desktop-bookmarks)

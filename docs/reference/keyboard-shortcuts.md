# Keyboard shortcuts

> **Applies to:** Creators · Analysts · Developers

This reference lists the keyboard shortcuts and mouse gestures Lumen handles, grouped by where they work. Every
entry was checked against the key handler in the source code; the files are listed at the end. Key names are for
Linux keyboards: Ctrl, Shift, Alt.

Shortcuts cannot be changed.

## Anywhere in the app

| Keys | Action |
|---|---|
| Ctrl+S | Save (opens **Save as** when the report has no saved location yet) |
| Ctrl+Shift+S | Save as |
| Ctrl+O | Open a file |
| Ctrl+N | New blank report |
| Ctrl+Z | Undo. In a text box or code editor, undoes the typing instead. |
| Ctrl+Y or Ctrl+Shift+Z | Redo. Same rule for text boxes and code editors. |
| Ctrl+F1 | Collapse or pin the ribbon |
| Esc | Close the File menu (when no dialog or menu is open over it) |
| Ctrl+Shift+I or F12 | Open or close the developer tools |
| Ctrl+X, Ctrl+C, Ctrl+V, Ctrl+A in a text box | Cut, copy, paste, select all |

The Ctrl+S, Ctrl+O, Ctrl+N, Ctrl+Z and Ctrl+Y shortcuts do nothing while Alt is also held.

### Title-bar search

| Keys | Action |
|---|---|
| Up, Down | Move through the results |
| Enter | Run the highlighted command |
| Esc | Clear the box and leave it |

## Report canvas

These work in Report view while you edit the report, when the focus is not in a text field, and not while the
mobile layout editor is on.

| Keys | Action |
|---|---|
| Delete or Backspace | Delete the selected visuals |
| Arrow keys | Move the selected visuals by 1 pixel |
| Ctrl+Arrow | Move by 10 pixels, or by one grid step when **Snap to grid** is on |
| Shift+Arrow | Resize by 1 pixel (Right and Down grow, Left and Up shrink) |
| Ctrl+Shift+Arrow | Resize by 10 pixels, or by one grid step |
| Esc | Cancel the format painter; otherwise clear the selection |
| Ctrl+A | Select every visual on the page |
| Ctrl+C | Copy the selected visuals |
| Ctrl+X | Cut the selected visuals |
| Ctrl+V | Paste visuals copied in Lumen (each further paste is offset by 20 pixels) |
| Ctrl+G | Group the selected visuals (two or more) |
| Ctrl+Shift+G | Ungroup the selected groups |
| Ctrl+Alt+T | Tidy up: arrange two or more selected visuals in an even row or grid |

When **Lock objects** is on (**View > Page options**), the arrow keys do nothing.

These also work in reading view:

| Keys | Action |
|---|---|
| Ctrl+Page Down, Ctrl+Page Up | Next page, previous page (hidden pages are skipped in reading view) |
| Alt+Shift+F11 | Show the selected visual's data as a table |
| Esc | Close the visual's context menu; otherwise leave focus mode or the table view of a visual; otherwise turn off spotlight |

## Visuals

| Where | Keys | Action |
|---|---|---|
| Table or matrix (click it first) | Ctrl+C | Copy the selected rows as tab-separated text with headers (a matrix copies the last clicked cell when no row is selected) |
| List slicer | Up, Down, Home, End, Page Up, Page Down | Move between items (Page Up and Page Down move 8 items) |
| List slicer | Space or Enter | Select the focused item; with Ctrl, add it to the selection when **Multi-select with Ctrl** is on |
| List slicer | Ctrl+F | Show the search box, even when search is off in the Format pane |
| List slicer search box | Esc | Clear and hide the search box (when search is off in the Format pane) |
| Hierarchy slicer | Right, Left | Expand, collapse the focused node |
| Tile slicer (horizontal) | Left, Right | Move between items |
| Dropdown slicer (closed) | Enter, Space or Down | Open it |
| Dropdown slicer (open) | Esc | Close it |
| Dropdown slicer search box | Enter | Pick the first match |
| List, dropdown or button slicer | Ctrl+V | Select the pasted values |
| Button slicer | Arrow keys, Home, End, Page Up, Page Down | Move between buttons (Up and Down move a whole row in a grid) |
| Button slicer | Space or Enter | Select the focused button; with Ctrl, add it to the selection |
| Date slicer calendar | Left, Right / Up, Down / Page Up, Page Down | Previous or next day / week / month |
| Date slicer calendar | Enter or Space | Pick the date |
| Date slicer calendar | Esc | Close the calendar |
| Date slicer typed date, text slicer, range slicer box | Enter, Esc | Apply, revert |
| Q&A visual | Up, Down | Move through the suggestions |
| Q&A visual | Tab or Enter | Accept a suggestion |
| Q&A visual | Enter, Esc | Ask the question, close the suggestions |
| Text box being edited | Esc | Stop editing |

## Page tabs and panes

| Where | Keys | Action |
|---|---|---|
| A page tab being renamed | Enter, Esc | Confirm, cancel |
| Data pane, Selection pane, Bookmarks pane: an item being renamed | Enter, Esc | Confirm, cancel |
| Performance analyzer row | Enter or Space | Expand or collapse it |
| Number box in the Format pane | Up, Down | Step the value up, down |
| Number box in the Format pane | Enter, Esc | Commit, revert |
| **Name** box on the Table, Column or Measure tools tab | Enter, Esc | Commit, revert |
| Any search box | Esc | Clear it |
| Check box, radio button, switch | Space or Enter | Toggle it |
| Open menu or drop-down list | Esc | Close it |

## Model view

These do nothing while you type in a field or while a dialog is open.

| Keys | Action |
|---|---|
| Ctrl+A | Select every table |
| Ctrl+G | Group the selected tables |
| Ctrl+Shift+G | Ungroup the selected group (its tables stay) |
| Delete or Backspace | Remove the selected bend point of a line; with a group selected, ungroup it (no table is deleted) |
| Delete | Delete the selected relationship (asks first) |
| Esc | Cancel the drag in progress; otherwise deselect the bend point |
| Space (hold) and drag | Pan the diagram |
| Enter, Esc while renaming a group | Confirm, cancel |

There is no shortcut that deletes a table in Model view.

## Formula bar and DAX query view

The formula bar (for measures, calculated columns and calculated tables) and the DAX query view use the same code
editor. Lumen's own keys come first; the editor's standard keys follow.

| Keys | Action |
|---|---|
| F5 | DAX query view: run the query, or only the selected text |
| Ctrl+Enter | DAX query view: run the query. Formula bar: commit the formula |
| Enter | Formula bar: commit a one-line formula; in a multi-line formula, start a new indented line |
| Shift+Enter | New line |
| Esc | Formula bar: cancel the edit (the first Esc closes the suggestion list) |
| Tab or Enter while suggestions show | Accept the suggestion |
| Tab, Shift+Tab | Indent, outdent |
| Ctrl+Space | Show suggestions |
| Ctrl+/ | Comment or uncomment the selected lines |
| Shift+Alt+F | Format the DAX |
| Ctrl+F | Find |
| F3, Shift+F3 (or Ctrl+G, Ctrl+Shift+G) | Find next, find previous |
| Ctrl+D | Select the next occurrence |
| Ctrl+Shift+L | Select all occurrences |
| Ctrl+Alt+G | Go to line |
| Alt+Up, Alt+Down | Move the line up, down |
| Shift+Alt+Up, Shift+Alt+Down | Copy the line up, down |
| Ctrl+Shift+K | Delete the line |
| Ctrl+], Ctrl+[ | Indent, outdent the line |
| Ctrl+U | Undo the last selection change |

In the **Calculation group** and **Manage roles** dialogs the DAX editor has no run or commit action: Ctrl+Enter
inserts a blank line and Esc does not close the editor.

## Power Query editor

| Where | Keys | Action |
|---|---|---|
| Formula bar | Enter | Commit the step formula |
| Formula bar | Shift+Enter | New line |
| Formula bar | Ctrl+Enter | Commit |
| Formula bar | Esc | Cancel the edit (the first Esc closes suggestions) |
| Formula bar | Tab | Accept the suggestion |
| Formula bar | Ctrl+/ | Comment or uncomment |
| **Advanced Editor** | Ctrl+Enter | **Done** |
| **Custom Column** dialog | Ctrl+Enter | **OK** |
| Applied steps | Up, Down | Select the previous, next step |
| Applied steps | Delete | Delete the selected step |
| Applied steps | F2 | Rename the selected step |
| Queries pane | F2 | Rename the focused query |
| Queries pane | Delete | Delete the focused query |
| A query, step or column header being renamed | Enter, Esc | Confirm, cancel |
| Query **Name** box (Query Settings) | Enter, Esc | Commit, revert |
| A column's filter menu | Enter | **OK** |

The Power Query formula bar and Advanced Editor also have the editor keys listed for the DAX editor above (find,
line operations, undo).

## Dialogs and pickers

| Where | Keys | Action |
|---|---|---|
| Any dialog | Esc | Close the dialog (an open drop-down closes first) |
| Dialogs with a default button | Enter | Press the default button (**OK**, **Export**, …), unless the focus is in a multi-line box or on another button |
| Confirmation dialogs | Enter, Esc | The focused button, **Cancel** |
| **Export** pages dialog | Ctrl+A | Select every page |
| **Export** pages dialog | Up, Down, Home, End | Move between pages |
| **Export** pages dialog | Space, Shift+Space | Tick the page, tick the range from the last ticked page |
| Icon picker | Down (from the search box) | Move into the icon grid |
| Icon picker | Arrow keys, Page Up, Page Down, Home, End | Move through the grid |
| Icon picker | Enter | Choose the icon |
| **Enter data** / **Create table** | Enter in the last row | Add a row |
| **Create table** (Modeling) | Enter, Down, Up | Move to the cell below, below, above |
| **Enter data** / **Create table** | Ctrl+V | Paste cells copied from a spreadsheet |

Dialogs where Enter presses the default button include: Canvas settings, Get data and the connector dialogs, Mark as
date table, Export data, Export pages, View as, field parameters, Data source settings permissions, and the Power
Query dialogs (properties, rename, group by, filter rows, merge, append, choose columns, split column, replace
values and errors, pivot, merge columns, index column).

## Mouse gestures with modifier keys

### Report canvas

| Gesture | Action |
|---|---|
| Ctrl+click or Shift+click a visual | Add it to the selection or remove it |
| Click a visual in a group, then click again | The first click selects the group, the second the visual inside it |
| Drag on an empty part of the page | Select the visuals inside the rectangle; with Ctrl or Shift, add them to the selection |
| Hold Alt while dragging or resizing | Turn off the smart guides to other visuals (grid snapping still applies) |
| Hold Shift while resizing | Keep the proportions |
| Ctrl+click a button, navigator, link or hyperlink while editing | Follow it (a plain click follows it in reading view) |
| Ctrl+click data points, table rows or slicer items | Add them to the selection for cross-filtering |
| Double-click a text box | Edit its text |
| Double-click a table or matrix column border | Fit the column to its content |
| Double-click a map | Reset its zoom |
| Mouse wheel on a map | Zoom (when zoom is allowed in the Format pane) |
| Double-click a chart's zoom slider | Reset the zoom |
| Double-click a page tab | Rename the page |
| Drag a page tab | Reorder the pages |

### Window and panes

| Gesture | Action |
|---|---|
| Double-click the title bar | Maximize or restore the window |
| Double-click a ribbon tab | Collapse or pin the ribbon |
| Double-click a field in the Data pane | Rename it |
| Selection pane: Ctrl+click, Shift+click, double-click, drag | Add to the selection, select a range, rename, change the layer order |
| Bookmarks pane: click, Ctrl+click, double-click | Apply the bookmark, select without applying, rename |
| Mobile layout: Ctrl+click or Shift+click; Alt while dragging; Shift while resizing | Multi-select; no snapping; keep proportions |
| Mobile layout: double-click a visual in the side list | Add it to the phone layout |

### Model view

| Gesture | Action |
|---|---|
| Ctrl+mouse wheel | Zoom at the pointer |
| Mouse wheel, Shift+mouse wheel | Scroll up and down, left and right |
| Middle-button drag, Space+drag, or plain drag in pan mode (the default) | Pan |
| Shift+drag in pan mode, or plain drag in select mode | Select tables with a rectangle (Ctrl adds to the selection) |
| Ctrl+click or Shift+click a table header | Add the table to the selection or remove it |
| Drag a column onto a column of another table | Create a relationship |
| Double-click a relationship line | Edit the relationship |
| Drag a line or a bend point | Bend the line, move the point (Alt turns snapping off) |
| Double-click a bend point | Remove it |
| Double-click a line end | Attach it automatically again |
| Double-click a group's label, or a collapsed group | Rename, expand the group |

### Other views and dialogs

| Gesture | Action |
|---|---|
| Table view: double-click a column's resize handle | Reset the column width |
| DAX query view: double-click a query tab | Rename the query |
| DAX query view: double-click a table or field in the list | Insert its name in the editor |
| Power Query: Ctrl+click, Shift+click a column header | Add the column to the selection, select a range |
| Power Query: double-click a column header, query or step | Rename it |
| Merge dialog: Ctrl+click column headers | Match on several columns |
| Append dialog, Custom Column dialog: double-click | Add the table, insert the column |
| Manage relationships: Ctrl+click, double-click | Select several, edit |
| Get data: double-click a source | Connect |
| Icon picker: double-click an icon | Choose it |
| Export pages dialog: Shift+click a page | Tick the range |

## Exported HTML report

In a page exported with **File > Export > Export to HTML**, Right or Page Down shows the next page and Left or Page Up
the previous one.

## Considerations and limitations

- Shortcuts are handled by the application window; the desktop environment may take some first. Ctrl+Alt+T
  (**Tidy up**) opens a terminal on many Linux desktops, so it may never reach Lumen.
- Ctrl+C on a table or matrix in edit mode copies the rows and also copies the selected visual itself; the last one
  to reach the clipboard wins.
- In edit mode, arrow keys, Space and Delete pressed in a focused slicer can also reach the canvas and move or delete
  the selected slicer.
- Esc in a dialog over the report canvas can also clear the visual selection behind it.
- F12 and Ctrl+Shift+I open the developer tools in every build.
- The **Comment** and **Uncomment** buttons in the DAX query view both show Ctrl+/, which toggles.

## Source of this reference

Checked by reading the key handlers in: `src/main/index.ts`, `src/main/menu.ts`, `src/renderer/src/app/App.tsx`,
`app/TitleBar.tsx`, `app/commands.ts`, `app/ui/Modal.tsx`, `app/ui/primitives.tsx`, `app/ui/Popover.tsx`,
`report/ReportView.tsx`, `report/commands.ts`, `report/PageCanvas.tsx`, `report/PageTabs.tsx`,
`report/mobile/MobileLayoutView.tsx`, the panes under `panes/`, `views/model/ModelView.tsx`,
`views/dax/DaxQueryView.tsx`, `editors/dax/DaxEditor.tsx`, `editors/FormulaBar.tsx`, the Power Query editor under
`views/powerquery/`, the slicers and tables under `visuals/`, `dialogs/ExportPagesDialog.tsx`,
`icons/IconPicker.tsx`, and the CodeMirror keymaps (`@codemirror/commands`, `@codemirror/search`,
`@codemirror/autocomplete`). Paths under `src/renderer/src/` are shortened. When you add a shortcut, add it here.

## Related content

- [Tour of the interface](../get-started/tour-of-the-interface.md)
- [Coming from Power BI Desktop](../get-started/coming-from-power-bi-desktop.md)
- [Create reports](../create-reports/README.md)
- [DAX](../dax/README.md)
- [Keyboard shortcuts in Power BI Desktop on Microsoft Learn](https://learn.microsoft.com/power-bi/create-reports/desktop-accessibility-keyboard-shortcuts)

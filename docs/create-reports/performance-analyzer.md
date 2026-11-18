# Performance analyzer

> **Applies to:** Creators · Analysts · Developers

The **Performance analyzer** pane records how long each visual takes to query and draw when you use the report. Use it
to find the slow visuals of a page and to copy the DAX query a visual runs.

![The Performance analyzer pane while recording: Start recording (disabled), Refresh visuals, Stop, Clear and Export buttons; the Recording started and Refreshed visual groups; one row per visual with its duration in milliseconds; the Sales by category row expanded into DAX query 1, Visual display 0, Other 11 and a Copy query link.](../images/create-reports/performance-analyzer-pane.png)

## Prerequisites

- A report open in Lumen. The steps use the built-in sample.

## Record

1. Open the pane: **View > Performance analyzer** or **Optimize > Performance analyzer**, or the timer icon on the
   pane switcher at the right edge of the window.
2. Select **Start recording**. The pane logs *Recording started*; nothing else is logged until you use the report.
3. Use the report. Each action adds a group with one row per visual that reacted:
   - **Refresh visuals** (in the pane, or **Optimize > Refresh visuals**) re-runs every visual of the page: group
     *Refreshed visual*.
   - Changing a slicer: group *Changed a slicer*, with the visuals that queried again.
   - Switching pages: group *Changed page*, with the visuals of the new page.
4. Select **Stop** to stop logging. **Optimize > Start recording / Stop recording** does the same from the ribbon.

## Read the results

Each visual row shows the visual's title (or its field, for untitled cards and slicers) and its **Duration (ms)**.
Select a row to expand it:

| Line | Meaning |
|---|---|
| **DAX query** | Time spent running the visual's query in Lumen's DAX engine. Missing for visuals without a query (text boxes, shapes). |
| **Visual display** | Time spent drawing the visual. |
| **Other** | The rest of the time until the next paint: waiting for the other visuals of the page to render, layout and painting. |

The three lines add up to the row's duration (each is rounded).

Select **Name** or **Duration (ms)** to sort the rows across all groups (select again to reverse, a third time to go
back to the action order).

## Copy a visual's query

Expand a visual's row and select **Copy query**. The clipboard receives the query in Power BI's form, starting with
`// DAX Query` and an `EVALUATE` statement. Paste it into the DAX query view to run and edit it; see the
[DAX section](../dax/README.md).

## Export and clear

- **Export** saves the log as a JSON file in the format of Power BI Desktop's performance analyzer export (events
  *User Action*, *Visual Container Lifecycle*, *Query*, with the query text). Disabled while the log is empty.
- **Clear** empties the log.

## Considerations and limitations

- Durations are measured inside Lumen: the DAX query time is Lumen's engine, not Analysis Services. They show which
  visuals are slow in Lumen and are not a prediction of Power BI timings.
- The **Performance analyzer** button on the **Optimize** tab and the pane toggle on **View** open the same pane.
- Recording stays on across page changes until you select **Stop**.

## Differences from Power BI Desktop

- There is no link that opens a visual's query in the DAX query view; copy the query and paste it.
- The split into **DAX query**, **Visual display** and **Other** is an approximation of Power BI's categories: Lumen's
  engine runs inside the app, so there is no network or queueing time. Cached queries show about 0 ms, as in Power BI.
- Power BI Desktop's *Direct query* and *Evaluated parameters* lines don't apply to Lumen and are not shown.

## Related content

- [DAX query view](../dax/README.md)
- [Report view overview](report-view-overview.md)
- [Visual interactions](visual-interactions.md)
- [Performance analyzer on Microsoft Learn](https://learn.microsoft.com/power-bi/create-reports/desktop-performance-analyzer)

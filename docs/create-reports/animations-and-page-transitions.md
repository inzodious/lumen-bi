# Animations and page transitions

> **Applies to:** Creators, Viewers

Visuals in Lumen animate when they appear and when their data changes, the way Power BI animates them: columns and
bars grow from the axis, lines and areas draw from left to right, pie and donut slices sweep in, markers pop in and card
values count up. When a filter, slicer or cross-highlight changes the data, each mark moves from its old value to its
new one. Pages can also enter with a transition when you move between them, which Power BI doesn't offer.

## Set animations for the report and a page

1. Click an empty spot of the canvas so that no visual is selected.
2. In the **Visualizations** pane, select **Format page** and open **Animations**.
3. Set **Page transition** for this page: **Report default**, **None**, **Fade**, **Slide**, **Rise** or **Zoom**.
   **Slide** comes in from the right when you move forward through the pages and from the left when you go back.
4. Under **Report**, set what applies to every page:

| Setting | Default | What it does |
|---|---|---|
| **Animate visuals** | On | Turns every visual animation on or off. |
| **Duration (ms)** | 500 | How long a visual animation takes (100 to 2000). |
| **Stagger (ms)** | 0 | A delay between visuals entering a page, top to bottom, then left to right (0 to 400). |
| **Default page transition** | None | The transition of every page that keeps **Report default**. |
| **Transition duration (ms)** | 350 | How long a page transition takes (100 to 1500). |

**Preview** plays the page's transition and every visual's entrance once.

Page transitions play in the reading view and in published dashboards. While you edit, pages switch at once, so moving
around the report stays quick. Visual animations play in both.

## Set the animation of one visual

1. Select the visual.
2. In **Format visual**, select **General** and open **Animation**.
3. Choose the **Entrance**:
   - **Auto (by visual type)** animates the visual's marks as described above. Tables, matrices, maps and custom
     visuals fade in. Slicers, text boxes, shapes, images and buttons don't move, as in Power BI.
   - **Fade in**, **Rise** or **Zoom** brings in the whole visual that way.
   - **None** turns animation off for this visual.
4. Set **Delay (ms)** to bring the visual in later than the others (0 to 3000). It adds to the report's stagger.

## When nothing moves

Lumen plays no animation or transition when:

- the system asks for reduced motion (on Linux, GNOME **Settings > Accessibility > Reduce animation**; on Windows,
  **Settings > Accessibility > Visual effects > Animation effects** off). A visitor of a published dashboard with this
  setting sees no motion either;
- a report is exported to PDF, PowerPoint or images, printed, or captured by the command-line tools (`capture.sh`,
  `sweep.sh`), so every picture shows the finished page;
- a published dashboard is opened with `?motion=off` in its address, for example in an embed.

## Published dashboards and HTML export

[Publish a dashboard](publish-a-dashboard.md) keeps the report's animations and transitions: the viewer reads the
same settings from the report. Clear **Keep visual animations and page transitions** in the Publish dialog to publish
a dashboard that doesn't move. The page pictures Lumen saves for Lumen Server's gallery are taken without motion.

[Export to HTML](export-a-report.md) embeds pictures of the pages, so visuals can't animate there, but the page
transitions play when you switch pages.

## In Power BI

The settings are stored as Lumen annotations (`Lumen_Motion`) on the report, its pages and its visuals. Power BI
Desktop keeps them when it opens and saves the project, and ignores them: visuals animate the way Power BI animates them,
and pages switch without a transition. Nothing else about the report changes, so a report with animations opens in
Power BI like any other. [Working with PBIP projects](../files-and-compatibility/working-with-pbip-projects.md) lists
every extension Lumen writes.

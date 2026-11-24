# Animations and page transitions

> **Applies to:** Creators, Viewers

Visuals in Lumen animate when they appear and when their data changes, the way Power BI animates them: columns and
bars grow from the axis, lines and areas draw from left to right, pie and donut slices sweep in, markers pop in and card
values count up. When a filter, slicer or cross-highlight changes the data, each mark moves from its old value to its
new one. Pages can also enter with a transition when you move between them, which Power BI doesn't offer.

## Set animations for the report and a page

1. Click an empty spot of the canvas so that no visual is selected.
2. In the **Visualizations** pane, select **Format page** and open **Animations**.
3. Set **Page transition** for this page (or keep **Report default**):

| Transition | What you see |
|---|---|
| **None** | The page switches at once, as in Power BI. |
| **Fade** | The new page fades in. |
| **Slide** | The new page slides in: from the right when you move forward through the pages, from the left when you go back. |
| **Push** | The old page slides out while the new one slides in, in the same directions as **Slide**. |
| **Rise** | The new page rises into place. |
| **Zoom** | The new page grows into place. |
| **Depth** | The old page sinks back and fades while the new one rises to the front. |
| **Wipe** | A straight edge uncovers the new page, left to right going forward and right to left going back. |
| **Circle reveal** | A circle that opens from the tab or button you clicked uncovers the new page. |
| **Morph (shared visuals glide)** | Visuals the two pages share glide from their old place to the new one, and the rest cross-fade. Visuals count as shared when they have the same type, the same fields and the same title, and appear once on each page. |
4. Under **Report**, set what applies to every page:

| Setting | Default | What it does |
|---|---|---|
| **Animate visuals** | On | Turns every visual animation on or off. |
| **Duration (ms)** | 500 | How long a visual animation takes (100 to 2000). |
| **Stagger (ms)** | 0 | A delay between visuals entering a page, top to bottom, then left to right (0 to 400). |
| **Default page transition** | None | The transition of every page that keeps **Report default**. |
| **Transition duration (ms)** | 350 | How long a page transition takes (100 to 1500). |
| **Drill-through** | Zoom from the visual | **Zoom from the visual** grows the drill-through page out of the visual you drilled from, and **Back** shrinks it into that visual again. **Page transition** uses the target page's transition instead. |
| **Bookmarks** | Morph | **Morph** fades in the visuals a bookmark shows, fades out the ones it hides and moves the ones it moves. **None** switches at once, as in Power BI. |

**Preview** plays the page's transition and every visual's entrance once. For the transitions that move the old page
too, the open page stands in for it.

Transitions only move a still copy of the page that leaves and the page that enters, so they stay smooth on large
pages: nothing is drawn again while they play. Everything they move stays inside the canvas: a page sliding in or out
is cut off at the canvas edge and never paints over the gray area around it.

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

## Keep a sidebar still during page transitions

Turn on **Stay fixed during page transitions** in **Format visual ▸ General ▸ Animation** for each part of a sidebar,
header or navigation rail. To pin a whole group, select it and turn on the same switch under **Animation**. Everything
in the group then stays fixed.

When you switch pages, a pinned visual or group holds still while the rest of the page moves, as long as the page you
came from has a pinned visual of the same type (or a pinned group) in the same place. This is the case when the sidebar
is copied to every page. It works with every transition, and with drill-through zoom and Back. A pinned visual has no
entrance animation.

During the transition, Lumen shows a still picture of the old page's sidebar. When the transition ends, the new page's
own sidebar takes over with a short cross-fade, so a page navigator moves its highlight to the new page at that point.
A pinned visual with no match on the old page moves with its page.

The HTML export plays transitions on whole-page pictures, so pinned visuals move with the page there.

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
transitions play when you switch pages. **Morph** plays as a cross-fade there, because a page picture has no visuals to
glide.

## In Power BI

The settings are stored as Lumen annotations (`Lumen_Motion`) on the report, its pages and its visuals. Power BI
Desktop keeps them when it opens and saves the project, and ignores them: visuals animate the way Power BI animates them,
pages switch without a transition, drill-through and Back switch at once, and bookmarks apply without a morph. Nothing else about the report changes, so a report with animations opens in
Power BI like any other. [Working with PBIP projects](../files-and-compatibility/working-with-pbip-projects.md) lists
every extension Lumen writes.

# Animations and page transitions

> **Applies to:** Creators, Viewers

Visuals in Lumen animate when they appear and when their data changes, the way Power BI animates them: columns and
bars grow from the axis, lines and areas draw from left to right, pie and donut slices sweep in, markers pop in and card
values count up. When a filter, slicer or cross-highlight changes the data, each mark moves from its old value to its
new one. Pages can also enter with a transition when you move between them, which Power BI doesn't offer.

## Use the Animation pane

The **Animation** pane puts everything that moves on the open page in one place. Open it from the pane switcher on
the right, from **View ▸ Show panes ▸ Animation**, or by searching for *Animation pane*.

- **Play** runs the page's transition and every visual's entrance on the canvas, with a playhead over the timeline.
  The time next to it is when the last visual has finished entering.
- **Page** sets this page's transition, its duration and curve, and the stagger between visuals entering it. Fields
  left empty use the report's defaults.
- **Sequence** lists the visuals that enter, in the order they enter, each with a bar on a shared timeline. Drag a
  visual up or down to change when it enters. Visuals you haven't placed follow, top to bottom and left to right.
  **Reset order** goes back to that reading order. **Doesn't move** lists the pinned visuals and the ones without an
  entrance (slicers, text boxes, shapes, images and buttons on **Auto**, or any visual set to **None**).
- Select a visual on the canvas or in the sequence to set its timing:

| Setting | What it does |
|---|---|
| **Start** | **With previous** starts the stagger after the previous visual starts. **After previous** waits until every visual before it has finished. |
| **Delay (ms)** | Waits this long after its start (0 to 3000). |
| **Duration (ms)** | How long its entrance and data changes take (100 to 3000). Empty uses the report's duration. |
| **Curve** | **Smooth**, **Linear**, **Ease in** (speeds up), **Ease out** (slows down), **Ease in and out** or **Overshoot** (passes the end a little and comes back). |
| **Animate data changes** | Off: filters, slicers and cross-highlights change the visual at once. |
| **Hover effect** | See [Hover effects](#hover-effects). |

- **Report defaults** holds the settings every page and visual starts from, including the curve, the duration of
  data-change animations (empty: the same as **Duration**) and the curve of page transitions.

Card values always count up on their own easing curve. Charts that animate their marks one after another (bars,
points) spread them over up to 40% of the duration, at most 400 ms, on top of it; the timeline counts that time.

## Hover effects

A visual or a group can react when the pointer is over it, in reading view and in published dashboards:
**Brighten**, **Darken**, **Enlarge** (a card grows by the strength, 10% by default) or **Lift** (rises a little with a
shadow). Set it in the Animation pane, or in **Format visual ▸ General ▸ Animation**. **Hover strength (%)** sets how
much (1 to 50).

Set the effect on a group to move everything in it together, such as a KPI tile made of a card and its note. Nothing
grows past the canvas: a visual at the edge grows away from that edge, and the page cuts off anything that would
still reach past it. The HTML export shows page pictures, so it has no hover effects.

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

The Animation pane has the rest of a visual's timing: its place in the sequence, start, duration, curve and hover
effect.

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

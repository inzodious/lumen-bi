# A visual looks different from Power BI

> **Applies to:** Creators · Developers

Lumen aims to draw every visual the way Power BI Desktop does, from the same report definition and theme. This
article explains the common, expected causes of differences, how to check a difference systematically with the
compare tool, and how to report one so it can be fixed.

## Check the expected causes first

| What you see | Likely cause | What to do |
|---|---|---|
| Different values, bars of different lengths | Different data: sample data, a different refresh, other filters | Check the status bar for the **Sample data** badge and the filters on the visual. A layout comparison needs the same data. |
| Text slightly wider or narrower, a label wraps or is cut off where Power BI's fits | Font: Segoe UI is usually not installed on Linux (see below) | Install Segoe UI if you have a licence, or accept small differences |
| A visual shows a placeholder with "This visual type isn't supported yet" or "This custom visual isn't supported in Lumen" | No renderer for that type | See [Visual support](../reference/visual-support.md) |
| Map background or tiles differ | Map basemaps are offline approximations in Lumen | Expected; see [Visuals](../visuals/README.md) |
| AI visuals (key influencers, anomaly detection) show different results | Lumen uses statistical stand-ins for Power BI's models | Expected; see [Visuals](../visuals/README.md) |
| Colours differ slightly in a screenshot | The screenshot was re-encoded or colour-managed | Compare against an **Export to PDF** from Power BI Desktop |

## Fonts: the Segoe UI stand-in

Power BI draws text in **Segoe UI**, a Microsoft font that is not licensed for redistribution and normally not
installed on Linux. Lumen handles this in two steps:

1. If a font named Segoe UI (and its Light, Semilight, Semibold and Bold variants) is installed on your system,
   Lumen uses it.
2. Otherwise Lumen uses **Selawik**, Microsoft's open-source font designed to have the same metrics as Segoe UI, which
   Lumen ships. For Segoe UI Semibold, Lumen ships "Lumen Sans Semibold", a lighter semibold derived from Selawik,
   because Selawik's own semibold is almost as heavy as its bold. Its weight was matched to Power BI renders by eye.

Selawik's widths match Segoe UI closely but its letter shapes differ, so text looks slightly different and an
occasional label breaks at a different place. Lumen also ships Open Sans as a general fallback. Any other font a report names is used when it is installed on your
system; otherwise the text falls back to another font, as it would in Power BI Desktop on a computer without that
font.

## Compare a page with Power BI systematically

The repository has a compare tool that puts a Power BI reference image next to Lumen's rendering of the same page,
visual by visual, and ranks the differences. It needs the repository checkout (it is a developer tool) and
`pdftoppm` (package `poppler-utils`) for PDF references.

1. In Power BI Desktop, export the report with **File > Export > Export to PDF**. (A screenshot of one page also
   works; collapse the panes and use **View > Page view > Actual size** first.)
2. Run the tool with the reference, the report and an output folder:

   ```bash
   # a PDF exported from Power BI Desktop, same data in both (a .pbix carries its data)
   scripts/compare.sh ~/export.pdf ~/reports/Sales.pbix /tmp/cmp --same-data

   # a screenshot of page 2 of a PBIP project that has no data in Lumen
   scripts/compare.sh ~/page2.png ~/projects/Sales/Sales.Report /tmp/cmp --page 2 --sample-data --private
   ```

3. Open `/tmp/cmp/index.html` in a browser. It lists every visual, worst first, with the two crops side by side and
   the scores that flagged it (background, border, series colours, title, layout and others).

The tool cannot tell you whether numbers are right, and it cannot see tooltips, hover states or other interactive
states. Treat a high score as "look at this". The full description, including every option and score, is in
[Comparing Lumen with Power BI](../COMPARE.md).

## Report a difference

A good report lets someone reproduce the difference without your file:

1. Reproduce it on the **built-in sample** (**File > New > Sample report**) or on a small report you can share. Do
   not attach a confidential report to a public issue.
2. Describe what differs: the visual type, the format setting involved (Format pane card and property), and what
   Power BI Desktop shows instead.
3. Attach a Power BI Desktop screenshot or PDF and the same view from Lumen. If you ran the compare tool, attach the
   visual's crop pair from `visuals/` (the tool names visuals by page, type and number, never by title).
4. Note the Lumen version (**File > About**).
5. If the visual's definition matters, attach its `visual.json` from the PBIP project (check it for confidential
   names and values first).

> [!NOTE]
> Wrong numbers are a different kind of problem from a different look. If a measure gives a different result on the
> same data, report it with the DAX of the measure; see
> [A report opens with errors or empty visuals](a-report-opens-with-errors-or-empty-visuals.md#a-visual-shows-a-number-that-looks-wrong).

## Related content

- [Comparing Lumen with Power BI](../COMPARE.md)
- [Visual support](../reference/visual-support.md)
- [Visuals](../visuals/README.md)
- [Coming from Power BI Desktop](../get-started/coming-from-power-bi-desktop.md)
- [Frequently asked questions](faq.md)

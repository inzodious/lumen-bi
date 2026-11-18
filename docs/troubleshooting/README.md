# Troubleshooting

> **Applies to:** Creators · Analysts · Developers

Solutions for the problems you are most likely to meet with Lumen, from a build that fails to a visual that looks
different from Power BI. Each article starts from the symptom you see.

## Problems and solutions

| Article | Symptoms |
|---|---|
| [The app does not start or build](the-app-does-not-start-or-build.md) | Nothing happens when you start Lumen, the build fails, Electron behaves like Node.js |
| [A report opens with errors or empty visuals](a-report-opens-with-errors-or-empty-visuals.md) | "Couldn't open the file", "Can't display this visual", (Blank) everywhere, a field that cannot be found |
| [A visual looks different from Power BI](a-visual-looks-different-from-power-bi.md) | Different fonts, label wrapping, colours or layout; how to report it |
| [Refresh and connection problems](refresh-and-connection-problems.md) | Refresh fails, sign-in problems, slow refresh |
| [Export problems](export-problems.md) | An export is incomplete, pages not fully rendered, row limits |

## Questions

| Article | What it answers |
|---|---|
| [Frequently asked questions](faq.md) | Short answers about formats, data, Power BI compatibility and the project |

## Before you report a problem

1. Note the exact message Lumen shows, and what you did before it.
2. Check whether the built-in sample (**File > New > Sample report**) shows the same problem.
3. Open the developer tools with Ctrl+Shift+I (or F12) and copy the errors from the **Console** tab.
4. Note the version from **File > About** and your Linux distribution.

Do not attach a confidential report to a public issue. Reproduce the problem with the sample report or a small model
of your own when you can.

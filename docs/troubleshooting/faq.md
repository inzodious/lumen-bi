# Frequently asked questions

> **Applies to:** Creators · Analysts · Developers

Short answers to common questions about Lumen, with links to the articles that explain more.

## About Lumen

**Is Lumen made by Microsoft?**
No. Lumen is an independent open-source project, not affiliated with or endorsed by Microsoft. See
[What is Lumen?](../get-started/what-is-lumen.md)

**Does Lumen need Power BI Desktop, a Power BI licence or a Microsoft account?**
No. Lumen reads and writes the files itself and evaluates DAX and Power Query M with its own engines. You only need
an account for a data source that requires one.

**Does it run on Windows or macOS?**
Lumen is developed and supported on Linux only. There are no Windows or macOS builds.

**Is there an installer?**
No published package. You build Lumen from source; see [Install Lumen on Linux](../get-started/install-on-linux.md).

## Files

**Can I open a .pbix file?**
Yes, including the data stored in it. See [How Lumen reads PBIX files](../files-and-compatibility/how-lumen-reads-pbix.md).

**Can I save a .pbix file?**
No. Lumen saves as a Power BI project (PBIP) or as a Lumen bundle (`.wbi`). See
[Save your work and file types](../get-started/save-and-file-types.md).

**Will Power BI Desktop open what Lumen saves?**
A PBIP project saved by Lumen is designed to open in Power BI Desktop, but this project has not tested it. See
[Round-trip with Power BI Desktop](../files-and-compatibility/round-trip-with-power-bi-desktop.md).

**Can I keep reports in Git?**
Yes: save as PBIP. Lumen rewrites only the files that changed. See
[Working with PBIP projects](../files-and-compatibility/working-with-pbip-projects.md).

**What is a .wbi file?**
Lumen's single-file bundle: a PBIP project plus its data. Only Lumen opens it. See
[The .wbi bundle](../files-and-compatibility/the-wbi-bundle.md).

## Data

**Why does my PBIP project open without data?**
A project holds definitions, not data. Refresh from the sources or use sample data. See
[Reports without data and sample data](../files-and-compatibility/reports-without-data-and-sample-data.md).

**Is the sample data real?**
No. Every value is invented. By default, names and identifiers from your formulas and filters are not copied into
it. Never read business numbers from sample data.

**Can Lumen refresh from my databases?**
From the sources Lumen has connectors for, if your computer can reach them and you can sign in. See
[Connector support](../reference/connector-support.md) and
[Refresh and connection problems](refresh-and-connection-problems.md).

**Can I connect live to a model in the Power BI service or Fabric?**
No. A live-connected report opens without data.

## Reports and visuals

**Can I publish to the Power BI service?**
No. The **Publish** button is disabled. Save as PBIP and use Fabric Git integration, or open the project in Power BI
Desktop to publish.

**Are all visuals supported?**
Most built-in Power BI visual types have renderers in Lumen (smart narrative cannot be inserted); some are approximations (AI visuals, map basemaps), and
packaged custom visuals are not executed, apart from Lumen's own HTML Content and Deneb implementations. See
[Visual support](../reference/visual-support.md).

**Why does text look slightly different from Power BI?**
Power BI uses Segoe UI, which is usually not installed on Linux; Lumen uses the metric-compatible Selawik font. See
[A visual looks different from Power BI](a-visual-looks-different-from-power-bi.md#fonts-the-segoe-ui-stand-in).

**Are the numbers the same as in Power BI?**
That is the goal: Lumen's DAX engine is tested against the published values of Microsoft's sample reports. Wrong
numbers are treated as defects. 289 of the 460 functions in Microsoft's DAX list are implemented and 8 more partly;
a formula that uses a missing one fails with an error rather than returning a wrong value. See
[DAX function support](../reference/dax-function-support.md).

## Using Lumen

**Where are my settings stored?**
In `~/.config/Lumen` (options, pane layout, recent files). Saved data source credentials are encrypted with your
desktop's keyring.

**Does Lumen save automatically?**
No. Save with Ctrl+S. There is no auto-recovery in this version.

**Can I change keyboard shortcuts?**
No. See [Keyboard shortcuts](../reference/keyboard-shortcuts.md) for the ones that exist.

**Why do two windows open when I double-click two files?**
Each launch starts its own Lumen window; Lumen does not pass files to a window that is already open.

## Related content

- [What is Lumen?](../get-started/what-is-lumen.md)
- [Coming from Power BI Desktop](../get-started/coming-from-power-bi-desktop.md)
- [Troubleshooting](README.md)
- [Glossary](../reference/glossary.md)

# Files and compatibility

> **Applies to:** Creators · Analysts · Developers

Which files Lumen opens and saves, how it reads them, and how a report moves between Lumen and Power BI Desktop.
Read these articles before you rely on Lumen for a report that lives in a `.pbix` file, a PBIP project or Git.

## Reference

| Article | What you learn |
|---|---|
| [Supported file formats](supported-file-formats.md) | The open and save matrix for `.pbix`, `.pbit`, PBIP, `*.Report` and `*.SemanticModel` folders, `model.bim` and `.wbi` |

## Concepts

| Article | What you learn |
|---|---|
| [How Lumen reads PBIX files](how-lumen-reads-pbix.md) | The `.pbix` container, the legacy report layout, the compressed data model and what is decoded |
| [Working with PBIP projects](working-with-pbip-projects.md) | The folder layout, what Lumen preserves, the files it adds, Git |
| [Round-trip with Power BI Desktop](round-trip-with-power-bi-desktop.md) | What is designed to survive a save in Lumen, what is tested and what is not |
| [The .wbi bundle](the-wbi-bundle.md) | Lumen's single-file format with data, and when to use it |
| [Reports without data and sample data](reports-without-data-and-sample-data.md) | Why a report opens empty, refresh versus sample data, privacy defaults |

The feature-by-feature matrix is in the reference section: [File format support](../reference/file-format-support.md).

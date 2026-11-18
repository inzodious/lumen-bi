# Supported file formats

> **Applies to:** Creators · Analysts · Developers

This article lists the files and folders Lumen can open and save, and what Lumen reads from each. It is checked
against the open and save code in `src/core/io/`.

## Open and save matrix

| Format | What it is | Open | Save | Data |
|---|---|---|---|---|
| `.pbix` | Power BI Desktop file: report, model and data in one zip container | Yes | No | Read from the file |
| `.pbit` | Power BI template: report and model, no data | Yes | No | None (refresh or sample data) |
| `.pbip` | Power BI project file that points at a `*.Report` folder | Yes | Yes | Usually none; a `.pbi/cache.abf` copy when present |
| `*.Report` folder | A report in the PBIR format (or the older PBIR-legacy layout) | Yes | Yes, as PBIP | None |
| `*.SemanticModel` folder | A semantic model as TMDL files (`definition/*.tmdl`) or as `model.bim` | Yes | Yes | None |
| Project folder | A folder that contains a `.pbip` file, or exactly one `*.Report` or `*.SemanticModel` folder | Yes | Yes, as PBIP | None |
| `model.bim` | A tabular model in the TMSL JSON format (also called BIM) | Yes, model only | No (only inside a `*.SemanticModel` folder) | None |
| `.wbi` | Lumen bundle: a PBIP project plus the data that was loaded | Yes | Yes | Read from the bundle |

"Save as PBIP" means Lumen writes `<Name>.pbip`, `<Name>.Report` and `<Name>.SemanticModel` (the last only when there
is a local model). See [Save your work and file types](../get-started/save-and-file-types.md).

## What Lumen reads from each format

### .pbix and .pbit

A `.pbix` file is a zip container. Lumen reads these parts:

| Part | Content | Lumen |
|---|---|---|
| `Report/Layout` | The report in the legacy layout JSON | Converted to PBIR in memory |
| `Report/definition/**` | The report in PBIR, in files saved with the PBIR preview format enabled | Read as PBIR |
| `Report/StaticResources/**` | Themes and images | Kept |
| `Report/CustomVisuals/**` | Packaged custom visuals | Kept as files; only the custom visuals Lumen implements are drawn |
| `DataModel` | The compressed model and data | Decoded: model metadata and column data |
| `DataModelSchema` | The model as TMSL JSON (`.pbit` files) | Read as the model |
| `DataMashup` | The Power Query package | Queries read; old-style query partitions upgraded to M partitions |
| `DiagramLayout` | Model view layout | Kept for Model view and PBIP output |
| `DAXQueries/**` | Saved DAX queries | Kept for PBIP output |
| `Connections` | Live connection settings | Read to tell a live-connected report apart |
| `Report/LinguisticSchema` | Q&A linguistic schema | Not read |

See [How Lumen reads PBIX files](how-lumen-reads-pbix.md) for the details.

### PBIP projects

From a `.pbip` file Lumen follows the first artifact that names a report, opens that `*.Report` folder, and follows
the report's dataset reference (`definition.pbir` `byPath`) to the `*.SemanticModel` folder. A report whose dataset
reference is a connection to a service model (`byConnection`) opens without a model and with a warning.

In the `*.SemanticModel` folder Lumen reads the TMDL files under `definition/`, or `model.bim` when there are no TMDL
files, and keeps every other file (for example `diagramLayout.json`, `.platform`, `definition.pbism`,
`.pbi/editorSettings.json`) to write it back unchanged. Other per-user files in `.pbi/` (such as
`localSettings.json`) are not carried along.

**Data in a PBIP project.** A PBIP project normally has no data. Power BI Desktop can keep a local copy of the data in
`<Name>.SemanticModel/.pbi/cache.abf`; its default `.gitignore` for projects excludes that file, so a project you
get from Git or from a colleague usually does not have it. When the file is present, Lumen decodes it on open (the
same way it decodes the data inside a `.pbix`, see [How Lumen reads PBIX files](how-lumen-reads-pbix.md)) and the
report opens with that data. Started with the environment variable `WBI_BLOCK_CACHE=1`, Lumen never reads the file
and says so in the open diagnostics ("Data cache (.pbi/cache.abf) not read: blocked"). Lumen never writes or
updates `cache.abf`. See [Reports without data and sample data](reports-without-data-and-sample-data.md).

### .wbi bundles

Lumen reads the bundled PBIP project and the stored data. See [The .wbi bundle](the-wbi-bundle.md).

### model.bim

Lumen reads the TMSL model and opens it in Table, Model and DAX query view. There is no report.

## Ways to open

| How | What it accepts |
|---|---|
| **File > Open > Browse this device**, Ctrl+O, **Open a file** on the welcome screen | `.pbix`, `.pbit`, `.pbip`, `.wbi` (the dialog's file-type list also offers all files, so a `model.bim` can be chosen) |
| **File > Open > Open a folder**, **Open a folder** on the welcome screen | A project folder, a `*.Report` folder or a `*.SemanticModel` folder |
| Command line, desktop file associations | `.pbix`, `.pbit`, `.pbip`, `.wbi`, a `*.Report` or `*.SemanticModel` folder |
| **Recent** list | Anything opened or saved before |

A folder that contains several `*.Report` folders and no `.pbip` file is refused with "The folder contains several
reports; open one of the *.Report folders".

## Considerations and limitations

- Lumen does not write `.pbix`, `.pbit` or a standalone `model.bim`.
- Reports connected live to a model in the Power BI service, Analysis Services or Microsoft Fabric open without data.
  Lumen does not connect to those models.
- Custom visuals packaged in a report (`.pbiviz` content) are not executed. Lumen draws its own implementations of
  a few custom visuals (HTML Content and Deneb); others show a placeholder. See [Visuals](../visuals/README.md).
- The [file format support reference](../reference/file-format-support.md) lists, feature by feature, what is read,
  written, and kept untouched.

## Related content

- [How Lumen reads PBIX files](how-lumen-reads-pbix.md)
- [Working with PBIP projects](working-with-pbip-projects.md)
- [The .wbi bundle](the-wbi-bundle.md)
- [Save your work and file types](../get-started/save-and-file-types.md)
- [File format support reference](../reference/file-format-support.md)

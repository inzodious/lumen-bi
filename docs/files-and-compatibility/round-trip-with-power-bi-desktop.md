# Round-trip with Power BI Desktop

> **Applies to:** Creators · Analysts · Developers

This article says what is designed to survive when you take a report from Power BI Desktop into Lumen, save it,
and open it in Power BI Desktop again, and what has and has not been tested. Read it before you use Lumen on a
report that others continue to edit in Power BI Desktop.

> [!IMPORTANT]
> **Opening a file saved by Lumen in Power BI Desktop has not been tested by this project.** Lumen is developed on
> Linux, and its tests run there. Everything below that is about Power BI Desktop reading Lumen's output is
> **designed to** work, based on Microsoft's published PBIP formats and their JSON schemas, and is **not verified**.
> Keep the original file until you have checked the result in Power BI Desktop yourself.

## The round trip

```text
Power BI Desktop                 Lumen                          Power BI Desktop
  .pbix  ─── open ───────────▶  edit  ─── Save as PBIP ──────▶  open the .pbip   (designed to; not verified)
  .pbip  ─── open ───────────▶  edit  ─── Save (in place) ───▶  open the .pbip   (designed to; not verified)
  .pbix  ─── open ───────────▶  edit  ─── Save as .pbix ─────▶  open the .pbix   (experimental; not verified)
  any    ─── open ───────────▶  edit  ─── Save as .pbit ─────▶  open the .pbit   (experimental; not verified)
```

For a report opened from a `.pbix` whose data is unchanged, Lumen copies the original data model byte for byte, or
writes measure edits into it, and writes the report. For any other report (a PBIP project refreshed from its
sources, the built-in sample, a `.pbix` whose data or model changed), Lumen writes the whole data model itself: the
model, every column's data and the structures Power BI keeps beside it (sort orders, hierarchies, relationship
indexes). A model that uses a feature Lumen can't write yet goes out as a `.pbit` or a PBIP project, which you can
open in Power BI Desktop and save as `.pbix` there. See [Save your work and file types](../get-started/save-and-file-types.md#what-a-pbix-save-keeps).

### Power BI files written by Lumen

| File | What Lumen writes | Checked in Lumen | Checked in Power BI Desktop |
|---|---|---|---|
| `.pbit` | The model as TMSL (`DataModelSchema`) and the report in the classic layout form (`Report/Layout`), with Settings, Metadata, the diagram layout and the report's resources | Every Microsoft sample and the built-in sample: written, reopened, same model, queries, pages and visuals | **No** |
| `.pbix`, data model unchanged | The original `DataModel` part byte for byte, the report rewritten, every other part copied byte for byte (except `SecurityBindings`, see below) | Every Microsoft sample: written with an edited visual, reopened, same data and model, edit present, untouched parts identical | **No** |
| `.pbix` with measure edits | Measures written into the original `metadata.sqlitedb`; the data model re-packed by Lumen's ABF and XPress9 writers | Every Microsoft sample: measures added, changed and deleted, reopened, same measures and data; SQLite integrity check passes and the schema is unchanged | **No** |
| `.pbix` with data written by Lumen | The whole data model built by Lumen: `metadata.sqlitedb`, every column's dictionary and segments, attribute and user hierarchies, relationship indexes, in a new backup | The built-in sample, invented models of every data type and a Microsoft sample rewritten from its loaded data: reopened with identical data. Lumen's writers reproduce Desktop's own files' column structures from their values byte for byte in most cases (see [Writing a DataModel](../developer/file-format-io.md#writing-a-datamodel-stage-e)) | **No** |

All four are labelled **Experimental: not yet verified in Power BI Desktop** in the Save dialog. A file written
by Lumen never contains `SecurityBindings`. In that optional part Power BI Desktop stores data source permission
settings, encrypted by Windows for one user on one computer, so a file written elsewhere cannot carry a meaningful
one. Power BI Desktop asks whoever opens the file to confirm the data source permissions, as it does for any file
received from someone else.

## What is tested, and how

| Check | Tested? | How |
|---|---|---|
| Lumen reads `.pbix` and `.pbit` files correctly | Yes | Automated tests decode Microsoft's public sample `.pbix` files and compare measure results with the values those reports publish |
| Lumen reads PBIP projects | Yes | Unit tests and an optional run over a set of real projects (parse with no errors, evaluate, write back) |
| Open in Lumen → save as PBIP → reopen in Lumen gives the same report | Yes | Automated save-and-reopen tests (pages, visuals, theme) for the sample `.pbix` files and the built-in sample |
| Untouched files keep their bytes | Yes, with a tolerance | TMDL write-back tests; report JSON is compared by value before writing |
| The PBIP output follows Microsoft's JSON schemas | Partly | Lumen writes the schema URLs and versions Power BI uses. A manual check of a saved project against Microsoft's published schemas found one failure, the base theme reference, which Lumen now writes in full (see [Base theme of reports created in Lumen](#base-theme-of-reports-created-in-lumen)); the test suite does not validate against the schemas |
| Power BI Desktop opens the PBIP output | **No** | Not tested: no Windows machine in this project |
| Power BI Desktop opens the `.pbix` / `.pbit` output | **No** | Not tested. A test kit of files written from Microsoft's samples and the built-in sample is prepared for a manual check |
| Power BI Desktop shows the same thing as Lumen | **No** | Not tested; the [compare tool](../../scripts/compare.sh) compares Lumen against screenshots or PDFs exported from Power BI, in one direction |

## What is designed to survive

- **Everything you did not change.** Unchanged report JSON files keep their bytes; unknown properties in files that
  Lumen does change are kept; unchanged TMDL objects keep their source lines. See
  [Working with PBIP projects](working-with-pbip-projects.md#what-lumen-preserves).
- **Your edits, in Power BI's own format.** Lumen writes report edits as PBIR JSON (visual queries, formatting
  objects, filters, bookmarks, conditional formatting rules, mobile layout) and model edits as TMDL, in the shapes
  Power BI Desktop writes for the same edit.
- **Report content converted from a `.pbix` legacy layout.** Lumen follows the mapping Power BI Desktop uses when it
  upgrades a report to PBIR, and writes the Classic base theme explicitly when the original had none, so colours stay
  the same.
- **Icons** inserted in Lumen are stored as ordinary images, so Power BI Desktop shows the picture (it cannot edit
  the icon as an icon). For icons on the new card visual, the picture is stored as a `data:` URI; whether Power BI
  Desktop accepts that form there is an assumption, not verified.

## Base theme of reports created in Lumen

A report that Lumen **created** (a blank report or the built-in sample) uses the `CY24SU10` base theme. When it is
saved, Lumen writes the base theme the way Power BI Desktop does:

- a `reportVersionAtImport` entry in `themeCollection.baseTheme` (required by Microsoft's report schema);
- the theme file under `StaticResources/SharedResources/BaseThemes/`;
- a `resourcePackages` entry for it.

The theme file has exactly the bytes Power BI Desktop writes for that theme. The `reportVersionAtImport` value is an
approximation: Lumen derives it from the theme version that current Power BI Desktop records for `CY24SU10`.

## What Lumen adds, and what Power BI Desktop is expected to do with it

| Addition | Expected in Power BI Desktop |
|---|---|
| `diagramLayout.lumen.json` in the `*.SemanticModel` folder | A file Power BI Desktop does not know. Expected to be ignored. Not verified. |
| `lumenLayout` object in `report.json`, `lumenSlicer` object in a slicer's `visual.json` | Unknown formatting objects. Expected to be ignored and dropped if Power BI Desktop rewrites the file. Not verified; a strict schema check in Power BI Desktop could reject them. These objects are only written when you use the feature. |
| `Lumen_Icon` annotation on a visual | Annotations are part of the PBIR visual schema and are kept by Power BI. Expected to be preserved. Not verified. |
| `Lumen_Sample` annotation (projects saved from the built-in sample only) | A model annotation. Expected to be preserved. |

To avoid the unknown objects entirely, do not use layout guides or the Lumen-only slicer options in reports that go
back to Power BI Desktop.

## What does not travel

- **Data.** PBIP and `.pbit` output has no data. Power BI Desktop refreshes from the sources when it needs data. A
  `.pbix` carries only the data of the `.pbix` it was opened from. Sample data generated in Lumen never reaches
  Power BI.
- **`.pbix`-only content.** Parts of a `.pbix` that PBIP does not hold are not written to PBIP or `.pbit` (for
  example the Q&A linguistic schema). A `.pbix` saved by Lumen copies them from the original.
- **Features Lumen does not implement.** Lumen keeps their definitions where it can (an unknown property, a custom
  visual's files), but you cannot edit them in Lumen, and you cannot preview in Lumen a visual it does not draw.

## Before you hand a project back

1. Save as PBIP into a new folder, not over the only copy of the original.
2. Look at the diff (for example with `git diff`) to see which files changed.
3. Open the `.pbip` in Power BI Desktop and check the pages you edited.
4. Report anything that does not open or looks different; see
   [A visual looks different from Power BI](../troubleshooting/a-visual-looks-different-from-power-bi.md).

## Related content

- [Working with PBIP projects](working-with-pbip-projects.md)
- [Supported file formats](supported-file-formats.md)
- [How Lumen reads PBIX files](how-lumen-reads-pbix.md)
- [Coming from Power BI Desktop](../get-started/coming-from-power-bi-desktop.md)
- [File format support reference](../reference/file-format-support.md)

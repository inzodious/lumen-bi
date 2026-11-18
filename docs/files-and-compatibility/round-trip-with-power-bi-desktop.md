# Round-trip with Power BI Desktop

> **Applies to:** Creators · Analysts · Developers

This article says what is designed to survive when you take a report from Power BI Desktop into Lumen, save it,
and open it in Power BI Desktop again, and what has and has not been tested. Read it before you use Lumen on a
report that others continue to edit in Power BI Desktop.

> [!IMPORTANT]
> **Opening a Lumen-saved project in Power BI Desktop has not been tested by this project.** Lumen is developed on
> Linux, and its tests run there. Everything below that is about Power BI Desktop reading Lumen's output is
> **designed to** work, based on Microsoft's published PBIP formats and their JSON schemas, and is **not verified**.
> Keep the original file until you have checked the result in Power BI Desktop yourself.

## The round trip

```text
Power BI Desktop                 Lumen                          Power BI Desktop
  .pbix  ─── open ───────────▶  edit  ─── Save as PBIP ──────▶  open the .pbip   (designed to; not verified)
  .pbip  ─── open ───────────▶  edit  ─── Save (in place) ───▶  open the .pbip   (designed to; not verified)
```

There is no way back to `.pbix` inside Lumen: Lumen cannot write `.pbix`. In Power BI Desktop you can open the
`.pbip` and save it as `.pbix` there.

## What is tested, and how

| Check | Tested? | How |
|---|---|---|
| Lumen reads `.pbix` and `.pbit` files correctly | Yes | Automated tests decode Microsoft's public sample `.pbix` files and compare measure results with the values those reports publish |
| Lumen reads PBIP projects | Yes | Unit tests and an optional run over a set of real projects (parse with no errors, evaluate, write back) |
| Open in Lumen → save as PBIP → reopen in Lumen gives the same report | Yes | Automated save-and-reopen tests (pages, visuals, theme) for the sample `.pbix` files and the built-in sample |
| Untouched files keep their bytes | Yes, with a tolerance | TMDL write-back tests; report JSON is compared by value before writing |
| The PBIP output follows Microsoft's JSON schemas | Partly | Lumen writes the schema URLs and versions Power BI uses. A manual check of a saved project against Microsoft's published schemas found one failure (see [Known schema gap](#known-schema-gap)); the test suite does not validate against the schemas |
| Power BI Desktop opens the PBIP output | **No** | Not tested: no Windows machine in this project |
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

## Known schema gap

A report that Lumen **created** (a blank report or the built-in sample), saved as PBIP, has two known problems for
Power BI Desktop:

- its `definition/report.json` does not validate against Microsoft's published report schema: the
  `themeCollection.baseTheme` entry lacks the `reportVersionAtImport` property;
- it references its base theme (`CY24SU10`) by name only, without the theme file under
  `StaticResources/SharedResources/BaseThemes/` and without a `resourcePackages` entry for it. Lumen draws such a
  report with its built-in copy of the theme, and notes on reopening that the theme was not found in the report's
  resources.

Whether Power BI Desktop opens such a report anyway is not verified. Reports that came from Power BI Desktop keep
their own theme entries and files, so this gap concerns reports started in Lumen.

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

- **Data.** PBIP output has no data. Power BI Desktop refreshes from the sources when it needs data. Sample data
  generated in Lumen never reaches Power BI.
- **`.pbix`-only content.** Parts of a `.pbix` that PBIP does not hold are not written (for example the Q&A
  linguistic schema).
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

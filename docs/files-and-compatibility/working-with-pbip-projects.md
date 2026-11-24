# Working with PBIP projects

> **Applies to:** Creators · Analysts · Developers

A Power BI project (PBIP) stores a report and its semantic model as folders of text files instead of one binary
file. It is Lumen's main save format. This article describes the folder layout, what Lumen reads and writes, what
it leaves untouched, the files Lumen adds, and how to keep a project in Git.

## Folder layout

When you save a report named `Sales` as PBIP into a folder, Lumen writes:

```text
Sales.pbip                                  points at the report folder
Sales.Report/
  .platform                                 item metadata (type, display name, logical id)
  definition.pbir                           the report's dataset reference: "../Sales.SemanticModel"
  definition/
    version.json
    report.json                             report-level settings, theme, filters
    reportExtensions.json                   report-level measures (when there are any)
    pages/pages.json                        page order and active page
    pages/<page id>/page.json               one folder per page
    pages/<page id>/visuals/<visual id>/visual.json
    pages/<page id>/visuals/<visual id>/mobile.json   (phone layout position, when set)
    bookmarks/bookmarks.json, bookmarks/<id>.bookmark.json
  StaticResources/
    SharedResources/BaseThemes/*.json       base theme
    RegisteredResources/*                   custom theme, images
Sales.SemanticModel/
  .platform
  definition.pbism                          semantic model settings
  definition/
    database.tmdl
    model.tmdl
    relationships.tmdl
    tables/<Table>.tmdl                     one file per table: columns, measures, hierarchies, partitions
    roles/, cultures/, perspectives/ …      when the model has them
  diagramLayout.json                        Model view layout (when there is one)
```

- **PBIR** (Power BI enhanced report format) is the folder-of-JSON report format under `*.Report/definition/`.
- **TMDL** (Tabular Model Definition Language) is the indented text format of the model under
  `*.SemanticModel/definition/`. A model that was opened from a `model.bim` file is saved as `model.bim` again
  instead.

Microsoft documents both formats: see
[Power BI Desktop projects](https://learn.microsoft.com/power-bi/developer/projects/projects-overview) on Microsoft
Learn.

## Opening a project

Open the `.pbip` file, the project folder, the `*.Report` folder, or the `*.SemanticModel` folder alone (model only,
no report). See [Quickstart: open a report](../get-started/quickstart-open-a-report.md#open-a-pbip-project).

A project contains no data, so it usually opens with the **No data loaded** notice: refresh from the sources or use
sample data. See [Reports without data and sample data](reports-without-data-and-sample-data.md).

## What Lumen preserves

Lumen is built so that a project you open and save without changing anything comes out byte for byte the same:

- **Unchanged files are not rewritten.** Before writing a file, Lumen compares the new content with the file on
  disk; JSON files are compared by value, so a file whose content is equal keeps its exact bytes, formatting and key
  order.
- **The report JSON is edited in place.** Lumen keeps every property of `report.json`, `page.json` and `visual.json`,
  including ones it does not understand, and changes only what you edit.
- **TMDL keeps its formatting.** For every model object, Lumen remembers the exact source lines it read. An object
  you did not change is written with its original lines; an object you changed is written in Lumen's canonical TMDL
  formatting.
- **Other files are carried along.** Files in the `*.SemanticModel` folder that are not part of the model definition
  (`diagramLayout.json`, `.platform`, `definition.pbism`, `.pbi/editorSettings.json`, and any file Lumen does not
  know) and files in the `*.Report` folder outside `definition/` are kept and written back as they were.
- **The `.pbip` file's own settings are kept.** Only its `artifacts` list is set to the report folder.

What Lumen removes when you save in place: the folders and files of pages, visuals and bookmarks you deleted, the
TMDL files of tables, roles or cultures you deleted, and a `model.bim` that a TMDL save replaces. A PBIR-legacy
`report.json` at the root of the report folder is replaced by the PBIR `definition/` folder.

What Lumen does not touch: the `.pbi/` folders' per-user files (`localSettings.json`) and the data cache
`cache.abf`. They stay on disk as they were.

> [!NOTE]
> "Byte-identical when untouched" is a design goal, not a guarantee. Lumen's unit tests write TMDL fixtures back
> byte for byte, and its optional test run over a set of real projects requires more than 95% of TMDL files to come
> back byte-identical: the rest differ in formatting, not in meaning. Expect occasional formatting-only diffs in
> `.tmdl` files the first time Lumen saves a project made elsewhere.

## Files and properties Lumen adds

Some Lumen features have no place in the Power BI formats. Lumen stores them in places that Power BI's formats
reserve for extensions or annotations, and only when you use the feature:

| What | Where | Written when |
|---|---|---|
| Model view extras: line styles, bends, manual line ends, table groups | `*.SemanticModel/diagramLayout.lumen.json` (a separate file next to `diagramLayout.json`) | You customised the diagram; removed again when nothing custom is left |
| Layout guides (page margin and gutter) | `report.json`, object `lumenLayout` | You set non-default guides; removed when set back to none |
| Lumen-only slicer options (dropdown summary style and others) | The slicer's `visual.json`, object `lumenSlicer` | You changed one from its default |
| Container effects (frosted glass, gradient fill, glow, rotation), used by the Lumen-only gallery templates | Annotation `Lumen_Style` in the visual's `annotations`, a JSON object (see `src/core/report/lumenStyle.ts`); Power BI Desktop keeps it and draws the container's ordinary formatting | A template or report sets them |
| Gradient fills of color properties (Format pane color picker, **Gradient** tab) | Annotation `Lumen_Fill` in the `annotations` of the visual's `visual.json` or the page's `page.json`: a JSON list of `{ object, prop, selector?, container?, fallback, gradient }` (see `src/core/report/gradientFill.ts`). The property itself keeps the solid `fallback` color, which Power BI Desktop draws; a gradient whose property no longer holds its fallback is ignored | You applied a gradient; removed when the last gradient of the visual or page is set back to a solid color |
| Animations and page transitions | Annotation `Lumen_Motion`, a JSON object, on `report.json` (animate visuals, durations, stagger, default page transition, drill-through zoom, bookmark morph), `page.json` (the page's transition) and `visual.json` (entrance, delay); see `src/core/report/motion.ts`. Power BI Desktop keeps it and ignores it: visuals animate the Power BI way and pages switch without a transition | You change a setting from its default; removed when every setting of that report, page or visual is back to its default |
| Built-in icons | The icon's picture as an ordinary image (a registered resource, or a data URI for card images) plus an annotation `Lumen_Icon` in the visual's `annotations` with the icon's name, colour and a fingerprint | You inserted an icon |
| Code visual | The visual's `visual.json` (a Lumen-only visual type with objects `lumenCode`, `lumenParams` and `lumenCodeFormat`) and its code as `code.html`, `code.css` and `code.jsx` in the same folder. Power BI Desktop is not expected to display the visual (not verified). See [Code visual](../visuals/code-visual.md) | You added a code visual |
| Sample data on empty visuals (mockups) | Annotation `Lumen_SampleData` on `report.json` (`on` / `off`); on a visual, a JSON object with the sample's `query`, its value-bound formatting `objects`, and `off` when the sample was cleared (see `src/core/sample/spec.ts`). The rows the samples draw are in `*.SemanticModel/sampleData.lumen.json`, never in the model. Power BI Desktop sees empty visuals | A gallery template or a new report turns it on; View > Sample data switches it |
| Gallery template marker | Annotation `Lumen_Template` on the model with the template's id | Projects saved from a gallery template |
| Built-in sample report marker | Annotation `Lumen_Sample` on the model and its tables | Only in projects saved from the built-in sample |
| New project metadata | `.platform` files with a new logical id; `definition.pbism`; `.pbip` with `enableAutoRecovery` | The project is saved for the first time |

For the diagram file's schema see [Architecture: Model diagram sidecar](../ARCHITECTURE.md#model-diagram-sidecar-diagramlayoutlumenjson);
for icons see [Built-in icons](../ICONS.md).

## Keeping a project in Git

PBIP is designed for source control, and Lumen's save behaviour keeps diffs small: an edit to one visual changes one
`visual.json`, a new measure changes one table's `.tmdl` file.

Recommendations:

- Commit the `.pbip` file and both folders.
- Do not commit the per-user files and the data cache. Lumen does not create a `.gitignore`; add one at the project
  root with:

  ```text
  **/.pbi/localSettings.json
  **/.pbi/cache.abf
  ```

- Review `diagramLayout.lumen.json` like any other file; it only exists when the Model view was customised in Lumen.

## Considerations and limitations

- A project saved by Lumen is designed to open in Power BI Desktop; that is not verified by this project. See
  [Round-trip with Power BI Desktop](round-trip-with-power-bi-desktop.md).
- If a `.pbip` file lists several artifacts, Lumen opens the first report and, on save, writes back a `.pbip` that
  lists only that report.
- A report whose dataset reference is a connection (`byConnection`) is saved without a `*.SemanticModel` folder.
- Lumen always names the model folder after the project (`<Name>.SemanticModel`) and points `definition.pbir` at it.
  A project whose report uses a model folder of another name (for example one model shared by several reports) gets
  a second, renamed copy of the model when you save it in place; the original folder is not updated.
- A report that Lumen created (a blank report or the built-in sample) references its base theme by name only, without
  the theme file under `StaticResources/SharedResources/BaseThemes/`. Lumen draws it with its built-in copy of that
  theme; when the project is reopened, the open diagnostics note that the theme was not found in the report's
  resources.
- Lumen writes no data into the project and does not update `.pbi/cache.abf`. If Power BI Desktop later finds a
  cache that no longer matches the model you changed in Lumen, it may need a refresh (not verified).

## Related content

- [Supported file formats](supported-file-formats.md)
- [Round-trip with Power BI Desktop](round-trip-with-power-bi-desktop.md)
- [Save your work and file types](../get-started/save-and-file-types.md)
- [File format support reference](../reference/file-format-support.md)
- [Power BI Desktop projects on Microsoft Learn](https://learn.microsoft.com/power-bi/developer/projects/projects-overview)

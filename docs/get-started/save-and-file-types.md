# Save your work and file types

> **Applies to:** Creators · Analysts · Developers

This article explains what **Save** and **Save as** do in Lumen, which file formats Lumen can write, and which it can
only open. Read it before you save a report that you opened from a `.pbix` file.

## What Lumen can open and what it can save

| Format | Open | Save |
|---|---|---|
| Power BI project (`.pbip` with a `*.Report` and a `*.SemanticModel` folder) | Yes | **Yes** |
| A `*.Report` or `*.SemanticModel` folder on its own | Yes | **Yes**, as a PBIP project (see below) |
| Lumen bundle (`.wbi`) | Yes | **Yes** |
| Power BI Desktop file (`.pbix`) | Yes, with its data | **Experimental**, for a report opened from a `.pbix` whose data is unchanged (see below) |
| Power BI template (`.pbit`) | Yes, without data | **Experimental** |
| Tabular model file (`model.bim` on its own) | Yes, model only | **Yes**, back to the same file |

Lumen writes these formats:

- **Power BI project (PBIP)**: a `<Name>.pbip` file, a `<Name>.Report` folder with the report in the PBIR format and
  a `<Name>.SemanticModel` folder with the model in the TMDL format (or as `model.bim` when the model was opened from
  one). It holds definitions only, no data. It is the format Power BI Desktop uses for source control, and it suits
  Git. See [Working with PBIP projects](../files-and-compatibility/working-with-pbip-projects.md).
- **Lumen bundle (`.wbi`)**: one file that contains the same PBIP project plus the data currently loaded in Lumen, so
  the report reopens with its data and without a refresh. Only Lumen opens it. See
  [The .wbi bundle](../files-and-compatibility/the-wbi-bundle.md).
- **Power BI template (`.pbit`)**, experimental: the model and the report without data. Power BI Desktop loads the
  data from the Power Query sources when it opens the file.
- **Power BI Desktop file (`.pbix`)**, experimental: the report with its data model and the data loaded in Lumen. For
  a report you opened from a `.pbix` and whose data you did not change, Lumen keeps that file's data model (copied
  unchanged, or with your measure edits written into it). For any other report, such as a PBIP project you refreshed
  from its sources, Lumen writes the whole data model itself.

> [!IMPORTANT]
> The `.pbix` and `.pbit` writers are **experimental: not yet verified in Power BI Desktop**. Lumen's tests read
> every file it writes back in Lumen, but nobody has yet confirmed that Power BI Desktop opens them. Keep your
> original file, and open the saved file in Power BI Desktop to check it before you share it. Some model features
> can't go into a `.pbix` written by Lumen yet (for example DirectQuery tables, many-to-many relationships or auto
> date/time); the Save dialog names them and offers a `.pbit` or a PBIP project instead. See
> [Round-trip with Power BI Desktop](../files-and-compatibility/round-trip-with-power-bi-desktop.md).

## Save

Select **Save** in the title bar, **File > Save**, or press Ctrl+S. What happens depends on where the report came
from:

| The report was opened from | Save writes to |
|---|---|
| A `.pbip` file | The same project, in place |
| A project folder or a `*.Report` folder | The `<Name>.pbip` next to the `*.Report` folder, and the `*.Report` and `*.SemanticModel` folders, in place |
| A `*.SemanticModel` folder | The same folder, in place (no `.pbip` file or report is written, because there is no report) |
| A `.wbi` bundle | The same bundle, replaced |
| A `.pbix` or `.pbit` file, the sample report, a blank report | Nothing yet: **Save** opens **Save as** |
| A standalone `model.bim` file | The same `model.bim` file, in place |

When Lumen saves a PBIP project in place, it rewrites only the files whose content changed. Files you did not
touch keep their exact bytes, which keeps Git diffs small. The project's folders keep their names: a report that
points at a model folder with another name (for example a model shared by several reports) keeps pointing at it, and
a `.pbip` file that lists several reports keeps all of them. Files of pages, visuals, bookmarks or tables you deleted
are removed. Lumen never writes data into a PBIP project.

## Save as

1. Select **File > Save as**, or press Ctrl+Shift+S.
2. Choose the format:
   - **Power BI project (.pbip)**: "Report (PBIR) + semantic model (TMDL) folders — opens in Power BI Desktop,
     works with Git".
   - **Lumen bundle (.wbi)**: "Single file: the PBIP project plus the cached data, so it opens without a refresh".
   - **Power BI file (.pbix)**: "Experimental: the report with its data model and the data loaded now; not yet
     verified in Power BI Desktop".
   - **Power BI template (.pbit)**: "Experimental: model and report without data; Power BI loads the data from your
     sources when it opens the file".

   (Ctrl+Shift+S skips this choice and opens the file dialog with all four formats in its file-type list.)
3. In the file dialog, choose a folder and a name, and select **Save**.
4. For `.pbix` and `.pbit`, a dialog says how Lumen will write the file and marks the method
   **Experimental: not yet verified in Power BI Desktop**. Select **Save** to write it, or **Cancel**. If Lumen can't
   write a `.pbix` for this report, the dialog says why and lists each reason (for example "table 'Sales' has no data
   loaded (refresh it first)"):
   "Lumen can't write this model's data into a .pbix yet. Save a .pbit (Power BI loads the data from your sources
   when it opens the file) or a PBIP project."

For PBIP, the name you type becomes the project name: Lumen writes `<Name>.pbip`, `<Name>.Report` and
`<Name>.SemanticModel` into the chosen folder, and points the report at `../<Name>.SemanticModel`. If you type a name
without the `.pbip` extension, Lumen adds it.

![The File menu on the Save as page with four tiles: Power BI project (.pbip), Lumen bundle (.wbi), Power BI file (.pbix) and Power BI template (.pbit)](../images/get-started/save-and-file-types-save-as.png)

After a successful save Lumen shows "Saved to <path>", adds the file to the recent list, and from then on **Save**
writes to the new location. A `.pbit` is an export: the open report keeps its own location. After a `.pbix` save, the
saved `.pbix` is the report's file, and the next **Save as > Power BI file (.pbix)** keeps its data model.

### What a .pbix save keeps

| You changed since opening the `.pbix` | Save as `.pbix` |
|---|---|
| Only the report: pages, visuals, formatting, filters, bookmarks, themes, images | Keeps the original data model byte for byte and writes the report |
| Also measures: added, deleted, or changed (expression, format string, description, display folder, hidden, annotations) | Writes the measures into the original data model; every table's data stays as it was |
| Tables, columns, relationships, hierarchies, partitions, roles, or the data (a refresh, **Enter data**, sample data) | Writes the whole data model from what is loaded in Lumen ("Power BI file with data written by Lumen"), unless the model uses a feature that Lumen can't write yet: the dialog then names it, and you can save a `.pbit` or a PBIP project |

Power BI Desktop asks whoever opens a `.pbix` or `.pbit` written by Lumen to confirm data source permissions. Lumen
never writes the part where Power BI Desktop stores those permissions, because Windows encrypts it for one user on
one computer.

**File > Export > Power BI project (.pbip)** does the same as **Save as > Power BI project (.pbip)**: the open report
then points at the new project.

## Unsaved changes

An asterisk after the report name in the title bar marks unsaved changes. When you open another file, create a new
report, close the report or close the window with unsaved changes, Lumen asks
"Do you want to save your changes to "<Name>"?" with **Save**, **Don't save** and **Cancel**.

> [!WARNING]
> Lumen does not save automatically and has no recovery of unsaved work after a crash. The option
> **Store auto-recovery information** in **File > Options and settings > Options > Report settings** is stored, but
> nothing in this version uses it. Save often.

## Which format to choose

| You want to | Choose |
|---|---|
| Keep the report in Git, review changes, work with others | PBIP |
| Continue in Power BI Desktop | PBIP (designed to open there; not verified), or `.pbix` / `.pbit` (experimental; not verified) |
| Hand a colleague a Power BI file with its data | `.pbix` (experimental; not verified) |
| Hand over the model and report without data | `.pbit` (experimental; not verified) |
| Reopen the report in Lumen with its data, without the sources | `.wbi` |
| Hand someone a single file that opens in Lumen | `.wbi` |
| Keep a report that uses generated sample data together with that data | `.wbi` |

## Considerations and limitations

- `.pbix` and `.pbit` output is experimental and not verified in Power BI Desktop. A `.pbix` can be written only for
  a report opened from a `.pbix` whose data and model (other than measures) are unchanged.
- Inside a `.pbix` or `.pbit`, Lumen writes the report in the classic layout form (`Report/Layout`) that every
  Power BI Desktop version reads. A few PBIR-only settings have no place in that form. Lumen lists them in the
  **Saved, with notes** dialog after the save.
- PBIP output contains no data: a reopened project shows the **No data loaded** notice until you refresh or use
  sample data. Files that Power BI Desktop keeps in the project's `.pbi` folders, such as a data cache, are left on
  disk untouched; Lumen does not update them.
- **Save as** a PBIP project under a new name writes new `<Name>.Report` and `<Name>.SemanticModel` folders and
  points the report at the new model folder.
- Saving a report that was connected live to a service model writes the report folder only.

## Related content

- [Supported file formats](../files-and-compatibility/supported-file-formats.md)
- [Working with PBIP projects](../files-and-compatibility/working-with-pbip-projects.md)
- [The .wbi bundle](../files-and-compatibility/the-wbi-bundle.md)
- [Round-trip with Power BI Desktop](../files-and-compatibility/round-trip-with-power-bi-desktop.md)
- [File format support reference](../reference/file-format-support.md)

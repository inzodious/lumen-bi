# A report opens with errors or empty visuals

> **Applies to:** Creators · Analysts

This article helps when a report does not open, opens with error messages, or opens with visuals that show nothing
or an error. Find the message you see in the sections below.

## "Couldn't open the file"

Lumen could not read the file at all. The message names the file and the reason. Common reasons:

| Reason in the message | Cause | What to do |
|---|---|---|
| "Not a valid Power BI file (zip): …" | The `.pbix` / `.pbit` is damaged or is not a Power BI file | Open the original again in Power BI Desktop, or get a fresh copy |
| "Unsupported file type: …" | The file has an extension Lumen does not open | See [Supported file formats](../files-and-compatibility/supported-file-formats.md) |
| "The .pbip file does not reference a report" | The `.pbip` has no report artifact | Open the `*.SemanticModel` folder instead, or fix the `.pbip` |
| "No semantic model definition found (definition/*.tmdl or model.bim)" | A `*.SemanticModel` folder without a model | Check that the folder is complete |
| "model.bim is not valid JSON: …" | A damaged `model.bim` | Restore it from version control |
| "The folder contains several reports; open one of the *.Report folders" | You opened a folder with several reports and no `.pbip` | Open one `*.Report` folder |
| "No Power BI project found in this folder" | The folder has no `.pbip`, `*.Report` or `*.SemanticModel` | Choose the project folder |
| "Not a Lumen bundle" / "This bundle was written by a newer Lumen" | A damaged `.wbi`, or one from a newer version | Update Lumen |

## "Problem while opening"

The file opened, but Lumen met errors in it, such as a TMDL file it could not parse ("TMDL <file>:<line>: …"),
a model folder the report points at that does not exist ("Semantic model folder not found: …"), or a data model it
could not decode ("Could not decode the embedded data model: …"). Lumen shows up to three such errors as
notifications and opens what it could read.

- A **TMDL parse error** names the file and line. Fix the line in a text editor, or open the project in the tool that
  wrote it.
- **"Semantic model folder not found"**: the report's `definition.pbir` points at a model folder that is not there.
  Keep the `*.Report` and `*.SemanticModel` folders side by side as Power BI Desktop saved them.
- **"Could not decode the embedded data model: Unsupported data model: no metadata.sqlitedb (pre-2017
  XML-metadata model)"**: the `.pbix` is too old. Open it
  in a current Power BI Desktop and save it again.

## Every visual shows (Blank) or "No data available"

The model has no data. Lumen shows the **No data loaded** notice and the status bar says
**n table(s) without data**. Select **Refresh from source** or **Use sample data**. See
[Reports without data and sample data](../files-and-compatibility/reports-without-data-and-sample-data.md).

A report that is **connected live** to a service model ("This report is connected live to …; there is no local model
or data") has no local model. Lumen cannot connect to the service model, so its visuals stay empty.

## "The query engine couldn't load this model"

A red bar under the ribbon, and **Engine error** in the status bar: Lumen's DAX engine could not build the model, for
example because a calculated table or column failed. Hover over **Engine error** to read the reason. Visuals show
"Can't display this visual" with "The data model couldn't be loaded" in **See details**. Report the problem with the
reason; see [A visual looks different from Power BI](a-visual-looks-different-from-power-bi.md#report-a-difference).

## A visual shows "Can't display this visual"

The visual failed while drawing. Select **See details** on the visual for the error message and the visual type.
If the model is still loading, the details say "The data model is still loading"; wait for it.

## A visual shows "Something's wrong with one or more fields"

The visual uses a column or measure that does not exist in the model, usually because it was renamed or deleted.
**See details** lists the missing fields and their field wells. In edit mode, select **Fix this** to remove the
missing fields from the visual, then add the right fields again.

## A visual shows "This visual type isn't supported yet" or "This custom visual isn't supported in Lumen"

Lumen has no renderer for that visual type. Custom visuals from AppSource or your organisation are not executed;
Lumen only draws its own implementations of a few. The placeholder shows the visual's type or name so you can
identify it. See [Visual support](../reference/visual-support.md).

## A visual shows a number that looks wrong

1. Check that the data is real: a **Sample data** badge in the status bar means some tables hold generated values.
2. Check the filters that apply: hover over the visual and select **Filters and slicers affecting this visual**.
3. Check the measure in the **DAX query view**: evaluate it with `EVALUATE ROW("Value", [Your measure])` and compare.
4. If you can compare with Power BI Desktop and the numbers differ on the same data, report it with the measure's
   DAX. Wrong numbers are treated as defects. See [DAX](../dax/README.md) for the engine's known limitations.

## A visual warns that the query exceeded its time budget

A visual's query that runs longer than 15 seconds is stopped, and the visual shows the rows computed so far with the
warning *The query exceeded its time budget (15 s) and was stopped; the results are partial.* Treat its numbers as
incomplete. Reduce the work: filter the page, simplify the measure, or check it in the DAX query view, which has no
time budget. See [DAX](../dax/README.md).

## A large .pbix takes long to open

Lumen decodes the whole data model in the application window, which takes time and memory for large files. The
progress overlay shows the step it is on. Wait for it to finish; the time grows with the size of the data in the file.

## Related content

- [Supported file formats](../files-and-compatibility/supported-file-formats.md)
- [Reports without data and sample data](../files-and-compatibility/reports-without-data-and-sample-data.md)
- [A visual looks different from Power BI](a-visual-looks-different-from-power-bi.md)
- [Visual support](../reference/visual-support.md)
- [Frequently asked questions](faq.md)

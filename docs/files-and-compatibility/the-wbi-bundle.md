# The .wbi bundle

> **Applies to:** Creators · Analysts · Developers

A `.wbi` file is Lumen's own single-file format: a Power BI project plus the data that was loaded when you saved
it. This article explains what it contains, when to use it and what it is not.

## When to use a .wbi bundle

| Use a `.wbi` bundle to | Because |
|---|---|
| Reopen a report with its data without a refresh | The data travels inside the file |
| Keep a report that you opened from a `.pbix`, with its data | Lumen cannot write `.pbix`; PBIP would lose the data |
| Keep generated sample data | PBIP never stores data |
| Hand a colleague one file that opens in Lumen | A single zip file instead of a folder tree |

Use PBIP instead when the report should go into Git or back to Power BI Desktop. Power BI Desktop does not open
`.wbi` files.

## Save and open a bundle

- Save: **File > Save as > Lumen bundle (.wbi)**, or Ctrl+Shift+S and choose the `.wbi` file type.
- Open: **File > Open > Browse this device**, Ctrl+O, double-click in the file manager (after
  [desktop integration](../get-started/install-on-linux.md#add-lumen-to-the-desktop)), or the **Recent** list.

Once a report was opened from or saved to a `.wbi`, **Save** (Ctrl+S) writes the bundle again.

## What a bundle contains

A `.wbi` file is a zip archive (deflate-compressed) with this layout:

```text
manifest.json                         format "wbi", format version, project name, save time, generator, source
project/<Name>.pbip
project/<Name>.Report/**              the report, exactly as a PBIP save would write it
project/<Name>.SemanticModel/**       the model as TMDL (or model.bim), exactly as a PBIP save would write it
data/tables.json                      per table: name, row count, load status, and per column its type and encoding
data/<table>/<column>.bin             one binary file per column
```

Each column is stored in a compact encoding chosen from its values: 32-bit integers, 64-bit floating-point numbers,
dates (as milliseconds), booleans, dictionary-encoded text (the dictionary is kept in `tables.json`), or tagged JSON
for mixed columns. Blanks are kept in a bitmap. The load status of each table is stored too, so tables filled with
sample data are still marked as sample data when you reopen the bundle.

The `project/` folder inside the bundle is a complete PBIP project. You can unzip a bundle and open
`project/<Name>.pbip` in Lumen (it then has no data), or in Power BI Desktop with the same caveats as any PBIP saved
by Lumen (see [Round-trip with Power BI Desktop](round-trip-with-power-bi-desktop.md)).

## Versioning

`manifest.json` carries a format version (currently 1). Lumen refuses a bundle with a higher version than it knows,
with "This bundle was written by a newer Lumen (format n)", and a zip that is not a bundle with "Not a Lumen bundle".

## Considerations and limitations

- A bundle stores data as loaded in memory, without VertiPaq compression. A large model gives a large file; the zip
  deflate compression helps with repeated values but does not match a `.pbix`.
- A bundle is a snapshot. It does not refresh by itself; use **Home > Refresh** to reload from the sources.
- Credentials are never stored in a bundle (Lumen keeps them in its encrypted credential store).
- Only Lumen reads `.wbi`.
- The bundle holds whatever data was loaded. If that data is confidential, so is the bundle: treat it like the
  original `.pbix`.

## Related content

- [Save your work and file types](../get-started/save-and-file-types.md)
- [Supported file formats](supported-file-formats.md)
- [Reports without data and sample data](reports-without-data-and-sample-data.md)
- [Working with PBIP projects](working-with-pbip-projects.md)

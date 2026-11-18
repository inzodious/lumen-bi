# Connect to files and folders

> **Applies to:** Creators · Analysts

Import Excel workbooks, CSV and text files, JSON documents, Parquet files, or the list of files in a folder. Files are read from the local disk (or a mounted network location) with your own file permissions.

## Prerequisites

- The file is on a local disk or on a network share that is already mounted. For SMB and NFS shares that are not mounted yet, see [Connect to network shares](connect-to-network-shares.md).
- Supported file types:

| Connector | File types | M query Lumen writes |
|---|---|---|
| **Excel workbook** | `.xlsx`, `.xlsm` | `Excel.Workbook(File.Contents(…), null, true)`, then the sheet or table, promoted headers and types |
| **Text/CSV** | `.csv`, `.txt`, `.tsv`, `.prn` | `Csv.Document(File.Contents(…), [Delimiter, Columns, Encoding=65001, QuoteStyle=QuoteStyle.Csv])`, promoted headers and types |
| **JSON** | `.json` | `Json.Document(File.Contents(…))`, converted to a table, types |
| **Parquet** | `.parquet` | `Parquet.Document(File.Contents(…))` (column types come from the file, so no type step) |
| **Folder** | any folder | `Folder.Files(…)` |

## Import a file

1. Select **Home > Get data**, or **Home > Excel workbook** for a workbook.
2. Select **File**, then the connector (**Excel workbook**, **Text/CSV**, **JSON** or **Parquet**), and select **Connect**.
3. In the file picker, select the file and open it. The picker's filter shows the connector's file types; choose **All files** to pick another extension.
4. In the **Navigator**, select an item to preview it, and select its check box:
   - A workbook lists its sheets and its Excel tables.
   - A CSV, JSON or Parquet file is one item.
5. Select **Load**, or **Transform data** to shape the data first in the [Power Query editor](power-query-editor.md).

**Result:** a new table with the file's rows. The status bar of Table view shows its row count.

## How Lumen reads each format

**Text/CSV**

- The delimiter is detected from the first 20 non-empty lines: comma, semicolon, tab or pipe, whichever splits them most consistently.
- Quoted fields may contain delimiters, quotes and line breaks (RFC 4180).
- The first row becomes the header row when it is all text and a later row is not, the rule Power BI Desktop uses. Otherwise columns are named `Column1`, `Column2`, and so on.
- Column types are detected from the first 1,000 rows: whole number, decimal number, date, date/time, true/false or text.
- `Csv.Document` decodes UTF-8 (code page 65001), Windows code pages, UTF-16 and other common code pages. UTF-7 is refused.

**Excel workbook**

- Sheets are read from their used range; empty leading rows are skipped. A sheet's first row is promoted to headers by the same rule as CSV.
- Excel tables (defined with **Format as Table** in Excel) keep their own headers.

**JSON**

Lumen turns these shapes into a table and writes the matching M step:

| JSON shape | M step |
|---|---|
| An array of objects | `Table.FromRecords(Source)` |
| An object of arrays (one array per column) | `Table.FromColumns(Record.FieldValues(Source), Record.FieldNames(Source))` |
| An array of arrays | `Table.FromRows(Source)` |
| An array of values | `Table.FromList(Source, Splitter.SplitByNothing(), {"Value"}, null, ExtraValues.Error)` |

A document of any other shape fails with *No tables were found in this file.* Read it with a blank query and `Json.Document` instead.

**Parquet**

Types come from the Parquet schema. Lumen decodes Parquet itself, in the app.

**Folder**

1. Select **File > Folder**, then **Connect**, and choose the folder.
2. The Navigator shows one item named after the folder. Its preview lists the files directly in the folder with `Name`, `Extension`, `Date modified`, `Folder Path` and `Size`.
3. Select **Transform data** to work with the files in the Power Query editor.

The query Lumen writes is `Folder.Files("<folder>")`. In the M engine it returns Power Query's columns, `Content`, `Name`, `Extension`, `Date accessed`, `Date modified`, `Date created`, `Attributes` and `Folder Path`, and it includes files in sub-folders. To combine files, filter on `Extension` and add a custom column that reads each `Content` binary, for example with `Csv.Document([Content])`.

> [!WARNING]
> Known issue: a table loaded with **Load** from the Folder connector gets the preview's columns (including `Size`, which `Folder.Files` does not return), so its first refresh fails with *Expression.Error: The 'Size' column does not exist in the rowset.* The table keeps the rows it was loaded with. The preview also omits files in sub-folders, which the query includes. This was reproduced in Lumen for this article.

## Considerations and limitations

- **Not exercised for every format for this documentation.** The CSV and Folder paths were run in Lumen for this article (file picker, Navigator, Load, generated query, refresh). Excel, JSON and Parquet are described from the code and its unit tests.
- Excel `.xls` (binary) and `.xlsb` are not read.
- The **Combine Files** command of Power BI Desktop is not available. Combine files with M in the Power Query editor (`Table.AddColumn` over `Folder.Files`, then `Table.Combine` or **Expand**).
- File paths in the query are absolute paths of this computer. A report that you open on another computer needs the files at the same paths, or edited queries. Paths on a mounted share can be written as `smb://` addresses instead; see [Connect to network shares](connect-to-network-shares.md).
- File reads cannot be interrupted. When you cancel a refresh, Lumen stops waiting at once, but a large file that is being read finishes in the background. See [Refresh data](refresh-data.md).

## Differences from Power BI Desktop

- The **Text/CSV** connector opens the Navigator directly. There is no separate preview dialog with **File origin**, **Delimiter** and **Data type detection** drop-downs; change those in the Power Query editor (edit the `Source` step).
- Type detection looks at the first 1,000 rows, where Power BI Desktop uses the first 200 by default; the detected types can differ for files whose first rows are not representative.

## Related content

- [Get data overview](get-data-overview.md)
- [The Power Query editor](power-query-editor.md)
- [Connect to network shares](connect-to-network-shares.md)
- [Data types and locale](data-types-and-locale.md)
- [Connector support](../reference/connector-support.md)

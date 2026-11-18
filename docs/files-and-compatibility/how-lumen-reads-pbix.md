# How Lumen reads PBIX files

> **Applies to:** Analysts · Developers

This article explains what is inside a `.pbix` file and how Lumen turns it into a report, a model and data without
Power BI Desktop. Read it to understand why a `.pbix` opens with its data in Lumen but cannot be saved back as
`.pbix`, and what to expect from old or unusual files.

## The container

A `.pbix` file (and a `.pbit` template) is a zip archive in the Open Packaging Conventions style. Its main parts:

| Part | Content | Encoding |
|---|---|---|
| `Version` | The file format version | Text |
| `Report/Layout` | The report: pages, visuals, filters, bookmarks, in the legacy layout format | UTF-16 JSON, with nested JSON strings |
| `Report/definition/**` | The report in the PBIR format, in files saved with PBIR enabled | JSON files |
| `Report/StaticResources/**` | Base and custom themes, images | JSON, images |
| `DataModel` | The semantic model and its data | Compressed Analysis Services backup |
| `DataModelSchema` | The model without data, in `.pbit` templates | UTF-16 TMSL JSON |
| `DataMashup` | The Power Query queries | Binary package with a zip inside |
| `DiagramLayout` | Model view diagram | JSON |
| `Connections` | The connection of a live-connected report | JSON |

Lumen unzips the container in memory (with the `fflate` library), then reads the report, the model and the queries
separately.

## The report

- If the file has `Report/definition/report.json`, the report is already in PBIR and Lumen reads it as is.
- Otherwise Lumen converts `Report/Layout` into PBIR in memory, following the mapping Power BI Desktop uses when it
  upgrades a report: each section becomes a page, each visual container a visual with its query, formatting
  (`objects` and `visualContainerObjects`), filters and mobile position; report, page and visual filters become
  PBIR filter configurations; bookmarks and report-level measures are carried over. Parts of the legacy format
  that PBIR does not keep (for example cached query results) are dropped and reported as diagnostics.
- A report without a base theme is given Power BI's Classic theme, which is what such a report shows in Power BI,
  and that theme is written out when you save.

From then on the report is handled as PBIR, which is also what Lumen writes when you save as PBIP.

## The data model and its compressed storage

The `DataModel` part is where the work is. It holds an Analysis Services tabular database backup (ABF), compressed,
which contains the model's metadata in a SQLite database and every column's data in the VertiPaq column-store
format. Lumen decodes it in pure TypeScript, in these steps:

```text
DataModel
  │  1. decompress: XPress9 (single- or multi-threaded framing), or none
  ▼
ABF backup  ──  2. parse the backup header and its virtual directory of files
  │              (older files: each inner file is XPress8-compressed)
  ▼
metadata.sqlitedb  ──  3. read with sql.js (SQLite compiled to WebAssembly):
  │                      tables, columns, measures, relationships, hierarchies,
  │                      partitions, roles, calculation groups, annotations…
  ▼
column files  ──  4. decode VertiPaq storage per column:
                     .idfmeta  segment metadata
                     .idf      data ids, hybrid run-length + bit-packed
                     .dictionary  string / integer / real dictionaries,
                                  incl. Huffman-compressed string pages
                     → values (hash-encoded via dictionary, or value-encoded)
```

5. Relationship indexes stored in the file are read as well, so relationship keys match exactly what Power BI
   computed (this matters for keys of mixed types, such as text against whole numbers).

The values follow Lumen's value rules: dates become date-times with no time zone, fixed decimal numbers are
divided by 10,000, a blank is a blank. The decoder runs in the renderer, so a large file takes noticeable time and
memory; the progress overlay shows each step ("Decompressing data model", "Reading model metadata", "Loading
<table>").

The decoders are ports of published work, credited in `THIRD_PARTY_NOTICES.md` and in
`src/core/io/pbix/datamodel/THIRD_PARTY.md`: Microsoft's open-source Xpress9 and Xpress (XPress8) decoders, and the
format knowledge of the pbixray and xmhuffman projects. The VertiPaq dictionary and data formats are also described
in Microsoft's [MS-XLDM] open specification.

## The queries

The `DataMashup` part holds a Power Query package with the file `Formulas/Section1.m`, which contains every query in
M. Lumen extracts it. Older `.pbix` files store table partitions as `SELECT * FROM [Query]` references to the mashup
instead of M expressions; Lumen replaces those with the M of the matching query and adds the remaining queries
(parameters, helper queries) as shared expressions, as Power BI Desktop does when it upgrades such a file.

## .pbit templates

A `.pbit` has `DataModelSchema` (the model as TMSL JSON) instead of `DataModel`. Lumen reads the model from it. There
is no data: the report opens with the **No data loaded** notice.

## What is decoded and what is not

| Content | Lumen |
|---|---|
| Report pages, visuals, filters, bookmarks, themes, images | Read |
| Model metadata (tables, columns, measures, relationships, hierarchies, roles, calculation groups, partitions, annotations, format strings) | Read |
| Data of import-mode tables, including calculated columns and calculated tables stored in the file | Read |
| DirectQuery tables | No data is stored in the file; marked "DirectQuery table: no data stored in the file" |
| Power Query (M) queries | Read |
| Model view layout, saved DAX queries | Kept |
| Q&A linguistic schema | Not read |
| Packaged custom visuals | Kept as files, not executed |
| Live-connected reports (no local model) | Report only, with a warning |

When one column cannot be decoded, its values become blank and the reason is listed in the diagnostics; a table
whose columns all fail is marked as an error. Lumen still opens the rest of the file.

## Version tolerance

- **Compression**: uncompressed, single-threaded XPress9 and multi-threaded XPress9 backups are recognised.
- **Older files**: ABF backups whose inner files are each XPress8-compressed are decompressed, and older
  `metadata.sqlitedb` schemas with different column names are handled.
- **Very old files**: models from before about 2017, which kept their metadata as XML instead of
  `metadata.sqlitedb`, are not supported. Lumen reports "Unsupported data model: no metadata.sqlitedb (pre-2017
  XML-metadata model)".
- **New features**: properties of the report and model that Lumen does not know are kept, so they survive a save as
  PBIP; a feature Lumen does not implement is not drawn or evaluated.

## Why Lumen cannot write .pbix

Writing a `.pbix` would mean producing a compressed Analysis Services backup with VertiPaq column storage that
Power BI Desktop accepts. Lumen implements the decoding direction only. PBIP is Power BI's open, text-based format
for the same content, so Lumen saves there; see
[Round-trip with Power BI Desktop](round-trip-with-power-bi-desktop.md).

## Related content

- [Supported file formats](supported-file-formats.md)
- [Working with PBIP projects](working-with-pbip-projects.md)
- [File format support reference](../reference/file-format-support.md)
- [File-format I/O for developers](../developer/README.md)
- [Third-party notices](../../THIRD_PARTY_NOTICES.md)

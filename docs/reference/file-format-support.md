# File format support

> **Applies to:** Creators · Analysts · Developers

This reference lists, feature by feature, what Lumen reads from each file format, what it writes, and what it keeps
without interpreting it. It was checked against the readers and writers in `src/core/io/`, `src/core/pbir/` and
`src/core/tmdl/`. For an overview, read [Supported file formats](../files-and-compatibility/supported-file-formats.md).

## Legend

| Value | Meaning |
|---|---|
| **Read** | Lumen reads it and uses it |
| **Read, write** | Lumen reads it, uses it, and writes it (changed when you edit it) |
| **Kept** | Lumen does not interpret it but carries it to the output unchanged |
| **Not read** | Ignored on open, not in the output |
| **n/a** | The format cannot hold it |

Output is always PBIP or `.wbi`: Lumen writes neither `.pbix` nor `.pbit`. The `.wbi` column is the same as the PBIP
column for definitions; the difference is data.

## Report

| Feature | `.pbix` / `.pbit` (open) | PBIP | `.wbi` |
|---|---|---|---|
| Pages, visuals, visual groups | Read | Read, write | Read, write |
| Legacy report layout (`Report/Layout`, PBIR-legacy `report.json`) | Read, converted to PBIR | Read, written as PBIR | n/a |
| PBIR report (`definition/**`) | Read | Read, write | Read, write |
| Report, page and visual filters | Read | Read, write | Read, write |
| Formatting objects (`objects`, `visualContainerObjects`) | Read | Read, write | Read, write |
| Unknown properties in report, page and visual JSON | Kept | Kept | Kept |
| Base and custom themes | Read | Read, write | Read, write |
| Images and other registered resources | Read | Read, write | Read, write |
| Bookmarks | Read | Read, write | Read, write |
| Mobile layout (`mobile.json`) | Read | Read, write | Read, write |
| Report-level measures (`reportExtensions.json`) | Read | Read, write | Read, write |
| Packaged custom visuals (`CustomVisuals/**`) | Kept (not executed) | Kept | Kept |
| Q&A linguistic schema | Not read | n/a | n/a |
| Report `.platform` | n/a | Kept; created when missing | Kept; created when missing |
| Report `.pbi/` per-user files | n/a | Not read; left on disk | n/a |
| Lumen layout guides (`lumenLayout`), Lumen slicer options (`lumenSlicer`), `Lumen_Icon` annotations | n/a | Read, write (only when used) | Read, write |

## Semantic model

| Feature | `.pbix` | `.pbit` | PBIP (TMDL) | PBIP / `model.bim` | `.wbi` |
|---|---|---|---|---|---|
| Tables, columns, measures | Read | Read | Read, write | Read, write | Read, write |
| Calculated columns and tables | Read | Read | Read, write | Read, write | Read, write |
| Relationships | Read | Read | Read, write | Read, write | Read, write |
| Hierarchies | Read | Read | Read, write | Read, write | Read, write |
| Calculation groups | Read | Read | Read, write | Read, write | Read, write |
| Roles (row-level security) | Read | Read | Read, write | Read, write | Read, write |
| Perspectives, cultures (translations) | Read | Read | Read, write | Read, write | Read, write |
| Partitions with Power Query (M) | Read (from the mashup for older files) | Read | Read, write | Read, write | Read, write |
| Shared expressions and parameters | Read | Read | Read, write | Read, write | Read, write |
| Annotations | Read | Read | Read, write | Read, write | Read, write |
| Format strings, display folders, descriptions | Read | Read | Read, write | Read, write | Read, write |
| Model properties Lumen does not model | Kept where the reader can carry them | Kept | Kept | Kept | Kept |
| TMDL formatting of unchanged objects | n/a | n/a | Kept (written from the source lines) | n/a | Kept |
| Model view layout (`diagramLayout.json`) | Read | n/a | Read, write | Read, write | Read, write |
| Lumen diagram extras (`diagramLayout.lumen.json`) | n/a | n/a | Read, write (only when used) | Read, write | Read, write |
| Saved DAX queries (`DAXQueries/**`) | Kept | Kept | Kept | Kept | Kept |
| `definition.pbism`, model `.platform` | n/a | n/a | Kept; created when missing | Kept; created when missing | Kept |
| `.pbi/editorSettings.json` | n/a | n/a | Kept | Kept | Kept |
| `.pbi/localSettings.json` | n/a | n/a | Not read; left on disk | Not read; left on disk | n/a |

## Data

| Feature | `.pbix` | `.pbit` | PBIP | `.wbi` |
|---|---|---|---|---|
| Import-mode table data | Read (decoded from the compressed model) | n/a | Read from `.pbi/cache.abf` when present and not blocked; never written | Read, write |
| DirectQuery table data | n/a (not stored in the file) | n/a | n/a | Read, write (what was loaded) |
| Relationship indexes | Read | n/a | Read from the cache when it is read | n/a (recomputed) |
| Load status per table (loaded, sample data, error) | n/a | n/a | n/a | Read, write |
| Generated sample data | n/a | n/a | Not written | Read, write |

## Connections

| Feature | `.pbix` / `.pbit` | PBIP | `.wbi` |
|---|---|---|---|
| Live connection to a service model | Read (report only, no data) | Read (`byConnection`), written back | Read, write |
| Data source credentials | n/a | n/a | Never written |

## Considerations and limitations

- "Read, write" means Lumen writes the feature in the format Power BI uses. Whether Power BI Desktop accepts every
  written feature is designed for but not verified; see
  [Round-trip with Power BI Desktop](../files-and-compatibility/round-trip-with-power-bi-desktop.md).
- A model read from `.pbix` is written as TMDL; a model read from `model.bim` is written as `model.bim`.
- When the model is written as TMDL, `definition.pbism` is set to version 4.2 if it declared an older version, since
  TMDL needs version 4.0 or later.
- This table describes file content. Whether Lumen **evaluates or draws** a feature it reads is covered elsewhere:
  [Visual support](visual-support.md), [DAX function support](dax-function-support.md),
  [M function support](m-function-support.md), [Connector support](connector-support.md).

## Related content

- [Supported file formats](../files-and-compatibility/supported-file-formats.md)
- [How Lumen reads PBIX files](../files-and-compatibility/how-lumen-reads-pbix.md)
- [Working with PBIP projects](../files-and-compatibility/working-with-pbip-projects.md)
- [The .wbi bundle](../files-and-compatibility/the-wbi-bundle.md)

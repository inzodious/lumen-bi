# Connect and transform data

> **Applies to:** Analysts · Creators · Developers

Lumen gets data the way Power BI Desktop does: a **Get Data** dialog with connectors, a Navigator that previews what you pick, Power Query M queries that you shape in the Power Query editor, and a refresh that runs those queries again. Queries run in Lumen's own M engine on Linux. This section explains each connector, the editor, folding, refresh, credentials, and the generated sample data Lumen offers when a report opens without data.

## Overview and concepts

| Article | Type | What it covers |
|---|---|---|
| [Get data overview](get-data-overview.md) | Overview | The Get Data dialog, its categories, the Navigator, and what happens after you load |
| [Query folding](query-folding.md) | Concept | Which Power Query steps Lumen sends to each source, and when folding stops |
| [Credentials and privacy](credentials-and-privacy.md) | Concept | Where credentials are stored, sign-in flows, privacy levels, what is never saved in a report |
| [Data types and locale](data-types-and-locale.md) | Concept | Power Query types, how they map to model types, and which cultures Lumen supports |
| [Sample data](sample-data.md) | Concept | Why a project can open without data, and how Lumen generates sample data that never copies names or ids |

## Connect to a source

| Article | Type | Sources |
|---|---|---|
| [Connect to files and folders](connect-to-files.md) | How-to | Excel workbook, Text/CSV, JSON, Parquet, Folder |
| [Connect to network shares](connect-to-network-shares.md) | How-to | SMB and NFS shares mounted on the computer |
| [Connect to a lakehouse folder or DuckDB](connect-to-a-lakehouse-folder-or-duckdb.md) | How-to | Delta tables in a lakehouse folder, DuckDB database files |
| [Connect to SQL Server and Microsoft Fabric](connect-to-sql-server-and-fabric.md) | How-to | SQL Server, Azure SQL, Azure Synapse, Fabric SQL analytics endpoint and Warehouse |
| [Connect to PostgreSQL, MySQL and SQLite](connect-to-postgresql-mysql-sqlite.md) | How-to | PostgreSQL, MySQL and MariaDB, SQLite files |
| [Connect to S3-compatible storage](connect-to-s3-storage.md) | How-to | Amazon S3, MinIO, Cloudflare R2, Backblaze B2 and other S3 services |
| [Connect to Google Firestore](connect-to-firestore.md) | How-to | Firestore databases and the Firestore emulator |
| [Connect to web sources and APIs](connect-to-web-and-apis.md) | How-to | Web (CSV and JSON), OData feed, GraphQL API, paged REST API |
| [Enter data](enter-data.md) | How-to | Type or paste a small table |

## Shape and refresh

| Article | Type | What it covers |
|---|---|---|
| [The Power Query editor](power-query-editor.md) | Overview | Queries pane, applied steps, formula bar, preview, ribbon |
| [Write M in the Advanced editor](write-m-in-the-advanced-editor.md) | Tutorial | Edit a query's M text, with examples you can run on the built-in sample |
| [Parameters and custom functions](parameters-and-functions.md) | How-to | Manage Parameters, functions written in M, Invoke |
| [Refresh data](refresh-data.md) | How-to | The Refresh dialog, per-table status, Cancel, errors, keeping previous data |

## Reference

- [Connector support](../reference/connector-support.md): every connector, its M function, authentication, folding and cancel behaviour (generated).
- [M function support](../reference/m-function-support.md): every function in Microsoft's M list and whether Lumen implements it (generated).

## Not supported

These Power BI Desktop features have no equivalent in Lumen today:

- Connectors that need Windows or a Microsoft service: Power BI semantic models, Dataflows, SharePoint Online lists and files, Analysis Services, ODBC, OLE DB, Azure Blob and Data Lake storage with sign-in, Fabric workspace browsing (`Lakehouse.Contents`). They appear in the dialog as **Not available** or fail with an error that suggests an alternative.
- HTML tables from web pages (`Web.Page`).
- Windows authentication to SQL Server.
- Power Query editor commands: Combine Files, Column From Examples, Invoke Custom Function (the ribbon command; invoking a function query works), Parse XML / JSON, Trigonometry, Query Dependencies, **View Native Query**, **Extract Previous**.
- Dataflows and the Power Query Online diagram view.

## Related content

- [Model data](../model-data/README.md)
- [DAX in Lumen](../dax/README.md)
- [Get started](../get-started/README.md)
- [Troubleshooting](../troubleshooting/README.md)

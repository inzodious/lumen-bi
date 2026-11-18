# Refresh data

> **Applies to:** Creators · Analysts

A refresh runs each table's Power Query query again and loads the result into the model. This article covers how to start a refresh, the **Refresh** dialog and its per-table status, what **Cancel** does and does not stop, errors, and what happens to the data you had before.

## Prerequisites

- The tables have Power Query queries (import tables). Calculated tables and calculation groups are not refreshed from a source; the DAX engine recomputes them after the refresh.
- The sources are reachable and their credentials are set (see [Credentials and privacy](credentials-and-privacy.md)).

## Start a refresh

| To refresh | Do this |
|---|---|
| Every table | **Home > Refresh**, or search for **Refresh** in the title bar's search box |
| One table | Right-click the table in the **Data** pane and select **Refresh data**, or select **Refresh** in Table view when the table has no data |
| Tables whose queries you changed | **Close & Apply** or **Apply** in the Power Query editor |
| Tables a report opened without | **Refresh from source** in the *No data loaded* notification, or set **File > Options and settings > Options > Global > Data Load > When tables have no data** to **Refresh from the data sources** |

## The Refresh dialog

The dialog lists the tables being refreshed, one row each, with a progress bar while it runs:

| Row shows | Meaning |
|---|---|
| *Waiting…* | Not started yet. Tables are refreshed one after the other, in order. |
| *Evaluating…* (spinner) | The query is running. |
| *N rows loaded* (check mark) | Done. Lumen may add *(N errors loaded as blank)* or an incremental refresh note. |
| An error message (red icon) | The table failed; see below. |
| *Cancelled* | The refresh was cancelled before this table finished. |
| *Not refreshed* | A problem stopped the whole refresh before this table started. |

![The Refresh dialog after a refresh with one error: Product 65 rows loaded, Region 9 rows loaded, Store with the error "DataSource.NotFound: File or Folder: We couldn't find the file '/data/missing/stores.csv'.", Sales 23,110 rows loaded; buttons Use sample data for tables without data and Close.](../images/connect-and-transform/refresh-data-dialog-error.png)

When every table loads, the dialog closes by itself, as Power BI Desktop's does. It stays open when a table failed or when you cancelled, with a summary: *Refresh complete*, *Refresh finished with N errors* or *Refresh failed*.

After a refresh, Lumen rebuilds the model's data: calculated columns and calculated tables are recomputed and every visual queries the new data.

## Errors

Tables refresh independently: one failure does not stop the others.

- A failed table **keeps the data it had** before the refresh. If it had none, it is marked with the error, and the status bar shows a *table errors* badge with the messages.
- Error messages follow Power Query's form: `DataSource.NotFound: File or Folder: We couldn't find the file '…'.`, `Expression.Error: The 'Size' column does not exist in the rowset.`, and so on.
- When a message points to credentials or sign-in (authentication failures, 401 and 403 responses, expired tokens), the dialog offers **Edit credentials…**, which opens **Data source settings**.
- **Use sample data for tables without data** fills the tables that still have no rows with generated [sample data](sample-data.md).
- Cells that evaluate to an error load as blank values, and the row reports how many: *(N errors loaded as blank)*.
- A query whose result is not a table fails with *Expression.Error: The query returns a … but only tables can be loaded to the model.*
- A column of the model that the query no longer returns fails the table with *The 'X' column does not exist in the rowset.* Change the query, or remove or rename the column in the model.

## Cancel a refresh

Select **Cancel** while the refresh runs (closing the dialog also cancels). The button reads **Cancelling…** and the dialog stops at once:

- Tables that **finished** before you cancelled keep their **new** data. Cancel does not roll them back.
- The table that was **running** keeps its **previous** data.
- Tables that had **not started** are not refreshed.
- Their rows show *Cancelled*, and **Close** replaces **Cancel**.

What happens to the request that was running depends on the source:

| Source | Effect of Cancel on the running request |
|---|---|
| SQL Server, Azure SQL, Synapse, Fabric | Stopped: Lumen sends SQL Server's cancel signal, and abandons a sign-in that is waiting. |
| Web, OData, GraphQL, REST (HTTP requests) | Stopped: the connection is closed. |
| PostgreSQL, MySQL, SQLite, DuckDB, Firestore, S3 | **Not stopped.** Lumen stops waiting and discards the result, but the query or download runs to completion in the background. |
| Files, folders, lakehouse folders, network shares | **Not stopped.** A file read that started completes in the background; its result is discarded. |

A transformation that is already being computed in the M engine finishes its current pass before Lumen notices the cancel; the next data request does not start.

## Incremental refresh

When a table has an incremental refresh policy and its query filters on the `RangeStart` and `RangeEnd` parameters, Lumen applies the policy as the Power BI service does: the first refresh loads the rolling window, later refreshes reload only the incremental window and keep the older rows. The row says, for example, *incremental: 2025-11-01 – 2025-11-30 refreshed (N rows), M archived rows kept*.

## Sample tables

Tables of the built-in sample and tables that hold [generated sample data](sample-data.md) are handled specially: when such a table's query returns no rows (the sample's `Sales` and `Customer` queries only declare columns), the refresh keeps the generated rows.

## Considerations and limitations

- **Exercised for this documentation.** A refresh with one failing table was run on the built-in sample for the screenshot above. Lumen's end-to-end test of **Cancel** against a server that never answers (the dialog stops at once, the previous data is kept, the HTTP connection is closed) passed on the build documented here.
- Tables refresh one at a time; Power BI Desktop refreshes several in parallel.
- For sample tables whose rows were kept, the dialog says *N rows loaded* although no rows were read.
- Database row limit: a query that returns more than 5,000,000 rows fails (see the connector articles).

## Differences from Power BI Desktop

- When you cancel, Lumen keeps the new data of the tables that finished; do not expect the whole refresh to be undone.
- Power BI Desktop's dialog shows rows and bytes as they load; Lumen shows a state per table and a result line.
- Power BI Desktop ignores incremental refresh policies and loads the parameters' values. Lumen applies the policy.

## Related content

- [Credentials and privacy](credentials-and-privacy.md)
- [Sample data](sample-data.md)
- [The Power Query editor](power-query-editor.md)
- [Connector support](../reference/connector-support.md)
- [Troubleshooting](../troubleshooting/README.md)

# Refresh and connection problems

> **Applies to:** Analysts

This article helps when a refresh fails, a data source asks for credentials you cannot provide, or a refresh is
slow. A refresh runs the model's Power Query (M) queries in Lumen's own M engine and loads the results into the
model.

## Read the refresh result

**Home > Refresh** (or **Refresh from source** on the notice bar) opens the **Refresh** dialog. It lists every table
with its state: **Waiting…**, **Evaluating…**, the number of rows loaded, **Failed**, **Cancelled** or
**Not refreshed**. At the end it says **Refresh complete**, **Refresh finished with n errors** or
**Refresh failed**; a failed table's row shows the reason. **Cancel** stops a running refresh (see
[Refresh is slow](#refresh-is-slow) for a limitation).

After a refresh with errors:

- a red notice bar says **Refresh failed** for the tables concerned, with a **Use sample data** button that fills
  just those tables with generated values;
- the status bar shows **n table errors**; hover over it to read the reasons.

Rows that load with an error in a cell are kept, with the cell blank, and the dialog says how many cells were
affected ("n errors loaded as blank").

## Common causes

| Message or symptom | Cause | What to do |
|---|---|---|
| A file is not found | The query uses a path from the computer where the report was made (often a Windows path such as `C:\…`) | Change the path in the Power Query editor (**Home > Transform data**), usually in the query's **Source** step or a parameter (**Manage Parameters**) |
| Sign-in to SQL Server, Azure SQL or a Fabric SQL analytics endpoint fails | The authentication method does not fit your account | Choose another method in **File > Options and settings > Options > Security > Authentication method** (see below) |
| "Windows authentication" is required | Windows integrated authentication is not available on Linux | Use SQL Server authentication or Microsoft Entra ID, if the server allows it |
| A server name cannot be resolved, or a connection times out | The server is on a network you are not on (VPN, private network) | Connect to the network, or use sample data |
| A source is "Not supported by Lumen" in **Data source settings** | The query uses a connector Lumen does not implement | See [Connector support](../reference/connector-support.md); use sample data for those tables |
| An M function is not known | The query uses an M function Lumen does not implement yet | See [M function support](../reference/m-function-support.md); report it |
| The report is connected live to a service model | There is no local model to refresh | Lumen cannot refresh it |
| *Expression.Error: The 'Size' column does not exist in the rowset.* on a table loaded from a **Folder** | A known issue: a table loaded with **Load** from the Folder connector keeps the preview's columns, and its first refresh fails (the table keeps the rows it was loaded with) | See [Connect to files](../connect-and-transform/connect-to-files.md) |
| *A cyclic reference was encountered during evaluation.* when you set up a REST source with **Page number parameter** or **Offset / limit parameters** paging | A known issue with those paging modes | Use **Next-page link in the response** when the API has one, or write the query yourself; see [Connect to web and APIs](../connect-and-transform/connect-to-web-and-apis.md) |
| Numbers or dates in text are read in the wrong format | **Locale for import** in Options has no effect in this version: queries use `en-US` unless they name a culture | Pass the culture in the query; see [Data types and locale](../connect-and-transform/data-types-and-locale.md) |

## Sign-in to SQL Server and Microsoft Fabric

Choose how Lumen signs in to SQL Server, Azure SQL and Fabric SQL analytics endpoints in
**File > Options and settings > Options > Security**:

| Authentication method | Use when |
|---|---|
| **Microsoft Entra ID — default credential chain** | You are signed in through one of the standard Azure credential sources on this computer (environment variables, Azure CLI, and others) |
| **Microsoft Entra ID — Azure CLI (az login)** | You signed in with `az login` |
| **Microsoft Entra ID — device code** | You sign in in a browser, possibly on another device, by entering a code that Lumen shows |
| **Microsoft Entra ID — browser sign-in** | You sign in in a browser window on this computer |
| **SQL Server authentication (asked per source)** | The server has SQL logins; Lumen asks for the user name and password per source |

**Tenant ID (optional)** restricts the sign-in to one Microsoft Entra tenant, which helps when your account belongs to
several.

## Saved credentials and privacy levels

**File > Options and settings > Data source settings** (also on the **Home** tab of the Power Query editor, and in the menu of **Home > Transform data**) lists
the data sources the open report uses, with how each authenticates and its privacy level. Double-click a source (or
select it and **Edit Permissions…**) to change its credentials and privacy level; **Clear Permissions** removes what
Lumen saved for it.

- Secrets are encrypted with your desktop's keyring (Secret Service / GNOME Keyring / KWallet) through Electron.
- If no keyring is available, Lumen keeps secrets in memory for the session only and asks again after a restart.
  It never writes them to disk in clear text.

## Refresh is slow

- Lumen runs queries itself. Steps that a database can do (filters, column selection, joins, sorting) are sent to
  the database when Lumen can fold them into the source query; steps it cannot fold run in Lumen after the data is
  downloaded. Large unfiltered tables take time to download.
- Incremental refresh policies in the model are applied where Lumen supports them.
- Cancel a refresh with **Cancel** in the Refresh dialog. In this version Cancel stops requests to SQL Server
  (including Azure SQL and Fabric) and web (HTTP) sources at once. Requests to PostgreSQL, MySQL, SQLite, DuckDB,
  Firestore and S3 sources keep running in the background until they finish.

The details of query folding and incremental refresh are in [Connect and transform data](../connect-and-transform/README.md).

## Built-in sample report

The sample report's tables are marked as sample data: their queries only declare the schema. A refresh keeps the
generated rows and reports them as "sample rows kept".

## Related content

- [Connect and transform data](../connect-and-transform/README.md)
- [Connector support](../reference/connector-support.md)
- [M function support](../reference/m-function-support.md)
- [Reports without data and sample data](../files-and-compatibility/reports-without-data-and-sample-data.md)
- [Frequently asked questions](faq.md)

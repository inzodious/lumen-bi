# Query folding

> **Applies to:** Analysts · Developers

*Query folding* means turning Power Query steps into the source's own query, so the source filters and trims the data before it is sent. This article explains which steps Lumen folds, for which connectors, and when folding stops.

## How folding works in Lumen

When a query navigates to a database table, for example `Source{[Schema="dbo",Item="Orders"]}[Data]`, Lumen does not read the rows yet. It first asks the source for the columns only (`TOP (0)` or `LIMIT 0`). Each following step that can be folded is merged into a pending request. The rows are read when a step cannot be folded, or when the query ends.

Folding stops at the first step that cannot be folded. From there on, every step runs in Lumen on the rows that were read. A non-foldable step never changes results; it only means more data is transferred.

## Steps that fold

| Step | Folds as | Condition |
|---|---|---|
| **Choose Columns**, **Remove Other Columns** (`Table.SelectColumns`) | column list | Columns exist and are named once; no `MissingField` option |
| **Remove Columns** (`Table.RemoveColumns`) | column list | At least one column remains |
| **Filter Rows** (`Table.SelectRows`) | `WHERE` | A simple `each` predicate (see below), and no earlier top-N or skip |
| **Sort** (`Table.Sort`) | `ORDER BY` | Sort by columns; no earlier top-N or skip. Earlier sort keys are kept as tie-breakers, like M's stable sort |
| **Remove Top Rows** (`Table.Skip`) | `OFFSET` | A whole number. For SQL Server sources, only after a folded sort (T-SQL needs an `ORDER BY` to skip rows) |
| **Keep Top Rows** (`Table.FirstN`) | `TOP` / `LIMIT` | A whole number |
| **Merge Queries** then **Expand** (`Table.NestedJoin` + `Table.ExpandTableColumn`) | one `SELECT … JOIN …` | Both tables come from the same server and database; the joined column is expanded right away; supported join kind (below) |

A predicate folds when it is built from:

- comparisons of a column with a constant (`=`, `<>`, `<`, `<=`, `>`, `>=`),
- `and`, `or`, `not`,
- `[Column] = null` and `[Column] <> null`,
- `List.Contains({…}, [Column])` with a constant list,
- `Text.StartsWith`, `Text.EndsWith` and `Text.Contains` with a constant.

Constants may be computed (`Date.AddDays(#date(2024, 1, 1), 30)`) or come from another step or query, such as a parameter; see privacy levels below. Like Power BI, folded text comparisons follow the server's collation (often case-insensitive), so a folded filter can match rows that M's case-sensitive comparison would not.

## Folding by connector

| Connector | Folds | Not folded |
|---|---|---|
| SQL Server, Azure SQL, Synapse, Fabric (`Sql.Database`) | All steps above | Predicates with values T-SQL cannot express (for example `time` literals) |
| PostgreSQL, DuckDB | All steps above, all join kinds | |
| MySQL | All steps above | Full outer merges |
| SQLite | All steps above | Right and full outer merges |
| Google Firestore | Field filters (`=`, `<`, `<=`, `>`, `>=`, `in`, `or`, `<> null`), **Keep Top Rows**, sort on fields the filter requires, of one value type | `<>` against a value, `= null`, `not (…)`, skip, other sorts |
| Files, folders, S3, lakehouse folders, Web, OData, GraphQL, REST, Enter data | Nothing | Everything runs in Lumen |

A native SQL statement (the **SQL statement** box, `[Query = "…"]`, or `Value.NativeQuery`) is sent as you wrote it; steps after it run in Lumen.

## Example: what PostgreSQL receives

This query (from Lumen's tests, `src/core/m/__tests__/connectors.test.ts`):

```powerquery
let
    Source = PostgreSQL.Database("pg", "shop"),
    t = Source{[Schema="public",Item="orders"]}[Data],
    f = Table.SelectRows(t, each [region] = "East" and [amount] >= 10),
    s = Table.Sort(f, {{"amount", Order.Descending}}),
    k = Table.Skip(s, 2),
    n = Table.FirstN(k, 10),
    c = Table.SelectColumns(n, {"id", "amount"})
in
    c
```

sends one statement to read the rows:

```sql
SELECT "id", "amount" FROM "public"."orders" WHERE ("region" = 'East' AND "amount" >= 10) ORDER BY "amount" DESC NULLS LAST LIMIT 10 OFFSET 2
```

`NULLS LAST` keeps M's ordering of nulls. When an added column comes first, folding stops there:

```powerquery
let
    t = PostgreSQL.Database("pg", "shop"){[Schema="public",Item="orders"]}[Data],
    a = Table.AddColumn(t, "x", each [id] * 2),
    f = Table.SelectRows(a, each [x] = 4)
in
    Table.SelectColumns(f, {"id"})
```

Here the source receives `SELECT * FROM "public"."orders"` and Lumen does the rest.

The same skip-and-top shape renders per dialect as:

| Dialect | `SELECT` with a column, a filter `x`, descending sort, skip 10, top 5 |
|---|---|
| PostgreSQL | `SELECT "a" FROM "s"."t" WHERE x ORDER BY "a" DESC NULLS LAST LIMIT 5 OFFSET 10` |
| MySQL | ``SELECT `a` FROM `s`.`t` WHERE x ORDER BY `a` DESC LIMIT 5 OFFSET 10`` |
| SQL Server | `SELECT [a] FROM [s].[t] WHERE x ORDER BY [a] DESC OFFSET 10 ROWS FETCH NEXT 5 ROWS ONLY` |

## Privacy levels and folding

A filter whose value comes from another step or query (a parameter, a list read from another source) is "computed". When the query combines sources whose [privacy levels](credentials-and-privacy.md) must not mix (one source **Private**, or **Organizational** with **Public**), Lumen does not send computed values to a source: those filters run in Lumen, and the refresh reports a privacy warning. Filters with literal constants still fold.

## Order of steps matters

Put foldable steps first: navigate, remove columns, filter, sort, keep top rows. Then add columns, change types, and so on. Changing a column's type (`Table.TransformColumnTypes`), adding a column, grouping, pivoting and most other transformations are not folded, and nothing after them is.

## Considerations and limitations

- **Verified with Lumen's tests, not against live servers, for this documentation.** The SQL statements shown are the expected outputs of the connector unit tests, which passed on the build documented here (`npx vitest run src/core/m/__tests__/connectors.test.ts`).
- Lumen cannot show you the native query: **View Native Query** is disabled in the Power Query editor.
- Folding is applied during refresh and preview alike.
- Merges fold only when the merged column is expanded in the very next step. A merge that is not expanded right away runs in Lumen.

## Differences from Power BI Desktop

- Power BI Desktop folds many more steps (type changes, added columns, grouping, and so on) for SQL sources. Lumen folds the steps listed above and runs everything else locally, so a query can read more rows in Lumen than in Power BI Desktop. The results are the same.
- Power BI Desktop's folding indicators on applied steps are not shown.

## Related content

- [Connector support](../reference/connector-support.md)
- [Connect to SQL Server and Microsoft Fabric](connect-to-sql-server-and-fabric.md)
- [Connect to PostgreSQL, MySQL and SQLite](connect-to-postgresql-mysql-sqlite.md)
- [Credentials and privacy](credentials-and-privacy.md)
- [The Power Query editor](power-query-editor.md)

# Create calculated columns

> **Applies to:** Creators · Analysts

A calculated column adds a column to a table whose value is computed by a DAX formula once per row and stored with the table. Use it for values you want to slice, filter or group by; use a measure for values that must react to filters. This article shows how to create calculated columns in Lumen and when they are computed.

## Prerequisites

- A report or semantic model open in Lumen, with data loaded (embedded, refreshed or sample data).

## Create a calculated column

1. Select the table in the **Data** pane. In the sample, select **Sales**.
2. Select **New column**. It is on the **Modeling** tab and the **Table tools** tab in Report view, on the **Home** tab in Table view and Model view, and on the **Column tools** tab when a column is selected. In Table view you can also right-click a column header and select **New column**.

   Lumen adds a column named `Column` to the table and puts the cursor in the formula bar after `Column = `.
3. Type a name and a formula, for example:

   ```dax
   Line Margin = Sales[SalesAmount] - Sales[Cost]
   ```

4. Press Enter to commit.

Lumen computes the column for every row, infers its data type from the values (whole number, decimal number, text, date, true/false) and, for a numeric column, sets its default summarization to **Sum** unless you chose another one. The column appears in the **Data** pane with a calculated-column icon, and in Table view as an extra column.

## Row context and related tables

A calculated column formula runs in a *row context*: a bare column reference such as `Sales[SalesAmount]` means "the value in the current row". To read a value from the one side of a relationship, use `RELATED`; to aggregate the many side, use `CALCULATE` (or a measure reference), which turns the current row into a filter (*context transition*).

This query defines the same kind of columns in a DAX query, so you can try them without changing the model:

```dax
DEFINE
    COLUMN Sales[Line Margin] = Sales[SalesAmount] - Sales[Cost]
    COLUMN Sales[Price Band] =
        SWITCH (
            TRUE (),
            Sales[UnitPrice] >= 1000, "High",
            Sales[UnitPrice] >= 100, "Medium",
            "Low"
        )
EVALUATE
SUMMARIZECOLUMNS (
    Sales[Price Band],
    "Lines", COUNTROWS ( Sales ),
    "Margin", SUM ( Sales[Line Margin] )
)
ORDER BY Sales[Price Band]
```

| Sales[Price Band] | [Lines] | [Margin] |
|---|---|---|
| High | 1158 | 1063259.36 |
| Low | 18203 | 1030921.28 |
| Medium | 3749 | 937953.07 |

`RELATED` follows a many-to-one relationship from the current row; `CALCULATE` around an aggregation filters the related fact rows of the current row:

```dax
DEFINE
    COLUMN Sales[Category] = RELATED ( Product[Category] )
    COLUMN Customer[Lifetime Sales] = CALCULATE ( SUM ( Sales[SalesAmount] ) )
EVALUATE
TOPN ( 3, SELECTCOLUMNS ( Customer, "Customer", Customer[Customer], "Lifetime Sales", Customer[Lifetime Sales] ), [Lifetime Sales], DESC )
ORDER BY [Lifetime Sales] DESC
EVALUATE
SUMMARIZECOLUMNS ( Sales[Category], "Lines", COUNTROWS ( Sales ) )
ORDER BY Sales[Category]
```

| [Customer] | [Lifetime Sales] |
|---|---|
| Blue Ridge Mobility Group | 111003.64 |
| Silver Creek Tours Co. | 95885.56 |
| Pinecrest Tours Ltd | 81618.68 |

| Sales[Category] | [Lines] |
|---|---|
| Accessories | 9635 |
| Bikes | 1193 |
| Clothing | 7454 |
| Components | 4828 |

Without `CALCULATE`, `SUM ( Sales[SalesAmount] )` in a Customer column would return the same grand total on every row. See [Evaluation context in Lumen](evaluation-context-in-lumen.md).

> [!NOTE]
> Columns defined with `DEFINE COLUMN` exist only while the query runs. To keep a column, create it with **New column**.

## When calculated columns are computed

Lumen computes calculated columns and calculated tables, in dependency order:

- when a report or model is opened (after its data is loaded),
- after a refresh,
- after you add or edit a calculated column, a calculated table or anything they depend on.

If a column cannot be computed (for example, its formula refers to a column that was removed), the error is reported for that column and, when the file contained stored values for it, those values are kept.

## Considerations and limitations

- Lumen recomputes calculated columns every time a model is opened. PBIP files store only their formulas, as Power BI does.
- The inferred data type follows the values the formula returns. To force a type, wrap the formula in a conversion such as `CONVERT ( …, INTEGER )` or `FORMAT`, or change **Data type** on **Column tools**.
- Computing a calculated column runs on the user interface thread; a formula that iterates a large table for every row (for example `COUNTROWS ( FILTER ( Sales, … ) )` in a Sales column) can make the window unresponsive for a while.

## Related content

- [Create measures](create-measures.md)
- [Create calculated tables](calculated-tables.md)
- [Evaluation context in Lumen](evaluation-context-in-lumen.md)
- [Table view](../model-data/table-view.md)
- [Column and table properties](../model-data/column-and-table-properties.md)

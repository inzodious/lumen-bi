# Evaluation context in Lumen

> **Applies to:** Analysts · Developers

Every DAX expression is evaluated in a context: the filters that are active (filter context) and, inside iterators and calculated columns, the current row (row context). This article explains how Lumen's engine applies filter context, row context, context transition and relationships, with queries you can run on the built-in sample to see each rule.

Lumen follows the semantics Microsoft documents for DAX. The behaviour described here is what the engine does and what its tests check; where it is known to differ from Power BI, [Known differences](known-differences-from-the-power-bi-engine.md) says so.

## Filter context

The filter context is the set of filters in effect when an expression is evaluated. In a visual it comes from the visual's own groups (one filter per row, column or data point), its filters, the page and report filters, slicers, cross-filtering from other visuals and row-level security. In a query, `SUMMARIZECOLUMNS` creates one filter context per group.

```dax
EVALUATE
SUMMARIZECOLUMNS (
    Product[Category],
    "Total Sales", [Total Sales],
    "Units", [Units]
)
ORDER BY [Total Sales] DESC
```

| Product[Category] | [Total Sales] | [Units] |
|---|---|---|
| Bikes | $2,710,885 | 1,708 |
| Accessories | $1,353,695 | 32,060 |
| Components | $1,233,453 | 9,487 |
| Clothing | $1,189,963 | 19,668 |

Each row evaluates `[Total Sales]` (`SUM ( Sales[SalesAmount] )`) with a filter on one category. The filter is on **Product**, yet it restricts **Sales**: filters propagate along relationships, from the one side to the many side (see [Relationships](#relationships-and-cross-filter-direction)).

Like Power BI, `SUMMARIZECOLUMNS` and visuals drop rows whose values are all blank, and only show combinations of groups that exist in the data (*auto-exist*).

### Changing the filter context: CALCULATE, ALL, ALLSELECTED, KEEPFILTERS

`CALCULATE` evaluates its first argument in a modified filter context. A filter argument on a column **replaces** the existing filter on that column, unless you wrap it in `KEEPFILTERS`, which **intersects** with it:

```dax
EVALUATE
SUMMARIZECOLUMNS (
    Product[Category],
    "Bikes (replace)", CALCULATE ( [Total Sales], Product[Category] = "Bikes" ),
    "Bikes (KEEPFILTERS)", CALCULATE ( [Total Sales], KEEPFILTERS ( Product[Category] = "Bikes" ) )
)
ORDER BY Product[Category]
```

| Product[Category] | [Bikes (replace)] | [Bikes (KEEPFILTERS)] |
|---|---|---|
| Accessories | 2710885.07 |  |
| Bikes | 2710885.07 | 2710885.07 |
| Clothing | 2710885.07 |  |
| Components | 2710885.07 |  |

`ALL` removes filters; `ALLSELECTED` removes the filters of the current visual (its rows and columns) but keeps the filters that come from outside it (slicers, page filters, a `CALCULATETABLE` around a query). The sample's `[% of Total Sales]` uses `ALLSELECTED ( Product )` and `[% of Grand Total]` uses `ALL ( Sales )`:

```dax
EVALUATE
CALCULATETABLE (
    SUMMARIZECOLUMNS (
        Product[Category],
        "Total Sales", [Total Sales],
        "% of Total Sales", [% of Total Sales],
        "% of Grand Total", [% of Grand Total]
    ),
    Product[Category] IN { "Bikes", "Clothing" }
)
ORDER BY Product[Category]
```

| Product[Category] | [Total Sales] | [% of Total Sales] | [% of Grand Total] |
|---|---|---|---|
| Bikes | $2,710,885 | 69.5% | 41.8% |
| Clothing | $1,189,963 | 30.5% | 18.3% |

The outer filter keeps two categories. `ALLSELECTED` restores that outer filter, so the two shares add up to 100%; `ALL` ignores it and divides by all sales.

Lumen implements `ALLSELECTED` with *shadow filter contexts*, as Analysis Services does: inside an iterator over a visual's column, `ALLSELECTED` restores the iterated values, and a column the iteration does not cover keeps the outer selection.

## Row context

A row context exists inside an iterator (`SUMX`, `FILTER`, `ADDCOLUMNS`, …) and in a calculated column. In a row context, a column reference returns the value of the current row:

```dax
EVALUATE
TOPN (
    5,
    ADDCOLUMNS (
        Product,
        "Unit Margin", Product[List Price] - Product[Standard Cost]
    ),
    [Unit Margin], DESC
)
ORDER BY [Unit Margin] DESC
```

| Product[Product] | Product[Category] | Product[List Price] | Product[Standard Cost] | [Unit Margin] |
|---|---|---|---|---|
| Velocity Aero | Bikes | $3,499.00 | $2,043.38 | 1455.62 |
| Volt Trail | Bikes | $3,999.00 | $2,583.18 | 1415.82 |
| Ridgeline Pro | Bikes | $2,899.00 | $1,787.69 | 1111.31 |
| Volt City - White | Bikes | $2,299.00 | $1,358.15 | 940.85 |
| Velocity 600 - White | Bikes | $2,199.00 | $1,355.10 | 843.9 |

(The query returns every Product column; the table shows the relevant ones.)

A row context does **not** filter anything by itself. That is why `SUM` inside an iterator over categories returns the grand total until the row context is turned into a filter.

## Context transition

`CALCULATE` (and `CALCULATETABLE`) turns every active row context into an equivalent filter context: *context transition*. A measure reference always does this, because Power BI wraps every measure in an implicit `CALCULATE`.

```dax
EVALUATE
ADDCOLUMNS (
    VALUES ( Product[Category] ),
    "SUM without CALCULATE", SUM ( Sales[SalesAmount] ),
    "SUM with CALCULATE", CALCULATE ( SUM ( Sales[SalesAmount] ) ),
    "Measure reference", [Total Sales]
)
ORDER BY Product[Category]
```

| Product[Category] | [SUM without CALCULATE] | [SUM with CALCULATE] | [Measure reference] |
|---|---|---|---|
| Accessories | 6487996.03 | 1353695.26 | $1,353,695 |
| Bikes | 6487996.03 | 2710885.07 | $2,710,885 |
| Clothing | 6487996.03 | 1189963.11 | $1,189,963 |
| Components | 6487996.03 | 1233452.59 | $1,233,453 |

In Lumen, as in Power BI, context transition filters the *expanded* table of the current row: a row of **Sales** also filters the columns of the tables on the one side of its relationships (**Product**, **Customer**, **Date**, …).

## Relationships and cross-filter direction

A filter on a table propagates to the tables related to it, following each relationship's cross-filter direction:

| Relationship | Default direction | Lumen behaviour |
|---|---|---|
| Many-to-one | Single: the one side filters the many side | As Power BI. A filter on **Product** filters **Sales**; a filter on **Sales** does not filter **Product**. |
| Many-to-one, **Both** | Both directions | Filters also flow from the many side to the one side. |
| One-to-one | Both directions | As Power BI. |
| Many-to-many | As set on the relationship | Filters by key values in the relationship's direction (a "limited" relationship). |

Chains of relationships propagate further: the sample's **Region** filters **Customer**, which filters **Sales** (a snowflake):

```dax
EVALUATE
SUMMARIZECOLUMNS (
    Region[Region],
    "Total Sales", [Total Sales],
    "Customers", [Customers]
)
ORDER BY Region[Region]
```

| Region[Region] | [Total Sales] | [Customers] |
|---|---|---|
| Asia Pacific | $1,389,647 | 250 |
| Europe | $2,354,887 | 489 |
| North America | $2,743,462 | 510 |

With single-direction relationships, a filter on **Product** reaches **Sales** but not **Customer**, so counting rows of **Customer** per category gives the full count everywhere. `CROSSFILTER ( …, BOTH )` makes the filter flow from **Sales** to **Customer** for one calculation:

```dax
EVALUATE
SUMMARIZECOLUMNS (
    Product[Category],
    "Rows in Customer", COUNTROWS ( Customer ),
    "Customers (measure)", [Customers],
    "Rows in Customer, both directions",
        CALCULATE (
            COUNTROWS ( Customer ),
            CROSSFILTER ( Sales[CustomerKey], Customer[CustomerKey], BOTH )
        )
)
ORDER BY Product[Category]
```

| Product[Category] | [Rows in Customer] | [Customers (measure)] | [Rows in Customer, both directions] |
|---|---|---|---|
| Accessories | 1400 | 1,166 | 1166 |
| Bikes | 1400 | 571 | 571 |
| Clothing | 1400 | 1,107 | 1107 |
| Components | 1400 | 1,010 | 1010 |

`[Customers]` is `DISTINCTCOUNT ( Sales[CustomerKey] )`, which counts on the fact table and needs no bidirectional filter.

Other relationship rules the engine implements:

- **Inactive relationships** do not propagate filters unless a calculation activates them with `USERELATIONSHIP`. `CROSSFILTER` can also set a relationship's direction to `NONE` for one calculation.
- **Ambiguous paths**: as in Power BI, a model should have only one active path between two tables. The sample relates **Store** to its own country columns instead of to **Region** for this reason.
- **Blank row**: when the many side has keys with no match on the one side, the one side gets a virtual blank row. `VALUES` and `ALL` include it; `DISTINCT`, `ALLNOBLANKROW` and table scans do not. The sample has no unmatched keys, so `COUNTROWS ( VALUES ( Product[Category] ) )` and `COUNTROWS ( DISTINCT ( Product[Category] ) )` both return 4.
- **Key columns of different types** (text on one side, numbers on the other): Lumen uses the key matches stored in a PBIX file when they are available, and otherwise converts the text side the way `VALUE` does. See [Create and edit relationships](../model-data/create-and-edit-relationships.md).
- **Row-level security** filters propagate through relationships like any other filter, from the role's table to related tables.

## Variables

`VAR` evaluates its expression once, in the context where it is declared, and the value does not change when the filter context changes later. Inside one `VAR` block, each declaration sees the variables declared before it.

## Considerations and limitations

- These examples run in DAX query view. In a visual, the same measures also get the visual's filters, slicers and cross-filters.
- The engine's semantics are checked by its tests and by comparison with values recomputed from Microsoft's sample files; they have not been compared with Power BI Desktop directly. See [DAX in Lumen](dax-in-lumen-overview.md#how-accuracy-is-checked).

## Related content

- [DAX query view](dax-query-view.md)
- [Create and edit relationships](../model-data/create-and-edit-relationships.md)
- [Time intelligence](time-intelligence.md)
- [Known differences from the Power BI engine](known-differences-from-the-power-bi-engine.md)
- [Row-level security](../model-data/row-level-security.md)
- [Filter context on Microsoft Learn](https://learn.microsoft.com/dax/dax-overview#context)

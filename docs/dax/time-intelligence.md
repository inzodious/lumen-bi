# Time intelligence

> **Applies to:** Analysts

Time intelligence functions shift or extend the dates in the filter context: year to date, same period last year, the previous month, a rolling three months. This article explains what Lumen needs to evaluate them correctly, which functions exist, and shows the sample's time intelligence measures with their results.

## Prerequisites: a date table

Time intelligence works on a column of dates. For results that match Power BI, use a date table that:

- has one row per day, with no gaps, covering every year in your data;
- is related to the fact table on its date column (many-to-one, from the fact's date to the date table);
- is marked as a date table (**Table tools > Mark as date table**, or **Modeling > Mark as date table**), or at least has its date column on the one side of a relationship.

The sample's **Date** table meets all three: one row per day from 1/1/2023 to 12/31/2025, related to **Sales[OrderDate]**, and marked as a date table. See [Date tables](../model-data/date-tables.md).

### Why marking matters

When a time intelligence function (or any filter) sets a filter on the date table's key, Lumen replaces every other filter on the date table, as Power BI does. That is what lets `[Sales LY]` return last year's value on a row filtered by `'Date'[Year] = 2025`: the filter on **Year** is removed when `SAMEPERIODLASTYEAR` filters **Date[Date]**. Lumen applies this rule when the filtered date column is the key of a table marked as a date table (or its only date column), or is on the one side of a relationship.

## Year to date, last year and growth

The sample's measures:

```dax
Sales YTD = TOTALYTD ( [Total Sales], 'Date'[Date] )
Sales LY = CALCULATE ( [Total Sales], SAMEPERIODLASTYEAR ( 'Date'[Date] ) )
Sales YoY % =
    VAR _ly = [Sales LY]
    RETURN
        IF ( NOT ISBLANK ( _ly ), DIVIDE ( [Total Sales] - _ly, _ly ) )
```

By month of 2025:

```dax
EVALUATE
CALCULATETABLE (
    SUMMARIZECOLUMNS (
        'Date'[Month Number],
        'Date'[Month Short],
        "Total Sales", [Total Sales],
        "Sales YTD", [Sales YTD],
        "Sales LY", [Sales LY],
        "Sales YoY %", [Sales YoY %]
    ),
    'Date'[Year] = 2025
)
ORDER BY 'Date'[Month Number]
```

| Date[Month Number] | Date[Month Short] | [Total Sales] | [Sales YTD] | [Sales LY] | [Sales YoY %] |
|---|---|---|---|---|---|
| 1 | Jan | $147,670 | $147,670 | $97,237 | 51.9% |
| 2 | Feb | $133,692 | $281,362 | $102,388 | 30.6% |
| 3 | Mar | $201,244 | $482,606 | $167,005 | 20.5% |
| 4 | Apr | $253,824 | $736,430 | $167,288 | 51.7% |
| 5 | May | $259,600 | $996,030 | $218,285 | 18.9% |
| 6 | Jun | $305,081 | $1,301,111 | $231,000 | 32.1% |
| 7 | Jul | $224,972 | $1,526,083 | $234,174 | -3.9% |
| 8 | Aug | $259,245 | $1,785,328 | $196,660 | 31.8% |
| 9 | Sep | $186,591 | $1,971,919 | $155,414 | 20.1% |
| 10 | Oct | $185,618 | $2,157,537 | $160,177 | 15.9% |
| 11 | Nov | $255,394 | $2,412,931 | $215,891 | 18.3% |
| 12 | Dec | $253,831 | $2,666,761 | $235,645 | 7.7% |

`[Sales LY]` for each month of 2025 equals `[Total Sales]` of the same month of 2024 (compare the next section).

## Quarter to date, previous month, parallel period

```dax
DEFINE
    MEASURE _Measures[Sales QTD] = TOTALQTD ( [Total Sales], 'Date'[Date] )
    MEASURE _Measures[Sales PM] = CALCULATE ( [Total Sales], DATEADD ( 'Date'[Date], -1, MONTH ) )
    MEASURE _Measures[Sales PY (PARALLELPERIOD)] = CALCULATE ( [Total Sales], PARALLELPERIOD ( 'Date'[Date], -1, YEAR ) )
EVALUATE
CALCULATETABLE (
    SUMMARIZECOLUMNS (
        'Date'[Month Number],
        'Date'[Month Short],
        "Total Sales", [Total Sales],
        "Sales QTD", [Sales QTD],
        "Sales PM", [Sales PM],
        "Sales PY (PARALLELPERIOD)", [Sales PY (PARALLELPERIOD)]
    ),
    'Date'[Year] = 2025,
    'Date'[Quarter] IN { "Q1", "Q2" }
)
ORDER BY 'Date'[Month Number]
```

| Date[Month Number] | Date[Month Short] | [Total Sales] | [Sales QTD] | [Sales PM] | [Sales PY (PARALLELPERIOD)] |
|---|---|---|---|---|---|
| 1 | Jan | $147,670 | 147670.14 | 235645.29 | 2181164.97 |
| 2 | Feb | $133,692 | 281362.11 | 147670.14 | 2181164.97 |
| 3 | Mar | $201,244 | 482606.17 | 133691.97 | 2181164.97 |
| 4 | Apr | $253,824 | 253823.76 | 201244.06 | 2181164.97 |
| 5 | May | $259,600 | 513423.49 | 253823.76 | 2181164.97 |
| 6 | Jun | $305,081 | 818504.86 | 259599.73 | 2181164.97 |

- `TOTALQTD` restarts in April, the first month of the second quarter.
- `DATEADD ( …, -1, MONTH )` in January 2025 returns December 2024.
- `PARALLELPERIOD ( …, -1, YEAR )` returns the **whole** previous year whatever the month, unlike `SAMEPERIODLASTYEAR`.

The query-defined measures have no format string, so their values are unformatted.

## Rolling periods and month to date

```dax
Sales Rolling 3M =
CALCULATE (
    [Total Sales],
    DATESINPERIOD ( 'Date'[Date], MAX ( 'Date'[Date] ), -3, MONTH )
)
```

```dax
EVALUATE
CALCULATETABLE (
    SUMMARIZECOLUMNS (
        'Date'[Month Number],
        'Date'[Month Short],
        "Total Sales", [Total Sales],
        "Sales Rolling 3M", [Sales Rolling 3M],
        "Sales MTD", [Sales MTD]
    ),
    'Date'[Year] = 2024
)
ORDER BY 'Date'[Month Number]
```

| Date[Month Number] | Date[Month Short] | [Total Sales] | [Sales Rolling 3M] | [Sales MTD] |
|---|---|---|---|---|
| 1 | Jan | $97,237 | $447,851 | $97,237 |
| 2 | Feb | $102,388 | $392,886 | $102,388 |
| 3 | Mar | $167,005 | $366,630 | $167,005 |
| 4 | Apr | $167,288 | $437,650 | $167,288 |
| 5 | May | $218,285 | $552,578 | $218,285 |
| 6 | Jun | $231,000 | $619,203 | $231,000 |
| 7 | Jul | $234,174 | $683,459 | $234,174 |
| 8 | Aug | $196,660 | $661,834 | $196,660 |
| 9 | Sep | $155,414 | $586,247 | $155,414 |
| 10 | Oct | $160,177 | $512,251 | $160,177 |
| 11 | Nov | $215,891 | $536,047 | $215,891 |
| 12 | Dec | $235,645 | $611,714 | $235,645 |

January 2024's rolling three months includes November and December 2023. `[Sales MTD]` equals `[Total Sales]` on a monthly row because the month is complete; it differs on daily rows.

## Fiscal years

`TOTALYTD`, `DATESYTD`, `PREVIOUSYEAR`, `NEXTYEAR`, `STARTOFYEAR`, `ENDOFYEAR` and `OPENINGBALANCEYEAR` / `CLOSINGBALANCEYEAR` take an optional year-end date as text. A fiscal year ending on June 30:

```dax
EVALUATE
CALCULATETABLE (
    SUMMARIZECOLUMNS (
        'Date'[Year Month Number],
        'Date'[Year Month],
        "Total Sales", [Total Sales],
        "Calendar YTD", TOTALYTD ( [Total Sales], 'Date'[Date] ),
        "Fiscal YTD (June 30)", TOTALYTD ( [Total Sales], 'Date'[Date], "6/30" )
    ),
    'Date'[Year Month Number] >= 202505,
    'Date'[Year Month Number] <= 202508
)
ORDER BY 'Date'[Year Month Number]
```

| Date[Year Month Number] | Date[Year Month] | [Total Sales] | [Calendar YTD] | [Fiscal YTD (June 30)] |
|---|---|---|---|---|
| 202505 | May 2025 | $259,600 | 996029.66 | 2193990.86 |
| 202506 | Jun 2025 | $305,081 | 1301111.03 | 2499072.23 |
| 202507 | Jul 2025 | $224,972 | 1526082.99 | 224971.96 |
| 202508 | Aug 2025 | $259,245 | 1785328.04 | 484217.01 |

The fiscal year to date restarts in July. The year-end text is read in en-US order (month/day); `"30/6"` is also accepted because 30 cannot be a month. Lumen uses only the month of the year-end date, so a fiscal year always ends on the last day of that month.

## Period boundaries

Table functions return the dates of a period, which you can count or aggregate. For February 2024 (a leap year):

```dax
EVALUATE
CALCULATETABLE (
    ROW (
        "First date", FIRSTDATE ( 'Date'[Date] ),
        "Last date", LASTDATE ( 'Date'[Date] ),
        "Days in DATESYTD", COUNTROWS ( DATESYTD ( 'Date'[Date] ) ),
        "Days in SAMEPERIODLASTYEAR", COUNTROWS ( SAMEPERIODLASTYEAR ( 'Date'[Date] ) ),
        "End of quarter", ENDOFQUARTER ( 'Date'[Date] )
    ),
    'Date'[Year Month Number] = 202402
)
```

| [First date] | [Last date] | [Days in DATESYTD] | [Days in SAMEPERIODLASTYEAR] | [End of quarter] |
|---|---|---|---|---|
| 2/1/2024 | 2/29/2024 | 60 | 28 | 3/31/2024 |

`SAMEPERIODLASTYEAR` of February 2024 is February 2023, which has 28 days.

## Supported functions

Lumen implements the classic time intelligence functions that work on a date column: `DATEADD`, `DATESBETWEEN`, `DATESINPERIOD`, `DATESMTD`, `DATESQTD`, `DATESYTD`, `ENDOFMONTH`, `ENDOFQUARTER`, `ENDOFYEAR`, `FIRSTDATE`, `FIRSTNONBLANK`, `FIRSTNONBLANKVALUE`, `LASTDATE`, `LASTNONBLANK`, `LASTNONBLANKVALUE`, `NEXTDAY`, `NEXTMONTH`, `NEXTQUARTER`, `NEXTYEAR`, `OPENINGBALANCEMONTH` / `QUARTER` / `YEAR`, `CLOSINGBALANCEMONTH` / `QUARTER` / `YEAR`, `PARALLELPERIOD`, `PREVIOUSDAY`, `PREVIOUSMONTH`, `PREVIOUSQUARTER`, `PREVIOUSYEAR`, `SAMEPERIODLASTYEAR`, `STARTOFMONTH`, `STARTOFQUARTER`, `STARTOFYEAR`, `TOTALMTD`, `TOTALQTD` and `TOTALYTD`. The [time intelligence function list](../reference/dax-functions/time-intelligence.md) is generated from the engine.

## Considerations and limitations

- **Calendar-based time intelligence is not implemented.** Power BI's newer calendars (defined on the model) and the week functions that need them (`DATESWTD`, `TOTALWTD`, `STARTOFWEEK`, `ENDOFWEEK`, `PREVIOUSWEEK`, `NEXTWEEK`, `OPENINGBALANCEWEEK`, `CLOSINGBALANCEWEEK`) fail with *The function '…' is not supported by this engine*. Build week logic with columns such as **Week of Year** and `CALCULATE` filters instead.
- **Auto date/time.** Models saved by Power BI with auto date/time tables (`'Sales'[OrderDate].[Year]` and the hidden `LocalDateTable_…` tables) are read and evaluated. Lumen does not create those tables for new date columns.
- Dates are handled as days: a date-time value keeps its time part in results, but time intelligence functions compare by day.
- A date table with gaps, or one that does not cover a year completely, gives the same partial results as in Power BI.

## Related content

- [Date tables](../model-data/date-tables.md)
- [Evaluation context in Lumen](evaluation-context-in-lumen.md)
- [Quick measures](quick-measures.md)
- [DAX time intelligence function list](../reference/dax-functions/time-intelligence.md)
- [Time intelligence on Microsoft Learn](https://learn.microsoft.com/dax/time-intelligence-functions-dax)

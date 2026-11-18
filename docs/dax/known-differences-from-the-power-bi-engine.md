# Known differences from the Power BI engine

> **Applies to:** Analysts · Developers

This reference lists every behaviour of Lumen's DAX engine and DAX tools that is known to differ from Power BI Desktop. Use it when a number in Lumen does not match Power BI, or before you move a model between the two. It is collected from the engine's code, its tests and queries run on the built-in sample; where something is approximated, the code says so too.

Not listed here means "no known difference", not "verified identical": the engine has not been compared with Power BI Desktop directly. See [How accuracy is checked](dax-in-lumen-overview.md#how-accuracy-is-checked).

## Functions

| Area | Lumen | Power BI | What to do |
|---|---|---|---|
| Missing functions | 163 of the 460 functions in Microsoft's reference are not implemented: all financial and INFO functions, the probability distributions and `LINEST`, the week-based time intelligence functions, `TOCSV`, `TOJSON`, `EXTERNALMEASURE`, `COLUMNSTATISTICS` and a few others. A formula that calls one fails with *The function 'NAME' is not supported by this engine*. | Implemented | Check the [function support reference](../reference/dax-function-support.md) |
| `KMEANSCLUSTERING` (Power BI clustering) | Always an error | Computes clusters | None in Lumen |
| `FORMAT` with a locale | The locale argument is ignored; en-US formatting | Formats for the locale | Format with explicit patterns |
| `USERCULTURE` | Always `en-US` | The user's culture | |
| `USERPRINCIPALNAME`, `USERNAME`, `USEROBJECTID`, `CUSTOMDATA` | `user@localhost`, `LOCAL\user`, an all-zero GUID, blank | The signed-in user | Row-level security rules based on these cannot be tested with **View as**; test them in Power BI |
| `EVALUATEANDLOG` | Returns its value; logs nothing | Logs to a trace | |
| `APPROXIMATEDISTINCTCOUNT` | Exact distinct count | May return an approximation | |
| `CONVERT ( …, CURRENCY )` | Not rounded: `CONVERT ( 1.23456, CURRENCY )` returns 1.23456 | Fixed decimal, four places: 1.2346 | Round explicitly with `ROUND ( …, 4 )` |
| Fiscal year end (`TOTALYTD ( …, "6/30" )` and similar) | Only the month is used; the year ends on the last day of that month | Uses the given date | Use month-end year ends |
| Lumen extensions | `ATAN2`, `CHAR`, `CLEAN`, `CODE`, `CONCAT`, `DATEFROMPARTS`, `DISTINCTCOUNTX`, `LTRIM`, `RTRIM`, `XOR` and the Excel names `STDEV`, `STDEVA`, `VAR`, `VARA` are accepted | Not in Microsoft's reference; not expected to work | Do not use them in models shared with Power BI |

## Numbers, text and dates

| Area | Lumen | Power BI |
|---|---|---|
| Numeric storage | Every number (whole number, decimal number, fixed decimal) is a 64-bit floating-point value. Whole numbers beyond 2^53 lose precision. | Whole numbers are 64-bit integers; fixed decimal (currency) is exact to four decimal places |
| Fixed decimal arithmetic | Floating-point: sums of currency values can differ in the last decimal places | Exact decimal arithmetic |
| Format strings | Interpreted with en-US conventions (decimal point, thousands separator, month and day names) | The model's or user's culture |

## Queries and tools

| Area | Lumen | Power BI |
|---|---|---|
| Visual query time | Stopped after 15 seconds; the visual shows partial results and a warning | Runs to completion (or the service's own limits) |
| DAX query view time | No limit and no cancel; the window does not respond while a query runs | Can be cancelled |
| DAX query view and row-level security | Not applied: queries see every row even while **View as** is active (visuals are filtered) | Applied |
| `DEFINE TABLE` in a query | The table can be evaluated and used as a table expression, but `'Table'[Column]` references to it fail with *Cannot find table* | Columns can be referenced |
| DAX query view extras | No "Update model with changes", no Copilot | Available |
| Measures defined in a query | Never written to the model | Can be added with "Update model" |
| Performance analyzer | Times Lumen's in-process engine and renderer; the **DAX query** / **Visual display** / **Other** split is an approximation; no network or service time | Times Analysis Services queries and rendering |

## Visual calculations

| Area | Lumen | Power BI |
|---|---|---|
| Authoring | Evaluated and shown; cannot be created or edited | Created and edited in the visual |
| Small multiples with visual calculations (`ROWPAGES` axis) | Error | Supported |
| Order along an axis | Ascending order of the group values (or their sort-by column) | Not verified whether it follows the visual's sort |
| `IsDM<n>Total` names in the copied query | Numbered by the level's position among the visual's columns | Numbered by Power BI's internal projection index (names only; results are the same) |

## Relationships

| Area | Lumen | Power BI |
|---|---|---|
| Key columns of different data types (text on one side, number on the other) | Uses the key matches stored in a PBIX file when present; otherwise converts the text side like `VALUE` (trimmed, decimal and exponent notation) | Uses its own conversion when the data is processed |

## DAX editor

| Area | Lumen |
|---|---|
| Autocomplete | Offers 87 functions the engine does not implement (they are in the editor's catalog of Microsoft's functions); see the [list](../reference/dax-function-support.md#autocomplete-entries-without-an-implementation) |
| User-defined functions | The error check underlines `DEFINE FUNCTION` type hints and calls to user-defined functions although they run; autocomplete does not offer them |
| Live value | A Lumen addition, without a Power BI equivalent; it ignores the visual's own filters |

## Not supported

- Calendar-based time intelligence (calendars on the model).
- Authoring model user-defined functions and visual calculations: both are evaluated when present but cannot be created or edited in Lumen; see [User-defined functions](user-defined-functions.md) and [Visual calculations](visual-calculations.md).
- DirectQuery at query time: the engine evaluates every query in memory over the loaded data (embedded, refreshed or sample data); it never sends a query to the data source while you use a report.

## Related content

- [DAX in Lumen](dax-in-lumen-overview.md)
- [DAX function support](../reference/dax-function-support.md)
- [Troubleshoot a measure](troubleshoot-a-measure.md)
- [Evaluation context in Lumen](evaluation-context-in-lumen.md)
- [Files and compatibility](../files-and-compatibility/README.md)

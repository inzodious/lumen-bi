# Code visual API reference

> **Applies to:** Creators · Developers

This reference lists everything the code of a [code visual](../visuals/code-visual.md) can use: the HTML template
language, the CSS variables and their naming rule, the declarative attributes for selection and drill, the JSX props,
the limits, and a summary of the message protocol between the visual and the report. For a guided introduction, see
[Use the code visual](../create-reports/code-visual.md).

## Three layers

A code visual has up to three layers of code. Each is optional; most visuals need only the first two.

| Layer | Editor tab | What it does |
|---|---|---|
| HTML template | **HTML** | Markup with `{{ }}` placeholders filled from the visual's data. No JavaScript. |
| Stylesheet | **CSS** | Plain CSS. The data is also available as CSS custom properties (variables). |
| Component | **JSX** | A React component, for logic and state. When present, it renders the visual; the template's output is passed to it as the `html` prop. |

All three run in a sandbox with no network access and no access to the app (see [Limits](#limits)).

## Template language

The template language is a subset of Handlebars, evaluated by Lumen (no JavaScript runs in a template). Every value
is HTML-escaped; triple braces (`{{{ }}}`, unescaped output) are refused.

### Output

| Syntax | Output |
|---|---|
| `{{Total Sales}}` | The field's value formatted with its format string (the formatter native visuals use). A name with spaces needs no quotes. |
| `{{raw Total Sales}}` | The unformatted value (numbers in full precision, dates as ISO text). |
| `{{[Total Sales]}}` | Bracket form of a name. Use it inside helper arguments when the name could be read as two arguments. |
| `{{totalSales}}` | The same field by its JavaScript identifier (see [Naming rule](#naming-rule)). |
| `{{measure1}}`, `{{measureName1}}` | The first measure of the **Values** well at the grand total, and its display name (also `measure2`, `measureName2`, …). |
| `{{this}}`, `{{../name}}`, `{{@root.name}}`, `{{drill.levelName}}` | The current context, the enclosing context, the root, a dotted path. |
| `{{! comment }}`, `{{!-- comment --}}` | Nothing. |

A mustache whose first word is not a helper is read as one name: `{{Total Sales}}` is the field "Total Sales". In
helper arguments, consecutive words are read as one name when such a name exists (`{{raw Total Sales}}`,
`{{format Total Sales "0.0,,M"}}`), and as separate arguments otherwise.

A name that resolves to nothing outputs nothing; the editor lists it as a warning with its line and column.

### Blocks

| Block | Meaning |
|---|---|
| `{{#each rows}} … {{else}} … {{/each}}` | Repeats for every row; the `{{else}}` part when there are none. Inside: `@index` (0-based), `@number` (1-based), `@first`, `@last`, and the row's fields. |
| `{{#if cond}} … {{else if other}} … {{else}} … {{/if}}` | Conditional. Blank, `0`, `false`, empty text and empty lists are false. |
| `{{#unless cond}} … {{/unless}}` | The opposite of `#if`. |
| `{{#with drill}} … {{/with}}` | Changes the context to a value. |

A condition can be a helper call in parentheses, `{{#if (gt value1 1000)}}`, or one infix comparison,
`{{#if [Margin %] > 0.4}}` (`==`, `!=`, `>`, `>=`, `<`, `<=`).

### Rows in `{{#each rows}}`

Inside `{{#each rows}}`, the **first element of each iteration** receives the row's attributes and CSS variables:

```html
{{#each rows}}
<li class="row" data-select>{{category}} {{value1}}</li>
{{/each}}
```

becomes, for the first row, `<li class="row" data-select data-row="0" data-depth="0" style="--value:2710885;--pct-of-max:1;…">`.
A `style` attribute you wrote is kept after the variables.

| Name in a row | Value |
|---|---|
| Field names, JavaScript identifiers | The row's cells (formatted on output). |
| `category` | The cell of the innermost **Rows** field of the row. |
| `value1`, `value2`, … | The row's measures, in the order of the **Values** well. |
| `label` | The row's grouping values, formatted, joined with a space. |
| `selected`, `highlighted` | This visual's selection; the cross-highlight from another visual (`highlighted` is blank when no highlight is active). |
| `depth`, `parentKeys`, `canDrill` | Nesting when a hierarchy is expanded; whether a lower level exists. |

### Root names

| Name | Value |
|---|---|
| `rows`, `columns` | The rows and the field descriptions. |
| `measure1` … , `measureName1` … , every value field by name | The measures at the grand total (with all grouping removed). |
| `categoryName` | The name of the innermost **Rows** field shown. |
| `rowCount`, `truncated`, `rowLimit` | Number of rows, whether the row limit cut them, the limit. |
| `hasSelection`, `hasHighlight` | This visual has a selection; another visual cross-highlights it. |
| `drill` | `level`, `levelName`, `levels`, `path`, `breadcrumb`, `canDrillDown`, `canDrillUp`, `drillMode`. |
| `level`, `breadcrumb` | Shortcuts for `drill.level` and `drill.breadcrumb` ("Bikes > Road Bikes"). |
| `params` | The parameters (see [Parameters](#parameters)). |
| `theme` | Not in the template context; use the CSS variables. |

### Helpers

| Helper | Result |
|---|---|
| `format v "fmt"` | `v` formatted with a .NET format string; without `"fmt"`, the field's own format. |
| `raw v` | The unformatted value. |
| `percent v [decimals]`, `number v [decimals]` | `0.4567` → `46%`; `1234.5` → `1,235`. |
| `sum`, `min`, `max`, `avg`, `count` | Over the rows: `{{sum "Total Sales"}}`, `{{max rows "Total Sales"}}`, `{{count rows}}`. |
| `pctOfMax v "Field"` | `v` divided by the largest absolute value of the field over the rows. |
| `points ["Field"] [width] [height]`, `areaPoints …` | SVG `points` for a sparkline of a field over the rows (default: the first measure, 100 × 30). |
| `eq`, `ne`, `gt`, `gte`, `lt`, `lte`, `and`, `or`, `not` | Comparisons and logic (cells compare by their raw values). |
| `add`, `sub`, `mul`, `div`, `mod`, `round v [d]`, `abs`, `floor`, `ceil`, `clamp v lo hi` | Arithmetic. `div` by zero is blank. |
| `default a b`, `ifThen c a b`, `concat …`, `lower`, `upper`, `len` | Text and choice. |
| `color n` | The theme's data colour n (1-based). |
| `resource "name"` | A registered image of the report as a `data:` URI, for `<img src>` or CSS. |
| `json v` | The value as JSON text (escaped). |

Template errors (an unclosed block, an unknown helper) are shown in the visual and in the editor with their line and
column.

## CSS variables

### Naming rule

Field and parameter names become CSS identifiers and JavaScript identifiers by one rule:

| Step | CSS (`cssName`) | JavaScript (`jsName`) |
|---|---|---|
| Symbols spelled out | `%` → `pct`, `#` → `num`, `&` → `and`, `+` → `plus` | same |
| Accents removed, camelCase split | `Café` → `cafe`, `TotalSales` → `total sales` | same |
| Words joined | lower case with `-`: `total-sales` | camelCase: `totalSales` |
| Leading digit | `f-` prefix: `2024 Target` → `f-2024-target` | `f` prefix: `f2024Target` |
| Collisions | `-2`, `-3`, … in field order | `2`, `3`, … |

Examples: "Total Sales" → `--total-sales` / `totalSales`; "Margin %" → `--margin-pct` / `marginPct`. Names that would
clash with the variables below (`value`, `index`, `width`, …) also get a number. The editor's **Data** tab lists the
names of every bound field.

### On the root

The visual's root element (`#lumen-root`) carries:

| Variable | Value |
|---|---|
| `--<field>` | Each measure at the grand total, unformatted: `--total-sales: 6487996` (usable in `calc()`). |
| `--<field>-text` | The same value formatted, as a CSS string for `content:`: `--total-sales-text: "$6,487,996"`. |
| `--<field>-highlight`, `--<field>-highlight-text` | The value under another visual's cross-highlight, while one is active. |
| `--width`, `--height` | The visual's size in px (they follow resizing). |
| `--level`, `--row-count`, `--has-highlight`, `--has-selection` | Drill level (0-based), number of rows, `1` / `0` flags. |
| `--theme-color-1` … `--theme-color-N` | The theme's data colours. |
| `--theme-foreground`, `--theme-foreground-secondary`, `--theme-foreground-tertiary` | Text colours. |
| `--theme-background`, `--theme-background-light`, `--theme-background-neutral` | Background colours. |
| `--theme-good`, `--theme-neutral`, `--theme-bad`, `--theme-accent`, `--theme-hyperlink` | Sentiment, table accent, link colours. |
| `--theme-font`, `--theme-<class>-size`, `--theme-<class>-color`, `--theme-<class>-font` | The label font, and size (px), colour and font of the theme's text classes (`title`, `header`, `label`, `callout`, `large-title`, `data-title`, `small-label`, `light-label`). |
| `--param-<name>` | Each parameter: a colour, a number, a CSS string (text), or `1` / `0` (toggle). |

### On each row element

| Variable | Value |
|---|---|
| `--value` | The row's first measure. |
| `--pct-of-max` | `--value` divided by the largest absolute value over the rows (−1 … 1). |
| `--pct-of-total` | `--value` divided by the sum over the rows. |
| `--highlight-value`, `--highlight-pct-of-max` | The same under a cross-highlight, while one is active. |
| `--index`, `--depth` | Row position; nesting depth of an expanded hierarchy. |
| `--<field>`, `--<field>-text` | Every cell of the row. |

### Attributes for CSS

| Attribute | On | Value |
|---|---|---|
| `data-level`, `data-has-highlight`, `data-has-selection`, `data-overflow`, `data-mode` | root | Drill level; `true` / `false`; the **Overflow** setting; `html` or `jsx`. |
| `data-row`, `data-depth` | row elements | Row index, depth. |
| `data-selected` | row elements | `true` / `false`, only while this visual has a selection. |
| `data-highlighted` | row elements | `true` / `false`, only while another visual cross-highlights this one. |
| `data-can-drill` | row elements | `true` when the row can drill down. |

For example, `[data-highlighted="false"] { opacity: .4; }` dims what another visual's selection does not include.

### The container

The root is a size container (`container-type: size`, `container-name: visual`), so container queries and container
units work:

```css
.value { font-size: clamp(20px, 22cqmin, 56px); }        /* scales with the visual */
@container (max-width: 280px) { .bar { grid-row: 2; } }   /* layout changes when narrow */
@container visual (max-height: 120px) { .spark { display: none; } }
```

The report's Segoe UI stand-in fonts (Selawik and Lumen Sans Semibold) are loaded in the visual; `--theme-font` names
them.

## Declarative interaction

These attributes work in templates and in JSX output (inside an element that has `data-row`):

| Attribute | Click does |
|---|---|
| `data-select` | Selects the row (Ctrl+click adds or removes it): cross-filters or cross-highlights the page like a data point of a native chart. In drill mode, drills instead. |
| `data-drill` | Drills down into the row. |
| `data-drill-up` | Drills up one level (or collapses one expanded level). |
| `data-expand` | Expands all down one level. |
| `data-next-level` | Goes to the next level. |
| `data-clear` | Clears the selection. |
| `data-no-tooltip` | No row tooltip inside this element. |

A click on empty space clears the selection. Elements with these attributes are focusable buttons (Tab, Enter or
Space). Hovering a row element shows the default tooltip with the row's **Rows**, **Values** and **Tooltips** fields
(turn it off with **Format > Code > Row tooltips**).

## JSX

The **JSX** tab holds one module that exports a React component (TypeScript type annotations are accepted):

```jsx
import { useState } from 'react'

export default function Visual({ rows, columns, size, select, rowProps }) {
  const [n, setN] = useState(5)
  const m = columns.find((c) => c.role === 'values')
  return (
    <ul onDoubleClick={() => setN(n === 5 ? rows.length : 5)}>
      {rows.slice(0, n).map((r) => (
        <li key={r.key} {...rowProps(r)} data-select>
          {r.label}: {r.cells[m.name].formatted} ({size.width} px wide)
        </li>
      ))}
    </ul>
  )
}
```

Only `react` can be imported (React 19, production build). Hooks work as usual.

### Props

| Prop | Value |
|---|---|
| `rows` | Rows; each has `key`, `index`, `label`, `cells` (by field name), every cell also as `row["Field name"]` and `row.jsIdentifier`, `selected`, `highlighted`, `depth`, `parentKeys`, `canDrill`, `vars` (the row's CSS variables). |
| `columns` | `{ name, css, js, role ('rows' / 'values' / 'tooltips'), kind ('group' / 'value'), dataType, formatString, level }`. |
| `values`, `measures`, `totals` | The measures at the grand total, by name and by JavaScript identifier. |
| `size` | `{ width, height }` in px; the component re-renders when the visual is resized. |
| `theme`, `params` | Theme colours, fonts and text classes; parameter values. |
| `drillInfo`, `level`, `breadcrumb` | Drill state (as `drill` in templates). |
| `truncated`, `hasHighlight`, `selection` | Row limit reached; a cross-highlight is active; this visual's selected rows. |
| `html` | The template's output, if the **HTML** tab has a template. |
| `select(row \| rows, { multi })`, `clear()` | Select rows (cross-filter the page) or clear. |
| `drill(row)`, `drillUp()`, `expandNextLevel()`, `goToNextLevel()` | Drill actions. |
| `isSelected(row)`, `isHighlighted(row)` | Selection and highlight state. |
| `tooltip(row \| items, event)`, `tooltip(null)` | Show the default tooltip for a row, or `[{ label, value }]` lines; hide it. |
| `format(value, formatString?)` | Lumen's formatter (the one native visuals use). A cell without a format string returns its formatted text. |
| `resource(name)` | A registered image of the report as a `data:` URI. |
| `rowProps(row)`, `rowStyle(row)` | Attributes that make an element the row's element (`data-row`, state attributes, CSS variables), or just its style. |

Values are plain data: numbers as numbers, dates as ISO text (`2024-01-31`, with a time when it is not midnight), blank
as `null`. Each cell is `{ value, formatted, type, highlight?, highlightFormatted? }`.

Errors in the JSX (transpiling, rendering, an unhandled promise rejection) appear in the visual and in the editor with
the line and column of your source.

## Parameters

Parameters let a report author change a code visual from the **Format** pane without editing code. Declare them in
the editor's **Parameters** tab (name, label, type, default):

| Type | Format pane control | Template / JSX | CSS |
|---|---|---|---|
| Colour | Colour picker (empty = automatic) | `params.accent` = `#E66C37` | `--param-accent: #E66C37` (absent when automatic) |
| Number | Number box | `params.size` = `12` | `--param-size: 12` |
| Text | Text box | `params.title` = `Revenue` | `--param-title: "Revenue"` |
| Toggle | Switch | `params.compact` = `true` | `--param-compact: 1` |

Their values are stored in the visual's `lumenParams` object, so a theme can set them for every code visual with
`visualStyles.lumenCodeVisualC0DE5A1E7B3F4E2A9D6C8B1F0E4A7D3C["*"].lumenParams`.

## Limits

| Limit | Value |
|---|---|
| Network | None: no fetch, XHR, WebSocket, beacon, workers, remote images, fonts or stylesheets. |
| Images | Registered images of the report (`resource "name"`, at most 4 MB each), `data:` URIs, or fields that hold `data:` URIs. Image URL fields with `http(s)` addresses do not load. |
| App access | None: no access to the report, the app window, storage, cookies, Node or the file system. |
| Navigation | Links and forms never navigate. A script that navigates its own frame only replaces the visual with its error state. |
| Rows | **Row limit**, 1,000 by default, up to 30,000; a notice shows when rows were cut. |
| Template | 512 KB of source, 4 MB of output. |
| Time | A render must finish within 8 seconds, and the frame must answer the watchdog within 4 seconds; otherwise it is stopped and the visual offers **Run again**. |
| Imports (JSX) | `react` only. |

## Message protocol (summary)

The visual runs in a sandboxed frame and talks to the report only through `postMessage`, validated on both sides
(`src/core/codevisual/protocol.ts`):

| Direction | Messages |
|---|---|
| Report → visual | `render` (code, data, CSS variables, theme, images), `pointer` (clicks and moves forwarded in edit mode), `ping` (watchdog). |
| Visual → report | `boot`, `rendered`, `error`, `select`, `clear`, `tooltip`, `tooltipHide`, `menu`, `drill`, `drillUp`, `expand`, `nextLevel`, `pong`. |

A message counts only when it comes from the visual's own frame with the frame's random token and a strictly
increasing sequence number; malformed, oversized (over 64 KB), foreign and replayed messages are ignored. Rows are
referred to by keys the report issued. See [Code visual internals](../developer/code-visual-internals.md).

## Related content

- [Code visual](../visuals/code-visual.md)
- [Use the code visual](../create-reports/code-visual.md)
- [Tutorial: build a KPI tile with HTML and CSS](../create-reports/tutorial-build-a-kpi-tile-with-html-and-css.md)
- [Tutorial: build a drillable bar list](../create-reports/tutorial-build-a-drillable-bar-list.md)
- [Code visual internals](../developer/code-visual-internals.md)

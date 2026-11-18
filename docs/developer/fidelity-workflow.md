# Fidelity workflow

> **Applies to:** Developers

Lumen's first rule is Power BI fidelity: a report should look and compute the way it does in Power BI Desktop.
This article describes how a rendering difference is investigated and fixed: read the definition first, find the
documented default, apply the evidence rule, record the decision in [VISUAL_DEFAULTS.md](../VISUAL_DEFAULTS.md),
and make the Format pane show what the visual draws. Read it before you change how a visual looks.

## The steps

```text
report a difference ─► 1. read the definition ─► 2. resolve it like Power BI ─► 3. find the documented default
        ─► 4. weigh the evidence ─► 5. implement through props.ts ─► 6. make the pane agree ─► 7. record and test
```

### 1. Read the definition first

Most differences are not "Lumen's default is wrong" but "Lumen ignores something the report sets". Open the
visual's `visual.json` (PBIP: `<name>.Report/definition/pages/<page>/visuals/<visual>/visual.json`; PBIX: the
report layout as Lumen converts it to PBIR, visible in a `.wbi` or PBIP saved from Lumen) and read:

- `visual.objects` (the visual's formatting) and `visual.visualContainerObjects` (title, background, border,
  padding, header);
- the selectors on each entry: a property can be set per series, per measure or per data point
  (see [The report document model](the-report-document-model.md) for the `{ id: 'default' }` rule in
  `src/core/report/entries.ts`);
- the report's custom theme in `StaticResources/RegisteredResources/` and the base theme named in
  `report.json` `themeCollection.baseTheme`.

If the report sets the property, the fix is in how Lumen reads it, not in a default.

### 2. Resolve it the way Power BI does

Property resolution goes through `src/core/report/props.ts` (`getProp`, `getColor`), in this order:

1. the visual's own objects entry whose selector matches (no selector for the default);
2. the theme's `visualStyles[visualType]['*'][object]`;
3. the theme's `visualStyles['*']['*'][object]`;
4. the fallback the caller passes.

The theme in steps 2 and 3 is the merged result of the report's custom theme over its base theme
(`src/core/report/theme.ts`; the base theme Lumen ships is `src/core/report/themes/CY24SU10.json`). A renderer that
reads a property any other way (for example `optStr(...) ?? x`) skips the theme and is a bug in itself.

### 3. Find the documented default

When nothing in the definition or theme sets the property, the renderer's fallback decides. Look for the default
in this order, as [VISUAL_DEFAULTS.md](../VISUAL_DEFAULTS.md) does:

1. the base theme JSON (`CY24SU10.json`): values it sets win over everything else;
2. Microsoft Learn: the report-theme documentation (text classes, structural colours), the per-visual format pane
   articles, and the report-theme JSON schema for object and property names;
3. measurements of Power BI renders: Learn screenshots or Microsoft sample reports, measured in pixels. Where
   Learn's tables and a real render disagree, the render wins, and the table row says so.

### 4. Weigh the evidence

The evidence rule: **one render does not establish a default.** A property value seen in a single Power BI
screenshot may come from that report's settings, a theme you cannot see, or a state that is not the default.
Before you change a default:

- confirm it on at least two independent renders (different reports), or on one render plus documentation;
- state in the code comment and in VISUAL_DEFAULTS.md what the evidence is ("inferred from two Power BI Desktop
  renders", "Learn text classes", "unverified");
- when the evidence is one render only, do not change the default; record the observation as an open question.

The project withdrew defaults that broke this rule (a light box behind combo line labels, a "below at local
minima" line-label rule), and VISUAL_DEFAULTS.md keeps the withdrawal on record so they are not reintroduced.

### 5. Implement through `props.ts`, with the default as the fallback

Pass the default as the `fallback` argument of `getProp`, ideally from an exported constant that the renderer and
the Format pane share. From `src/renderer/src/visuals/charts/cartesian/CartesianChart.tsx`:

```ts
/**
 * Default data-label position of bars (also shown by the Format pane): inside center when stacked, else Auto.
 * A stacked chart drawing a single bar series (no legend field, one measure) labels its bars like a clustered chart:
 * Auto, outside the end of the bar when there is room, inside the end otherwise. Inferred from Power BI Desktop
 * renders (two single-series stacked bar charts with no stored position; not documented).
 */
export const barLabelPositionDefault = (stacking: CartesianConfig['stacking'], barSeriesCount = 2): string =>
  stacking === 'clustered' || (stacking === 'stacked' && barSeriesCount === 1) ? 'Auto' : 'InsideCenter'
```

The comment carries the evidence. If the behaviour is approximate, say so in the comment with the word
"Approximation" and, where the user could be misled, in the UI.

### 6. Make the Format pane show the value the visual draws with

An unset property in the Format pane shows the value the visual uses, never a separately maintained copy
(`src/renderer/src/panes/visualizations/effective.ts`). The pane obtains it by running the visual's format
resolution under `recordFallbacks` (`props.ts`), which reports every fallback passed to `getProp`:

```ts
/** Run `fn` while reporting every property fallback read through getProp / noteFallback to `sink`. */
export function recordFallbacks<T>(sink: FallbackSink, fn: () => T): T {
```

- Visuals whose formatting is resolved by pure functions implement `VisualDefinition.formatDefaults`
  (`src/renderer/src/visuals/contract.ts`), which the pane runs under the recorder.
- Charts list theme- or configuration-dependent defaults in `panes/visualizations/chartDefaults.ts`, built on the
  renderers' exported constants (such as `barLabelPositionDefault`).
- Readers with their own resolution report through `noteFallback`.

`src/renderer/src/panes/visualizations/effectiveDefaults.test.tsx` renders every gallery fixture with an empty
format definition while recording fallbacks, and fails when a pane control shows anything else. Run it after any
default change:

```bash
npx vitest run src/renderer/src/panes/visualizations/effectiveDefaults.test.tsx
```

See [Format pane internals](format-pane-internals.md).

### 7. Record and test

1. Update the row in [VISUAL_DEFAULTS.md](../VISUAL_DEFAULTS.md): Lumen value, Power BI default, source. Keep the
   history visible when a value changes ("**#605E5C** (was #252423)").
2. Add a unit test next to the renderer for the rule (for example the single-series stacked case), and a journey
   when the behaviour is interactive (see [End-to-end tests](end-to-end-tests.md)).
3. Sweep a few reports and, when you have a Power BI reference, compare them (see [The sweep](the-sweep.md) and
   [The compare tool](the-compare-tool.md)) to check you did not move other visuals.

## Numbers are different

When a value differs, not a look:

1. Reproduce it as a DAX query in the DAX query view, or with `engine.runDaxQuery` in a test.
2. Check the filter context the visual receives (the sweep's `report.json` keeps it for `nodata`, `blank` and
   `error` visuals) and the query Lumen sent (**Performance analyzer > Copy query**; see
   [Performance](performance.md)).
3. With Microsoft's sample files, the oracle tests compare engine results with values recomputed from raw data
   and with figures Microsoft publishes (see [Testing](testing.md#microsoft-sample-files-lumen_samples_dir)).

Never ship a change that silently produces a wrong number. If a function or feature is approximated, the result
must say so, in code and where the user sees it. The slicer's **Sample stand-in** marker
(`src/renderer/src/visuals/slicers/SlicerChrome.tsx`) is an example of stating in the UI that what is shown is not
the real value.

## Considerations and limitations

- Lumen implements the CY24SU10 base theme's defaults. Reports that embed another base theme use that theme's
  values where it sets them, and Lumen's fallbacks elsewhere; newer base themes change many defaults.
- Lumen bundles no DIN face, and its Segoe UI faces are metric-compatible stand-ins, so text widths and glyph
  positions differ slightly from Power BI's (see [Container chrome and text](container-chrome-and-text.md)).
- Not every default has public evidence. VISUAL_DEFAULTS.md marks those rows "unverified" and lists open questions
  at the end; treat them as the current best guess.

## Related content

- [VISUAL_DEFAULTS.md](../VISUAL_DEFAULTS.md)
- [Themes and text classes](themes-and-text-classes.md)
- [Format pane internals](format-pane-internals.md)
- [The compare tool](the-compare-tool.md)
- [The report document model](the-report-document-model.md)

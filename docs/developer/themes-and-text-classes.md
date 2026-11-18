# Themes and text classes

> **Applies to:** Developers

This article explains how a report theme is found, merged and resolved, how visuals read theme colours,
`visualStyles` and text classes, and how Lumen writes a theme into a report. Read it before you change a visual's
default colours or fonts, or the theme commands.

## Where a report's theme lives

A PBIR report names its themes in `report.json`:

```json
"themeCollection": {
  "baseTheme":   { "name": "CY24SU10", "type": "SharedResources" },
  "customTheme": { "name": "Executive12345678.json", "reportVersionAtImport": { "...": "..." }, "type": "RegisteredResources" }
}
```

- The **base theme** is one of Power BI's shipped base themes, normally stored under
  `StaticResources/SharedResources/BaseThemes/<name>.json`.
- The **custom theme** is the theme a user applied or imported, stored under
  `StaticResources/RegisteredResources/<name>` and listed in `report.json` `resourcePackages`.

`resolveThemes` (`src/core/pbir/pbir.ts`) runs when a report is read and stores the parsed JSON of both in
`ReportDocument.theme` (`{ base?, custom? }`). For each reference it:

1. looks up the file in the report's resources (through `resourcePackages`, or the conventional path);
2. if the file is missing, tries `builtinTheme(name)` (`src/core/report/themes/builtin.ts`), because older layouts
   can name a built-in theme (for example `Concourse` or `City park`) without embedding it;
3. otherwise adds a diagnostic, *Theme '<name>' not found in the report resources (...)*.

A legacy layout with no base theme at all gets the pre-2019 Classic palette (`legacyDefaultBaseTheme`), which is how
Power BI renders those reports.

## Resolving: base + custom = `ResolvedTheme`

`resolveTheme(base?, custom?)` (`src/core/report/theme.ts`) merges the two and fills in every colour a visual
needs:

```ts
// src/core/report/theme.ts
export function resolveTheme(base?: any, custom?: any): ResolvedTheme {
  const merged = deepMerge(deepMerge({}, base ?? DEFAULT_BASE_THEME), custom ?? {})
  const fg = merged.foreground ?? '#252423'
  // ...
}
```

- When there is no base theme JSON, `DEFAULT_BASE_THEME` applies: Lumen's copy of Power BI's `CY24SU10` base
  theme, `src/core/report/themes/CY24SU10.json`.
- Objects merge recursively, so a custom theme overrides single keys of `visualStyles` and `textClasses`.
- `visualStyles` property-bag arrays merge per `$id`: the bag without `$id` (the default) merges with the custom
  theme's default bag; bags with an `$id` are matched by it or appended.
- Any other array (for example `dataColors`) is replaced as a whole.

The result has typed fields for the colours visuals use (`dataColors`, `foreground`,
`foregroundNeutralSecondary`, `foregroundNeutralTertiary`, `background`, `backgroundLight`, `backgroundNeutral`,
`tableAccent`, `good`, `neutral`, `bad`, `maximum`, `center`, `minimum`, `null`, `hyperlink`), each with a
fallback, plus `textClasses`, `visualStyles` and the merged JSON as `raw`.

The document store holds the resolved theme as `useApp().theme`. `mutateReport` re-resolves it only when an edit
replaces `report.theme`, and then runs the registered theme followers in the same undo step (see
[State and store](state-and-store.md#how-mutatereport-works)).

## Colours from the theme

Helpers in `src/core/report/theme.ts`:

| Function | Purpose |
|---|---|
| `themeDataColor(theme, colorId, percent)` | the colour of an SQ `ThemeDataColor`: id 0 is `background`, 1 is `foreground`, 2 and up index `dataColors`; `percent` tints toward white (positive) or shades toward black (negative) |
| `seriesColor(theme, index)` | palette colour of the n-th series or category, cycling through `dataColors` |
| `shadeColor(hex, percent)` | the tint and shade rule used above |
| `withTransparency(color, transparency)` | Power BI's 0 to 100 transparency as `rgba()` |

`decodeValue` in `src/core/report/props.ts` turns a stored `ThemeDataColor` expression into a hex string with
`themeDataColor`, so a visual that reads a colour through `getColor` gets theme colours for free.

## `visualStyles`: theme defaults for formatting properties

A theme's `visualStyles` give default values for Format pane properties:
`visualStyles[visualType][styleName][object] = [ { prop: value, ... } ]`. Lumen reads them only through the
property resolver (`rawProp` in `src/core/report/props.ts`), after explicit formatting and before the renderer's
default:

1. `visualStyles[visualType]['*'][object]`
2. `visualStyles['*']['*'][object]`
3. `visualStyles['*']['*']['*']` (a property for every object)

The base theme uses this for, among others, dotted gridlines and axis titles on every chart
(`visualStyles['*']['*'].categoryAxis` and `.valueAxis`), word wrap and title wrap. Always read formatting through
`getProp` so these defaults apply exactly as they do in Power BI; see
[The report document model](the-report-document-model.md#property-resolution).

## Text classes

*Text classes* are a theme's named font defaults (face, size in points, colour, and optionally bold and italic).
The base theme defines four:

| Class | CY24SU10 value | Used for (in Lumen) |
|---|---|---|
| `callout` | DIN 45pt `#252423` | card and KPI values, gauge callout |
| `title` | DIN 12pt `#252423` | visual titles (container chrome), chart axis titles |
| `header` | Segoe UI Semibold 12pt `#252423` | not read by any visual; editable in **Customize current theme** |
| `label` | Segoe UI 10pt `#252423` | chart labels (through derived classes), table and matrix text, text box defaults, card labels |

Power BI also defines *derived* classes computed from these four (for example `lightLabel`, `smallLightLabel`,
`largeLightLabel`, `boldLabel`). A theme may define them explicitly; otherwise Lumen derives the ones it uses in
the reader that needs them.

The readers:

| Helper | File | What it does |
|---|---|---|
| `textClass(theme, name, fallback)` | `src/renderer/src/visuals/common/fmtProps.ts` | face, size and colour of a class with a full fallback (used with `callout`, for example by the gauge) |
| `axisTitleClass(theme)` | `fmtProps.ts` | axis titles from `title` |
| `labelDerivedClass(theme, 'lightLabel' \| 'smallLightLabel')` | `fmtProps.ts` | category-axis labels (`lightLabel`) and value-axis and data labels (`smallLightLabel`), inherited from `label` |
| `cardTextDefaults(theme)` | `src/renderer/src/visuals/cards/cardProps.ts` | card value from `callout`, category label from `largeLightLabel` (derived: `label` + 2pt) |
| `legacyCardModel` | `src/renderer/src/visuals/cards/legacyCardModel.ts` | the legacy card value from `callout` |
| `themeTextDefaults(theme)` | `src/renderer/src/visuals/elements/textboxModel.ts` | text box defaults from `label` |
| `tableFormat.ts` | `src/renderer/src/visuals/tables/tableFormat.ts` | table and matrix text from `label` |
| `resolveChrome` | `src/renderer/src/report/chrome.ts` | visual title defaults from `title` (the Format pane's `effective.ts` reads the same class) |

`textClassDefaults` in `src/renderer/src/visuals/common/textStyle.ts` is exported but has no callers.

The derivation rules for the derived classes are not all published by Microsoft. The module comments of
`labelDerivedClass` and `cardTextDefaults` state the evidence used and which parts are approximations; keep that
evidence up to date when you change them (see [Fidelity workflow](fidelity-workflow.md) and
[VISUAL_DEFAULTS.md](../VISUAL_DEFAULTS.md)).

### Fonts

Power BI stores font sizes in points and font families as names that encode the weight (`Segoe UI Semibold`,
`Segoe UI Light`, `DIN`) or as CSS stacks (`'Segoe UI', wf_segoe-ui_normal, helvetica, arial, sans-serif`).
`cssFont` in `src/renderer/src/visuals/common/textStyle.ts` turns them into a CSS family plus a numeric weight and
appends `FALLBACK_STACK`; `ptToPx` converts points to CSS pixels (96/72). Which faces actually render on Linux in
place of Segoe UI and DIN is covered in [Container chrome and text](container-chrome-and-text.md).

## Writing a theme into a report

The renderer's theme commands are in `src/renderer/src/app/themes/index.ts`:

- `setReportTheme(report, json, fileName?)` (pure, runs on a draft) removes the current custom theme, then writes
  the new JSON as a `StaticResources/RegisteredResources/<file>.json` resource, registers it in `resourcePackages`
  as a `CustomTheme` item and sets `themeCollection.customTheme` with `reportVersionAtImport`. `json = null` (the
  **Default** theme) only removes the custom theme, so the base theme applies.
- `applyTheme` and `applyThemeJson` wrap it in `mutateReport('Change theme', ...)`, so a theme change is one undo
  step.
- `importThemeFile` reads a JSON file and checks it with `validateThemeJson` (an object, valid hex colours,
  `visualStyles` and `textClasses` objects, and at least one theme key).
- `saveCurrentTheme` exports the merged theme JSON.

The **View > Themes** gallery entries come from `src/renderer/src/app/themes/builtin.ts`. Its module comment lists
the public sources of each palette and which palettes are sampled from images and may differ from Power BI's exact
values by a few units per channel. The **Customize current theme** dialog is
`src/renderer/src/dialogs/CustomizeThemeDialog.tsx`.

## Considerations and limitations

- Only the `'*'` style name of `visualStyles` is read; named styles under a visual type are ignored.
- Lumen ships one base theme, `CY24SU10`. A report whose base theme file is missing and whose name is not a
  built-in theme renders with `CY24SU10` and gets a diagnostic.
- Saved reports reference the base theme without writing its JSON file or `reportVersionAtImport`; see
  [Saving and round-trip](saving-and-round-trip.md#schema-validation-status).
- Built-in gallery palettes that were sampled from images, the 8-colour cycles of most built-in themes, and the
  derived text class rules are approximations, stated in the code comments named above.
- Changing a text class affects only the readers listed above; a visual that hard-codes a font does not follow the
  theme. Search for the class name before assuming a theme edit reaches a visual.

## Related content

- [The report document model](the-report-document-model.md)
- [Container chrome and text](container-chrome-and-text.md)
- [Format pane internals](format-pane-internals.md)
- [Fidelity workflow](fidelity-workflow.md)
- [Visual defaults](../VISUAL_DEFAULTS.md)
- [State and store](state-and-store.md)

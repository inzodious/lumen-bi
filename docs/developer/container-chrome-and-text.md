# Container chrome and text

> **Applies to:** Developers

This article explains how Lumen draws everything around a visual's content (title, subtitle, divider, background, border, shadow, padding, visual header) and how text is set and measured so that it lays out like Power BI on a machine without Segoe UI. Read it before you touch `report/VisualContainer.tsx`, `report/chrome.ts` or the font helpers.

## Overview

In Power BI, the formatting of the box around a visual lives in `visual.visualContainerObjects` (the **General** tab of the Format pane), and the formatting of the visual's content in `visual.objects` (the **Visual** tab). Lumen keeps the same split in code:

| Concern | Where | Owner |
|---|---|---|
| Position, z-order, container chrome, visual header, error boundary, readiness | `src/renderer/src/report/VisualContainer.tsx` | the canvas |
| Chrome resolution (pure, no React) | `src/renderer/src/report/chrome.ts` `resolveChrome()` | the canvas |
| Conditional formatting (fx) of container colors | `src/renderer/src/report/containerCF.ts` `applyBoundContainerColors()` | the canvas |
| The content area | the visual's `component` | the visual |

A visual's component receives only the size of its content area, after padding and the title block are taken off.

## The container

`VisualContainer` renders one visual. In order, it:

1. looks up the definition with `getVisual(type)`;
2. builds the host context with `useVisualHost()` (`report/host.ts`);
3. resolves the chrome with `resolveChrome(visual.json, theme, opts)`, where `opts` comes from the definition's `category`: `titleOnByDefault` is left to the `TITLE_ON_BY_DEFAULT` pattern for `chart` and `map` and is `false` otherwise; `element: true` for elements;
4. applies conditional formatting of container colors, evaluated once in the visual's filter context (`applyBoundContainerColors`);
5. measures the content box (`.wbi-vc-content`) and renders the component inside `VisualErrorBoundary` once it has a non-zero size.

The DOM it produces is stable and used by tests and tools:

```html
<div class="wbi-vc" data-visual="<visual name>" data-type="<visualType>">
  <div class="wbi-vc-box">
    <!-- TitleBlock: title, subtitle, divider -->
    <div class="wbi-vc-content"><!-- the visual's component --></div>
  </div>
</div>
```

Instead of the component, the content box shows a message in these cases: no registered definition (`UnknownVisual`), no engine yet ("Can't display this visual", with the model load error if there is one), or fields that no longer exist in the model ("Something's wrong with one or more fields", with a **Fix this** action in edit mode that removes them). A render error is caught by `VisualErrorBoundary`.

The **visual header** (filter, focus, more options, drill buttons) appears on hover. `PlacedHeader` renders it through a portal into the canvas header layer (`.wbi-vh-layer` in `report/PageCanvas.tsx`) above the visual's top edge, as Power BI places it, so it never covers the visual's own controls.

## Chrome resolution

`resolveChrome()` returns a `ChromeSpec`: title and subtitle `TextSpec`s, divider, spacing, background, border, radius, shadow, padding, header switches, tooltip settings, visual link, alt text and lock-aspect. It reads only `visualContainerObjects`; the visual's own `objects` are deliberately excluded because a visual can reuse the same object names for something else (the new card's `divider` and `padding`, a slicer's `header`):

```ts
// container formatting lives in `visualContainerObjects` only: a visual's own `objects` can use the same names for
// something else (the card visual's `divider` / `padding`, a slicer's `header`…) and must not leak into the chrome
const ctx: PropContext = { ...makePropContext(visualJson, theme), objects: undefined }
```

Every property goes through `getProp()` (`core/report/props.ts`), so theme `visualStyles` apply, and the Format pane's General tab shows the same defaults through `containerDefault()` in `panes/visualizations/effective.ts` (checked against `resolveChrome` by `propModel.test.ts`).

The main defaults:

| Property | Default | Source in code |
|---|---|---|
| Title shown | on for types matching `TITLE_ON_BY_DEFAULT` (charts, maps, scatter, treemap, funnel, gauge, waterfall, KPI, decomposition tree, key influencers, Q&A, R and Python visuals); off for registered non-chart visuals | `TITLE_ON_BY_DEFAULT`, `titleOnByDefault()` |
| Title font | the theme's `title` text class (base theme: DIN 12 pt, `#252423`) | `resolveChrome` |
| Subtitle | off; 10 pt DIN, `foregroundNeutralSecondary` | `resolveChrome` |
| Padding, data visuals | top 0, right 5, bottom 5, left 5 px | `DEFAULT_PADDING` |
| Padding, elements | 5 px on every side | `ELEMENT_PADDING` |
| Vertical spacing | 5 px | `DEFAULT_VERTICAL_SPACING` |
| Background | on, theme `background` | `resolveChrome` |
| Border | off; `#CCCCCC`, 1 px | `resolveChrome` |
| Shadow | off; presets in `SHADOW_PRESETS` | `resolveChrome` |

The title switch (`title.show`) turns off the subtitle and divider as well, as Power BI's Title card does. Title-area spacing supports both of Power BI's models (`SpacingSpec.model`): the older "space below" properties and the newer "space above" properties (`spaceAboveSubtitle`, `spaceAboveDivider`, `spaceAbovePlotArea`); `titleAreaGaps()` turns either into pixel gaps. A title without its own text shows `generatedTitle()`: Power BI's automatic "<values> by <categories>" title from `autoTitle()`, except for the new card, which labels its values itself.

The provenance of each default (measured on a Power BI render, taken from the base theme, or unverified) is recorded in [VISUAL_DEFAULTS.md](../VISUAL_DEFAULTS.md#visual-container-title-subtitle-divider-spacing-padding).

## Fonts

### Power BI font values

Power BI stores font sizes in points and font families as names whose face carries the weight: `"Segoe UI Semibold"`, `"Segoe UI Light"`, `"DIN"`, the web-font aliases `wf_segoe-ui_semibold`, or a whole stack such as `'Segoe UI Semibold', wf_segoe-ui_semibold, helvetica, arial, sans-serif`. Bold, italic and underline are separate switches.

`resolveFont(family, { bold })` in `src/renderer/src/visuals/common/text.ts` is the one mapping from a Power BI font value to CSS, used by the container chrome (`fontStack()` and `fontWeightOf()` in `report/chrome.ts` call it) and the visuals:

- only the first family of a stack decides the face and weight ("Segoe UI Semibold" is weight 600, never bold because of its name);
- **Bold** on a weighted face selects the family's real bold face (weight 700), not a synthesized bold of the semibold face;
- Power BI's own fallbacks (`helvetica`, `arial`) are replaced by a Segoe-metric stack, because on Linux they resolve to Arial-metric fonts that run 5 to 10% wider than Power BI's text;
- an unknown family keeps the author's own fallbacks ahead of the Segoe stack.

`ptToPx()` converts points to CSS pixels at 96 dpi (px = pt x 4/3). `parseFontSize()` in `visuals/common/textStyle.ts` also accepts sizes stored as strings (`'14'`, `'14pt'`, `'12px'`); bare numbers are points.

### The Segoe UI stand-in faces

Segoe UI is not installed on Linux, and the usual fallbacks are wider, which wraps or truncates labels that fit in Power BI. Lumen bundles **Selawik**, Microsoft's open, metric-compatible fallback for Segoe UI (SIL Open Font License 1.1), in `src/renderer/src/assets/fonts/selawik/`. `selawik.css`, imported by `src/renderer/src/main.tsx`, declares:

- the `Selawik` family at weights 300, 350, 400, 600 and 700;
- the family names Power BI files use (`Segoe UI`, `Segoe UI Light`, `Segoe UI Semilight`, `Segoe UI Semibold`, `Segoe UI Bold` and the `wf_segoe-ui_*` aliases) mapped to those files, always trying a locally installed Segoe UI first with `local()`;
- `font-display: block`, so text measurement does not change after the first layout.

The Segoe UI Semibold aliases do not use Selawik's own Semibold, whose stems are nearly as heavy as its Bold. They use **Lumen Sans Semibold** (`lumensans-semibold.woff2`), built by `scripts/fonts/make-semibold.py` from Selawik Regular outlines emboldened to a lighter stem, with Selawik Semibold's advance widths and kerning, so it measures like the semibold face. It is renamed because "Selawik" is a Reserved Font Name under the OFL. The stem weight is matched to Power BI renders by eye: an approximation, stated in the script and the CSS.

DIN, the base theme's title face, is not bundled: titles fall back to the Segoe-metric stack (`'DIN', 'D-DIN', 'Barlow', 'Roboto Condensed', ...`), which runs slightly wider and sits about 1 px lower.

## Measuring text

Layout decisions (label truncation, axis label spacing, wrapping) need text widths before anything is drawn.

| Function | File | Use |
|---|---|---|
| `measureText(text, font)` | `visuals/common/text.ts` | Width in px from a cached 2D canvas context with the resolved CSS font; cached per font and string. In Node (unit tests) it falls back to `approxWidth()`, a deterministic Segoe-like average-advance estimate. |
| `ellipsize(text, maxWidth, font)` | `visuals/common/text.ts` | Binary search for the longest prefix that fits with an ellipsis. |
| `wrapText(text, maxWidth, font, maxLines)` | `visuals/common/text.ts` | Word wrap with an ellipsis on the last line. |
| `lineHeight(font)` | `visuals/common/text.ts` | `ceil(size x 1.3)`, the label line height. |
| `segoeTextWidth(text, px, weight)` | `visuals/elements/segoeMetrics.ts` | Width in real Segoe UI metrics (advance tables taken from Selawik 1.01 at weights 300 to 700), to predict where Power BI breaks a text box's lines even when a wider font renders. |

`FontSpec` (`{ size, family, weight, italic }`, size in px) is the common currency; `cssFont()` and `fontAttrs()` turn it into a CSS `font` string or SVG text attributes.

> [!TIP]
> Text measurement in unit tests uses `approxWidth`, not the real font, so tests that depend on exact truncation points should assert behaviour (an ellipsis appears, a label fits) rather than pixel widths.

## Considerations and limitations

- Without a local Segoe UI, all text is set in Selawik and Lumen Sans Semibold. Their advance widths match Segoe UI closely, but glyph shapes differ, and Lumen Sans Semibold's weight is a perceptual match, not Segoe UI Semibold's outlines.
- DIN is not bundled; titles in the base theme render in a Segoe-metric fallback.
- Power BI does not publish its container padding defaults. The data-visual padding (0 / 5 / 5 / 5) is measured on a Power BI Desktop render; the element padding (5 px all round) is unverified, as stated in `report/chrome.ts` and VISUAL_DEFAULTS.md.
- When "space above" spacing values are missing from a file saved by the newer format pane, Lumen falls back to the single vertical spacing (unverified approximation, commented in `spacingSpec()`).
- Gradient conditional formatting of container colors with "Lowest / Highest value" stops collapses to the first stop, because a container has a single value (commented in `containerCF.ts`).

## Related content

- [The visual contract](visual-contract.md)
- [Format pane internals](format-pane-internals.md)
- [Themes and text classes](themes-and-text-classes.md)
- [Fidelity workflow](fidelity-workflow.md)
- [VISUAL_DEFAULTS.md](../VISUAL_DEFAULTS.md)
- [Dependencies and licences](dependencies-and-licences.md)

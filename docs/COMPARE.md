# Comparing Lumen with Power BI

`scripts/compare.sh` puts a Power BI reference image next to Lumen's render of the same report page, visual by
visual, and scores the differences that survive different data. The goal is a systematic, repeatable check
instead of looking at two whole pages by eye.

```bash
scripts/compare.sh <reference.png|.jpg|.pdf> <report> <outdir> [options]
# a screenshot of page 2 of a PBIP without data:
scripts/compare.sh ~/shot.png path/to/X.Report /tmp/cmp --page 2 --sample-data --private
# a whole-report PDF of a Microsoft sample (it carries its data):
scripts/compare.sh ~/export.pdf path/to/Sample.pbix /tmp/cmp --same-data
```

Then open `<outdir>/index.html` (a local file, no network).

| Option | |
|---|---|
| `--page p` | which report page a screenshot (or a one-page PDF) shows: name, display name or 1-based index. Default: the first page |
| `--pages a,b` | only render / compare these pages (passed to the sweep) |
| `--sample-data`, `--private` | passed to the sweep (see [SWEEP.md](SWEEP.md)) |
| `--same-data` | both sides show the same data: also score a pixel difference per visual and add a difference panel |
| `--crop x,y,w,h` | the page rectangle in the reference, in reference pixels (skips detection; applies to every PDF page) |
| `--calibrate-colours` / `--no-calibrate` | force / prevent the colour-cast correction (default: on when a cast is detected) |
| `--no-local` | no per-visual alignment (see below) |
| `--lumen <dir>` | reuse a sweep output folder instead of rendering again |
| `--titles` | include visual titles in `compare.json` / `index.html` (off by default: ids are type + index) |
| `--size WxH`, `--no-build`, `--dpi n` | sweep window size, skip the build check, PDF rasterisation resolution (default 144) |

Requirements: `pdftoppm` (poppler-utils) for PDF references; JPEG and other non-PNG images are decoded through
Electron (`scripts/compare-electron.mjs`). No image library is installed, so PNG decoding / encoding and all
image work are plain Node (`scripts/compare-lib.mjs`).

## Output

| File | |
|---|---|
| `index.html` | review page: warnings, page side-by-sides, then every visual worst first with its crop pair and scores |
| `compare.json` | everything: per page the detected rectangle, colour cast, quality warnings; per visual rect, offset and scores |
| `summary.tsv` | one row per visual, worst first, with the main numbers |
| `pages/pNN-page.png` | reference (left) and Lumen (right) at the same scale |
| `pages/pNN-rects.png` | the same with the definition's visual rectangles drawn: **check this first** — if the boxes do not sit on the reference's containers the alignment is wrong; re-run with `--crop` |
| `visuals/pNN-<type>-<k>.png` | one per visual: reference left, Lumen right (and a difference heat map with `--same-data`). `k` counts visuals of that type in reading order (top to bottom, left to right) |
| `lumen/` | the sweep output (PNG per page + `report.json`) |

Visuals are named by page, type and index, never by title (titles can be confidential).

## How it works

1. **Render**: `scripts/sweep.sh` renders the pages. `report.json` records each visual's rectangle in page
   units from the definition (`rect`, group offsets applied, and `z`) and where the page sits in the PNG
   (`pngPage`: origin and pixels per unit).
2. **Rasterise**: PDF pages go through `pdftoppm`. Power BI's *Export to PDF* writes the visible pages in tab
   order (hidden and tooltip pages are left out), one PDF page per report page with the page's aspect ratio;
   PDF page *k* is matched with the *k*-th visible page. A PDF page with the page's aspect ratio is used whole.
3. **Align** (screenshots, or PDF pages with margins):
   - coarse: the rectangle with the page's aspect ratio whose downscaled luminance correlates best with
     Lumen's render (the layout matches even when the data differs);
   - fine: around it, the offset and scale at which the definition's container edges (every visual
     rectangle's sides) line up with edges in the reference, ± 1 px, then width and height separately within
     ± 1.5 % (screenshots are sometimes resized unevenly). This uses where Power BI draws the containers, not
     where Lumen does. The detected rectangle is printed as a `--crop` value you can correct.
   - per visual: a visual with a visible container border is moved (≤ 8 units) onto its own border when that
     lines up clearly better; a visual whose content does not depend much on the data (slicer, text box,
     shape, image, card, navigator) and has no convincing border is moved (≤ 12 units) to where its content
     correlates best. The shift is reported (`offset`, a `position` score), because it is either warping of
     the reference or a real position difference in Lumen. Charts and tables are never moved by content.
4. Both pages are resampled to the smaller of the two resolutions (downscaling only), then each visual's
   rectangle is cut out of both.
5. **Colour cast**: on large uniform areas (flat over ~40 units in both images: container, pane and header
   backgrounds, not bars or text) the reference's colours are compared with Lumen's. A large shift means the
   reference was processed (re-encoded, colour-managed, "enhanced"): the colours are then corrected towards
   Lumen's near those anchors only (colours far from every anchor, such as series colours, are untouched),
   colour-based severities count half, and the review page shows a warning banner.

## Scores

Each score has a severity 0–1 (≥ 0.3 is listed as a reason) and a `what` text in `compare.json` saying what
it measures. A visual's score is the weighted sum of its severities, used only for ranking.

| Score | Measures | Catches | Does not catch / false alarms |
|---|---|---|---|
| background | ΔE (CIELAB) between the most common interior colour of each crop | wrong fill / transparency | a crop that is mostly one data colour |
| border | mean per-pixel ΔE over the outer 3-unit band | border, shadow, corner radius, background differences at the edge | sub-pixel misalignment adds a few ΔE |
| series colours | dominant saturated colours (chroma > 15, ≥ 0.4 % of the crop); severity from the largest **hue** difference between a clearly coloured colour (≥ 1 %, chroma ≥ 20) and its nearest counterpart, or such a colour with no counterpart | a different series / fill palette, a missing coloured icon | pale colours (chroma < 20) are not judged; lightness / saturation drift is deliberately ignored |
| title ink / title stroke | the first text line at the top (the title): ink coverage, top position, stroke width (shorter of mean horizontal / vertical ink run) | too bold, too large, moved title | at < ~0.6 px per unit strokes are 1–2 px and the ratio is coarse; text pushed to black by processing reads heavier |
| title divider | a full-width horizontal line near the top: apparent thickness (contrast-independent), weight (thickness × contrast) and colour | divider too thick, too dark / bright, missing | a blurred 1 px line and a sharp 2 px lighter line have the same weight; a faint hairline may vanish in a low-resolution image |
| bottom row | the last text line (stroke width) and a heavy rule in the bottom band | a missing pinned total row (bold, under a rule) | at low resolution bold and regular are often indistinguishable; only the rule then signals |
| content extent | bounding box of content that differs from the background (below the title band for tall visuals) | bars / lines stopping short, a table not filling its width, content cut off | data with a different range moves the extent too |
| layout | share of occupied cells of a coarse (~24-unit) grid occupied on one side only | an icon, label or legend in another place | very different data also raises it |
| position | the per-visual alignment shift | a visual drawn in the wrong place | warping of a processed screenshot looks the same |
| pixel diff (`--same-data`) | % of pixels whose 3×3-blurred colour differs by ΔE > 10 | anything visible | font rasterisation differences around text set a floor of a few % |

Noise floor: comparing Lumen with a PDF printed from its own render (same data, rasterised at another
resolution) gives visual scores ≤ ~0.7 and a page pixel difference of ~2 %. Scores below ~1 are not worth
looking at; the ranking matters more than the numbers. The floor assumes the page rectangle was detected exactly:
comparing a sweep PNG with itself, detection once placed the page at `-1,-1` and every score rose (page pixel
difference about 9 %, a table at 1.2). When all scores look uniformly raised, check the detected rectangle (printed by the tool, and `pages[].referenceRect` in
`compare.json`) and pass `--crop x,y,w,h`.

What the tool **cannot** tell you: whether numbers are right (different data on purpose), anything inside
tooltips, hover states or other pages, font family identity, and which of two plausible renderings Power BI
would choose. Thresholds are heuristics tuned on synthetic cases and one real (processed) screenshot; trust a
high score as "look at this", not as proof.

## Producing good references in Power BI Desktop

Best: **File → Export → Export to PDF**. Every visible page, the exact canvas, vector text, no window chrome.
Pass the PDF as it is (`--dpi 192` for more detail on small text).

Screenshots work too:

- **View → Page view → Actual size** (or **Fit to page**), and collapse the Filters / Visualizations / Data
  panes so the whole page is visible. Window chrome around the page is fine; it is found automatically.
- Use the PNG straight from the screenshot tool. Do not paste it through chat apps, image editors or
  "enhancers": they re-encode, change colours (a cast is detected and corrected only roughly), sharpen text
  and can warp geometry, which turns every colour, weight and thin-line score into weak evidence.
- Higher resolution is better: at least the page's own size (e.g. 1280 px wide for a 1280 × 720 page).
  Below 0.6 reference pixels per page unit the tool warns that line and stroke scores are weak.
- One page per screenshot; pass `--page` to say which.
- Same data helps: a Microsoft sample `.pbix` carries its data, so run with `--same-data` and the pixel
  difference becomes meaningful.

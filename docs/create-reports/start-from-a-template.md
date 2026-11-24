# Start from a report template

> **Applies to:** Creators · Analysts

The gallery holds designed reports for quick mockups: every page looks finished, but the report holds no data. Each
template is a complete PBIP project: a semantic model with only the two default measure tables, a theme, vector
artwork and one or more pages of empty visuals that draw sample data until you give them fields (see
[Sample data on empty visuals](sample-data-on-empty-visuals.md)).

## Open the gallery

- On the start screen, select **Gallery**.
- Or select **File > New**; the gallery is under **Gallery**.

![The gallery on the start screen: template cards with previews, style and a Power BI compatible or Lumen only badge.](../images/create-reports/start-from-a-template-gallery.png)

Select a card to create a new, unsaved report from it. The visuals show their sample data right away. **Save** asks
where to put the report, as for any new report.

The chips above the cards filter the list: **All**, **Power BI compatible** and **Lumen only**.

## The templates

| Template | Style | Sample data | Power BI |
|---|---|---|---|
| Boardroom | Professional: ivory paper, navy and brass, serif headings, a ruled statement row | Quarterly finance, two pages | Compatible |
| Monolith | Modern: bento grid, giant light numerals, black and electric-lime tiles | Product usage and revenue | Compatible |
| Doodle | Cartoon: sticker cards with ink outlines and hard shadows, a waving mascot | Ice-cream shop sales | Compatible |
| Orbital | Futuristic: deep space, a HUD ring around the headline, frosted-glass panels | Satellite mission telemetry | Lumen only |
| Atomic | Mid-century: boomerangs, starbursts, a vinyl record that is the donut chart | Record shop sales | Compatible |
| Blacktop | Streetball: graffiti title, chain-link fence, court paint, tilted sticker cards | Summer league stats | Lumen only |
| Broadsheet | Editorial: a newspaper front page with masthead, lead chart and sidebar | Transit ridership | Compatible |
| Contour | Nature: mountain panorama, topographic lines, a trail through waypoint KPIs | Parks and wildlife | Compatible |
| Blueprint | Technical: an engineering drawing sheet with a title block and a CAD gear | Plant OEE | Compatible |
| Aurora | Glass: soft pastel light, aurora ribbons, frosted panels | Music streaming | Lumen only |
| Regolith | Industrial sci-fi: a command rail with page navigator, copper and teal glow panels | Space mining operations | Lumen only |
| 1st Edition | Starter: navigation, filter panel, calendar and last-refreshed date | Calendar only | Compatible |

**Power BI compatible** templates use only what Power BI Desktop draws the same way: its visuals, container
formatting (rounded corners, borders, drop shadows), theme fonts from the Power BI font list and SVG pictures. Save one
as a PBIP project and it opens in Power BI Desktop as it looks in Lumen.

**Lumen only** templates also use effects that Power BI has no setting for:

- **Container effects**: frosted glass (a blur of what is behind the visual), gradient fills, an outer glow and
  rotation. They are stored in the visual's `Lumen_Style` annotation; see
  [Working with PBIP projects](../files-and-compatibility/working-with-pbip-projects.md#files-and-properties-lumen-adds).
- **Fonts bundled with Lumen**: Barlow, Roboto Condensed and Open Sans, which Power BI's font list does not offer.

Power BI Desktop still opens these reports: it ignores the annotation, draws each container with its ordinary
background, border and shadow, straight and without blur, and substitutes its default font for the bundled ones.

## Put in your own data

The Data pane of a template holds two measure tables and nothing else:

| Table | Holds | Starts with |
|---|---|---|
| `_measures_kpi` | Metric measures (totals, rates, comparisons) | `kpi_blank` |
| `_measures_format` | Formatting measures (dynamic titles, colors, labels) | `fmt_blank` |

**New measure** adds to `_measures_kpi` unless another table is selected. To build the report on your data:

1. Load your tables (**Get data**, **Enter data** or **Transform data**).
2. Write your measures in `_measures_kpi` and `_measures_format`.
3. Drop fields into a visual. Its sample disappears as soon as it has a field; remove the fields and it comes back.

Text boxes such as headlines and footers are placeholders: double-click one to edit it.

## For developers

The templates are generated: `node scripts/templates/build.mjs` writes `src/core/templates/<id>/` from the designs in
`scripts/templates/designs/`. A design still describes its visuals with fields and sample tables; the build stores each
visual's fields in its `Lumen_SampleData` annotation, the tables in `sampleData.lumen.json` and leaves the visual
itself empty, and `scripts/templates/previews.sh` renders the gallery thumbnails with Lumen itself.
Lettering drawn as vector art (Blacktop's title) is outlined from Barlow by `scripts/templates/outline.py`.

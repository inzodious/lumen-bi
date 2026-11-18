# Documentation style guide

> **Applies to:** Developers

This guide is for anyone who adds or changes an article in `docs/`. It sets the structure, the article shapes, the
writing conventions, the rules for screenshots and the way the PDF editions are built. Read it before you write.

## The rule that outranks the rest: document what is true

Every statement in the documentation must hold for the code on the branch it is committed to.

- Check a feature in the code and, for anything a user sees, use it in the running app before you describe it.
  Do not describe a feature from its name, from Power BI's behaviour or from an older document.
- Where Lumen differs from Power BI Desktop, approximates something, or lacks something a Power BI user would
  expect, say so in a **Differences from Power BI Desktop** or **Considerations and limitations** section of the
  article. Never leave such a section out to make a feature look complete.
- Reference tables (visuals, DAX and M functions, connectors, file-format features, keyboard shortcuts, format
  properties) are generated from the source of truth or checked against it line by line. When a script under
  `scripts/docs/` generates a table, the article says so and names the script.
- "Not verified" is not "false". Opening a file saved by Lumen in Power BI Desktop is not part of this project's
  tests. Write "designed to" and "not verified" where that applies; never present compatibility as a tested fact.
- Do not copy text from Microsoft's documentation. Link to Microsoft Learn for Power BI concepts instead.
- The repository is public: no client names, paths, host names, GUIDs or data from real reports, ever.

## Readers

| Audience | Who | Typical questions |
|---|---|---|
| **Creators** | Build reports: pages, visuals, formatting, themes, interactions, export | How do I make this look right? Where is that setting? |
| **Analysts** | Work with data and logic: connect, transform, model, DAX, check numbers | Is this number right? Which functions work? |
| **Developers** | Extend or contribute to Lumen: architecture, contracts, engines, tests, tooling | Where does this live? How do I add one? How do I test it? |

They know Power BI to varying degrees. None of them has seen the code. Write for them, not for the maintainers:
no internal history, no "we recently fixed", no references to work sessions.

## Structure

```
docs/
  README.md                 hub page
  STYLE.md                  this guide
  _includes/                shared wording (disclaimer, audience line)
  get-started/              overview, install, quickstart, tour, tutorial, coming from Power BI Desktop
  create-reports/           report authoring: pages, formatting, themes, filters, interactions, export…
  visuals/                  one article per visual family, plus a gallery
  connect-and-transform/    Get data, connectors, Power Query editor, refresh, sample data
  model-data/               Table view, Model view, relationships, groups
  dax/                      measures, calculated columns and tables, DAX query view, engine notes
  files-and-compatibility/  file formats, PBIX, PBIP, round-tripping, .wbi, reports without data
  developer/                architecture, contracts, engines, tests, tooling, contributing
  reference/                generated or line-checked reference tables, glossary
  troubleshooting/          problems and their fixes, FAQ
  images/<section>/         screenshots, one folder per section
  pdf/                      generated PDF editions (see "PDF editions" below)
```

The older design notes in `docs/` (`ARCHITECTURE.md`, `BACKLOG.md`, `SWEEP.md`, `COMPARE.md`, `ICONS.md`,
`VISUAL_DEFAULTS.md`) stay where they are, because code comments point at them. Link to them; do not move them.

Every section has a `README.md`: a title, one paragraph, and a table (or several, grouped by article type) that
lists its articles. **The order of the links in that file is the order of the articles in the PDF**, so add a new
article to its section's `README.md` when you create it. The PDF build warns about articles that no section hub
lists and appends them at the end of their section.

## Article conventions

### File names

Lower case, words separated by hyphens, `.md`: `install-on-linux.md`. One topic per article; prefer several
focused articles to one long one.

### Opening lines

Every article starts with a title, the audience line and a one- or two-sentence summary:

```markdown
# Install Lumen on Linux

> **Applies to:** Creators · Analysts · Developers

This article explains how to build Lumen from source and add it to your desktop.
```

Keep only the audiences that apply, in the order Creators · Analysts · Developers. The line is kept in
[`_includes/audience.md`](_includes/audience.md).

### Article types

| Type | Shape |
|---|---|
| **Overview** | What it is and why it matters, a screenshot, links onward. |
| **Quickstart** | About ten minutes, one result. |
| **Tutorial** | Numbered steps that build something real with the built-in sample. |
| **How-to** | Prerequisites, numbered steps, the result, Considerations and limitations, Related content. |
| **Concept** | How something works, with tables or diagrams. |
| **Reference** | Tables, generated where possible. |

Every article ends with a **Related content** section of three to six links.

### Writing

- Plain, direct English. Second person ("you"), present tense, active voice.
- Sentence-case headings: "Save a report as PBIP", not "Save A Report As PBIP".
- Define a term on first use and add it to the [glossary](reference/glossary.md).
- No marketing language ("powerful", "seamless", "blazing").
- Product names: "Lumen"; "Power BI Desktop" and "Power BI" for Microsoft's products. Do not use Microsoft logos.
- Numbers in tables right-aligned only when they are compared; otherwise leave the default.

### Steps and UI labels

- Numbered steps, one action each.
- UI labels in **bold**, exactly as they appear in the app (check the label in the app or the code).
- Menu paths with `>`: **File > Export > Export to PDF**.
- Keys as plain text with `+`: Ctrl+Shift+S.

### Callouts

Use GitHub alert blockquotes. GitHub renders them; the PDF build styles them.

```markdown
> [!NOTE]
> Information the reader should notice even when skimming.

> [!TIP]
> Optional advice that makes a task easier.

> [!IMPORTANT]
> Information required to succeed.

> [!WARNING]
> Something that can lose work or produce wrong results.
```

### Code

Fence code with a language: `dax`, `powerquery`, `json`, `ts`, `bash`. Every DAX and M example must run in Lumen
against the built-in sample report, and a result shown in an article is the real result Lumen returned.

### Links

- Relative links between articles: `[Install Lumen](../get-started/install-on-linux.md)`.
- Link to a heading with its GitHub anchor: `file.md#considerations-and-limitations`.
- Links to source files are relative too (`../../src/core/io/open.ts`). In the PDF they print as plain text.
- The PDF build checks every relative link, image path and anchor in `docs/` and fails on a broken one.

### Markdown that converts cleanly

- Standard GitHub Flavored Markdown. No raw HTML except `<br>` inside table cells.
- Tables of at most about six columns; split wide reference tables or use a list.
- Relative image paths. No image wider than the page.
- Mermaid diagrams are fine on GitHub, but follow each ```` ```mermaid ```` block with a plain-text version: the PDF
  build drops the Mermaid source.

## Screenshots

- Only the built-in sample report (fictional data) or small models you invent for the purpose. Never real
  reports, never Microsoft's sample `.pbix` files, never anything from a personal folder.
- Capture from the real app at a 1440 x 900 window, through the end-to-end harness (`e2e/harness.ts`) or
  `scripts/capture.sh` after `npm run build`. Crop to the relevant region. PNG, ideally under 300 KB.
- Save as `docs/images/<section>/<article>-<what>.png`.
- Give every image alt text that says what the picture shows: `![The Filters pane with a page filter on Year](…)`.
- Look at every screenshot before you commit it. A rough or broken UI is a product defect to report, not
  something to hide by framing.

## The non-affiliation line

The hub page and every PDF cover carry the line in [`_includes/disclaimer.md`](_includes/disclaimer.md).

## PDF editions

The Markdown is the source; the PDFs in [`pdf/`](pdf/README.md) are generated from it and committed so readers
can download them.

```bash
scripts/docs/build-pdf.sh                 # link check, then every PDF into docs/pdf/
scripts/docs/build-pdf.sh --check         # link check only
scripts/docs/build-pdf.sh get-started     # link check, then one edition (see --list)
scripts/docs/build-pdf.sh --list          # the editions, their sections and article counts
scripts/docs/build-pdf.sh --out /tmp/pdf  # write somewhere else
scripts/docs/build-pdf.sh --warn-links    # report broken links but build anyway (drafts only)
```

Requirements: `pandoc` (3.x), `pdfinfo` (poppler-utils), the repository's Electron in `node_modules`, and
`xvfb-run` when no display is available. The build adds no npm dependencies and takes well under a minute.

How it works:

- **Link check.** Every relative link, image path and `#anchor` in `docs/**/*.md` must resolve (links inside code are
  ignored; anchors use GitHub's heading slugs). A broken one stops the build with a list of file:line entries.
- **Order.** Articles appear in the order of the links in their section's `README.md`. Pages in a sub-folder of a
  section (such as `reference/dax-functions/`) follow the article that links them. Anything no hub or article links
  is appended at the end of its section with a warning. The combined edition follows the "All sections" table of
  `docs/README.md`.
- **Conversion.** Each article is converted by pandoc with a Lua filter (`scripts/docs/pdf-filter.lua`) that turns
  `[!NOTE]`-style blockquotes into callouts, prefixes every heading id with the article's path so the articles of one
  edition can share a document, rewrites links between articles into links inside the PDF, makes image paths
  absolute, gives wide code blocks a smaller font instead of wrapping them, lets long code in table cells break after
  `/`, `.`, `_`, `-` and `:`, and drops ```` ```mermaid ```` blocks (GitHub renders them; an article that uses one
  must follow it with a plain-text version of the same diagram, which the PDF keeps).
- **Printing.** The articles are assembled behind a cover (edition title, audience, commit, build date and the
  non-affiliation line) and a linked table of contents, styled by `scripts/docs/pdf.css` (A4, the Selawik font the
  app ships, callouts, tables that fit the page, images scaled to the text width) and printed by Electron's
  `printToPDF` (`scripts/docs/pdf-print.cjs`), which adds the footer (edition title and page number) and the PDF
  outline (bookmarks).

A link to an article that is not in the same edition prints as its text followed by the article's path. Links to
source files print as text.

Run the build after you change any article, and commit the regenerated PDFs with the Markdown.

## Related content

- [Documentation hub](README.md)
- [Shared snippets](_includes/README.md)
- [PDF editions](pdf/README.md)
- [Architecture](ARCHITECTURE.md)

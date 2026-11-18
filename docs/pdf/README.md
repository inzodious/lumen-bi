# PDF editions

> **Applies to:** Creators · Analysts · Developers

The documentation is written in Markdown in `docs/`. The PDF files in this folder are generated from it, so that you
can read the documentation offline or print it. They are committed to the repository and regenerated whenever the
documentation changes.

| PDF | Contents |
|---|---|
| `lumen-documentation.pdf` | Everything, in the order of the [documentation hub](../README.md) |
| `lumen-get-started.pdf` | [Get started](../get-started/README.md) |
| `lumen-create-reports.pdf` | [Create reports](../create-reports/README.md) and [Visuals](../visuals/README.md) |
| `lumen-data-and-modeling.pdf` | [Connect and transform data](../connect-and-transform/README.md), [Model data](../model-data/README.md) and [DAX](../dax/README.md) |
| `lumen-files-and-compatibility.pdf` | [Files and compatibility](../files-and-compatibility/README.md) |
| `lumen-developer-guide.pdf` | [Developer guide](../developer/README.md) |
| `lumen-reference.pdf` | [Reference](../reference/README.md) |
| `lumen-troubleshooting.pdf` | [Troubleshooting](../troubleshooting/README.md) |

Each PDF has a cover with the commit and date it was built from, a table of contents with links, bookmarks (the PDF
outline) for every article and heading, and links between the articles it contains. A link to an article in another
PDF prints the article's path in the repository.

> [!NOTE]
> The Markdown files are the reference. If a PDF and the Markdown disagree, the PDF is out of date.

## Regenerate the PDFs

From the repository root:

```bash
scripts/docs/build-pdf.sh
```

The script first checks every relative link, image path and heading anchor in `docs/`, stops with a list if any is
broken, then writes all the PDFs above into this folder and prints the page count of each. To build only some
editions, name them (`scripts/docs/build-pdf.sh get-started reference`); `--list` shows the edition names and
`--help` every option.

Requirements: `pandoc` 3.x, `pdfinfo` (poppler-utils), the repository's Electron (`npm install`), and `xvfb-run` when
no display is available. See [the documentation style guide](../STYLE.md#pdf-editions) for how the build works.

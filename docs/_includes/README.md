# Shared snippets

Markdown has no include mechanism on GitHub, so these files are the single source of the wording that several
pages repeat. Copy the text verbatim; the PDF build (`scripts/docs/build-pdf.sh`) reads `disclaimer.md`
directly and prints it on every PDF cover and on the hub page check.

| File | Use |
|---|---|
| [`disclaimer.md`](disclaimer.md) | The non-affiliation and trademark line. Required on the hub page ([`docs/README.md`](../README.md)) and on every PDF cover (added by the build). |
| [`audience.md`](audience.md) | The "Applies to" line every article starts with. Keep only the audiences that apply, in the order Creators · Analysts · Developers. |

The audiences:

- **Creators** build reports: pages, visuals, formatting, themes, interactions, export.
- **Analysts** work with data and logic: connect, transform, model, DAX, check numbers.
- **Developers** extend or contribute to Lumen: architecture, contracts, engines, tests, tooling.

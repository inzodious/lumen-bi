# Third-party notices

Lumen includes or is derived from the following third-party works. npm dependencies are listed in
`package.json` and ship with their own license files in `node_modules`; this file covers bundled
assets, ported code and notable runtime libraries.

| Component | License | Where | Notes |
|---|---|---|---|
| **Selawik** font — Copyright 2015 Microsoft Corporation, Reserved Font Name "Selawik" (https://github.com/microsoft/Selawik, release 1.01) | SIL Open Font License 1.1 | `src/renderer/src/assets/fonts/selawik/` (license text: `OFL.txt`) | Unmodified woff2 files (300/350/400/600/700). Metric-compatible fallback for Segoe UI. |
| **Microsoft Xpress9 / Xpress (XPress8)** decoders — Copyright (c) Microsoft Corporation, via xpress9-python / xpress8-python (Copyright (c) Igor Cotruta) | MIT | `src/core/io/pbix/datamodel/` | TypeScript ports; details and license texts in `src/core/io/pbix/datamodel/THIRD_PARTY.md`. |
| **pbixray** / **xmhuffman** — Copyright (c) Igor Cotruta | MIT | `src/core/io/pbix/datamodel/` | Format knowledge for ABF / VertiPaq decoding (see `THIRD_PARTY.md` there). |
| **Power BI CY24SU10 base theme** — Microsoft | Microsoft (published report theme JSON) | `src/core/report/themes/CY24SU10.json` | Default visual styles used by Power BI Desktop; built-in theme palettes in `src/core/report/themes/builtin.ts` come from Microsoft's public documentation and samples (sources cited in that file). |
| **Open Sans** (via `@fontsource/open-sans`) — Copyright The Open Sans Project Authors | SIL Open Font License 1.1 | npm dependency | UI fallback font. |
| **world-atlas**, **us-atlas** — Copyright Mike Bostock (Natural Earth / US Census data) | ISC | npm dependencies | Map shapes for map visuals. |
| **Vega**, **Vega-Lite**, **vega-embed** — Copyright University of Washington Interactive Data Lab | BSD-3-Clause | npm dependencies | Deneb / Vega custom visuals. |

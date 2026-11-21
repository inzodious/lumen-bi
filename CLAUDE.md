# Lumen

> Product name: **Lumen** (repo/package name `lumen-bi`; bundle extension `.wbi`).

Linux desktop Power BI workbench: opens PBIX / PBIT / PBIP (PBIR + TMDL), DAX engine, Power Query M engine,
modeling, Power BI–faithful visuals, rich export. Electron + React 19 + TypeScript + zustand.

Read `docs/ARCHITECTURE.md` before changing anything — it lists the contracts and their owners.

## Commands
- `npm run dev` (HMR app) · `npm run build` · `npm start` (preview build)
- `npm test` · `npx vitest run <path>` · `npm run typecheck`
- `npm run dist` (Linux AppImage + deb) · `npm run dist:win` (on Windows: NSIS installer + portable exe; CI uploads both)
- `scripts/capture.sh /abs/out.png ['#/route'] [path-to-open] [WxH]` — headless screenshot after `npm run build`
- `e2e/run.sh [--no-build] [filter]` — end-to-end UI journeys (Playwright Electron driver, private Xvfb display; builds into `out/e2e/`).
  `LUMEN_SAMPLES_DIR=<dir of Microsoft sample .pbix>` enables the sample-file journeys; failure screenshots/logs go to `$LUMEN_E2E_OUT` (default a temp dir).
  New UI features need a journey in `e2e/*.e2e.ts` (helpers in `e2e/harness.ts`; wait on `wbiReady`/`wbiBusy`/DOM, never fixed sleeps)
- `scripts/sweep.sh <file-or-folder> <outdir> [--sample-data]` — render every page of reports; `node scripts/sweep-summary.mjs <outdir>`
- `scripts/compare.sh <reference.png|.pdf> <report> <outdir> [--page p] [--sample-data --private] [--same-data]` — compare a Power BI screenshot / Export-to-PDF with Lumen's render, visual by visual (review page `<outdir>/index.html`; see `docs/COMPARE.md`)
- `LUMEN_IT=1 npx vitest run src/main/ipc/connectors` — live connector tests (Docker)
- `scripts/install-desktop.sh [--pin]` — desktop entry + file associations

## Conventions
- TypeScript strict. `src/core` is pure TS (no DOM, no Node APIs except `io/nodefs.ts` and tests) so it can run in a worker.
- Path aliases: `@core/*`, `@renderer/*`, `@shared/*`. Vendored engines (`src/core/dax`, `src/core/m`) use relative imports with `.ts` extensions; keep their style.
- Power BI fidelity first: match PBI Desktop's look (Segoe-like font, Fluent icons via `@fluentui/react-icons`, PBI colors) and semantics. When a feature is approximated, say so in a code comment and in the UI where it matters; never silently produce wrong numbers.
- Tests live next to code as `*.test.ts` (or `__tests__/`). Engines need tests for every function/feature added.
- VS Code terminals set `ELECTRON_RUN_AS_NODE=1`; npm scripts unset it. Run electron directly with `env -u ELECTRON_RUN_AS_NODE`.
- Do not run `npm install`/`npm uninstall` without coordinating: many workstreams share one `node_modules`.
- Private corpus: real PBIP reports reached only through `LUMEN_CORPUS_DIR` (read-only, confidential: never copy its content, names or paths into this repo; never decode its `.pbi/cache.abf` — tests block it via `tests/setup.ts`, app runs need `WBI_BLOCK_CACHE=1`).
- Public samples: Microsoft's sample `.pbix` files via `LUMEN_SAMPLES_DIR` (real data; the accuracy oracle).
- This repository is public: no client names, paths, hostnames or data anywhere in code, tests, docs or history.

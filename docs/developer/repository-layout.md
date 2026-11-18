# Repository layout

> **Applies to:** Developers

This article walks through every top-level folder of the repository and the important folders below them, says what
belongs where, and explains the path aliases and the import style of the vendored engines. Use it to find where a
change goes.

## Top level

| Path | What it holds |
|---|---|
| `src/` | The application: `core`, `main`, `preload`, `renderer`, `shared` (below). |
| `e2e/` | End-to-end UI journeys (`*.e2e.ts`), the Playwright harness (`harness.ts`), their vitest config and `run.sh`. See [End-to-end tests](end-to-end-tests.md). |
| `tests/` | `setup.ts` (the global vitest setup) and `support/`: shared test helpers, including a lakehouse library imported as `@parity/lakehouse` and M test helpers. |
| `datasets/` | A separate generator of seven fictional lakehouse datasets (Delta, CSV, TMDL model, PBIR report), with its own `README.md`, docs per dataset and tests. Run with `node datasets/src/node/cli.ts`; output goes to the ignored `datasets/out/`. |
| `scripts/` | Developer scripts: capture, sweep, compare, launcher, desktop install, font and icon generators, documentation checks. See [Scripts](../reference/scripts.md). |
| `docs/` | This documentation and the design notes it links to (`ARCHITECTURE.md`, `SWEEP.md`, `COMPARE.md`, `ICONS.md`, `VISUAL_DEFAULTS.md`, `BACKLOG.md`). |
| `resources/` | The app icon (`icon.png`, `icon.svg`) and licence texts of bundled icon sets (`licenses/icons/`). |
| `package.json` | Scripts, dependencies, and the `build` section for electron-builder. |
| `electron.vite.config.ts` | Build configuration of the three bundles (main, preload, renderer) and the path aliases. |
| `vitest.config.ts` | Unit test configuration: aliases, `tests/setup.ts`, the test file patterns. |
| `tsconfig.json` | One TypeScript project for `src`, `tests`, `datasets/src` and the configs; `strict: true`. |
| `THIRD_PARTY_NOTICES.md`, `LICENSE` | Licences. See [Dependencies and licences](dependencies-and-licences.md). |
| `CLAUDE.md` | Short project instructions for coding agents; the same rules as [Conventions](conventions.md). |

Build outputs are ignored by git (`.gitignore`): `out/` (electron-vite), `out/e2e/` (end-to-end build), `dist/`,
`release/`, `coverage/`, `datasets/out/`.

## src/core: pure TypeScript

Everything here runs without a DOM and without Node, so it works in the renderer, in vitest and (in principle) in a
worker. The one exception is `io/nodefs.ts`.

| Folder | Contents |
|---|---|
| `core/project.ts` | `ProjectDocument`: model + data + report + diagnostics + source. |
| `core/model/` | `types.ts` (`SemanticModel` and every model object), `data.ts` (`DataStore`, `TableData`, `Scalar`: the value representation contract). |
| `core/report/` | `types.ts` (`ReportDocument`, pages, visuals), `sq.ts` (SQ field expressions and filters), `literal.ts` (PBIR literals), `props.ts` (formatting property resolution), `entries.ts` (which objects entry a write goes to), `theme.ts` and `themes/` (base theme `CY24SU10.json`, built-in themes). See [The report document model](the-report-document-model.md). |
| `core/engine/` | `api.ts` (`QueryEngine` interface), `engine.ts` (`createEngine`, the adapter over `dax/tabular`), `sqtranslate.ts` (SQ filters to engine filters), `daxquery.ts`, `validate.ts`, `format.ts`. |
| `core/dax/tabular/` | The production DAX engine: lexer, parser, evaluator, function families (`fn-*.ts`), `registry.ts`, `fusion.ts`, `visualcalc.ts`, `window-order.ts`. See [DAX engine internals](dax-engine-internals.md). |
| `core/dax/*.ts` | The vendored reference DAX engine (see below). |
| `core/m/` | The Power Query M engine: `lexer.ts`, `parser.ts`, `interpreter.ts`, `values.ts`, `driver.ts`, and the library in `lib/`. See [M engine internals](m-engine-internals.md). |
| `core/data/` | Refresh (`refresh.ts`, `fetcher.ts`, `queries.ts`), the built-in sample (`sample*.ts`), the sample-data generator (`synthetic*.ts`), stand-ins (`standIns.ts`), Parquet and Excel readers. See [Data layer](data-layer.md). |
| `core/io/` | `open.ts` (`openProject`, `saveProject`), `pbip.ts`, `wbi.ts`, `diagramSidecar.ts`, `fs.ts` (`FileSystem` interface), `nodefs.ts`, and `pbix/` (container, DataMashup, and `datamodel/`: XPress9, ABF, VertiPaq, `metadata.sqlitedb`). |
| `core/pbir/` | PBIR folder read and write, legacy layout conversion (`legacy.ts`), schema URLs (`schemas.ts`), resources. |
| `core/tmdl/` | TMDL parser and writer, TMSL (`model.bim`), formatting hints that keep round-trips byte-identical. |
| `core/format/` | Power BI / Excel format strings (`format.ts`, `dates.ts`, `decimal.ts`). |
| `core/icons/` | Built-in icon references, curated lists, baking icons to pictures. See [Icons internals](icons-internals.md). |

## src/renderer: the user interface

`src/renderer/index.html` is the page; the code is under `src/renderer/src/`.

| Folder | Contents |
|---|---|
| `main.tsx` | Entry: fonts, sql.js wasm, global CSS, `Root`, sweep start. |
| `app/` | The shell: `App.tsx` (layout, route options, shortcuts), `Router.tsx` (hash routes), `commands.ts` (open, save, undo, sample data), `shellState.ts` (`useShell`), `readiness.ts`, `e2eHooks.ts`, `ribbon/`, `backstage/` (the **File** menu), `ui/` (menus, modals, dropdowns, colour picker, toasts), `themes/`, `sweep/`. |
| `state/` | `store.ts` (`useApp`: document, engine, undo / redo) and `interaction.ts` (`useInteraction`: runtime selections). See [State and store](state-and-store.md). |
| `report/` | The canvas: `ReportView.tsx`, `PageCanvas.tsx`, `VisualContainer.tsx`, `chrome.ts`, filters, bookmarks, drill and runtime APIs, snapping (`geometry.ts`), mobile layout (`mobile/`), and the canvas test harness (`dev/`). |
| `visuals/` | One folder per visual family (`charts/`, `tables/`, `cards/`, `slicers/`, `elements/`, `custom/`), shared helpers in `common/` (`query.ts`, `categorical.ts`, `fmtProps.ts`, `textStyle.ts`, conditional formatting), the contract (`contract.ts`), the registry (`registry.ts`) and the gallery (`gallery/`). See [Visual contract](visual-contract.md). |
| `panes/` | Data, Visualizations (Build, Format, Analytics; `visualizations/cf/` for conditional formatting), Filters, Selection, Bookmarks, Sync slicers, Performance analyzer. See [Format pane internals](format-pane-internals.md). |
| `views/` | `data/` (Table view), `model/` (diagram), `dax/` (DAX query view), `powerquery/` (Power Query Editor), `dev/` (the modeling test harness). |
| `dialogs/` | Get data, modeling dialogs, Options, Refresh, Export, Customize theme, Page settings. |
| `editors/` | The formula bar and the DAX and M editor languages (CodeMirror). |
| `export/` | PDF, PowerPoint, image and HTML export, and the print layout. |
| `icons/` | Icon sets, picker, glyph rendering. |
| `assets/fonts/` | Selawik and the derived "Lumen Sans Semibold", the stand-ins for Segoe UI. |
| `styles/` | Global CSS. |

## src/main, src/preload, src/shared

| Path | Contents |
|---|---|
| `src/main/index.ts` | Window creation, app IPC (dialogs, recent files, window, export), capture / sweep / end-to-end modes. |
| `src/main/menu.ts` | Native menu accelerators that send `menu:command` to the renderer. |
| `src/main/ipc/fs.ts` | Filesystem IPC handlers. |
| `src/main/ipc/connectors.ts` | SQL Server (tedious, Entra ID) and HTTP handlers; wires the connector service, credentials (`cred:*`) and shares (`shares:*`). |
| `src/main/ipc/connectors/` | One file per connector (`pg.ts`, `mysql.ts`, `sqlite.ts`, `duckdb.ts`, `firestore.ts`, `s3.ts`, `shares.ts`), `service.ts`, `credstore.ts`, `oauth.ts`, `common.ts`, live tests in `__tests__/`. See [Connectors](connectors.md). |
| `src/preload/index.ts` | Builds the `window.wbi` object from IPC channels. |
| `src/shared/host.ts` | The `WbiHost` interface: the contract between preload and renderer. |
| `src/shared/cacheGuard.ts` | The `WBI_BLOCK_CACHE` guard shared by main, preload and tests. |

## Where tests go

Tests live next to the code as `*.test.ts` / `*.test.tsx`, or in a `__tests__/` folder beside it. vitest picks up
`src/**/*.test.ts(x)`, `tests/**/*.test.ts`, `datasets/**/*.test.ts` and `scripts/**/*.test.mjs`
(`vitest.config.ts`). End-to-end journeys are `e2e/*.e2e.ts` and run only through `e2e/run.sh`. See
[Testing](testing.md).

## Path aliases

Defined twice, identically: in `tsconfig.json` (for the type checker) and in `electron.vite.config.ts` /
`vitest.config.ts` (for bundling and tests).

| Alias | Points to |
|---|---|
| `@core/*` | `src/core/*` |
| `@renderer/*` | `src/renderer/src/*` |
| `@shared/*` | `src/shared/*` |
| `@parity/lakehouse`, `@parity/lakehouse/node` | `tests/support/lakehouse/index.ts`, `node-entry.ts` (tests only) |

Renderer code imports core as `@core/engine/api`; code inside `src/core` uses relative imports.

## The vendored engines' import style

`src/core/dax/` and `src/core/m/` were vendored from an earlier project (their comments call it "Parity") and keep
that project's style: relative imports **with** the `.ts` extension, which `tsconfig.json` allows through
`allowImportingTsExtensions`. For example, `src/core/dax/tabular/registry.ts`:

```ts
import type { Filter, FilterContext } from './filters.ts'
```

Keep this style when you edit files in those folders; use extension-less imports elsewhere.

## Considerations and limitations

- `src/core/dax/*.ts` (the reference engine) and `src/core/dax/tabular/` (the production engine) sit side by side.
  Only `tabular` runs behind `createEngine`; check which one a file belongs to before you change it.
- `e2e/` has its own `tsconfig.json`, which `npm run typecheck` does not include. Check journeys with
  `npx tsc --noEmit -p e2e/tsconfig.json`.
- `datasets/` is independent of the app: the app does not import it. `tsconfig.json` type-checks it, and `src/core/data/__tests__/refresh.test.ts` runs its CLI to test refresh end to end.

## Related content

- [Architecture overview](architecture-overview.md)
- [Conventions](conventions.md)
- [Development environment](development-environment.md)
- [Testing](testing.md)
- [Scripts](../reference/scripts.md)

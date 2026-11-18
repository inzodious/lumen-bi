# Conventions

> **Applies to:** Developers

This article lists the rules every change to Lumen follows: language settings, the purity of `src/core`, where
tests go, the "Power BI fidelity first" principle, how approximations are declared, how contracts change, and the
rules that keep a public repository free of private data. Reviewers check these; read them before your first change.

## TypeScript

- **Strict mode.** `tsconfig.json` sets `strict`, `noImplicitOverride` and `noFallthroughCasesInSwitch`.
  `npm run typecheck` (`tsc --noEmit -p tsconfig.json`) must pass. It does not cover `e2e/`, which has its own
  `e2e/tsconfig.json`: check journeys with `npx tsc --noEmit -p e2e/tsconfig.json`.
- **ES modules everywhere** (`"type": "module"`), target ES2023, bundler module resolution.
- **Path aliases** `@core/*`, `@renderer/*`, `@shared/*` outside `src/core`; relative imports inside it. The vendored
  engines in `src/core/dax` and `src/core/m` use relative imports **with** `.ts` extensions; keep their style. See
  [Repository layout](repository-layout.md#the-vendored-engines-import-style).
- **Untyped PBIR JSON is allowed.** Report JSON is kept exactly as Power BI wrote it, so code that reads it often
  types it as `any` (for example `getProjections(visualJson: any)` in `src/renderer/src/visuals/common/query.ts`).
  Read it through the helpers in `src/core/report/` (`props.ts`, `sq.ts`, `literal.ts`) rather than walking it by
  hand.

## `src/core` stays pure

Code in `src/core` must run without a DOM and without Node: no `document`, `window`, `fs` or `path` imports.
This lets the same code run in the renderer, in vitest under Node and, if needed, in a web worker. The exceptions:

- `src/core/io/nodefs.ts`, the Node implementation of the `FileSystem` interface (`src/core/io/fs.ts`), used by
  tests and scripts;
- test files.

Anything that needs the operating system goes through an interface that the renderer fills from `window.wbi`, for
example `FileSystem` for files and the M engine's host for connectors.

## Tests next to code

- A test lives beside the code it tests as `name.test.ts` / `name.test.tsx`, or in a `__tests__/` folder in the
  same directory.
- Engines need a test for every function or feature you add: a new DAX function, M library function or
  query-shape change comes with tests that pin its results.
- New UI features need an end-to-end journey in `e2e/*.e2e.ts`. Journeys wait on readiness signals
  (`wbiReady`, `wbiBusy`), DOM conditions or store state, **never** fixed sleeps. See
  [End-to-end tests](end-to-end-tests.md).

## Power BI fidelity first

Lumen's goal is to look and behave like Power BI Desktop. When you build or change something:

1. Find what Power BI does: the visual's capabilities and format properties, the theme's `visualStyles`, Power BI
   Desktop's rendering. The property names and value shapes in PBIR JSON are the contract.
2. Use Power BI's look: the Segoe UI stand-in fonts (`src/renderer/src/assets/fonts/`), Fluent icons from
   `@fluentui/react-icons`, Power BI's colours.
3. Resolve every formatting property through `src/core/report/props.ts` so theme defaults apply as in Power BI.
4. Where a default is not documented, record the evidence for the value you pick. See
   [Fidelity workflow](fidelity-workflow.md) and [VISUAL_DEFAULTS.md](../VISUAL_DEFAULTS.md).

## Approximations are declared, never silent

When Lumen cannot reproduce Power BI exactly, it says so:

- **In a code comment** at the place that approximates, starting with "Approximation" or naming what differs. For
  example, the header of `src/renderer/src/visuals/elements/QnaVisual.tsx`:

  ```ts
  * Approximation: the language understanding is Lumen's small rule-based grammar (see ./qna/parse.ts),
  * not the Power BI Q&A service — it covers aggregations, grouping, top/bottom N, sorting, value and
  * numeric filters and explicit visual types, and says so when it doesn't understand a word.
  ```

- **In the UI** where a user could be misled. The key influencers visual
  (`src/renderer/src/visuals/charts/misc/keyInfluencers/KeyInfluencers.tsx`) shows "Statistical approximation (not
  Power BI's AI model)", and a test (`charts/misc/__tests__/render.test.tsx`) keeps that label in place.
- **Never as wrong numbers.** If a calculation cannot be done faithfully, show an error or a blank with a reason,
  not a plausible-looking value. Engines raise errors for unsupported functions instead of guessing.

## Contracts change additively

The files listed under "Contracts" in [ARCHITECTURE.md](../ARCHITECTURE.md) (`SemanticModel`, `DataStore`,
`ReportDocument`, `QueryEngine`, `WbiHost`, `VisualDefinition` and the others) are used across the code base.

- **Additive changes are fine:** a new optional field, a new optional method, a new union member that existing
  code can ignore.
- **Breaking changes** (renaming, removing, changing a type or a meaning) need agreement first and must be called
  out in the pull request description.

## File formats round-trip

- Report JSON is mutated in place and written back as it was read; untouched files save byte-identically.
- Lumen-only data goes into clearly named extensions (for example the `lumenLayout` report object or the
  `diagramLayout.lumen.json` sidecar), written only when non-default, so a report that does not use the feature is
  unchanged. See [Saving and round-trip](saving-and-round-trip.md).

## Public repository: no private data

The repository is public. Nothing that belongs to a third party, an employer or a client may enter it, in code,
tests, fixtures, documentation, screenshots or commit history.

- **Tests use invented fixtures.** Build small models and reports in the test, or use the built-in sample
  (`src/core/data/sample*.ts`) and the fictional datasets in `datasets/`.
- **Never commit third-party report content.** Microsoft's public sample `.pbix` files are reached through
  `LUMEN_SAMPLES_DIR` and stay outside the repository; your own reports through `LUMEN_CORPUS_DIR`. Tests that use
  them assert generic properties (it parses, it round-trips, it evaluates) and print no names or values from them.
- **No names, paths, hostnames, connection strings, tenant or object ids** in code, comments, test names or docs.
  When a triage note needs to refer to a private report, use a neutral label (for example `C01`), as
  [SWEEP.md](../SWEEP.md) does.
- **Cached data stays sealed.** `tests/setup.ts` sets the global `__LUMEN_BLOCK_CACHE_ABF__` so no test decodes a
  PBIP `.pbi/cache.abf` file; run the app with `WBI_BLOCK_CACHE=1` on projects whose data must not be read.
- **Screenshots** in docs show only the built-in sample or invented data.

## Dependencies

Adding or removing an npm package changes `package.json` and `package-lock.json` for everyone. Explain why in the
pull request, prefer packages that are maintained and permissively licensed, and record bundled assets or ported code
in `THIRD_PARTY_NOTICES.md`. See [Dependencies and licences](dependencies-and-licences.md).

## Related content

- [Contributing](contributing.md)
- [Testing](testing.md)
- [Fidelity workflow](fidelity-workflow.md)
- [Repository layout](repository-layout.md)
- [ARCHITECTURE.md](../ARCHITECTURE.md)

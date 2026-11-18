# Developer documentation

> **Applies to:** Developers

These articles are for people who read Lumen's code, extend it or contribute to it: how the app is built, the
contracts between its parts, the DAX and M engines, the file formats, the visuals, and the tools that keep it
faithful to Power BI. They assume you know TypeScript and React; they explain the Power BI concepts the code depends
on. Start with the orientation articles, set up your environment, then go to the part you want to change.

## Orientation

| Article | Type | What you learn |
|---|---|---|
| [Architecture overview](architecture-overview.md) | Concept | Processes, layers and the path from a file to pixels |
| [Repository layout](repository-layout.md) | Concept | Every folder, path aliases, the vendored engines' style |
| [Set up a development environment](development-environment.md) | How-to | From a clone to a running build and green tests |
| [Conventions](conventions.md) | Concept | The rules every change follows |

## Contracts and state

| Article | Type | What you learn |
|---|---|---|
| [State and store](state-and-store.md) | Concept | zustand stores, mutations, undo and redo, sidecars, dialogs |
| [The report document model](the-report-document-model.md) | Concept | Pages, visual containers, objects and selectors, property resolution |
| [Themes and text classes](themes-and-text-classes.md) | Concept | Theme resolution, `visualStyles`, the base theme |
| [The host bridge and IPC](the-host-bridge-and-ipc.md) | Concept | `window.wbi`, preload, IPC handlers, connector requests |

## Visuals

| Article | Type | What you learn |
|---|---|---|
| [Visual contract](visual-contract.md) | Concept | `VisualDefinition`, data roles, format properties, the registry |
| [Tutorial: add a visual](tutorial-add-a-visual.md) | Tutorial | A complete small visual, from definition to end-to-end journey |
| [Visual query pipeline](visual-query-pipeline.md) | Concept | From field wells to engine queries to rows |
| [Container chrome and text](container-chrome-and-text.md) | Concept | Titles, borders, headers, fonts and text measurement |
| [Format pane internals](format-pane-internals.md) | Concept | Property model, effective values, controls, conditional formatting |
| [Icons internals](icons-internals.md) | Concept | Built-in icon sets, binding and baking |

## Engines and data

| Article | Type | What you learn |
|---|---|---|
| [DAX engine internals](dax-engine-internals.md) | Concept, how-to | Parser, evaluator, storage, optimisations, adding a function |
| [M engine internals](m-engine-internals.md) | Concept, how-to | Lexer, parser, evaluator, the driver, folding, adding a library function |
| [Data layer](data-layer.md) | Concept | `DataStore`, refresh, fetcher, cancellation, sample data |
| [Connectors](connectors.md) | Concept, how-to | Connectors in the main process, credentials, OAuth, adding a connector |

## File formats

| Article | Type | What you learn |
|---|---|---|
| [File format IO](file-format-io.md) | Concept | PBIX, PBIT, PBIP / PBIR / TMDL, `.wbi`, sidecars |
| [Saving and round-trip](saving-and-round-trip.md) | Concept | What a save writes, what Lumen adds, schema validation status |

## Quality

| Article | Type | What you learn |
|---|---|---|
| [Testing](testing.md) | Concept, how-to | vitest layout, setup, fixtures, oracle and performance tests |
| [End-to-end tests](end-to-end-tests.md) | Concept, how-to | The harness, readiness signals, writing a journey |
| [The sweep](the-sweep.md) | Overview | Rendering every page of reports and triaging visuals |
| [The compare tool](the-compare-tool.md) | Overview | Comparing Lumen's render with Power BI, visual by visual |
| [Fidelity workflow](fidelity-workflow.md) | How-to | Investigating a rendering difference |
| [Performance](performance.md) | Concept | Performance analyzer internals and performance budgets |
| [Debugging](debugging.md) | How-to | Developer tools, logs, headless capture, common failures |

## Project

| Article | Type | What you learn |
|---|---|---|
| [Build and packaging](build-and-packaging.md) | Concept | Build outputs, launcher, desktop integration, packages |
| [Dependencies and licences](dependencies-and-licences.md) | Reference | npm dependencies, licences, bundled assets |
| [Contribute a change](contributing.md) | How-to | Branches, commits, pull requests, review checklist |
| [Roadmap and known gaps](roadmap-and-known-gaps.md) | Concept | What Lumen does not do, approximates or gets wrong |

## Reference

| Article | What it lists |
|---|---|
| [Command line and environment variables](../reference/command-line-and-environment.md) | Launch arguments, every environment variable, route options |
| [Scripts](../reference/scripts.md) | Every script in `scripts/` and `e2e/run.sh` |
| [DAX function support](../reference/dax-function-support.md) | DAX functions the engine implements |
| [M function support](../reference/m-function-support.md) | Power Query M library functions |
| [Visual support](../reference/visual-support.md) | Visual types and their support level |

## Design notes

These files predate this documentation set and are referenced from the code; they hold detailed notes and logs.

| File | Content |
|---|---|
| [ARCHITECTURE.md](../ARCHITECTURE.md) | Contracts, key semantics, subsystems, the model diagram sidecar |
| [SWEEP.md](../SWEEP.md) | The sweep in detail and its triage log |
| [COMPARE.md](../COMPARE.md) | The compare tool's scores and how far to trust them |
| [ICONS.md](../ICONS.md) | Built-in icon sets and how icons are stored |
| [VISUAL_DEFAULTS.md](../VISUAL_DEFAULTS.md) | Power BI defaults Lumen uses, with their evidence |
| [BACKLOG.md](../BACKLOG.md) | Requested features and follow-ups |

## Related content

- [Documentation home](../README.md)
- [Architecture overview](architecture-overview.md)
- [Set up a development environment](development-environment.md)
- [CONTRIBUTING.md](../../CONTRIBUTING.md)

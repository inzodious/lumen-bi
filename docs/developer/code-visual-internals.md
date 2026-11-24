# Code visual internals

> **Applies to:** Developers

This article explains how the [code visual](../visuals/code-visual.md) works: where the author's code runs and why it
cannot reach the app, how data and interactions cross the frame boundary, how drill and selection plug into the
native machinery, and how the code is saved. Read it before you change anything under `src/core/codevisual`,
`src/renderer/src/visuals/code`, `src/renderer/codeframe` or `src/main/codeFrame.ts`.

## Overview

| Part | Location | Runs in |
|---|---|---|
| Model, template evaluator, CSS variables, protocol, storage, drill text, starter templates | `src/core/codevisual/` | Pure TypeScript (renderer, tests) |
| Visual definition, data query, frame host, editor, insert flow | `src/renderer/src/visuals/code/` | App renderer |
| Frame runtime and React bundle | `src/renderer/codeframe/` (`frame.ts`, `react.ts`, `frame.html`) | The sandboxed frame |
| `lumen-frame:` scheme, CSP, navigation guard | `src/main/codeFrame.ts` | Main process |
| Frame build | `codeFramePlugin` in `electron.vite.config.ts` | Build |

The path of one render:

1. The visual component (`CodeVisual.tsx`) queries its wells with `queryCodeData()` (`codeModel.ts`), through the same
   engine, filters, highlight filters and drill state as a native visual, and builds `CodeData` (`core/codevisual/types.ts`).
2. In the app renderer it evaluates the HTML template (`core/codevisual/template.ts`), sanitizes the output
   (`sanitize.ts`, DOMPurify), and computes the CSS variables (`core/codevisual/cssvars.ts`). JSX, if any, is transpiled
   in the app renderer with Sucrase (`transpile.ts`, a lazy chunk).
3. It posts one `render` message to the frame with the HTML, the author's CSS, the variables, the theme, the
   transpiled JSX and the registered images the code references.
4. The frame runtime (`codeframe/frame.ts`) writes the HTML or mounts the React component into `#lumen-root`, waits for
   a paint and answers `rendered`. The visual then releases its readiness hold (`useReadyHold`, see
   [Visual contract](visual-contract.md)), so exports and captures include it.

## Isolation

The author's code is untrusted: a report from someone else can contain any code. The design gives it no way out.

- **Sandboxed iframe.** `<iframe sandbox="allow-scripts">` without `allow-same-origin`: the frame has an opaque origin,
  so `window.parent` / `top` are cross-origin (no DOM, no `window.wbi`, no store), and it has no storage, cookies,
  popups, forms or top navigation. The frame is not given `nodeIntegration`; there is no `require` or `process`.
- **Privileged scheme.** A sandboxed (opaque-origin) frame cannot load `file:` or `blob:` resources, so the main
  process registers `lumen-frame:` (standard, secure, CORS-enabled) and serves `frame.html`, `frame.js`, `react.js`
  and the font files from the build output. Only these paths and the hosts `code` and `jsx-<id>` are served.
- **CSP on every response** (`CODE_FRAME_CSP`): `default-src 'none'`; scripts from `lumen-frame:` plus
  `'unsafe-eval'` (the transpiled JSX runs through `new Function`); inline styles; images from `data:` and `blob:`;
  fonts from `lumen-frame:` and `data:`; `connect-src`, `media-src`, `frame-src`, `worker-src`, `object-src`,
  `form-action`, `base-uri` and `manifest-src` all `'none'`. There is no network of any kind.
- **Navigation guard.** `guardFrameNavigation()` (main process, `will-frame-navigate`) cancels any sub-frame
  navigation to a URL outside `lumen-frame:`, `about:`, `blob:` and `data:`. The template's HTML is sanitized
  (DOMPurify: no scripts, event handlers, `<meta>`, `<base>`, `<form>` actions or `javascript:` URLs), and the frame
  runtime prevents link and form defaults.
- **Process isolation for JSX.** HTML-only visuals share the host `lumen-frame://code/`; a visual with JSX gets
  `lumen-frame://jsx-<random>/`, which site isolation puts in its own renderer process. An infinite loop stalls only
  that process.
- **Watchdog.** `CodeFrameHost` (`frameHost.ts`) expects `rendered` within 8 s of a render and a `pong` within 4 s of
  each `ping` (sent every 4 s). Otherwise it removes the frame (ending its process) and the visual shows an error with
  **Run again**.
- **The app's own CSP** allows `frame-src lumen-frame:` and nothing else new.

`e2e/codevisual-security.e2e.ts` opens a hostile report (a `.wbi` built from the sample with probing code) and checks
every route: parent DOM, `window.wbi`, the store, `require`, `process`, storage, cookies, `window.open`, workers,
`fetch`, XHR, WebSocket, `sendBeacon`, remote images, meta refresh and self-navigation, a fixed full-window overlay,
and a runaway loop. A local HTTP server in the test counts requests; it must see none.

## Message protocol

`core/codevisual/protocol.ts` defines protocol `lumen-code-visual/1` and validates both directions.

- Every frame host has a random token (`newToken()`), handed to the frame with its first render after `boot`. Frame
  messages carry the token and a strictly
  increasing sequence number `n`; `ReplayGuard` drops anything else. The host also checks `event.source` (the frame's
  `contentWindow`) and the origin (`'null'`).
- `validateFrameMessage()` checks the shape of each message type and its sizes (64 KB per message, 5,000 row keys,
  4,000 characters per text, 40 tooltip lines) and returns a fresh, typed copy; anything malformed returns `null`.
  Row references are keys the host issued in the last render; unknown keys are ignored.
- Host → frame: `render`, `pointer` (edit-mode pointer forwarding), `ping`. Frame → host: `boot`, `rendered`, `error`
  (with phase, line and column), `select`, `clear`, `tooltip`, `tooltipHide`, `menu`, `drill`, `drillUp`, `expand`,
  `nextLevel`, `pong`.

In edit mode the canvas needs the pointer for selecting and moving the visual, so an overlay covers the frame and
forwards clicks, moves and wheel events as `pointer` messages; the frame runtime hit-tests them, applies the
declarative attributes, and marks the hovered chain with `data-lumen-hover` (author `:hover` rules are rewritten to
`:is(:hover,[data-lumen-hover])`).

## Data and names

`queryCodeData()` builds one query from the wells: **Rows** (`Category` role) as grouping, **Values** (`Y`) and
**Tooltips** as measures or aggregations, with the visual's sort, the row limit (+1 to detect truncation) and a second
query for the grand totals. With a highlight filter from another visual it adds the highlighted values to each cell.
When levels are expanded ("expand all down one level") the rows form a tree; each row carries `depth`, the keys of its
parents and `canDrill`.

Names: `core/codevisual/naming.ts` derives the CSS name (`cssName`, kebab case) and JavaScript name (`jsName`, camel
case) of every field and parameter, numbering collisions and avoiding the reserved variable names. The template
context (`context.ts`) exposes fields by display name and by JavaScript name, plus `measure1`…, `value1`… and
`category`.

Row identity: each row's key is built from its grouping values, so it stays the same across renders while the row
exists. The host keeps a map from key to `DataPointIdentity`; selection, tooltips, the context menu and drill all go
through it.

## Interaction

- **Selection** calls the host context's `select(ids, { multi })`: the page cross-filters or cross-highlights exactly
  as for a native visual's data point, bookmarks capture it, and **Clear** works.
- **Incoming highlight**: the definition's `highlightsFor(json)` answers true when the visual has **Rows**, so the
  canvas passes another visual's selection as `highlightFilters`; with measures only, the visual is filtered like a
  card.
- **Drill**: `supportsDrill` with the **Rows** role `drillable` gives the native header icons and menu entries.
  Author-initiated drills (`drill`, `drillUp`, `expand`, `nextLevel`) run `drillOps.ts`, which produces the same
  `DrillState` the header does and calls `setDrill`. `report/runtime.ts` `setDrill` also writes the state into the
  visual's JSON (`lumenCode.drill`, text from `core/codevisual/drill.ts`) for code visuals, as one undo step, so it is
  saved and survives reopening. Native visuals keep drill state at runtime only.

## Storage

In memory and in `.wbi` bundles, everything is in the visual's `objects` (`core/codevisual/model.ts`):

| Object | Properties |
|---|---|
| `lumenCode` | `version` (`1L`), `html`, `css`, `jsx` (text literals), `params` (JSON text of the parameter definitions), `drill` (JSON text of the drill state) |
| `lumenParams` | One property per parameter value (colours as `solid.color`) |
| `lumenCodeFormat` | `overflow`, `defaultSort`, `rowLimit`, `rowTooltips` |

The `visualType` is `lumenCodeVisualC0DE5A1E7B3F4E2A9D6C8B1F0E4A7D3C`, in the shape of a custom visual ID so that
tools that look up custom visuals treat it as one.

In a PBIR folder (PBIP), `externalizeCode()` (`core/codevisual/storage.ts`, called from `core/pbir/pbir.ts`) moves the
code into files beside `visual.json` and leaves an index; `internalizeCode()` reverses it on open. For example, a
visual with a template and a stylesheet:

```text
definition/pages/ReportSection/visuals/a1b2c3d4e5f6a7b8c9d0/
  visual.json      "lumenCode": [{ "properties": { "version": …, "files": { "expr": { "Literal": { "Value": "'{\"html\":\"code.html\",\"css\":\"code.css\"}'" } } } } }]
  code.html        <div class="tile">{{measure1}}</div>
  code.css         .tile { font-size: clamp(20px, 22cqmin, 56px); }
```

Only layers in use get a file; removing the JSX deletes `code.jsx` on the next save, and an unchanged visual is not
rewritten. The saved `visual.json` validates against Microsoft's `visualContainer` 2.4.0 schema.

What Power BI Desktop does with this visual is **not verified**. The expected behaviour, from how it treats unknown
custom visual types, is an empty container with a message that the visual can't be displayed, with the container and
the fields intact. Whether it accepts, keeps or removes the extra files in the visual folder is not known.

## Build

`codeFramePlugin` in `electron.vite.config.ts` builds `src/renderer/codeframe` with a nested Vite build into IIFE
bundles: `codeframe/frame.js` (about 35 KB: runtime, template-free, uses `core/format` for `format()`) and
`codeframe/react.js` (about 220 KB, React 19 production, loaded only by JSX frames), plus `frame.html` and the six
Segoe UI stand-in fonts (`codeframe/fonts/*.woff2`). In development it writes the same files to `out/renderer/codeframe`.
The editor (CodeMirror with the HTML and CSS languages) and Sucrase are lazy chunks of the app renderer.

## Tests

| Test | Covers |
|---|---|
| `src/core/codevisual/codevisual.test.ts` | Template parsing, escaping, helpers, errors with positions; CSS variable names and values; protocol validation and replay; storage; drill text; parameters |
| `src/renderer/src/visuals/code/codeVisual.test.tsx` | Data shape, highlights, selection identity, sanitizer, CSS checks, transpile error mapping |
| `src/core/io/__tests__/codevisual.test.ts` | PBIP files beside `visual.json`, untouched re-save, JSX removal, `.wbi` round trip |
| `e2e/codevisual.e2e.ts` | Insert, bind, editor, undo, parameters, container queries, cross-filter both ways, drill, save and reopen, PDF export |
| `e2e/codevisual-security.e2e.ts` | The isolation probes above and the watchdog |
| `e2e/codevisual-docs.e2e.ts` | Both tutorials, step by step; with `LUMEN_DOCS_IMAGES=1` it writes the documentation screenshots |
| `e2e/codevisual-shots.e2e.ts` | With `LUMEN_E2E_SHOTS=<dir>`, every template at three sizes in light and dark |

## Considerations and limitations

- One renderer process per JSX visual. Opening a page with a dozen code visuals takes about 0.3 to 0.7 s longer than
  the same page of cards (frame creation); cross-filter updates are as fast.
- The frame cannot ask the host to resize the visual; size flows one way (host to frame).
- A drill state applied from a bookmark is shown but not written to `lumenCode.drill` until the next drill action.
- Report-page tooltips and drillthrough from a code visual's rows are not implemented.
- No static picture is saved for Power BI Desktop.

## Related content

- [Code visual API reference](../reference/code-visual-api.md)
- [Visual contract](visual-contract.md)
- [Visual query pipeline](visual-query-pipeline.md)
- [Saving and round-trip](saving-and-round-trip.md)
- [End-to-end tests](end-to-end-tests.md)

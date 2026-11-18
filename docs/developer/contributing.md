# Contribute a change

> **Applies to:** Developers

This how-to describes the path from an idea to a merged change: branches, commits, the checks to run, what a
pull request should say and what reviewers look for. It describes the conventions visible in the project's history.

## Prerequisites

- A working development environment: [Set up a development environment](development-environment.md).
- You have read [Conventions](conventions.md) and the part of the [Architecture overview](architecture-overview.md)
  your change touches.
- For a rendering change, the [Fidelity workflow](fidelity-workflow.md).

## Steps

1. **Start from an up-to-date `main` and create a branch.** Name it after the kind of change and the area:

   ```bash
   git switch main && git pull
   git switch -c fix/slicer-dropdown-width
   ```

   Branch prefixes in use: `fix/`, `feat/`, `docs/`. Larger efforts gather several branches on an `integrate/…`
   branch before they reach `main`.

2. **Find the owner of what you change.** The contract tables in [ARCHITECTURE.md](../ARCHITECTURE.md) name the
   file that owns each concept. Prefer changing the owner over working around it in a caller, and keep contract
   changes additive.

3. **Write the test first, or alongside.** Unit tests go next to the code (`*.test.ts`). Engine functions need a
   test per function or feature. A new or changed UI feature needs an end-to-end journey in `e2e/*.e2e.ts`. See
   [Testing](testing.md) and [End-to-end tests](end-to-end-tests.md).

4. **Make the change.** Keep `src/core` free of DOM and Node APIs. State approximations in a code comment and, where
   a user could be misled, in the UI.

5. **Run the checks.**

   ```bash
   npm run typecheck
   npm test
   npx tsc --noEmit -p e2e/tsconfig.json   # when you touched e2e/
   e2e/run.sh <filter>                      # the journeys of the area you changed
   ```

   For rendering changes, also look at the result: `scripts/capture.sh` for one view, `scripts/sweep.sh` for whole
   reports. If you have Microsoft's public sample files, run the oracle tests with `LUMEN_SAMPLES_DIR` set.

6. **Commit in logical steps.** Use the message style of the history (below).

7. **Open a pull request** against `main` with a description that a reviewer can check (below).

## Commit messages

The history uses a Conventional Commits style:

```text
<type>(<scope>[,<scope>]): <what changed, from the user's point of view>

<body: what was wrong or missing, why, what the change does, and how it is tested>
```

- **Types** seen in the history: `fix`, `feat`, `docs`, `test`.
- **Scopes** name the area: `cards`, `charts`, `tables`, `slicers`, `format`, `icons`, `chrome`, `export`,
  `sample-data`, `model-view`, `data`, `refresh`, `compare`, `e2e`, and so on; several are joined with a comma, as in
  `fix(cards,tables): …`.
- **Subject** in lower case, no final full stop, describing the behaviour (`fix(format): edits reach the
  { id: 'default' } entry the visual reads`) rather than the code.
- **Body** wrapped at about 100 characters. It explains the cause, the fix and the tests (for example "e2e: a
  data-image card takes an icon via the Format pane, saves, reopens"). Bullet lists are fine for multi-part changes.

## The pull request

Describe:

- the problem, with steps to reproduce for a bug;
- what you changed and why there, naming the owning files;
- how you tested it: unit tests, journeys, captures (attach before and after images for visual changes, made from
  the built-in sample or invented data only);
- any approximation you introduced and where the UI says so;
- any contract change, called out prominently, and any new dependency with its licence.

## Review checklist

Reviewers check, and you can check first:

- [ ] `npm run typecheck` and `npm test` pass; journeys of the touched area pass.
- [ ] New behaviour has tests next to the code; new UI has an end-to-end journey that waits on readiness signals,
      not sleeps.
- [ ] `src/core` imports no DOM or Node API (apart from `io/nodefs.ts` and tests).
- [ ] Formatting is resolved through `src/core/report/props.ts`, and Format pane writes go through the entry rule in
      `src/core/report/entries.ts`.
- [ ] Untouched files still save byte-identically; Lumen-only data is written only when non-default.
- [ ] Approximations are stated in a comment and, where it matters, in the UI; no silently wrong numbers.
- [ ] Contract changes are additive or explicitly agreed.
- [ ] No private data: no third-party report content, names, paths, hostnames or ids in code, tests, fixtures,
      screenshots or the commit messages.
- [ ] New dependencies, fonts, icons or ported code are justified and listed in `THIRD_PARTY_NOTICES.md` where
      they are bundled.
- [ ] Documentation that describes the changed behaviour is updated (this `docs/` tree, and
      [ARCHITECTURE.md](../ARCHITECTURE.md) when a contract or subsystem changes).

## Considerations and limitations

- The repository has no continuous-integration configuration (no `.github/` folder). The checks above run on your
  machine; say in the pull request which ones you ran.
- Optional test layers (`LUMEN_SAMPLES_DIR`, `LUMEN_CORPUS_DIR`, `LUMEN_IT`) need data or Docker that a contributor
  may not have. Say which layers you could not run.
- Nothing is tested on Windows or macOS, and saved files are not tested in Power BI Desktop. If you can check a
  saved file in Power BI Desktop, report the result in the pull request.

## Related content

- [Conventions](conventions.md)
- [Testing](testing.md)
- [End-to-end tests](end-to-end-tests.md)
- [Fidelity workflow](fidelity-workflow.md)
- [Roadmap and known gaps](roadmap-and-known-gaps.md)

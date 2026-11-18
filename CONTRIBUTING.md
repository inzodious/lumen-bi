# Contributing to Lumen

Thank you for your interest in Lumen. The developer documentation covers everything you need, from a fresh clone to
a merged change:

1. [Set up a development environment](docs/developer/development-environment.md): Node.js 20.19 or later,
   `npm install`, `npm run dev`, `npm test`.
2. [Conventions](docs/developer/conventions.md): strict TypeScript, a pure `src/core`, tests next to code,
   Power BI fidelity first, approximations stated, no private data in this public repository.
3. [Architecture overview](docs/developer/architecture-overview.md) and
   [ARCHITECTURE.md](docs/ARCHITECTURE.md): processes, layers and the contracts that own each concept.
4. [Contribute a change](docs/developer/contributing.md): branches, commit messages, pull requests and the review
   checklist.

All developer articles are listed in the [developer documentation hub](docs/developer/README.md).

## In short

- Branch from `main` (`fix/…`, `feat/…`, `docs/…`).
- Run `npm run typecheck` and `npm test`; for UI changes add and run an end-to-end journey (`e2e/run.sh <filter>`).
- Write commit messages as `type(scope): what changed` with a body that explains why and how it is tested.
- Never commit third-party report content, client names, paths, hostnames or ids. Tests use invented fixtures.

Lumen is released under the [MIT licence](LICENSE). Lumen is an independent project and is not affiliated with or
endorsed by Microsoft.

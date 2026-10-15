# Contributing

Thanks for helping improve Dory (دوري)!

## Workflow

1. Fork and create a branch: `git checkout -b feat/short-description`
2. Keep business logic in `src/core` — pure TypeScript, no React imports — and add tests in `tests/`.
3. Run `npm run check` and `npm run test:rules` before pushing.
4. Open a pull request describing **what** changed and **why**, with screenshots for UI changes.

## Conventions

- **Commits:** [Conventional Commits](https://www.conventionalcommits.org) (`feat:`, `fix:`, `docs:`, `refactor:`, `test:`).
- **UI copy:** Egyptian Arabic, short and friendly. Use the shared components in `src/ui`.
- **RTL:** never hard-code `left`/`right` for layout; prefer `start`/`end` and `flexDirection: 'row'` (flipped automatically).
- **Data:** every multi-document write is one batch/transaction in `src/data`; any new collection or field needs a matching rule in `firestore.rules` **and** a test in `tests-rules/`.
- **Logic:** timeline/payment math lives in pure functions in `src/core` with tests.

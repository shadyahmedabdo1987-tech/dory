# Contributing

Thanks for helping improve Gam3eya!

## Workflow

1. Fork and create a branch: `git checkout -b feat/short-description`
2. Keep business logic in `src/core` — pure TypeScript, no React imports — and add tests in `tests/`.
3. Run `npm run check` (typecheck + tests) before pushing.
4. Open a pull request describing **what** changed and **why**, with screenshots for UI changes.

## Conventions

- **Commits:** [Conventional Commits](https://www.conventionalcommits.org) (`feat:`, `fix:`, `docs:`, `refactor:`, `test:`).
- **UI copy:** Egyptian Arabic, short and friendly. Use the shared components in `src/ui`.
- **RTL:** never hard-code `left`/`right` for layout; prefer `start`/`end` and `flexDirection: 'row'` (flipped automatically).
- **State:** immutable updates only; store actions call the pure functions in `src/core`.

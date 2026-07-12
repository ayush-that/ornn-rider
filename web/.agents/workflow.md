# Workflow

## Commands

- `vpr build`: Only for build/bundler issues or verifying production output
- `vpr lint`: Covers both type-aware linting and type checking. No need to run `tsc --noEmit`
- `vpr dev` runs indefinitely in watch mode
- `vpr db` for Drizzle Kit commands (e.g. `vpr db generate` to generate a migration)

Don't build after every change. If lint passes; assume changes work.

## Testing

Vitest hasn't been set up yet. Prefer lint checks for now.

## Formatting

Oxfmt (via Vite+) is configured for consistent code formatting via `vpr format`. It runs automatically on commit via Vite+ pre-commit hooks, so manual formatting is not necessary.

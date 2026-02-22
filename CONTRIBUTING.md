# Contributing

## Development setup

```bash
bun install
```

## Quality gates

Run these before opening a pull request:

```bash
bun run format
bun run lint
bun run typecheck
bun test
```

## Commit format

This project uses Conventional Commits for release automation.

Examples:

- `feat: add batch input support`
- `fix: handle empty extraction response`
- `docs: update CLI usage`

Use `feat!:` or `fix!:` for breaking changes.

## Pull requests

- Keep PRs focused on one change
- Add or update tests when behavior changes
- Update docs when CLI flags or defaults change

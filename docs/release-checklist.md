# Release Checklist

Run these checks before publishing or merging release-sensitive changes.

## Required Checks

```bash
pnpm run lint
pnpm run typecheck
pnpm run test
pnpm run build
git diff --check
```

## Package Smoke Checks

Use these when package exports, optional dependencies, or build config changed.

```bash
pnpm --filter aiex-cli build
pnpm --filter aiex-cli exec publint
pnpm --filter aiex-cli smoke:cli
pnpm --filter aiex-cli smoke:package
node app/cli/dist/cli.mjs --help
```

For PDF converter changes, also smoke-test the selected converter on `app/cli/test/demo.pdf` or a comparable fixture.

## Release Risk Notes

- `@llamaindex/liteparse` and `@napi-rs/system-ocr` are optional native dependencies and must remain external to the CLI bundle.
- `app/web` builds into `app/cli/dist/web`; run the root build after Web settings changes.
- Public package exports are intentionally small: the root API, CLI entry, and package metadata.
- `.aiex/` project data must not be committed.

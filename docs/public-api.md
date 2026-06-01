# Public API Boundary

The package currently exposes a small public surface:

| Export | Purpose |
|---|---|
| `aiex-cli` | CLI binary entry. |
| `aiex-cli/cli` | Built CLI module. |
| `aiex-cli` root export | Programmatic schema and diagnostics helpers. |

`src/core/**` has been removed. New code should import from `application`, `domain`, or `infrastructure` directly.

Internal modules should not be added to `package.json#exports` unless they are intended to become supported API. If an internal path is needed by generated code, document the reason here and add release smoke coverage.

## Naming Rules

- Persisted converter enum values use snake-case where needed, such as `mineru_api`.
- TypeScript object properties use camelCase, such as `mineruApi`, `ocrEnabled`, and `tessdataPath`.
- Prose may keep upstream product casing, such as LiteParse and MinerU.
- Class names use project style, such as `LiteparsePdfConverter`.
- `core` is not a layering term anymore. Use `domain`, `application`, or `infrastructure`.

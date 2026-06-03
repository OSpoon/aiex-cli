# AIEX Drizzle-Backed Schema Dialect

AIEX does not try to implement the full JSON Schema specification. The schema files are an AIEX dialect that uses JSON Schema-shaped input to generate stable Drizzle SQLite tables, migrations, and insertable data models.

## Principle

Support only what can be represented reliably by Drizzle and SQLite.

Unsupported JSON Schema features should be reported as warnings or validation errors instead of being silently treated as database behavior.

## Supported Mapping Surface

| AIEX schema input | Drizzle / SQLite output |
|---|---|
| `type: "string"` | `text()` |
| `type: "integer"` | `integer()` |
| `type: "number"` | `real()` |
| `type: "boolean"` | `integer({ mode: "boolean" })` |
| `type: "object"` without `nested.enabled` | `text({ mode: "json" })` |
| `type: "array"` without nested object items | `text({ mode: "json" })` |
| `format: "date-time"` | `integer({ mode: "timestamp" })` |
| `format: "json"` | `text({ mode: "json" })` |
| `format: "email"` / `format: "uri"` | `text()` |
| `required` | `.notNull()` |
| `primary` | `.primaryKey()` |
| `autoIncrement` | `.primaryKey({ autoIncrement: true })` |
| `unique` | `.unique()` |
| `default` | `.default(...)` |
| `minLength` / `maxLength` | SQLite `check(length(column) ...)` |
| `minimum` / `maximum` | SQLite numeric `check(...)` |
| `enum` | SQLite `check(column IN (...))` |
| `foreignKey` | Drizzle `.references(...)` |
| `nested.enabled` object | child table plus relation |
| `array.items.nested.enabled` object | child table plus has-many relation |
| `table.timestamps` | generated `created_at`, `updated_at` columns |
| `table.softDelete` | generated nullable `deleted_at` column |

## Supported Drizzle Extensions

| Extension | Meaning |
|---|---|
| `drizzle.mode: "json"` | Store value as JSON text |
| `drizzle.mode: "timestamp"` | Store as Drizzle timestamp integer |
| `drizzle.mode: "timestamp_ms"` | Store as millisecond timestamp integer |
| `drizzle.mode: "boolean"` | Store as Drizzle boolean integer |
| `drizzle.mode: "bigint"` | Store as Drizzle bigint integer |

## Non-Portable Or Unsupported JSON Schema Keywords

The dialect warns for full JSON Schema keywords that do not map reliably to Drizzle SQLite:

`oneOf`, `anyOf`, `allOf`, `not`, `if`, `then`, `else`, `const`, `contains`, `prefixItems`, `additionalItems`, `additionalProperties`, `patternProperties`, `propertyNames`, `dependentRequired`, `dependentSchemas`, `dependencies`, `unevaluatedItems`, `unevaluatedProperties`, `multipleOf`, `exclusiveMinimum`, `exclusiveMaximum`.

`pattern` is kept for extraction guidance, but it is not emitted as a SQLite constraint because SQLite has no portable built-in `REGEXP` implementation.

## Mapping Report

Every schema generation writes:

```text
.aiex/drizzle/schema-map.json
```

The report records each AIEX schema field and the generated table, column, Drizzle type, SQLite type, nullability, uniqueness, relation role, and notes. This is the primary artifact for debugging Schema to SQLite behavior.

## Migration Risk Analysis

Before applying migrations, AIEX compares the previous mapping report with the newly generated mapping report.

High-risk changes are blocked by default:

- table removal
- column removal
- column type changes
- nullable to not-null changes
- added unique constraints
- primary key changes
- narrowed enum values

Medium and low risk changes are reported but allowed. High-risk migrations require an explicit CLI override:

```bash
aiex schema --force
```

When a high-risk migration is blocked, `schema-map.json` keeps `baselineEntries` so the next run still compares against the last accepted database mapping instead of losing the old baseline.

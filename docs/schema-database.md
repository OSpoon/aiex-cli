# Database & Schema Migration System

`aiex` enables developers to define database tables visually using **JSON Schema** and translates them automatically into a fully-migrated **SQLite** database via **Drizzle ORM**. This document details the underlying translation engine, migration pipelines, and run-time safety checks.

---

## 1. Schema Translation Engine

User schemas are defined as JSON Schema draft-07 files stored in `.aiex/schema/<schema-name>.json`. 

The compilation engine in `app/cli/src/core/schema-sqlite/generator.ts` parses these definitions and generates TypeScript files for Drizzle ORM inside `.aiex/drizzle/schema.ts`.

### Translation Mapping Rules

The generator maps JSON Schema types to SQLite column types according to the following conventions:

| JSON Schema Property | Drizzle / SQLite Type | Notes |
| :--- | :--- | :--- |
| `type: "string"` | `text()` | Default column representation for text. |
| `type: "string", format: "date-time"` | `text()` | Standardized ISO date strings. |
| `type: "integer"` | `integer()` | Maps to 64-bit integer. |
| `type: "number"` | `real()` | Floating-point real numbers. |
| `type: "boolean"` | `integer({ mode: "boolean" })` | Stored as `0` or `1` in SQLite. |
| `type: "object"` (inline) | `text({ mode: "json" })` | Objects without relational annotations are serialized as JSON strings. |
| `type: "array"` (inline) | `text({ mode: "json" })` | Arrays without relational annotations are serialized as JSON strings. |

### Relational Schema Mapping
If an object or array property contains a `nested` annotation, it is translated into a database relation instead of a JSON column:

1. **Has-One Relation (`nested.relation: "has-one"`)**:
   - Creates a separate secondary table.
   - Adds a Foreign Key column (e.g. `parentId`) pointing back to the primary table.
2. **Has-Many Relation (`nested.relation: "has-many"`)**:
   - Creates a secondary table.
   - Links rows to the primary table via Foreign Keys.

---

## 2. Migration Execution Pipeline

When a user runs `aiex schema` or clicks "Apply Migration" in the Web Console:

```
┌──────────────────┐     ┌──────────────────────┐     ┌──────────────────────┐
│  .aiex/schema/   │ ──> │ Drizzle Schema Code  │ ──> │  drizzle-kit generate │
│   JSON Schemas   │     │  .aiex/drizzle/      │     │  SQL Migration files │
└──────────────────┘     └──────────────────────┘     └──────────────────────┘
                                                                 │
                                                                 ▼
                                                      ┌──────────────────────┐
                                                      │ drizzle-kit migrate  │
                                                      │  Apply DDL to        │
                                                      │  .aiex/database.db   │
                                                      └──────────────────────┘
```

1. **Schema Generation**: The core generator scans `.aiex/schema/*.json` and compiles them into a unified `.aiex/drizzle/schema.ts` file, establishing tables, column constraints, relations, and index definitions.
2. **Drizzle-Kit Call**: The migration manager fires `drizzle-kit generate` to compare the generated TypeScript schema against the previous migration state, outputting incremental `.sql` files to `.aiex/drizzle/migrations/`.
3. **Execution**: The migration manager executes the pending migrations on the local SQLite file (`.aiex/database.db`) using `drizzle-orm/better-sqlite3/migrator`.

---

## 3. Database Pre-Flight Checks

To prevent invalid writes and database crashes during AI data insertion, `aiex` performs strict runtime checks on the target database before executing insertion queries.

Inside `app/cli/src/core/extract-runner.ts` and `app/cli/src/core/ai-extraction/inserter.ts`:

1. **Table Existence Check**:
   - Queries `sqlite_master` to ensure all expected tables (including nested relation tables) exist:
     ```sql
     SELECT name FROM sqlite_master WHERE type='table' AND name=?
     ```
   - If tables are missing, it halts the operation and prompts the user to run `aiex schema` first.
2. **Dynamic Transaction Safety**:
   - Inserts are executed inside a SQLite Transaction. If any nested row fails (due to constraint violations, unique conflicts, or type mismatches), the entire operation rolls back automatically, keeping the database in a clean state.

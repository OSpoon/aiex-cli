# Contributor Guidelines

This document provides guidelines for setting up the local development environment, running tests, linting, compiling, and contributing to the `aiex` project.

---

## 1. Development Environment Setup

This project is a monorepo managed with **pnpm**.

### Prerequisites
- Node.js >= 18.x
- pnpm >= 9.x

### Quickstart Installation
1. Clone the repository and install all dependencies:
   ```bash
   pnpm install
   ```
2. Initialize SQLite schemas for database testing:
   ```bash
   pnpm --dir app/cli schema
   ```

---

## 2. Core Build & Development Commands

Workspace scripts are defined in the root `package.json`. You can trigger them from the root:

| Command | Action |
| :--- | :--- |
| **`pnpm build`** | Compiles TypeScript CLI files via `tsdown` and web assets via Vite. |
| **`pnpm dev`** | Runs CLI compilation in watch mode. |
| **`pnpm dev:web`** | Runs the visual Web Console dev server. |
| **`pnpm typecheck`** | Performs static type checks on both CLI (`tsc`) and Web Vue templates (`vue-tsc`). |
| **`pnpm lint`** | Runs ESLint over all CLI and Web files. |
| **`pnpm test`** | Executes the vitest test suite. |

---

## 3. Coding Guidelines

### Dependency Guidelines
- Do not introduce heavy or unstable NPM dependencies.
- Keep the CLI fast and lightweight.
- Specify common dependencies under the shared catalog inside `pnpm-workspace.yaml`.

### Localization (i18n)
When adding logs or user prompts in the CLI, add corresponding localization strings in both English and Chinese:
- English: `app/cli/src/locales/en.ts`
- Chinese: `app/cli/src/locales/zh-CN.ts`
Use `t('key.path')` inside the CLI logic.

---

## 4. Writing & Running Unit Tests

We use **Vitest** for testing.

### Test Structure
- Unit tests are located under `app/cli/test/` and are named `<feature>.test.ts`.
- Fixtures and schema configurations are declared in `app/cli/test/ai-extraction.test-utils.ts`.

### Writing a Test Case
When writing tests that interact with external AI providers, mock the AI SDK using hoisted mocks to ensure test speed and stability:
```typescript
import { describe, expect, it, vi } from 'vitest'

const generateTextMock = vi.hoisted(() => vi.fn())
vi.mock('ai', () => ({
  generateText: generateTextMock,
  tool: vi.fn(options => options),
}))

describe('Feature Test', () => {
  it('should test correctly', async () => {
    generateTextMock.mockResolvedValueOnce({ text: '{"mocked": true}' })
    // ... test assertion
  })
})
```

### Running Specific Tests
To run a specific test file during development:
```bash
pnpm --dir app/cli test test/extract-runner.test.ts --run
```

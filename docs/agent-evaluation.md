# Agent Evaluation

This document defines the lightweight evaluation entry point for AIEX extraction agents. It is intentionally file-based so the same fixtures can be used by CLI tests, local manual runs, and future CI jobs without binding the project to a specific agent framework.

## Fixture Layout

Place fixtures under `test/fixtures/agent-eval/<case-name>/`:

- `input.md`: Source document after PDF/image conversion.
- `schema.json`: AIEX JSON schema used for extraction.
- `expected.json`: Expected extracted object.
- `actual.json`: Actual extracted object to score.
- `actual-evidence.json` (optional): Evidence report produced by ReAct Agent mode.

## Metrics

Each case should report:

- **Exact field accuracy**: Primitive fields matching `expected.json`.
- **Missing-field accuracy**: Fields correctly returned as `null`.
- **Unexpected field count**: Fields not present in the schema.
- **Evidence coverage**: Non-null fields with `status: "found"` and a snippet.
- **Token usage**: Prompt, completion, and total tokens.
- **Latency**: End-to-end extraction duration.

## Comparison Modes

Run each fixture against:

- Pipeline mode.
- ReAct Agent mode.
- ReAct Agent mode with different configured models when relevant.

The first CI-friendly implementation should use mocked model responses for deterministic regression coverage. Live model evaluation should remain an explicit local command because results depend on model/provider behavior and cost.

## Runner

Run deterministic fixture scoring from `app/cli`:

```sh
pnpm run eval:agent -- --fixtures test/fixtures/agent-eval
```

The runner compares `actual.json` with `expected.json`, reads optional `actual-evidence.json`, and reports exact field accuracy, missing-field accuracy, unexpected field count, evidence coverage, and evidence issue count. It does not call live models.

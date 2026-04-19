# AOK CLI Reference

## Global Commands

### `aok init`
Initialize AOK in the current directory. Creates `.aok/` with ledger database and default configuration.

```bash
aok init
```

### `aok run`
Execute the full autonomous repair loop.

```bash
aok run [--auto]
```

| Option | Description |
|--------|-------------|
| `--auto` | Run autonomous loop using LLM APIs |

---

## Repository Management

### `aok repo attach <path>`
Register a repository for AOK management.

```bash
aok repo attach /path/to/repo --name my-repo
```

| Option | Description |
|--------|-------------|
| `--name <name>` | Human-readable name for this repo |

### `aok repo use <name>`
Set the active repository context.

```bash
aok repo use my-repo
```

### `aok repo list`
List all registered repositories.

```bash
aok repo list
```

---

## Orchestration

### `aok orchestrate init`
Initialize the orchestrator ledger and default agents.

```bash
aok orchestrate init
```

### `aok orchestrate create-task <title>`
Create a new task in the orchestrator queue.

```bash
aok orchestrate create-task "Fix bug in parser" \
  --goal "Resolve off-by-one in tokenizer" \
  --scope "Modify exactly one file: src/parser.ts" \
  --non_goals "Do not change public API" \
  --definition_of_done "Parser handles edge case correctly" \
  --proof_required "src/parser.ts" \
  --repo my-repo
```

| Option | Default | Description |
|--------|---------|-------------|
| `--goal <string>` | Test goal | Primary objective |
| `--scope <string>` | E2E transitions | Files and boundaries |
| `--non_goals <string>` | No source mods | What not to do |
| `--definition_of_done <string>` | Task transitions | Success criteria |
| `--proof_required <string>` | Handoff logs | Target file for mutation evidence |
| `--repo <name>` | Active repo | Target repository |

### `aok orchestrate run`
Run the orchestrator loop.

```bash
# Single tick
aok orchestrate run --once

# Continuous loop
aok orchestrate run --watch
```

| Option | Description |
|--------|-------------|
| `--once` | Execute exactly one tick, then stop |
| `--watch` | Continuously run on interval |

### `aok orchestrate status`
Print current orchestrator state: active repo, task queue, and blocked tasks.

```bash
aok orchestrate status
```

### `aok orchestrate prove-execution`
Run the hard truth integration test. Creates a disposable file, stages a mutation, runs the full pipeline, and verifies engine-committed the change.

```bash
aok orchestrate prove-execution [--repo <name>]
```

| Option | Description |
|--------|-------------|
| `--repo <name>` | Target repo (defaults to active) |

**Exit criteria:**
- `done` — Pipeline functional, staged mutation committed
- `blocked` — Pipeline failed, blocker reason reported

### `aok orchestrate approve <approvalId>`
Approve a blocked task that requires human authorization.

```bash
aok orchestrate approve <approvalId> --action approve
```

---

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `AOK_API_KEY` | Yes* | — | LLM provider API key |
| `OPENAI_API_KEY` | Alt | — | Fallback if `AOK_API_KEY` unset |
| `AOK_SIMULATION_MODE` | No | `false` | `true` for offline testing |
| `AOK_LLM_PROVIDER` | No | auto | `openai`, `openrouter`, `anthropic` |
| `AOK_LLM_MODEL` | No | `gpt-4o` | Model override |
| `AOK_MAX_TOKENS` | No | `800` | Max tokens per LLM call |

*Not required when `AOK_SIMULATION_MODE=true`.

---

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | Runtime error or task failure |

---

## Examples

```bash
# Full workflow: init → attach → prove → create → run → check
aok init
aok repo attach ./my-project --name my-project
aok repo use my-project
AOK_API_KEY=sk-... aok orchestrate prove-execution --repo my-project
aok orchestrate create-task "Document exports" --goal "Add JSDoc" --scope "src/index.ts" --proof_required "src/index.ts"
aok orchestrate run --once
aok orchestrate status
```

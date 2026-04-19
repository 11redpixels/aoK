# Getting Started with AOK

## Prerequisites

- **Node.js** 18 or higher
- **npm** 9 or higher
- An OpenAI-compatible API key (OpenAI, OpenRouter, or custom)

## Installation

```bash
git clone <repo-url> AOK
cd AOK
npm install
npm run build
```

## Configuration

### API Key

Set your provider key as an environment variable:

```bash
# OpenAI direct
export AOK_API_KEY='sk-...'

# OpenRouter (auto-detected from sk-or- prefix)
export AOK_API_KEY='sk-or-v1-...'
```

### Optional Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `AOK_API_KEY` | — | Required. LLM provider authentication. |
| `AOK_LLM_PROVIDER` | auto | Override provider: `openai`, `openrouter`, `anthropic` |
| `AOK_LLM_MODEL` | `gpt-4o` | Override model name |
| `AOK_MAX_TOKENS` | `800` | Max tokens per LLM call |
| `AOK_SIMULATION_MODE` | `false` | Set to `true` for offline testing |

## First Run

### 1. Initialize AOK

```bash
node dist/aok.js init
```

Creates the `.aok/` directory with ledger database and default agent configurations.

### 2. Attach a Repository

```bash
node dist/aok.js repo attach /path/to/your/repo --name my-project
node dist/aok.js repo use my-project
```

### 3. Verify the Runtime

Always run proof-execution before queuing real tasks:

```bash
AOK_API_KEY=<key> node dist/aok.js orchestrate prove-execution --repo my-project
```

Expected output:
```
✅ Created Truth Test File at .../AOK_TRUTH_<timestamp>.txt
[Engine] Stage stage_<id> verified for .../AOK_TRUTH_<timestamp>.txt
[Engine] Stage stage_<id> committed to .../AOK_TRUTH_<timestamp>.txt
🏁 Prove Execution Complete. Final State: done
```

If final state is not `done`, your environment is not ready. Check your API key and credits.

### 4. Create Your First Task

```bash
node dist/aok.js orchestrate create-task "Add documentation to utils.ts" \
  --goal "Add JSDoc comments to all exported functions" \
  --scope "Modify exactly one file: src/utils.ts" \
  --non_goals "Do not change runtime logic" \
  --definition_of_done "JSDoc comments present on all exports" \
  --proof_required "src/utils.ts"
```

### 5. Execute

```bash
# Run one tick at a time (recommended for first use)
node dist/aok.js orchestrate run --once

# Or run the full loop
node dist/aok.js orchestrate run --watch
```

### 6. Inspect Results

```bash
# Check orchestrator status
node dist/aok.js orchestrate status

# Check filesystem changes
git status --short
git diff
```

## Simulation Mode

For testing without API credits:

```bash
AOK_SIMULATION_MODE=true node dist/aok.js orchestrate prove-execution --repo my-project
```

The pipeline runs end-to-end with mock LLM responses but real staged mutation verification.

## Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| `Native execution requires AOK_API_KEY` | Missing key | Set `AOK_API_KEY` |
| `402 Insufficient credits` | Provider account depleted | Add credits or switch provider |
| `NO_ACTIONABLE_MUTATION_OUTPUT` | Builder didn't produce file changes | Increase `AOK_MAX_TOKENS`, refine task scope |
| `STAGE_COMMIT_FAILED` | SafeWriter security gate triggered | Check path boundaries and overwrite permissions |
| `NO_REPO_CONTEXT` | No active repo | Run `aok repo use <name>` |

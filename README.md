<p align="center">
  <strong>AOK</strong><br>
  <em>Autonomous Operations Kernel</em>
</p>

<p align="center">
  The first autonomous maintenance runtime that refuses to fake success.
</p>

---

## What is AOK?

AOK is an autonomous code maintenance kernel that uses multi-agent orchestration to perform real, verified work on your repositories. Unlike conventional AI coding agents that report success without proof, AOK enforces a **staged mutation model** where every file change must be:

1. **Staged** through a sandboxed write boundary
2. **Verified** by independent agent review
3. **Committed** only by the orchestrator engine
4. **Proven** through filesystem evidence

If any step fails, the task is blocked — never silently marked complete.

## Why AOK Matters

Most AI-powered coding tools operate on trust. They tell you they fixed something. You hope they did.

AOK operates on **proof**:

- **No ceremonial completions.** A task cannot reach `done` without engine-owned mutation evidence.
- **No silent fallbacks.** If an API key is missing, execution crashes immediately — it doesn't switch to a mock and pretend.
- **No unscoped writes.** Every file mutation is path-bounded, symlink-checked, and task-scoped.
- **No bypassing governance.** Builders stage. The engine commits. Nothing else has write authority.

## Staged Mutation Model

```
Builder → stageMutation()
   ↓
Verifier → reviews output
   ↓
Reviewer → confirms quality
   ↓
Supervisor → approves hardening
   ↓
Engine → updateValidationState('verified')
       → commitStaged(taskId, stageId)
       → post-commit filesystem verification
   ↓
done (or blocked with reason)
```

Every mutation passes through **11 safety gates** before touching a target file:

| Gate | Enforcement |
|------|-------------|
| Path resolution | `path.resolve()` + boundary check |
| Traversal rejection | `../` escape → blocked |
| Absolute path rejection | Outside repo root → blocked |
| Symlink escape | `realpathSync()` chain verification |
| Overwrite gate | Existing file without permission → blocked |
| Patch validation | Missing diff markers → blocked |
| Multi-file patch | Unauthorized multi-file → blocked |
| Task scoping | Mismatched taskId → blocked |
| Verification state | Only `verified` stages commit |
| Integrity hash | SHA-256 payload verification |
| Atomic write | Temp file + rename, never partial |

## Proof of Execution

```bash
aok orchestrate prove-execution --repo <name>
```

Creates a disposable truth file, stages a mutation, runs the full agent pipeline, and verifies the engine committed the change atomically. If this command doesn't return `done`, your environment is not ready.

## Provider Support

AOK is provider-agnostic. It supports any OpenAI-compatible API:

| Provider | Config | Notes |
|----------|--------|-------|
| OpenAI | `AOK_API_KEY=sk-...` | Direct API access |
| OpenRouter | `AOK_API_KEY=sk-or-...` | Auto-detected from key prefix |
| Any OpenAI-compatible | `AOK_LLM_PROVIDER=openai` + custom `baseURL` | Custom endpoints |

Environment overrides: `AOK_LLM_MODEL`, `AOK_MAX_TOKENS`, `AOK_LLM_PROVIDER`.

## Use Cases

- **Autonomous bug fixing** — Queue a task, let agents diagnose and patch, engine commits only proven fixes
- **Documentation maintenance** — Safely add JSDoc, update READMEs, document undocumented APIs
- **Repetitive repo chores** — License headers, import sorting, dead code identification
- **Safe multi-step execution** — Complex refactors staged atomically with rollback capability
- **CI integration** — Run `prove-execution` as a pipeline gate to validate AOK readiness
- **Internal engineering copilot** — Multi-repo orchestration across team codebases

## Quick Start

```bash
# Install
npm install
npm run build

# Initialize in your project
node dist/aok.js init

# Attach a repository
node dist/aok.js repo attach /path/to/repo --name my-repo
node dist/aok.js repo use my-repo

# Verify the runtime
AOK_API_KEY=<key> aok orchestrate prove-execution --repo my-repo

# Create a task
aok orchestrate create-task "Fix typo in README" \
  --goal "Correct spelling in README.md" \
  --scope "Modify exactly one file: README.md" \
  --proof_required "README.md"

# Run one tick
aok orchestrate run --once
```

## Documentation

| Document | Description |
|----------|-------------|
| [Getting Started](docs/GETTING_STARTED.md) | Installation, configuration, first run |
| [Architecture](docs/ARCHITECTURE.md) | System design, agent roles, state machine |
| [Use Cases](docs/USE_CASES.md) | Real-world scenarios and task templates |
| [Security Model](docs/SECURITY_MODEL.md) | SafeWriter, path boundaries, threat model |
| [CLI Reference](docs/CLI_REFERENCE.md) | Complete command documentation |
| [Operator Runbook](docs/operator-runbook.md) | Production operation guide |

## Requirements

- Node.js 18+
- npm 9+
- An OpenAI-compatible API key

## License

Proprietary — Anwiik Engineering

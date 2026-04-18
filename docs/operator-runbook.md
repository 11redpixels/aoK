# AOK Operator Runbook
## Milestone: Controlled Rollout v1.0

> This document covers the production-hardened AOK autonomous maintenance kernel.
> Internal tag: `controlled-rollout-ready-v1`

---

## Architecture Overview

AOK uses a multi-agent pipeline to autonomously maintain codebases:

```
Builder → Verifier → Reviewer → Supervisor → Engine (commit gate)
```

### Write Authority Model

| Component | May Stage | May Commit | May Write Directly |
|-----------|-----------|------------|--------------------|
| Builder   | ✅        | ❌         | ❌                 |
| Verifier  | ❌        | ❌         | ❌                 |
| Reviewer  | ❌        | ❌         | ❌                 |
| Supervisor| ❌        | ❌         | ❌                 |
| Engine    | ❌        | ✅         | ❌                 |
| SafeWriter| —         | —          | ✅ (atomic only)   |

- **Builder** extracts LLM-produced file modifications and calls `SafeWriter.stageMutation()`. It returns `stageId` references in its handoff payload. It never writes to target files.
- **Engine** is the sole commit authority. At the `hardened` gate, it extracts staged mutation references from handoffs, calls `updateValidationState('verified')`, then `commitStaged()`. If any step fails, the task is blocked.
- **SafeWriter** enforces path boundaries, symlink checks, and atomic temp-file-then-rename writes. No direct `writeFileSync` to target paths ever occurs.

---

## Execution Modes

### Strict Mode (Default)

All LLM calls are live. `AOK_API_KEY` is mandatory. Tasks that reach `hardened` without staged mutations are blocked with `NO_STAGED_MUTATIONS`. Tasks where commit fails are blocked with `STAGE_COMMIT_FAILED`.

### Simulation Mode

```bash
AOK_SIMULATION_MODE=true aok orchestrate <command>
```

- LLM calls return deterministic mock payloads.
- No API key required.
- `prove-execution` pre-stages a synthetic mutation so the engine's full commit path is exercised.
- Simulated tasks can reach `done` only if the staged commit path succeeds end-to-end.

---

## Environment Variables

| Variable | Required | Purpose |
|----------|----------|---------|
| `AOK_API_KEY` | Yes (strict mode) | Primary LLM provider authentication |
| `OPENAI_API_KEY` | Alternative | Fallback if `AOK_API_KEY` is unset |
| `AOK_SIMULATION_MODE` | No | Set to `true` for offline pipeline testing |

---

## Provider Configuration

### Direct OpenAI

```javascript
// aok.config.js or provider_metadata
{
  provider: 'openai',
  model: 'gpt-4o'
}
```

Set `AOK_API_KEY` to your OpenAI key.

### OpenRouter

```javascript
{
  provider: 'openrouter',
  model: 'anthropic/claude-sonnet-4-20250514'
}
```

Set `AOK_API_KEY` to your OpenRouter key. The SDK connects to `https://openrouter.ai/api/v1` using the OpenAI-compatible endpoint.

---

## Proof Command

```bash
aok orchestrate prove-execution [--repo <name>]
```

**What it does:**
1. Creates `<repo>/.aok/temp/AOK_TRUTH_<timestamp>.txt` with content `INIT`
2. Creates a task targeting that file
3. In simulation mode: pre-stages a mutation via SafeWriter
4. Runs the full pipeline: Builder → Verifier → Reviewer → Supervisor
5. At `hardened` gate: Engine extracts staged mutation, verifies, commits atomically
6. Post-commit: Engine confirms file exists on disk
7. Reports final state: `done` (success) or `blocked` (with blocker reason)
8. Cleans up the truth file

**Expected outcomes:**

| Mode | Expected Final State | Meaning |
|------|---------------------|---------|
| Simulation | `done` | Full staged commit path works |
| Strict, no API key | crash | Fail-fast credential enforcement |
| Strict, with API key | `done` if LLM produces valid FILE blocks | Live execution verified |

---

## SafeWriter Validation Rules

Every mutation passes through these gates before any bytes touch a target file:

1. **Path resolution**: `path.resolve(repo.path, target)` + `path.relative()` boundary check
2. **Traversal rejection**: Any `../` escape → `INVALID_PATH_ESCAPE`
3. **Absolute path rejection**: Paths outside repo root → `ABSOLUTE_PATH_DISALLOWED` (exception: `.aok/temp/`)
4. **Symlink escape detection**: `fs.realpathSync()` chain verification → `SYMLINK_ESCAPE`
5. **Overwrite gate**: Existing file + no `allowOverwrite` flag → `OVERWRITE_FORBIDDEN`
6. **Patch validation**: Missing diff markers → `MALFORMED_PATCH`
7. **Multi-file patch gate**: Multiple `---` boundaries without explicit permission → `MULTI_FILE_PATCH_FORBIDDEN`
8. **Task scoping**: `commitStaged()` verifies `taskId` matches staged metadata → `TASK_MISMATCH`
9. **Verification state**: Only `verified` stages may commit → `VALIDATION_REQUIRED`
10. **Integrity hash**: SHA-256 payload hash verified at commit time → `PAYLOAD_SCRAMBLED`
11. **Atomic write**: Content goes to `.tmp_commit_<ts>` then `fs.renameSync()` to target

---

## ⛔ Do Not Use

> [!CAUTION]
> **Do not run AOK against production repositories without the following precautions:**

1. **No sensitive repos without branch isolation.** Always operate on a dedicated branch or a cloned working copy. AOK's Builder agent will stage real file mutations. If something goes wrong during commit, the target file is replaced atomically — there is no undo without version control.

2. **No unrestricted overwrite tasks.** The `allowOverwrite` flag must be explicitly set per-task. Do not create tasks with `OVERWRITE` in the goal string against files you cannot afford to lose. The SafeWriter will reject unauthorized overwrites, but task metadata controls this gate.

3. **No multi-repo autonomous loops without supervision.** AOK can operate across multiple attached repos. Do not leave it running unattended across repos containing unrelated production data.

4. **No skipping `prove-execution` before first live use.** Always run the proof command against your target repo before queuing real tasks. If proof fails, do not proceed.

5. **Backup `.aok/ledger.sqlite` before major operations.** The ledger contains all task state, handoff history, and staged mutation metadata. Corruption or accidental deletion loses orchestrator context.

---

## Operator Verification Checklist

Before first live use on any repo:

- [ ] `npm run build` succeeds
- [ ] `npx tsx tests/safety.test.ts` — 12/12 pass
- [ ] `AOK_SIMULATION_MODE=true aok orchestrate prove-execution --repo <target>` → `done`
- [ ] `AOK_API_KEY=<key> aok orchestrate prove-execution --repo <target>` → `done`
- [ ] Target repo has a clean git branch or backup
- [ ] `.aok/ledger.sqlite` backed up

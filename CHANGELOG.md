# AOK Changelog

## controlled-rollout-ready-v1 — 2026-04-18

### Hardening
- Removed all silent mock fallbacks from Builder, Verifier, Reviewer, Supervisor agents
- `createLLMProvider()` crashes immediately if `AOK_API_KEY` missing in strict mode
- Simulation mode requires explicit `AOK_SIMULATION_MODE=true`

### SafeWriter Sandbox
- New `src/orchestrator/fs-sandbox.ts` — all file mutations must pass through SafeWriter
- Path boundary enforcement via `path.resolve()` + `path.relative()` + symlink detection
- Staged transaction model: stage → verify → atomic commit
- Task-scoped writes: commit requires matching taskId
- Patch validation: rejects malformed diff payloads
- Overwrite gate: requires explicit `allowOverwrite` flag

### Engine-Owned Commit Authority
- Builder may only call `stageMutation()` — never writes to target files
- Engine extracts staged mutation refs from handoff payloads at `hardened` gate
- Engine calls `updateValidationState('verified')` then `commitStaged()`
- Failed commits block the task with `STAGE_COMMIT_FAILED`
- Missing staged mutations block with `NO_STAGED_MUTATIONS`
- Git dependency removed as primary truth gate (now optional secondary evidence)

### Proof Command
- `aok orchestrate prove-execution [--repo <name>]`
- Creates isolated truth file in `<repo>/.aok/temp/`
- In simulation mode: pre-stages mutation so engine commit path is fully exercised
- End-to-end: staged → verified → committed → done

### Testing
- 12 safety + integration tests in `tests/safety.test.ts`
- Path escape, absolute path, symlink, overwrite, malformed patch, task mismatch,
  missing stage, rejected validation, pending validation, valid overwrite, valid patch

### Provider Support
- OpenAI direct
- OpenRouter via OpenAI-compatible SDK (`https://openrouter.ai/api/v1`)
- Anthropic (structural support)

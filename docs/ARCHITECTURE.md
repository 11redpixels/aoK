# AOK Architecture

## System Overview

AOK is a multi-agent orchestration system built on three core principles:

1. **Separation of concerns** — Agents have narrow roles and cannot exceed their authority
2. **Engine-owned commit authority** — Only the orchestrator engine can finalize mutations
3. **Proof over trust** — Every `done` state requires verifiable filesystem evidence

```
┌─────────────────────────────────────────────────────┐
│                   CLI (bin/aok.ts)                   │
├─────────────────────────────────────────────────────┤
│              OrchestratorEngine                      │
│   ┌──────────┐  ┌──────────┐  ┌──────────┐         │
│   │ Builder  │→ │ Verifier │→ │ Reviewer │         │
│   └──────────┘  └──────────┘  └──────────┘         │
│        ↓              ↓             ↓               │
│   ┌──────────┐                                      │
│   │Supervisor│                                      │
│   └──────────┘                                      │
│        ↓                                            │
│   ┌─────────────────────┐   ┌──────────────┐       │
│   │  SafeWriter (sandbox)│   │ TaskLedger   │       │
│   │  - stageMutation()   │   │ (SQLite)     │       │
│   │  - commitStaged()    │   │              │       │
│   └─────────────────────┘   └──────────────┘       │
├─────────────────────────────────────────────────────┤
│              LLM Providers (openai SDK)              │
│         OpenAI  |  OpenRouter  |  Custom             │
└─────────────────────────────────────────────────────┘
```

## Agent Roles

### Builder
- **Purpose:** Implement code changes
- **Authority:** May call `stageMutation()` only. Cannot commit.
- **Input:** Task goal, scope, existing file content
- **Output:** Staged mutation references (`stageId`, `targetPath`)
- **Constraint:** Must produce structured `--- FILE: ... ---` blocks

### Verifier
- **Purpose:** Validate that builder output meets task requirements
- **Authority:** Read-only. Cannot stage or commit.
- **Output:** Pass/fail assessment, optional return-to-builder recommendation

### Reviewer
- **Purpose:** Quality review and scope validation
- **Authority:** Read-only. Cannot expand scope.
- **Output:** Approval or rejection with rationale

### Supervisor
- **Purpose:** High-level approval and coordination
- **Authority:** Can block tasks, request human approval
- **Output:** Hardening decision, escalation if needed

### Engine (OrchestratorEngine)
- **Purpose:** Sole commit authority. Owns the staged mutation lifecycle.
- **Authority:** May verify, commit, or reject staged mutations
- **Gates:** Proof-task vs real-task distinction. Must have mutation evidence.

## Task State Machine

```
queued → planned → in_progress → implemented → verified → hardened → done
                       ↑              ↓                      ↓
                       └── (return) ──┘                   blocked
```

| Transition | Owner | Gate |
|-----------|-------|------|
| queued → planned | supervisor | Planning review |
| planned → implemented | builder | Must produce staged mutations |
| implemented → verified | verifier | Implementation review |
| verified → hardened | reviewer | Quality review |
| hardened → done | engine | Staged mutations committed OR git delta proven |
| hardened → blocked | engine | No mutation evidence |

## Staged Mutation Lifecycle

```
1. Builder calls SafeWriter.stageMutation(taskId, path, content, type)
   → Content written to .aok/staging/stage_<taskId>_<hash>.payload
   → Metadata written to .aok/staging/stage_<taskId>_<hash>.json
   → Returns stageId

2. Builder encodes stageId in handoff message:
   __STAGED_MUTATIONS__[{stageId, targetPath, ...}]__END_STAGED__

3. Engine extracts staged mutation refs from all handoffs for task

4. Engine calls SafeWriter.updateValidationState(stageId, 'verified')
   → Metadata updated: validation_state = 'verified'

5. Engine calls SafeWriter.commitStaged(taskId, stageId)
   → Verifies: taskId matches, validation_state === 'verified'
   → Verifies: SHA-256 payload hash matches staged hash
   → Writes content to temp file, then fs.renameSync() to target
   → Atomic commit complete

6. Engine performs post-commit verification
   → Confirms target file exists on disk
   → Task transitions to 'done'
```

## Data Storage

### TaskLedger (SQLite)
- `agents` — Registered agent records with roles and instruction profiles
- `tasks` — Task records with state, scope, goals, proof requirements
- `handoffs` — Agent-to-agent handoff messages with mutation metadata
- `approvals` — Human approval gates
- `repos` — Registered repository paths

### SafeWriter (.aok/staging/)
- `stage_<taskId>_<hash>.json` — Stage metadata (taskId, target, type, hash, timestamp, validation_state)
- `stage_<taskId>_<hash>.payload` — Staged file content

## Security Boundaries

See [SECURITY_MODEL.md](SECURITY_MODEL.md) for the comprehensive threat model.

Key enforcements:
- Path traversal (`../`) rejected
- Absolute paths outside repo rejected
- Symlink escape detected and blocked
- Overwrite requires explicit task permission
- Task ID must match at commit time
- Payload integrity verified via SHA-256

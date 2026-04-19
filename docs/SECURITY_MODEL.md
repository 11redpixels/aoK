# AOK Security Model

## Threat Model

AOK is designed to prevent autonomous agents from causing unintended damage to repositories. The security model addresses these threat categories:

| Threat | Attack Vector | Mitigation |
|--------|--------------|------------|
| Path escape | `../../etc/passwd` | Normalized path + relative boundary check |
| Absolute path write | `/tmp/malicious` | Rejected unless `.aok/temp/` internal path |
| Symlink exploitation | Symlink pointing outside repo | `realpathSync()` chain verification |
| Unauthorized overwrite | Replacing critical files | Explicit `allowOverwrite` permission per task |
| Scope creep | Builder modifying unrelated files | Task-scoped `proof_required` path enforcement |
| Fake completion | Task reaching `done` without mutation | Engine-owned mutation evidence gate |
| Payload tampering | Modified content between stage and commit | SHA-256 integrity hash verification |
| Cross-task contamination | Wrong task committing another's stage | TaskId matching at commit time |
| Multi-file explosion | Patch affecting unrelated files | Multi-file patch gate |
| Agent privilege escalation | Reviewer expanding scope | `Permission Denied: Reviewer cannot expand scope` |

## SafeWriter Security Gates

All file mutations pass through `SafeWriter` (`src/orchestrator/fs-sandbox.ts`), which enforces 11 sequential gates:

### Gate 1: Path Resolution
```
path.resolve(repoRoot, targetPath)
```
All paths are resolved against the repo root. Relative paths are normalized.

### Gate 2: Traversal Rejection
```
if (relativePath.startsWith('..'))
  → Error: INVALID_PATH_ESCAPE
```
Any path that resolves outside the repo boundary is rejected.

### Gate 3: Absolute Path Rejection
```
if (path.isAbsolute(targetPath) && !isInternalAokPath)
  → Error: ABSOLUTE_PATH_DISALLOWED
```
Absolute paths are rejected unless they point to `.aok/temp/` for internal proof operations.

### Gate 4: Symlink Escape Detection
```
if (fs.realpathSync(resolved) does not start with repoRoot)
  → Error: SYMLINK_ESCAPE
```
Symlinks that resolve outside the repo boundary are rejected, preventing indirect path escape.

### Gate 5: Overwrite Permission
```
if (file exists && !options.allowOverwrite)
  → Error: OVERWRITE_FORBIDDEN
```
Existing files cannot be replaced unless the task explicitly grants overwrite permission.

### Gate 6: Patch Validation
```
if (operationType === 'patch' && !content.includes('---') && !content.includes('+++'))
  → Error: MALFORMED_PATCH
```
Patch payloads must contain valid diff markers.

### Gate 7: Multi-File Patch Gate
```
if (multiple --- boundaries detected)
  → Error: MULTI_FILE_PATCH_FORBIDDEN
```
Patches affecting multiple files are rejected unless explicitly allowed.

### Gate 8: Task Scoping
```
if (stagedMetadata.taskId !== requestedTaskId)
  → Error: TASK_MISMATCH
```
A commit request must match the taskId that created the stage.

### Gate 9: Verification State
```
if (stagedMetadata.validation_state !== 'verified')
  → Error: VALIDATION_REQUIRED
```
Only stages that have been explicitly verified by the engine can be committed.

### Gate 10: Integrity Hash
```
if (SHA256(payload) !== stagedMetadata.content_hash)
  → Error: PAYLOAD_SCRAMBLED
```
Content integrity is verified at commit time to detect tampering.

### Gate 11: Atomic Write
```
fs.writeFileSync(tempPath, content)
fs.renameSync(tempPath, targetPath)
```
Content is written to a temporary file first, then atomically renamed. No partial writes.

## Engine Governance Gate

At the `hardened → done` transition, the engine enforces:

### Proof Tasks (`.aok/temp/AOK_TRUTH_*`)
- Truth file content must differ from `INIT`
- Pre-staged mutation verification

### Real Tasks
- **Preferred:** Engine-committed staged mutations tied to this task ID
- **Fallback:** Verified `git diff` showing actual content delta on declared target
- **Never accepted:** Pre-existing file existence, `git status --porcelain` alone

### Blocker Reasons
| Blocker | Meaning |
|---------|---------|
| `NO_ACTIONABLE_MUTATION_OUTPUT` | Builder produced no structured file changes |
| `NO_STAGED_MUTATIONS` | No staged mutations and no filesystem evidence |
| `STAGE_COMMIT_FAILED` | SafeWriter rejected the commit |
| `POST_COMMIT_VERIFICATION_FAILED` | Committed file not found on disk |
| `NO_REPO_CONTEXT` | No active repository attached |
| `TASK_MISMATCH` | TaskId doesn't match staged metadata |
| `VALIDATION_REQUIRED` | Stage not verified before commit attempt |
| `PAYLOAD_SCRAMBLED` | Content hash mismatch at commit time |

## Credential Security

- `AOK_API_KEY` is never logged, never stored in ledger, never written to disk
- Simulation mode uses a non-functional dummy key for SDK constructor requirements
- No secrets are committed to the repository
- `.gitignore` excludes `.aok/ledger.sqlite`, `.aok/staging/`, `.aok/temp/`

# AOK Use Cases

## 1. Autonomous Documentation Maintenance

**Scenario:** Your team has 200+ exported functions across a TypeScript monorepo with no JSDoc comments.

**AOK approach:**
```bash
aok orchestrate create-task "Document exported functions in src/utils/formatting.ts" \
  --goal "Add JSDoc comments to all exported functions" \
  --scope "Modify exactly one file: src/utils/formatting.ts" \
  --non_goals "Do not change function signatures or logic" \
  --proof_required "src/utils/formatting.ts"
```

**Why AOK:** The Builder reads the existing file, produces a modified version with JSDoc, stages it through SafeWriter, and the engine commits only after the Verifier confirms no logic was altered. If the Builder hallucinates a logic change, the task blocks.

---

## 2. Autonomous Bug Fixing

**Scenario:** A failing test points to a specific utility function. You want an agent to diagnose and fix it.

**AOK approach:**
```bash
aok orchestrate create-task "Fix parseNumeric utility" \
  --goal "Fix numeric parsing to handle comma-separated values correctly" \
  --scope "Modify exactly one file: src/utils/parseNumeric.ts" \
  --non_goals "Do not modify tests, do not change function signatures" \
  --proof_required "src/utils/parseNumeric.ts"
```

**Why AOK:** The fix is staged, verified by an independent agent, and committed atomically. If the Builder's fix doesn't actually change the file, the engine refuses `done` — preventing false confidence.

---

## 3. Repetitive Repo Chores

**Scenario:** Add license headers to all source files, one at a time.

**AOK approach:** Queue individual tasks per file, each scoped to one file with overwrite permission.

**Why AOK:** Each file change is independently staged, verified, and committed. If one file's header causes a syntax error, only that task blocks — the others proceed.

---

## 4. Safe Multi-Repo Operations

**Scenario:** You manage 5 services and need to update a shared constant across all of them.

**AOK approach:**
```bash
# Attach all repos
aok repo attach /path/to/service-a --name service-a
aok repo attach /path/to/service-b --name service-b

# Queue tasks per repo
aok orchestrate create-task "Update API version constant" --goal "..." --repo service-a
aok orchestrate create-task "Update API version constant" --goal "..." --repo service-b
```

**Why AOK:** Repo boundary enforcement prevents cross-contamination. A task scoped to `service-a` cannot accidentally write to `service-b`.

---

## 5. CI/CD Pipeline Gate

**Scenario:** You want to verify AOK readiness before deploying to staging.

**CI step:**
```yaml
- name: Verify AOK Runtime
  run: |
    AOK_SIMULATION_MODE=true node dist/aok.js orchestrate prove-execution --repo $REPO
```

**Why AOK:** `prove-execution` is a deterministic integration test. If it fails, your environment isn't configured correctly. If it passes, the staged mutation pipeline is functional.

---

## 6. Internal Engineering Copilot

**Scenario:** Junior developers need guardrailed AI assistance that can't break production.

**AOK approach:** AOK prevents destructive overwrites, blocks unauthorized file access, and requires multi-agent verification before any change lands. The Reviewer agent enforces scope boundaries — it cannot expand what the Builder is allowed to touch.

**Why AOK:** Other AI tools let agents write anywhere. AOK's SafeWriter ensures every write goes through 11 safety gates. No path escape, no symlink exploitation, no unauthorized overwrites.

---

## Task Template Reference

### Documentation Task
```bash
aok orchestrate create-task "<title>" \
  --goal "Add JSDoc comments to <function/type> in <file>" \
  --scope "Modify exactly one file: <path>. Documentation-only." \
  --non_goals "Do not alter runtime logic, imports, or any other file." \
  --definition_of_done "JSDoc comments present and function behavior unchanged" \
  --proof_required "<path>"
```

### Bug Fix Task
```bash
aok orchestrate create-task "<title>" \
  --goal "Fix <specific issue> in <file>" \
  --scope "Modify exactly one file: <path>." \
  --non_goals "Do not modify tests, do not change public API." \
  --definition_of_done "Issue resolved and existing tests pass" \
  --proof_required "<path>"
```

### Refactor Task
```bash
aok orchestrate create-task "<title>" \
  --goal "Refactor <function> in <file> for clarity" \
  --scope "Modify exactly one file: <path>. Behavior must be identical." \
  --non_goals "Do not change function signatures or return types." \
  --definition_of_done "Code refactored, all existing tests pass" \
  --proof_required "<path>"
```

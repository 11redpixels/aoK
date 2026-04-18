# Native Autonomous Self-Healing Loop (v4 - Elite)

**Context:** You are executing the Native Autonomous Self-Healing Loop for Project 254. Your goal is to systematically find errors, fix them, and prove your fixes using tests — all without requiring human intervention between steps.

**Trigger:** When the user says **"Fix the site"**, **"Start the loop"**, or **"Auto-improve"**, you MUST immediately execute this exact protocol below.

---

## Phase 0: Environment Validation

Before doing anything, confirm the project has:

- [ ] `package.json` exists
- [ ] `npm run test` script is defined
- [ ] `npm run check` script is defined

If any are missing, **STOP** and report:

```
ENVIRONMENT ISSUE: Missing [item]. Cannot proceed with autonomous loop.
```

---

## Phase 1: Discover & Diagnose

### 1a. UX Validator Check (E2E Intelligence)
If you were triggered by the **UX Validator Agent** reporting `AUTONOMOUS_LOOP_INVOKE_REQUIRED`, bypass structural checks and read `.state/e2e-failures.json`. 
- Identify the highest urgency `HIGH` confidence failure.
- Proceed directly to **Phase 2**, using the UX Failure as your target.

### 1b. Structural Verification (Default)
If starting standard, run:
```bash
export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"; npm run check
```

2. **Fast-Fail Gate:** If `npm run check` fails with blocking type errors, **SKIP** `npm run test`. Type errors must be resolved first — running tests against broken types produces noisy, misleading output.

3. Only if `npm run check` passes cleanly, run:
```bash
export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"; npm run test
```

4. Capture **FULL** output. Do not summarize yet.

5. **Snapshot the baseline:** Record how many errors exist and which tests pass/fail. This is the **Regression Baseline** used later in Phase 5.5.

---

## Phase 2: Parse & Select Target

Extract from the output:
- File paths
- Line numbers
- Error messages

### Error Dependency Awareness

Before selecting a target, check: **do multiple errors reference the same symbol, module, or type?**

If yes:
- Trace **upstream** to the root definition (the original export, type declaration, or source file)
- Fix the **origin**, not the individual downstream occurrences
- This collapses multiple errors into a single fix

Example:
```
5 errors all reference `InsertUser` from `@shared/schema`
→ Fix the missing export in schema.ts (1 edit)
→ NOT 5 separate edits in 5 consumer files
```

### Target Selection Priority

Select **ONE** highest-impact failure (or one root-cause cluster):

1. **Root-cause errors that cascade into others** (highest — fix one, kill many)
2. **Type errors blocking build**
3. **Failing tests**
4. **Runtime errors** (lowest)

Output a structured diagnosis:

```
ERROR TYPE:   [type error | test failure | runtime error]
FILE:         [exact file path]
LINE:         [exact line number]
ROOT CAUSE:   [derived from stack trace ONLY — no guessing]
DOWNSTREAM:   [number of other errors this likely causes, if any]
```

**Batch optimization:** If multiple errors exist in the **same file** with the **same root cause** (e.g., repeated missing type), they MAY be batched into a single fix pass. Otherwise, fix one at a time.

---

## Phase 2.5: Load Context

Before planning any fix, you MUST load the actual source code:

1. Open the target file using `view_file`
2. Read **at least 30 lines** surrounding the error line (15 above, 15 below)
3. Identify the **exact code** causing the issue
4. Check imports, types, and function signatures that the error references
5. If the error involves an imported symbol, **also open the source file** of that import

If the file cannot be accessed:

```
FILE ACCESS ERROR: Cannot read [file path]. Aborting fix.
```

**Rules:**
- 🚫 Never plan a fix from the error message alone
- 🚫 Never assume what a variable, type, or function looks like — read it first
- ✅ Cross-reference any imported types or referenced files if the error involves them

---

## Phase 2.7: Memory Injection (ACTIVE — NOT PASSIVE)

Before planning a fix, query the **Evolution Memory** for intelligence on this error:

### 2.7.1 Check Failed Strategies

Query `getFailedStrategies(errorSignature)` from `evolution-memory.ts`:

```
MEMORY CHECK: Failed Strategies

Error signature: [signature]
Previously failed approaches:
- [strategy 1] — tried [date], result: FAILED
- [strategy 2] — tried [date], result: REGRESSED

🚫 DO NOT retry these strategies. They are proven ineffective for this error.
```

If no history exists: `No prior fix attempts recorded. Proceeding with fresh analysis.`

### 2.7.2 Check Effective Strategies

Query `getEffectiveStrategies(errorSignature)`:

```
MEMORY CHECK: Effective Strategies

Error signature: [signature]
Previously successful approaches:
- [strategy] — tried [date], result: SUCCESS (still holding)

✅ PREFER this strategy. It has a proven track record for this error type.
```

### 2.7.3 Check Regression Risks

Query `getKnownRegressions(targetFile)`:

```
MEMORY CHECK: Regression Risks

Target file: [file]
Known regression pairs:
- Editing [file] has previously broken [otherFile] ([N] times)
- Avoidance rule: [rule]

⚠️ After applying fix, MUST explicitly verify [otherFile] still passes.
```

If no regressions known: `No known regression risks for this file.`

### 2.7.4 Record This Attempt

After memory checks, log the current attempt to evolution memory via `recordFailurePattern()` so future runs can learn from this one.

---

## Phase 3: Minimal Fix Plan (VISIBLE — NOT INTERNAL)

Write a short, visible plan before editing:

```
DIAGNOSIS:
  Error: <exact error message>
  File:  <path>
  Line:  <number>

FIX PLAN:
  - Edit file: X
  - Change: Y → Z
  - Reason: Fixes <exact error message>

SCOPE:
  - Lines affected: [line range]
  - Other files affected: [none | list]
  - Expected downstream impact: [none | "should also resolve N related errors"]
```

**Rules:**
- 🚫 No guessing
- 🚫 No renaming unrelated variables
- 🚫 No refactoring beyond the targeted error

---

## Phase 4: Execute Fix

Apply the fix using code-editing tools.

**Rules:**
- Only modify the targeted lines
- Do NOT refactor unrelated code
- Do NOT comment out logic
- Preserve typing integrity

---

## Phase 4.5: Validate Scope

Immediately after applying the fix, before re-running tests:

1. Review the diff of what you just changed
2. Confirm the change **only affects the error line(s)**
3. Confirm no unrelated logic, imports, or exports were modified
4. If the fix accidentally touched unrelated code, **revert that portion** before proceeding

If scope violation is detected:

```
SCOPE VIOLATION: Fix modified unrelated code at [file:line].
Reverting unrelated changes before proceeding.
```

---

## Phase 5: Verify

Re-run based on the Fast-Fail Gate:

```bash
export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"; npm run check
```

If `npm run check` passes:

```bash
export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"; npm run test
```

### Test Failure Interpretation Rules

If `ERROR TYPE = test failure`, apply these rules:

| Failure Type | Action |
|---|---|
| Assertion mismatch (expected vs actual) | Fix the **implementation**, not the test. Only modify the test if the test expectation is provably wrong. |
| Import / module resolution error | Fix the import path or missing export. |
| Async / timeout failure | Check for missing `await`, unresolved promises, or race conditions. Do NOT increase timeout values as a fix. |
| Mock / stub failure | Verify the mock matches the current function signature. Update mock, not implementation. |

**Default rule:** Prefer fixing implementation over modifying tests. Tests represent intended behavior.

### Flaky Test Detection

If test results are **inconsistent across consecutive runs** (pass on one run, fail on the next with the same code):

```
⚠️ FLAKY TEST SUITE DETECTED

Test: [test name]
Behavior: [passed on run N, failed on run N+1 with no code changes]

Skipping this test from the fix loop.
Flagging for human review.
```

Do NOT attempt to fix flaky tests. Report and move on to the next error.

---

## Phase 5.5: Regression Check

After a successful fix, compare current results against the **Regression Baseline** captured in Phase 1:

1. Were any **previously passing** tests now **failing**?
2. Were any **new** type errors introduced that didn't exist before?

If regression detected:

```
🔴 REGRESSION DETECTED

Test/Check: [name or error]
Previously:  PASS
Now:         FAIL
Caused by:   [last fix applied]

Action: Reverting last fix and trying alternative approach.
```

- Revert the fix that caused the regression
- Log it in the Attempt Log as a failed strategy
- Return to Phase 2.5 and try a different approach
- This counts as one of the 4 circuit breaker attempts

If no regression: proceed to Phase 6.

---

## Phase 6: Loop Control

### Fix Attempt Log

Maintain a running log of every attempt:

```
Attempt 1: [description of fix] → [result: pass/fail/regression]
Attempt 2: [description of fix] → [result: pass/fail/regression]
...
```

### Re-attempt Rules

If a fix fails:
- You **MUST** try a **different strategy** on the next attempt
- You **CANNOT** repeat the same fix
- Analyze *why* the previous fix failed before proceeding
- Re-load context (Phase 2.5) to check if your previous edit introduced new issues

### Circuit Breaker (STRICT)

**Maximum: 4 attempts per single error.**

If exceeded, output:

```
FAILED AFTER 4 ATTEMPTS

Error: [original error]
File:  [file path]

Tried:
1. [description] → [why it failed]
2. [description] → [why it failed]
3. [description] → [why it failed]
4. [description] → [why it failed]

Likely Issue:
[deeper root cause analysis]

Needs human intervention.
```

Then **move on to the next error** if others exist. Do not let one stubborn error block the entire loop.

---

## Success Condition

If `npm run check` and `npm run test` both pass cleanly with **zero regressions**:

```
✅ All tests passing! The loop is complete.

Fix Summary:
- File X: corrected Y
- File Z: resolved type mismatch

Total Attempts: [N]
Errors Fixed:   [N]
Errors Skipped: [N] (flaky/blocked)
Regressions Caught & Reverted: [N]
```

Then check: are there MORE errors remaining from the original Phase 1 output?
- If **yes**, loop back to Phase 2 with the next error.
- If **no**, the loop is finished.

---

## Enforcement

This loop defines a **rigid structural framework**. Do not bypass these steps. Do not skip phases. Do not internally plan — all plans must be visible in the output. This replaces the need for external workflow tools by leveraging native terminal execution and code-editing capabilities.

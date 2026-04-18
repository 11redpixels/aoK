# Agent Output Validation Layer

**Context:** This is the enforcement layer that ensures every agent in the system produces compliant, machine-readable output. Without this, the system is "LLM-ish" — with it, it's deterministic.

**Trigger:** This layer runs AUTOMATICALLY after every agent completes execution. It is not invoked manually.

---

## Validation Protocol

After any agent produces its Handoff Block + JSON Output Block, the orchestrator MUST validate the JSON before accepting it.

### Step 1: Extract JSON Block

Look for the JSON code fence in the agent's output:

```
```json
{ ... }
```​
```

If no JSON block is found:

```
OUTPUT VALIDATION FAILED:

Agent: [agent name]
Error: No structured JSON output block found

Action: Re-running agent with correction prompt:
"Your output is missing the required JSON summary block. 
Append it now using the format from your system rules."
```

### Step 2: Validate Fields

The JSON block MUST contain all required fields:

| Field | Type | Required |
|-------|------|----------|
| `agent` | string (valid agent name) | ✅ |
| `status` | `"complete"` \| `"failed"` \| `"blocked"` | ✅ |
| `output_type` | string | ✅ |
| `artifacts` | string[] | ✅ |
| `errors_found` | number | ✅ |
| `errors_fixed` | number | ✅ |
| `tests_passed` | number \| null | ✅ |
| `tests_failed` | number \| null | ✅ |
| `next_agent` | string \| null | ✅ |
| `requires_human` | boolean | ✅ |
| `human_prompt` | string \| null | ✅ |
| `timestamp` | ISO 8601 string | ✅ |

If any field is missing or invalid:

```
OUTPUT VALIDATION FAILED:

Agent: [agent name]
Errors:
- Missing required field: "artifacts"
- Invalid status: "done" (must be complete/failed/blocked)

Action: Re-running agent with correction prompt:
"Fix your JSON output. Errors: [list]. Resubmit the corrected block."
```

### Step 3: Accept or Reject

```
If valid:
  → Accept output
  → Record in pipeline state via state-manager.ts
  → Proceed to next agent

If invalid (after 1 retry):
  → Mark agent as "blocked"
  → Log validation failure
  → Route to user for manual intervention
```

---

## Enforcement Hierarchy

```
Agent executes
    ↓
Agent produces output (Handoff + JSON)
    ↓
Validator checks JSON
    ↓
  VALID? ──Yes──→ Accept → Record → Continue pipeline
    │
    No
    ↓
  Retry agent (1 attempt)
    ↓
  VALID? ──Yes──→ Accept → Record → Continue pipeline
    │
    No
    ↓
  BLOCKED → Log → Notify user
```

---

## Code Reference

The validation logic is implemented in:

```
server/state-manager.ts → validateAgentOutput()
```

This function accepts a parsed JSON object and returns `{ valid: boolean, errors: string[] }`.

---

## Rules

- Validation is NEVER skipped, even for the auto-fix engine
- A maximum of 1 retry is allowed for output correction
- The validator does NOT modify agent output — it only accepts or rejects
- All validation failures are logged to the pipeline's append-only log file

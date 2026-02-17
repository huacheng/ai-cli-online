---
name: verify
description: "Run domain-adapted tests and verification procedures, producing result files. Triggered after plan generation (post-plan), during execution (per-step), or after execution completes (post-exec) to provide evidence for check's verdict."
arguments:
  - name: task_module
    description: "Path to the task module directory (e.g., AiTasks/auth-refactor)"
    required: true
  - name: checkpoint
    description: "Verification scope: quick, full, or step-N"
    required: false
    default: full
---

# /moonview:verify — Test Execution & Verification

Run domain-adapted tests and verification procedures for a task module, producing structured result files. Does not render a verdict — that is the responsibility of `check`.

## Usage

```
/moonview:verify <task_module_path> [--checkpoint quick|full|step-N]
```

## Checkpoints

| Checkpoint | Scenario | Scope |
|------------|----------|-------|
| `quick` | Lightweight check during execution | build + lint + type check |
| `full` | Comprehensive post-execution verification | All `.test/` criteria + acceptance tests + regression tests |
| `step-N` | Per-step verification during exec | Only criteria related to step N |

## Execution Steps

1. **Read** `.index.json` — get `type`, `status`. Validate status is not terminal (`complete` or `cancelled`)
2. **Read** `.type-profile.md` if exists — "Verification Standards" section is the **primary** source for testing approach, quality metrics, and acceptance criteria for this task
3. **Read** `.test/` latest criteria file — determine what to verify
4. **Read** `.target.md` — extract acceptance criteria
5. **Read** `.summary.md` if exists — condensed context for understanding verification scope
6. **Read** `AiTasks/.references/.summary.md` if exists — keyword match against task domain → read matched `.references/<topic>.md` files for domain verification guidance (testing frameworks, tools, best practices)
7. **Gap check**: if `.type-profile.md` lacks verification standards OR `.references/` lacks testing/verification knowledge for the task `type`, trigger `research --scope gap --caller verify` to collect missing references before proceeding
8. **Determine** verification strategy: use `.type-profile.md` "Verification Standards" first, supplement with per-type seed file `init/references/seed-types/<type>.md` (verify section), combine with `.references/` domain knowledge. If verification reveals that `.type-profile.md` standards are inadequate, update its "Verification Standards" section with findings. For hybrid types (`A|B`), read seed files and experience for all segments
9. **Execute** verification procedures per checkpoint scope:
   - `quick`: build, lint, type check — fast feedback loop
   - `full`: all `.test/` criteria, acceptance tests from `.target.md`, regression tests
   - `step-N`: only criteria associated with step N from `.test/` criteria file
10. **Write** `.test/<YYYY-MM-DD>-<checkpoint>-results.md` with structured test outcomes (pass/fail per criterion, raw output, metrics)
11. **Update** `.test/.summary.md` — overwrite with condensed summary of ALL criteria & results files in `.test/`
12. **Git commit**: `-- ai-cli-task(<module>):verify <checkpoint> verification`
13. **Write** `.auto-signal`: `{ "step": "verify", "result": "(pass|fail|partial)", "next": "check", "checkpoint": "<checkpoint>", "timestamp": "..." }`
14. **Report** results summary to user

## Result Values

| Result | Meaning |
|--------|---------|
| `pass` | All verification criteria met |
| `fail` | One or more critical criteria failed |
| `partial` | Some criteria passed, some failed (non-critical failures) |

## State Transitions

None — `verify` is a utility sub-command. It does not change task status.

## Git

```
-- ai-cli-task(<module>):verify <checkpoint> verification
```

Examples:
```
-- ai-cli-task(auth-refactor):verify quick verification
-- ai-cli-task(auth-refactor):verify full verification
-- ai-cli-task(auth-refactor):verify step-3 verification
```

## .auto-signal

The `checkpoint` field in verify's signal carries **the verification scope** (what was tested), not the check checkpoint. When `check` receives verify results, it uses the **invoking context** (status + triggering signal) to determine its own checkpoint — NOT verify's checkpoint field.

| Verify Scope | Signal |
|------------|--------|
| quick | `{ "step": "verify", "result": "(pass)", "next": "check", "checkpoint": "quick", "timestamp": "..." }` |
| full | `{ "step": "verify", "result": "(pass)", "next": "check", "checkpoint": "full", "timestamp": "..." }` |
| step-N | `{ "step": "verify", "result": "(pass)", "next": "check", "checkpoint": "step-N", "timestamp": "..." }` |

Result values: `(pass)`, `(fail)`, `(partial)` — see Result Values table above.

**Auto routing note**: In the auto loop, verify's checkpoint field is informational for the daemon. The auto loop determines the correct `check` checkpoint from the triggering context (e.g., after `plan` → `check --checkpoint post-plan`; after `exec (done)` → `check --checkpoint post-exec`; after `exec (mid-exec)` → `check --checkpoint mid-exec`).

## Notes

- **Utility, not gatekeeper**: `verify` runs tests and produces results; `check` reads those results and renders verdicts. This separation allows tests to be re-run independently without triggering state transitions
- **check integration**: `check` can optionally invoke `verify` internally, or read pre-existing `verify` results from `.test/`. When recent `verify` results exist (same day, matching checkpoint), `check` incorporates them instead of re-running tests
- **exec integration**: Per-step verification in `exec` can optionally invoke `verify --checkpoint step-N` for domain-specific testing. For lightweight checks (build + lint), inline verification is sufficient
- **Domain adaptation**: Verification strategy MUST match the task `type` — use `.type-profile.md` first, then per-type seed file `init/references/seed-types/<type>.md` for domain-specific testing procedures, tools, and thresholds. Supplement with web search for current best practices
- **Concurrency**: Verify acquires `AiTasks/<module>/.lock` before proceeding and releases on completion (see Concurrency Protection in `commands/ai-cli-task.md`)

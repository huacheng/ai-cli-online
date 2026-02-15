---
name: verify
description: Run domain-adapted tests and verification procedures, producing result files
arguments:
  - name: task_module
    description: "Path to the task module directory (e.g., AiTasks/auth-refactor)"
    required: true
  - name: checkpoint
    description: "Verification scope: quick, full, or step-N"
    required: false
    default: full
---

# /ai-cli-task:verify — Test Execution & Verification

Run domain-adapted tests and verification procedures for a task module, producing structured result files. Does not render a verdict — that is the responsibility of `check`.

## Usage

```
/ai-cli-task:verify <task_module_path> [--checkpoint quick|full|step-N]
```

## Checkpoints

| Checkpoint | Scenario | Scope |
|------------|----------|-------|
| `quick` | Lightweight check during execution | build + lint + type check |
| `full` | Comprehensive post-execution verification | All `.test/` criteria + acceptance tests + regression tests |
| `step-N` | Per-step verification during exec | Only criteria related to step N |

## Execution Steps

1. **Read** `.index.json` — get `type`, `status`. Validate status is not terminal (`complete` or `cancelled`)
2. **Read** `.test/` latest criteria file — determine what to verify
3. **Read** `.target.md` — extract acceptance criteria
4. **Read** `.summary.md` if exists — condensed context for understanding verification scope
5. **Read** `AiTasks/.references/.summary.md` if exists — keyword match against task domain → read matched `.references/<topic>.md` files for domain verification guidance
6. **Determine** verification strategy based on task `type` (see `check/references/task-type-verification.md` for the full domain reference table)
7. **Execute** verification procedures per checkpoint scope:
   - `quick`: build, lint, type check — fast feedback loop
   - `full`: all `.test/` criteria, acceptance tests from `.target.md`, regression tests
   - `step-N`: only criteria associated with step N from `.test/` criteria file
8. **Write** `.test/<YYYY-MM-DD>-<checkpoint>-results.md` with structured test outcomes (pass/fail per criterion, raw output, metrics)
9. **Update** `.test/.summary.md` — overwrite with condensed summary of ALL criteria & results files in `.test/`
10. **Git commit**: `-- ai-cli-task(<module>):verify <checkpoint> verification`
11. **Write** `.auto-signal`: `{ "step": "verify", "result": "(pass|fail|partial)", "next": "check", "checkpoint": "<checkpoint>", "timestamp": "..." }`
12. **Report** results summary to user

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

| Checkpoint | Signal |
|------------|--------|
| quick | `{ "step": "verify", "result": "(pass)", "next": "check", "checkpoint": "quick", "timestamp": "..." }` |
| full | `{ "step": "verify", "result": "(pass)", "next": "check", "checkpoint": "full", "timestamp": "..." }` |
| step-N | `{ "step": "verify", "result": "(pass)", "next": "check", "checkpoint": "step-N", "timestamp": "..." }` |

Result values: `(pass)`, `(fail)`, `(partial)` — see Result Values table above.

## Notes

- **Utility, not gatekeeper**: `verify` runs tests and produces results; `check` reads those results and renders verdicts. This separation allows tests to be re-run independently without triggering state transitions
- **check integration**: `check` can optionally invoke `verify` internally, or read pre-existing `verify` results from `.test/`. When recent `verify` results exist (same day, matching checkpoint), `check` incorporates them instead of re-running tests
- **exec integration**: Per-step verification in `exec` can optionally invoke `verify --checkpoint step-N` for domain-specific testing. For lightweight checks (build + lint), inline verification is sufficient
- **Domain adaptation**: Verification strategy MUST match the task `type` — use the domain reference table in `check/references/task-type-verification.md` to select appropriate tools and methods
- **No mental math**: When verification involves numerical comparisons (thresholds, metrics, performance benchmarks), write a script and run it in shell instead of computing mentally
- **Concurrency**: Verify acquires `AiTasks/<module>/.lock` before proceeding and releases on completion (see Concurrency Protection in `commands/ai-cli-task.md`)

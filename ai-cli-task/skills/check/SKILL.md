---
name: check
description: Check plan feasibility at key checkpoints — post-plan, mid-execution, post-execution
arguments:
  - name: task_module
    description: "Path to the task module directory (e.g., AiTasks/auth-refactor)"
    required: true
  - name: checkpoint
    description: "Evaluation checkpoint: post-plan, mid-exec, post-exec"
    required: false
    default: post-plan
---

# /moonview:check — Plan Feasibility Check

Check the implementation plan at three lifecycle checkpoints. Acts as the decision maker in the task state machine.

## Usage

```
/moonview:check <task_module_path> [--checkpoint post-plan|mid-exec|post-exec]
```

## Checkpoints

### 1. post-plan (default)

Evaluates whether the implementation plan is ready for execution.

**Reads:** `.target.md` + `.plan.md` + `.summary.md` (if exists) + `.test/` (latest criteria file) + `.bugfix/` (latest file if exists, to verify revised plan addresses execution issues)

**Evaluation Criteria:**

| Criterion | Weight | Description |
|-----------|--------|-------------|
| **Completeness** | High | Does the plan cover all requirements in `.target.md`? |
| **Feasibility** | High | Can the plan be implemented with current codebase/tools? |
| **Verifiability** | High | Does `.test/` contain criteria files with testable acceptance criteria and per-step verification? Are test/verification methods appropriate for the task type (see Task-Type-Aware Verification below)? |
| **Clarity** | Medium | Are implementation steps clear and unambiguous? |
| **Risk** | Medium | Are risks identified and mitigated? |
| **Dependencies** | High | Are all `depends_on` modules meeting their required status? (simple → `complete`, extended → at-or-past `min_status`) If not → BLOCKED |

**Outcomes:**

| Result | Action | Status Transition |
|--------|--------|-------------------|
| **PASS** | Create `.analysis/<date>-post-plan-pass.md` with approval summary | `planning` → `review` |
| **NEEDS_REVISION** | Create `.analysis/<date>-post-plan-needs-revision.md` with specific issues | Status unchanged |
| **BLOCKED** | Create `.analysis/<date>-post-plan-blocked.md` with blocking reasons | → `blocked` |

### 2. mid-exec

Evaluates progress during execution when issues are encountered.

**Reads:** `.target.md` + `.plan.md` + `.summary.md` (if exists) + `.test/` (latest criteria + results) + `.analysis/` (latest file only) + current code changes (via git diff)

**Evaluation Criteria:**

| Criterion | Weight | Description |
|-----------|--------|-------------|
| **Progress** | High | How much of the plan has been completed? (read `completed_steps` from `.index.json`) |
| **Deviation** | High | Has execution deviated from the plan? |
| **Issues** | High | Are encountered issues resolvable? |
| **Continue vs Replan** | Critical | Should execution continue or revert to planning? |

**Outcomes:**

| Result | Action | Status Transition |
|--------|--------|-------------------|
| **CONTINUE** | Document progress, note any adjustments | Status unchanged |
| **NEEDS_FIX** | Create `.bugfix/<date>-<summary>.md` with specific fixable issues | Status unchanged |
| **REPLAN** | Create `.bugfix/<date>-<summary>.md` with issue analysis | `executing` → `re-planning`, set `phase: needs-plan` |
| **BLOCKED** | Create `.analysis/<date>-mid-exec-blocked.md` with blocking analysis | → `blocked` |

### 3. post-exec

Evaluates whether execution results meet the task requirements.

**Reads:** `.target.md` + `.plan.md` + `.summary.md` (if exists) + `.test/.summary.md` (primary; drill into individual `.test/` files only if summary is missing or insufficient) + `.analysis/` (latest file only) + code changes + test results

**Evaluation Criteria:**

| Criterion | Weight | Description |
|-----------|--------|-------------|
| **Requirements met** | Critical | Does the implementation satisfy `.target.md`? |
| **Tests pass** | High | Do all relevant tests pass? |
| **No regressions** | High | Are there any unintended side effects? |
| **Code quality** | Medium | Does the code follow project conventions? |

**Outcomes:**

| Result | Action | Status Transition |
|--------|--------|-------------------|
| **ACCEPT** | Create `.analysis/<date>-post-exec-accept.md`, write `.test/<date>-post-exec-results.md` | Status unchanged (`executing`), signal → `merge` sub-command |
| **NEEDS_FIX** | Create `.analysis/<date>-post-exec-needs-fix.md` with specific issues | Status unchanged |
| **REPLAN** | Create `.analysis/<date>-post-exec-replan.md` with fundamental issues | `executing` → `re-planning`, set `phase: needs-plan` |

## Output Files

| File | When Created | Content |
|------|-------------|---------|
| `.analysis/<date>-<summary>.md` | post-plan, mid-exec (BLOCKED), post-exec | Feasibility analysis, blocking analysis, or issue list. One file per assessment, preserving evaluation history |
| `.bugfix/<date>-<summary>.md` | mid-exec (NEEDS_FIX, REPLAN) | Issue analysis, root cause, fix approach. One file per issue |
| `.test/<date>-<checkpoint>-results.md` | mid-exec, post-exec | Test outcomes for criteria verification. One file per checkpoint evaluation |

When writing to any history directory (`.analysis/`, `.bugfix/`, `.test/`), also overwrite that directory's `.summary.md` with a condensed summary of all entries in the directory.

## Execution Steps

1. **Read** `.index.json` to get current task status
2. **Validate** checkpoint is appropriate for current status:
   - `post-plan`: requires status `planning` or `re-planning`
   - `mid-exec`: requires status `executing`
   - `post-exec`: requires status `executing`
3. **Validate dependencies**: read `depends_on` from `.index.json`, check each dependency module's `.index.json` status against its required level (simple string → `complete`, extended object → at-or-past `min_status`). If any dependency is not met, verdict is BLOCKED with dependency details
4. **Read** `.type-profile.md` if exists — "Verification Standards", "Quality metrics", and "Audit Adaptation" sections are the **primary** source for evaluation criteria and domain-specific audit checkpoints. If check reveals the profile's standards are inadequate for this domain, update the relevant sections with findings
5. **Read** all relevant files per checkpoint (use `.summary.md` as primary context, latest file only from each history directory)
6. **Scan** `AiTasks/.references/.summary.md` if exists — find relevant external reference files to inform evaluation criteria and domain best practices
7. **Gap check**: if `.type-profile.md` lacks evaluation criteria OR `.references/` lacks domain evaluation standards/benchmarks for the task `type`, trigger `research --scope gap --caller check` to collect missing references before proceeding
8. **Incorporate verify results**: If fresh verification results exist in `.test/` (from a prior `verify` run, same day and matching checkpoint), read and incorporate them. Otherwise, run verification procedures inline as part of evaluation
9. **Evaluate** against criteria
10. **Write** output files per outcome: evaluation to `.analysis/` or `.bugfix/` (per Outcomes tables above), and test results to `.test/<date>-<checkpoint>-results.md` when tests are evaluated (mid-exec and post-exec checkpoints)
11. **Update** each written directory's `.summary.md` — overwrite with condensed summary of ALL entries in that directory (`.analysis/.summary.md`, `.bugfix/.summary.md`, `.test/.summary.md` as applicable per checkpoint)
12. **Write** task-level `.summary.md` with condensed context: task state, plan summary, evaluation outcome, progress (`completed_steps`), known issues, key decisions (integrate from directory summaries)
13. **Update** `.index.json` status and timestamp per outcome
14. **Write** `.auto-signal` with verdict, next action, and checkpoint (see .auto-signal section below)
15. **Report** evaluation result with detailed reasoning

## State Transitions

```
post-plan PASS:          planning → review
post-plan PASS:          re-planning → review, phase: "" (cleared)
post-plan NEEDS_REVISION: (no change, files committed). If current status is `re-planning`, set `phase: needs-plan`; if `planning`, phase stays `""`
post-plan BLOCKED:       → blocked

mid-exec CONTINUE:       (no change)
mid-exec NEEDS_FIX:      (no change, files committed)
mid-exec REPLAN:         executing → re-planning, phase: needs-plan
mid-exec BLOCKED:        → blocked

post-exec ACCEPT:        (no change, signal → merge)
post-exec NEEDS_FIX:     (no change, files committed)
post-exec REPLAN:        executing → re-planning, phase: needs-plan
```

## Git

| Outcome | Commit Message |
|---------|---------------|
| PASS | `-- ai-cli-task(<module>):check post-plan PASS → review` |
| ACCEPT | `-- ai-cli-task(<module>):check post-exec ACCEPT` |
| REPLAN | `-- ai-cli-task(<module>):check replan → re-planning` |
| BLOCKED | `-- ai-cli-task(<module>):check blocked → blocked` |
| NEEDS_REVISION | `-- ai-cli-task(<module>):check post-plan NEEDS_REVISION` |
| NEEDS_FIX (mid-exec) | `-- ai-cli-task(<module>):check mid-exec NEEDS_FIX` |
| NEEDS_FIX (post-exec) | `-- ai-cli-task(<module>):check post-exec NEEDS_FIX` |
| CONTINUE | `-- ai-cli-task(<module>):check mid-exec CONTINUE` |

All outcomes commit their output files and state updates, regardless of whether status changes.

## .auto-signal

Every check outcome writes `.auto-signal` on completion:

| Checkpoint | Result | Signal |
|------------|--------|--------|
| post-plan | PASS | `{ "step": "check", "result": "PASS", "next": "exec", "checkpoint": "", "timestamp": "..." }` |
| post-plan | NEEDS_REVISION | `{ "step": "check", "result": "NEEDS_REVISION", "next": "plan", "checkpoint": "", "timestamp": "..." }` |
| post-plan | BLOCKED | `{ "step": "check", "result": "BLOCKED", "next": "(stop)", "checkpoint": "", "timestamp": "..." }` |
| mid-exec | CONTINUE | `{ "step": "check", "result": "CONTINUE", "next": "exec", "checkpoint": "", "timestamp": "..." }` |
| mid-exec | NEEDS_FIX | `{ "step": "check", "result": "NEEDS_FIX", "next": "exec", "checkpoint": "mid-exec", "timestamp": "..." }` |
| mid-exec | REPLAN | `{ "step": "check", "result": "REPLAN", "next": "plan", "checkpoint": "", "timestamp": "..." }` |
| mid-exec | BLOCKED | `{ "step": "check", "result": "BLOCKED", "next": "(stop)", "checkpoint": "", "timestamp": "..." }` |
| post-exec | ACCEPT | `{ "step": "check", "result": "ACCEPT", "next": "merge", "checkpoint": "", "timestamp": "..." }` |
| post-exec | NEEDS_FIX | `{ "step": "check", "result": "NEEDS_FIX", "next": "exec", "checkpoint": "post-exec", "timestamp": "..." }` |
| post-exec | REPLAN | `{ "step": "check", "result": "REPLAN", "next": "plan", "checkpoint": "", "timestamp": "..." }` |

When ACCEPT, the `merge` sub-command handles refactoring, merge, conflict resolution, and cleanup. See `skills/merge/SKILL.md`.

## Task-Type-Aware Verification

Verification methods MUST match the task domain. Read `type` from `.index.json` and apply domain-appropriate verification. If test methods are mismatched for the task type → verdict is NEEDS_REVISION.

> **See `init/references/seed-types/<type>.md`** for per-type seed methodology (indicators, verification approach). Shared profiles in `AiTasks/.type-profiles/` take precedence when available.

## Notes

- **Judgment bias**: When uncertain between PASS and NEEDS_REVISION, prefer NEEDS_REVISION. When uncertain between ACCEPT and NEEDS_FIX, prefer NEEDS_FIX. False negatives (extra iteration) are cheaper than false positives (bad code merged).
- Evaluation should be thorough but pragmatic — focus on blocking issues, not style preferences
- Each assessment creates a new file in `.analysis/` (full evaluation history preserved, latest = last by filename sort)
- Each mid-exec issue creates a new file in `.bugfix/` (one issue per file, filename includes date + summary)
- For `post-exec`, if tests exist (`.test/` criteria files), they MUST be run and pass for ACCEPT
- Check writes test results to `.test/<date>-<checkpoint>-results.md` (e.g., `2024-01-15-post-exec-results.md`) documenting test outcomes
- `depends_on` in `.index.json` MUST be validated: if any dependency is not met (simple string → `complete`, extended object → at-or-past `min_status`), verdict is BLOCKED (not just flagged as risk)
- **Concurrency**: Check acquires `AiTasks/<module>/.lock` before proceeding and releases on completion (see Concurrency Protection in `commands/ai-cli-task.md`)
- **Six-perspective audit**: For thorough evaluation, apply security / architecture / performance / extensibility / consistency / correctness checks systematically, adapted to the task's domain type. See `references/six-perspective-audit.md` for the full checklist and domain adaptation table
- **verify integration**: The `verify` sub-command can pre-run tests independently. When recent `verify` results exist (same day, matching checkpoint), check incorporates them instead of re-running. This is optional — check works standalone

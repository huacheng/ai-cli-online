---
name: check
description: Check plan feasibility at key checkpoints — post-plan, mid-execution, post-execution
arguments:
  - name: task_module
    description: "Path to the task module directory (e.g., TASK/auth-refactor)"
    required: true
  - name: checkpoint
    description: "Evaluation checkpoint: post-plan, mid-exec, post-exec"
    required: false
    default: post-plan
---

# /ai-cli-task check — Plan Feasibility Check

Check the implementation plan at three lifecycle checkpoints. Acts as the decision maker in the task state machine.

## Usage

```
/ai-cli-task check <task_module_path> [--checkpoint post-plan|mid-exec|post-exec]
```

## Checkpoints

### 1. post-plan (default)

Evaluates whether the implementation plan is ready for execution.

**Reads:** `.target.md` + all user-created plan `.md` files in the module + `.test.md` + `.bugfix/` (if exists, to verify revised plan addresses execution issues)

**Evaluation Criteria:**

| Criterion | Weight | Description |
|-----------|--------|-------------|
| **Completeness** | High | Does the plan cover all requirements in `.target.md`? |
| **Feasibility** | High | Can the plan be implemented with current codebase/tools? |
| **Verifiability** | High | Does `.test.md` exist with testable acceptance criteria and per-step verification? |
| **Clarity** | Medium | Are implementation steps clear and unambiguous? |
| **Risk** | Medium | Are risks identified and mitigated? |
| **Dependencies** | Low | Are external dependencies (other task modules) accounted for? |

**Outcomes:**

| Result | Action | Status Transition |
|--------|--------|-------------------|
| **PASS** | Create `.analysis/<date>-post-plan-pass.md` with approval summary | `planning` → `review` |
| **NEEDS_REVISION** | Create `.analysis/<date>-post-plan-needs-rev.md` with specific issues | Status unchanged |
| **BLOCKED** | Create `.analysis/<date>-post-plan-blocked.md` with blocking reasons | → `blocked` |

### 2. mid-exec

Evaluates progress during execution when issues are encountered.

**Reads:** `.target.md` + plan files + `.test.md` + `.analysis/` (latest) + current code changes (via git diff)

**Evaluation Criteria:**

| Criterion | Weight | Description |
|-----------|--------|-------------|
| **Progress** | High | How much of the plan has been completed? |
| **Deviation** | High | Has execution deviated from the plan? |
| **Issues** | High | Are encountered issues resolvable? |
| **Continue vs Replan** | Critical | Should execution continue or revert to planning? |

**Outcomes:**

| Result | Action | Status Transition |
|--------|--------|-------------------|
| **CONTINUE** | Document progress, note any adjustments | Status unchanged |
| **NEEDS_FIX** | Create `.bugfix/<date>-<summary>.md` with specific fixable issues | Status unchanged |
| **REPLAN** | Create `.bugfix/<date>-<summary>.md` with issue analysis | `executing` → `re-planning` |
| **BLOCKED** | Write blocking analysis | → `blocked` |

### 3. post-exec

Evaluates whether execution results meet the task requirements.

**Reads:** `.target.md` + plan files + `.test.md` + `.analysis/` (latest) + code changes + test results

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
| **ACCEPT** | Create `.analysis/<date>-post-exec-accept.md`, task-level refactoring, merge to main | `executing` → `complete` (if merge conflict → stays `executing`, report conflict) |
| **NEEDS_FIX** | Create `.analysis/<date>-post-exec-needs-fix.md` with specific issues | Status unchanged |
| **REPLAN** | Create `.analysis/<date>-post-exec-replan.md` with fundamental issues | `executing` → `re-planning` |

## Output Files

| File | When Created | Content |
|------|-------------|---------|
| `.analysis/<date>-<summary>.md` | post-plan, post-exec | Feasibility analysis (post-plan) or issue list (NEEDS_FIX). One file per assessment, preserving evaluation history |
| `.bugfix/<date>-<summary>.md` | mid-exec (NEEDS_FIX, REPLAN) | Issue analysis, root cause, fix approach. One file per issue |

## Execution Steps

1. **Read** `.index.md` to get current task status
2. **Validate** checkpoint is appropriate for current status:
   - `post-plan`: requires status `planning` or `re-planning`
   - `mid-exec`: requires status `executing`
   - `post-exec`: requires status `executing`
3. **Read** all relevant files per checkpoint
4. **Evaluate** against criteria
5. **Write** analysis to appropriate system file
6. **Update** `.index.md` status and timestamp per outcome
7. **Report** evaluation result with detailed reasoning

## State Transitions

```
post-plan PASS:          planning → review
post-plan NEEDS_REVISION: (no change)
post-plan BLOCKED:       → blocked

mid-exec CONTINUE:       (no change)
mid-exec NEEDS_FIX:      (no change)
mid-exec REPLAN:         executing → re-planning
mid-exec BLOCKED:        → blocked

post-exec ACCEPT:        executing → complete
post-exec NEEDS_FIX:     (no change)
post-exec REPLAN:        executing → re-planning
```

## Git

| Outcome | Commit Message |
|---------|---------------|
| PASS | `-- ai-cli-task(<module>):check post-plan PASS → review` |
| ACCEPT | `-- ai-cli-task(<module>):check post-exec ACCEPT → complete` + merge to main |
| REPLAN | `-- ai-cli-task(<module>):check replan → re-planning` |
| BLOCKED | `-- ai-cli-task(<module>):check blocked → blocked` |
| NEEDS_REVISION / NEEDS_FIX | No commit (status unchanged) |

### Refactoring & Merge

When ACCEPT:
1. **Task-level refactoring** on task branch (dead code, naming, duplication cleanup)
2. Commit: `-- ai-cli-task(<module>):refactor cleanup before merge`
3. **Merge to main**:
   - If worktree: `cd <project-root>` first (worktree is locked to task branch)
   - `git checkout main` (non-worktree) or already on main (worktree, main worktree)
   ```bash
   git merge task/<module> --no-ff -m "-- ai-cli-task(<module>):merge merge completed task"
   ```
4. **Cleanup** (after successful merge):
   - If worktree exists: `git worktree remove .worktrees/task-<module>`
   - Delete merged branch: `git branch -d task/<module>`

## Notes

- **Judgment bias**: When uncertain between PASS and NEEDS_REVISION, prefer NEEDS_REVISION. When uncertain between ACCEPT and NEEDS_FIX, prefer NEEDS_FIX. False negatives (extra iteration) are cheaper than false positives (bad code merged).
- Evaluation should be thorough but pragmatic — focus on blocking issues, not style preferences
- Each assessment creates a new file in `.analysis/` (full evaluation history preserved, latest = last by filename sort)
- Each mid-exec issue creates a new file in `.bugfix/` (one issue per file, filename includes date + summary)
- For `post-exec`, if tests exist, they MUST be run and pass for ACCEPT
- `depends_on` in `.index.md` should be checked: if dependencies are not `complete`, flag as risk

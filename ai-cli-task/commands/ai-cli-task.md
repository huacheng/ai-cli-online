---
description: "Task lifecycle management — init, plan, check, exec, merge, report, auto, cancel"
arguments:
  - name: subcommand
    description: "Sub-command: init, plan, check, exec, merge, report, auto, cancel"
    required: true
  - name: args
    description: "Sub-command arguments (varies by sub-command)"
    required: false
---

# /ai-cli-task — Task Lifecycle Management

Single entry point for task lifecycle management in the `TASK/` directory.

## Arguments

{{ARGUMENTS}}

## Shared Context

### TASK/ Directory Convention

```
TASK/
├── .index.md                  # Root index (task module listing)
└── <module-name>/             # One directory per task module
    ├── .index.md              # Task metadata (YAML frontmatter)
    ├── .target.md             # Requirements / objectives (human-authored)
    ├── .analysis/             # Evaluation history (one file per assessment by check)
    ├── .test/                 # Test criteria & results (one file per phase, by plan/exec/check)
    ├── .bugfix/               # Issue history (one file per mid-exec issue by check)
    ├── .notes/                # Research notes & experience log (*-plan/*-exec suffix per origin)
    ├── .summary.md            # Condensed context summary (written by plan/check/exec, read by all)
    ├── .report.md             # Completion report (written by report)
    ├── .tmp-annotations.json  # Transient annotation transport (frontend → plan)
    ├── .auto-signal           # Transient auto-loop progress report (ephemeral)
    ├── .auto-stop             # Transient auto-loop stop request (ephemeral)
    └── *.md                   # User-authored plan documents (non-dot-prefixed)
```

- **Dot-prefixed** files are system-managed; only `.target.md` is human-editable
- **Non-dot** `.md` files are user-authored plan documents via the Plan annotation panel
- `.tmp-annotations.json`, `.auto-signal`, and `.auto-stop` are ephemeral (should be in `.gitignore`)
- `.notes/` files use origin suffix: `<YYYY-MM-DD>-<summary>-plan.md` or `<YYYY-MM-DD>-<summary>-exec.md`
- `.test/` files use phase prefix: `<YYYY-MM-DD>-<phase>-criteria.md` (test plan) or `<YYYY-MM-DD>-<phase>-results.md` (test outcomes)
- `.summary.md` is a condensed context file — written by `plan`/`check`/`exec` after each run, read by subsequent steps instead of all history files. Prevents context window overflow as task accumulates history

### .summary.md Format

`.summary.md` is overwritten (not appended) on each write. Recommended structure:

```markdown
# Task Summary: <title>

**Status**: <status> | **Phase**: <phase> | **Progress**: <completed_steps>/<total_steps>

## Plan Overview
<!-- 3-5 sentence summary of the implementation approach -->

## Current State
<!-- What was last done, what's next -->

## Key Decisions
<!-- Important architectural/design decisions made so far -->

## Known Issues
<!-- Active issues, blockers, or risks -->

## Lessons Learned
<!-- Patterns, workarounds, or discoveries from execution -->
```

Writers should keep `.summary.md` under ~200 lines. It is a context window optimization — not a full record (that's `.report.md`).

### .index.md YAML Schema

```yaml
---
title: "Human-readable task title"
status: draft
phase: ""
completed_steps: 0
created: 2024-01-01T00:00:00Z
updated: 2024-01-01T00:00:00Z
depends_on: []
tags: []
branch: "task/module-name"
worktree: ".worktrees/task-module-name"   # empty if not using worktree
---
```

#### Phase Field

The `phase` field disambiguates sub-states within a status, primarily for `re-planning` auto recovery:

| Status | Phase | Meaning | Auto Entry Action |
|--------|-------|---------|-------------------|
| `re-planning` | `needs-plan` | check REPLAN set status, plan hasn't run yet | `plan --generate` |
| `re-planning` | `needs-check` | plan regenerated, ready for assessment | `check --checkpoint post-plan` |
| (other) | `""` (empty) | No sub-state needed | Status-based routing |

Writers: `check` sets `phase: needs-plan` on REPLAN. `plan` sets `phase: needs-check` when completing on `re-planning` status. All other transitions clear `phase` to `""`.

### Status State Machine

| Status | Description | Transitions To |
|--------|-------------|----------------|
| `draft` | Task target being defined | `planning` |
| `planning` | Plan being researched | `review`, `blocked` |
| `review` | Plan passed assessment | `executing`, `re-planning` |
| `executing` | Implementation in progress | `complete`, `re-planning`, `blocked` |
| `re-planning` | Plan being revised | `review`, `blocked` |
| `complete` | Finished and verified | — |
| `blocked` | Blocked by dependency/issue | `planning` |
| `cancelled` | Abandoned (via `cancel`) | — |

### Complete State × Command Matrix

Every (state, sub-command) combination. `→X` = transitions to X. `=` = stays same. `⊘` = rejected (prerequisite fail). `—` = no status change.

| State ↓ \ Command → | plan | check post-plan | check mid-exec | check post-exec | exec | merge | report | cancel |
|---|---|---|---|---|---|---|---|---|
| `draft` | →`planning` | ⊘ | ⊘ | ⊘ | ⊘ | ⊘ | — | →`cancelled` |
| `planning` | =`planning` | PASS→`review` / NEEDS_REV=`planning` / BLOCKED→`blocked` | ⊘ | ⊘ | ⊘ | ⊘ | — | →`cancelled` |
| `review` | →`re-planning` | ⊘ | ⊘ | ⊘ | →`executing` | ⊘ | — | →`cancelled` |
| `executing` | →`re-planning` | ⊘ | CONT=`executing` / NEEDS_FIX=`executing` / REPLAN→`re-planning` / BLOCKED→`blocked` | ACCEPT=`executing` (signal→merge) / NEEDS_FIX=`executing` / REPLAN→`re-planning` | =`executing` (NEEDS_FIX fix) / →`blocked` (dependency) | →`complete` / =`executing` (conflict) | — | →`cancelled` |
| `re-planning` | =`re-planning` | PASS→`review` / NEEDS_REV=`re-planning` / BLOCKED→`blocked` | ⊘ | ⊘ | ⊘ | ⊘ | — | →`cancelled` |
| `complete` | ⊘ | ⊘ | ⊘ | ⊘ | ⊘ | ⊘ | — (write) | →`cancelled` |
| `blocked` | →`planning` | ⊘ | ⊘ | ⊘ | ⊘ | ⊘ | — (write) | →`cancelled` |
| `cancelled` | ⊘ | ⊘ | ⊘ | ⊘ | ⊘ | ⊘ | — (write) | — (no-op) |

**Legend:** `→X` transition, `=X` self-loop (stays same status), `⊘` rejected, `—` no status change.

**Verification properties:**
- Every non-terminal state has ≥1 exit path (no deadlock)
- Terminal states: only `complete` and `cancelled`
- `cancel` is always available (no-op on already `cancelled`)
- `exec` requires `review` gate (cannot skip `check`)
- `merge` requires ACCEPT verdict gate (cannot skip `check post-exec`)
- `re-planning` must pass through `check` to reach `review`
- NEEDS_FIX/NEEDS_REVISION self-loops are broken by auto signal routing (`next` field)

### Annotation Format (for `plan` sub-command)

`.tmp-annotations.json` contains four `string[][]` arrays:

```json
{
  "Insert Annotations": [["Line{N}:...before20", "content", "after20..."]],
  "Delete Annotations": [["Line{N}:...before20", "selected", "after20..."]],
  "Replace Annotations": [["Line{N}:...before20", "selected", "replacement", "after20..."]],
  "Comment Annotations": [["Line{N}:...before20", "selected", "comment", "after20..."]]
}
```

| Type | Elements | Structure |
|------|----------|-----------|
| Insert | 3 | [context_before, content, context_after] |
| Delete | 3 | [context_before, selected_text, context_after] |
| Replace | 4 | [context_before, selected_text, replacement, context_after] |
| Comment | 4 | [context_before, selected_text, comment, context_after] |

Context: `context_before` = `"Line{N}:...{≤20 chars}"`, newlines as `↵`. `context_after` = `"{≤20 chars}..."`.

### depends_on Format

TASK-root-relative paths: `"auth-refactor"` → `TASK/auth-refactor`

**Dependency enforcement**: `exec` and `merge` MUST validate that all `depends_on` modules have status `complete` before proceeding. If any dependency is not `complete`, the sub-command rejects with a clear error listing the blocking dependencies and their current statuses. `check` also flags incomplete dependencies as a blocking issue.

### Git Integration

Every task module has a dedicated git branch. Worktrees are optional for parallel execution.

#### Branch Convention

| Item | Format | Example |
|------|--------|---------|
| Branch name | `task/<module-name>` | `task/auth-refactor` |
| Worktree path | `.worktrees/task-<module-name>` | `.worktrees/task-auth-refactor` |

#### Commit Message Convention

All ai-cli-task triggered commits use `--` prefix to distinguish from user manual commits:

```
-- ai-cli-task(<module>):<type> <description>
```

| type | Scenario | Commit Scope |
|------|----------|-------------|
| `init` | Task initialization | TASK/ directory files |
| `plan` | Plan generation / annotation processing | TASK/ directory files |
| `check` | Check evaluation results | TASK/ directory files |
| `exec` | Execution state changes | TASK/ directory files |
| `feat` | New feature code during exec | Project files |
| `fix` | Bugfix code during exec | Project files |
| `refactor` | Code cleanup before merge | Project files |
| `merge` | Merge to main + conflict resolution | — (merge commit) |
| `report` | Report generation | TASK/ directory files |
| `cancel` | Task cancellation | TASK/ directory files |

Examples:
```
-- ai-cli-task(auth-refactor):init initialize task module
-- ai-cli-task(auth-refactor):plan generate implementation plan
-- ai-cli-task(auth-refactor):plan annotations processed
-- ai-cli-task(auth-refactor):check post-plan PASS → review
-- ai-cli-task(auth-refactor):feat add user auth middleware
-- ai-cli-task(auth-refactor):fix fix token expiration check
-- ai-cli-task(auth-refactor):exec step 2/5 done
-- ai-cli-task(auth-refactor):check post-exec ACCEPT
-- ai-cli-task(auth-refactor):refactor cleanup before merge
-- ai-cli-task(auth-refactor):merge merge completed task
-- ai-cli-task(auth-refactor):merge resolve merge conflict
-- ai-cli-task(auth-refactor):merge task completed
-- ai-cli-task(auth-refactor):report generate completion report
-- ai-cli-task(auth-refactor):cancel user cancelled
```

Commit scope: TASK/ directory files (state/plan) or project files (feat/fix).

#### Refactoring & Merge

After task completion confirmed (`check --checkpoint post-exec` ACCEPT), the `merge` sub-command handles the full merge lifecycle:

1. **Task-level refactoring** (on task branch, before merge)
2. **Merge to main** (with conflict resolution — up to 3 attempts with verification)
3. **Cleanup** (worktree removal, branch deletion)

See `skills/merge/SKILL.md` for detailed merge strategy and conflict resolution flow.

**Recommended:** After all related tasks merge to main, do a project-level refactoring pass on main (cross-task cleanup, shared utilities, API consistency). This is a manual activity, not part of auto mode.

#### Worktree Parallel Execution

Without `--worktree`: all work happens on the task branch in the main worktree. Only one task can execute at a time (branch switching required).

With `--worktree` (passed to `init`):
```bash
git worktree add .worktrees/task-<module> -b task/<module>
```

- Each task runs in an isolated directory with full project copy
- Multiple tasks can `exec` simultaneously without conflict
- `auto` daemon operates in the task's worktree directory
- On completion, merge back: `git merge task/<module>` from main branch

#### Rollback

To revert a task to a previous checkpoint:
```bash
git log --oneline task/<module>    # find checkpoint commit
git reset --hard <commit>          # in the task's worktree
```

#### .auto-signal Convention

Every sub-command (plan, check, exec, merge, report) MUST write `.auto-signal` on completion, regardless of whether auto mode is active:

```json
{
  "step": "<sub-command>",
  "result": "<outcome>",
  "next": "<next sub-command or (stop)>",
  "checkpoint": "<checkpoint hint for next command, optional>",
  "timestamp": "<ISO 8601>"
}
```

- The `next` field follows the signal routing table documented in the `auto` sub-command.
- The `checkpoint` field provides context for the next command (e.g., `"post-plan"`, `"mid-exec"`, `"post-exec"`) when the `next` command needs it. Optional — omit when not applicable. If auto mode is not active, the file is harmless (gitignored, ephemeral). This fire-and-forget pattern avoids each skill needing to detect auto mode.

**Worktree note**: In worktree mode, `.auto-signal` MUST be written to the **main worktree's** `TASK/<module>/` directory (not the task worktree copy) to survive worktree removal during merge cleanup.

#### .gitignore

Add to project `.gitignore`:
```
.worktrees/
TASK/**/.tmp-annotations.json
TASK/**/.auto-signal
TASK/**/.auto-stop
```

---

## Input Validation

All sub-commands that accept `<task_module>` MUST validate the path before processing:

| Check | Rule | Example |
|-------|------|---------|
| **Path containment** | Resolved path must be under `TASK/` directory (no `..` traversal) | `TASK/../etc/passwd` → REJECT |
| **Module name** | Must match `[\p{L}\p{N}_-]+` (Unicode letters/digits/hyphens/underscores) | `auth-refactor` ✓, `../../foo` ✗ |
| **No symlinks** | Task module directory must not be a symlink (prevent symlink-based escape) | REJECT if `lstat` ≠ `stat` |
| **Existence** | Directory must exist (except for `init` which creates it) | REJECT if missing |

Validation is performed by resolving the absolute path and confirming it starts with the project's `TASK/` prefix. This prevents path traversal attacks where a crafted module name could read/write files outside the task directory.

## Sub-commands

> Detailed steps, processing logic, and notes for each sub-command are in `skills/<name>/SKILL.md`.

### init

`/ai-cli-task init <module_name> [--title "..."] [--tags t1,t2] [--worktree]`

Create task module directory + `.index.md` (status `draft`) + `.target.md` template. Create git branch `task/<module_name>`, checkout to it (or create worktree with `--worktree`). Module name: UTF-8 letters/digits/hyphens/underscores (`[\p{L}\p{N}_-]+`).

### plan

```
/ai-cli-task plan <task_file_path> <annotation_file_path> [--silent]   # Annotation mode
/ai-cli-task plan <task_module> --generate                              # Generate mode
```

**Generate mode**: Research codebase + `.target.md` → write implementation plan `.md` file → status `planning`.

**Annotation mode**: Process `.tmp-annotations.json` (Insert/Delete/Replace/Comment) with cross-impact assessment (None/Low/Medium/High) → update task file → delete annotation file. Comments add `> 💬`/`> 📝` blockquotes, never modify existing content. REJECT on `complete`/`cancelled`.

### check

`/ai-cli-task check <task_module> [--checkpoint post-plan|mid-exec|post-exec]`

Decision maker at three lifecycle checkpoints:

| Checkpoint | Prerequisite | Outcomes |
|------------|-------------|----------|
| **post-plan** | `planning` / `re-planning` | PASS→`review`, NEEDS_REVISION (no change), BLOCKED→`blocked` |
| **mid-exec** | `executing` | CONTINUE (no change), NEEDS_FIX (no change), REPLAN→`re-planning`, BLOCKED→`blocked` |
| **post-exec** | `executing` | ACCEPT (no change, signal→`merge`), NEEDS_FIX (no change), REPLAN→`re-planning` |

ACCEPT signals → `merge` sub-command for refactoring + merge. Tests MUST pass for ACCEPT.

### exec

`/ai-cli-task exec <task_module> [--step N]`

Execute implementation plan step-by-step. Prerequisite: status `review` or `executing` (NEEDS_FIX continuation). Reads plan files + `.analysis/` + `.test/`, implements changes, verifies per step against `.test/` criteria. On significant issues → signal `(mid-exec)` for mid-exec evaluation. On all steps complete → signal `(done)` for post-exec verification. Project file commits use `feat`/`fix` type.

### merge

`/ai-cli-task merge <task_module>`

Merge completed task branch to main with automated conflict resolution. Prerequisite: status `executing` with ACCEPT verdict. Performs pre-merge refactoring, attempts merge (up to 3 conflict resolution retries with build/test verification), post-merge cleanup (worktree + branch). On persistent conflict → stays `executing` (retryable after manual resolution).

### report

`/ai-cli-task report <task_module> [--format full|summary]`

Generate `.report.md` from all task artifacts. Informational only — no status change. For `complete` tasks, includes change history via commit message pattern matching (works after branch deletion). Full format: Summary, Objective, Plan, Changes, Verification, Issues, Dependencies, Lessons.

### auto

`/ai-cli-task auto <task_module> [--start|--stop|--status]`

Backend-driven autonomous loop: plan → check → exec → check, with self-correction. Backend daemon uses `fs.watch` on `.auto-signal` + `tmux capture-pane` readiness check.

**Status-based first entry:**

| Status | First Action |
|--------|-------------|
| `draft` | Validate `.target.md` has content → plan --generate (stop if empty) |
| `planning` / `re-planning` | check --checkpoint post-plan |
| `review` | exec |
| `executing` | check --checkpoint post-exec |
| `complete` | report → stop |
| `blocked` / `cancelled` | stop |

**Signal-based subsequent routing** (`next` field breaks self-loops):

| step | result | next | checkpoint |
|------|--------|------|------------|
| check | PASS | exec | — |
| check | NEEDS_REVISION | plan | — |
| check | CONTINUE | exec | — |
| check | ACCEPT | merge | — |
| check | NEEDS_FIX | exec | mid-exec / post-exec |
| check | REPLAN / BLOCKED | plan / (stop) | — |
| plan | (any) | check | post-plan |
| exec | (done) | check | post-exec |
| exec | (mid-exec) | check | mid-exec |
| exec | (step-N) | check | mid-exec | ← manual `--step N` only |
| exec | (blocked) | (stop) | — |
| merge | success | report | — |
| merge | blocked | (stop) | — |
| report | (any) | (stop) | — |

**Safety**: max iterations (default 20), timeout (default 30 min), stop on `blocked`, one auto per session (SQLite PK), one auto per task (UNIQUE).

### cancel

`/ai-cli-task cancel <task_module> [--reason "..."] [--cleanup]`

Cancel any task regardless of status → `cancelled`. Stops auto if running. Snapshots uncommitted changes before cancelling. With `--cleanup`, removes worktree + deletes branch. Without `--cleanup`, branch preserved for reference.

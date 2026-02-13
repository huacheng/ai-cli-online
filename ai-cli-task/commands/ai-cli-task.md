---
description: "Task lifecycle management — init, plan, check, exec, report, auto, cancel"
arguments:
  - name: subcommand
    description: "Sub-command: init, plan, check, exec, report, auto, cancel"
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
    ├── .analysis.md           # Feasibility analysis (written by check)
    ├── .bugfix.md             # Issue history (appended by check mid-exec)
    ├── .report.md             # Completion report (written by report)
    ├── .tmp-annotations.json  # Transient annotation transport (frontend → plan)
    ├── .auto-signal           # Transient auto-loop signal (ephemeral)
    └── *.md                   # User-authored plan documents (non-dot-prefixed)
```

- **Dot-prefixed** files are system-managed; only `.target.md` is human-editable
- **Non-dot** `.md` files are user-authored plan documents via the Plan annotation panel
- `.tmp-annotations.json` and `.auto-signal` are ephemeral (should be in `.gitignore`)

### .index.md YAML Schema

```yaml
---
title: "Human-readable task title"
status: draft
created: 2024-01-01T00:00:00Z
updated: 2024-01-01T00:00:00Z
depends_on: []
tags: []
branch: "task/module-name"
worktree: ".worktrees/task-module-name"   # empty if not using worktree
---
```

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

| State ↓ \ Command → | plan | check post-plan | check mid-exec | check post-exec | exec | report | cancel |
|---|---|---|---|---|---|---|---|
| `draft` | →`planning` | ⊘ | ⊘ | ⊘ | ⊘ | — | →`cancelled` |
| `planning` | =`planning` | PASS→`review` / NEEDS_REV=`planning` / BLOCKED→`blocked` | ⊘ | ⊘ | ⊘ | — | →`cancelled` |
| `review` | →`re-planning` | ⊘ | ⊘ | ⊘ | →`executing` | — | →`cancelled` |
| `executing` | →`re-planning` | ⊘ | CONT=`executing` / REPLAN→`re-planning` / BLOCKED→`blocked` | ACCEPT→`complete`+merge / NEEDS_FIX=`executing` / REPLAN→`re-planning` | =`executing` (NEEDS_FIX fix) | — | →`cancelled` |
| `re-planning` | =`re-planning` | PASS→`review` / NEEDS_REV=`re-planning` / BLOCKED→`blocked` | ⊘ | ⊘ | ⊘ | — | →`cancelled` |
| `complete` | ⊘ | ⊘ | ⊘ | ⊘ | ⊘ | — (write) | →`cancelled` |
| `blocked` | →`planning` | ⊘ | ⊘ | ⊘ | ⊘ | — (write) | →`cancelled` |
| `cancelled` | ⊘ | ⊘ | ⊘ | ⊘ | ⊘ | — (write) | — (no-op) |

**Legend:** `→X` transition, `=X` self-loop (stays same status), `⊘` rejected, `—` no status change, `+merge` includes branch merge to main.

**Verification properties:**
- Every non-terminal state has ≥1 exit path (no deadlock)
- Terminal states: only `complete` and `cancelled`
- `cancel` is always available (no-op on already `cancelled`)
- `exec` requires `review` gate (cannot skip `check`)
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
| `feat` | New feature code during exec | Source code |
| `fix` | Bugfix code during exec | Source code |
| `refactor` | Code cleanup before merge | Source code |
| `report` | Report generation | TASK/ directory files |
| `cancel` | Task cancellation | TASK/ directory files |
| `merge` | Merge completed task to main | — (merge commit) |

Examples:
```
-- ai-cli-task(auth-refactor):init initialize task module
-- ai-cli-task(auth-refactor):plan generate implementation plan
-- ai-cli-task(auth-refactor):plan annotations processed
-- ai-cli-task(auth-refactor):check post-plan PASS → review
-- ai-cli-task(auth-refactor):feat add user auth middleware
-- ai-cli-task(auth-refactor):fix fix token expiration check
-- ai-cli-task(auth-refactor):exec step 2/5 done
-- ai-cli-task(auth-refactor):check post-exec ACCEPT → complete
-- ai-cli-task(auth-refactor):refactor cleanup before merge
-- ai-cli-task(auth-refactor):report generate completion report
-- ai-cli-task(auth-refactor):cancel user cancelled
```

Commit scope: TASK/ directory files (state/plan) or source code files (feat/fix).

#### Refactoring & Merge

After task completion confirmed (`check --checkpoint post-exec` ACCEPT):

1. **Task-level refactoring** (on task branch, before merge):
   - Review code changes for cleanup opportunities (dead code, naming, duplication)
   - Commit: `-- ai-cli-task(<module>):refactor cleanup before merge`
2. **Merge to main**:
   ```bash
   git checkout main
   git merge task/<module> --no-ff -m "-- ai-cli-task(<module>):merge merge completed task"
   ```

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

#### .gitignore

Add to project `.gitignore`:
```
.worktrees/
TASK/**/.tmp-annotations.json
TASK/**/.auto-signal
```

---

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
| **mid-exec** | `executing` | CONTINUE (no change), REPLAN→`re-planning`, BLOCKED→`blocked` |
| **post-exec** | `executing` | ACCEPT→`complete`+merge, NEEDS_FIX (no change), REPLAN→`re-planning` |

ACCEPT triggers task-level refactoring → merge to main. If merge conflict → status stays `executing`, report conflict. Tests MUST pass for ACCEPT.

### exec

`/ai-cli-task exec <task_module> [--step N]`

Execute implementation plan step-by-step. Prerequisite: status `review` or `executing` (NEEDS_FIX continuation). Reads plan files + `.analysis.md`, implements changes, verifies diagnostics per step. On significant issues → interactive: suggest `check --checkpoint mid-exec`; auto: signal `(done)` for post-exec evaluation. Source code commits use `feat`/`fix` type.

### report

`/ai-cli-task report <task_module> [--format full|summary]`

Generate `.report.md` from all task artifacts. Informational only — no status change. For `complete` tasks, includes `git log` change history. Full format: Summary, Objective, Plan, Changes, Verification, Issues, Dependencies, Lessons.

### auto

`/ai-cli-task auto <task_module> [--start|--stop|--status]`

Backend-driven autonomous loop: plan → check → exec → check, with self-correction. Backend daemon uses `fs.watch` on `.auto-signal` + `tmux capture-pane` readiness check.

**Status-based first entry:**

| Status | First Action |
|--------|-------------|
| `draft` | plan --generate |
| `planning` / `re-planning` | check --checkpoint post-plan |
| `review` | exec |
| `executing` | check --checkpoint post-exec |
| `complete` | report → stop |
| `blocked` / `cancelled` | stop |

**Signal-based subsequent routing** (`next` field breaks self-loops):

| step | result | next |
|------|--------|------|
| check | PASS | exec |
| check | NEEDS_REVISION | plan |
| check | ACCEPT | report |
| check | NEEDS_FIX | exec |
| check | REPLAN / BLOCKED | plan / (stop) |
| plan | (any) | check |
| exec | (done) / (blocked) | check post-exec / (stop) |
| report | (any) | (stop) |

**Safety**: max iterations (default 20), timeout (default 30 min), stop on `blocked`, one auto per session (SQLite PK), one auto per task (UNIQUE).

### cancel

`/ai-cli-task cancel <task_module> [--reason "..."] [--cleanup]`

Cancel any task regardless of status → `cancelled`. Stops auto if running. Snapshots uncommitted changes before cancelling. With `--cleanup`, removes worktree + deletes branch. Without `--cleanup`, branch preserved for reference.

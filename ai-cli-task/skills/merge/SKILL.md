---
name: merge
description: Merge completed task branch to main — with conflict resolution, verification retry, and cleanup
arguments:
  - name: task_module
    description: "Path to the task module directory (e.g., AiTasks/auth-refactor)"
    required: true
---

# /ai-cli-task merge — Merge Task Branch to Main

Merge a completed task's branch into main, with automated conflict resolution and verification.

## Usage

```
/ai-cli-task merge <task_module_path>
```

## Prerequisites

- Task status must be `executing`
- Latest `.analysis/` file must contain an ACCEPT verdict (from `check --checkpoint post-exec`)
- **Dependency gate**: All `depends_on` modules must meet their required status — simple string entries require `complete`, extended `{ module, min_status }` entries require at-or-past `min_status` (see depends_on Format in `commands/ai-cli-task.md`). If any dependency is not met, merge REJECTS with error listing blocking dependencies and their current statuses

## Merge Strategy

### Phase 1: Pre-Merge Refactoring

1. **Review** code changes on task branch for cleanup opportunities (dead code, naming, duplication)
2. **Commit** cleanup: `-- ai-cli-task(<module>):refactor cleanup before merge`

### Phase 2: Merge Attempt

1. **If worktree**: `cd <project-root>` first (worktree is locked to task branch)
2. **Checkout main** (non-worktree) or already on main (worktree, from main worktree)
3. **Attempt merge**:
   ```bash
   git merge task/<module> --no-ff -m "-- ai-cli-task(<module>):merge merge completed task"
   ```

### Phase 3: Conflict Resolution (if merge fails)

If merge conflict detected:

1. **Analyze** conflict markers in affected files
2. **Resolve** conflicts by applying the task branch's intent while preserving main's changes
3. **Run verification**: build check, test suite, `lsp_diagnostics`
4. **If verification passes**: commit merge resolution, proceed to Phase 4
5. **If verification fails**: abort merge (`git merge --abort`), retry from Phase 2 with different resolution strategy
6. **Max 3 resolution attempts** — after 3 failures → stay `executing`, report unresolvable conflicts (user can manually resolve then re-run merge)

### Phase 4: Post-Merge Cleanup

On successful merge:

1. **Update** `.index.md` status → `complete`, update timestamp
2. **Write** `.summary.md` with final task summary: completion status, plan overview, key changes, verification outcome, lessons learned (integrate from directory summaries)
3. **If worktree exists**: `git worktree remove .worktrees/task-<module>`
4. **Delete** merged branch: `git branch -d task/<module>`
5. **Commit** state: `-- ai-cli-task(<module>):merge task completed`

## Execution Steps

1. **Read** `.index.md` — validate status is `executing`
2. **Validate dependencies**: read `depends_on` from `.index.md`, check each dependency module's `.index.md` status against its required level (simple string → `complete`, extended object → at-or-past `min_status`). If any dependency is not met, REJECT with error listing blocking dependencies
3. **Verify** ACCEPT verdict: check latest `.analysis/` file for `post-exec-accept`
4. **Read** `.summary.md` for task context (plan overview, completed steps, key decisions)
5. **Phase 1**: Task-level refactoring on task branch
6. **Phase 2**: Attempt merge to main
7. **If conflict** (Phase 3):
   a. Parse conflict files
   b. Attempt resolution (up to 3 tries)
   c. Each resolution: fix conflicts → verify (build + test) → if pass commit, if fail abort and retry
   d. If all 3 attempts fail → stay `executing`, abort merge, report unresolvable conflicts
8. **Phase 4**: Post-merge cleanup (status update → `complete`, write `.summary.md`, worktree removal, branch deletion)
9. **Write** `.auto-signal` to the **main worktree's** `AiTasks/<module>/` directory (NOT the task worktree's copy) — MUST be written AFTER Phase 4 status update to `complete`, so the daemon reads correct status when routing to `report`. In worktree mode, the task directory exists in both locations; writing to main ensures the signal survives worktree removal. The daemon's `fs.watch` MUST monitor the main worktree path
10. **Report** merge result

## State Transitions

| Current Status | After Merge | Condition |
|----------------|-------------|-----------|
| `executing` | `complete` | Merge successful (with or without conflict resolution) |
| `executing` | `executing` | Merge conflict unresolvable after 3 attempts (stays `executing` so merge can be retried after manual conflict resolution) |

## Git

| Action | Commit Message |
|--------|---------------|
| Pre-merge cleanup | `-- ai-cli-task(<module>):refactor cleanup before merge` |
| Merge commit | `-- ai-cli-task(<module>):merge merge completed task` |
| Conflict resolution | `-- ai-cli-task(<module>):merge resolve merge conflict` |
| State update | `-- ai-cli-task(<module>):merge task completed` |

## .auto-signal

| Result | Signal |
|--------|--------|
| Success | `{ "step": "merge", "result": "success", "next": "report", "checkpoint": "", "timestamp": "..." }` |
| Conflict | `{ "step": "merge", "result": "conflict", "next": "(stop)", "checkpoint": "", "timestamp": "..." }` |

## Notes

- Merge is separated from `check` to isolate conflict resolution logic
- The 3-attempt limit prevents infinite resolution loops
- Each resolution attempt includes full verification (build + test) to ensure resolved code is correct
- On merge failure, status stays `executing` (not `blocked`) so merge can be retried. The user should manually resolve conflicts and then run `/ai-cli-task merge` again
- After manual resolution, if the user has already merged manually, they can update `.index.md` status to `complete` directly
- Pre-merge refactoring is optional — if no cleanup needed, skip directly to merge
- **Worktree signal race prevention**: In worktree mode, `.auto-signal` is written to the main worktree's `AiTasks/<module>/` path (not the task worktree), ensuring the daemon can read it after worktree removal. The daemon MUST watch the main worktree path for all signal files
- **Concurrency**: Merge acquires `AiTasks/<module>/.lock` before proceeding and releases on completion (see Concurrency Protection in `commands/ai-cli-task.md`)

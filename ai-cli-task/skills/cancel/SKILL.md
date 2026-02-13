---
name: cancel
description: Cancel a task module — set status to cancelled, stop auto if running, optionally clean up worktree
arguments:
  - name: task_module
    description: "Path to the task module directory (e.g., TASK/auth-refactor)"
    required: true
  - name: reason
    description: "Cancellation reason (recorded in .index.md)"
    required: false
  - name: cleanup
    description: "Also remove git worktree and delete the task branch (flag, no value)"
    required: false
---

# /ai-cli-task cancel — Cancel Task Module

Cancel a task module, stopping any active auto loop and optionally cleaning up the git worktree.

## Usage

```
/ai-cli-task cancel <task_module_path> [--reason "..."] [--cleanup]
```

## Arguments

- **task_module** (required): path to task module directory
- **--reason** (optional): cancellation reason, recorded in `.index.md` body
- **--cleanup** (optional): also remove the git worktree and delete the task branch

## Execution Steps

1. **Read** `.index.md` — get current status
2. **Stop auto** if running:
   - Query SQLite `task_auto` table by `task_dir` to find the `session_name` running this task's auto loop
   - If found: call `DELETE /api/sessions/<session_name>/task-auto`
   - Delete `.auto-signal` file if exists
3. **If uncommitted changes exist**, git commit snapshot: `-- ai-cli-task(<module>):cancel pre-cancel snapshot`
4. **Update** `.index.md`:
   - Set `status` to `cancelled`
   - Update `updated` timestamp
   - Append cancellation reason to body (if provided)
5. **Git commit**: `-- ai-cli-task(<module>):cancel user cancelled`
6. **If `--cleanup`**:
   - Remove worktree: `git worktree remove .worktrees/task-<module>`
   - Delete branch: `git branch -D task/<module>` (only if fully merged or with `--force`)
7. **Report** cancellation result

## State Transitions

Any non-cancelled status → `cancelled`. Already `cancelled` → no-op.

## Notes

- Cancel is always allowed regardless of current status
- If the task has uncommitted code changes in a worktree, `--cleanup` will warn before deleting
- Without `--cleanup`, the branch and worktree are preserved for reference
- A cancelled task can be referenced by `report` for documentation purposes

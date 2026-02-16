---
name: cancel
description: "Cancel a task module — set status to cancelled, stop auto if running, optionally clean up worktree. Use when a task becomes infeasible, is deprioritized, or needs to be abandoned."
arguments:
  - name: task_module
    description: "Path to the task module directory (e.g., AiTasks/auth-refactor)"
    required: true
  - name: reason
    description: "Cancellation reason (recorded in .index.json)"
    required: false
  - name: cleanup
    description: "Also remove git worktree and delete the task branch (flag, no value)"
    required: false
---

# /ai-cli-task:cancel — Cancel Task Module

Cancel a task module, stopping any active auto loop and optionally cleaning up the git worktree.

## Usage

```
/ai-cli-task:cancel <task_module_path> [--reason "..."] [--cleanup]
```

## Arguments

- **task_module** (required): path to task module directory
- **--reason** (optional): cancellation reason, recorded in `.index.json` body
- **--cleanup** (optional): also remove the git worktree and delete the task branch

## Execution Steps

1. **Read** `.index.json` — get current status
2. **Stop auto** if running:
   - Call `GET /api/task-auto/lookup?taskDir=<task_module_path>` to find the session running this task's auto loop
   - If found (200): call `DELETE /api/sessions/<session_name>/task-auto`
   - If not found (404): no auto loop running, skip
   - Delete `.auto-signal` file if exists
   - Delete `.auto-stop` file if exists
   - Delete `.lock` file if exists — first read lock content and verify the holder matches the auto session being cancelled (same `session` or dead `pid`). If held by a different live session, log warning but still delete (cancel is a deliberate override)
3. **If uncommitted changes exist**, git commit snapshot: `-- ai-cli-task(<module>):cancel pre-cancel snapshot`
4. **Update** `.index.json`:
   - Set `status` to `cancelled`
   - Update `updated` timestamp
   - Append cancellation reason to body (if provided)
5. **Write** `.summary.md` with condensed context: current status, cancellation reason, progress at time of cancellation (`completed_steps`), any known issues
6. **Git commit**: `-- ai-cli-task(<module>):cancel user cancelled`
7. **If `--cleanup`**:
   - Remove worktree: `git worktree remove .worktrees/task-<module>`
   - Delete branch: `git branch -D task/<module>` (only if fully merged or with `--force`)
8. **Report** cancellation result

## State Transitions

Any non-terminal status → `cancelled`. Terminal statuses (`complete`, `cancelled`) → REJECT.

## Notes

- Cancel is rejected on terminal statuses: `complete` (use a separate workflow to reopen) and `cancelled` (already terminal)
- If the task has uncommitted code changes in a worktree, `--cleanup` will warn before deleting
- Without `--cleanup`, the branch and worktree are preserved for reference
- A cancelled task can be referenced by `report` for documentation purposes

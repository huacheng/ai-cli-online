---
name: summarize
description: Regenerate .summary.md files for context recovery or refresh
arguments:
  - name: task_module
    description: "Path to the task module directory (e.g., AiTasks/auth-refactor)"
    required: true
  - name: all
    description: "Also regenerate each sub-directory's .summary.md"
    required: false
---

# /ai-cli-task:summarize — Context Summary Regeneration

Regenerate `.summary.md` files for a task module. Used to recover lost context or refresh stale summaries after manual edits.

## Usage

```
/ai-cli-task:summarize <task_module_path> [--all]
```

## When to Use

- **Context recovery**: After context window compaction or session restart, when `.summary.md` is outdated or missing
- **Manual edit refresh**: After manually editing task files (`.plan.md`, `.target.md`, etc.) outside the normal skill flow
- **Stale summary**: When `.summary.md` no longer reflects the current state of the task module
- **Standalone rebuild**: To regenerate summaries without running a full plan/check/exec cycle

## Execution Steps

1. **Read** `.index.json` — get `status`, `type`, `phase`, `completed_steps`, `depends_on`, metadata
2. **Read** `.target.md` — requirements and objectives
3. **Read** `.plan.md` if exists — current implementation plan
4. **Read** `.analysis/` all files (sorted by filename) — evaluation history
5. **Read** `.bugfix/` all files (sorted by filename) — issue history
6. **Read** `.test/` all files (sorted by filename) — criteria and results
7. **Read** `.notes/` all files (sorted by filename) — research and decisions
8. **If `--all`**: regenerate each directory's `.summary.md`:
   - `.analysis/.summary.md` — condensed summary of all evaluation entries
   - `.bugfix/.summary.md` — condensed summary of all issues and fixes
   - `.test/.summary.md` — condensed summary of all criteria and results
   - `.notes/.summary.md` — condensed summary of all research and decisions
9. **Generate + write** task-level `.summary.md` with condensed context:
   - Status, phase, progress (`completed_steps`/total)
   - Plan overview (3-5 sentence summary)
   - Current state (what was last done, what's next)
   - Key decisions (architectural/design decisions)
   - Known issues (active issues, blockers, risks)
   - Lessons learned (patterns, workarounds, discoveries)
10. **Git commit**: `-- ai-cli-task(<module>):summarize regenerate context summary`

## State Transitions

None — `summarize` is a utility sub-command. It does not change task status.

## Git

```
-- ai-cli-task(<module>):summarize regenerate context summary
```

## .auto-signal

None — `summarize` does not write `.auto-signal`. It is a recovery/maintenance tool that does not participate in the automation loop.

## Notes

- **Utility, not lifecycle**: `summarize` is a maintenance tool for context recovery. It does not participate in the auto loop and does not write `.auto-signal`
- **Non-destructive**: Only writes `.summary.md` files — never modifies source files (`.target.md`, `.plan.md`, etc.) or state files (`.index.json`)
- **Format compliance**: Generated `.summary.md` follows the format specified in `commands/ai-cli-task.md` (Status/Phase/Progress header, Plan Overview, Current State, Key Decisions, Known Issues, Lessons Learned sections). Keep under ~200 lines
- **Concurrency**: Summarize acquires `AiTasks/<module>/.lock` before proceeding and releases on completion (see Concurrency Protection in `commands/ai-cli-task.md`)
- **`--all` scope**: Without `--all`, only the task-level `.summary.md` is regenerated. With `--all`, all sub-directory summaries are also regenerated, which requires reading every file in every sub-directory

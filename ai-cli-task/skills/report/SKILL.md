---
name: report
description: Generate a completion report for a finished task module
arguments:
  - name: task_module
    description: "Path to the task module directory (e.g., AiTasks/auth-refactor)"
    required: true
  - name: format
    description: "Report format: full (default) or summary"
    required: false
    default: full
---

# /ai-cli-task report — Generate Completion Report

Generate a structured completion report for a task module, documenting what was planned, executed, and verified.

## Usage

```
/ai-cli-task report <task_module_path> [--format full|summary]
```

## Prerequisites

- Task module should have status `complete` (post-exec assessment passed)
- Can also be run on `blocked` or `cancelled` tasks for documentation purposes
- **Minimum content**: If status is `draft` and no plan files exist, report outputs a brief notice ("No meaningful content to report — task is still in draft with no plan") instead of generating an empty report structure

## Report Structure

### Full Format

```markdown
# Task Report: <title>

## Summary
- **Status**: complete | blocked | cancelled
- **Created**: <timestamp>
- **Completed**: <timestamp>
- **Duration**: <calculated>

## Objective
<!-- From .target.md -->

## Plan
<!-- Summary of implementation approach from plan files -->

## Changes Made
<!-- List of files modified/created/deleted with brief descriptions -->

## Verification
<!-- From .test/ criteria and results files, build status, evaluation outcomes -->

## Issues Encountered
<!-- From .bugfix/ if exists, or "None" -->

## Dependencies
<!-- Status of depends_on modules -->

## Lessons Learned
<!-- Any notable patterns, workarounds, or discoveries -->
```

### Summary Format

Compact single-section report with: status, objective (1 line), key changes (bullet list), verification result.

## Output

The report is written to `AiTasks/<module_name>/.report.md` and also printed to screen.

## Execution Steps

1. **Read** `.index.md` for task metadata (including `completed_steps`)
2. **Read** `.target.md` for objectives
3. **Read** all plan files for implementation approach
4. **Read** `.summary.md` if exists (condensed context overview)
5. **Read** `.test/` for verification criteria and test results (all files, sorted by name, if exists)
6. **Read** `.analysis/` for evaluation history (all files, sorted by name, if exists)
7. **Read** `.bugfix/` for issue history (all files, sorted by name, if exists)
8. **Read** `.notes/` for research findings and experience log (all files, sorted by name, if exists)
9. **Collect** git changes related to the task (if identifiable)
10. **Compose** report in requested format
11. **Write** to `.report.md`
12. **Distill experience**: If task status is `complete` and `type` is non-empty, validate `type` matches `[a-zA-Z0-9_:-]+` then extract key learnings and append to `AiTasks/.experience/<type>.md` (create file if not exists). Acquire `AiTasks/.experience/.lock` before writing (see Concurrency Protection in `commands/ai-cli-task.md`). Each entry is a section headed `### <module> (<date>)` containing: what worked, what didn't, key decisions, tools/patterns discovered. If `.experience/<type>.md` exceeds 500 lines, compact it by summarizing older entries. Release lock after write
13. **Git commit**: `-- ai-cli-task(<module>):report generate completion report`
14. **Write** `.auto-signal`: `{ step: "report", result: "(generated)", next: "(stop)", checkpoint: "" }`
15. **Print** report to screen

**Note**: Report is a terminal step — it reads ALL history files (not just latest) to produce a comprehensive record. `.summary.md` is used as an overview, not a replacement for full history in report context.

## State Transitions

No status change — report generation is informational. The task must already be `complete`, `blocked`, or `cancelled`.

## Git

- `-- ai-cli-task(<module>):report generate completion report`

## .auto-signal

`{ "step": "report", "result": "(generated)", "next": "(stop)", "checkpoint": "", "timestamp": "..." }`

Report is always a terminal step — `next` is always `(stop)`.

## Notes

- Reports are overwritten on regeneration (only latest report kept)
- For `blocked` tasks, the report documents what was completed and what blocks remain
- For `cancelled` tasks, the report documents the reason for cancellation
- The report serves as a permanent record even after task files are archived
- For `complete` tasks, report includes change history via `git log --oneline --all --grep="ai-cli-task(<module>)"` (uses commit message pattern, works even after task branch deletion)

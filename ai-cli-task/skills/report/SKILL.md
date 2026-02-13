---
name: report
description: Generate a completion report for a finished task module
arguments:
  - name: task_module
    description: "Path to the task module directory (e.g., TASK/auth-refactor)"
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
<!-- Test results, build status, evaluation outcomes -->

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

The report is written to `TASK/<module_name>/.report.md` and also printed to screen.

## Execution Steps

1. **Read** `.index.md` for task metadata
2. **Read** `.target.md` for objectives
3. **Read** all plan files for implementation approach
4. **Read** `.test.md` for verification criteria and test results (if exists)
5. **Read** `.analysis/` for evaluation history (all files, sorted by name, if exists)
6. **Read** `.bugfix/` for issue history (all files, sorted by name, if exists)
7. **Read** `.notes/` for research findings and experience log (all files, sorted by name, if exists)
8. **Collect** git changes related to the task (if identifiable)
9. **Compose** report in requested format
10. **Write** to `.report.md`
11. **Print** report to screen

## State Transitions

No status change — report generation is informational. The task must already be `complete`, `blocked`, or `cancelled`.

## Git

- `-- ai-cli-task(<module>):report generate completion report`

## Notes

- Reports are overwritten on regeneration (only latest report kept)
- For `blocked` tasks, the report documents what was completed and what blocks remain
- For `cancelled` tasks, the report documents the reason for cancellation
- The report serves as a permanent record even after task files are archived
- For `complete` tasks, report includes change history via `git log --oneline --all --grep="ai-cli-task(<module>)"` (uses commit message pattern, works even after task branch deletion)

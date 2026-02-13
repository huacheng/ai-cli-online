---
name: exec
description: Execute the implementation plan for a reviewed task module
arguments:
  - name: task_module
    description: "Path to the task module directory (e.g., TASK/auth-refactor)"
    required: true
  - name: step
    description: "Execute a specific step number (optional, executes all if omitted)"
    required: false
---

# /ai-cli-task exec — Execute Implementation Plan

Execute the implementation plan for a task module that has passed evaluation.

## Usage

```
/ai-cli-task exec <task_module_path> [--step N]
```

## Prerequisites

- Task module must have status `review` (post-plan check passed) or `executing` (NEEDS_FIX continuation)
- `.target.md` and at least one plan file must exist
- `.analysis.md` should exist with PASS evaluation (warning if missing)

## Execution Strategy

### Step Discovery

1. **Read** all plan files in the task module (non-dot-prefixed `.md` files)
2. **Read** `.target.md` for requirements context
3. **Read** `.analysis.md` for evaluation notes and approved approach
4. **Read** `.bugfix.md` if exists for mid-exec issue history and fix guidance
5. **Extract** implementation steps from plan files (ordered by file, then by heading structure)
6. **Build** execution order respecting any noted dependencies

### Per-Step Execution

For each implementation step:

1. **Read** relevant source files in the project codebase
2. **Implement** the change as described in the plan
3. **Verify** the change compiles / has no syntax errors (use `lsp_diagnostics` where available)
4. **Record** what was done (file changed, lines modified, approach taken)

### Issue Handling

| Situation | Action |
|-----------|--------|
| Step succeeds | Record in progress log, continue |
| Minor deviation needed | Adjust and document, continue |
| Significant issue | Stop execution, signal `(mid-exec)`. Interactive: suggest `check --checkpoint mid-exec`. Auto: daemon routes to mid-exec evaluation |
| Blocking dependency | Set status to `blocked`, report which dependency |

## Execution Steps

1. **Read** `.index.md` — validate status is `review` or `executing`
2. **Update** `.index.md` status to `executing`, update timestamp
3. **Discover** all implementation steps from plan files
4. **If** `--step N` specified, execute only that step; otherwise execute all in order
5. **For each step:**
   a. Read required source files
   b. Implement the change
   c. Verify (diagnostics / build check)
   d. Record result
6. **After all steps** (or on failure):
   - Update `.index.md` timestamp
   - If all steps complete: signal `(done)`, suggest running `/ai-cli-task check --checkpoint post-exec`
   - If significant issue: signal `(mid-exec)`, suggest running `/ai-cli-task check --checkpoint mid-exec`
7. **Report** execution summary with per-step results

## State Transitions

| Current Status | After Exec | Condition |
|----------------|-----------|-----------|
| `review` | `executing` | Execution starts |
| `executing` | `executing` | NEEDS_FIX continuation (fix issues, stay executing) |

## Progress Tracking

Execution progress is tracked via `.index.md` frontmatter update. The `updated` timestamp reflects the last execution activity.

For long-running executions, intermediate progress can be observed by:
- Checking git diff for code changes made so far
- Reading the execution report output

## Git

- On start: `-- ai-cli-task(<module>):exec execution started`
- Source code (feature): `-- ai-cli-task(<module>):feat <description>`
- Source code (bugfix): `-- ai-cli-task(<module>):fix <description>`
- Per step progress: `-- ai-cli-task(<module>):exec step N/M done`
- On blocked: `-- ai-cli-task(<module>):exec blocked`
- Source code changes use `feat`/`fix` type, state file changes use `exec` type

## Notes

- Each step should be atomic — if a step fails, previous steps remain applied
- The executor should follow project coding conventions (check CLAUDE.md if present)
- When status is `executing` (NEEDS_FIX), exec reads issues from `.analysis.md` (post-exec) or `.bugfix.md` (mid-exec) and addresses them
- When `--step N` is used, the executor verifies prerequisites for that step are met
- After successful execution of all steps, the user should run `/ai-cli-task check --checkpoint post-exec`
- Execution does NOT automatically run tests — that is part of the post-exec evaluation
- **No mental math**: When implementation involves calculations (offsets, sizing, algorithm parameters, etc.), write a script and run it in shell instead of computing mentally
- **Evidence-based decisions**: When uncertain about APIs, library usage, or compatibility, use shell commands to verify (curl official docs, check installed versions, read node_modules source, etc.) before implementing

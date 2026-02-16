---
name: exec
description: "Execute the implementation plan for a reviewed task module. Triggered after check PASS (from review status) or on NEEDS_FIX continuation (from executing status with fix guidance)."
arguments:
  - name: task_module
    description: "Path to the task module directory (e.g., AiTasks/auth-refactor)"
    required: true
  - name: step
    description: "Execute a specific step number (optional, executes all if omitted)"
    required: false
---

# /ai-cli-task:exec — Execute Implementation Plan

Execute the implementation plan for a task module that has passed evaluation.

## Usage

```
/ai-cli-task:exec <task_module_path> [--step N]
```

## Prerequisites

- Task module must have status `review` (post-plan check passed) or `executing` (NEEDS_FIX continuation)
- `.target.md` and at least one plan file must exist
- `.analysis/` should contain a PASS evaluation file (warning if empty/missing)
- **Dependency gate**: All `depends_on` modules must meet their required status — simple string entries require `complete`, extended `{ module, min_status }` entries require at-or-past `min_status` (see depends_on Format in `commands/ai-cli-task.md`). If any dependency is not met, exec REJECTS with error listing blocking dependencies and their current statuses

## Execution Strategy

### Step Discovery

1. **Read** the plan file `.plan.md` in the task module
2. **Read** `.target.md` for requirements context
3. **Read** `.type-profile.md` if exists — "Implementation Patterns" and "Key tools" sections are the **primary** source for tool selection and implementation approach. If execution reveals the profile's patterns are inaccurate, update the relevant sections with findings
4. **Read** `.summary.md` if exists (condensed context from prior plan/check/exec runs — primary context source)
5. **Read** `.test/` latest criteria file for per-step verification criteria and acceptance standards
6. **Read** `.analysis/` latest file only for evaluation notes and approved approach
7. **Read** `.bugfix/` latest file only if exists for most recent issue and fix guidance
8. **Read** `.notes/` latest file only if exists for most recent research findings
9. **Scan** `AiTasks/.references/.summary.md` if exists — find relevant external reference files by keyword matching. Read matched `.references/<topic>.md` files for domain-specific implementation guidance
10. **Gap check**: if `.type-profile.md` lacks implementation guidance OR `.references/` lacks knowledge for the current step's technologies/APIs, trigger `research --scope gap --caller exec` to collect missing references before proceeding
11. **Extract** implementation steps from `.plan.md` (ordered by heading structure)
12. **Build** execution order respecting any noted dependencies

**Context management**: When `.summary.md` exists, read it as the primary context source instead of reading all files from `.analysis/`, `.bugfix/`, `.notes/`. Only read the latest (last by filename sort) file from each directory for detailed info on the most recent assessment/issue/note.

### Per-Step Execution

Read the `type` field from `.index.json` to determine the task domain. Execution strategy MUST adapt to the task type — different domains use fundamentally different tools, verification methods, and workflows.

For each implementation step:

1. **Read** relevant files (source code, configs, scripts, documentation)
2. **Implement** the change using **domain-appropriate methods** as described in the plan (see `init/references/seed-types/<type>.md` for per-type seed methodology, or `.type-profile.md` for task-specific guidance)
3. **Verify** the step succeeded against `.test/` criteria using **domain-appropriate verification** (see per-type seed file or `.type-profile.md` for domain verification methods)
4. **Record** what was done (files changed, commands run, tools invoked, approach taken)
5. **Create** `.notes/<YYYY-MM-DD>-<summary>-exec.md` when implementation deviates from plan, an unexpected workaround is needed, or a non-obvious API behavior is discovered. Skip for straightforward steps that follow the plan exactly
6. **Update** `.notes/.summary.md` — overwrite with condensed summary of ALL notes files in `.notes/`

### Issue Handling

| Situation | Action |
|-----------|--------|
| Step succeeds | Record in progress log, continue |
| Minor deviation needed | Adjust and document, continue |
| Significant issue | Stop execution, signal `(mid-exec)`. Interactive: suggest `check --checkpoint mid-exec`. Auto: daemon routes to mid-exec evaluation |
| Blocking dependency | Set status to `blocked`, report which dependency |

## Execution Steps

1. **Read** `.index.json` — validate status is `review` or `executing`
2. **Validate dependencies**: read `depends_on` from `.index.json`, check each dependency module's `.index.json` status against its required level (simple string → `complete`, extended object → at-or-past `min_status`). If any dependency is not met, REJECT with error listing blocking dependencies
3. **Update** `.index.json` status to `executing`, clear `phase` to `""`, update timestamp
4. **Discover** all implementation steps from `.plan.md`
5. **Detect completed steps**: read `completed_steps` field from `.index.json` to determine progress; skip steps ≤ `completed_steps`
6. **If NEEDS_FIX resumption**: determine fix source by reading **both** `.bugfix/` and `.analysis/` latest files, using the most recent file (by filename date) as the primary fix guidance. `.bugfix/` entries indicate mid-exec issues; `.analysis/` entries indicate post-exec issues. Address fix items before continuing remaining steps
7. **If** `--step N` specified, execute only that step; otherwise execute remaining incomplete steps in order
8. **For each step:**
   a. Read required files
   b. Implement the change
   c. Verify against `.test/` criteria (diagnostics / build check). For domain-specific testing, can optionally invoke `verify --checkpoint step-N`
   d. Record result
   e. Update `.index.json` `completed_steps` to current step number
9. **After all steps** (or on failure):
   - Update `.index.json` timestamp
   - Write task-level `.summary.md` with condensed context: current progress, steps completed, key decisions, issues encountered, remaining work (integrate from directory summaries)
   - If all steps complete: signal `{ "step": "exec", "result": "(done)", "next": "verify", "checkpoint": "post-exec", "timestamp": "..." }`
   - If significant issue: signal `{ "step": "exec", "result": "(mid-exec)", "next": "verify", "checkpoint": "mid-exec", "timestamp": "..." }`
   - If `--step N` single step complete: signal `{ "step": "exec", "result": "(step-N)", "next": "verify", "checkpoint": "mid-exec", "timestamp": "..." }`
   - If blocking dependency: signal `{ "step": "exec", "result": "(blocked)", "next": "(stop)", "checkpoint": "", "timestamp": "..." }`
10. **Report** execution summary with per-step results

## State Transitions

| Current Status | After Exec | Condition |
|----------------|-----------|-----------|
| `review` | `executing` | Execution starts |
| `executing` | `executing` | NEEDS_FIX continuation (fix issues, stay executing) |
| `executing` | `blocked` | Blocking dependency encountered |

## Progress Tracking

Execution progress is tracked via `.index.json` fields:
- `completed_steps`: integer, incremented after each step completes successfully. Reset to `0` when plan changes (by `plan` sub-command on re-plan). **Validation**: must be integer >= 0. If value is invalid (negative, non-integer), reset to 0 with warning
- `updated`: timestamp of last execution activity

For long-running executions, intermediate progress can be observed by:
- Reading `completed_steps` in `.index.json`
- Reading `.summary.md` for condensed context
- Checking git diff for code changes made so far

## Git

- On start: `-- ai-cli-task(<module>):exec execution started`
- Project files (feature): `-- ai-cli-task(<module>):feat <description>`
- Project files (bugfix): `-- ai-cli-task(<module>):fix <description>`
- Per step progress: `-- ai-cli-task(<module>):exec step N/M done`
- On blocked: `-- ai-cli-task(<module>):exec blocked`
- Project file changes use `feat`/`fix` type, state file changes use `exec` type

## .auto-signal

| Result | Signal |
|--------|--------|
| All steps done | `{ "step": "exec", "result": "(done)", "next": "verify", "checkpoint": "post-exec", "timestamp": "..." }` |
| Significant issue | `{ "step": "exec", "result": "(mid-exec)", "next": "verify", "checkpoint": "mid-exec", "timestamp": "..." }` |
| Single step (--step N) | `{ "step": "exec", "result": "(step-N)", "next": "verify", "checkpoint": "mid-exec", "timestamp": "..." }` |
| Blocking dependency | `{ "step": "exec", "result": "(blocked)", "next": "(stop)", "checkpoint": "", "timestamp": "..." }` |

## Notes

- Each step should be atomic — if a step fails, previous steps remain applied
- The executor should follow project coding conventions (check CLAUDE.md if present)
- When status is `executing` (NEEDS_FIX), exec reads both `.bugfix/` and `.analysis/` latest files, using the most recent by filename date as fix guidance (`.bugfix/` = mid-exec source, `.analysis/` = post-exec source)
- When `--step N` is used, the executor verifies prerequisites for that step are met, then signals `(step-N)` on completion for mid-exec checkpoint
- After successful execution of all steps, the user should run `/ai-cli-task:check --checkpoint post-exec`
- Per-step verification against `.test/` criteria is done during execution; full test suite / acceptance testing is part of the post-exec evaluation by `check`
- **Evidence-based decisions**: When uncertain about APIs, library usage, or compatibility, use shell commands to verify (curl official docs, check installed versions, read node_modules source, etc.) before implementing
- **Concurrency**: Exec acquires `AiTasks/<module>/.lock` before proceeding and releases on completion (see Concurrency Protection in `commands/ai-cli-task.md`)
- **Reference collection**: Primary reference collection is handled by the `research` sub-command before planning. During execution, if you discover valuable implementation details via web searches, you may still save findings to `AiTasks/.references/<topic>.md` and update `.summary.md` — acquire `AiTasks/.references/.lock` before writing (see `.references/ Write Protection` in `commands/ai-cli-task.md`)
- **verify integration**: Per-step verification can optionally invoke `verify --checkpoint step-N` for domain-specific testing. For lightweight checks (build + lint), inline verification is sufficient

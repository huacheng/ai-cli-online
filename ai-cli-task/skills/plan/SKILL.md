---
name: plan
description: Generate implementation plans for a task module
arguments:
  - name: task_module
    description: "Task module name (e.g., auth-refactor)"
    required: true
---

# /ai-cli-task:plan — Plan Generation

Generate an implementation plan from `.target.md`. Annotation processing is handled by the `annotate` sub-command.

## Usage

```
/ai-cli-task:plan <task_module> --generate
```

## Execution Steps

1. Read `.target.md` for requirements
2. **Determine task type**: Analyze `.target.md` content to identify the task domain (see Task-Type-Aware Planning below). Validate type value matches `[a-zA-Z0-9_:-]+`. Set `type` field in `.index.json`
3. Read `.summary.md` if exists (condensed context from prior runs — primary context source)
4. Read `.analysis/` latest file only if exists (address check feedback from NEEDS_REVISION)
5. Read `.bugfix/` latest file only if exists (address most recent mid-exec issue from REPLAN)
6. Read `.test/` latest criteria and results files if exists (incorporate lessons learned)
7. Read `AiTasks/.experiences/<type>.md` if exists — cross-task experience from completed tasks of the same domain type (lessons learned, patterns, tool choices)
8. **Invoke research**: Determine scope based on planning context and delegate reference collection to the `research` sub-command (see `skills/research/SKILL.md`):
   - **First plan** (status `draft`/`planning`, no existing `.plan.md`): invoke research with `--scope full` — comprehensive reference collection
   - **Re-plan** (status `re-planning`/`review`/`executing`): invoke research with `--scope gap` — incremental collection, only if gap analysis finds uncovered topics
9. **Read** `AiTasks/.references/.summary.md` if exists — find relevant external reference files by keyword matching against task requirements. Read matched `.references/<topic>.md` files for domain knowledge
10. Read project codebase for context (relevant files, CLAUDE.md conventions)
11. Read `.notes/` latest file only if exists (prior research findings and experience)
12. **If re-planning** (status is `re-planning` or `review`/`executing` transitioning to re-plan): archive existing `.plan.md` — rename to `.plan-superseded.md` (append numeric suffix if already exists, e.g., `.plan-superseded-2.md`). This prevents `exec` from reading outdated steps alongside the new plan
13. Generate implementation plan using **domain-appropriate methodology** (incorporating check feedback, bugfix history, prior notes, cross-task experience, and researched best practices)
14. Write plan to `.plan.md` in the task module
15. Write `.test/<YYYY-MM-DD>-plan-criteria.md` with **domain-appropriate** verification criteria: acceptance criteria from `.target.md` + per-step test cases using methods standard in the task domain. On re-plan, write `.test/<YYYY-MM-DD>-replan-criteria.md` incorporating lessons from previous `.test/` results files
16. **Update** `.test/.summary.md` — overwrite with condensed summary of ALL criteria & results files in `.test/`
17. Create `.notes/<YYYY-MM-DD>-<summary>-plan.md` with research findings and key decisions
18. **Update** `.notes/.summary.md` — overwrite with condensed summary of ALL notes files in `.notes/`
19. Write task-level `.summary.md` with condensed context: plan overview, key decisions, requirements summary, known constraints (integrate from directory summaries)
20. Update `.index.json`: set `type` field (if not already set or if task nature changed), status → `planning` (from `draft`/`planning`/`blocked`) or `re-planning` (from `review`/`executing`/`re-planning`), update timestamp. If the **new** status is `re-planning`, set `phase: needs-check`. For all other **new** statuses, clear `phase` to `""`. Reset `completed_steps` to `0` (new/revised plan invalidates prior progress)
21. **Git commit**: `-- ai-cli-task(<module>):plan generate implementation plan`
22. **Write** `.auto-signal`: `{ step: "plan", result: "(generated)", next: "check", checkpoint: "post-plan" }`
23. Report plan summary to user

**Context management**: When `.summary.md` exists, read it as the primary context source instead of reading all files from `.analysis/`, `.bugfix/`, `.notes/`. Only read the latest (last by filename sort) file from each directory for detailed info on the most recent assessment/issue/note.

## State Transitions

| Current Status | After Plan | Condition |
|----------------|-----------|-----------|
| `draft` | `planning` | First plan generation |
| `planning` | `planning` | Plan revision |
| `review` | `re-planning` | Revisions after assessment |
| `executing` | `re-planning` | Mid-execution re-plan |
| `re-planning` | `re-planning` | Further revisions |
| `blocked` | `planning` | Unblocking changes |
| `complete` | REJECT | Completed tasks cannot be re-planned |
| `cancelled` | REJECT | Cancelled tasks cannot be re-planned |

## Git

```
-- ai-cli-task(<module>):plan generate implementation plan
```

## .auto-signal

| Result | Signal |
|--------|--------|
| Generated | `{ "step": "plan", "result": "(generated)", "next": "check", "checkpoint": "post-plan", "timestamp": "..." }` |

## Task-Type-Aware Planning

Plan methodology MUST adapt to the task domain. Different domains require different design approaches, tool choices, and milestones.

> **See `references/task-type-planning.md`** for the full domain planning table, type determination rules, and requirements.

## Notes

- All plan research should consider the full context of the task module (read `.target.md` and `.plan.md`)
- When researching implementation plans, use the project codebase as context (read relevant project files)
- **No mental math**: When planning involves calculations (performance estimates, size limits, capacity, etc.), write a script and run it in shell instead of computing mentally
- **Evidence-based decisions**: Primary domain research is handled by the `research` sub-command (step 8). For plan-specific decisions, use shell commands to verify claims (curl docs/APIs, npm info, etc.) rather than relying solely on internal knowledge
- **Concurrency**: Plan acquires `AiTasks/<module>/.lock` before proceeding and releases on completion (see Concurrency Protection in `commands/ai-cli-task.md`). Reference writing is handled by the `research` sub-command (which manages its own `.references/.lock`)
- **Task-type-aware test design**: `.test/` criteria must use domain-appropriate verification methods (e.g., unit tests for code, SSIM/PSNR for image processing, SNR for audio/DSP, schema validation for data pipelines). Research established best practices for the task domain before writing test criteria. See `check/SKILL.md` Task-Type-Aware Verification section for the full domain reference table

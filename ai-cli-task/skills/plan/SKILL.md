---
name: plan
description: Generate implementation plans or process annotations for a task module
arguments:
  - name: task_file
    description: "Absolute path to the task file (annotation mode) or task module name (generate mode)"
    required: true
  - name: annotation_file
    description: "Absolute path to .tmp-annotations.json (optional, omit for generate mode)"
    required: false
  - name: mode
    description: "Execution mode: interactive (default) or silent"
    required: false
    default: interactive
---

# /ai-cli-task plan — Plan Generation & Annotation Review

Two modes: generate an implementation plan from `.target.md`, or process annotations from the Plan panel.

## Usage

```
# Generate mode (no annotations)
/ai-cli-task plan <task_module> --generate

# Annotation mode (with annotation file)
/ai-cli-task plan <task_file_path> <annotation_file_path> [--silent]
```

## Mode A: Generate (no annotations)

When called without annotation_file or with `--generate`:

1. Read `.target.md` for requirements
2. **Determine task type**: Analyze `.target.md` content to identify the task domain (see Task-Type-Aware Planning below). Validate type value matches `[a-zA-Z0-9_:-]+`. Set `type` field in `.index.md`
3. Read `.summary.md` if exists (condensed context from prior runs — primary context source)
4. Read `.analysis/` latest file only if exists (address check feedback from NEEDS_REVISION)
5. Read `.bugfix/` latest file only if exists (address most recent mid-exec issue from REPLAN)
6. Read `.test/` latest criteria and results files if exists (incorporate lessons learned)
7. Read `AiTasks/.experience/<type>.md` if exists — cross-task experience from completed tasks of the same domain type (lessons learned, patterns, tool choices)
8. Read project codebase for context (relevant files, CLAUDE.md conventions)
9. Read `.notes/` latest file only if exists (prior research findings and experience)
10. **Research domain best practices**: Based on the determined task type, use shell commands (curl, web search, npm info, etc.) to find established methodologies, tools, and patterns for that domain. Do not rely solely on internal knowledge
11. **If re-planning** (status is `re-planning` or `review`/`executing` transitioning to re-plan): archive existing `.plan.md` — rename to `.plan-superseded.md` (append numeric suffix if already exists, e.g., `.plan-superseded-2.md`). This prevents `exec` from reading outdated steps alongside the new plan
12. Generate implementation plan using **domain-appropriate methodology** (incorporating check feedback, bugfix history, prior notes, cross-task experience, and researched best practices)
13. Write plan to `.plan.md` in the task module
14. Write `.test/<YYYY-MM-DD>-plan-criteria.md` with **domain-appropriate** verification criteria: acceptance criteria from `.target.md` + per-step test cases using methods standard in the task domain. On re-plan, write `.test/<YYYY-MM-DD>-replan-criteria.md` incorporating lessons from previous `.test/` results files
15. **Update** `.test/summary.md` — overwrite with condensed summary of ALL criteria & results files in `.test/`
16. Create `.notes/<YYYY-MM-DD>-<summary>-plan.md` with research findings and key decisions
17. **Update** `.notes/summary.md` — overwrite with condensed summary of ALL notes files in `.notes/`
18. Write task-level `.summary.md` with condensed context: plan overview, key decisions, requirements summary, known constraints (integrate from directory summaries)
19. Update `.index.md`: set `type` field (if not already set or if task nature changed), status → `planning` (from `draft`/`planning`/`blocked`) or `re-planning` (from `review`/`executing`/`re-planning`), update timestamp. If the **new** status is `re-planning`, set `phase: needs-check`. For all other **new** statuses, clear `phase` to `""`. Reset `completed_steps` to `0` (new/revised plan invalidates prior progress)
20. **Git commit**: `-- ai-cli-task(<module>):plan generate implementation plan`
21. **Write** `.auto-signal`: `{ step: "plan", result: "(generated)", next: "check", checkpoint: "post-plan" }`
22. Report plan summary to user

**Context management**: When `.summary.md` exists, read it as the primary context source instead of reading all files from `.analysis/`, `.bugfix/`, `.notes/`. Only read the latest (last by filename sort) file from each directory for detailed info on the most recent assessment/issue/note.

## Mode B: Annotation (with annotation_file)

Process `.tmp-annotations.json` from the Plan panel. Supports 4 annotation types: Insert, Delete, Replace, Comment. Each is triaged for cross-impact and conflict before execution.

> **See `references/annotation-processing.md`** for the full annotation file format, processing logic (triage rules, cross-impact assessment, conflict detection), and execution report format.

## Annotation Execution Steps

1. **Read** the task file at the given absolute path
2. **Read** `.index.md` — validate status is not `complete` or `cancelled`. If either, REJECT with error: tasks in terminal status cannot be modified
3. **Read** the annotation file (`.tmp-annotations.json`)
4. **Read** `.target.md` + `.plan.md` + `.test/` (latest criteria) for full context
5. **Parse** all annotation arrays
6. **Triage** each annotation by type and condition
7. **Assess** cross-impacts and conflicts against ALL files in the module
8. **Execute** changes per severity level
9. **Update** the task file with resolved changes and inline markers for pending items
10. **Update** `.index.md` in the task module:
    - Update `status` per State Transitions table: `draft`→`planning`, `review`/`executing`→`re-planning`, `blocked`→`planning`, others keep current
    - If status transitions to `re-planning`, set `phase: needs-check`
    - Update `updated` timestamp
11. **Write** `.summary.md` with condensed context reflecting annotation changes
12. **Clean up** the `.tmp-annotations.json` file (delete after processing)
13. **Git commit**: `-- ai-cli-task(<module>):plan annotations processed`
14. **Write** `.auto-signal`: `{ step: "plan", result: "(annotations)", next: "check", checkpoint: "post-plan" }`
15. **Generate** execution report (print to screen or append to file per mode)

## State Transitions

| Current Status | After Plan | Condition |
|----------------|-----------|-----------|
| `draft` | `planning` | First annotation processing |
| `planning` | `planning` | Additional annotations |
| `review` | `re-planning` | Revisions after assessment |
| `executing` | `re-planning` | Mid-execution changes |
| `re-planning` | `re-planning` | Further revisions |
| `blocked` | `planning` | Unblocking changes |
| `complete` | REJECT | Completed tasks cannot be re-planned |
| `cancelled` | REJECT | Cancelled tasks cannot be re-planned |

## Git

- Generate mode: `-- ai-cli-task(<module>):plan generate implementation plan`
- Annotation mode: `-- ai-cli-task(<module>):plan annotations processed`

## .auto-signal

Both modes write `.auto-signal` on completion:

| Mode | Signal |
|------|--------|
| Generate | `{ "step": "plan", "result": "(generated)", "next": "check", "checkpoint": "post-plan", "timestamp": "..." }` |
| Annotation | `{ "step": "plan", "result": "(annotations)", "next": "check", "checkpoint": "post-plan", "timestamp": "..." }` |

## Task-Type-Aware Planning

Plan methodology MUST adapt to the task domain. Different domains require different design approaches, tool choices, and milestones.

> **See `references/task-type-planning.md`** for the full domain planning table, type determination rules, and requirements.

## Notes

- The `.tmp-annotations.json` is ephemeral — created by frontend, consumed and deleted by this skill
- All plan research should consider the full context of the task module (read `.target.md` and `.plan.md`)
- When researching implementation plans, use the project codebase as context (read relevant project files)
- Cross-impact assessment should check ALL files in the task module, not just the current file
- **No mental math**: When planning involves calculations (performance estimates, size limits, capacity, etc.), write a script and run it in shell instead of computing mentally
- **Evidence-based decisions**: Actively use shell commands to fetch external information (curl docs/APIs, npm info, package changelogs, GitHub issues, etc.) to support planning decisions with evidence rather than relying solely on internal knowledge
- **Concurrency**: Plan acquires `AiTasks/<module>/.lock` before proceeding and releases on completion (see Concurrency Protection in `commands/ai-cli-task.md`)
- **Task-type-aware test design**: `.test/` criteria must use domain-appropriate verification methods (e.g., unit tests for code, SSIM/PSNR for image processing, SNR for audio/DSP, schema validation for data pipelines). Research established best practices for the task domain before writing test criteria. See `check/SKILL.md` Task-Type-Aware Verification section for the full domain reference table

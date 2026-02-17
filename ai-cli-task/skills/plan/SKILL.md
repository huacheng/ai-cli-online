---
name: plan
description: "Generate implementation plans for a task module. Triggered after init when .target.md requirements are defined, or on re-plan when check/exec identify issues requiring plan revision."
arguments:
  - name: task_module
    description: "Task module name (e.g., auth-refactor)"
    required: true
  - name: generate
    description: "Generate or regenerate the implementation plan (flag, no value). Default behavior when invoked — the flag exists for explicitness in auto mode commands"
    required: false
---

# /moonview:plan — Plan Generation

Generate an implementation plan from `.target.md`. Annotation processing is handled by the `annotate` sub-command.

## Usage

```
/moonview:plan <task_module> [--generate]
```

`--generate` is the default behavior — the flag exists for explicitness when invoked from auto mode or scripts. Omitting it has the same effect.

## Execution Steps

1. Read `.target.md` for requirements
2. **Invoke research** (which handles type discovery): Delegate reference collection AND type determination to the `research` sub-command. **Invocation method**: in auto mode, Read `skills/research/SKILL.md` and execute its numbered steps inline (skipping its `.auto-signal` write — auto loop handles it). In manual/standalone mode, use Skill tool to invoke `/moonview:research`. See `skills/research/SKILL.md` and `references/type-profiling.md` for details:
   - **First plan** (status `draft`/`planning`, no existing `.plan.md`): invoke research with `--scope full --caller plan` — research will analyze `.target.md`, validate/override any user-specified type, detect hybrid domains, build `.type-profile.md`, and collect comprehensive references
   - **Re-plan** (status `re-planning`/`review`/`executing`): invoke research with `--scope gap --caller plan` — incremental type refinement and reference collection
3. **Read** `.type-profile.md` — research has created or updated this. Verify the type classification makes sense in context. If plan disagrees with research's classification, update `.type-profile.md` with rationale and adjust `type` in `.index.json`
4. Validate type value: each pipe-separated segment matches `[a-zA-Z0-9_:-]+`, full field matches `[a-zA-Z0-9_:|-]+`. Ensure `type` in `.index.json` is set
5. Read `.summary.md` if exists (condensed context from prior runs — primary context source)
6. Read `.analysis/` latest file only if exists (address check feedback from NEEDS_REVISION)
7. Read `.bugfix/` latest file only if exists (address most recent mid-exec issue from REPLAN)
8. Read `.test/` latest criteria and results files if exists (incorporate lessons learned)
9. Read `AiTasks/.experiences/<type>/.summary.md` if exists — condensed cross-task experience from completed tasks of the same domain type (apply directory-safe transform: `:` → `-` in type for directory name, e.g., `science:astro` → `science-astro`). For hybrid types (`A|B`), read summary files for **all** pipe-separated segments. If summary references specific entries relevant to current task, read those `AiTasks/.experiences/<type>/<module>.md` files for detail
10. **Read** `AiTasks/.references/.summary.md` if exists — find relevant external reference files by keyword matching against task requirements. Read matched `.references/<topic>.md` files for domain knowledge
11. Read project codebase for context (relevant files, CLAUDE.md conventions)
12. Read `.notes/` latest file only if exists (prior research findings and experience)
13. **If re-planning** (status is `re-planning` or `review`/`executing` transitioning to re-plan): archive existing `.plan.md` — rename to `.plan-superseded.md` (append numeric suffix if already exists, e.g., `.plan-superseded-2.md`). This prevents `exec` from reading outdated steps alongside the new plan
14. Generate implementation plan using **domain-appropriate methodology** (incorporating check feedback, bugfix history, prior notes, cross-task experience, and researched best practices)
15. Write plan to `.plan.md` in the task module
16. Write `.test/<YYYY-MM-DD>-plan-criteria.md` with **domain-appropriate** verification criteria: acceptance criteria from `.target.md` + per-step test cases using methods standard in the task domain. On re-plan, write `.test/<YYYY-MM-DD>-replan-criteria.md` incorporating lessons from previous `.test/` results files
17. **Update** `.test/.summary.md` — overwrite with condensed summary of ALL criteria & results files in `.test/`
18. Create `.notes/<YYYY-MM-DD>-<summary>-plan.md` with research findings and key decisions
19. **Update** `.notes/.summary.md` — overwrite with condensed summary of ALL notes files in `.notes/`
20. Write task-level `.summary.md` with condensed context: plan overview, key decisions, requirements summary, known constraints (integrate from directory summaries)
21. Update `.index.json`: set `type` field (if not already set or if task nature changed), status → `planning` (from `draft`/`planning`/`blocked`) or `re-planning` (from `review`/`executing`/`re-planning`), update timestamp. If the **new** status is `re-planning`, set `phase: needs-check`. For all other **new** statuses, clear `phase` to `""`. Reset `completed_steps` to `0` (new/revised plan invalidates prior progress)
22. **Git commit**: `-- ai-cli-task(<module>):plan generate implementation plan`
23. **Write** `.auto-signal`: `{ "step": "plan", "result": "(generated)", "next": "verify", "checkpoint": "post-plan", "timestamp": "..." }`
24. Report plan summary to user

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
| Generated | `{ "step": "plan", "result": "(generated)", "next": "verify", "checkpoint": "post-plan", "timestamp": "..." }` |

## Task-Type-Aware Planning

Plan methodology MUST adapt to the task domain. Different domains require different design approaches, tool choices, and milestones.

> **See `init/references/seed-types/<type>.md`** for per-type seed methodology (plan structure, key considerations). Shared profiles in `AiTasks/.type-profiles/` take precedence when available.

## Notes

- All plan research should consider the full context of the task module (read `.target.md` and `.plan.md`)
- When researching implementation plans, use the project codebase as context (read relevant project files)
- **Evidence-based decisions**: Primary domain research is handled by the `research` sub-command (step 2). For plan-specific decisions, use shell commands to verify claims (curl docs/APIs, npm info, etc.) rather than relying solely on internal knowledge
- **Concurrency**: Plan acquires `AiTasks/<module>/.lock` before proceeding and releases on completion (see Concurrency Protection in `commands/ai-cli-task.md`). Reference writing is handled by the `research` sub-command (which manages its own `.references/.lock`)
- **Task-type-aware test design**: `.test/` criteria must use domain-appropriate verification methods (e.g., unit tests for code, SSIM/PSNR for image processing, SNR for audio/DSP, schema validation for data pipelines). Research established best practices for the task domain before writing test criteria. See `check/SKILL.md` Task-Type-Aware Verification section for the full domain reference table

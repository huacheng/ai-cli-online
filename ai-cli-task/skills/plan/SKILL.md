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
2. Read `.summary.md` if exists (condensed context from prior runs — primary context source)
3. Read `.analysis/` latest file only if exists (address check feedback from NEEDS_REVISION)
4. Read `.bugfix/` latest file only if exists (address most recent mid-exec issue from REPLAN)
5. Read `.test/` latest criteria and results files if exists (incorporate lessons learned)
6. Read project codebase for context (relevant files, CLAUDE.md conventions)
7. Read `.notes/` latest file only if exists (prior research findings and experience)
8. Research and generate implementation plan (incorporating check feedback, bugfix history, and prior notes if any)
9. Write plan to a new `.md` file in the task module (e.g., `plan.md`)
10. Write `.test/<YYYY-MM-DD>-plan-criteria.md` with verification criteria: acceptance criteria from `.target.md` + per-step test cases / expected outcomes. On re-plan, write `.test/<YYYY-MM-DD>-replan-criteria.md` incorporating lessons from previous `.test/` results files
11. Create `.notes/<YYYY-MM-DD>-<summary>-plan.md` with research findings and key decisions
12. Write `.summary.md` with condensed context: plan overview, key decisions, requirements summary, known constraints
13. Update `.index.md`: status → `planning` (from `draft`/`planning`/`blocked`) or `re-planning` (from `review`/`executing`/`re-planning`), update timestamp. If the **new** status is `re-planning`, set `phase: needs-check`. For all other **new** statuses, clear `phase` to `""`. Reset `completed_steps` to `0` (new/revised plan invalidates prior progress)
14. **Git commit**: `-- ai-cli-task(<module>):plan generate implementation plan`
15. **Write** `.auto-signal`: `{ step: "plan", result: "(generated)", next: "check", checkpoint: "post-plan" }`
16. Report plan summary to user

**Context management**: When `.summary.md` exists, read it as the primary context source instead of reading all files from `.analysis/`, `.bugfix/`, `.notes/`. Only read the latest (last by filename sort) file from each directory for detailed info on the most recent assessment/issue/note.

## Mode B: Annotation (with annotation_file)

## Annotation File Format

The annotation file (`.tmp-annotations.json`) is written by the frontend and contains:

```json
{
  "Insert Annotations": [
    ["Line{N}:...{before 20 chars}", "insertion content", "{after 20 chars}..."]
  ],
  "Delete Annotations": [
    ["Line{N}:...{before 20 chars}", "selected text", "{after 20 chars}..."]
  ],
  "Replace Annotations": [
    ["Line{N}:...{before 20 chars}", "selected text", "replacement content", "{after 20 chars}..."]
  ],
  "Comment Annotations": [
    ["Line{N}:...{before 20 chars}", "selected text", "comment content", "{after 20 chars}..."]
  ]
}
```

Each annotation type is a `string[][]` array:

| Type | Elements | Structure |
|------|----------|-----------|
| **Insert** | 3 | [context_before, insertion_content, context_after] |
| **Delete** | 3 | [context_before, selected_text, context_after] |
| **Replace** | 4 | [context_before, selected_text, replacement_content, context_after] |
| **Comment** | 4 | [context_before, selected_text, comment_content, context_after] |

Context rules:
- `context_before`: `"Line{N}:...{up to 20 chars}"` — line number prefix + surrounding text. Newlines shown as `↵`
- `context_after`: `"{up to 20 chars}..."` — trailing context. Newlines shown as `↵`

## Processing Logic

### A. Delete Annotations

Triage each delete annotation:

| Type | Condition | Action |
|------|-----------|--------|
| **Deferred confirmation** | Previously unresolved item confirmed by this edit | Resume research on incomplete plan |
| **Plan content deletion** | Removes part of existing plan | Delete + check cross-impact |
| **Pure content removal** | No plan impact | Delete directly |

#### Cross-Impact Assessment

| Level | Action |
|-------|--------|
| **None** | Execute directly |
| **Low** | Adjust affected plans inline |
| **Medium** | Research approach → execute → document resolution |
| **High — Interactive** | Explain + draft solution → print to screen → 10 min timeout → fall back to Silent |
| **High — Silent** | Write explanation + draft into task file → await next annotation |

### B. Insert Annotations

Triage each insert annotation:

| Type | Condition | Action |
|------|-----------|--------|
| **Deferred confirmation** | Previously unresolved item confirmed | Resume research |
| **New task content** | New requirement | Research implementation plan in full context |
| **Info supplement** | Simple addition | Write to task file, no research needed |

#### Conflict Detection

| Level | Action |
|-------|--------|
| **None** | Execute directly |
| **Low** | Resolve with minor adjustments |
| **Medium** | Research resolution → execute → document |
| **High — Interactive** | Explain conflict → print → timeout → Silent fallback |
| **High — Silent** | Write to task file → await next annotation |

### C. Replace Annotations

Triage each replace annotation:

| Type | Condition | Action |
|------|-----------|--------|
| **Deferred confirmation** | Previously unresolved, now confirmed | Resume research |
| **Plan content replacement** | Replaces existing plan | Delete original + insert replacement + cross-impact |
| **Simple text replacement** | No plan impact | Replace directly |

Cross-Impact Assessment: same rules as Delete (Section A).

### D. Comment Annotations

Classify by intent:

| Type | Detection | Action |
|------|-----------|--------|
| **Question** | Contains `?`, interrogative words | Research selected content → write explanation below using `> 💬 ...` blockquote |
| **Note** | Declarative sentence | Insert as `> 📝 ...` blockquote below selected content |

Comments NEVER delete or modify existing content — they only ADD information.

### E. Execution Report

| Section | Content |
|---------|---------|
| **Actions summary** | All changes made |
| **Cross-impact resolutions** | Low/Medium impacts resolved |
| **Conflict resolutions** | Low/Medium conflicts resolved |
| **Explanations provided** | Questions answered |
| **Notes recorded** | Memos inserted |
| **Pending confirmations** | High-level items awaiting review |

## Annotation Execution Steps

1. **Read** the task file at the given absolute path
2. **Read** `.index.md` — validate status is not `complete` or `cancelled`. If either, REJECT with error: tasks in terminal status cannot be modified
3. **Read** the annotation file (`.tmp-annotations.json`)
4. **Read** `.target.md` + sibling plan files + `.test/` (latest criteria) for full context
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

## Notes

- The `.tmp-annotations.json` is ephemeral — created by frontend, consumed and deleted by this skill
- All plan research should consider the full context of the task module (read `.target.md` and sibling plan files)
- When researching implementation plans, use the project codebase as context (read relevant project files)
- Cross-impact assessment should check ALL files in the task module, not just the current file
- **No mental math**: When planning involves calculations (performance estimates, size limits, capacity, etc.), write a script and run it in shell instead of computing mentally
- **Evidence-based decisions**: Actively use shell commands to fetch external information (curl docs/APIs, npm info, package changelogs, GitHub issues, etc.) to support planning decisions with evidence rather than relying solely on internal knowledge

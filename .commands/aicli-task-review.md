---
name: aicli-task-review
description: Review task file annotations, research implementation plans, handle cross-impacts and conflicts
arguments:
  - name: task_file
    description: Absolute path to the task file being reviewed
    required: true
  - name: annotations
    description: The JSON string of annotations
    required: true
  - name: mode
    description: "Execution mode: interactive (default) or silent"
    required: false
    default: interactive
---

# /aicli-task-review — Task Annotation Review & Plan Research

Enter plan mode to analyze annotation-based task changes on the specified task file.

## Usage

```
/aicli-task-review <absolute_path_to_task_file> <json_string_of_annotations> [--silent]
```

## Annotation Format

The annotations argument is a JSON string with the following structure. Each annotation type is a `string[]`, where each element is a single context-rich string:

```json
{
  "Insert Annotations": [
    "Line{N}: ...{before 20 chars}, {insertion content}, {after 20 chars}..."
  ],
  "Delete Annotations": [
    "Line{N}: ...{before 20 chars}, {selected text}, {after 20 chars}..."
  ],
  "Replace Annotations": [
    "Line{N}: ...{before 20 chars}, {selected text}, {replacement content}, {after 20 chars}..."
  ],
  "Comment Annotations": [
    "Line{N}: ...{before 20 chars}, {selected text}, {comment content}, {after 20 chars}..."
  ]
}
```

Each annotation is a single inline string with embedded context:

| Type | Format | Description |
|------|--------|-------------|
| **Insert** | `Line{N}: ...before, content, after...` | Inserted content with 20-char context on each side |
| **Delete** | `Line{N}: ...before, selected, after...` | Deleted selected text with 20-char context on each side |
| **Replace** | `Line{N}: ...before, selected, replacement, after...` | Replaced selected text with 20-char context on each side |
| **Comment** | `Line{N}: ...before, selected, comment, after...` | Comment on selected text with 20-char context on each side |

Context rules:
- `before`: Up to 20 characters before the annotation start position (less if near line start). Newlines shown as `↵`
- `after`: Up to 20 characters after the annotation end position (may span lines). Newlines shown as `↵`
- `Line{N}`: Source file line number of the annotation

## Input

| Parameter | Description |
|-----------|-------------|
| **Task file** | Absolute path to the task file being reviewed (from annotation context) |
| **Annotations** | JSON string with `Insert Annotations`, `Delete Annotations`, `Replace Annotations`, and `Comment Annotations` arrays |
| **Mode** | `interactive` (default): print to screen and wait for confirmation. `silent`: write to task file for later annotation-based confirmation |

## Processing Logic

### A. Delete Annotations

Triage each delete annotation. Classify into one of three action types:

| Type | Condition | Action |
|------|-----------|--------|
| **Deferred confirmation** | A previously unresolved item, now confirmed by this edit | Resume research on the previously incomplete implementation plan based on confirmation + surrounding context |
| **Plan content deletion** | Removes part of an existing implementation plan | Delete in context, then assess cross-impact (see below) |
| **Pure content removal** | No plan impact, just text cleanup | Delete the content directly from the task file |

#### Cross-Impact Assessment (applies to all deletions)

| Level | Action | Detail |
|-------|--------|--------|
| **None** | Execute directly | No cross-impact, change plan as-is |
| **Low** | Adjust directly | Adjust affected plans inline |
| **Medium** | Research + execute | Research change approach, think deeply, execute, resolve cross-impact. Add explanation under affected plans + include in execution report |
| **High — Interactive** | Await confirmation | Explain cause, draft solution, print to screen. If no response within 10 min → fall back to Silent |
| **High — Silent** | Write to task file | Explain cause, draft solution, write into task file. Wait for next annotation edit confirmation |

### B. Insert Annotations

Triage each insert annotation. Classify into one of three action types:

| Type | Condition | Action |
|------|-----------|--------|
| **Deferred confirmation** | A previously unresolved item, now confirmed by this edit | Resume research on the incomplete plan based on confirmation + context |
| **New task content** | Brand new requirement | Research implementation plan in full context |
| **Info supplement** | Simple informational addition | Write to task file at corresponding position, no plan research needed |

#### Conflict Detection (applies to all insertions)

| Level | Action | Detail |
|-------|--------|--------|
| **None** | Execute directly | No conflict, apply change as-is |
| **Low** | Adjust directly | Resolve conflict with minor adjustments |
| **Medium** | Research + execute | Research conflict resolution, think deeply, execute. Write explanation to task file + execution report |
| **High — Interactive** | Await confirmation | Explain conflict cause, draft solution, print to screen. If no response within 10 min → fall back to Silent |
| **High — Silent** | Write to task file | Explain conflict cause, draft solution, write into task file. Wait for next annotation edit confirmation |

### C. Replace Annotations

Triage each replace annotation. Classify into one of three action types:

| Type | Condition | Action |
|------|-----------|--------|
| **Deferred confirmation** | A previously unresolved item, now confirmed by this replacement | Resume research based on replacement + context |
| **Plan content replacement** | Replaces part of an existing implementation plan | Delete original content, insert replacement, then assess cross-impact (same as Delete § Cross-Impact) |
| **Simple text replacement** | No plan impact, just wording change | Replace directly in task file |

Cross-Impact Assessment: same rules as Delete Annotations (Section A).

### D. Comment Annotations

Triage each comment annotation. Classify by intent:

| Type | Detection | Action |
|------|-----------|--------|
| **Question / Request for explanation** | Contains `?`, or starts with interrogative words (how, why, what, when, where, which, could, can, should, is, are, do, does, will, would) | Research the selected content in full context. Write detailed explanation, supplementary details, or implementation rationale **below** the selected content in the task file. Mark with `> 💬 ...` blockquote format. |
| **Note / Memo** | Declarative sentence, no question markers | Insert as an inline note below the selected content using `> 📝 ...` blockquote format. No plan research needed. |

Comment annotations NEVER delete or modify existing content — they only ADD supplementary information.

### E. Execution Report

| Section | Content |
|---------|---------|
| **Actions summary** | All actions taken during this review (deletions, insertions, replacements, plan changes) |
| **Cross-impact resolutions** | Low/Medium level cross-impacts that were resolved, with explanations |
| **Conflict resolutions** | Low/Medium level conflicts that were resolved, with explanations |
| **Explanations provided** | Comment-type questions that were answered with detailed explanations |
| **Notes recorded** | Comment-type memos inserted into task file |
| **Pending confirmations** | High-level cross-impacts/conflicts awaiting user review |
| **Deferred items** | Items written to task file in silent mode, pending next annotation edit |

### F. Output

| Target | Description |
|--------|-------------|
| **Task file** | Updated at the absolute path with all resolved changes, pending items marked inline |
| **Index file** | `TASK/.index.md` — update if task structure changed (new/removed sections) |
| **Execution report** | Printed to screen (interactive) or appended to task file bottom (silent) |

## Execution Steps

1. **Read** the task file at the given absolute path
2. **Parse** all annotations (deletions, insertions, replacements, comments) from the JSON input
3. **Triage** each annotation — classify by type:
   - Delete: deferred / plan deletion / pure removal
   - Insert: deferred / new task / info supplement
   - Replace: deferred / plan replacement / simple replacement
   - Comment: question → research & explain / note → record as-is
4. **Assess** cross-impacts (deletions, replacements) and conflicts (insertions) against existing plans in the task file
5. **Execute** changes per severity level:
   - None/Low/Medium: resolve immediately, document in execution report
   - High: branch by mode (interactive → print + wait; silent → write to file)
6. **Update** the task file with all resolved changes and inline markers for pending items
7. **Update** `TASK/.index.md` if the task structure changed
8. **Generate** execution report with summary, resolutions, and pending confirmations

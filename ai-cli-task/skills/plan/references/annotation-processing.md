# Annotation Processing (Mode B)

Process annotations from the Plan panel's `.tmp-annotations.json` file.

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

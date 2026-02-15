---
name: research
description: Collect and organize external references to support planning and execution phases
arguments:
  - name: task_module
    description: "Path to the task module directory (e.g., AiTasks/auth-refactor)"
    required: true
  - name: scope
    description: "Research scope: full (default, comprehensive collection) or gap (incremental, fill missing topics only)"
    required: false
    default: full
---

# /ai-cli-task:research — Reference Collection & Organization

Collect external domain knowledge and organize it into `AiTasks/.references/` to support planning, execution, and evaluation phases. Acts as the intelligence arm of the task lifecycle — separating research from planning for clearer logic.

## Usage

```
/ai-cli-task:research <task_module_path> [--scope full|gap]
```

| Scope | When Used | Behavior |
|-------|-----------|----------|
| `full` | First plan, standalone invocation | Comprehensive collection — scan requirements, research all identified topics |
| `gap` | Re-plan, mid-execution supplement | Incremental — compare requirements against existing references, collect only missing topics |

## Trigger Rules

Research is invoked in two ways:

### 1. From plan (automatic)

| Plan Context | Trigger | Scope |
|--------------|---------|-------|
| First plan (`draft`/`planning`, no `.plan.md`) | **Always** | `full` |
| Re-plan (`re-planning`/`review`/`executing`) | **Conditional** — only if gap analysis finds uncovered topics | `gap` |

Plan invokes research internally before generating the implementation plan. See `skills/plan/SKILL.md` for integration details.

### 2. Standalone (manual)

```
/ai-cli-task:research <task_module> --scope full
/ai-cli-task:research <task_module> --scope gap
```

Callable independently for preparatory research before planning, or to supplement references mid-execution.

## Execution Steps

1. **Read** `.index.json` — get task `type`, `status`, validate not `complete`/`cancelled`
2. **Read** `.target.md` — extract requirements, key technologies, domain keywords
3. **Read** `.plan.md` if exists — understand current approach (for re-plan context)
4. **Read** `.bugfix/` latest file if exists — understand what went wrong (for re-plan gap targeting)
5. **Read** `.analysis/` latest file if exists — understand evaluation feedback (for re-plan gap targeting)
6. **Read** `AiTasks/.references/.summary.md` if exists — inventory of existing references
7. **Gap analysis**:
   - Extract topic keywords from steps 2-5 (technologies, libraries, APIs, patterns, methodologies, domain concepts)
   - Compare against existing references from step 6
   - Produce a list of **uncovered topics** that need research
   - If `--scope gap` and no uncovered topics → log `"references sufficient, skipping collection"` → skip to step 12
8. **Acquire** `AiTasks/.references/.lock` (see Concurrency Protection in `commands/ai-cli-task.md`)
9. **Active research** — for each uncovered topic:
   - Use shell commands to gather domain knowledge: `curl` official docs/APIs, `npm info` / `pip show` for package details, web search for best practices, GitHub issues for known pitfalls, `man` pages for CLI tools, read project `node_modules` or local source for API details
   - Write findings to `AiTasks/.references/<topic>.md` (kebab-case filename, e.g., `express-middleware.md`, `ffmpeg-filters.md`)
   - Each file should be self-contained: what it is, key APIs/patterns, usage examples, gotchas, links to official docs
   - **Append** to existing `<topic>.md` if the file already exists (add new section with date header), do not overwrite
10. **Update** `AiTasks/.references/.summary.md` — overwrite with index of ALL reference files:
    ```markdown
    # References Index

    | File | Topic | Keywords | Updated |
    |------|-------|----------|---------|
    | express-middleware.md | Express middleware | routing, middleware, error handling | 2024-01-15 |
    ```
11. **Release** `AiTasks/.references/.lock`
12. **Git commit**: `-- ai-cli-task(<module>):research collect references` (skip if no files written)
13. **Write** `.auto-signal`: `{ "step": "research", "result": "(collected)" or "(sufficient)", "next": "plan", "checkpoint": "post-research" }`

## Output

| Output | Location | Content |
|--------|----------|---------|
| Reference files | `AiTasks/.references/<topic>.md` | Domain knowledge per topic (kebab-case filename) |
| Reference index | `AiTasks/.references/.summary.md` | Keyword-searchable index of all reference files |

Research does **NOT** modify any task module files (`.index.json`, `.summary.md`, etc.). It only writes to the shared `.references/` directory.

## State Transitions

**None.** Research is a utility sub-command — it does not change task status. Like `report`, it operates on the side without affecting the state machine.

| Current Status | After Research | Condition |
|----------------|---------------|-----------|
| Any non-terminal | (unchanged) | Research is status-neutral |
| `complete` | REJECT | Completed tasks don't need research |
| `cancelled` | REJECT | Cancelled tasks don't need research |

## Git

| Outcome | Commit Message |
|---------|---------------|
| References collected | `-- ai-cli-task(<module>):research collect references` |
| References sufficient | (no commit — nothing changed) |

## .auto-signal

| Result | Signal |
|--------|--------|
| Collected | `{ "step": "research", "result": "(collected)", "next": "plan", "checkpoint": "post-research", "timestamp": "..." }` |
| Sufficient | `{ "step": "research", "result": "(sufficient)", "next": "plan", "checkpoint": "post-research", "timestamp": "..." }` |

## Reference File Guidelines

### Filename Convention

Kebab-case, topic-descriptive: `[a-z0-9]+(-[a-z0-9]+)*.md`

Good: `express-middleware.md`, `ffmpeg-audio-filters.md`, `react-state-management.md`
Bad: `Express_Middleware.md`, `ref1.md`, `notes.md`

### Content Structure

Each `<topic>.md` should follow:

```markdown
# <Topic Title>

## Overview
<!-- What this is and why it matters for the task -->

## Key APIs / Patterns
<!-- Core interfaces, functions, or design patterns -->

## Usage Examples
<!-- Concrete code or command examples -->

## Gotchas & Limitations
<!-- Known issues, edge cases, compatibility notes -->

## Sources
<!-- URLs to official docs, relevant GitHub issues, etc. -->
```

### Deduplication

- Before creating a new file, check if an existing reference already covers the topic (scan `.summary.md` keywords)
- If a topic partially overlaps, **append** a new dated section to the existing file rather than creating a new one
- Topic granularity: one file per distinct technology/concept, not one file per search query

## Notes

- **No mental math**: When research involves evaluating options (library comparison, performance benchmarks, compatibility matrices), write a script and run it in shell instead of reasoning from memory
- **Evidence over assumptions**: Always verify claims via shell commands — `curl` official docs, check actual installed versions, read source code. Do not rely solely on internal knowledge
- **Concurrency**: Research acquires `AiTasks/.references/.lock` before writing and releases on completion. If the lock is held (another task is writing), wait and retry (see Concurrency Protection in `commands/ai-cli-task.md`)
- **Idempotent**: Running research multiple times with `--scope gap` is safe — it only adds missing topics, never removes or overwrites existing reference content (append-only for existing files)
- **Shared resource**: `.references/` is shared across all task modules. References collected for one task benefit future tasks in the same domain. This is by design — domain knowledge compounds

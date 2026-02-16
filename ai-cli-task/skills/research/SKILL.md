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
  - name: caller
    description: "Calling phase: plan (default), verify, check, or exec — determines .auto-signal next routing"
    required: false
    default: plan
---

# /ai-cli-task:research — Reference Collection & Organization

Collect external domain knowledge and organize it into `AiTasks/.references/` to support all lifecycle phases: planning (implementation strategy), verification (testing tools and criteria), evaluation (domain standards), and execution (technical details). Acts as the intelligence arm of the task lifecycle — separating research from other phases for clearer logic.

## Usage

```
/ai-cli-task:research <task_module_path> [--scope full|gap]
```

| Scope | When Used | Behavior |
|-------|-----------|----------|
| `full` | First plan, standalone invocation | Comprehensive collection — scan requirements, research all identified topics |
| `gap` | Re-plan, mid-execution supplement | Incremental — compare requirements against existing references, collect only missing topics |

## Trigger Rules

Research is invoked from multiple lifecycle phases:

### 1. From plan (automatic)

| Plan Context | Trigger | Scope |
|--------------|---------|-------|
| First plan (`draft`/`planning`, no `.plan.md`) | **Always** | `full` |
| Re-plan (`re-planning`/`review`/`executing`) | **Conditional** — only if gap analysis finds uncovered topics | `gap` |

Plan invokes research internally before generating the implementation plan. See `skills/plan/SKILL.md` for integration details.

### 2. From verify / check / exec (automatic)

| Phase | Trigger | Scope |
|-------|---------|-------|
| verify | Missing testing tools/frameworks knowledge for task `type` | `gap` |
| check | Missing domain standards/benchmarks for evaluation | `gap` |
| exec | Encountering unfamiliar technology/API during implementation | `gap` |

Each phase reads `AiTasks/.references/.summary.md` at entry. If the existing references lack coverage for the current phase's needs (testing tools, evaluation criteria, implementation details), the phase triggers research with `--scope gap` and `--caller <phase>` before proceeding.

### 3. Standalone (manual)

```
/ai-cli-task:research <task_module> --scope full
/ai-cli-task:research <task_module> --scope gap
```

Callable independently for preparatory research before any phase, or to supplement references mid-execution.

## Execution Steps

1. **Read** `.index.json` — get task `type`, `status`, validate not `complete`/`cancelled`
2. **Read** `.target.md` — extract requirements, key technologies, domain keywords
3. **Read** `.type-profile.md` if exists — current domain classification, methodology, confidence level
4. **Read** `.plan.md` if exists — understand current approach (for re-plan context)
5. **Read** `.bugfix/` latest file if exists — understand what went wrong (for re-plan gap targeting)
6. **Read** `.analysis/` latest file if exists — understand evaluation feedback (for re-plan gap targeting)
7. **Read** `AiTasks/.references/.summary.md` if exists — inventory of existing references
8. **Type discovery & refinement** (see `plan/references/type-profiling.md`):
   a. **Read** `AiTasks/.type-registry.md` if exists — known types (seed + previously discovered). If missing, read `init/references/seed-types/.summary.md` as fallback
   b. **Read** `AiTasks/.type-profiles/<type>.md` if exists — shared profile from prior tasks (check for each pipe segment of current type; apply directory-safe transform: `:` → `-` in type for filename). This provides a starting point, eliminating redundant web searches
   c. **If `--caller plan`** and `.type-profile.md` doesn't exist or confidence is `low`:
     - If shared profile exists → use as starting point for `.type-profile.md`, then refine per-task
     - If no shared profile → web search `.target.md` domain keywords to identify the actual field
     - Compare against type registry — detect single match, hybrid indicators, or novel domain
     - For hybrid tasks: write type as `A|B` pipe-separated format (e.g., `data-pipeline|ml`)
     - For novel domains: **register** new type in `AiTasks/.type-registry.md` (append row with date + source task)
   d. **Write** or update `.type-profile.md` with all sections including **Phase Intelligence** and **Audit Adaptation** (per-perspective domain checkpoints — use seed tables from `check/references/six-perspective-audit.md` Domain Adaptation as starting point, supplement with web research for novel types)
   e. **Update** `type` in `.index.json` (use `A|B` format for hybrids)
   f. **Sync to shared**: copy `.type-profile.md` to `AiTasks/.type-profiles/<primary-type>.md` (acquire `.type-profiles/.lock` first; apply directory-safe transform: replace `:` with `-` in type segment when used as filename, e.g., `science:astro` → `science-astro`). For ALL types — seed types also benefit from cross-task profile accumulation. Release lock after write
   g. **If `--caller verify|check|exec`** and `.type-profile.md` exists:
     - Check if current phase's section in profile is adequate (e.g., verify caller → "Verification Standards" section; check caller → "Audit Adaptation" + "Verification Standards" sections)
     - If inadequate or missing: web search for domain-specific methodology for this phase
     - If type classification changed (e.g., discovered secondary domain): update type in `.index.json` to `A|B` format, register new type if needed
     - Update `.type-profile.md` with findings, append to refinement log
     - **Sync to shared**: if profile was significantly updated → merge changes to `AiTasks/.type-profiles/<primary-type>.md` (apply directory-safe transform for `:` in type, acquire `.type-profiles/.lock`, release after write)
9. **Determine research direction**: Read `.type-profile.md` "Phase Intelligence" section first. If it has direction for the calling phase, use it. Otherwise fall back to per-type seed file `init/references/seed-types/<type>.md` for the calling phase's methodology. For types not in seed files, use `.type-profile.md` as sole direction source
10. **Gap analysis**:
    - Extract topic keywords from steps 2-6 (technologies, libraries, APIs, patterns, methodologies, domain concepts)
    - Cross-reference with intelligence matrix from step 9 — ensure collection targets match the calling phase's needs
    - For hybrid types: include keywords from **both** primary and secondary domains
    - Compare against existing references from step 7
    - Produce a list of **uncovered topics** that need research
    - If `--scope gap` and no uncovered topics → log `"references sufficient, skipping collection"` → skip to step 15
11. **Acquire** `AiTasks/.references/.lock` (see Concurrency Protection in `commands/ai-cli-task.md`)
12. **Active research** — for each uncovered topic:
    - Use shell commands to gather domain knowledge: `curl` official docs/APIs, `npm info` / `pip show` for package details, web search for best practices, GitHub issues for known pitfalls, `man` pages for CLI tools, read project `node_modules` or local source for API details
    - **Phase-directed focus**: collection content must align with the calling phase's needs from step 9 (e.g., verify-phase calls should collect testing tools/frameworks/thresholds, not architecture patterns)
    - For hybrid types: collect from **both** primary and secondary domain sources
    - Write findings to `AiTasks/.references/<topic>.md` (kebab-case filename, e.g., `express-middleware.md`, `ffmpeg-filters.md`)
    - Each file should be self-contained: what it is, key APIs/patterns, usage examples, gotchas, links to official docs
    - **Append** to existing `<topic>.md` if the file already exists (add new section with date header), do not overwrite
13. **Update** `AiTasks/.references/.summary.md` — overwrite with index of ALL reference files:
    ```markdown
    # References Index

    | File | Topic | Keywords | Phase | Updated |
    |------|-------|----------|-------|---------|
    | express-middleware.md | Express middleware | routing, middleware, error handling | plan | 2024-01-15 |
    | jest-testing.md | Jest testing framework | unit test, coverage, mocking | verify | 2024-01-16 |
    ```
14. **Release** `AiTasks/.references/.lock`
15. **Git commit**: `-- ai-cli-task(<module>):research collect references` (skip if no files written; include `.type-profile.md` and `AiTasks/.type-profiles/` if updated)
16. **Write** `.auto-signal`: `{ "step": "research", "result": "(collected)" or "(sufficient)", "next": "<caller>", "checkpoint": "post-research", "timestamp": "..." }` — `next` field routes back to the calling phase (default: `plan`; if `--caller verify` → `verify`; if `--caller check` → `check`; if `--caller exec` → `exec`)

## Output

| Output | Location | Content |
|--------|----------|---------|
| Reference files | `AiTasks/.references/<topic>.md` | Domain knowledge per topic (kebab-case filename) |
| Reference index | `AiTasks/.references/.summary.md` | Keyword-searchable index of all reference files |
| Type registry | `AiTasks/.type-registry.md` | Auto-expanding type list (new types appended) |
| Shared profiles | `AiTasks/.type-profiles/<type>.md` | Cross-task type profiles (for types not in static tables) |

Research writes to shared directories (`AiTasks/.references/`, `.type-registry.md`, `.type-profiles/`) and to the task module's `.type-profile.md` and `.index.json` `type` field. It does **NOT** modify other task module files (`.summary.md`, `.plan.md`, etc.).

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
| Collected | `{ "step": "research", "result": "(collected)", "next": "<caller>", "checkpoint": "post-research", "timestamp": "..." }` |
| Sufficient | `{ "step": "research", "result": "(sufficient)", "next": "<caller>", "checkpoint": "post-research", "timestamp": "..." }` |

`<caller>` defaults to `plan`. When invoked with `--caller verify|check|exec`, routes back to that phase instead.

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

- **Evidence over assumptions**: Always verify claims via shell commands — `curl` official docs, check actual installed versions, read source code. Do not rely solely on internal knowledge
- **Concurrency**: Research acquires `AiTasks/.references/.lock` before writing and releases on completion. If the lock is held (another task is writing), wait and retry (see Concurrency Protection in `commands/ai-cli-task.md`)
- **Idempotent**: Running research multiple times with `--scope gap` is safe — it only adds missing topics, never removes or overwrites existing reference content (append-only for existing files)
- **Shared resources**: `.references/`, `.type-registry.md`, and `.type-profiles/` are shared across all task modules. References and type profiles collected for one task benefit future tasks in the same domain. This is by design — domain knowledge compounds
- **Shared profile priority**: When building `.type-profile.md`, check `AiTasks/.type-profiles/<type>.md` first. If it exists, use as starting point instead of researching from scratch. Only web search for topics not covered by the shared profile

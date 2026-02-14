---
name: init
description: Initialize a new task module in AiTasks/ directory with system files, git branch, and optional worktree
arguments:
  - name: module_name
    description: "Name of the task module directory to create (e.g., auth-refactor, add-search)"
    required: true
  - name: title
    description: "Human-readable title for the task (defaults to module_name)"
    required: false
  - name: tags
    description: "Comma-separated tags (e.g., feature,backend,urgent)"
    required: false
  - name: type
    description: "Task type for domain-specific .target.md template (e.g., software, dsp, literary)"
    required: false
  - name: worktree
    description: "Create isolated git worktree for parallel execution (flag, no value)"
    required: false
---

# /ai-cli-task init — Initialize Task Module

Create a new task module under the project's `AiTasks/` directory with the standard system file structure.

## Usage

```
/ai-cli-task init <module_name> [--title "Task Title"] [--tags feature,backend] [--type software] [--worktree]
```

## Directory Structure Created

```
AiTasks/
└── <module_name>/
    ├── .index.md       # Task metadata (YAML frontmatter) — machine-readable
    └── .target.md      # Task target / requirements — human-authored
```

## .index.md YAML Schema

The `.index.md` file uses YAML frontmatter as the single source of truth for task state:

```yaml
---
title: "Human-readable task title"
type: ""
status: draft
phase: ""
completed_steps: 0
created: 2024-01-01T00:00:00Z
updated: 2024-01-01T00:00:00Z
depends_on: []
tags: []
branch: "task/module-name"
worktree: ".worktrees/task-module-name"   # empty if not using worktree
---
```

### Status Values

| Status | Description |
|--------|-------------|
| `draft` | Initial state, task target being defined |
| `planning` | Implementation plan being researched |
| `review` | Plan complete, awaiting feasibility evaluation |
| `executing` | Implementation in progress |
| `re-planning` | Execution hit issues, plan being revised |
| `complete` | Task finished and verified |
| `blocked` | Blocked by dependency or unresolved issue |
| `cancelled` | Task abandoned |

### depends_on Format

Dependencies reference other task modules. Two formats — simple string (requires `complete`) and extended object (custom minimum status):

```yaml
depends_on:
  - "auth-refactor"                                  # Simple: requires complete
  - { module: "api-design", min_status: "review" }   # Extended: requires at least review
```

## System Files (dot-prefixed)

| File | Purpose | Created by |
|------|---------|-----------|
| `.index.md` | Task metadata, state machine | `init` (always) |
| `.target.md` | Task requirements / objectives | `init` (always) |
| `.analysis/` | Evaluation history (one file per assessment) | `check` (on demand) |
| `.test/` | Test criteria & results (one file per phase) | `plan`/`exec`/`check` (on demand) |
| `.bugfix/` | Issue history (one file per mid-exec issue) | `check` (on demand) |
| `.notes/` | Research notes & experience log (one file per entry) | `plan`/`exec` (on demand) |
| `.summary.md` | Condensed context summary | `plan`/`check`/`exec` (on demand) |
| `.report.md` | Completion report | `report` (on demand) |
| `.tmp-annotations.json` | Transient annotation transport | Frontend (ephemeral) |

User-created `.md` files (without dot prefix) are task plan documents authored via the Plan annotation panel.

## Root AiTasks/.index.md Format

The root `AiTasks/.index.md` is a module listing auto-managed by `init`:

```markdown
# AiTasks

- [auth-refactor](./auth-refactor/.index.md) — User auth refactoring
- [add-search-v2](./add-search-v2/.index.md) — Add search functionality v2
```

Each line: `- [<module_name>](./<module_name>/.index.md) — <title>`

Created automatically by `init` if `AiTasks/` directory does not exist. `init` appends one line per new module. No other sub-command modifies this file.

When the root index grows large (50+ entries), consider manually reorganizing into sections (`## Active`, `## Completed`, `## Archived`) for readability. This is a manual maintenance activity.

## Execution Steps

1. **Validate** module_name: ASCII letters, digits, hyphens, underscores (`[a-zA-Z0-9_-]+`), no whitespace, no leading dot, no path separators
2. **Check** `AiTasks/` directory exists; create with root `.index.md` if missing
3. **Check** `AiTasks/<module_name>/` does not already exist; abort with error if it does
4. **Check branch collision**: verify `task/<module_name>` branch does not already exist (`git branch --list task/<module_name>`). If exists, abort with error suggesting `--cleanup` the old task or choose a different name
5. **Check working tree clean**: verify no uncommitted changes (`git status --porcelain`). If dirty, abort with error — branch should be created from a clean state to avoid mixing unrelated changes. User should commit or stash first
6. **Git**: create branch `task/<module_name>` from current HEAD
7. **If `--worktree`**: `git worktree add .worktrees/task-<module_name> task/<module_name>`
8. **If not worktree**: `git checkout task/<module_name>`
9. **Create** `AiTasks/<module_name>/` directory (in worktree if applicable)
10. **Create** `AiTasks/<module_name>/.index.md` with YAML frontmatter:
   - `title`: from `--title` argument or module_name
   - `status`: `draft`
   - `phase`: `""` (empty)
   - `completed_steps`: `0`
   - `created`: current ISO timestamp
   - `updated`: current ISO timestamp
   - `depends_on`: `[]`
   - `tags`: parsed from `--tags` argument or `[]`
   - `branch`: `task/<module_name>`
   - `worktree`: `.worktrees/task-<module_name>` (or empty if no worktree)
11. **Create** `AiTasks/<module_name>/.target.md` using domain-specific template:
    - If `--type` is specified, validate value matches `[a-zA-Z0-9_:-]+`; reject with error if invalid
    - If `--type` is specified and a matching template exists in `references/target-templates/<type>.md`, copy it (replacing `<title>` placeholder)
    - If `--type` is specified, also set `.index.md` `type` field to the given value
    - Otherwise, use the default template:
    ```markdown
    # Task Target: <title>

    ## Objective

    <!-- Describe the goal of this task -->

    ## Requirements

    <!-- List specific requirements -->

    ## Constraints

    <!-- Any constraints or limitations -->
    ```
12. **Update** `AiTasks/.index.md`: append a line referencing the new module (if not already listed)
13. **Git commit**: `-- ai-cli-task(<module_name>):init initialize task module`
14. **Report**: path, files created, branch name, worktree path (if any), next step hint

## Git

- Creates branch: `task/<module_name>` from current HEAD
- Without worktree: `git checkout task/<module_name>` before creating files
- Optional worktree: `.worktrees/task-<module_name>`
- Commit: `-- ai-cli-task(<module_name>):init initialize task module`

## Notes

- Module names are ASCII only: letters, digits, hyphens, underscores (`[a-zA-Z0-9_-]+`). No whitespace, no leading dot, no path separators. Examples: `auth-refactor`, `add-search-v2`
- The `.target.md` is for human authoring — users fill in requirements via the Plan annotation panel
- System files (dot-prefixed) should not be manually edited except `.target.md`
- After init, the typical workflow is: edit `.target.md` → `/ai-cli-task plan` → `/ai-cli-task check` → `/ai-cli-task exec`
- With `--worktree`, the task runs in an isolated directory; multiple tasks can execute simultaneously
- **Branch collision check**: if `task/<module_name>` branch already exists (from a previous cancelled/completed task), init aborts. User should delete the old branch first (`git branch -d task/<name>`) or choose a different module name
- **Clean working tree**: init requires no uncommitted changes to avoid mixing unrelated work into the task branch. User should `git commit` or `git stash` first

---
name: init
description: Initialize a new task module in TASK/ directory with system files, git branch, and optional worktree
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
  - name: worktree
    description: "Create isolated git worktree for parallel execution (flag, no value)"
    required: false
---

# /ai-cli-task init — Initialize Task Module

Create a new task module under the project's `TASK/` directory with the standard system file structure.

## Usage

```
/ai-cli-task init <module_name> [--title "Task Title"] [--tags feature,backend] [--worktree]
```

## Directory Structure Created

```
TASK/
└── <module_name>/
    ├── .index.md       # Task metadata (YAML frontmatter) — machine-readable
    └── .target.md      # Task target / requirements — human-authored
```

## .index.md YAML Schema

The `.index.md` file uses YAML frontmatter as the single source of truth for task state:

```yaml
---
title: "Human-readable task title"
status: draft
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

Dependencies use TASK-root-relative paths:

```yaml
depends_on:
  - "auth-refactor"           # Another task module at TASK/auth-refactor
  - "api-redesign/endpoints"  # Sub-path reference
```

## System Files (dot-prefixed)

| File | Purpose | Created by |
|------|---------|-----------|
| `.index.md` | Task metadata, state machine | `init` (always) |
| `.target.md` | Task requirements / objectives | `init` (always) |
| `.analysis/` | Evaluation history (one file per assessment) | `check` (on demand) |
| `.test.md` | Test/verification plan | `plan` (on demand) |
| `.bugfix/` | Issue history (one file per mid-exec issue) | `check` (on demand) |
| `.notes/` | Research notes & experience log (one file per entry) | `plan`/`exec` (on demand) |
| `.report.md` | Completion report | `report` (on demand) |
| `.tmp-annotations.json` | Transient annotation transport | Frontend (ephemeral) |

User-created `.md` files (without dot prefix) are task plan documents authored via the Plan annotation panel.

## Root TASK/.index.md Format

The root `TASK/.index.md` is a module listing auto-managed by `init`:

```markdown
# TASK

- [auth-refactor](./auth-refactor/.index.md) — User auth refactoring
- [用户认证重构](./用户认证重构/.index.md) — 重构用户认证系统
```

Each line: `- [<module_name>](./<module_name>/.index.md) — <title>`

Created automatically by `init` if `TASK/` directory does not exist. `init` appends one line per new module. No other sub-command modifies this file.

## Execution Steps

1. **Validate** module_name: Unicode letters, digits, hyphens, underscores (`[\p{L}\p{N}_-]+`), no whitespace, no leading dot, no path separators
2. **Check** `TASK/` directory exists; create with root `.index.md` if missing
3. **Check** `TASK/<module_name>/` does not already exist; abort with error if it does
4. **Git**: create branch `task/<module_name>` from current HEAD
5. **If `--worktree`**: `git worktree add .worktrees/task-<module_name> task/<module_name>`
6. **If not worktree**: `git checkout task/<module_name>`
7. **Create** `TASK/<module_name>/` directory (in worktree if applicable)
8. **Create** `TASK/<module_name>/.index.md` with YAML frontmatter:
   - `title`: from `--title` argument or module_name
   - `status`: `draft`
   - `created`: current ISO timestamp
   - `updated`: current ISO timestamp
   - `depends_on`: `[]`
   - `tags`: parsed from `--tags` argument or `[]`
   - `branch`: `task/<module_name>`
   - `worktree`: `.worktrees/task-<module_name>` (or empty if no worktree)
9. **Create** `TASK/<module_name>/.target.md` with a template header:
   ```markdown
   # Task Target: <title>

   ## Objective

   <!-- Describe the goal of this task -->

   ## Requirements

   <!-- List specific requirements -->

   ## Constraints

   <!-- Any constraints or limitations -->
   ```
10. **Update** `TASK/.index.md`: append a line referencing the new module (if not already listed)
11. **Git commit**: `-- ai-cli-task(<module_name>):init initialize task module`
12. **Report**: path, files created, branch name, worktree path (if any), next step hint

## Git

- Creates branch: `task/<module_name>` from current HEAD
- Without worktree: `git checkout task/<module_name>` before creating files
- Optional worktree: `.worktrees/task-<module_name>`
- Commit: `-- ai-cli-task(<module_name>):init initialize task module`

## Notes

- Module names support UTF-8: Unicode letters, digits, hyphens, underscores (`[\p{L}\p{N}_-]+`). No whitespace, no leading dot, no path separators. Examples: `auth-refactor`, `用户认证重构`, `add-search-v2`
- The `.target.md` is for human authoring — users fill in requirements via the Plan annotation panel
- System files (dot-prefixed) should not be manually edited except `.target.md`
- After init, the typical workflow is: edit `.target.md` → `/ai-cli-task plan` → `/ai-cli-task check` → `/ai-cli-task exec`
- With `--worktree`, the task runs in an isolated directory; multiple tasks can execute simultaneously

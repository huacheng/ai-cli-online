---
name: auto
description: Autonomous execution loop — coordinates plan/check/exec cycle with backend daemon
arguments:
  - name: task_module
    description: "Path to the task module directory (e.g., TASK/auth-refactor)"
    required: true
  - name: action
    description: "Action: start, stop, or status"
    required: false
    default: start
---

# /ai-cli-task auto — Autonomous Execution Loop

Coordinate the full task lifecycle autonomously: plan → check → exec → check, with self-correction on failures.

## Usage

```
/ai-cli-task auto <task_module_path> [--start|--stop|--status]
```

## Architecture

Auto mode is **backend-driven** — the server daemon manages the execution loop independently of the frontend WebSocket connection. This ensures the loop continues even if the browser is closed or the tab is switched.

### Components

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────┐
│  Claude (skill)  │────▶│  .auto-signal    │────▶│  Backend    │
│  writes signal   │     │  (file in TASK/) │     │  Daemon     │
│  after each step │     └──────────────────┘     │  (fs.watch) │
└─────────────────┘                               └──────┬──────┘
                                                         │
                                              ┌──────────▼──────────┐
                                              │  tmux capture-pane  │
                                              │  (readiness check)  │
                                              └──────────┬──────────┘
                                                         │
                                              ┌──────────▼──────────┐
                                              │  PTY write          │
                                              │  next command       │
                                              └─────────────────────┘
```

### Signal File (`.auto-signal`)

After each step completes, Claude writes a signal file to the task module:

```json
{
  "step": "check",
  "result": "PASS",
  "next": "exec",
  "timestamp": "2024-01-01T00:00:00Z"
}
```

The backend daemon detects this via `fs.watch` and:
1. Checks terminal readiness (`tmux capture-pane` — looks for shell prompt)
2. Sends the next command to PTY: `claude "/ai-cli-task <next_skill> <task_module>"`
3. Deletes the `.auto-signal` file

### Terminal Readiness Detection

Before sending any command, the daemon captures the tmux pane output and verifies:
- Shell prompt is visible (e.g., `$`, `❯`, `%`)
- No active command is running
- Previous command has completed

If terminal is not ready, the daemon retries with exponential backoff (1s, 2s, 4s, max 30s).

## State Machine

```
       ┌──────────────────────────────────────────┐
       │              AUTO LOOP                    │
       │                                           │
 start ▼                                           │
┌──────────┐    ┌──────────┐    ┌──────────┐       │
│ planning │───▶│ check    │───▶│  exec    │───────┘
│ (plan)   │    │(post-plan│    │  (done)  │
└──────────┘    │ PASS)    │    └──────────┘
       ▲        └────┬─────┘         │
       │             │               │ signal (done)
       │        NEEDS_│               ▼
       │        REVISION        ┌──────────┐
       │             │          │ check    │
       │             ▼          │(post-exec)│
       │        ┌──────────┐   └────┬─────┘
       │        │ re-plan  │        │
       │        │          │  ┌─────┼─────────┐
       │        └──────────┘  ▼     ▼         ▼
       │             ▲     ACCEPT NEEDS_FIX  REPLAN
       │             │        │     │         │
       │             │        ▼     ▼         │
       │             │   ┌────────┐ (re-exec) │
       │             │   │complete│           │
       │             │   │(report)│           │
       │             │   └────────┘           │
       │             └────────────────────────┘
       └──────────────────────┘
```

## Auto Loop Steps

1. **Start**: Read `.index.md` status, determine entry point
2. **Route** based on current status:

| Current Status | Auto Action |
|----------------|-------------|
| `draft` | Run `plan --generate` (or with annotations if `.tmp-annotations.json` present) |
| `planning` | Run `check --checkpoint post-plan` |
| `review` | Run `exec` |
| `executing` | Run `check --checkpoint post-exec` |
| `re-planning` | Run `check --checkpoint post-plan` (on revised plan) |
| `complete` | Run `report`, then stop loop |
| `blocked` | Stop loop, report blocking reason |
| `cancelled` | Stop loop |

3. **After each skill completes**: Write `.auto-signal` with result and **next action**
4. **Daemon picks up signal** → reads `next` field → sends next command → loop continues
5. **Loop terminates** when status reaches `complete`, `blocked`, or `cancelled`

### Two-Level Routing

- **First entry**: Status-based routing (table above) — determines the entry point
- **Subsequent iterations**: Signal-based routing (`.auto-signal` `next` field) — drives the loop

The `next` field is critical for breaking self-loop scenarios (NEEDS_REVISION, NEEDS_FIX):

| step | result | next | Rationale |
|------|--------|------|-----------|
| check | PASS | exec | Plan approved, proceed to execution |
| check | NEEDS_REVISION | plan | Plan needs revision, re-generate first |
| check | ACCEPT | report | Task complete, generate report |
| check | NEEDS_FIX | exec | Minor issues, re-execute to fix first |
| check | REPLAN | plan | Fundamental issues, revise plan |
| check | BLOCKED | (stop) | Cannot continue |
| plan | (any) | check | Plan ready, assess it |
| exec | (done) | check --checkpoint post-exec | Execution phase done (full or partial), verify |
| exec | (blocked) | (stop) | Cannot continue |
| report | (any) | (stop) | Loop complete |

Without signal-based routing, NEEDS_REVISION and NEEDS_FIX would cause infinite loops (status unchanged → same command re-sent → same result).

## Backend REST API

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/sessions/:id/task-auto` | Start auto mode for a task module |
| `DELETE` | `/api/sessions/:id/task-auto` | Stop auto mode |
| `GET` | `/api/sessions/:id/task-auto` | Get auto mode status |

Request body for POST:
```json
{
  "taskDir": "/absolute/path/to/TASK/module-name",
  "maxIterations": 20,
  "timeoutMinutes": 30
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `taskDir` | string | (required) | Absolute path to task module |
| `maxIterations` | number | 20 | Max plan/check/exec cycles before forced stop |
| `timeoutMinutes` | number | 30 | Total execution time limit (minutes). User sets based on task difficulty |

Frontend displays these as editable fields in the auto-start dialog, with sensible defaults.

### SQLite State

```sql
CREATE TABLE task_auto (
  session_name TEXT PRIMARY KEY,
  task_dir TEXT NOT NULL UNIQUE,
  status TEXT DEFAULT 'running',
  max_iterations INTEGER DEFAULT 20,
  timeout_minutes INTEGER DEFAULT 30,
  iteration_count INTEGER DEFAULT 0,
  started_at TEXT,
  last_signal_at TEXT
);
```

`session_name` as PRIMARY KEY enforces one auto loop per session. Starting a new auto task requires stopping the current one or creating a new session.

## Safety

- **Max iterations**: user-configurable (default 20), forced stop when reached
- **Timeout**: user-configurable (default 30 min), forced stop when elapsed
- **Pause on blocked**: Auto stops immediately on `blocked` status
- **Manual override**: User can `/ai-cli-task auto --stop` at any time
- **Terminal check**: Always verify terminal readiness before sending commands
- **Single instance per session**: Only one auto loop per session (enforced by SQLite PK). If an auto task is already running, `POST` returns 409 Conflict
- **Single instance per task**: UNIQUE constraint on `task_dir` prevents same task from running in multiple sessions

## Frontend Integration

The frontend is a **pure observer** for auto mode, except for start/stop control:

- **Start dialog**: editable fields for `maxIterations` and `timeoutMinutes` with defaults
- **Status display**: polls `GET /api/sessions/:id/task-auto`, shows in Plan panel toolbar:
  - Current iteration / max iterations
  - Elapsed time / timeout
  - Current step (plan/check/exec)
  - Running / stopped status
- **Stop button**: sends `DELETE /api/sessions/:id/task-auto`
- Does NOT drive the loop — backend daemon handles all orchestration

## Cleanup

When auto mode stops (complete, blocked, cancelled, or manual stop):
1. Delete `.auto-signal` file if exists
2. Remove `task_auto` row from SQLite
3. Frontend status indicator clears on next poll

## Git

Auto mode inherits git behavior from each sub-command it invokes. No additional git commits are made by auto itself — each `plan`, `check`, `exec`, and `report` sub-command handles its own state commits on the task branch.

## Notes

- Auto mode uses `claude "/ai-cli-task ..."` CLI invocation, not `/` slash commands
- The daemon starts a `fs.watch` on the task module directory for `.auto-signal`
- If the backend server restarts, auto state is recovered from SQLite on startup
- `.auto-signal` is a transient file — should be in `.gitignore`
- The daemon logs all actions to server console for debugging

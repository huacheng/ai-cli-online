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
  "checkpoint": "",
  "timestamp": "2024-01-01T00:00:00Z"
}
```

Fields:
- `step`: the sub-command that just completed
- `result`: outcome of the step
- `next`: next sub-command to run (or `"(stop)"`)
- `checkpoint`: hint for the next command when it needs a checkpoint parameter (e.g., `"post-plan"`, `"mid-exec"`, `"post-exec"`). Empty when not applicable
- `timestamp`: ISO 8601

The backend daemon detects this via `fs.watch` and:
1. Checks terminal readiness (`tmux capture-pane` — looks for shell prompt)
2. Reads the signal file and **validates** before use (see Signal Validation below)
3. Constructs next command from validated fields: `claude "/ai-cli-task <next> <task_module> [--checkpoint <checkpoint>]"`
4. Sends the command to PTY
5. Deletes the `.auto-signal` file

### Signal Validation (Security)

The daemon MUST validate `.auto-signal` before constructing PTY commands to prevent command injection:

| Field | Validation | Allowed Values |
|-------|-----------|----------------|
| `step` | Whitelist | `plan`, `check`, `exec`, `merge`, `report` |
| `result` | Whitelist | `PASS`, `NEEDS_REVISION`, `ACCEPT`, `NEEDS_FIX`, `REPLAN`, `BLOCKED`, `CONTINUE`, `(generated)`, `(annotations)`, `(done)`, `(mid-exec)`, `(step-N)` (where N is integer), `(blocked)`, `success`, `blocked`, `(generated)` |
| `next` | Whitelist | `plan`, `check`, `exec`, `merge`, `report`, `(stop)` |
| `checkpoint` | Whitelist | `""`, `post-plan`, `mid-exec`, `post-exec` |
| `timestamp` | Format check | ISO 8601 |

- **Reject** any signal with fields not matching the whitelist — do NOT pass to PTY
- **No string interpolation**: construct the command from validated enum values, not raw string concatenation from the signal file
- **Log rejected signals** for debugging

### Terminal Readiness Detection

Before sending any command, the daemon captures the tmux pane output and verifies:
- Shell prompt is visible (e.g., `$`, `❯`, `%`)
- No active command is running
- Previous command has completed

If terminal is not ready, the daemon retries with exponential backoff (1s, 2s, 4s, max 30s).

### Stall Detection & Recovery

Claude Code may stall mid-execution (e.g., waiting for user input, context window overflow prompt, or internal hang). Since the daemon is signal-driven, a stall means no `.auto-signal` is written and the loop halts silently. The daemon MUST actively detect and recover from stalls.

#### Heartbeat Polling

The daemon runs a periodic heartbeat (every 60 seconds) while an auto loop is active:

1. `tmux capture-pane -t '=${name}:' -p` — capture current terminal output
2. Compare with previous capture (store last capture hash)
3. Track consecutive unchanged captures as `stall_count`

#### Stall Determination

| `stall_count` | Terminal Output Status | Verdict |
|---------------|----------------------|---------|
| < 3 | — | Normal (Claude may be thinking/working) |
| ≥ 3 | Output unchanged for ≥ 3 polls | Stall suspected → run pattern match |

A stall is only suspected after **3 consecutive unchanged captures** (≥ 3 minutes at 60s interval). This avoids false positives from long-running steps.

#### Pattern Matching Recovery

When stall is suspected, scan the captured pane output for known stall patterns:

| Pattern | Detection | Recovery Action |
|---------|-----------|-----------------|
| Continuation prompt | `continue`, `Continue?`, `press enter` (case-insensitive) | Send `continue\n` to PTY |
| Yes/No prompt | `(y/n)`, `(Y/N)`, `[y/N]`, `[Y/n]` | Send `y\n` to PTY |
| Proceed prompt | `Do you want to proceed`, `Shall I continue` | Send `yes\n` to PTY |
| Shell prompt visible | `$`, `❯`, `%` at end of output (no active command) | Claude exited without writing signal → re-send last command |
| No recognizable pattern | — | Log warning, increment `stall_count`, continue polling |

#### Recovery Limits

| Limit | Value | Action on Exceed |
|-------|-------|-----------------|
| Max recoveries per step | 3 | Stop auto loop, report stall |
| Max total recoveries | 10 | Stop auto loop, report repeated stalls |

Recovery counts are tracked in SQLite (`recovery_count_step`, `recovery_count_total` in `task_auto` table) and reset per step on successful `.auto-signal` receipt.

#### SQLite Schema Addition

```sql
ALTER TABLE task_auto ADD COLUMN recovery_count_step INTEGER DEFAULT 0;
ALTER TABLE task_auto ADD COLUMN recovery_count_total INTEGER DEFAULT 0;
ALTER TABLE task_auto ADD COLUMN last_capture_hash TEXT DEFAULT '';
ALTER TABLE task_auto ADD COLUMN stall_count INTEGER DEFAULT 0;
```

## State Machine

```
AUTO LOOP (4 phases)

Phase 1: Planning
  plan ──→ check(post-plan) ─── PASS ──────────→ [Phase 2]
                │
                NEEDS_REVISION ──→ plan (retry)

Phase 2: Execution
  exec ─┬─ (mid-exec) ──→ check(mid-exec) ─── CONTINUE ──→ exec (resume)
        │                         │
        │                    NEEDS_FIX ──→ exec (fix then resume)
        │                         │
        │                    REPLAN ──→ [Phase 1]
        │
        └─ (done) ──→ [Phase 3]

Phase 3: Verification
  check(post-exec) ─── ACCEPT ──→ [Phase 4]
          │                │
       NEEDS_FIX        REPLAN ──→ [Phase 1]
          │
          └──→ exec (re-exec) → [Phase 3]

Phase 4: Merge & Report
  merge ─── success ──→ report → (stop)
    │
    └── conflict unresolvable (after 3 retries, stays executing) → (stop)

Terminal: BLOCKED at any check → (stop, status → blocked)
Terminal: merge conflict → (stop, status stays executing — retryable)
```

## Auto Loop Steps

1. **Start**: Read `.index.md` status, determine entry point
2. **Route** based on current status:

| Current Status | Auto Action |
|----------------|-------------|
| `draft` | Validate `.target.md` has substantive content (not just template placeholders) → if empty, stop and report "fill `.target.md` first". Otherwise run `plan --generate` |
| `planning` | Run `check --checkpoint post-plan` |
| `review` | Run `exec` |
| `executing` | Run `check --checkpoint post-exec` |
| `re-planning` | Read `phase` field: if `needs-plan` → run `plan --generate`; if `needs-check` → run `check --checkpoint post-plan`; if empty → default to `plan --generate` (safe fallback) |
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

| step | result | next | checkpoint | Rationale |
|------|--------|------|------------|-----------|
| check | PASS | exec | — | Plan approved, proceed to execution |
| check | NEEDS_REVISION | plan | — | Plan needs revision, re-generate first |
| check | ACCEPT | merge | — | Task verified, merge to main |
| check | NEEDS_FIX | exec | mid-exec / post-exec | Minor issues, re-execute to fix first |
| check | REPLAN | plan | — | Fundamental issues, revise plan |
| check | BLOCKED | (stop) | — | Cannot continue |
| check (mid-exec) | CONTINUE | exec | — | Progress OK, resume execution |
| check (mid-exec) | NEEDS_FIX | exec | mid-exec | Fixable issues, exec addresses then continues |
| check (mid-exec) | REPLAN | plan | — | Fundamental issues, revise plan |
| check (mid-exec) | BLOCKED | (stop) | — | Cannot continue |
| plan | (any) | check | post-plan | Plan ready, assess it |
| exec | (done) | check | post-exec | All steps completed, verify results |
| exec | (mid-exec) | check | mid-exec | Significant issue encountered, checkpoint |
| exec | (step-N) | check | mid-exec | Single step completed (from manual `--step N`), mid-exec checkpoint |
| exec | (blocked) | (stop) | — | Cannot continue |
| merge | success | report | — | Merge complete, generate report |
| merge | blocked | (stop) | — | Merge conflict unresolvable |
| report | (any) | (stop) | — | Loop complete |

**Note on `(step-N)`:** This signal is produced only when `exec --step N` is invoked manually (targeted single-step execution). In normal auto flow, the daemon sends `exec` without `--step`, and exec runs all remaining steps sequentially. The `(step-N)` routing is defensive — if someone manually triggers `--step N` during an active auto loop, the daemon knows to route to mid-exec check.

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
  recovery_count_step INTEGER DEFAULT 0,
  recovery_count_total INTEGER DEFAULT 0,
  last_capture_hash TEXT DEFAULT '',
  stall_count INTEGER DEFAULT 0,
  started_at TEXT,
  last_signal_at TEXT
);
```

`session_name` as PRIMARY KEY enforces one auto loop per session. Starting a new auto task requires stopping the current one or creating a new session.

## Safety

- **Max iterations**: user-configurable (default 20), forced stop when reached
- **Timeout**: user-configurable (default 30 min), forced stop when elapsed
- **Stall detection**: heartbeat polling (60s) + pattern matching recovery, with per-step (3) and total (10) recovery limits
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
1. Stop heartbeat polling timer
2. Delete `.auto-signal` file if exists
3. Remove `task_auto` row from SQLite (clears all stall detection state)
4. Frontend status indicator clears on next poll

## Git

Auto mode inherits git behavior from each sub-command it invokes. No additional git commits are made by auto itself — each `plan`, `check`, `exec`, and `report` sub-command handles its own state commits on the task branch.

## Notes

- Auto mode uses `claude "/ai-cli-task ..."` CLI invocation, not `/` slash commands
- The daemon starts a `fs.watch` on the task module directory for `.auto-signal`
- If the backend server restarts, auto state is recovered from SQLite on startup
- `.auto-signal` is a transient file — should be in `.gitignore`
- The daemon logs all actions to server console for debugging

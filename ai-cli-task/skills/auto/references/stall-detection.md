# Stall Detection & Recovery

Claude Code may stall mid-execution (e.g., context window overflow prompt, waiting for user input, or internal hang). The daemon MUST actively detect and recover from stalls.

## Heartbeat Polling

The daemon runs a periodic heartbeat (every 60 seconds) while an auto loop is active:

1. `tmux capture-pane -t '=${name}:' -p` — capture current terminal output
2. Compare with previous capture (store last capture hash)
3. Track consecutive unchanged captures as `stall_count`

## Stall Determination

| `stall_count` | Terminal Output Status | Verdict |
|---------------|----------------------|---------|
| < 3 | — | Normal (Claude may be thinking/working) |
| >= 3 | Output unchanged for >= 3 polls | Stall suspected -> run pattern match |

A stall is only suspected after **3 consecutive unchanged captures** (>= 3 minutes at 60s interval). This avoids false positives from long-running steps.

## Pattern Matching Recovery

When stall is suspected, first verify the **foreground process** is Claude itself — run `tmux list-panes -t '=${name}:' -F '#{pane_current_command}'` and confirm the result is `claude` (or `node` for Claude Code). If the foreground process is a child process (e.g., `python`, `npm`, `gcc`), do NOT apply pattern matching recovery — the output belongs to a subprocess, not a stall. Only proceed with pattern matching when Claude is the foreground process.

Scan the captured pane output for known stall patterns:

| Pattern | Detection | Recovery Action |
|---------|-----------|-----------------|
| Continuation prompt | `continue`, `Continue?`, `press enter` (case-insensitive) | Send `continue\n` to PTY |
| Yes/No prompt | `(y/n)`, `(Y/N)`, `[y/N]`, `[Y/n]` | Send `y\n` to PTY |
| Proceed prompt | `Do you want to proceed`, `Shall I continue` | Send `yes\n` to PTY |
| Shell prompt visible | `$`, `>`, `%` at end of output (no active command) | Claude session ended unexpectedly -> restart auto session (see Server Recovery in main SKILL.md) |
| **Quota exhausted** | `rate limit`, `quota exceeded`, `usage limit`, `token limit`, `try again later` (case-insensitive) | **NOT a stall** — reset `stall_count` to 0, enter quota-wait mode (see `references/context-quota.md`) |
| No recognizable pattern | — | Log warning, increment `stall_count`, continue polling |

## Recovery Limits

| Limit | Value | Action on Exceed |
|-------|-------|-----------------|
| Max recoveries per iteration | 3 | Write `.auto-stop` with reason `"stall_limit"` |
| Max total recoveries | 10 | Write `.auto-stop` with reason `"stall_limit"` |

Recovery counts are tracked in SQLite and reset on each new `.auto-signal` receipt.

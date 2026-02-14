# Context Window Management & Quota Exhaustion Handling

## Context Window Management

The auto loop runs in a single long-lived Claude session. As the conversation accumulates, context window usage grows. Proactive compaction prevents context overflow:

1. **Threshold**: Before each iteration (loop step 2b), Claude checks context window usage. At **>= 70%** usage, proactively run `/compact` to compress context
2. **Safety net**: Each sub-command writes `.summary.md` and directory-level `summary.md` files, providing condensed recovery context after compaction
3. **Post-compaction recovery**: After compaction, Claude re-reads `.auto-signal` (iteration + step position), `.index.md` (status), and `.summary.md` (task context) to resume the loop. See "Compaction recovery" in Context Advantage section of main SKILL.md

## Quota Exhaustion Handling

When Claude's API quota (token usage / rate limit) is exhausted mid-auto-loop, this is **NOT a stall** and must be handled differently:

### Daemon Behavior

1. **Detection**: Heartbeat captures terminal output containing quota-related messages (`rate limit`, `quota exceeded`, `usage limit`, etc.)
2. **Enter quota-wait mode**: Reset `stall_count` to 0, pause stall detection timers
3. **Suspend timeout**: Quota-wait time does **NOT** count toward `timeoutMinutes`. The daemon pauses the timeout clock while in quota-wait mode
4. **Continue heartbeat**: Keep polling at 60s interval, but only check for quota recovery (Claude resumes output) — do not apply stall determination logic
5. **Exit quota-wait**: When heartbeat detects new output (Claude resumed), restore normal monitoring and resume timeout clock

### Claude Behavior

- Claude Code automatically waits and retries when quota is exhausted — no special handling needed inside the auto loop
- The auto loop resumes naturally when quota resets

### SQLite Extension

```sql
ALTER TABLE task_auto ADD COLUMN quota_wait_since TEXT DEFAULT '';
```

- Set to ISO 8601 timestamp when entering quota-wait mode, cleared when exiting
- `timeoutMinutes` enforcement subtracts total quota-wait duration from elapsed time

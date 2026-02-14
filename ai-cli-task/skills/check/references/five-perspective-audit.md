# Five-Perspective Audit Checklist

When evaluating a plan or implementation, apply all five perspectives systematically. Each perspective has specific checkpoints — verify each one, flag issues by severity (HIGH / MEDIUM / LOW).

## 1. Security (安全)

| Checkpoint | What to Verify |
|------------|---------------|
| **Path traversal** | All user-provided paths resolved and confirmed under expected directory (no `..` escape) |
| **Input validation** | Names, identifiers, type fields constrained to safe character sets (regex-validated) |
| **Symlink protection** | No symlink-based escape from sandboxed directories |
| **Injection prevention** | No command injection, SQL injection, or template injection from user content |
| **Content sanitization** | External content (annotations, user input) stripped of HTML comments, ANSI escapes, control chars before writing to files |
| **Atomic operations** | Shared resources written atomically (write-to-tmp + rename) to prevent partial reads |
| **Concurrency protection** | Shared mutable state protected by locks (O_CREAT\|O_EXCL), stale lock recovery defined |
| **Secret handling** | No credentials, tokens, or secrets in logs, commit messages, or output files |
| **Privilege boundaries** | Foreground process verified before acting on terminal output (prevent subprocess output manipulation) |

## 2. Performance (性能)

| Checkpoint | What to Verify |
|------------|---------------|
| **Context window management** | Summary hierarchy exists (task-level → directory-level → individual files); readers use summaries as primary context |
| **Lazy loading** | Only latest files read from history directories for ongoing operations; full reads reserved for terminal operations (report) |
| **Growth control** | Accumulated files have compaction rules (line limits, summarization on threshold) |
| **Non-blocking operations** | Locks fail immediately (no spin-wait); file watches use kernel events (inotify), not polling |
| **I/O efficiency** | Bulk operations batched; unnecessary network/disk round trips eliminated |
| **Calculation accuracy** | Numerical estimates, capacity calculations, algorithm parameters computed via script — never mental math (see Computation Rule below) |

## 3. Extensibility (扩展性)

| Checkpoint | What to Verify |
|------------|---------------|
| **Open type system** | New categories/types can be added without modifying core logic |
| **Custom thresholds** | Project-specific acceptance criteria externalized (not hardcoded) |
| **Hook / extension points** | Status transitions, lifecycle events can trigger external actions |
| **Dependency format** | Supports both simple and extended (parameterized) dependency declarations |
| **Progressive disclosure** | Core logic self-contained; reference details loaded on demand |
| **Template system** | Domain-specific templates customizable per project |

## 4. Consistency (一致性)

| Checkpoint | What to Verify |
|------------|---------------|
| **Cross-file terminology** | Same concept uses identical wording across all files (e.g., dependency validation language) |
| **State machine alignment** | Every (state, command) cell in the matrix matches the skill's State Transitions section |
| **Signal routing match** | Every skill's .auto-signal definition matches the auto routing table |
| **Step numbering** | Execution steps are sequential with no gaps or duplicates |
| **Shared protocol references** | All files that use a shared protocol (locks, atomic writes) reference the canonical definition |
| **Field usage symmetry** | Fields written by one skill are correctly read by all consumers (phase, completed_steps, type) |
| **Naming conventions** | File naming patterns (dates, prefixes, suffixes) follow documented conventions everywhere |

## 5. Correctness / Completeness (正确性 / 完整性)

| Checkpoint | What to Verify |
|------------|---------------|
| **Deadlock freedom** | Every non-terminal state has ≥1 exit path; no state combinations trap the system |
| **Loop termination** | All cycles (plan↔check, exec↔check) have upper bounds (max iterations, timeout) |
| **Ordering correctness** | Operations that must happen before/after others are correctly sequenced (e.g., status update before signal write) |
| **Edge cases** | Empty inputs, missing files, first-run scenarios, legacy data handled gracefully |
| **Superseded data isolation** | Old/replaced artifacts invisible to readers (archived with dot prefix, excluded by convention) |
| **Source identification** | When multiple sources provide similar data (e.g., .bugfix/ vs .analysis/ for fix guidance), the correct source is selected (most recent by date) |
| **Fallback behavior** | Undefined/empty values have documented fallback (e.g., empty type → skip, unknown type → software) |
| **Idempotency** | Re-running a command in the same state produces the same result (or explicitly rejects) |

## Computation Rule

**No mental math.** When evaluation involves ANY numerical reasoning — performance estimates, size calculations, capacity limits, threshold comparisons, algorithm complexity, timing analysis — write a script and run it in shell instead of computing mentally.

Examples:
- Estimating file count growth over N iterations → write a Python one-liner
- Checking if a timeout (30 min) covers worst-case cycle count (20 iterations × 90s each) → calculate in shell
- Verifying line count thresholds (500-line compaction) → `wc -l` the actual file
- Comparing dates/timestamps for staleness detection → use `date` command arithmetic

**Why**: Mental arithmetic is error-prone, especially with units, edge cases, and compound calculations. Scripts produce verifiable, reproducible results.

## Audit Workflow

1. **Read** all relevant files for full context
2. **Apply** each perspective's checkpoints systematically
3. **Flag** issues with severity and specific file:line references
4. **Cross-reference** findings across perspectives (a security issue may also be a consistency issue)
5. **Propose** fixes grouped by file to minimize edit passes
6. **Verify** each fix doesn't introduce new issues in other perspectives

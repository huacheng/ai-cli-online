# Task-Type-Aware Testing Procedures

`verify` MUST adapt its testing tools, commands, and pass/fail criteria to the task domain. **Do not invent test procedures from scratch** — research established tools and best practices from the internet for the specific domain before designing tests.

## Domain-Specific Testing Procedures

| Task Type | Quick Checkpoint | Full Checkpoint | Key Tools & Commands |
|-----------|-----------------|-----------------|----------------------|
| `software` | Build pass, lint clean, type check pass | Unit tests, integration tests, E2E tests, coverage ≥ threshold | `npm test`, `pytest`, `jest`, `cargo test`, `go test`, `tsc --noEmit`, `eslint`, `clippy` |
| `image-processing` | File format valid, dimensions correct, no corruption | SSIM/PSNR against reference images, color space validation, metadata integrity, batch consistency | `imagemagick compare`, `ffprobe`, `python PIL/skimage.metrics`, `exiftool` |
| `video-production` | Output file playable, codec correct, duration matches | Frame-accurate diff, audio sync verification, color space compliance, bitrate within spec | `ffprobe`, `ffmpeg -vstats`, `mediainfo`, `melt`, frame-by-frame extraction + SSIM |
| `dsp` | Build/compile pass, signal generation runs | SNR ≥ threshold, frequency response within tolerance, THD ≤ limit, golden reference correlation ≥ 0.99 | `scipy.signal`, `sox --stats`, `octave`, `numpy.fft`, `audacity` (CLI export) |
| `data-pipeline` | Schema validation pass, sample rows parsed | Row count reconciliation, checksum match, referential integrity, idempotency test (run twice → same result) | `csvkit`, `jq`, `psql/mysql`, `dbt test`, `great_expectations`, `pandas` assertions |
| `infrastructure` | Config syntax valid, dry-run pass | Health check endpoints 200, connectivity tests, rollback + re-deploy, idempotency (apply twice → no diff) | `terraform plan/validate`, `docker compose config`, `ansible --check`, `curl`, `nc`, `systemctl status` |
| `documentation` | Markdown renders, no broken links | Completeness checklist pass, spell check, terminology consistency, link validation, formatting rules | `markdownlint`, `cspell`, `lychee` (link checker), `vale`, `textlint` |
| `ml` | Training script runs, model loads | Accuracy/F1/loss meet baseline, cross-validation stable, data distribution check, inference latency ≤ SLA | `pytest`, `mlflow`, `tensorboard`, `sklearn.metrics`, `torch.testing`, custom benchmark scripts |
| `literary` | Word count within target range, no encoding issues | Narrative arc completeness, character consistency across chapters, style guide adherence, pacing analysis | Manual checklist + automated: `proselint`, `vale` (custom style), `wc`, diff against outline |
| `screenwriting` | Fountain/FDX format valid, scene count matches outline | Industry format compliance, scene heading format, dialogue balance, continuity notes cross-check | `afterwriting` (Fountain linter), `fountain-js`, custom format validators, page count check |
| `science:*` | Code/simulation runs, produces output | Results reproducible (fixed seed → same output), statistical significance (p < threshold), numerical results match literature within tolerance | `pytest`, `jupyter nbconvert --execute`, `R CMD check`, `scipy.stats`, custom reproducibility scripts |
| `mechatronics` | Firmware compiles, simulation runs | Control stability (gain/phase margins), timing constraints met, sensor readings within calibration tolerance, safety shutdown triggers correctly | `platformio test`, `simulink`, `ltspice`, `gcc -Wall -Werror`, logic analyzer traces, custom test harness |
| `ai-skill` | Skill loads, frontmatter parses, no syntax errors | Invocation produces expected output, trigger conditions accurate, progressive disclosure works, edge cases handled | Skill invocation test scripts, prompt output diff, frontmatter schema validator, manual trigger testing |
| `chip-design` | RTL lint clean, simulation compiles | Functional simulation all-pass, coverage targets (line ≥ 95%, toggle ≥ 90%, FSM 100%), formal properties proven, synthesis timing closure (no violations), CDC clean | `iverilog`/`verilator` (OSS), `vcs`/`xcelium` (commercial), `yosys` (synthesis), `opensta`, `spyglass`/`ascent` (lint), `jaspergold` (formal) |

## Checkpoint Scope Guidelines

### quick
- **Purpose**: fast feedback during execution, catch obvious breakage
- **Time budget**: < 30 seconds
- **What to run**: build, lint, type check, format validation — no slow tests
- **When**: during `exec` per-step verification, or before `check(mid-exec)`

### full
- **Purpose**: comprehensive verification before decision gates
- **Time budget**: no strict limit, run everything
- **What to run**: all `.test/` criteria, acceptance tests from `.target.md`, regression tests, coverage measurement
- **When**: before `check(post-plan)` (plan quality verification), before `check(post-exec)` (completion verification)

### step-N
- **Purpose**: targeted verification of a specific plan step
- **Time budget**: proportional to step scope
- **What to run**: only criteria from `.test/` associated with step N
- **When**: during `exec` for critical steps that need isolated verification

## Requirements

1. **Research before testing**: Use shell commands (`curl`, `npm info`, web search, `pip show`) to find established testing frameworks and best practices for the identified domain. Do not rely solely on internal knowledge
2. **Domain-appropriate tools**: Use tools that practitioners in the domain actually use — not generic substitutes
3. **Concrete thresholds**: Every test criterion must have a measurable pass/fail threshold (numbers, exit codes, diff outputs) — no vague "looks good" assessments
4. **No mental math**: When verification involves numerical comparisons (metrics, performance, tolerances), write a script and run it in shell. Never compute mentally
5. **Evidence capture**: Save raw command output, metrics, and diffs to `.test/` result files for `check` to reference
6. **Reproducibility**: Tests must be deterministic or use fixed seeds. Document any environment dependencies

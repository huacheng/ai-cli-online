# Task-Type-Aware Verification

Test and verification plans MUST be designed based on the task's domain type, combined with industry best practices from the internet. **Do not invent test methods from scratch** — research established approaches for the specific domain.

## Determination

Read the `type` field from `.index.md` (set by `plan` during generation). If `type` is empty (legacy or pre-plan task), analyze `.target.md` content to identify the domain and flag NEEDS_REVISION requesting that `plan` set the type. Common categories (non-exhaustive):

| Task Domain | Example Indicators | Verification Approach |
|-------------|-------------------|----------------------|
| **Programming / Software** | Code, API, database, UI | Unit tests, integration tests, linting, type checking, build verification |
| **Image Processing** | Image, render, thumbnail, filter | Visual diff (SSIM/PSNR), reference image comparison, format validation, metadata checks |
| **Video Production** | Video editing, compositing, VFX, motion | Frame-accurate comparison, codec validation, timeline continuity checks, render output verification |
| **Digital Signal Processing** | Audio, FFT, filter, spectrum, waveform | SNR measurement, frequency response verification, golden reference comparison |
| **Data Pipeline / ETL** | Transform, migrate, import, export, CSV | Row count validation, schema conformance, data integrity checksums, sample verification |
| **Infrastructure / DevOps** | Deploy, provision, CI/CD, container | Health checks, connectivity tests, rollback verification, idempotency tests |
| **Documentation / Content** | Docs, README, translation, writing | Completeness checklist, link validation, spell check, formatting consistency |
| **Machine Learning** | Model, training, accuracy, dataset | Metric benchmarks (accuracy/F1/loss), cross-validation, data distribution checks |
| **Literary Writing** | Fiction, poetry, creative writing, essay | Structural completeness, narrative consistency, style guide adherence, character/plot continuity |
| **Screenwriting** | Film/TV script, storyboard, dialogue | Script format compliance (industry standard), scene structure, dialogue flow, continuity checks |
| **Science (physics/chemistry/biology/medicine/math/econ)** | Research, experiment, simulation, paper | Reproducibility verification, statistical significance, peer methodology comparison, citation validity, numerical result cross-check |
| **Mechatronics / Control** | Embedded, PLC, robotics, motor, PID | Control stability analysis, hardware-in-loop simulation, timing constraints, safety margin verification |
| **AI Skill / Plugin** | Skill, plugin, agent, prompt, MCP | Skill invocation testing, prompt quality review, frontmatter validation, trigger accuracy, progressive disclosure compliance |

## Requirements

1. **Research before designing**: Use shell commands (`curl`, `npm info`, web search) to find established testing frameworks and best practices for the identified domain. Do not rely solely on internal knowledge
2. **Domain-appropriate tools**: Select verification tools that are standard in the domain (e.g., `pytest` for Python, `jest` for JS, `SSIM` for image quality, `sox` for audio analysis)
3. **Measurable criteria**: Every test criterion must have a concrete pass/fail threshold — no vague "looks good" assessments
4. **NEEDS_REVISION if mismatched**: If `.test/` criteria use inappropriate methods for the task type (e.g., unit tests for an image processing task with no visual validation), verdict is NEEDS_REVISION with specific guidance on correct approach

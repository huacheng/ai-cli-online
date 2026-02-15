# Seed Type Registry

Predefined task types used to initialize `AiTasks/.type-registry.md`. This table is the **seed** — `research` auto-expands the registry by discovering new types from `.target.md` + web research.

> **This file is for human maintenance.** When new domain types are commonly needed, add them here. The runtime registry (`AiTasks/.type-registry.md`) grows automatically via `research` — this seed file only affects initial registry creation.

## Predefined Types

| Type | Description | Methodology |
|------|-------------|-------------|
| `software` | Programming, API, database, UI development | Unit/integration tests, CI, code review |
| `image-processing` | Image/video manipulation, rendering, visual | SSIM/PSNR metrics, visual diff, perceptual quality |
| `video-production` | Video editing, compositing, VFX, motion graphics | Frame analysis, render quality, timeline verification |
| `dsp` | Digital signal processing, audio, frequency analysis | SNR, THD, spectral analysis, listening tests |
| `data-pipeline` | Data transformation, ETL, migration | Schema validation, row counts, data integrity |
| `infrastructure` | DevOps, deployment, CI/CD, containers | Health checks, smoke tests, rollback verification |
| `documentation` | Docs, README, translation, content | Prose linting, link validation, reading level |
| `ml` | Machine learning, model training, datasets | Accuracy/F1, cross-validation, data split integrity |
| `literary` | Fiction, poetry, creative writing, essays | Style analysis, consistency checks, readability |
| `screenwriting` | Film/TV scripts, storyboards, dialogue | Format compliance, scene structure, dialogue flow |
| `science:physics` | Physics research and simulation | Dimensional analysis, conservation laws, numerical stability |
| `science:chemistry` | Chemical research, molecular modeling | Stoichiometry, thermodynamics, safety constraints |
| `science:biology` | Biological research, bioinformatics | Statistical significance, reproducibility, sequence integrity |
| `science:medicine` | Medical/pharmaceutical research | Clinical standards, dosing calculations, regulatory compliance |
| `science:math` | Mathematics, statistics, formal proofs | Proof verification, numerical precision, convergence |
| `science:econ` | Economics, quantitative finance | Econometric validation, backtesting, risk metrics |
| `mechatronics` | Embedded systems, robotics, PLC, control systems | Hardware-in-loop, timing analysis, safety interlocks |
| `ai-skill` | AI skill/plugin/agent/prompt development | Prompt testing, edge cases, context window efficiency |
| `chip-design` | IC/FPGA/ASIC design, RTL development, verification | Simulation, formal verification, STA, DRC/LVS |

## Naming Conventions

- Lowercase kebab-case: `data-pipeline`, `image-processing`
- Science subtypes use colon separator following [arXiv taxonomy](https://arxiv.org/category_taxonomy): `science:physics`, `science:neuro`
- Custom types discovered by research follow the same conventions

## How This File Is Used

1. **`init`** reads this file when creating `AiTasks/.type-registry.md` for the first time (if registry doesn't exist)
2. **`research`** reads the runtime registry `AiTasks/.type-registry.md` (not this file) for type matching
3. New types discovered by `research` are appended to the runtime registry, NOT this file
4. Maintainers update this file to add commonly needed seed types for new projects

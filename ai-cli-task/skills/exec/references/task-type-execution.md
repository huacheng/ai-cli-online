# Task-Type-Aware Execution

Execution strategy MUST adapt to the task domain. Different domains use fundamentally different tools, verification methods, and workflows.

## Determination

Read the `type` field from `.index.json` (set by `plan` during generation). Apply domain-appropriate implementation and verification methods for each step.

## Domain-Specific Implementation Methods

| Task Type | Implementation Approach |
|-----------|------------------------|
| `software` | Edit source code, run build systems, check types/linting |
| `image-processing` | Invoke image processing tools (ImageMagick, ffmpeg, PIL, etc.), generate/compare visual outputs |
| `video-production` | Operate video editing tools (ffmpeg, DaVinci Resolve CLI, melt/MLT, etc.), assemble timelines, apply effects |
| `dsp` | Run signal processing tools (scipy, sox, MATLAB/Octave, etc.), generate/measure signals |
| `data-pipeline` | Execute transform scripts, validate schemas, verify data integrity |
| `infrastructure` | Run provisioning tools (terraform, docker, ansible, etc.), verify connectivity |
| `documentation` | Write/edit content, validate links, check formatting |
| `ml` | Prepare datasets, run training scripts, evaluate metrics |
| `literary` | Draft/revise text, maintain character/plot notes, apply style guidelines |
| `screenwriting` | Write scenes in industry format (Fountain/Final Draft), maintain continuity notes |
| `science:*` | Run experiments/simulations, collect data, perform statistical analysis, write up findings |
| `mechatronics` | Write firmware/control code, run simulations (Simulink, LTspice, etc.), verify timing and stability |
| `ai-skill` | Write SKILL.md/frontmatter, design prompts/agents, configure hooks/MCP servers, test invocations |
| `chip-design` | Write RTL (Verilog/SystemVerilog/VHDL), build testbenches, run simulation (iverilog/VCS/Xcelium/Verilator), synthesize (Yosys/DC), run STA, generate netlists/bitstreams |

## Domain-Specific Verification Methods

| Task Type | Verification Approach |
|-----------|----------------------|
| `software` | `lsp_diagnostics`, build check, unit/integration tests |
| `image-processing` | Visual diff (SSIM/PSNR), reference image comparison, metadata validation |
| `video-production` | Frame-accurate comparison, codec validation, timeline continuity, render output verification |
| `dsp` | SNR measurement, frequency response verification, golden reference comparison |
| `data-pipeline` | Row count validation, schema conformance, checksum verification |
| `infrastructure` | Health checks, connectivity tests, idempotency verification |
| `documentation` | Completeness checklist, link validation, spell check |
| `ml` | Metric benchmarks against baseline, data distribution checks |
| `literary` | Narrative consistency check, structural completeness, style coherence review |
| `screenwriting` | Format compliance, scene structure validation, dialogue flow, continuity checks |
| `science:*` | Reproducibility verification, statistical significance, numerical cross-check against literature |
| `mechatronics` | Control stability analysis (Bode/Nyquist), timing constraint verification, safety margin checks |
| `ai-skill` | Skill invocation test, prompt output review, frontmatter schema validation, trigger condition testing |
| `chip-design` | RTL lint pass, functional simulation pass (all testcases), code coverage targets met, synthesis timing closure (no violations), formal property proofs, CDC clean |

## Requirements

1. **Research before executing**: Use shell commands to find established tools and workflows standard in the determined domain
2. **Domain-appropriate tools**: Use tools that practitioners in the domain actually use (not generic substitutes)
3. **Measurable verification**: Each step's verification must have concrete pass/fail criteria from `.test/` criteria files
4. **Evidence-based**: When uncertain about tools, APIs, or compatibility, verify via shell commands before implementing

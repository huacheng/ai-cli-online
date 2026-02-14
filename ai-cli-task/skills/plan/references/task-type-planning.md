# Task-Type-Aware Planning

Plan generation MUST adapt its methodology to the task domain. Different domains require fundamentally different approaches to design, implementation strategy, and verification.

## Type Determination

Analyze `.target.md` to classify the task domain. Write the determined type to `.index.md` `type` field. See `commands/ai-cli-task.md` Type Field section for canonical type values.

## Domain-Specific Planning Guidelines

| Task Type | Plan Structure | Key Considerations |
|-----------|---------------|-------------------|
| `software` | Architecture → components → interfaces → implementation steps | Design patterns, API contracts, type safety, test coverage, dependency management |
| `image-processing` | Pipeline design → stage parameters → quality metrics → validation | Color space handling, format compatibility, reference images, visual quality thresholds (SSIM/PSNR) |
| `video-production` | Timeline → sequence assembly → effects chain → render settings → output validation | Codec selection, frame rate consistency, color grading pipeline, audio sync, format compliance |
| `dsp` | Signal flow → algorithm selection → parameter tuning → measurement | Sample rates, frequency response specs, SNR requirements, golden reference signals |
| `data-pipeline` | Schema mapping → transform logic → validation rules → rollback plan | Data integrity, idempotency, schema versioning, row count reconciliation |
| `infrastructure` | Topology → provisioning → configuration → health checks | Rollback strategy, idempotency, secret management, connectivity verification |
| `documentation` | Outline → content structure → cross-references → review criteria | Completeness, link validity, terminology consistency, audience appropriateness |
| `ml` | Data preparation → model architecture → training strategy → evaluation metrics | Dataset splits, baseline benchmarks, metric thresholds (accuracy/F1/loss), reproducibility |
| `literary` | Theme/premise → structure/outline → character design → scene drafting → revision | Narrative arc, voice consistency, character development, pacing, stylistic coherence |
| `screenwriting` | Logline → treatment → beat sheet → scene breakdown → draft | Industry format (Final Draft/Fountain), three-act structure, dialogue rhythm, visual storytelling |
| `science:*` | Literature review → hypothesis → methodology → experiment/simulation → analysis → conclusions | Reproducibility, statistical rigor, peer methodology alignment, citation of prior art, numerical validation |
| `mechatronics` | System architecture → hardware/software partitioning → control design → integration → testing | Timing constraints, safety margins, control stability (Bode/Nyquist), sensor calibration, fail-safe design |
| `ai-skill` | Skill specification → prompt/agent design → tool integration → invocation testing → documentation | Prompt quality, progressive disclosure, frontmatter schema, trigger conditions, skill-creator guidelines compliance |

## Requirements

1. **Research before planning**: Use shell commands to find established methodologies, frameworks, and tools standard in the determined domain
2. **Domain-appropriate tools**: Plan should reference tools that practitioners in the domain actually use (not generic substitutes)
3. **Measurable milestones**: Each plan step must have concrete, domain-appropriate success criteria
4. **Test criteria alignment**: `.test/` criteria files must use verification methods standard in the domain (see `check/references/task-type-verification.md`)

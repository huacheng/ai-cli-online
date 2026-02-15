# Task-Type-Aware Intelligence Collection

Research MUST adapt its collection direction based on both the **task domain** and the **calling lifecycle phase**. Different phases need fundamentally different types of intelligence, and different domains have different authoritative sources.

## Phase × Domain Intelligence Matrix

### plan phase — "How to design it"

| Task Type | Collection Direction | Key Sources |
|-----------|---------------------|-------------|
| `software` | Architecture patterns, API contracts, dependency compatibility, design trade-offs | Official docs, GitHub repos, npm/PyPI package info, changelog/migration guides |
| `image-processing` | Pipeline architecture, color space theory, format specs, quality metrics | ImageMagick/ffmpeg docs, ICC spec, image format RFCs, academic papers on SSIM/PSNR |
| `video-production` | Timeline architecture, codec selection, color science, industry workflows | ffmpeg wiki, DaVinci Resolve docs, broadcast standards (ITU-R BT.709/2020), NAB best practices |
| `dsp` | Algorithm selection, filter design theory, sampling constraints, numerical stability | DSP textbooks (Oppenheim, Proakis), scipy.signal docs, MATLAB references, IEEE signal processing |
| `data-pipeline` | Schema design, ETL patterns, idempotency strategies, data governance rules | Apache Airflow/dbt docs, data engineering blogs, schema registry specs, GDPR/compliance guides |
| `infrastructure` | Architecture topology, service discovery, scaling strategies, security baselines | Cloud provider docs (AWS/GCP/Azure), Terraform registry, CIS benchmarks, 12-factor app methodology |
| `documentation` | Content architecture, style guides, terminology standards, audience analysis | Google/Microsoft style guides, Divio documentation system, i18n best practices, accessibility (WCAG) |
| `ml` | Model architecture options, dataset preparation strategies, training methodologies, SOTA benchmarks | arXiv papers, HuggingFace model cards, Papers With Code leaderboards, framework docs (PyTorch/TF) |
| `literary` | Genre conventions, narrative structure theory, character development frameworks | Writer's Digest, Save the Cat, Story Grid, genre-specific style guides, literary criticism |
| `screenwriting` | Industry format standards, story structure, production constraints | Final Draft/Fountain spec, Syd Field's paradigm, production company formatting guides |
| `science:*` | Literature review, methodology standards, prior art, statistical frameworks | arXiv, PubMed, Google Scholar, domain journals, reproducibility guidelines (CONSORT/PRISMA) |
| `mechatronics` | System architecture, control theory, component datasheets, safety standards | Component datasheets, IEC 61131/61508, control textbooks (Ogata, Nise), platform docs (Arduino/STM32) |
| `ai-skill` | Skill design patterns, Claude Code plugin API, prompt engineering techniques | Claude docs, skill-creator guidelines, MCP spec, prompt engineering papers |
| `chip-design` | Architecture specs, HDL coding standards, IP block documentation, process node constraints | IEEE 1364/1800 (Verilog/SV), vendor PDKs, Synopsys/Cadence tool docs, FPGA vendor guides (Xilinx/Intel) |

### verify phase — "How to test it"

| Task Type | Collection Direction | Key Sources |
|-----------|---------------------|-------------|
| `software` | Testing frameworks, coverage tools, CI integration, mutation testing | Jest/pytest/vitest docs, coverage.py, Istanbul, Stryker, framework-specific testing guides |
| `image-processing` | Visual quality metrics, reference image generation, perceptual testing | SSIM/PSNR libraries, OpenCV test utilities, ICC profile validators, exiftool |
| `video-production` | Frame comparison tools, codec compliance testing, broadcast QC | ffmpeg/ffprobe test patterns, QC tools (Vidchecker, Baton), EBU test sequences |
| `dsp` | Signal analysis tools, measurement automation, golden reference comparison | sox, scipy.signal testing, Audio Precision docs, PESQ/POLQA standards |
| `data-pipeline` | Data validation frameworks, schema testing, statistical profiling | Great Expectations, dbt tests, Pandera, Apache Griffin, data profiling tools |
| `infrastructure` | Infrastructure testing, compliance scanning, chaos engineering | Terratest, InSpec, Checkov, Goss, Chaos Monkey, container scanning (Trivy) |
| `documentation` | Link checkers, spell checkers, readability analysis, accessibility testing | Lychee, cspell, Vale, Hemingway, axe-core, markdownlint |
| `ml` | Model evaluation metrics, fairness testing, robustness testing | sklearn.metrics, Fairlearn, ART (adversarial robustness), MLflow evaluation |
| `literary` | Editorial checklists, consistency checking, readability scoring | ProWritingAid, Grammarly API, Flesch-Kincaid, custom continuity checkers |
| `screenwriting` | Format validators, continuity checkers, script analysis | afterwriting, Fountain.js, script coverage services, industry format specs |
| `science:*` | Statistical tests, reproducibility frameworks, numerical validation | scipy.stats, R testing packages, Jupyter nbconvert --execute, numerical tolerance frameworks |
| `mechatronics` | Hardware-in-loop test rigs, simulation validation, safety compliance | MATLAB/Simulink test harness, HIL tools, IEC 61508 test procedures, JTAG debug tools |
| `ai-skill` | Skill invocation testing, prompt evaluation frameworks, regression suites | Claude API testing, prompt evaluation tools, A/B testing frameworks |
| `chip-design` | Simulation testbench patterns, coverage closure, formal property libraries | UVM methodology, SVA assertion libraries, coverage-driven verification guides, EDA tool regression suites |

### check phase — "How to evaluate it"

| Task Type | Collection Direction | Key Sources |
|-----------|---------------------|-------------|
| `software` | Code quality standards, industry benchmarks, security audit checklists | OWASP, SonarQube rules, Google/Airbnb style guides, CERT coding standards |
| `image-processing` | Visual quality standards, format compliance specs, industry acceptance criteria | ICC standards, image format specs (JPEG/PNG/WebP), broadcast color standards |
| `video-production` | Broadcast standards, delivery specs, QC acceptance criteria | ITU-R recommendations, Netflix/YouTube delivery specs, EBU R128 (loudness) |
| `dsp` | Signal quality standards, regulatory compliance, performance benchmarks | ITU-T standards, FCC emission limits, audio codec quality benchmarks (MUSHRA) |
| `data-pipeline` | Data quality dimensions, SLA definitions, compliance requirements | DAMA-DMBOK, data quality frameworks, industry-specific compliance (HIPAA/SOX/GDPR) |
| `infrastructure` | Security baselines, compliance frameworks, SLA benchmarks | CIS benchmarks, SOC 2 controls, cloud well-architected frameworks, SRE golden signals |
| `documentation` | Documentation quality standards, completeness criteria | Divio quality criteria, API documentation best practices, accessibility standards |
| `ml` | Model performance baselines, fairness criteria, deployment readiness | MLOps maturity model, responsible AI frameworks, model card standards |
| `literary` | Editorial standards, genre expectations, publication requirements | Publishing house style guides, genre conventions, beta reader feedback criteria |
| `screenwriting` | Industry format standards, story structure quality, production feasibility | WGA standards, coverage service criteria, production budget constraints |
| `science:*` | Peer review criteria, statistical rigor standards, reproducibility requirements | Journal submission guidelines, CONSORT/STROBE checklists, p-value/CI standards |
| `mechatronics` | Safety standards, certification requirements, performance specifications | IEC 61508 SIL levels, CE marking requirements, MIL-STD reliability standards |
| `ai-skill` | Skill quality criteria, user experience standards, integration requirements | Claude Code skill guidelines, UX heuristics for conversational AI |
| `chip-design` | Design rule compliance, timing/power/area targets, silicon qualification criteria | Foundry design rules, signoff criteria (DRC/LVS/ERC), automotive/mil qualification (AEC-Q100) |

### exec phase — "How to implement it"

| Task Type | Collection Direction | Key Sources |
|-----------|---------------------|-------------|
| `software` | API documentation, library usage patterns, migration guides, debugging techniques | Official docs, Stack Overflow (verified), GitHub issues, changelog, source code |
| `image-processing` | Tool CLI syntax, API reference, format conversion recipes, optimization techniques | ImageMagick/ffmpeg CLI docs, PIL/OpenCV API, format-specific encoding guides |
| `video-production` | NLE tool operations, effects recipes, render settings, encoding profiles | ffmpeg cookbook, DaVinci Resolve manual, codec encoding guides (x264/x265/AV1) |
| `dsp` | Algorithm implementation guides, numerical recipes, library API reference | scipy/numpy API, MATLAB function reference, DSP implementation cookbooks |
| `data-pipeline` | SQL patterns, ETL tool recipes, connector configurations, performance tuning | Database docs, dbt macros, Airflow operator reference, query optimization guides |
| `infrastructure` | Terraform/Ansible module reference, CLI tools, troubleshooting runbooks | Provider docs, module registries, tool man pages, operations runbooks |
| `documentation` | Markup syntax, template systems, publishing tool chains | Markdown/AsciiDoc specs, static site generator docs, PDF/EPUB toolchain guides |
| `ml` | Framework API reference, training recipes, hyperparameter tuning guides | PyTorch/TF tutorials, HuggingFace Trainer docs, Optuna/Ray Tune guides |
| `literary` | Writing craft techniques, genre-specific conventions, revision strategies | Craft books, genre writing guides, editing technique references |
| `screenwriting` | Fountain/FDX syntax, scene writing techniques, production annotation formats | Fountain spec, screenwriting software docs, production notation standards |
| `science:*` | Simulation tool reference, data analysis recipes, visualization techniques | Tool documentation, Jupyter/R notebooks, plotting library guides (matplotlib/ggplot2) |
| `mechatronics` | MCU register reference, peripheral drivers, communication protocol specs | Datasheet register maps, HAL/LL driver docs, protocol specs (I2C/SPI/CAN/UART) |
| `ai-skill` | Claude API reference, MCP protocol spec, prompt engineering patterns | Anthropic docs, MCP SDK reference, skill file format specification |
| `chip-design` | EDA tool command reference, HDL coding recipes, IP integration guides | Synopsys/Cadence/Mentor tool manuals, vendor IP user guides, HDL coding style guides |

## Collection Priority by Phase

| Phase | Priority Order |
|-------|---------------|
| plan | 1. Architecture/design patterns → 2. Dependency/compatibility info → 3. Trade-off analysis → 4. Prior art |
| verify | 1. Testing frameworks/tools → 2. Pass/fail criteria standards → 3. Coverage measurement → 4. Regression strategies |
| check | 1. Industry quality standards → 2. Acceptance benchmarks → 3. Compliance requirements → 4. Peer evaluation criteria |
| exec | 1. API/tool reference docs → 2. Implementation recipes → 3. Debugging techniques → 4. Performance optimization |

## Requirements

1. **Phase-aware collection**: Always check the `--caller` parameter to focus research on the calling phase's needs. Do not collect plan-phase intelligence when called from verify
2. **Domain-appropriate sources**: Prioritize official documentation, standards bodies, and established references over blog posts or forum answers
3. **Actionable output**: Each reference file must contain concrete, usable information (API signatures, command examples, threshold values) — not abstract overviews
4. **Freshness**: When tools have multiple versions, research the version actually used in the project (check `package.json`, `Cargo.toml`, `requirements.txt`, etc.)
5. **Gap-aware**: During `--scope gap`, compare existing `.references/` content against the calling phase's needs matrix above. Only collect topics that are actually missing

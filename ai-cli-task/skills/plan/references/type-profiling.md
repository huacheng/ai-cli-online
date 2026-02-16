# Dynamic Type Profiling

## Table of Contents

- [Core Principles](#core-principles)
- [Type Format in .index.json](#type-format-in-indexjson)
- [Type Determination Flow](#type-determination-flow)
- [Auto-Expanding Type Registry](#auto-expanding-type-registry)
- [Hybrid Type System](#hybrid-type-system)
- [.type-profile.md Structure](#type-profilemd-structure)
- [Shared Type Profiles](#shared-type-profiles)
- [Refinement Across Phases](#refinement-across-phases)
- [research's Role in Type Discovery](#researchs-role-in-type-discovery)
- [Integration with Lifecycle Phases](#integration-with-lifecycle-phases)

Task type is NOT a one-shot decision. It is a **continuously refined classification** that evolves through research, planning, and execution. Types are **auto-discovered** from `.target.md` analysis and web research — no user input required at `init` time.

## Core Principles

1. **Type is a hypothesis, not a label** — every type assignment starts as a hypothesis that must be validated by research
2. **Fully automatic discovery** — `init` does not accept a `--type` argument; type is determined by `research` during the first `plan` phase, based on `.target.md` content + web research
3. **Hybrid types are first-class** — many real tasks span multiple domains; represented as `A|B` pipe-separated format (e.g., `data-pipeline|ml`)
4. **Auto-expanding type registry** — when research discovers a domain not in the predefined table, it registers the new type in `AiTasks/.type-registry.md` automatically. The predefined table is a seed, not a ceiling
5. **Progressive refinement** — type confidence grows across phases: target analysis → research → plan → verify/check/exec feedback

## Type Format in `.index.json`

The `type` field uses a simple string with pipe separator for hybrids:

| Pattern | Example | Meaning |
|---------|---------|---------|
| `<type>` | `software` | Single domain |
| `<A>\|<B>` | `data-pipeline\|ml` | Hybrid — A is primary, B is secondary |
| `<A>\|<B>\|<C>` | `software\|infrastructure\|dsp` | Multi-hybrid — first is primary, rest are secondary (rare) |

**Validation regex**: Each segment must match `[a-zA-Z0-9_:-]+`. Full type field: `[a-zA-Z0-9_:|-]+` (pipe allowed as separator). Parsing: `type.split('|')` → `[0]` is primary, `[1:]` are secondary.

**Experiences mapping**: For hybrid type `A|B`, `report` writes to **both** `AiTasks/.experiences/A/<module>.md` and `AiTasks/.experiences/B/<module>.md`, updating per-type `.summary.md` in each directory. Plan reads `.summary.md` for all segments, drilling into individual entries when relevant.

## Type Determination Flow

```
                    ┌──────────────────────────────────────────┐
                    │         .target.md analysis               │
                    │  (no user-specified type — auto only)     │
                    └──────────────┬───────────────────────────┘
                                   │
                    ┌──────────────▼───────────────────────────┐
                    │         research (--caller plan)          │
                    │  • Web search domain keywords             │
                    │  • Identify field, methodology, tools     │
                    │  • Compare against type registry + seed   │
                    │  • Detect hybrid indicators               │
                    │  • Register new types if needed           │
                    └──────────────┬───────────────────────────┘
                                   │
                    ┌──────────────▼───────────────────────────┐
                    │         Type classification               │
                    │                                           │
                    │  ├─ Single known type match               │
                    │  │  → type: "software"                    │
                    │  │  confidence: high                      │
                    │  │                                        │
                    │  ├─ Hybrid of 2+ types                    │
                    │  │  → type: "data-pipeline|ml"            │
                    │  │  confidence: medium → high after plan  │
                    │  │                                        │
                    │  └─ New type (not in registry)            │
                    │     → register in .type-registry.md       │
                    │     → type: "quantum-computing"           │
                    │     confidence: low → medium → high       │
                    └──────────────┬───────────────────────────┘
                                   │
                    ┌──────────────▼───────────────────────────┐
                    │     Write .type-profile.md                │
                    │     Write type to .index.json             │
                    │     Update .type-registry.md (if new)     │
                    └──────────────────────────────────────────┘
                                   │
              ┌────────────────────┼────────────────────┐
              ▼                    ▼                     ▼
         verify/check            exec               re-plan
         May update profile   May update profile   May reclassify
         if standards wrong   if patterns wrong    if nature changed
```

## Auto-Expanding Type Registry

### Location

`AiTasks/.type-registry.md` — shared across all tasks, auto-maintained by `research`.

### Format

```markdown
# Type Registry

Auto-maintained by research. Predefined seed types + dynamically discovered types.

| Type | Description | Discovered | Source Task |
|------|-------------|------------|-------------|
| software | Programming, API, database, UI development | (seed) | — |
| dsp | Digital signal processing, audio, frequency analysis | (seed) | — |
| data-pipeline | Data transformation, ETL, migration | (seed) | — |
| quantum-computing | Quantum circuit design and simulation | 2024-03-15 | quantum-sim |
| game-design | Game mechanics, level design, balancing | 2024-04-02 | rpg-prototype |
```

### Lifecycle

1. **Seed**: `init` creates `.type-registry.md` (if missing) with the predefined types from `commands/ai-cli-task.md` as seed rows
2. **Grow**: When `research` classifies a type not in the registry, it appends a new row with discovery date and source task module name
3. **Read**: `research` reads the registry during type classification to match against known types (both seed and discovered)
4. **Shared**: The registry is a shared resource — types discovered by one task benefit future tasks. No lock needed (append-only, one writer at a time via task `.lock`)

### Why Auto-Expand?

Human-defined type tables have two inherent problems:
- **Lag**: New domains emerge faster than maintainers can update tables
- **Insufficiency**: Maintainers can't anticipate every domain a user might work in

Auto-expansion solves both: research identifies the domain from `.target.md` + web search, registers it if new, and builds a comprehensive `.type-profile.md` immediately. Future tasks in the same domain benefit from the registry entry.

## Hybrid Type System

### Single Type
```
.index.json type: "software"
```
Task clearly belongs to one domain. All phases use that domain's methodology.

### Hybrid Type (pipe-separated)
```
.index.json type: "data-pipeline|ml"
```
Task spans two domains. Primary (`data-pipeline`) drives architecture and workflow; secondary (`ml`) adds specialized verification and implementation concerns.

Example: "Build an ETL pipeline that feeds into ML model training" → `data-pipeline|ml` — the pipeline is the main deliverable (primary), ML training integration needs ML-specific verification (secondary).

### Custom / Novel Type
```
.index.json type: "quantum-computing"
```
Task is in a domain not covered by existing registry types. `research` registers it and builds `.type-profile.md` as the **sole** methodology reference. Profile must be especially thorough.

## .type-profile.md Structure

Every task module gets a `.type-profile.md`. This is the **authoritative** domain methodology source for this specific task, taking precedence over static reference tables.

```markdown
# Type Profile: <type>

## Domain Classification
- **Assigned type**: `<type>` (e.g., `data-pipeline|ml`)
- **Classification**: single | hybrid | custom
- **Primary**: `<type>` (weight: N%)       ← hybrid only
- **Secondary**: `<type>` (weight: N%)     ← hybrid only
- **Nearest known**: `<type>`              ← custom only
- **Confidence**: high | medium | low
- **Rationale**: <why this type was chosen, based on .target.md + research>
- **Refinement log**:
  - <date> research: initial classification based on .target.md + web research
  - <date> verify: updated verification standards after discovering X
  - <date> exec: refined implementation patterns after encountering Y

## Phase Intelligence
<!-- What to research for each lifecycle phase in this domain -->
- **plan**: <collection direction — architecture/design patterns, key sources>
- **verify**: <collection direction — testing frameworks/tools, key sources>
- **check**: <collection direction — quality standards/benchmarks, key sources>
- **exec**: <collection direction — API docs/implementation recipes, key sources>

## Domain Methodology
<!-- How projects in this domain are typically structured and executed -->
- **Design approach**: <architecture/design methodology standard in this domain>
- **Key tools**: <industry-standard tools, frameworks, languages>
- **Workflow**: <typical project lifecycle in this domain>
- **Secondary domain considerations**: <if hybrid, methodology from secondary type>

## Verification Standards
<!-- How quality is measured in this domain -->
- **Testing approach**: <standard testing methodology>
- **Quality metrics**: <measurable criteria with typical thresholds>
- **Acceptance criteria**: <what "done" looks like in this domain>
- **Secondary verification**: <if hybrid, additional criteria from secondary type>

## Implementation Patterns
<!-- How work is typically done in this domain -->
- **Common patterns**: <design/implementation patterns>
- **Known pitfalls**: <frequent mistakes, anti-patterns>
- **Tool chain**: <specific tools and their roles>

## Audit Adaptation
<!-- Domain-specific checkpoints that augment the six-perspective base (see check/references/six-perspective-audit.md) -->
<!-- research populates from seed tables + web research; check/verify/exec refine from experience -->
- **Security**: <+domain-specific security concerns>
- **Architecture**: <+domain-specific structural concerns>
- **Performance**: <+domain-specific efficiency concerns>
- **Extensibility**: <+domain-specific extension concerns>
- **Consistency**: <+domain-specific convention concerns>
- **Correctness**: <+domain-specific verification concerns>

## Sources
<!-- Where this profile information came from -->
- <URL or reference for each claim above>
```

## Shared Type Profiles

### Problem

Per-task `.type-profile.md` is task-specific and non-shared. When task A builds a comprehensive domain profile (verification tools, implementation patterns, phase intelligence), task B with the same type starts from scratch — duplicating the same web searches and methodology discovery. This applies to ALL types: both new types not in static tables and seed types whose static table entries are generic defaults lacking task-derived experience.

### Solution: `AiTasks/.type-profiles/`

A shared directory of type profiles, auto-maintained by `research` and `report` for **all** types (seed and discovered):

```
AiTasks/.type-profiles/
├── quantum-computing.md     # Discovered by task quantum-sim
├── game-design.md           # Discovered by task rpg-prototype
└── bioinformatics.md        # Discovered by task genome-analysis
```

### Write Triggers

| Phase | Trigger | Action |
|-------|---------|--------|
| **research** | Builds or updates `.type-profile.md` for **any** type (seed or discovered) | Copy profile to `AiTasks/.type-profiles/<primary-type>.md` (create or overwrite if confidence is higher). Apply directory-safe transform: replace `:` with `-` in type for filename |
| **report** | Task completes with a refined `.type-profile.md` | Merge refinements back to `AiTasks/.type-profiles/<primary-type>.md` (append refinement log, update sections that changed). Apply directory-safe transform for `:` in type |

**Note**: ALL types sync to shared profiles — including seed types. Over time, shared profiles become richer than static reference tables because they incorporate real task execution experience (tool discoveries, verified patterns, phase-specific intelligence). Static tables remain as initial fallback only.

### Read Priority Chain

When research needs domain intelligence for a type, it checks sources in this order:

```
1. AiTasks/.type-profiles/<type>.md     ← shared profile from prior tasks (most specific; apply directory-safe transform: `:` → `-`)
2. Per-type seed files                   ← init/references/seed-types/<type>.md (factory defaults)
3. Web search from scratch              ← fallback for completely unknown types
```

If `AiTasks/.type-profiles/<type>.md` exists, research reads it as the starting point for `.type-profile.md`, then refines per-task. This eliminates redundant web searches across tasks in the same domain.

### Concurrency

Shared profiles use the same lock protocol: acquire `AiTasks/.type-profiles/.lock` before writing (see Concurrency Protection in `commands/ai-cli-task.md`).

### For Hybrid Types

For type `A|B`, shared profiles are stored by **primary** type: `AiTasks/.type-profiles/A.md`. The profile itself contains secondary domain info in its sections. If `B` also has a standalone profile, research reads both.

## Refinement Across Phases

`.type-profile.md` is a **living document** updated throughout the lifecycle:

| Phase | Reads | May Update | Trigger |
|-------|-------|-----------|---------|
| research | Entire profile (gap detection) | All sections (new domain info) | Always — research is the primary type intelligence source |
| plan | All sections (methodology selection) | Domain Classification, Methodology | Initial creation; re-plan if nature changed |
| verify | Verification Standards | Verification Standards | Testing approach proved inadequate for this domain |
| check | Verification Standards, Quality metrics, Audit Adaptation | Verification Standards, Audit Adaptation | Evaluation criteria or audit checkpoints mismatched domain norms |
| exec | Implementation Patterns, Key tools | Implementation Patterns | Discovered tools/patterns differ from profile |

**Refinement log**: Every update appends to the "Refinement log" in Domain Classification, creating an audit trail of how the type understanding evolved.

## research's Role in Type Discovery

research has **three type-related responsibilities**:

### 1. Type discovery (when called from plan)
- Analyze `.target.md` keywords against type registry (`AiTasks/.type-registry.md`)
- Web search to identify the actual domain field
- Detect hybrid indicators (keywords from multiple domains)
- Classify and write `type` to `.index.json` using `A|B` format for hybrids
- Register new types in `.type-registry.md` if not already known

### 2. Type refinement (when called from any phase)
- Each phase may discover that the current type classification is incomplete
- research collects additional domain info and updates `.type-profile.md`
- Type itself may change (e.g., `software` → `software|infrastructure` hybrid)
- Updated type written back to `.index.json` with pipe format

### 3. Custom type profiling (when no registry type fits)
- Comprehensive web research to build the domain profile from scratch
- Must cover all four profile sections with web-sourced best practices
- Identify the nearest known type(s) for partial methodology reuse
- Register the new type in `.type-registry.md` for future tasks

## Integration with Lifecycle Phases

All phases read `.type-profile.md` as their **first** source of domain methodology:

1. **research** reads entire profile → discovers/validates type, identifies gaps, collects phase-directed intelligence
2. **plan** reads all sections → selects methodology, generates domain-appropriate plan
3. **verify** reads "Verification Standards" → determines what to test and how
4. **check** reads "Verification Standards" + "Quality metrics" + "Audit Adaptation" → sets evaluation criteria and domain-specific audit checkpoints
5. **exec** reads "Implementation Patterns" + "Key tools" → chooses tools and approach

When `.type-profile.md` conflicts with static reference tables, the **profile takes precedence** (it's task-specific and research-informed, while tables are generic defaults).

When type is hybrid (e.g., `data-pipeline|ml`), phases must consider **all** domain segments — e.g., verification for `data-pipeline|ml` must include both data integrity checks AND model metric benchmarks.

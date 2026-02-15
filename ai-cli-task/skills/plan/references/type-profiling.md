# Dynamic Type Profiling

Task type is NOT a one-shot decision. It is a **continuously refined classification** that evolves through research, planning, and execution. User-provided types are treated as initial hints, not gospel — they must be validated and may be corrected.

## Core Principles

1. **Type is a hypothesis, not a label** — every type assignment starts as a hypothesis that must be validated by research
2. **User-specified types are hints** — `init --type X` sets a starting point, but research/plan may discover the actual domain differs
3. **Hybrid types are first-class** — many real tasks span multiple domains; the type system must represent this, not force a single category
4. **Progressive refinement** — type confidence grows across phases: target analysis → research → plan → verify/check/exec feedback

## Type Determination Flow

```
                    ┌──────────────────────────────────────────┐
                    │         .target.md analysis               │
                    │  + user hint (init --type, if provided)   │
                    └──────────────┬───────────────────────────┘
                                   │
                    ┌──────────────▼───────────────────────────┐
                    │         research (--caller plan)          │
                    │  • Web search domain keywords             │
                    │  • Identify field, methodology, tools     │
                    │  • Compare against predefined types       │
                    │  • Detect hybrid indicators               │
                    └──────────────┬───────────────────────────┘
                                   │
                    ┌──────────────▼───────────────────────────┐
                    │         Type classification               │
                    │                                           │
                    │  ├─ Single predefined type match          │
                    │  │  confidence: high                      │
                    │  │                                        │
                    │  ├─ Hybrid of 2+ predefined types         │
                    │  │  primary + secondary, weighted         │
                    │  │  confidence: medium → high after plan  │
                    │  │                                        │
                    │  └─ Custom (no predefined type fits)      │
                    │     research-built profile is sole ref    │
                    │     confidence: low → medium → high       │
                    └──────────────┬───────────────────────────┘
                                   │
                    ┌──────────────▼───────────────────────────┐
                    │     Write .type-profile.md                │
                    │     Write type to .index.json             │
                    └──────────────────────────────────────────┘
                                   │
              ┌────────────────────┼────────────────────┐
              ▼                    ▼                     ▼
         verify/check            exec               re-plan
         May update profile   May update profile   May reclassify
         if standards wrong   if patterns wrong    if nature changed
```

## User-Specified Type Validation

When `init --type X` was used, the user's type is NOT automatically trusted:

| Scenario | Action |
|----------|--------|
| User type matches `.target.md` + research findings | Accept user type, confidence `high` |
| User type partially matches (right general area) | Accept but refine — add specifics to profile, may adjust to sub-type |
| User type contradicts `.target.md` + research | Override user type with research-informed classification. Log reason in profile "Rationale" |
| User type is vague (e.g., `software` for a specialized task) | Refine to more specific type (e.g., `software` → `data-pipeline` if task is clearly ETL) |

research MUST validate user-specified types by checking:
- Do the `.target.md` keywords match the type's typical domain vocabulary?
- Do the referenced tools/technologies belong to this type?
- Does the task workflow match the type's standard lifecycle?

## Hybrid Type System

Many real tasks don't fit a single category. The type system supports three classification levels:

### Level 1: Single Type
```markdown
- **Assigned type**: `software`
- **Classification**: single
- **Confidence**: high
```
Task clearly belongs to one domain. All phases use that domain's methodology.

### Level 2: Primary + Secondary
```markdown
- **Assigned type**: `data-pipeline`
- **Classification**: hybrid
- **Primary**: `data-pipeline` (weight: 70%)
- **Secondary**: `ml` (weight: 30%)
- **Confidence**: medium
```
Task spans two domains. Planning, verification, and execution draw from both — primary domain drives architecture, secondary domain adds specialized concerns. For example: "Build an ETL pipeline that feeds into ML model training" → primary data-pipeline (the pipeline is the main deliverable), secondary ml (training integration needs ML-specific verification).

### Level 3: Custom / Novel
```markdown
- **Assigned type**: `quantum-computing`
- **Classification**: custom
- **Nearest predefined**: `science:physics` (partial match)
- **Confidence**: low → research-dependent
```
Task is in a domain not covered by predefined types. `.type-profile.md` is the **sole** methodology reference. Profile must be especially thorough.

## .type-profile.md Structure

Every task module gets a `.type-profile.md`. This is the **authoritative** domain methodology source for this specific task, taking precedence over static reference tables.

```markdown
# Type Profile: <type>

## Domain Classification
- **Assigned type**: `<type>`
- **Classification**: single | hybrid | custom
- **Primary**: `<type>` (weight: N%)       ← hybrid only
- **Secondary**: `<type>` (weight: N%)     ← hybrid only
- **Nearest predefined**: `<type>`         ← custom only
- **Confidence**: high | medium | low
- **Rationale**: <why this type was chosen, including validation against .target.md>
- **User hint**: `<init --type value>` | (none)  ← for audit trail
- **Refinement log**:
  - <date> plan: initial classification based on .target.md + research
  - <date> verify: updated verification standards after discovering X
  - <date> exec: refined implementation patterns after encountering Y

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

## Sources
<!-- Where this profile information came from -->
- <URL or reference for each claim above>
```

## Refinement Across Phases

`.type-profile.md` is a **living document** updated throughout the lifecycle:

| Phase | Reads | May Update | Trigger |
|-------|-------|-----------|---------|
| research | Entire profile (gap detection) | All sections (new domain info) | Always — research is the primary type intelligence source |
| plan | All sections (methodology selection) | Domain Classification, Methodology | Initial creation; re-plan if nature changed |
| verify | Verification Standards | Verification Standards | Testing approach proved inadequate for this domain |
| check | Verification Standards, Quality metrics | Verification Standards | Evaluation criteria mismatched domain norms |
| exec | Implementation Patterns, Key tools | Implementation Patterns | Discovered tools/patterns differ from profile |

**Refinement log**: Every update appends to the "Refinement log" in Domain Classification, creating an audit trail of how the type understanding evolved.

## research's Role in Type Discovery

research has **three type-related responsibilities**:

### 1. Type validation (when called from plan)
- Compare `.target.md` keywords against predefined type vocabularies
- Web search to identify the actual domain field
- Validate or override user-specified type
- Detect hybrid indicators (keywords from multiple domains)

### 2. Type refinement (when called from any phase)
- Each phase may discover that the current type classification is incomplete
- research collects additional domain info and updates `.type-profile.md`
- Type itself may change (e.g., `software` → `software` + `infrastructure` hybrid)

### 3. Custom type profiling (when no predefined type fits)
- Comprehensive web research to build the domain profile from scratch
- Must cover all four profile sections with web-sourced best practices
- Identify the nearest predefined type(s) for partial methodology reuse

## Integration with Lifecycle Phases

All phases read `.type-profile.md` as their **first** source of domain methodology:

1. **research** reads entire profile → validates type, identifies gaps, collects phase-directed intelligence
2. **plan** reads all sections → selects methodology, generates domain-appropriate plan
3. **verify** reads "Verification Standards" → determines what to test and how
4. **check** reads "Verification Standards" + "Quality metrics" → sets evaluation criteria
5. **exec** reads "Implementation Patterns" + "Key tools" → chooses tools and approach

When `.type-profile.md` conflicts with static reference tables, the **profile takes precedence** (it's task-specific and research-informed, while tables are generic defaults).

When `.type-profile.md` is a hybrid profile, phases must consider **both** primary and secondary domain requirements — e.g., verification for a `data-pipeline + ml` hybrid must include both data integrity checks AND model metric benchmarks.

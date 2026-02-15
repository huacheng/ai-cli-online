# software

## Description

Programming, API, database, UI development

## Methodology

Unit/integration tests, CI, code review

## Phase Intelligence

### plan

- **Collection Direction**: Architecture patterns, API contracts, dependency compatibility, design trade-offs
- **Key Sources**: Official docs, GitHub repos, npm/PyPI package info, changelog/migration guides
- **Plan Structure**: Architecture → components → interfaces → implementation steps
- **Key Considerations**: Design patterns, API contracts, type safety, test coverage, dependency management

### verify

- **Collection Direction**: Testing frameworks, coverage tools, CI integration, mutation testing
- **Key Sources**: Jest/pytest/vitest docs, coverage.py, Istanbul, Stryker, framework-specific testing guides
- **Quick Checkpoint**: Build pass, lint clean, type check pass
- **Full Checkpoint**: Unit tests, integration tests, E2E tests, coverage ≥ threshold
- **Key Tools**: `npm test`, `pytest`, `jest`, `cargo test`, `go test`, `tsc --noEmit`, `eslint`, `clippy`

### check

- **Collection Direction**: Code quality standards, industry benchmarks, security audit checklists
- **Key Sources**: OWASP, SonarQube rules, Google/Airbnb style guides, CERT coding standards
- **Indicators**: Code, API, database, UI
- **Verification Approach**: Unit tests, integration tests, linting, type checking, build verification

### exec

- **Collection Direction**: API documentation, library usage patterns, migration guides, debugging techniques
- **Key Sources**: Official docs, Stack Overflow (verified), GitHub issues, changelog, source code
- **Implementation Approach**: Edit source code, run build systems, check types/linting
- **Step Verification**: `lsp_diagnostics`, build check, unit/integration tests

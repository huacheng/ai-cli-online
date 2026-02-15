# ai-skill

## Description

AI skill/plugin/agent/prompt development

## Methodology

Prompt testing, edge cases, context window efficiency

## Phase Intelligence

### plan

- **Collection Direction**: Skill design patterns, Claude Code plugin API, prompt engineering techniques
- **Key Sources**: Claude docs, skill-creator guidelines, MCP spec, prompt engineering papers
- **Plan Structure**: Skill specification → prompt/agent design → tool integration → invocation testing → documentation
- **Key Considerations**: Prompt quality, progressive disclosure, frontmatter schema, trigger conditions, skill-creator guidelines compliance

### verify

- **Collection Direction**: Skill invocation testing, prompt evaluation frameworks, regression suites
- **Key Sources**: Claude API testing, prompt evaluation tools, A/B testing frameworks
- **Quick Checkpoint**: Skill loads, frontmatter parses, no syntax errors
- **Full Checkpoint**: Invocation produces expected output, trigger conditions accurate, progressive disclosure works, edge cases handled
- **Key Tools**: Skill invocation test scripts, prompt output diff, frontmatter schema validator, manual trigger testing

### check

- **Collection Direction**: Skill quality criteria, user experience standards, integration requirements
- **Key Sources**: Claude Code skill guidelines, UX heuristics for conversational AI
- **Indicators**: Skill, plugin, agent, prompt, MCP
- **Verification Approach**: Skill invocation testing, prompt quality review, frontmatter validation, trigger accuracy, progressive disclosure compliance

### exec

- **Collection Direction**: Claude API reference, MCP protocol spec, prompt engineering patterns
- **Key Sources**: Anthropic docs, MCP SDK reference, skill file format specification
- **Implementation Approach**: Write SKILL.md/frontmatter, design prompts/agents, configure hooks/MCP servers, test invocations
- **Step Verification**: Skill invocation test, prompt output review, frontmatter schema validation, trigger condition testing

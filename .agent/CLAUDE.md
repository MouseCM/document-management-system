# VDT AI Agent Demo — ClaudeKit Edition

Demo project for Viettel Digital Talent 2026: "AI Agent Architecture & Orchestration Patterns"

## Skills → Pattern Mapping

| # | Skill | Pattern | SDLC Phase | Demo |
|---|-------|---------|------------|------|
| 1 | `/vdt:fix` | Single Agent | Bug Fix | Demo 01 |
| 2 | `/vdt:brainstorm` | Multi-Agent | Ideation | Demo 02 |
| 3 | `/vdt:plan` | Sequential | Planning | Demo 03 |
| 4 | `/vdt:cook` | Parallel | Implementation | Demo 04 |
| 5 | `/vdt:loop` | Conditional+Loop | Incident Fix | Demo 05 |
| — | `/vdt:scout` | (internal) | Discovery | — |
| — | `/vdt:git` | (finalize) | Commit | Demo 06 |
| — | `/vdt:docs` | (finalize) | Documentation | Demo 06 |

## Full Lifecycle (Demo 06)

```
/vdt:brainstorm → /vdt:plan → /vdt:cook → /vdt:loop → /vdt:git → /vdt:docs
```

## Agents

Sub-agents that skills delegate to:
- `planner` — Creates implementation plans
- `tester` — Runs test suites, validates
- `code-reviewer` — Reviews code quality
- `debugger` — Investigates root causes
- `docs-manager` — Updates documentation
- `fullstack-developer` — Implements features (parallel mode)
- `git-manager` — Git operations
- `researcher` — Researches solutions

## Project

Express + TypeScript demo app with planted bugs for demonstration.

```bash
npm install     # Install deps
npm test        # Shows planted bug (TypeError in auth)
./reset.sh      # Reset to demo-ready state
```

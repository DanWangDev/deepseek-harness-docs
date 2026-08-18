# Why This Whitepaper

> A systematic analysis of the DeepSeek Harness source code and official documentation. The target reader is a developer who wants to understand, use, and extend this agent harness — from "how is it different from Claude Code" to "how do I write a plugin for it".

## Background: A Rapidly Iterating Developer Preview

DeepSeek Harness is developed by DeepSeek AI and is currently in *developer preview*, iterating rapidly — the official README states plainly: **THERE WILL BE COMPATIBILITY-BREAKING CHANGES**. This means:

* The official documentation (the `docs/` directory) is an accurate projection of the **current state**, but makes no backward-compatibility promise
* On-disk formats (session log, SQLite schema) evolve across versions; old formats are rejected rather than accommodated
* The terminology system is already stable: seam, scope, turn, step, goal, preset… these terms are locked in one by one in the [glossary](https://github.com/deepseek-ai/deepseek-harness/blob/main/docs/glossary.zh.md)

On a project iterating this fast, the most reliable source of knowledge is not blog posts but **the source code itself**: type declarations, package READMEs, and event catalogs. This whitepaper is organized with these as its yardstick.

## Relationship to the Claude Code Whitepaper

The [Claude Code whitepaper](https://ccb.agent-aura.top/docs/introduction/what-is-claude-code) is a reverse engineering of Anthropic's official CLI — decompiling the single-file bundle to resolve runtime behavior. DeepSeek Harness needs no reverse engineering: it is open source, with the source under `packages/`. This whitepaper therefore adopts the same **format** (one-sentence definition, comparison tables, flow diagrams, source-level breakdowns), but its content comes from **forward engineering**:

| Dimension | Claude Code whitepaper | This whitepaper |
|---|---|---|
| Source of knowledge | Decompiled TypeScript bundle | Open-source repository source + official documentation |
| Core subject | `query()` async-generator loop | Cordis plugin tree + agent-loop driver |
| Authority | Reverse-engineered inference, possibly wrong | Source code is the source of truth, verifiable at any time |
| Narrative angle | "Hidden mechanisms" | "A complete map of the public architecture" |

## What Questions This Whitepaper Answers

Organized by reading path, each chapter answers a set of questions:

| Chapter | Questions answered |
|---|---|
| Introduction | What is it? What does the architecture look like? Why is it designed this way? |
| Core mechanisms | How does Cordis work? How does the loop turn? How is the session recorded? How are prompts assembled? How is scope divided? |
| Tool system | How are tools registered, executed, and rendered? What does each of the eight tool families do? |
| Context engineering | How is context compacted? How is the token budget computed? |
| Agent mechanisms | How do presets assemble capabilities? How are goals persisted? How does self-modification work? |
| Extensibility | How do you write a plugin? How do you bridge Claude Code hooks? How does the skill system work? How do you integrate the SDK? |
| Safety | What is the threat model? How do approval and sandboxing guard operations? How does plan mode work? |
| Features and usage | How do you use the Web UI? How do you configure model providers? How are commands and background jobs managed? |
| Internals | How is the repository laid out? What are the runtime invariants? How do identity and telemetry work? |

## Writing Method

1. **Source-first**: every mechanism corresponds to a real type, service key, or event name, with the source path under `packages/` given
2. **Events are facts**: anything model-visible is necessarily persisted as a session event — so "what the system actually did" can be inferred back from `SessionEventMap`
3. **Consistent terminology**: follow the official glossary (seam, scope, turn, step…), invent no new terms
4. **Current state**: describe the shipped reality, not "upcoming" features

## Boundaries and Disclaimer

* This document covers features that are **implemented and shipped**; under `developer preview` individual details may have changed with the latest commits — defer to the source code
* This document is not a mirror of the official documentation but an independently organized analytical read; when you need field-by-field contracts, consult [docs/](https://github.com/deepseek-ai/deepseek-harness/tree/main/docs) and each package README
* The demonstrative `examples/` compositions are outside the scope of this document, but the example code is a good entry point for understanding the minimal usable composition

## How to Read

* Every page opens with a one-sentence definition, followed by tables and diagrams
* Pages are chained via "previous / next"; the left sidebar offers arbitrary navigation
* Code blocks and type names are the only authoritative "anchors" — `grep` these names in the repository to verify any claim

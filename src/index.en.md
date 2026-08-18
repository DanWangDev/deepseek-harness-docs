# DeepSeek Harness Whitepaper

> DeepSeek Harness (`dsh`) is an open-source agent harness developed by DeepSeek AI: an agent runtime platform where **everything is a plugin**, powered by Cordis — covering the full capability stack from LLM adapters, tool execution, and session persistence to the Web UI.

This whitepaper follows the format of the Claude Code reverse-engineering whitepaper: from the architecture overview to the core loop, the tool system, context engineering, the safety model, and internal mechanics, every claim is grounded in source-level facts.

**The core thesis, stated up front**: DeepSeek Harness has no privileged kernel that needs patching — every part of the product (model adapters, the tool registry, the session log, the agent loop itself) is a plugin, and any part can be replaced from configuration. This is the most fundamental architectural difference between it and monolithic agent products such as Claude Code or OpenHands.

## Reading Paths

- New here? Start with [What is DeepSeek Harness](introduction/what-is-deepseek-harness.md), then the [Architecture Overview](introduction/architecture-overview.md).
- To understand the loop itself: start from [The Agentic Loop](core/the-loop.md), alongside [The Session Log](core/session.md) and [Cordis](core/cordis.md).
- To understand the capability boundaries: read [Tool System Design](tools/what-are-tools.md) and the whole [Safety](safety/why-safety-matters.md) group.
- To extend it: read [Plugin Development](extensibility/plugins.md), [Hooks](extensibility/hooks.md), [Skills](extensibility/skills.md), and [SDK and Protocols](extensibility/sdk.md).

## Table of Contents

The sidebar organizes all 36 pages into nine sections. Every page opens with a one-line definition and includes comparison tables, flow diagrams, and source-level breakdowns; pages are chained into a complete reading path with Previous / Next navigation.

## About Accuracy

This whitepaper is compiled directly from the repository source and official docs (`docs/` directory, package READMEs, and type declarations), aiming for the same rigor as "model-visible means logged": every mechanism corresponds to a real type, service key, or event name. The project is iterating rapidly in developer preview, so individual details may drift from the latest code — the source is authoritative.

## Local Browsing

This site is a zero-dependency static site. Double-click `site/index.html` to read it, or deploy it with any static server (see `README.md` at the repository root).

## Switching Language and Theme

Use the buttons in the sidebar (or top-right on the landing page) to switch between **中文 / English** and **dark / light** themes. Your choice is remembered in `localStorage`.

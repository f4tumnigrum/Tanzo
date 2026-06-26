# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-06-26

Initial public release.

### Added

- Local-first agent runtime working on real workspace files and processes, built
  on a layered `AgentService` / `RunEngine` / `TurnLoop` design over the AI SDK
  tool loop.
- Multi-provider AI configuration (Anthropic, OpenAI, Google, DeepSeek, and any
  OpenAI-compatible endpoint) with credentials in the OS secure store.
- Model Context Protocol (MCP) integration exposing server tools to the agent.
- Sandboxed tools: workspace-confined filesystem access with symlink-escape and
  credential-path protection, and shell execution with a stripped environment.
- Approval system with a policy engine, configurable rules, and permission modes,
  including consolidated single-card handling for concurrent tool approvals.
- Context engineering with section/provider model, budgeting, compaction, and
  forking.
- Subprocess hooks compatible with Codex / Claude Code event triggers.
- Architecture reference under `docs/architecture/`.

[Unreleased]: https://github.com/f4tumnigrum/Tanzo/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/f4tumnigrum/Tanzo/releases/tag/v0.1.0

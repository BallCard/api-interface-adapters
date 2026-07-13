# Clean Claude API bridge

## Scope
- This directory contains a minimal local proxy for a Claude-compatible chat interface.
- Keep the bridge thin: no personality injection, no hidden memory, no project-specific prompt rewriting.

## Conventions
- Source files live in `src/`.
- Environment variables hold all secrets and upstream configuration.
- Do not commit API keys or tokens.
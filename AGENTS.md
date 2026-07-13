# api-interface-adapters

## Scope
- This workspace stores reusable local interface bridges and API adapters.
- Each adapter lives in its own directory and should be independently runnable.

## Structure
- One adapter per top-level directory.
- Adapter source code stays inside that adapter directory.
- Shared documentation may live at workspace root when it helps unified management.

## Rules
- Keep adapters thin and explicit.
- Secrets must stay in environment variables or ignored local env files.
- Do not hardcode API keys, tokens, or personal credentials.
- Add a README for every adapter with startup, config, and routing notes.

## Naming
- Use lowercase `kebab-case` directory names.
- Prefer names that describe protocol or role, not temporary experiments.

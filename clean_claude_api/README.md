# Clean Claude API

This is a local Claude interface for daily conversation.

It is built for a narrow goal:

- keep conversation history
- reduce product-layer interference
- avoid project-assistant and coding-agent framing

It is better suited to long-running personal conversations with Opus.

## Files

- `src/server.mjs`: local chat service
- `src/cli.mjs`: minimal local chat CLI
- `public/`: local web UI
- `.env.example`: environment template
- `ACCESS_MANUAL.md`: access manual

## Quick Start

From workspace root:

```powershell
cd D:\Workspace\projects\api-interface-adapters
npm run chat:start
```

Or from this adapter directory:

```powershell
cd D:\Workspace\projects\api-interface-adapters\clean_claude_api

$env:UPSTREAM_BASE_URL="https://sakura886.site"
$env:UPSTREAM_API_KEY="your-real-key"
$env:MODEL_OPUS="claude-opus-4-7"
$env:MODEL_SONNET="claude-sonnet-4-6"
$env:MODEL_HAIKU="claude-sonnet-4-6"
$env:MODEL_MULTIMODAL="claude-sonnet-4-6"

node src/server.mjs
```

Default address:

```text
http://127.0.0.1:8787
```

Open the web UI:

```text
http://127.0.0.1:8787
```

Or use the CLI:

```powershell
cd D:\Workspace\projects\api-interface-adapters\clean_claude_api
npm run chat
```

From workspace root:

```powershell
cd D:\Workspace\projects\api-interface-adapters
npm run chat:cli
```

## Design

This interface does:

- save history
- manage sessions
- use a light default system prompt
- provide normal and streaming requests

This interface does not:

- orchestrate tools
- inject project-management framing
- wrap itself as a coding agent
- force a theatrical persona

## Boundary

This adapter owns chat only.

- It may keep session history.
- It may expose Claude-compatible routes.
- It should not absorb image or video generation responsibilities.

## Docs

- [Access Manual](D:\Workspace\projects\api-interface-adapters\clean_claude_api\ACCESS_MANUAL.md)
- [Interface Registry](D:\Workspace\projects\api-interface-adapters\INTERFACES.md)

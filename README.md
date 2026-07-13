# Interface Keyboard

This workspace is a local adapter layer built on top of one upstream relay API.

The purpose is not to build one giant gateway. The purpose is to keep chat, image,
and later video generation as separate, explicit local interfaces with stable entrypoints.

## Workspace Shape

- one upstream relay, configured by environment variables
- one adapter per top-level directory
- one local `README.md` per adapter
- thin local interfaces with explicit routing and minimal hidden behavior

## Current Map

### Active

- `clean_claude_api/`: Claude-compatible local chat bridge with session storage, CLI, and web UI
- `image2/`: OpenAI-compatible local image generation bridge with HTTP and CLI entrypoints

### Planned

- `video`: local video-generation bridge built on the same upstream relay pattern

## Unified Commands

Install dependencies:

```powershell
npm install
```

Run all syntax checks:

```powershell
npm run check
```

Start chat bridge:

```powershell
npm run chat:start
```

Open chat CLI:

```powershell
npm run chat:cli
```

Probe upstream chat models:

```powershell
npm run chat:probe
```

Start image bridge:

```powershell
npm run image:start
```

Generate an image:

```powershell
npm run image:generate -- --payload image2/example-request.json --out output/image2/demo.png
```

## Boundary Notes

- `clean_claude_api` owns persistent conversation history and Claude-compatible routing.
- `image2` owns image generation only. It does not manage chat sessions.
- `video` should become its own adapter when added. Do not fold it into `image2` or `clean_claude_api`.

## Cross-session Instruction

```text
Use the existing interface under D:\Workspace\projects\api-interface-adapters.
Do not reimplement an adapter that already exists.
Prefer the unified root scripts first, then adapter-local scripts when needed.
Keep secrets only in environment variables or ignored local env files.
Return the concrete local endpoint or output path after execution.
```

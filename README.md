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
- `image-hub/`: primary image-material control plane with visual configuration, task lifecycle, unified asset library, project output routing, probes, budget guards, and a metadata-only ledger
- `video/`: relay-backed local video bridge with create, status, download, and history entrypoints

## Unified Commands

Install dependencies:

```powershell
npm install
```

Run all syntax checks:

```powershell
npm run check
```

Run local health checks:

```powershell
npm run health
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

Start the image channel control center:

```powershell
npm run image-hub:start
```

Generate an image:

```powershell
npm run image:generate -- --payload image2/example-request.json --out output/image2/demo.png
```

Start video bridge:

```powershell
npm run video:start
```

Generate a video:

```powershell
npm run video:generate -- --prompt "A slow orbit around a glass sculpture"
```

Wait and download a video:

```powershell
npm run video:generate -- --prompt "A slow orbit around a glass sculpture" --wait --out output/video/demo.mp4
```

## Boundary Notes

- `clean_claude_api` owns persistent conversation history and Claude-compatible routing.
- `image2` owns image generation only. It does not manage chat sessions.
- `image-hub` is the primary image-material workflow: create a task, select an optional Workspace project output directory, run it, then manage the result from the unified asset library. It stores image assets locally and returns asset URLs rather than Base64 responses.
- `video` owns video generation only. Do not fold it into `image2` or `clean_claude_api`.
- `video` currently works against `https://sakura886.site/v1` with `AA-veo31fast-720p` as the tested default model.
- `video` has local history persistence; current relay testing shows prompt-only requests work, while image reference mode is not yet supported by the tested default model.

## Cross-session Instruction

```text
Use the existing interface under D:\Workspace\projects\api-interface-adapters.
Do not reimplement an adapter that already exists.
Prefer the unified root scripts first, then adapter-local scripts when needed.
Keep secrets only in environment variables or ignored local env files.
Return the concrete local endpoint or output path after execution.
```

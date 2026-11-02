# Interface Registry

This file is the quick map for `D:\Workspace\projects\api-interface-adapters`.

Its job is to make three things explicit:

- what the upstream dependency is
- which local adapters already exist
- where chat, image, and video boundaries should stay separated

## Architecture

```text
upstream relay API
  -> clean_claude_api  (chat)
  -> image2            (image generation)
  -> video             (video generation)
```

## Interface Map

| Name | Status | Type | Upstream | Local Entry | Default Port | Purpose |
| --- | --- | --- | --- | --- | --- | --- |
| `clean_claude_api` | active | Anthropic-compatible bridge | `UPSTREAM_BASE_URL` | `POST /chat`, `POST /chat/stream`, `POST /v1/messages` | `8787` | Local chat bridge with session persistence, CLI, and web UI |
| `image2` | active | OpenAI-compatible image bridge | `OPENAI_BASE_URL` or OpenAI default | `POST /api/image2/generate` | `3000` | Stable local image-generation entrypoint and CLI wrapper |
| `image-hub` | active | primary image-material control plane | per-channel OpenAI-compatible endpoints | visual UI, `POST /api/tasks`, `POST /api/tasks/:id/run` | `4100` | Channel configuration, task lifecycle, unified asset library, Workspace project output routing, no-cost probes, paid-test guard, and request ledger |
| `video` | active | relay-backed video bridge | `OPENAI_BASE_URL` | `POST /api/video/generate`, `GET /api/video/:id`, `GET /api/video/:id/content`, `GET /api/video/history` | `4000` | Stable local video job bridge with create, retrieve, download, and local history routes |

## Environment Contract

### Shared Principle

- secrets live only in environment variables or ignored local env files
- local adapters should expose one clear entrypoint each
- upstream vendor details belong in env, not in code paths

### `clean_claude_api`

Required:

- `UPSTREAM_BASE_URL`
- `UPSTREAM_API_KEY`

Optional:

- `HOST`
- `PORT`
- `DATA_DIR`
- `DEFAULT_SESSION`
- `DEFAULT_MODEL`
- `MAX_HISTORY_MESSAGES`
- `DEFAULT_MAX_TOKENS`
- `DEFAULT_SYSTEM_PROMPT`
- `MODEL_HAIKU`
- `MODEL_SONNET`
- `MODEL_OPUS`
- `MODEL_MULTIMODAL`
- `ANTHROPIC_VERSION`

### `image2`

Required:

- `OPENAI_API_KEY`

Optional:

- `OPENAI_BASE_URL`
- `OPENAI_IMAGE_MODEL`
- `IMAGE2_API_URL`
- `HOST`
- `PORT`

### `image-hub`

- configuration: `image-hub/channels.local.json` (ignored; contains no keys)
- keys: `image-hub/.env.local` (ignored; one `IMAGE_HUB_<CHANNEL>_API_KEY` per channel)
- UI: `http://127.0.0.1:4100`
- generated Base64 is decoded locally and returned as an asset URL, never relayed in an LLM-facing response
- `GET /api/assets` is the unified material library; each task may set `output_destination` to an existing `projects/<project>` folder, otherwise output stays in the default library
- paid tests require explicit confirmation; generation never auto-falls back to another channel

### `video`

Required:

- `OPENAI_API_KEY`

Optional:

- `OPENAI_BASE_URL`
- `OPENAI_VIDEO_MODEL`
- `VIDEO_API_URL`
- `VIDEO_DATA_DIR`
- `HOST`
- `PORT`

Current tested relay behavior:

- relay: `https://sakura886.site/v1`
- tested default model: `AA-veo31fast-720p`
- prompt-only create requests work
- image reference mode is currently rejected by the tested default model

## Management Rule

For every new adapter, add at least:

1. one independent top-level directory
2. one local `README.md`
3. one registry entry in this file
4. one explicit note about what it owns and what it does not own

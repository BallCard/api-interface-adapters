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
  -> video             (planned)
```

## Interface Map

| Name | Status | Type | Upstream | Local Entry | Default Port | Purpose |
| --- | --- | --- | --- | --- | --- | --- |
| `clean_claude_api` | active | Anthropic-compatible bridge | `UPSTREAM_BASE_URL` | `POST /chat`, `POST /chat/stream`, `POST /v1/messages` | `8787` | Local chat bridge with session persistence, CLI, and web UI |
| `image2` | active | OpenAI-compatible image bridge | `OPENAI_BASE_URL` or OpenAI default | `POST /api/image2/generate` | `3000` | Stable local image-generation entrypoint and CLI wrapper |
| `video` | planned | video-generation bridge | same relay pattern | TBD | TBD | Keep video generation separate from chat and image adapters |

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
- `PORT`

### `video`

Not added yet.

When created, document at least:

- required upstream env variables
- local HTTP entrypoint
- output contract
- relation to `image2`

## Management Rule

For every new adapter, add at least:

1. one independent top-level directory
2. one local `README.md`
3. one registry entry in this file
4. one explicit note about what it owns and what it does not own

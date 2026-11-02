# image-hub

`image-hub` is the local AI Workbench. It provides one calm local entrypoint for
image generation, video generation, and chat while keeping each adapter's
network contract and data ownership separate.

## What it owns

- one local visual workspace at `http://127.0.0.1:4100`
- an image-generation workspace with multiple OpenAI-compatible channels
- video-service status, launch, task creation, and local history via `video/`
- chat-service status and launch, with a direct link to `clean_claude_api/`
- API key storage in an ignored `.env.local` only
- no-cost `GET /v1/models` probes
- explicitly-confirmed paid test images
- Base64 decoding and local asset storage before returning a response
- a unified asset library that is the primary surface for generated images
- optional per-task output to an existing `Workspace/projects/<project>` directory
- a metadata-only JSONL ledger; prompts and image Base64 are not logged

It deliberately does **not** automatically retry a generation on another
provider. A missing response does not prove the provider did not charge, so
automatic fallback could duplicate billing.

## Start

```powershell
npm run image-hub:start
```

Open `http://127.0.0.1:4100`.

The first start uses `channels.example.json`. Saving a channel in the UI creates
the ignored `channels.local.json`; entering a key creates or updates ignored
`image-hub/.env.local`.

For the existing Sakura setup, enter the current image key once in the Sakura
channel. The hub does not copy or expose keys stored in `image2/.env.local`.

## HTTP API

- `GET /health`: local configuration status only
- `GET /api/services`: status of image, video, and chat local services
- `POST /api/services/video/start`: start the video adapter when it is stopped
- `POST /api/services/chat/start`: start the chat adapter when it is stopped
- `POST /api/services/start-all`: start video and chat, then return health status for all three services
- `GET /api/service-configs`, `PUT /api/service-configs/:id`: read or save independent video/chat relay configuration
- `POST /api/service-configs/:id/probe`: query the configured relay's model list without creating a task
- `GET /api/video/history`, `POST /api/video/generate`: same-origin proxies to the local video adapter; keys never pass through the browser
- `GET /api/channels`: masked channel configuration and latest probe status
- `POST /api/channels/:id/probe`: no-cost model-list probe
- `PUT /api/channels/:id`: save metadata; optional `api_key` writes only to `.env.local`
- `POST /api/channels/:id/test`: creates and runs a `paid_test` task; requires `{ "confirm": "PAID_TEST" }`
- `POST /api/tasks`: create a draft generation task
- `GET /api/tasks`, `GET /api/tasks/:id`: list or inspect tasks
- `POST /api/tasks/:id/run`: run a task; requires an `Idempotency-Key` header
- `GET /api/projects`: selectable Workspace project directories
- `GET /api/assets`: unified asset library
- `GET /api/assets/:asset_id`: locally persisted output
- `GET /api/ledger?limit=50`: recent metadata-only request records

## Guardrails

Every generation is a task before it reaches an upstream. A task persists its
request, lifecycle (`draft` / `running` / `succeeded` / `failed`), run records,
asset references, and the latest safe error. Tasks are stored under the ignored
`image-hub/data/tasks/` directory.

The task field `output_destination` is optional. Leave it empty to store files
in `image-hub/data/assets/files/`, the default library. Otherwise it must be a
relative existing project directory such as `projects/my-project`; paths outside
`Workspace/projects/` and absolute paths are rejected. Every persisted image is
also indexed by the asset library, regardless of its final directory.

Each channel owns `maxImages`, `estimatedImageCostCny`, and
`maxEstimatedCostCny`. The hub rejects requests over the configured estimated
budget before sending them upstream. Estimates are local operator input, not
provider billing data.

When an upstream returns Base64, the hub writes it to `image-hub/data/assets/`
and returns only an asset route. This prevents a large binary string from
flowing into an LLM or command response.

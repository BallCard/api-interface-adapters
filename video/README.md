# video

## What it is

`video` is a reusable local video-generation interface built on top of the OpenAI Videos API.

It provides:

- an HTTP service: `POST /api/video/generate`
- a CLI wrapper: `npm run video:generate -- ...`
- local history storage and lookup routes

## Why this shape

The local layer keeps a stable command and routing surface, while staying thin enough to mirror the upstream video job lifecycle.

## Files

- `server.mjs`: local HTTP service
- `generate.mjs`: CLI wrapper for cross-session usage
- `example-request.json`: reusable payload example
- `.env.example`: environment template
- `tasks/`: task workspaces for prompts, notes, and per-run request files

## Environment variables

- `OPENAI_API_KEY`: required
- `OPENAI_BASE_URL`: optional, defaults to `https://sakura886.site/v1`
- `OPENAI_VIDEO_MODEL`: optional, defaults to `AA-veo31fast-720p`
- `VIDEO_API_URL`: optional CLI target override, otherwise the CLI follows `HOST` and `PORT`
- `VIDEO_DATA_DIR`: optional local data dir, defaults to `video/data`
- `HOST`: optional local listen host, defaults to `127.0.0.1`
- `PORT`: optional local service port, defaults to `4000`

## Start the service

From workspace root:

```powershell
npm run video:start
```

Or directly:

```powershell
$env:OPENAI_API_KEY="your-key"
$env:OPENAI_BASE_URL="https://sakura886.site/v1"
$env:OPENAI_VIDEO_MODEL="AA-veo31fast-720p"
$env:HOST="127.0.0.1"
$env:PORT="4000"
npm run video:start
```

## Generate a video

From workspace root:

```powershell
npm run video:generate -- --payload video/example-request.json --out output/video/demo.mp4
```

Or with direct prompt:

```powershell
npm run video:generate -- --prompt "A slow orbit around a glass sculpture"
```

Wait and download after you confirm the relay accepts your chosen model parameters:

```powershell
npm run video:generate -- --prompt "A slow orbit around a glass sculpture" --wait --out output/video/demo.mp4
```

Use a reference string when the upstream model supports it:

```powershell
npm run video:generate -- --prompt "Keep the subject close to the reference" --reference-url "https://example.com/reference.png"
```

Or use a local reference file:

```powershell
npm run video:generate -- --prompt "Keep the subject close to the reference" --reference-file "video/tasks/2026-07-14-video-task-01/references/reference.png"
```

## Request contract

Create route:

- `POST /api/video/generate`

Read route:

- `GET /api/video/:video_id`

Download route:

- `GET /api/video/:video_id/content`

History routes:

- `GET /api/video/history`
- `GET /api/video/history/:video_id`

The create request body is JSON and currently supports:

- `prompt`: required
- `model`: optional, defaults to `OPENAI_VIDEO_MODEL`
- `seconds`: optional, usually `4`, `8`, or `12`
- `size`: optional, such as `1280x720`
- `quality`: optional
- `input_reference`: optional string
- `reference_url`: optional alias for `input_reference`
- `reference_file`: optional local file path that the local adapter converts to a data URL before forwarding upstream

Other provider-specific fields are passed through unchanged.

Current relay note:

- `AA-veo31fast-720p` accepted prompt-only create requests in testing on July 13, 2026
- the same relay rejected `seconds` for that model, so do not assume OpenAI-style video params are universally supported
- the same relay currently rejects image references for this model with `Unsupported reference mode: image`

## Reference Images

Conclusion first: with the current relay and the current default model, you cannot rely on local image upload as a working generation path yet.

What is true right now:

1. this relay does not behave like the official object-style `input_reference`
2. it expects `input_reference` as a string
3. for `AA-veo31fast-720p`, image reference attempts currently fail with `Unsupported reference mode: image`

So the current answer is:

- if the relay later enables a model that supports image reference, send that reference as a string field
- until then, do not build your product flow around image-guided video for this specific model

That means I did not add a fake local upload route that only looks complete but still fails upstream.

## History

Every successful create request now writes a local history record under `video/data/history/`.

History records are updated when you:

- create a video task
- query task status
- download video content

Use:

```powershell
Invoke-RestMethod "http://127.0.0.1:4000/api/video/history"
```

Read one record:

```powershell
Invoke-RestMethod "http://127.0.0.1:4000/api/video/history/task_xxx"
```

## Task Workspace

Use `video/tasks/` for actual work, not the adapter root.

Recommended shape:

- one dated task folder per concrete video task
- `README.md` for the task goal and run notes
- `request.json` for the request you actually send
- `notes.md` for prompt iteration and status tracking
- `references/` for any local reference material you want to keep with the task

Starter task folder created in this repo:

- [2026-07-14-video-task-01](D:/Workspace/projects/api-interface-adapters/video/tasks/2026-07-14-video-task-01)

## Response contract

Create and read routes return:

```json
{
  "ok": true,
  "video": {}
}
```

The returned `video` object mirrors the upstream job object, including fields like `id`, `status`, `progress`, `model`, `seconds`, and `size`.

The content route streams the binary asset returned by `GET /v1/videos/{video_id}/content`.

The CLI behavior is explicit:

- default: create job and print the returned job JSON
- `--wait`: poll until completion
- `--wait --out ...`: download the finished MP4 to disk

## Boundary

This adapter owns video generation only.

- It maps local requests to video-job creation, lookup, and download.
- It may write local video files through the CLI wrapper.
- It should not absorb chat memory or image-generation logic.

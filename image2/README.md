# image2

## What it is

`image2` is a reusable local image-generation interface built on an OpenAI-compatible Images API.

It provides:

- an HTTP service: `POST /api/image2/generate`
- a CLI wrapper: `npm run image2:generate -- ...`

## Files

- `server.mjs`: local HTTP service
- `generate.mjs`: CLI wrapper for cross-session usage
- `example-request.json`: reusable payload example

## Environment variables

- `OPENAI_API_KEY`: required
- `OPENAI_BASE_URL`: optional OpenAI-compatible endpoint, for example `https://sakura886.site/v1`
- `OPENAI_IMAGE_MODEL`: optional, defaults to `gpt-image-2`
- `IMAGE2_API_URL`: optional CLI target override, defaults to `http://localhost:3000/api/image2/generate`
- `PORT`: optional local service port, defaults to `3000`

## Start the service

From workspace root:

```powershell
npm run image:start
```

Or directly:

PowerShell:

```powershell
$env:OPENAI_API_KEY="your-key"
$env:OPENAI_BASE_URL="https://sakura886.site/v1"
$env:OPENAI_IMAGE_MODEL="gpt-image-2"
npm run image2:start
```

## Generate an image

From workspace root:

```powershell
npm run image:generate -- --payload image2/example-request.json --out output/image2/demo.png
```

Or with the existing compatibility alias:

With direct prompt:

```powershell
npm run image2:generate -- --prompt "A chalkboard mechanics diagram" --size 1536x864 --quality high --output-format png --out output/image2/demo.png
```

With reusable payload:

```powershell
npm run image2:generate -- --payload image2/example-request.json --out output/image2/demo.png
```

## Response contract

The service returns JSON in this shape:

```json
{
  "ok": true,
  "model": "gpt-image-2",
  "created": 0,
  "data": [
    {
      "index": 0,
      "b64_json": "..."
    }
  ]
}
```

## Failure checks

When generation fails, check in this order:

1. `OPENAI_API_KEY` exists in the current shell
2. `OPENAI_BASE_URL` is correct
3. the service is running
4. the upstream provider accepts the model name
5. the upstream token is still valid

## Boundary

This adapter owns image generation only.

- It accepts image-generation payloads.
- It may write local image files through the CLI wrapper.
- It should not absorb chat memory or future video-generation logic.

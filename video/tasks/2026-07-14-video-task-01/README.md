# 2026-07-14 Video Task 01

## Goal

Generate a courtyard sky-shot video that matches the provided reference composition while replacing the flower species with pink Rose of Sharon and keeping the airplane small, distant, and continuous across the full clip.

Use this folder to keep:

- the working prompt
- request payloads you actually send
- iteration notes
- local reference assets

## Run

From workspace root:

```powershell
npm run video:generate -- --payload video/tasks/2026-07-14-video-task-01/request.json
```

Wait and download:

```powershell
npm run video:generate -- --payload video/tasks/2026-07-14-video-task-01/request.json --wait --out output/video/task-01.mp4
```

## Current Reality

- the task now includes a real local `reference_file` path in `request.json`
- the local adapter can convert that file into an upstream reference string automatically
- but the tested relay models are currently blocked by channel availability and do not provide a stable render path right now
- use `notes.md` to track model-specific findings instead of assuming OpenAI official behavior

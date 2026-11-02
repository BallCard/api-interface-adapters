# 2026-07-16 Video Task 02

## Goal

Generate a premium website background video that preserves the reference image composition almost unchanged while replacing the original flowers with pink Rose of Sharon.

The video requirement is simple:

- keep the courtyard geometry, sky opening, lighting, and framing logic extremely close to the reference
- change only the flower species
- keep a small airplane moving from right to left across the sky opening
- make motion subtle enough for background-video use

## Reference

- `references/reference.png`

## Run

From workspace root:

```powershell
npm run video:generate -- --payload video/tasks/2026-07-16-video-task-02/request.json --wait --out output/video/task-02.mp4
```

## Notes

Use `notes.md` to track prompt changes and render review.

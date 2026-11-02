# Notes

## Intent

- Keep the reference composition nearly unchanged.
- Replace only the flower species with pink Rose of Sharon.
- Keep the airplane small and continuous from right to left.
- Make the result calm enough for website background use.

## Current Prompt Strategy

- Do not ask for a redesigned courtyard.
- Anchor composition, floral distribution, and diagonal lower-wall shadow explicitly.
- Treat the flower change as a species swap, not a scene rewrite.
- Keep camera motion nearly locked off.

## Review Checklist

- Wide horizontal sky opening remains dominant.
- White stucco geometry stays clean and minimal.
- Heavy floral canopy remains upper left to upper center.
- Dense secondary flower mass remains lower right to lower center.
- Flowers read as Rose of Sharon rather than bougainvillea.
- Airplane is visible from the first frame and stays small.
- Airplane travels right to left with a continuously attached contrail.
- Camera motion is subtle enough for background-video use.

## Run Status

- 2026-07-16: attempted generation with `AA-veo31fast-720p` three times.
- The relay accepted model listing but the actual create call failed each time with channel-unavailable: `分组 default 下模型 AA-veo31fast-720p 的可用渠道不存在（retry）`.
- Current blocker is upstream channel availability, not prompt formatting.
- 2026-07-17: retried after correcting the local service routing so `http://127.0.0.1:4000/health` returned the `video` service again.
- 2026-07-17: three more create attempts still failed upstream with `No available channel for model AA-veo31fast-720p under group default (distributor)`.
- 2026-07-17 request ids:
  - `202607171607367193871478268d9d6UkXgmKb1`
  - `202607171607482553851158268d9d6cCi4lkKA`
  - `202607171608003749671458268d9d6RdPD6xqQ`
- 2026-07-17: another retry batch of three create attempts also failed upstream with the same channel-unavailable error for `AA-veo31fast-720p`.
- 2026-07-17 later request ids:
  - `202607171645227313366748268d9d6yFAuhJwn`
  - `202607171645361565798448268d9d62KGtxtKl`
  - `202607171645518391489358268d9d6ijI5ftLW`
- 2026-07-22: restarted the local `video` service and confirmed `http://127.0.0.1:4000/health` returned service `video`.
- 2026-07-22: retried the same `request.json` three times.
- 2026-07-22: first attempt failed at network fetch layer with `fetch failed`.
- 2026-07-22: second and third attempts failed upstream with `No available channel for model AA-veo31fast-720p under group default (distributor)`.
- 2026-07-22 request ids:
  - `202607220428453483108668268d9d6BPtIvJMC`
  - `202607220428581416334588268d9d6W9PJhAqR`

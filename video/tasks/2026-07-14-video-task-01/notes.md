# Notes

## Final Prompt Direction

- Pure text-to-video only. Do not send `reference_file`, `reference_url`, or `input_reference`.
- Keep the request centered on the courtyard composition and encode the composition explicitly in the prompt.
- Preserve the original visual logic:
  - very wide horizontal sky opening
  - white stucco courtyard viewed from below
  - heavy floral canopy at upper left to upper center
  - secondary floral cluster at lower center to lower right
  - lighter accents on left and right edges
  - small distant airplane with fully attached contrail
- Force species correction in prompt: `Hibiscus syriacus`, not bougainvillea, not tropical hibiscus.
- Explicitly suppress watermark carryover from the reference image.

## Relay Findings

- `AA-veo31fast-720p` had earlier successful runs in this workspace history, but current channel availability is unstable.
- The relay `/models` endpoint still lists `AA-veo31fast-720p`, so model listing does not guarantee runnable capacity.
- Direct upstream retry with key `sk-cYp...Qhu` returned `分组 pro 下模型 AA-veo31fast-720p 的可用渠道不存在（retry）`.
- Direct upstream retry with key `sk-5xJ...Q6l` returned `分组 default 下模型 AA-veo31fast-720p 的可用渠道不存在（retry）`.
- Direct upstream retry with key `sk-cYp...Qhu` also returned channel-unavailable for `seedance2.0` and `seedance2.0fast`.
- Direct upstream retry with key `sk-5xJ...Q6l` also returned channel-unavailable for `seedance2.0` and `seedance2.0fast`.
- When the relay does route `AA-veo31fast-720p`, image reference mode still fails with `Unsupported reference mode: image`.
- Do not assume `seconds` is accepted for this model.
- Therefore the real blocker is upstream channel availability first, and model support for image reference second.

## Review Checklist

- Airplane starts on the far right in frame one and stays visible until the end.
- Airplane remains small and understated instead of becoming the subject.
- Contrail stays directly attached to the airplane with no detached segment.
- Floral framing reads as Rose of Sharon shrub growth rather than bougainvillea vine growth.
- The diagonal lower-wall shadow remains clean and structurally similar to the reference.

## Current Status

- Task payload is prepared.
- Request payload is now text-only and no longer uploads the reference image.
- Prompt is ready for rerun as soon as the relay restores a working channel for the default video model.
- Actual render is currently blocked by relay channel availability.

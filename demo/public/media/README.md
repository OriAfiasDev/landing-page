# demo/media

Assets for the before/after comparison on `/demo/`.

| file | what it is |
| --- | --- |
| `before.mp4` | screen recording of the **old / generic** site |
| `after.mp4` | screen recording of the **new** site |

Only one plays at a time, chosen by the לפני / אחרי tabs, and each is shown
whole (`object-fit: contain`) in a frame that takes its shape from the video.

That means they do **not** need to match each other: different aspect ratios,
different lengths and different pacing are all fine. The only things that matter:

- keep them short and light — the active one autoplays and loops, so a few
  seconds each is plenty;
- record at a decent resolution, since each is shown at full frame width.

The old site is rendered slightly desaturated so the new one reads as the
vivid one; that lives in `.showcase video.before` in `demo/index.html`.

H.264 in an `.mp4` is the safe encode. Optionally add `before.jpg` / `after.jpg`
and reference them with a `poster` attribute to show a still while loading.

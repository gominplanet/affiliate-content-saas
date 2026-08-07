# Clip Factory — burned-caption polish (render service change)

The animated captions on a Short are burned by the external render microservice
(`YOUTUBE_INGEST_URL`, FFmpeg + libass), not by this app. This repo now sends
that service everything it needs to polish them; the service just has to read it.

## What this app now sends

`POST {YOUTUBE_INGEST_URL}/render-short` body:

```jsonc
{
  "videoUrl" | "youtubeVideoId": "...",
  "startSec": 90.0,
  "endSec": 112.0,
  "captionTheme": "bold-white",   // the chosen SubtitleStyle (was unused by ffmpeg path)
  "words": [
    { "startSec": 0.0, "endSec": 0.4, "text": "These", "hl": false },
    { "startSec": 0.4, "endSec": 0.9, "text": "saved",  "hl": false },
    { "startSec": 0.9, "endSec": 1.3, "text": "$40",    "hl": true  }  // power word
  ]
}
```

- `hl: true` marks a "power word" (numbers, `$`/`%`, shouted ALL-CAPS, or a
  high-emphasis term). Computed by `isPowerWord()` in `lib/shorts-captions.ts`.
- `captionTheme` is the creator's chosen style key.
- `text` may already contain emoji characters (future; safe to render as-is).

Both fields are additive — older code sent neither, so the service must treat
them as optional.

## Service-side change (libass)

In the ASS the service generates per word, when `hl` is true, wrap the word in an
accent color override, e.g.:

```
{\c&H00E0FF&}$40{\c&HFFFFFF&}     ; accent, then back to white
```

Pick the accent from `captionTheme` (e.g. `bold-white` → yellow `&H00E0FF&`,
`mint` → green, etc.); default to the current white when the theme is unknown so
nothing regresses. Everything else (position, font, word-by-word timing) stays
as-is.

Emoji: ensure the burn-in font stack includes an emoji-capable font (e.g. Noto
Color Emoji) so any emoji in `text` render as glyphs, not tofu.

## Verifying

Render any Short with a clip that quotes a number or price — the number should
come out accent-colored while the rest of the line stays white.

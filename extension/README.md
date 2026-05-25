# MVP Affiliate — Co-Pilot Helper (Chrome extension)

One extension, two jobs:

1. **CC Scout** (original) — scans Amazon Creator Connections campaigns and pushes the high-EPC ones into your MVP queue. Driven by the popup + a pasted ingest token. _Unchanged._
2. **Co-Pilot frame grab** (new in 1.2.0) — lets MVP's YouTube Co-Pilot dashboard grab a **real frame** from your video so Nano Banana can ground the thumbnail on the creator + product as they actually appear on camera (vidIQ-style).

## How the frame grab works (Design A)

```
MVP dashboard (mvpaffiliate.io)
   │  chrome.runtime.sendMessage(EXT_ID, { type:'MVP_CAPTURE_FRAME', youtubeVideoId })
   ▼
background.js  → opens youtube.com/watch?v=… (foreground tab), injects grabFrameInPage:
                 finds the <video>, mutes + plays, skips a pre-roll ad, seeks to ~50%,
                 draws the frame to a 1280×720 canvas → JPEG data URL
   │  closes the tab, returns the data URL
   ▼
MVP posts it to /api/youtube/generate-thumbnail as `capturedFrameDataUrl`
```

The dashboard talks to us via `externally_connectable` (restricted to `mvpaffiliate.io`). The frame is public data, so the **Pro gate stays server-side** in the generate-thumbnail cap — the extension itself does no auth.

### Known trade-off
Chrome throttles video rendering in hidden/background tabs (you get black frames), so the capture tab is opened **foreground** for ~3–5s, then closed. A brief YouTube tab flash is the cost of a reliable frame. If `MVP_CAPTURE_FRAME` returns `{ ok:false }` (ad couldn't be skipped, blank frame, timeout), MVP silently falls back to the `maxresdefault` frame.

## Stable extension ID

The published Web Store listing has a fixed ID. MVP must know it — set:

```
NEXT_PUBLIC_SCOUT_EXTENSION_ID=<the published extension id>
```

For **unpacked dev**, the id is shown at `chrome://extensions` after "Load unpacked" — set the env var to that locally. (We intentionally do NOT pin a `key` in the manifest, so we don't change the existing published Scout ID.)

## Load / test locally

1. `chrome://extensions` → enable Developer mode → **Load unpacked** → select this folder.
2. Copy the extension ID it shows → set `NEXT_PUBLIC_SCOUT_EXTENSION_ID` in your env and restart Next.
3. In Co-Pilot, generate a thumbnail — a YouTube tab should briefly open + close, and the result should be grounded on a real frame (`faceDebug: source=extension-frame`).

## Publish (unlisted, Pro-only)

1. Zip the folder contents (exclude `key.pem`, `*.der`, `README.md` optional).
2. Chrome Web Store Developer Dashboard → update the existing listing → upload → set **Visibility: Unlisted**.
3. Put the install link behind the Pro paywall in MVP. (Re-review applies because 1.2.0 adds new permissions: `tabs`, `youtube.com` host, `externally_connectable`.)

# SCOUT — Chrome Web Store submission

The store build is `public/mvp-cc-scout-store.zip` (served at
`https://www.mvpaffiliate.io/mvp-cc-scout-store.zip`). It is the normal
extension MINUS the `key` field (CWS forbids it) and with the manifest
`description` trimmed to ≤132 chars. The unpacked build
(`public/mvp-cc-scout.zip`) still keeps the `key` for existing load-unpacked
users until the store version is live.

## Upload
Developer Dashboard → **Add new item** → drop `mvp-cc-scout-store.zip`. The two
earlier errors (key not allowed, description too long) are fixed in this build.

## Store listing — copy/paste

**Item name:** SCOUT — MVP Affiliate

**Summary (≤132):** Companion for MVP Affiliate: grabs real YouTube frames for sharper thumbnails and reads Amazon product details.

**Category:** Productivity

**Detailed description:**
> SCOUT is the free companion extension for MVP Affiliate (mvpaffiliate.io). It
> runs in your own browser and makes a few things work that a server can't do on
> its own:
>
> • Sharper thumbnails — captures a real frame from your YouTube video so MVP can
>   ground your thumbnail on how you and the product actually look on screen.
> • Accurate product details — reads an Amazon product page (title, bullets,
>   price, images) from your logged-in browser when our server is rate-limited.
> • Brand recaps — finds your own on-Amazon videos so MVP can include the right
>   links when you pitch a brand.
> • Deal discovery — scans Amazon Creator Connections you have access to and
>   sends the opportunities into MVP.
>
> SCOUT only acts when you ask it to from MVP Affiliate, and only on your own
> logged-in YouTube and Amazon sessions. You need an MVP Affiliate account to use
> it.

## Privacy practices (REQUIRED — review fails without these)

**Single purpose:** Bridge the MVP Affiliate web app to the user's own logged-in
YouTube and Amazon sessions so MVP can read data the user already has access to
(video frames, product details) and act only on the user's request.

**Permission justifications:**
- `activeTab` / `scripting` — read the page the user asked MVP to work with
  (grab a YouTube frame, read an Amazon product page) only on demand.
- `tabs` — open the specific YouTube/Amazon/Studio page needed for a requested
  action, then close it.
- `storage` — remember lightweight extension settings.
- Host `*.youtube.com` — capture a frame from the user's own video and read
  their Studio content list (for the planning calendar / metadata).
- Host `amazon.com/*` (creatorconnections, manage-content, shop, dp) +
  `affiliate-program.amazon.com` — read product details and the user's own
  affiliate content from their logged-in session.
- Host `mvpaffiliate.io` — receive requests from the MVP dashboard
  (externally_connectable) and hand results back.

**Data usage:** SCOUT does not collect, store, or transmit personal data to any
third party. It passes the data the user requested (a video frame, product text)
back to the user's own MVP Affiliate dashboard only. No analytics, no selling.

**Privacy policy URL:** use the MVP Affiliate privacy policy (e.g.
`https://www.mvpaffiliate.io/privacy`). REQUIRED field.

**Screenshots:** at least one 1280×800 (or 640×400) PNG. Easiest: a screenshot
of the YouTube Co-Pilot generating a thumbnail, or the SCOUT popup.

## ⚠️ After it's published — the extension ID changes
The store assigns a NEW extension ID (different from the current unpacked
`inpklaogoifhgaimbnlgmijnnjkopnlc`, because CWS ignores our `key`). Once the
item exists, copy its ID from the dashboard and tell me. Then we:
1. Set `NEXT_PUBLIC_SCOUT_EXTENSION_ID` (Vercel env) to the published ID.
2. Point the in-app install/update UI at the Web Store URL instead of the zip.
3. (Transition) optionally have the MVP↔SCOUT bridge try BOTH the old unpacked
   ID and the new store ID so existing unpacked users keep working until they
   reinstall from the store.

Do NOT flip `NEXT_PUBLIC_SCOUT_EXTENSION_ID` before the store item is live and
you've reinstalled SCOUT from the store — doing it early breaks the bridge to
your current unpacked copy.

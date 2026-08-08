# Facebook Page connect — failure modes and fixes

## Why a Page won't show

The connect flow reads Pages two ways (`services/facebook/index.ts` → `getPages`):

- **Directly-owned Pages** via `/me/accounts` — needs `pages_show_list` (approved). Works today.
- **Business Manager / New-Pages-Experience Pages** via `/me/businesses` → `owned_pages`/`client_pages` — needs **`business_management`**.

`business_management` is in the OAuth scope string (`app/api/auth/facebook/route.ts`) but Facebook **silently drops it for customers until App Review approves it**. It is **not in the current App Review submission** (that submission is the Comment→DM set: `pages_messaging`, `pages_manage_metadata`, `pages_read_engagement`, `pages_show_list`). So a Business-Manager Page is never offered on the "opt in to all" screen — the user cannot select it, no matter how many times they reconnect.

### Taxonomy
| Case | Symptom | Fix |
|---|---|---|
| Directly-owned, opted in | Works | — |
| Directly-owned, opted OFF on consent screen | Missing from picker | Reconnect, toggle it ON ("opt in to all") |
| Under a Business Manager | Never appears even after opt-in-all | `business_management` (App Review) **or** manual connect |
| Multiple owned, wrong one active | Posts to wrong Page | In-app picker (>1), or reconnect (now preserves selection) |

## Fixes shipped
1. **Callback no longer clobbers the selected Page on reconnect** (`callback/route.ts`) — keeps the user's chosen Page if it's still in the returned list.
2. **Pagination** — `getPages` follows `paging.next` so accounts with many Pages aren't truncated.
3. **Manual connect escape hatch** (`/api/auth/facebook/connect-manual` + `resolveManualPage`) — the user pastes a Page ID + a Page/System-User access token from their Business Manager. Bypasses the OAuth Page list entirely, so it works today for any Page they administer, BM-owned or not, with **zero Meta approval**. Surfaced in Connect Socials as "Can't find your Page? Connect manually" in both the connected and not-connected states.

## Still on Ops
Submit **`business_management`** for App Review so the normal OAuth flow surfaces BM Pages without the manual token. Until then, manual connect is the path for BM-Page users.

## Manual connect — what to tell a user
Facebook → **Business Settings → Users → System users** → add a system user → assign the Page with *Manage Page* access → **Generate token** (select the Page; check `pages_manage_posts` + `pages_read_engagement`). Paste that token (and the Page ID if the token can reach several Pages) into Connect Socials → "Connect manually".

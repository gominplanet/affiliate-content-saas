# Performance Audit & 2026 Best-Practices Plan — MVP Affiliate

_Audited: 2026-05-25. Stack: Next.js 15.5 (App Router) + React 19 + Supabase + Vercel + Tailwind 3.4. Generated WordPress sites on Hostinger (LiteSpeed)._

This report is in two halves: (1) a concrete audit of what the codebase does today and why it's slow, and (2) 2026-current best practices with a prioritized action plan (quick wins vs deeper work), specific files, and expected impact. Sources are cited inline and listed at the end.

---

## PART 1 — CODEBASE AUDIT (findings)

### 1.1 Build/config (`next.config.ts`, `tsconfig.json`, `package.json`)

- **`typescript.ignoreBuildErrors: true` + `eslint.ignoreDuringBuilds: true`** (`next.config.ts:6,9`). These ship type-unsafe and lint-unsafe code to prod. The stated reason is a Supabase generic-inference break — but the codebase has masked it with `(supabase as any)` casts *everywhere* (dashboard layout, dashboard page, content page, most API routes). **Risk:** real runtime bugs (wrong column names, undefined access, N+1 introduced silently) ship undetected; perf regressions in data access can't be caught at build time. This is a correctness risk more than a raw-speed risk, but it's the umbrella that lets the issues below persist.
- **No `experimental.optimizePackageImports`.** `lucide-react` is imported in **38 files** (e.g. `Sidebar.tsx` imports ~40 icons in one statement; `content/page.tsx`, `studio/page.tsx` similar). Without barrel optimization, Next pulls a large slice of the icon library into client bundles. This is the single highest-leverage, lowest-risk bundle win available (see Vercel's own benchmark: 333 vs 1583 modules) ([Vercel](https://vercel.com/blog/how-we-optimized-package-imports-in-next-js)).
- **No bundle analyzer** wired in. We're flying blind on client JS weight.
- Heavy deps are correctly server-only (`@vercel/og`, `cloudinary`, `jszip`, `sharp`, `@anthropic-ai/sdk`, `openai`, `stripe`) — confirmed they appear only in `app/api/**` and `services/**`, not in client pages. Good. `@stripe/stripe-js` is the only client-facing payment dep.

### 1.2 Rendering model — the biggest structural issue

**Almost every dashboard page is a client component.** Only 3 of ~22 dashboard routes are server components (`dashboard/page.tsx`, `layout.tsx`, `community/page.tsx`). Everything else starts with `'use client'`, including the giant ones:

| File | Lines | Type |
|---|---|---|
| `app/(dashboard)/content/page.tsx` | **3,682** | client |
| `app/(dashboard)/setup/page.tsx` | 1,980 | client |
| `app/(dashboard)/studio/page.tsx` | 1,946 | client |
| `app/(dashboard)/brand/page.tsx` | 1,145 | client |
| `app/(dashboard)/customize/page.tsx` | 941 | client |
| `app/(dashboard)/campaigns/page.tsx` | 910 | client |
| `components/layout/Sidebar.tsx` | 571 | client |

Consequences:
- **All of this ships as client JS** and must hydrate before interactive — directly inflating INP and TBT. RSC's whole point is that server components add zero client JS ([Next.js production checklist](https://nextjs.org/docs/app/guides/production-checklist)).
- **Client-side fetch waterfalls.** The client pages follow a repeated anti-pattern: mount → `useEffect` → `supabase.auth.getUser()` (round-trip) → *then* `fetch('/api/...')` (second round-trip) → render. Confirmed in `analytics/page.tsx` (`useEffect` → `/api/analytics/clicks`), and in `content/page.tsx` which has **many** independent `useEffect`/`fetch` blocks (lines 535, 751, 930, 1067, 1645…). Each is a serial network hop after JS hydration, instead of data arriving with the HTML.
- **No streaming / Suspense / `loading.tsx`** anywhere. There are no `loading.tsx` files and no `<Suspense>` boundaries. Pages show spinners ("Loading click data from Geniuslink…") *after* hydration rather than streaming a server-rendered shell.

### 1.3 Data layer (`lib/supabase/*`, queries)

- **Middleware runs on nearly every request and calls `supabase.auth.getSession()`** (`middleware.ts:16`). The matcher excludes static assets but covers all pages + most API routes. `getSession()` in middleware reads the cookie but the recommended call for *gating* is fine; the bigger issue is this is a per-request network/CPU cost on the critical path for every navigation. (Note: dashboard `layout.tsx` *also* calls `getUser()` and the page calls `getUser()` again — auth is resolved 2–3× per dashboard load.)
- **`select('*')` appears 14×** across `app`/`lib`. Per Supabase guidance this fetches every column, inflates transfer/memory, and defeats covering indexes ([Supabase query optimization](https://supabase.com/docs/guides/database/query-optimization)). Several hot paths *do* select explicit columns (good — `dashboard/page.tsx`, `blog/content/route.ts`), so this is inconsistent rather than universal; the `*` sites should be hunted down.
- **Dashboard page is well-structured** (`dashboard/page.tsx`): two `Promise.all` batches (3 + 4 queries) instead of serial — this is the pattern the rest of the app should copy. But it issues **7 count/select queries per dashboard load**; several are `count: 'exact', head: true` on `ai_usage`/`blog_posts`/`collaborations` filtered by `user_id` + a date — these need composite indexes to stay fast as `ai_usage` grows.
- **Indexes:** schema + migrations define a reasonable set (`idx_youtube_videos_user_published`, `idx_blog_posts_user_status`, `scheduled_posts_due_idx`, `ai_usage_*`, etc.). **Gaps to verify:** the dashboard's `ai_usage` counts filter on `(user_id, feature, created_at)` but the existing `ai_usage` indexes are `(created_at)`, `(tier, created_at)`, `(feature, created_at)` — **none lead with `user_id`**, so those per-user count queries likely scan more than they should. Supabase also does **not** auto-index foreign keys — verify every `user_id` FK has an index ([SupaExplorer](https://supaexplorer.com/best-practices/supabase-postgres/)).
- **RLS overhead:** if RLS policies use bare `auth.uid() = user_id`, Postgres re-evaluates `auth.uid()` per row. Wrapping as `(select auth.uid())` makes it run once per query — Supabase documents >100× speedups on large tables ([Supabase RLS perf](https://supabase.com/docs/guides/troubleshooting/rls-performance-and-best-practices-Z5Jjwv)). Worth auditing all policies.
- **Connection pooling:** no evidence of the transaction-mode pooler (port `6543` / Supavisor) in env examples. Vercel serverless functions open a new DB connection per invocation; under load this exhausts Postgres connections. Server-side `@supabase/ssr` over the REST API (PostgREST) mitigates this, but any direct Postgres connections (migrations, `lib/supabase/admin`) should use the pooler ([Supabase max connections](https://supabase.com/docs/guides/troubleshooting/how-to-change-max-database-connections-_BQ8P5)).

### 1.4 Images

- **23 raw `<img>` tags** across `app`/`components` vs `next/image` used in only **2 files** (`app/page.tsx` landing hero, `(auth)/layout.tsx`). The dashboard renders remote YouTube thumbnails with plain `<img>` (e.g. `dashboard/page.tsx:297`, content list, studio). These are **un-optimized, un-sized (CLS risk), and not lazy-loaded** beyond the browser default.
- **`next.config.ts` `images.remotePatterns`** only whitelists `img.youtube.com` + `i.ytimg.com`. fal.media / replicate / googleapis images (generated thumbnails) are **not** whitelisted, which is *why* the code falls back to raw `<img>` + the custom proxy.
- **`app/api/proxy-image/route.ts`** proxies external CDN images to add CORS for canvas compositing. It sets only `Cache-Control: public, max-age=3600` and runs as a Node serverless function — every proxied image is a function invocation (cost + latency) with a short cache. It's necessary for canvas tainting, but it shouldn't be the *display* path for images.
- Only `TutorialVideo.tsx` and `tutorials/page.tsx` use `loading="lazy"`; nothing uses `priority`/`fetchpriority` on the dashboard.

### 1.5 Fonts & CSS

- **App uses system fonts** (`-apple-system, BlinkMacSystemFont, …` in `tailwind.config.ts`) — zero webfont cost on the SaaS app. Good; no `next/font` needed here.
- **Studio injects Google Fonts at runtime** via `document.createElement('link')` (`studio/page.tsx:709`) — render-blocking, unmeasured, and fires client-side. Acceptable since it's a preview-only feature, but it's an un-optimized webfont load.
- **`globals.css`** uses two large fixed `radial-gradient` background layers with `background-attachment: fixed` on `body`. `fixed` backgrounds can cause paint/scroll-jank on mobile. Minor.
- Tailwind `content` globs are correct (purge works); no obvious CSS bloat.

### 1.6 API routes / serverless

- **No route exports `runtime` or `dynamic`** — everything is default Node serverless. Heavy AI routes correctly set `maxDuration` (`blog/generate` = 300s, `photobooth` = 300, `wordpress/posts` = 120). `blog/generate` **correctly uses `next/after`** (imported as `after` from `next/server`) to defer best-effort work (e.g. `maybeEvolveLearnProfile`) off the response path — good pattern.
- Cron routes run **every minute** (`vercel.json`: `process-scheduled` + `process-burn-jobs` at `* * * * *`). Two functions invoked 60×/hr each = constant warm-ish traffic but also constant cost; ensure they early-exit cheaply when there's no work.
- Cold starts: on Vercel Fluid Compute (2026 default), in-function concurrency largely removes cold-start pain for sustained traffic ([Vercel Fluid Compute](https://vercel.com/docs/fluid-compute)). The bigger latency lever here is the auth-resolve-then-fetch waterfall in clients, not raw cold start.

---

## PART 2 — 2026 BEST PRACTICES & PRIORITIZED ACTION PLAN

### A. QUICK WINS (hours, low risk, high impact)

1. **Enable `optimizePackageImports` for `lucide-react`** (and `next-themes` if applicable).
   - File: `next.config.ts` → `experimental: { optimizePackageImports: ['lucide-react'] }`.
   - Impact: 20–30% bundle reduction on icon-heavy pages, faster builds/HMR; only ship the icons used. Near-zero risk, no code changes. ([Vercel](https://vercel.com/blog/how-we-optimized-package-imports-in-next-js), [Next.js docs](https://nextjs.org/docs/app/api-reference/config/next-config-js/optimizePackageImports))

2. **Add `@next/bundle-analyzer`** and run `ANALYZE=true npm run build` once to get a baseline treemap. Drives every later decision on what to split. ([DEV 2026 guide](https://dev.to/bean_bean/nextjs-performance-optimization-the-2026-complete-guide-1a9k))

3. **Add `loading.tsx`** to the heavy dashboard route segments (`content`, `studio`, `setup`, `campaigns`, `brand`). Instant server-rendered skeleton while the client page hydrates — immediate perceived-perf win with one file per route, no refactor. ([Next.js streaming](https://nextjs.org/docs/app/guides/production-checklist))

4. **Whitelist generated-image hosts in `next.config.ts` `images.remotePatterns`** (`fal.media`, `*.fal.media`, `replicate.delivery`, `storage.googleapis.com`) and **replace dashboard `<img>` with `next/image`** (start with `dashboard/page.tsx`, the content list, studio thumbnails). Always pass `width`/`height` (kills CLS) and `priority` only on the LCP image. Vercel then serves cached WebP/AVIF. ([Vercel image optimization](https://vercel.com/docs/image-optimization), [Core Web Vitals 2026](https://www.digitalapplied.com/blog/core-web-vitals-2026-inp-lcp-cls-optimization-guide))

5. **Hunt the 14 `select('*')` calls** and replace with explicit column lists. Free transfer/latency reduction, enables covering indexes. ([Supabase](https://supabase.com/docs/guides/database/query-optimization))

6. **Raise `proxy-image` cache** from `max-age=3600` to `public, max-age=31536000, immutable` (CDN images are content-addressed/stable) and restrict its use to the canvas-compositing path only — never as the `<img src>` for display. Cuts repeat function invocations dramatically.

### B. MEDIUM (days, moderate refactor)

7. **Convert read-mostly dashboard pages to Server Components with server-side data fetch**, mirroring the existing good `dashboard/page.tsx` pattern (parallel `Promise.all`, explicit columns). Strongest candidates: `analytics`, `billing`, `collaborations`, `learn`, and the read views inside `content`. Push interactivity into small `'use client'` leaf components. This removes the hydrate-then-`getUser()`-then-`fetch()` waterfall — data arrives with the HTML.
   - Impact: large INP/LCP/TTFB win; less client JS. RSC reduces main-thread work, the #1 lever for INP (43% of sites fail INP in 2026). ([Core Web Vitals 2026](https://dev.to/dharanidharan_d_tech/fix-lcp-inp-cls-in-2026-the-complete-core-web-vitals-guide-with-real-benchmarks-54cl))

8. **Code-split heavy client-only widgets with `next/dynamic`** (currently **zero usage**). Targets: `SocialPreviewModal`, `BulkScheduleModal`, `PinterestPreviewModal`, the Instagram-burner/photobooth canvas tooling, and any chart/modal not needed on first paint — `dynamic(() => import(...), { ssr: false })`. Keeps the 3,600-line `content` page from shipping everything up front. ([Code With Seb](https://www.codewithseb.com/blog/dynamic-bundle-optimization-under-200kb-guide))

9. **Collapse the auth waterfall.** Resolve the user once in the server layout and pass `user`/`tier` down via props/context instead of each client page calling `getUser()` again. Where data is fetched in `useEffect`, prefer fetching server-side in the (now server) page. Reduces 2–3 auth round-trips to 1.

10. **Index + RLS audit on Supabase:**
    - Add composite indexes that lead with `user_id` for the dashboard counters: `ai_usage (user_id, feature, created_at desc)`, and confirm `(user_id, created_at)` on `collaborations` / `blog_posts` exist for the `.gte(created_at)` filters.
    - Verify every `user_id` foreign key is indexed (Supabase doesn't auto-create these).
    - Rewrite RLS policies to wrap auth calls: `(select auth.uid()) = user_id`. Documented >100× on large tables.
    - Use Supabase's Performance Advisor + slow-query view to confirm. ([Supabase RLS](https://supabase.com/docs/guides/troubleshooting/rls-performance-and-best-practices-Z5Jjwv), [Database advisors](https://supabase.com/docs/guides/database/database-advisors), [SupaExplorer](https://supaexplorer.com/best-practices/supabase-postgres/))

11. **Connection pooling:** ensure any direct-Postgres usage (migrations/admin scripts/`lib/supabase/admin`) targets the transaction-mode pooler (Supavisor, port `6543`) for serverless safety. ([Supabase](https://supabase.com/docs/guides/troubleshooting/how-to-change-max-database-connections-_BQ8P5))

### C. DEEPER WORK (weeks, structural)

12. **Adopt Partial Prerendering (PPR) on the landing + pricing + marketing pages.** These are mostly static with a small dynamic sliver (auth state). PPR serves a static shell instantly from the edge and streams the dynamic hole-outs in one HTTP response. Enable incrementally: `experimental: { ppr: 'incremental' }` + `export const experimental_ppr = true` per route. Best fit = mixed static/dynamic pages (marketing, SaaS dashboards). For fully-authenticated dashboard routes, plain `loading.tsx` streaming (item 3) gives most of the benefit with far less config. ([Next.js PPR](https://nextjs.org/docs/15/app/getting-started/partial-prerendering), [wolf-tech tradeoffs](https://wolf-tech.io/blog/nextjs-15-partial-prerendering-real-world-patterns-and-tradeoffs))

13. **Caching strategy for genuinely-cacheable reads.** Wrap expensive, non-user-specific or slowly-changing server reads (e.g. announcement banner, WP-version lookups, public tutorials) in `unstable_cache`/`revalidate` so they're not recomputed per request. Keep user-specific data uncached. ([Next.js production checklist](https://nextjs.org/docs/app/guides/production-checklist))

14. **Fix the root cause behind `ignoreBuildErrors`.** Generate proper Supabase types (`supabase gen types typescript`) and a typed client wrapper so the `(supabase as any)` casts can be removed and `ignoreBuildErrors` turned off. This re-enables compile-time detection of the very query/data bugs that hurt perf. (Correctness > raw speed, but it's the keystone.)

15. **Break long tasks for INP.** In the mega client pages, defer non-critical work, yield to the main thread, and minimize DOM complexity (the `content` page renders very large lists/trees). RSC migration (item 7) does most of this; remaining client interactions should chunk work. ([Core Web Vitals 2026](https://www.digitalapplied.com/blog/core-web-vitals-2026-inp-lcp-cls-optimization-guide))

### D. RUNTIME / VERCEL

- **Stay on Node runtime + Fluid Compute** (2026 default). Edge runtime is deprecated for functions; Fluid's in-function concurrency removes cold-start pain for sustained traffic and supports the long-running AI routes (`maxDuration` up to 300s) that Edge cannot. Do **not** move AI/`sharp`/SDK routes to Edge. ([Vercel runtimes](https://vercel.com/docs/functions/runtimes), [Fluid Compute](https://vercel.com/blog/scale-to-one-how-fluid-solves-cold-starts))
- Keep `next/after` for deferred work (already done in `blog/generate`); extend the pattern to other routes that do best-effort post-response work (analytics writes, usage recording, cache purges).
- Make the every-minute cron routes early-exit with a cheap indexed "is there due work?" query before doing anything.

### E. GENERATED WORDPRESS SITES (LiteSpeed on Hostinger) — brief

The affiliate blogs we generate are the reader-facing surface and rank in search, so their Core Web Vitals matter for SEO/conversions.

- **LiteSpeed Cache settings:** start from the **Standard preset**, enable **Guest Mode + Guest Optimization** (huge win for first-time anonymous visitors = exactly affiliate-blog traffic), and use **QUIC.cloud CDN** (required for Guest Optimization + Critical CSS). ([Ecenica](https://www.ecenica.com/support/answer/best-litespeed-cache-settings-for-wordpress/), [Savvy](https://savvy.co.il/en/blog/wordpress-speed/litespeed-cache-optimal-settings/))
- **Images:** enable WebP generation + lazy-load, but **exclude the above-the-fold / LCP hero image from lazy-load** (LiteSpeed's Viewport Images service auto-detects the first ~4). Our theme already defines `add_image_size('mvp-card', 640×360)` and `mvp-card-large 1200×675` (`functions.php:36-37`) — make sure generated posts request the right size rather than full-res. ([LiteSpeed image opt](https://docs.litespeedtech.com/lscache/lscwp/imageopt/))
- **CLS:** enable LiteSpeed's "add missing width/height to images" so reader posts don't shift. ([LiteSpeed page opt](https://docs.litespeedtech.com/lscache/lscwp/pageopt/))
- **Our theme's `<head>` output** (`functions.php:87-129`): it enqueues `main.css` + `main.js` (deferred via `true` = footer, good) and conditionally loads Google Fonts with `&display=swap` (good — avoids invisible-text CLS). When the font theme is `editorial`/`minimal` (system fonts) it correctly loads **no** webfont. Keep that. Consider `preconnect` to `fonts.googleapis.com`/`fonts.gstatic.com` when a Google font theme is active.
- Note (from MEMORY): Hostinger CDN/WAF can 403 our REST writes; unrelated to perf but a caching/CDN-layer gotcha to keep separate from LiteSpeed config.

---

## PRIORITIZED SUMMARY TABLE

| # | Action | Effort | Impact | Files |
|---|---|---|---|---|
| 1 | `optimizePackageImports: ['lucide-react']` | XS | High (bundle) | `next.config.ts` |
| 2 | Add bundle analyzer baseline | XS | (diagnostic) | `next.config.ts`, scripts |
| 3 | `loading.tsx` on heavy routes | S | High (perceived) | `(dashboard)/*/loading.tsx` |
| 4 | `next/image` + remotePatterns for dashboard imgs | S–M | High (LCP/CLS/cost) | `next.config.ts`, dashboard pages |
| 5 | Kill `select('*')` (14×) | S | Med | various API/lib |
| 6 | Longer proxy-image cache, display-path off proxy | XS | Med (cost/latency) | `api/proxy-image/route.ts` |
| 7 | Read pages → Server Components | M–L | Very High (INP/JS) | analytics, billing, content, etc. |
| 8 | `next/dynamic` heavy modals/canvas | M | High (JS) | content/studio/IG pages |
| 9 | Collapse auth waterfall | M | Med–High | layout + client pages |
| 10 | Indexes (user_id-leading) + RLS `(select auth.uid())` | M | High (DB) | `supabase/migrations`, policies |
| 11 | Transaction pooler for direct PG | S | Med (stability) | env/admin client |
| 12 | PPR on marketing pages | L | Med–High (LCP) | landing/pricing |
| 13 | `unstable_cache` for shared reads | M | Med | banner/wp-version/tutorials |
| 14 | Fix Supabase types, drop `ignoreBuildErrors` | L | High (correctness) | types, `next.config.ts` |
| WP | LiteSpeed Guest Mode + WebP + LCP exclude | S | High (reader CWV) | Hostinger LiteSpeed, theme |

---

## SOURCES

- Next.js — Optimized package imports: https://vercel.com/blog/how-we-optimized-package-imports-in-next-js
- Next.js — `optimizePackageImports` reference: https://nextjs.org/docs/app/api-reference/config/next-config-js/optimizePackageImports
- Next.js — Production checklist (streaming, RSC, caching): https://nextjs.org/docs/app/guides/production-checklist
- Next.js — Partial Prerendering (v15): https://nextjs.org/docs/15/app/getting-started/partial-prerendering
- PPR real-world tradeoffs: https://wolf-tech.io/blog/nextjs-15-partial-prerendering-real-world-patterns-and-tradeoffs
- Next.js streaming & Suspense guide: https://www.untergletscher.com/en/blog/nextjs-15-streaming-suspense-performance-guide
- Next.js performance 2026 guide: https://dev.to/bean_bean/nextjs-performance-optimization-the-2026-complete-guide-1a9k
- Bundle under 200KB / dynamic imports: https://www.codewithseb.com/blog/dynamic-bundle-optimization-under-200kb-guide
- Vercel — Fluid Compute: https://vercel.com/docs/fluid-compute
- Vercel — Scale to one / cold starts: https://vercel.com/blog/scale-to-one-how-fluid-solves-cold-starts
- Vercel — Runtimes (Edge deprecated): https://vercel.com/docs/functions/runtimes
- Vercel — Image Optimization: https://vercel.com/docs/image-optimization
- Supabase — Query optimization: https://supabase.com/docs/guides/database/query-optimization
- Supabase — RLS performance & best practices: https://supabase.com/docs/guides/troubleshooting/rls-performance-and-best-practices-Z5Jjwv
- Supabase — Database advisors: https://supabase.com/docs/guides/database/database-advisors
- Supabase — Max connections / pooler: https://supabase.com/docs/guides/troubleshooting/how-to-change-max-database-connections-_BQ8P5
- Supabase Postgres 30 best practices: https://supaexplorer.com/best-practices/supabase-postgres/
- Core Web Vitals 2026 (INP/LCP/CLS): https://www.digitalapplied.com/blog/core-web-vitals-2026-inp-lcp-cls-optimization-guide
- Core Web Vitals 2026 benchmarks: https://dev.to/dharanidharan_d_tech/fix-lcp-inp-cls-in-2026-the-complete-core-web-vitals-guide-with-real-benchmarks-54cl
- LiteSpeed Cache best settings 2026: https://www.ecenica.com/support/answer/best-litespeed-cache-settings-for-wordpress/
- LiteSpeed image optimization docs: https://docs.litespeedtech.com/lscache/lscwp/imageopt/
- LiteSpeed page optimization docs: https://docs.litespeedtech.com/lscache/lscwp/pageopt/

# Audit follow-ups (from the failure + speed/bug sweep)

Shipped already (PRs #403–#405): always-use-Geniuslink on scheduled + manual
posts, Facebook "no Page" message, Nano-Banana pricing aliases, tier normalize
in schedule-publish, X scheduled-post capping.

Below are the remaining findings, grouped by risk. The HIGH-RISK ones touch the
money/publish path or concurrency and were deliberately left for a careful,
reviewed change rather than an unattended edit. Each has file:line + the fix.

---

## High value, needs careful review (do these next, with eyes on)

### 1. Duplicate social posts after a mid-publish crash (no idempotency) — ✅ DONE
> Shipped: `publishOne` now short-circuits when the post already carries this
> platform's external id (twitter/threads/linkedin/facebook/bluesky/pinterest/
> telegram), returning it instead of republishing. Closes the common
> crash-after-publish-before-completed window.

- Where: `app/api/cron/process-scheduled/route.ts` — stuck-recovery `:127-138` flips `processing→pending` after 5 min; publish then `status:'completed'` + `external_id` write at `:236-237`. Per-platform blog_posts id (e.g. `twitter_post_id`) is written inside `publishOne` (X `:503`) BEFORE the completed write.
- Failure: publish succeeds, the function dies before the `completed` write (Vercel timeout on a big parallel batch), recovery re-queues the row, it republishes → duplicate tweet/FB/LI post.
- Fix (catches the common window): at the top of each `publishOne` platform branch, if the linked `blog_posts.<platform>_post_id` is already set, skip publishing and return that id as `externalId`. This closes the "crashed after publishOne, before completed write" case. The residual window (crash mid-`publishOne`, after the platform API but before the blog_posts id write) needs an external-id reservation and is much rarer — acceptable to leave once the common case is closed.
- Risk: touches the core publish path; verify each platform writes its `blog_posts.<platform>_post_id` and that a legitimate re-attempt (transient earlier failure) isn't wrongly skipped (it won't be — the id is only set on success).

### 2. X monthly cap is non-atomic → paid cap can be exceeded
- Where: `lib/x-cap.ts:32-52` (check-then-record; `recordXPost`→`recordUsage` is fire-and-forget, `lib/ai-usage.ts:177`), consumed in the parallel batch `process-scheduled/route.ts:483` and `lib/deal-social-publish.ts:99`.
- Failure: several X posts for one user in one tick all read the same pre-post count, all pass, all post — over the $0.20/post cap.
- Fix: gate X through an atomic consume RPC (mirror `try_consume_post_quota`) that reserves the slot before `createTweet`, or serialize X posts per user per tick. Also make `x-cap` fail CLOSED (conservative) on a telemetry read error instead of `exceeded:false` (`x-cap.ts:32-48`).
- Risk: needs a small DB RPC + careful rollout; real dollars, so worth doing right.

### 3. No retry on transient upstream errors in the social cron
- Where: `process-scheduled/route.ts:11-13` ("no retries"), failure path `:242-268`.
- Failure: a single `ECONNRESET`/`5xx` marks the post permanently `failed`, and 3 such blips also falsely trip the dead-channel nag (see #5 below).
- Fix: classify transient errors (regex already exists at `generate/route.ts:1118`); on transient, set the row back to `pending` with a bounded `retry_count` (add the column) instead of `failed`. Cap at 2–3 to stay under `maxDuration=60`.

### 4. Channel-health `getConnectedPlatforms` treats a read error as "nothing connected"
- Where: `lib/channel-health.ts:100-119` (both reads swallow errors, return possibly-empty set); `getDeadChannels` filters dead channels by it (`:186-187`).
- Failure: a transient DB error → empty set → every dead channel filtered out → the "needs reconnecting" alert silently vanishes during a hiccup.
- Fix: signal read-failure distinctly (e.g. return `null`/throw) and have `getDeadChannels` skip the connected-only filter on error rather than treating it as "nothing connected." Signature change ripples to callers — do it deliberately.

### 5. Cap/transient failures pollute the dead-channel streak → false "reconnect" nag + wrongful auto-skip
- Where: `lib/channel-health.ts:57-76` (`classify` misses cap/quota + transient), streak at `:154-158`; X cap failure stamped at `process-scheduled/route.ts:484`.
- Failure: X hitting its monthly cap 3× (or 3 transient blips) reads as `failing` → user told to reconnect a healthy channel, and the cron auto-skips it for 24h.
- Fix: tag cap/quota failures with a prefix excluded from the streak (same mechanism as `AUTO_SKIP_PREFIX`), and exclude classified-transient errors from the streak too.

### 6. Silent image→link fallback masks auth (401/403) errors
- Where: LinkedIn `process-scheduled/route.ts:557-561`, Facebook `:638-648` (bare `catch { … postLink() }`).
- Failure: `postPhoto`/`createImagePost` throws on an expired token, the catch retries as a link post, so the real cause (expired) is misclassified as `failing` → wrong user guidance; or it succeeds and hides a dying token.
- Fix: in each catch, only fall back to a link post for image-fetch errors; rethrow on 401/403/token errors so `classify()` sees the true cause. At minimum `console.warn` the swallowed error.

---

## Medium value, mostly contained

### 7. deal-social-publish reads X token only from legacy column
- `lib/deal-social-publish.ts:96` reads `integrations.twitter_access_token` and throws "X is not connected" if missing, even when X was connected via the modern `social_accounts` flow (used for FB/Threads at `:120`,`:140`). Fix: resolve X via `resolveSocialAccount` like FB/Threads.

### 8. Deal-radar discount can only ratchet UP, never correct down
- `app/api/cron/refresh-deal-radar/route.ts:264-276`: `Math.max(curPct, histPct)` + write only when higher. A stale-high `discount_pct` can never be lowered by an authoritative price-history read → overstated "% off". Fix: let a fresh history read overwrite downward (or store history-derived separately and display that).

### 9. `completeJob` swallowed failure can leave a job re-runnable
- `app/api/cron/process-generation-jobs/route.ts:140-142`: success path wraps `completeJob` in empty catch; job stays `running`, the 720s reclaim re-runs it. Idempotent for the rewrite/blog path, but a non-upsert handler (campaign/comparison) would double-execute/double-bill. Fix: retry `completeJob`, or flip `running→done` unconditionally.

### 10. Deal-schedule + burn-job crons have no dead-channel guard
- `process-deal-schedules/route.ts:69-126`, `process-burn-jobs/route.ts:65-131` don't call `getDeadChannels`/`shouldSkipChannel`, so a disconnected channel keeps getting full attempts. Fix: reuse the guard from `process-scheduled/route.ts:188-219`.

### 11. Burn-job transient failure discards a paid render
- `process-burn-jobs/route.ts:120-131`: any post-render error marks the job `failed`; the paid Cloudinary render (`:88-102`) is lost, user re-pays. Fix: on transient publish error, requeue reusing the already-rendered `burned.url` (checkpoint-before-publish, like `lib/generation-jobs.ts:169-201`).

### 12. Newsletter sends a hollow issue on a post-lookup error
- `app/api/cron/newsletter-process/route.ts:189-206`: if the `blog_posts` lookup errors, it proceeds with `posts:[]` and still marks `sent`. Fix: mark `failed` when `blog_post_ids` was non-empty but zero rows came back.

### 13. `job_failures.status:'pending_retry'` implies an auto-retry that never runs
- `logFailure` (`generate/route.ts:2524`) writes `pending_retry`; nothing drains it. Fix: either add a worker that drains it (respecting `retry_count`) or rename the initial status to `open` to match the failures API/UI.

---

## Performance (from the speed sweep)

### P1. `refresh-social-tokens` is fully sequential and unbounded
- `app/api/cron/refresh-social-tokens/route.ts:70` (≤2000 integrations, up to 3 awaited HTTP each) + `:145` (≤5000 social_accounts) — strictly sequential under `maxDuration=300`. Blows the budget → the tail never gets refreshed → tokens age out → "why did my scheduled post fail?". Fix: bounded-concurrency chunks (Promise.all over ~10–20 slices) and/or order by soonest-expiry so each run drains the most urgent first.

### P2. `refresh-indexing` doubly sequential + unbounded users
- `refresh-indexing/route.ts:61` user loop, `:124` inspect loop, users query `:48` has no `.limit()`. ~15s/user caps it at ~20 users/tick; the rest are silently skipped daily with no round-robin. Fix: cap users/run, order by oldest-refreshed, bounded concurrency.

### P3. Deal quick-post publishes platforms serially on the user's request
- `lib/deal-social-publish.ts:92` `for…await` per platform (~24s for 6). Fix: `Promise.all` the per-platform blocks after the single up-front reads (pre-check the X cap once before fan-out).

### P4/P5. Redundant `integrations`/`brand_profiles` reads on hot generation paths
- `app/api/deals/route.ts:333` re-reads integrations (also inside `checkGenerationLimit`, `lib/tier.ts:883`); `brand_profiles` read twice (`:159`, `:588`). The gate helpers (`lib/tier.ts:641/737/805/883`) each re-read the tier row. Fix: resolve `{tier, period_start, period_end}` + the brand row once per request and pass down.

---

## Notes
- Both audits confirmed the following are already fine: atomic claim + `allSettled` parallelism in `process-scheduled`/`process-deal-schedules`; token-paced deadline-bounded Keepa crons; cursor pagination in `v1/blog-posts`; the blog-generate inline-vs-`after()` image split.

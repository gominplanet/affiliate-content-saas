// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// BACKGROUND JOBS FINISH, CLAIM, AND SAY WHAT HAPPENED.
//
// Pins the fixes from the jobs audit of 2026-10-06. Each line below was a way
// a cron could do work twice, leave a row in a state nothing ever leaves, or
// write "done" over a lookup that never got an answer.
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const failures: string[] = []
const check = (name: string, cond: boolean, detail?: string) => {
  if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`)
}
const read = (p: string) => readFileSync(p, 'utf8')

// ── every cron in vercel.json has a route, a limit and the secret ───────────
{
  const crons = (JSON.parse(read('vercel.json')).crons ?? []) as Array<{ path: string }>
  for (const c of crons) {
    const file = join('app', c.path, 'route.ts')
    if (!existsSync(file)) { check(`${c.path} has a route`, false); continue }
    const src = read(file)
    check(`${c.path} declares maxDuration`, /export const maxDuration = \d+/.test(src),
      'without it the platform default decides when the run is cut off')
    check(`${c.path} requires the cron secret`, /CRON_SECRET/.test(src))
  }
  const routes = readdirSync('app/api/cron').filter((d) => existsSync(join('app/api/cron', d, 'route.ts')))
  for (const d of routes) {
    check(`app/api/cron/${d} is scheduled`, crons.some((c) => c.path === `/api/cron/${d}`), 'a cron route nobody calls')
  }
}

// ── burn jobs: a dead claim is failed with a reason, never re-posted ─────────
{
  const BURN = read('app/api/cron/process-burn-jobs/route.ts')
  check('stuck burn jobs are failed, not left processing',
    /\.eq\('status', 'processing'\)\s*\.lt\('claimed_at'/.test(BURN) && /STUCK_BURN_MESSAGE/.test(BURN))
  check('and they are not put back in the queue (the Reel may be live)',
    !/status: 'pending'/.test(BURN.slice(BURN.indexOf('STUCK_BURN_MINUTES * 60_000') - 400, BURN.indexOf('STUCK_BURN_MINUTES * 60_000'))))
}

// ── newsletter: the A/B winner is claimed before it is sent ──────────────────
{
  const SEND = read('lib/newsletter-send.ts')
  const fin = SEND.slice(SEND.indexOf('export async function finalizeAbBroadcast'))
  const claimAt = fin.indexOf(".eq('status', 'ab_testing')")
  const sendAt = fin.indexOf('sendBroadcastBatch(')
  check('the A/B finalize claims the row before mailing the holdback',
    claimAt > -1 && sendAt > -1 && claimAt < sendAt && /update\(\{ status: 'sending' \}\)/.test(fin))
  const PROC = read('app/api/cron/newsletter-process/route.ts')
  check('a send the function died in is failed with a reason',
    /\.eq\('status', 'sending'\)\s*\.is\('sent_at', null\)/.test(PROC))
  check('zero recipients says so', /No active subscribers matched/.test(PROC))
}

// ── a lookup that got no answer is not stamped as checked ───────────────────
{
  const CC = read('app/api/cron/enrich-cc-catalog/route.ts')
  check('enrich-cc-catalog skips a card Keepa never answered',
    /if \(card\.tokensLeft == null\)/.test(CC) && CC.indexOf('card.tokensLeft == null') < CC.indexOf('product_verified_at: nowIso'))
  const EPC = read('app/api/cron/enrich-epc-products/route.ts')
  check('enrich-epc-products stamps only answered ASINs',
    /fetchKeepaBasicsCached\(admin, distinct, \{ answered \}\)/.test(EPC) && /if \(!answered\.has\(asin\)\) return/.test(EPC))
  const DR = read('app/api/cron/refresh-deal-radar/route.ts')
  check('deal radar does not write an empty read over a stored verdict',
    /a\.currentCents == null && a\.avg90Cents == null/.test(DR))
  const FAV = read('app/api/cron/check-favorite-brands/route.ts')
  check('a failed brand scan is not written as zero open',
    !/catch \{ openByKey\.set\(key, 0\) \}/.test(FAV) && /if \(!openByKey\.has\(r\.brand_key\)\)|openByKey\.has\(r\.brand_key\)/.test(FAV))
}

// ── claims that overlapping ticks can race ───────────────────────────────────
{
  const GS = read('app/api/cron/drain-global-sync/route.ts')
  check('drain-global-sync resumes a job only if its claim wins',
    /\.eq\('id', job\.id\)\.lt\('updated_at', staleBefore\)\s*\.select\('id'\)/.test(GS) && /claimed_elsewhere/.test(GS))
}

// ── one account cannot hold a queue ──────────────────────────────────────────
{
  const PB = read('app/api/cron/partnerboost-sync/route.ts')
  check('partnerboost leaves recently failed accounts out of the query itself',
    /\.not\('user_id', 'in'/.test(PB))
  const DIG = read('app/api/cron/weekly-deal-digest/route.ts')
  check('weekly digest filters opt-in in the query, before the limit',
    DIG.indexOf("notification_preferences->>weekly_digest") > -1
    && DIG.indexOf("notification_preferences->>weekly_digest") < DIG.indexOf('.limit(200)'))
  const CS = read('app/api/cron/covered-sales/route.ts')
  check('covered-sales records one creator\'s error and moves on', /errors\.push\(\{ userId/.test(CS))
  const HT = read('app/api/cron/heal-thumbnails/route.ts')
  check('heal-thumbnails does not take the same flagged owners every run', /Math\.random\(\)/.test(HT))
}

// ── deadlines leave room for the step in hand ───────────────────────────────
{
  for (const [file, re] of [
    ['app/api/cron/refresh-indexing/route.ts', /if \(left\(\) < 15_000\) break/],
    ['app/api/cron/refresh-social-tokens/route.ts', /if \(left\(\) < 30_000\)/],
    ['app/api/cron/heal-thumbnails/route.ts', /if \(left\(\) < 60_000\)/],
    ['app/api/cron/auto-blog/route.ts', /deferred_out_of_time/],
    ['app/api/cron/check-favorite-brands/route.ts', /if \(left\(\) < 30_000\)/],
    ['app/api/cron/youtube-data-retention/route.ts', /retentionPass\(createAdminClient\(\), 2000, Date\.now\(\)/],
  ] as const) check(`${file} stops with time to spare`, re.test(read(file)))
  check('weekly digest starts its last digest with room to finish it',
    /const deadline = Date\.now\(\) \+ 170_000/.test(read('app/api/cron/weekly-deal-digest/route.ts')))
  check('deal aftercare starts its last rewrite with room to finish it',
    /const deadline = started \+ 200_000/.test(read('app/api/cron/deal-aftercare/route.ts')))
}

// ── what members read has no dashes ──────────────────────────────────────────
{
  const BURN = read('app/api/cron/process-burn-jobs/route.ts')
  const RSC = read('app/api/cron/reset-stuck-campaigns/route.ts')
  const quoted = (src: string) => [...src.matchAll(/(error_message|STUCK_BURN_MESSAGE)[^'`]*['`]([^'`]*)['`]/g)].map((m) => m[2])
  for (const s of [...quoted(BURN), ...quoted(RSC)]) {
    check(`no dash in "${s.slice(0, 50)}"`, !/[–—]| - /.test(s))
  }
  const MIG = read('supabase/migrations/411_jobs_reclaim_message.sql')
  check('migration 411 rewrites the reclaim message without a dash',
    /create or replace function public\.reclaim_stuck_scheduled_posts/.test(MIG) && !/[–—]/.test(MIG.slice(MIG.indexOf('as $$'))))
}

if (failures.length) {
  console.error(`\n❌ cron-jobs: ${failures.length} failure(s)\n`)
  for (const f of failures) console.error(`   • ${f}`)
  process.exit(1)
}
console.log('✅ cron-jobs: every cron is limited and authed, claims win before work, a non-answer is never stamped done, and stuck rows say why')

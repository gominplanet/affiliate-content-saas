// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// THE 2026-10-06 SECURITY AUDIT FIXES STAY FIXED.
//
// Each check below is one hole that was open, written as the property that
// closes it, so a later edit that reopens it fails the build instead of
// shipping. Source-level checks on purpose: the holes were all one line wide
// (a fallback to the session, a token in a URL, a missing gate), and one line
// is exactly what a refactor drops without anyone noticing.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { isScriptUrl, inertHtml } from '../lib/inert-html'
import { signupIpHash, captchaEnforced, PAID_SIGNUPS_PER_IP_HOUR } from '../lib/signup-guard'

const failures: string[] = []
const check = (name: string, cond: boolean, why: string) => {
  if (!cond) failures.push(`${name}\n    why: ${why}`)
}
const root = new URL('..', import.meta.url).pathname
const read = (rel: string) => readFileSync(join(root, rel), 'utf8')

// ── OAuth callbacks bind state to the signed-in user ────────────────────────
for (const [rel, label] of [
  ['app/api/auth/youtube/callback/route.ts', 'YouTube'],
  ['app/api/auth/gsc/callback/route.ts', 'Search Console'],
] as const) {
  const src = read(rel)
  check(`${label} callback refuses a state that is not the session user`,
    /userId\s*!==\s*user\.id/.test(src) && /!userId\s*\|\|/.test(src),
    'it trusted the uid in state and fell back to the session when state was missing, so a link carrying someone else\'s Google code connected THEIR account to whoever clicked it')
  check(`${label} callback no longer adopts the session user when state is missing`,
    !/userId\s*=\s*user\?\.id\s*\?\?\s*null/.test(src),
    'that fallback is the CSRF: no state at all meant "use whoever is signed in"')
}

// Every OAuth callback compares state with the session user somewhere.
{
  const dir = join(root, 'app/api/auth')
  const callbacks: string[] = []
  const walk = (d: string) => {
    for (const e of readdirSync(d)) {
      const f = join(d, e)
      if (statSync(f).isDirectory()) walk(f)
      else if (e === 'route.ts' && /\/callback\/route\.ts$/.test(f) && !/\/api\/auth\/callback\//.test(f)) callbacks.push(f)
    }
  }
  walk(dir)
  for (const f of callbacks) {
    const src = readFileSync(f, 'utf8')
    check(`${f.replace(root, '')} checks state against the session user`,
      /auth\.getUser\(\)/.test(src) && /(state|stateUserId|userId)\s*!==\s*user\.id/.test(src),
      'an OAuth callback that does not bind state to the session lets a crafted link plant another person\'s tokens')
  }
}

// ── no OAuth token in a redirect URL ────────────────────────────────────────
{
  const src = read('app/api/auth/facebook/callback/route.ts')
  check('Facebook callback does not put a token in the redirect',
    !/debug_token=/.test(src) && !/redirect\([^)]*(longToken|shortToken|access_token)/.test(src),
    'the long-lived Facebook token went into ?debug_token=, so into history, logs and Referer')
}

// ── paid signup has the locks the normal signup has ─────────────────────────
{
  const route = read('app/api/auth/signup-paid/route.ts')
  const createAt = route.indexOf('auth.admin.createUser')
  const captchaAt = route.indexOf('turnstileOk(')
  const throttleAt = route.indexOf('paidSignupThrottled(')
  check('paid signup verifies the captcha before creating the account',
    captchaAt > 0 && captchaAt < createAt,
    'this route creates a CONFIRMED account with the service key, so Supabase\'s own captcha never sees it')
  check('paid signup is throttled per network before creating the account',
    throttleAt > 0 && throttleAt < createAt,
    'without it a script could mint Free accounts, each with an AI allowance, as fast as it liked')
  const form = read('components/auth/SignupForm.tsx')
  check('the signup form sends its captcha token to the paid route',
    /signup-paid[\s\S]{0,800}captchaToken:\s*token/.test(form),
    'a server check on a token the form never sends refuses every buyer')
  check('one IP hashes the same way twice and two IPs do not collide',
    signupIpHash('1.2.3.4') === signupIpHash('1.2.3.4') && signupIpHash('1.2.3.4') !== signupIpHash('1.2.3.5') && signupIpHash('') === null,
    'the ceiling counts by this hash')
  check('the ceiling is a small number', PAID_SIGNUPS_PER_IP_HOUR > 0 && PAID_SIGNUPS_PER_IP_HOUR <= 20, 'a ceiling nobody reaches is not one')
  const saved = { s: process.env.TURNSTILE_SECRET_KEY, k: process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY }
  process.env.TURNSTILE_SECRET_KEY = 'x'; delete process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY
  check('the captcha is not demanded while the form cannot show it', !captchaEnforced(),
    'requiring a token the form has no widget for would refuse every buyer')
  process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY = 'y'
  check('the captcha is demanded once both keys are set', captchaEnforced(), 'otherwise setting the secret changes nothing')
  if (saved.s === undefined) delete process.env.TURNSTILE_SECRET_KEY; else process.env.TURNSTILE_SECRET_KEY = saved.s
  if (saved.k === undefined) delete process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY; else process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY = saved.k
}

// ── entitlement columns are server-only ─────────────────────────────────────
{
  const sql = read('supabase/migrations/410_security_entitlements_and_signup_throttle.sql')
  for (const col of ['limits_cohort', 'legacy_creator_newsletter']) {
    check(`the billing guard pins ${col}`, new RegExp(`new\\.${col}\\s*:=\\s*old\\.${col}`).test(sql),
      'a member could set it on their own row through the public API and keep the older, higher caps')
  }
  check('the guard still pins tier', /new\.tier\s*:=\s*old\.tier/.test(sql), 'the function is replaced whole, so dropping a line reopens 393')
  check('migration 410 is safe to run twice',
    /create or replace function/.test(sql) && /drop trigger if exists/.test(sql) && /create table if not exists public\.signup_attempts/.test(sql),
    'Seb pastes migrations by hand, sometimes twice')
}

// ── the shared CC catalogue ─────────────────────────────────────────────────
{
  const src = read('app/api/campaigns/ingest-live/route.ts')
  check('live ingest requires Creator Connections access', /ccAccessOk\(/.test(src),
    'any signed-in account could rewrite the catalogue every member browses')
  check('live ingest bounds its batch', /MAX_LIVE_CAMPAIGNS/.test(src) && /\.slice\(0, MAX_LIVE_CAMPAIGNS\)/.test(src),
    'one request could overwrite the whole catalogue')
}

// ── Instagram token stays encrypted ─────────────────────────────────────────
for (const rel of ['lib/ig-dm.ts', 'lib/instagram-publish.ts']) {
  const src = read(rel)
  check(`${rel} decrypts the stored Instagram token`, /maybeDecrypt\(integ\?\.instagram_access_token/.test(src),
    'the callback stores it encrypted; reading it raw hands ciphertext to Meta')
  check(`${rel} encrypts a refreshed Instagram token`, /instagram_access_token:\s*maybeEncrypt\(/.test(src),
    'the refresh wrote the new token back in plain text')
}

// ── post HTML is made inert before it reaches the page ──────────────────────
{
  check('javascript: is a script URL', isScriptUrl('javascript:alert(1)') && isScriptUrl(' JaVa\tScRiPt:alert(1)'), 'the obvious one, and its spaced, mixed-case spelling')
  check('data:text/html is a script URL', isScriptUrl('data:text/html,<script>1</script>'), 'it runs as a page')
  check('an https link is not', !isScriptUrl('https://example.com/a') && !isScriptUrl('/relative'), 'ordinary links must survive')
  check('without a DOM, inertHtml escapes rather than passes through',
    !/<img/.test(inertHtml('<img src=x onerror=alert(1)>')),
    'the fallback has to be the safe direction')
  for (const [rel, pat] of [
    ['app/(dashboard)/articles/page.tsx', /__html:\s*inertHtml\(preview\.html\)/],
    ['components/content/ManualEdit.tsx', /innerHTML\s*=\s*inertHtml\(html\)/],
    ['components/content/BlogEditModal.tsx', /innerHTML\s*=\s*inertHtml\(/],
  ] as const) {
    check(`${rel} renders post HTML through inertHtml`, pat.test(read(rel)),
      'post HTML can come from web research, WordPress or a VA, and one onerror ran with the creator\'s session')
  }
}

// ── Creator Connections access, 2026-10-07 (Seb) ─────────────────────────────
{
  const { readFileSync: rf } = require('node:fs') as typeof import('node:fs')
  const V = rf('app/api/campaigns/cc-verify/route.ts', 'utf8')
  check('CC access is proved by real campaign ids from SCOUT\'s scan, not a button',
    /campaignIds/.test(V) && /from\('cc_campaign_catalog'\)\.select\('campaign_id', \{ count: 'exact', head: true \}\)\.in\('campaign_id', ids\)/.test(V)
    && /if \(matched < Math\.min\(MIN_MATCHED, ids\.length\)\)/.test(V), 'see the Creator Connections access block in this guard')
  check('and lasts 30 days', /const VERIFY_TTL_DAYS = 30/.test(V) && /CC_VERIFY_TTL_MS = 30 \* 86_400_000/.test(rf('lib/cc-access.ts', 'utf8')), 'see the Creator Connections access block in this guard')
  for (const f of ['components/campaigns/CampaignBrowsePanel.tsx', 'app/(dashboard)/cc-campaigns/page.tsx', 'components/campaigns/SmartScanPanel.tsx']) {
    check(`${f} sends the campaign ids it saw`, /campaignIds: [a-z.]+\.map\(m => m\.campaignId\)/.test(rf(f, 'utf8')), 'see the Creator Connections access block in this guard')
  }
  const L = rf('app/api/campaigns/ingest-live/route.ts', 'utf8')
  check('a member scan only refreshes live numbers on campaigns already in the catalogue',
    /if \(!old\) \{ unknown\+\+; continue \}/.test(L) && /const LIVE_FIELDS = \['available_slot', 'total_slot', 'budget', 'budget_remaining', 'rating', 'review_count'\] as const/.test(L), 'see the Creator Connections access block in this guard')
  check('with a daily cap per account and every change signed', /DAILY_ROWS_PER_ACCOUNT = 3000/.test(L) && /last_live_by: user\.id, last_live_at: stamp/.test(L), 'see the Creator Connections access block in this guard')
}

if (failures.length) {
  console.error(`test-security-audit: ${failures.length} failure(s)\n`)
  for (const f of failures) console.error(`  x ${f}\n`)
  process.exit(1)
}
console.log('test-security-audit: all checks passed')

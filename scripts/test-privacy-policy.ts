// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// THE PRIVACY POLICY MEETS YOUTUBE'S REQUIREMENTS AND SAYS WHAT THE CODE DOES.
//
// Google reviews the policy against the app for the YouTube API quota audit
// (2026-10-05). YouTube API Developer Policies III.A.2 lists what it must
// contain, and III.E.4 how long YouTube data may be kept: refreshed or deleted
// every 30 days, deleted within 7 days of a disconnect. Each promise here is
// checked against the code that keeps it.
//
// Run: npx tsx scripts/test-privacy-policy.ts
import { readFileSync } from 'node:fs'

const failures: string[] = []
const check = (name: string, ok: boolean) => { if (!ok) failures.push(name) }
const r = (p: string) => readFileSync(p, 'utf8')
const P = r('app/privacy/page.tsx')
const text = P.slice(P.indexOf('return ('))

// ── III.A.2 ─────────────────────────────────────────────────────────────────
check('says it uses YouTube API Services', /uses <strong>YouTube API Services<\/strong>/.test(text))
check('links the Google Privacy Policy at the address the policy names', text.includes('href="http://www.google.com/policies/privacy"'))
check('links the YouTube Terms of Service', text.includes('href="https://www.youtube.com/t/terms"'))
check('says what it accesses, stores, uses and shares', /What we access\./.test(text) && /What we store\./.test(text) && /What we do with it/.test(text) && /Who we share it with\./.test(text))
check('names the AI providers YouTube text is processed by', /processed by\s+the AI providers listed in section 9/.test(text) && /Anthropic, OpenAI, Google \(Gemini\)/.test(text))
check('discloses cookies and device storage', /Cookies and Data Stored on Your Device/.test(text) && /_fbp/.test(text))
check('says whether third parties serve ads in the App', /does not let third parties serve advertisements/.test(text))
check('links Google\'s security settings page for revoking access', text.includes('href="https://security.google.com/settings/security/permissions"'))
check('gives a contact for questions and complaints', /questions, complaints/.test(text) && /mailto:us@gominplanet\.com/.test(text))
check('states the Limited Use commitment', /Limited Use requirements/.test(text))

// ── III.E.4: the retention it promises is the retention the code enforces ──
check('promises 30-day refresh, deletion on disconnect, and 30 days after a Google-side revoke',
  /refreshed from YouTube at\s+least every 30 days, or deleted/.test(text) && /straight away/.test(text) && /deleted within 30 days/.test(text))
const D = r('app/api/auth/youtube/disconnect/route.ts')
check('disconnect revokes at Google and empties the stored YouTube data',
  /oauth2\.googleapis\.com\/revoke/.test(D) && /await clearYouTubeData\(sb, user\.id\)/.test(D))
const R = r('lib/youtube-retention.ts')
check('the retention pass refreshes rows older than 30 days', /export const YT_REFRESH_DAYS = 30/.test(R) && /export async function retentionPass/.test(R))
check('and empties what YouTube no longer shows, only when every way of asking answered',
  /if \(failed \|\| !order\.length\) return \{ found, gone: \[\], quota: false \}/.test(R) && /if \(got\.gone\.length\) \{ await clearYouTubeData\(sb, userId, got\.gone\)/.test(R) && /if \(!connectedOf\(chans, integ\)\) \{\s*\/\/ Disconnected in MVP/.test(R))
check('a 401 or a token that threw is never taken for a revoked login or a deleted video',
  !/got\.revoked\) \{ await clearYouTubeData/.test(R) && /\} catch \{ trouble = true \}/.test(R) && /let failed = logins\.trouble/.test(R))
check('a whole chunk nobody sees empties nothing', /if \(pending\.length >= 10 && pending\.length === ids\.length\) return \{ found, gone: \[\], quota: false \}/.test(R))
check('rows emptied for creators still connected are refilled, and the refill never empties', /export async function restorePass/.test(R) && !/clearYouTubeData/.test(R.slice(R.indexOf('export async function restorePass'))) && /restorePass\(sb, 2000, deadline\)/.test(r('app/api/cron/youtube-data-retention/route.ts')))
check('the emptied fields include every YouTube field the policy lists',
  ['title', 'description', 'thumbnail_url', 'view_count', 'transcript'].every((f) => new RegExp(`\\b${f}:`).test(R.slice(R.indexOf('YT_CLEARED_FIELDS'), R.indexOf('} as const')))))
check('an emptied row loses its last-refreshed time, so the refill takes it next run', /update\(\{ yt_refreshed_at: null \}\)/.test(R.slice(R.indexOf('export async function clearYouTubeData'), R.indexOf('type Fresh'))))
{
  const A = r('app/api/admin/youtube-restore/route.ts')
  check('the admin Refill now is admin only and only refills', /if \(caller\?\.tier !== 'admin'\) return NextResponse\.json\(\{ error: 'Admin only' \}, \{ status: 403 \}\)/.test(A) && /restorePass\(sb, 2500/.test(A) && !/clearYouTubeData/.test(A))
}
const V = JSON.parse(r('vercel.json')) as { crons: Array<{ path: string }> }
check('the retention pass runs every day', V.crons.some((c) => c.path === '/api/cron/youtube-data-retention'))
check('migration 406 adds the refresh stamp, safe to run twice', /add column if not exists yt_refreshed_at/.test(r('supabase/migrations/406_youtube_data_retention.sql')))

// ── it does not promise what the product does not do ───────────────────────
check('no claim that nothing runs in the background (scheduled uploads and comments do)',
  !/no background scheduling/i.test(text) && !/never post, upload, or change anything in the background/i.test(text))
check('describes background actions honestly', /Some of these run in the background after you set them up/.test(text))
check('no dash punctuation in the policy text', !/[—–]| - /.test(text.replace(/className="[^"]*"/g, '')))

if (failures.length) {
  console.error(`\n❌ privacy-policy: ${failures.length} failure(s)\n`)
  for (const f of failures) console.error(`   • ${f}`)
  process.exit(1)
}
console.log('✓ privacy-policy: meets YouTube API policy III.A.2, and the retention it promises is the retention the code enforces')

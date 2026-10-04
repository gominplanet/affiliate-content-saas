/**
 * VIRTUAL ASSISTANTS PUBLISH THROUGH THE OWNER'S ACCOUNTS.
 *
 * The owner connects each social once; a VA with "Publish to socials" posts
 * and schedules through those connections without ever logging into them
 * (lib/agency-publish). For a VA the routes run on the service role, so the
 * one rule that keeps that safe is checked here, route by route: every query
 * names the owner's user_id, or writes rows that carry it.
 *
 * Run: npx tsx scripts/test-va-publish.ts
 */
import { readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'

const read = (p: string) => readFileSync(p, 'utf8')
const failures: string[] = []
const check = (name: string, ok: boolean) => { if (!ok) failures.push(name) }

// ── The helper ──────────────────────────────────────────────────────────────
const H = read('lib/agency-publish.ts')
check('an owner keeps their own session (RLS as before)', /if \(ctx\.effectiveOwnerUserId === user\.id\) return \{ user, supabase: session, realUser: user, isOwner: true \}/.test(H))
check('a VA without "Publish to socials" is refused with the reason', /mode === 'publish' && !hasPermission\(ctx, 'publish_to_socials'\)/.test(H) && /VA_NO_PUBLISH_MESSAGE/.test(H))
check('a VA works as the owner: the owner\'s id on every query', /user: \{ \.\.\.user, id: ctx\.effectiveOwnerUserId, email \}/.test(H))

// ── Every publishing and scheduling route goes through it ───────────────────
const MUST = [
  'facebook-post', 'instagram-post', 'pinterest-post', 'tiktok-post', 'threads-post', 'twitter-post', 'bluesky-post',
  'telegram-post', 'linkedin-post', 'schedule-post', 'schedule-publish', 'scheduled-list', 'schedule-edit',
  'scheduled-cancel', 'facebook-group-teaser', 'schedule-cascade-only', 'pinterest-preview',
].map((n) => `app/api/blog/${n}/route.ts`).concat([
  'app/api/blog/tiktok-post/schedule/route.ts', 'app/api/blog/tiktok-post/video/route.ts', 'app/api/blog/tiktok-post/status/route.ts',
  'app/api/blog/tiktok-post/video/status/route.ts', 'app/api/blog/tiktok-post/creator-info/route.ts',
  'app/api/social-accounts/route.ts', 'app/api/youtube/calendar/route.ts', 'app/api/clip-factory/facebook-reel/route.ts',
  'app/api/instagram/publish-burned/route.ts', 'app/api/instagram/post-direct-video/route.ts', 'app/api/tiktok/publish-burned/route.ts',
  'app/api/tiktok/publish-burned/status/route.ts', 'app/api/pinterest/video-pin/route.ts', 'app/api/pinterest/boards/route.ts',
  'app/api/youtube/upload-short/route.ts', 'app/api/youtube/upload-video/route.ts', 'app/api/youtube/shorts-status/route.ts',
])
for (const f of MUST) {
  const src = read(f)
  check(`${f}: goes through getPublishContext`, /const pub = await getPublishContext\(await createServerClient\(\)/.test(src) && !/supabase\.auth\.getUser\(\)/.test(src))
}

// ── THE RULE: every query names the owner, or writes rows that carry them ──
// A row loaded earlier with the owner filter is allowed by id only where the
// write is an insert of rows built with user_id (checked by eye, listed here).
const INSERTS_OF_OWNER_ROWS = new Set([
  'app/api/blog/schedule-cascade-only/route.ts:insert(childRows)', 'app/api/blog/schedule-cascade-only/route.ts:insert(legacyRows)',
  'app/api/blog/schedule-publish/route.ts:insert(childRows)', 'app/api/blog/schedule-publish/route.ts:insert(legacyRows)',
  'app/api/blog/schedule-edit/route.ts:insert(rows)', 'app/api/blog/schedule-edit/route.ts:insert(legacy)',
  'app/api/blog/tiktok-post/schedule/route.ts:insert(rows)',
])
const routes = execSync('grep -rl getPublishContext app/api --include=route.ts').toString().trim().split('\n')
for (const f of routes) {
  const s = read(f)
  const ms = [...s.matchAll(/\.from\('([a-z_]+)'\)/g)]
  ms.forEach((m, k) => {
    const start = m.index ?? 0
    const stop = k + 1 < ms.length ? (ms[k + 1].index ?? s.length) : s.length
    let chunk = s.slice(start, Math.min(stop, start + 600))
    const end = chunk.search(/\n\s*\n|\n\s*(const|let|if|await|return|try|\/\/)\b|\n\s*\}(?!\))/)
    if (end > 0) chunk = chunk.slice(0, end + 1)
    if (/user_id/.test(chunk)) return
    const ins = chunk.match(/\.insert\((\w+)\)/)
    if (ins && INSERTS_OF_OWNER_ROWS.has(`${f}:insert(${ins[1]})`)) return
    failures.push(`${f}:${s.slice(0, start).split('\n').length}: a query that does not name the owner (${chunk.replace(/\s+/g, ' ').slice(0, 90)})`)
  })
}

// ── What the VA sees ────────────────────────────────────────────────────────
for (const f of ['app/api/social/connected/route.ts', 'app/api/social/health/route.ts', 'app/api/connections/checkup/route.ts']) {
  check(`${f}: reads the owner's connections for a VA`, /const supabase = auth\.isOwner \? session : \(createAdminClient\(\) as any\)/.test(read(f)))
}
const CS = read('app/(dashboard)/connect-socials/page.tsx')
check('a VA sees the owner\'s connections on Connect Socials, with no connect buttons', /if \(who\.isVa\) return \(/.test(CS) && /<VaConnections who=\{who\} \/>/.test(CS))
const CP = read('app/(dashboard)/content/page.tsx')
check('Social Push loads the owner\'s library and connections for a VA', /const uid = isVa \? \(who!\.ownerId as string\) : user\.id/.test(CP) && /if \(isVa\) \{[\s\S]{0,400}\/api\/social\/connected/.test(CP))
const MW = read('middleware.ts')
check('a VA cannot start a social connect or disconnect (it would land on their own login)', /\/\^\\\/api\\\/auth\\\/\(facebook\|instagram\|threads\|pinterest\|tiktok\|twitter\|linkedin\|bluesky\|telegram\)/.test(MW) && /Only the account owner can connect or disconnect social accounts/.test(MW))
check('the cron publishes each queued row as its user_id, which is now the owner', /user_id/.test(read('app/api/cron/process-scheduled/route.ts')))

if (failures.length) {
  console.error('❌ va-publish guard failed:\n  - ' + failures.join('\n  - '))
  process.exit(1)
}
console.log(`✓ va-publish guard passed (${routes.length} routes publish as the owner, every query names them)`)

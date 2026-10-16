// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// LIVE HASHTAG DATA FROM THE PLATFORMS (lib/hashtag-trends; Seb, 2026-10-16:
// "lifting them from like TikTok Creative Center's trending hashtags... the
// same thing with YouTube... the same thing with Instagram as well").
//
// Held on answers shaped like the real ones: Creative Center's list (with a
// promoted tag, which is an ad and never a trend, and the country in the
// address), the rows SCOUT reads off the page when the answers are missing,
// YouTube's "2M videos • 505K channels", and Instagram's post counts. A read
// that fails is nothing, never zero; a dead tag is kept, so the engine knows
// to avoid it and SCOUT does not ask about it again tomorrow.
import { readFileSync } from 'node:fs'
import { compactNumber, parseTikTokCC, parseTikTokList, readTikTokTrends, TIKTOK_INDUSTRIES, TIKTOK_LIST_URL, parseYouTubeHashtagPage, parseInstagramCounts, saveTrends, worthKeeping, trendTag } from '../lib/hashtag-trends'

const fails: string[] = []
const check = (name: string, ok: boolean | undefined, detail?: unknown) => { if (!ok) fails.push(`${name}${detail !== undefined ? `: ${JSON.stringify(detail)}` : ''}`) }
const read = (f: string) => readFileSync(f, 'utf8')

async function main() {
  check('numbers as the platforms write them', compactNumber('2M') === 2_000_000 && compactNumber('505K') === 505_000 && compactNumber('1.2B') === 1_200_000_000 && compactNumber('12,345') === 12_345 && compactNumber('lots') === null)
  check('a trend tag is a clean tag or nothing', trendTag('AirFryer') === '#airfryer' && trendTag('fyp') === null && trendTag('deals2026') === null)

  const cc = parseTikTokCC([
    { url: 'https://ads.tiktok.com/creative_radar_api/v1/popular_trend/hashtag/list?page=1&limit=20&period=7&country_code=GB&sort_by=popular', body: { code: 0, data: { list: [
      { hashtag_name: 'airfryer', rank: 3, publish_cnt: 12000, video_views: 50_000_000, industry_info: { value: 'Home Improvement' } },
      { hashtag_name: 'brandpromo', rank: 1, is_promoted: true, publish_cnt: 900 },
      { hashtag_name: 'fyp', rank: 2, publish_cnt: 5e9 },
    ] } } },
    { rows: [{ name: 'kitchenhacks', rank: 9, posts: '45K' }, { name: 'airfryer', rank: 30, posts: '1K' }] },
  ])
  const air = cc.find((r) => r.tag === '#airfryer')
  check('Creative Center: rank, posts, views and industry as TikTok sent them', !!air && air.rank === 3 && air.posts === 12000 && air.views === 50_000_000 && /Home Improvement/.test(air.label || ''), air)
  check('Creative Center: the country comes from the address', air?.region === 'GB', air)
  check('a promoted tag is an ad, never a trend', !cc.some((r) => r.tag === '#brandpromo'), cc)
  check('spam is never a trend', !cc.some((r) => r.tag === '#fyp'), cc)
  check('rows read off the page fill in, never over the answers', cc.some((r) => r.tag === '#kitchenhacks' && r.posts === 45_000 && r.region === 'US') && cc.filter((r) => r.tag === '#airfryer').length === 1 && air?.rank === 3, cc)
  check('nothing read is nothing', parseTikTokCC([]).length === 0 && parseTikTokCC([{ url: 'x', body: { code: 40101, msg: 'no permission' } }]).length === 0)

  // THE LIST CREATIVE CENTER ASKS FOR NOW (2026-10-16: it moved to
  // /creative/creativeCenter/trends; SCOUT's read of the old page hit Chrome's
  // error page). Shaped like TikTok's real answer.
  const answer = { BaseResp: { StatusCode: 0 }, items: [
    { hashtagID: '1', hashtagName: 'cordlessvacuum', industryIDs: [16000000000], publishCnt: 5761, rankIndex: 3, vv: 1_200_000, popularityCurve: [] },
    { hashtagID: '2', hashtagName: 'fyp', publishCnt: 9e9, rankIndex: 1, vv: 1 },
    { hashtagID: '3', hashtagName: 'บรีสเอกเซล', publishCnt: 12, rankIndex: 2, vv: 3 },
  ], pagination: { hasMore: false, limit: 3, page: 1, totalCount: 3 } }
  const list = parseTikTokList(answer, { country: 'US', period: 7, industry: '16000000000' })
  check('Creative Center now: name, rank, posts and views as TikTok sent them, and the label says where and when', list.length === 1 && list[0].tag === '#cordlessvacuum' && list[0].rank === 3 && list[0].posts === 5761 && list[0].views === 1_200_000 && list[0].label === '#3 trending on TikTok in Appliances this week', list)
  check('spam and tags in other scripts are never trends', !list.some((r) => r.tag === '#fyp') && list.length === 1)
  check('the camelCase answer also reads through the older parser', parseTikTokCC([answer]).some((r) => r.tag === '#cordlessvacuum' && r.rank === 3))
  check('every Creative Center industry has its label, Appliances included', Object.keys(TIKTOK_INDUSTRIES).length === 21 && TIKTOK_INDUSTRIES['16000000000'] === 'Appliances' && TIKTOK_INDUSTRIES['14000000000'] === 'Beauty & Personal Care')

  // The read itself, with TikTok stood in: every list asked, a number for the
  // period and industry (TikTok refuses strings), each tag kept once at its best.
  const sent: Array<Record<string, unknown>> = []
  const okFetch = (async (url: string, init: { body: string }) => {
    const b = JSON.parse(init.body) as Record<string, unknown>
    sent.push(b)
    const items = b.industryID === 16000000000 ? [{ hashtagName: 'cordlessvacuum', rankIndex: 2, publishCnt: 900, vv: 10 }] : b.industryID == null ? [{ hashtagName: 'cordlessvacuum', rankIndex: 1, publishCnt: 900, vv: 10 }, { hashtagName: 'halloween', rankIndex: 2, publishCnt: 5e6, vv: 9e9 }] : []
    return new Response(JSON.stringify({ items, pagination: { totalCount: items.length } }), { status: url === TIKTOK_LIST_URL ? 200 : 404 })
  }) as unknown as typeof fetch
  const ttRead = await readTikTokTrends('US', { fetcher: okFetch })
  check('every list is asked: overall and 21 industries, this week and this month', ttRead.asked === 44 && ttRead.answered === 44 && sent.length === 44)
  check('TikTok is sent numbers, never strings', sent.every((b) => typeof b.timeRange === 'number' && (b.industryID === undefined || typeof b.industryID === 'number')))
  const vac = ttRead.rows.filter((r) => r.tag === '#cordlessvacuum')
  check('a tag is kept once, at its industry showing this week', vac.length === 1 && /in Appliances this week/.test(vac[0].label || ''), vac)
  const refused = await readTikTokTrends('US', { fetcher: (async () => new Response(JSON.stringify({ code: 'InvalidRequest', message: 'bad' }), { status: 400 })) as unknown as typeof fetch })
  check('a night TikTok refused reads as refused, never as a quiet night', refused.answered === 0 && refused.rows.length === 0 && /400/.test(refused.error || ''), refused)

  const yt = parseYouTubeHashtagPage('{"pageHeaderRenderer":{"content":"2M videos • 505K channels"}}')
  check('YouTube: videos and channels from the hashtag page', yt.videos === 2_000_000 && yt.channels === 505_000, yt)
  check('YouTube: a page without counts is no reading, never zero', parseYouTubeHashtagPage('<html>nothing here</html>').videos === null)

  const ig = parseInstagramCounts([{ tag: 'airfryer', posts: 4_200_000 }, { tag: 'tinytag', posts: 300 }, { tag: 'cosori', posts: null }, { tag: 'x', posts: 5 }, { tag: 'neg', posts: -4 }])
  check('Instagram: counts as SCOUT read them', ig.some((r) => r.tag === '#airfryer' && r.posts === 4_200_000 && /4\.2M posts/.test(r.label || '')), ig)
  check('Instagram: a missing count is no reading, never zero', !ig.some((r) => r.tag === '#cosori') && !ig.some((r) => r.tag === '#neg'), ig)
  check('a dead tag is kept (so it is avoided, and not asked about again)', ig.some((r) => r.tag === '#tinytag') && worthKeeping({ platform: 'instagram', tag: '#tinytag', source: 'instagram', posts: 300 }), ig)
  check('a row with no count is not kept', !worthKeeping({ platform: 'instagram', tag: '#x', source: 'instagram', posts: null }))

  // saveTrends writes one upsert to the shared table, keyed per platform, tag, source and region.
  const calls: Array<{ rows: Array<Record<string, unknown>>; opts: unknown }> = []
  const admin = { from: (t: string) => ({ upsert: async (rows: Array<Record<string, unknown>>, opts: unknown) => { calls.push({ rows, opts }); return { error: t === 'hashtag_trends' ? null : { message: 'wrong table' } } } }) }
  const saved = await saveTrends(admin, [...cc, ...ig])
  check('saved to hashtag_trends in one upsert, on the table key', saved.saved === cc.length + ig.length && calls.length === 1 && JSON.stringify(calls[0].opts) === JSON.stringify({ onConflict: 'platform,tag,source,region' }), { saved, opts: calls[0]?.opts })
  check('every saved row has a region and a time', calls[0]?.rows.every((r) => typeof r.region === 'string' && typeof r.seen_at === 'string'))
  const missing = await saveTrends({ from: () => ({ upsert: async () => ({ error: { message: 'relation "public.hashtag_trends" does not exist' } }) }) }, ig)
  check('before migration 434 nothing is claimed saved', missing.saved === 0 && /does not exist/.test(missing.error || ''))

  // ── The routes and the schedule ─────────────────────────────────────────────
  const ROUTE = read('app/api/hashtags/trends/route.ts')
  check('reading on demand is Labs only, and what SCOUT sends is parsed, never trusted', /if \(!\(await allowed\(admin, user\.id\)\)\) return NextResponse\.json\(\{ error: 'Live hashtag reading is in Labs\.' \}, \{ status: 403 \}\)/.test(ROUTE) && /parseInstagramCounts\(Array\.isArray\(body\.items\)/.test(ROUTE))
  check('the page is told what was actually read, dead ends included', /tiktokTop/.test(ROUTE) && /instagramRecent/.test(ROUTE) && /trendStanding\(/.test(ROUTE))
  check('a read with nothing in it says so', /TikTok Creative Center answered but listed no usable hashtags\./.test(ROUTE) && /SCOUT read no Instagram counts\./.test(ROUTE))
  const CRON = read('app/api/cron/hashtag-trends/route.ts')
  check('TikTok is read every night by MVP itself, and what it read is reported', /const tt = await readTikTokTrends\('US'\)/.test(CRON) && /tiktok = \{ asked: tt\.asked, answered: tt\.answered/.test(CRON))
  check('the card reads TikTok through MVP, not SCOUT, and says how many lists answered', /action: 'tiktok', country: 'US'/.test(read('components/pulse/HashtagTrends.tsx')) && !/requestTikTokTrends/.test(read('components/pulse/HashtagTrends.tsx')) && /readTikTokTrends\(/.test(ROUTE) && /TikTok Creative Center did not answer/.test(ROUTE))
  check('YouTube is read every night by MVP itself', /readYouTubeHashtag\(/.test(CRON) && (JSON.parse(read('vercel.json')).crons as Array<{ path: string }>).some((c) => c.path === '/api/cron/hashtag-trends'))
  check('a tag YouTube did not answer for is left as it was', /if \(g\) rows\.push\(g\); else unanswered\+\+/.test(CRON))
  check('the engine reads the trends for each platform', /trendsFor\(input\.platform\)/.test(read('lib/hashtag-data.ts')))
  const GATE = read('lib/labs-preview.ts')
  check('Live hashtag data is behind Labs (Seb only while it is tested)', /hashtag_trends: 'admin'/.test(GATE))
  const CARD = read('components/pulse/HashtagTrends.tsx')
  check('the card says what failed in words, and runs itself once a session when stale', /IG_WHY/.test(CARD) && /sessionStorage\.setItem\(AUTO_KEY/.test(CARD) && /if \(!info \|\| !info\.allowed\) return null/.test(CARD))
  check('the card copy has no dashes', !/[–—]| - /.test(CARD.replace(/\/\/.*$|\/\*[\s\S]*?\*\//gm, '').match(/'[^'\n]{12,}'|`[^`\n]{12,}`|>[^<>{}\n]{12,}</g)?.join(' ') || ''))
  const MIG = read('supabase/migrations/434_hashtag_engine.sql')
  check('migration 434 is safe to run twice', /create table if not exists public\.hashtag_trends/.test(MIG) && (MIG.match(/add column if not exists/g) || []).length === 2 && !/create index (?!if not exists)/.test(MIG) && /primary key \(platform, tag, source, region\)/.test(MIG))
  check('SCOUT version bumped for the hashtag reads', /SCOUT_HASHTAG_TRENDS_MIN_VERSION = '1\.49\.0'/.test(read('lib/scout-version.ts')) && /^1\.(49|5\d)\.\d+$/.test(JSON.parse(read('extension/manifest.json')).version))

  if (fails.length) { console.error('hashtag-trends failed:\n - ' + fails.join('\n - ')); process.exit(1) }
  console.log('✅ hashtag-trends: TikTok Creative Center (promoted tags out), YouTube hashtag pages and Instagram counts read as the platforms wrote them; a failed read is nothing, a dead tag is remembered')
}
void main()

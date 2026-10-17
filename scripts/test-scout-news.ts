// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// THE SCOUT NEWS CARD (lib/scout-news, components/dashboard/MvpNews since the
// daily What's new card took it in,
// app/api/scout/whats-new; Seb, 2026-10-17: "an automatic pop up when users
// first open MVP Affiliate.. anytime there is a new scout update ... the
// latest, newest features ... and also a randomized YouTube video that they
// can watch right there on the card").
//
// What it holds: once per release with news, per browser; a Web Store SCOUT
// hears about a release only once Chrome has delivered it (never told to
// update what it cannot), no SCOUT gets "Get SCOUT" only on a desktop browser
// that can run it, the old manual copy is sent to the Web Store, a member
// sees only notes for what their plan has, and the card plays the channel's
// three latest videos (Seb, the same day: "let's have the latest three
// published videos to watch on that card"), no Shorts and nothing still to
// come, from youtube-nocookie.
import { readFileSync } from 'node:fs'
import { SCOUT_RELEASES, scoutPopupPlan, releasesFor, parseChannelFeed, watchableVideos, latestVideos, uploadsPlaylist, MVP_CHANNEL_ID, MAX_NOTES, VIDEOS_ON_CARD, type ScoutRelease } from '../lib/scout-news'
import { SCOUT_LATEST_VERSION, scoutAtLeast } from '../lib/scout-version'
import { canUsePreview } from '../lib/labs-preview'
import { hasVideoTools } from '../lib/amazon-plan'

const fails: string[] = []
const check = (name: string, ok: boolean | undefined, detail?: unknown) => { if (!ok) fails.push(`${name}${detail !== undefined ? `: ${JSON.stringify(detail)}` : ''}`) }
const read = (f: string) => readFileSync(f, 'utf8')

// ── The releases ──
check('the newest release with news is not newer than the SCOUT MVP ships', SCOUT_RELEASES.every((r) => scoutAtLeast(SCOUT_LATEST_VERSION, r.version)), SCOUT_RELEASES.map((r) => r.version))
check('every release has notes, a date, and words with no dashes', SCOUT_RELEASES.every((r) => r.notes.length > 0 && /^\d{4}-\d\d-\d\d$/.test(r.date) && r.notes.every((n) => n.text.length > 30 && !/[–—]| - /.test(n.text))))
check('each note is a short overview line, not a manual', SCOUT_RELEASES.every((r) => r.notes.every((n) => n.text.length <= 110)), SCOUT_RELEASES.flatMap((r) => r.notes.filter((n) => n.text.length > 110).map((n) => n.text.length)))
check('no year in a note', !SCOUT_RELEASES.some((r) => r.notes.some((n) => /\b20\d\d\b/.test(n.text))))
check('no note claims vidIQ is handled (it still changes the time)', !SCOUT_RELEASES.some((r) => r.notes.some((n) => /vidiq/i.test(n.text))))

const R = (v: string, text = `Something new arrived in SCOUT version ${v} for members.`): ScoutRelease => ({ version: v, date: '2026-10-16', notes: [{ text }] })
const rel = [R('1.50.0'), R('1.48.0'), R('1.47.0')]

// ── Who sees it ──
const store = (installed: string, seen: string | null, extra: object = {}) => scoutPopupPlan({ kind: 'store', installed, seen, desktop: true, releases: rel, ...extra })
const s1 = store('1.50.0', null)
check('a store SCOUT on the newest release: what is new, all of it, newest first', s1?.mode === 'updated' && s1.version === '1.50.0' && s1.notes.map((n) => n.version).join() === '1.50.0,1.48.0,1.47.0' && s1.seenTo === '1.50.0', s1)
check('seen it: nothing', store('1.50.0', '1.50.0') === null)
const s2 = store('1.50.0', '1.48.0')
check('only what came after the last one seen', s2?.notes.length === 1 && s2.notes[0].version === '1.50.0', s2)
const s3 = store('1.48.0', '1.47.0')
check('a store SCOUT Chrome has not updated yet hears only about what it has', s3?.mode === 'updated' && s3.notes.every((n) => n.version !== '1.50.0') && s3.seenTo === '1.48.0', s3)
check('a store SCOUT behind, with everything it has seen: nothing, never "update now"', store('1.48.0', '1.48.0') === null)
check('Later hides it this visit only', store('1.50.0', null, { later: '1.50.0' }) === null && store('1.50.0', null, { later: '1.48.0' }) !== null)
check('?scoutnews opens it again even when seen', store('1.50.0', '1.50.0', { force: true })?.notes.length === 3)
const side = scoutPopupPlan({ kind: 'sideload', installed: '1.44.0', seen: null, desktop: true, releases: rel })
check('the old manual copy behind: pointed at the Web Store', side?.mode === 'move' && side.version === '1.50.0', side)
check('the manual copy on the newest release: just the news', scoutPopupPlan({ kind: 'sideload', installed: '1.50.0', seen: null, desktop: true, releases: rel })?.mode === 'updated')
const none = scoutPopupPlan({ kind: 'none', installed: null, seen: null, desktop: true, releases: rel })
check('no SCOUT on a desktop browser that can run it: Get SCOUT', none?.mode === 'get' && none.seenTo === '1.50.0', none)
check('no SCOUT on a phone or a browser that cannot run it: nothing', scoutPopupPlan({ kind: 'none', installed: null, seen: null, desktop: false, releases: rel }) === null)
check('SCOUT that answers without a version: nothing said about it', scoutPopupPlan({ kind: 'store', installed: null, seen: null, desktop: true, releases: rel }) === null)
const many = scoutPopupPlan({ kind: 'store', installed: '1.60.0', seen: null, desktop: true, releases: ['1.60.0', '1.59.0', '1.58.0', '1.57.0', '1.56.0', '1.55.0', '1.54.0'].map((v) => R(v)) })
check(`at most ${MAX_NOTES} lines, the newest`, many?.notes.length === MAX_NOTES && many.notes[0].version === '1.60.0', many?.notes.map((n) => n.version))
check('releases in any order are read newest first', scoutPopupPlan({ kind: 'store', installed: '1.50.0', seen: null, desktop: true, releases: [R('1.47.0'), R('1.50.0'), R('1.48.0')] })?.seenTo === '1.50.0')
check('nothing to say: nothing shown', scoutPopupPlan({ kind: 'store', installed: '1.50.0', seen: null, desktop: true, releases: [] }) === null)

// ── Only what the plan has ──
const canFor = (tier: string) => (g: Parameters<Parameters<typeof releasesFor>[0]>[0]) => g === 'video_tools' ? hasVideoTools(tier) : canUsePreview(g, tier)
const proNotes = releasesFor(canFor('pro')).flatMap((r) => r.notes.map((n) => n.text))
const amazonNotes = releasesFor(canFor('amazon')).flatMap((r) => r.notes.map((n) => n.text))
const adminNotes = releasesFor(canFor('admin')).flatMap((r) => r.notes.map((n) => n.text))
check('a feature still admin only is not news to members', !proNotes.some((t) => /^Pulse:/.test(t)) && adminNotes.some((t) => /^Pulse:/.test(t)))
check('TRYBE Send all is news on Pro, not on the Amazon plan', proNotes.some((t) => /Send all/.test(t)) && !amazonNotes.some((t) => /Send all/.test(t)))
check('the Page Reel is news on both plans', proNotes.some((t) => /Page Reel/.test(t)) && amazonNotes.some((t) => /Page Reel/.test(t)))

// ── The videos ──
const FEED = `<feed><entry><yt:videoId>RrVsrBwMG08</yt:videoId><title>How to Use Trybe &amp; Find Brands</title><link rel="alternate" href="https://www.youtube.com/watch?v=RrVsrBwMG08"/><published>2026-10-08T04:24:31+00:00</published></entry>
<entry><yt:videoId>abcdefghijk</yt:videoId><title>A Short</title><link rel="alternate" href="https://www.youtube.com/shorts/abcdefghijk"/></entry></feed>`
const fv = parseChannelFeed(FEED)
check('the feed: videos read, a Short left out, titles unescaped', fv.length === 1 && fv[0].id === 'RrVsrBwMG08' && fv[0].title === 'How to Use Trybe & Find Brands', fv)
const item = (id: string, over: object = {}) => ({ id, snippet: { title: 't', liveBroadcastContent: 'none', publishedAt: '2026-10-08T00:00:00Z' }, contentDetails: { duration: 'PT12M5S' }, status: { privacyStatus: 'public', embeddable: true }, ...over })
const api = watchableVideos([
  item('aaaaaaaaaaa'),
  item('bbbbbbbbbbb', { contentDetails: { duration: 'PT58S' } }),
  item('ccccccccccc', { liveStreamingDetails: { actualStartTime: 'x' } }),
  item('ddddddddddd', { status: { privacyStatus: 'unlisted', embeddable: true } }),
  item('eeeeeeeeeee', { status: { privacyStatus: 'public', embeddable: false } }),
  item('fffffffffff', { snippet: { title: 't', liveBroadcastContent: 'upcoming' }, contentDetails: { duration: 'P0D' } }),
  item('ggggggggggg', { contentDetails: { duration: 'PT1H2M' } }),
])
check('the API: long, public, embeddable, not live now; a Short, an unlisted, a blocked embed and a premiere left out, a live replay kept', api.map((v) => v.id).join() === 'aaaaaaaaaaa,ccccccccccc,ggggggggggg', api)
const dated = (id: string, published: string | null) => ({ id, title: id, published })
const latest = latestVideos([dated('old', '2026-07-01T00:00:00Z'), dated('nodate', null), dated('newest', '2026-10-16T05:00:00Z'), dated('mid', '2026-10-08T04:00:00Z'), dated('next', '2026-10-06T06:00:00Z')])
check('the card gets the three latest, newest first', VIDEOS_ON_CARD === 3 && latest.map((v) => v.id).join() === 'newest,mid,next', latest)
check('the uploads list of the MVP Affiliate channel', uploadsPlaylist(MVP_CHANNEL_ID) === 'UUyxAkGx_IbKVCs0Uon9MAfA' && MVP_CHANNEL_ID === 'UCyxAkGx_IbKVCs0Uon9MAfA')

// ── The wiring ──
const ROUTE = read('app/api/scout/whats-new/route.ts')
check('the route needs a session and filters notes by the member’s plan', /if \(!user\) return NextResponse\.json\(\{ error: 'Unauthorized' \}, \{ status: 401 \}\)/.test(ROUTE) && /releases: releasesFor\(can\)/.test(ROUTE) && /\.eq\('user_id', user\.id\)/.test(ROUTE))
check('the route sends the three latest', /videos = latestVideos\(got\.videos\)/.test(ROUTE))
check('the API first and counted, the feed after, kept 6 hours, a failure not kept', /await ytFetch\(pl\.toString\(\)/.test(ROUTE) && ROUTE.indexOf('ytFetch(pl') < ROUTE.indexOf('feeds/videos.xml') && /revalidate: 6 \* 3600/.test(ROUTE) && /throw new Error\(`\$\{apiWhy\}; \$\{feedWhy\}`\)/.test(ROUTE))
check('the feed’s videos are asked whether they are Shorts', /probeShort\(v\.id\)/.test(ROUTE) && /shorts\[k\] !== true/.test(ROUTE))
check('no video: it says why, never a blank frame', /videoError = e instanceof Error/.test(ROUTE))
const POP = read('components/dashboard/MvpNews.tsx')
check('the video plays in the card from youtube-nocookie', /https:\/\/www\.youtube-nocookie\.com\/embed\/\$\{video\.id\}/.test(POP))
check('the newest is ready to play, and all three are a click away', /setPick\(0\)/.test(POP) && /videos\.map\(\(v, i\) => \(/.test(POP) && /onClick=\{\(\) => choose\(i\)\}/.test(POP) && !/Math\.random/.test(POP))
check('no video says so and links the channel', /The videos could not load right now\./.test(POP) && /MVP_CHANNEL_URL/.test(POP))
check('Got it records the release; Later only this visit', /localSet\(SEEN_KEY, plan\.seenTo\)/.test(POP) && /sessionSet\(LATER_KEY, plan\.seenTo\)/.test(POP))
check('it waits for any other popup to close', /otherPopupOpen\(\)/.test(POP) && /:not\(\[data-mvp-news\]\)/.test(POP) && /data-mvp-news=""/.test(POP))
check('nothing to show: not even a request', POP.indexOf('if (!opensToday(') > 0 && POP.indexOf('if (!opensToday(') < POP.indexOf('const res = await load()'))
check('the button words are readable: white on dark orange', /const SCOUT_BUTTON = '#C2410C'/.test(POP))
const words = (POP.match(/>[^<>{}\n]{3,}</g) || []).join(' ') + (POP.match(/'[^'\n]{12,}'/g) || []).join(' ') + (POP.match(/`[^`\n]{12,}`/g) || []).join(' ')
check('the words on the card have no dashes', !/[–—]| - /.test(words))
check('Subscribe on YouTube opens YouTube\u2019s subscribe prompt, and Join the Facebook group is MVP\u2019s group', /export const MVP_SUBSCRIBE_URL = 'https:\/\/www\.youtube\.com\/@MVPaffiliate\?sub_confirmation=1'/.test(read('lib/scout-news.ts')) && /href=\{MVP_SUBSCRIBE_URL\}[^>]*target="_blank"/.test(POP) && /href=\{FACEBOOK_GROUP_URL\}[^>]*target="_blank"/.test(POP) && /Subscribe on YouTube/.test(POP) && /Join the Facebook group/.test(POP) && /FACEBOOK_GROUP_URL = 'https:\/\/www\.facebook\.com\/groups\/mvpaffiliate'/.test(read('lib/community.ts')))
check('mounted on every dashboard page', /<MvpNews tier=\{String\(effectiveTier\)\} \/>/.test(read('components/layout/DashboardShellV2.tsx')))

if (fails.length) { console.error('scout-news failed:\n - ' + fails.join('\n - ')); process.exit(1) }
console.log('✅ scout-news: once per SCOUT release, what is new for this member’s plan and the three latest MVP Affiliate videos in the card; a store SCOUT is never told to update')

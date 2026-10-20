// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// TAGS AND KEYWORDS FROM REAL SEARCHES (Seb, 2026-10-20: "We could build from
// what people actually type into YouTube search boxes, like actual real
// searches, and keep only the ones that match the video ... check the main
// keyword against Google search suggestion the same way").
//
// Held on the e-bike that started it: YouTube's box offered "fat tire ebike
// rack" and "electric bike for kids" for a review of an adult e-bike, and the
// writer guessed "electric scooter" and a year. The search boxes are faked
// here (globalThis.fetch), so this runs offline and the same every time.
import { readFileSync, existsSync } from 'node:fs'
import { matchesContent, contentVocab, titleTopic, suggest, SEARCH_WORDS } from '../lib/search-suggest'
import { pickYouTubeTags, youtubeSeeds, researchYouTubeTags, YT_TAGS_MAX_CHARS } from '../lib/youtube-search-tags'
import { researchKeyword } from '../lib/keyword-research'

const fails: string[] = []
const check = (name: string, ok: boolean | undefined, detail?: unknown) => { if (!ok) fails.push(`${name}${detail !== undefined ? `: ${JSON.stringify(detail)}` : ''}`) }
const read = (f: string) => readFileSync(f, 'utf8')

const vt = "Don't Buy a Fat Tire E-Bike Until You See This"
const pt = 'Jasion EB7 Fat Tire Electric Bike for Adults, 750W Motor 48V Removable Battery, 26" Fat Tire Ebike, Off Road Mountain Ebike'
const said = 'I rode it on my daily commute and off road trails. Battery range, hills, the brakes.'
const vocab = contentVocab(`${vt}\n${pt}\n${said}`)

// ── What matches the video ───────────────────────────────────────────────────
check('a search made of the video\'s words matches', matchesContent('fat tire ebike review', vocab) && matchesContent('jasion eb7', vocab) && matchesContent('fat tire electric bike off road', vocab))
check('a search about something else does not ("rack", "scooter")', !matchesContent('fat tire ebike rack', vocab) && !matchesContent('electric scooter', vocab))
check('who it is for counts only when the video says it ("kids")', !matchesContent('electric bike for kids', vocab) && matchesContent('electric bike for adults', vocab) && !SEARCH_WORDS.has('kids'))
check('a year never matches', !matchesContent('best electric bike 2026', vocab))
check('search words alone are about nothing', !matchesContent('best review', vocab))
check('"E-Bike" is the word ebike too', vocab.has('ebike') && vocab.has('ebikes'))
check('a video title loses the words nobody searches with', titleTopic(vt) === 'fat tire ebike' && titleTopic('Why I Stopped Using My Air Fryer') === 'stopped using air fryer', [titleTopic(vt), titleTopic('Why I Stopped Using My Air Fryer')])

// ── YouTube tags ─────────────────────────────────────────────────────────────
const seeds = youtubeSeeds({ videoTitle: vt, productTitle: pt, productName: 'Jasion EB7 Fat Tire Electric Bike' })
check('YouTube is asked about the product, its brand and model, and the topic, never the title\'s sentence', seeds.includes('jasion eb7') && seeds.includes('fat tire ebike') && seeds.some((s) => /electric bike/.test(s)) && !seeds.some((s) => /dont|until|see/.test(s)), seeds)
const picked = pickYouTubeTags(
  [['electric bike', 'electric bike review', 'electric bike for kids', 'electric bike conversion kit'], ['jasion eb7', 'jasion eb7 review'], ['fat tire ebike', 'fat tire ebike review', 'fat tire ebike rack', 'electric bike review']],
  ['fat tire ebike', 'best electric bike 2026', 'electric scooter', 'ebike battery range'],
  vocab,
)
check('real searches lead, a search offered twice first', picked.tags[0] === 'electric bike review' && picked.fromSearches >= 5, picked.tags)
check('searches not about the video are left out', !picked.tags.some((t) => /kids|conversion kit|rack/.test(t)), picked.tags)
check('the writer\'s tags follow only when about the video, the rest are named', picked.tags.includes('ebike battery range') && !picked.tags.includes('electric scooter') && picked.notAbout.includes('electric scooter') && picked.notAbout.includes('best electric bike 2026'), picked)
const many = pickYouTubeTags([Array.from({ length: 40 }, (_, i) => `fat tire ebike review ${['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'][i % 10]}`)], [], contentVocab('fat tire ebike review one two three four five six seven eight nine ten'))
check('inside YouTube\'s limit for the field', many.tags.join(',').length <= YT_TAGS_MAX_CHARS, many.tags.join(',').length)

// ── The boxes, faked ─────────────────────────────────────────────────────────
const asked: string[] = []
let boxesUp = true
const BOX: Record<string, string[]> = {
  'fat tire ebike': ['fat tire ebike', 'fat tire ebike review', 'fat tire ebike rack', 'fat tire ebike for adults'],
  'fat tire': ['fat tire', 'fat tire electric bike', 'fat tire beer', 'fat tire bike'],
  'fat tire electric': ['fat tire electric bike', 'fat tire electric bike for adults', 'fat tire electric scooter'],
  'jasion eb7': ['jasion eb7', 'jasion eb7 review'],
  'electric bike': ['electric bike', 'electric bike review'],
}
globalThis.fetch = (async (input: string | URL) => {
  const url = String(input)
  asked.push(url)
  if (!boxesUp) return new Response('no', { status: 503 })
  const q = decodeURIComponent((url.match(/[?&](?:q|prefix)=([^&]+)/) || [])[1] || '').replace(/\+/g, ' ')
  const list = BOX[q] || []
  if (url.includes('completion.amazon.com')) return new Response(JSON.stringify({ suggestions: list.map((value) => ({ type: 'KEYWORD', value })) }), { status: 200 })
  return new Response(JSON.stringify([q, list]), { status: 200 })
}) as typeof fetch

;(async () => {
  const yt = await researchYouTubeTags(null, { videoTitle: vt, productTitle: pt, productName: 'Jasion EB7 Fat Tire Electric Bike', text: said, writer: ['electric scooter'] })
  check('a live read: YouTube tags from its own box, about the video', yt.answered > 0 && yt.fromSearches > 0 && yt.tags.includes('jasion eb7 review') && !yt.tags.includes('fat tire ebike rack'), yt)
  check('YouTube\'s box is the one asked for YouTube tags', asked.some((u) => u.includes('ds=yt')))

  // Remembered for everyone: a fresh answer in the table means nobody asks again.
  asked.length = 0
  const remembered = { from: () => { const q: Record<string, unknown> = {}; for (const k of ['select', 'eq', 'gte']) q[k] = () => q; q.maybeSingle = () => Promise.resolve({ data: { phrases: ['jasion eb7 review'] } }); q.upsert = () => Promise.resolve({ error: null }); return q } }
  const r = await suggest('youtube', 'jasion eb7', remembered)
  check('a remembered answer is used without asking the box again', r.remembered && r.phrases[0] === 'jasion eb7 review' && asked.length === 0, r)

  // ── The blog's main keyword ────────────────────────────────────────────────
  const kwVideo = await researchKeyword({ videoTitle: vt, contentText: `${said} fat tire electric bike for adults` })
  check('a video alone gets a keyword a search box confirms', !!kwVideo.primary && kwVideo.confirmedBy.length > 0 && /fat tire/.test(kwVideo.primary || ''), kwVideo)
  check('the box echoing the words it was asked is no confirmation', kwVideo.primary !== 'fat tire' && kwVideo.primary !== 'fat tire ebike', kwVideo.primary)
  check('never a search about something else (beer, rack, scooter)', !/beer|rack|scooter/.test([kwVideo.primary, ...kwVideo.supporting].join(' ')), kwVideo)
  boxesUp = false
  const down = await researchKeyword({ videoTitle: vt, contentText: said })
  check('when no box answers, nothing is called confirmed', down.confirmedBy.length === 0 && down.answered === 0, down)
  boxesUp = true

  // ── Wiring ────────────────────────────────────────────────────────────────
  const META = read('app/api/youtube/generate-metadata/route.ts')
  check('YouTube metadata builds its tags from real searches and says how', /researchYouTubeTags\(createAdminClient\(\)/.test(META) && /tagsResearch,/.test(META) && /usedWriterUnchecked: true/.test(META))
  const COPILOT = read('app/(dashboard)/co-pilot/page.tsx')
  check('Co-Pilot marks the searched tags and says when YouTube did not answer', /from real YouTube searches \(green\)/.test(COPILOT) && /YouTube&rsquo;s search box did not answer/.test(COPILOT))
  const BLOG = read('app/api/blog/generate/route.ts')
  check('every blog post is researched, a video alone too, kept only when a box confirms it', /if \(!targetKeyword && !asinOverride\) \{/.test(BLOG) && /research\?\.primary && research\.confirmedBy\.length/.test(BLOG) && /keywordResearch: keywordResearch \? \{ \.\.\.keywordResearch, used: generated\.seoKeyword \|\| null \} : null/.test(BLOG))
  check('the writer is told where the keyword came from', /targetKeywordFrom: keywordResearch\?\.from \?\? null/.test(BLOG) && /confirmed by Google\\'s or Amazon\\'s search box: a phrase people actually type/.test(read('services/claude/index.ts')))
  check('answers are remembered (migration 449), safe to run twice', existsSync('supabase/migrations/449_search_suggestions.sql') && /create table if not exists public\.search_suggestions/.test(read('supabase/migrations/449_search_suggestions.sql')))

  if (fails.length) { console.error('search-research failed:\n - ' + fails.join('\n - ')); process.exit(1) }
  console.log('✅ search-research: YouTube tags from real YouTube searches about the video, the blog keyword confirmed by Google or Amazon, answers remembered, and an unconfirmed one never called confirmed')
})()

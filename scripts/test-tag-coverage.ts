// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// EVERY TAG MVP WRITES GOES THROUGH THE ENGINE (Seb, 2026-10-20: "Let's make
// sure that anything that MVP creates as far as content, as far as tagging
// and hashtags ... runs through this kind of engine so we have better tags
// and hashtags. I don't want to hear from users that the hashtags are poor").
//
// An audit that day found the gaps this holds closed: the YouTube tags field
// on Clip Factory, Shorts Studio and Drop (and a timed-out Co-Pilot) sent the
// writer's guesses or nothing; WordPress tags were the writer's first six or
// ten on every blog type; deal posts, On Sale and the Group Post Queue only
// got the safety net; Clip Factory's TikTok, Instagram and Facebook reused
// the Short's pick; Telegram had no net at all; scheduled Auto-pilot and
// Levanta posts had no tags. Each surface is checked by what it calls, and
// the pieces they call are checked by what they do.
import { readFileSync } from 'node:fs'
import { postTags } from '../lib/post-tags'
import { offlineYouTubeTags } from '../lib/youtube-search-tags'
import { discloseSocialPost } from '../lib/social-disclaimer'
import { fitHashtags, writerTags } from '../lib/hashtag-engine'

const fails: string[] = []
const check = (name: string, ok: boolean | undefined, detail?: unknown) => { if (!ok) fails.push(`${name}${detail !== undefined ? `: ${JSON.stringify(detail)}` : ''}`) }
const read = (f: string) => readFileSync(f, 'utf8')

// ── The pieces ───────────────────────────────────────────────────────────────
const post = { title: 'Jasion EB7 Review: The Fat Tire Electric Bike for My Commute', content: '<p>I rode the Jasion EB7 fat tire ebike to work every day. The battery range, the brakes and the hills.</p>' }
const wp = postTags({ tags: ['fat tire ebike', 'Electric Scooter', 'best ebike 2026', 'jasion eb7', '#commute', 'kitchen gadgets'], ...post, keyword: 'fat tire electric bike', supporting: ['fat tire ebike for adults'], max: 6 })
check('WordPress tags: the keyword first, then only tags about the post', wp[0] === 'fat tire electric bike' && wp.includes('jasion eb7') && wp.includes('commute') && !wp.some((t) => /scooter|2026|kitchen/.test(t)), wp)
check('WordPress tags: a supporting search not in the post is left out', !wp.includes('fat tire ebike for adults'), wp)
const yt = offlineYouTubeTags({ videoTitle: "Don't Buy a Fat Tire E-Bike Until You See This", productTitle: 'Jasion EB7 Fat Tire Electric Bike', productName: 'Jasion EB7 Fat Tire Electric Bike', writer: ['electric scooter', 'fat tire ebike review'] })
check('YouTube tags with no answer from YouTube: about the video, never the writer\'s others', yt.tags.includes('fat tire ebike review') && !yt.tags.includes('electric scooter') && yt.tags.includes('jasion eb7') && (yt.fromProduct ?? 0) > 0, yt)
const tg = discloseSocialPost('Great deal\\! \\#airfryer \\#fyp \\#AirFryer \\#2026deals \\#kitchen \\#cooking', 'telegram')
check('Telegram: spam, years and repeats out, escaped as Telegram needs', !/fyp|2026deals/.test(tg) && (tg.match(/\\#airfryer/gi) || []).length === 1 && !/(?<!\\)#/.test(tg), tg)
check('a tag that starts with a year is a tag, and the year takes it out', !/#2026deals/.test(fitHashtags('New drop #2026deals #airfryer', 'instagram')) && writerTags('#2026deals #airfryer').includes('#2026deals'))
check('"#1 pick" is not a tag', fitHashtags('My #1 pick today', 'instagram') === 'My #1 pick today')

// ── Every surface ────────────────────────────────────────────────────────────
const META = read('app/api/youtube/generate-metadata/route.ts')
check('Co-Pilot, Launchpad, Liftoff: the tags field through youtubeTagsFor, never the writer\'s unchecked', /seoData\.tags = tagsResearch\.tags/.test(META) && /youtubeTagsFor\(/.test(META) && !/usedWriterUnchecked: true/.test(META))
const KIT = read('app/api/clip-factory/publish-kit/route.ts')
check('Clip Factory: the Short\'s tags through real searches, each platform\'s hashtags picked for it', /youtubeTagsFor\(createAdminClient\(\)/.test(KIT) && /const hashtags = await hashtagsFor\(\{\s*platform: tagPlatform/.test(KIT) && /hashtags \}\)/.test(KIT))
check('Clip Factory\'s panel uses the platform\'s own pick', /kit\?\.hashtags\?\.length \? kit\.hashtags : props\.hashtags/.test(read('components/clip-factory/PublishPanel.tsx')))
const SHORT = read('app/api/youtube/upload-short/route.ts')
check('Shorts Studio and Drop: tags from real searches when the creator saw none', /if \(body\.researchTags\) \{\s*const r = await youtubeTagsFor/.test(SHORT) && /researchTags: true/.test(read('components/content/ShortsStudioModal.tsx')) && /researchTags: true/.test(read('lib/drop-places.ts')))
check('Shorts Studio\'s TikTok and Instagram buttons pick for that platform', /pickedCaption\(clip, 'tiktok'\)/.test(read('components/content/ShortsStudioModal.tsx')) && /pickedCaption\(clip, 'instagram'\)/.test(read('components/content/ShortsStudioModal.tsx')) && /researchedTags\(text, \{ platform: body\.platform as TagPlatform/.test(read('app/api/hashtags/pick/route.ts')))
for (const f of ['app/api/blog/generate/route.ts', 'app/api/campaigns/generate/route.ts', 'app/api/ltk/generate/route.ts', 'app/api/wayward/generate/route.ts', 'app/api/walmart/generate/route.ts', 'app/api/levanta/generate/route.ts']) {
  const s = read(f)
  check(`${f}: WordPress tags checked against the post`, /resolveTagIds\(postTags\(\{ tags: generated\.tags/.test(s) && !/resolveTagIds\(\(?generated\.tags/.test(s))
}
const DEALS = read('lib/deal-social-publish.ts')
check('Deal posts (Deal Radar, Deals Hub, Walmart, Wayward): each platform\'s tags picked, researched once', /await pickForPlatforms\(/.test(DEALS) && !/composeText\(baseCaption,/.test(DEALS) && /capSocialText\(captionFor\('telegram'\)/.test(DEALS))
for (const f of ['lib/deal-quick-post.ts', 'lib/walmart-quick-post.ts', 'lib/wayward-quick-post.ts']) check(`${f}: the engine picks unless the creator wrote the caption`, /pickTags: !\(input\.caption \|\| ''\)\.trim\(\)/.test(read(f)))
check('Instagram deal post: tags picked for Instagram', /researchedTags\(baseCaption, \{ platform: 'instagram'/.test(read('lib/deal-quick-post.ts')))
check('On Sale\'s social post: its tag picked', /researchedTags\(tidy\(j\.social \?\? ''\), \{ platform: 'x'/.test(read('app/api/on-sale/promo/route.ts')))
check('Group Post Queue: each post\'s tags picked for a Facebook Group', /researchedTags\(written, \{ platform: 'facebook_group'/.test(read('app/api/group-queue/route.ts')))
check('Auto-pilot and Levanta scheduled posts: tags picked per platform, none on a Facebook link post', /scheduledCaptions\(caption,/.test(read('lib/generation-job-runner.ts')) && /scheduledCaptions\(caption,/.test(read('app/api/levanta/generate/route.ts')) && !/facebook: '/.test(read('lib/hashtag-data.ts').slice(read('lib/hashtag-data.ts').indexOf('export async function scheduledCaptions')).split('\n')[1] || ''))
check('Instagram\'s screen says 4 hashtags plus #ad, not 20', !/20 hashtags/.test(read('components/content/InstagramPublishModal.tsx')))

if (fails.length) { console.error('tag-coverage failed:\n - ' + fails.join('\n - ')); process.exit(1) }
console.log('✅ tag-coverage: every YouTube tags field, WordPress tag set, deal, promo, queue, cross-post and scheduled post MVP writes goes through the engine; Telegram has its net')

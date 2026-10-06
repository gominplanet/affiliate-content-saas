// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// A POST FROM THE CREATOR'S OWN VIDEO NEVER SAYS THEY DID NOT REVIEW IT.
//
// A Pro customer's posts all said "I didn't actually review this product":
// the transcript fetch failed in silence (it used the account's first token,
// not the channel that owns the video, and had no audio fallback), the prompt
// then told the writer it had nothing, and nothing took the hedge out. Their
// geni.us links also gave no product without Geniuslink API keys.
import { readFileSync } from 'node:fs'
import { scrubVoicePatterns } from '../lib/blog-voice-scrub'

const failures: string[] = []
const check = (name: string, cond: boolean) => { if (!cond) failures.push(name) }
const ROUTE = readFileSync('app/api/blog/generate/route.ts', 'utf8')
const CLAUDE = readFileSync('services/claude/index.ts', 'utf8')

check('captions are asked for with the token of the channel that owns the video',
  /getChannelOAuthToken\(supabase, ownerId, \(videoRow\.channel_id/.test(ROUTE))
check('when captions fail, the audio is transcribed (as Shorts does)',
  /ingestAudio\(youtubeVideoIdForTranscript, ownerId\)/.test(ROUTE) && /transcriptSource = 'whisper'/.test(ROUTE))
check('saved word cues are used before paying for anything',
  /transcript_cues/.test(ROUTE))
check('the prompt no longer invites a "did not review" hedge',
  !/No transcript available — base post on title, description, and tags only\./.test(CLAUDE) && /never say or suggest that you did not review, test or use the product/.test(CLAUDE))
check('every voice scrub on this path treats the post as the creator\'s own video',
  (ROUTE.match(/scrubVoicePatterns\(/g) ?? []).length === (ROUTE.match(/ownVideo: true/g) ?? []).length)
check('a geni.us link gives its product without Geniuslink keys, and the creator\'s link is kept',
  /alreadyGeniuslink = true\s*\n\s*\/\/ THE PRODUCT, STILL\.[\s\S]{0,700}resolveTrueDestination\(directProductUrl\)/.test(ROUTE))

const html = '<p>This topper is great. I didn\'t actually review this product, so this is from the listing. It fits king beds.</p><p>I haven\'t tested it myself.</p><p>I tested the cooling for a week.</p>'
const own = scrubVoicePatterns(html, { ownVideo: true }).content
check('denials are taken out of an own-video post, and real first-hand lines stay',
  !/didn't actually review|haven't tested/.test(own) && /I tested the cooling for a week/.test(own) && /It fits king beds/.test(own))
{
  // Real review lines that mention not using something are NOT denials.
  const real = '<p>I never use the turbo setting because it is loud.</p><p>We couldn\'t use it in the rain, the seal leaked.</p><p>I didn\'t use a pencil to mark the holes.</p><p>I didn\'t test it in the rain, so I cannot say how it holds up there.</p>'
  check('real first-hand lines and cons stay, even when they say "didn\'t use"',
    scrubVoicePatterns(real, { ownVideo: true }).content === real)
  check('"I haven\'t personally tried these" is a denial',
    !/personally tried/.test(scrubVoicePatterns('<p>Good stuff. I haven\'t personally tried these, but buyers like them.</p>', { ownVideo: true }).content))
}
check('a post that is not from the creator\'s own video keeps its honest disclaimer',
  scrubVoicePatterns(html, {}).content === html)

// THE SHARED QUOTA. A caption list and download cost 250 of the one daily
// YouTube quota every account shares; a day of posts used all of it. The free
// scraper and the audio (no quota) go first, the Data API last.
{
  const scrape = ROUTE.indexOf('YoutubeTranscript.fetchTranscript(youtubeVideoIdForTranscript')
  const audio = ROUTE.indexOf('ingestAudio(youtubeVideoIdForTranscript, ownerId)')
  const api = ROUTE.indexOf('yt.getTranscript(youtubeVideoIdForTranscript)')
  check('transcripts try the scraper, then the audio, and the quota-costly Data API last',
    scrape > 0 && audio > scrape && api > audio)
}

if (failures.length) {
  console.error(`\n❌ blog-transcript: ${failures.length} failure(s)\n`)
  for (const f of failures) console.error(`   • ${f}`)
  process.exit(1)
}
console.log('✅ blog-transcript: transcripts from the owning channel or the audio, no "did not review" in an own-video post, geni.us products found without keys')

// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// THE INTRO VIDEO FOR BRAND REQUESTS (Seb, 2026-10-20: "Let's make it a
// personal intro submission based on what MVP wants to recommend"). The words
// MVP writes stay personal and never talk money or name a brand; the video is
// kept only when it arrived; and until SCOUT can attach it, the card says
// requests still go without it, and only admin sees it.
import { readFileSync, existsSync } from 'node:fs'
import { introPrompt, parseIntro, readIntroVideo, INTRO_SYSTEM, INTRO_MAX_WORDS, INTRO_TIPS } from '../lib/trybe-intro'

const fails: string[] = []
const check = (name: string, ok: boolean | undefined, detail?: unknown) => { if (!ok) fails.push(`${name}${detail !== undefined ? `: ${JSON.stringify(detail)}` : ''}`) }
const read = (f: string) => readFileSync(f, 'utf8')

check('the writer is told: personal, every brand, never money, only the facts', /Never mention rates, prices, pay, fees or money/.test(INTRO_SYSTEM) && /Never name a brand or a product/.test(INTRO_SYSTEM) && /Use only the facts given/.test(INTRO_SYSTEM) && new RegExp(`${INTRO_MAX_WORDS} words at most`).test(INTRO_SYSTEM))
const prompt = introPrompt({ name: 'Seb', years: '5 years or more', facts: ['YouTube: https://youtube.com/@gomin'], coreMessage: 'I make real-life video reviews.', niches: ['tech', 'outdoors'] })
check('the prompt carries the name, years, niches, pitch and what MVP knows', /FIRST NAME: Seb/.test(prompt) && /MAKING VIDEOS FOR: 5 years or more/.test(prompt) && /NICHES: tech, outdoors/.test(prompt) && /THEIR PITCH/.test(prompt) && /youtube\.com/.test(prompt))
check('no name given: the writer is told not to invent one', /not given: write "I" without a name/.test(introPrompt({ name: '', years: '', facts: [] })))
const parsed = parseIntro(JSON.stringify({ lines: [
  { say: 'Hi, I\'m Seb!', show: 'Wave' },
  { say: 'I\'ve made real-life product videos for five years — tech and outdoor gear mostly.', show: 'Hold up a product' },
  { say: 'My rates start at $150 a video.', show: null },
  { say: 'You can find my reviews on YouTube and my Amazon storefront.', show: null },
  { say: 'I\'d love to make something for your brand.', show: 'Smile' },
] }))
check('a line that talks money is dropped, dashes become commas', !!parsed && !parsed.lines.some((l) => /\$|rate/i.test(l.say)) && !parsed.lines.some((l) => /[—–]/.test(l.say)) && parsed.lines.length === 4, parsed)
check('too little to say is no script', parseIntro('{"lines":[{"say":"Hi"}]}') === null && parseIntro('nonsense') === null)
check('a stored video is read back only with a real address', readIntroVideo({ url: 'https://x.supabase.co/a.mp4', path: 'u/trybe-intro-1.mp4' })?.url === 'https://x.supabase.co/a.mp4' && readIntroVideo({ url: 'javascript:alert(1)', path: 'x' }) === null && readIntroVideo(null) === null)
check('filming tips include no rates and about 30 seconds', INTRO_TIPS.some((t) => /no rates or prices/.test(t)) && INTRO_TIPS.some((t) => /30 seconds/.test(t)))

const ROUTE = read('app/api/labs/trybe/route.ts')
check('admin only while SCOUT cannot attach it', /if \(action\.startsWith\('intro_'\)\) \{\s*if \(tier !== 'admin'\)/.test(ROUTE))
check('a video is saved only when storage has it', /if \(!hit\) return NextResponse\.json\(\{ error: 'The upload did not arrive in MVP storage, so nothing was saved/.test(ROUTE))
check('only the upload MVP opened, in the creator\'s own folder', /trybe-intro-\[0-9a-f-\]\{36\}/.test(ROUTE))
check('the clean-up jobs never take it (not burner-, clip- or source-)', /\^\(burner\|clip\|source\)-/.test(read('app/api/cron/purge-shorts-sources/route.ts')))
const CARD = read('components/labs/TrybeIntroVideo.tsx')
check('the card says requests still go without it, until they do', /Not added to requests yet\. Requests still go with your message only\./.test(CARD))
check('only admin sees it on Find brands', /\{isAdmin && <TrybeIntroVideo \/>\}/.test(read('components/labs/TrybeOutreach.tsx')))
check('optional: off sends the message only, as before, and the card shrinks to one line', /No thanks, message only/.test(CARD) && /Intro video off\.<\/b> Requests go with your message only, as before\./.test(CARD) && /action === 'intro_toggle'/.test(ROUTE) && /add column if not exists intro_off boolean not null default false/.test(read('supabase/migrations/450_trybe_intro.sql')))
check('migration 450, safe to run twice', existsSync('supabase/migrations/450_trybe_intro.sql') && /add column if not exists intro_video jsonb/.test(read('supabase/migrations/450_trybe_intro.sql')))

if (fails.length) { console.error('trybe-intro failed:\n - ' + fails.join('\n - ')); process.exit(1) }
console.log('✅ trybe-intro: a personal intro MVP writes (no money, no brand names), kept only when it arrived, said as not sent yet, admin only until SCOUT attaches it')

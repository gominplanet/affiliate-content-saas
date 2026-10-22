// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// THE INTRO VIDEO FOR BRAND REQUESTS (Seb, 2026-10-20: "Let's make it a
// personal intro submission based on what MVP wants to recommend"). The words
// MVP writes stay personal and never talk money or name a brand; the video is
// kept only when it arrived; and until SCOUT can attach it, the card says
// requests still go without it, and only admin sees it.
import { readFileSync, existsSync } from 'node:fs'
import { INTRO_GUIDE, introPrompt, introSystem, parseIntro, readIntroVideo, cleanInputs, introSuggest, introSample, isTrybeSampleUrl, WORDS_FOR, INTRO_TIPS } from '../lib/trybe-intro'

const fails: string[] = []
const check = (name: string, ok: boolean | undefined, detail?: unknown) => { if (!ok) fails.push(`${name}${detail !== undefined ? `: ${JSON.stringify(detail)}` : ''}`) }
const read = (f: string) => readFileSync(f, 'utf8')

const sys = introSystem(30)
check('the writer is told: personal, every brand, never money, only the facts, links on screen', /Never mention rates, prices, pay, fees or money/.test(sys) && /Never name a brand or a product/.test(sys) && /Use only the facts given/.test(sys) && new RegExp(`${WORDS_FOR[30]} words at most`).test(sys) && /never read a link out loud/.test(sys) && /they speak as "we"/.test(sys))
check('the length sets the words', /40 words at most/.test(introSystem(15)) && /115 words at most/.test(introSystem(45)))
// THE OPTIONS (Seb, 2026-10-20: "name, experience, social used with success (links), signature, name + email (if user wants)")
const inputs = cleanInputs({ name: 'Seb and Michelle', years: '5 years or more', highlight: '500 Amazon videos', niches: 'tech, outdoors', socials: [{ id: 'youtube', url: 'https://youtube.com/@gomin' }, { id: 'tiktok', url: '' }, { id: 'bogus', url: 'https://x.com' }, { id: 'website', url: 'javascript:alert(1)' }], withEmail: true, email: 'hello@gomin.com', tone: 'upbeat', seconds: 45 })
check('the options are kept, made safe', inputs.name === 'Seb and Michelle' && inputs.highlight === '500 Amazon videos' && inputs.niches.join() === 'tech,outdoors' && inputs.socials.map((x) => x.id).join() === 'youtube,tiktok,website' && inputs.socials[2].url === '' && inputs.withEmail && inputs.tone === 'upbeat' && inputs.seconds === 45, inputs)
check('a bad email is no email', !cleanInputs({ withEmail: true, email: 'not an email' }).withEmail)
const prompt = introPrompt(inputs, { facts: ['Name: Gomin'], coreMessage: 'I make real-life video reviews.' })
check('the prompt carries every option', /NAME: Seb and Michelle/.test(prompt) && /MAKING VIDEOS FOR: 5 years or more/.test(prompt) && /PROUD OF: 500 Amazon videos/.test(prompt) && /NICHES: tech, outdoors/.test(prompt) && /- YouTube \(on screen: https:\/\/youtube\.com\/@gomin\)/.test(prompt) && /EMAIL \(end with it; on screen exactly\): hello@gomin\.com/.test(prompt) && /TONE: Upbeat/.test(prompt) && /THEIR PITCH/.test(prompt), prompt)
check('no name given: the writer is told there is none', /NAME: \(not given: no name\)/.test(introPrompt(cleanInputs({}))))
const parsed = parseIntro(JSON.stringify({ lines: [
  { say: 'Hi, we\'re Seb and Michelle!', show: 'Wave' },
  { say: 'We make supplements videos that boost immunity and cure insomnia.', show: null },
  { say: 'We\'ve made real-life product videos for five years — tech and outdoor gear mostly.', show: 'Hold up a product' },
  { say: 'Our rates start at $150 a video.', show: null },
  { say: 'You\'ll find us on YouTube.', show: 'https://youtube.com/@gomin' },
  { say: 'Reach us at hello@gomin.com, we\'d love to make something for your brand.', show: 'hello@gomin.com' },
] }), 45)
check('each line is cleaned on its own: a health claim never takes the whole intro', !!parsed && parsed.lines.length >= 4 && parsed.lines[0].say.startsWith('Hi'), parsed)
check('a line that talks money is dropped, dashes become commas', !!parsed && !parsed.lines.some((l) => /\$|rate/i.test(l.say)) && !parsed.lines.some((l) => /[—–]/.test(l.say)), parsed)
check('a link or email on screen is kept exactly', !!parsed && parsed.lines.some((l) => l.show === 'https://youtube.com/@gomin') && parsed.lines.some((l) => l.show === 'hello@gomin.com'), parsed)
check('too little to say is no script', parseIntro('{"lines":[{"say":"Hi"}]}') === null && parseIntro('nonsense') === null)
check('a stored video is read back only with a real address', readIntroVideo({ url: 'https://x.supabase.co/a.mp4', path: 'u/trybe-intro-1.mp4' })?.url === 'https://x.supabase.co/a.mp4' && readIntroVideo({ url: 'javascript:alert(1)', path: 'x' }) === null && readIntroVideo(null) === null)
const sug = introSuggest({ author_name: 'Seb', name: 'Gomin Reviews', youtube_channel_url: 'https://youtube.com/@gomin', tiktok_url: '', contact_email: 'hello@gomin.com', niches: ['tech'], collab_track_record: '500 videos' }, ['outdoors'])
check('the form is filled in from the profile (the person\'s name, not the site\'s)', sug.name === 'Seb' && sug.socials?.length === 1 && sug.email === 'hello@gomin.com' && sug.niches?.join() === 'tech,outdoors' && sug.highlight === '500 videos', sug)
check('filming tips include no rates and links on screen', INTRO_TIPS.some((t) => /no rates or prices/.test(t)) && INTRO_TIPS.some((t) => /links and email as text on screen/.test(t)))

const ROUTE = read('app/api/labs/trybe/route.ts')
check('admin only while SCOUT cannot attach it', /if \(action\.startsWith\('intro_'\)\) \{\s*if \(tier !== 'admin'\)/.test(ROUTE))
check('a video is saved only when storage has it', /if \(!hit\) return NextResponse\.json\(\{ error: 'The upload did not arrive in MVP storage, so nothing was saved/.test(ROUTE))
check('only the upload MVP opened, in the creator\'s own folder', /trybe-intro-\[0-9a-f-\]\{36\}/.test(ROUTE))
check('the clean-up jobs never take it (not burner-, clip- or source-)', /\^\(burner\|clip\|source\)-/.test(read('app/api/cron/purge-shorts-sources/route.ts')))
const CARD = read('components/labs/TrybeIntroVideo.tsx')
// Seb, 2026-10-22: "I don't want to give a script to someone. Just give them a little idea of what the intro video should be ... make sure that people write their core message".
check('the card has no form and no script: a short guide to a good intro instead', !['Your name, or names', 'Making videos for', 'Where your videos do well', 'Sign off with my email', 'Write my intro', "action: 'intro_script'"].some((w) => CARD.includes(w)) && /1\. What a good intro video is/.test(CARD) && /INTRO_GUIDE\.map/.test(CARD) && INTRO_GUIDE.length >= 4 && INTRO_GUIDE.some((t) => /no rates or prices/i.test(t)))
check('it says the core message is the request and the video goes with it, and opens it', /Write your core message first\.<\/b> It is the words of every request/.test(CARD) && /Your core message is written\./.test(CARD) && /<TrybeIntroVideo core=\{core\} onWriteCore=/.test(read('components/labs/TrybeOutreach.tsx')) && /id="trybe-core-message"/.test(read('components/labs/TrybeOutreach.tsx')))
check('the route reads the options and fills the form from the profile', /const inputs = cleanInputs\(body\.inputs\)/.test(ROUTE) && /suggest: introSuggest\(/.test(ROUTE) && /parseIntro\(\(msg\.content/.test(ROUTE))
// ── With every request (Seb, 2026-10-21, read from TRYBE's own Request to Join) ──
check('the card says where it stands: none, in MVP only, SCOUT too old, or on every request', /No intro yet\. Requests go with your message only\./.test(CARD) && /Saved in MVP, not on TRYBE yet, so requests still go with your message only\./.test(CARD) && /which sends requests without it\. Update SCOUT/.test(CARD) && /On TRYBE\. Every request SCOUT sends now carries it/.test(CARD))
check('it goes on TRYBE the way TRYBE does it: an address, the file, the link', /requestTrybeApi\('POST', TRYBE_PORTFOLIO_PATH, \{ fileName: v\.name, fileType: type, fileSize: size, uploadType: 'portfolio_video' \}\)/.test(CARD) && /requestTrybePutFile\(\{ fileUrl: v\.url, uploadUrl: d\.uploadUrl/.test(CARD) && /action: 'intro_trybe_saved', url: d\.publicUrl/.test(CARD))
check('only TRYBE\'s own portfolio link is kept, and only when TRYBE shows the file', isTrybeSampleUrl('https://cdn.jointrybe.com/creators/0415b21f-a43a-4c87-8630-d27fa2c1bc6b/portfolio/1792585888166_72009169199dff1e.mp4') && !isTrybeSampleUrl('https://evil.com/creators/x/portfolio/a.mp4') && !isTrybeSampleUrl('https://cdn.jointrybe.com/brands/x/a.mp4') && /if \(!head\?\.ok\) return NextResponse\.json\(\{ error: `TRYBE does not show the video at its link yet/.test(ROUTE))
check('a new file is put on TRYBE again', /trybeUrl: null, trybeAt: null/.test(ROUTE))
const v = readIntroVideo({ url: 'https://x.supabase.co/a.mov', path: 'u/trybe-intro-1.mov', name: 'intro.mov', trybeUrl: 'https://cdn.jointrybe.com/creators/abcdef12/portfolio/1_2.mov' })
check('a request carries it unless turned off or not on TRYBE', introSample(v, false)?.mimeType === 'video/quicktime' && introSample(v, true) === null && introSample(readIntroVideo({ url: 'https://x.co/a.mp4', path: 'p' }), false) === null)
check('MVP hands it to every send, and keeps whether it went', /sample \}\)$/m.test(ROUTE.split('\n').find((l) => l.includes("url: sendUrl(row.brand_id, row.brand_url, programId), sample })")) || '') && /sent_with_intro: body\.withVideo === true/.test(ROUTE) && /add column if not exists sent_with_intro boolean/.test(read('supabase/migrations/451_trybe_sent_with_intro.sql')))
const BG = read('extension/background.js')
check('SCOUT 1.53.7 sends it as TRYBE\'s button does, only a TRYBE cdn link', /sampleCreativeUrl: u, sampleCreativeMimeType: t/.test(BG) && /cdn\\\.jointrybe\\\.com\\\/creators/.test(BG) && /trybeSend\(\{ url: d\.url, name: d\.name, message: d\.message, sample: d\.sample \}\)/.test(BG) && /withVideo: !!res\.withVideo/.test(BG) && /\/\^\\\/backend\\\/api\\\/creator\\\/profile\\\/portfolio\\\/upload-url\$\//.test(BG))
check('the run log says when a request went with the video', /Sent with your intro video\./.test(BG) && /Sent with your intro video\. /.test(read('components/labs/TrybeOutreach.tsx')))
check('only admin sees it on Find brands', /\{isAdmin && <TrybeIntroVideo core=/.test(read('components/labs/TrybeOutreach.tsx')))
check('optional: off sends the message only, as before, and the card shrinks to one line', /No thanks, message only/.test(CARD) && /Intro video off\.<\/b> Requests go with your message only, as before\./.test(CARD) && /action === 'intro_toggle'/.test(ROUTE) && /add column if not exists intro_off boolean not null default false/.test(read('supabase/migrations/450_trybe_intro.sql')))
check('migration 450, safe to run twice', existsSync('supabase/migrations/450_trybe_intro.sql') && /add column if not exists intro_video jsonb/.test(read('supabase/migrations/450_trybe_intro.sql')))

if (fails.length) { console.error('trybe-intro failed:\n - ' + fails.join('\n - ')); process.exit(1) }
console.log('✅ trybe-intro: a personal intro MVP writes (no money, no brand names), put on TRYBE once as TRYBE does it, carried by every request SCOUT 1.53.7 sends, and each one saying whether it went')

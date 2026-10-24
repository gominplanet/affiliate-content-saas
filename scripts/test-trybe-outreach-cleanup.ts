// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// TRYBE OUTREACH, CLEANED UP (Seb, 2026-10-24: "take your time and fix all
// issues and illogical messes inside of the Trybe feature"). Holds what the
// review of Outreach and the Inbox found:
//   - TRYBE messages never talk rates: one broad check on every message MVP
//     writes (join requests, the first message after a yes, follow ups,
//     replies), the core message on save, and the voice samples; and the
//     brand's pay is never given to a writer;
//   - a join request keeps the core message's words: the voice samples set
//     only its greeting and sign-off;
//   - only Save message saves the core message, and Rewrite all asks first;
//   - the server keeps a few seconds between two join requests;
//   - counts mean what they say: chats with new messages (no group chats),
//     sent apart from not sent, the cap as "used";
//   - a send in progress is never put back in the queue, an edit that
//     changed nothing says so, and Send all waits for edits;
//   - links name where they go, no dashes, no plan that does not exist.
import { readFileSync } from 'node:fs'
import { talksTerms, termsHit, termsHits, quoteHits, asksMoney, tidyDraft } from '../lib/trybe-outreach'
import { inboxSnapshot } from '../lib/trybe-alerts'

const fails: string[] = []
const check = (name: string, ok: boolean | undefined) => { if (!ok) fails.push(name) }
const read = (f: string) => readFileSync(f, 'utf8')

const ROUTE = read('app/api/labs/trybe/route.ts')
const UI = read('components/labs/TrybeOutreach.tsx')
const OUT = read('lib/trybe-outreach.ts')

// Money.
for (const t of ['Love that you pay $50 per video', 'Is payment handled through TRYBE?', 'The 20% commission works great', 'What is the price per video?', 'your monthly ad budget', 'We charge $150 per video']) check(`"${t}" is money talk`, talksTerms(t))
check('a voice sample that talks pay is never learned', asksMoney('We charge $150 per video'))
check('budget-friendly is not money talk', !talksTerms('Budget-friendly and sturdy.'))
check('kickoff, follow up and join requests are checked, written once more, then refused, with no exception', /const moneyOk = \(t: string\) => !talksTerms\(t\)/.test(ROUTE) && /The message kept saying \u201c\$\{termsHit\(text\)\}\u201d/.test(ROUTE) && /if \(firstHit\) text = await write\(/.test(ROUTE) && /The draft kept saying \u201c\$\{lastHit\}\u201d/.test(ROUTE))
check('a core message that talks pay is said on save', /const coreHits = coreMessage \? termsHits\(coreMessage\) : \[\]/.test(ROUTE) && /if \(d\.warning\) toast\.warning\(d\.warning/.test(UI))

// WHY A REQUEST WAS NOT WRITTEN (Seb, 2026-10-24: "draft could not be
// written", with no reason). Every refusal names the words it caught, the
// core message is checked before anything is written, and the page shows the
// server's reason instead of a bare count.
for (const t of ['I have done $500 brand deals', 'We charge $150 a video', 'Our rate is $50 per video', '$1,000 per month for 4 videos']) check(`"${t}" is still pay talk`, talksTerms(t))
check('the refusal names the words it caught, with a word or two around them', termsHit('Love that you pay $50 per video') === 'you pay $50 per video' && termsHit('Hi Haus, so glad to have found you here.') === null)
for (const t of ['Our videos are built to run as paid ads on Meta and TikTok.', 'We have driven $250K+ in Amazon sales with our reviews.', 'We run a $3.5 Million/Year business reviewing products.', 'a $2M ecommerce company', 'Your fast charging power banks look great.', 'We pay close attention to lighting.', 'Our approval rate is high.']) check(`"${t}" is not pay talk`, !talksTerms(t))
check('a core message that talks pay stops the requests before any writing, naming every phrase at once', /const coreHits = termsHits\(settings\.coreMessage\)\n    if \(coreHits\.length\) return NextResponse\.json\(\{ error: `Your core message says \$\{quoteHits\(coreHits\)\}/.test(ROUTE) && ROUTE.indexOf('const coreHits = termsHits(settings.coreMessage)') < ROUTE.indexOf("if (action === 'ideas')") && ROUTE.indexOf('const coreHits = termsHits(settings.coreMessage)') > ROUTE.indexOf("if (action === 'draft')"))
check('every phrase is listed once, in order', JSON.stringify(termsHits('We pay attention. Our rate is $50 per video. Thanks for reading this far, we love it. Payment goes through PayPal.')) === JSON.stringify(['Our rate is $50 per video.', 'Payment goes through']) && quoteHits(['a', 'b', 'c']) === '\u201ca\u201d, \u201cb\u201d and \u201cc\u201d')
check('the writer is told which words to take out', /Your last try said \u201c\$\{firstHit\}\u201d/.test(ROUTE))
check('a brand that is not on the list is said, not dropped', /That brand is not on your list, so it was not written/.test(ROUTE))
check('the page shows the server\'s reason with the count', /reasons\.push\(r\.error\)/.test(UI) && /function notWritten\(/.test(UI) && (UI.match(/notWritten\(r\.failed, r\.reasons/g) || []).length === 4 && !/could not be written`\)/.test(UI))
// WHERE A WRITTEN BRAND WENT (Seb, 2026-10-24: "Haus disappeared from that
// list strangely"): Star brands leaves out what is in Ready to send, so it
// says which brands moved there and opens it, and the toast does too.
{
  const STAR = read('components/labs/TrybeStarBrands.tsx')
  check('Star brands names the brands that moved to Ready to send, with a way there', /setMoved\(done\.map\(\(id\) => names\.get\(id\)/.test(STAR) && /in Ready to send now, so/.test(STAR) && /<button onClick=\{onOpenQueue\}/.test(STAR) && /onOpenQueue=\{\(\) => setTab\('queue'\)\}/.test(UI))
  check('a request written from a list that stays open says where it went', /action: \{ label: 'Open Ready to send', onClick: \(\) => setTab\('queue'\) \}/.test(UI) && /return written\n  \}/.test(UI))
  check('the left-out count says what it holds', /more you already wrote to, sent or passed on are left out/.test(STAR) && !/more already on your list/.test(STAR))
}
check('the core message card warns while you type, naming every phrase', /const coreHits = termsHits\(core\)/.test(UI) && /\{coreHits\.length > 0 && <p/.test(UI))
// NO HOOK BELOW AN EARLY RETURN. A useMemo put under "if (loading) return"
// crashed the TRYBE page for everyone (2026-10-24): the loading render ran
// one hook fewer than the next one.
{
  const start = UI.indexOf('export default function TrybeOutreach(')
  const body = UI.slice(start)
  const firstReturn = body.search(/\n  if \([^\n]*\) return\b/)
  const pageReturn = body.indexOf('\n  return (', firstReturn)
  const between = firstReturn < 0 ? '' : body.slice(firstReturn, pageReturn)
  const hooks = between.split('\n').filter((l) => /\buse[A-Z][A-Za-z]*\(/.test(l) && !/^\s*\/\//.test(l))
  check(`no React hook runs after an early return in the TRYBE page${hooks.length ? `: ${hooks.map((l) => l.trim().slice(0, 60)).join(' | ')}` : ''}`, firstReturn > 0 && pageReturn > firstReturn && hooks.length === 0)
}
check('the brand\'s pay is never given to a writer', !/`TRYBE pay: \$\{b\.payText\}`/.test(OUT) && !/`Pays: \$\{b\.payText\}`/.test(read('lib/trybe-playbook.ts')) && /payText: null, website: r\.website/.test(ROUTE))

// Voice.
check('a join request takes only its greeting and sign-off from the voice samples', /DRAFT_SYSTEM\(BANNED_RULE\) \+ \(draftVoice\.length \? `\\n\$\{DRAFT_VOICE_RULE\}` : ''\)/.test(ROUTE) && /use it only for the greeting and the sign-off/.test(read('lib/trybe-voice.ts')))

// Saving.
check('only Save message saves the core message', /\.\.\.\(what\.core \? \{ coreMessage: core \} : \{\}\)/.test(UI) && /saveSettings\(false, \{ core: true \}\)/.test(UI) && /if \(coreMessage != null\) row\.core_message = coreMessage/.test(ROUTE))
check('Rewrite all asks first, and unsaved changes to the core message are said', /window\.confirm\(`Write \$\{list\.length === 1/.test(UI) && /function unsavedCoreSaid\(\)/.test(UI))

// Pacing.
check('the server keeps a few seconds between two join requests', /MIN_SEND_GAP_MS = 8_000/.test(OUT) && /gte\('send_started_at', new Date\(Date\.now\(\) - MIN_SEND_GAP_MS\)/.test(ROUTE) && /c\.retryInMs \+ 300/.test(UI))
check('the comments say the pacing as it is', !/SCOUT presses Request to Join for each, 45 to 120 seconds apart\./.test(UI))

// Counts.
check('the inbox counts chats with new messages, no group chats', inboxSnapshot([{ name: 'Room (group)', unread: 40, at: 2 }, { name: 'Oink', unread: 3, at: 1 }]).unread === 1 && /const unread = inboxSnapshot\(inbox\?\.convos \|\| \[\]\)\.unread/.test(UI))
check('sent is said apart from not sent, and the cap as used', /`\$\{went\} sent\$\{notSent \? `, \$\{notSent\} not sent` : ''\}`/.test(UI) && /label="Used of your daily cap"/.test(UI))
check('a request with no send time never counts an older chat as a reply', /if \(!Number\.isFinite\(sentAt\)\) return null/.test(UI))

// Sending.
check('a send in progress is not put back in the queue', /scoutRun\?\.current\?\.id !== b\.brand_id/.test(UI) && /SCOUT started this one less than 4 minutes ago/.test(ROUTE))
check('an edit that changed nothing says so, and Send all waits for edits', /Not saved: this brand is being sent or was sent/.test(ROUTE) && /if \(pendingSave\.current\.size\)/.test(UI))
check('a request that did not go is said where it goes', /moves to Sent as Not sent, with the reason and a Queue it again button/.test(UI))

// Words.
check('"--" is no sentence break', tidyDraft('Thanks for approving us -- we cannot wait.') === 'Thanks for approving us, we cannot wait.')
check('Amazon video links say Amazon', /Video \{i \+ 1\} on Amazon/.test(read('components/labs/TrybeAfterAccept.tsx')))
check('no Amazon plan is named to a customer', !UI.split('\n').some((l) => /Amazon plan/.test(l) && !/^\s*(\/\/|\{\/\*|\*|\/\*\*)/.test(l)))
check('Suggest a reply is not offered in group chats', /\{!\/\\\(group\\\)\/i\.test\(openConvo\?\.name \|\| ''\) && <button onClick=\{\(\) => void suggestReply\(\)\}/.test(read('components/labs/TrybeInbox.tsx')))
check('a failed samples read is said', /MVP could not check your samples just now/.test(read('components/labs/TrybeSampleGuard.tsx')))

if (fails.length) { console.error('trybe-outreach-cleanup failed:\n - ' + fails.join('\n - ')); process.exit(1) }
console.log('✅ trybe-outreach-cleanup: no message talks pay, the core message is saved only on purpose, sends are spaced and counts mean what they say')

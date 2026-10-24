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
import { talksTerms, asksMoney, tidyDraft } from '../lib/trybe-outreach'
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
check('kickoff, follow up and join requests are checked, written once more, then refused', /const moneyOk = \(t: string\) => !talksTerms\(t, \{ adSpendQuestion: action === 'kickoff' \}\)/.test(ROUTE) && /The message kept talking about pay or rates/.test(ROUTE) && /if \(text && talksTerms\(text\)\) text = await write\(/.test(ROUTE) && /The draft kept talking about pay or rates/.test(ROUTE))
check('a core message that talks pay is said on save', /const warning = coreMessage && talksTerms\(coreMessage/.test(ROUTE) && /if \(d\.warning\) toast\.warning\(d\.warning/.test(UI))
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

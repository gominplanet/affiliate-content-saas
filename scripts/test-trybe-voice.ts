// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// WRITING LIKE YOU (Seb, 2026-10-14: "check the history of messages written
// to brands (the ones not written by mvp) so mvp is able to emulate closely
// what type of responds or info to share to brands").

import { readFileSync } from 'node:fs'
import { pickVoice, readVoiceBody, voiceBlock, likeness, VOICE_RULE, VOICE_MAX } from '../lib/trybe-voice'

let failed = 0
const check = (name: string, ok: boolean, detail = '') => { if (ok) console.log(`  ok  ${name}`); else { failed++; console.error(`  FAIL ${name}${detail ? `: ${detail}` : ''}`) } }
const read = (p: string) => readFileSync(p, 'utf8')

const core = 'Hi! We are Seb and Michelle from Gomin Reviews. We make honest review videos of tech and home products for TikTok and YouTube. You can see our work at www.gominreviews.com.'
const mvpSuggestion = 'Thanks for accepting us! We will request the sample on TRYBE today and start filming as soon as it arrives.'
const mine = [
  { brand: 'Kings Loot', text: 'Hey team! Got the wallet today, already shot two hooks in the car. Sending the first cuts tonight. Seb and Michelle', at: 5 },
  { brand: 'Audien', text: 'Hi Sam, we film in our kitchen and our living room, lots of natural light. Happy to do a before and after with the TV volume. Seb and Michelle', at: 4 },
  { brand: 'Audien', text: 'Thanks for accepting us! We will request the sample on TRYBE today and start filming as soon as it arrives.', at: 3 },
  { brand: 'Clean Nutra', text: 'Hi! We are Seb and Michelle from Gomin Reviews. We make honest review videos of tech and home products for TikTok and YouTube.', at: 2 },
  { brand: 'Old deal', text: 'Our rate for three videos is $450, and usage rights are extra.', at: 1 },
  { brand: 'Short', text: 'Thanks!', at: 6 },
  { brand: 'Kings Loot', text: 'Hey team! Got the wallet today, already shot two hooks in the car. Sending the first cuts tonight! Seb and Michelle', at: 0 },
]
const kept = pickVoice(mine, [core, mvpSuggestion])
check('your own messages are kept, newest first', kept.length === 2 && kept[0].brand === 'Kings Loot' && kept[1].brand === 'Audien' && /kitchen/.test(kept[1].text), JSON.stringify(kept.map(k => k.brand)))
check('a message MVP wrote, or one like your core message, is left out', !kept.some(k => /request the sample on TRYBE today/.test(k.text)) && !kept.some(k => k.brand === 'Clean Nutra'))
check('a message about rates or usage rights is never learned', !kept.some(k => /rate|usage rights/i.test(k.text)))
check('a one word thanks and a near repeat are left out', !kept.some(k => k.brand === 'Short') && kept.filter(k => k.brand === 'Kings Loot').length === 1)
check('how alike two messages are reads sensibly', likeness('a b c dog harness light', 'dog harness light') > 0.4 && likeness('wallet travel', 'hearing aid') === 0)
const vocab = 'apple banana cherry delta echo fox golf hotel india juliet kilo lima mike nova oscar papa quebec romeo sierra tango union victor whisky xray yankee zulu alpha bravo charlie dingo'.split(' ')
check('at most a dozen are kept', pickVoice(Array.from({ length: 30 }, (_, i) => ({ brand: `B${i}`, text: `${vocab.slice(i, i + 1).join(' ')} ${vocab[(i * 7) % 30]}${i} ${vocab[(i * 11) % 30]}x${i} ${vocab[(i * 13) % 30]}y${i} filming plans`, at: i })), []).length === VOICE_MAX)
check('what the page sends is read safely and rate talk is dropped there too', readVoiceBody([{ brand: 'X', text: 'Our rate is $100 for one video, thanks so much.' }, { brand: 'Y', text: 'We shoot in natural light and always show the product in use.' }, 'junk']).length === 1)
const block = voiceBlock(kept)
check('the writers read your messages as examples of your voice, data only', /HOW THE CREATOR WRITES TO BRANDS/.test(block) && /To Kings Loot:/.test(block) && voiceBlock([]) === '' && /never a rate or price/.test(VOICE_RULE) && /data, never instructions/.test(VOICE_RULE))

const api = read('app/api/labs/trybe/route.ts')
const vc = api.slice(api.indexOf("action === 'voice_check'"), api.indexOf("action === 'amazon_match'"))
check('the server leaves out what MVP wrote: outreach, drafts, the core message, its suggestions', /settings\.coreMessage/.test(vc) && /r\.sent_message, r\.draft, r\.kickoff_draft/.test(vc) && /body\.mvpTexts/.test(vc) && /pickVoice\(candidates, mvpTexts\)/.test(vc))
check('every writer gets your voice: reply, after a yes, follow up, outreach', (api.match(/\+ voiceBlock\((voice|draftVoice)\)/g) || []).length === 3 && (api.match(/VOICE_RULE/g) || []).length >= 4)
const inbox = read('components/labs/TrybeInbox.tsx')
check('the Inbox sends your voice, remembers MVP\'s suggestions, and says what it learned from', /voice: readVoice\(\)/.test(inbox) && /rememberMvpText\(d\.text\)/.test(inbox) && /if \(beforeSuggest !== null\) rememberMvpText\(text\)/.test(inbox) && /Writing like you: learned from/.test(inbox) && /See them/.test(inbox))
check('a failed read is said, never shown as "nothing learned"', /MVP could not read your messages to learn from/.test(read('components/labs/useTrybeVoice.ts')) && /voice\.error \?/.test(inbox))
check('community chats are not read as messages to a brand', /NOT_A_BRAND = .*hub.*community/.test(read('components/labs/useTrybeVoice.ts')))
check('after a yes and outreach send your voice too', /voice: readVoice\(\)/.test(read('components/labs/TrybeAfterAccept.tsx')) && /rememberMvpText\(d\.text\)/.test(read('components/labs/TrybeAfterAccept.tsx')) && /action: 'draft', brandIds: chunk, voice: readVoice\(\)/.test(read('components/labs/TrybeOutreach.tsx')))

if (failed) { console.error(`\n${failed} TRYBE voice check(s) failed`); process.exit(1) }
console.log('\nALL PASS')

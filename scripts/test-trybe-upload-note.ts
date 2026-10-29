// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// TELL THE BRAND ABOUT THE UPLOAD (Seb, 2026-10-29). Pinned: one message per
// brand for all the videos just sent to it, naming the products and the
// creator, never talking pay, without dashes; sent only by a tap, through
// the chat send that says Sent only once it shows in the chat; no chat and
// already told today are said; Open the chat opens the Inbox on that chat.
import { readFileSync } from 'node:fs'
import { uploadNoteText, toldToday } from '../lib/trybe-upload-note'
import { termsHits } from '../lib/trybe-outreach'

const fails: string[] = []
const check = (name: string, ok: boolean | undefined) => { if (!ok) fails.push(name) }
const read = (f: string) => readFileSync(f, 'utf8')

const one = uploadNoteText('Bassdash', [{ products: ["Men's UPF 50+ Long Sleeve Hunting Hoodie with Mask FS06M"] }], 'Seb Gomin')
check('one video: the brand, the product, in review, and the first name', /^Hi Bassdash team! I just sent you a new video for Men's UPF 50\+ Long Sleeve Hunting Hoodie with Mask FS06M\. It is in your review now\./.test(one) && /Thanks, Seb!$/.test(one))
const three = uploadNoteText('Bassdash', [{ products: ['Hoodie A'] }, { products: ['Shorts B'] }, { products: ['Hoodie A', 'Boots C'] }], '')
check('several videos: one message, counted, products listed once', /I just sent you 3 new videos for Hoodie A, Shorts B and more\. They are in your review now\./.test(three) && /Thanks!$/.test(three))
check('no product picked: still a whole sentence', /I just sent you a new video\. It is in your review now\./.test(uploadNoteText('Haus', [{ products: [] }])))
check('the message never talks pay, and has no dashes', [one, three].every((t) => termsHits(t).length === 0 && !/[–—]| - /.test(t)))

const now = new Date('2026-10-29T15:00:00')
check('told today is said; told yesterday is not', toldToday({ b1: new Date('2026-10-29T09:12:00').toISOString() }, 'b1', now) !== null && toldToday({ b1: new Date('2026-10-28T20:00:00').toISOString() }, 'b1', now) === null && toldToday({}, 'b1', now) === null)

const U = read('components/labs/TrybeUpload.tsx'), T = read('components/labs/TrybeUploadTell.tsx'), O = read('components/labs/TrybeOutreach.tsx')
check('one box per brand, for videos confirmed in its review', /if \(v\.stage !== 'in_review' \|\| !v\.choice\.brandId\) continue/.test(U) && /<TrybeUploadTell key=\{brandId\}/.test(U) && /chat=\{inbox \? chatFor\(g\.brandName, inbox\.convos\) : null\}/.test(U))
check('sent only by a tap, through the send that confirms it in the chat', /onClick=\{\(\) => void send\(\)\}/.test(T) && /await sendInTrybeChat\(chat\.id, text\.trim\(\), me, myName\)/.test(T) && !/useEffect\([^)]*send\(/.test(T))
check('pay words block the send and are named', /const payWords = termsHits\(text\)/.test(T) && /disabled=\{sending \|\| made\.by === 'writing' \|\| !text\.trim\(\) \|\| payWords\.length > 0\}/.test(T) && /TRYBE messages never talk pay/.test(T))
check('no chat, still reading, no SCOUT and told today are each said', /You do not have a chat with \{brandName\} on TRYBE yet/.test(T) && /Reading your TRYBE chats/.test(T) && /Sending in TRYBE chats needs SCOUT/.test(T) && /You told \$\{brandName\} at \$\{time\(told\)\} today/.test(T))
check('Open the chat opens that chat in the Inbox', /<TrybeUpload inbox=\{inbox\} canChat=\{canInbox\} onOpenChat=\{\(id\) => \{ setOpenChat\(o => \(\{ id, n: \(o\?\.n \?\? 0\) \+ 1 \}\)\); setTab\('inbox'\) \}\} \/>/.test(O))

// IN THE CREATOR'S VOICE (Seb, 2026-10-29: "make it the user's voice").
const R = read('app/api/labs/trybe/route.ts')
const writer = R.slice(R.indexOf("if (action === 'upload_note')"), R.indexOf("if (action === 'kickoff' || action === 'followup')"))
check('the server writes it from the creator\'s own messages', writer.length > 200 && /readVoiceBody\(body\.voice\)/.test(writer) && /VOICE_RULE/.test(writer) && /voiceBlock\(voice\)/.test(writer))
check('it is spend gated and counted', /spendGate\(userId, tier\)/.test(writer) && /feature: 'trybe_upload_note'/.test(writer))
check('pay talk is written once more, then refused, never shown', /termsHit\(text\)/.test(writer) && /if \(talksTerms\(text\)\) return NextResponse\.json\(\{ error/.test(writer) && /BANNED_RULE/.test(writer))
check('no dashes reach the box', /replace\(\/\\s\*\[–—\]\\s\*\/g, ', '\)/.test(writer))
check('any brand they sent to, joined through MVP or not', !/from\('trybe_brands'\)/.test(writer))
check('the box asks for it with the voice samples', /action: 'upload_note'/.test(T) && /const voice = readVoice\(\)/.test(T))
check('which message is showing is said: their voice, or the standard one and why', /Written the way you write to brands, from your own TRYBE messages/.test(T) && /This is MVP's standard message\. \$\{made\.why/.test(T) && /MVP has not read how you write to brands yet/.test(T) && /MVP could not write it your way just now/.test(T))
check('a failure falls back to the standard message, never an empty box', (T.match(/return standard\(/g) ?? []).length >= 2 && /catch \{\s*\n\s*standard\(/.test(T))
check('words the creator changed are never overwritten by a late answer', /if \(mine !== run\.current \|\| edited\.current\) return/.test(T) && /if \(showing && !edited\.current\) void write\(\)/.test(T))
check('what MVP wrote is never learned back as the creator\'s own writing', (T.match(/rememberMvpText\(/g) ?? []).length >= 2)
check('a brand told today is not written to again for nothing', /const showing = told !== undefined && \(!told \|\| again\)/.test(T))

if (fails.length) { console.error('FAIL trybe upload note:\n  ' + fails.join('\n  ')); process.exit(1) }
console.log('✅ trybe-upload-note: after an upload, one tap tells the brand in its chat in the creator\'s own voice, never on its own')

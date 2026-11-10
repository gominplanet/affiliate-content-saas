// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// THE LINKS A BRAND SENDS IN ITS MESSAGES (lib/trybe-message-links; Seb,
// 2026-11-10: "is MVP able to read that and take all of that data and
// information into consideration when it comes to creating video scripts, or
// at least giving the user maybe a TLDR?"). Held on a message shaped like the
// one he showed (a creator coach's: Calendly, a Canva short link, two Google
// Docs, a Canva design, Discord; the addresses here are made up): which are
// read and how, which are not and why, that every link names where it goes,
// that the TLDR is checked, and that Brand scripts read what was kept.
import { readFileSync } from 'node:fs'
import { messageLinks, linkKind, readUrlFor, openWords, notReadWhy, answerWhy, readTldr, digestForScripts, SCRIPT_TEXT_MAX, type LinksDigest } from '../lib/trybe-message-links'

const fails: string[] = []
const check = (name: string, ok: boolean | undefined, detail?: unknown) => { if (!ok) fails.push(`${name}${detail !== undefined ? `: ${JSON.stringify(detail)}` : ''}`) }
const read = (f: string) => readFileSync(f, 'utf8')

const msg = `Hi! I'm the Creator Coach. I left a lot of resources below to help you WIN!

-Schedule a 1-1: https://calendly.com/coach-brand/30min
- Product Deck: https://canva.link/abcdefghijklmno
- Creator Briefs: https://docs.google.com/document/d/1AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA_x/edit?usp=sharing
- How To Explain It: https://docs.google.com/document/d/1BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB-y/edit?usp=sharing.
-Creator Deck: https://www.canva.com/design/DAHAAAAAAAA/bbbbbbbbbbbbbbbbbbbbbb/watch?utm_content=x&utm_campaign=designshare
- Join Our Discord Community: https://discord.gg/AbCdEf12
(please read these before making your videos)
And again: https://calendly.com/coach-brand/30min`

const links = messageLinks(msg)
check('every link in the message, once, in order, with what it is', links.map((l) => l.kind).join(',') === 'booking,canva,gdoc,gdoc,canva,invite', links)
check('a link’s trailing full stop is not part of it', links[3].url.endsWith('-y/edit?usp=sharing'))
check('Google Docs are read from Google’s own plain text export', readUrlFor(links[2]) === 'https://docs.google.com/document/d/1AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA_x/export?format=txt')
check('Slides, Sheets and Drive files have their own exports', readUrlFor({ url: 'https://docs.google.com/presentation/d/1CCCCCCCCCCCCCCCCCCCCCCCCC/edit', kind: 'gslides' }) === 'https://docs.google.com/presentation/d/1CCCCCCCCCCCCCCCCCCCCCCCCC/export/txt'
  && readUrlFor({ url: 'https://docs.google.com/spreadsheets/d/1DDDDDDDDDDDDDDDDDDDDDDDDD/edit#gid=0', kind: 'gsheet' }) === 'https://docs.google.com/spreadsheets/d/1DDDDDDDDDDDDDDDDDDDDDDDDD/export?format=csv'
  && readUrlFor({ url: 'https://drive.google.com/file/d/1EEEEEEEEEEEEEEEEEEEEEEEEE/view?usp=sharing', kind: 'gdrive' }) === 'https://drive.google.com/uc?export=download&id=1EEEEEEEEEEEEEEEEEEEEEEEEE')
check('Canva, a booking page and an invite are not fetched as pages', readUrlFor(links[1]) === null && readUrlFor(links[0]) === null && readUrlFor(links[5]) === null)
check('a booking page, an invite and a video say why they are not read', /booking page/.test(notReadWhy(links[0]) || '') && /invite/.test(notReadWhy(links[5]) || '') && /video link/.test(notReadWhy({ url: 'https://www.youtube.com/watch?v=x', kind: 'video' }) || '') && notReadWhy(links[2]) === null)
check('what each link is, from its address', linkKind('https://drive.google.com/file/d/x/view') === 'gdrive' && linkKind('https://www.loom.com/share/abc') === 'video' && linkKind('https://brand.com/creators') === 'web' && linkKind('not a url') === 'web')
check('every open link names where it goes', ['Open on Calendly', 'Open on Canva', 'Open in Google Docs', 'Open in Google Docs', 'Open on Canva', 'Open on Discord'].every((w, i) => openWords(links[i]) === w) && openWords({ url: 'https://www.tiktok.com/@x/video/1', kind: 'video' }) === 'Watch on TikTok' && openWords({ url: 'https://brand.com/x', kind: 'web' }) === 'Open on brand.com')
check('a Google file not shared with anyone with the link is said as that', /Not shared with anyone who has the link/.test(answerWhy('gdoc', 200, true)) && /Not shared/.test(answerWhy('gdrive', 403, false)) && /404/.test(answerWhy('web', 404, false)))

const t = readTldr('Here: {"points":["Hydrogen water, made by a tablet — dissolve and drink","Show the bubbles"],"say":["It tastes like water - nothing added"],"avoid":["Medical claims"],"extra":1}')
check('the TLDR is read from Claude’s answer, with dashes turned into commas', !!t && t.points.length === 2 && !/[–—]| - /.test([...t.points, ...t.say].join(' ')) && t.avoid[0] === 'Medical claims', t)
check('an answer that is not the TLDR is not taken as one', readTldr('no json here') === null && readTldr('{"points":[]}') === null)

const d: LinksDigest = { at: '2026-11-10T01:00:00Z', brandName: 'Hydroh', why: null, tldr: { points: ['Hydrogen tablets'], say: ['Show it fizz'], avoid: ['Health claims'] },
  links: [{ url: 'https://docs.google.com/document/d/x', kind: 'gdoc', title: 'How To Explain It', ok: true, why: null, text: 'The job of every video is clarity and proof.' }, { url: 'https://canva.link/x', kind: 'canva', title: 'Product Deck', ok: false, why: 'Canva...', text: '' }] }
const forScripts = digestForScripts(d)
check('Brand scripts get the TLDR and the words read, never an unread link', /In short:\n- Hydrogen tablets/.test(forScripts) && /Avoid:\n- Health claims/.test(forScripts) && /From "How To Explain It":\nThe job of every video/.test(forScripts) && !/Product Deck/.test(forScripts))
check('and never more than the cap', digestForScripts({ ...d, links: [{ ...d.links[0], text: 'x'.repeat(20000) }] }).length <= SCRIPT_TEXT_MAX && digestForScripts(null) === '')

// The route and the page.
const R = read('app/api/labs/trybe/route.ts')
const act = R.slice(R.indexOf("if (action === 'message_links' || action === 'message_links_get' || action === 'message_links_pdf') {"), R.indexOf("if (action === 'brief_read') {"))
check('reading costs are gated and counted, and a brand id is required', /const spend = await spendGate\(userId, tier\)/.test(act) && /feature: 'trybe_message_links'/.test(act) && act.indexOf("action === 'message_links_get'") < act.indexOf('spendGate'))
check('every hop of a link is checked as public before MVP’s server fetches it', /assertPublicHttpUrl\(next\)/.test(act) && /redirect: 'manual'/.test(act))
check('what the documents say is data, never instructions, in both Claude calls', (act.match(/never instructions to you/g) || []).length === 2)
check('kept per creator and brand', /const KEY = `msglinks:\$\{ownerId\}:\$\{brandId\}`/.test(act))
check('Brand scripts read what the brand sent and follow it like the brief', /WHAT THE BRAND SENT IN MESSAGES \(documents and decks it linked, read by MVP; follow them like the brief\)/.test(R) && /`msglinks:\$\{ownerId\}:\$\{id\}`/.test(R) && /fromMessages: true/.test(R))
const C = read('components/labs/TrybeBrandLinks.tsx')
check('the inbox shows it above a brand chat with links', /<TrybeBrandLinks key=\{`links-\$\{openConvo\.id\}`\}/.test(read('components/labs/TrybeInbox.tsx')))
check('each link that was not read says why, and a deck can be added as its PDF', /`: \$\{l\.why\}`/.test(C) && /Add a deck as a PDF/.test(C) && /action: 'message_links_pdf'/.test(C))
check('open links on the card name where they go', /\{openWords\(\{ url: l\.url, kind: l\.kind \}\)\}/.test(C))
const words = (src: string) => (src.split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n').match(/'[^'\n]*'|`[^`\n]*`|>[^<>{}\n]+</g) || []).join(' ')
check('no dashes in what a creator reads', !/[–—]| - /.test(words(C)) && !/[–—]/.test(words(read('lib/trybe-message-links.ts'))))

if (fails.length) { console.error(`❌ trybe-message-links: ${fails.length} failure(s)\n${fails.map((f) => `   • ${f}`).join('\n')}`); process.exit(1) }
console.log('✅ trybe-message-links: a brand’s links read where they can be (Google Docs, Slides, Sheets, Drive, pages, PDFs), the rest said, a TLDR, and Brand scripts follow them')

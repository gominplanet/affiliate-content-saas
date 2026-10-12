// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// The brand's own TRYBE page from a chat (Seb, 2026-10-12: "when clicking on
// brand page on trybe.. it rarely finds the page"). The chat's own brand id
// first, then joined brands, then the directory; whole name, then the brand's
// name inside the chat's name. The link is the brand's own page.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { brandIdFromChat, brandPageUrl, matchBrand, normName, readBrandCard } from '../lib/trybe-brand-page'

let failed = 0
function check(name: string, ok: boolean, detail = '') {
  if (ok) console.log(`  ok  ${name}`)
  else { failed++; console.error(`  FAIL ${name}${detail ? `: ${detail}` : ''}`) }
}
const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
const UUID = 'c57218b9-59fd-44ec-b127-857f1ac3550a'

check('the link is the brand\'s own page, as TRYBE shows it', brandPageUrl(UUID) === `https://jointrybe.com/creator/brands/${UUID}`)
check('a brand id on the chat is found', brandIdFromChat({ id: 'chan-123456', brandId: UUID }) === UUID)
check('a brand object on the chat is found', brandIdFromChat({ id: 'chan-123456', brand: { id: UUID, name: 'Jive' } }) === UUID)
check('a brand id deeper in the chat is found', brandIdFromChat({ id: 'chan-123456', metadata: { context: { brand_id: UUID } } }) === UUID)
check('a brand participant is found', brandIdFromChat({ id: 'chan-123456', members: [{ id: 'user-999999', type: 'creator' }, { id: UUID, type: 'BRAND' }] }) === UUID)
check('the chat\'s own id is never taken for the brand', brandIdFromChat({ id: 'chan-123456', name: 'Clean Nutra' }) === null)

const joined = [{ id: 'joined-clean-nutra', name: 'Clean Nutra' }, { id: 'joined-audien', name: 'Audien' }, { id: 'joined-jive', name: 'Jive Nutrition' }]
const directory = [{ id: 'dir-clean', name: 'Clean Nutra Inc.', website: 'https://cleannutra.com/' }, { id: 'dir-nobl', name: 'NOBL', website: 'https://nobl.com/' }]
check('company words do not stop a match', normName('Clean Nutra Inc.') === normName('Clean Nutra'))
check('a joined brand wins over the directory', matchBrand('Clean Nutra', joined, directory)?.id === 'joined-clean-nutra')
check('a brand not joined is found in the directory, with its website', (() => { const m = matchBrand('NOBL', joined, directory); return m?.id === 'dir-nobl' && m.website === 'https://nobl.com/' && m.source === 'directory' })())
check('a group chat named after the brand is that brand', matchBrand('\u{1F3A7} Audien Creator Vault', joined, directory)?.id === 'joined-audien')
check('a chat about nothing on the list is not matched', matchBrand('trybe-creator-hub', joined, directory) === null)
check('a short name does not match inside other words', matchBrand('Gold standard deals', [{ id: 'go-brand-1', name: 'Go' }], []) === null)

const card = readBrandCard({ data: { id: UUID, name: 'Jive Nutrition', websiteUrl: 'jivenutrition.com', logoUrl: 'https://cdn.example.com/jive.png', commissionRules: ['15% of sales'], creativeBrief: { text: 'Show the scoop and the taste test.' } } })
check('the details give the website, pay, logo and brief', card.website === 'https://jivenutrition.com/' && card.pay === '15% of sales' && card.logo === 'https://cdn.example.com/jive.png' && card.brief === 'Show the scoop and the taste test.', JSON.stringify(card))
const linked = readBrandCard({ brand: { name: 'X' }, briefUrl: 'https://docs.example.com/brief.pdf' })
check('a brief that is a link is a link', linked.briefUrl === 'https://docs.example.com/brief.pdf' && linked.brief === null)
check('details with nothing in them read as nothing, not as made up values', (() => { const c = readBrandCard({}); return !c.website && !c.pay && !c.brief && !c.briefUrl })())

const inbox = read('components/labs/TrybeInbox.tsx')
check('the chat shows the brand card', /<TrybeBrandCard key=\{openConvo\.id\}/.test(inbox) && !/TrybeLink/.test(inbox))
const cardSrc = read('components/labs/TrybeBrandCard.tsx')
check('the card links the brand page and the website', /href=\{page\}/.test(cardSrc) && /href=\{website\}/.test(cardSrc))
check('a chat with no brand says so, with a way to find it', /Not matched to a brand/.test(cardSrc))
check('a name match says it was a name match', /Matched by name/.test(cardSrc))
const allow = read('extension/background.js')
check('SCOUT already allows the two reads (no new SCOUT)', /brands\\\/stats/.test(allow) && /\(details\|top-formats\|leaderboard\)/.test(allow))

if (failed) { console.error(`\n${failed} TRYBE brand page check(s) failed`); process.exit(1) }
console.log('\nALL PASS')

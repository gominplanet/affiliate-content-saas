// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Brand messages name a niche only when the creator wants one (Alejandro,
// 2026-10-12: unticking every category still showed a niche).

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { outreachNiche } from '../lib/outreach-niche'

let failed = 0
function check(name: string, ok: boolean) { if (ok) console.log(`  ok  ${name}`); else { failed++; console.error(`  FAIL ${name}`) } }
const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')

const off = outreachNiche({ niche: 'Home & Kitchen', outreach_profile: { categories: ['Tech'], omitCategories: true } })
check('"Don\'t mention" wins over ticked categories and the Brand page niche', off.fact === '' && /Do NOT name a niche/.test(off.rule))
check('ticked categories are used, and only those', outreachNiche({ niche: 'Home', outreach_profile: { categories: ['Tech', 'Tools'] } }).fact === 'Content categories I cover: Tech, Tools')
const fb = outreachNiche({ niches: ['Kitchen', 'Garden'], outreach_profile: { categories: [] } })
check('nothing ticked: the Brand page niche, named as its source', fb.source === 'brand' && fb.words === 'Kitchen, Garden')
check('no categories and no niche: nothing', outreachNiche({}).fact === '' && outreachNiche({}).rule === '')

const route = read('app/api/campaigns/outreach/route.ts')
check('the CC message writer uses the shared rule, not its own fallback', /outreachNiche\(bp\)/.test(route) && !/opCategories/.test(route) && /nicheLine\.rule/.test(route))
check('TRYBE uses the same rule', /outreachNiche\(bp\)/.test(read('app/api/labs/trybe/route.ts')))
check('the setting is saved', /omitCategories: p\.omitCategories === true/.test(read('app/api/collaborations/profile/route.ts')))
const card = read('components/collaborations/OutreachProfileCard.tsx')
check('the card offers the option and says what a message will mention', /Don&apos;t mention a niche or category/.test(card) && /messages use the niche from your Brand page/.test(card))

if (failed) { console.error(`\n${failed} outreach niche check(s) failed`); process.exit(1) }
console.log('\nALL PASS')

// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Green for a percent of sales, red for a percent of ad spend only.
//
// Seb, 2026-11-25: "we really need to highlight for users the brands on Trybe
// that offer % of GMV and not % of adspend .. when users search and we list
// those brands.. we need to make a green highlight for good brands and red
// highlight for 'bad' brands."

import { readFileSync } from 'node:fs'
import { payHighlight, payReadOf, PAY_HIGHLIGHT_WORDS } from '../lib/trybe-pay'

const failures: string[] = []
const check = (name: string, ok: boolean) => { if (!ok) failures.push(name) }
const read = (p: string) => readFileSync(p, 'utf8')
const of = (lines: string[]) => payHighlight(payReadOf(lines).kinds)

// 1. From TRYBE's own pay lines
check('"15% of GMV" is green', of(['15% of GMV']) === 'sales')
check('"20% of ad spend" is red', of(['20% of ad spend']) === 'adSpend')
check('a brand paying both a % of sales and a % of ad spend is green: it pays on sales', of(['10% of GMV', '5% of ad spend']) === 'sales')
check('a flat fee plus a % of sales is green', of(['$25 per approved video plus 5% of sales']) === 'sales')
check('a flat fee only, a fee per order or a retainer gets no colour', of(['$50 per video']) === null && of(['$5 per order']) === null && of(['Guaranteed $500 this period if you submit 10 videos']) === null)
check('terms MVP cannot read get no colour, never a guess', of(['Ask the brand']) === null && of([]) === null && payHighlight(undefined) === null)
check('the words say what each colour means, no dashes', PAY_HIGHLIGHT_WORDS.sales.chip === '% of sales' && PAY_HIGHLIGHT_WORDS.adSpend.chip === '% of ad spend only' && /stops running them/.test(PAY_HIGHLIGHT_WORDS.adSpend.why) && !/[–—]/.test(JSON.stringify(PAY_HIGHLIGHT_WORDS)))

// 2. Sent with every brand in the search
const ROUTE = read('app/api/labs/trybe/route.ts')
check('Find brands sends each brand\'s colour', /pay_basis: payHighlight\(pay\.kinds\)/.test(ROUTE))

// 3. The whole card's hue wherever brands are listed (Seb: "I don't want it to
//    be a chip. I want the whole card to be either green... or a red hue.")
const UI = read('components/labs/trybe-ui.tsx')
check('one hue each, green or red, as the card\'s ground and border, with the reason on hover', /sales: \{ color: '#16A34A'/.test(UI) && /adSpend: \{ color: '#DC2626'/.test(UI) && /export function payBasisCard/.test(UI) && /export function payBasisTitle/.test(UI))
check('no chip', !/PayBasisChip/.test(UI) && !/PayBasisChip/.test(read('components/labs/TrybeBrandTable.tsx')))
check('a key above the list says what green and red mean', /export function PayBasisKey/.test(UI) && /Green: pays a % of sales/.test(UI) && /Red: pays a % of ad spend only/.test(UI) && /<PayBasisKey \/>/.test(read('components/labs/TrybeOutreach.tsx')))
const TABLE = read('components/labs/TrybeBrandTable.tsx')
check('the results table tints the whole row, its pinned cells too, and says why on hover', /basis \? PAY_BASIS\[basis\]\.soft/.test(TABLE) && /\$\{PAY_BASIS\[basis\]\.pct\}%, var\(--surface\)\)/.test(TABLE) && /title=\{payBasisTitle\(basis\)\}/.test(TABLE))
check('the Find cards take the hue', /payBasisOf\(b\.pay_basis\) \? PAY_BASIS\[payBasisOf\(b\.pay_basis\)!\]\.soft/.test(read('components/labs/TrybeOutreach.tsx')))
for (const [f, re] of [
  ['components/labs/TrybeStarBrands.tsx', /payBasisCard\(payBasisOf\(b\.pay_basis\)\)/],
  ['components/labs/TrybeBestNew.tsx', /payBasisCard\(payBasisOf\(b\.pay_basis\)\)/],
  ['components/labs/TrybeBrandPeek.tsx', /payBasisCard\(payBasisOf\(brand\.pay_basis\)\)/],
  ['components/labs/TrybeDossier.tsx', /payBasisCard\(payBasisOf\(listing\.pay_basis\)\)/],
] as Array<[string, RegExp]>) check(`${f} takes the hue`, re.test(read(f)))

if (failures.length) {
  console.error(`test-trybe-pay-basis: ${failures.length} failed`)
  for (const f of failures) console.error(`  ✗ ${f}`)
  process.exit(1)
}
console.log('test-trybe-pay-basis: all checks passed')

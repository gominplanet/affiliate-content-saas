// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// The SEO page explains itself (Seb, 2026-10-12: "cleaned up for ease of use..
// explain to users what each thing does and what it means to them"):
//   - seven numbered sections, each with what it is and what it means for you;
//   - every "?" tip points at a word that is explained;
//   - one list of today's requests to Google, not two that pick differently;
//   - the words are plain: no dashes, no year, no Indexing API.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { TERMS, SECTIONS, JOURNEY, TOOLS, term } from '../lib/seo-glossary'

let failed = 0
function check(name: string, ok: boolean, detail = '') {
  if (ok) console.log(`  ok  ${name}`)
  else { failed++; console.error(`  FAIL ${name}${detail ? `: ${detail}` : ''}`) }
}
const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')

const page = read('app/(dashboard)/seo/page.tsx')
const board = read('components/seo/PostBoard.tsx')
const explain = read('components/seo/SeoExplain.tsx')
const help = read('components/seo/IndexingHelp.tsx')
const guide = read('components/guide/tool-guides.tsx')

// Sections, in order, each explained.
const used = [...page.matchAll(/<SeoSection id="([\w-]+)" index=\{(\d+)\}/g)].map((m) => ({ id: m[1], n: Number(m[2]) }))
check('the page has every section, numbered in order', used.map((u) => u.id).join(',') === SECTIONS.map((s) => s.id).join(',') && used.every((u, i) => u.n === i + 1), used.map((u) => `${u.n}:${u.id}`).join(' '))
check('every section says what it is and what it means for you', SECTIONS.every((s) => s.what.length > 40 && s.forYou.length > 40 && s.helps.length > 0))
check('the page opens with how it works', /<SeoIntro \/>/.test(page) && JOURNEY.length === 4)
check('section ids are unique on the page (no clash with ids inside cards)', !/id="seo-board"/.test(board) && !/<div id="get-found"/.test(page))

// Every tip points at an explained word.
const tips = [...(page + board + explain).matchAll(/<InfoTip id=(?:"([\w-]+)"|\{[^}]*?'([\w-]+)'[^}]*?'([\w-]+)'[^}]*\}|\{tip\})/g)]
  .flatMap((m) => [m[1], m[2], m[3]]).filter(Boolean) as string[]
const cardTips = [...page.matchAll(/tip="([\w-]+)"/g)].map((m) => m[1])
const missing = [...tips, ...cardTips].filter((id) => !term(id))
check('every "?" tip explains a word in the glossary', tips.length >= 8 && missing.length === 0, missing.join(','))
check('every word has what it is and what it means for you', TERMS.every((t) => t.means.length > 20 && t.forYou.length > 20))
check('the other tools are each explained', TOOLS.length === 6 && TOOLS.every((t) => t.says.length > 20))

// One list of today's requests.
check('Request indexing has one list on the page, in the board\'s plans', !/requestQueue\(/.test(help) && /Go to today&apos;s list/.test(help) && /request_today/.test(board))
check('the post list explains its marks and buttons', /function ListKey/.test(page) && /<ListKey /.test(page))

// Plain words.
const words = JSON.stringify({ TERMS, SECTIONS, JOURNEY, TOOLS })
check('no dashes in the explanations', !/[–—]| - /.test(words))
check('no year in the explanations', !/\b20\d\d\b/.test(words))
const seoGuide = guide.slice(guide.indexOf('export function SeoGuide'), guide.indexOf('// ── Ads'))
check('the page guide matches the page: no Index button, no Indexing API', !/Indexing API|Nudge Google with Index/.test(seoGuide) && /The four steps/.test(seoGuide))

if (failed) { console.error(`\n${failed} SEO explain check(s) failed`); process.exit(1) }
console.log('\nALL PASS')

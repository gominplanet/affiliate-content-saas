// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// The SEO guide (Seb, 2026-10-12: "a guide for confused users about /seo ...
// clickable at the top of that page, thoroughly detailed but explained
// clearly"). It must be reachable from the top of /seo, cover every section,
// every stage and every word the page uses, and read in plain sentences.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { LANES } from '../lib/post-doctor'

let failed = 0
function check(name: string, ok: boolean, detail = '') {
  if (ok) console.log(`  ok  ${name}`)
  else { failed++; console.error(`  FAIL ${name}${detail ? `: ${detail}` : ''}`) }
}
const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')

const guide = read('app/(dashboard)/seo/guide/page.tsx')
const seo = read('app/(dashboard)/seo/page.tsx')
check('the guide link sits at the top of /seo, before the tabs and sections', /href="\/seo\/guide"/.test(seo) && seo.indexOf('href="/seo/guide"') < seo.indexOf('<SeoHubTabs />') && seo.indexOf('href="/seo/guide"') < seo.indexOf('<SeoIntro />'))
check('the guide reads the page\'s own sections, terms, steps and tools', /SECTIONS\.map/.test(guide) && /TERMS\.map/.test(guide) && /JOURNEY\.map/.test(guide) && /TOOLS\.map/.test(guide) && /LANES\.map/.test(guide))
const missing = LANES.filter((l) => !new RegExp(`\\n  ${l.id}: '`).test(guide)).map((l) => l.id)
check('every stage on the board says what to do', missing.length === 0, missing.join(', '))
check('every section links back to its place on the page', /href=\{`\/seo#\$\{s\.id\}`\}/.test(guide))
check('the first steps and the weekly routine are there', /id="first"/.test(guide) && /id="routine"/.test(guide) && /Connect Search Console/.test(guide))
check('the request limit comes from the same number the board uses', /REQUESTS_PER_DAY/.test(guide) && !/about 10 a day/.test(guide))
const visible = guide.replace(/^\s*\/\/.*$/gm, '')
check('no em or en dashes in the guide', !/[–—]/.test(visible))
check('no year in the guide copy', !/\b20[2-3]\d\b/.test(visible))
check('the page does not export anything Next does not allow', !/^export (const|function) (?!default)/m.test(guide))

if (failed) { console.error(`\n${failed} SEO guide check(s) failed`); process.exit(1) }
console.log('\nALL PASS')

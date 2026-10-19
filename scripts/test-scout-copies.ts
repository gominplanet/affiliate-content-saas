// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// TWO SCOUTS IN ONE CHROME TAKE TURNS NO MORE (lib/scout-copies). Alejandro,
// 2026-10-19: on the latest SCOUT his TRYBE sends still failed with the old
// error and TRYBE asked to be allowed on every visit. MVP had kept only the
// last copy to announce itself. This guard keeps every copy, the newest one
// answering, and the banner saying so.
import { readFileSync, existsSync } from 'node:fs'
import { rankScoutCopies, twoCopiesWords } from '../lib/scout-copies'

const failures: string[] = []
const check = (name: string, cond: boolean) => { if (!cond) failures.push(name) }

const STORE = 'blpmlneliggaekangckpgknphpacapkg'
const HAND = 'abcdefghijklmnopabcdefghijklmnop'
const OTHER = 'ponmlkjihgfedcbaponmlkjihgfedcba'

check('the newest copy answers first', rankScoutCopies([{ id: STORE, version: '1.52.2' }, { id: HAND, version: '1.53.0' }], STORE)[0].id === HAND)
check('the Web Store copy wins between equals', rankScoutCopies([{ id: HAND, version: '1.53.0' }, { id: STORE, version: '1.53.0' }], STORE)[0].id === STORE)
check('an old copy added by hand never beats a newer Web Store copy', rankScoutCopies([{ id: HAND, version: '1.52.2' }, { id: STORE, version: '1.53.0' }], STORE)[0].id === STORE)
check('versions compare as numbers, not text', rankScoutCopies([{ id: HAND, version: '1.9.0' }, { id: OTHER, version: '1.10.0' }], STORE)[0].id === OTHER)
check('a copy with no version goes last', rankScoutCopies([{ id: OTHER, version: null }, { id: HAND, version: '1.40.0' }], STORE)[0].id === HAND)
check('the same copy twice is one copy', rankScoutCopies([{ id: HAND, version: '1.53.0' }, { id: HAND, version: null }], STORE).length === 1)
check('one copy says nothing', twoCopiesWords([{ id: STORE, version: '1.53.0' }], STORE) === null)
const two = twoCopiesWords([{ id: STORE, version: '1.53.0' }, { id: HAND, version: '1.52.2' }], STORE) || ''
check('two copies are named, with where each came from', /2 copies of SCOUT/.test(two) && /1\.53\.0 from the Chrome Web Store/.test(two) && /1\.52\.2 added by hand/.test(two))
check('and the words say why it matters', /TRYBE asks you to allow SCOUT again/.test(two))
check('no dashes in what the member reads', !/[–—]| - /.test(two))

const FRAME = readFileSync('lib/extension-frame.ts', 'utf8')
const BANNER = readFileSync('components/layout/ScoutRequired.tsx', 'utf8')
const ROUTE = readFileSync('app/api/scout/seen/route.ts', 'utf8')
check('every copy that announces itself is kept, not just the last', /discoveredScouts\.set\(d\.extensionId/.test(FRAME) && !/discoveredScoutId = d\.extensionId/.test(FRAME))
check('sends go to the ranked copies first', /rankScoutCopies\(scoutCopiesFound\(\), SCOUT_STORE_EXTENSION_ID\)/.test(FRAME))
check('a removed copy is dropped once it stops answering', /discoveredScouts\.delete\(c\.id\)/.test(FRAME))
check('the version reported is the copy MVP talks to', /const top = rankScoutCopies\(copies, SCOUT_STORE_EXTENSION_ID\)\[0\]/.test(FRAME))
check('the banner says when there are two', /kind: 'copies'/.test(BANNER) && /twoCopiesWords\(found\.copies/.test(BANNER))
check('what was found includes the copies', /body: JSON\.stringify\(\{ install, version, background, copies \}\)/.test(BANNER) && /scout_copies/.test(ROUTE))
check('a database without migration 446 still keeps the rest', ROUTE.indexOf('scout_copies') > ROUTE.indexOf('scout_seen_at'))
const BG = readFileSync('extension/background.js', 'utf8')
// SCOUT 1.53.1: allowed is allowed, one Allow window, and a miss says its size.
check('allowed on jointrybe.com counts as allowed', /const TRYBE_WORK_ORIGIN = \['https:\/\/jointrybe\.com\/\*'\]/.test(BG) && /permissions\.contains\(\{ origins: TRYBE_WORK_ORIGIN \}\)/.test(BG))
check('one Allow window at a time', /if \(trybeAsking\) \{/.test(BG) && /trybeAskWin = winId/.test(BG))
check('a send that finds no search box says how big the page was drawn', /\$\{window\.innerWidth\}x\$\{window\.innerHeight\}, \$\{Array\.from\(document\.querySelectorAll\('input'\)\)/.test(BG))

const MIG = existsSync('supabase/migrations/446_scout_copies.sql') ? readFileSync('supabase/migrations/446_scout_copies.sql', 'utf8') : ''
check('migration 446 is safe to run twice', /add column if not exists scout_copies jsonb/.test(MIG))

if (failures.length) {
  console.error(`\n❌ scout-copies: ${failures.length} failure(s)\n`)
  for (const f of failures) console.error(`   • ${f}`)
  process.exit(1)
}
console.log('✅ scout-copies: with two SCOUTs installed, the newest answers every time and the banner says so')

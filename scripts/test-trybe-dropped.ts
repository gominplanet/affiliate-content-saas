// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// THE TRYBE CONNECTION DROPPING (lib/trybe-tab trybeDropped; Seb, 2026-11-09:
// the TRYBE inbox said "page-error: Failed to fetch", "this happens too
// often"). Held on the traps: a read that never reached TRYBE is asked again
// after a pause, a write never is (TRYBE may have it), what is left is said in
// words and never the browser's own error, and the inbox keeps the chats it
// had rather than going blank.
import { readFileSync } from 'node:fs'
import { trybeDropped, trybeDroppedWords, TRYBE_DROP_WAITS_MS } from '../lib/trybe-tab'

const fails: string[] = []
const check = (name: string, ok: boolean | undefined) => { if (!ok) fails.push(name) }
const read = (f: string) => readFileSync(f, 'utf8')

check('the browser’s Failed to fetch from TRYBE’s tab is a dropped connection', trybeDropped({ status: 0, error: 'page-error: Failed to fetch' }) && trybeDropped({ error: 'page-error: NetworkError when attempting to fetch resource.' }))
check('an answer from TRYBE is not a drop, even a bad one', !trybeDropped({ status: 500, error: 'page-error: Failed to fetch' }) && !trybeDropped({ status: 0, error: 'not-allowed' }) && !trybeDropped({ status: 401 }))
check('a read is asked twice more, after pauses long enough for TRYBE’s tab to reload', TRYBE_DROP_WAITS_MS.length === 2 && TRYBE_DROP_WAITS_MS[0] >= 1000 && TRYBE_DROP_WAITS_MS[1] >= 3000)
check('what is left is said in words, with what to do', /Press Refresh/.test(trybeDroppedWords(false)) && !/page-error|Failed to fetch/i.test(trybeDroppedWords(false)))
check('a dropped write says TRYBE may have it, so check before sending again', /cannot tell whether TRYBE got it/.test(trybeDroppedWords(true)))
check('no dashes in the words', !/[–—]/.test(trybeDroppedWords(true) + trybeDroppedWords(false)))

const F = read('lib/extension-frame.ts')
const fn = F.slice(F.indexOf('export async function requestTrybeApi'), F.indexOf('// THE PAGE\'S TRYBE READS, QUEUED'))
check('reads are asked again after each pause while the drop lasts', /for \(const wait of TRYBE_DROP_WAITS_MS\) \{\n\s*if \(r\.ok \|\| !trybeDropped\(r\)\) break\n\s*await new Promise\(\(ok\) => setTimeout\(ok, wait\)\)\n\s*r = await once\(\)/.test(fn))
check('a write is sent once and never repeated by itself', /if \(method !== 'GET'\) \{\n\s*trybeInFlight\.clear\(\)\n\s*const w = await once\(\)\n\s*return !w\.ok && trybeDropped\(w\) \? \{ \.\.\.w, error: trybeDroppedWords\(true\) \} : w\n\s*\}/.test(fn))
const I = read('components/labs/TrybeInbox.tsx')
check('a failed refresh keeps the chats already on screen, and says they are from the last read', /if \(!r\.ok\) \{ const had = convosRef\.current\.length; setListNote\(had \? `\$\{errWords\(r\)\}\. The chats below are from the last read\.` : errWords\(r\)\); return null \}/.test(I) && !/setListNote\(errWords\(r\)\); setConvos\(\[\]\)/.test(I))

if (fails.length) { console.error(`✗ ${fails.length} TRYBE drop check(s) failed:\n  ${fails.join('\n  ')}`); process.exit(1) }
console.log('✓ TRYBE drops: a dropped read asked again after a pause, a write never repeated, words not browser errors, and the inbox kept')

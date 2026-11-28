// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// ONE RECORDING, EVERY PART (Seb, 2026-11-28: "could I send everything at
// once in one file where I just say all the hooks, all the bodies, and all
// the CTAs, and let MVP do the rest?"). The recording is written down word by
// word; each part of the set's scripts is found in it (the last good take of
// a line said twice), or each part's name said aloud when there are no
// scripts; the video server cuts each part into its own file.

import { readFileSync } from 'node:fs'
import { splitVoice, splitByLabels, splitWords, settle, partsFromScripts, norm, cutDone, CUT_STALE_MS, MATCH_MIN, type HeardWord, type CutJob } from '../lib/voice-split'
import type { ModularScripts } from '../lib/studio-scripts'

const failures: string[] = []
const check = (name: string, ok: boolean, detail?: unknown) => { if (!ok) failures.push(`${name}${detail !== undefined ? `: ${JSON.stringify(detail)}` : ''}`) }
const read = (p: string) => readFileSync(p, 'utf8')

/** Words said one after another from `at`, 0.4 s apart. */
const say = (t: string, at: number): HeardWord[] => t.split(' ').map((w, i) => ({ start: Math.round((at + i * 0.4) * 100) / 100, end: Math.round((at + i * 0.4 + 0.3) * 100) / 100, text: w }))

const scripts = {
  type: 'voiceover',
  hooks: [{ id: 'H1', style: '', say: 'Stop throwing away half your groceries every week', show: '', onScreen: '' }, { id: 'H2', style: '', say: 'This little sealer paid for itself in a month', show: '', onScreen: '' }],
  bodies: [{ id: 'B1', angle: '', lines: [{ say: 'Put the food in the bag and zip it shut.', show: '' }, { say: 'Press once and it seals by itself.', show: '' }] }],
  ctas: [{ id: 'C1', say: 'Grab yours before the sale ends!', show: '', onScreen: '' }, { id: 'C2', say: 'Link below for the bundle deal today', show: '', onScreen: '' }],
  broll: [],
} as unknown as ModularScripts

{
  check('the parts come from the scripts, in order, words compared plainly', partsFromScripts(scripts).map((p) => p.label).join(' ') === 'H1 H2 B1 C1 C2' && norm('Shut.') === 'shut' && norm("Don’t") === 'dont' && MATCH_MIN > 0.5)
  const words = [
    ...say('Hook one Stop throwing away half your groceries uh', 0),
    ...say('Stop throwing away half your groceries every week', 5),
    ...say('okay This little sealer paid for itself in a month', 10),
    ...say('Put the food in the bag and zip it shut Press once and it seals by itself', 16),
    ...say('Grab yours before the sale ends', 25),
  ]
  const r = splitVoice(words, scripts, 30)
  const at = (l: string) => r.found.find((f) => f.label === l)
  check('each part found where it was said', r.how === 'scripts' && ['H1', 'H2', 'B1', 'C1'].every((l) => !!at(l)), r.found.map((f) => f.label))
  check('a line said twice is taken from the last good take', (at('H1')?.start ?? 0) > 4.5 && (at('H1')?.end ?? 0) > 8, at('H1'))
  check('a part begins on its first word, a breath before it', at('B1')?.start === 15.88 && at('H2')?.start === 10.28, [at('B1')?.start, at('H2')?.start])
  check('a part ends a little after its last word, never into the next', (at('B1')?.end ?? 0) <= 24.95 && (at('B1')?.end ?? 0) >= 22.9, at('B1')?.end)
  check('a part not said is named, never guessed', r.missing.join() === 'C2' && !at('C2'))
  check('found and not heard, in words', splitWords(r) === 'Found 2 hooks, 1 body and 1 CTA. Not heard: C2. Record it on its own and add it to its column.', splitWords(r))
}

{
  const words = say('Hook one stop wasting food Hook two you need this Body one here is how it works Body two the bag seals itself CTA one get it now Call to action two link below', 0)
  const r = splitVoice(words, null, 30)
  check('no scripts: split where each part’s name is said', r.how === 'labels' && r.found.map((f) => f.label).join(' ') === 'H1 H2 B1 B2 C1 C2', r.found.map((f) => f.label))
  check('the name itself is not part of the part', r.found[0].heard === 'stop wasting food' && r.found[5].heard === 'link below', r.found.map((f) => f.heard))
  const again = splitByLabels(say('Hook one bad take Hook one good take Body one the middle', 0))
  check('a part named twice: the later one wins', again.found.filter((f) => f.label === 'H1').length === 1 && again.found[0].heard === 'good take', again.found)
  check('"the body of the bag" is not a part name', splitByLabels(say('look at the body of the bag here', 0)).found.length === 0)
  check('nothing to tell the parts apart: said how to record it', /say each part’s name before it/.test(splitWords(splitVoice(say('just some words with nothing in them', 0), null))))
}

{
  const kept = settle([
    { label: 'H1', kind: 'hook', start: 1, end: 3, score: 0.9, heard: '' },
    { label: 'H2', kind: 'hook', start: 2.5, end: 4, score: 0.7, heard: '' },
    { label: 'B1', kind: 'body', start: 5, end: 9.9, score: 1, heard: '' },
  ], 10)
  check('parts that overlap: the better match stays', kept.map((k) => k.label).join(' ') === 'H1 B1', kept)
  check('never past the end of the recording', kept[kept.length - 1].end <= 10)
}

// ── Wired ─────────────────────────────────────────────────────────────────────
const API = read('app/api/labs/trybe-studio/route.ts')
check('the API writes the recording down, splits it by the set’s scripts, has it cut, and deletes the one recording', /action === 'split_voice'/.test(API) && /splitVoice\(words, project\.scripts as ModularScripts \| null, duration\)/.test(API) && /videoServer<\{ cuts: Array/.test(API) && /'\/cut-audio'/.test(API) && /remove\(\[own\]\)/.test(API) && /\/source-edit-\//.test(API))
check('an older video server is said, never a failure without words', /its video server is being updated and cannot cut them yet/.test(API))
const SV = read('ingest-service/server.js')
check('the video server cuts each part into its own file in the creator’s folder', /app\.post\('\/cut-audio'/.test(SV) && /source-edit-\$\{require\('crypto'\)\.randomUUID\(\)\}\.m4a/.test(SV) && /'-ss', start\.toFixed\(3\), '-i', src, '-t', len\.toFixed\(3\)/.test(SV))
const MIX = read('components/labs/StudioMixer.tsx')
check('the voiceover mixer takes one recording and fills the columns, each part to listen to', /Add one recording/.test(MIX) && /action: voiceover \? 'split_voice' : 'split_video'/.test(MIX) && /\{c\.up && <a href=\{c\.up\.url\}/.test(MIX) && /\.filter\(\(c\) => needed\.has\(c\.key\) && !c\.up && c\.file\)/.test(MIX))
for (const f of ['lib/voice-split.ts', 'components/labs/StudioMixer.tsx']) check(`${f}: no dashes in what the creator reads`, !/[–—]/.test(read(f).replace(/\/\/.*$/gm, '')))

// ── A long talking take, cut in the background (Seb, 2026-11-28: "one long
// video of me just talking ... and have it properly cut") ──────────────────
{
  const job: CutJob = { userId: 'u1', projectId: 'p1', state: 'cutting', at: '2026-11-28T10:00:00Z', own: 'u1/source-edit-x.mp4', missing: [], words: 'Found 1 hook and 1 body.',
    parts: [{ label: 'H1', kind: 'hook', heard: 'a', start: 1, end: 3 }, { label: 'B1', kind: 'body', heard: 'b', start: 4, end: 9 }] }
  const done = cutDone(job, { ok: true, cuts: [{ id: 'H1', url: 'https://x.supabase.co/u1/source-edit-1.mp4', seconds: 2, bytes: 100 }, { id: 'B1', url: 'https://x.supabase.co/u1/source-edit-2.mp4', seconds: 5, bytes: 200 }] }, '2026-11-28T10:03:00Z')
  check('the cut parts are put on the parts, each with its file', done.state === 'done' && done.parts.every((p) => p.url && p.bytes) && done.parts[1].seconds === 5)
  check('a part the server did not cut keeps no file, and none at all is a failure said', !cutDone(job, { ok: true, cuts: [{ id: 'H1', url: 'https://x/a.mp4' }] }, 'now').parts[1].url && cutDone(job, { ok: true, cuts: [] }, 'now').state === 'failed')
  check('a failed cut says the server’s reason', cutDone(job, { ok: false, error: 'The video has no sound' }, 'now').error === 'The video has no sound')
  check('an address that is not a web address is never taken for a file', !cutDone(job, { ok: true, cuts: [{ id: 'H1', url: 'javascript:alert(1)' }, { id: 'B1', url: 'https://x/b.mp4' }] }, 'now').parts[0].url)
  check('a cut not posted back in 45 minutes is said as lost', CUT_STALE_MS === 45 * 60_000)
  const API3 = read('app/api/labs/trybe-studio/route.ts')
  check('a talking take: found now, cut in the background, asked after', /action === 'split_video'/.test(API3) && /'\/cut-video'/.test(API3) && /studiocut:\$\{jobId\}/.test(API3) && /action === 'split_status'/.test(API3) && /Date\.now\(\) - Date\.parse\(st\.at\) > CUT_STALE_MS/.test(API3) && /own: undefined, userId: undefined/.test(API3))
  const CB = read('app/api/labs/trybe-studio/cut-callback/route.ts')
  check('the callback checks the secret and the signed job, keeps the parts, and deletes the one take', /x-ingest-secret/.test(CB) && /readRenderJob\(/.test(CB) && /startsWith\('cut-'\)/.test(CB) && /was\.userId !== job\.userId/.test(CB) && /cutDone\(was, body, now\)/.test(CB) && /remove\(\[was\.own\]\)/.test(CB))
  const MW = read('middleware.ts')
  check('the video server’s reports reach MVP, not the sign-in page', /'\/api\/review-edit\/callback'/.test(MW) && /'\/api\/labs\/trybe-studio\/cut-callback'/.test(MW))
  const SV2 = read('ingest-service/server.js')
  check('the server cuts each part from its own first frame, upright, at most 1080x1920, normal colour, sound kept', /app\.post\('\/cut-video'/.test(SV2) && /'-ss', start\.toFixed\(3\), '-i', src, '-t', len\.toFixed\(3\), '-map', '0:v:0', '-map', '0:a:0'/.test(SV2) && /force_original_aspect_ratio=decrease/.test(SV2) && /hdrChain\(info\.transfer\)/.test(SV2) && /renderQueue = renderQueue\.then/.test(SV2.slice(SV2.indexOf("app.post('/cut-video'"))))
  const MIX2 = read('components/labs/StudioMixer.tsx')
  check('the talking mixer takes one vertical video, waits for the cut, and fills the columns', /'Add one video'/.test(MIX2) && /action: voiceover \? 'split_voice' : 'split_video'/.test(MIX2) && /action: 'split_status', job: d\.job/.test(MIX2) && /was filmed sideways\. The Video Builder takes vertical 9:16 video only\./.test(MIX2) && /fillParts\(parts, f\.name, u\.path\)/.test(MIX2))
}

if (failures.length) {
  console.error(`test-voice-split: ${failures.length} failed`)
  for (const f of failures) console.error(`  ✗ ${f}`)
  process.exit(1)
}
console.log('test-voice-split: one recording split into its hooks, bodies and CTAs, the last good take of each, what was not heard named')

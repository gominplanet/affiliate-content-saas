// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Music beds: tick a mood, a tempo and a style, preview, accept.
//
// Seb, 2026-11-26: "it'd be great if we could actually have the user tick a
// few boxes in terms of mood and tempo and style, and then be able to preview
// it and accept". Stable Audio 3 on fal; no voices, ever (his production
// rules); a voice check that could not run is never read as clean.

import { readFileSync, existsSync } from 'node:fs'
import { BED_MODELS, MOODS, TEMPOS, STYLES, NEGATIVE_PROMPT, readAsk, bedPrompt, voiceVerdict, voiceWords, canAccept } from '../lib/music-bed'
import { canUsePreview } from '../lib/labs-preview'

const failures: string[] = []
const check = (name: string, ok: boolean) => { if (!ok) failures.push(name) }
const read = (p: string) => readFileSync(p, 'utf8')

// 1. What can be ticked, read safely
{
  const ok = readAsk({ moods: ['upbeat', 'warm', 'calm'], tempo: 'fast', styles: ['pop'], seconds: 45, model: 'medium' })
  check('up to two moods, one tempo, the styles, the length and the engine', ok.ok && ok.ask.moods.length === 2 && ok.ask.tempo === 'fast' && ok.ask.seconds === 45 && ok.ask.model === 'medium')
  check('nothing ticked says what to tick', !readAsk({ moods: [], tempo: 'fast', styles: ['pop'], seconds: 30 }).ok && !readAsk({ moods: ['upbeat'], tempo: 'nope', styles: ['pop'], seconds: 30 }).ok && !readAsk({ moods: ['upbeat'], tempo: 'slow', styles: [], seconds: 30 }).ok)
  check('a length past the engine says so', (() => { const r = readAsk({ moods: ['upbeat'], tempo: 'slow', styles: ['pop'], seconds: 200, model: 'small' }); return !r.ok && /up to 120 seconds/.test(r.error) })())
  check('an unknown engine is Small, never a guess at a price', readAsk({ moods: ['upbeat'], tempo: 'slow', styles: ['pop'], seconds: 30, model: 'x' }).ok && (readAsk({ moods: ['upbeat'], tempo: 'slow', styles: ['pop'], seconds: 30, model: 'x' }) as { ask: { model: string } }).ask.model === 'small')
  check('the engines are Stable Audio 3 on fal, Small to 2 minutes and Medium to 6', BED_MODELS.small.id === 'fal-ai/stable-audio-3/small/music/text-to-audio' && BED_MODELS.small.maxSec === 120 && BED_MODELS.medium.id === 'fal-ai/stable-audio-3/medium/text-to-audio' && BED_MODELS.medium.maxSec === 380)
}

// 2. Always instrumental (Seb's rule: no voices, ever, and never "8-bit")
{
  const p = bedPrompt({ moods: ['upbeat'], tempo: 'fast', styles: ['funk'], seconds: 30, model: 'small' })
  check('the prompt names the style, the mood and the BPM, and asks for instruments only', /funk groove/.test(p) && /upbeat/.test(p) && /124 BPM/.test(p) && /no vocals/.test(p) && /melody played on instruments/.test(p))
  check('voices and 8-bit are always asked against', ['vocals', 'singing', 'speech', 'lyrics', 'vocal chops', '8-bit', 'chiptune'].every((w) => NEGATIVE_PROMPT.includes(w)))
  check('every choice has words for the page and the prompt, no dashes', [...MOODS, ...TEMPOS, ...STYLES].every((c) => c.label && c.words && !/[–—]/.test(c.label + c.words)))
}

// 3. The voice check
{
  check('varied words mean voices', voiceVerdict('I love the way you make me feel tonight').verdict === 'voices')
  check('a ghost "thank you" over music is not a voice', voiceVerdict(' Thank you. ').verdict === 'clean' && voiceVerdict('').verdict === 'clean' && voiceVerdict('♪ ♪').verdict === 'clean')
  check('what was heard is kept to say', voiceVerdict('baby baby come on home tonight').heard.includes('baby'))
  check('a check that did not run says so, never "no voices"', /did not run/.test(voiceWords('unchecked', [], 'it took too long')) && !/no voices/.test(voiceWords('unchecked', [], null)) && /no voices/.test(voiceWords('clean', [], null)) && /Voices heard/.test(voiceWords('voices', ['baby'], null)))
  check('only a checked, clean preview can be accepted', canAccept('clean', 'preview') && !canAccept('unchecked', 'preview') && !canAccept('voices', 'preview') && !canAccept('clean', 'accepted'))
}

// 4. Wired in
const R = read('app/api/music-bed/route.ts')
check('the route calls the engine with the voices asked against, at the length asked, with a deadline', /negative_prompt: NEGATIVE_PROMPT, duration: ask\.seconds/.test(R) && /abortSignal: AbortSignal\.timeout\(110_000\)/.test(R))
check('the voice check is its own call that tells a failure apart', /async function checkVoices/.test(R) && /check: 'unchecked'/.test(R) && !/import[^\n]*transcribeToCues/.test(R))
check('a track with voices is never offered, and Accept refuses anything not clean', /status: v\.check === 'voices' \? 'rejected' : 'preview'/.test(R) && /if \(!canAccept\(bed\.voice_check, bed\.status\)\)/.test(R))
check('the track is kept in MVP storage, since fal links do not last', /storage\.from\(BUCKET\)\.upload\(path, buf/.test(R) && /fetch\(audioUrl, \{ signal: AbortSignal\.timeout\(/.test(R))
check('each track and each check is costed', /feature: 'music_bed', model: model\.usage/.test(R) && /'stable-audio-3-small':\s+\{ in: 0, out: 0, imageCost: 0\.0217 \}/.test(read('lib/ai-usage.ts')) && /'fal-whisper-clip'/.test(read('lib/ai-usage.ts')))
check('a missing table says which migration, before anything is spent', /const probe = await admin\.from\('music_beds'\)/.test(R) && R.indexOf('const probe') < R.indexOf('fal.subscribe(model.id'))
check('a member only reaches their own tracks', /\.eq\('id', id\)\.eq\('user_id', g\.userId\)/.test(R))
check('the route exports only handlers and config', !/^export (?!async function (GET|POST)|const maxDuration)/m.test(R))
check('admin first', canUsePreview('music_beds', 'admin') && !canUsePreview('music_beds', 'pro') && !canUsePreview('music_beds', 'trial'))
const UI = read('components/music/MusicBedMaker.tsx')
check('the panel ticks mood, tempo, style and length, previews, and accepts', /title="Mood"/.test(UI) && /title="Tempo"/.test(UI) && /title="Style"/.test(UI) && /title="Length"/.test(UI) && /<audio controls/.test(UI) && /onAct\('accept', bed\.id\)/.test(UI) && /'Make another'/.test(UI))
check('no dashes in the panel', !/[–—]/.test(UI.replace(/\/\/.*$/gm, '')))
check('on the admin page and in the admin menu', existsSync('app/(dashboard)/admin/music-beds/page.tsx') && /href: '\/admin\/music-beds'/.test(read('components/layout/DashboardShellV2.tsx')))
const MIG = 'supabase/migrations/475_music_beds.sql'
check('migration 475 makes the table, safe to run twice', existsSync(MIG) && /create table if not exists public\.music_beds/.test(read(MIG)) && /create index if not exists/.test(read(MIG)))

if (failures.length) {
  console.error(`test-music-bed: ${failures.length} failed`)
  for (const f of failures) console.error(`  ✗ ${f}`)
  process.exit(1)
}
console.log('test-music-bed: all checks passed')

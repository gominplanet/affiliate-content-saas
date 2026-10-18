// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// HOW THEY WIN (lib/trybe-scripts, migration 442): the words of TRYBE's Top
// 100 videos, and the rewrite that turns one into a script in the creator's
// own voice.
//
// Two things this file is really for. A board that shows four videos out of
// forty must say so, because a thin board that looks complete sends a creator
// to copy the wrong thing. And a rewrite must never hand back the reference:
// a creator who posts another creator's words to the same brand in the same
// month is the one who gets dropped by that brand.
import { readFileSync } from 'node:fs'
import {
  openingOf, cleanScript, toTranscribe, coverageWords, rewriteMissing, rewritePrompt,
  readRewrite, tooAlike, readCloseness, CLOSENESS, SCRIPT_MAX, SCRIPT_MIN, TOO_ALIKE,
  type ScriptSource, type ScriptState,
} from '../lib/trybe-scripts'

const fails: string[] = []
const check = (name: string, ok: boolean | undefined, detail?: unknown) => {
  if (!ok) fails.push(`${name}${detail !== undefined ? `: ${JSON.stringify(detail)}` : ''}`)
}
const read = (f: string) => readFileSync(f, 'utf8')

// ── The opening line ─────────────────────────────────────────────────────────
check('the hook is the first sentence', openingOf('These are way too expensive. Then I wore them for a week.') === 'These are way too expensive.')
check('a script with no full stop still gives a hook', (openingOf('for guys who hate stiff long sleeve polos it looks right for work but the second you move') || '').startsWith('for guys who hate stiff'))
check('nothing in, nothing out', openingOf('') === null && openingOf(null) === null && openingOf('hi') === null)
check('a rambling first sentence is cut rather than shown whole', (openingOf(`${'word '.repeat(80)}. end`) || '').length < 200)

// ── Keeping a script ─────────────────────────────────────────────────────────
const tooShort = cleanScript('way too short')
check('a script too short to learn from is refused, with the reason', !tooShort.ok && /characters of words/.test((tooShort as { why: string }).why))
check('nothing at all is refused, with its own reason', (() => { const r = cleanScript(''); return !r.ok && r.why === 'no words in it' })())
const long = cleanScript('x'.repeat(SCRIPT_MAX + 500))
check('a runaway transcript is cut to the limit', long.ok && long.script.length === SCRIPT_MAX)
const good = cleanScript('  These   are way too expensive.  But I wore them every day for a week and here is what happened.  ')
check('whitespace is tidied and the hook comes out of it', good.ok && good.script.startsWith('These are way too expensive.') && good.hook === 'These are way too expensive.')
check('the floor and the ceiling are sane', SCRIPT_MIN >= 20 && SCRIPT_MAX >= 1000)

// ── What to spend a transcription on ─────────────────────────────────────────
// A transcription costs money. Highest placed first, each video once ever.
const E = (submissionId: string | null, rank: number | null, video: string | null) => ({ submissionId, rank, video })
const entries = [E('s98', 98, 'https://v/98.mp4'), E('s3', 3, 'https://v/3.mp4'), E('s40', 40, 'https://v/40.mp4'), E('s7', 7, 'https://v/7.mp4')]
check('the best placed video is read first', toTranscribe(entries, new Set(), 10).map((e) => e.submissionId).join() === 's3,s7,s40,s98')
check('the cap is the cap', toTranscribe(entries, new Set(), 2).length === 2 && toTranscribe(entries, new Set(), 0).length === 0)
check('a video already read is never read again', !toTranscribe(entries, new Set(['s3']), 10).some((e) => e.submissionId === 's3'))
// A video we tried and failed on is in `have` too: retrying it is a decision,
// not something that happens because somebody opened a page.
check('a video we failed to read is not retried by opening a page', toTranscribe(entries, new Set(['s3', 's7', 's40', 's98']), 10).length === 0)
check('a video with no file is skipped, not queued for ever',
  toTranscribe([E('a', 1, null), E('b', 2, 'http://insecure/x.mp4'), E('c', 3, 'https://v/c.mp4')], new Set(), 10).map((e) => e.submissionId).join() === 'c')
check('an entry TRYBE gave no id for is skipped', toTranscribe([E(null, 1, 'https://v/x.mp4')], new Set(), 10).length === 0)

// ── Saying how thin the board is ─────────────────────────────────────────────
// A thin board that reads as a complete one sends a creator to copy the wrong
// thing. One admin read of the top 25 kept 4 openings, so this is the normal
// case, not the edge case.
const row = (state: ScriptState, source: ScriptSource) => ({ state, source })
check('an empty board says it is empty', /none|No Top 100 videos saved/i.test(coverageWords([])))
check('videos with no words say so rather than showing a number of ready ones',
  coverageWords([row('waiting', 'none'), row('none', 'none')]) === '2 videos, none with words yet.')
check('the count is of the ones with words, against the total',
  /Words for 2 of 5/.test(coverageWords([row('ready', 'trybe'), row('ready', 'transcribed'), row('none', 'none'), row('waiting', 'none'), row('waiting', 'none')])))
// "TRYBE shared these words" and "MVP listened to the video" are different
// claims, and only one of them is TRYBE's.
check('which source answered is said, not blurred into one number',
  /1 shared by TRYBE, 1 MVP listened to/.test(coverageWords([row('ready', 'trybe'), row('ready', 'transcribed')])))
check('a board that is all transcribed does not claim TRYBE shared anything',
  !/shared by TRYBE/.test(coverageWords([row('ready', 'transcribed'), row('ready', 'transcribed')])))

// ── The rewrite ──────────────────────────────────────────────────────────────
check('a rewrite with nothing of the creator in it is refused',
  rewriteMissing({ reference: 'a winning script', product: 'Kings Loot Wallet', experience: '' }).join() === 'one line about your own experience with it')
check('and with no reference and no product it says all three',
  rewriteMissing({}).length === 3)
check('a real ask is let through', rewriteMissing({ reference: 'x', product: 'Wallet', experience: 'I carried it for three weeks' }).length === 0)
check('the dial has three settings and falls back to the middle one',
  readCloseness('loose') === 'loose' && readCloseness('close') === 'close' && readCloseness('whatever') === 'similar' && readCloseness(undefined) === 'similar')

const P = rewritePrompt({
  reference: 'These are way too expensive. Then I wore them for a week.',
  avatar: 'A dad who buys once and keeps it', experience: 'I carried it every day for three weeks and the stitching held',
  closeness: 'close', product: 'Kings Loot Wallet', brand: 'Kings Loot', brief: 'Show the card slots', voice: ['Hey! Just filmed this one for you'],
})
// COPY THE ANGLE, NEVER THE SENTENCES. This is the line that keeps a creator
// on the brand, so it is checked rather than assumed.
check('the prompt forbids reusing the reference words, in as many words', /NEVER reuse its sentences/.test(P) && /Copy what it does, not what it says/.test(P))
check('the creator’s own experience is in the prompt and marked as the part that cannot be invented',
  /I carried it every day for three weeks/.test(P) && /cannot be invented/.test(P))
check('the dial reaches the prompt', /Close to it/.test(P) && /beat for beat/.test(P))
check('the brand brief is followed when there is one', /Show the card slots/.test(P) && /how the video gets approved/.test(P))
check('their own voice goes in as rhythm, not as subject', /Just filmed this one for you/.test(P) && /Match the rhythm, not the subject/.test(P))
check('it asks for spoken words, not a shot list', /spoken words only, no shot directions/.test(P))
check('it asks for three hooks and one script, as JSON', /"hooks":\[/.test(P) && /"script":"/.test(P))
const noBrief = rewritePrompt({ reference: 'x'.repeat(50), avatar: '', experience: 'I used it', closeness: 'loose', product: 'A', brand: 'B' })
check('no brief and no voice leaves those parts out rather than sending empty headings', !/THE BRAND'S BRIEF/.test(noBrief) && !/HOW THIS CREATOR TALKS/.test(noBrief))
check('a creator who said nothing about themselves still gets a usable instruction', /not said, so keep it plain and first person/.test(noBrief))

// ── Reading the answer ───────────────────────────────────────────────────────
const body = `Sure! Here you go: {"hooks":["one two three four five","second hook right here","third hook goes here"],"script":"${'word '.repeat(30)}"} hope that helps`
const r = readRewrite(body)
check('an answer wrapped in chat is still read', !!r && r.hooks.length === 3 && r.script.length > SCRIPT_MIN)
check('prose with no JSON is a result to show, not a crash', readRewrite('I cannot do that') === null)
check('broken JSON is refused rather than half read', readRewrite('{"hooks":["a b c d e"],"script":') === null)
check('a script too short to use is refused', readRewrite('{"hooks":[],"script":"too short"}') === null)
check('more than three hooks is cut to three', (readRewrite(`{"hooks":["aaaa bbbb","cccc dddd","eeee ffff","gggg hhhh"],"script":"${'word '.repeat(30)}"}`) || { hooks: [] }).hooks.length === 3)
check('an empty hook is dropped rather than shown as a blank line',
  (readRewrite(`{"hooks":["", "  ", "a real hook here"],"script":"${'word '.repeat(30)}"}`) || { hooks: [] }).hooks.length === 1)

// ── The check that protects the creator ──────────────────────────────────────
const ref = 'These are way too expensive but I wore them every single day for a week and the stitching held up'
check('a rewrite that is the reference back again is caught', tooAlike(ref, ref))
check('and caught when a couple of words are swapped',
  tooAlike(ref, 'These are far too expensive but I wore them every single day for a week and the stitching held up'))
check('a genuinely different script is not caught',
  !tooAlike(ref, 'My wallet fell apart in March. This one has survived three weeks of a toddler, a job site and one washing machine.'))
check('the line is drawn somewhere defensible', TOO_ALIKE >= 0.5 && TOO_ALIKE <= 0.8)

// ── House style ──────────────────────────────────────────────────────────────
const words = Object.values(CLOSENESS).map((c) => `${c.label} ${c.says}`).join(' ')
check('the dial is said in plain words, no dashes', !/[–—]| - /.test(words) && Object.keys(CLOSENESS).length === 3)
check('no year typed into any copy here', !/\b20\d\d\b/.test(words + coverageWords([row('ready', 'trybe')])))

// ── The migration ────────────────────────────────────────────────────────────
const sql = read('supabase/migrations/442_trybe_top_scripts.sql')
check('migration 442 makes the shared store, safe to run twice',
  /create table if not exists public\.trybe_top_scripts/.test(sql) && /submission_id text primary key/.test(sql))
check('it records which source answered, so a card can say it', /source {6}text not null default 'none'/.test(sql) && /state {7}text not null default 'waiting'/.test(sql))
check('every member reads it and nobody writes it from the browser',
  /for select using \(auth\.uid\(\) is not null\)/.test(sql) && !/for insert|for update|for all/.test(sql))
check('nothing in it drops or deletes', !/drop table|delete from|truncate/i.test(sql))

if (fails.length) {
  console.error(`\n❌ trybe-scripts: ${fails.length} failure(s)\n`)
  for (const f of fails) console.error(`   • ${f}`)
  process.exit(1)
}
console.log('✅ trybe-scripts: a board says how thin it is, a transcription is spent once on the best placed video, and a rewrite that hands back the reference is caught')

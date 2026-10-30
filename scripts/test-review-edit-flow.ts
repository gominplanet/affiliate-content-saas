// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// THE REVIEW EDITOR'S QUEUE AND PAGE (Seb, 2026-10-30). Pinned: Labs only;
// a batch moves by itself in the background, one video on the video server
// at a time, every step claimed so two ticks never do the same work; only
// the sound is sent to be written down; raw uploads are deleted when the
// creator is done or two days after, never while in use; a video made again
// replaces its last files; every stop says why; cheap models, few frames.
import { readFileSync } from 'node:fs'
import { ownPath, MAKING_AT_ONCE, RAW_KEEP_MS } from '../lib/review-edit-server'

const fails: string[] = []
const check = (name: string, ok: boolean | undefined) => { if (!ok) fails.push(name) }
const read = (f: string) => readFileSync(f, 'utf8')
const W = read('lib/review-edit-server.ts')
const R = read('app/api/review-edit/route.ts')
const C = read('app/api/review-edit/callback/route.ts')
const Q = read('app/api/cron/review-edits/route.ts')
const P = read('lib/review-edit-plan.ts')
const U = read('components/review-editor/ReviewEditor.tsx')
const S = read('ingest-service/server.js')

// ── Labs only ────────────────────────────────────────────────────────────────
check('admin only while it is tested', /review_edit: 'admin'/.test(read('lib/labs-preview.ts')))
check('the route, the page and the menu each check', /canUsePreview\('review_edit'/.test(R) && /canUsePreview\('review_edit'/.test(read('app/(dashboard)/review-editor/page.tsx')) && /href: '\/review-editor'[^\n]*gate: isAdmin/.test(read('components/layout/DashboardShellV2.tsx')))

// ── In the background, one at a time ─────────────────────────────────────────
check('adding a video starts it at once, and the cron carries on', /after\(async \(\) => \{ try \{ await moveQueue\(db, \{ userId: g\.userId/.test(R)
  && (JSON.parse(read('vercel.json')).crons as { path: string; schedule: string }[]).some((c) => c.path === '/api/cron/review-edits' && c.schedule === '*/2 * * * *'))
check('one video on the video server at a time', MAKING_AT_ONCE === 1 && /\(making \?\? 0\) < MAKING_AT_ONCE/.test(W))
check('a read and a make are claimed first, so two ticks never do the same video', /\.eq\('id', row\.id\)\.eq\('status', 'queued'\)\.select\('id'\)/.test(W) && /\.eq\('id', row\.id\)\.eq\('status', 'ready_to_make'\)\.select\('id'\)/.test(W))
check('work that never came back is tried again, then said to have stopped', /READ_STALE_MS/.test(W) && /MAKE_STALE_MS/.test(W) && /MAX_ATTEMPTS/.test(W) && /The video server never finished it/.test(W))
check('the next video starts when the server reports one done', /moveQueue\(db, \{ readBudget: 0 \}\)/.test(C))
check('only a signed job of the editor’s lands in the callback', /x-ingest-secret/.test(C) && /readRenderJob/.test(C) && /startsWith\('edit-'\)/.test(C))
check('a video server that is updating puts the video back in line, not failed', /sent\.status === 404 \|\| sent\.status === 0\) return set\(db, row\.id, \{ status: 'ready_to_make'/.test(W))
check('the cron before the table exists says so instead of failing', /review_edits table not made yet/.test(Q))

// ── Files ────────────────────────────────────────────────────────────────────
check('only the sound goes to be written down, and it is deleted after', /'\/stream-audio'/.test(W) && /transcribeToCues\(audio\.data\.url\)/.test(W) && /remove\(\[audioPath\]\)/.test(W))
check('raw takes go when the creator is done, or two days after it was made, never while in use', RAW_KEEP_MS === 48 * 3600_000 && /if \(BUSY\.includes\(r\.status\)\) continue/.test(W) && /action === 'finish'[\s\S]{0,80}deleteRaw/.test(R))
check('a video made again replaces its last files', /const stale = old\.filter/.test(W) && /remove\(stale\)/.test(W))
check('only this creator’s own files are ever used or deleted', ownPath('https://x.supabase.co/storage/v1/object/public/instagram-videos/u1/source-edit-a.mp4', 'u1') === 'u1/source-edit-a.mp4'
  && ownPath('https://x.supabase.co/storage/v1/object/public/instagram-videos/u2/source-edit-a.mp4', 'u1') === null
  && ownPath('https://x.supabase.co/storage/v1/object/public/instagram-videos/u1/../u2/x.mp4', 'u1') === null)
check('the video server keeps the takes in a folder of the job’s own, removed whatever happens', /fs\.mkdtempSync\(path\.join\(os\.tmpdir\(\), 'edit-'\)\)/.test(S) && /finally \{\s*\n\s*try \{ fs\.rmSync\(dir, \{ recursive: true, force: true \}\)/.test(S))
check('finished videos are named for the 30 day clean-up', /edit-\$\{stamp\}-\$\{f\}\.mp4/.test(S) && /edit-\\d\+-\(wide\|vertical\)/.test(read('lib/burn-retention.ts')))

// ── A review and a TRYBE ad are different videos from the start ─────────────
const E = read('lib/review-edit.ts')
check('one video asks what it is for first', /What is this video for\?/.test(U) && /\(\['review', 'trybe'\] as VideoKind\[\]\)/.test(U) && /settings: look/.test(U))
check('no wide and vertical choice: the kind decides the format', !/Make it<\/p>/.test(U) && /formats: kind === 'trybe' \? \['vertical'\] : \['wide'\]/.test(E))
check('a TRYBE ad has its own brief: an ad, cut harder, opening on a hook', /system: o\.kind === 'trybe' \? TRYBE_SYSTEM : PLAN_SYSTEM/.test(P) && /It is not a review/.test(P) && /filler/.test(P))
check('a take filmed the wrong way round for a review is said before any work', /This take was filmed upright\. An Amazon and YouTube review is filmed sideways/.test(W))
check('a typed change cannot turn a review into an ad', /kind: o\.settings\.kind,/.test(P))
check('Send to Drop says what comes next for each kind', /pick the TRYBE brand it is for/.test(U) && /make its Shorts, TikTok and Reels/.test(U))

// ── A video is never left hanging (Seb, 2026-10-30: half an hour "being made") ─
check('the video server says what it is working on, and forgets nothing it took without finishing it', /app\.get\('\/jobs'/.test(S) && /editJobs\.set\(id, \{ at: Date\.now\(\), stage: 'wait'/.test(S) && /editJobs\.delete\(id\)\s*\n\s*const cb = await postRenderCallback/.test(S))
check('a make the server lost is sent again within minutes', /LOST_CHECK_MS = 4 \* 60_000/.test(W) && /if \(jobs\.edits\.has\(`edit-\$\{m\.id\}`\) \|\| t - Date\.parse\(m\.updated_at\) < LOST_CHECK_MS\) continue/.test(W) && /stopped before finishing this one/.test(W))
check('each busy card says how long its step has run and what is normal', /This step started \$\{mins\}/.test(U) && /Making takes 2 to 10 minutes/.test(U))
check('a step stuck for 20 minutes can be started again by the creator', /STUCK_AFTER_MS = 20 \* 60_000/.test(R) && /Start it again/.test(U))

check('an HDR take and its B-roll are converted, and a server that cannot convert still makes the video', /color_transfer/.test(S) && /transfer: hdrFallback \? '' : info\.transfer/.test(S) && /hdrChain\(bi && bi\.transfer\)/.test(S) && /hdr: built\.hdr \? 'converted'/.test(S))

check('the card says what the video server is doing with it, how far, and what is ahead of it', /report\('make', p\)/.test(S) && /report\('download', p\)/.test(S) && /ahead: order\.slice\(0, i\)\.length/.test(S) && /waiting behind \$\{n\} other/.test(U) && /making the video\$\{pct\}/.test(U))
check('a video the server does not have is said, not shown as being made', /The video server does not have this one right now/.test(U))

check('the server keeps each result and whether MVP heard it; MVP takes one it missed', /rememberDone\(id, \{ \.\.\.rec, at: new Date\(\)\.toISOString\(\), delivered: cb\.delivered/.test(S) && /done: Object\.fromEntries\(editDone\)/.test(S) && /await finishMaking\(db, m\.id, m\.user_id, \{ \.\.\.done \}\)/.test(W) && /await finishMaking\(db, r\.id, r\.user_id/.test(R))
check('a video that keeps stopping the server stops with a reason, never going round for ever', /if \(\(m\.attempts \|\| 0\) >= MAX_ATTEMPTS\) await set\(db, m\.id, \{ status: 'failed'/.test(W) && !/attempts: Math\.max\(0, \(m\.attempts \|\| 1\) - 1\)/.test(W))

check('the dead air is found from the sound itself, when reading and for a video read before', /silences: true \}, 295_000\)/.test(W) && /A video read before the dead air was found from the sound/.test(W) && /function findSilences\(file, duration\)/.test(S) && /silencedetect=noise=\$\{noise\}dB/.test(S))

// ── Title looks and pictures (Seb, 2026-10-30) ──────────────────────────────
check('the title is drawn in its look, colour and size, and the page previews that same drawing', /drawTitle\(t\.text, \{ look: t\.look/.test(W) && /\/api\/review-edit\/title\?/.test(U) && /This is the picture MVP puts on the video/.test(U))
check('a preview that cannot be drawn says so, never a blank', /The preview could not be drawn/.test(U) && /onError=\{\(\) => setTitleBad\(true\)\}/.test(U))
check('a title can stay on for the whole video', /n === 0 \? 'the whole video'/.test(U) && /settings\.title\.seconds === 0 \? spec\.seconds \+ 1/.test(W))
check('pictures are only ever the creator\u2019s own files, in a library of their own', (R.match(/settings\.pictures = settings\.pictures\.filter\(\(p\) => own\(p\.url\)\)/g) ?? []).length === 3 && /const PICTURE_NAME = \/\^pic-/.test(R) && /pic-\$\{crypto\.randomUUID\(\)\}/.test(U))
check('deleting from the library touches only a library picture of this creator', /action === 'forget_picture'[\s\S]{0,200}ownPath\(body\.url, g\.userId\)[\s\S]{0,120}PICTURE_NAME\.test/.test(R))
check('no clean-up job deletes library pictures', !/pic/.test((read('app/api/cron/purge-shorts-sources/route.ts').match(/\^\(([^)]*)\)-/) ?? [''])[0]))
check('the server lays up to four pictures over the video, each at its moment', /body\.pictures[\s\S]{0,80}\.slice\(0, 4\)/.test(S) && /pictures, ass,/.test(S))
check('what went on the video is saved when it is sent, and the card shows it, with anything left out said', /info: \{ \.\.\.info, placed \}/.test(W) && /The title could not be drawn, so it is not on this video/.test(W) && /is not said in the finished video, so this picture was left out/.test(E) && /'missed' in p \? <span style=\{\{ color: AMBER \}\}>/.test(U))
check('a typed change can restyle the title and move pictures, never add one or swap its file', /"look" \(\$\{TITLE_LOOKS/.test(P) && /url: p\.url \}\)\)/.test(P) && /You cannot add a new picture/.test(P))
check('calls to action stay in Drop, so Amazon gets a clean copy', /Calls to action are added in Drop/.test(U))

check('the logo is timed for the first or last seconds, and on the whole video otherwise', /spec\.logo\.when === 'start' \? \{ startSec: 0, endSec: Math\.min\(spec\.seconds, spec\.logo\.seconds\) \}/.test(W) && /put\(o\.logo, logoIn\[f\], 'lg', true\)/.test(read('ingest-service/edit-filters.js')) && /Untick Show my logo for none/.test(U))
check('a B-roll of a different product is caught while reading, left out, and said on the card', /const check = shots\.length \? await brollFits/.test(W) && /plan\.placements = plan\.placements\.map\(\(p\) => \(\{ \.\.\.p, off: true \}\)\)/.test(W) && /The B-roll looks like a different product/.test(U) && /brollCheck: r\.info\?\.brollCheck/.test(R))
check('the B-roll check only says no when it is clearly another product', /Generic shots \(hands, a box, packaging, a table\) or not being sure is "same": true/.test(P) && /fits: raw\.same !== false/.test(P))
check('the video server reads when each clip was filmed from the file, a few at a time, its header only', /app\.post\('\/filmed'/.test(S) && /'-show_entries', 'format_tags'/.test(S) && /Math\.min\(6, items\.length\)/.test(S))

// ── The page (Seb, 2026-10-30: "Can we clean this up?") ──────────────────────
const M = read('supabase/migrations/462_review_edit_looks.sql')
check('the look is saved once, in its own table, safe to run twice and closed to the browser', /create table if not exists public\.review_edit_looks/.test(M) && /enable row level security/.test(M) && !/create policy/.test(M))
check('a saved look is what new videos start from, and the page says when it is borrowed from the last video instead', /defaults: lookRow \? cleanSettings\(lookRow\.settings\) : last \?/.test(R) && /lookSaved: !!lookRow/.test(R) && /Not saved yet: this is the look of the last video you added/.test(U))
check('saving the look keeps only the creator\u2019s own logo and pictures, and says when the table is missing', /action === 'save_look'[\s\S]{0,300}own\(settings\.logo\.url\)[\s\S]{0,200}own\(p\.url\)/.test(R) && /Saving your look needs migration 462 in Supabase first/.test(R))
check('three parts: your look, add videos, your videos', /aria-label="Your look"/.test(U) && /aria-label="Add videos"/.test(U) && /aria-label="Your videos"/.test(U) && /A batch from Google Drive/.test(U) && /'One video'/.test(U))
check('a card folds its changes away until Edit this video is pressed', /Edit this video/.test(U) && /\{open && editable && \(/.test(U))

// ── Cost ─────────────────────────────────────────────────────────────────────
check('the plan on Sonnet 5, the B-roll and typed changes on Haiku', /PLAN_MODEL = 'claude-sonnet-5'/.test(P) && /QUICK_MODEL = 'claude-haiku-4-5-20251001'/.test(P) && /model: QUICK_MODEL[\s\S]{0,40}max_tokens: 900/.test(P))
check('the B-roll is seen from 36 small frames, sent in the answer, never stored', /frames: 36, width: 320/.test(W) && /jpg: fs\.readFileSync\(out\)\.toString\('base64'\)/.test(S))
check('every AI call is counted', (P.match(/recordAnthropicUsage\(/g) ?? []).length === (P.match(/messages\.create\(/g) ?? []).length && (P.match(/recordAnthropicUsage\(/g) ?? []).length === 4)

// ── Every stop says why ──────────────────────────────────────────────────────
const fails2 = (W.match(/status: 'failed', note: /g) ?? []).length + (W.match(/return await fail\(/g) ?? []).length
check('each way a video stops writes its reason', fails2 >= 8)
check('the page shows every status in words, and the note under it', ['queued', 'reading', 'ready_to_make', 'making', 'done', 'failed'].every((k) => new RegExp(`${k}: \\{ words: '`).test(U)) && /e\.status !== 'done' && line && <p/.test(U) && /: e\.note$/m.test(U))
check('a cut is never silent: each is listed with why, and can be put back', /What MVP cut/.test(U) && /c\.restored \? 'Cut it again' : 'Put it back'/.test(U))
check('changes are said to need Make it again', /Changes here show once you press Make it again/.test(U))
check('Send to Drop goes through Drop’s own draft', /action: 'draft_start'/.test(U) && /action: 'draft_add', dropId: d\.id/.test(U))

const copy = U.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n').replace(/\$\{[^}]*\}/g, '').match(/'[^'\n]{14,}'|"[^"\n]{14,}"|>[^<>{}\n]{14,}</g)?.join(' ') ?? ''
check('no dashes in what a creator reads', !/[–—]| - /.test(copy))
check('no year in the copy', !/\b20\d\d\b/.test(copy))

if (fails.length) { console.error(`\n❌ review-edit-flow: ${fails.length} failure(s)\n`); for (const f of fails) console.error(`   • ${f}`); process.exit(1) }
console.log('✅ review-edit-flow: Labs only, a batch moves by itself one video at a time, raw takes deleted when done, every stop says why')

// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// The Video Builder, phases 1 and 2.
//
// Seb, 2026-11-26: "MVP needs to always check briefs and Google Docs and web
// pages and PDFs ... or images ... to understand what the brand is looking
// for, the do's and don'ts ... we need to have a spot where users can upload
// PDFs, upload documents, or share links"; "only vertical, 9:16"; "we should
// be able to have a one button send to the tribe brand directly"; "this whole
// entire build is for users who submit content to brands through trybe".

import { readFileSync, existsSync } from 'node:fs'
import { hashText, upsertSource, sheetInput, readSheet, readQuestions, sheetFromReply, sheetToCampaign, emptySheet, sheetCount, SHEET_SYSTEM, MAX_HISTORY, type RuleSource, type OldSource } from '../lib/studio-rules'
import { studioStage, canSendNow, needsConfirm, studioFileName, allowanceWords, outputOf, type StudioEdit } from '../lib/studio'
import { checkCut } from '../lib/trybe-edit'
import { mixCombos, mixCounts, brollFor, mixLabel } from '../lib/studio-mix'
import { scriptsSystem, scriptsInput, parseScripts, checkScripts, sheetText, secondsOf, VIDEO_TYPES } from '../lib/studio-scripts'
import { canUsePreview } from '../lib/labs-preview'
import type { Word } from '../lib/review-edit'

const failures: string[] = []
const check = (name: string, ok: boolean) => { if (!ok) failures.push(name) }
const read = (p: string) => readFileSync(p, 'utf8')
const NOW = '2026-11-26T12:00:00.000Z'
const src = (id: string, text: string, readAt = '2026-11-20T00:00:00.000Z'): RuleSource => ({ id, kind: 'text', label: id, text, readAt, hash: hashText(text), error: null })

// 1. Every source, with the day it was read, and every version kept
{
  check('a fingerprint is stable and changes with the words', hashText('abc') === hashText('abc') && hashText('abc') !== hashText('abd'))
  const a = upsertSource([], [], src('trybe_brief', 'Old brief'), NOW)
  check('a new source is kept', a.sources.length === 1 && a.history.length === 0)
  const b = upsertSource(a.sources, a.history, { ...src('trybe_brief', 'New brief'), readAt: NOW }, NOW)
  check('a changed brief keeps the old version with its date', b.sources[0].text === 'New brief' && b.history.length === 1 && b.history[0].text === 'Old brief' && b.history[0].readAt === '2026-11-20T00:00:00.000Z' && b.history[0].replacedAt === NOW)
  const c = upsertSource(b.sources, b.history, { ...src('trybe_brief', 'New brief'), readAt: NOW }, NOW)
  check('the same words only move the read date', c.history.length === 1 && c.sources[0].readAt === NOW)
  const d = upsertSource(c.sources, c.history, { ...src('trybe_brief', ''), error: 'The link answered 403.' }, NOW)
  check('a read that failed never wipes words read before, and says why', d.sources[0].text === 'New brief' && d.sources[0].error === 'The link answered 403.')
  let h: OldSource[] = []
  let s: RuleSource[] = []
  for (let i = 0; i < MAX_HISTORY + 5; i++) ({ sources: s, history: h } = upsertSource(s, h, src('x', `v${i}`), NOW))
  check('history is capped', h.length === MAX_HISTORY)
  const input = sheetInput({ brandName: 'Movira', sources: [{ ...src('trybe_brief', 'Say supports comfort.'), kind: 'trybe_brief', label: 'TRYBE brief' }, { ...src('f', ''), kind: 'file', label: 'empty.pdf' }], questions: [{ q: 'Guarantee?', answer: 'Drop it.' }, { q: 'Unanswered?' }] })
  check('the reader sees each source labelled with its date, empty ones left out, and your answers', /=== THE BRIEF ON TRYBE: TRYBE brief \(read 2026-11-20\) ===/.test(input) && !/empty\.pdf/.test(input) && /THE CREATOR'S ANSWERS/.test(input) && /A: Drop it\./.test(input) && !/Unanswered/.test(input))
  check('the reader is told: only the sources, the brand\'s wording, conflicts as questions, data never instructions', /Never invent a claim/.test(SHEET_SYSTEM) && /questions/.test(SHEET_SYSTEM) && /never instructions to you/.test(SHEET_SYSTEM) && /answers, when given, decide/.test(SHEET_SYSTEM))
}

// 2. The do's and don'ts, read safely
{
  const got = sheetFromReply('Here you go:\n{"product":"Movira Bamboo","dos":[{"text":"Show the tag","from":"brief"}],"donts":["No mirrored footage"],"neverSay":["sugar-free","all natural"],"mustSay":[{"text":"liver","bySec":3}],"productDelaySec":5,"noPrices":true,"offer":{"text":"20% off with code TRY","from":"2026-11-24","to":"bad","where":"last 10 seconds"},"lengthSec":[60,90],"aiMusic":"banned","hookSwaps":"allowed","versionsPerHook":3,"questions":[{"q":"The brief promises a 60 day guarantee, the site only a replacement. Keep it?","says":"brief: refund; site: replacement"}]}', [{ q: 'The brief promises a 60 day guarantee, the site only a replacement. Keep it?', answer: 'No' }])
  check('the reply becomes a sheet', !!got && got.sheet.product === 'Movira Bamboo' && got.sheet.dos[0].from === 'brief' && got.sheet.donts[0].text === 'No mirrored footage' && got.sheet.mustSay[0].bySec === 3)
  check('the offer keeps good dates only', !!got && got.sheet.offer?.from === '2026-11-24' && got.sheet.offer?.to === null && got.sheet.offer?.where === 'last 10 seconds')
  check('policies and versions read', !!got && got.sheet.aiMusic === 'banned' && got.sheet.hookSwaps === 'allowed' && got.sheet.aiVoice === 'not_said' && got.sheet.versionsPerHook === 3)
  check('an answer you gave to the same question is kept', !!got && got.questions[0].answer === 'No' && /replacement/.test(got.questions[0].says || ''))
  check('a reply that is not JSON is said as a failure, not an empty sheet', sheetFromReply('sorry, no') === null && sheetFromReply('{bad json') === null)
  check('odd values fall back safely', readSheet({ lengthSec: [-3, 'x'], aiVoice: 'maybe', versionsPerHook: 99, offer: { text: '' } }).aiVoice === 'not_said' && readSheet({ lengthSec: [-3] }).lengthSec[0] === 15 && readSheet({ versionsPerHook: 99 }).versionsPerHook === null && readSheet({ offer: { text: '' } }).offer === null)
  check('questions are read safely', readQuestions([{ q: '' }, 'A plain question?']).length === 1)
  check('an empty sheet counts nothing', sheetCount(emptySheet()) === 0)
}

// 3. The finished video checked against the brand's sheet (lib/trybe-edit checkCut)
{
  const sheet = readSheet({ product: 'NOBL Tracker', neverSay: ['Tile'], noPrices: true, productDelaySec: 5, lengthSec: [20, 40] })
  const camp = sheetToCampaign(sheet, { id: 'brand1', name: 'NOBL' })
  const w = (text: string, start: number): Word => ({ text, start, end: start + 0.3 } as Word)
  const bad = checkCut({ words: [w('my', 0), w('NOBL', 1), w('beats', 2), w('Tile', 3), w('for', 4), w('$20', 5)], seconds: 12, campaign: camp, now: NOW })
  check('a brand word too early, a banned name, a price and a short cut are all caught', bad.state === 'red' && bad.items.some((i) => /before the 5 second mark/.test(i.text)) && bad.items.some((i) => /"Tile" is said/.test(i.text)) && bad.items.some((i) => /A price is said/.test(i.text)) && bad.items.some((i) => /12 seconds: the brief asks for 20 to 40/.test(i.text)))
  const good = checkCut({ words: [w('this', 0), w('changed', 1), w('my', 2), w('trips', 3), w('NOBL', 8)], seconds: 30, campaign: camp, now: NOW })
  check('a video inside the rules is green', good.state === 'green')
}

// 4. Where each video stands, in words
{
  const e = (o: Partial<StudioEdit>): StudioEdit => ({ id: 'e1', name: 'Take 1', status: 'done', note: null, outputs: { vertical: { url: 'https://x/y.mp4', seconds: 30 } }, studio: { brandId: 'b', check: null, send: null }, ...o })
  check('being made, said as such', studioStage(e({ status: 'making' })).tone === 'wait' && studioStage(e({ status: 'failed' })).word === 'Not edited')
  check('not checked says the rules were not read', /not checked against the brand's rules/.test(studioStage(e({})).word))
  check('a broken rule is red and asks before sending', studioStage(e({ studio: { brandId: 'b', check: { state: 'red', items: [], seconds: 30, at: NOW }, send: null } })).tone === 'bad' && needsConfirm(e({ studio: { brandId: 'b', check: { state: 'red', items: [], seconds: 30, at: NOW }, send: null } })))
  check('sent says the brand is reviewing it', studioStage(e({ studio: { brandId: 'b', check: null, send: { state: 'in_review' } } }), 'NOBL').word === 'Sent: NOBL is reviewing it')
  check('a send TRYBE did not confirm says so, never "sent"', studioStage(e({ studio: { brandId: 'b', check: null, send: { state: 'sent_unconfirmed' } } })).word === 'Sent, not confirmed by TRYBE yet')
  check('Send is offered once: not again after a send, not again when unconfirmed, again after a failure', canSendNow(e({})) && !canSendNow(e({ studio: { brandId: 'b', check: null, send: { state: 'in_review' } } })) && !canSendNow(e({ studio: { brandId: 'b', check: null, send: { state: 'sent_unconfirmed' } } })) && canSendNow(e({ studio: { brandId: 'b', check: null, send: { state: 'failed' } } })) && !canSendNow(e({ outputs: null })))
  check('the file is named by brand and video', studioFileName('Taste Flavor Co.', 'Black Friday take 2', 4) === 'taste-flavor-co-black-friday-take-2.mp4' && studioFileName('NOBL', null, 3) === 'nobl-video-3.mp4')
  check('the allowance in words', allowanceWords({ used: 12, limit: 200, left: 188 }) === '12 of 200 TRYBE ad edits used this month' && /All 200/.test(allowanceWords({ used: 200, limit: 200, left: 0, resetLabel: 'Dec 1' }) || ''))
  check('the finished file is found', outputOf(e({}))?.seconds === 30 && outputOf(e({ outputs: null })) === null)
}

// 4b. Hooks × bodies × CTAs (Seb, 2026-11-26: "I'm uploading 3 different hooks, and then ... 3 different
//     bodies, and then ... 3 different CTAs, and then I could upload some B-roll ... and then having MVP put
//     together everything")
{
  check('3 hooks, 3 bodies and 3 CTAs make 27, 9 or 3 videos', JSON.stringify(mixCounts(3, 3, 3)) === JSON.stringify({ all: 27, pairs: 9, once: 3 }))
  const pairs = mixCombos(3, 3, 3, 'pairs')
  check('each hook with each body once, the CTAs taking turns', new Set(pairs.map((c) => `${c.h}${c.b}`)).size === 9 && [0, 1, 2].every((c) => pairs.filter((x) => x.c === c).length === 3))
  const once = mixCombos(3, 2, 4, 'once')
  check('each clip once: every clip is used', once.length === 4 && new Set(once.map((c) => c.h)).size === 3 && new Set(once.map((c) => c.b)).size === 2 && new Set(once.map((c) => c.c)).size === 4)
  check('no CTAs: the body ends the video', mixCombos(2, 2, 0, 'all').length === 4 && mixCombos(2, 2, 0, 'all').every((c) => c.c === null) && mixLabel(0, 1, null) === 'H1 · B2')
  check('each video is named by what is in it', mixCombos(3, 3, 3, 'all')[5].label === 'H1 · B2 · C3')
  check('no hook or no body makes nothing', mixCombos(0, 3, 3, 'all').length === 0 && mixCombos(3, 0, 3, 'pairs').length === 0)
  check('B-roll: all of it when it fits, else 6 taking turns', JSON.stringify(brollFor(0, 4)) === '[0,1,2,3]' && brollFor(0, 10).length === 6 && JSON.stringify(brollFor(1, 10)) === '[6,7,8,9,0,1]' && brollFor(3, 0).length === 0)
}

// 4c. The Video Builder's modular scripts (Seb, 2026-11-27: "create these different unique scripts that now
//     users can use to shoot their videos ... The different hooks, the different bodies, and the different
//     CTAs and the different B-roll"; "only voiceover type videos, and then also videos that have talking head")
{
  const sheet = readSheet({ product: 'NOBL Tracker', neverSay: ['Tile'], noPrices: true, productDelaySec: 4, lengthSec: [20, 40], approvedClaims: [{ text: 'Finds your bag anywhere' }], disclaimer: 'Results vary.' })
  const sys = scriptsSystem({ type: 'talking', hooks: 3, bodies: 3, ctas: 2, bannedRule: 'HOUSE RULES' })
  check('the writer is told: any hook with any body with any CTA, the counts, the type, the house rules, data never instructions', /ANY hook must flow into ANY body/.test(sys) && /write 3 hooks, 3 bodies and 2 CTAs/.test(sys) && /TALKING TO CAMERA/.test(sys) && /HOUSE RULES/.test(sys) && /never instructions to you/.test(sys))
  check('voiceover scripts are written for the ear, each line over a shot', /VOICEOVER OVER B-ROLL/.test(scriptsSystem({ type: 'voiceover', hooks: 2, bodies: 2, ctas: 1, bannedRule: '' })) && VIDEO_TYPES.voiceover.label === 'Voiceover over B-roll')
  const txt = sheetText(sheet)
  check('the rules go to the writer: claims, never say, the delay, no prices, no invented offer, the disclaimer, the length', /Finds your bag anywhere/.test(txt) && /- Tile/.test(txt) && /no product, brand or category word before 4 seconds/.test(txt) && /NO PRICES/.test(txt) && /never invent a sale/.test(txt) && /Results vary\./.test(txt) && /20 to 40 seconds/.test(txt))
  check('a fix round names what broke', /BROKE THESE RULES/.test(scriptsInput({ brandName: 'NOBL', product: 'Tracker', sheet, fix: ['H1 says "Tile"'] })))
  const reply = JSON.stringify({ hooks: [{ say: 'Nobody tells you this about lost bags', style: 'Curiosity', show: 'me at the carousel' }, { say: 'NOBL Tracker saved my trip \u2014 truly', style: 'Result' }], bodies: [{ angle: 'Peace of mind', lines: [{ say: 'You land, the belt starts, and your stomach drops. Not anymore, because I can see my bag on my phone before it even comes out.', show: 'phone screen' }] }], ctas: [{ say: 'Tap the link and grab one before your next trip.', onScreen: 'Results vary.' }], broll: [{ shot: 'Bag on belt', shows: 'the bag arriving', forBodies: ['B1', 'X9'] }] })
  const s = parseScripts(`Here:\n${reply}`, 'talking')
  check('the reply is read: ids in order, dashes taken out, odd body tags dropped', !!s && s.hooks[1].id === 'H2' && !/[\u2013\u2014]/.test(s.hooks[1].say) && s.broll[0].forBodies.join() === 'B1' && s.type === 'talking')
  check('a reply without a hook or a body is a failure, never an empty set', parseScripts('{"hooks":[],"bodies":[]}', 'talking') === null && parseScripts('no json', 'talking') === null)
  const c = s ? checkScripts(s, sheet) : null
  check('the check catches the product named in a hook when the brand wants it later', !!c && c.state === 'red' && c.items.some((i) => /H2 names "NOBL Tracker" in the hook/.test(i.text)))
  check('the check says how long the combinations run', !!c && c.shortest > 0 && c.longest >= c.shortest && secondsOf(Array(27).fill('word').join(' ')) === 10)
  const banned = parseScripts(JSON.stringify({ hooks: [{ say: 'Better than Tile, for $20' }], bodies: [{ lines: [{ say: 'It is 50% off right now.' }] }], ctas: [] }), 'talking')
  const bc = banned ? checkScripts(banned, readSheet({ neverSay: ['Tile'], noPrices: true, noPercentOff: true })) : null
  check('never-say words, prices and percents are caught', !!bc && bc.items.some((i) => /says "Tile"/.test(i.text)) && bc.items.some((i) => /says a price/.test(i.text)) && bc.items.some((i) => /says a percent/.test(i.text)))
}

// 5. Wired in
const API = read('app/api/labs/trybe-studio/route.ts')
check('the rules API is for the team first', /canUsePreview\('trybe_studio'/.test(API) && canUsePreview('trybe_studio', 'admin') && !canUsePreview('trybe_studio', 'pro'))
check('a link, a file, pasted words, TRYBE\'s brief and the chat are all sources', ["kind === 'trybe_brief'", "kind === 'link'", "kind === 'text'", "action === 'chat'", "action === 'file'"].every((x) => API.includes(x)))
check('an uploaded file is read, then deleted', /readFileBytes\(bytes/.test(API) && /remove\(\[path\]\)/.test(API))
check('reading the rules is costed and gated', /spendGate\(g\.userId, g\.tier\)/.test(API) && /feature: 'studio_rules'/.test(API))
const READ = read('lib/studio-read.ts')
check('links are read with every redirect checked, Google docs through their text export, PDFs and pictures by Claude', /assertPublicHttpUrl\(next\)/.test(READ) && /readUrlFor\(link\)/.test(READ) && /type: 'document', source/.test(READ) && /AbortSignal\.timeout/.test(READ))
const RE = read('app/api/review-edit/route.ts')
check('a studio video carries its brand, and is listed by it', /studio_brand_id: studio\.brandId/.test(RE) && /q\.eq\('studio_brand_id', forStudio\)/.test(RE))
check('what TRYBE said is kept on the video', /action === 'studio_sent'/.test(RE) && /studio_send: send/.test(RE))
const SRV = read('lib/review-edit-server.ts')
check('the studio takes vertical 9:16 only, said in words', /if \(row\.studio_brand_id && !upright\) return await fail\('The Video Builder takes vertical 9:16 video only/.test(SRV))
check('every studio video is checked against its brand\'s rules when it is made', /else if \(row\.studio_brand_id\)/.test(SRV) && /campaign: rules/.test(SRV))
for (const f of ['components/review-editor/ComputerBatch.tsx', 'components/review-editor/DriveBatch.tsx']) {
  const src2 = read(f)
  check(`${f}: sideways files are left out and named before uploading`, /filmed sideways\. The Video Builder takes vertical 9:16 video only\./.test(src2) && /studio: \{ brandId: studio\.brandId \}/.test(src2))
}
const VID = read('components/labs/TrybeStudioVideos.tsx')
check('Send makes the same record and send as Upload', /action: 'create'/.test(VID) && /sendDropToTrybe\(/.test(VID) && /toTrybe: true/.test(VID) && /requestTrybePutFile/.test(VID))
check('a video that breaks a rule asks first', /needsConfirm\(e\) && !window\.confirm/.test(VID))
check('the options are ticked by the creator', ['label="Captions"', 'label="B-roll over the talk"', 'label="Zooms"', 'label="Colour boost"', 'label="Title"'].every((x) => VID.includes(x)))
check('every studio video is a vertical TRYBE ad with no logo', /kind: 'trybe', formats: \['vertical'\], logo: null/.test(VID))
// Seb, 2026-11-26, on the saved "Product provided in exchange for review #ad" title: "This is not necessary."
check('your saved review title and pictures are not carried into a TRYBE ad', /pictures: \[\], callouts: \[\], captions: true, title: \{ \.\.\.saved\.title, on: false, text: '' \}/.test(VID))
const RULES = read('components/labs/TrybeStudioRules.tsx')
check('the rules panel adds links, PDFs or pictures, pasted words and the chat', /Add a link/.test(RULES) && /Add a PDF or picture/.test(RULES) && /Paste words/.test(RULES) && /Add what they sent in chat/.test(RULES))
check('TRYBE\'s brief is read again only when it changed', /kept\.hash !== hashText\(c\.brief\.trim\(\)\)/.test(RULES))
check('questions from disagreeing sources go to the creator', /The sources disagree\. You decide:/.test(RULES))
check('a tab under Videos, only where Labs opens it', /\{ label: 'Video Builder', icon: Wand2, tabs: \['studio'\] \}/.test(read('components/labs/TrybeNav.tsx')) && /\(studio \|\| !it\.tabs\.includes\('studio'\)\)/.test(read('components/labs/TrybeNav.tsx')) && /tab === 'studio' && studio && !lockedTab/.test(read('components/labs/TrybeOutreach.tsx')) && /studio=\{canUsePreview\('trybe_studio', tier\)\}/.test(read('app/(dashboard)/trybe/page.tsx')))
for (const f of ['components/labs/TrybeStudio.tsx', 'components/labs/TrybeStudioRules.tsx', 'components/labs/TrybeStudioVideos.tsx', 'lib/studio.ts']) check(`${f}: no dashes in what the creator reads`, !/[–—]/.test(read(f).replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')))
const MIX = read('components/labs/StudioMixer.tsx')
check('the mixer has four columns, vertical only', /title: 'Hooks'/.test(MIX) && /title: 'Bodies'/.test(MIX) && /title: 'CTAs'/.test(MIX) && /title: 'B-roll'/.test(MIX) && /filmed sideways\. The Video Builder takes vertical 9:16 video only\./.test(MIX))
check('each clip is uploaded once, then each combination is one video: hook, body and CTA joined, B-roll over it', /const up = new Map/.test(MIX) && /review: take\(parts\)/.test(MIX) && /broll: take\(roll\)/.test(MIX) && /studio: \{ brandId: brand\.id, /.test(MIX) && /more: fs\.slice\(1\)/.test(MIX))
check('never more videos than the TRYBE ad edits left, and said', /combos\.slice\(0, Math\.max\(0, trybeLeft\)\)/.test(MIX) && /only the first \{trybeLeft\} of these/.test(MIX))
check('the mixer comes first in the studio', /<StudioMixer brand=\{brand\}/.test(VID) && VID.indexOf('<StudioMixer') < VID.indexOf('A whole video filmed in one take'))
check('a clip shared by many videos stays until every one of them is done', /A STUDIO CLIP IS SHARED/.test(SRV) && /paths = paths\.filter\(\(p\) => !inUse\.has\(p\)\)/.test(SRV) && /if \(error\) return/.test(SRV))
check('no dashes in the mixer', !/[–—]/.test(MIX.replace(/\/\/.*$/gm, '')))
const STEP = read('components/labs/TrybeStudio.tsx')
check('the Video Builder goes step by step: brand, product, rules, scripts, make', /\{ id: 'brand', label: 'Brand' \}, \{ id: 'product', label: 'Product' \}, \{ id: 'rules', label: 'Rules' \}, \{ id: 'scripts', label: 'Scripts' \}, \{ id: 'make', label: 'Make' \}/.test(STEP) && /BUILDER_NAME = 'Video Builder'/.test(STEP))
check('the products come from the brand\'s TRYBE page, or are typed', /loadBrandPage\(b\.id\)/.test(STEP) && /Or type the product/.test(STEP) && /action: 'project'/.test(STEP))
check('the API keeps one set per brand and product, writes the scripts and keeps the options', /action === 'project'/.test(API) && /action === 'scripts'/.test(API) && /action === 'options'/.test(API) && /checkScripts\(scripts, sheet\)/.test(API) && /if \(check\.state === 'red'\)/.test(API))
check('scripts are written only from read rules', /Read the brand\\u2019s rules first/.test(API))
check('videos made in a set know it, and are listed by it', /studio_project_id: studio\.projectId/.test(RE) && /q\.eq\('studio_project_id', forProject\)/.test(RE) && /projectId \? \{ projectId \} : \{\}/.test(MIX))
const MUS = read('components/labs/StudioMusic.tsx')
check('music: none, an accepted bed, or a new one made there, and honest that it is not in the render yet', /No music/.test(MUS) && /status === 'accepted'/.test(MUS) && /<MusicBedMaker/.test(MUS) && /MUSIC_IN_RENDER = false/.test(MUS) && /until then they are made without it/.test(MUS))
check('a voiceover set says it cannot be edited yet, instead of making talking videos from it', /MVP cannot edit voiceover videos yet/.test(VID) && /voiceover\s*\? \(/.test(VID))
check('the options and music are kept with the set', /action: 'options', projectId: project\.id/.test(VID))
check('the shoot sheet prints, its words escaped', /function printSheet/.test(read('components/labs/TrybeStudioScripts.tsx')) && /const esc = /.test(read('components/labs/TrybeStudioScripts.tsx')))
check('migration 477: the sets, and the video column, safe to run twice', existsSync('supabase/migrations/477_video_builder.sql') && /create table if not exists public\.studio_projects/.test(read('supabase/migrations/477_video_builder.sql')) && /add column if not exists studio_project_id uuid/.test(read('supabase/migrations/477_video_builder.sql')))
for (const f of ['components/labs/TrybeStudioScripts.tsx', 'components/labs/StudioMusic.tsx', 'lib/studio-scripts.ts']) check(`${f}: no dashes in what the creator reads`, !/[–—]/.test(read(f).replace(/\/\/.*$/gm, '')))
const MIG = 'supabase/migrations/476_edit_studio.sql'
check('migration 476: the rules table and the two video columns, safe to run twice', existsSync(MIG) && /create table if not exists public\.trybe_brand_rules/.test(read(MIG)) && /add column if not exists studio_brand_id text/.test(read(MIG)) && /add column if not exists studio_send jsonb/.test(read(MIG)))

if (failures.length) {
  console.error(`test-edit-studio: ${failures.length} failed`)
  for (const f of failures) console.error(`  ✗ ${f}`)
  process.exit(1)
}
console.log('test-edit-studio: all checks passed')

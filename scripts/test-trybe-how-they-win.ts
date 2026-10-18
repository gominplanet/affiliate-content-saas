// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// HOW THEY WIN, wired up (components/labs/TrybeHowTheyWin, the top_scripts
// actions in app/api/labs/trybe, migration 442).
//
// The two things that cost real money or real trust:
//
//   A transcription is spent once, by the team, on a video nothing else could
//   read. Spent twice, or spent per member, and the Top 100 costs a hundred
//   times what it should.
//
//   A rewrite never hands the reference back. A creator who posts another
//   creator's words to the same brand in the same month is the one that brand
//   drops, and they would be doing it because MVP told them to.
import { readFileSync, existsSync } from 'node:fs'
import { bestRank } from '../lib/trybe-scripts'
import { readTopEntries, topEntryFields } from '../lib/trybe-working'

const fails: string[] = []
const check = (name: string, ok: boolean | undefined, detail?: unknown) => {
  if (!ok) fails.push(`${name}${detail !== undefined ? `: ${JSON.stringify(detail)}` : ''}`)
}
const read = (f: string) => readFileSync(f, 'utf8')
const R = read('app/api/labs/trybe/route.ts')
const C = read('components/labs/TrybeHowTheyWin.tsx')
const O = read('components/labs/TrybeOutreach.tsx')

// ── On the page ──────────────────────────────────────────────────────────────
check('the component exists', existsSync('components/labs/TrybeHowTheyWin.tsx'))
check('How they win is a tab in Create', /\{ id: 'win', label: 'How they win', icon: Trophy, group: 'create'/.test(O))
check('and it renders, rather than being a label with nothing behind it',
  /type Tab = [^\n]*'win'/.test(O) && /\{tab === 'win' && <TrybeHowTheyWin canRead=\{canMyBrands\} isAdmin=\{isAdmin\} \/>\}/.test(O))
check('it sits with Make videos and Upload videos, not off in Track',
  O.indexOf("id: 'win'") > O.indexOf("id: 'create', label: 'Make videos'") && O.indexOf("id: 'win'") < O.indexOf("id: 'week'"))

// ── WHO MAY SPEND MONEY ──────────────────────────────────────────────────────
// Collecting is the team's. A member reading is free; a member transcribing
// the Top 100 would be the same hundred videos paid for again per person.
for (const action of ['top_scripts_seen', 'top_script_save', 'top_script_hear']) {
  const at = R.indexOf(`action === '${action}'`)
  const body = R.slice(at, at + 500)
  check(`${action} is the team's alone`, at > 0 && /tier !== 'admin'/.test(body), body.slice(0, 120))
}
check('reading a brand’s videos is not admin only', (() => {
  const at = R.indexOf("action === 'top_scripts'")
  return at > 0 && !/tier !== 'admin'/.test(R.slice(at, at + 400))
})())
check('the rewrite is not admin only either, it is what members came for', (() => {
  const at = R.indexOf("action === 'script_rewrite'")
  return at > 0 && !/tier !== 'admin'/.test(R.slice(at, at + 600))
})())

// ── A TRANSCRIPTION IS SPENT ONCE ────────────────────────────────────────────
const hear = R.slice(R.indexOf("action === 'top_script_hear'"), R.indexOf("action === 'script_rewrite'"))
check('a video that already has words is never paid for again', /row\.state === 'ready'[\s\S]{0,80}already: true/.test(hear))
check('a video with no file is written off with a reason, not queued for ever',
  /state: 'none', detail: 'TRYBE gave no video file for this one\.'/.test(hear))
// A transcription that fell over is not a video with no words. Marking it
// 'none' would retire a perfectly good video on one network hiccup.
const hearCatch = hear.slice(hear.indexOf('} catch (e) {'))
check('a transcription that failed leaves the video waiting, not written off',
  hearCatch.length > 40 && /could not listen to it/.test(hearCatch) && !/state:/.test(hearCatch))
check('the video URL is checked before MVP fetches it', /assertPublicHttpUrl\(url\)/.test(hear))
check('no transcription is attempted where it is not configured', /transcriptionConfigured\(\)/.test(hear))
// Free first. TRYBE shares the words for some of them at no cost.
check('the page asks TRYBE for the words before paying to listen',
  C.indexOf("action: 'top_script_save'") < C.indexOf("action: 'top_script_hear'"))
check('and only pays for the ones TRYBE had nothing for', /hear\.delete\(id\)/.test(C))
// EVERY ZERO CARRIES ITS REASON. The first collection reported "TRYBE
// shared 0, MVP listened to 0" and said nothing about why, which is the
// failure this codebase keeps producing: a screen reporting the plan rather
// than the result.
check('a collection that got nothing from TRYBE says how many it asked',
  /TRYBE shared the words for none of the \$\{need\.length\} MVP asked about/.test(C))
check('and says how many TRYBE refused outright', /refused \$\{refused\} of those outright/.test(C))
check('a video TRYBE gave no file for is counted and named as the reason nothing listened',
  /\$\{noFile\} of them have no video file/.test(C) && /noFile/.test(R))
check('transcription being switched off is said, not reported as zero videos',
  /Transcription is not switched on for this deployment/.test(C) && /not configured/i.test(C))
check('an answer with no video files at all says that in as many words',
  /TRYBE sent no video files at all in this answer/.test(C))
check('what it did get is still reported per source', /MVP listened to \$\{heard\} of \$\{toHear\.length\}/.test(C))

// ── WHAT WAS FILED IS WHAT WAS SAVED ─────────────────────────────────────────
// Seb, 2026-10-18, twice: "Filed 100 videos", then "none of the 0 MVP asked
// about" and "Nothing collected yet". The Top 100 reader calls a video's id
// `id`, the route filed only `submissionId`, so every entry was dropped before
// it was saved, and the page counted what it sent rather than what was kept.
const seenAt = R.indexOf("action === 'top_scripts_seen'")
const seenBody = R.slice(seenAt, R.indexOf("action === 'top_script_save'"))
check('the route files a video under its id whichever name it comes in', /\[e\.submissionId, e\.id\]/.test(seenBody))
check('and says how many came with no id at all', /noId = list\.filter\(\(e\) => !e\.submissionId\)/.test(seenBody) && (seenBody.match(/noId/g) || []).length >= 3)
check('the page sends the id under the name the route files it by', /entries: entries\.map\(\(e\) => \(\{ \.\.\.e, submissionId: e\.id \}\)\)/.test(C))
check('"Filed" is the count the route saved, not the count the page sent',
  /const filed = Number\(seen\.json\.saved\)/.test(C) && /Filed \$\{filed\} of the \$\{entries\.length\}/.test(C) && !/`Filed \$\{entries\.length\}/.test(C))
check('filing none is said as none, and not shown with a tick', /MVP filed none of the \$\{entries\.length\}/.test(C) && /i === 0 && report\.filed \? <Check/.test(C))
check('entries with no id are counted with the reason', /came without a video id in TRYBE/.test(C))
check('asking about none says why, instead of "none of the 0"',
  /if \(need\.length\) lines\.push\(shared/.test(C) && /else if \(filed\) lines\.push\('Every one of them was already tried on an earlier collection/.test(C))
// The second collection (Seb, 2026-10-18) read "TRYBE shared the words for
// 7" and "5 did not come back": 53 refusals and five reasons, all unsaid.
check('a collection that got some words still says how many were asked and refused',
  /TRYBE shared the words for \$\{shared\} of the \$\{need\.length\} MVP asked about\$\{turnedDown\}/.test(C)
    && /const turnedDown = refused \? `, and refused \$\{refused\} of those outright`/.test(C))
check('a video that did not come back says why', /whyNot\.set\(why/.test(C) && /did not come back\$\{reasons \? ` \(\$\{reasons\}\)` : ''\}/.test(C))
check('what is left is said, and that Collect again does the next ones',
  /const stillWaiting = Math\.max\(0, waiting - shared - heard\)/.test(C) && /Collect again listens to the next/.test(C)
    && /const hearLeft = canHear\.length - hear\.length/.test(seenBody) && /hearLeft,/.test(seenBody))
check('one collection still pays for 25 at most', /const hear = canHear\.slice\(0, 25\)/.test(seenBody))
// Write mine from this, pressed with the boxes empty (Seb, 2026-10-18): the
// page checks first with the route's own rule, says where the boxes are, and
// takes the creator to the empty one, before anything is spent.
{
  const rw = C.slice(C.indexOf('async function rewrite('), C.indexOf("action: 'script_rewrite'"))
  check('an empty box is caught on the page with the route’s own rule, before the request',
    /const missing = rewriteMissing\(\{ reference: v\.script, experience, product \}\)/.test(rw) && /if \(missing\.length\)[\s\S]{0,500}return/.test(rw))
  check('and the creator is taken to the empty box', /scrollIntoView/.test(rw) && /box\?\.focus\(\)/.test(rw)
    && /ref=\{productBox\}/.test(C) && /ref=\{experienceBox\}/.test(C))
  check('and told where the boxes are', /Fill in the boxes above under/.test(rw))
}
check('an answer with no video files shows the fields TRYBE did send', /withFile === 0\) lines\.push\(`Each entry TRYBE sent has: \$\{topEntryFields\(top\.json\)\}/.test(C))
{
  const nested = readTopEntries({ data: [{ id: 's1', brandName: 'Acme', media: { assets: [{ type: 'video', url: 'https://cdn.example.com/v/a1.mp4?sig=1' }] } }] })
  check('a video file a few levels down is found', nested[0]?.video === 'https://cdn.example.com/v/a1.mp4?sig=1', nested[0]?.video)
  const keyed = readTopEntries({ data: [{ id: 's2', brandName: 'Acme', submission: { videoFileUrl: 'https://files.example.com/abc' } }] })
  check('and so is one under a name only a video file has', keyed[0]?.video === 'https://files.example.com/abc', keyed[0]?.video)
  const page = readTopEntries({ data: [{ id: 's3', brandName: 'Acme', post: { videoUrl: 'https://www.tiktok.com/@a/video/1' }, cover: { src: 'https://cdn.example.com/t.jpg' } }] })
  check('a TikTok page or a picture is never taken for a file', page[0]?.video === null, page[0]?.video)
  const fields = topEntryFields({ data: [{ id: 's1', rank: 1, media: { assets: [], kind: 'x' }, creator: { name: 'a' } }] })
  check('the field list names nested fields too', /media\.\{assets, kind\}/.test(fields) && /creator\.\{name\}/.test(fields), fields)
}

// ── A better place is kept ───────────────────────────────────────────────────
check('a worse day never demotes a video', bestRank(71, 3) === 3 && bestRank(3, 71) === 3)
check('a first sighting stands on its own', bestRank(12, undefined) === 12 && bestRank(null, 12) === 12)
check('nothing known stays nothing, never zero', bestRank(null, undefined) === null && bestRank(0, null) === null)
check('the route keeps the best place rather than today’s', /bestRank\(r\.best_rank, was\?\.best_rank\)/.test(R))

// ── THE CHECK THAT PROTECTS THE CREATOR ──────────────────────────────────────
const rw = R.slice(R.indexOf("action === 'script_rewrite'"), R.indexOf("action === 'script_rewrite'") + 3000)
check('a rewrite too close to the original is refused, not shown with a warning',
  /tooAlike\(reference, out\.script\)/.test(rw) && /status: 409/.test(rw))
check('and the refusal tells the creator what to change', /Move the dial to Same shape or Just the idea/.test(rw))
check('the creator must say what happened to them before anything is written', /rewriteMissing\(input\)/.test(rw))
check('the spend gate runs before the model does',
  rw.indexOf('spendGate(userId, tier)') > 0 && rw.indexOf('spendGate(userId, tier)') < rw.indexOf('messages.create'))
check('what it cost is recorded against the creator', /feature: 'trybe_script_rewrite'/.test(rw))
check('a model that answers with prose is a message, not a crash', /did not get a script back it could use/.test(rw))

check('TRYBE\u2019s answer is parsed into words before it is saved',
  /readScript\(sr\.json\)/.test(C) || /readScript\(body\.script\)/.test(R))
check('and the route parses it too, whatever the page sends', /typeof body\.script === 'string' \? body\.script : readScript\(body\.script\)/.test(R))

// ── WHAT THE BOARD ADMITS ────────────────────────────────────────────────────
// Four openings out of twenty five asked is the normal case. A board that
// hides that sends a creator to copy the wrong thing.
check('the board prints its own coverage', /\{coverage\}/.test(C) && /coverage: coverageWords\(rows\)/.test(R))
check('each card says which source answered, and they are different sentences',
  /TRYBE shared these words/.test(C) && /MVP listened to the video for these words/.test(C))
check('a video with no words is shown saying so, not left out',
  /Nothing read from this one yet/.test(C) && /v\.detail \|\| 'Nothing read from this one yet'/.test(C))
check('a video with no opening line says that too', /No opening line yet\./.test(C))
check('the server sends the coverage line rather than the page inventing one', /coverage: coverageWords\(rows\)/.test(R))

// ── Migration missing is said, not swallowed ─────────────────────────────────
check('a database without migration 442 says which migration', /How they win needs migration 442 in Supabase first\./.test(R))
check('and says it on reading, not only on writing', /scriptsMissing\(error\.message\)[\s\S]{0,160}needsMigration: true/.test(R))

// ── House style ──────────────────────────────────────────────────────────────
// One line at a time: a quoted string a creator reads never spans lines, and
// pairing quotes across lines read the code between two attributes as copy.
const copy = (C.match(/"[^"\n]{12,}"|>[^<>{}\n]{14,}</g) ?? []).join(' ')
check('no dashes in anything a creator reads', !/[–—]| - /.test(copy), (copy.match(/[–—]| - /g) ?? []).slice(0, 3))
check('no year typed into the copy', !/\b20\d\d\b/.test(copy))

if (fails.length) {
  console.error(`\n❌ trybe-how-they-win: ${fails.length} failure(s)\n`)
  for (const f of fails) console.error(`   • ${f}`)
  process.exit(1)
}
console.log('✅ trybe-how-they-win: the team pays for a transcription once, the board admits how thin it is, and a rewrite that copies the original is refused')

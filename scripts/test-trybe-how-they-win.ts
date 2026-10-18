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
import { bestRank, withTeamWords } from '../lib/trybe-scripts'
import { readTopEntries, topEntryFields } from '../lib/trybe-working'

const fails: string[] = []
const check = (name: string, ok: boolean | undefined, detail?: unknown) => {
  if (!ok) fails.push(`${name}${detail !== undefined ? `: ${JSON.stringify(detail)}` : ''}`)
}
const read = (f: string) => readFileSync(f, 'utf8')
const R = read('app/api/labs/trybe/route.ts')
// The page and the collection pass it shares with the daily run.
const COLLECT = read('components/labs/trybe-collect.ts')
const C = read('components/labs/TrybeHowTheyWin.tsx') + '\n' + COLLECT
const HEAR = read('lib/trybe-top-hear.ts')
const CRON = read('app/api/cron/trybe-top-hear/route.ts')
const O = read('components/labs/TrybeOutreach.tsx')

// ── On the page ──────────────────────────────────────────────────────────────
check('the component exists', existsSync('components/labs/TrybeHowTheyWin.tsx'))
// TEAM ONLY (Seb, 2026-10-18: "how they win may not be very helpful" as its
// own tab; the help belongs in Make videos). The team keeps the tab to collect.
check('the collection is a team only tab in Create', /\{ id: 'win', label: 'Top 100 words', icon: Trophy, group: 'create', teamOnly: true/.test(O))
check('members never see it in the menu', /TABS\.filter\(\(t\) => t\.group === g\.id && \(!t\.teamOnly \|\| isAdmin\)\)/.test(O))
check('and it renders for the team only, rather than being a label with nothing behind it',
  /type Tab = [^\n]*'win'/.test(O) && /\{tab === 'win' && isAdmin && <TrybeHowTheyWin canRead=\{canMyBrands\} isAdmin=\{isAdmin\} \/>\}/.test(O))

// ── WHERE A MEMBER SEES IT: Make videos, Their best videos ───────────────────
{
  const V = read('components/labs/TrybeVideoIdeas.tsx')
  check('Their best videos reads the team’s Top 100 words for the brand', /action: 'top_scripts', brandId/.test(V) && /withTeamWords\(out, await teamWords\(brandId\), 9\)/.test(V))
  check('and a brand with no live top videos still shows its Top 100 ones', V.indexOf('withTeamWords(out') < V.indexOf("TRYBE shows no top videos for this brand yet"))
  check('each video says where its words came from', /From the Top 100: MVP listened to it/.test(V) && /From the Top 100: TRYBE shared it/.test(V))
  check('and the line under them counts both sources', /MVP has the words of \$\{winners\.fromTeam\}/.test(V))
  const live = [
    { id: 'a', thumbnail: null, video: null, caption: null, words: 'TRYBE shared these words live today' },
    { id: 'b', thumbnail: null, video: null, caption: null, words: null },
    { id: 'c', thumbnail: null, video: null, caption: null, words: null },
  ]
  const row = (id: string, rank: number, source: 'trybe' | 'transcribed', state: 'ready' | 'waiting' = 'ready') =>
    ({ submission_id: id, script: state === 'ready' ? `${id} `.repeat(30) : null, state, source, best_rank: rank, thumbnail: null, video_url: null })
  const m = withTeamWords(live, [row('b', 4, 'transcribed'), row('z', 9, 'trybe'), row('y', 2, 'transcribed'), row('c', 1, 'trybe', 'waiting')], 9)
  check('a live video TRYBE gave no words for gets the team’s, marked as listened', m.videos[1].words?.startsWith('b ') === true && m.videos[1].from === 'top100_listened')
  check('a video with no words anywhere stays without, and says nothing', m.videos[2].words === null && m.videos[2].from === null)
  check('live words are kept and marked as TRYBE’s', m.videos[0].words === 'TRYBE shared these words live today' && m.videos[0].from === 'trybe')
  check('the brand’s other Top 100 videos with words follow, best placed first',
    m.videos.slice(3).map((v) => v.id).join() === 'y,z' && m.videos[4].from === 'top100_trybe', m.videos.map((v) => v.id))
  check('the count is what came from the team', m.fromTeam === 3, m.fromTeam)
  check('and the list stops at the cap', withTeamWords(live, [row('y', 2, 'trybe'), row('z', 9, 'trybe')], 4).videos.length === 4)
}
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
// The route's press and the daily job share one listen (lib/trybe-top-hear).
const hear = R.slice(R.indexOf("action === 'top_script_hear'"), R.indexOf("action === 'script_rewrite'")) + '\n' + HEAR
check('the press and the daily job listen with the same code', /hearTopVideo\(admin, row\)/.test(R) && /hearTopVideo\(sb, r\)/.test(CRON))

// ── ONCE A DAY, BY ITSELF (Seb, 2026-10-18) ─────────────────────────────────
// Reading the Top 100 needs a signed in TRYBE, so it runs on the team's first
// TRYBE visit of the day. Listening needs only the saved file, so the server
// does it, under a daily cap counted in the same ledger as the team's presses.
{
  check('the first team visit of the day collects by itself',
    /if \(preview \|\| !isAdmin \|\| !canMyBrands \|\| autoCollect\.current\) return/.test(O) && /collectTop100\(\{ listen: false \}\)/.test(O))
  check('and the day is marked done only after the run finished',
    O.indexOf("localStorage.setItem(KEY, today)") > O.indexOf('collectTop100({ listen: false })') && /if \(!r\.ok\) \{ toast\.error/.test(O))
  check('the daily run does not listen in the page; the server does', /const toHear = o\.listen \? \[\.\.\.hear\] : \[\]/.test(COLLECT)
    && /It does that on its own over the next few hours, up to 25 a day/.test(COLLECT))
  check('the Collect press still listens', /collectTop100\(\{ listen: true/.test(C))
  const crons = (JSON.parse(read('vercel.json')).crons ?? []) as Array<{ path: string; schedule: string }>
  check('the listening job is scheduled', crons.some((c) => c.path === '/api/cron/trybe-top-hear'))
  check('it needs the cron secret', /CRON_SECRET/.test(CRON))
  check('it stops at the daily cap, counted with the team\u2019s presses',
    /const room = Math\.min\(PER_RUN, DAILY_CAP - done\)/.test(CRON) && /const DAILY_CAP = 25/.test(CRON) && /await countListen\(sb\)/.test(HEAR))
  check('a count it cannot read stops it rather than letting it spend', /if \(error\) return Number\.POSITIVE_INFINITY/.test(HEAR))
  check('it listens only to fresh files, best placed first, and never retries a failure on its own',
    /\.gte\('updated_at', new Date\(Date\.now\(\) - FRESH_MS\)/.test(CRON) && /order\('best_rank', \{ ascending: true/.test(CRON)
      && /!\/\^MVP could not listen to it\/\.test/.test(CRON))
  check('a listen is counted before it is paid for', HEAR.indexOf('await countListen(sb)') < HEAR.indexOf('await transcribeToCues(url)'))
  // The report: "nothing was paid for" only when nothing was listened to.
  const tail = COLLECT.slice(COLLECT.indexOf('else if (toHear.length) lines.push(heard'))
  check('a run that listened never says nothing was paid for',
    /\n  else lines\.push\(`Nothing was left with a video file to listen to/.test(tail) && !/if \(stillWaiting\) \{[\s\S]{0,400}\} *\n *else if \(!notConfigured\) lines\.push\(`Nothing was left/.test(COLLECT))
}
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
  check('and the creator is taken to the product box', /scrollIntoView/.test(rw) && /box\?\.focus\(\)/.test(rw) && /ref=\{productBox\}/.test(C))
  check('and told where it is', /Type which product this is for in the box above under/.test(rw))
  // An ad, not a review: the other box asks for nothing MVP needs to have.
  check('the second box is optional and does not ask for a true story',
    /placeholder="Anything to work in\?[^"]*Optional\."/.test(C) && !/MVP cannot invent/.test(C))
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
check('the route still checks the video and the product before anything is written', /rewriteMissing\(input\)/.test(rw))
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

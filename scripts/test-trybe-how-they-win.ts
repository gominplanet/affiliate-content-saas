// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// TRYBE'S TOP 100, collected in the background and used in Make videos
// (components/labs/trybe-collect, the top_scripts actions in
// app/api/labs/trybe, the trybe-top-hear job, migration 442).
//
// Seb, 2026-10-19: "giving a user a way to click on top 100 words and then
// just clicking on videos filed and with the words and Tribe shared, it's so
// confusing and I don't know what it brings." So there is no tab. The team's
// SCOUT reads the Top 100 once a day, the server listens to the videos TRYBE
// shared no words for, and Make videos writes from the winning ads.
//
// What must not break:
//   A transcription is spent once, by the team, on a video nothing else could
//   read, under a daily cap. Spent twice, or per member, and the Top 100
//   costs a hundred times what it should.
//   Make videos learns from the winning ads and never copies them, and says
//   how many it used, so a plan written without any never reads as one that had.
import { readFileSync, existsSync } from 'node:fs'
import { bestRank, withTeamWords, whyNoWords, noWordsSentence, pickExamples, examplesBlock } from '../lib/trybe-scripts'
import { readTopEntries, topEntryFields } from '../lib/trybe-working'

const fails: string[] = []
const check = (name: string, ok: boolean | undefined, detail?: unknown) => {
  if (!ok) fails.push(`${name}${detail !== undefined ? `: ${JSON.stringify(detail)}` : ''}`)
}
const read = (f: string) => readFileSync(f, 'utf8')
const R = read('app/api/labs/trybe/route.ts')
const C = read('components/labs/trybe-collect.ts')
const HEAR = read('lib/trybe-top-hear.ts')
const CRON = read('app/api/cron/trybe-top-hear/route.ts')
const O = read('components/labs/TrybeOutreach.tsx')
const V = read('components/labs/TrybeVideoIdeas.tsx')

// ── NO TAB ───────────────────────────────────────────────────────────────────
check('the Top 100 words tab is gone, for the team too',
  !existsSync('components/labs/TrybeHowTheyWin.tsx') && !/TrybeHowTheyWin/.test(O) && !/'win'/.test(O) && !/Top 100 words/.test(O))
check('and so are the actions only it used',
  !/action === 'top_scripts_stats'/.test(R) && !/action === 'top_script_hear'/.test(R) && !/action === 'script_rewrite'/.test(R))

// ── ONCE A DAY, BY ITSELF ────────────────────────────────────────────────────
// Reading the Top 100 needs a signed in TRYBE, so it runs on the team's first
// TRYBE visit of the day. Listening needs only the saved file, so the server
// does it, under a daily cap.
check('the first team visit of the day collects by itself',
  /if \(preview \|\| !isAdmin \|\| !canMyBrands \|\| autoCollect\.current\) return/.test(O) && /void collectTop100\(\)\.then/.test(O))
check('and the day is marked done only after the run finished',
  O.indexOf('localStorage.setItem(KEY, today)') > O.indexOf('void collectTop100()') && /if \(!r\.ok\) \{ toast\.error/.test(O))
check('a run that went fine is one quiet line, a problem says what it was',
  /if \(r\.report\.tone === 'warn'\) toast\.warning\(`Today’s Top 100: \$\{r\.report\.lines\.join\(' '\)\}`/.test(O)
    && /Today’s TRYBE Top 100 is in\. Make videos writes from its winning ads\./.test(O))
check('the page never listens; the server does', !/top_script_hear/.test(C) && /It does that on its own over the next few hours, up to 25 a day/.test(C))
{
  const crons = (JSON.parse(read('vercel.json')).crons ?? []) as Array<{ path: string; schedule: string }>
  check('the listening job is scheduled', crons.some((c) => c.path === '/api/cron/trybe-top-hear'))
}
check('it needs the cron secret', /CRON_SECRET/.test(CRON))
check('it stops at the daily cap', /const room = Math\.min\(PER_RUN, DAILY_CAP - done\)/.test(CRON) && /const DAILY_CAP = 25/.test(CRON) && /await countListen\(sb\)/.test(HEAR))
check('a count it cannot read stops it rather than letting it spend', /if \(error\) return Number\.POSITIVE_INFINITY/.test(HEAR))
check('it listens only to fresh files, best placed first, and never retries a failure on its own',
  /\.gte\('updated_at', new Date\(Date\.now\(\) - FRESH_MS\)/.test(CRON) && /order\('best_rank', \{ ascending: true/.test(CRON)
    && /!\/\^MVP could not listen to it\/\.test/.test(CRON))
check('a listen is counted before it is paid for', HEAR.indexOf('await countListen(sb)') < HEAR.indexOf('await transcribeToCues(url)'))
check('a video that already has words is never paid for again', /row\.state === 'ready'[\s\S]{0,80}already: true/.test(HEAR))
check('a video with no file is written off with a reason, not queued for ever', /state: 'none', detail: 'TRYBE gave no video file for this one\.'/.test(HEAR))
{
  const hearCatch = HEAR.slice(HEAR.indexOf('} catch (e) {'))
  check('a transcription that failed leaves the video waiting, not written off',
    hearCatch.length > 40 && /could not listen to it/.test(hearCatch) && !/state:/.test(hearCatch))
}
check('the video URL is checked before MVP fetches it', /assertPublicHttpUrl\(url\)/.test(HEAR))

// ── WHO MAY WRITE ────────────────────────────────────────────────────────────
for (const action of ['top_scripts_seen', 'top_script_save']) {
  const at = R.indexOf(`action === '${action}'`)
  check(`${action} is the team's alone`, at > 0 && /tier !== 'admin'/.test(R.slice(at, at + 500)))
}
check('reading a brand’s Top 100 videos is not admin only', (() => {
  const at = R.indexOf("action === 'top_scripts'")
  return at > 0 && !/tier !== 'admin'/.test(R.slice(at, at + 400))
})())

// ── WHAT WAS FILED IS WHAT WAS SAVED ─────────────────────────────────────────
// Seb, 2026-10-18: "Filed 100" while the route had dropped every one, because
// the reader calls a video's id `id` and the route filed only `submissionId`.
{
  const seenBody = R.slice(R.indexOf("action === 'top_scripts_seen'"), R.indexOf("action === 'top_script_save'"))
  check('the route files a video under its id whichever name it comes in', /\[e\.submissionId, e\.id\]/.test(seenBody))
  check('and says how many came with no id at all', /noId = list\.filter\(\(e\) => !e\.submissionId\)/.test(seenBody))
  check('the page sends the id under the name the route files it by', /entries: entries\.map\(\(e\) => \(\{ \.\.\.e, submissionId: e\.id \}\)\)/.test(C))
  check('"Filed" is the count the route saved', /const filed = Number\(seen\.json\.saved\)/.test(C) && /Filed \$\{filed\} of the \$\{entries\.length\}/.test(C))
  check('one collection hands the server 25 at most', /const hear = canHear\.slice\(0, 25\)/.test(seenBody))
  check('the route keeps the best place rather than today’s', /bestRank\(r\.best_rank, was\?\.best_rank\)/.test(R))
  check('today’s already filed ones say why they have no words', /noneWhy = noWordsSentence\(whyNoWords\(earlier\.filter/.test(seenBody))
}
// EVERY ZERO CARRIES ITS REASON, and amber is kept for a real problem.
check('a collection that got nothing from TRYBE says how many it asked and refused',
  /TRYBE shared the words for none of the \$\{need\.length\} MVP asked about\$\{turnedDown\}/.test(C) && /refused \$\{refused\} of those outright/.test(C))
check('free first: TRYBE is asked before anything is left to the server', /hear\.delete\(id\)/.test(C))
check('up to date is said as up to date', /All of them were filed on an earlier collection, so there was nothing new to ask TRYBE about\. \$\{haveWords\} of today/.test(C) && /if \(noneWhy\) lines\.push\(noneWhy\)/.test(C))
check('amber only for a real problem', /const problem = !filed \|\| noId > 0 \|\| empty > 0 \|\| withFile === 0/.test(C) && /tone: problem \? 'warn' : 'ok'/.test(C))
check('an answer with no video files names the fields TRYBE did send', /TRYBE sent no video files at all in this answer\. Each entry TRYBE sent has: \$\{topEntryFields\(top\.json\)\}/.test(C))
check('TRYBE’s answer is parsed into words before it is saved', /readScript\(sr\.json\)/.test(C) && /typeof body\.script === 'string' \? body\.script : readScript\(body\.script\)/.test(R))
{
  const n = whyNoWords([
    { state: 'ready' }, { state: 'none', detail: 'MVP listened to it and heard only 12 characters of words.', video_url: 'https://x/v.mp4' },
    { state: 'none', detail: 'TRYBE gave no video file for this one.' }, { state: 'waiting', video_url: 'https://x/a.mp4' },
    { state: 'waiting', detail: 'MVP could not listen to it: timeout', video_url: 'https://x/b.mp4' },
  ])
  check('the no words count tells the four reasons apart', n.noSpeech === 1 && n.noFile === 1 && n.toListen === 1 && n.couldNot === 1, n)
  const words = noWordsSentence(n)
  check('and says them in words', /^4 have no words: 1 was listened to and hardly anything is said in it/.test(words) && /1 came without a video file/.test(words), words)
  check('every video with words says nothing', noWordsSentence(whyNoWords([{ state: 'ready' }])) === '')
}
{
  const nested = readTopEntries({ data: [{ id: 's1', brandName: 'Acme', media: { assets: [{ type: 'video', url: 'https://cdn.example.com/v/a1.mp4?sig=1' }] } }] })
  check('a video file a few levels down is found', nested[0]?.video === 'https://cdn.example.com/v/a1.mp4?sig=1', nested[0]?.video)
  const page = readTopEntries({ data: [{ id: 's3', brandName: 'Acme', post: { videoUrl: 'https://www.tiktok.com/@a/video/1' }, cover: { src: 'https://cdn.example.com/t.jpg' } }] })
  check('a TikTok page or a picture is never taken for a file', page[0]?.video === null, page[0]?.video)
  const fields = topEntryFields({ data: [{ id: 's1', rank: 1, media: { assets: [], kind: 'x' }, creator: { name: 'a' } }] })
  check('the field list names nested fields too', /media\.\{assets, kind\}/.test(fields) && /creator\.\{name\}/.test(fields), fields)
}
check('a worse day never demotes a video', bestRank(71, 3) === 3 && bestRank(3, 71) === 3 && bestRank(null, undefined) === null)

// ── MAKE VIDEOS WRITES FROM THE WINNING ADS ──────────────────────────────────
check('the video plan reads the Top 100 words and picks examples for the brand',
  /\.from\('trybe_top_scripts'\)\.select\('brand_id,brand_name,best_rank,category,script,state'\)\.eq\('state', 'ready'\)/.test(R)
    && /pickExamples\(/.test(R) && /\$\{examplesText \? `\\n\\n\$\{examplesText\}` : ''\}/.test(R))
check('and says how many it used, on both answers', (R.match(/fromTop100: examples\.length/g) || []).length === 2)
check('the page says it on the plan', /Written with \$\{d\.fromTop100\} winning ad/.test(V))
{
  const rows = [
    { brand_id: 'a', brand_name: 'Hollow Socks', best_rank: 5, category: 'Apparel & Accessories', script: 'Hollow Socks changed my runs. Stop buying cheap socks that fall apart in a week.', state: 'ready' as const },
    { brand_id: 'b', brand_name: 'Pepper Pong', best_rank: 2, category: 'Toys & Games', script: 'This is the game my whole family fights over every single weekend now, here is why.', state: 'ready' as const },
    { brand_id: 'c', brand_name: 'BYLT', best_rank: 9, category: 'Apparel', script: 'BYLT shirts keep their shape after fifty washes, look at this collar after a year.', state: 'ready' as const },
    { brand_id: 'c', brand_name: 'BYLT', best_rank: 12, category: 'Apparel', script: 'A second BYLT ad, long enough to count as words for this check to read.', state: 'ready' as const },
    { brand_id: 'c', brand_name: 'BYLT', best_rank: 14, category: 'Apparel', script: 'A third BYLT ad, long enough to count as words for this check to read.', state: 'ready' as const },
    { brand_id: 'm', brand_name: 'Mason Clothing', best_rank: 40, category: 'Apparel', script: 'Mason Clothing own ad words, long enough to count for this check to read.', state: 'ready' as const },
    { brand_id: 'd', brand_name: 'Quiet', best_rank: 1, category: 'Apparel', script: null, state: 'none' as const },
  ]
  const picked = pickExamples(rows, { id: 'm', name: 'Mason Clothing', categories: ['Apparel'] }, 6)
  check('the brand’s own winning ad comes first', picked[0]?.brand_name === 'Mason Clothing', picked.map((r) => r.brand_name))
  check('then its category, best placed first', picked[1]?.brand_name === 'Hollow Socks' && picked[2]?.brand_name === 'BYLT', picked.map((r) => r.brand_name))
  check('two at most from any one brand', picked.filter((r) => r.brand_name === 'BYLT').length === 2)
  check('a video without words is never an example', !picked.some((r) => r.brand_name === 'Quiet'))
  const block = examplesBlock(picked, 'Mason Clothing')
  check('another brand’s name never reaches the plan', !/Hollow Socks|BYLT|Pepper Pong/.test(block) && /the brand changed my runs/.test(block), block)
  check('the brand’s own name stays', /Mason Clothing own ad words/.test(block))
  check('and the plan is told to learn from them, never copy them', /Never copy their sentences, never name another brand, and never borrow their numbers, prices or results\./.test(block))
  check('no examples, no block', examplesBlock([], 'X') === '')
}
// Their best videos still shows the brand's own Top 100 words.
check('Their best videos reads the team’s Top 100 words for the brand', /action: 'top_scripts', brandId/.test(V) && /withTeamWords\(out, await teamWords\(brandId\), 9\)/.test(V))
{
  const live = [{ id: 'a', thumbnail: null, video: null, caption: null, words: 'TRYBE shared these words live today' }, { id: 'b', thumbnail: null, video: null, caption: null, words: null }]
  const row = (id: string, rank: number) => ({ submission_id: id, script: `${id} `.repeat(30), state: 'ready' as const, source: 'transcribed' as const, best_rank: rank, thumbnail: null, video_url: null })
  const m = withTeamWords(live, [row('b', 4), row('y', 2)], 9)
  check('a live video TRYBE gave no words for gets the team’s, marked as listened', m.videos[1].words?.startsWith('b ') === true && m.videos[1].from === 'top100_listened')
}

// ── Migration missing is said, not swallowed ─────────────────────────────────
check('a database without migration 442 says which migration', /needs migration 442 in Supabase first\./.test(R))

// ── House style ──────────────────────────────────────────────────────────────
const copy = (C.match(/`[^`\n]{12,}`|'[^'\n]{12,}'/g) ?? []).join(' ')
check('no dashes in anything a creator reads', !/[–—]| - /.test(copy), (copy.match(/[–—]| - /g) ?? []).slice(0, 3))

if (fails.length) {
  console.error(`\n❌ trybe-how-they-win: ${fails.length} failure(s)\n`)
  for (const f of fails) console.error(`   • ${f}`)
  process.exit(1)
}
console.log('✅ trybe-how-they-win: the Top 100 is collected in the background, paid for once, and Make videos writes from its winning ads')

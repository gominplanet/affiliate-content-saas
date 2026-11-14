// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// WHEN YOUTUBE REFUSES MVP'S DOWNLOADER, SCOUT BRINGS THE CREATOR'S OWN VIDEO
// IN FROM YOUTUBE STUDIO (Seb, 2026-11-14, a screenshot of Clip Factory's
// Shorts cards: "We couldn't fetch this video automatically: YouTube is
// refusing MVP's downloader right now (it asks it to sign in). Upload the MP4
// instead").
//
// The Studio route (MVP_STUDIO_VIDEO_FILE) already existed, but only the find
// moments panel used it. The Shorts cards ("Tap to fetch") and Shorts Studio
// told the creator to upload by hand. Nothing here gets past YouTube's check on
// MVP's server: Studio's own Download, in the owner's own signed-in browser.
import { readFileSync } from 'node:fs'

const fails: string[] = []
const check = (name: string, ok: boolean | undefined, detail?: unknown) => { if (!ok) fails.push(`${name}${detail !== undefined ? `: ${JSON.stringify(detail).slice(0, 400)}` : ''}`) }
const read = (p: string) => readFileSync(p, 'utf8')

;(async () => {
  const { studioFileWords, fileFromStudio, serverOrStudio } = await import('../lib/studio-file-client')

  // ── The words ──────────────────────────────────────────────────────────────
  const codes = ['not-installed', 'needs-update', 'signed-out', 'not-your-video', 'no-download-url', 'too-large', 'timeout', 'studio-http-403', '']
  const said = codes.map((c) => studioFileWords(c, 'upload the MP4 instead'))
  check('every reason SCOUT gives is said in words, with what to do', said.every((t) => t.length > 30 && /\.$/.test(t)), said)
  check('no SCOUT says so and says what SCOUT would do', /SCOUT is not installed in this browser\. With it, MVP brings your own videos in from YouTube Studio\. Or upload the MP4 instead\./.test(said[0]))
  check('no download offered reads as one sentence', said[4] === 'YouTube Studio did not offer a download for this video. Download it in Studio (the ⋮ menu, then Download) and upload the MP4.', said[4])
  check('the panel keeps its own words for its own box', /drop the file in the box/.test(studioFileWords('timeout', 'drop the file in the box')))
  check('no dashes in what a creator reads', !said.some((t) => /[–—]| - /.test(t)))

  // ── The helper, end to end where SCOUT is missing ─────────────────────────
  const calls: Array<{ url: string; body: Record<string, unknown> }> = []
  ;(globalThis as { fetch: typeof fetch }).fetch = (async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body || '{}')) })
    return new Response(JSON.stringify({ ok: true, uploadUrl: 'https://storage.example/upload', youtubeVideoId: 'abcdefghijk', path: 'u1/ingest-studio-x.mp4', maxBytes: 100 }), { status: 200 })
  }) as typeof fetch
  const r = await fileFromStudio('v1', 'short', 'upload the MP4 instead')
  check('without SCOUT it says so, and nothing is attached', !r.ok && r.code === 'not-installed' && calls.length === 1 && calls[0].body.target === 'short', { r, calls })

  // ── The decision, run on every answer the server fetch gives ──────────────
  // Lisa's and Seb's case: YouTube refused MVP's server.
  const refused = { error: "We couldn't fetch this video automatically: YouTube is refusing MVP\u2019s downloader right now (it asks it to sign in). Upload the MP4 instead and we'll take it from there.", needsUpload: true }
  let asked = 0
  const studioOk = async () => { asked++; return { ok: true as const, url: 'https://storage.example/u1/ingest-studio-1.mp4' } }
  const studioNo = async () => { asked++; return { ok: false as const, code: 'not-installed', why: studioFileWords('not-installed', 'upload the MP4 instead') } }
  const a = await serverOrStudio(false, refused, studioOk)
  check('YouTube refused the server: the file comes from YouTube Studio, and says so', a.ok && a.via === 'studio' && a.url.endsWith('ingest-studio-1.mp4') && asked === 1, a)
  asked = 0
  const b = await serverOrStudio(false, refused, studioNo)
  check('neither worked: both reasons, the server’s "upload instead" said once, never as success',
    !b.ok && b.error === "We couldn't fetch this video automatically: YouTube is refusing MVP\u2019s downloader right now (it asks it to sign in). SCOUT tried YouTube Studio too: SCOUT is not installed in this browser. With it, MVP brings your own videos in from YouTube Studio. Or upload the MP4 instead." && asked === 1, b)
  asked = 0
  const c = await serverOrStudio(true, { videoUrl: 'https://storage.example/server.mp4' }, studioOk)
  check('the server had it: SCOUT is not asked', c.ok && c.via === 'server' && c.url === 'https://storage.example/server.mp4' && asked === 0, c)
  const d = await serverOrStudio(false, { error: 'Clip Factory is a Pro feature.', limitReached: true }, studioOk)
  check('a plan limit stops there, as a limit, without asking SCOUT', !d.ok && d.limit === true && asked === 0, d)
  const e = await serverOrStudio(false, { error: 'Clip Factory works on videos up to 10 minutes long. Pick a shorter video, or trim this one first.' }, studioOk)
  check('a reason Studio cannot help with (over ten minutes) is said as it is, without asking SCOUT', !e.ok && /up to 10 minutes/.test(e.error) && asked === 0, e)
  const f = await serverOrStudio(false, { error: 'Automatic video fetch is not configured.', ingestDisabled: true }, studioOk)
  check('automatic fetch switched off: SCOUT brings it from Studio', f.ok && f.via === 'studio' && asked === 1, f)
  asked = 0
  const g = await serverOrStudio(false, { error: 'Automatic video fetch is not configured.', ingestDisabled: true }, studioNo)
  check('switched off and no SCOUT: says fetch is off, then SCOUT’s reason', !g.ok && /^Automatic fetch is not available right now\. SCOUT tried YouTube Studio too: SCOUT is not installed/.test(g.error), g)
  const h = await serverOrStudio(false, refused, async () => ({ ok: true as const, url: null }))
  check('SCOUT sent it but nothing attached is a failure, not a video', !h.ok && /SCOUT tried YouTube Studio too: the file did not attach\./.test(h.error), h)

  // ── Where it is used ───────────────────────────────────────────────────────
  const CF = read('components/clip-factory/ClipFactory.tsx')
  const load = CF.slice(CF.indexOf('const loadShortById = useCallback'), CF.indexOf('const pickShort = useCallback'))
  check('Tap to fetch asks MVP’s server first, then goes through the decision above with SCOUT for a Short',
    load.indexOf("fetch('/api/youtube/shorts/ingest'") > 0 && load.indexOf("fetch('/api/youtube/shorts/ingest'") < load.indexOf('serverOrStudio(')
    && /await serverOrStudio\(res\.ok && !!data\.videoUrl, data, async \(\) => \{\s*setFetchVia\('studio'\)\s*return fileFromStudio\(id, 'short', 'upload the MP4 instead'\)/.test(load))
  check('a Short brought in from Studio says so; a failure shows the decision’s words', /if \(got\.via === 'studio'\) toast\.success\('Brought in from YouTube Studio by SCOUT\.'\)/.test(load) && /throw new Error\(got\.error\)/.test(load))
  check('the card says SCOUT is bringing it in while it does', /fetchVia === 'studio' \? 'SCOUT is bringing it in from YouTube Studio…' : 'Fetching…'/.test(CF))
  check('a plan limit still opens the upgrade prompt', /if \(got\.limit\) dispatchCapReached\(got\.error/.test(load))
  const SS = read('components/content/ShortsStudioModal.tsx')
  const fa = SS.slice(SS.indexOf('const fetchAutomatically = useCallback'), SS.indexOf('const renderClip = useCallback'))
  check('Shorts Studio goes through the same decision, for the long video’s source', /await serverOrStudio\(res\.ok, data, async \(\) => \{/.test(fa) && /return fileFromStudio\(videoId, 'source', 'upload the MP4 instead'\)/.test(fa)
    && /toast\.success\(got\.via === 'studio' \? 'Brought in from YouTube Studio by SCOUT\.' : 'Video ready'\)/.test(fa) && /await findShorts\(\)/.test(fa))
  const fs = SS.slice(SS.indexOf('const findShorts = useCallback'), SS.indexOf('const fetchAutomatically = useCallback'))
  check('Shorts Studio’s find step is untouched by it', !/serverOrStudio|fileFromStudio/.test(fs) && /\/api\/youtube\/shorts\/plan/.test(fs))
  const SP = read('components/vertical/ShortsCreatePanel.tsx')
  check('the find moments panel uses the same helper, with its own box in the words', /await fileFromStudio\(videoId, 'source', 'drop the file in the box'\)/.test(SP) && !/requestStudioVideoFile/.test(SP))

  // ── The route: a Short's file is kept where the Shorts cards read it ──────
  const RT = read('app/api/youtube/shorts/studio-file/route.ts')
  check('a Short’s file is named like the server’s own fetches, not as a clip source',
    /\$\{body\.target === 'short' \? 'ingest-studio' : 'source'\}-\$\{crypto\.randomUUID\(\)\}\.mp4/.test(RT))
  const sweep = read('app/api/cron/purge-shorts-sources/route.ts').match(/if \(!(\/\^\([^)]*\)-\/)\.test\(f\.name\)\) return false/)
  const sweepRe = sweep ? new RegExp(sweep[1].slice(1, -1)) : null
  check('the daily clean up of clip sources leaves a Short’s Studio file alone', !!sweepRe && sweepRe.test('source-1.mp4') && !sweepRe.test('ingest-studio-1.mp4'), sweep?.[1])
  check('a Short’s file is attached where the Shorts cards read it, a long video’s as its source',
    /\.update\(asShort \? \{ instagram_video_url: pub\.publicUrl \} : \{ source_video_url: pub\.publicUrl/.test(RT)
    && /new RegExp\(`\^\$\{o\.user\.id\}\/\$\{asShort \? 'ingest-studio' : 'source'\}-\[0-9a-f-\]\{36\}/.test(RT)
    && /instagram_video_url/.test(read('app/api/instagram/burn/source/route.ts')))

  if (fails.length) { console.error(`❌ studio-file-fallback: ${fails.length} failure(s)\n${fails.map((f) => `   • ${f}`).join('\n')}`); process.exit(1) }
  console.log('✅ studio-file-fallback: when YouTube refuses MVP’s downloader, the Shorts cards and Shorts Studio bring the creator’s own video in from YouTube Studio through SCOUT, and say which way it came')
})()

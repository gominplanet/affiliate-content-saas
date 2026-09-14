// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Publishing to YouTube from the Launchpad 500'd, and then the run was stuck.
//
// What the creator saw, pasted verbatim:
//
//   1. 500: Internal Server Error body{color:#000;background:#fff;margin:0}
//   .next-error-h1{border-right:1px solid rgba(0,0,0,.3)}...
//
// That is a Next.js error PAGE with its tags stripped, which tells you two
// things at once. The route did not produce it: /api/youtube/upload-video wraps
// its whole handler in a try/catch that guarantees JSON on any throw. So the
// function itself was killed by the platform, above the handler, where no
// application catch can reach.
//
// It was killed for holding the video in memory four times over:
//
//   res.arrayBuffer()                            one copy, unavoidable
//   Buffer.from(ab)                              free, it wraps
//   new Uint8Array(buf)                          A SECOND, and pointless: a Node
//                                                Buffer already IS a Uint8Array
//   videoBytes.buffer.slice(...) in uploadShort  A THIRD, made only to satisfy
//                                                TypeScript's BodyInit
//   undici serialising the PUT                   a fourth
//
// A 250MB upload therefore wanted a gigabyte on a function that did not have
// one. Two of those copies were free to delete, which halves the peak, and the
// publish cap came down to a size the default allowance can actually survive.
//
// The second half is worse than the crash. Amazon never needed YouTube, but the
// Amazon step is gated on the YouTube step being resolved, and the only way to
// resolve it was a small grey underline in the card header. Somebody staring at
// a wall of stripped CSS does not go looking up there. The run was over.
import { readFileSync, existsSync } from 'node:fs'

const failures: string[] = []
const check = (name: string, cond: boolean, detail?: string) => {
  if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`)
}

const ROUTE = readFileSync('app/api/youtube/upload-video/route.ts', 'utf8')
const SERVICE = readFileSync('services/youtube/index.ts', 'utf8')
const PAGE = readFileSync('app/(dashboard)/launchpad/page.tsx', 'utf8')
const VERCEL = JSON.parse(readFileSync('vercel.json', 'utf8'))
const strip = (src: string) => src.split('\n').filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n')

// ── the video is not copied for no reason ───────────────────────────────────
{
  const code = strip(ROUTE)
  check('the route does not re-copy the buffer into a Uint8Array',
    !/new Uint8Array\(buf\)/.test(code),
    'a Node Buffer is already a Uint8Array; that line cost a whole video of memory')
  check('and hands the buffer straight on', /bytes = buf/.test(code))

  const svc = strip(SERVICE)
  check('the upload service does not slice the whole video',
    !/videoBytes\.buffer\.slice\(/.test(svc),
    'ArrayBuffer.slice copies; fetch takes the view as it is')
  check('it passes the view itself', /const body = videoBytes as unknown as BodyInit/.test(svc),
    'a cast changes a type, a slice changes a hundred megabytes')
}

// ── the publish cap matches what the function can actually survive ──────────
//
// The first attempt at this raised the function's memory with a `functions`
// block in vercel.json so the full 500MB stayed reachable. That failed the
// deployment twice in a row, on the two commits that carried it and on nothing
// before them, so the config is gone and the cap came down to a size the default
// allowance handles. A working deploy is worth more than a file size almost
// nobody reaches, and the copy removal above is what actually fixed the crash.
{
  check('vercel.json carries no functions block', !VERCEL.functions,
    'adding one failed the deployment; if it is reinstated, verify a green PRODUCTION build before trusting it')
  check('the crons are intact', Array.isArray(VERCEL.crons) && VERCEL.crons.length > 20,
    `${VERCEL.crons?.length} crons`)
  check('the cap is one the function can survive',
    /const MAX_BYTES = 300 \* 1024 \* 1024/.test(ROUTE),
    'peak memory is about twice the file; 500MB on the default allowance is what was being OOM-killed')
  check('and the refusal points at the step that still works',
    /Amazon storefronts are not affected/.test(ROUTE),
    'a size limit on YouTube must not read as the whole run being over')
}

// ── the size limit is checked before the download, and says the size ────────
{
  const code = strip(ROUTE)
  const headerAt = code.indexOf("res.headers.get('content-length')")
  const bodyAt = code.indexOf('await res.arrayBuffer()')
  check('the size is checked on the header first',
    headerAt > -1 && bodyAt > -1 && headerAt < bodyAt,
    'downloading half a gigabyte to discover it is half a gigabyte is the thing the check guards against')
  check('the refusal names the actual size', /function sizeError/.test(ROUTE) && /\$\{mb\}MB/.test(ROUTE),
    '"over 500MB" leaves them guessing whether they missed by one megabyte or four hundred')
}

// ── a crash reads as English, not as a stylesheet ───────────────────────────
{
  check('the page translates a platform crash', /function humanPublishError/.test(PAGE))
  check('and recognises the Next.js error page by its own markup',
    /prefers-color-scheme/.test(PAGE) && /Internal Server Error/.test(PAGE),
    'that stylesheet IS what reached the creator, so it is what has to be matched')
  check('the translation tells them their video is safe',
    /video is safe/i.test(PAGE),
    'after a 500 the first question is whether the upload was lost')
}

// ── a failed publish leaves a way forward ───────────────────────────────────
{
  check('the failure is held on screen, not only in a toast',
    /const \[publishError, setPublishError\]/.test(PAGE),
    'a toast disappears while they are still deciding what to do')
  check('and the failure offers the Amazon step',
    /Skip YouTube, continue to Amazon/.test(PAGE),
    'the only escape was a grey underline in the card header')
  check('the escape actually resolves the YouTube step',
    /publishError && !publishedUrl[\s\S]{0,900}setYtOpen\('skipped'\)/.test(PAGE),
    'Amazon is gated on that step being resolved; a button that does not resolve it changes nothing')
  check('a retry is offered beside it', /Try YouTube again/.test(PAGE))
  check('a new attempt clears the last failure', /setPublishing\(true\); setPublishError\(null\)/.test(PAGE))
}

// ── YouTube gets the CTA cut, Amazon gets the clean one ─────────────────────
{
  check('YouTube publishes the render with the CTA burned in',
    /videoUrl: renderedUrl, title: chosenTitle/.test(PAGE))
  check('Amazon gets the clean upload', /videoUrl: cleanUrl,/.test(PAGE))
  check('and there is NO fallback to the CTA cut',
    !/videoUrl: cleanUrl \|\| renderedUrl/.test(PAGE),
    'a burned-in call to action pointing off Amazon is what gets a storefront video rejected')
  check('a missing clean cut refuses instead of substituting',
    /clean cut of this video is missing/.test(PAGE),
    'they would have heard about it from Amazon rather than from us')
}

// ── a creator who already has a thumbnail can use it ────────────────────────
{
  check('there is an upload control', /Upload my own thumbnail/.test(PAGE))
  check('it accepts only images', /accept="image\/jpeg,image\/png,image\/webp"/.test(PAGE))
  check('it refuses over YouTube\'s own 2MB thumbnail limit',
    /const MAX = 2 \* 1024 \* 1024/.test(PAGE),
    'otherwise it fails as an opaque API error on a video that is already published')
  check('and the refusal names the size they gave', /and this one is \$\{/.test(PAGE))
  check('an uploaded thumbnail feeds the same state the generated one does',
    /setThumbUrl\(urlData\.publicUrl\)/.test(PAGE),
    'that is what /api/youtube/apply and the Amazon master both already read')
  check('it clears the skip flag', /setThumbSkipped\(false\)/.test(PAGE),
    'having uploaded one, they have not skipped this step')
}

// ── the Launchpad pays for ONE image, not two ───────────────────────────────
//
// Every Launchpad run used to render a second, wordless thumbnail for
// non-English storefronts, at full image price. It could never be used. The
// storefront step filters its markets through isEnglishMarket, so US, CA, UK and
// AU are the only destinations a Launchpad master has, and all four take the
// thumbnail with the headline on it. Storefront Sync, where localizing is
// actually the job, still builds the wordless variant and builds it lazily, the
// first time a non-English market is chosen.
{
  const MASTER = strip(readFileSync('app/api/launchpad/master/route.ts', 'utf8'))
  const page = strip(PAGE)
  check('the Launchpad no longer renders a text-free twin',
    !/clean-thumbnail/.test(page) && !/thumbCleanUrl/.test(page),
    'one image per run, and it is the one the creator approved')
  check('the standalone route is gone', !existsSync('app/api/launchpad/clean-thumbnail/route.ts'),
    'an endpoint nothing calls is an endpoint that bills when something does')
  check('and the master does not render one behind their back',
    !/withText: false/.test(MASTER),
    'removing it from the page only to pay for it in the background saves nothing')
  check('the master still renders the ONE thumbnail when YouTube was skipped',
    /seedThumb \? Promise\.resolve\(null\) : buildProductThumbnail/.test(MASTER),
    'skipping YouTube must not mean skipping the storefront image')
  check('Storefront Sync still builds the wordless one on demand',
    /withText: false/.test(readFileSync('app/api/global-sync/start/route.ts', 'utf8')),
    'the non-English markets are that page\'s job and still need it')
}

// ── it has to be possible to tell what is actually live ────────────────────
//
// Both Vercel lanes report to GitHub under one status context and GitHub keeps
// only the latest, so a red mark on a commit could be production or the branch
// preview. Reading that wrong cost three bad calls in a day, including two extra
// builds spent chasing a config error that the first failure had already shown.
// /api/version answers it in one request.
{
  const V = readFileSync('app/api/version/route.ts', 'utf8')
  const MW = readFileSync('middleware.ts', 'utf8')
  check('the version route reports the commit', /VERCEL_GIT_COMMIT_SHA/.test(V))
  check('and which lane is serving', /VERCEL_ENV/.test(V),
    'production and preview are indistinguishable from outside without it')
  check('it is reachable without a session', /'\/api\/version'/.test(MW),
    'a check that needs a login is not a check you can run')
  check('it is never cached', /no-store/.test(V),
    'a stale answer is worse than none when the question is what is serving right now')
  check('it does not leak the branch name', !/VERCEL_GIT_COMMIT_REF/.test(V),
    'env already separates production from preview; the branch adds nothing and is internal')
}

if (failures.length) {
  console.error(`\n❌ launchpad-publish: ${failures.length} failure(s)\n`)
  for (const f of failures) console.error(`   • ${f}`)
  process.exit(1)
}
console.log('✅ launchpad-publish: the video is copied once, one thumbnail is paid for, a crash reads as English, a failure still reaches Amazon, and the clean cut is the only thing Amazon gets')

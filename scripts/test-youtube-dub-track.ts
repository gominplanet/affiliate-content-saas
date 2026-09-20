// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// A FILE NEVER CLAIMS A LANGUAGE IT DOES NOT CARRY.
//
// The ingest service can fetch one specific audio track from a YouTube video,
// and the admin page uses it to answer whether YouTube serves dubs at all. The
// DUB LANE no longer reaches for it: pulling a track turned out to be a full
// video download per market, so every market is dubbed by MVP now. The block
// halfway down pins that reversal and says why, because it is the sort of
// shortcut that looks free and gets re-added.
//
// What survives unchanged is the honesty rule, and it is the reason this file
// exists. If a French track does not exist and the download quietly returns the
// original, the file is present, plays fine, and is still in English. That
// reads as success from every angle: same URL, same state, same delivered_at,
// and nobody finds out until a French shopper presses play. So the language is
// REPORTED from what was obtained, never echoed from what was asked for.
import { readFileSync } from 'node:fs'
import { extractYouTubeVideoId as ytId } from '../lib/youtube-url'

const failures: string[] = []
const check = (name: string, cond: boolean, detail?: string) => {
  if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`)
}
const read = (p: string) => readFileSync(p, 'utf8')
const live = (s: string) => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter((l) => !/^\s*(?:\/\/|\*)/.test(l)).join('\n')

const SERVICE = live(read('ingest-service/server.js'))
const CLIENT = live(read('lib/youtube-ingest.ts'))
// THE LANE, not the route. This all lived inside /api/global-sync/dub until the
// background catalogue drain needed to dub without a session. It moved to a
// library both callers share rather than being copied into the cron, because a
// second copy is exactly where a rule quietly stops applying in one of them.
const DUB = live(read('lib/dub-target.ts'))
const DUB_ROUTE = live(read('app/api/global-sync/dub/route.ts'))

// ── the downloader can ask for a language, and the ask is real ──────────────
{
  check('the ingest service accepts an audio language',
    /req\.body\?\.audioLanguage/.test(SERVICE))
  check('and selects that track by language',
    /ba\[language\^=\$\{esc\}\]/.test(SERVICE),
    'prefix match, so fr finds fr-FR and fr-CA')

  // NO bare `ba` alternative inside the language selector. yt-dlp would take it
  // happily and hand back the original audio, and the whole point is to know.
  const langSelector = SERVICE.match(/`bv\*\[height<=1080\]\+ba\[language[^`]*`/)?.[0] ?? ''
  check('the language selector was found', langSelector.length > 10, langSelector)
  // EVERY `ba` in the selector must carry the filter, not just the first. The
  // first version of this clause looked for "/ba" and so missed
  // `…+ba[language^=x]/bv*+ba`, where the alternative is spelled `+ba`. yt-dlp
  // would take that branch happily, return the original audio, and the download
  // would report success.
  // Checked per ALTERNATIVE, since "/" is what yt-dlp falls through on. Two
  // earlier versions of this clause each missed a different unfiltered spelling:
  // `+ba` (looking only for "/ba"), then `/b`, which is yt-dlp's best-combined
  // format and carries the original audio while containing no "ba" at all.
  // Whatever the spelling, an alternative with no [language= is a silent success.
  const alternatives = langSelector.replace(/^`|`$/g, '').split('/').filter(Boolean)
  check('the language selector was parsed', alternatives.length > 0, langSelector)
  check('every alternative in the language selector is language-filtered',
    alternatives.every((a) => a.includes('[language')),
    `${alternatives.join(' | ')} — an unfiltered alternative returns the original audio and reports success`)

  check('the language is sanitised before it reaches the shell',
    /replace\(\/\[\^a-z-\]\/g, ''\)/.test(SERVICE),
    'it goes into a yt-dlp format string')
}

// ── what came back is reported, not what was asked for ──────────────────────
{
  check('the service returns the language it actually got',
    /return res\.json\(\{ url: publicUrl\(key\), durationSeconds, audioLanguage, audioLanguageNote \}\)/.test(SERVICE))
  check('and only sets it after the language download produced a file',
    /if \(fs\.existsSync\(tmp\)\) audioLanguage = wantLang/.test(SERVICE),
    'setting it from the request is the bug: an English file labelled French')
  check('a missing track falls back to the original rather than failing',
    /if \(!fs\.existsSync\(tmp\)\) \{[\s\S]{0,200}bv\*\[height<=1080\]\+ba\/b/.test(SERVICE),
    'the caller can still dub it the paid way; a hard failure would block the market entirely')
  check('and the fallback is explained',
    /audioLanguageNote = `no \$\{wantLang\} audio track on this video`/.test(SERVICE))

  check('the client reads the language off the RESPONSE',
    /typeof data\.audioLanguage === 'string' \? data\.audioLanguage : null/.test(CLIENT),
    'echoing the request would make every call claim success')
  check('and an older service with no such field reads as original audio',
    /const got = typeof data\.audioLanguage/.test(CLIENT))
}

// ── THE DUB LANE DOES NOT PULL FROM YOUTUBE, AND THAT IS DELIBERATE ────────
//
// The clauses that used to live here pinned the opposite decision: check for a
// YouTube track first and use it, because it was already translated, already in
// sync and free. Two of those three were true. The third was not.
//
// Pulling a track is a FULL VIDEO DOWNLOAD, PER MARKET. ingestYouTubeVideo with
// an audioLanguage fetches the whole video at up to 1080p through the
// residential proxy and re-uploads it, with a 280 second ceiling inside a 300
// second function, and the result is stored on one market's target. Five
// European storefronts meant five downloads of the same video, each able to run
// the function out of time, each through the bot wall that is the least
// reliable thing this product depends on. Our own lane downloads the master
// ONCE, caches it on the video, and every market after that is a Claude
// translation, a TTS call and a mux on a file we already host.
//
// It also produced two voices on one creator's storefronts, ours in the markets
// YouTube had not auto-dubbed and YouTube's generic one in the markets it had.
//
// THE CAPABILITY IS NOT DELETED. The ingest service can still fetch a specific
// language and the admin page still answers whether YouTube serves dubs for a
// video, and the clauses above and below still hold them honest. What is gone
// is the dub lane reaching for it automatically, and these clauses exist so
// that putting it back is a decision somebody makes on purpose after reading
// why it was taken out.
{
  check('the dub lane never asks for a specific audio language',
    !/audioLanguage/.test(DUB),
    'that parameter is what turns one dub into a full video download for that market')
  check('and it dubs every non-English market the same way',
    DUB.indexOf('await translateScript(') > -1
    && DUB.indexOf('synthesizeSpeech(') > DUB.indexOf('await translateScript('),
    'two lanes meant YouTube’s voice in France and ours in Italy on the same storefronts')
  check('the master is pulled at most once and cached on the video',
    /source_video_url: sourceUrl/.test(DUB),
    'without the cache every market re-downloads the same master and the saving is gone')

  // The cloned voice is a paid product that sounds like the creator, and it
  // stays the only thing a credit is ever spent on.
  check('the cloned voice is still the only paid lane',
    /const wantClone = !requestedStandard && !!clonedVoiceId && elevenConfigured\(\)/.test(DUB)
    && /if \(usedClone\)/.test(DUB),
    'a credit spent on anything else is a charge the creator did not agree to')
  check('and a credit is spent only when that voice actually ran',
    /const usedClone = speech\.engine === 'elevenlabs' && !!useVoiceId/.test(DUB),
    'spending on intent rather than outcome bills for a dub that fell back to the free voice')
  check('the response never claims a YouTube dub any more',
    !/'youtube_dub'/.test(DUB) && !/voice: 'youtube'/.test(DUB),
    'a lane that cannot run must not have a result shape that says it did')
}

// ── "no tracks" and "we could not tell" are different answers ───────────────
{
  // Scoped to the listing FUNCTION. Read against the whole file, `if (!res.ok)
  // return null` is also satisfied by ingestYouTubeVideo's copy of the same
  // line, so the clause passed with the listing changed to return an empty list.
  const listFn = CLIENT.slice(CLIENT.indexOf('export async function listYouTubeAudioTracksDetailed'))
  check('the listing function was found', listFn.includes('/audio-tracks'), `${listFn.length} chars`)
  check('a failed listing yields no info, never an empty list',
    /if \(!d\?\.ok \|\| !Array\.isArray\(d\.languages\)\) return \{ info: null/.test(listFn)
    && !/return \{ info: \{ languages: \[\]/.test(listFn),
    'an empty list would read as "no dub exists" and send the creator to the paid lane on a video that has one')
  check('and the thin wrapper passes that null straight through',
    /return \(await listYouTubeAudioTracksDetailed\(youtubeVideoId\)\)\.info/.test(CLIENT),
    'the dub route only needs yes or no; the reasons are for the screen')
  check('hasAudioTrack treats null as false rather than throwing',
    /if \(!info \|\| !lang\) return false/.test(CLIENT))
  check('and matches on a prefix',
    /l\.toLowerCase\(\)\.startsWith\(want\)/.test(CLIENT),
    "the market's lang is fr-FR and the track may be tagged fr")

  check('the listing endpoint downloads nothing',
    /app\.post\('\/audio-tracks'[\s\S]{0,700}ytDlp\(\['-J'/.test(SERVICE),
    '-J is metadata only; this runs before the creator has decided to spend')
  check('and it reads language off audio-only formats',
    /if \(f\.vcodec && f\.vcodec !== 'none'\) continue/.test(SERVICE),
    'a muxed format reports the original language and would make every video look multi-track')
  check('the listing endpoint is behind the shared secret',
    /app\.post\('\/audio-tracks'[\s\S]{0,200}x-ingest-secret/.test(SERVICE))
}

// ── the screen that answers the question has THREE answers ──────────────────
//
// Whether YouTube serves its dubs decides whether Storefront Sync keeps paying
// to synthesize them, and the only way to ask used to be a yt-dlp command on
// the ingest box. So it is a page.
//
// "This video has no dubs" and "we could not check" both look like zero
// languages and mean opposite things: one says synthesize, the other says the
// downloader's cookies expired and the question is still open. Collapsing them
// is how a lookup failure becomes a false finding about the video.
{
  const API = live(read('app/api/admin/audio-tracks/route.ts'))
  const PAGE = read('app/(dashboard)/admin/audio-tracks/page.tsx')

  check('the checker is admin only',
    /caller\?\.tier !== 'admin'/.test(API))
  check('an unconfigured service is its own answer',
    /reason: 'not-configured'/.test(API)
    && /This is not a finding about the video/.test(API),
    'reporting it as "no tracks" says something false about the video')

  // A REMEDY PER CAUSE, not one sentence for every failure.
  //
  // The first version said "usually the cookies need refreshing" whatever went
  // wrong. The very first real run was a 404, because the ingest service
  // deploys separately from the app and had not been rebuilt, so the page sent
  // its operator to fix cookies that were fine. Collapsing distinct causes into
  // the likeliest one is the same bug this page exists to prevent, one layer up.
  const CAUSES = ['not-configured', 'service-down', 'stale-service', 'unauthorized', 'blocked'] as const
  for (const c of CAUSES) {
    check(`${c} is a named cause`, new RegExp(`'${c}':`).test(API) || new RegExp(`reason: '${c}'`).test(API))
  }
  check('a stale service is told to redeploy, not to fix cookies',
    /redeploy ingest-service/.test(API)
    && /deploys separately from the app/.test(API),
    'a Vercel deploy does not rebuild it, which is not guessable from the failure')
  check('and only the genuine block mentions cookies',
    (API.match(/cookies/g) ?? []).length === 1,
    'the cookie remedy belongs to one cause; on any other it is a wrong instruction')

  const LIB = live(read('lib/youtube-ingest.ts'))
  check('the 404 case is confirmed against health, not assumed',
    /\$\{base\}\/health/.test(LIB),
    '"old build" and "wrong URL" both 404, and they have different fixes')
  check('the detailed lookup separates the causes',
    /export type AudioTrackFailure/.test(LIB)
    && /'stale-service' : 'service-down'/.test(LIB),
    'one null for every cause is what produced the wrong remedy')
  check('and the two are distinguishable from a real empty result',
    /ok: true[\s\S]{0,600}multiTrack/.test(API),
    'ok:true is what separates "we looked" from "we could not"')

  check('the verdict is a sentence, not a list of language codes',
    /verdict: info\.multiTrack/.test(API),
    'the reader should not have to work out the conclusion from bcp-47 tags')
  check('and it names the Amazon markets that become free',
    /freeMarkets/.test(API) && /needsTranslation/.test(API),
    'the markets are the point; the language codes are the evidence')

  // The shared, unit-tested extractor, not a second copy. The first version of
  // this route carried its own regex, which also broke the build: a Next.js
  // route file may only export route handlers, so the helper could not live
  // there anyway. The Studio form was the one shape the shared one lacked.
  check('the checker uses the shared id extractor',
    /extractYouTubeVideoId\(request\.nextUrl\.searchParams/.test(API),
    'a second parser is a second thing to get wrong')

  // BEHAVIOUR, not the regex source. The first version of this clause matched
  // the literal pattern text and broke the moment the patterns were rewritten,
  // which said nothing about whether they still worked.
  check('the shared extractor understands a Studio URL',
    ytId('https://studio.youtube.com/video/ah7ITX7BkM4/translations') === 'ah7ITX7BkM4',
    'that is the URL in the address bar when somebody is looking at the dubs')
  check('and still understands the ordinary shapes',
    ytId('https://www.youtube.com/watch?v=ah7ITX7BkM4&t=30s') === 'ah7ITX7BkM4'
    && ytId('https://youtu.be/ah7ITX7BkM4?si=x') === 'ah7ITX7BkM4'
    && ytId('ah7ITX7BkM4') === 'ah7ITX7BkM4')
  // An id is exactly 11 characters, so a longer run is a different string.
  // Without a boundary these patterns returned the first 11 characters of any
  // slug, and /video/ is a path plenty of non-YouTube sites use, so a wrong
  // paste would have produced a confident wrong id instead of a refusal.
  check('a longer slug is not mistaken for an id',
    ytId('https://example.com/video/notelevenchars') === null
    && ytId('https://example.com/shorts/notelevenchars') === null
    && ytId('https://example.com/video/a-much-longer-slug-than-eleven') === null,
    'the 11-character match must end on a boundary')
  check('the route exports nothing but its handler',
    !/^export (?:function|const) (?!async function GET)/m.test(API),
    'Next.js rejects any other export from a route file, and the build says so')

  check('the page says out loud when nothing was learned',
    /This is not a result about the video/.test(PAGE),
    'an amber box alone leaves the reader to guess whether the video has dubs')
  check('and states that nothing is spent',
    /Nothing is downloaded and nothing is spent/.test(PAGE))

  const copy = PAGE.match(/subtitle="([^"]*)"/)?.[1] ?? ''
  check('the subtitle was found', copy.length > 30, `${copy.length} chars`)
  check('no dash punctuation on the page copy',
    !/[—–]/.test(copy) && !/\S \- \S/.test(copy), copy.slice(0, 120))

  // ── AND IT HAS TO BE FINDABLE ─────────────────────────────────────────────
  //
  // This page shipped with no way in. It existed, it worked, and the only route
  // to it was typing the URL, so the first thing that happened was "I cannot see
  // audio tracks in admin". A tool nobody can reach is not a tool.
  //
  // Swept over EVERY admin page rather than pinned to this one, because the
  // mistake is not specific to it: the next admin page will be added the same
  // way. The sweep is clean today, so it starts honest.
  const { readdirSync, existsSync } = require('node:fs') as typeof import('node:fs')
  const NAV = read('components/layout/DashboardShellV2.tsx')
  const SEARCH = read('lib/app-search-index.ts')
  // ── THE COOKIE ENCODER NEVER SENDS THE COOKIES ANYWHERE ───────────────────
  //
  // A YouTube cookies.txt is a logged-in session: whoever holds it holds the
  // channel. The page exists because the obvious way to base64 a file without a
  // terminal is to paste it into some website, which is handing the account
  // over. Its whole value is that the work happens in the tab.
  //
  // So the absence of a server is the feature, and absences rot silently. An
  // API route added later "just to log usage" would quietly turn a safe page
  // into an exfiltration path, and nothing about the screen would change.
  const COOKIES_PAGE = read('app/(dashboard)/admin/youtube-cookies/page.tsx')
  check('the cookie encoder has no API route behind it',
    !existsSync('app/api/admin/youtube-cookies'),
    'the file is a live session for that YouTube account; it must not leave the browser')
  check('and the page makes no outbound call',
    !/\bfetch\s*\(|axios\.|XMLHttpRequest|navigator\.sendBeacon/.test(COOKIES_PAGE),
    'reading the file is local; anything that posts it defeats the point of the page')
  check('the page says the file is not uploaded',
    /not uploaded,\s+not sent to MVP, and there is no server behind this screen/.test(COOKIES_PAGE),
    'a reader has to be able to tell this apart from the websites they should not use')
  check('and warns what the file actually is',
    /logged-in session for that YouTube account/.test(COOKIES_PAGE))
  check('it chunks under the variable cap',
    /const CHUNK = 30000/.test(COOKIES_PAGE) && /YOUTUBE_COOKIES_B64_\$\{i \+ 1\}/.test(COOKIES_PAGE),
    'Railway caps a variable at 32768 and the service joins _2, _3 in order')

  const orphans = readdirSync('app/(dashboard)/admin', { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((name) => !NAV.includes(`/admin/${name}'`) && !SEARCH.includes(`/admin/${name}'`))
  check('every admin page is reachable from the sidebar or search',
    orphans.length === 0,
    `${orphans.map((o) => `/admin/${o}`).join(', ')} — built, working, and unreachable without typing the URL`)
}

if (failures.length) {
  console.error(`\n❌ youtube-dub-track: ${failures.length} failure(s)\n`)
  for (const f of failures) console.error(`   • ${f}`)
  process.exit(1)
}
console.log("✅ youtube-dub-track: MVP dubs every market itself, and no file ever claims a language it does not carry")

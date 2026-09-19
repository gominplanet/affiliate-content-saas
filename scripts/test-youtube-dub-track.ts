// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// WHEN YOUTUBE HAS ALREADY DUBBED THE VIDEO, USE THAT, AND SAY SO.
//
// YouTube auto-dubs a lot of videos, and a creator can upload their own
// multi-audio tracks. A track that exists is already translated, already timed
// to the picture, and already paid for. Global Storefront Sync was transcribing,
// translating, synthesizing and muxing its own instead, because the downloader
// asked for `ba` with no language filter and so always got the original.
//
// THE DANGER IS NOT THE FEATURE, IT IS THE FALLBACK. If a French track does not
// exist and the download quietly returns the original, the market page gets a
// file that is present, plays fine, and is still in English. That reads as
// success everywhere: the URL looks the same, the state says localized, and
// nobody finds out until a French shopper does. So what is pinned hardest here
// is that the language is REPORTED from what was obtained, never echoed from
// what was asked for.
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
const DUB = live(read('app/api/global-sync/dub/route.ts'))

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

// ── the dub route prefers the free track, on the right lane ─────────────────
{
  check('the dub route checks for a track before spending anything',
    DUB.indexOf('listYouTubeAudioTracks(') > -1
    && DUB.indexOf('listYouTubeAudioTracks(') < DUB.indexOf('translateScript('),
    'after the translate it has already paid for the thing it was trying to avoid')
  check('and before the transcript requirement',
    DUB.indexOf('listYouTubeAudioTracks(') < DUB.indexOf('No transcript to dub yet'),
    "a YouTube dub needs no transcript, so a video without one should still localize")

  check('it only accepts the pull when a language actually came back',
    /if \(pulled\?\.url && pulled\.audioLanguage\)/.test(DUB),
    'url alone is satisfied by the original-audio fallback')

  // The cloned voice is a paid product that sounds like the creator. Swapping
  // in YouTube's generic voice would be a downgrade nobody asked for.
  check('the cloned-voice lane is not silently replaced',
    /!cloneIsOnTheTable/.test(DUB))
  check('but the gate is "not getting a clone", not "asked for standard"',
    /const cloneIsOnTheTable = !requestedStandard && !!clonedForLane && elevenConfigured\(\)/.test(DUB),
    'gating on the explicit flag alone means the lane almost never runs, since most callers send no voice')

  check('the response says the dub came from YouTube',
    /note: 'youtube_dub'/.test(DUB) && /voice: 'youtube'/.test(DUB),
    'a dub the creator did not pay for must not be reported as one they did')
  check('and no cloned-voice credit is spent on it',
    /note: 'youtube_dub'[\s\S]{0,120}clonedDubsRemaining: null/.test(DUB))
}

// ── "no tracks" and "we could not tell" are different answers ───────────────
{
  // Scoped to the listing FUNCTION. Read against the whole file, `if (!res.ok)
  // return null` is also satisfied by ingestYouTubeVideo's copy of the same
  // line, so the clause passed with the listing changed to return an empty list.
  const listFn = CLIENT.slice(CLIENT.indexOf('export async function listYouTubeAudioTracks'))
    .split('export async function')[1] ?? ''
  check('the listing function was found', listFn.includes('/audio-tracks'), `${listFn.length} chars`)
  check('a failed listing returns null, not an empty list',
    /if \(!res\.ok\) return null/.test(listFn)
    && /if \(!d\?\.ok \|\| !Array\.isArray\(d\.languages\)\) return null/.test(listFn),
    'an empty list would read as "no dub exists" and send the creator to the paid lane on a video that has one')
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
    /reason: 'not_configured'/.test(API)
    && /This is not a finding about the video/.test(API),
    'reporting it as "no tracks" says something false about the video')
  check('a failed lookup is its own answer too',
    /reason: 'lookup_failed'/.test(API)
    && /not a video without dubs/.test(API))
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
  const { readdirSync } = require('node:fs') as typeof import('node:fs')
  const NAV = read('components/layout/DashboardShellV2.tsx')
  const SEARCH = read('lib/app-search-index.ts')
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
console.log("✅ youtube-dub-track: a free dub is used when it exists, and the file never claims a language it does not carry")

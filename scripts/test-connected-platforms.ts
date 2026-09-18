// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// THE PRESELECTION AND THE PUBLISHER HAVE TO AGREE.
//
// Every "Quick post to socials" modal opened with all platforms ticked. Gina
// has one network connected and unticked six buttons before every post; when
// she forgot, the post went out to Facebook and came back with six red "failed"
// rows for six accounts that were never connected. A creator reading that
// screen sees a broken product, not six accounts they chose not to connect.
//
// The fix ticks only what is connected, and the fix has its own failure mode,
// which is the one this file exists for: the modal now holds an OPINION about
// connectedness, and if that opinion ever drifts from the publisher's, the
// creator gets the worse of both. Say connected when the publisher will refuse
// and they are back to a red error, except now a button promised it would work.
// Say not connected when the publisher would have succeeded and a working
// channel has quietly vanished from their reach with nothing explaining why.
//
// So the predicates in lib/connected-platforms are the negation of the
// publisher's own `throw new Error('X is not connected.')` lines, and this
// guard reads BOTH files to hold them together. Adding a seventh network to the
// publisher and forgetting the predicate fails the build.
import { readFileSync } from 'node:fs'
import {
  connectedQuickPostPlatforms, preselectPlatforms,
  pinterestConnected, instagramConnected,
} from '../lib/connected-platforms'
import { QUICK_POST_PLATFORMS } from '../lib/deal-social-publish'

const failures: string[] = []
const check = (name: string, cond: boolean, detail?: string) => {
  if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`)
}

const read = (p: string) => readFileSync(p, 'utf8')
// Comments first, always. Every file here explains the bug it fixes by quoting
// it, so a raw grep finds the explanation and calls it the code.
const live = (s: string) => s
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter((l) => !/^\s*(?:\/\/|\*)/.test(l)).join('\n')

const PUBLISH = live(read('lib/deal-social-publish.ts'))
const PREDICATE = live(read('lib/connected-platforms.ts'))

// ── every platform the publisher can refuse has a predicate ─────────────────
//
// THE CLAUSE THAT MATTERS. Read off the publisher rather than typed here, so a
// new network cannot be added there and missed here.
{
  const refuses = [...PUBLISH.matchAll(/platform === '([a-z_]+)'/g)].map((m) => m[1])
  const publisherPlatforms = [...new Set(refuses)]
  check('the publisher branches were found', publisherPlatforms.length >= 6,
    publisherPlatforms.join(','))
  check('and they match the exported platform list',
    publisherPlatforms.sort().join(',') === [...QUICK_POST_PLATFORMS].sort().join(','),
    `publisher has ${publisherPlatforms.join(',')}; QUICK_POST_PLATFORMS has ${QUICK_POST_PLATFORMS.join(',')}`)

  // The predicate must be able to RETURN each one. A name appearing in a type
  // union is not a predicate; the push is.
  for (const p of QUICK_POST_PLATFORMS) {
    check(`connected-platforms can return '${p}'`,
      new RegExp(`out\\.push\\('${p}'\\)`).test(PREDICATE),
      'the publisher can refuse this platform, so the modal has to be able to say it is connected')
  }
}

// ── the predicate reads the same columns the publisher gates on ─────────────
//
// Name-by-name, because a predicate that checks a DIFFERENT column is the exact
// drift this file exists to stop, and it type-checks perfectly.
{
  const GATES: [string, string[]][] = [
    ['twitter', ['twitter_access_token']],
    ['linkedin', ['linkedin_access_token', 'linkedin_person_id']],
    ['telegram', ['telegram_bot_token', 'telegram_channel_id']],
    ['bluesky', ['bluesky_handle', 'bluesky_app_password']],
  ]
  for (const [platform, cols] of GATES) {
    for (const col of cols) {
      check(`the publisher still gates ${platform} on ${col}`,
        PUBLISH.includes(col),
        'if this moved, the predicate below is now checking the wrong thing')
      check(`and connected-platforms reads ${col}`,
        PREDICATE.includes(col))
    }
  }
  // Facebook and Threads resolve through social_accounts, so they cannot be
  // decided from an integrations row and are passed in. Pinned so nobody
  // "simplifies" them into a column read that would call a modern-flow
  // connection missing.
  for (const p of ['facebook', 'threads'] as const) {
    check(`${p} is still resolved, not column-sniffed`,
      new RegExp(`resolveSocialAccount\\(supabase, userId, '${p}'`).test(PUBLISH),
      'the publisher resolves it; the predicate must be handed that result')
    check(`and the predicate takes ${p} as a resolved input`,
      new RegExp(`resolved\\.${p}`).test(PREDICATE))
  }
}

// ── the three states stay three ─────────────────────────────────────────────
//
// A failed lookup and an empty result must not produce the same screen. That is
// the same defect as the bug being fixed: nothing worked and nothing is
// connected looked identical.
{
  const offered = ['twitter', 'facebook', 'threads']
  check('a lookup that has not landed selects everything',
    preselectPlatforms(offered, [], false).join(',') === offered.join(','),
    'a failed lookup must never quietly untick a channel that works')
  check('a lookup that found some selects exactly those',
    preselectPlatforms(offered, ['facebook'], true).join(',') === 'facebook')
  check('a lookup that found none selects nothing',
    preselectPlatforms(offered, [], true).length === 0,
    'preselecting all here is what produced six red errors on a one-network account')
  check('a connected platform the plan does not offer is not smuggled in',
    preselectPlatforms(offered, ['facebook', 'pinterest'], true).join(',') === 'facebook',
    'the plan decides what appears; the connections decide what is ticked')
}

// ── the predicates themselves ───────────────────────────────────────────────
{
  const none = connectedQuickPostPlatforms({}, { facebook: false, threads: false })
  check('an empty row is connected to nothing', none.length === 0, none.join(','))

  check('Gina: Facebook only',
    connectedQuickPostPlatforms({}, { facebook: true, threads: false }).join(',') === 'facebook')

  check('half a LinkedIn connection is not a connection',
    !connectedQuickPostPlatforms({ linkedin_access_token: 'tok' }, { facebook: false, threads: false }).includes('linkedin'),
    'the publisher throws unless BOTH the token and the person id are present')
  check('a whole one is',
    connectedQuickPostPlatforms({ linkedin_access_token: 'tok', linkedin_person_id: 'p' }, { facebook: false, threads: false }).includes('linkedin'))

  check('a blank string is not a token',
    !connectedQuickPostPlatforms({ twitter_access_token: '   ' }, { facebook: false, threads: false }).includes('twitter'),
    'an empty column reads as connected to anything checking only for null')
  check('and neither is null',
    !connectedQuickPostPlatforms({ twitter_access_token: null }, { facebook: false, threads: false }).includes('twitter'))

  // Telegram is the one platform whose token can come from the environment, so
  // a channel with no personal bot is still connected when the platform bot
  // exists. Getting this backwards would untick a working channel.
  check('Telegram on the platform bot counts',
    connectedQuickPostPlatforms({ telegram_channel_id: '@x' }, { facebook: false, threads: false, platformTelegramBot: true }).includes('telegram'))
  check('Telegram with no bot at all does not',
    !connectedQuickPostPlatforms({ telegram_channel_id: '@x' }, { facebook: false, threads: false, platformTelegramBot: false }).includes('telegram'))
  check('and a bot with no channel does not either',
    !connectedQuickPostPlatforms({ telegram_bot_token: 't' }, { facebook: false, threads: false }).includes('telegram'),
    'the publisher needs both')

  check('Pinterest answers separately', pinterestConnected({ pinterest_access_token: 'a' }) && !pinterestConnected({}))
  check('Instagram accepts a resolved account', instagramConnected({}, true) && !instagramConnected({}, false))
}

// ── every modal uses the shared picker ──────────────────────────────────────
//
// There were three copies of this markup and three copies of
// `new Set(ALL_PLATFORMS)`, which is why one bug appeared three times. Fixing
// two of three is the realistic failure, so it is pinned.
{
  const MODALS = [
    'components/deal/QuickPostModal.tsx',
    'components/walmart/WalmartQuickPostModal.tsx',
    'components/wayward/WaywardQuickPostModal.tsx',
  ]
  for (const m of MODALS) {
    const src = live(read(m))
    check(`${m} asks which socials are connected`,
      /useConnectedPlatforms\(\)/.test(src),
      'otherwise it opens with everything ticked, which is the reported bug')
    check(`${m} preselects through the shared helper`,
      /useSelectedPlatforms\(/.test(src))
    check(`${m} does not tick every platform outright`,
      !/useState<Set<string>>\(new Set\((?:QUICK_PLATFORMS|platformOptions)/.test(src),
      'this exact line is the bug, in all three files')
    check(`${m} draws the shared picker`,
      /<PlatformPicker/.test(src),
      'three copies of the row is how two get fixed and one does not')
  }
}

// ── an unconnected platform is visible, and still clickable ─────────────────
{
  const PICKER = live(read('components/social/PlatformPicker.tsx'))
  check('an unconnected platform is labelled rather than hidden',
    /not connected/.test(PICKER),
    'a creator who cannot find Threads will ask where it went')
  check('and is not disabled',
    !/disabled=/.test(PICKER),
    'if this check is ever wrong it should cost a click, not a channel')
  check('nothing-connected says so and offers the way out',
    /None of these are connected/.test(PICKER) && /connect-socials/.test(PICKER),
    'an empty picker with no explanation is the same silence as the bug')
  check('an unfinished lookup claims nothing',
    /known \? \(/.test(PICKER) || /: known \?/.test(PICKER),
    'in flight is a third state, not a quiet "all connected"')
}

console.log(failures.length ? `FAIL (${failures.length})` : 'ALL PASS')
for (const f of failures) console.log(`  ✗ ${f}`)
process.exit(failures.length ? 1 : 0)

// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// A CHECKUP THAT CANNOT SAY "I DON'T KNOW" IS WORSE THAN NO CHECKUP.
//
// The notice this backs exists because "please reconnect your accounts" tells
// nobody anything. Its value is entirely in being accurate about each row, and
// there are exactly two ways to destroy that, in opposite directions:
//
//   round an unknown DOWN to fine   the five X accounts that post without their
//                                   image are told everything is current
//   round an unknown UP to broken   every creator with a healthy connection is
//                                   sent to redo it for nothing, and the ones
//                                   who really are broken are lost in the noise
//
// Both read as a working screen. So the three states are pinned here one by one,
// along with the summary line, which is the sentence that actually decides
// whether anybody does anything.
import {
  buildCheckup,
  checkupSummary,
  type CheckupInput,
} from '../lib/reconnect-checkup'

const failures: string[] = []
const check = (name: string, cond: boolean, detail?: string) => {
  if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`)
}

const NOTHING: CheckupInput = {
  twitterConnected: false,
  twitterScopes: null,
  geniuslinkConfigured: false,
  geniuslinkUnreadable: false,
  wordpressConfigured: false,
  wordpressNeedsAttention: false,
  deadChannels: [],
  staleTokens: [],
  hotlinkedPosts: 0,
}
const input = (over: Partial<CheckupInput>): CheckupInput => ({ ...NOTHING, ...over })
const find = (items: ReturnType<typeof buildCheckup>, key: string) => items.find(i => i.key === key)

// ── X: the case the whole notice was written for ───────────────────────────
//
// A grant is fixed at authorization and a refresh re-issues the SAME grant, so
// an account connected before MVP asked for media.write can never gain it. The
// posts keep succeeding. Only the picture is missing, and only on X.
{
  const old = find(buildCheckup(input({ twitterConnected: true, twitterScopes: 'tweet.read tweet.write users.read offline.access' })), 'x-media')
  check('a grant without media.write is an action', old?.state === 'action', old?.state)
  check('and it says reconnecting is the only repair',
    /reconnect/i.test(old?.detail ?? ''),
    'a refresh re-issues the same grant, so anything else is false hope')
  check('and offers the link', !!old?.href && !!old?.actionLabel)

  const current = find(buildCheckup(input({ twitterConnected: true, twitterScopes: 'tweet.read tweet.write media.write offline.access' })), 'x-media')
  check('a grant WITH media.write is ok', current?.state === 'ok', current?.state)
  check('and offers nothing to do', !current?.href,
    'a link here sends someone with a working connection to redo it')

  const unrecorded = find(buildCheckup(input({ twitterConnected: true, twitterScopes: null })), 'x-media')
  check('a grant we never recorded is UNKNOWN', unrecorded?.state === 'unknown', unrecorded?.state)
  check('and says so in words', /cannot tell/i.test(unrecorded?.detail ?? ''), unrecorded?.detail)
  check('and still offers the fix', !!unrecorded?.href,
    'unknown is not an accusation, but it is the case where reconnecting helps')

  check('X is not mentioned at all when it is not connected',
    !find(buildCheckup(input({ twitterConnected: false, twitterScopes: null })), 'x-media'),
    'a row about a channel nobody uses is noise that hides the real ones')
}

// ── Geniuslink: a key encrypted twice, which publishes uncloaked links ─────
{
  const broken = find(buildCheckup(input({ geniuslinkConfigured: true, geniuslinkUnreadable: true })), 'geniuslink')
  check('an unreadable key is an action', broken?.state === 'action', broken?.state)
  check('and says the stored value is gone',
    /cannot be recovered|enter your key/i.test(broken?.detail ?? ''),
    'without that, the creator waits for a repair that is not coming')

  const fine = find(buildCheckup(input({ geniuslinkConfigured: true })), 'geniuslink')
  check('a readable key is ok', fine?.state === 'ok', fine?.state)
  check('Geniuslink is silent when it was never set up',
    !find(buildCheckup(input({})), 'geniuslink'))
}

// ── WordPress ──────────────────────────────────────────────────────────────
{
  const refusing = find(buildCheckup(input({ wordpressConfigured: true, wordpressNeedsAttention: true })), 'wordpress')
  check('a site refusing writes is an action', refusing?.state === 'action', refusing?.state)
  const ok = find(buildCheckup(input({ wordpressConfigured: true })), 'wordpress')
  check('a site accepting posts is ok', ok?.state === 'ok', ok?.state)
  check('and no row at all without a site', !find(buildCheckup(input({})), 'wordpress'))
}

// ── a channel already failing its posts is not reported twice ─────────────
{
  const both = buildCheckup(input({
    twitterConnected: true,
    twitterScopes: 'tweet.read tweet.write',
    deadChannels: [{ platform: 'twitter', label: 'X (Twitter)', message: 'X keeps refusing your posts.' }],
  }))
  check('X appears once, not twice', both.filter(i => i.label === 'X (Twitter)').length === 1,
    'two rows about one account reads as two separate problems')

  const healthyX = buildCheckup(input({
    twitterConnected: true,
    twitterScopes: 'tweet.read tweet.write media.write',
    deadChannels: [{ platform: 'twitter', label: 'X (Twitter)', message: 'X keeps refusing your posts.' }],
  }))
  check('but a dead channel is still reported when the grant is fine',
    healthyX.some(i => i.key === 'dead-twitter'),
    'the grant being current says nothing about the token still working')

  const other = buildCheckup(input({
    deadChannels: [{ platform: 'pinterest', label: 'Pinterest', message: 'Pinterest keeps refusing your posts.' }],
  }))
  check('another failing channel is carried through', other.some(i => i.key === 'dead-pinterest'))
  check('and marked as an action', find(other, 'dead-pinterest')?.state === 'action')
}

// ── a token the nightly refresh found dead ─────────────────────────────────
//
// The case that prompted this. A creator's Threads token went stale, the
// nightly refresh failed against it every night into a console log, and the
// first thing that told him was a post failing with "An unknown error
// occurred" — a message that named no cause and did not suggest the fix. He
// reconnected on a hunch and it worked.
{
  const stale = buildCheckup(input({ staleTokens: [{ platform: 'threads', label: 'Threads' }] }))
  const item = find(stale, 'stale-threads')
  check('a stale token is an action', item?.state === 'action', item?.state)
  check('and says reconnecting is the fix', /reconnect/i.test(item?.detail ?? ''), item?.detail)
  check('and does not blame the creator', /nothing you did/i.test(item?.detail ?? ''),
    'this is our refresh failing, not something they broke')
  check('and links somewhere', !!item?.href && !!item?.actionLabel)

  // One row per channel. A stale token that has ALSO started failing posts is
  // one problem with two symptoms, and printing both reads as two.
  const both = buildCheckup(input({
    staleTokens: [{ platform: 'threads', label: 'Threads' }],
    deadChannels: [{ platform: 'threads', label: 'Threads', message: 'Threads keeps refusing your posts.' }],
  }))
  check('a stale token and a failing channel are one row', both.filter(i => i.label === 'Threads').length === 1,
    both.filter(i => i.label === 'Threads').map(i => i.key).join(', '))

  check('nothing is said when no token is stale', !buildCheckup(input({})).some(i => i.key.startsWith('stale-')))

  const s2 = checkupSummary(stale)
  check('and it leads the headline', /needs redoing/.test(s2.headline), s2.headline)
}

// ── pictures living on our server instead of theirs ────────────────────────
//
// Six creators were carrying 186 posts in this state and not one of them knew,
// because the post reads correctly. fal deletes expired files permanently and
// publishes no default retention, so the only honest move is to say so and
// offer the repair rather than wait for the pictures to vanish.
{
  const one = find(buildCheckup(input({ hotlinkedPosts: 1 })), 'hotlinked-images')
  check('a single hotlinked post is raised', one?.state === 'action', one?.state)
  check('and reads as singular', /1 of your posts is/i.test(one?.detail ?? ''), one?.detail)

  const many = find(buildCheckup(input({ hotlinkedPosts: 81 })), 'hotlinked-images')
  check('the count is the creator\'s own', /81 of your posts are/i.test(many?.detail ?? ''), many?.detail)
  check('and it explains why they look fine', /look right today/i.test(many?.detail ?? ''), many?.detail)
  check('and says whose fault it is not', /your site turned the uploads away/i.test(many?.detail ?? ''), many?.detail)
  check('and promises no regeneration', /does not regenerate/i.test(many?.detail ?? ''),
    'a creator who thinks this reruns the AI will not press it, and it costs nothing')
  check('and offers the repair', !!many?.href && /move them/i.test(many?.actionLabel ?? ''), many?.actionLabel)

  check('and nothing is said when there are none',
    !find(buildCheckup(input({ hotlinkedPosts: 0 })), 'hotlinked-images'),
    'a row about a problem somebody does not have is what makes the real rows ignorable')

  const s2 = checkupSummary(buildCheckup(input({ hotlinkedPosts: 81 })))
  check('it counts toward the actions', s2.actions === 1, String(s2.actions))
  check('and never reads as all current', !/all current|nothing to do/i.test(s2.headline), s2.headline)
}

// ── the sentence at the top ────────────────────────────────────────────────
//
// This is the line that decides whether anybody acts, so it is held to the one
// rule that matters: an unknown NEVER rounds down to fine.
{
  const all = buildCheckup(input({
    twitterConnected: true,
    twitterScopes: null,             // unknown
    geniuslinkConfigured: true,
    geniuslinkUnreadable: true,      // action
    wordpressConfigured: true,       // ok
  }))
  const s = checkupSummary(all)
  check('actions are counted', s.actions === 1, String(s.actions))
  check('unknowns are counted separately', s.unknowns === 1, String(s.unknowns))
  check('and an action leads the headline', /needs redoing/.test(s.headline), s.headline)
  check('the headline never claims all is well while something is unresolved',
    !/all current|nothing to do/i.test(s.headline), s.headline)

  const onlyUnknown = checkupSummary(buildCheckup(input({ twitterConnected: true, twitterScopes: null })))
  check('an unknown alone does NOT read as fine',
    !/all current|nothing to do/i.test(onlyUnknown.headline), onlyUnknown.headline)
  check('and says it could not be checked',
    /could not check/i.test(onlyUnknown.headline), onlyUnknown.headline)

  const clean = checkupSummary(buildCheckup(input({
    twitterConnected: true,
    twitterScopes: 'tweet.write media.write',
    wordpressConfigured: true,
  })))
  check('a genuinely clean account is told so', /all current/i.test(clean.headline), clean.headline)
  check('with nothing to act on', clean.actions === 0 && clean.unknowns === 0)

  const empty = checkupSummary([])
  check('and nothing connected is its own answer',
    /nothing connected/i.test(empty.headline), empty.headline)
  check('rather than a clean bill of health',
    !/all current/i.test(empty.headline),
    'a trial user with no connections has not passed a check, they have not taken one')

  const plural = checkupSummary(buildCheckup(input({
    twitterConnected: true,
    twitterScopes: 'tweet.write',
    geniuslinkConfigured: true,
    geniuslinkUnreadable: true,
  })))
  check('two actions read as plural', /2 of your connections need/.test(plural.headline), plural.headline)
}

// ── house style ────────────────────────────────────────────────────────────
//
// Every string here is shown to a customer, and dashes are not used as
// punctuation anywhere user-facing.
{
  // EVERY state of every item, not one scenario. The first version of this
  // check built a single broken account and read only the strings that account
  // produced, so none of the "ok" copy was ever looked at — a hyphen planted in
  // the healthy-X line sailed straight through it. Three scenarios cover all
  // three states of all four items, and the summary line of each.
  const scenarios = [
    input({
      twitterConnected: true, twitterScopes: 'tweet.write',
      geniuslinkConfigured: true, geniuslinkUnreadable: true,
      wordpressConfigured: true, wordpressNeedsAttention: true,
      deadChannels: [{ platform: 'pinterest', label: 'Pinterest', message: 'Pinterest keeps refusing your posts.' }],
    }),
    input({
      twitterConnected: true, twitterScopes: 'tweet.write media.write',
      geniuslinkConfigured: true,
      wordpressConfigured: true,
    }),
    input({ twitterConnected: true, twitterScopes: null }),
    input({ staleTokens: [{ platform: 'threads', label: 'Threads' }] }),
    input({ hotlinkedPosts: 81 }),
    input({}),
  ]
  const everything = scenarios.flatMap(s => buildCheckup(s))
  const strings = [
    ...everything.flatMap(i => [i.label, i.detail, i.actionLabel ?? '']),
    ...scenarios.map(s => checkupSummary(buildCheckup(s)).headline),
  ]
  // Proof the sweep reaches every state, so it cannot pass by covering one.
  for (const state of ['action', 'unknown', 'ok'] as const) {
    check(`the style sweep sees at least one "${state}" item`,
      everything.some(i => i.state === state),
      'a sweep that never reaches a state cannot check its copy')
  }
  for (const s of strings) {
    check(`no dash punctuation in "${s.slice(0, 40)}…"`, !/[—–]|\s-\s/.test(s))
    check(`no year in "${s.slice(0, 40)}…"`, !/\b20\d{2}\b/.test(s))
  }
  for (const item of everything) {
    check(`${item.key} has a detail worth reading`, item.detail.length > 30, item.detail)
    check(`${item.key} that asks for action gives somewhere to go`,
      item.state !== 'action' || (!!item.href && !!item.actionLabel),
      'telling somebody to reconnect without saying where is the advice this replaced')
  }
}

if (failures.length) {
  console.error(`\n❌ reconnect-checkup: ${failures.length} failure(s)\n`)
  for (const f of failures) console.error(`   • ${f}`)
  process.exit(1)
}
console.log('✅ reconnect-checkup: broken, unknown and fine stay three different answers')

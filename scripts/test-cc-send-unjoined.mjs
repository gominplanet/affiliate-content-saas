// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Can a creator message a brand whose campaign they have not joined?
//
// For a long time MVP said no, and the comments in this codebase said it was
// Amazon's rule: an un-accepted opportunity has no brand chat, so there is
// nothing to send a message into. That was wrong, and it was wrong in the worst
// possible way, because MVP acted on it. Every bulk message silently accepted
// the campaign first. A creator who only wanted to ask a question ended up
// committed to terms they had not read.
//
// The actual cause was ours. The ASIN → campaign lookup filtered on statuses
// SCHEDULED and DELIVERING, which are the statuses a campaign only carries once
// you have joined it, so an un-joined opportunity could never be found. Joining
// did not unlock the chat. Joining made the campaign visible to our own search.
//
// The real send pipeline is lifted out of content.js and run against a fake
// Amazon that distinguishes those two things, because nothing else can: only a
// live account would otherwise show whether the ASIN resolves.
import { readFileSync } from 'node:fs'

const src = readFileSync('extension/content.js', 'utf8')

/** Lifts `async function name(...)`, brace-matched from its first brace. */
function lift(decl) {
  const start = src.indexOf(decl)
  if (start < 0) throw new Error(`${decl} not found in content.js`)
  let depth = 0, i = src.indexOf('{', start), end = -1
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}') { depth--; if (depth === 0) { end = i + 1; break } }
  }
  return src.slice(start, end)
}

const ccSendInPage = eval(`(${lift('async function ccSendInPage(')})`)

const failures = []
const check = (name, cond, detail) => { if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`) }

const JOINED = 'B0JOINED001'
const OPEN = 'B0OPPORTUN1'

/**
 * Amazon, as far as this pipeline can tell.
 *
 * One campaign the creator has joined, one they have not. `chatNeedsJoin` is
 * the question the whole file exists to keep honest: when it is false a brand
 * chat opens for either campaign, which is the behaviour a creator reported and
 * MVP denied; when it is true only a joined campaign gets a chat.
 */
function makeAmazon({ chatNeedsJoin = false } = {}) {
  const calls = { searches: [], chat: [], sent: [] }
  const CAMPAIGNS = {
    [JOINED]: { campaignId: 'camp-joined', brandName: 'Joined Brand', status: 'DELIVERING' },
    [OPEN]: { campaignId: 'camp-open', brandName: 'Open Brand', status: 'AVAILABLE' },
  }
  const joinedStatuses = ['SCHEDULED', 'DELIVERING']
  const fetch = async (url, init) => {
    const body = JSON.parse(init.body)
    if (url.includes('/collaboration/search')) {
      const statuses = body.filterOptions && body.filterOptions.statuses
      calls.searches.push(statuses)
      const asin = (body.searchOptions.find(s => s.fieldName === 'asin') || {}).searchString
      const c = CAMPAIGNS[asin]
      // A status filter genuinely filters. This is the line that made joining
      // look mandatory, and it has to keep behaving like the real API or the
      // test proves nothing.
      const visible = c && (statuses == null || statuses.includes(c.status))
      const ads = visible ? [{ campaignId: c.campaignId, brandName: c.brandName, campaignAsins: [asin] }] : []
      return { ok: true, status: 200, json: async () => ({ responses: [{ ads }] }), text: async () => '' }
    }
    if (url.includes('/chat/search')) {
      calls.chat.push(body)
      const open = !chatNeedsJoin || body.searchOption.campaignId === 'camp-joined'
      const addressBook = open ? [{ contextValidatorToken: 'tok-' + body.searchOption.campaignId + '-0123456789012345' }] : []
      const payload = { responses: [{ addressBook }] }
      return { ok: true, status: 200, json: async () => payload, text: async () => JSON.stringify(payload) }
    }
    if (url.includes('/chat/message/send')) {
      calls.sent.push(body)
      return { ok: true, status: 200, text: async () => '{"status":"SUCCESS"}' }
    }
    throw new Error('unexpected url ' + url)
  }
  return { fetch, calls }
}

const OPTS = {
  segments: ['hello'],
  campaignIdsHint: [],
  headers: {},
  storeId: 'store-01',
  creatorId: 'amzn1.creator.abc',
  creatorName: 'Seb',
  sendTemplate: JSON.stringify({ actorName: '__MVP_ACTOR__', contextToken: '__MVP_CTX__', content: '__MVP_MSG__' }),
  searchTemplate: JSON.stringify({ requestingActor: { name: '__MVP_ACTOR__', id: '__MVP_CREATOR__' }, searchOption: { campaignId: '__MVP_CAMPAIGN__' } }),
  MSG: '__MVP_MSG__', CTX: '__MVP_CTX__', CAMP: '__MVP_CAMPAIGN__',
  CREATOR: '__MVP_CREATOR__', ACTOR: '__MVP_ACTOR__',
}

globalThis.document = { documentElement: { innerHTML: '' }, body: { innerText: '' } }
globalThis.AbortController = class { constructor() { this.signal = null } abort() {} }

const run = async (asin, amazon) => {
  globalThis.fetch = amazon.fetch
  return ccSendInPage({ ...OPTS, asin })
}

// ── the failure this file exists for ────────────────────────────────────────
// An opportunity the creator has not joined, and a brand willing to talk.
{
  const amazon = makeAmazon()
  const r = await run(OPEN, amazon)
  check('an un-joined campaign can be messaged', r.ok, JSON.stringify(r))
  check('and the message actually went out', amazon.calls.sent.length === 1, `${amazon.calls.sent.length} sent`)
  check('nothing was accepted to make that work',
    !JSON.stringify(amazon.calls).includes('accept'), 'an accept call reached Amazon')
  check('the result says the campaign was un-joined, so the app can say so too',
    r.unjoined === true, JSON.stringify(r))
}

// ── the lookup asks the narrow question first ───────────────────────────────
// Dropping the status filter outright would widen every lookup and risk matching
// a campaign the creator never selected. Joined first, everything second.
{
  const amazon = makeAmazon()
  await run(JOINED, amazon)
  check('a joined campaign is found on the first, narrow search',
    amazon.calls.searches.length === 1, JSON.stringify(amazon.calls.searches))
  check('and that search is the joined-only one',
    JSON.stringify(amazon.calls.searches[0]) === JSON.stringify(['SCHEDULED', 'DELIVERING']),
    JSON.stringify(amazon.calls.searches[0]))
}
{
  const amazon = makeAmazon()
  const r = await run(OPEN, amazon)
  check('an un-joined campaign takes a second, unfiltered search',
    amazon.calls.searches.length === 2, JSON.stringify(amazon.calls.searches))
  check('and the second one carries no status filter at all',
    amazon.calls.searches[1] === null, JSON.stringify(amazon.calls.searches[1]))
  check('the campaign only that search could see is flagged un-joined', r.unjoined === true)
}
{
  const amazon = makeAmazon()
  const r = await run(JOINED, amazon)
  check('a joined campaign is not flagged un-joined', r.unjoined === false, JSON.stringify(r))
}

// ── when Amazon does refuse, say which refusal it was ───────────────────────
// A brand that will not talk to an un-joined creator and a chat that exists but
// did not answer look identical in the click count and have opposite fixes. Only
// one of them is solved by joining, and telling someone to join when it would
// not help is how MVP got here in the first place.
{
  const amazon = makeAmazon({ chatNeedsJoin: true })
  const r = await run(OPEN, amazon)
  check('a refusal is not reported as a success', !r.ok, JSON.stringify(r))
  check('and it is named as needing a join, not as a generic missing chat',
    r.reason === 'no-chat-unjoined', r.reason)
  check('no message was sent', amazon.calls.sent.length === 0, `${amazon.calls.sent.length} sent`)

  const joined = await run(JOINED, makeAmazon({ chatNeedsJoin: true }))
  check('the joined campaign still goes through in the same conditions', joined.ok, JSON.stringify(joined))
}

// ── a real missing chat keeps its own reason ────────────────────────────────
{
  const amazon = makeAmazon({ chatNeedsJoin: true })
  // Joined, but the chat is not there. Not a joining problem.
  amazon.fetch = (url, init) => url.includes('/chat/search')
    ? Promise.resolve({ ok: true, status: 200, json: async () => ({ responses: [{ addressBook: [] }] }), text: async () => '{}' })
    : makeAmazon().fetch(url, init)
  const r = await run(JOINED, amazon)
  check('a joined campaign with no chat is not blamed on joining',
    r.reason === 'no-context-token', r.reason)
}

console.log(failures.length ? 'FAIL' : 'ALL PASS')
for (const f of failures) console.log(`  ${f}`)
process.exit(failures.length ? 1 : 0)

// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Reaching the trial users, and the segment that silently skipped the paying ones.
//
// ── THE BUG THAT WAS ALREADY LIVE ─────────────────────────────────────────
//
// /api/admin/broadcast carried its own idea of who is a paying customer:
//
//     const PAID = new Set(['creator', 'studio', 'pro'])
//
// It was written before the Amazon plan and never grew. Amazon is the plan
// the Meta campaign sells and the only one with a live card on its own
// landing page, and every Amazon subscriber fell through every segment: not
// 'trial', not in PAID, and 'amazon' was not in the audience picker either.
// "All paid" reached nobody on the flagship plan.
//
// WHAT ITS FAILURE LOOKED LIKE ON SCREEN, which is the part worth keeping:
// nothing. The send succeeded. The screen reported a recipient count, and
// that count was correct for the segment it described. The audience button
// even carried the omission in writing, labelled "Creator + Studio + Pro", in
// the one form nobody reads as a list of who is being left out. A segment
// that quietly excludes people cannot be noticed by the person sending, only
// by the person who never got the email.
//
// So both sides now derive from lib/tier. A plan joins the right segment the
// day it is priced rather than the day somebody notices.
//
// ── AND THE COUNT IS A COUNT ──────────────────────────────────────────────
//
// The admin list pages fifty users at a time. Filtering those fifty in the
// browser gives "the trial users on page one" rendered where a reader sees
// "the trial users", and the accounts most worth emailing (the newest signups
// and the ones that went quiet) are the least likely to be on the open page.
// Counting a fetched array as a total has shipped here three times. So the
// segment is resolved across every account server-side and the response
// carries `total` and `totalAll` separately.

import { readFileSync } from 'node:fs'
import { TIERS, type Tier } from '../lib/tier'
import { PAID_TIERS, inSegment, segmentOptions } from '../lib/admin-segments'

const failures: string[] = []
const check = (name: string, cond: boolean, detail?: string) => {
  if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`)
}
const read = (p: string) => readFileSync(p, 'utf8')
const live = (src: string) => src
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, (m) => m.replace(/[^\n]/g, ' '))
  .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
  .split('\n').map((l) => (/^\s*(?:\/\/|\*)/.test(l) ? '' : l)).join('\n')

// ── every paying customer is in the paid segment ───────────────────────────
{
  // The actual regression, named. Not "amazon is in PAID_TIERS", which a typo
  // in the derivation could still satisfy: every tier we charge for.
  const charged = (Object.keys(TIERS) as Tier[])
    .filter((t) => t !== 'admin' && (((TIERS[t] as { price?: number }).price ?? 0) > 0))
  for (const t of charged) {
    check(`a ${TIERS[t].label} subscriber is in the paid segment`,
      inSegment(t, 'paid'),
      'they pay us every month and no bulk email could reach them')
  }
  check('amazon specifically, which is the one that was missing',
    inSegment('amazon', 'paid') && PAID_TIERS.includes('amazon'),
    'the hardcoded set was written before this plan existed')

  check('and the trial is not quietly in it',
    !inSegment('trial', 'paid'),
    'a "paid customers" email landing on free accounts is the opposite mistake and just as bad')
  check('admin accounts are in no segment at all',
    !inSegment('admin', 'all') && !inSegment('admin', 'paid') && !inSegment('admin', 'trial'),
    'staff and test accounts are not an audience')
  check('a user with no plan row reads as trial',
    inSegment('trial', 'trial'),
    'a brand-new signup has no integrations row for a moment, and it is certainly in the trial segment')
}

// ── the picker offers every one of them ────────────────────────────────────
{
  const opts = segmentOptions()
  const ids = opts.map((o) => o.id)
  check('the audience list is built, not typed',
    ids.includes('all') && ids.includes('trial') && ids.includes('paid'),
    '')
  for (const t of PAID_TIERS) {
    check(`${TIERS[t].label} can be targeted on its own`,
      ids.includes(t),
      'a segment with no button is a segment that does not exist')
  }
  // The label on the "All paid" button WAS the visible half of the bug.
  const paid = opts.find((o) => o.id === 'paid')!
  for (const t of PAID_TIERS) {
    check(`the paid hint names ${TIERS[t].label}`,
      paid.hint.includes(TIERS[t].label),
      `hint reads "${paid.hint}" — it described a segment that skipped them`)
  }
  check('every option has a hint that is not its own label',
    opts.every((o) => o.hint.trim().length > 0 && o.hint !== o.label), '')
}

// ── neither side keeps its own copy ────────────────────────────────────────
{
  const BROADCAST = live(read('app/api/admin/broadcast/route.ts'))
  const BPAGE = live(read('app/(dashboard)/admin/broadcast/page.tsx'))
  const LIST = live(read('app/api/admin/users-list/route.ts'))
  const UPAGE = live(read('app/(dashboard)/admin/users/page.tsx'))

  check('the broadcast route asks lib/admin-segments',
    /inSegment\(tier, audience\)/.test(BROADCAST) && !/new Set\(\['creator'/.test(BROADCAST),
    'its own set is how this went wrong')
  check('the broadcast UI builds its buttons from it',
    /segmentOptions\(\)/.test(BPAGE) && !/id: 'studio', label:/.test(BPAGE),
    'a typed button list is the other half of the same copy')
  check('the user list resolves the segment with it too',
    /inSegment\(/.test(LIST),
    'two places deciding who is a trial user is two answers')
  check('and the admin screen offers the same segments',
    /segmentOptions\(\)/.test(UPAGE),
    'the list you are looking at and the list you would email must be one list')
}

// ── a page is a page and a total is a total ────────────────────────────────
{
  const LIST = live(read('app/api/admin/users-list/route.ts'))
  const UPAGE = live(read('app/(dashboard)/admin/users/page.tsx'))

  check('the segment is applied before the page is cut',
    /matching\.slice\(start, start \+ perPage\)/.test(LIST),
    'slicing first and filtering second gives "the trial users on page one"')
  check('the route returns the segment total and the account total separately',
    /total,/.test(LIST) && /totalAll: nonAdmin\.length/.test(LIST),
    'one number cannot answer both questions')
  check('hasMore is measured against the total, not the page length',
    /hasMore: start \+ authUsers\.length < total/.test(LIST),
    'authUsers.length === perPage says "the page was full", which is not the same as "there is more"')
  check('and a capped walk says it was capped',
    /truncated/.test(LIST),
    'a ceiling reached in silence turns a floor into a count')

  check('the screen renders the server total rather than counting its rows',
    /total\.toLocaleString\(\)/.test(UPAGE) && !/list\.length\.toLocaleString/.test(UPAGE),
    'list holds one page of fifty')
  check('an unreadable count shows as unavailable, not as zero',
    /count unavailable/.test(UPAGE),
    '"0 accounts" and "we could not count" are different sentences and only one is alarming')
  check('and a truncated one is marked as a floor',
    /at least /.test(UPAGE), '')
}

// ── and getting from a row to an email is one click ────────────────────────
//
// The ask was "an easy way to send messages to the free trial users". The
// per-user send already existed; what did not was any way to see who the
// trial users are, or to write to one without retyping their address into the
// lookup box above the list.
{
  const UPAGE = live(read('app/(dashboard)/admin/users/page.tsx'))
  check('a row has its own Email button',
    /lookup\(u\.email, \{ message: true \}\)/.test(UPAGE),
    'retyping an address you are looking at is how the wrong person gets emailed')
  check('and it opens the compose box rather than just the card',
    /if \(opts\?\.message\) setMsgOpen\(true\)/.test(UPAGE), '')
  check('the row click underneath it does not fire as well',
    /e\.stopPropagation\(\); void lookup\(u\.email, \{ message: true \}\)/.test(UPAGE),
    'the second handler would toggle the compose box straight back shut')
  check('a row with no address cannot be clicked',
    /disabled=\{!u\.email \|\| looking\}/.test(UPAGE), '')
  check('nothing is prefilled into the message',
    !/setMsgSubject\('[^']+'\)/.test(UPAGE),
    'a prefilled message is one somebody sends without reading it')
  check('the bulk tool is reachable from the same place, on the same segment',
    /admin\/broadcast\?audience=\$\{encodeURIComponent\(segment\)\}/.test(UPAGE), '')

  const BPAGE = live(read('app/(dashboard)/admin/broadcast/page.tsx'))
  check('and the broadcast page honours that segment',
    /URLSearchParams\(window\.location\.search\)\.get\('audience'\)/.test(BPAGE), '')
  check('but validates it against the real options first',
    /AUDIENCES\.some\(\(a\) => a\.id === want\)/.test(BPAGE),
    'a stale value in a URL must not preselect an audience the server then interprets its own way')
}

if (failures.length) {
  console.error(`\n❌ admin-segments: ${failures.length} failure(s)\n`)
  for (const f of failures) console.error(`   • ${f}`)
  process.exit(1)
}
console.log('✅ admin-segments: every paying plan is reachable, a page is not a total, and a row is one click from an email')

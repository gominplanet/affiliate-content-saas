// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Does "days left" turn into advice a creator can act on?
//
// The distinction this file guards is the one MVP had nowhere: the same number
// of days means opposite things depending on what you are making.
//
//   An Amazon video is slow to start and fast to be seen. The sample has to be
//   agreed and shipped, which is a fortnight gone before day one, and then it
//   sits on the product page in front of people already deciding to buy.
//
//   A blog post is the reverse. Written today, found by search weeks later.
//
//   A social post is fast at both ends and short lived.
//
// So a 40 day campaign is a video opportunity and a 12 day campaign is not, and
// a 12 day campaign is no good for a blog post either, because Google will not
// have found it before the boost expires. Telling someone to "hurry and write
// the post" there is telling them to work for the ordinary rate.
import {
  campaignRunway, VIDEO_MIN_DAYS, OWNED_VIDEO_MIN_DAYS, BLOG_MIN_DAYS, SOCIAL_ONLY_DAYS,
  SAMPLE_ARRIVAL_DAYS, SEARCH_DISCOVERY_DAYS,
} from '../lib/campaign-runway'

const failures: string[] = []
const check = (name: string, cond: boolean | undefined, detail?: string) => {
  if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`)
}

// ── the long window: what joining is actually for ───────────────────────────
{
  const r = campaignRunway(45)
  check('45 days is a video window', r.best === 'video', r.best)
  check('the video route is open', r.video.viable === true, r.video.note)
  check('and so is everything else', r.blog.viable === true && r.social.viable === true)
  check('the sample wait is named as the thing the time buys',
    /sample to arrive \(about 14 days\)/i.test(r.video.note), r.video.note)
  check('and the reason a longer window is better is stated',
    /the longer the window, the more that video earns/i.test(r.headline), r.headline)
}

// ── the threshold, from both sides ──────────────────────────────────────────
{
  check('the video threshold is 30 days, not a number picked out of the air',
    VIDEO_MIN_DAYS === 30, `${VIDEO_MIN_DAYS}`)
  check('at the threshold the video route is open', campaignRunway(VIDEO_MIN_DAYS).best === 'video')
  check('one day under it, it is not', campaignRunway(VIDEO_MIN_DAYS - 1).video.viable === false)
}

// ── the middle window: the correction this file exists for ──────────────────
// Long enough that someone would reasonably try, short enough that trying the
// obvious thing wastes the campaign.
{
  const r = campaignRunway(12)
  check('12 days is not a video window', r.video.viable === false, r.video.note)
  check('and the sample is the reason, not the filming',
    new RegExp(`sample takes about ${SAMPLE_ARRIVAL_DAYS} days`, 'i').test(r.video.note), r.video.note)
  check('12 days is not a blog window either', r.blog.viable === false, r.blog.note)
  check('and search being slow is the reason',
    new RegExp(`search takes about ${SEARCH_DISCOVERY_DAYS} days`, 'i').test(r.blog.note), r.blog.note)
  check('social is what is left', r.social.viable === true && r.best === 'social-first', r.best)
  check('the headline says to write the post anyway but push it socially',
    /Write the post if you want it long term/i.test(r.headline) && /social push/i.test(r.headline), r.headline)
  check('and it never implies the post will earn the boost',
    !/the post will (earn|bring)/i.test(r.headline), r.headline)
}

// ── the band where a post can be found but a sample cannot arrive ───────────
{
  check('the blog threshold is 35 days', BLOG_MIN_DAYS === 35, `${BLOG_MIN_DAYS}`)
  const r = campaignRunway(36)
  check('36 days is long enough for search to find a post', r.blog.viable === true, r.blog.note)
  check('and long enough for the sample route too', r.video.viable === true, r.video.note)

  // Between 30 and 34 a video works and a blog post does not, because getting a
  // sample filmed is quicker than getting a page found.
  const tight = campaignRunway(31)
  check('at 31 days the video route is open', tight.video.viable === true, tight.video.note)
  check('but a new post would not be found in time', tight.blog.viable === false, tight.blog.note)
}

// ── the closing window ──────────────────────────────────────────────────────
{
  const r = campaignRunway(3)
  check('3 days can only carry a social post', r.best === 'social-now', r.best)
  check('and it says so without pretending otherwise',
    /Nothing that has to be discovered will be discovered in time/i.test(r.headline), r.headline)
  check('it names the one condition worth joining under',
    /only if you can post to social today/i.test(r.headline), r.headline)
  check('the boundary is a week', campaignRunway(SOCIAL_ONLY_DAYS).best === 'social-first' && campaignRunway(SOCIAL_ONLY_DAYS - 1).best === 'social-now')
}

// ── owning the product removes the wait that rules videos out ───────────────
{
  const waiting = campaignRunway(20)
  const owns = campaignRunway(20, { ownsProduct: true })
  check('20 days is not enough while waiting on a sample', waiting.video.viable === false, waiting.video.note)
  check('but it is enough with the product already there', owns.video.viable === true, owns.video.note)
  check('the owned threshold is filming plus real earning time',
    OWNED_VIDEO_MIN_DAYS === 16, `${OWNED_VIDEO_MIN_DAYS}`)
  check('and under it, it is still ruled out',
    campaignRunway(OWNED_VIDEO_MIN_DAYS - 1, { ownsProduct: true }).video.viable === false)
  check('the note stops blaming a sample that is not coming',
    !/sample/i.test(owns.video.note), owns.video.note)
}

// ── no end date is not a short window ───────────────────────────────────────
// Amazon leaves this blank often enough that guessing would either write off a
// live campaign or recommend a dead one.
{
  const r = campaignRunway(null)
  check('an undated campaign gets no verdict', r.best === 'unknown', r.best)
  check('and no route is called viable or ruled out',
    r.video.viable === null && r.blog.viable === null && r.social.viable === null,
    JSON.stringify([r.video.viable, r.blog.viable, r.social.viable]))
  check('it says what to do instead of guessing',
    /check the window on Amazon/i.test(r.headline), r.headline)
  check('and states no countdown', !/\d+ days left/.test(r.headline), r.headline)
}

// ── a closed window ─────────────────────────────────────────────────────────
{
  const r = campaignRunway(-5)
  check('nothing is recommended for a closed campaign',
    r.video.viable === false && r.blog.viable === false && r.social.viable === false)
  check('and it says the boost is gone rather than that the creator failed',
    /nothing made now earns the boosted rate/i.test(r.headline) && !/should have|too late|missed/i.test(r.headline), r.headline)
}

// ── the language ────────────────────────────────────────────────────────────
{
  const all = [45, 31, 20, 12, 3, -2, null].map(d => campaignRunway(d))
  const jargon = /\b(SERP|indexation|CTR|EPC|conversion funnel|ASIN)\b/i
  for (const r of all) {
    const text = `${r.headline} ${r.video.note} ${r.blog.note} ${r.social.note}`
    check('no jargon reaches the creator', !jargon.test(text), (text.match(jargon) || [])[0])
    check('every route says something', r.video.note.length > 10 && r.blog.note.length > 10 && r.social.note.length > 10)
  }
}

console.log(failures.length ? 'FAIL' : 'ALL PASS')
for (const f of failures) console.log(`  ${f}`)
process.exit(failures.length ? 1 : 0)

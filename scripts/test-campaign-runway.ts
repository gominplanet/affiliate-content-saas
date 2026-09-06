// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Does "days left" turn into advice a creator can act on?
//
// The distinction this file guards is the one MVP had nowhere: the same number
// of days means opposite things depending on what you are making, because the
// bottleneck is in a different place for each one.
//
//   An Amazon video is fast at BOTH ends. In the US the sample ships through
//   Amazon and lands in a day to three, and the finished video sits on the
//   product page in front of people already deciding to buy.
//
//   A blog post is fast to write and slow to be found. Search takes weeks.
//   Discovery, not writing, is what it needs a long window for.
//
//   A social post is fast at both ends and short lived.
//
// The first version of this file had the sample at a fortnight, which is wrong
// for most of the US and had real consequences: it ruled out the video route on
// every campaign under a month and pointed creators at blog posts that could not
// possibly be found before the boost expired. The assertions below hold the
// corrected shape in place, and the 20-day case is the one that flipped.
import {
  campaignRunway, VIDEO_MIN_DAYS, OWNED_VIDEO_MIN_DAYS, BLOG_MIN_DAYS, VIDEO_STRONG_DAYS,
  SEARCH_DISCOVERY_DAYS,
} from '../lib/campaign-runway'

const failures: string[] = []
const check = (name: string, cond: boolean | undefined, detail?: string) => {
  if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`)
}

// ── the case that flipped ───────────────────────────────────────────────────
// Twenty days. A perfectly good video window and a hopeless blog window: the
// sample arrives on day three, the video is up on day five and earns for a
// fortnight, while a post published today would still be waiting on Google when
// the boost expired. The old model had this backwards and told the creator to
// write the post.
{
  const r = campaignRunway(20)
  check('20 days is a video window', r.video.viable === true, r.video.note)
  check('and the route says so', r.best === 'video', r.best)
  check('the sample being quick is the reason given',
    /sample usually arrives in a few days/i.test(r.video.note), r.video.note)
  check('20 days is NOT a blog window', r.blog.viable === false, r.blog.note)
  check('and search being slow is the reason',
    new RegExp(`search takes about ${SEARCH_DISCOVERY_DAYS} days`, 'i').test(r.blog.note), r.blog.note)
  check('the headline names the video and the social push as what pays here',
    /the video and the social push are what pay here/i.test(r.headline), r.headline)
  check('and it never tells them to hurry a blog post for the boost',
    !/write the post/i.test(r.headline), r.headline)
}

// ── the thresholds, from both sides ─────────────────────────────────────────
{
  check('a video needs 12 days: sample, filming, and a week of the boost',
    VIDEO_MIN_DAYS === 12, `${VIDEO_MIN_DAYS}`)
  check('at the threshold the video route is open', campaignRunway(VIDEO_MIN_DAYS).video.viable === true)
  check('one day under it, it is not', campaignRunway(VIDEO_MIN_DAYS - 1).video.viable === false)
  check('and the reason is the boost expiring, not the sample being slow',
    /filming would finish as the boost expires/i.test(campaignRunway(VIDEO_MIN_DAYS - 1).video.note),
    campaignRunway(VIDEO_MIN_DAYS - 1).video.note)

  check('a blog post needs 28 days, because being found takes three weeks',
    BLOG_MIN_DAYS === 28, `${BLOG_MIN_DAYS}`)
  check('at the threshold search can still find it', campaignRunway(BLOG_MIN_DAYS).blog.viable === true)
  check('one day under it, it cannot', campaignRunway(BLOG_MIN_DAYS - 1).blog.viable === false)

  check('the video threshold is far below the blog one, which is the whole point',
    VIDEO_MIN_DAYS < BLOG_MIN_DAYS)
}

// ── a long window is not more viable, it is more paid ───────────────────────
// Filming is a fixed cost and the video keeps selling for as long as the
// campaign runs, so 60 days is not twice as possible as 30. It is twice as paid.
{
  const long = campaignRunway(45)
  check('a long window is called out separately', long.best === 'video-long', long.best)
  check('and the reason is what the same day of filming earns',
    /keeps selling for the whole window|earning for weeks/i.test(long.headline), long.headline)
  check('a blog post is fine here too', long.blog.viable === true, long.blog.note)
  check('the line is drawn at 30 days', VIDEO_STRONG_DAYS === 30)
  check('just under it is still a video window, just not called long',
    campaignRunway(VIDEO_STRONG_DAYS - 1).best === 'video')
}

// ── the closing window ──────────────────────────────────────────────────────
{
  const r = campaignRunway(3)
  check('3 days can only carry a social post', r.best === 'social-now', r.best)
  check('and it says so without pretending otherwise',
    /A social post is the only thing that reaches a buyer in time/i.test(r.headline), r.headline)
  check('a video is ruled out even though the sample would arrive',
    r.video.viable === false && /Only worth it if you already have the product/i.test(r.video.note), r.video.note)
}

// ── owning the product removes the wait ─────────────────────────────────────
{
  const waiting = campaignRunway(10)
  const owns = campaignRunway(10, { ownsProduct: true })
  check('10 days is too tight while waiting on a sample', waiting.video.viable === false, waiting.video.note)
  check('but it works with the product already there', owns.video.viable === true, owns.video.note)
  check('the owned threshold is filming plus real earning time',
    OWNED_VIDEO_MIN_DAYS === 9, `${OWNED_VIDEO_MIN_DAYS}`)
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
  check('a closed campaign is its own state', r.best === 'closed', r.best)
  check('nothing is recommended for it',
    r.video.viable === false && r.blog.viable === false && r.social.viable === false)
  check('and it says the boost is gone rather than that the creator failed',
    /nothing made now earns the boosted rate/i.test(r.headline) && !/should have|too late|missed/i.test(r.headline), r.headline)
}

// ── the language ────────────────────────────────────────────────────────────
{
  const all = [60, 30, 20, 12, 8, 3, -2, null].map(d => campaignRunway(d))
  const jargon = /\b(SERP|indexation|CTR|EPC|conversion funnel|ASIN)\b/i
  for (const r of all) {
    const text = `${r.headline} ${r.video.note} ${r.blog.note} ${r.social.note}`
    check('no jargon reaches the creator', !jargon.test(text), (text.match(jargon) || [])[0])
    check('every route says something', r.video.note.length > 10 && r.blog.note.length > 10 && r.social.note.length > 10)
  }
  // The sample estimate is a US assumption and is never stated as a hard fact.
  for (const r of all) {
    if (r.video.viable !== true) continue
    check('the sample time is hedged, never promised',
      !/sample (arrives|will arrive) in \d+ days/i.test(r.video.note), r.video.note)
  }
}

console.log(failures.length ? 'FAIL' : 'ALL PASS')
for (const f of failures) console.log(`  ${f}`)
process.exit(failures.length ? 1 : 0)

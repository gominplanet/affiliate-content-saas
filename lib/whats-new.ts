// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// WHAT'S NEW IN MVP, every entry dated (Seb, 2026-10-17: "because we change
// so much stuff all of the time ... we need to have this pop up for anyone
// using MVP once a day when they use the tools .. list the new things we
// offer or have updated from the past 7 days").
//
// The daily card (components/dashboard/MvpNews) shows the entries of the last
// 7 days that the member's plan has. Add an entry at the top for each release
// a member will notice, with today's date; it drops off the card by itself
// after 7 days. Plain words, no dashes, no year in the copy.

import { canUsePreview, trybeAccess, type PreviewFeature } from '@/lib/labs-preview'

export type NewsGate = PreviewFeature | 'trybe'
export interface WhatsNewItem {
  /** The day it went live, YYYY-MM-DD. */
  date: string
  /** The plan feature it belongs to; none for everyone. */
  gate?: NewsGate
  badge: string
  tone: string // accent color for the badge chip
  title: string
  desc: string
  href?: string
}

export const WHATS_NEW: WhatsNewItem[] = [
  // Your own thumbnail text (Seb, 2026-10-18). For everyone who makes thumbnails.
  {
    date: '2026-10-18',
    badge: 'NEW',
    tone: '#7C3AED',
    title: 'Your own thumbnail text',
    desc: 'Got a line in mind? Type it in "Your own thumbnail text" and MVP puts exactly those words on the thumbnail instead of writing its own, split over two lines the way the box shows. It is on YouTube Co-Pilot, Video Launchpad, Amazon thumbnails, the social designs, and on each video in Bulk Amazon upload. Leave it empty and MVP writes it, as before.',
    href: '/co-pilot',
  },
  // Drop (open to Pro 2026-10-18; gated on 'drop', so it follows that switch).
  {
    date: '2026-10-17',
    gate: 'drop',
    badge: 'LABS',
    tone: '#0EA5A4',
    title: 'Drop: finished videos in, one Launch',
    desc: 'Set up once: where each kind of video goes, YouTube, Amazon or both, your CTA, thumbnail look, posting times and days, channel, playlist and Studio steps. Then just drop videos. Each long video is prepared while you check it, with its product photo, thumbnail, title and its own time on its card. Vertical videos go to TikTok, Reels, Shorts, a Facebook Reel, a video pin, Amazon and the TRYBE brand you pick. The board shows where each one landed.',
    href: '/drop',
  },
  // TRYBE, after TrybeDaily's Today, What's Working, Creators and Brands (2026-10-17).
  {
    date: '2026-10-17',
    gate: 'trybe',
    badge: 'NEW',
    tone: '#7C3AED',
    title: 'TRYBE: Most active brands, and any day of What changed',
    desc: 'What changed has three views now. Most active brands ranks the brands creators are joining fastest, with TRYBE\u2019s payout range, Top 100 videos and Meta ads next to each. Pick any day of the last two weeks from Day. Not on Discover lists the brands creators cannot find on TRYBE\u2019s Discover.',
    href: '/trybe?tab=changes',
  },
  {
    date: '2026-10-17',
    gate: 'trybe',
    badge: 'NEW',
    tone: '#DB2777',
    title: 'TRYBE: who is winning the Top 100, and the ads brands run',
    desc: 'What\u2019s working narrows to one category, lists the creators with the most videos in TRYBE\u2019s Top 100 with their brands and videos, and shows the ads TRYBE brands run on Meta, with how long each has been running.',
    href: '/trybe?tab=working',
  },
  {
    date: '2026-10-17',
    gate: 'trybe',
    badge: 'NEW',
    tone: '#16A34A',
    title: 'TRYBE: payouts, TikTok Shop and Compare in Find brands',
    desc: 'Each brand shows what TRYBE says it paid out, and the range before when it went up, plus whether it sells on TikTok Shop. Sort by Highest total payouts, filter by Payout tier went up or On TikTok Shop, and press Compare on two or three brands to see them side by side.',
    href: '/trybe?tab=find',
  },
  // The Page Reel posts itself after the Group post (2026-10-16).
  {
    date: '2026-10-16',
    gate: 'facebook_reels',
    badge: 'NEW',
    tone: '#1877F2',
    title: 'Clip Factory: the Page Reel posts itself',
    desc: 'After you press Post in your Facebook Group, you can close MVP. While Facebook processes the video, SCOUT keeps watching for up to 3 hours, and MVP then posts the Reel on your Page linking to that exact Group post. Keep the Facebook tab open until it is up. Needs SCOUT 1.50.0, which Chrome installs by itself.',
    href: '/meta',
  },
  // What a TRYBE brand pays creators a month (2026-10-16).
  {
    date: '2026-10-16',
    gate: 'trybe',
    badge: 'NEW',
    tone: '#0E7490',
    title: 'TRYBE: what each brand pays creators a month',
    desc: 'Find brands now estimates what a brand pays TRYBE creators a month: its videos approved in the last 30 days times what it pays per video. Sort by Pays creators most, set a monthly minimum, or tap Big creator budgets. Hover a figure to see the math. A brand MVP cannot estimate yet is left out and counted. On the Pro plan.',
    href: '/trybe?tab=find',
  },
  // One hashtag engine for everything MVP posts (2026-10-16).
  {
    date: '2026-10-16',
    badge: 'NEW',
    tone: '#ff3b30',
    title: 'Better hashtags on every post',
    desc: 'Every caption MVP writes now picks its hashtags the same way: your proven tags, what is active on that platform and about the post, the brand and the product\u2019s own category. Each platform gets the count it rewards: Instagram 5 including #ad, Threads 1, YouTube 3 to 5. Spam tags, years and repeats are taken out before anything posts. Hashtag insights now shows every platform you post to, and says plainly where a platform does not share results.',
    href: '/pulse',
  },
  // Ticks before a suggested TRYBE reply (2026-10-16).
  {
    date: '2026-10-16',
    gate: 'trybe',
    badge: 'NEW',
    tone: '#7C3AED',
    title: 'TRYBE replies: tick what is true first',
    desc: 'In the Inbox, tick whether you have read the creative brief, requested samples and approved partnership ad permissions. A suggested reply only says you did what is ticked, and offers to do the rest next. Remembered for each chat. On the Pro plan.',
    href: '/trybe?tab=inbox',
  },
  // What a TRYBE brand sells (2026-10-16).
  {
    date: '2026-10-16',
    gate: 'trybe',
    badge: 'NEW',
    tone: '#7C3AED',
    title: 'TRYBE: filter by what a brand sells',
    desc: 'Find brands now tells physical products, apps, software and services apart, read from TRYBE and each brand\u2019s own website. Pick one under Sells; hover a brand\u2019s chip to see why. A brand MVP cannot tell yet is left out and counted. On the Pro plan.',
    href: '/trybe?tab=find',
  },
  // TRYBE sends keep going when you leave the page (2026-10-16).
  {
    date: '2026-10-16',
    gate: 'trybe',
    badge: 'NEW',
    tone: '#7C3AED',
    title: 'TRYBE: Send all keeps going when you leave',
    desc: 'Press Send all and SCOUT sends the whole list by itself, out of sight. Close the tab or keep working; nothing pops up or takes your screen. Brands with no pay figure now stay out of At least $25 a video, and What changed opens any brand to read it and message it. Needs SCOUT 1.48.0, which Chrome installs by itself. On the Pro plan.',
    href: '/trybe?tab=queue',
  },
  // Group Post Queue live for Pro (Seb, 2026-10-16).
  {
    date: '2026-10-16',
    gate: 'group_queue',
    badge: 'NEW',
    tone: '#2563EB',
    title: 'Group Post Queue: a batch of Facebook Group posts',
    desc: 'Pick Sponsored Products or your Amazon videos and MVP writes every post at once. Each goes into your Facebook Group with your link (SCOUT fills it in, you press Post), then MVP shares it on your Page linking to that Group post. Under Share, next to Meta Hub.',
    href: '/group-queue',
  },
  // Amazon's hidden figures (Seb, 2026-10-15).
  {
    date: '2026-10-15',
    badge: 'IMPROVED',
    tone: '#B45309',
    title: 'A number Amazon did not report now says so',
    desc: 'Amazon only reports a product once it has a few sales. Your earnings, storefront, joined campaigns and blog health now show those as not reported, instead of $0, 0 orders or "no sales yet".',
    href: '/earnings',
  },
  // SEO (Seb, 2026-10-15: "one button that is able to completely audit
  // someone's site and then give them actionable things to do").
  {
    date: '2026-10-15',
    badge: 'NEW',
    tone: '#7C3AED',
    title: 'Audit my site: one button, a short list in order',
    desc: 'The SEO page now opens with one button. MVP checks your site, every post and what Google says about each one, then lists what to do, most important first. Where MVP can do it, the button is right there; where it is yours, it gives you the exact clicks.',
    href: '/seo',
  },
  // TRYBE, the fifth release of the day (Seb, 2026-10-14: from six TRYBE
  // strategy videos, "build 1, 2, 3, and 4"). Newest first.
  {
    date: '2026-10-14',
    gate: 'trybe',
    badge: 'NEW',
    tone: '#16A34A',
    title: 'TRYBE retainers: when to ask, the ask, and the deal',
    desc: 'My brands shows the brands ready for a retainer (25+ videos in 30 days, 10+ approved, and a payout), drafts the ask from your real numbers for you to send, and tracks the deal once they say yes: videos due, days left and the top up.',
    href: '/trybe?tab=brands',
  },
  {
    date: '2026-10-14',
    gate: 'trybe',
    badge: 'NEW',
    tone: '#7C3AED',
    title: 'What each video needs: the hook or the body',
    desc: 'Your best videos now read hook rate against click rate: a hook that stops the wrong people, a good body behind a weak hook, or a winner. Plus a remix to try: the hook of one video with the body of another.',
    href: '/trybe?tab=brands',
  },
  {
    date: '2026-10-14',
    gate: 'trybe',
    badge: 'IMPROVED',
    tone: '#B45309',
    title: 'Sample guard and rate lock watch',
    desc: 'Before you ask for more samples, MVP tells you how many are waiting to be filmed. And when a brand changes its pay while your videos are in review, My brands lists them with a friendly nudge to send.',
    href: '/trybe?tab=week',
  },
  // TRYBE, the fourth release of the day (Seb, 2026-10-14: Huntr's five and
  // Keighly Hart's four). Newest first.
  {
    date: '2026-10-14',
    gate: 'trybe',
    badge: 'NEW',
    tone: '#16A34A',
    title: 'TRYBE: ready made lists and how fast brands decide',
    desc: 'Find brands has one tap lists: Untapped, New this week, Big spenders, Fast deciders and Pays $25+ a video. Each brand now shows a verdict (Strong pick, Worth a look, Skip) and how fast it approves or rejects videos, from MVP members\u2019 own results.',
    href: '/trybe?tab=find',
  },
  {
    date: '2026-10-14',
    gate: 'trybe',
    badge: 'NEW',
    tone: '#EA580C',
    title: 'The best new brands, and the hooks winning on TRYBE',
    desc: 'What changed opens with the best new brands on TRYBE, ranked for you, and the Today list tells you when new ones land. Make videos shows the opening lines of this week\u2019s Top 100 videos, and every video plan learns from them.',
    href: '/trybe?tab=changes',
  },
  {
    date: '2026-10-14',
    gate: 'trybe',
    badge: 'NEW',
    tone: '#7C3AED',
    title: 'Road to 500 and your monthly video goal',
    desc: 'Your stage now shows how many videos you have sent on the road to 500. This week has a monthly goal (250 to start, change it any time) with the weekly pace that reaches it.',
    href: '/trybe?tab=week',
  },
  {
    date: '2026-10-14',
    gate: 'trybe',
    badge: 'IMPROVED',
    tone: '#B45309',
    title: 'Move on when a video does not run, and keep a mix',
    desc: 'Your ads, live now points out brands whose videos got no ad results, so you move to a new angle or the next brand. MVP keeps a mix of small and big brands in every batch it finds, and Find brands shows your mix.',
    href: '/trybe?tab=brands',
  },
  // TRYBE, the third release of the day (Seb, 2026-10-14, after Rob's Oink
  // Suite video: "build all 4"). Newest first.
  {
    date: '2026-10-14',
    gate: 'trybe',
    badge: 'NEW',
    tone: '#16A34A',
    title: 'TRYBE: what a video pays, before you ask',
    desc: 'Every brand in Find brands now shows what an approved video pays: from your own results with it, MVP members\u2019 results, or its flat fee and guaranteed retainer. A % of sales or of ad spend is said as such, never guessed. Press how? to see the math. Two new pay filters: % of ad spend and Guaranteed.',
    href: '/trybe?tab=find',
  },
  {
    date: '2026-10-14',
    gate: 'trybe',
    badge: 'NEW',
    tone: '#B45309',
    title: 'OPEN, FILLING or CROWDED',
    desc: 'One word on each brand says whether you would be early or one of hundreds: its creators, how many joined, and its videos over the last 30 days. Open only shows the brands with room for you.',
    href: '/trybe?tab=find',
  },
  {
    date: '2026-10-14',
    gate: 'trybe',
    badge: 'NEW',
    tone: '#7C3AED',
    title: 'Your ads, live',
    desc: 'My brands now opens with what your videos do as ads on TRYBE: earned, live ads, impressions, link clicks, hook rate, click rate and watch time, for 7, 14 or 30 days, plus your best videos. Brands winning on ads count as your winners to double down on. Needs SCOUT 1.47.0, which Chrome installs by itself. On the Pro plan.',
    href: '/trybe?tab=brands',
  },
  {
    date: '2026-10-14',
    gate: 'trybe',
    badge: 'IMPROVED',
    tone: '#0B1B38',
    title: 'NEW brands, and statics',
    desc: 'Brands new on TRYBE carry a NEW badge. Your priorities now asks what you make (videos, videos and statics, or mostly statics), and brands that take statics say so.',
    href: '/trybe?tab=find',
  },
  // TRYBE, the second release of the day (Seb, 2026-10-14: "update the
  // what's new"). Newest first; the first release's items follow.
  {
    date: '2026-10-14',
    gate: 'trybe',
    badge: 'NEW',
    tone: '#16A34A',
    title: 'TRYBE: see what you already filmed on Amazon, everywhere',
    desc: 'Every TRYBE brand and product now says when you already have Amazon videos of it: in Make videos (each product you filmed says so), Ready to send, Sent, My brands, the Inbox and This week. When a brand says yes, MVP tells you to submit those Amazon videos on TRYBE first: paid videos with no new filming. On the Pro plan.',
    href: '/trybe?tab=create',
  },
  {
    date: '2026-10-14',
    gate: 'trybe',
    badge: 'NEW',
    tone: '#4F46E5',
    title: 'Your TRYBE samples as a PDF',
    desc: 'On This week, Download my samples (PDF) gives you every sample by brand, with the brand\u2019s logo, where each one stands, the dates, the ones to chase, and the Amazon videos you already have of them. On the Pro plan.',
    href: '/trybe?tab=week',
  },
  {
    date: '2026-10-14',
    gate: 'trybe',
    badge: 'IMPROVED',
    tone: '#0B1B38',
    title: 'Your weekly planner, in MVP\u2019s design',
    desc: 'The TRYBE weekly planner PDF now has MVP\u2019s logo, colors and type, a cover, and page numbers on every page.',
    href: '/trybe?tab=week',
  },
  {
    date: '2026-10-14',
    gate: 'trybe',
    badge: 'IMPROVED',
    tone: '#6d28d9',
    title: 'Replies that fit TRYBE',
    desc: 'Suggested replies to TRYBE brands never ask about rates or terms: on TRYBE the brand sets the pay. They answer the brand, show you fit and move to the next step: the sample, the brief, the videos.',
    href: '/trybe?tab=inbox',
  },
  // TRYBE (Seb, 2026-10-14). TRYBE is open to the Pro plan, so every item
  // says so; each links to its own tab (?tab= on /trybe).
  {
    date: '2026-10-14',
    gate: 'trybe',
    badge: 'NEW',
    tone: '#7C3AED',
    title: 'TRYBE: your whole TRYBE business in one place',
    desc: 'Find brands that fit your channel, message them in your own words, answer them, plan your videos and see what each brand pays you. Three groups in one menu: Create, Get brands and Track. On the Pro plan, under Find products, with SCOUT in Chrome.',
    href: '/trybe',
  },
  {
    date: '2026-10-14',
    gate: 'trybe',
    badge: 'NEW',
    tone: '#E4572E',
    title: 'Make videos: pick a brand, pick your product, get ten scripts',
    desc: 'MVP lists the brand\u2019s own products from its TRYBE profile, with your samples first. Pick the one you have on hand and get ten shooting scripts that follow the brand\u2019s brief, each with a hook written for the viewer. Every idea is kept for that brand.',
    href: '/trybe?tab=create',
  },
  {
    date: '2026-10-14',
    gate: 'trybe',
    badge: 'NEW',
    tone: '#16A34A',
    title: 'Find brands: see who you already filmed on Amazon',
    desc: 'Each brand says if you already have Amazon videos of its products, if its products are in your storefront, and if it pays Amazon creators on Creator Connections. Rank brands by what matters to you, filter by pay per video, creators, samples and more, and star or pass on any brand. On the Pro plan.',
    href: '/trybe?tab=find',
  },
  {
    date: '2026-10-14',
    gate: 'trybe',
    badge: 'NEW',
    tone: '#0E7490',
    title: 'Your stage: volume first, then double down',
    desc: 'At first, ask many brands and film for every one that says yes. Once your own numbers show which brands pay and approve you, MVP names them as your winners and tells you to put most of your videos into them, while you keep testing new brands.',
    href: '/trybe?tab=find',
  },
  {
    date: '2026-10-14',
    gate: 'trybe',
    badge: 'NEW',
    tone: '#C2410C',
    title: 'This week: samples, a 7 day plan and a planner PDF',
    desc: 'Your TRYBE sample requests come in by themselves and tick off as they arrive. MVP plans your next seven days from what you have on hand and your monthly target, and makes a clean weekly planner PDF with scripts, top videos to watch and your earnings as charts.',
    href: '/trybe?tab=week',
  },
  {
    date: '2026-10-14',
    gate: 'trybe',
    badge: 'NEW',
    tone: '#BE185D',
    title: 'My brands, What changed and What\u2019s working',
    desc: 'See what each brand paid you and approved, which ones to focus on, and videos stuck in review. Every day MVP notes new brands, pay changes and new Meta ads, your brands first. Check your own hook before you film, and see how the videos in TRYBE\u2019s Top 100 open, with examples to watch.',
    href: '/trybe?tab=brands',
  },
  {
    date: '2026-10-14',
    gate: 'trybe',
    badge: 'IMPROVED',
    tone: '#6d28d9',
    title: 'Inbox with a suggested reply',
    desc: 'Your TRYBE chats inside MVP, each with a reply suggested in your voice. Unread replies show in the menu and on your Today list.',
    href: '/trybe?tab=inbox',
  },
]

/** Shown on the card: the last `days` days. */
export const NEWS_DAYS = 7

/** Does this plan have the feature an entry belongs to. */
export function newsGateOpen(gate: NewsGate | undefined, tier: unknown): boolean {
  if (!gate) return true
  if (gate === 'trybe') return trybeAccess(tier) !== 'none'
  return canUsePreview(gate, tier)
}

/** The entries of the last `days` days this plan has, newest first. Pure. */
export function recentNews(tier: unknown, now: Date = new Date(), days = NEWS_DAYS, items: WhatsNewItem[] = WHATS_NEW): WhatsNewItem[] {
  const cut = now.getTime() - days * 86_400_000
  return items
    .filter((u) => Date.parse(u.date + 'T23:59:59Z') >= cut && newsGateOpen(u.gate, tier))
    .sort((a, b) => b.date.localeCompare(a.date))
}

/** Today in the member's own time, YYYY-MM-DD. */
export function localDay(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
/** Opens by itself: once a day when there is news, and whenever SCOUT has
 *  news not yet seen. Pure. */
export function opensToday(input: { today: string; shownDay: string | null; updates: number; scout: boolean; force: boolean }): boolean {
  if (input.force || input.scout) return true
  return input.updates > 0 && input.shownDay !== input.today
}

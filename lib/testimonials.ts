// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// REAL CUSTOMER QUOTES. ONE LIST, NEVER FABRICATED.
//
// Lifted out of app/page.tsx when the ad landing page arrived, because two
// copies of a testimonial list is two lists to remember, and the one that gets
// forgotten is the one nobody is looking at. Every surface that shows proof
// imports this, so adding a quote here puts it everywhere at once.
//
// THE RULE, and it is the only one that matters here: every entry is something
// a real creator actually said, about MVP, and agreed to have shown. The
// temptation when a page looks thin is to write a plausible quote from a
// plausible person. These are customers whose businesses we can name, so an
// invented one is not a white lie; it is a sentence attributed to somebody who
// never said it, on a page we are paying to put in front of strangers.
//
// WHAT MAKES A QUOTE WORK on cold traffic, in order:
//
//   result   the outcome in their own words, ideally a number. Rendered in bold
//            ABOVE the quote, because a reader skimming three cards reads three
//            outcomes and stops at the one that sounds like their own month.
//   photo    a face. The reference competitors run twenty-three headshots and
//            it is the single biggest reason their proof section outperforms.
//   title    what they do, so a reader recognises themselves in them.
//
// Everything except `quote` and `name` is optional and the card lays out
// correctly without any of it, so a quote goes up the day it arrives and gains
// its photo later.

export interface Testimonial {
  quote: string
  name: string
  handle?: string
  /** e.g. 'Amazon Influencer' — what they do, so a reader recognises themselves. */
  title?: string
  /** Path under /public, e.g. '/png/testimonial-rob.webp'. Square crop, 400px+. */
  photo?: string
  /** The headline outcome, in their words. e.g. 'Made the subscription back in 2 weeks'. */
  result?: string
}

export const TESTIMONIALS: Testimonial[] = [
  {
    quote: 'I was skeptical at first but I needed to try something new to push my Amazon offsite revenue. Within the first 2 weeks of testing MVP, I made the subscription back and then some. So grateful for this tool and what it generates for my business.',
    name: 'Verified MVP creator',
  },
]

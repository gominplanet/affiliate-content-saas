// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// The money-back guarantee, in one place, because it was in two and they
// disagreed.
//
// WHAT WAS LIVE. /own-your-blog and /run-your-storefront promised a "30-day
// money-back guarantee" between them five times, twice directly under a
// checkout button, once as an FAQ answer ending "no questions", and once as a
// tile headed "30-day guarantee · If it is not for you, you get your money
// back." Section 9 of the Terms of Service, which is the document a buyer
// actually agrees to at checkout, said:
//
//     Fees already paid are non-refundable except where required by law.
//
// Not a nuance apart. Opposite. And the failure is silent in the way that
// costs most: both pages read perfectly on their own, nobody compares a
// landing page against clause 9 before paying, and the contradiction only
// surfaces at the moment somebody asks for their money back, which is the
// worst possible time to discover which document wins.
//
// The operator confirmed (2026-09-23) that the guarantee is real. So the
// Terms carry it now, and the window lives here so a page cannot advertise
// one length while the terms promise another.

// SEVEN DAYS, NO QUESTIONS, ONCE PER CREATOR (Seb, 2026-10-18). A short
// refund window, short on purpose: a 30-day refund would be a free month of
// AI, and the first week runs at a quarter of each allowance
// (lib/intro-allowance) for the same reason. One refund per creator, matched
// on the card, the YouTube channel, the Amazon ID and the email, so it cannot
// be taken twice.
//
// THIS IS NOW THE BACKSTOP, NOT THE OFFER (2026-10-21). lib/trial gives every
// new member 7 free days before the first charge, so the refund is no longer
// what a visitor is asked to weigh. Sales copy leads with the free week; this
// sits behind it for the member who forgets to cancel and is charged on day 8.
// Both stay true, because the window below counts from the FIRST PAYMENT,
// which under a trial is day 8 rather than day 1. Nothing here needed to
// change for that, and nothing here should be deleted in the trial's name.

/** How long after the first payment a refund can be requested. */
export const GUARANTEE_DAYS = 7

/** Where a member writes to ask for the refund (Seb, 2026-10-18). The Terms
 *  and Ask MVP both read it, so they cannot name two different inboxes. */
export const REFUND_EMAIL = 'team@mvpaffiliate.io'

/** The phrase used on the sales pages. Kept here so "7-day" and the clause in
 *  the Terms cannot come apart. */
export const GUARANTEE_LABEL = `${GUARANTEE_DAYS}-day refund, no questions asked`

/** The short form for a feature tile or a badge. */
export const GUARANTEE_SHORT = `${GUARANTEE_DAYS}-day refund`

/** The whole promise in one sentence, for a line under a checkout button. */
export const GUARANTEE_SENTENCE = `Not for you? Ask within ${GUARANTEE_DAYS} days of your first payment and you get it all back, no questions asked. One refund per creator.`

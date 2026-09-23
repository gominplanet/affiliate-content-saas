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

/** How long after the first payment a refund can be requested. */
export const GUARANTEE_DAYS = 30

/** The phrase used on the sales pages. Kept here so "30-day" and the clause
 *  in the Terms cannot come apart. */
export const GUARANTEE_LABEL = `${GUARANTEE_DAYS}-day money-back guarantee`

/** The short form for a feature tile or a badge. */
export const GUARANTEE_SHORT = `${GUARANTEE_DAYS}-day guarantee`

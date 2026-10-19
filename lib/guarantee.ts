// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// WHAT A NEW MEMBER IS PROMISED, in one place, because it was in two and they
// disagreed once: the sales pages promised a 30-day money-back guarantee while
// section 9 of the Terms said fees were non-refundable. A page cannot
// advertise one thing while the Terms say another if both read it from here.
//
// THE FREE WEEK (Seb, 2026-10-19: "if people sign up with a credit card, we do
// not charge them right away. The first seven days are free. So if they don't
// cancel within seven days, then we charge them a first full month"). On the
// MONTHLY plan the card is taken at signup and nothing is charged for 7 days;
// cancel before day 8 and they pay nothing. It replaces the 7-day refund. The
// YEARLY plan has no free week: it is charged when they join.
//
// ONE FREE WEEK PER CREATOR, matched on the card and the email at signup
// (lib/creator-refund normalizeEmail). Someone who had one, or a refund under
// the old promise, is charged on the day they join. The first week runs at a
// quarter of each allowance (lib/intro-allowance), the same as before.
//
// THE 7-DAY REFUND (Seb, 2026-10-18) was the promise for members who joined
// between the end of the old free trial and the free week. They paid on day
// one and keep it: the admin refunds page still decides their requests.

/** How long the free week lasts on the monthly plan. */
export const FREE_WEEK_DAYS = 7

/** The free week began here, just after it went live. A member who paid
 *  before it, from lib/free-trial NO_TRIAL_FROM, joined with the 7-day refund
 *  instead and keeps it; one who paid after it has no refund
 *  (lib/creator-refund refundCheck). */
export const FREE_WEEK_FROM = '2026-10-19T13:00:00.000Z'

/** The refund window those members were promised. */
export const LEGACY_REFUND_DAYS = 7

/** Where a member writes to the team. The Terms and Ask MVP both read it, so
 *  they cannot name two different inboxes. */
export const SUPPORT_EMAIL = 'team@mvpaffiliate.io'

/** The phrase used on the sales pages. */
export const FREE_WEEK_LABEL = `${FREE_WEEK_DAYS} days free on the monthly plan`

/** The short form for a feature tile or a badge. */
export const FREE_WEEK_SHORT = `${FREE_WEEK_DAYS} days free`

/** The whole promise in one sentence, for a line under a checkout button. */
export const FREE_WEEK_SENTENCE = `On the monthly plan your first ${FREE_WEEK_DAYS} days are free: your card is not charged until day ${FREE_WEEK_DAYS + 1}, and if you cancel before then you pay nothing. One free week per creator. The yearly plan is charged when you join.`

/** THE FREE GUIDE STILL PROMISES THE 7-DAY REFUND, and its guard
 *  (scripts/test-freeguide.ts) reads this line to check the guide's number.
 *  The guide belongs to another session, which updates it to the free week;
 *  until then this keeps that guard reading the number the guide still says.
 *  Nothing in the app uses it. */
export const GUARANTEE_DAYS = 7

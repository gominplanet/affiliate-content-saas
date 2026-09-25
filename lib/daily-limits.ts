// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// The limits that reset every 24 hours rather than every month. Each one
// exists because the thing it spends is shared by every MVP creator (Google's
// indexing quota, YouTube's comment quota), not because of what it costs us.
//
// ONE NUMBER, IMPORTED BY THE GATE AND THE USAGE PAGE, so what the page says
// and what the gate enforces cannot drift apart.

export { SALE_COMMENTS_PER_DAY } from '@/lib/sale-comments'

/** Manual "index this now" nudges per creator per rolling 24 hours (SEO). */
export const INDEX_NUDGES_PER_DAY = 2

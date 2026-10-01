// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// DOES THIS LINK LAND ON AMAZON.
//
// Amazon's Associates policy 6(w): a link must not be placed in a way that
// makes it unclear it goes to Amazon. A cloaked link (Passport mvpl.ink,
// Geniuslink geni.us, a short link) cannot say so by its address, so the words
// beside it must ("Grab it on Amazon"), and the posting code has to KNOW. It
// used to decide from the address and the post body, and a Passport post body
// holds only mvpl.ink links, so Facebook, LinkedIn and Bluesky posted "Get it
// here" beside a link to Amazon. A Passport code is looked up by its stored
// target; anything else is followed. Unknown stays false.

import { isAmazonLink } from '@/lib/social-link-mode'
import { passportTargetForCode } from '@/lib/passport-links'
import { resolveTrueDestination } from '@/lib/affiliate-resolve'

export async function landsOnAmazon(userId: string, link: string | null | undefined): Promise<boolean> {
  if (!link) return false
  if (isAmazonLink(link)) return true
  try {
    const u = new URL(link)
    if (/(^|\.)mvpl\.ink$/i.test(u.hostname)) {
      const code = u.pathname.split('/').filter(Boolean).pop() || ''
      const t = await passportTargetForCode(userId, code)
      return !!(t?.asin || (t?.destinationUrl && isAmazonLink(t.destinationUrl)))
    }
    if (!/geni\.us|amzn\.to|a\.co|bit\.ly|tinyurl\.com|rebrand\.ly/i.test(u.hostname)) return false
    const dest = await Promise.race([resolveTrueDestination(link), new Promise<string>((r) => setTimeout(() => r(''), 6000))])
    return !!dest && isAmazonLink(dest)
  } catch { return false }
}

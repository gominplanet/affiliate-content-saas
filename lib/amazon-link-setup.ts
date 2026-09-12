// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Which link an Amazon Influencer's posts actually go out with.
//
// The Affiliate setup on /amazon/social read: "Geniuslink is best (it
// geo-routes to each visitor's local store); an Amazon Associates tag alone
// also works." Passport Links was not mentioned anywhere on the page.
//
// Three things are wrong with that on this tier.
//
//   Passport IS geo-routing, it is ours, and it is included in the plan. The
//   modal sent a paying subscriber off to open a third-party account to buy a
//   feature they had already paid us for.
//
//   pickLinkStyle returns 'passport' whenever it is on, ahead of everything
//   else. So a creator who followed the advice, pasted Geniuslink keys, and
//   later found the Passport toggle would have those keys silently ignored.
//   The screen recommending Geniuslink is outranked by a toggle it never named.
//
//   And it is the first screen a new Amazon subscriber meets. The ads point
//   here.
//
// So this decides, in one place, what is actually in force, and the setup UI
// reports THAT rather than describing what it hopes is true. The order below
// mirrors lib/link-style.ts pickLinkStyle exactly; if the two ever disagree the
// screen is lying, which is worse than the screen being absent.

export type AmazonLinkStyle = 'passport' | 'geniuslink' | 'tag' | 'none'

export interface AmazonLinkInputs {
  /** integrations.passport_links_enabled, already AND-ed with the tier check by
   *  GET /api/passport, which returns `enabled` in exactly that form. */
  passportEnabled: boolean
  /** Whether this plan may use Passport at all. */
  passportCanUse: boolean
  /** A Geniuslink key AND secret are on file. */
  hasGeniuslink: boolean
  /** The Associates tag. Passport builds its per-country links from this, so it
   *  is not an alternative to Passport: it is what Passport earns with. */
  amazonTag: string
}

export interface AmazonLinkStatus {
  style: AmazonLinkStyle
  /** What to show as the active method. */
  label: string
  /** One line on what that means for their links. */
  detail: string
  /** True when a posted link will actually earn them commission. */
  earning: boolean
  /** Something worth saying out loud, or null. Not an error: a state that will
   *  surprise them later if nobody mentions it now. */
  warning: string | null
}

export function amazonLinkStatus(i: AmazonLinkInputs): AmazonLinkStatus {
  const tag = (i.amazonTag || '').trim()

  if (i.passportEnabled) {
    return {
      style: 'passport',
      label: 'Passport Links',
      detail: tag
        ? 'Every link geo-routes to the visitor’s own Amazon store, under your tag.'
        : 'Geo-routing is on, but there is no Associates tag to earn with yet.',
      earning: !!tag,
      // The exact trap this module exists for. Their keys are on file, the old
      // screen told them to put them there, and they do nothing.
      warning: i.hasGeniuslink
        ? 'Your Geniuslink keys are saved but not in use: Passport takes priority while it is on. Turn Passport off if you would rather route through Geniuslink.'
        : (tag ? null : 'Add your Amazon Associates tag below, or Passport has nothing to earn with.'),
    }
  }

  if (i.hasGeniuslink) {
    return {
      style: 'geniuslink',
      label: 'Geniuslink',
      detail: 'Links route through your Geniuslink account.',
      earning: true,
      warning: i.passportCanUse
        ? 'Passport Links is included in your plan and geo-routes the same way, with nothing to connect.'
        : null,
    }
  }

  if (tag) {
    return {
      style: 'tag',
      label: 'Amazon tag',
      detail: 'Links point at Amazon US under your tag. A shopper in another country lands on a store they cannot buy from.',
      earning: true,
      warning: i.passportCanUse
        ? 'Turn on Passport Links to send each visitor to their own Amazon store. It is included in your plan.'
        : null,
    }
  }

  return {
    style: 'none',
    label: 'Not set up',
    detail: 'Your posts will go out without an affiliate link, so they earn nothing.',
    earning: false,
    warning: 'Add your Amazon Associates tag to start earning on every post.',
  }
}

/** The options in the order the setup screen should offer them, with the reason
 *  each one is where it is. Shared so the screen and its test agree. */
export function amazonLinkOptions(canUsePassport: boolean): Array<{
  key: 'passport' | 'geniuslink' | 'tag'
  title: string
  blurb: string
  recommended: boolean
}> {
  return [
    {
      key: 'passport',
      title: 'Passport Links',
      blurb: 'Included in your plan. Sends every shopper to their own country’s Amazon so the sale actually completes, and nothing to sign up for.',
      recommended: canUsePassport,
    },
    {
      key: 'tag',
      title: 'Amazon Associates tag',
      blurb: 'What your links earn with. Required either way, and enough on its own if you only sell in one country.',
      recommended: false,
    },
    {
      key: 'geniuslink',
      title: 'Geniuslink',
      blurb: 'Already have an account? Paste the keys and MVP will use it. Passport takes priority while it is switched on.',
      recommended: false,
    },
  ]
}

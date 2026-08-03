// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Per-platform "link mode" for social fan-out: does a post's link point to the
// blog, straight to the Amazon affiliate product, or both? The user sets a
// default per platform (Facebook / LinkedIn / Bluesky) at the top of the Blog
// to Social page; it's stored on integrations.social_link_modes and read
// server-side by each publish route and the scheduled cron.
//
// Only these three platforms carry a clickable caption link where the choice
// makes sense. Everything else (Pinterest = pin-to-blog, X/Threads/Telegram,
// Instagram/TikTok = no clickable caption) is intentionally excluded.

export type LinkMode = 'blog' | 'affiliate' | 'both'

export const LINK_MODE_PLATFORMS = ['facebook', 'linkedin', 'bluesky'] as const
export type LinkModePlatform = typeof LINK_MODE_PLATFORMS[number]

export type SocialLinkModes = Partial<Record<LinkModePlatform, LinkMode>>

const VALID: LinkMode[] = ['blog', 'affiliate', 'both']

/** Parse the stored jsonb into a clean modes object (unknown values dropped). */
export function parseLinkModes(raw: unknown): SocialLinkModes {
  const out: SocialLinkModes = {}
  if (raw && typeof raw === 'object') {
    for (const p of LINK_MODE_PLATFORMS) {
      const v = (raw as Record<string, unknown>)[p]
      if (typeof v === 'string' && VALID.includes(v as LinkMode)) out[p] = v as LinkMode
    }
  }
  return out
}

/** The stored mode for a platform, defaulting to 'blog' (current behavior). */
export function linkModeFor(modes: SocialLinkModes, platform: LinkModePlatform): LinkMode {
  return modes[platform] ?? 'blog'
}

/** Fall back to blog when a mode needs an affiliate link the post doesn't have. */
export function effectiveMode(mode: LinkMode, affiliateLink: string | null): LinkMode {
  if ((mode === 'affiliate' || mode === 'both') && !affiliateLink) return 'blog'
  return mode
}

/** The affiliate CTA line (no disclaimer — the caller places it per the layout). */
export function affiliateLine(link: string): string {
  return `🛒 Grab it on Amazon 👉 ${link}`
}

/** The blog CTA line. `label` differs per platform ("post" vs "review"). */
export function blogLine(url: string, label = 'Read the full post'): string {
  return `🔗 ${label}: ${url}`
}

/**
 * Compose the full caption for a roomy text platform (Facebook, LinkedIn),
 * following the exact ordering the product spec calls for:
 *   both      → affiliate link + disclaimer, then the write-up, then blog link
 *   affiliate → affiliate link + disclaimer, then the write-up
 *   blog      → blog link, then the write-up, then disclaimer at the end
 * Falls back to blog layout when the mode needs an affiliate link that's absent.
 */
export function composeCaption(opts: {
  mode: LinkMode
  writeUp: string
  blogUrl: string | null
  affiliateLink: string | null
  disclaimer: string
  blogLabel?: string
}): string {
  const eff = effectiveMode(opts.mode, opts.affiliateLink)
  const writeUp = opts.writeUp.trim()
  const aff = opts.affiliateLink ? affiliateLine(opts.affiliateLink) : ''
  const blog = opts.blogUrl ? blogLine(opts.blogUrl, opts.blogLabel) : ''
  const disc = opts.disclaimer.trim()

  if (eff === 'both') {
    return [`${aff}\n${disc}`, writeUp, blog].filter(Boolean).join('\n\n').trim()
  }
  if (eff === 'affiliate') {
    return [`${aff}\n${disc}`, writeUp].filter(Boolean).join('\n\n').trim()
  }
  // blog: link on top, write-up, disclaimer at the end
  return [blog, writeUp, disc].filter(Boolean).join('\n\n').trim()
}

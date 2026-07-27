// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Deal Radar → Instagram STORY. Meta's API can't add a link sticker or a
// caption to a Story, so we bake a "LINK IN BIO" call-to-action into a 9:16
// image (Cloudinary) and publish that as a Story. Followers tap the creator's
// bio link — ideally their Link in Bio page — to shop. Pairs with the Link in
// Bio feature: Story drives attention, the bio page holds the shoppable grid.

import { decryptIntegrationRow } from '@/lib/integration-secrets'
import { resolveSocialAccount } from '@/lib/social-accounts'
import { publishMedia, refreshLongLivedToken } from '@/services/instagram'
import { renderStoryImage, cloudinaryConfigured } from '@/services/cloudinary'

export interface StoryResult { ok: boolean; storyId?: string; error?: string }

export async function publishDealStory(opts: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any
  userId: string
  deal: { asin: string; title: string; imageUrl: string | null }
  /** Small headline baked at the top of the story (e.g. "50% OFF TODAY"). */
  headline?: string
}): Promise<StoryResult> {
  const { supabase, userId, deal } = opts

  if (!deal.imageUrl) return { ok: false, error: 'No product image to build a Story from.' }
  if (!cloudinaryConfigured()) return { ok: false, error: 'Story images need Cloudinary — not configured yet.' }

  // Instagram creds: social_accounts first (modern flow), legacy integrations
  // columns as fallback — same resolution every other IG route uses.
  const { data: intRaw } = await supabase
    .from('integrations')
    .select('instagram_user_id,instagram_access_token,instagram_token_expiry')
    .eq('user_id', userId).maybeSingle()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ig = decryptIntegrationRow(intRaw as any) || {}
  const acct = await resolveSocialAccount(supabase, userId, 'instagram', {
    socialAccountId: null,
    allowSelection: false,
    legacy: {
      externalId: ig.instagram_user_id as string | undefined,
      accessToken: ig.instagram_access_token as string | undefined,
      displayName: null,
    },
  })
  if (!acct) return { ok: false, error: 'Instagram is not connected.' }

  let accessToken = acct.accessToken
  // Refresh a legacy long-lived token if it's near expiry (social_accounts rows
  // are refreshed by their own flow; legacy integrations rows aren't).
  const expiry = Number(ig.instagram_token_expiry || 0)
  if (!acct.id && expiry && Date.now() > expiry - 24 * 60 * 60 * 1000) {
    try {
      const r = await refreshLongLivedToken(accessToken)
      accessToken = r.accessToken
      await supabase.from('integrations')
        .update({ instagram_access_token: accessToken, instagram_token_expiry: r.expiresAt })
        .eq('user_id', userId)
    } catch { /* keep the existing token */ }
  }

  // Compose the 9:16 story image with the baked-in CTA.
  const storyImage = await renderStoryImage(deal.imageUrl, {
    headline: opts.headline,
    cta: 'SHOP THIS  -  LINK IN BIO',
  })
  if (!storyImage) return { ok: false, error: "Couldn't build the Story image — try again shortly." }

  try {
    const storyId = await publishMedia({ userId: acct.externalId, accessToken, mediaType: 'STORIES', imageUrl: storyImage })
    return { ok: true, storyId }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

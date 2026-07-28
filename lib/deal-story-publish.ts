// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Deal Radar → Instagram STORY. Meta's API can't add a link sticker or a
// caption to a Story, so we bake a "LINK IN BIO" call-to-action into a 9:16
// image (Cloudinary) and publish that as a Story. Followers tap the creator's
// bio link — ideally their Link in Bio page — to shop. Pairs with the Link in
// Bio feature: Story drives attention, the bio page holds the shoppable grid.

import { resolveSocialAccount } from '@/lib/social-accounts'
import { maybeDecrypt } from '@/lib/secrets'
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

  // Instagram creds — the canonical IG resolution (matches /instagram/publish-
  // burned): social_accounts first (the modern connect flow mirrors the IG
  // account there as the default, with an ENCRYPTED token), legacy integrations
  // columns as fallback (token decrypted via maybeDecrypt — NOT read raw, or the
  // API gets ciphertext and rejects it).
  const { data: integ } = await supabase
    .from('integrations')
    .select('instagram_user_id,instagram_access_token,instagram_token_expiry,instagram_username')
    .eq('user_id', userId).maybeSingle()
  const acct = await resolveSocialAccount(supabase, userId, 'instagram', {
    socialAccountId: null,
    allowSelection: false,
    legacy: {
      externalId: (integ?.instagram_user_id as string | undefined),
      accessToken: (maybeDecrypt(integ?.instagram_access_token) as string | undefined) || undefined,
      displayName: (integ?.instagram_username as string | undefined) ?? null,
    },
  })
  if (!acct) return { ok: false, error: 'Instagram is not connected.' }
  const igUserId = acct.externalId
  let accessToken = acct.accessToken

  // Refresh a near-expiry legacy long-lived token (social_accounts rows are
  // refreshed by their own cron).
  const expiry = Number(integ?.instagram_token_expiry || 0)
  if (!acct.id && expiry && Date.now() > expiry - 24 * 60 * 60 * 1000) {
    try {
      const r = await refreshLongLivedToken(accessToken)
      accessToken = r.accessToken
      await supabase.from('integrations')
        .update({ instagram_access_token: accessToken, instagram_token_expiry: r.expiresAt })
        .eq('user_id', userId)
    } catch { /* keep the existing token */ }
  }

  // Brand logo + handle for the top of the story. Prefer the creator's Link in
  // Bio handle (that's where the "link in bio" points), else the brand name.
  const { data: brand } = await supabase.from('brand_profiles').select('name,logo_url').eq('user_id', userId).maybeSingle()
  const { data: lp } = await supabase.from('link_pages').select('handle').eq('user_id', userId).maybeSingle()
  const handle = lp?.handle ? `@${lp.handle}` : ((brand?.name as string | undefined) || undefined)

  // Compose the 9:16 story image with the baked-in CTA.
  const storyImage = await renderStoryImage(deal.imageUrl, {
    headline: opts.headline,
    handle,
    logoUrl: (brand?.logo_url as string | undefined) || undefined,
  })
  if (!storyImage) return { ok: false, error: "Couldn't build the Story image — try again shortly." }

  try {
    const storyId = await publishMedia({ userId: igUserId, accessToken, mediaType: 'STORIES', imageUrl: storyImage })
    return { ok: true, storyId }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

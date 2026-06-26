// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential. No copying, redistribution, reverse-engineering, or reuse. See LICENSE.
//
// Store the REAL public permalink a social platform hands back at post-time on
// blog_posts.social_permalinks (jsonb, platform → url). The brand-recap builder
// PREFERS these over URLs it reconstructs from an opaque post id — so the
// "here's where our review is live" message links exactly where the post
// actually landed, including platforms (Threads, Instagram, Telegram) that have
// no reliable public URL derivable from the id alone.
//
// Best-effort by design: a failure here must never break a publish. The recap
// simply falls back to its constructed-URL behaviour when a permalink is absent.

import type { SupabaseClient } from '@supabase/supabase-js'

/** Platforms we may store a real permalink for. Mirrors RecapPlatform's social
 *  members (lib/brand-recap.ts). */
export type SocialPermalinkPlatform =
  | 'x' | 'facebook' | 'linkedin' | 'pinterest' | 'tiktok'
  | 'threads' | 'instagram' | 'telegram'

/**
 * Merge one platform's real permalink into blog_posts.social_permalinks.
 * Read-modify-write (the column is a small jsonb map), never throws.
 *
 * @returns true if the write landed, false if it was skipped/failed.
 */
export async function recordSocialPermalink(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
  postId: string,
  platform: SocialPermalinkPlatform,
  url: string | null | undefined,
): Promise<boolean> {
  try {
    if (!postId || !url || !/^https?:\/\//i.test(url)) return false
    const { data } = await supabase
      .from('blog_posts')
      .select('social_permalinks')
      .eq('id', postId)
      .maybeSingle()
    const current = (data?.social_permalinks && typeof data.social_permalinks === 'object')
      ? data.social_permalinks as Record<string, string>
      : {}
    // No-op if unchanged — avoids a pointless write on a re-publish.
    if (current[platform] === url) return true
    const next = { ...current, [platform]: url }
    const { error } = await supabase
      .from('blog_posts')
      .update({ social_permalinks: next })
      .eq('id', postId)
    return !error
  } catch {
    return false
  }
}

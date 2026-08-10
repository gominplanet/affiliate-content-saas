// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Shared art-director brief cache. A design generation is two costs: the
// art-director brief (the Claude reasoning step that decides layout, palette,
// headline and callouts — ~$0.02) and the gpt-image render (~$0.06). The brief
// is FORMAT-AGNOSTIC: the same creative direction fits a 2:3 pin, a 9:16 story
// and a 1.91:1 Facebook post. So when a creator pushes one product to several
// networks, we run the brief ONCE and reuse it, paying only the per-format
// render for each. That is the "shared creative thinking" the Amazon tier's
// social volumes are priced on.
//
// Keyed by (user_id, brief_key). The caller mints a brief_key per "post set"
// (product + a fresh nonce on each new design), so a Regenerate always makes a
// new brief while a cross-post to a second network reuses the stored one.
// Read/write goes through the service-role client, independent of RLS context.
import { createAdminClient } from '@/lib/supabase/admin'

interface Args<T> {
  userId: string
  /** Stable key for one post set. Falsy → skip the cache entirely (just generate). */
  briefKey: string | null | undefined
  /** How long a cached brief stays reusable. Default 3h — long enough to cross-post,
   *  short enough that a later session designs fresh. */
  ttlMinutes?: number
  /** Runs the real art-director call on a cache miss. */
  generate: () => Promise<T>
}

/**
 * Return the art-director briefs for this post set, reusing a cached brief when
 * one exists (and is still fresh) and otherwise generating + caching it. With no
 * briefKey it degrades to a plain generate() call, so paths that don't opt in
 * (YouTube co-pilot) behave exactly as before.
 */
export async function getOrCreateBriefs<T>(args: Args<T>): Promise<T> {
  const { userId, briefKey, ttlMinutes = 180, generate } = args
  if (!briefKey) return generate()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin: any = createAdminClient()

  // 1. Fresh cache hit → reuse the brief, skip the reasoning call.
  try {
    const { data } = await admin
      .from('art_director_briefs')
      .select('briefs,created_at')
      .eq('user_id', userId)
      .eq('brief_key', briefKey)
      .maybeSingle()
    if (data?.briefs) {
      const ageMs = Date.now() - new Date(data.created_at as string).getTime()
      if (ageMs < ttlMinutes * 60_000) return data.briefs as T
    }
  } catch { /* cache read failed — fall through to a live generate */ }

  // 2. Miss → generate and cache (best-effort; the design still ships either way).
  const briefs = await generate()
  try {
    await admin
      .from('art_director_briefs')
      .upsert(
        { user_id: userId, brief_key: briefKey, briefs, created_at: new Date().toISOString() },
        { onConflict: 'user_id,brief_key' },
      )
  } catch { /* cache write is best-effort */ }
  return briefs
}

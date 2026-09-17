// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// One lookup, so every image surface reads the same chosen look.
//
// The presets shipped wired to YouTube thumbnails only, while the picker told
// creators it set "blog headers, YouTube thumbnails and Pinterest pins". That
// sentence was written before the wiring existed and was wrong the moment it
// went out: a creator who picked Editorial got it on YouTube and the old loud
// house style on every pin and every article header.
//
// The reason it happened is worth keeping. Four image generators live in
// lib/art-director-pin.ts and are called from five different files, none of
// which knew the preset existed. Each one would have needed its own lookup, and
// the surface that gets forgotten is the one nobody is looking at. So there is
// exactly one function, every caller uses it, and a test asserts that every call
// site passes a presetId.
//
// Never throws and never blocks an image. A creator whose preset cannot be read
// gets the default look, which is what they had before any of this existed.

import { createAdminClient } from '@/lib/supabase/admin'

/** Read the brand's chosen image look. Null means unset, unreadable, or a
 *  database that has not run migration 342, and all three mean the default. */
export async function getBrandPresetId(userId: string | null | undefined): Promise<string | null> {
  const id = String(userId ?? '').trim()
  if (!id) return null
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (createAdminClient() as any)
      .from('brand_profiles')
      .select('visual_preset')
      .eq('user_id', id)
      .maybeSingle()
    const preset = (data as { visual_preset?: string | null } | null)?.visual_preset
    return typeof preset === 'string' && preset.trim() ? preset.trim() : null
  } catch {
    // An unreadable preset is not worth failing an image over.
    return null
  }
}

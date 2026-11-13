// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// A DRAFT SAVED IN STUDIO OPENS ITS DROP AGAIN (Lisa, 2026-11-12: "They did
// get to my channel"). Her two videos were on her channel as Studio drafts,
// and the Drop had already given up on their blog post, pin, Facebook post and
// clips with "the video did not reach YouTube", then closed. The Drop now waits
// for a draft (lib/drop-run), and when SCOUT saves one, the places that stopped
// with those words go back in line and a closed drop opens, so the next pass
// writes the post and sends the rest without anyone pressing anything.
//
// Server only. Called from app/api/launch/studio-uploads when a save lands.

import { NOT_ON_YOUTUBE_RE } from '@/lib/studio-upload'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

export interface DropReopened { places: number; drops: number }

export async function reopenDropAfterDraft(db: Db, userId: string, launchItemId: string): Promise<DropReopened> {
  const out: DropReopened = { places: 0, drops: 0 }
  try {
    const { data: items, error } = await db.from('drop_items').select('id,drop_id,to_blog,blog_state,blog_detail')
      .eq('user_id', userId).eq('launch_item_id', launchItemId).limit(10)
    if (error || !items?.length) return out
    const now = new Date().toISOString()
    const dropIds = new Set<string>()
    for (const it of items as Array<{ id: string; drop_id: string; to_blog: boolean; blog_state: string; blog_detail: string | null }>) {
      if (it.to_blog && it.blog_state === 'failed' && NOT_ON_YOUTUBE_RE.test(String(it.blog_detail ?? ''))) {
        const { data: b } = await db.from('drop_items').update({ blog_state: 'wanted', blog_detail: null, updated_at: now })
          .eq('id', it.id).eq('user_id', userId).eq('blog_state', 'failed').select('id')
        if (b?.length) { out.places++; dropIds.add(it.drop_id) }
      }
      const { data: sends } = await db.from('drop_sends').select('id,detail').eq('drop_item_id', it.id).eq('user_id', userId).eq('state', 'failed')
      const again = ((sends ?? []) as Array<{ id: string; detail: string | null }>).filter((x) => NOT_ON_YOUTUBE_RE.test(String(x.detail ?? ''))).map((x) => x.id)
      if (again.length) {
        const { data: s } = await db.from('drop_sends').update({ state: 'wanted', detail: null, updated_at: now })
          .in('id', again).eq('user_id', userId).eq('state', 'failed').select('id')
        if (s?.length) { out.places += s.length; dropIds.add(it.drop_id) }
      }
    }
    if (dropIds.size) {
      const { data: d } = await db.from('drops').update({ state: 'launched', updated_at: now })
        .in('id', [...dropIds]).eq('user_id', userId).eq('state', 'done').select('id')
      out.drops = d?.length ?? 0
    }
  } catch { /* no Drop tables yet: nothing to open */ }
  return out
}

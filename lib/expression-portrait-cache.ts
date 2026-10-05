// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// ONE PORTRAIT PER FACE AND EXPRESSION, EVER.
//
// A design with a chosen expression first renders a portrait of the creator
// wearing it (generate-thumbnail, generateExpressionPortrait), checks it, and
// re-renders once if the face came back wrong. That was a new render on every
// design, for the same selfies and the same expression each time. Seb,
// 2026-10-05: count it against the plan, and make it so it rarely has to run.
//
// So a portrait that passed the check is kept, keyed by the exact selfies it
// was made from, the expression and the prompt that asked for it. The next
// design with the same face and expression uses the kept portrait and renders
// nothing. New selfies, a different expression or a changed prompt make a new
// key, so a stale face is never reused. Only a portrait that was checked and
// matched is kept: a wrong face is not something to remember.
//
// Every step is best-effort. A cache that cannot be read or written leaves the
// design path exactly as it was.

import { createHash } from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/admin'

const BUCKET = 'headshots'

/** The storage path for a portrait. Pure: same inputs, same path. */
export function portraitCachePath(o: {
  userId: string
  refs: Array<Uint8Array | Buffer>
  expressionKey: string
  prompt: string
  model?: string
}): string {
  const h = createHash('sha256')
  for (const r of o.refs) h.update(createHash('sha256').update(r).digest())
  h.update(`|${o.expressionKey}|${o.model ?? ''}|`).update(o.prompt)
  return `${o.userId}/expression-portraits/${h.digest('hex').slice(0, 40)}.png`
}

export async function readCachedPortrait(path: string): Promise<Uint8Array | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (createAdminClient() as any).storage.from(BUCKET).download(path)
    if (error || !data) return null
    const buf = new Uint8Array(await data.arrayBuffer())
    return buf.length > 1000 ? buf : null
  } catch { return null }
}

export async function writeCachedPortrait(path: string, png: Uint8Array): Promise<void> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (createAdminClient() as any).storage.from(BUCKET).upload(path, Buffer.from(png), { contentType: 'image/png', upsert: true })
  } catch { /* the next design renders it again, which is what happened before */ }
}

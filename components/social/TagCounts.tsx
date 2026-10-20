'use client'

/**
 * HOW BIG EACH HASHTAG IS, beside the caption it is in (Seb, 2026-10-20: "I
 * love a hashtag that is anywhere between 10,000 and 200,000 ... way better
 * than a hashtag like the word bike"). Each tag in the caption, as it stands
 * after any edit, with what a platform actually counted for it: green in the
 * sweet spot, marked when it is a crowd, and "not counted yet" when nobody
 * has counted it, so a guess never looks like a measured tag. The disclosure
 * #ad is not a hashtag for this.
 */

import { useEffect, useState } from 'react'
import { sizeWords, writerTags, type SizeTone, type TagPlatform } from '@/lib/hashtag-engine'

type Counted = { tag: string; counts: Array<{ platform: string; source: string; posts: number | null; rank: number | null }> }

const TONE: Record<SizeTone, { color: string; bg: string; note?: string }> = {
  sweet: { color: '#1f7a35', bg: 'rgba(52,199,89,0.12)' },
  near: { color: 'var(--text, #1d1d1f)', bg: 'rgba(120,120,128,0.10)' },
  small: { color: '#8a5a00', bg: 'rgba(255,159,10,0.12)', note: 'small' },
  big: { color: '#8a5a00', bg: 'rgba(255,159,10,0.12)', note: 'big' },
  crowd: { color: '#c93400', bg: 'rgba(255,59,48,0.10)', note: 'crowded' },
  trend: { color: '#5b21b6', bg: 'rgba(124,58,237,0.10)' },
  none: { color: '#86868b', bg: 'rgba(120,120,128,0.08)' },
}

export default function TagCounts({ text, platform }: { text: string; platform: TagPlatform }) {
  const tags = Array.from(new Set(writerTags(text))).slice(0, 30)
  const key = tags.join(',')
  const [rows, setRows] = useState<Counted[] | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!key) { setRows([]); return }
    let alive = true
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/hashtags/counts?tags=${encodeURIComponent(key)}`)
        const j = await r.json().catch(() => ({})) as { ok?: boolean; tags?: Counted[] }
        if (!alive) return
        if (j.ok) { setRows(j.tags || []); setFailed(false) } else setFailed(true)
      } catch { if (alive) setFailed(true) }
    }, 700)
    return () => { alive = false; clearTimeout(t) }
  }, [key])

  if (!tags.length) return null
  return (
    <div className="mt-1.5">
      <p className="text-[10px] text-[#86868b]">Hashtag sizes. 10K to 200K posts reaches buyers best.</p>
      {failed ? (
        <p className="text-[11px] text-[#c93400] mt-1">MVP could not load the counts for these tags.</p>
      ) : (
        <div className="flex flex-wrap gap-1 mt-1">
          {tags.map((tag) => {
            const found = rows?.find((r) => r.tag === tag)
            const w = rows ? sizeWords(found?.counts || [], platform) : { tone: 'none' as SizeTone, text: 'checking' }
            const tone = TONE[w.tone]
            return (
              <span key={tag} className="text-[11px] px-1.5 py-0.5 rounded tabular-nums" style={{ color: tone.color, background: tone.bg }}>
                {tag} · {w.text}{tone.note ? ` (${tone.note})` : ''}
              </span>
            )
          })}
        </div>
      )}
    </div>
  )
}

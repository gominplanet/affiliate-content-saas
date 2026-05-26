/**
 * Smart text-zone detection for thumbnails (Phase 2 / Track B — #13).
 *
 * The canvas overlay (lib/thumbnail-overlay.ts → drawHeadline) historically
 * always dropped the headline in the TOP-LEFT. That's fine when the subject is
 * on the right, but the Nano-Banana frame path grounds on the creator's REAL
 * video frame — where the person can be anywhere. A left-standing subject got
 * the headline painted across their face.
 *
 * This helper runs a cheap Claude Haiku vision pass on the finished (text-free)
 * thumbnail and returns the cleanest corner for large headline text plus the
 * detected face box, so the overlay can place the title in open space instead
 * of over the face. Best-effort: returns null on any failure so it can never
 * block generation, and a `safeFallbackZone()` is provided for that case.
 */
import { createAnthropicClient } from '@/lib/anthropic'
import { recordAnthropicUsage } from '@/lib/ai-usage'

const TEXTZONE_MODEL = 'claude-haiku-4-5-20251001'

export type TextPosition =
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right'
  | 'top-center'
  | 'bottom-center'

const VALID_POSITIONS: TextPosition[] = [
  'top-left', 'top-right', 'bottom-left', 'bottom-right', 'top-center', 'bottom-center',
]

export interface TextZone {
  /** The corner/zone with the cleanest empty space for a large headline. */
  position: TextPosition
  /** Which side of the frame the main subject/face occupies. */
  subjectSide: 'left' | 'right' | 'center'
  /** Largest detected face, normalized 0–1 (x,y = top-left). null if none. */
  faceBox: { x: number; y: number; w: number; h: number } | null
  reason: string
}

interface Ctx { userId?: string | null; tier?: string | null }

/** Default when vision is unavailable: subject assumed right, text top-left. */
export function safeFallbackZone(): TextZone {
  return { position: 'top-left', subjectSide: 'right', faceBox: null, reason: 'fallback' }
}

function firstJson(text: string): Record<string, unknown> | null {
  const m = text.match(/\{[\s\S]*\}/)
  if (!m) return null
  try { return JSON.parse(m[0]) as Record<string, unknown> } catch { return null }
}

/** Fetch an image and return an Anthropic base64 image block. */
async function imageBlock(imageUrl: string): Promise<{ type: 'image'; source: { type: 'base64'; media_type: 'image/jpeg' | 'image/png' | 'image/webp'; data: string } } | null> {
  try {
    const res = await fetch(imageUrl, { signal: AbortSignal.timeout(15000) })
    if (!res.ok) return null
    const ct = (res.headers.get('content-type') || '').toLowerCase()
    const media_type = ct.includes('png') ? 'image/png' : ct.includes('webp') ? 'image/webp' : 'image/jpeg'
    const data = Buffer.from(await res.arrayBuffer()).toString('base64')
    return { type: 'image', source: { type: 'base64', media_type, data } }
  } catch {
    return null
  }
}

function num01(v: unknown): number | null {
  const n = Number(v)
  if (!Number.isFinite(n)) return null
  return Math.max(0, Math.min(1, n))
}

/**
 * Given a detected face box, derive the safest text position: the headline
 * goes to the horizontal side AWAY from the face, in whichever vertical half
 * (top vs. bottom) the face occupies less. Used both as a sanity check on the
 * model's own recommendation and as the resolver when only a box is returned.
 */
export function positionFromFaceBox(box: { x: number; y: number; w: number; h: number }): TextPosition {
  const cx = box.x + box.w / 2
  const cy = box.y + box.h / 2
  // Horizontal: put text opposite the face. Face left → text right, etc.
  const horiz: 'left' | 'right' | 'center' = cx < 0.4 ? 'right' : cx > 0.6 ? 'left' : 'center'
  // Vertical: faces usually sit upper-middle; prefer the half the face leaves
  // clearer. If the face center is in the top half, put text at the top corner
  // on the open side (text beside the face), else top by default.
  const vert: 'top' | 'bottom' = cy > 0.6 ? 'top' : cy < 0.45 ? 'bottom' : 'top'
  if (horiz === 'center') return vert === 'top' ? 'top-center' : 'bottom-center'
  return `${vert}-${horiz}` as TextPosition
}

/**
 * Analyse a finished (text-free) thumbnail and return the cleanest headline
 * zone + face box. Best-effort — returns null on any failure.
 */
export async function analyzeTextZone(imageUrl: string, opts: { ctx?: Ctx } = {}): Promise<TextZone | null> {
  try {
    const img = await imageBlock(imageUrl)
    if (!img) return null
    const anthropic = createAnthropicClient()
    const msg = await anthropic.messages.create({
      model: TEXTZONE_MODEL,
      max_tokens: 220,
      messages: [{
        role: 'user',
        content: [
          img,
          {
            type: 'text',
            text: `You are laying out a YouTube thumbnail. A large bold ALL-CAPS headline (2 lines) must be placed in the CLEANEST open area — never covering the main person's face/head or the main product.

Analyse the image and return:
- faceBox: the bounding box of the largest/most prominent human face as normalized fractions of width/height (x,y = top-left corner, w,h = size, each 0..1). null if no clear face.
- subjectSide: which side the main subject (person or product) sits on — "left", "right", or "center".
- position: the single best zone for the headline so it sits in empty space and does NOT overlap the face or main subject. One of: "top-left","top-right","bottom-left","bottom-right","top-center","bottom-center". Prefer a TOP corner on the side OPPOSITE the subject.

Return ONLY JSON: {"faceBox":{"x":N,"y":N,"w":N,"h":N}|null,"subjectSide":"left|right|center","position":"...","reason":"short"}`,
          },
        ],
      }],
    })
    if (opts.ctx) recordAnthropicUsage(msg, { userId: opts.ctx.userId, tier: opts.ctx.tier, feature: 'thumbnail_textzone', model: TEXTZONE_MODEL })
    const text = ((msg.content[0] as { type: string; text: string }).text || '').trim()
    const p = firstJson(text)
    if (!p) return null

    // Parse face box if present + sane.
    let faceBox: TextZone['faceBox'] = null
    const fb = p.faceBox as Record<string, unknown> | null | undefined
    if (fb && typeof fb === 'object') {
      const x = num01(fb.x), y = num01(fb.y), w = num01(fb.w), h = num01(fb.h)
      if (x !== null && y !== null && w !== null && h !== null && w > 0.02 && h > 0.02) {
        faceBox = { x, y, w, h }
      }
    }

    const subjectSide = (['left', 'right', 'center'].includes(String(p.subjectSide))
      ? p.subjectSide
      : 'center') as TextZone['subjectSide']

    let position = (VALID_POSITIONS.includes(p.position as TextPosition)
      ? p.position
      : null) as TextPosition | null

    // If the model gave a face box but a position that still overlaps it,
    // override with the geometric safe zone.
    if (faceBox) {
      const safe = positionFromFaceBox(faceBox)
      if (!position) position = safe
      else if (overlapsFace(position, faceBox)) position = safe
    }
    if (!position) {
      // No box, no valid position → derive from subjectSide.
      position = subjectSide === 'left' ? 'top-right' : subjectSide === 'right' ? 'top-left' : 'top-center'
    }

    return { position, subjectSide, faceBox, reason: String(p.reason || '').slice(0, 120) }
  } catch {
    return null
  }
}

/** Rough check: would a headline in `position` sit over the face box? */
function overlapsFace(position: TextPosition, box: { x: number; y: number; w: number; h: number }): boolean {
  const cx = box.x + box.w / 2
  const cy = box.y + box.h / 2
  const isTop = position.startsWith('top')
  const faceTop = cy < 0.5
  // Same vertical half as the face?
  if (isTop !== faceTop) return false
  // Same horizontal region?
  if (position.endsWith('left')) return cx < 0.5
  if (position.endsWith('right')) return cx > 0.5
  // center band overlaps a centered face
  return cx > 0.3 && cx < 0.7
}

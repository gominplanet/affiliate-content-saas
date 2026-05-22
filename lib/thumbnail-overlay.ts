/**
 * Client-side canvas text overlay for AI-generated thumbnails.
 *
 * Used by:
 *   - YouTube Co-Pilot (16:9, 1280×720)
 *   - Instagram modal (4:5, 1080×1350)
 *
 * The Flux backend always returns a clean image (no text), and we draw
 * the headline overlay in the browser via canvas so the text is always
 * crisp regardless of model drift. Styles defined once here keep both
 * surfaces visually consistent.
 *
 * Style presets are tuned for viral / punchy YouTube + IG thumbnails
 * (see memory/feedback_thumbnail_calibration.md for why we don't have
 * "subtle" presets — the user explicitly wants high-impact every time).
 */

export interface OverlayStyle {
  id: string
  fontName: string | null
  fontStack: string
  weight: string
  colors: string[]
  outlineColor: string
  outlineW: number
  shadowAlpha: number
  maxPx: number
  position: 'bottom-left' | 'top-left'
  gradient: boolean
  blockBg?: string | null
  highlightLineIdx?: number | null
  highlightColor?: string | null
  hardShadow?: { dx: number; dy: number; color: string } | null
}

export const OVERLAY_STYLES: OverlayStyle[] = [
  {
    id: 'impact-classic',
    fontName: null,
    fontStack: 'Impact, "Arial Black", sans-serif',
    weight: '900',
    colors: ['#FFE034', '#FFFFFF'],
    outlineColor: '#000',
    outlineW: 18,
    shadowAlpha: 0.85,
    maxPx: 134,
    position: 'bottom-left',
    gradient: true,
    hardShadow: { dx: 8, dy: 8, color: '#000' },
  },
  {
    id: 'bangers-orange',
    fontName: 'Bangers',
    fontStack: '"Bangers", Impact, sans-serif',
    weight: '400',
    colors: ['#FF6B00', '#FFFFFF'],
    outlineColor: '#000',
    outlineW: 16,
    shadowAlpha: 0.9,
    maxPx: 134,
    position: 'top-left',
    gradient: false,
    hardShadow: { dx: 7, dy: 7, color: '#000' },
  },
  {
    id: 'oswald-red',
    fontName: 'Oswald',
    fontStack: '"Oswald", Impact, sans-serif',
    weight: '700',
    colors: ['#FF3B30', '#FFFFFF'],
    outlineColor: '#000',
    outlineW: 16,
    shadowAlpha: 0.85,
    maxPx: 128,
    position: 'bottom-left',
    gradient: true,
    hardShadow: { dx: 6, dy: 6, color: '#000' },
  },
  {
    id: 'split-red-white-massive',
    fontName: 'Anton',
    fontStack: '"Anton", Impact, "Arial Black", sans-serif',
    weight: '400',
    colors: ['#FF1F1F', '#FFFFFF'],
    outlineColor: '#000',
    outlineW: 22,
    shadowAlpha: 1,
    maxPx: 150,
    position: 'bottom-left',
    gradient: false,
    hardShadow: { dx: 10, dy: 10, color: '#000' },
  },
  {
    id: 'banner-block',
    fontName: 'Anton',
    fontStack: '"Anton", Impact, "Arial Black", sans-serif',
    weight: '400',
    colors: ['#FFFFFF', '#FFFFFF'],
    outlineColor: '#000',
    outlineW: 8,
    shadowAlpha: 0.6,
    maxPx: 120,
    position: 'bottom-left',
    gradient: false,
    blockBg: '#FF7A00',
    hardShadow: { dx: 6, dy: 6, color: '#000' },
  },
  {
    id: 'mrbeast-yellow',
    fontName: 'Anton',
    fontStack: '"Anton", Impact, "Arial Black", sans-serif',
    weight: '400',
    colors: ['#FFE034', '#FFE034'],
    outlineColor: '#000',
    outlineW: 22,
    shadowAlpha: 0.95,
    maxPx: 150,
    position: 'top-left',
    gradient: false,
    hardShadow: { dx: 9, dy: 9, color: '#000' },
  },
  {
    id: 'highlight-strip-yellow',
    fontName: 'Anton',
    fontStack: '"Anton", Impact, "Arial Black", sans-serif',
    weight: '400',
    colors: ['#FFFFFF', '#1d1d1f'],
    outlineColor: '#000',
    outlineW: 8,
    shadowAlpha: 0.7,
    maxPx: 140,
    position: 'bottom-left',
    gradient: false,
    highlightLineIdx: 1,
    highlightColor: '#FFE034',
    hardShadow: { dx: 7, dy: 7, color: '#000' },
  },
  {
    id: 'red-on-yellow-strip',
    fontName: 'Anton',
    fontStack: '"Anton", Impact, "Arial Black", sans-serif',
    weight: '400',
    colors: ['#FFE034', '#E10600'],
    outlineColor: '#000',
    outlineW: 14,
    shadowAlpha: 0.85,
    maxPx: 144,
    position: 'bottom-left',
    gradient: false,
    highlightLineIdx: 1,
    highlightColor: '#FFE034',
    hardShadow: { dx: 9, dy: 9, color: '#000' },
  },
]

/**
 * Pick a style index biased by per-user 👍 / 👎 feedback.
 *
 * Weight per style: `max(0.1, 1 + likes*0.3 - dislikes*0.5)`. A style
 * the user dislikes 2× and likes 0× scores 0.1 (still has a tiny shot,
 * never zeroed-out — we never know when their taste shifts). A style
 * they like 3× scores 1.9 — almost double the default.
 *
 * Pass empty objects to fall back to uniform random.
 */
export function pickWeightedStyleIndex(
  liked: Record<string, number> = {},
  disliked: Record<string, number> = {},
): number {
  const weights = OVERLAY_STYLES.map(s => {
    const l = liked[s.id] || 0
    const d = disliked[s.id] || 0
    return Math.max(0.1, 1 + l * 0.3 - d * 0.5)
  })
  const total = weights.reduce((a, b) => a + b, 0)
  let r = Math.random() * total
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i]
    if (r <= 0) return i
  }
  return weights.length - 1
}

const loadedFonts = new Set<string>()

async function loadOverlayFont(fontName: string | null, weight = '400'): Promise<void> {
  if (!fontName || typeof window === 'undefined') return
  const key = `${fontName}:${weight}`
  if (loadedFonts.has(key)) return
  // Inject the stylesheet once per font.
  if (!document.querySelector(`link[data-overlay-font="${fontName}"]`)) {
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.dataset.overlayFont = fontName
    link.href = `https://fonts.googleapis.com/css2?family=${fontName.replace(/ /g, '+')}:wght@400;700;900&display=swap`
    document.head.appendChild(link)
  }
  // CRITICAL: document.fonts.ready alone resolves BEFORE a freshly-added font
  // finishes downloading, so canvas would draw with the Impact fallback (the
  // "bland" look). Explicitly load THIS font+weight and wait for it (with a
  // timeout so we never hang). Then the punchy fonts actually render.
  try {
    await Promise.race([
      (async () => {
        await document.fonts.load(`${weight} 100px "${fontName}"`)
        await document.fonts.ready
      })(),
      new Promise<void>(r => setTimeout(r, 4000)),
    ])
  } catch { /* fall back to the fontStack (system Impact) */ }
  loadedFonts.add(key)
}

export interface OverlayOpts {
  /** Output canvas width. 1280 for YouTube 16:9, 1080 for IG 4:5. */
  width?: number
  /** Output canvas height. 720 for YouTube 16:9, 1350 for IG 4:5. */
  height?: number
  /** Force a specific style; omit for random pick. */
  styleIndex?: number
}

/**
 * Draws `hookText` onto `rawUrl` using one of the OVERLAY_STYLES presets.
 * Returns a data: URL of the composited JPEG (quality 0.92).
 *
 * Throws if Canvas isn't supported or the image fails to load (the
 * caller should fall back to the un-overlaid URL in that case).
 */
export async function renderThumbnailOverlay(
  rawUrl: string,
  hookText: string,
  opts: OverlayOpts = {},
): Promise<{ url: string; styleId: string }> {
  const width = opts.width ?? 1280
  const height = opts.height ?? 720
  const style = OVERLAY_STYLES[opts.styleIndex ?? Math.floor(Math.random() * OVERLAY_STYLES.length)]
  await loadOverlayFont(style.fontName, style.weight)

  return new Promise<{ url: string; styleId: string }>((resolve, reject) => {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) { reject(new Error('Canvas not supported')); return }

    const text = hookText.replace(/\bhonest\b/gi, '').replace(/\s{2,}/g, ' ').trim().toUpperCase()
    if (!text) { reject(new Error('Empty hook text')); return }
    const words = text.split(' ')
    let lines: string[]
    if (words.length === 1) {
      lines = [words[0]]
    } else {
      const split = Math.ceil(words.length / 2)
      lines = [words.slice(0, split).join(' '), words.slice(split).join(' ')].filter(Boolean)
    }

    const img = new window.Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      ctx.drawImage(img, 0, 0, width, height)

      // Margins scale with canvas size so layouts look balanced at
      // either YT or IG aspect ratios.
      const MARGIN_X = Math.round(width * 0.045)
      const MARGIN_EDGE = Math.round(height * 0.07)
      // Text zone: ~70% of width for 16:9, more for 4:5 (text wraps better there).
      const ZONE_W = Math.round(width * (width >= height ? 0.55 : 0.85))
      const { outlineW: OUTLINE, colors: LINE_COLORS, outlineColor, shadowAlpha } = style
      // Cap font size to height as well so 4:5 vertical doesn't overflow.
      const maxPxScaled = Math.min(style.maxPx, Math.round(height * 0.13))

      const makeFont = (s: number) => `${style.weight} ${s}px ${style.fontStack}`
      let fs = maxPxScaled
      ctx.font = makeFont(fs)
      while (fs > 36) {
        const maxW = Math.max(...lines.map(l => ctx.measureText(l).width))
        if (maxW <= ZONE_W - OUTLINE * 2) break
        fs -= 4
        ctx.font = makeFont(fs)
      }

      const lineH = fs * 1.18
      const totalH = lines.length * lineH
      const startY = style.position === 'top-left'
        ? MARGIN_EDGE
        : height - MARGIN_EDGE - totalH

      if (style.gradient) {
        const gradH = totalH + MARGIN_EDGE + 20
        const gradY = style.position === 'top-left' ? 0 : height - gradH
        const grad = ctx.createLinearGradient(0, gradY, 0, gradY + gradH)
        if (style.position === 'top-left') {
          grad.addColorStop(0, `rgba(0,0,0,0.6)`)
          grad.addColorStop(1, 'rgba(0,0,0,0)')
        } else {
          grad.addColorStop(0, 'rgba(0,0,0,0)')
          grad.addColorStop(1, `rgba(0,0,0,0.65)`)
        }
        ctx.fillStyle = grad
        ctx.fillRect(0, gradY, width, gradH)
      }

      const blockBg = style.blockBg
      if (blockBg) {
        ctx.font = makeFont(fs)
        const pad = Math.round(fs * 0.18)
        lines.forEach((line, i) => {
          const lineW = ctx.measureText(line).width
          const y = startY + i * lineH
          ctx.fillStyle = blockBg
          ctx.fillRect(MARGIN_X - pad, y - pad * 0.4, lineW + pad * 2, fs + pad * 0.8)
        })
      }

      if (typeof style.highlightLineIdx === 'number' && style.highlightColor && lines[style.highlightLineIdx]) {
        ctx.font = makeFont(fs)
        const pad = Math.round(fs * 0.16)
        const line = lines[style.highlightLineIdx]
        const lineW = ctx.measureText(line).width
        const y = startY + style.highlightLineIdx * lineH
        ctx.fillStyle = style.highlightColor
        ctx.fillRect(MARGIN_X - pad, y - pad * 0.3, lineW + pad * 2, fs + pad * 0.7)
      }

      ctx.textAlign = 'left'
      ctx.textBaseline = 'top'
      ctx.lineJoin = 'round'

      const hardShadow = style.hardShadow
      lines.forEach((line, i) => {
        const x = MARGIN_X
        const y = startY + i * lineH

        ctx.font = makeFont(fs)

        // Hard sticker offset shadow first.
        if (hardShadow) {
          ctx.shadowBlur = 0; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0
          ctx.lineWidth = OUTLINE
          ctx.strokeStyle = hardShadow.color
          ctx.strokeText(line, x + hardShadow.dx, y + hardShadow.dy)
          ctx.fillStyle = hardShadow.color
          ctx.fillText(line, x + hardShadow.dx, y + hardShadow.dy)
        }

        // Soft blurred drop shadow.
        ctx.shadowColor = `rgba(0,0,0,${shadowAlpha})`
        ctx.shadowBlur = 10
        ctx.shadowOffsetX = 4
        ctx.shadowOffsetY = 4

        // Outline.
        ctx.lineWidth = OUTLINE
        ctx.strokeStyle = outlineColor
        ctx.strokeText(line, x, y)

        // Fill.
        ctx.shadowBlur = 0; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0
        ctx.fillStyle = LINE_COLORS[i] ?? LINE_COLORS[LINE_COLORS.length - 1]
        ctx.fillText(line, x, y)
      })

      try {
        resolve({ url: canvas.toDataURL('image/jpeg', 0.92), styleId: style.id })
      } catch (e) {
        reject(e instanceof Error ? e : new Error('toDataURL failed'))
      }
    }
    img.onerror = () => reject(new Error('Image load failed'))
    img.src = rawUrl
  })
}

/**
 * Client-side canvas text overlay for AI-generated thumbnails.
 *
 * Used by:
 *   - YouTube Co-Pilot (16:9, 1280×720)
 *   - Instagram modal (4:5, 1080×1350)
 *
 * The image backend always returns a clean image (no text), and we draw the
 * headline overlay in the browser via canvas so the text is always crisp.
 *
 * STYLE: viral-YouTube / MrBeast lettering — bold uppercase, thick black
 * outline + hard drop shadow, NO background blocks or strips. TOP-LEFT,
 * left-aligned (the image keeps the subject right + product bottom-left, so
 * the title never overlaps them). Colour variations give natural variety.
 */

export interface OverlayStyle {
  id: string
  fontName: string | null
  fontStack: string
  weight: string
  /** Per-line fill colours. colors[0] = line 1, colors[1] = line 2 (accent). */
  colors: string[]
  outlineColor: string
  outlineW: number
  shadowAlpha: number
  maxPx: number
  position: 'top-center' | 'bottom-center' | 'top-left' | 'bottom-left'
  gradient: boolean
  blockBg?: string | null
  highlightLineIdx?: number | null
  highlightColor?: string | null
  hardShadow?: { dx: number; dy: number; color: string } | null
  /** Selection weight before per-user feedback. Default 1. */
  baseWeight?: number
}

// MrBeast-style: bold Anton/Impact, heavy outline + offset shadow, centred at
// the top. No boxes, gradients, or strips. Variations are colour-only.
export const OVERLAY_STYLES: OverlayStyle[] = [
  {
    id: 'bold-white-center',
    fontName: 'Anton',
    fontStack: '"Anton", Impact, "Arial Black", sans-serif',
    weight: '400',
    colors: ['#FFFFFF', '#FFFFFF'],
    outlineColor: '#000',
    outlineW: 20,
    shadowAlpha: 0.9,
    maxPx: 150,
    position: 'top-left',
    gradient: false,
    hardShadow: { dx: 7, dy: 8, color: '#000' },
    baseWeight: 1.4,
  },
  {
    id: 'bold-yellow-center',
    fontName: 'Anton',
    fontStack: '"Anton", Impact, "Arial Black", sans-serif',
    weight: '400',
    colors: ['#FFE034', '#FFE034'],
    outlineColor: '#000',
    outlineW: 20,
    shadowAlpha: 0.9,
    maxPx: 150,
    position: 'top-left',
    gradient: false,
    hardShadow: { dx: 7, dy: 8, color: '#000' },
    baseWeight: 1.2,
  },
  {
    id: 'bold-white-yellow-accent',
    fontName: 'Anton',
    fontStack: '"Anton", Impact, "Arial Black", sans-serif',
    weight: '400',
    colors: ['#FFFFFF', '#FFE034'], // 2nd line pops yellow
    outlineColor: '#000',
    outlineW: 20,
    shadowAlpha: 0.9,
    maxPx: 152,
    position: 'top-left',
    gradient: false,
    hardShadow: { dx: 7, dy: 8, color: '#000' },
    baseWeight: 1.6,
  },
  {
    id: 'bold-white-red-accent',
    fontName: 'Anton',
    fontStack: '"Anton", Impact, "Arial Black", sans-serif',
    weight: '400',
    colors: ['#FFFFFF', '#FF2D2D'], // 2nd line pops red
    outlineColor: '#000',
    outlineW: 20,
    shadowAlpha: 0.9,
    maxPx: 152,
    position: 'top-left',
    gradient: false,
    hardShadow: { dx: 7, dy: 8, color: '#000' },
    baseWeight: 1.4,
  },
  {
    id: 'impact-white-center',
    fontName: null,
    fontStack: 'Impact, "Arial Black", sans-serif',
    weight: '900',
    colors: ['#FFFFFF', '#FFFFFF'],
    outlineColor: '#000',
    outlineW: 18,
    shadowAlpha: 0.85,
    maxPx: 144,
    position: 'top-left',
    gradient: false,
    hardShadow: { dx: 6, dy: 7, color: '#000' },
    baseWeight: 0.8,
  },
]

/**
 * Pick a style index biased by each preset's baseWeight and per-user 👍 / 👎
 * feedback: `max(0.1, baseWeight + likes*0.3 - dislikes*0.5)`.
 */
export function pickWeightedStyleIndex(
  liked: Record<string, number> = {},
  disliked: Record<string, number> = {},
): number {
  const weights = OVERLAY_STYLES.map(s => {
    const l = liked[s.id] || 0
    const d = disliked[s.id] || 0
    return Math.max(0.1, (s.baseWeight ?? 1) + l * 0.3 - d * 0.5)
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
  if (!document.querySelector(`link[data-overlay-font="${fontName}"]`)) {
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.dataset.overlayFont = fontName
    link.href = `https://fonts.googleapis.com/css2?family=${fontName.replace(/ /g, '+')}:wght@400;700;900&display=swap`
    document.head.appendChild(link)
  }
  try {
    await Promise.race([
      (async () => {
        await document.fonts.load(`${weight} 100px "${fontName}"`)
        await document.fonts.ready
      })(),
      new Promise<void>(r => setTimeout(r, 4000)),
    ])
  } catch { /* fall back to the fontStack */ }
  loadedFonts.add(key)
}

export interface OverlayOpts {
  width?: number
  height?: number
  styleIndex?: number
}

/**
 * Draws `hookText` onto `rawUrl` using one of the OVERLAY_STYLES presets.
 * Returns a data: URL of the composited JPEG (quality 0.92).
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
    if (words.length === 1) lines = [words[0]]
    else {
      const split = Math.ceil(words.length / 2)
      lines = [words.slice(0, split).join(' '), words.slice(split).join(' ')].filter(Boolean)
    }

    const img = new window.Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      ctx.drawImage(img, 0, 0, width, height)
      drawHeadline(ctx, lines, style, width, height)
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

/**
 * Shared headline renderer — bold lettering with a hard offset shadow + thick
 * outline (no background). Supports top/bottom × centre/left positions.
 * Exported so the studio's overlay path can reuse the exact same look.
 */
export function drawHeadline(
  ctx: CanvasRenderingContext2D,
  lines: string[],
  style: OverlayStyle,
  width: number,
  height: number,
): void {
  const centered = style.position.endsWith('center')
  const MARGIN_X = Math.round(width * 0.045)
  const MARGIN_EDGE = Math.round(height * 0.06)
  const ZONE_W = centered ? Math.round(width * 0.92) : Math.round(width * (width >= height ? 0.55 : 0.85))
  const { outlineW: OUTLINE, colors: LINE_COLORS, outlineColor, shadowAlpha } = style
  const maxPxScaled = Math.min(style.maxPx, Math.round(height * 0.15))

  const makeFont = (s: number) => `${style.weight} ${s}px ${style.fontStack}`
  let fs = maxPxScaled
  ctx.font = makeFont(fs)
  while (fs > 36) {
    const maxW = Math.max(...lines.map(l => ctx.measureText(l).width))
    if (maxW <= ZONE_W - OUTLINE * 2) break
    fs -= 4
    ctx.font = makeFont(fs)
  }

  const lineH = fs * 1.14
  const totalH = lines.length * lineH
  const startY = style.position.startsWith('top') ? MARGIN_EDGE : height - MARGIN_EDGE - totalH
  const x = centered ? Math.round(width / 2) : MARGIN_X

  ctx.textAlign = centered ? 'center' : 'left'
  ctx.textBaseline = 'top'
  ctx.lineJoin = 'round'

  const hardShadow = style.hardShadow
  lines.forEach((line, i) => {
    const y = startY + i * lineH
    ctx.font = makeFont(fs)

    // Hard offset "sticker" shadow first.
    if (hardShadow) {
      ctx.shadowBlur = 0; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0
      ctx.lineWidth = OUTLINE
      ctx.strokeStyle = hardShadow.color
      ctx.strokeText(line, x + hardShadow.dx, y + hardShadow.dy)
      ctx.fillStyle = hardShadow.color
      ctx.fillText(line, x + hardShadow.dx, y + hardShadow.dy)
    }

    // Soft blurred drop shadow under the outline.
    ctx.shadowColor = `rgba(0,0,0,${shadowAlpha})`
    ctx.shadowBlur = 12
    ctx.shadowOffsetX = 3
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
}

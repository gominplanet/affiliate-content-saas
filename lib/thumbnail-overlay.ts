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
  /** vidIQ-style accent: colour the FIRST word of the headline differently
   *  (e.g. yellow "WINE" + white rest). When set, `accentColor` is used. */
  accentWord?: 'first' | null
  accentColor?: string | null
  /** Vertical gradient fill per line — top color → bottom color.
   *  When set, replaces the flat `colors[i]` fill with a gradient.
   *  Per-line: gradientStops[i] = [topHex, bottomHex]. */
  gradientStops?: Array<[string, string]> | null
  /** Optional inner stroke layer drawn AFTER the outer outline but BEFORE
   *  the fill — gives the "stickered" double-edge look (e.g. white halo
   *  inside a black outline). Skip with null. */
  innerStroke?: { color: string; width: number } | null
  /** Rotation in degrees applied to the whole headline block (-5 to +5).
   *  Slight tilt adds dynamism; matches MrBeast / vidIQ thumbnail energy. */
  tilt?: number | null
}

/** Headline placement zones. Matches lib/thumbnail-textzone.ts TextPosition. */
export type HeadlinePosition =
  | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
  | 'top-center' | 'bottom-center'

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
  // vidIQ signature: first word YELLOW, rest white — the highest-converting
  // look in the references. Weighted heavy so it's picked most often.
  {
    id: 'firstword-yellow',
    fontName: 'Anton',
    fontStack: '"Anton", Impact, "Arial Black", sans-serif',
    weight: '400',
    colors: ['#FFFFFF', '#FFFFFF'],
    outlineColor: '#000',
    outlineW: 22,
    shadowAlpha: 0.92,
    maxPx: 158,
    position: 'top-left',
    gradient: false,
    hardShadow: { dx: 7, dy: 9, color: '#000' },
    accentWord: 'first',
    accentColor: '#FFE034',
    baseWeight: 2.4,
  },
  // First word CYAN — same energy, cooler accent for variety.
  {
    id: 'firstword-cyan',
    fontName: 'Anton',
    fontStack: '"Anton", Impact, "Arial Black", sans-serif',
    weight: '400',
    colors: ['#FFFFFF', '#FFFFFF'],
    outlineColor: '#000',
    outlineW: 22,
    shadowAlpha: 0.92,
    maxPx: 158,
    position: 'top-left',
    gradient: false,
    hardShadow: { dx: 7, dy: 9, color: '#000' },
    accentWord: 'first',
    accentColor: '#27E1FF',
    baseWeight: 1.2,
  },
  // ──────────────────────────────────────────────────────────────────────
  // "Smart Toaster" tier — chunky, slightly tilted, white→gold gradient,
  // double-stroke (black outer + white halo) + huge font. Highest weight
  // so it's picked most often. This is the look the user shared as the
  // target reference for what gominreviews.com thumbnails should match.
  {
    id: 'poppy-gradient-white-gold',
    fontName: 'Anton',
    fontStack: '"Anton", Impact, "Arial Black", sans-serif',
    weight: '400',
    colors: ['#FFFFFF', '#FFE034'], // line 1 white, line 2 gold (fallback if no gradientStops)
    outlineColor: '#000',
    outlineW: 28,
    shadowAlpha: 0.95,
    maxPx: 200,
    position: 'top-left',
    gradient: false,
    hardShadow: { dx: 9, dy: 11, color: '#000' },
    baseWeight: 3.5,
    gradientStops: [
      ['#FFFFFF', '#FFD400'], // line 1: white at top, deep gold at bottom
      ['#FFE034', '#FF8C00'], // line 2: yellow → orange-red for max punch
    ],
    innerStroke: { color: '#FFFFFF', width: 5 },
    tilt: -2,
  },
  // Variant — all-yellow gradient (gold → orange) on EVERY line for the
  // "burning warning" energy. Slightly less common than the white→gold but
  // very on-brand for product reviews where you want to scream "deal".
  {
    id: 'poppy-gradient-fire',
    fontName: 'Anton',
    fontStack: '"Anton", Impact, "Arial Black", sans-serif',
    weight: '400',
    colors: ['#FFE034', '#FFE034'],
    outlineColor: '#000',
    outlineW: 28,
    shadowAlpha: 0.95,
    maxPx: 195,
    position: 'top-left',
    gradient: false,
    hardShadow: { dx: 9, dy: 11, color: '#000' },
    baseWeight: 2.0,
    gradientStops: [
      ['#FFE034', '#FF6B00'],
      ['#FFE034', '#FF6B00'],
    ],
    innerStroke: { color: '#FFFFFF', width: 5 },
    tilt: 2, // tilts the OTHER way for variety vs the white-gold style
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

/** Normalized (0–1) face bounding box from the vision text-zone pass. */
export interface FaceBox { x: number; y: number; w: number; h: number }

export interface OverlayOpts {
  width?: number
  height?: number
  styleIndex?: number
  /** Override the style's default placement (e.g. the vision text-zone result)
   *  so the headline avoids the subject's face. */
  position?: HeadlinePosition
  /** Detected face box (normalized). When present the headline is constrained
   *  to the clear band beside the face so it never sits on the subject. */
  faceBox?: FaceBox | null
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
      drawHeadline(ctx, lines, style, width, height, opts.position, opts.faceBox)
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
  positionOverride?: HeadlinePosition,
  faceBox?: FaceBox | null,
): void {
  // The vision text-zone result (if supplied) wins over the style's default
  // corner, so the headline lands in open space away from the face.
  let position: HeadlinePosition = positionOverride ?? (style.position as HeadlinePosition)
  const MARGIN_X = Math.round(width * 0.045)
  const MARGIN_EDGE = Math.round(height * 0.06)
  let zoneW = position.endsWith('center') ? Math.round(width * 0.92) : Math.round(width * (width >= height ? 0.55 : 0.85))

  // Face-aware constraint: keep the headline OUT of the face's horizontal span.
  // Picking a corner alone isn't enough — a centered subject still gets clipped
  // by a wide top-corner block. So measure the clear band on each side of the
  // face and pin the headline to the roomier side, capping its width to that
  // band (the font-fit loop below then shrinks to fit). This is what stops the
  // "text across the eyes" problem.
  if (faceBox && faceBox.w > 0.02) {
    const gap = Math.round(width * 0.03)
    const faceLeft = faceBox.x * width
    const faceRight = (faceBox.x + faceBox.w) * width
    const leftBand = Math.max(0, faceLeft - MARGIN_X - gap)
    const rightBand = Math.max(0, width - MARGIN_X - faceRight - gap)
    const vert = position.startsWith('bottom') ? 'bottom' : 'top'
    if (rightBand > leftBand) {
      position = (vert === 'bottom' ? 'bottom-right' : 'top-right')
      zoneW = Math.min(zoneW, Math.max(rightBand, Math.round(width * 0.26)))
    } else {
      position = (vert === 'bottom' ? 'bottom-left' : 'top-left')
      zoneW = Math.min(zoneW, Math.max(leftBand, Math.round(width * 0.26)))
    }
  }

  const centered = position.endsWith('center')
  const alignRight = position.endsWith('right')
  const ZONE_W = zoneW
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
  const startY = position.startsWith('top') ? MARGIN_EDGE : height - MARGIN_EDGE - totalH

  // Position manually (textAlign 'left') so we can colour individual words —
  // the vidIQ "first word yellow" look needs per-word fills, which a single
  // aligned fillText can't do.
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  ctx.lineJoin = 'round'

  const hardShadow = style.hardShadow
  const accentFirst = style.accentWord === 'first'
  const accentColor = style.accentColor || LINE_COLORS[0]
  const innerStroke = style.innerStroke
  const gradientStops = style.gradientStops

  // Optional tilt for that hand-placed-sticker / MrBeast energy. Save +
  // restore the canvas state around the rotation so the rest of the
  // canvas (image already drawn) is unaffected. Rotate around the
  // headline block's vertical centre to keep it roughly in the zone.
  const tilt = style.tilt ?? 0
  const tiltApplied = Math.abs(tilt) > 0.001
  if (tiltApplied) {
    ctx.save()
    // Pivot point — middle of the headline block on the chosen side
    const pivotX = centered ? width / 2
      : alignRight ? width - MARGIN_X
      : MARGIN_X
    const pivotY = startY + totalH / 2
    ctx.translate(pivotX, pivotY)
    ctx.rotate((tilt * Math.PI) / 180)
    ctx.translate(-pivotX, -pivotY)
  }

  lines.forEach((line, i) => {
    const y = startY + i * lineH
    ctx.font = makeFont(fs)
    const words = line.split(' ')
    const spaceW = ctx.measureText(' ').width
    const wordWidths = words.map(w => ctx.measureText(w).width)
    const lineW = wordWidths.reduce((a, b) => a + b, 0) + spaceW * Math.max(0, words.length - 1)
    // Left edge of the line for the requested alignment.
    const lineStartX = centered ? Math.round(width / 2 - lineW / 2)
      : alignRight ? Math.round(width - MARGIN_X - lineW)
      : MARGIN_X

    // Hard offset "sticker" shadow (whole line).
    if (hardShadow) {
      ctx.shadowBlur = 0; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0
      ctx.lineWidth = OUTLINE
      ctx.strokeStyle = hardShadow.color
      ctx.fillStyle = hardShadow.color
      ctx.strokeText(line, lineStartX + hardShadow.dx, y + hardShadow.dy)
      ctx.fillText(line, lineStartX + hardShadow.dx, y + hardShadow.dy)
    }

    // Outer black outline + soft blurred drop shadow (whole line).
    ctx.shadowColor = `rgba(0,0,0,${shadowAlpha})`
    ctx.shadowBlur = 12
    ctx.shadowOffsetX = 3
    ctx.shadowOffsetY = 4
    ctx.lineWidth = OUTLINE
    ctx.strokeStyle = outlineColor
    ctx.strokeText(line, lineStartX, y)

    // Inner halo stroke (e.g. white) — gives the "stickered" double-edge
    // look from the Smart-Toaster reference. Drawn between the outer
    // outline and the fill so the halo sits inside the black ring.
    if (innerStroke) {
      ctx.shadowBlur = 0; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0
      ctx.lineWidth = innerStroke.width
      ctx.strokeStyle = innerStroke.color
      ctx.strokeText(line, lineStartX, y)
    }

    // Fill — gradient if configured, otherwise per-word colours so the
    // first word can take the accent colour.
    ctx.shadowBlur = 0; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0
    const lineGradient = gradientStops?.[i] ?? gradientStops?.[gradientStops.length - 1]
    if (lineGradient) {
      // Vertical gradient: top colour at character top, bottom colour at
      // character bottom. Re-created per-line so it follows the wrap.
      const g = ctx.createLinearGradient(0, y, 0, y + fs)
      g.addColorStop(0, lineGradient[0])
      g.addColorStop(1, lineGradient[1])
      ctx.fillStyle = g
      ctx.fillText(line, lineStartX, y)
    } else {
      const baseColor = LINE_COLORS[i] ?? LINE_COLORS[LINE_COLORS.length - 1]
      let cx = lineStartX
      words.forEach((w, wi) => {
        const isAccent = accentFirst && i === 0 && wi === 0
        ctx.fillStyle = isAccent ? accentColor : baseColor
        ctx.fillText(w, cx, y)
        cx += wordWidths[wi] + spaceW
      })
    }
  })

  if (tiltApplied) ctx.restore()
}

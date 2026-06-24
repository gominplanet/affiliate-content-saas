/**
 * Definitive pin renderer. The AI generates a CLEAN, text-free scene;
 * we draw the headline / benefit / badge ourselves on a fixed
 * 1000x1500 canvas via next/og (Satori). Because the text lives in
 * padded flex containers it physically cannot be clipped or bleed off
 * the edge — the recurring "text cut off" problem is impossible here.
 *
 * Fonts are vendored (base64) so the serverless runtime always has a
 * font — no system-font dependency.
 *
 * VARIETY: the overlay isn't one skeleton recoloured. We define a set of
 * DESIGN PRESETS — each a coherent bundle of position + treatment (gradient
 * scrim vs solid band vs floating card vs highlighter-marker vs color stripe)
 * + ALL-CAPS vs Title Case + headline size + badge shape (pill / rect / stamp
 * / angled sticker). One preset is rolled per generation, so pins look
 * deliberately different rather than "same template, new words".
 */
import { ImageResponse } from 'next/og'
import sharp from 'sharp'
import { PIN_FONT_BASE64 } from '@/lib/pin-font'

const PIN_W = 1000
const PIN_H = 1500
const FONT = Buffer.from(PIN_FONT_BASE64, 'base64')

export interface PinText {
  viral_hook: string
  main_benefit: string
  trust_factor: string
}

type Pos = 'top' | 'bottom' | 'center'
type Treatment = 'scrim' | 'band' | 'card' | 'marker' | 'stripe'
type BadgeShape = 'pill' | 'rect' | 'stamp' | 'angled'
type BadgePos = 'tl' | 'tr' | 'tc' | 'bc' | 'br'

interface Preset {
  pos: Pos
  treat: Treatment
  upper: boolean          // ALL CAPS vs Title Case headline
  hookSize: number
  hookColor: string       // headline colour for scrim/stripe treatments
  boxColor: string        // band/card/marker background
  boxText: string         // headline colour when it sits on boxColor
  showBenefit: boolean
  badgeBg: string
  badgeText: string
  badgeShape: BadgeShape
  badgePos: BadgePos
}

// Eight distinct looks. Badges are always placed OPPOSITE the headline
// vertically (and never bottom-left, where Pinterest paints its own
// "See more stats" chip in board view) so nothing collides.
const PRESETS: Preset[] = [
  // 0 — classic: bottom neon headline on a dark gradient scrim, white pill
  { pos: 'bottom', treat: 'scrim', upper: true, hookSize: 78, hookColor: '#eaff00', boxColor: '#000', boxText: '#fff', showBenefit: true, badgeBg: '#ffffff', badgeText: '#111111', badgeShape: 'pill', badgePos: 'tr' },
  // 1 — top SOLID Pinterest-red band, white caps, black rect badge bottom
  { pos: 'top', treat: 'band', upper: true, hookSize: 70, hookColor: '#fff', boxColor: '#e60023', boxText: '#ffffff', showBenefit: false, badgeBg: '#111111', badgeText: '#ffffff', badgeShape: 'rect', badgePos: 'br' },
  // 2 — centered floating WHITE CARD, dark caps + benefit, stamp badge
  { pos: 'center', treat: 'card', upper: true, hookSize: 62, hookColor: '#111', boxColor: '#ffffff', boxText: '#141414', showBenefit: true, badgeBg: '#111111', badgeText: '#ffffff', badgeShape: 'stamp', badgePos: 'tc' },
  // 3 — bottom hot-pink HIGHLIGHTER marker, Title Case, angled sticker
  { pos: 'bottom', treat: 'marker', upper: false, hookSize: 72, hookColor: '#fff', boxColor: '#ff2e88', boxText: '#ffffff', showBenefit: false, badgeBg: '#ffffff', badgeText: '#111111', badgeShape: 'angled', badgePos: 'tl' },
  // 4 — top minimal white caps on a light scrim, pill bottom-center (collage)
  { pos: 'top', treat: 'scrim', upper: true, hookSize: 66, hookColor: '#ffffff', boxColor: '#000', boxText: '#fff', showBenefit: false, badgeBg: '#ffffff', badgeText: '#111111', badgeShape: 'pill', badgePos: 'bc' },
  // 5 — bottom black banner with amber caps + white benefit, amber rect badge
  { pos: 'bottom', treat: 'band', upper: true, hookSize: 74, hookColor: '#ffd400', boxColor: 'rgba(0,0,0,0.74)', boxText: '#ffd400', showBenefit: true, badgeBg: '#ffd400', badgeText: '#111111', badgeShape: 'rect', badgePos: 'tl' },
  // 6 — top color-STRIPE editorial, Title Case white, cyan pill bottom-right
  { pos: 'top', treat: 'stripe', upper: false, hookSize: 70, hookColor: '#ffffff', boxColor: '#19e3ff', boxText: '#fff', showBenefit: true, badgeBg: '#19e3ff', badgeText: '#06303a', badgeShape: 'pill', badgePos: 'br' },
  // 7 — centered DARK card, cyan caps + benefit, angled cyan sticker top
  { pos: 'center', treat: 'card', upper: true, hookSize: 60, hookColor: '#19e3ff', boxColor: '#0b1220', boxText: '#19e3ff', showBenefit: true, badgeBg: '#19e3ff', badgeText: '#06303a', badgeShape: 'angled', badgePos: 'tc' },
]
/** Number of design presets — callers seed a random index in [0, this). */
export const PIN_DESIGN_COUNT = PRESETS.length
// Collage roundup pins use a fixed clean look (top minimal) so the product
// grid isn't covered.
const COLLAGE_PRESET_INDEX = 4

// Back-compat exports (older callers imported these counts). Both now map onto
// the unified preset roll.
export const PIN_OVERLAY_THEME_COUNT = PRESETS.length
export const PIN_LAYOUT_COUNT = PRESETS.length

const toTitle = (s: string) =>
  s.toLowerCase().replace(/\b([a-z])/g, (_m, c: string) => c.toUpperCase())

export async function composePin(
  sceneBase64: string,
  sceneMediaType: string,
  t: PinText,
  opts?: { designSeed?: number; layout?: 'standard' | 'collage'; styleSeed?: number; layoutSeed?: number },
): Promise<{ data: string; mediaType: string } | null> {
  // Resolve the preset. Collage forces the clean grid-friendly look; otherwise
  // roll. designSeed is preferred; styleSeed/layoutSeed are accepted for
  // back-compat and summed so old callers still vary.
  const seed = opts?.designSeed ?? ((opts?.styleSeed ?? 0) + (opts?.layoutSeed ?? 0))
  const idx = opts?.layout === 'collage'
    ? COLLAGE_PRESET_INDEX
    : ((seed % PRESETS.length) + PRESETS.length) % PRESETS.length
  const P = PRESETS[idx]

  try {
    // Normalize the AI scene to an exact 1000x1500 with NO crop: full
    // image centered over a blurred dimmed copy of itself.
    const src = Buffer.from(sceneBase64, 'base64')
    const background = await sharp(src)
      .resize(PIN_W, PIN_H, { fit: 'cover', position: 'centre' })
      .blur(36).modulate({ brightness: 0.72 }).toBuffer()
    const foreground = await sharp(src)
      .resize(PIN_W, PIN_H, { fit: 'inside' }).toBuffer()
    const scene = await sharp(background)
      .composite([{ input: foreground, gravity: 'centre' }])
      .jpeg({ quality: 88 }).toBuffer()
    const sceneUrl = `data:image/jpeg;base64,${scene.toString('base64')}`

    const cap = (s: string) => (P.upper ? (s || '').toUpperCase() : toTitle(s || '')).trim()
    const hook = cap(t.viral_hook)
    const benefit = cap(t.main_benefit)
    const badge = (t.trust_factor || '').toUpperCase().trim()

    // Treatment-dependent colours/shadows.
    const onSolid = P.treat === 'band' || P.treat === 'card' || P.treat === 'marker'
    const hookColor = onSolid ? P.boxText : P.hookColor
    const benefitColor = P.treat === 'card' ? P.boxText : '#ffffff'
    const textShadow = onSolid ? 'none' : '0 4px 14px rgba(0,0,0,0.85)'

    // Cluster background (gradient scrim / solid band / nothing for card+marker).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const clusterBg: any = {}
    if (P.treat === 'scrim' || P.treat === 'stripe') {
      clusterBg.backgroundImage = P.pos === 'bottom'
        ? 'linear-gradient(0deg, rgba(0,0,0,0.80) 0%, rgba(0,0,0,0.38) 58%, rgba(0,0,0,0) 100%)'
        : 'linear-gradient(180deg, rgba(0,0,0,0.74) 0%, rgba(0,0,0,0.34) 58%, rgba(0,0,0,0) 100%)'
    } else if (P.treat === 'band') {
      clusterBg.backgroundColor = P.boxColor
    }

    // Cluster position + padding.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const clusterPos: any = P.pos === 'center'
      ? { top: 0, height: PIN_H, justifyContent: 'center', padding: '0 80px' }
      : P.pos === 'bottom'
        ? { bottom: 0, padding: P.treat === 'band' ? '54px 70px 60px' : '120px 70px 90px' }
        : { top: 0, padding: P.treat === 'band' ? '60px 70px 54px' : '70px 70px 120px' }

    // Headline element — gets the marker highlight box when treat==='marker'.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const hookStyle: any = {
      display: 'flex', color: hookColor, fontSize: P.hookSize, fontWeight: 800,
      letterSpacing: P.upper ? -1 : -0.5, lineHeight: 1.06, textAlign: 'center', textShadow,
    }
    if (P.treat === 'marker') {
      hookStyle.backgroundColor = P.boxColor
      hookStyle.color = P.boxText
      hookStyle.padding = '14px 26px'
      hookStyle.borderRadius = 14
      hookStyle.textShadow = 'none'
    }

    const benefitEl = P.showBenefit && benefit ? (
      <div style={{
        display: 'flex', marginTop: 18, color: benefitColor,
        fontSize: 44, fontWeight: 800, lineHeight: 1.12, textAlign: 'center',
        textShadow: onSolid && P.treat !== 'card' ? 'none' : '0 3px 12px rgba(0,0,0,0.9)',
      }}>{benefit}</div>
    ) : null

    // Inner content (hook + optional benefit). For the CARD treatment this is
    // wrapped in a padded, rounded, shadowed box; otherwise it sits directly in
    // the cluster.
    const inner = (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
        <div style={hookStyle}>{hook}</div>
        {benefitEl}
      </div>
    )
    const content = P.treat === 'card' ? (
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        backgroundColor: P.boxColor, padding: '46px 50px', borderRadius: 28,
        boxShadow: '0 24px 60px rgba(0,0,0,0.45)',
        border: P.boxColor === '#0b1220' ? '1px solid rgba(255,255,255,0.08)' : '1px solid rgba(0,0,0,0.06)',
      }}>{inner}</div>
    ) : inner

    // Badge shape.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const badgeStyle: any = {
      display: 'flex', backgroundColor: P.badgeBg, color: P.badgeText,
      fontSize: 30, fontWeight: 800, padding: '14px 30px', letterSpacing: 1,
    }
    if (P.badgeShape === 'pill') badgeStyle.borderRadius = 999
    else if (P.badgeShape === 'rect') badgeStyle.borderRadius = 10
    else if (P.badgeShape === 'stamp') { badgeStyle.borderRadius = 8; badgeStyle.border = `3px solid ${P.badgeText}`; badgeStyle.letterSpacing = 2 }
    else if (P.badgeShape === 'angled') { badgeStyle.borderRadius = 10; badgeStyle.transform = 'rotate(-7deg)'; badgeStyle.boxShadow = '0 8px 20px rgba(0,0,0,0.35)' }

    // Badge wrapper position.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const badgeWrap: any = { position: 'absolute', display: 'flex' }
    if (P.badgePos === 'tl') { badgeWrap.top = 56; badgeWrap.left = 56 }
    else if (P.badgePos === 'tr') { badgeWrap.top = 56; badgeWrap.right = 56 }
    else if (P.badgePos === 'br') { badgeWrap.bottom = 70; badgeWrap.right = 56 }
    else if (P.badgePos === 'tc') { badgeWrap.top = 56; badgeWrap.left = 0; badgeWrap.width = PIN_W; badgeWrap.justifyContent = 'center' }
    else { badgeWrap.bottom = 70; badgeWrap.left = 0; badgeWrap.width = PIN_W; badgeWrap.justifyContent = 'center' }

    const resp = new ImageResponse(
      (
        <div style={{ width: PIN_W, height: PIN_H, display: 'flex', position: 'relative' }}>
          <img src={sceneUrl} width={PIN_W} height={PIN_H} style={{ position: 'absolute', top: 0, left: 0, width: PIN_W, height: PIN_H, objectFit: 'cover' }} />

          {/* Headline cluster */}
          <div style={{
            position: 'absolute', left: 0, width: PIN_W,
            display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center',
            ...clusterPos, ...clusterBg,
          }}>
            {/* Editorial color stripe above the headline (stripe treatment only). */}
            {P.treat === 'stripe' && (
              <div style={{ display: 'flex', width: 150, height: 12, backgroundColor: P.boxColor, borderRadius: 999, marginBottom: 28 }} />
            )}
            {content}
          </div>

          {/* Trust badge */}
          {badge && (
            <div style={badgeWrap}>
              <div style={badgeStyle}>{badge}</div>
            </div>
          )}
        </div>
      ),
      {
        width: PIN_W,
        height: PIN_H,
        fonts: [{ name: 'Noto', data: FONT, weight: 400, style: 'normal' }],
      },
    )

    const png = Buffer.from(await resp.arrayBuffer())
    const out = await sharp(png).jpeg({ quality: 86 }).toBuffer()
    return { data: out.toString('base64'), mediaType: 'image/jpeg' }
  } catch (err) {
    console.error('[pin-compose] render failed:', err instanceof Error ? err.message : err)
    return null
  }
}

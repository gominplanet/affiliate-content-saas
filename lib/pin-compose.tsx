/**
 * Definitive pin renderer. The AI generates a CLEAN, text-free scene;
 * we draw the headline / benefit / badge ourselves on a fixed
 * 1000x1500 canvas via next/og (Satori). Because the text lives in
 * padded flex containers it physically cannot be clipped or bleed off
 * the edge — the recurring "text cut off" problem is impossible here.
 *
 * Fonts are vendored (base64) so the serverless runtime always has a
 * font — no system-font dependency.
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

// Overlay colour/treatment themes. One is picked per pin (caller passes a seed)
// so the headline + center band + badge don't look identical on every pin.
// `band: null` renders the benefit as outlined text with no box, for variety.
interface OverlayTheme {
  hook: string                 // headline colour
  band: string | null          // center benefit band background (null = no box)
  bandText: string             // center benefit text colour
  badgeBg: string              // bottom badge background
  badgeText: string            // bottom badge text colour
  badgeRadius: number          // 999 = pill, smaller = rounded rectangle
}
const OVERLAY_THEMES: OverlayTheme[] = [
  // 0 — neon yellow on dark scrim (the original)
  { hook: '#eaff00', band: 'rgba(0,0,0,0.55)', bandText: '#ffffff', badgeBg: '#ffffff', badgeText: '#111111', badgeRadius: 999 },
  // 1 — white headline + Pinterest-red benefit bar
  { hook: '#ffffff', band: '#e60023', bandText: '#ffffff', badgeBg: '#111111', badgeText: '#ffffff', badgeRadius: 12 },
  // 2 — electric cyan
  { hook: '#19e3ff', band: 'rgba(8,12,20,0.62)', bandText: '#ffffff', badgeBg: '#19e3ff', badgeText: '#06303a', badgeRadius: 999 },
  // 3 — hot pink headline, clean white text (no box)
  { hook: '#ff2e88', band: null, bandText: '#ffffff', badgeBg: '#ffffff', badgeText: '#111111', badgeRadius: 999 },
  // 4 — bold white headline + amber badge
  { hook: '#ffffff', band: 'rgba(0,0,0,0.58)', bandText: '#ffd400', badgeBg: '#ffd400', badgeText: '#111111', badgeRadius: 12 },
]
/** Number of overlay themes — callers seed a random index in [0, this). */
export const PIN_OVERLAY_THEME_COUNT = OVERLAY_THEMES.length

// Distinct LAYOUTS (where the text sits + which elements show). The colour
// themes above only changed hue; without layout variety every pin shares the
// same top-hook → center-band → bottom-badge skeleton and reads identical.
// Callers seed a random index in [0, PIN_LAYOUT_COUNT).
type PinLayout = 'topClassic' | 'bottomStack' | 'topMinimal' | 'bottomBanner'
const LAYOUTS: PinLayout[] = ['topClassic', 'bottomStack', 'topMinimal', 'bottomBanner']
export const PIN_LAYOUT_COUNT = LAYOUTS.length

export async function composePin(
  sceneBase64: string,
  sceneMediaType: string,
  t: PinText,
  opts?: { styleSeed?: number; layoutSeed?: number; layout?: 'standard' | 'collage' },
): Promise<{ data: string; mediaType: string } | null> {
  const theme = OVERLAY_THEMES[((opts?.styleSeed ?? 0) % OVERLAY_THEMES.length + OVERLAY_THEMES.length) % OVERLAY_THEMES.length]
  // Collage keeps a fixed clean layout (top hook + bottom badge, no band) so the
  // product grid isn't covered. Everything else rotates through the layouts.
  const layout: PinLayout = opts?.layout === 'collage'
    ? 'topMinimal'
    : LAYOUTS[((opts?.layoutSeed ?? 0) % LAYOUTS.length + LAYOUTS.length) % LAYOUTS.length]
  const hookAtBottom = layout === 'bottomStack' || layout === 'bottomBanner'
  const showBand = layout === 'topClassic'
  const benefitWithHook = layout === 'bottomStack' || layout === 'bottomBanner'
  const badgePos: 'bottom-center' | 'top-left' | 'bottom-right' =
    layout === 'topClassic' ? 'bottom-center' : layout === 'bottomStack' ? 'top-left' : layout === 'bottomBanner' ? 'bottom-center' : 'bottom-right'
  const solidHookBanner = layout === 'bottomBanner'
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

    const hook = (t.viral_hook || '').toUpperCase().trim()
    const benefit = (t.main_benefit || '').toUpperCase().trim()
    const badge = (t.trust_factor || '').toUpperCase().trim()

    const resp = new ImageResponse(
      (
        <div style={{ width: PIN_W, height: PIN_H, display: 'flex', position: 'relative' }}>
          <img src={sceneUrl} width={PIN_W} height={PIN_H} style={{ position: 'absolute', top: 0, left: 0, width: PIN_W, height: PIN_H, objectFit: 'cover' }} />

          {/* Headline cluster — anchored top OR bottom depending on layout, on a
              scrim (or a solid banner). When the layout stacks the benefit with
              the hook (bottom layouts), it renders right under the headline. */}
          <div style={{
            position: 'absolute', left: 0, width: PIN_W,
            ...(hookAtBottom ? { bottom: 0 } : { top: 0 }),
            display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center',
            padding: hookAtBottom ? '110px 80px 80px' : '70px 80px 100px',
            ...(solidHookBanner
              ? { backgroundColor: 'rgba(0,0,0,0.6)' }
              : { backgroundImage: hookAtBottom
                  ? 'linear-gradient(0deg, rgba(0,0,0,0.78) 0%, rgba(0,0,0,0.38) 60%, rgba(0,0,0,0) 100%)'
                  : 'linear-gradient(180deg, rgba(0,0,0,0.72) 0%, rgba(0,0,0,0.35) 60%, rgba(0,0,0,0) 100%)' }),
          }}>
            <div style={{
              display: 'flex', color: theme.hook, fontSize: 78, fontWeight: 800,
              letterSpacing: -1, lineHeight: 1.05, textAlign: 'center',
              textShadow: '0 4px 14px rgba(0,0,0,0.85)',
            }}>{hook}</div>
            {benefitWithHook && benefit && (
              <div style={{
                display: 'flex', marginTop: 20, color: theme.bandText,
                fontSize: 48, fontWeight: 800, lineHeight: 1.1, textAlign: 'center',
                textShadow: '0 3px 12px rgba(0,0,0,0.92)',
              }}>{benefit}</div>
            )}
          </div>

          {/* Center benefit band — only the classic layout (and never collage). */}
          {benefit && showBand && (
            <div style={{
              position: 'absolute', top: '52%', left: 0, width: PIN_W,
              display: 'flex', justifyContent: 'center', padding: '0 70px',
            }}>
              <div style={{
                display: 'flex', textAlign: 'center', color: theme.bandText,
                fontSize: 56, fontWeight: 800, lineHeight: 1.1,
                padding: theme.band ? '20px 34px' : '0', borderRadius: 18,
                backgroundColor: theme.band ?? 'transparent',
                textShadow: '0 3px 12px rgba(0,0,0,0.92)',
              }}>{benefit}</div>
            </div>
          )}

          {/* Trust badge — position rotates with the layout (bottom-center,
              top-left sticker, or bottom-right). */}
          {badge && (
            <div style={{
              position: 'absolute', display: 'flex',
              ...(badgePos === 'top-left' ? { top: 60, left: 60 }
                : badgePos === 'bottom-right' ? { bottom: 70, right: 60 }
                : { bottom: 70, left: 0, width: PIN_W, justifyContent: 'center' }),
            }}>
              <div style={{
                display: 'flex', backgroundColor: theme.badgeBg, color: theme.badgeText,
                fontSize: 30, fontWeight: 800, padding: '14px 30px',
                borderRadius: theme.badgeRadius, letterSpacing: 1,
              }}>{badge}</div>
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
  } catch {
    return null
  }
}

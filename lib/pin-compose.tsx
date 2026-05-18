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

export async function composePin(
  sceneBase64: string,
  sceneMediaType: string,
  t: PinText,
): Promise<{ data: string; mediaType: string } | null> {
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

          {/* Top header — neon, on a dark scrim. Padding = safe margin. */}
          <div style={{
            position: 'absolute', top: 0, left: 0, width: PIN_W,
            display: 'flex', justifyContent: 'center', textAlign: 'center',
            padding: '70px 80px 90px',
            backgroundImage: 'linear-gradient(180deg, rgba(0,0,0,0.72) 0%, rgba(0,0,0,0.35) 60%, rgba(0,0,0,0) 100%)',
          }}>
            <div style={{
              display: 'flex', color: '#eaff00', fontSize: 78, fontWeight: 800,
              letterSpacing: -1, lineHeight: 1.05, textAlign: 'center',
              textShadow: '0 4px 14px rgba(0,0,0,0.85)',
            }}>{hook}</div>
          </div>

          {/* Center benefit band */}
          {benefit && (
            <div style={{
              position: 'absolute', top: '52%', left: 0, width: PIN_W,
              display: 'flex', justifyContent: 'center', padding: '0 70px',
            }}>
              <div style={{
                display: 'flex', textAlign: 'center', color: '#ffffff',
                fontSize: 56, fontWeight: 800, lineHeight: 1.1,
                padding: '20px 34px', borderRadius: 18,
                backgroundColor: 'rgba(0,0,0,0.55)',
                textShadow: '0 3px 10px rgba(0,0,0,0.9)',
              }}>{benefit}</div>
            </div>
          )}

          {/* Bottom trust badge */}
          {badge && (
            <div style={{
              position: 'absolute', bottom: 70, left: 0, width: PIN_W,
              display: 'flex', justifyContent: 'center',
            }}>
              <div style={{
                display: 'flex', backgroundColor: '#ffffff', color: '#111111',
                fontSize: 30, fontWeight: 800, padding: '14px 30px',
                borderRadius: 999, letterSpacing: 1,
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

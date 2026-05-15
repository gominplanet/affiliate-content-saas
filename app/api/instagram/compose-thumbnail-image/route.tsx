import { NextResponse } from 'next/server'
import { ImageResponse } from 'next/og'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { tierAllowsSocial, type Tier } from '@/lib/tier'

/**
 * Compose a 1080×1350 (4:5) Instagram image from a horizontal YouTube
 * video's thumbnail + brand assets. We render it server-side with
 * @vercel/og's ImageResponse, upload the PNG to Supabase Storage's
 * `instagram-images` bucket, and persist the public URL on
 * `youtube_videos.instagram_image_url` so the publish route can fetch
 * it via Instagram's Content Publishing API.
 *
 * Design:
 *   - Background: brand primary_color, slight bottom gradient for contrast
 *   - Top strip: author_name (and logo when set)
 *   - Center: YouTube thumbnail at 960×540 with rounded corners
 *   - Below: video title in large bold white (clamped to 3 lines)
 *   - Bottom: "Watch the full review on YouTube →" CTA
 *
 * Pro-tier gated (matches the rest of the Instagram surface).
 */
export async function POST(request: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Pro gate — tier lives on the integrations row in this codebase
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: intRow } = await (supabase as any)
    .from('integrations').select('tier').eq('user_id', user.id).single()
  const tier = (intRow?.tier as Tier) ?? 'free'
  if (!tierAllowsSocial(tier, 'instagram')) {
    return NextResponse.json({ error: 'Instagram image posts are a Pro feature.' }, { status: 403 })
  }

  const { videoDbId } = await request.json().catch(() => ({})) as { videoDbId?: string }
  if (!videoDbId) return NextResponse.json({ error: 'Missing videoDbId' }, { status: 400 })

  // Pull the YouTube video row (thumbnail + title)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: video, error: videoErr } = await (supabase as any)
    .from('youtube_videos')
    .select('id,title,thumbnail_url')
    .eq('id', videoDbId)
    .eq('user_id', user.id)
    .single()
  if (videoErr || !video) return NextResponse.json({ error: 'Video not found' }, { status: 404 })

  // Brand assets
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: brand } = await (supabase as any)
    .from('brand_profiles')
    .select('author_name,logo_url,primary_color,secondary_color')
    .eq('user_id', user.id)
    .single()

  const primaryColor: string = brand?.primary_color || '#0071e3'
  const secondaryColor: string = brand?.secondary_color || '#34c759'
  const authorName: string = brand?.author_name || ''
  const logoUrl: string | null = brand?.logo_url || null
  const title: string = video.title || ''
  const thumbnailUrl: string = video.thumbnail_url || ''

  if (!thumbnailUrl) {
    return NextResponse.json({ error: 'Video has no thumbnail to compose from' }, { status: 400 })
  }

  // YouTube serves a few thumbnail sizes; the mqdefault returned by Data API
  // is only 320×180. Try to upgrade to maxresdefault for sharper output.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const upgradedThumb = thumbnailUrl.replace(/\/(default|mqdefault|hqdefault|sddefault)\.jpg/, '/maxresdefault.jpg')

  let imageResponse: ImageResponse
  try {
    imageResponse = new ImageResponse(
      (
        <div
          style={{
            width: '1080px',
            height: '1350px',
            display: 'flex',
            flexDirection: 'column',
            background: `linear-gradient(180deg, ${primaryColor} 0%, ${primaryColor} 60%, ${darken(primaryColor, 0.3)} 100%)`,
            fontFamily: 'sans-serif',
            color: 'white',
          }}
        >
          {/* Top strip — logo + author */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '60px 60px 0 60px',
            height: '120px',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
              {logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={logoUrl} alt="" width={72} height={72} style={{ borderRadius: '12px', objectFit: 'contain' }} />
              ) : null}
              {authorName ? (
                <span style={{ fontSize: '36px', fontWeight: 700, letterSpacing: '-0.5px' }}>{authorName}</span>
              ) : null}
            </div>
            <span style={{
              fontSize: '24px',
              fontWeight: 600,
              padding: '10px 20px',
              borderRadius: '999px',
              background: 'rgba(255,255,255,0.18)',
              color: 'white',
            }}>NEW REVIEW</span>
          </div>

          {/* Thumbnail */}
          <div style={{
            display: 'flex',
            justifyContent: 'center',
            padding: '60px',
          }}>
            <div style={{
              width: '960px',
              height: '540px',
              borderRadius: '28px',
              overflow: 'hidden',
              display: 'flex',
              boxShadow: '0 16px 60px rgba(0,0,0,0.35)',
            }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={upgradedThumb} alt="" width={960} height={540} style={{ objectFit: 'cover', width: '960px', height: '540px' }} />
            </div>
          </div>

          {/* Title */}
          <div style={{
            display: 'flex',
            padding: '0 60px',
            flex: 1,
            alignItems: 'flex-start',
          }}>
            <span style={{
              fontSize: title.length > 80 ? '52px' : '64px',
              fontWeight: 800,
              lineHeight: 1.1,
              letterSpacing: '-1.5px',
              color: 'white',
              display: '-webkit-box',
              WebkitLineClamp: 3,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}>{title}</span>
          </div>

          {/* Bottom CTA */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '40px 60px 60px 60px',
          }}>
            <span style={{
              fontSize: '28px',
              fontWeight: 700,
              color: 'white',
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
            }}>
              <span style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '48px',
                height: '48px',
                borderRadius: '12px',
                background: secondaryColor,
                fontSize: '28px',
              }}>▶</span>
              Watch the full review on YouTube
            </span>
            <span style={{ fontSize: '28px', fontWeight: 700, color: 'rgba(255,255,255,0.8)' }}>→</span>
          </div>
        </div>
      ),
      {
        width: 1080,
        height: 1350,
      }
    )
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'render failed'
    return NextResponse.json({ error: `Image render failed: ${msg}` }, { status: 500 })
  }

  // Convert ImageResponse → ArrayBuffer for the Supabase upload
  const pngBytes = new Uint8Array(await imageResponse.arrayBuffer())

  // Upload to the public instagram-images bucket via admin client (bypass RLS)
  const admin = createAdminClient()
  const path = `${user.id}/${videoDbId}.png`
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: upErr } = await (admin.storage as any).from('instagram-images').upload(path, pngBytes, {
    contentType: 'image/png',
    cacheControl: '3600',
    upsert: true,
  })
  if (upErr) {
    return NextResponse.json({ error: `Storage upload failed: ${upErr.message}` }, { status: 500 })
  }

  const { data: urlData } = admin.storage.from('instagram-images').getPublicUrl(path)
  const publicUrl = urlData.publicUrl

  // Persist on the youtube_videos row
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: updateErr } = await (supabase as any)
    .from('youtube_videos')
    .update({ instagram_image_url: publicUrl })
    .eq('id', videoDbId)
  if (updateErr) {
    return NextResponse.json({ error: `DB update failed: ${updateErr.message}` }, { status: 500 })
  }

  return NextResponse.json({ ok: true, instagramImageUrl: publicUrl })
}

/** Darken a hex color by `amount` (0–1). Returns hex. */
function darken(hex: string, amount: number): string {
  const m = hex.replace('#', '').match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i)
  if (!m) return hex
  const r = Math.max(0, Math.floor(parseInt(m[1], 16) * (1 - amount)))
  const g = Math.max(0, Math.floor(parseInt(m[2], 16) * (1 - amount)))
  const b = Math.max(0, Math.floor(parseInt(m[3], 16) * (1 - amount)))
  return '#' + [r, g, b].map(n => n.toString(16).padStart(2, '0')).join('')
}

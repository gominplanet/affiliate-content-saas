/**
 * GET /api/admin/cloudinary-check
 *
 * Admin-only diagnostic for the Cloudinary video-overlay setup. Confirms the
 * CLOUDINARY_URL (or discrete vars) is present, loaded, and valid by pinging
 * Cloudinary and reporting which cloud is configured. Never echoes the secret.
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { cloudinaryConfigured, cloudinaryPing } from '@/services/cloudinary'

export const maxDuration = 30

export async function GET() {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: caller } = await (supabase as any)
      .from('integrations').select('tier').eq('user_id', user.id).single()
    if (caller?.tier !== 'admin') {
      return NextResponse.json({ error: 'Admin only' }, { status: 403 })
    }

    const present = {
      CLOUDINARY_URL: !!process.env.CLOUDINARY_URL,
      CLOUDINARY_CLOUD_NAME: !!process.env.CLOUDINARY_CLOUD_NAME,
      CLOUDINARY_API_KEY: !!process.env.CLOUDINARY_API_KEY,
      CLOUDINARY_API_SECRET: !!process.env.CLOUDINARY_API_SECRET,
    }
    const ping = await cloudinaryPing()
    return NextResponse.json({
      ok: ping.ok,
      configured: cloudinaryConfigured(),
      envPresent: present,
      cloudName: ping.cloudName ?? null,
      error: ping.error ?? null,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'

// GET — load profile + brand data
export async function GET() {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [{ data: profile }, { data: brand }, { data: integration }] = await Promise.all([
      supabase.from('profiles').select('full_name').eq('id', user.id).single(),
      supabase.from('brand_profiles').select('author_name,author_bio,logo_url,headshot_url').eq('user_id', user.id).single(),
      supabase.from('integrations').select('notification_preferences').eq('user_id', user.id).single(),
    ])

    const fullName: string = profile?.full_name ?? ''
    const spaceIdx = fullName.indexOf(' ')
    const firstName = spaceIdx >= 0 ? fullName.slice(0, spaceIdx) : fullName
    const lastName = spaceIdx >= 0 ? fullName.slice(spaceIdx + 1) : ''

    return NextResponse.json({
      email: user.email ?? '',
      firstName,
      lastName,
      authorName: brand?.author_name ?? '',
      authorBio: brand?.author_bio ?? '',
      logoUrl: brand?.logo_url ?? '',
      headshotUrl: brand?.headshot_url ?? '',
      // notification_preferences was added to the UI before the schema; the
      // column doesn't exist on `integrations` yet. Return defaults until
      // a migration adds it.
      notifications: {
        new_video: true,
        post_published: true,
        job_failures: true,
        weekly_digest: false,
      },
    })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

// POST — save profile, brand, notifications, optionally sync to WP
export async function POST(request: Request) {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json()
    const {
      firstName, lastName, authorName, authorBio,
      logoUrl, headshotUrl, notifications,
    } = body

    const fullName = [firstName, lastName].filter(Boolean).join(' ')

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any

    await Promise.all([
      // Update profiles table
      sb.from('profiles').update({ full_name: fullName }).eq('id', user.id),
      // Update brand_profiles
      sb.from('brand_profiles').update({
        ...(authorName !== undefined ? { author_name: authorName } : {}),
        ...(authorBio !== undefined ? { author_bio: authorBio } : {}),
        ...(logoUrl !== undefined ? { logo_url: logoUrl } : {}),
        ...(headshotUrl !== undefined ? { headshot_url: headshotUrl } : {}),
      }).eq('user_id', user.id),
      // Update notification preferences
      ...(notifications
        ? [sb.from('integrations').update({ notification_preferences: notifications }).eq('user_id', user.id)]
        : []),
    ])

    // If brand data changed and WP is connected, push to WordPress
    if (authorBio !== undefined || authorName !== undefined || logoUrl !== undefined || headshotUrl !== undefined) {
      const { data: intRow } = await sb
        .from('integrations')
        .select('wordpress_url,wordpress_username,wordpress_app_password,wordpress_api_token')
        .eq('user_id', user.id)
        .single()

      if (intRow?.wordpress_url) {
        await pushProfileToWordPress({
          siteUrl: intRow.wordpress_url,
          username: intRow.wordpress_username,
          password: intRow.wordpress_app_password,
          apiToken: intRow.wordpress_api_token,
          authorName: authorName ?? '',
          authorBio: authorBio ?? '',
          logoUrl: logoUrl ?? '',
          headshotUrl: headshotUrl ?? '',
        }).catch(() => {
          // Non-fatal — WP push failure doesn't block save
        })
      }
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

async function pushProfileToWordPress({
  siteUrl, username, password, apiToken,
  authorName, authorBio, logoUrl, headshotUrl,
}: {
  siteUrl: string
  username: string
  password: string
  apiToken: string
  authorName: string
  authorBio: string
  logoUrl: string
  headshotUrl: string
}) {
  const authHeaders: HeadersInit = apiToken
    ? { 'X-API-Key': apiToken }
    : { Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}` }

  await fetch(`${siteUrl}/wp-json/affiliateos/v1/customizations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders },
    body: JSON.stringify({
      profile: { authorName, authorBio, logoUrl, headshotUrl },
    }),
  })
}

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'

export async function GET() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabase as any)
    .from('integrations')
    .select('blog_customizations')
    .eq('user_id', user.id)
    .single()

  return NextResponse.json(data?.blog_customizations ?? {})
}

export async function POST(req: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const customizations = await req.json()

  // Save to Supabase
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: dbError } = await (supabase as any)
    .from('integrations')
    .update({ blog_customizations: customizations })
    .eq('user_id', user.id)

  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 })

  // Push to WordPress if connected
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: intRow } = await (supabase as any)
    .from('integrations')
    .select('wp_site_url, wp_username, wp_app_password')
    .eq('user_id', user.id)
    .single()

  if (intRow?.wp_site_url && intRow?.wp_username && intRow?.wp_app_password) {
    try {
      const wpRes = await fetch(`${intRow.wp_site_url}/wp-json/affiliateos/v1/customizations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Basic ${Buffer.from(`${intRow.wp_username}:${intRow.wp_app_password}`).toString('base64')}`,
        },
        body: JSON.stringify(customizations),
      })
      if (!wpRes.ok) {
        const text = await wpRes.text()
        console.error('WP push failed:', text)
        // Non-fatal — data is already saved in Supabase
      }
    } catch (e) {
      console.error('WP push error:', e)
    }
  }

  return NextResponse.json({ ok: true })
}

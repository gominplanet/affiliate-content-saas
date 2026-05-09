import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'

export async function POST() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: intRow } = await (supabase as any)
    .from('integrations')
    .select('wordpress_url, blog_customizations')
    .eq('user_id', user.id)
    .single()

  if (!intRow?.wordpress_url) {
    return NextResponse.json({ error: 'WordPress not connected' }, { status: 400 })
  }

  // Re-posting the current customizations triggers litespeed_purge_all in the PHP snippet
  const res = await fetch(`${intRow.wordpress_url}/wp-json/affiliateos/v1/customizations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(intRow.blog_customizations ?? {}),
  })

  if (!res.ok) {
    const text = await res.text()
    return NextResponse.json({ error: `WordPress returned ${res.status}: ${text.slice(0, 100)}` }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}

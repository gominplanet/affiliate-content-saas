/**
 * GET /api/script/list — caller's last 30 saved scripts (light fields only)
 *
 * The script page renders these as a "Recent scripts" strip under the form
 * so creators can re-open a script they generated last week without having
 * to re-paste the URL. Full script body is excluded; the row click loads
 * /api/script/[id] on demand to keep the listing payload small.
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'

export async function GET() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from('video_scripts')
    .select('id,style,input,asin,product_title,product_image_url,created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(30)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ scripts: data || [] })
}

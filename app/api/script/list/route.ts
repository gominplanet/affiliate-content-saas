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
import { checkScriptUsage } from '@/lib/tier'

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

  // Piggyback usage so the page can render the meter (or the upsell, for
  // non-Pro tiers) on first paint without a second round-trip.
  const usage = await checkScriptUsage(supabase, user.id)
  const usageOut = usage.allowed
    ? {
        allowed: true,
        tier: usage.tier,
        used: usage.used,
        cap: usage.cap,
        remaining: usage.cap === null ? null : Math.max(0, usage.cap - usage.used),
        resetLabel: usage.resetLabel,
        upgrade: null,
        reason: null,
      }
    : {
        allowed: false,
        tier: usage.tier,
        used: usage.used,
        cap: usage.cap,
        remaining: 0,
        resetLabel: null,
        upgrade: usage.upgrade,
        reason: usage.reason,
      }

  return NextResponse.json({ scripts: data || [], usage: usageOut })
}

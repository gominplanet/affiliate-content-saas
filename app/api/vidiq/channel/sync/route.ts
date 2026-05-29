import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'

// Hardcoded snapshot from VidIQ MCP — replace with live API call once VidIQ key is connected
const SNAPSHOT = {
  channelId: 'UCvVXgMQ1ONgUIEWe6k1uUEw',
  title: 'Seb & Mich • GominPlanet',
  thumbnail: 'https://yt3.ggpht.com/jk5jVhU-5J7CfPAai7hbZOMDe5C3Q-PTCubXOB-Avrox3NI0VOYIWoQOK6BZ9pQmMbVEHhfPll8=s240-c-k-c0x00ffffff-no-rj',
  currentStats: { subscribers: 2090, views: 3655749, videos: 2816 },
  growth: { subscribersGained: 70, viewsGained: 1126439, videosPublished: 128 },
  dailyStats: [],
  syncedAt: 'just now',
}

export async function POST() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const snapshot = { ...SNAPSHOT, syncedAt: 'just now' }

  // Upsert into integrations — store snapshot as JSONB
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any)
    .from('integrations')
    .upsert(
      { user_id: user.id, vidiq_snapshot: snapshot as any },
      { onConflict: 'user_id' },
    )

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json(snapshot)
}

export async function GET() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabase as any)
    .from('integrations')
    .select('vidiq_snapshot')
    .eq('user_id', user.id)
    .single()

  return NextResponse.json(data?.vidiq_snapshot ?? null)
}

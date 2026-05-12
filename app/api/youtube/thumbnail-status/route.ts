import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'

export const maxDuration = 10

// Polls fal.ai queue status for a PuLID request.
// Returns { status: 'IN_QUEUE' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED', thumbnailUrl? }
export async function GET(request: Request) {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const requestId = searchParams.get('requestId')
    const model = searchParams.get('model') ?? 'fal-ai/pulid'

    if (!requestId) {
      return NextResponse.json({ error: 'Missing requestId' }, { status: 400 })
    }

    const falKey = process.env.FAL_KEY
    if (!falKey) {
      return NextResponse.json({ error: 'FAL_KEY not configured' }, { status: 500 })
    }

    // Check queue status
    const statusRes = await fetch(
      `https://queue.fal.run/${model}/requests/${requestId}/status`,
      { headers: { Authorization: `Key ${falKey}` } }
    )
    const statusData = await statusRes.json() as { status?: string; error?: string }
    console.log('[thumbnail-status] requestId:', requestId, 'status:', statusData.status)

    if (!statusRes.ok || statusData.error) {
      return NextResponse.json({
        status: 'FAILED',
        error: statusData.error ?? `Status check failed: ${statusRes.status}`,
      })
    }

    const queueStatus = statusData.status ?? 'IN_QUEUE'

    if (queueStatus === 'COMPLETED') {
      // Fetch the actual result
      const resultRes = await fetch(
        `https://queue.fal.run/${model}/requests/${requestId}`,
        { headers: { Authorization: `Key ${falKey}` } }
      )
      const resultData = await resultRes.json() as { images?: Array<{ url: string }>; error?: string }

      if (!resultRes.ok || resultData.error) {
        return NextResponse.json({
          status: 'FAILED',
          error: resultData.error ?? 'Failed to fetch result',
        })
      }

      const thumbnailUrl = resultData.images?.[0]?.url ?? null
      if (!thumbnailUrl) {
        return NextResponse.json({ status: 'FAILED', error: 'No image URL in result' })
      }

      return NextResponse.json({ status: 'COMPLETED', thumbnailUrl })
    }

    // Still running
    return NextResponse.json({ status: queueStatus })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[thumbnail-status]', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

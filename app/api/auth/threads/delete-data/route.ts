/**
 * POST /api/auth/threads/delete-data — Meta's data-deletion callback.
 *
 * Meta sends a `signed_request` form field (base64url JSON + HMAC-SHA256).
 * We MUST verify the signature with FACEBOOK_APP_SECRET (Meta uses the same
 * app secret across Facebook / Threads). If verification fails we 400 —
 * an unsigned POST is either a misconfiguration or someone trying to wipe
 * a creator's Threads token by guessing their `threads_user_id`.
 *
 * On success we null out the Threads tokens for the matching user and
 * return Meta's expected `{ url, confirmation_code }` payload so the user
 * has a page to land on confirming the deletion happened.
 *
 * Spec: https://developers.facebook.com/docs/development/create-an-app/app-dashboard/data-deletion-callback
 */
import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createHmac, timingSafeEqual } from 'crypto'

function base64UrlDecode(s: string): Buffer {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)
  return Buffer.from(padded, 'base64')
}

/** Verify Meta's signed_request and return the decoded payload, or null
 *  if the signature is bad. */
function verifySignedRequest(signedRequest: string, secret: string): Record<string, unknown> | null {
  try {
    const [encodedSig, encodedPayload] = signedRequest.split('.')
    if (!encodedSig || !encodedPayload) return null
    const sig = base64UrlDecode(encodedSig)
    const expected = createHmac('sha256', secret).update(encodedPayload).digest()
    if (sig.length !== expected.length) return null
    if (!timingSafeEqual(sig, expected)) return null
    const payload = JSON.parse(base64UrlDecode(encodedPayload).toString('utf8'))
    if (typeof payload !== 'object' || payload === null) return null
    return payload as Record<string, unknown>
  } catch {
    return null
  }
}

export async function POST(request: NextRequest) {
  const secret = process.env.FACEBOOK_APP_SECRET || process.env.META_APP_SECRET
  if (!secret) {
    return NextResponse.json({ error: 'Server not configured' }, { status: 500 })
  }

  // Meta sends signed_request as application/x-www-form-urlencoded.
  let signedRequest: string | null = null
  try {
    const ct = request.headers.get('content-type') || ''
    if (ct.includes('application/x-www-form-urlencoded') || ct.includes('multipart/form-data')) {
      const form = await request.formData()
      const v = form.get('signed_request')
      signedRequest = typeof v === 'string' ? v : null
    } else {
      // Fall through for JSON callers (testing / local).
      const body = await request.json().catch(() => ({}))
      signedRequest = typeof body.signed_request === 'string' ? body.signed_request : null
    }
  } catch {
    signedRequest = null
  }

  if (!signedRequest) {
    return NextResponse.json({ error: 'Missing signed_request' }, { status: 400 })
  }

  const payload = verifySignedRequest(signedRequest, secret)
  if (!payload) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  // Meta puts the user id on the payload under `user_id` (Threads user id).
  const userId = typeof payload.user_id === 'string' ? payload.user_id : null

  if (userId) {
    const supabase = await createServerClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase as any).from('integrations').update({
      threads_access_token: null,
      threads_user_id: null,
    }).eq('threads_user_id', userId)
  }

  // Confirmation code — Meta uses this so the user can verify deletion went
  // through. We emit a stable code derived from the user id + a timestamp.
  const confirmationCode = `mvp_${userId ?? 'unknown'}_${Date.now()}`
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://www.mvpaffiliate.io'
  return NextResponse.json({
    url: `${appUrl}/threads-deletion-confirmed?id=${encodeURIComponent(confirmationCode)}`,
    confirmation_code: confirmationCode,
  })
}

export async function GET() {
  return NextResponse.json({ success: true })
}

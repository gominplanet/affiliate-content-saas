// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// POST /api/labs/unlock — validate the shared LABS password and, on success,
// set the httpOnly `labs_unlocked` cookie that middleware checks for LABS
// pages/APIs. Requires a logged-in session (LABS is on top of tier gates). The
// cookie stores a SHA-256 of the password, never the raw value.

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { LABS_COOKIE, labsTokenFor, expectedLabsToken } from '@/lib/labs-access'

export async function POST(request: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const expected = await expectedLabsToken()
  // No password configured → the gate is open; nothing to unlock.
  if (!expected) return NextResponse.json({ ok: true, open: true })

  const body = await request.json().catch(() => ({}))
  const password = typeof body?.password === 'string' ? body.password : ''
  if (!password) return NextResponse.json({ error: 'Password required' }, { status: 400 })

  const token = await labsTokenFor(password)
  if (token !== expected) {
    return NextResponse.json({ error: 'That password is not correct.' }, { status: 401 })
  }

  const res = NextResponse.json({ ok: true })
  res.cookies.set(LABS_COOKIE, expected, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 90, // 90 days
  })
  return res
}

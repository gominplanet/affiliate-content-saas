// The member-facing Newsletter is retired (lib/feature-flags
// NEWSLETTER_FOR_MEMBERS). Every member tool route under /api/newsletter calls
// this right after its auth check and returns what it gives back, so a member
// gets a plain 410 before any work is done. Admin keeps the tool.
//
// NOT called by the public routes (subscribe, unsubscribe, confirm,
// resend-webhook): those serve forms, emailed links and Resend, and MVP's own
// list still runs through them.

import { NextResponse } from 'next/server'
import { NEWSLETTER_FOR_MEMBERS } from '@/lib/feature-flags'

export const NEWSLETTER_RETIRED_ERROR = 'The newsletter has been retired.'

export async function newsletterRetired(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  userId: string,
): Promise<NextResponse | null> {
  if (NEWSLETTER_FOR_MEMBERS) return null
  const { data } = await supabase.from('integrations').select('tier').eq('user_id', userId).maybeSingle()
  if ((data as { tier?: string } | null)?.tier === 'admin') return null
  return NextResponse.json({ error: NEWSLETTER_RETIRED_ERROR }, { status: 410 })
}

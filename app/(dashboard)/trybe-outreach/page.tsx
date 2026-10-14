// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// The old address of TRYBE (Seb, 2026-10-14: "let's also not have the link
// say trybe outreach.. just Trybe"). Links already out there (the Today list,
// What's new, bookmarks) land on /trybe, on the same tab.

import { redirect } from 'next/navigation'

export default async function TrybeOutreachMoved({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams
  const q = new URLSearchParams()
  for (const [k, v] of Object.entries(sp)) for (const one of Array.isArray(v) ? v : v != null ? [v] : []) q.append(k, one)
  const qs = q.toString()
  redirect(`/trybe${qs ? `?${qs}` : ''}`)
}

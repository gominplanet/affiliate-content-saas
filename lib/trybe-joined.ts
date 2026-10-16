// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// THE BRANDS YOU JOINED ON TRYBE, read live by SCOUT (TRYBE's brands/stats).
// TRYBE's Discover list leaves these out, so MVP's copy of TRYBE needs them
// to tell "you joined it" from "it left TRYBE" (app/api/labs/trybe
// healJoined). Null when SCOUT could not read them: never taken as "none".
import { requestTrybeApi } from '@/lib/extension-frame'
import { readBrandStats } from '@/lib/trybe-mybrands'

export async function readJoinedBrandIds(): Promise<string[] | null> {
  try {
    const r = await requestTrybeApi('GET', '/backend/api/creator/v2/brands/stats?period=all')
    if (!r.ok || r.json == null) return null
    return readBrandStats(r.json).map((b) => b.id).filter(Boolean)
  } catch {
    return null
  }
}

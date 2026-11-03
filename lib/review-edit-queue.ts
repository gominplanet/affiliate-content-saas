// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// TURNS BETWEEN MEMBERS (Seb, 2026-11-03: "go with 100 and 25 for free week",
// with the editor about to open to Pro). The video server reads and makes one
// video at a time for every member together. Taken in the order they arrived,
// one member's batch of twenty went before everyone who came after it, so a
// single video could wait an hour behind someone else's batch.
//
// Now MVP takes turns: the next video is the oldest one of the member served
// longest ago (never served counts as longest ago). A member with twenty
// waiting gets one, then everyone else waiting gets one, then the next of
// theirs. The same order says each member where their videos stand in line.
// Pure, tested in scripts/test-review-edit-queue.

export interface QueueRow {
  id: string
  user_id: string
  /** When it joined this line (ISO): added, for reading; read, for making. */
  at: string
}

/** The order the line is worked through, given when each member was last
 *  served (epoch ms; a member missing from it has not been served lately).
 *  Every row is in the answer once. Pure. */
export function fairOrder(rows: QueueRow[], lastServed: Record<string, number> = {}): string[] {
  const byUser = new Map<string, QueueRow[]>()
  for (const r of [...rows].sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || a.id.localeCompare(b.id))) {
    const list = byUser.get(r.user_id) ?? []
    list.push(r)
    byUser.set(r.user_id, list)
  }
  const served = new Map<string, number>()
  for (const u of byUser.keys()) served.set(u, Number.isFinite(lastServed[u]) ? lastServed[u] : -Infinity)
  // Each turn given here comes after every real time, in the order given.
  let tick = Math.max(Date.now(), ...Object.values(lastServed).filter(Number.isFinite)) + 1
  const out: string[] = []
  while (out.length < rows.length) {
    let pick: string | null = null
    for (const [u, list] of byUser) {
      if (!list.length) continue
      if (pick === null) { pick = u; continue }
      const a = served.get(u)!, b = served.get(pick)!
      if (a < b || (a === b && Date.parse(list[0].at) < Date.parse(byUser.get(pick)![0].at))) pick = u
    }
    if (pick === null) break
    out.push(byUser.get(pick)!.shift()!.id)
    served.set(pick, tick++)
  }
  return out
}

/** When each member was last served: the latest of the times given per row.
 *  Pure. */
export function lastServedBy(rows: Array<{ user_id: string; at: string | null | undefined }>): Record<string, number> {
  const out: Record<string, number> = {}
  for (const r of rows) {
    const t = Date.parse(String(r.at ?? ''))
    if (Number.isFinite(t) && !(t <= (out[r.user_id] ?? -Infinity))) out[r.user_id] = t
  }
  return out
}

/** How many videos go before each of these ids in the line: its place in the
 *  fair order, plus those already on the server. Pure. */
export function placesInLine(order: string[], ids: string[], onServer = 0): Record<string, number> {
  const at = new Map(order.map((id, i) => [id, i]))
  const out: Record<string, number> = {}
  for (const id of ids) { const i = at.get(id); if (i != null) out[id] = i + onServer }
  return out
}

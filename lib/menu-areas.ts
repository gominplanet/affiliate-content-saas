// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// THE LEFT MENU'S AREAS, REDRAWN (labs-preview menu_v2; Seb, 2026-11-08: "the
// left column ... I think it's a lot cleaner now, but it's still not organized
// the way I want it to be organized. It's a little bit all over the place";
// 2026-11-09: "go ahead and do everything that you're supposed to").
//
// What was all over the place: Share held eleven tools of four kinds (social
// posts, comments under your videos, your links, and the Deals Hub, which
// writes blog posts); Make videos mixed the tools that make a video with the
// ones that post it; Work with brands held two. The areas are now one job
// each, in the order a creator works:
//
//   Find products   where the products and the paying brands are
//   Make videos     the tools that make the video
//   Post videos     sending it to YouTube and Amazon, and the comment under it
//   Social          posts, designs and DMs on the networks, and your links
//   Blog            everything that ends up as a post on your site
//   Brand deals     pitching brands and their replies
//
// TRYBE stays its own area, right under the Dashboard (the shell moves it).
// Rows keep their gates and their tabs: only the area they sit in changes, so
// nothing anyone can open is lost and nothing new is opened. A row the plan
// below does not name stays in the area it was in, or the one that took that
// area's place, so a tool added later is never dropped. Pure.

export interface MenuArea { label: string; rows: string[] }

export const MENU_V2: MenuArea[] = [
  { label: 'Find products', rows: ['Product research', 'Deal Radar', 'Brand campaigns', 'Partner programs', 'Idea lists', 'TRYBE'] },
  { label: 'Make videos', rows: ['Video Scripts', 'Scriptwriter', 'Review Editor', 'Thumbnails', 'Clip Factory', 'Amazon Live'] },
  { label: 'Post videos', rows: ['Drop', 'Bulk Amazon upload', 'YouTube Co-Pilot', 'YouTube comments'] },
  { label: 'Social', rows: ['Social Push', 'Social designs', 'Social Launch Kit', 'Instagram Auto-DM', 'Meta Hub', 'Group Post Queue', 'Hashtag insights', 'Link in Bio', 'Passport links'] },
  { label: 'Blog', rows: ['Blog posts', 'Deals Hub', 'Comparisons and guides', 'Articles', 'Ended deals', 'SEO and indexing', 'Ads', 'Blog design', 'Newsletter'] },
  { label: 'Brand deals', rows: ['Brand pitches', 'Brand inbox'] },
]

/** The areas the plan redraws; every other area (the Dashboard row, Your
 *  setup, Help, Labs, Admin, the Amazon plan's More with Pro) is kept as it
 *  is, where it is. */
export const REDRAWN = ['Find products', 'Make videos', 'Blog', 'Share', 'Work with brands']
/** Where a row the plan does not name goes, by the area it came from. */
const TAKEN_OVER: Record<string, string> = { Share: 'Social', 'Work with brands': 'Brand deals' }

/** The menu with its job areas redrawn by `plan`. Pure. */
export function regroupMenu<I extends { label: string }, G extends { label: string; items: I[] }>(groups: G[], plan: MenuArea[] = MENU_V2): G[] {
  const first = groups.findIndex((g) => REDRAWN.includes(g.label))
  if (first < 0) return groups
  const template = groups[first]
  const byLabel = new Map<string, { item: I; from: string }>()
  for (const g of groups) if (REDRAWN.includes(g.label)) for (const it of g.items) if (!byLabel.has(it.label)) byLabel.set(it.label, { item: it, from: g.label })
  const placed = new Set<string>()
  const areas: G[] = plan.map((a) => {
    const items: I[] = []
    for (const r of a.rows) { const hit = byLabel.get(r); if (hit) { items.push(hit.item); placed.add(r) } }
    return { ...template, label: a.label, items }
  })
  // A row the plan does not name: its own area, or the one that took its place.
  for (const [label, { item, from }] of byLabel) {
    if (placed.has(label)) continue
    const home = areas.find((a) => a.label === from) ?? areas.find((a) => a.label === TAKEN_OVER[from]) ?? areas[areas.length - 1]
    home.items.push(item)
  }
  const kept = groups.filter((g) => !REDRAWN.includes(g.label))
  const before = kept.filter((g) => groups.indexOf(g) < first)
  const after = kept.filter((g) => groups.indexOf(g) > first)
  return [...before, ...areas.filter((a) => a.items.length > 0), ...after]
}

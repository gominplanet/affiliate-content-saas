// Same-product dedupe for Creator Connections campaigns.
//
// A single product is routinely listed under several campaign ids: sometimes
// named by slot ("soap dispenser-50%-1" / "-2"), sometimes under totally
// different marketing headlines ("Tech Meets Cuddles Smart Peppa!!", "VIRAL:
// They're Already Fans", "Smart Peppa = Smarter Gifting"). Showing all of them
// clutters every campaign surface, so we collapse them to one card.
//
// Shared by the daily digest (/api/cc-digest) and the CC Campaigns browser
// (/api/cc/campaigns) so both dedupe identically.

/** Normalize a product title to a stable identity token: lowercased, alnum
 *  only, first 8 words. '' when too short to be meaningful.
 *
 *  Brands list the SAME product under several campaign slots whose names differ
 *  ONLY by a commission marker or a trailing variant number ("soap dispenser
 *  -50%-1" vs "-2"). Those are naming artifacts, not different products, so
 *  strip them BEFORE tokenizing or the two never collapse. */
export function normTitle(s: string | null | undefined): string {
  const cleaned = (s || '')
    .toLowerCase()
    .replace(/\b\d{1,3}\s*%/g, ' ')            // commission marker: "50%", "50 %"
    .replace(/\b\d{1,3}\s*percent\b/g, ' ')    // spelled out: "50 percent"
    .replace(/\bcommissions?\b/g, ' ')          // the word "commission(s)" itself
    .replace(/[-#]\s*\d{1,3}\s*$/g, ' ')        // trailing variant slot: "-1", "#2"
    .replace(/\bv\s*\d{1,3}\s*$/g, ' ')         // trailing "v2" / "v 3"
  const t = cleaned.replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean).slice(0, 8).join(' ')
  return t.length >= 6 ? t : ''
}

/** All "same product" fingerprints for a campaign. Two campaigns are the SAME
 *  item if they share ANY of these, so callers union-find on the whole set
 *  instead of picking one priority key. Signals: a real ASIN, brand+image,
 *  brand+clean-title, and brand+price+rating.
 *
 *  brand+price+rating is what catches a brand listing ONE product under several
 *  UNRELATED marketing headlines — the names share no words and the images
 *  differ, but the product is identical so its price + rating match. Distinct
 *  products from the same brand almost always differ in price or rating, so the
 *  collision risk is low and a rare false merge only hides the lower-commission
 *  twin. */
export function productSignals(x: {
  campaignId: string; brand: string | null; asin?: string | null; name?: string | null
  imageUrl?: string | null; priceCents?: number | null; rating?: number | null
}): string[] {
  const b = (x.brand || '').trim().toLowerCase()
  const out: string[] = []
  const asin = (x.asin || '').toUpperCase()
  if (/^[A-Z0-9]{10}$/.test(asin)) out.push(`a:${asin}`)
  const nt = normTitle(x.name)
  if (b && nt) out.push(`bt:${b}|${nt}`)
  const img = (x.imageUrl || '').split('?')[0]
  if (b && img) out.push(`bi:${b}|${img}`)
  if (b && x.priceCents != null && x.rating != null) out.push(`bpr:${b}|${x.priceCents}|${x.rating}`)
  if (!out.length) out.push(`c:${x.campaignId}`)
  return out
}

/** Group items that share ANY signal (union-find). Groups are returned in the
 *  first-seen order of each group's earliest member, so downstream ordering is
 *  stable. */
export function groupBySignals<T>(items: T[], sigsOf: (t: T) => string[]): T[][] {
  const parent = items.map((_, i) => i)
  const find = (i: number): number => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i] } return i }
  const owner = new Map<string, number>()
  items.forEach((it, i) => {
    for (const s of sigsOf(it)) {
      const o = owner.get(s)
      if (o == null) owner.set(s, i)
      else { const ra = find(i), rb = find(o); if (ra !== rb) parent[ra] = rb }
    }
  })
  const groups = new Map<number, T[]>()
  const order: number[] = []
  items.forEach((it, i) => {
    const r = find(i)
    if (!groups.has(r)) { groups.set(r, []); order.push(r) }
    groups.get(r)!.push(it)
  })
  return order.map((r) => groups.get(r)!)
}

// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// EVERY PRO TOOL, LOCKED, FOR THE LEGACY PLANS (Seb, 2026-11-08: "the legacy
// people that are on the creator or studio tier that doesn't exist anymore.
// They should be able to see everything, all the new stuff that the full
// membership offers, but without having access to it ... If they click on
// something ... then they get asked to upgrade to the full membership").
//
// The shell draws its menu for a plan, so it can draw it for the member and for
// Pro. lockProRows puts every row Pro opens and the member's plan does not in
// its place, locked; lockedPageAt says which locked tool an address is, so the
// shell shows the Pro upgrade panel there instead of the page. The menu stays
// a hint and every route still enforces the plan: a locked row only decides
// what the member is shown.

import { featureLine } from './feature-lines'

export interface LockableItem {
  href: string
  label: string
  badge?: number | string
  gate?: boolean
  external?: boolean
  locked?: boolean
  tabs?: LockableItem[]
}

export interface LockableGroup<I extends LockableItem = LockableItem> {
  label: string
  items: I[]
}

/** Staff sections: never offered to a member. */
const STAFF = new Set(['Labs', 'Admin'])

/** The member's menu with every row Pro opens and the member's plan does not,
 *  in its place, locked. `mine` and `pro` are the same menu drawn for the two
 *  plans, so rows line up by place, and each pair is checked by label (a row
 *  that does not match is left as the member has it). A tab Pro opens on a row
 *  the member already has is locked the same way. */
export function lockProRows<I extends LockableItem, G extends LockableGroup<I>>(mine: G[], pro: G[]): G[] {
  return mine.map((g, gi) => {
    const pg = pro[gi]
    if (!pg || pg.label !== g.label || STAFF.has(g.label)) return g
    const items = g.items.map((it, i) => {
      const p = pg.items[i]
      if (!p || p.label !== it.label || p.href !== it.href || p.gate === false || p.external) return it
      if (it.gate === false) {
        return {
          ...p,
          gate: true,
          locked: true,
          badge: 'Pro',
          tabs: p.tabs?.map((t) => (t.gate === false ? t : { ...t, badge: undefined, locked: true })),
        } as I
      }
      if (!it.tabs || !p.tabs) return it
      const tabs = it.tabs.map((t, ti) => {
        const pt = p.tabs![ti]
        return t.gate === false && pt && pt.href === t.href && pt.gate !== false ? { ...pt, gate: true, badge: undefined, locked: true } : t
      })
      return { ...it, tabs } as I
    })
    return { ...g, items }
  })
}

export interface LockedPage {
  /** The locked page's own address. */
  href: string
  /** What the upgrade panel calls it: the row, or the locked tab of an open row. */
  label: string
  /** The menu row it belongs to. */
  rowHref: string
}

const pathOf = (h: string) => h.split(/[?#]/)[0]

/** The locked tool this address opens, if any: the menu address that matches
 *  it most closely (the page itself, or the deepest row or tab it sits under)
 *  is a locked one. On a tie the open row wins, so nothing the member's plan
 *  opens is ever covered by a lock. */
export function lockedPageAt(groups: LockableGroup[], pathname: string): LockedPage | undefined {
  const under = (p: string) => pathname === p || pathname.startsWith(`${p}/`)
  let best: { len: number; page?: LockedPage } = { len: -1 }
  const consider = (href: string, page?: LockedPage) => {
    const p = pathOf(href)
    if (!p || p === '/' || !under(p)) return
    if (p.length > best.len || (p.length === best.len && !page)) best = { len: p.length, page }
  }
  for (const g of groups) for (const it of g.items) {
    if (it.gate === false || it.external) continue
    for (const x of [it, ...(it.tabs ?? [])]) {
      if (x.gate === false) continue
      consider(x.href, it.locked || x.locked ? { href: x.href, label: it.locked ? it.label : x.label, rowHref: it.href } : undefined)
    }
  }
  return best.page
}

/** What the upgrade panel says under "<tool> is part of Pro": what the tool
 *  does (its menu line), then what Pro is. */
export function proLockedBody(page: LockedPage, tier: string): string {
  const line = featureLine(page.href) ?? featureLine(page.rowHref)
  const plan = tier === 'studio' ? 'Studio' : 'Creator'
  return `${line ? `${line} ` : ''}Pro is the full MVP membership: every tool in this menu, open. Moving from ${plan} to Pro keeps everything you have made in MVP.`
}

/** The legacy plans that see Pro's tools locked. */
export function seesProLocked(tier: string): boolean {
  return tier === 'creator' || tier === 'studio'
}

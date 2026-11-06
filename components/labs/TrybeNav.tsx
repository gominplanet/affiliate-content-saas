'use client'
// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// THE NEW TRYBE'S MENU (Seb, 2026-11-06: "everything needs to have a place and
// a reason to be there"). Home, then the three jobs in the order a creator
// does them: get brands, make the videos, keep track.
//
// TWO LEVELS, NEVER A SCROLLER (Seb, 2026-11-06: "i do not like the slider for
// the menu selection.. need to figure something else better visually"). One
// bar of thirteen pages ran wider than the screen and scrolled sideways under
// a scrollbar. Now the four jobs sit side by side as big buttons (two by two
// on a phone), each saying what waits in it, and the pages of the open job sit
// under them as tabs that wrap. Nothing is hidden off the edge.

import { LayoutDashboard, Search, Rocket, Send, Inbox, Clapperboard, UploadCloud, CalendarDays, Lightbulb, BarChart3, ListChecks, Bell, Megaphone, ChevronRight, type LucideIcon } from 'lucide-react'
import type { Tab } from '@/components/labs/TrybeOutreach'

type Item = { label: string; icon: LucideIcon; tabs: Tab[]; count?: 'queue' | 'unread' }
type Group = { id: string; label: string; icon: LucideIcon; hint: string; items: Item[] }
const GROUPS: Group[] = [
  { id: 'home', label: 'Home', icon: LayoutDashboard, hint: 'What needs you today', items: [{ label: 'Home', icon: LayoutDashboard, tabs: ['home'] }] },
  { id: 'get', label: 'Get brands', icon: Megaphone, hint: 'Find, message, answer', items: [
    { label: 'Find brands', icon: Search, tabs: ['find'] },
    { label: 'Star brands', icon: Rocket, tabs: ['stars'] },
    { label: 'Outreach', icon: Send, tabs: ['queue', 'sent'], count: 'queue' },
    { label: 'Inbox', icon: Inbox, tabs: ['inbox'], count: 'unread' },
  ] },
  { id: 'make', label: 'Make videos', icon: Clapperboard, hint: 'Scripts, filming, uploads', items: [
    // ONE SCRIPT TAB (Seb, 2026-11-06: "Under Tribe, it should only be brand
    // scripts"): pick the brand, pick the product, and the script agent writes.
    { label: 'Brand scripts', icon: Clapperboard, tabs: ['create'] },
    { label: 'Upload', icon: UploadCloud, tabs: ['upload'] },
    { label: 'This week', icon: CalendarDays, tabs: ['week'] },
    { label: 'What’s working', icon: Lightbulb, tabs: ['working'] },
  ] },
  { id: 'track', label: 'Track', icon: BarChart3, hint: 'Earnings and what changed', items: [
    { label: 'Earnings', icon: BarChart3, tabs: ['analytics', 'brands'] },
    { label: 'Submissions', icon: ListChecks, tabs: ['submissions'] },
    { label: 'What changed', icon: Bell, tabs: ['changes'] },
  ] },
]

/** The job a page belongs to (Home when it is not in the menu). Pure. */
export function groupOf(tab: Tab): string {
  return (GROUPS.find((g) => g.items.some((it) => it.tabs.includes(tab))) ?? GROUPS[0]).id
}

export default function TrybeNav({ tab, queue, unread, go }: { tab: Tab; queue: number; unread: number; go: (t: Tab) => void }) {
  const open = groupOf(tab)
  const countOf = (it: Item) => (it.count === 'queue' ? queue : it.count === 'unread' ? unread : 0)
  const firstOf = (it: Item): Tab => (it.count === 'queue' ? (queue ? 'queue' : 'sent') : it.tabs[0])
  const active = GROUPS.find((g) => g.id === open)!
  return (
    <nav aria-label="TRYBE" className="rounded-2xl overflow-hidden" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
      {/* The four jobs. */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-1.5 p-1.5">
        {GROUPS.map((g) => {
          const on = g.id === open
          const waiting = g.items.reduce((n, it) => n + countOf(it), 0)
          const Icon = g.icon
          return (
            <button key={g.id} type="button" aria-current={on ? 'true' : undefined}
              onClick={() => { if (!on) go(firstOf(g.items[0])) }}
              className="flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-left transition-colors focus-visible:outline focus-visible:outline-2 hover:brightness-[1.03]"
              style={on
                ? { background: 'var(--accent)', color: '#fff', outlineColor: 'var(--accent)' }
                : { background: 'var(--surface-2)', color: 'var(--text)', outlineColor: 'var(--accent)' }}>
              <span className="shrink-0 grid place-items-center w-8 h-8 rounded-lg" style={on ? { background: 'rgba(255,255,255,0.18)' } : { background: 'var(--surface)', color: 'var(--accent-text, var(--accent))' }}>
                <Icon size={16} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5 text-[14px] font-bold leading-tight">
                  {g.label}
                  {/* THE SIDEBAR'S RED NUMBER, HERE TOO (Seb, 2026-11-06: "the
                      little number 2 should also be duplicated where it says
                      get brands ... so people know where to go to clear
                      that number"): the same unread replies, in the same red. */}
                  {g.items.some((it) => it.count === 'unread') && unread > 0 && <UnreadDot n={unread} />}
                </span>
                {/* What waits shows at every width; the plain hint only where it fits. */}
                <span className={`${waiting > 0 ? 'block' : 'hidden sm:block'} text-[11.5px] leading-tight mt-0.5 truncate`} style={{ color: on ? 'rgba(255,255,255,0.85)' : waiting > 0 ? 'var(--accent-text, var(--accent))' : 'var(--text-3)', fontWeight: waiting > 0 ? 600 : 400 }}>
                  {waiting > 0 ? <>{waiting} waiting<span className="hidden sm:inline"> on you</span></> : g.hint}
                </span>
              </span>
            </button>
          )
        })}
      </div>
      {/* THE PAGES OF THE OPEN JOB (Seb, 2026-11-06: "needs to be more
          visible.. especially the smaller lower sub menus... needs color,
          boldness.. something so that users dont search for it"). A strip in
          the look's own colour under the four jobs, named for the job it
          opens, with each page a bold button: the page you are on solid, the
          others white with a coloured icon. They wrap; nothing scrolls. */}
      {active.items.length > 1 && (
        <div role="tablist" aria-label={active.label} className="flex flex-wrap items-center gap-2 px-3 py-2.5"
          style={{ background: 'rgb(var(--brand-rgb) / 0.10)', borderTop: '1px solid rgb(var(--brand-rgb) / 0.25)' }}>
          <span className="hidden sm:inline-flex items-center gap-1 text-[11px] font-bold uppercase pl-1 pr-1.5" style={{ color: 'var(--accent-text, var(--accent))', letterSpacing: '0.08em' }}>
            {active.label} <ChevronRight size={13} aria-hidden="true" />
          </span>
          {active.items.map((it) => {
            const on = it.tabs.includes(tab)
            const n = countOf(it)
            const Icon = it.icon
            return (
              <button key={it.label} type="button" role="tab" aria-selected={on}
                onClick={() => go(firstOf(it))}
                className="inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-[14px] font-bold whitespace-nowrap transition hover:brightness-[1.04] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
                style={on
                  ? { background: 'var(--accent)', color: '#fff', border: '1px solid var(--accent)', boxShadow: '0 2px 10px rgb(var(--brand-rgb) / 0.35)', outlineColor: 'var(--accent)' }
                  : { background: 'var(--surface)', color: 'var(--text)', border: '1px solid rgb(var(--brand-rgb) / 0.30)', outlineColor: 'var(--accent)' }}>
                <Icon size={16} style={on ? undefined : { color: 'var(--accent-text, var(--accent))' }} />
                {it.label}
                {n > 0 && (it.count === 'unread' ? <UnreadDot n={n} />
                  : <span className="text-[11px] font-bold rounded-full px-1.5 min-w-[20px] text-center" style={on ? { background: '#fff', color: 'var(--accent)' } : { background: 'var(--accent)', color: '#fff' }}>{n}</span>)}
              </button>
            )
          })}
        </div>
      )}
    </nav>
  )
}

/** Unread replies: the sidebar's red pill, so the two read as one number. */
function UnreadDot({ n }: { n: number }) {
  return (
    <span className="text-[11px] tabular-nums min-w-[18px] h-[18px] px-1.5 rounded-full font-bold inline-flex shrink-0 items-center justify-center text-white"
      style={{ backgroundColor: '#ff3b30' }} aria-label={`${n} unread repl${n === 1 ? 'y' : 'ies'}`}>
      {n > 99 ? '99+' : n}
    </span>
  )
}

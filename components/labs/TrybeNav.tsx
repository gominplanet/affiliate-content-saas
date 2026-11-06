'use client'
// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// THE NEW TRYBE'S MENU (Seb, 2026-11-06: "everything needs to have a place and
// a reason to be there"). One bar instead of three columns of tiles: Home,
// then the three jobs in the order a creator does them, get brands, make the
// videos, keep track. What waits on you shows as a count. On a phone the bar
// scrolls sideways inside itself; the page never does.

import { LayoutDashboard, Search, Rocket, Send, Inbox, Clapperboard, UploadCloud, CalendarDays, Lightbulb, BarChart3, ListChecks, Bell, type LucideIcon } from 'lucide-react'
import type { Tab } from '@/components/labs/TrybeOutreach'

type Item = { label: string; icon: LucideIcon; tabs: Tab[]; count?: 'queue' | 'unread' }
const GROUPS: Array<{ label: string | null; items: Item[] }> = [
  { label: null, items: [{ label: 'Home', icon: LayoutDashboard, tabs: ['home'] }] },
  { label: 'Get brands', items: [
    { label: 'Find brands', icon: Search, tabs: ['find'] },
    { label: 'Star brands', icon: Rocket, tabs: ['stars'] },
    { label: 'Outreach', icon: Send, tabs: ['queue', 'sent'], count: 'queue' },
    { label: 'Inbox', icon: Inbox, tabs: ['inbox'], count: 'unread' },
  ] },
  { label: 'Make videos', items: [
    { label: 'Scripts', icon: Clapperboard, tabs: ['create'] },
    { label: 'Upload', icon: UploadCloud, tabs: ['upload'] },
    { label: 'This week', icon: CalendarDays, tabs: ['week'] },
    { label: 'What’s working', icon: Lightbulb, tabs: ['working'] },
  ] },
  { label: 'Track', items: [
    { label: 'Earnings', icon: BarChart3, tabs: ['analytics', 'brands'] },
    { label: 'Submissions', icon: ListChecks, tabs: ['submissions'] },
    { label: 'What changed', icon: Bell, tabs: ['changes'] },
  ] },
]

export default function TrybeNav({ tab, queue, unread, go }: { tab: Tab; queue: number; unread: number; go: (t: Tab) => void }) {
  return (
    <nav aria-label="TRYBE" className="rounded-2xl p-1.5 overflow-x-auto" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
      <div className="flex items-stretch gap-1 min-w-max">
        {GROUPS.map((g, gi) => (
          <div key={gi} className="flex items-stretch gap-1">
            {gi > 0 && <span aria-hidden="true" className="w-px my-2 mx-1.5" style={{ background: 'var(--border)' }} />}
            {g.label && <span className="self-center text-[10px] font-bold uppercase pl-1 pr-0.5 hidden xl:inline" style={{ color: 'var(--text-3)', letterSpacing: '0.09em' }}>{g.label}</span>}
            {g.items.map((it) => {
              const on = it.tabs.includes(tab)
              const n = it.count === 'queue' ? queue : it.count === 'unread' ? unread : 0
              const Icon = it.icon
              return (
                <button key={it.label} type="button" aria-current={on ? 'page' : undefined}
                  onClick={() => go(it.count === 'queue' ? (queue ? 'queue' : 'sent') : it.tabs[0])}
                  className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-[13px] font-semibold whitespace-nowrap transition-colors focus-visible:outline focus-visible:outline-2"
                  style={on ? { background: 'var(--accent)', color: '#fff', outlineColor: 'var(--accent)' } : { color: 'var(--text-2)', outlineColor: 'var(--accent)' }}>
                  <Icon size={14} />
                  {it.label}
                  {n > 0 && <span className="text-[10.5px] font-bold rounded-full px-1.5 min-w-[18px] text-center" style={on ? { background: 'rgba(255,255,255,0.25)' } : { background: 'var(--accent)', color: '#fff' }}>{n}</span>}
                </button>
              )
            })}
          </div>
        ))}
      </div>
    </nav>
  )
}

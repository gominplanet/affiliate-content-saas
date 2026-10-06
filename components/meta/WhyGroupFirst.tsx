'use client'
// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// WHY YOUR GROUP HOLDS THE LINK AND YOUR PAGE POINTS TO IT, for creators.
// One explainer, shown wherever MVP posts to Facebook (Meta Hub, Group Post
// Queue), so the reason is said the same way everywhere.
//
// The facts, from Meta's help page (facebook.com/help/1929252614431792, read
// 2026-10-06; see lib/facebook-link-budget.ts): a Page gets 2 posts a month
// with an outside link unless it pays for Meta One; links to Facebook,
// Instagram, WhatsApp and Threads do not count; Groups are not named in the
// limit. Spam filters still watch Groups, so the safe habits are listed too.
import { useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'

export default function WhyGroupFirst({ defaultOpen = false }: { defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  const h = 'text-[12.5px] font-semibold'
  return (
    <div className="rounded-2xl border p-4 flex flex-col gap-2" style={{ borderColor: 'rgba(24,119,242,0.35)', background: 'rgba(24,119,242,0.06)' }}>
      <button onClick={() => setOpen(!open)} className="flex items-center gap-2 text-left">
        <span className="text-[15px] font-semibold flex-1" style={{ color: 'var(--text)' }}>Your Group holds the link. Your Page points to it. Here is why.</span>
        {open ? <ChevronUp size={16} style={{ color: 'var(--text-faint)' }} /> : <ChevronDown size={16} style={{ color: 'var(--text-faint)' }} />}
      </button>
      {open && (
        <div className="flex flex-col gap-3 text-[13px] leading-relaxed" style={{ color: 'var(--text-soft)' }}>
          <div>
            <p className={h} style={{ color: 'var(--text)' }}>Facebook limits links on Pages</p>
            <p>Meta lets a Page make only 2 posts a month with a link that leaves Facebook, like Amazon or your blog. More costs a paid Meta One plan. Past the limit, creators report the link going up as plain text nobody can tap.</p>
          </div>
          <div>
            <p className={h} style={{ color: 'var(--text)' }}>Links to Facebook do not count</p>
            <p>A link to your own Group post stays on Facebook, so it is free. That is why your Page can post every day: each Page post or Reel points to the Group post that has the product and your link.</p>
          </div>
          <div>
            <p className={h} style={{ color: 'var(--text)' }}>Your Group is where the link lives</p>
            <p>Meta publishes no link limit for Groups. MVP fills the post, link included, into your Group with SCOUT, and you press Post. The moment it is up, MVP posts on your Page pointing to it.</p>
          </div>
          <div>
            <p className={h} style={{ color: 'var(--text)' }}>Keep your Group safe from spam filters</p>
            <ul className="list-disc pl-5">
              <li>Post links only in Groups you run. Amazon does not allow your links in other people&apos;s Groups.</li>
              <li>Always write a few real words. A bare link looks like spam.</li>
              <li>Do not paste the same link into many Groups at once.</li>
              <li>Keep a steady pace, a handful of posts a day, not dozens in a row.</li>
              <li>Add your Page and your Group to your website list in Amazon Associates Central.</li>
            </ul>
          </div>
          <p className="text-[11.5px]" style={{ color: 'var(--text-faint)' }}>From Meta&apos;s own help page on link limits. Meta may change it or apply it differently to some Pages.</p>
        </div>
      )}
    </div>
  )
}

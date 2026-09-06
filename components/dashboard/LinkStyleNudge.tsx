'use client'

// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// "Pick how your links are built" — the one setting MVP cannot guess.
//
// The link style decides what EVERY affiliate link in a creator's content
// becomes: a geo-routing Passport link, their branded geni.us link, a Bitly
// short link, or a plain tagged Amazon URL. It is set once and applied to every
// blog post, YouTube description, pin and social post from then on.
//
// A creator who never opens Brand Profile never picks one, so MVP falls back to
// something sensible and they never find out which. That is the wrong shape for
// a decision this large: they discover it months later, in a published
// description, as a link that is not the one they thought they had. There is no
// good moment to ask at generation time either, because by then the content is
// already being written.
//
// So it is asked here, once, in the way that matches the stakes: it stays until
// they choose, and it goes the moment they do. Dismissing hides it for this
// visit only, because a creator who keeps skipping it is still publishing links
// they never decided on.

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Link2, ArrowRight, X } from 'lucide-react'

const LABELS: Record<string, string> = {
  passport: 'Passport Links',
  geniuslink: 'Genius Links',
  bitly: 'Bitly',
  direct: 'plain tagged Amazon links',
}

export default function LinkStyleNudge() {
  const [show, setShow] = useState(false)
  const [current, setCurrent] = useState<string>('direct')

  useEffect(() => {
    let cancelled = false
    fetch('/api/affiliate-links/save')
      .then(r => r.json())
      .then(d => {
        if (cancelled || !d || d.ok === false) return
        if (d.linkStyleChosen === true) return
        setCurrent(typeof d.effectiveLinkStyle === 'string' ? d.effectiveLinkStyle : 'direct')
        setShow(true)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  if (!show) return null

  return (
    <div
      className="mb-4 rounded-xl border p-4 flex items-start gap-3"
      style={{ borderColor: 'rgba(124,58,237,0.35)', background: 'linear-gradient(135deg, rgba(124,58,237,0.08), rgba(52,199,89,0.04))' }}
    >
      <div
        className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
        style={{ background: 'linear-gradient(135deg,#7C3AED,#34c759)', color: '#fff' }}
      >
        <Link2 size={16} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">
          Choose how MVP builds your links
        </p>
        <p className="text-[12px] text-[#3a3a3c] dark:text-[#d2d2d7] leading-relaxed mt-0.5">
          You have not picked a link style yet, so MVP is using {LABELS[current] || LABELS.direct} for now.
          Your pick applies to every link in everything MVP writes for you: blog posts, YouTube descriptions,
          pins and social posts. It takes one click, and you can change it any time.
        </p>
        <Link
          href="/brand#affiliate"
          className="inline-flex items-center gap-1 mt-2 text-[12px] font-semibold"
          style={{ color: '#7C3AED' }}
        >
          Pick my link style <ArrowRight size={12} />
        </Link>
      </div>
      <button
        type="button"
        onClick={() => setShow(false)}
        aria-label="Hide for now"
        className="flex-shrink-0 p-1 rounded-md text-[#86868b] hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7]"
      >
        <X size={14} />
      </button>
    </div>
  )
}

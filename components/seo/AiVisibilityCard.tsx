'use client'

// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// AI search visibility card — shows whether the AI answer engines' crawlers can
// read the creator's site (robots.txt). Blocked crawlers = the site can't be
// quoted in ChatGPT / Perplexity / Google AI Overviews. Self-contained: fetches
// /api/seo/ai-crawlers on mount.

import { useEffect, useState } from 'react'
import { Loader2, Bot, Check, X, RefreshCw } from 'lucide-react'

interface Crawler { token: string; label: string; serves: string; allowed: boolean }
interface Report { ok?: boolean; siteUrl?: string; robotsFound?: boolean; crawlers?: Crawler[]; allowedCount?: number; blockedCount?: number; error?: string; code?: string }

export default function AiVisibilityCard() {
  const [data, setData] = useState<Report | null>(null)
  const [loading, setLoading] = useState(true)

  const load = () => {
    setLoading(true)
    fetch('/api/seo/ai-crawlers').then(r => r.json()).then(setData).catch(() => setData({ error: 'Could not check right now.' })).finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [])

  if (loading) {
    return (
      <div className="rounded-2xl border p-4 mb-5 flex items-center gap-2" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
        <Loader2 size={15} className="animate-spin" style={{ color: 'var(--text-faint)' }} />
        <span className="text-[13px]" style={{ color: 'var(--text-soft)' }}>Checking AI-search visibility…</span>
      </div>
    )
  }
  if (!data || data.error) {
    if (data?.code === 'no_site') return null
    return null
  }

  const blocked = data.blockedCount ?? 0
  const crawlers = data.crawlers ?? []
  const allGood = blocked === 0

  return (
    <div className="rounded-2xl border mb-5 overflow-hidden" style={{ borderColor: allGood ? 'rgba(5,150,105,0.35)' : 'rgba(217,119,6,0.4)', background: allGood ? 'rgba(5,150,105,0.06)' : 'rgba(217,119,6,0.06)' }}>
      <div className="p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-2.5">
            <div className="w-8 h-8 rounded-lg grid place-items-center flex-shrink-0" style={{ background: allGood ? 'rgba(5,150,105,0.14)' : 'rgba(217,119,6,0.16)' }}>
              <Bot size={17} style={{ color: allGood ? '#059669' : '#d97706' }} />
            </div>
            <div>
              <p className="text-[14px] font-bold" style={{ color: 'var(--text)' }}>AI search visibility</p>
              <p className="text-[12.5px] mt-0.5 leading-relaxed" style={{ color: 'var(--text-soft)' }}>
                {allGood
                  ? 'Every major AI answer engine can read your site — your content is eligible to be quoted in ChatGPT, Perplexity, and Google AI Overviews.'
                  : `${blocked} of ${crawlers.length} AI crawlers are blocked by your robots.txt. Blocked engines can't quote your content. Allow them in robots.txt (or your SEO plugin's crawler settings) to be eligible.`}
              </p>
            </div>
          </div>
          <button onClick={load} title="Re-check" className="p-1.5 rounded-lg flex-shrink-0" style={{ color: 'var(--text-faint)' }}><RefreshCw size={14} /></button>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 mt-3.5">
          {crawlers.map(c => (
            <div key={c.token} className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }} title={`${c.label} — ${c.serves} — ${c.allowed ? 'allowed' : 'blocked'}`}>
              {c.allowed
                ? <Check size={13} style={{ color: '#059669', flexShrink: 0 }} />
                : <X size={13} style={{ color: '#e11d48', flexShrink: 0 }} />}
              <div className="min-w-0">
                <div className="text-[11.5px] font-semibold truncate" style={{ color: 'var(--text)' }}>{c.label}</div>
                <div className="text-[10px] truncate" style={{ color: 'var(--text-faint)' }}>{c.serves}</div>
              </div>
            </div>
          ))}
        </div>

        {!data.robotsFound && (
          <p className="text-[11px] mt-2.5" style={{ color: 'var(--text-faint)' }}>
            No robots.txt found — nothing is blocked, so all engines can read the site. (A robots.txt only ever restricts access.)
          </p>
        )}
      </div>
    </div>
  )
}

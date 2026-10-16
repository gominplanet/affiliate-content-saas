'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Flame, Loader2, RefreshCw, Check, AlertTriangle } from 'lucide-react'
import { requestHashtagAccess, requestInstagramTagCounts } from '@/lib/extension-frame'

/**
 * LIVE HASHTAG DATA (Labs). Where the hashtag engine's trend readings come
 * from, how fresh each one is, and what was actually read: TikTok Creative
 * Center's lists and YouTube's hashtag pages (read by MVP's server every
 * night, or now on a press) and Instagram's tag counts (read by SCOUT in this
 * Chrome, since Instagram wants a signed-in browser). A read that found
 * nothing says so in words; it never looks like a read that worked.
 */

interface Source { platform: string; source: string; label: string; by: string; tags: number | null; lastAt: string | null; missing: boolean }
interface Info {
  ok: boolean; allowed: boolean; sources: Source[]
  tiktokTop: Array<{ tag: string; rank: number | null; posts: number | null; label: string | null; region: string }>
  instagramRecent: Array<{ tag: string; posts: number | null; standing: string }>
  instagramNext: string[]
}
type Access = 'checking' | 'granted' | 'not-granted' | 'no-scout' | 'old'
type Say = { tone: 'ok' | 'bad' | 'info'; text: string } | null

const AUTO_KEY = 'mvp.hashtagTrends.autoRead'
const STALE_MS = 2 * 86_400_000

function ago(iso: string | null): string {
  if (!iso) return 'never'
  const h = (Date.now() - new Date(iso).getTime()) / 3_600_000
  if (h < 1) return 'just now'
  if (h < 24) return `${Math.round(h)} hours ago`
  const d = Math.round(h / 24)
  return d === 1 ? 'yesterday' : `${d} days ago`
}
function short(n: number | null): string {
  if (n == null) return ''
  return n >= 1e9 ? `${(n / 1e9).toFixed(1).replace(/\.0$/, '')}B` : n >= 1e6 ? `${(n / 1e6).toFixed(1).replace(/\.0$/, '')}M` : n >= 1e3 ? `${Math.round(n / 1e3)}K` : String(n)
}

const IG_WHY: Record<string, string> = {
  'no-access': 'SCOUT is not allowed on Instagram yet. Press Allow first.',
  'not-signed-in': 'Instagram is not signed in in this Chrome. Sign in at instagram.com, then try again.',
  'slow-down': 'Instagram asked SCOUT to slow down. What came back is saved; try the rest later.',
  'nothing-read': 'Instagram answered but gave no counts for these tags.',
  'no-tags': 'There are no tags to check yet.',
  busy: 'SCOUT is already reading hashtags. Try again in a minute.',
  timeout: 'SCOUT took too long. Nothing was saved; try again.',
}

export default function HashtagTrends() {
  const [info, setInfo] = useState<Info | null>(null)
  const [access, setAccess] = useState<Access>('checking')
  const [busy, setBusy] = useState<'tiktok' | 'instagram' | 'allow' | null>(null)
  const [said, setSaid] = useState<Say>(null)
  const autoTried = useRef(false)

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/hashtags/trends')
      if (r.ok) setInfo(await r.json())
    } catch { /* the card stays as it was */ }
  }, [])

  useEffect(() => { void load() }, [load])
  useEffect(() => {
    let alive = true
    requestHashtagAccess(false).then((a) => { if (alive) setAccess(a.state) }).catch(() => { if (alive) setAccess('no-scout') })
    return () => { alive = false }
  }, [])

  const allow = async () => {
    setBusy('allow'); setSaid(null)
    const a = await requestHashtagAccess(true)
    setAccess(a.state)
    setBusy(null)
    if (a.state !== 'granted') setSaid({ tone: 'bad', text: a.state === 'old' ? 'This needs SCOUT 1.49.0. Chrome updates SCOUT by itself; or download the new build.' : a.state === 'no-scout' ? 'SCOUT is not installed in this Chrome.' : 'Not allowed. SCOUT will not read hashtags.' })
  }

  const readTikTok = useCallback(async () => {
    setBusy('tiktok'); setSaid({ tone: 'info', text: 'MVP is reading TikTok Creative Center, industry by industry...' })
    try {
      const r = await fetch('/api/hashtags/trends', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'tiktok', country: 'US' }) })
      const j = await r.json().catch(() => ({})) as { ok?: boolean; saved?: number; read?: number; asked?: number; answered?: number; error?: string }
      if (!j.ok) { setSaid({ tone: 'bad', text: j.error || `MVP could not read Creative Center (${r.status}).` }); return }
      setSaid({ tone: 'ok', text: `Read ${j.read} trending hashtags from ${j.answered} of ${j.asked} Creative Center lists (every industry, this week and this month). Saved ${j.saved}.` })
      await load()
    } catch { setSaid({ tone: 'bad', text: 'MVP did not answer. Nothing was saved; try again.' }) } finally { setBusy(null) }
  }, [load])

  const readInstagram = useCallback(async (tags: string[]) => {
    if (!tags.length) { setSaid({ tone: 'info', text: IG_WHY['no-tags'] }); return }
    setBusy('instagram'); setSaid({ tone: 'info', text: `SCOUT is asking Instagram about ${tags.length} tag${tags.length === 1 ? '' : 's'}, one at a time...` })
    try {
      const res = await requestInstagramTagCounts(tags.map((t) => t.replace(/^#/, '')))
      const items = (res.items || []).filter((i) => i.posts != null)
      if (items.length) {
        const r = await fetch('/api/hashtags/trends', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'instagram', items }) })
        const j = await r.json().catch(() => ({})) as { ok?: boolean; saved?: number; error?: string }
        if (!j.ok) { setSaid({ tone: 'bad', text: j.error || 'MVP could not save what SCOUT read.' }); return }
      }
      if (!res.ok || res.error) setSaid({ tone: items.length ? 'info' : 'bad', text: `${items.length ? `Saved ${items.length} of ${tags.length}. ` : ''}${IG_WHY[res.error || ''] || `SCOUT could not read Instagram (${res.error || 'no answer'}).`}` })
      else setSaid({ tone: 'ok', text: `Instagram gave counts for ${items.length} of ${tags.length} tags. Saved.` })
      await load()
    } finally { setBusy(null) }
  }, [load])

  // KEPT FRESH WITHOUT A PRESS: MVP reads TikTok every night; if that has
  // not happened for two days, the card reads it once a session on its own.
  useEffect(() => {
    if (autoTried.current || !info?.allowed || busy) return
    const tt = info.sources.find((s) => s.source === 'tiktok_cc')
    if (!tt || tt.missing || (tt.lastAt && Date.now() - new Date(tt.lastAt).getTime() < STALE_MS)) return
    autoTried.current = true
    try { if (sessionStorage.getItem(AUTO_KEY)) return; sessionStorage.setItem(AUTO_KEY, '1') } catch { /* read anyway */ }
    void readTikTok()
  }, [info, busy, readTikTok])

  if (!info || !info.allowed) return null
  const missing = info.sources.some((s) => s.missing)

  return (
    <div className="rounded-2xl border overflow-hidden" style={{ borderColor: 'rgba(255,59,48,0.25)', background: 'rgba(255,59,48,0.03)' }}>
      <div className="flex items-center gap-2 px-5 py-3.5 border-b" style={{ borderColor: 'rgba(255,59,48,0.15)' }}>
        <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-[#ff3b30]/10 text-[#ff3b30]"><Flame size={15} /></span>
        <div>
          <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Live hashtag data <span className="ml-1 text-[10px] font-semibold uppercase tracking-wide text-[#7C3AED]">Labs</span></p>
          <p className="text-[11px] text-[#86868b] dark:text-[#8e8e93]">Read from the platforms themselves. MVP uses a trending tag only when it is about the post, and never one the platform shows almost nobody using.</p>
        </div>
      </div>

      <div className="p-5 space-y-4">
        {missing && (
          <p className="flex items-start gap-1.5 text-[12px] text-[#c93400]"><AlertTriangle size={13} className="mt-0.5 flex-shrink-0" /> The hashtag_trends table is missing. Run migration 434 in Supabase, then reload.</p>
        )}

        <div className="grid gap-2 sm:grid-cols-3">
          {info.sources.map((s) => (
            <div key={s.source} className="rounded-xl border px-3 py-2.5" style={{ borderColor: 'var(--border)' }}>
              <p className="text-[12px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">{s.label}</p>
              <p className="text-[11px] text-[#86868b] dark:text-[#8e8e93]">{s.by}</p>
              <p className="mt-1 text-[12px] tabular-nums text-[#1d1d1f] dark:text-[#f5f5f7]">{s.missing ? 'not set up' : s.tags ? `${s.tags} tags, ${ago(s.lastAt)}` : `nothing read yet`}</p>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => void readTikTok()} disabled={busy !== null} className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-[13px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] disabled:opacity-60" style={{ borderColor: 'var(--border)' }}>
            {busy === 'tiktok' ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Read TikTok trends now
          </button>
          {access === 'granted' ? (
            <button type="button" onClick={() => void readInstagram(info.instagramNext)} disabled={busy !== null || !info.instagramNext.length} className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-[13px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] disabled:opacity-60" style={{ borderColor: 'var(--border)' }}>
              {busy === 'instagram' ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Check {info.instagramNext.length || ''} tags on Instagram
            </button>
          ) : (
            <button type="button" onClick={allow} disabled={busy !== null || access === 'checking' || access === 'no-scout'} className="inline-flex items-center gap-1.5 rounded-lg bg-[#7C3AED] px-3 py-2 text-[13px] font-semibold text-white disabled:opacity-60">
              {busy === 'allow' ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Allow SCOUT to read Instagram counts
            </button>
          )}
        </div>
        {access !== 'granted' && (
          <p className="text-[12px] text-[#6e6e73] dark:text-[#a1a1a6]">{access === 'no-scout' ? 'Instagram counts need SCOUT in this Chrome.' : access === 'old' ? 'Instagram counts need SCOUT 1.49.0.' : access === 'checking' ? 'Checking SCOUT...' : 'Instagram shows tag counts only to a signed-in browser, so SCOUT reads them in yours. Chrome asks once. Reading only: nothing is posted, liked or followed.'}</p>
        )}

        {said && (
          <p role="status" className="text-[12px]" style={{ color: said.tone === 'ok' ? '#248a3d' : said.tone === 'bad' ? '#c93400' : '#6e6e73' }}>{said.text}</p>
        )}

        {info.tiktokTop.length > 0 && (
          <div>
            <p className="text-[12px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1.5">Trending on TikTok now</p>
            <div className="flex flex-wrap gap-1.5">
              {info.tiktokTop.map((t) => (
                <span key={t.tag} className="text-[12px] px-2 py-1 rounded-lg tabular-nums" style={{ background: 'rgba(255,59,48,0.08)', color: '#b3261e' }} title={t.label || undefined}>
                  {t.rank ? `${t.rank}. ` : ''}{t.tag}{t.posts ? ` · ${short(t.posts)} posts` : ''}
                </span>
              ))}
            </div>
          </div>
        )}

        {info.instagramRecent.length > 0 && (
          <div>
            <p className="text-[12px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1.5">Checked on Instagram</p>
            <div className="flex flex-wrap gap-1.5">
              {info.instagramRecent.map((t) => (
                <span key={t.tag} className="text-[12px] px-2 py-1 rounded-lg tabular-nums" style={t.standing === 'dead' ? { background: 'rgba(0,0,0,0.05)', color: '#86868b', textDecoration: 'line-through' } : { background: 'rgba(124,58,237,0.08)', color: '#5b21b6' }} title={t.standing === 'dead' ? 'Almost nobody posts with it: MVP will not use it' : t.standing === 'crowd' ? 'So many posts a new one is buried fast' : 'Active'}>
                  {t.tag} · {short(t.posts)}{t.standing === 'dead' ? ' (not used)' : t.standing === 'crowd' ? ' (crowded)' : ''}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

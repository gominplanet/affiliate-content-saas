'use client'
// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Swap a site address in a creator's YouTube descriptions (app/api/admin/
// domain-swap). Lists the addresses their posts and descriptions use, flags
// temporary host addresses, and reports every video it could not change.
import { useState } from 'react'
import { Loader2, Link2 } from 'lucide-react'

type Host = { host: string; temporary: boolean; posts: number; siteOnFile: boolean; videos: number }
type Result = {
  ok: boolean; error?: string; changed?: number; alreadyRight?: number; missing?: number; left?: number
  failed?: Array<{ title: string; reason: string }>; site?: string; wordpressMoved?: boolean; postsUpdated?: number
}

export function DomainSwap({ userId }: { userId: string }) {
  const [hosts, setHosts] = useState<Host[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<Result | null>(null)

  async function load() {
    setLoading(true); setError(null)
    try {
      const r = await fetch(`/api/admin/domain-swap?userId=${encodeURIComponent(userId)}`)
      const d = await r.json().catch(() => ({}))
      if (!r.ok || !d.ok) throw new Error(d.error || `Could not load (${r.status})`)
      const list = (d.hosts ?? []) as Host[]
      setHosts(list)
      const temp = list.find((h) => h.temporary && h.videos > 0)
      if (temp && !from) setFrom(temp.host)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load')
    } finally {
      setLoading(false)
    }
  }

  async function run() {
    setBusy(true); setResult(null)
    try {
      const r = await fetch('/api/admin/domain-swap', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, from, to }),
      })
      const d = await r.json().catch(() => null) as Result | null
      setResult(d ?? { ok: false, error: 'The swap returned nothing readable, so it is not known what changed. Check again before running it twice.' })
      await load()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="border-t border-gray-100 dark:border-white/10 pt-4 mb-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Swap their site address in YouTube descriptions</p>
          <p className="text-[11px] text-[#86868b] dark:text-[#8e8e93] mt-0.5">
            For a site connected on a temporary host address. Reads each live description, changes only the address, keeps the rest. Refused when the new address does not answer.
          </p>
        </div>
        {!hosts && (
          <button onClick={load} disabled={loading} className="btn-secondary text-sm flex items-center gap-1.5 flex-shrink-0">
            {loading ? <Loader2 size={13} className="animate-spin" /> : <Link2 size={13} />} {loading ? 'Checking' : 'Check addresses'}
          </button>
        )}
      </div>
      {error && <p className="text-[11px] text-[#ff3b30] mt-2">{error}</p>}

      {hosts && (
        <div className="mt-3 flex flex-col gap-2">
          {hosts.length === 0 ? <p className="text-[12px] text-[#86868b]">No site address on record.</p> : (
            <ul className="flex flex-col gap-0.5">
              {hosts.map((h) => (
                <li key={h.host} className="text-[11.5px] text-[#1d1d1f] dark:text-[#f5f5f7]">
                  <b>{h.host}</b>
                  {h.temporary && <span className="ml-1.5 text-[#ff9500]">temporary host address</span>}
                  <span className="text-[#86868b]"> · {h.videos} video descriptions · {h.posts} posts{h.siteOnFile ? ' · the connected site' : ''}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="flex items-center gap-2 flex-wrap text-[12px]">
            <input value={from} onChange={(e) => setFrom(e.target.value)} placeholder="old address"
              className="rounded-lg border border-black/10 dark:border-white/15 bg-transparent px-2 py-1 w-64" />
            <span className="text-[#86868b]">to</span>
            <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="their real domain, e.g. mysite.com"
              className="rounded-lg border border-black/10 dark:border-white/15 bg-transparent px-2 py-1 w-64" />
            <button onClick={run} disabled={busy || !from.trim() || !to.trim()} className="btn-primary text-xs inline-flex items-center gap-1.5">
              {busy ? <Loader2 size={12} className="animate-spin" /> : <Link2 size={12} />} {busy ? 'Swapping' : 'Swap in descriptions'}
            </button>
          </div>
          {result && <SwapResult r={result} />}
        </div>
      )}
    </div>
  )
}

function SwapResult({ r }: { r: Result }) {
  if (r.error) return <p className="text-[12px] text-[#ff3b30]">{r.error}</p>
  const failed = r.failed ?? []
  return (
    <div className="rounded-lg p-2.5 text-[12px]" style={{ background: failed.length ? '#ff950012' : '#34c75912' }}>
      <p className="text-[#1d1d1f] dark:text-[#f5f5f7]">
        {r.changed ?? 0} descriptions changed{r.alreadyRight ? `, ${r.alreadyRight} already right on YouTube` : ''}{r.missing ? `, ${r.missing} no longer on YouTube` : ''}{failed.length ? `, ${failed.length} not changed` : ''}.
        {' '}{r.left ? `${r.left} still to do: press Swap again (25 per run, to spare the daily YouTube quota).` : 'None left to do.'}
      </p>
      {r.site && <p className="text-[#6e6e73] dark:text-[#b0b0b5] mt-1">{r.site}</p>}
      <p className="text-[#6e6e73] dark:text-[#b0b0b5] mt-0.5">
        {r.wordpressMoved
          ? `WordPress has moved too, so ${r.postsUpdated ?? 0} post addresses and the site connection on file now use the new address.`
          : 'WordPress still reports the old address as its home, so the post and site addresses on file were left as they are. Change it in WordPress, Settings, General, then run this again to update them.'}
      </p>
      {failed.length > 0 && (
        <ul className="mt-1.5 flex flex-col gap-0.5">
          {failed.slice(0, 10).map((f, i) => <li key={i} className="text-[11px] text-[#ff3b30]">{f.title}: {f.reason}</li>)}
        </ul>
      )}
    </div>
  )
}

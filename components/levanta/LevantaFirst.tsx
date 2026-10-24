'use client'

// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// "Use Levanta links when they pay more" (Seb, 2026-10-24: "could mvp let
// users use levanta links when possible?"). The switch, what it does and what
// it gives up, and what MVP decided for each product it checked, so a Levanta
// link is never assumed: a product that kept its Amazon link says why.
// lib/levanta-first holds the rule; /api/levanta/prefer reads and saves.

import { useCallback, useEffect, useState } from 'react'
import { Loader2, RotateCcw, ExternalLink, Check, AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'

const CYAN = '#0891B2'
const SHOWN = 12

interface Row { asin: string; state: string; checkedAt: string; usedAt: string | null; words: string; commission: number | null }
interface Data { on: boolean; connected: boolean; ready: boolean; team: boolean; products: Row[]; counts: { levanta: number; amazon: number } }

export default function LevantaFirst() {
  const [data, setData] = useState<Data | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [shown, setShown] = useState(SHOWN)

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/levanta/prefer', { cache: 'no-store' })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.error || `Could not load (${r.status})`)
      setData(d as Data); setError(null)
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not load.') }
  }, [])
  useEffect(() => { void load() }, [load])

  async function send(body: Record<string, unknown>, done: string) {
    setBusy(true)
    try {
      const r = await fetch('/api/levanta/prefer', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) { toast.error(d.error || 'Could not save.', { duration: 10000 }); return }
      toast.success(done)
      await load()
    } finally { setBusy(false) }
  }

  const soft = { color: 'var(--text-soft)' }
  const on = !!data?.on
  return (
    <section className="rounded-xl border p-4 mb-5" style={{ background: 'var(--surface)', borderColor: on ? 'rgba(8,145,178,0.45)' : 'var(--border)' }} aria-label="Use Levanta links when they pay more">
      <div className="flex flex-wrap items-start gap-3">
        <div className="flex-1 min-w-[16rem]">
          <p className="text-[15px] font-semibold" style={{ color: 'var(--text)' }}>Use Levanta links when they pay more</p>
          <p className="text-[13px] mt-1" style={soft}>
            Every Amazon link MVP makes for you (blog posts, comparisons, social posts, deals, Link in Bio, video descriptions, Instagram DMs) checks Levanta first. When Levanta has the product for you, MVP uses your Levanta link, in your link style.
          </p>
        </div>
        {data && (
          <button
            type="button" role="switch" aria-checked={on} disabled={busy || (!on && !data.connected) || !data.ready}
            onClick={() => void send({ on: !on }, on ? 'Levanta links are off. New links use Amazon.' : 'Levanta links are on for new links.')}
            className="relative inline-flex h-7 w-12 flex-shrink-0 items-center rounded-full transition-colors disabled:opacity-50"
            style={{ background: on ? CYAN : 'var(--surface-bright, #d4d4d8)' }}>
            <span className="sr-only">{on ? 'Turn Levanta links off' : 'Turn Levanta links on'}</span>
            <span className="inline-block h-5 w-5 rounded-full bg-white shadow transition-transform" style={{ transform: on ? 'translateX(24px)' : 'translateX(4px)' }} />
          </button>
        )}
      </div>

      {error && <p className="text-[13px] mt-2" style={{ color: '#B45309' }}>{error}</p>}
      {!data && !error && <p className="text-[13px] mt-2 inline-flex items-center gap-1.5" style={soft}><Loader2 size={13} className="animate-spin" /> Loading…</p>}

      {data && !data.ready && (
        <p className="text-[13px] mt-2 inline-flex items-start gap-1.5" style={{ color: '#B45309' }}>
          <AlertTriangle size={14} className="mt-0.5 shrink-0" /> {data.team ? 'Run migration 455 in Supabase to turn this on.' : 'This needs an update on MVP’s side first.'}
        </p>
      )}
      {data && data.ready && !data.connected && (
        <p className="text-[13px] mt-2" style={{ color: '#B45309' }}>Connect your Levanta API key above to turn this on.</p>
      )}

      {data && (
        <ul className="mt-3 text-[12.5px] space-y-1 list-disc pl-5" style={soft}>
          <li>A product whose Creator Connections campaign pays as much or more keeps your Amazon link: a Levanta link earns no Associates commission and no campaign bonus.</li>
          <li>What a Levanta link gives up: Amazon pays on the whole cart for 24 hours after a click, Levanta pays on this product for 14 days. A Levanta link always goes to amazon.com, so visitors outside the US are not sent to their own Amazon the way Passport sends them.</li>
          <li>Your link style still applies. Passport, Geniuslink or Bitly wraps the Levanta link and Levanta&rsquo;s tracking is kept. Links already published stay as they are.</li>
        </ul>
      )}

      {data && data.products.length > 0 && (
        <div className="mt-4">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[13px] font-semibold" style={{ color: 'var(--text)' }}>
              Products MVP checked: {data.counts.levanta} with a Levanta link, {data.counts.amazon} kept on Amazon
            </p>
            <button onClick={() => void send({ recheck: true }, 'Saved answers cleared. The next links ask Levanta again.')} disabled={busy}
              className="ml-auto inline-flex items-center gap-1 text-[12.5px] font-semibold disabled:opacity-50" style={{ color: CYAN }}
              title="After joining a brand on Levanta">
              <RotateCcw size={12} /> Check Levanta again
            </button>
          </div>
          <ul className="mt-2 divide-y rounded-lg border" style={{ borderColor: 'var(--border)' }}>
            {data.products.slice(0, shown).map((r) => (
              <li key={r.asin} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-[12.5px]" style={{ borderColor: 'var(--border)' }}>
                {r.state === 'use'
                  ? <Check size={13} className="shrink-0" style={{ color: '#16A34A' }} />
                  : <span className="w-[13px] shrink-0" aria-hidden="true" />}
                <span className="font-mono" style={{ color: 'var(--text)' }}>{r.asin}</span>
                <span className="flex-1 min-w-[12rem]" style={r.state === 'use' ? { color: '#16A34A' } : soft}>{r.words}</span>
                <a href={`https://www.amazon.com/dp/${r.asin}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-semibold" style={{ color: CYAN }}>
                  See it on Amazon <ExternalLink size={11} />
                </a>
              </li>
            ))}
          </ul>
          {data.products.length > shown && (
            <button onClick={() => setShown((n) => n + 30)} className="mt-2 text-[12.5px] font-semibold" style={{ color: CYAN }}>Show more ({data.products.length - shown} left)</button>
          )}
        </div>
      )}
      {data && data.ready && data.on && data.products.length === 0 && (
        <p className="mt-3 text-[12.5px]" style={soft}>Nothing checked yet. The next Amazon link MVP makes asks Levanta, and it shows here.</p>
      )}
    </section>
  )
}

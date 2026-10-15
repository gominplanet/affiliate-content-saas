'use client'

// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// AUDIT MY SITE, the top of the SEO page (Seb, 2026-10-15: "one button that is
// able to completely audit someone's site and then give them actionable things
// to do"). One press: MVP checks the site, every post and what Google says,
// then shows a short list in order. Each item carries the button that does it
// (MVP's own tools) or the exact clicks when the work is theirs, and every
// button reports what actually happened. What MVP could not check is listed
// as such, never folded into a pass. The judgement is lib/seo-audit.

import { useCallback, useEffect, useState } from 'react'
import { Loader2, ScanSearch, CheckCircle2, AlertTriangle, ExternalLink, ChevronDown, RefreshCw, Wrench, User } from 'lucide-react'
import { readAudit, type Audit, type AuditStep } from '@/lib/seo-audit'

const PURPLE = '#7C3AED'
const GREEN = '#16A34A'
const RED = '#DC2626'
const AMBER = '#B45309'

export interface GetFoundResult { purged: boolean; pinged: number; pingError?: string; links: number; posts: number }

interface Props {
  /** Runs the page's Get my blog found loop and hands back what happened. */
  onGetFound: () => Promise<GetFoundResult>
  /** Re-reads the page's numbers after an action changed something. */
  onChanged: () => void
}

type Outcome = { ok: boolean; text: string }

function ago(iso: string): string {
  const m = Math.round((Date.now() - Date.parse(iso)) / 60_000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m} minute${m === 1 ? '' : 's'} ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`
  const d = Math.round(h / 24)
  return `${d} day${d === 1 ? '' : 's'} ago`
}

export default function SiteAudit({ onGetFound, onChanged }: Props) {
  const [audit, setAudit] = useState<Audit | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [outcomes, setOutcomes] = useState<Record<string, Outcome>>({})

  useEffect(() => {
    let live = true
    fetch('/api/seo/audit').then((r) => r.json()).then((d) => { if (live) setAudit(readAudit(d.audit)) }).catch(() => {}).finally(() => { if (live) setLoaded(true) })
    return () => { live = false }
  }, [])

  const run = useCallback(async (force: boolean) => {
    setRunning(true); setError(null)
    try {
      const r = await fetch(`/api/seo/audit${force ? '?force=1' : ''}`, { method: 'POST', signal: AbortSignal.timeout(150_000) })
      const d = await r.json().catch(() => ({}))
      const a = readAudit(d.audit)
      if (!r.ok || !a) throw new Error(d.error || `The audit did not finish (${r.status}). Try again in a minute.`)
      setAudit(a); setOutcomes({})
    } catch (e) {
      setError(e instanceof Error && e.name !== 'TimeoutError' ? e.message : 'The audit took too long. Your site may be slow to answer; try again in a minute.')
    } finally { setRunning(false) }
  }, [])

  const act = useCallback(async (s: AuditStep) => {
    const done = (o: Outcome) => setOutcomes((m) => ({ ...m, [s.id]: o }))
    setBusy(s.id)
    try {
      if (s.action === 'get-found') {
        const g = await onGetFound()
        const parts = [
          g.purged ? 'Sitemap refreshed.' : 'MVP could not refresh your sitemap.',
          g.pinged ? `Sent ${g.pinged} posts to Bing.` : `Not sent to Bing: ${g.pingError || 'no answer'}.`,
          g.links ? `Repaired ${g.links} moved addresses.` : null,
          g.posts ? `Fixed the SEO basics on ${g.posts} posts.` : 'No SEO basics needed fixing.',
        ].filter(Boolean)
        done({ ok: g.purged || g.pinged > 0, text: parts.join(' ') })
      } else if (s.action === 'refresh-urls') {
        const r = await fetch('/api/blog/resync-permalinks', { method: 'POST' })
        const d = await r.json().catch(() => ({}))
        if (!r.ok) done({ ok: false, text: d.error || 'MVP could not refresh your post addresses.' })
        else done({ ok: true, text: d.updated ? `Saved the real address for ${d.updated} post${d.updated === 1 ? '' : 's'}.` : 'Every address already matched WordPress.' })
        onChanged()
      } else if (s.action === 'request-index' && s.indexUrls?.length) {
        const r = await fetch('/api/seo/request-index', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ urls: s.indexUrls }) })
        const d = await r.json().catch(() => ({})) as { error?: string; results?: { url: string; outcome: string; message?: string }[] }
        if (!r.ok) done({ ok: false, text: d.error || `Google did not take the request (${r.status}).` })
        else {
          const ok = (d.results || []).filter((x) => x.outcome === 'submitted').length
          const bad = (d.results || []).filter((x) => x.outcome !== 'submitted')
          done({ ok: ok > 0, text: `${ok ? `Google accepted ${ok}.` : 'Google accepted none.'}${bad.length ? ` Not accepted: ${bad.map((b) => b.message || b.outcome).join('; ')}` : ''}` })
        }
      } else if (s.action === 'link-up' && s.pairs?.length) {
        let added = 0
        const notes: string[] = []
        for (const p of s.pairs) {
          const r = await fetch('/api/seo/link-to', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fromPostId: p.fromId, toPostId: p.toId }) })
          const d = await r.json().catch(() => ({})) as { added?: boolean; note?: string; error?: string }
          if (r.ok && d.added) added++
          else notes.push(`${p.toTitle.slice(0, 40)}: ${d.error || d.note || 'not added'}`)
        }
        done({ ok: added > 0, text: `${added ? `Added ${added} link${added === 1 ? '' : 's'} and republished those posts.` : 'No links were added.'}${notes.length ? ` ${notes.join(' | ')}` : ''}` })
      }
    } catch {
      done({ ok: false, text: 'MVP could not reach the server. Try again.' })
    } finally { setBusy(null) }
  }, [onGetFound, onChanged])

  const soft = { color: 'var(--text-soft)' }

  return (
    <section className="rounded-2xl border p-4 sm:p-5 mb-5" style={{ borderColor: 'var(--border-bright, var(--border))', background: 'var(--surface)' }} aria-label="Audit my site">
      <div className="flex flex-wrap items-start gap-3">
        <span className="w-10 h-10 shrink-0 rounded-xl inline-flex items-center justify-center" style={{ background: 'rgba(124,58,237,0.12)', color: PURPLE }}><ScanSearch size={19} /></span>
        <div className="min-w-[14rem] flex-1">
          <h2 className="text-[17px] font-bold leading-tight" style={{ color: 'var(--text)' }}>Audit my site</h2>
          <p className="text-[13px] mt-0.5" style={soft}>
            {audit && !running
              ? <>Last audit {ago(audit.at)}{audit.siteUrl ? <> of {audit.siteUrl.replace(/^https?:\/\//, '')}</> : null}.</>
              : 'One press. MVP checks your site, your posts and what Google says about each one, then gives you a short list in order.'}
          </p>
        </div>
        <button onClick={() => void run(!!audit)} disabled={running || !loaded}
          className="inline-flex items-center gap-1.5 rounded-xl px-4 py-2.5 text-[14px] font-semibold text-white disabled:opacity-60" style={{ background: PURPLE }}>
          {running ? <><Loader2 size={15} className="animate-spin" /> Auditing...</> : audit ? <><RefreshCw size={14} /> Run it again</> : <><ScanSearch size={15} /> Audit my site</>}
        </button>
      </div>

      {running && (
        <p className="text-[13px] mt-3 rounded-lg px-3 py-2" style={{ background: 'rgba(124,58,237,0.07)', color: 'var(--text-2)' }}>
          Opening your site, your sitemap and your posts, and reading what Google says about each one. This usually takes under a minute.
        </p>
      )}
      {error && <p className="text-[13px] mt-3 inline-flex items-start gap-1.5" style={{ color: RED }}><AlertTriangle size={14} className="mt-0.5 shrink-0" />{error}</p>}

      {audit && !running && <AuditBody audit={audit} busy={busy} outcomes={outcomes} onAct={(st) => void act(st)} />}
    </section>
  )
}

/** The result: headline, the list in order, what is right, what could not be checked. */
export function AuditBody({ audit, busy, outcomes, onAct }: { audit: Audit; busy: string | null; outcomes: Record<string, Outcome>; onAct: (s: AuditStep) => void }) {
  return (
    <div className="mt-4">
      <p className="text-[15px] font-semibold" style={{ color: 'var(--text)' }}>{audit.headline}</p>

      {audit.steps.length > 0 && (
        <ol className="mt-3 space-y-2.5">
          {audit.steps.map((s, i) => <Step key={s.id} n={i + 1} s={s} busy={busy === s.id} anyBusy={!!busy} outcome={outcomes[s.id]} onAct={() => onAct(s)} />)}
        </ol>
      )}

      {audit.right.length > 0 && (
        <details className="mt-3 group">
          <summary className="cursor-pointer text-[13px] font-semibold inline-flex items-center gap-1 list-none" style={{ color: GREEN }}>
            <CheckCircle2 size={14} /> Already right ({audit.right.length}) <ChevronDown size={13} className="group-open:rotate-180 transition-transform" />
          </summary>
          <ul className="mt-1.5 space-y-1 pl-5 list-disc text-[13px]" style={{ color: 'var(--text-2)' }}>{audit.right.map((r) => <li key={r}>{r}</li>)}</ul>
        </details>
      )}
      {audit.unchecked.length > 0 && (
        <details className="mt-2 group">
          <summary className="cursor-pointer text-[13px] font-semibold inline-flex items-center gap-1 list-none" style={{ color: AMBER }}>
            <AlertTriangle size={14} /> What MVP could not check ({audit.unchecked.length}) <ChevronDown size={13} className="group-open:rotate-180 transition-transform" />
          </summary>
          <ul className="mt-1.5 space-y-1 pl-5 list-disc text-[13px]" style={{ color: 'var(--text-2)' }}>{audit.unchecked.map((u) => <li key={u}>{u}</li>)}</ul>
        </details>
      )}
    </div>
  )
}

function Step({ n, s, busy, anyBusy, outcome, onAct }: { n: number; s: AuditStep; busy: boolean; anyBusy: boolean; outcome?: Outcome; onAct: () => void }) {
  const [open, setOpen] = useState(n === 1)
  const colour = s.tone === 'blocked' ? RED : PURPLE
  const btn = 'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px] font-semibold text-white disabled:opacity-60'
  const action = (() => {
    if (s.action === 'none' || !s.actionLabel) return null
    if (s.action === 'connect-gsc') return <a href="/api/auth/gsc?returnTo=/seo" className={btn} style={{ background: colour }}>{s.actionLabel}</a>
    if (s.action === 'open' && s.href) {
      const external = /^https?:/i.test(s.href)
      return <a href={s.href} target={external ? '_blank' : undefined} rel={external ? 'noopener noreferrer' : undefined} className={btn} style={{ background: colour }}>{s.actionLabel}{external && <ExternalLink size={12} />}</a>
    }
    return (
      <button onClick={onAct} disabled={anyBusy || (!!outcome && outcome.ok)} className={btn} style={{ background: colour }}>
        {busy ? <><Loader2 size={13} className="animate-spin" /> Working...</> : outcome?.ok ? <><CheckCircle2 size={13} /> Done</> : s.actionLabel}
      </button>
    )
  })()

  return (
    <li className="rounded-xl border" style={{ borderColor: 'var(--border)' }}>
      <button onClick={() => setOpen((v) => !v)} className="w-full flex items-start gap-3 px-3.5 py-3 text-left" aria-expanded={open}>
        <span className="w-6 h-6 shrink-0 rounded-full inline-flex items-center justify-center text-[12px] font-bold text-white tabular-nums" style={{ background: outcome?.ok ? GREEN : colour }}>{outcome?.ok ? <CheckCircle2 size={13} /> : n}</span>
        <span className="flex-1 min-w-0">
          <span className="block text-[14px] font-semibold" style={{ color: 'var(--text)' }}>{s.title}</span>
          <span className="mt-0.5 inline-flex items-center gap-1 text-[11.5px]" style={{ color: 'var(--text-soft)' }}>
            {s.who === 'mvp' ? <><Wrench size={11} /> MVP does this for you</> : <><User size={11} /> You do this</>}
          </span>
        </span>
        <ChevronDown size={15} className={`mt-1 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} style={{ color: 'var(--text-faint, var(--text-soft))' }} />
      </button>
      {open && (
        <div className="px-3.5 pb-3.5 pl-12 space-y-2">
          <p className="text-[13px]" style={{ color: 'var(--text-2)' }}>{s.why}</p>
          <ol className="list-decimal pl-4 space-y-0.5 text-[13px]" style={{ color: 'var(--text)' }}>{s.doThis.map((d) => <li key={d}>{d}</li>)}</ol>
          {s.posts && s.posts.length > 0 && (
            <ul className="text-[12.5px] space-y-0.5 rounded-lg px-3 py-2" style={{ background: 'var(--surface-2, rgba(0,0,0,0.035))' }}>
              {s.posts.slice(0, 10).map((p) => (
                <li key={p.id} className="[overflow-wrap:anywhere]">
                  {p.url ? <a href={p.url} target="_blank" rel="noopener noreferrer" className="underline" style={{ color: 'var(--text)' }}>{p.title}</a> : <span>{p.title}</span>}
                  {p.note && <span style={{ color: AMBER }}> · {p.note}</span>}
                </li>
              ))}
            </ul>
          )}
          {s.pairs && s.pairs.length > 0 && !outcome && (
            <ul className="text-[12px] space-y-0.5" style={{ color: 'var(--text-soft)' }}>
              {s.pairs.map((p) => <li key={p.toId} className="truncate">Link to “{p.toTitle}” from “{p.fromTitle}”</li>)}
            </ul>
          )}
          {action && <div className="pt-0.5">{action}</div>}
          {outcome && <p className="text-[12.5px]" style={{ color: outcome.ok ? GREEN : RED }}>{outcome.text}</p>}
        </div>
      )}
    </li>
  )
}

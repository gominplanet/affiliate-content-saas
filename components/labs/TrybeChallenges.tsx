'use client'
// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// BRAND CHALLENGES, on TRYBE Home (Seb, 2026-11-20: "build the challenge
// tracker"). A brand pays a bonus for a number of approved videos by a date
// (NOBL: 300 approved by November 30 for $10,000). The creator adds it once;
// MVP reads that brand's submissions through SCOUT and says, in their own
// numbers, where it stands (lib/trybe-challenge readChallenge): approved so
// far, what waits, how long the brand takes to decide, the real last day to
// send, the videos a day that gets there and the pace of the last 7 days.
// A read that failed or stopped short is said on the card, never shown as
// a count of zero. Saved per member (migration 471); before 471 it is kept in
// this browser and the card says so.

import { useCallback, useEffect, useState } from 'react'
import { Loader2, Trophy, RotateCcw, Plus, X, AlertTriangle } from 'lucide-react'
import { requestTrybeApi } from '@/lib/extension-frame'
import { readBrandStats } from '@/lib/trybe-mybrands'
import { readBrandSubs } from '@/components/labs/TrybeMyBrands'
import { readChallenge, readChallenges, dayOf, shortDay, STATE_WORDS, type Challenge, type ChallengeState, type ChallengeSub } from '@/lib/trybe-challenge'

const PURPLE = 'var(--accent)'
const GREEN = '#16A34A'
const AMBER = '#B45309'
const RED = '#DC2626'
const LOCAL_KEY = 'mvp.trybe.challenges'
const STATE_COLOR: Record<ChallengeState, string> = { done: GREEN, on_track: GREEN, behind: AMBER, out_of_time: RED, unknown: 'var(--text-3)' }

interface Read { subs: ChallengeSub[]; error: string | null; complete: boolean; at: number }

/** Pages of 50 to read for a target: twice the target, at least 4, at most 20. */
const pagesFor = (target: number) => Math.min(20, Math.max(4, Math.ceil((target * 2) / 50)))

function readLocal(): Challenge[] {
  try { return readChallenges(JSON.parse(localStorage.getItem(LOCAL_KEY) || '[]')) } catch { return [] }
}
function writeLocal(list: Challenge[]) {
  try { localStorage.setItem(LOCAL_KEY, JSON.stringify(list)) } catch { /* private window: kept for this visit */ }
}

async function post(body: Record<string, unknown>) {
  const r = await fetch('/api/labs/trybe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'challenges', ...body }), signal: AbortSignal.timeout(20_000) })
  const d = await r.json().catch(() => ({}))
  return { ok: r.ok, challenges: readChallenges(d?.challenges), error: (d?.error as string | undefined) || (r.ok ? null : `MVP answered ${r.status}`), setup: d?.setup === true }
}

export default function TrybeChallenges({ canRead }: { canRead: boolean }) {
  const [list, setList] = useState<Challenge[] | null>(null)
  /** Set when the list lives in this browser only (before migration 471). */
  const [localOnly, setLocalOnly] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [reads, setReads] = useState<Record<string, Read | 'loading'>>({})
  const [brands, setBrands] = useState<Array<{ id: string; name: string }> | null>(null)
  const [brandsError, setBrandsError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState({ brandId: '', target: '', deadline: '', startsOn: dayOf(Date.now()), reward: '' })
  const [saving, setSaving] = useState(false)

  // The saved challenges.
  useEffect(() => {
    if (!canRead) return
    let gone = false
    void post({}).then((r) => {
      if (gone) return
      if (r.ok) { setList(r.challenges); return }
      if (r.setup) { setList(readLocal()); setLocalOnly(r.error); return }
      setLoadError(r.error)
    }).catch(() => { if (!gone) setLoadError('MVP did not answer.') })
    return () => { gone = true }
  }, [canRead])

  // Each challenge's submissions, one brand at a time through SCOUT.
  const readOne = useCallback(async (c: Challenge) => {
    setReads((m) => ({ ...m, [c.id]: 'loading' }))
    const r = await readBrandSubs(c.brandId, pagesFor(c.target)).catch((e) => ({ subs: [], error: e instanceof Error ? e.message : 'SCOUT did not answer.', complete: false }))
    setReads((m) => ({ ...m, [c.id]: { ...r, at: Date.now() } }))
  }, [])
  const ids = (list || []).map((c) => `${c.id}:${c.brandId}:${c.target}`).join('|')
  useEffect(() => {
    if (!canRead || !list?.length) return
    void (async () => { for (const c of list) if (!reads[c.id]) await readOne(c) })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canRead, ids])

  // The brands you are in, for the add form (TRYBE's brands/stats).
  const loadBrands = useCallback(() => {
    setBrandsError(null)
    requestTrybeApi('GET', '/backend/api/creator/v2/brands/stats?period=all')
      .then((r) => {
        if (!r.ok) { setBrandsError('MVP could not read your TRYBE brands just now.'); return }
        setBrands(readBrandStats(r.json).map((b) => ({ id: b.id, name: b.name })).sort((a, b) => a.name.localeCompare(b.name)))
      })
      .catch(() => setBrandsError('MVP could not read your TRYBE brands just now.'))
  }, [])
  useEffect(() => { if (adding && !brands) loadBrands() }, [adding, brands, loadBrands])

  const save = async (next: Challenge[]) => {
    setSaving(true); setSaveError(null)
    try {
      if (localOnly) { writeLocal(next); setList(next); return true }
      const r = await post({ challenges: next })
      if (r.ok) { setList(r.challenges); return true }
      if (r.setup) { writeLocal(next); setList(next); setLocalOnly(r.error); return true }
      setSaveError(r.error); return false
    } catch { setSaveError('MVP did not answer, so nothing was saved.'); return false } finally { setSaving(false) }
  }

  const add = async () => {
    const b = brands?.find((x) => x.id === form.brandId)
    const target = Number(form.target)
    const reward = form.reward.trim() ? Number(form.reward.replace(/[$,\s]/g, '')) : null
    if (!b) { setSaveError('Pick the brand.'); return }
    if (!(target >= 1)) { setSaveError('Say how many approved videos the brand asks for.'); return }
    if (!form.deadline) { setSaveError('Pick the last day of the challenge.'); return }
    if (form.startsOn > form.deadline) { setSaveError('The start day is after the last day.'); return }
    if (reward != null && !(reward > 0)) { setSaveError('The reward should be a dollar amount, or left empty.'); return }
    const c: Challenge = { id: `${b.id}-${form.deadline}`.replace(/[^a-z0-9-]/gi, '').slice(0, 40), brandId: b.id, brand: b.name, target: Math.round(target), deadline: form.deadline, startsOn: form.startsOn, reward }
    const next = readChallenges([...(list || []).filter((x) => x.id !== c.id), c])
    if (!next.some((x) => x.id === c.id)) { setSaveError('MVP could not read that challenge. Check the numbers and days.'); return }
    if (await save(next)) { setAdding(false); setForm({ brandId: '', target: '', deadline: '', startsOn: dayOf(Date.now()), reward: '' }) }
  }

  if (!canRead) return null
  if (loadError) {
    return <p className="text-[12px] mb-3 inline-flex items-center gap-1.5" style={{ color: AMBER }}><AlertTriangle size={12} /> Your brand challenges did not load: {loadError}</p>
  }
  if (!list) return null

  const field = 'rounded-lg border px-2 py-1.5 text-[13px] bg-transparent'
  return (
    <section className="rounded-xl border p-3.5 mb-3" style={{ borderColor: 'var(--border-2)', background: 'var(--surface)' }} aria-label="Brand challenges">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-start gap-3 min-w-0">
          <span className="mt-0.5 w-8 h-8 shrink-0 rounded-lg inline-flex items-center justify-center" style={{ background: 'rgba(245,158,11,0.14)', color: '#D97706' }}><Trophy size={16} /></span>
          <div className="min-w-0">
            <p className="text-[14.5px] font-bold">Brand challenges</p>
            <p className="text-[13px]" style={{ color: 'var(--text-2)' }}>
              {list.length ? 'Read from your TRYBE submissions to each brand. The day to send by allows for how long the brand takes to approve.' : 'A brand paying a bonus for a number of approved videos by a date? Add it. MVP reads your submissions to that brand and tells you the real last day to send, allowing for how long the brand takes to approve, and how many videos a day get you there.'}
            </p>
          </div>
        </div>
        {!adding && list.length < 12 && (
          <button type="button" onClick={() => setAdding(true)} className="inline-flex items-center gap-1 text-[12.5px] font-semibold rounded-lg px-2.5 py-1.5" style={{ border: '1px solid var(--border)', color: 'var(--text)' }}><Plus size={13} /> Add a challenge</button>
        )}
      </div>

      {localOnly && <p className="text-[12px] mt-2" style={{ color: AMBER }}>Kept in this browser only for now: {localOnly}</p>}

      {adding && (
        <div className="mt-3 rounded-lg border p-3 grid gap-2 sm:grid-cols-2" style={{ borderColor: 'var(--border-2)' }}>
          <label className="grid gap-1 text-[12px] font-semibold sm:col-span-2">Brand
            {brands ? (
              <select className={field} value={form.brandId} onChange={(e) => setForm((f) => ({ ...f, brandId: e.target.value }))}>
                <option value="">Pick a brand you are in</option>
                {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            ) : brandsError ? (
              <span className="font-normal" style={{ color: AMBER }}>{brandsError} <button type="button" onClick={loadBrands} className="font-semibold underline">Try again</button></span>
            ) : <span className="font-normal inline-flex items-center gap-1.5" style={{ color: 'var(--text-3)' }}><Loader2 size={12} className="animate-spin" /> Reading your TRYBE brands...</span>}
          </label>
          <label className="grid gap-1 text-[12px] font-semibold">Approved videos it asks for
            <input className={field} inputMode="numeric" placeholder="300" value={form.target} onChange={(e) => setForm((f) => ({ ...f, target: e.target.value.replace(/[^\d]/g, '') }))} />
          </label>
          <label className="grid gap-1 text-[12px] font-semibold">Reward, if any (dollars)
            <input className={field} inputMode="decimal" placeholder="10000" value={form.reward} onChange={(e) => setForm((f) => ({ ...f, reward: e.target.value }))} />
          </label>
          <label className="grid gap-1 text-[12px] font-semibold">Counts videos sent from
            <input type="date" className={field} value={form.startsOn} onChange={(e) => setForm((f) => ({ ...f, startsOn: e.target.value }))} />
          </label>
          <label className="grid gap-1 text-[12px] font-semibold">Last day
            <input type="date" className={field} value={form.deadline} onChange={(e) => setForm((f) => ({ ...f, deadline: e.target.value }))} />
          </label>
          <div className="sm:col-span-2 flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => void add()} disabled={saving} className="text-[12.5px] font-semibold rounded-lg px-3 py-1.5 text-white disabled:opacity-50" style={{ background: PURPLE }}>{saving ? 'Saving...' : 'Track it'}</button>
            <button type="button" onClick={() => { setAdding(false); setSaveError(null) }} className="text-[12.5px] font-semibold underline" style={{ color: 'var(--text-2)' }}>Cancel</button>
            {saveError && <span className="text-[12px]" style={{ color: RED }}>{saveError}</span>}
          </div>
        </div>
      )}
      {!adding && saveError && <p className="text-[12px] mt-2" style={{ color: RED }}>{saveError}</p>}

      {list.map((c) => {
        const r = reads[c.id]
        const loaded = r && r !== 'loading' ? r : null
        const x = loaded && !loaded.error ? readChallenge(c, loaded.subs, loaded.at) : null
        const color = x ? STATE_COLOR[x.state] : 'var(--text-3)'
        // Stopped short: the oldest video read is newer than the start, so
        // older approvals in the window were not counted.
        const ats = loaded ? loaded.subs.map((s) => s.at).filter((t): t is number => t != null) : []
        const short = !!loaded && !loaded.error && !loaded.complete && ats.length > 0 && dayOf(Math.min(...ats)) > c.startsOn
        const pct = x ? Math.min(100, (x.approved / c.target) * 100) : 0
        const likelyPct = x ? Math.min(100 - pct, (x.likelyFromQueue / c.target) * 100) : 0
        return (
          <div key={c.id} className="mt-3 rounded-lg border p-3" style={{ borderColor: 'var(--border-2)' }} aria-label={`${c.brand} challenge`}>
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-[14px] font-bold" style={{ color: 'var(--text)' }}>{c.brand}</p>
              {x && <span className="text-[10.5px] font-bold rounded-full px-2 py-0.5 border" style={{ borderColor: color, color }}>{STATE_WORDS[x.state]}</span>}
              <span className="text-[12px]" style={{ color: 'var(--text-2)' }}>{c.target.toLocaleString('en-US')} approved by {shortDay(c.deadline)}{c.reward != null ? `, for $${c.reward.toLocaleString('en-US')}` : ''}. Counting from {shortDay(c.startsOn)}.</span>
              <span className="ml-auto flex items-center gap-2">
                <button type="button" onClick={() => void readOne(c)} disabled={r === 'loading'} className="text-[12px] font-semibold inline-flex items-center gap-1 disabled:opacity-50" style={{ color: PURPLE }}><RotateCcw size={11} /> Read again</button>
                <button type="button" onClick={() => void save((list || []).filter((y) => y.id !== c.id))} disabled={saving} aria-label={`Stop tracking ${c.brand}`} className="text-[12px] inline-flex items-center gap-0.5 disabled:opacity-50" style={{ color: 'var(--text-3)' }}><X size={12} /> Remove</button>
              </span>
            </div>
            {r === 'loading' && <p className="text-[12px] mt-2 inline-flex items-center gap-1.5" style={{ color: 'var(--text-3)' }}><Loader2 size={12} className="animate-spin" /> Reading your {c.brand} submissions through SCOUT...</p>}
            {loaded?.error && <p className="text-[12px] mt-2" style={{ color: AMBER }}>Not read, so where this stands is not known: {loaded.error}</p>}
            {x && (
              <>
                <div className="h-2.5 rounded-full mt-2 overflow-hidden flex" style={{ background: 'var(--surface-2)' }} role="progressbar" aria-valuemin={0} aria-valuemax={c.target} aria-valuenow={x.approved}>
                  <div className="h-full" style={{ width: `${pct}%`, background: x.state === 'done' ? GREEN : PURPLE }} />
                  {likelyPct > 0 && <div className="h-full" style={{ width: `${likelyPct}%`, background: PURPLE, opacity: 0.35 }} title="Waiting, likely to be approved" />}
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mt-2 tabular-nums">
                  <Tile label="Approved" value={`${x.approved.toLocaleString('en-US')} / ${c.target.toLocaleString('en-US')}`} />
                  <Tile label="Waiting" value={(x.pending + x.revision).toLocaleString('en-US')} sub={x.revision ? `${x.revision} in revision` : undefined} />
                  <Tile label="Send by" value={x.lagDays == null ? 'Not known' : shortDay(x.cutoff)} sub={x.lagDays ? `${x.lagDays} day${x.lagDays === 1 ? '' : 's'} before the end` : undefined} hot={x.lagDays != null && x.lagDays > 0 && x.state !== 'done'} />
                  <Tile label="A day needed" value={x.perDay == null ? 'Not known' : String(Math.ceil(x.perDay))} sub={x.toSend ? `${x.toSend.toLocaleString('en-US')} more to send` : undefined} />
                  <Tile label="Your last 7 days" value={`${x.pace7 >= 10 ? Math.round(x.pace7) : x.pace7.toFixed(1).replace(/\.0$/, '')} a day`} />
                </div>
                <div className="mt-2 grid gap-1">
                  {x.says.map((line, i) => <p key={i} className="text-[12.5px]" style={{ color: i === 0 ? 'var(--text)' : 'var(--text-2)' }}>{line}</p>)}
                </div>
                {short && <p className="text-[12px] mt-1.5" style={{ color: AMBER }}>MVP read your latest {loaded!.subs.length.toLocaleString('en-US')} {c.brand} submissions and stopped there; older ones from this challenge were not read, so the approved count may be low.</p>}
              </>
            )}
          </div>
        )
      })}
    </section>
  )
}

function Tile({ label, value, sub, hot }: { label: string; value: string; sub?: string; hot?: boolean }) {
  return (
    <div className="rounded-lg px-2.5 py-1.5" style={{ background: 'var(--surface-2)' }}>
      <p className="text-[10.5px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>{label}</p>
      <p className="text-[14px] font-bold" style={{ color: hot ? AMBER : 'var(--text)' }}>{value}</p>
      {sub && <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>{sub}</p>}
    </div>
  )
}

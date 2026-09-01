'use client'

/**
 * BulkMessageBrandModal — message MANY Creator Connections brands at once.
 *
 * You tick campaigns on the CC Campaigns grid (up to 100), open this, and:
 *   1. MVP drafts ONE reusable message group from your Outreach Profile + the
 *      options you tick, with [[PRODUCT]] / [[ASIN]] tokens.
 *   2. On send, it fills each brand's product + ASIN into that template and hands
 *      it to SCOUT, which accepts-if-needed and sends inside your Amazon session —
 *      one brand at a time, spaced out so Amazon doesn't flag the burst.
 *
 * Brands you've already messaged are skipped. A failed brand doesn't stop the
 * batch; you get a per-brand result list at the end and can retry the failures.
 */

import { useEffect, useState, useCallback, useRef } from 'react'
import { toast } from 'sonner'
import { X, Loader2, Sparkles, Send, Users, Plus, Trash2, Check, AlertTriangle, RotateCcw } from 'lucide-react'
import { requestSendByAsin, requestAcceptCampaign, getScoutStatus } from '@/lib/extension-frame'
import OutreachProfileModal from '@/components/collaborations/OutreachProfileModal'

export interface BulkCampaign {
  campaignId: string
  product: string
  asin: string
  brand: string | null
  detailsUrl: string
  commissionPct: number | null
}

interface Options {
  includeAsin: boolean
  includeLinks: boolean
  requestSample: boolean
  shareAddress: boolean
  offerLivestream: boolean
  offerBannerAds: boolean
}

const DEFAULT_OPTIONS: Options = {
  includeAsin: true,
  includeLinks: true,
  requestSample: true,
  shareAddress: false,
  offerLivestream: false,
  offerBannerAds: false,
}

const OPTS_KEY = 'mvp.messageBrand.opts.v2'
const ADDR_KEY = 'mvp.messageBrand.address.v1'
const TEMPLATES_KEY = 'mvp.cc.templates.v1'
const MARK = '---- Add to Message Group ----'

interface SavedTemplate { name: string; segments: string[]; opts: Options }
function loadTemplates(): SavedTemplate[] {
  try { const a = JSON.parse(localStorage.getItem(TEMPLATES_KEY) || '[]'); return Array.isArray(a) ? a : [] } catch { return [] }
}

const CHECKS: { key: keyof Options; label: string; msg: string }[] = [
  { key: 'includeAsin', label: 'Name the exact product & ASIN', msg: 'Msg 2' },
  { key: 'offerLivestream', label: 'Also offer a livestream', msg: 'Msg 2' },
  { key: 'offerBannerAds', label: 'Also offer banner-ad placement', msg: 'Msg 2' },
  { key: 'includeLinks', label: 'Include my portfolio & links', msg: 'Msg 3' },
  { key: 'requestSample', label: 'Request a free sample', msg: 'Msg 4' },
  { key: 'shareAddress', label: 'Share my shipping address', msg: 'Msg 4' },
]

function splitSegments(msg: string): string[] {
  const s = (msg || '').trim()
  const hasMarker = /-{2,}\s*add to message group\s*-{2,}/i.test(s)
  const parts = hasMarker ? s.split(/\s*-{2,}\s*add to message group\s*-{2,}\s*/i) : s.split(/\n\s*\n+/)
  const out = parts.map(x => x.trim()).filter(Boolean)
  return out.length ? out : ['']
}

// Fill one brand's product + ASIN into the reusable template and rejoin with the
// group marker SCOUT splits on.
function fillTemplate(segs: string[], product: string, asin: string): string {
  return segs
    .map(s => s.trim())
    .filter(Boolean)
    .map(s => s
      .replace(/\[\[\s*PRODUCT\s*\]\]/gi, product || 'your product')
      .replace(/\[\[\s*ASIN\s*\]\]/gi, asin || ''))
    .join(`\n\n${MARK}\n\n`)
}

// Turn SCOUT's terse machine reasons into a line the creator can act on.
function reasonText(raw: string): string {
  const s = String(raw || '').toLowerCase()
  if (/not-learned|no-recipe|no-send-recipe|no-search-recipe/.test(s))
    return 'SCOUT hasn’t captured your send yet — open Creator Connections, message any one brand by hand once, then hit Retry.'
  if (/no-creator-id/.test(s)) return 'Couldn’t read your Amazon creator profile — open Creator Connections in this browser, then Retry.'
  if (/no-campaign-for-asin/.test(s)) return 'This product isn’t in your accepted campaigns yet (accept may still be propagating) — Retry in a moment.'
  if (/no-context-token/.test(s)) return 'Amazon didn’t open a chat for this brand yet — Retry shortly.'
  if (/send-rejected/.test(s)) return 'Amazon rejected the message (length or content) — trim it and Retry.'
  if (/not[_-]?signed[_-]?in|signin|401|unauth/.test(s)) return 'You’re signed out of Amazon — sign in to Creator Connections, then Retry.'
  return raw || 'send failed'
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
// 4–8s between sends: spaces the burst out so Amazon doesn't rate-limit / flag it.
const gap = () => 4000 + Math.floor(Math.random() * 4000)

type SendState = 'pending' | 'sending' | 'sent' | 'failed' | 'skipped'
interface Row { campaign: BulkCampaign; state: SendState; error?: string; note?: string }

export default function BulkMessageBrandModal({ campaigns, alreadyMessaged, alreadyAccepted, onClose, onDone }: {
  campaigns: BulkCampaign[]
  /** Uppercased ASINs the user has already messaged — skipped, not re-sent. */
  alreadyMessaged: Set<string>
  /** Uppercased ASINs already accepted on Amazon — we skip the accept step. */
  alreadyAccepted: Set<string>
  onClose: () => void
  onDone?: () => void
}) {
  const [opts, setOpts] = useState<Options>(DEFAULT_OPTIONS)
  const [address, setAddress] = useState('')
  const [extraNotes, setExtraNotes] = useState('')
  const [segments, setSegments] = useState<string[]>([''])
  const [drafting, setDrafting] = useState(false)
  const [sending, setSending] = useState(false)
  const [rows, setRows] = useState<Row[]>([])
  const [editWording, setEditWording] = useState(false)
  const [templates, setTemplates] = useState<SavedTemplate[]>([])
  useEffect(() => { setTemplates(loadTemplates()) }, [])
  const cancelRef = useRef(false)

  const saveTemplate = () => {
    const clean = segments.map(s => s.trim()).filter(Boolean)
    if (clean.length === 0) { toast.error('Draft a message first.'); return }
    const name = (typeof window !== 'undefined' ? window.prompt('Save this message as a template. Name it:') : '')?.trim()
    if (!name) return
    const next = [...loadTemplates().filter(t => t.name !== name), { name, segments: clean, opts }]
    try { localStorage.setItem(TEMPLATES_KEY, JSON.stringify(next)) } catch { /* ignore */ }
    setTemplates(next)
    toast.success(`Saved “${name}”.`)
  }
  const applyTemplate = (name: string) => {
    const t = loadTemplates().find(x => x.name === name)
    if (!t) return
    setSegments(t.segments.length ? t.segments : [''])
    setOpts({ ...DEFAULT_OPTIONS, ...t.opts })
  }
  const deleteTemplate = (name: string) => {
    const next = loadTemplates().filter(t => t.name !== name)
    try { localStorage.setItem(TEMPLATES_KEY, JSON.stringify(next)) } catch { /* ignore */ }
    setTemplates(next)
  }

  // De-dupe by campaignId, then split into "will send" vs "already messaged".
  const unique = Array.from(new Map(campaigns.filter(c => c.campaignId && c.asin).map(c => [c.campaignId, c])).values())
  const notMessaged = unique.filter(c => !alreadyMessaged.has((c.asin || '').toUpperCase()))
  const skipped = unique.filter(c => alreadyMessaged.has((c.asin || '').toUpperCase()))
  // Fold multiple products from the SAME brand into ONE message — Amazon's brand
  // chat is per brand, so messaging each product would spam the same thread. Only
  // fold when the brand is known; unknown-brand rows each stand on their own.
  const seenBrand = new Set<string>()
  const toSend: BulkCampaign[] = []
  const folded: BulkCampaign[] = []
  for (const c of notMessaged) {
    const b = (c.brand || '').trim().toLowerCase()
    if (b && seenBrand.has(b)) { folded.push(c); continue }
    if (b) seenBrand.add(b)
    toSend.push(c)
  }

  useEffect(() => {
    try {
      const o = localStorage.getItem(OPTS_KEY)
      if (o) setOpts({ ...DEFAULT_OPTIONS, ...JSON.parse(o) })
      const a = localStorage.getItem(ADDR_KEY)
      if (a) setAddress(a)
    } catch { /* ignore */ }
  }, [])

  const draft = useCallback(async () => {
    setDrafting(true)
    try {
      const res = await fetch('/api/campaigns/outreach', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          template: true,
          options: { ...opts, address: opts.shareAddress ? address : '' },
          extraNotes,
        }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok || !d.message) throw new Error(d.error || 'Could not draft the template')
      setSegments(splitSegments(d.message))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Draft failed')
    } finally { setDrafting(false) }
  }, [opts, address, extraNotes])

  // Draft the template once on open.
  useEffect(() => { draft() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [])

  const toggle = (k: keyof Options) => setOpts(o => {
    const next = { ...o, [k]: !o[k] }
    try { localStorage.setItem(OPTS_KEY, JSON.stringify(next)) } catch { /* ignore */ }
    return next
  })
  const updateSeg = (i: number, v: string) => setSegments(s => s.map((x, j) => (j === i ? v : x)))
  const removeSeg = (i: number) => setSegments(s => (s.length > 1 ? s.filter((_, j) => j !== i) : s))
  const addSeg = () => setSegments(s => [...s, ''])

  const cleanSegments = segments.map(s => s.trim()).filter(Boolean)
  const hasPlaceholder = /\[\[\s*(product|asin)\s*\]\]/i.test(cleanSegments.join(' '))

  // Send the template to a given set of campaigns, sequentially + paced.
  const runBatch = useCallback(async (targets: BulkCampaign[]) => {
    if (cleanSegments.length === 0) { toast.error('Draft a message first.'); return }
    // One SCOUT presence check up front, so we don't hammer 100 sends at a wall.
    const scout = await getScoutStatus().catch(() => ({ installed: false, version: null as string | null }))
    if (!scout.installed) { toast.error('Install / enable SCOUT and sign in to Amazon, then try again.'); return }
    // We DON'T pre-gate on a recipe probe anymore. The old probe blocked the whole
    // batch (and dead-ended the Send button) whenever it was slow, timed out, or a
    // fresh SCOUT install had lost the learned send — even when a real recipe was
    // present. The send itself is the source of truth: a learned recipe goes
    // through, and a genuinely missing one surfaces as an honest per-brand reason
    // (handled below), so the only real requirement is SCOUT installed + logged in.
    if (opts.shareAddress && address.trim()) { try { localStorage.setItem(ADDR_KEY, address.trim()) } catch { /* ignore */ } }

    cancelRef.current = false
    setSending(true)
    // Seed the rows: queued to send, folded same-brand duplicates, and
    // already-messaged — the last two shown as skipped with the reason.
    setRows([
      ...targets.map(c => ({ campaign: c, state: 'pending' as SendState })),
      ...folded.map(c => ({ campaign: c, state: 'skipped' as SendState, note: `Same brand as ${c.brand || 'another'} — messaged once` })),
      ...skipped.map(c => ({ campaign: c, state: 'skipped' as SendState, note: 'Already messaged' })),
    ])

    for (let i = 0; i < targets.length; i++) {
      if (cancelRef.current) break
      const c = targets[i]
      setRows(rs => rs.map(r => (r.campaign.campaignId === c.campaignId ? { ...r, state: 'sending' } : r)))
      let ok = false, err = ''
      try {
        const message = fillTemplate(segments, c.product, c.asin)
        // Auto-accept first: Amazon opens the brand chat only after you accept the
        // campaign, so join every brand we're about to message (skip the ones
        // already accepted). Best-effort — if accept fails, the send below still
        // tries and reports its own reason.
        let justAccepted = false
        if (!alreadyAccepted.has((c.asin || '').toUpperCase())) {
          try {
            const acc = await requestAcceptCampaign(c.detailsUrl)
            if (acc.ok && !acc.already) {
              justAccepted = true
              void fetch('/api/campaigns/mark-accepted', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ asin: c.asin, campaignId: c.campaignId, detailsUrl: c.detailsUrl, brand: c.brand, commissionPct: c.commissionPct, productTitle: c.product }),
              }).catch(() => {})
            }
          } catch { /* accept is best-effort */ }
        }
        // Give Amazon a moment to index a fresh acceptance before the chat lookup.
        if (justAccepted) await sleep(2500)
        // Fully background: hidden-tab replay of Amazon's own search → chat/send
        // API (no visible tab, no on-page button). Retry once if a just-accepted
        // campaign hasn't propagated to the collaboration search yet.
        let r = await requestSendByAsin(c.asin, message, [c.campaignId])
        if (!r.ok && justAccepted) { await sleep(3500); r = await requestSendByAsin(c.asin, message, [c.campaignId]) }
        ok = !!r.ok
        err = r.ok ? '' : reasonText(r.reason || r.error || 'send failed')
        try { console.warn('[MVP bulk] send result:', c.brand || c.asin, r) } catch { /* ignore */ }
        if (ok) {
          try {
            await fetch('/api/campaigns/mark-messaged', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ asin: c.asin, message }),
            })
          } catch { /* the message went out — recording is best-effort */ }
        }
      } catch (e) { ok = false; err = e instanceof Error ? e.message : 'send failed' }
      setRows(rs => rs.map(r => (r.campaign.campaignId === c.campaignId ? { ...r, state: ok ? 'sent' : 'failed', error: ok ? undefined : err } : r)))
      // Pace the burst (skip the wait after the last one / on cancel).
      if (i < targets.length - 1 && !cancelRef.current) await sleep(gap())
    }

    setSending(false)
    onDone?.()
  }, [segments, cleanSegments.length, opts.shareAddress, address, skipped, folded, alreadyAccepted, onDone])

  const started = rows.length > 0
  const sentCount = rows.filter(r => r.state === 'sent').length
  const failedRows = rows.filter(r => r.state === 'failed')
  const doneCount = rows.filter(r => r.state === 'sent' || r.state === 'failed').length
  const finished = started && !sending && doneCount + rows.filter(r => r.state === 'skipped').length >= rows.length && rows.some(r => r.state !== 'skipped')

  const stateChip = (s: SendState) => {
    const map: Record<SendState, { c: string; bg: string; t: string }> = {
      pending: { c: 'var(--text-faint)', bg: 'var(--surface-2)', t: 'Queued' },
      sending: { c: '#7C3AED', bg: 'rgba(124,58,237,0.12)', t: 'Sending…' },
      sent: { c: '#1c7a35', bg: 'rgba(52,199,89,0.15)', t: 'Sent' },
      failed: { c: '#b3261e', bg: 'rgba(255,59,48,0.12)', t: 'Failed' },
      skipped: { c: '#8a6d00', bg: 'rgba(255,204,0,0.15)', t: 'Skipped' },
    }
    return map[s]
  }

  return (
   <>
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.55)' }} onClick={sending ? undefined : onClose}>
      <div className="w-full max-w-lg rounded-2xl overflow-hidden flex flex-col max-h-[92vh] bg-white dark:bg-[#111113]" style={{ border: '1px solid var(--border)' }} onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 p-5 pb-3">
          <div className="min-w-0">
            <h2 className="text-[17px] font-bold flex items-center gap-2" style={{ color: 'var(--text)' }}>
              <Users size={17} className="text-[#7C3AED]" /> Message {toSend.length} {toSend.length === 1 ? 'brand' : 'brands'}
            </h2>
            <p className="text-[13px] mt-0.5" style={{ color: 'var(--text-soft)' }}>
              One message, filled with each brand&apos;s product{folded.length > 0 ? ` · ${folded.length} same-brand folded` : ''}{skipped.length > 0 ? ` · ${skipped.length} already messaged` : ''}
            </p>
          </div>
          {!sending && <button onClick={onClose} aria-label="Close" className="p-1 rounded-md hover:bg-black/5" style={{ color: 'var(--text-faint)' }}><X size={18} /></button>}
        </div>

        <div className="px-5 overflow-y-auto">
          {!started ? (
            <>
              <div className="rounded-lg border p-2.5 mb-2 text-[12px] leading-relaxed flex items-start gap-2" style={{ borderColor: 'var(--border)', background: 'var(--surface-2)', color: 'var(--text-soft)' }}>
                <span aria-hidden className="mt-[1px]">🔐</span>
                <span>
                  Make sure you&apos;re signed into{' '}
                  <a href="https://affiliate-program.amazon.com/p/connect/requests?status=opportunity&type=affiliate-plus" target="_blank" rel="noreferrer" className="font-semibold" style={{ color: '#7C3AED' }}>Amazon Creator Connections</a>{' '}
                  in this browser with SCOUT installed, then hit send. Everything runs in the background, no tabs open.
                </span>
              </div>
              <div className="rounded-lg border p-2.5 mb-3 text-[12px] leading-relaxed flex items-start gap-2" style={{ borderColor: '#c99a2e', background: 'rgba(245,158,11,0.09)', color: 'var(--text)' }}>
                <span aria-hidden className="mt-[1px]">🤝</span>
                <span style={{ color: 'var(--text-soft)' }}>
                  <b style={{ color: 'var(--text)' }}>Heads up:</b> sending also <b style={{ color: 'var(--text)' }}>accepts (joins) each brand&apos;s campaign</b> on Amazon first, since a brand&apos;s chat only opens once you&apos;ve joined. So the {toSend.length} {toSend.length === 1 ? 'brand' : 'brands'} you message here will also be joined on your account.
                </span>
              </div>
              <p className="text-[11px] font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--text-faint)' }}>Add to every message</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5">
                {CHECKS.map(c => (
                  <label key={c.key} className="flex items-center gap-2 text-[13px] cursor-pointer" style={{ color: 'var(--text)' }}>
                    <input type="checkbox" checked={opts[c.key]} onChange={() => toggle(c.key)} className="accent-[#7C3AED] w-4 h-4 flex-shrink-0" />
                    <span className="min-w-0">{c.label}</span>
                    <span className="ml-auto text-[9px] font-bold uppercase tracking-wide px-1 py-[1px] rounded flex-shrink-0" style={{ background: 'rgba(124,58,237,0.10)', color: '#9D6BFF' }}>{c.msg}</span>
                  </label>
                ))}
              </div>

              {opts.shareAddress && (
                <input value={address} onChange={e => setAddress(e.target.value)}
                  placeholder="Shipping / forwarding address for samples"
                  className="mt-3 w-full px-3 py-2 rounded-lg border text-[13px] bg-transparent"
                  style={{ borderColor: 'var(--border)', color: 'var(--text)' }} />
              )}
              <input value={extraNotes} onChange={e => setExtraNotes(e.target.value)}
                placeholder="Anything else to mention in every message (optional)"
                className="mt-2 w-full px-3 py-2 rounded-lg border text-[13px] bg-transparent"
                style={{ borderColor: 'var(--border)', color: 'var(--text)' }} />

              {/* Saved templates — reuse a proven angle without re-ticking options. */}
              <div className="flex items-center gap-2 mt-3">
                <select value="" onChange={e => { if (e.target.value) applyTemplate(e.target.value) }}
                  className="text-[12px] px-2 py-1.5 rounded-lg border bg-transparent" style={{ borderColor: 'var(--border)', color: 'var(--text)' }}>
                  <option value="">Load a saved template…</option>
                  {templates.map(t => <option key={t.name} value={t.name}>{t.name}</option>)}
                </select>
                <button type="button" onClick={saveTemplate} className="text-[12px] font-medium hover:underline" style={{ color: '#7C3AED' }}>Save current</button>
                {templates.length > 0 && (
                  <button type="button" onClick={() => { const n = window.prompt('Delete which template? Type its exact name:')?.trim(); if (n) deleteTemplate(n) }} className="text-[12px] font-medium hover:underline ml-auto" style={{ color: 'var(--text-faint)' }}>Delete…</button>
                )}
              </div>

              <div className="flex items-center justify-between mt-4 mb-1.5">
                <p className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-faint)' }}>
                  Template {cleanSegments.length > 0 && <span>· each brand&apos;s product fills in</span>}
                </p>
                <button onClick={draft} disabled={drafting}
                  className="inline-flex items-center gap-1 text-[12px] font-semibold text-[#7C3AED] hover:underline disabled:opacity-50">
                  {drafting ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />} {cleanSegments.length ? 'Regenerate' : 'Generate'}
                </button>
              </div>

              {drafting && cleanSegments.length === 0 ? (
                <div className="flex items-center gap-2 text-[13px] py-6 justify-center" style={{ color: 'var(--text-faint)' }}>
                  <Loader2 size={14} className="animate-spin" /> Drafting your template…
                </div>
              ) : (
                <div className="space-y-2.5">
                  {segments.map((seg, i) => {
                    const over = seg.length > 1000
                    return (
                      <div key={i} className="rounded-lg border" style={{ borderColor: over ? '#ff3b30' : 'var(--border)' }}>
                        <div className="flex items-center justify-between px-2.5 pt-1.5">
                          <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-[1px] rounded" style={{ background: 'rgba(124,58,237,0.12)', color: '#7C3AED' }}>Message {i + 1}</span>
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] tabular-nums" style={{ color: over ? '#ff3b30' : 'var(--text-faint)' }}>{seg.length}/1000</span>
                            {segments.length > 1 && (
                              <button onClick={() => removeSeg(i)} aria-label={`Remove message ${i + 1}`} className="p-0.5 rounded hover:bg-black/5" style={{ color: 'var(--text-faint)' }}><Trash2 size={13} /></button>
                            )}
                          </div>
                        </div>
                        <textarea value={seg} onChange={e => updateSeg(i, e.target.value)}
                          rows={Math.min(6, Math.max(2, Math.ceil((seg.length || 1) / 55)))}
                          placeholder={`Message ${i + 1}…`}
                          className="w-full px-2.5 pb-2 pt-1 text-[13px] bg-transparent leading-relaxed outline-none resize-y"
                          style={{ color: 'var(--text)' }} />
                      </div>
                    )
                  })}
                  <button onClick={addSeg} className="inline-flex items-center gap-1 text-[12px] font-semibold text-[#7C3AED] hover:underline"><Plus size={13} /> Add a message</button>
                  <p className="text-[11px] leading-relaxed pt-1" style={{ color: 'var(--text-faint)' }}>
                    <b>[[PRODUCT]]</b> and <b>[[ASIN]]</b> get replaced with each brand&apos;s own product when it sends. Keep them in the message.
                    {' '}Greeting, credibility, links &amp; sample address come from your saved profile —{' '}
                    <button type="button" onClick={() => setEditWording(true)} className="font-semibold underline" style={{ color: '#7C3AED' }}>edit it here</button>.
                  </p>
                </div>
              )}
            </>
          ) : (
            // Sending / results view.
            <div className="space-y-1.5 pb-1">
              {rows.map(r => {
                const chip = stateChip(r.state)
                return (
                  <div key={r.campaign.campaignId} className="flex items-center gap-2 rounded-lg border px-2.5 py-1.5" style={{ borderColor: 'var(--border)' }}>
                    <span className="min-w-0 flex-1">
                      <span className="text-[12px] font-medium block truncate" style={{ color: 'var(--text)' }}>{r.campaign.brand || 'Unknown brand'}</span>
                      <span className="text-[11px] block truncate" style={{ color: 'var(--text-faint)' }}>{r.campaign.product || r.campaign.asin}</span>
                      {r.note && <span className="text-[11px] block" style={{ color: '#8a6d00' }}>{r.note}</span>}
                      {r.error && <span className="text-[11px] block" style={{ color: '#b3261e' }}>{r.error}</span>}
                    </span>
                    <span className="text-[10px] font-semibold px-1.5 py-[2px] rounded flex-shrink-0 inline-flex items-center gap-1" style={{ background: chip.bg, color: chip.c }}>
                      {r.state === 'sending' && <Loader2 size={10} className="animate-spin" />}
                      {r.state === 'sent' && <Check size={10} />}
                      {r.state === 'failed' && <AlertTriangle size={10} />}
                      {chip.t}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {sending && (
          <div className="px-5 pt-3">
            <div className="flex items-center justify-between text-[11px] mb-1" style={{ color: 'var(--text-soft)' }}>
              <span>Sending {doneCount + 1 > toSend.length ? toSend.length : doneCount + 1} of {toSend.length}… (paced to protect your account)</span>
              <span className="tabular-nums">{Math.round((doneCount / Math.max(1, toSend.length)) * 100)}%</span>
            </div>
            <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--surface-2)' }}>
              <div className="h-full transition-all duration-300 ease-linear" style={{ width: `${(doneCount / Math.max(1, toSend.length)) * 100}%`, background: 'linear-gradient(45deg, #7C3AED 0%, #bc1888 100%)' }} />
            </div>
          </div>
        )}

        <div className="p-5 pt-3 flex items-center gap-2 border-t" style={{ borderColor: 'var(--border)' }}>
          {!started ? (
            <>
              <button onClick={onClose} className="px-4 py-2 rounded-lg text-[13px] font-semibold" style={{ color: 'var(--text-soft)' }}>Cancel</button>
              <button onClick={() => runBatch(toSend)} disabled={drafting || cleanSegments.length === 0 || toSend.length === 0 || !hasPlaceholder}
                className="ml-auto inline-flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-semibold text-white disabled:opacity-50"
                style={{ background: 'linear-gradient(45deg, #7C3AED 0%, #bc1888 100%)' }}>
                <Send size={14} /> Send to {toSend.length} {toSend.length === 1 ? 'brand' : 'brands'}
              </button>
            </>
          ) : sending ? (
            <button onClick={() => { cancelRef.current = true }} className="ml-auto inline-flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-semibold border" style={{ borderColor: 'var(--border)', color: 'var(--text)' }}>
              Stop after current
            </button>
          ) : (
            <>
              <span className="text-[12px]" style={{ color: 'var(--text-soft)' }}>
                {sentCount} sent{failedRows.length ? ` · ${failedRows.length} failed` : ''}{(skipped.length + folded.length) ? ` · ${skipped.length + folded.length} skipped` : ''}
              </span>
              {failedRows.length > 0 && (
                <button onClick={() => runBatch(failedRows.map(r => r.campaign))} className="ml-auto inline-flex items-center gap-2 px-3 py-2 rounded-lg text-[13px] font-semibold border" style={{ borderColor: 'var(--border)', color: 'var(--text)' }}>
                  <RotateCcw size={13} /> Retry {failedRows.length} failed
                </button>
              )}
              <button onClick={onClose} className={`${failedRows.length > 0 ? '' : 'ml-auto'} inline-flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-semibold text-white`} style={{ background: 'linear-gradient(45deg, #7C3AED 0%, #bc1888 100%)' }}>Done</button>
            </>
          )}
        </div>
        {!started && (
          <p className="px-5 pb-4 -mt-1 text-[11px]" style={{ color: 'var(--text-faint)' }}>
            SCOUT joins each brand&apos;s campaign if you haven&apos;t already, then sends from your Amazon session, one brand at a time spaced a few seconds apart so the burst isn&apos;t flagged. Keep this tab open; a failed brand won&apos;t stop the rest.
            {finished ? '' : !hasPlaceholder && cleanSegments.length > 0 ? ' Add [[PRODUCT]] / [[ASIN]] back into the message so each brand is named.' : ''}
          </p>
        )}
      </div>
    </div>
    {editWording && <OutreachProfileModal onClose={() => setEditWording(false)} />}
   </>
  )
}

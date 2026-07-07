'use client'

/**
 * AMZ Product Finder — the MVP Finder + Saved shelf for Amazon Creator
 * Connections (Affiliate+) and onsite products.
 *
 * Flow:
 *   1. Connect SCOUT (paste the ingest token here).
 *   2. Keep SCOUT updated (Web Store auto-updates; sideloaders get a nudge).
 *   3. Search the MVP Finder — MVP's proprietary criteria surface the campaigns
 *      / products worth your time; Save the winners.
 *   → Saved-for-later shelf holds your buy-to-review shortlist (Message brand /
 *      Buy to review / Remove).
 *
 * The old Campaign queue (SCOUT-imported campaigns + per-row Generate) was
 * retired 2026-07-06 — discovery lives in the Finder, follow-up in the Saved
 * shelf. The legacy campaigns table + /api/campaigns/{generate,ingest,…} stay in
 * place but are no longer surfaced here. Lives in the sidebar "Labs" group,
 * Pro-only (canUseLabs in DashboardShellV2).
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import PageHero from '@/components/layout/PageHero'
import { CheckCircle2, Download, Copy, RefreshCw, KeyRound, ChevronDown, ChevronRight, FlaskConical } from 'lucide-react'
import { toast } from 'sonner'
import { getScoutInstallKind } from '@/lib/extension-frame'
import MessageBrandModal, { type MessageBrandCampaign } from '@/components/campaigns/MessageBrandModal'
import SmartScanPanel from '@/components/campaigns/SmartScanPanel'
import SavedFinds from '@/components/campaigns/SavedFinds'
import { SCOUT_STORE_LISTING_URL } from '@/lib/scout-version'

// The REAL Creator Connections app (Amazon's 2026 redesign). The legacy
// www.amazon.com/creatorconnections/ URL is a dead shell that renders nothing;
// this deep-link opens the actual campaign grid (the app resolves the creator's
// id from their logged-in session).
const CC_URL = 'https://affiliate-program.amazon.com/p/connect/requests?status=opportunity&type=affiliate-plus'

export default function EpcScoutPage() {
  const [token, setToken] = useState<string | null>(null)
  // Only the ASINs are read (SmartScanPanel skips ones already covered), so a
  // lightweight shape is enough — /api/campaigns/list returns full rows.
  const [covered, setCovered] = useState<{ asin: string }[]>([])
  const [loading, setLoading] = useState(true)
  // The setup/how-it-works panel is collapsed by default; it auto-opens only for
  // users who haven't connected SCOUT yet.
  const [setupOpen, setSetupOpen] = useState(false)
  const [storeOpen, setStoreOpen] = useState(false)
  const finderRef = useRef<HTMLDivElement>(null) // step-3 pill scrolls here

  const [msgModal, setMsgModal] = useState<MessageBrandCampaign | null>(null)
  // Bumped when the Finder saves/unsaves a find → SavedFinds reloads.
  const [savedReloadKey, setSavedReloadKey] = useState(0)
  // Which SCOUT is installed (via MVP_PING) → drives the "move to the Web Store"
  // nudge for legacy sideloaders. null = not yet checked; store installs
  // auto-update so they get no banner at all.
  const [scout, setScout] = useState<{ kind: 'store' | 'sideload' | 'none'; version: string | null } | null>(null)

  useEffect(() => { getScoutInstallKind().then(setScout).catch(() => setScout({ kind: 'none', version: null })) }, [])

  const loadList = useCallback(async () => {
    try {
      const res = await fetch('/api/campaigns/list')
      const d = await res.json()
      if (res.ok) setCovered((d.campaigns ?? []).map((c: { asin: string }) => ({ asin: c.asin })))
    } catch { /* best-effort */ }
  }, [])

  useEffect(() => {
    (async () => {
      setLoading(true)
      await Promise.all([
        loadList(),
        fetch('/api/campaigns/ingest-token').then(r => r.json()).then(d => setToken(d.token ?? null)).catch(() => {}),
      ])
      setLoading(false)
    })()
  }, [loadList])

  const copyToken = useCallback(() => {
    if (!token) return
    navigator.clipboard.writeText(token).then(() => toast.success('Token copied')).catch(() => toast.error('Copy failed'))
  }, [token])

  const regenToken = useCallback(async () => {
    try {
      const res = await fetch('/api/campaigns/ingest-token', { method: 'POST' })
      const d = await res.json()
      if (res.ok) { setToken(d.token); toast.success('New token minted — re-paste it into the extension.') }
    } catch { toast.error('Could not regenerate token') }
  }, [])

  // Setup panel: honor a saved preference; otherwise open it only for users who
  // haven't connected a token yet (everyone else jumps straight to the Finder).
  useEffect(() => {
    if (loading) return
    let stored: string | null = null
    try { stored = localStorage.getItem('epc_setup_open') } catch { /* ignore */ }
    if (stored != null) setSetupOpen(stored === '1')
    else if (!token) setSetupOpen(true)
  }, [loading, token])
  const toggleSetup = useCallback(() => {
    setSetupOpen(o => { const n = !o; try { localStorage.setItem('epc_setup_open', n ? '1' : '0') } catch { /* ignore */ } return n })
  }, [])

  return (
    <>
      <div className="mb-2">
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wide"
          style={{ background: 'rgba(124,58,237,0.12)', color: '#7C3AED' }}>
          <FlaskConical size={11} /> MVP Labs · experimental
        </span>
      </div>
      <PageHero
        title="AMZ Product Finder"
        subtitle="A proven way to accelerate your Amazon commissions — Onsite + Affiliate+ (Creator Connections). One search, MVP-approved results: campaigns worth accepting, and products worth buying to review."
      />

      {/* ── Numbered setup steps — Connect → Update → Search. Steps 1 & 2 are
             expand-on-click pills; step 3 points at the MVP Finder below. Each
             carries a numbered badge (✓ green once that step is satisfied). ── */}
      <div className="flex items-center gap-1.5 flex-wrap mb-4">
        {/* Step 1 — Connect SCOUT */}
        <button onClick={toggleSetup} aria-expanded={setupOpen}
          className="inline-flex items-center gap-2 pl-1.5 pr-3 py-1.5 rounded-full border text-[12px] font-semibold transition-colors"
          style={setupOpen
            ? { borderColor: 'rgba(124,58,237,0.5)', background: 'rgba(124,58,237,0.08)', color: 'var(--text)' }
            : { borderColor: 'var(--border)', color: 'var(--text-soft)' }}>
          <span className="grid place-items-center w-5 h-5 rounded-full text-[11px] font-bold text-white flex-shrink-0"
            style={{ background: token ? '#34c759' : '#7C3AED' }}>
            {token ? <CheckCircle2 size={12} /> : '1'}
          </span>
          Connect
          <ChevronDown size={13} style={{ color: 'var(--text-faint)', transform: setupOpen ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }} />
        </button>

        <ChevronRight size={13} style={{ color: 'var(--text-faint)' }} />

        {/* Step 2 — Update SCOUT. Sideload = actionable amber; store = auto (green, done). */}
        {scout?.kind === 'sideload' ? (
          <button onClick={() => setStoreOpen(o => !o)} aria-expanded={storeOpen}
            className="inline-flex items-center gap-2 pl-1.5 pr-3 py-1.5 rounded-full border text-[12px] font-semibold transition-colors"
            style={storeOpen
              ? { borderColor: 'rgba(124,58,237,0.5)', background: 'rgba(124,58,237,0.08)', color: 'var(--text)' }
              : { borderColor: 'rgba(245,158,11,0.45)', background: 'rgba(245,158,11,0.08)', color: '#b26a00' }}>
            <span className="grid place-items-center w-5 h-5 rounded-full text-[11px] font-bold text-white flex-shrink-0" style={{ background: '#f59e0b' }}>2</span>
            Update SCOUT
            <ChevronDown size={13} style={{ transform: storeOpen ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }} />
          </button>
        ) : (
          <span className="inline-flex items-center gap-2 pl-1.5 pr-3 py-1.5 rounded-full border text-[12px] font-semibold"
            style={{ borderColor: 'rgba(52,199,89,0.4)', background: 'rgba(52,199,89,0.06)', color: '#1f8a3a' }}
            title="You're on the Web Store build — Chrome keeps SCOUT updated automatically.">
            <span className="grid place-items-center w-5 h-5 rounded-full text-white flex-shrink-0" style={{ background: '#34c759' }}><CheckCircle2 size={12} /></span>
            SCOUT auto-updates
          </span>
        )}

        <ChevronRight size={13} style={{ color: 'var(--text-faint)' }} />

        {/* Step 3 — Search. Scrolls to the MVP Finder card below. */}
        <button
          onClick={() => finderRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
          className="inline-flex items-center gap-2 pl-1.5 pr-3 py-1.5 rounded-full border text-[12px] font-semibold transition-colors"
          style={{ borderColor: 'var(--border)', color: 'var(--text-soft)' }}>
          <span className="grid place-items-center w-5 h-5 rounded-full text-[11px] font-bold text-white flex-shrink-0" style={{ background: '#7C3AED' }}>3</span>
          Search the MVP Finder
        </button>
      </div>

      {/* Update-SCOUT panel — reinstall from the Web Store for auto-updates. */}
      {storeOpen && scout?.kind === 'sideload' && (
        <div className="rounded-xl border p-4 mb-4 flex items-start gap-3"
          style={{ background: 'rgba(124,58,237,0.06)', borderColor: 'rgba(124,58,237,0.35)' }}>
          <RefreshCw size={16} className="flex-shrink-0 mt-0.5" style={{ color: '#7C3AED' }} />
          <div className="min-w-0">
            <p className="text-[13px] font-semibold" style={{ color: 'var(--text)' }}>
              Move SCOUT to the Chrome Web Store
            </p>
            <p className="text-[12px] leading-relaxed mt-1" style={{ color: 'var(--text-soft)' }}>
              You&apos;re on an older manually-loaded copy of SCOUT that Chrome can&apos;t keep updated. Reinstall from the Chrome Web Store once and Chrome will handle every future update for you automatically — then you can remove the old load-unpacked copy.
            </p>
            <div className="flex items-center gap-3 mt-2 flex-wrap">
              <a href={SCOUT_STORE_LISTING_URL} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold text-white"
                style={{ background: '#7C3AED' }}>
                <Download size={13} /> Reinstall from the Chrome Web Store
              </a>
            </div>
          </div>
        </div>
      )}

      {/* How-it-works / connect panel — expands from the pill above. */}
      {setupOpen && (
        <div className="card mb-5 overflow-hidden">
          <div className="px-4 pb-4 pt-4">
            <p className="text-[12px] leading-relaxed mb-3" style={{ color: 'var(--text-soft)' }}>
              Only works if your <a href={CC_URL} target="_blank" rel="noopener noreferrer" className="underline">Amazon Associates</a> account has <strong>Creator Connections</strong> (an Amazon invite — most creators don&rsquo;t have it yet). It scans both programs: <strong>Affiliate+</strong> (extra commission per sale) and <strong>Sponsored Products / EPC</strong> (paid per click). No Creator Connections tab = nothing to scan — use Reviews, Comparisons or Buying Guides instead.
            </p>
            <ol className="text-[12px] leading-relaxed list-decimal pl-5 mb-4 space-y-1" style={{ color: 'var(--text-soft)' }}>
              <li><a href={SCOUT_STORE_LISTING_URL} target="_blank" rel="noopener noreferrer" className="text-[#7C3AED] font-medium hover:underline inline-flex items-center gap-0.5">Install SCOUT <Download size={10} /></a> — one click from the Chrome Web Store.</li>
              <li>Copy your token below → paste into the SCOUT popup → <span className="font-medium">Connect</span>.</li>
              <li>Search the <span className="font-medium">MVP Finder</span> below — it surfaces the MVP-approved campaigns &amp; products. Hit <span className="font-medium">Save</span> on the winners.</li>
              <li>They land in <span className="font-medium">Saved for later</span> — your buy-to-review shortlist to Message the brand or Buy &amp; review.</li>
            </ol>
            <label className="block text-[10px] uppercase tracking-wide font-semibold mb-1" style={{ color: 'var(--text-faint)' }}>
              <KeyRound size={11} className="inline mr-1" /> Your ingest token
            </label>
            <div className="flex items-center gap-2 flex-wrap">
              <code className="px-3 py-2 rounded-lg border text-[12px] font-mono break-all flex-1 min-w-[240px]" style={{ borderColor: 'var(--border)', color: 'var(--text)' }}>
                {token ?? (loading ? 'loading…' : '—')}
              </code>
              <button onClick={copyToken} disabled={!token}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-semibold text-white disabled:opacity-50"
                style={{ background: 'linear-gradient(45deg, #7C3AED 0%, #bc1888 100%)' }}>
                <Copy size={13} /> Copy
              </button>
              <button onClick={regenToken}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-semibold border"
                style={{ borderColor: 'var(--border)', color: 'var(--text-soft)' }} title="Mint a new token (invalidates the old one)">
                <RefreshCw size={12} /> Regenerate
              </button>
            </div>
            <p className="text-[11px] mt-2" style={{ color: 'var(--text-faint)' }}>
              This token lets the extension push into <span className="font-medium">your</span> account. Keep it private; regenerate if it leaks.
            </p>
          </div>
        </div>
      )}

      {/* ── Step 3 · Search — MVP's opinionated one-click finder ──────────── */}
      <div ref={finderRef} className="scroll-mt-24">
        <div className="flex items-center gap-2 mb-2">
          <span className="grid place-items-center w-5 h-5 rounded-full text-[11px] font-bold text-white flex-shrink-0" style={{ background: '#7C3AED' }}>3</span>
          <p className="text-[13px] font-bold uppercase tracking-wide" style={{ color: '#7C3AED' }}>Search the MVP Finder</p>
          <span className="text-[11px] font-medium" style={{ color: 'var(--text-faint)' }}>— run your searches here</span>
        </div>
        <SmartScanPanel
          coveredAsins={covered.map(c => c.asin)}
          onMessageBrand={(c) => setMsgModal(c)}
          onSavedChange={() => setSavedReloadKey(k => k + 1)}
        />
        <p className="text-[11px] leading-relaxed mt-2 px-1" style={{ color: 'var(--text-faint)' }}>
          MVP does not guarantee commissions or any type of return. The MVP Finder is simply a focused search through Amazon affiliate campaigns using criteria that have been fruitful for influencers over the past 4 years — actual results depend on the product, your content, and your audience.
        </p>
      </div>

      {/* ── Saved for later — the buy-to-review shortlist (replaced the old
             Campaign queue 2026-07-06). Fed by the Finder's Save button. ── */}
      <SavedFinds reloadKey={savedReloadKey} onMessageBrand={(c) => setMsgModal(c)} />

      {msgModal && <MessageBrandModal campaign={msgModal} onClose={() => setMsgModal(null)} onSent={loadList} />}
    </>
  )
}

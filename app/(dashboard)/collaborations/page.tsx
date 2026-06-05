'use client'

import { useState, useEffect, useCallback } from 'react'
import { toast } from 'sonner'
import PageHero from '@/components/layout/PageHero'
import { TutorialVideo } from '@/components/TutorialVideo'
import { CapReachedBanner } from '@/components/CapReachedBanner'
import { useConfirm } from '@/components/ui/useConfirm'
import FeatureLockedCard from '@/components/ui/FeatureLockedCard'
import { createBrowserClient } from '@/lib/supabase/client'
import { type Tier } from '@/lib/tier'
import { effectiveTier, VIEW_AS_EVENT } from '@/lib/view-as'
import { Loader2, Sparkles, Copy, CheckCircle, AlertCircle, Trash2, Save, Handshake } from 'lucide-react'

interface CollabRow {
  id: string
  brand_name: string
  platforms: string[]
  generated_email: string
  created_at: string
}

function YesNo({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="inline-flex rounded-lg overflow-hidden border border-gray-200 dark:border-white/10">
      {[true, false].map(v => (
        <button
          key={String(v)}
          type="button"
          onClick={() => onChange(v)}
          className={`px-3 py-1.5 text-xs font-semibold transition-colors ${
            value === v
              ? 'bg-[#7C3AED] text-white'
              : 'bg-white dark:bg-[#1c1c1e] text-[#6e6e73] dark:text-[#ebebf0]'
          }`}
        >
          {v ? 'Yes' : 'No'}
        </button>
      ))}
    </div>
  )
}

export default function CollaborationsPage() {
  const { confirm, ConfirmHost } = useConfirm()
  const [brandName, setBrandName] = useState('')
  const [productOrAsin, setProductOrAsin] = useState('')
  const [amazonStorefront, setAmazonStorefront] = useState('')
  const [websiteUrl, setWebsiteUrl] = useState('')
  const [youtubeUrl, setYoutubeUrl] = useState('')
  const [portfolioUrl, setPortfolioUrl] = useState('')
  // Extra reach-out channels brands can use besides email. Stored on
  // brand_profiles so we only ask once; pre-fills on subsequent pitches.
  const [whatsapp, setWhatsapp] = useState('')
  const [wechat, setWechat] = useState('')
  const [lark, setLark] = useState('')

  const [allPlatforms, setAllPlatforms] = useState<string[]>([])
  const [platforms, setPlatforms] = useState<Set<string>>(new Set())
  const [bannerAds, setBannerAds] = useState(false)
  const [bannerAdsAmount, setBannerAdsAmount] = useState('')
  const [freeSample, setFreeSample] = useState(true)
  const [productionFee, setProductionFee] = useState(false)
  const [productionFeeAmount, setProductionFeeAmount] = useState('')
  const [livestreams, setLivestreams] = useState(false)
  const [livestreamLink, setLivestreamLink] = useState('')
  const [shareAddress, setShareAddress] = useState(false)
  const [collabsDone, setCollabsDone] = useState('')
  const [exampleLinks, setExampleLinks] = useState<string[]>(['', '', ''])
  const [extraNotes, setExtraNotes] = useState('')

  const [generating, setGenerating] = useState(false)
  const [genError, setGenError] = useState<string | null>(null)
  const [capError, setCapError] = useState<{ message: string; info: { cap: string; currentTier?: string; upgrade?: { tier: string; label: string; limit: number | null } | null } } | null>(null)
  const [subject, setSubject] = useState('')
  const [emailBody, setEmailBody] = useState('')
  const [copied, setCopied] = useState<'subject' | 'body' | null>(null)
  const [history, setHistory] = useState<CollabRow[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [deleting, setDeleting] = useState(false)
  const [savingTrack, setSavingTrack] = useState(false)
  const [trackSaved, setTrackSaved] = useState(false)

  // Tier restructure 2026-06-04: Collabs is Creator+ minimum (Creator 5,
  // Studio 15, Pro 100 per month). Trial sees the FeatureLockedCard
  // upsell. effectiveTier() honors the admin View-as override so admins
  // can preview the gate without changing their DB tier.
  const [tier, setTier] = useState<Tier | null>(null)
  useEffect(() => {
    let cancelled = false
    let realTier: string = 'trial'
    const apply = () => { if (!cancelled) setTier(effectiveTier(realTier)) }
    ;(async () => {
      try {
        const supabase = createBrowserClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) { realTier = 'trial'; apply(); return }
        const { data } = await supabase
          .from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
        realTier = (data as { tier?: string } | null)?.tier ?? 'trial'
        apply()
      } catch {
        realTier = 'trial'
        apply()
      }
    })()
    window.addEventListener(VIEW_AS_EVENT, apply)
    return () => { cancelled = true; window.removeEventListener(VIEW_AS_EVENT, apply) }
  }, [])

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/collaborations/list')
      const d = await res.json().catch(() => ({}))
      if (Array.isArray(d.platforms)) setAllPlatforms(d.platforms)
      if (d.prefill) {
        setWebsiteUrl(p => p || d.prefill.websiteUrl || '')
        setYoutubeUrl(p => p || d.prefill.youtubeUrl || '')
        setAmazonStorefront(p => p || d.prefill.amazonStorefront || '')
        setPortfolioUrl(p => p || d.prefill.portfolioUrl || '')
        setWhatsapp(p => p || d.prefill.whatsapp || '')
        setWechat(p => p || d.prefill.wechat || '')
        setLark(p => p || d.prefill.lark || '')
        setCollabsDone(p => p || d.prefill.collabsDone || '')
        setExtraNotes(p => p || d.prefill.extraNotes || '')
        if (d.prefill.livestreams) setLivestreams(true)
        setLivestreamLink(p => p || d.prefill.livestreamLink || '')
        const savedLinks = Array.isArray(d.prefill.exampleLinks) ? d.prefill.exampleLinks : []
        if (savedLinks.length) {
          setExampleLinks(prev =>
            prev.some(Boolean) ? prev : [savedLinks[0] ?? '', savedLinks[1] ?? '', savedLinks[2] ?? ''])
        }
      }
      setHistory((d.collaborations ?? []) as CollabRow[])
    } catch { /* ignore */ }
  }, [])
  useEffect(() => { load() }, [load])

  async function saveTrackRecord() {
    setSavingTrack(true); setTrackSaved(false)
    try {
      const res = await fetch('/api/collaborations/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ collabsDone, exampleLinks, extraNotes, livestreams, livestreamLink, portfolioUrl, whatsapp, wechat, lark }),
      })
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || 'Save failed') }
      setTrackSaved(true); setTimeout(() => setTrackSaved(false), 2000)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSavingTrack(false)
    }
  }

  function toggleSel(id: string) {
    setSelected(prev => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id); else n.add(id)
      return n
    })
  }

  const allSelected = history.length > 0 && selected.size === history.length

  function toggleSelectAll() {
    setSelected(allSelected ? new Set() : new Set(history.map(h => h.id)))
  }

  async function deleteSelected() {
    if (selected.size === 0) return
    const ids = [...selected]
    const ok = await confirm({
      title: `Delete ${ids.length} pitch${ids.length === 1 ? '' : 'es'}?`,
      description: 'This can\'t be undone.',
      confirmLabel: 'Delete',
      destructive: true,
    })
    if (!ok) return
    setDeleting(true)
    try {
      const res = await fetch('/api/collaborations/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(d.error || 'Delete failed')
      setHistory(prev => prev.filter(h => !selected.has(h.id)))
      setSelected(new Set())
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Delete failed')
    } finally {
      setDeleting(false)
    }
  }

  function togglePlatform(p: string) {
    setPlatforms(prev => {
      const n = new Set(prev)
      if (n.has(p)) n.delete(p); else n.add(p)
      return n
    })
  }

  async function generate() {
    if (!brandName.trim()) { setGenError('Enter the brand name you want to pitch.'); return }
    setGenerating(true); setGenError(null); setSubject(''); setEmailBody('')
    try {
      const res = await fetch('/api/collaborations/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          brandName, productOrAsin, amazonStorefront, websiteUrl, youtubeUrl, portfolioUrl,
          platforms: [...platforms],
          bannerAds, bannerAdsAmount, freeSample, productionFee, productionFeeAmount, shareAddress,
          livestreams, livestreamLink,
          collabsDone, exampleLinks: exampleLinks.map(s => s.trim()).filter(Boolean), extraNotes,
          // Extra reach-out channels for the email's "Best ways to reach me"
          // block. Trimmed empties get filtered out in the lib + the prompt
          // skips the line entirely when the value is blank.
          whatsapp: whatsapp.trim(), wechat: wechat.trim(), lark: lark.trim(),
        }),
      })
      const d = await res.json().catch(() => ({}))
      if (d.limitReached) {
        setCapError({
          message: d.error || 'You\'ve hit your collaboration emails cap for this period.',
          info: { cap: d.cap || 'collabs', currentTier: d.currentTier, upgrade: d.upgrade },
        })
        return
      }
      if (!res.ok) throw new Error(d.error || 'Generation failed')
      setCapError(null)
      setSubject(d.subject || '')
      setEmailBody(d.body || '')
      load()
    } catch (e) {
      setGenError(e instanceof Error ? e.message : 'Generation failed')
    } finally {
      setGenerating(false)
    }
  }

  function copyText(text: string, which: 'subject' | 'body') {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(which); setTimeout(() => setCopied(null), 1500)
    }).catch(() => {})
  }

  const lbl = 'block text-[11px] font-medium text-[#6e6e73] dark:text-[#ebebf0] mb-1'

  // Trial gate — render the FeatureLockedCard BEFORE everything else so
  // trial users (or admins View-as'ing trial) don't see the form load.
  // Creator+ falls through to the regular page; tier === null is the
  // "still loading" state.
  if (tier !== null && tier === 'trial') {
    return (
      <FeatureLockedCard
        icon={<Handshake size={28} strokeWidth={1.8} />}
        feature="Brand Deals"
        description="Drop a brand name. MVP researches their products + storefront, drafts a personalized pitch email that sells your work, and pulls in your real channel stats as proof of distribution. Built on the same playbook a proven brand-outreach pro uses to land deals."
        bullets={[
          'AI researches each brand + the angle that fits your channel',
          'Pulls your cross-platform reach automatically (no manual stats lookup)',
          'Editable subject line + email body — copy and send from your own inbox',
          'Track which brands you pitched, when, and the outcome',
          'Creator: 5 pitches / month · Studio: 15 / month · Pro: 100 / month',
        ]}
        requiredTier="creator"
        currentTier={tier}
      />
    )
  }

  return (
    <>
      <PageHero
        title="Brand Deals"
        subtitle="Fill this out and we'll research the brand and write a pitch email that sells your work, ready to copy and send."
      />

      <TutorialVideo sectionKey="collaborations" />

      <div className="card p-5 mb-5 max-w-3xl">
        <p className="text-xs font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-3">1 · Your channels & the brand</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="sm:col-span-2">
            <label className={lbl}>Brand name <span className="text-[#ff3b30]">*</span></label>
            <input value={brandName} onChange={e => setBrandName(e.target.value)} placeholder="The brand you want to collaborate with" className="input-field text-sm w-full" />
          </div>
          <div className="sm:col-span-2">
            <label className={lbl}>Product name or ASIN <span className="text-[#86868b]">(the specific product you want to pitch)</span></label>
            <input value={productOrAsin} onChange={e => setProductOrAsin(e.target.value)} placeholder="e.g. Acme Cordless Drill — or B0XXXXXXXX" className="input-field text-sm w-full" />
          </div>
          <div>
            <label className={lbl}>Amazon storefront</label>
            <input value={amazonStorefront} onChange={e => setAmazonStorefront(e.target.value)} placeholder="amazon.com/shop/yourstore" className="input-field text-sm w-full" />
          </div>
          <div>
            <label className={lbl}>Website / blog</label>
            <input value={websiteUrl} onChange={e => setWebsiteUrl(e.target.value)} placeholder="yourblog.com" className="input-field text-sm w-full" />
          </div>
          <div>
            <label className={lbl}>Your YouTube channel</label>
            <input value={youtubeUrl} onChange={e => setYoutubeUrl(e.target.value)} placeholder="youtube.com/@yourchannel" className="input-field text-sm w-full" />
          </div>
          <div>
            <label className={lbl}>Portfolio / link hub <span className="text-[#86868b]">(Linktree, etc.)</span></label>
            <input value={portfolioUrl} onChange={e => setPortfolioUrl(e.target.value)} placeholder="linktr.ee/yourname" className="input-field text-sm w-full" />
          </div>
        </div>

        {/* Direct-reply channels for the email's sign-off. Brands love
            being able to ping a creator on WhatsApp / WeChat / Lark
            instead of waiting for an email reply — especially overseas
            brands, which is most of Amazon's seller pool. All optional. */}
        <p className="mt-5 mb-2 text-[11px] font-semibold uppercase tracking-wider text-[#86868b] dark:text-[#8e8e93]">Other ways brands can reach you <span className="font-normal text-[10px] normal-case tracking-normal">(optional, saved to your profile)</span></p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className={lbl}>WhatsApp</label>
            <input value={whatsapp} onChange={e => setWhatsapp(e.target.value)} placeholder="+1 555 555 5555" className="input-field text-sm w-full" />
          </div>
          <div>
            <label className={lbl}>WeChat ID</label>
            <input value={wechat} onChange={e => setWechat(e.target.value)} placeholder="your-wechat-id" className="input-field text-sm w-full" />
          </div>
          <div>
            <label className={lbl}>Lark</label>
            <input value={lark} onChange={e => setLark(e.target.value)} placeholder="email or Lark ID" className="input-field text-sm w-full" />
          </div>
        </div>
      </div>

      <div className="card p-5 mb-5 max-w-3xl">
        <p className="text-xs font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-3">2 · Your offer</p>

        <label className={lbl}>Which platforms do you want to offer for this collaboration?</label>
        {allPlatforms.length === 0 ? (
          <p className="text-[11px] text-[#86868b] dark:text-[#8e8e93] mb-4">
            No connected channels found. Connect socials in Setup and add your blog/YouTube in Brand Profile — they&apos;ll appear here.
          </p>
        ) : (
          <div className="flex flex-wrap gap-1.5 mb-4">
            {allPlatforms.map(p => {
              const on = platforms.has(p)
              return (
                <button
                  key={p}
                  type="button"
                  onClick={() => togglePlatform(p)}
                  className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold transition-all ${
                    on ? 'bg-[#7C3AED] text-white' : 'bg-white dark:bg-[#1c1c1e] border border-gray-200 dark:border-white/10 text-[#1d1d1f] dark:text-[#f5f5f7]'
                  }`}
                >
                  {on && <CheckCircle size={11} />} {p}
                </button>
              )
            })}
          </div>
        )}

        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-[#1d1d1f] dark:text-[#f5f5f7]">Sell a banner ad on your blog to this brand?</span>
            <YesNo value={bannerAds} onChange={setBannerAds} />
          </div>
          {bannerAds && (
            <div>
              <label className={lbl}>How much for the banner ad?</label>
              <input value={bannerAdsAmount} onChange={e => setBannerAdsAmount(e.target.value)} placeholder="e.g. $500 / month" className="input-field text-sm w-full sm:w-64" />
            </div>
          )}
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-[#1d1d1f] dark:text-[#f5f5f7]">Want a free sample in exchange for a review?</span>
            <YesNo value={freeSample} onChange={setFreeSample} />
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-[#1d1d1f] dark:text-[#f5f5f7]">Charging a production fee for this review?</span>
            <YesNo value={productionFee} onChange={setProductionFee} />
          </div>
          {productionFee && (
            <div>
              <label className={lbl}>How much are you charging?</label>
              <input value={productionFeeAmount} onChange={e => setProductionFeeAmount(e.target.value)} placeholder="e.g. $350 per video" className="input-field text-sm w-full sm:w-64" />
            </div>
          )}
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-[#1d1d1f] dark:text-[#f5f5f7]">Open to live streams on your channels?</span>
            <YesNo value={livestreams} onChange={setLivestreams} />
          </div>
          {livestreams && (
            <div>
              <label className={lbl}>Your best livestream link <span className="text-[#86868b]">(optional — shown as proof in the pitch)</span></label>
              <input value={livestreamLink} onChange={e => setLivestreamLink(e.target.value)} placeholder="e.g. youtube.com/live/… or twitch.tv/…" className="input-field text-sm w-full" />
            </div>
          )}
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-[#1d1d1f] dark:text-[#f5f5f7]">Share your shipping address in the email?</span>
            <YesNo value={shareAddress} onChange={setShareAddress} />
          </div>
          {shareAddress && (
            <p className="text-[11px] text-[#86868b] dark:text-[#8e8e93]">
              Pulled from the private shipping details in your Brand Profile.
            </p>
          )}
        </div>
      </div>

      <div className="card p-5 mb-5 max-w-3xl">
        <p className="text-xs font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-3">3 · Track record & extras</p>
        <div className="grid grid-cols-1 gap-3">
          <div>
            <label className={lbl}>How many collaborations have you done?</label>
            <input value={collabsDone} onChange={e => setCollabsDone(e.target.value)} placeholder="e.g. 12 brand collabs, 40+ sponsored reviews" className="input-field text-sm w-full" />
          </div>
          <div>
            <label className={lbl}>Example links of your best work <span className="text-[#86868b]">(up to 3 — most-viewed videos / highest-quality work)</span></label>
            <div className="flex flex-col gap-2">
              {[0, 1, 2].map(i => (
                <input
                  key={i}
                  value={exampleLinks[i]}
                  onChange={e => setExampleLinks(prev => { const n = [...prev]; n[i] = e.target.value; return n })}
                  placeholder={`Example link ${i + 1}`}
                  className="input-field text-sm w-full"
                />
              ))}
            </div>
          </div>
          <div>
            <label className={lbl}>Your wins &amp; anything else for the email <span className="text-[#86868b]">(optional)</span></label>
            <textarea value={extraNotes} onChange={e => setExtraNotes(e.target.value)} rows={3} placeholder="Badges & status (Amazon Platinum/A-Lister since 2022, YouTube badges), # of video reviews, whether you're open to live streams, why this brand specifically…" className="input-field text-sm w-full resize-none" />
          </div>
        </div>

        <div className="flex items-center gap-3 mt-4">
          <button
            onClick={generate}
            disabled={generating}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold text-white bg-[#7C3AED] hover:bg-[#6D28D9] disabled:opacity-60 transition-colors"
          >
            {generating
              ? <><Loader2 size={14} className="animate-spin" /> Researching + writing… (up to ~1 min)</>
              : <><Sparkles size={14} /> Generate pitch email</>}
          </button>
          <button
            onClick={saveTrackRecord}
            disabled={savingTrack}
            title="Save your track record so it's pre-filled next time"
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-white dark:bg-[#1c1c1e] border border-gray-200 dark:border-white/10 text-[#1d1d1f] dark:text-[#f5f5f7] hover:border-gray-300 disabled:opacity-60 transition-colors"
          >
            {savingTrack
              ? <><Loader2 size={14} className="animate-spin" /> Saving…</>
              : trackSaved
                ? <><CheckCircle size={14} className="text-[#34c759]" /> Saved</>
                : <><Save size={14} /> Save track record</>}
          </button>
          {genError && <span className="text-xs text-[#ff3b30] flex items-center gap-1.5"><AlertCircle size={12} /> {genError}</span>}
        </div>
        {capError && (
          <div className="mt-3">
            <CapReachedBanner
              message={capError.message}
              info={capError.info}
              onDismiss={() => setCapError(null)}
            />
          </div>
        )}
      </div>

      {(subject || emailBody) && (
        <div className="card p-5 mb-6 max-w-3xl">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[10px] font-semibold text-[#86868b] dark:text-[#8e8e93] uppercase tracking-wide">Subject</p>
            <button
              onClick={() => copyText(subject, 'subject')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-white dark:bg-[#1c1c1e] border border-gray-200 dark:border-white/10 text-[#1d1d1f] dark:text-[#f5f5f7] hover:border-gray-300 transition-colors"
            >
              {copied === 'subject' ? <><CheckCircle size={12} className="text-[#34c759]" /> Copied</> : <><Copy size={12} /> Copy subject</>}
            </button>
          </div>
          <input
            value={subject}
            onChange={e => setSubject(e.target.value)}
            className="w-full text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] border border-gray-200 dark:border-white/10 rounded-lg px-3 py-2 mb-4 focus:outline-none focus:border-[#7C3AED]/50"
          />
          <div className="flex items-center justify-between mb-2">
            <p className="text-[10px] font-semibold text-[#86868b] dark:text-[#8e8e93] uppercase tracking-wide">Body</p>
            <button
              onClick={() => copyText(emailBody, 'body')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-white dark:bg-[#1c1c1e] border border-gray-200 dark:border-white/10 text-[#1d1d1f] dark:text-[#f5f5f7] hover:border-gray-300 transition-colors"
            >
              {copied === 'body' ? <><CheckCircle size={12} className="text-[#34c759]" /> Copied</> : <><Copy size={12} /> Copy body</>}
            </button>
          </div>
          <textarea
            value={emailBody}
            onChange={e => setEmailBody(e.target.value)}
            rows={16}
            className="w-full text-sm text-[#1d1d1f] dark:text-[#f5f5f7] border border-gray-200 dark:border-white/10 rounded-lg px-3 py-2 leading-relaxed resize-y focus:outline-none focus:border-[#7C3AED]/50"
          />
          <p className="text-[11px] text-[#86868b] dark:text-[#8e8e93] mt-2">Edit anything before you send — copy the subject and body separately into your email.</p>
        </div>
      )}

      {history.length > 0 && (
        <div className="max-w-3xl">
          <div className="flex items-center justify-between gap-3 mb-2">
            <p className="text-xs font-semibold text-[#86868b] dark:text-[#8e8e93] uppercase tracking-wide">Past pitches</p>
            <div className="flex items-center gap-3">
              <button
                onClick={toggleSelectAll}
                className="text-xs font-medium text-[#7C3AED] hover:underline"
              >
                {allSelected ? 'Clear selection' : `Select all (${history.length})`}
              </button>
              {selected.size > 0 && (
                <button
                  onClick={deleteSelected}
                  disabled={deleting}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#ff3b30] hover:underline disabled:opacity-50"
                >
                  {deleting
                    ? <><Loader2 size={12} className="animate-spin" /> Deleting…</>
                    : <><Trash2 size={12} /> Delete {selected.size} selected</>}
                </button>
              )}
            </div>
          </div>
          <div className="flex flex-col gap-2">
            {history.map(h => (
              <div
                key={h.id}
                className={`card p-4 ${selected.has(h.id) ? 'ring-1 ring-[#7C3AED]' : ''}`}
              >
                <div className="flex items-center justify-between gap-3 mb-1">
                  <label className="flex items-center gap-2 min-w-0 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selected.has(h.id)}
                      onChange={() => toggleSel(h.id)}
                      className="shrink-0 accent-[#7C3AED]"
                    />
                    <span className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] truncate">{h.brand_name}</span>
                  </label>
                  <button
                    onClick={() => copyText(h.generated_email, 'body')}
                    className="inline-flex items-center gap-1 text-xs font-medium text-[#7C3AED] hover:underline shrink-0"
                  >
                    <Copy size={11} /> Copy
                  </button>
                </div>
                <p className="text-[11px] text-[#86868b] dark:text-[#8e8e93] pl-6">
                  {h.platforms?.length ? h.platforms.join(' · ') + '  ·  ' : ''}
                  {new Date(h.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
      <ConfirmHost />
    </>
  )
}

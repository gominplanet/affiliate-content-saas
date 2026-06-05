'use client'

/**
 * Newsletter dashboard — Milestone 1.
 *
 * Renders:
 *   * Header strip with subscriber counts (active / pending / unsubscribed)
 *     and the tier cap, so the creator always sees room remaining.
 *   * Enable toggle + sender display-name + (US) mailing address fields,
 *     all auto-saving on blur (no Save button to forget). Mailing address is
 *     CAN-SPAM required for any commercial email — we warn but don't block.
 *   * "Embed on your blog" code block — the [mvp-newsletter] shortcode the
 *     creator pastes into any WordPress page/post. Pre-filled with their
 *     user_id so they don't have to think.
 *   * Subscribers list with import CSV + export CSV + per-row delete (GDPR).
 *
 * Milestone 2 will add a "Sender domain" card (Resend domain verify + DKIM
 * record display) above the embed snippet. Milestone 3 will add a
 * "Compose newsletter" CTA + recent-broadcasts table.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import PageHero from '@/components/layout/PageHero'
import FeatureLockedCard from '@/components/ui/FeatureLockedCard'
import { LegacyCapsNotice } from '@/components/newsletter/LegacyCapsNotice'
import { useConfirm } from '@/components/ui/useConfirm'
import { createBrowserClient } from '@/lib/supabase/client'
import { type Tier } from '@/lib/tier'
import { effectiveTier, VIEW_AS_EVENT } from '@/lib/view-as'
import {
  Loader2, Mail, CheckCircle, AlertCircle, Upload, Download,
  Copy, Trash2, RefreshCw, ShieldCheck, Globe, Send, ExternalLink, Info,
} from 'lucide-react'

interface DkimRecord {
  record: string
  type: string
  name: string
  value: string
  priority?: number
  ttl?: string
  status?: string
}
type HomepagePlacement = 'before_pick' | 'after_pick' | 'after_ads' | 'footer'
type SidebarPlacement = 'top' | 'bottom'

interface Settings {
  user_id: string
  sender_domain: string | null
  sender_local_part: string | null
  sender_name: string | null
  domain_status: string | null
  domain_checked_at?: string | null
  dkim_records?: DkimRecord[] | null
  enabled: boolean
  mailing_address: string | null
  resend_domain_id?: string | null
  // CTA copy overrides — null when the creator hasn't customised, in
  // which case the dashboard preview shows the same fallback the WP
  // theme would render.
  cta_title?: string | null
  cta_subtitle?: string | null
  cta_button?: string | null
  cta_bullet_1?: string | null
  cta_bullet_2?: string | null
  cta_bullet_3?: string | null
  // Where to render the form on each surface. null = theme default
  // ('after_ads' / 'bottom').
  homepage_placement?: HomepagePlacement | null
  sidebar_placement?: SidebarPlacement | null
}

const HOMEPAGE_PLACEMENT_LABELS: Record<HomepagePlacement, { label: string; hint: string }> = {
  before_pick: { label: 'Before Pick of the Day', hint: 'First thing under the hero — highest visibility, competes with the editor’s pick' },
  after_pick:  { label: 'After Pick of the Day',  hint: 'Between the pick and the 3-up ad strip' },
  after_ads:   { label: 'After the 3 ad spots',   hint: 'Default — prime above-the-fold real estate without crowding the pick' },
  footer:      { label: 'In the footer',          hint: 'Last thing on the page — lowest visibility, but doesn’t compete with content' },
}
const SIDEBAR_PLACEMENT_LABELS: Record<SidebarPlacement, { label: string; hint: string }> = {
  top:    { label: 'Top of the sidebar',     hint: 'First sidebar element on every blog post' },
  bottom: { label: 'After other sidebar ads', hint: 'Default — last sidebar element so readers see it after the post' },
}
interface SubscriberRow {
  id: string
  email: string
  status: string
  source: string | null
  source_url: string | null
  confirmed_at: string | null
  unsubscribed_at: string | null
  created_at: string
}
interface Counts { active: number; pending: number; unsubscribed: number }

export default function NewsletterPage() {
  const { confirm, ConfirmHost } = useConfirm()
  const [loading, setLoading] = useState(true)
  const [savingField, setSavingField] = useState<string | null>(null)
  const [settings, setSettings] = useState<Settings | null>(null)
  const [subs, setSubs] = useState<SubscriberRow[]>([])
  const [counts, setCounts] = useState<Counts>({ active: 0, pending: 0, unsubscribed: 0 })

  // Tier restructure 2026-06-04: Newsletter is Creator+ minimum. Trial sees
  // the FeatureLockedCard upsell instead of the dashboard. effectiveTier()
  // honors the admin View-as override so admins can preview the gated UX.
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
  const [importing, setImporting] = useState(false)
  const [importMsg, setImportMsg] = useState<{ ok: boolean; text: string } | null>(null)
  // Paste-list importer state — opens a modal so creators can paste a
  // Mailchimp / Substack / ConvertKit export (or just a list of emails)
  // straight from clipboard without saving a CSV file first.
  const [pasteOpen, setPasteOpen] = useState(false)
  const [pasteText, setPasteText] = useState('')
  // Live CTA editor state — separate from settings so the preview can
  // re-render on every keystroke. NOT auto-saved on blur (creators
  // explicitly asked for a Save button so they can confirm the wording
  // before it ships to the live blog). The Save button below the card
  // fires a single PUT with all three fields, then setSettings flips the
  // dirty flag back off.
  const [ctaTitle, setCtaTitle] = useState('')
  const [ctaSubtitle, setCtaSubtitle] = useState('')
  const [ctaButton, setCtaButton] = useState('')
  const [ctaBullet1, setCtaBullet1] = useState('')
  const [ctaBullet2, setCtaBullet2] = useState('')
  const [ctaBullet3, setCtaBullet3] = useState('')
  const [ctaSaved, setCtaSaved] = useState(false) // brief "Saved ✓" flash
  useEffect(() => {
    setCtaTitle(settings?.cta_title || '')
    setCtaSubtitle(settings?.cta_subtitle || '')
    setCtaButton(settings?.cta_button || '')
    setCtaBullet1(settings?.cta_bullet_1 || '')
    setCtaBullet2(settings?.cta_bullet_2 || '')
    setCtaBullet3(settings?.cta_bullet_3 || '')
  }, [settings?.cta_title, settings?.cta_subtitle, settings?.cta_button, settings?.cta_bullet_1, settings?.cta_bullet_2, settings?.cta_bullet_3])
  // Dirty = any field differs from the server snapshot. Enables the Save
  // button + suppresses the navigation-was-pointless case.
  const ctaDirty = (
    ctaTitle !== (settings?.cta_title || '')
    || ctaSubtitle !== (settings?.cta_subtitle || '')
    || ctaButton !== (settings?.cta_button || '')
    || ctaBullet1 !== (settings?.cta_bullet_1 || '')
    || ctaBullet2 !== (settings?.cta_bullet_2 || '')
    || ctaBullet3 !== (settings?.cta_bullet_3 || '')
  )
  async function saveCta() {
    if (!ctaDirty) return
    await saveSetting({
      cta_title: ctaTitle,
      cta_subtitle: ctaSubtitle,
      cta_button: ctaButton,
      cta_bullet_1: ctaBullet1,
      cta_bullet_2: ctaBullet2,
      cta_bullet_3: ctaBullet3,
    } as Partial<Settings>, 'cta')
    setCtaSaved(true)
    setTimeout(() => setCtaSaved(false), 2000)
  }
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Recent broadcasts table (Milestone 3) — the creator's last 30 sends.
  const [broadcasts, setBroadcasts] = useState<Array<{
    id: string; subject: string; status: string;
    recipients_total: number; recipients_delivered: number; recipients_bounced: number;
    sent_at: string | null; created_at: string; error_message: string | null;
  }>>([])
  // Sender-domain card state (Milestone 2)
  const [domainInput, setDomainInput] = useState('')
  const [domainBusy, setDomainBusy] = useState<'add' | 'verify' | 'remove' | 'dns-check' | null>(null)
  // DNS diagnostic state — populated when user clicks "Run DNS check".
  // Server-side endpoint resolves each Resend record against public DNS
  // and reports match/wrong/not_found per row. Cleared on every fresh
  // run so stale results never confuse the user.
  interface DnsCheckResult {
    type: string
    hostname: string
    expectedValue: string
    foundValues: string[]
    result: 'match' | 'partial' | 'wrong' | 'not_found' | 'error'
    hint?: string
  }
  const [dnsCheck, setDnsCheck] = useState<{ results: DnsCheckResult[]; allMatch: boolean } | null>(null)
  const [domainMsg, setDomainMsg] = useState<{ ok: boolean; text: string } | null>(null)
  // Per-record copy feedback — keyed by `${type}:${name}` so each "Copy"
  // button can flash its own "Copied!" independently.
  const [copiedRecord, setCopiedRecord] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [sRes, lRes, bRes] = await Promise.all([
        fetch('/api/newsletter/settings'),
        fetch('/api/newsletter/subscribers'),
        fetch('/api/newsletter/broadcasts'),
      ])
      const sData = await sRes.json()
      const lData = await lRes.json()
      const bData = await bRes.json().catch(() => ({}))
      if (!sRes.ok) throw new Error(sData.error || 'Failed to load settings')
      if (!lRes.ok) throw new Error(lData.error || 'Failed to load subscribers')
      setSettings(sData.settings)
      setSubs(lData.subscribers || [])
      setCounts(lData.counts || { active: 0, pending: 0, unsubscribed: 0 })
      if (bRes.ok) setBroadcasts(bData.broadcasts || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  // ── Auto re-check sender domain on mount when status is 'pending' ──────
  // Common case: user added DNS records hours/days ago, Resend has actually
  // verified them, but our DB cache is stale because the user never
  // clicked Verify after Resend caught up. Page-load auto-poll catches
  // this without burning Resend API calls on every visit (one shot per
  // page mount, gated on actually-pending state). Test emails arriving
  // is NOT a signal the domain is verified — those fall back to the
  // shared MVP sender (lib/newsletter.ts deriveFromAddress) — so users
  // can sit on pending status for days while still receiving mail.
  const autoVerifiedRef = useRef(false)
  useEffect(() => {
    if (autoVerifiedRef.current) return
    if (!settings?.sender_domain) return
    if (settings.domain_status !== 'pending') return
    if (domainBusy) return
    autoVerifiedRef.current = true
    void verifyDomain()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings?.sender_domain, settings?.domain_status])

  async function saveSetting(patch: Partial<Settings>, fieldLabel: string) {
    if (!settings) return
    setSavingField(fieldLabel)
    try {
      const r = await fetch('/api/newsletter/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'Save failed')
      setSettings(d.settings)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSavingField(null)
    }
  }

  // ── Sender-domain handlers (Milestone 2) ────────────────────────────────
  async function addDomain() {
    const raw = domainInput.trim().toLowerCase()
    if (!raw) { setDomainMsg({ ok: false, text: 'Enter a domain first.' }); return }
    setDomainBusy('add')
    setDomainMsg(null)
    try {
      const r = await fetch('/api/newsletter/domain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subdomain: raw }),
      })
      const d = await r.json()
      if (!r.ok) {
        setDomainMsg({ ok: false, text: d.error || 'Failed to register domain.' })
      } else {
        setSettings(d.settings)
        setDomainInput('')
        setDomainMsg({ ok: true, text: 'Domain added. Now paste the DNS records below into your DNS host, then click Verify.' })
      }
    } catch (e) {
      setDomainMsg({ ok: false, text: e instanceof Error ? e.message : 'Failed to register domain.' })
    } finally {
      setDomainBusy(null)
    }
  }

  async function verifyDomain() {
    setDomainBusy('verify')
    setDomainMsg(null)
    try {
      const r = await fetch('/api/newsletter/domain', { method: 'GET' })
      const d = await r.json()
      if (!r.ok) {
        setDomainMsg({ ok: false, text: d.error || 'Verification failed.' })
      } else {
        setSettings(d.settings)
        const s = d.settings?.domain_status
        if (s === 'verified') setDomainMsg({ ok: true, text: 'Verified! Your newsletter will now send from your own domain.' })
        else if (s === 'failed') setDomainMsg({ ok: false, text: "Records didn't match. Double-check the DNS values below and give it a few more minutes — DNS can take up to an hour to propagate." })
        else setDomainMsg({ ok: true, text: 'Still pending — DNS propagation usually finishes within an hour. Try again shortly.' })
      }
    } catch (e) {
      setDomainMsg({ ok: false, text: e instanceof Error ? e.message : 'Verification failed.' })
    } finally {
      setDomainBusy(null)
    }
  }

  // Run server-side DNS lookups against each record Resend expects and
  // display per-row match / not-found / wrong status. Helps users pinpoint
  // which specific record needs fixing instead of staring at a blanket
  // "Pending" badge. See /api/newsletter/domain/dns-check.
  async function runDnsCheck() {
    setDomainBusy('dns-check')
    setDnsCheck(null)
    setDomainMsg(null)
    try {
      const r = await fetch('/api/newsletter/domain/dns-check')
      const d = await r.json()
      if (!r.ok) {
        setDomainMsg({ ok: false, text: d.error || 'DNS check failed.' })
        return
      }
      setDnsCheck({ results: d.results, allMatch: d.summary?.allMatch ?? false })
    } catch (e) {
      setDomainMsg({ ok: false, text: e instanceof Error ? e.message : 'DNS check failed.' })
    } finally {
      setDomainBusy(null)
    }
  }

  async function removeDomain() {
    if (!(await confirm({
      title: 'Remove the sender domain?',
      description: 'You\'ll need to add and verify a domain again before you can send newsletters from your own address.',
      confirmLabel: 'Remove domain',
      destructive: true,
    }))) return
    setDomainBusy('remove')
    setDomainMsg(null)
    try {
      const r = await fetch('/api/newsletter/domain', { method: 'DELETE' })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) {
        setDomainMsg({ ok: false, text: d.error || 'Removal failed.' })
      } else {
        await load()
        setDomainMsg({ ok: true, text: 'Domain removed.' })
      }
    } catch (e) {
      setDomainMsg({ ok: false, text: e instanceof Error ? e.message : 'Removal failed.' })
    } finally {
      setDomainBusy(null)
    }
  }

  function copyRecord(key: string, value: string) {
    navigator.clipboard.writeText(value).then(() => {
      setCopiedRecord(key)
      setTimeout(() => setCopiedRecord(null), 1800)
    }).catch(() => { /* ignore */ })
  }

  /** Build a BIND zone-file snippet for the current DKIM records and
   *  download it. Cloudflare, AWS Route 53, Google Cloud DNS, and a
   *  number of others accept this format under "Import DNS records",
   *  making domain setup a one-click affair on those panels.
   *
   *  Hostinger doesn't support BIND import in the standard UI (yet),
   *  but the file still serves as a clean, no-line-wrapping reference
   *  the user can paste from — much easier than reading a ~200-char
   *  DKIM value out of a copy button. */
  function downloadZoneFile() {
    if (!settings?.sender_domain || !Array.isArray(settings.dkim_records) || settings.dkim_records.length === 0) return
    // The sender domain is e.g. "mail.gominreviews.com" — derive the
    // root zone the user actually edits in their DNS host (the last 2
    // labels). Hostinger zone files are scoped to the root domain, so
    // record names need to be relative to it (e.g. "send.mail" rather
    // than "send.mail.gominreviews.com.").
    const parts = settings.sender_domain.split('.')
    const root = parts.length >= 2 ? parts.slice(-2).join('.') : settings.sender_domain
    const stamp = new Date().toISOString().slice(0, 10)
    const header = [
      `;; MVP Affiliate — newsletter sender records`,
      `;; Sender domain: ${settings.sender_domain}`,
      `;; Generated: ${stamp}`,
      `;; Import into your DNS host's "Import zone file" feature, or use as a copy-paste reference.`,
      ``,
      `$ORIGIN ${root}.`,
      `$TTL 3600`,
      ``,
    ].join('\n')
    // Build one line per record. BIND requires:
    //   <relative-name>  IN  <type>  <value>
    // For long TXT values (DKIM), wrap in quotes — BIND tolerates a
    // single un-split quoted string up to 4 KB; the user's DNS host
    // will fragment it on its side if needed. For MX we prepend the
    // priority before the target host (and append the trailing dot to
    // make it absolute, otherwise BIND treats it as relative to $ORIGIN
    // and re-appends the root, breaking the record).
    const lines = settings.dkim_records.map((r) => {
      // Convert "send.mail" within zone root "gominreviews.com" → "send.mail"
      // (already relative). Convert "send.mail.gominreviews.com" → "send.mail".
      let name = r.name.trim()
      if (name.endsWith('.' + root)) name = name.slice(0, -(root.length + 1))
      if (name === root) name = '@'
      const type = r.type.trim().toUpperCase()
      if (type === 'MX') {
        const target = r.value.endsWith('.') ? r.value : r.value + '.'
        return `${name}\tIN\tMX\t${r.priority ?? 10} ${target}`
      }
      // TXT — quote the value, escape any embedded double-quote.
      const txt = `"${r.value.replace(/"/g, '\\"')}"`
      return `${name}\tIN\t${type}\t${txt}`
    })
    const body = header + lines.join('\n') + '\n'

    // Trigger the download via a transient anchor element. Filename
    // includes the root domain so users with multiple sites can tell
    // their downloads apart.
    const blob = new Blob([body], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${root}-newsletter-dns.txt`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  async function deleteSubscriber(id: string) {
    if (!(await confirm({
      title: 'Permanently delete this subscriber?',
      description: 'They\'ll lose any subscription state. Use the unsubscribe link in the email if you want them in the "unsubscribed" bucket instead.',
      confirmLabel: 'Delete subscriber',
      destructive: true,
    }))) return
    const r = await fetch(`/api/newsletter/subscribers?id=${id}`, { method: 'DELETE' })
    if (!r.ok) {
      const d = await r.json().catch(() => ({}))
      setError(d.error || 'Delete failed')
      return
    }
    setSubs(prev => prev.filter(s => s.id !== id))
  }

  // Single import handler — accepts either a File (from the CSV uploader)
  // or a raw string (from the paste-list modal). The /import API already
  // parses both shapes the same way (first column of every line + plain
  // newline-separated emails), so the only difference is where the body
  // comes from.
  async function handleImport(source: File | string) {
    setImporting(true)
    setImportMsg(null)
    try {
      const csv = typeof source === 'string' ? source : await source.text()
      const r = await fetch('/api/newsletter/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csv }),
      })
      const d = await r.json()
      if (!r.ok) {
        setImportMsg({ ok: false, text: d.error || 'Import failed' })
      } else {
        const parts: string[] = []
        parts.push(`Imported ${d.imported}`)
        if (d.skipped) parts.push(`${d.skipped} already on your list`)
        if (d.overCap) parts.push(`${d.overCap} skipped (tier cap)`)
        if (d.malformed) parts.push(`${d.malformed} malformed`)
        setImportMsg({ ok: true, text: parts.join(' · ') })
        void load()
      }
    } catch (err) {
      setImportMsg({ ok: false, text: err instanceof Error ? err.message : 'Import failed' })
    } finally {
      setImporting(false)
    }
  }

  async function handlePasteImport() {
    const text = pasteText.trim()
    if (!text) { setImportMsg({ ok: false, text: 'Paste some emails first.' }); return }
    setPasteOpen(false)
    setPasteText('')
    await handleImport(text)
  }

  function copyShortcode() {
    if (!settings) return
    const code = `[mvp-newsletter user="${settings.user_id}"]`
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }).catch(() => { /* ignore */ })
  }

  // Tier gate — Trial users see the upsell card BEFORE the loading
  // spinner so they don't briefly see "Loading…" and then a lock card.
  // Creator+ passes through to the normal dashboard.
  if (tier !== null && tier === 'trial') {
    return (
      <FeatureLockedCard
        icon={<Mail size={28} strokeWidth={1.8} />}
        feature="Newsletter"
        description="Capture email subscribers from your blog and send curated issues that link back to your reviews. Every send drives traffic to your highest-EPC posts, and your list compounds over time."
        bullets={[
          'Embed a sign-up form on your WordPress blog (one shortcode)',
          'Compose issues with a live preview + auto-pulled review picks',
          'CAN-SPAM compliant (mailing address footer + 1-click unsubscribe)',
          'Sender domain verify + DKIM for inbox-first deliverability',
          'Creator: 500 subs, 1 send/mo (taster)',
          'Studio: 5,000 subs, weekly sends + scheduling',
          'Pro: 10,000 subs, twice-weekly + A/B subject lines + segmented sends',
        ]}
        requiredTier="creator"
        currentTier={tier}
      />
    )
  }

  if (loading) {
    return (
      <>
        <PageHero title="Newsletter" subtitle="Capture emails on your blog and send curated issues to your list." />
        <div className="flex items-center gap-2 text-sm text-[#6e6e73] dark:text-[#ebebf0]">
          <Loader2 size={14} className="animate-spin" /> Loading…
        </div>
      </>
    )
  }

  return (
    <>
      <PageHero
        title="Newsletter"
        subtitle="Capture emails on your blog, then send curated issues that link back to your reviews."
      />

      {/* Grandfather banner — only visible to Creator users on the
          pre-2026-06-04 caps. Self-hides for everyone else. */}
      <LegacyCapsNotice />

      {error && (
        <div className="mb-4 card p-3 border-[#ff3b30]/20 bg-[#ff3b30]/5">
          <p className="text-xs text-[#ff3b30] flex items-center gap-1.5"><AlertCircle size={12} /> {error}</p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        {/* Subscriber counts + Compose CTA */}
        <div className="card p-5 lg:col-span-2">
          <div className="flex items-start justify-between gap-3 mb-3 flex-wrap">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-[#7C3AED]/10 flex items-center justify-center">
                <Mail size={16} className="text-[#7C3AED]" />
              </div>
              <div>
                <p className="text-xs text-[#86868b] dark:text-[#8e8e93] uppercase tracking-wide">Your audience</p>
                <p className="text-2xl font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">{counts.active.toLocaleString()} subscribers</p>
              </div>
            </div>
            <Link
              href="/newsletter/compose"
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold text-white bg-[#7C3AED] hover:bg-[#6D28D9]"
              title="Compose and send the next issue"
            >
              <Send size={13} /> Compose
            </Link>
          </div>
          <div className="flex gap-6 text-xs">
            <span className="text-[#34c759]">✓ {counts.active} active</span>
            <span className="text-[#ff9500]">⌛ {counts.pending} pending confirm</span>
            <span className="text-[#86868b] dark:text-[#8e8e93]">⊘ {counts.unsubscribed} unsubscribed</span>
          </div>
        </div>

        {/* Status — single clickable indicator, traffic-light style.
            Red by default (the creator hasn't opted in to running a
            newsletter yet); green once they flip it on. Whole card is
            the click target so it's hard to miss. */}
        <button
          type="button"
          onClick={() => saveSetting({ enabled: !settings?.enabled }, 'enabled')}
          disabled={savingField === 'enabled'}
          className="card p-5 text-left w-full transition-colors hover:border-gray-300 dark:hover:border-white/20 disabled:opacity-60 disabled:cursor-wait"
          aria-pressed={!!settings?.enabled}
          title={settings?.enabled ? 'Click to turn the newsletter off' : 'Click to turn the newsletter on'}
        >
          <p className="text-xs text-[#86868b] dark:text-[#8e8e93] uppercase tracking-wide mb-3">Newsletter status</p>
          <div className="flex items-center gap-3">
            <span
              className={`inline-block w-3.5 h-3.5 rounded-full flex-shrink-0 ${
                settings?.enabled
                  ? 'bg-[#34c759] shadow-[0_0_10px_rgba(52,199,89,0.55)]'
                  : 'bg-[#ff3b30] shadow-[0_0_10px_rgba(255,59,48,0.45)]'
              }`}
              aria-hidden
            />
            <span className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">
              {settings?.enabled ? 'Newsletter is a GO' : "I'm not running a newsletter right now"}
            </span>
            {savingField === 'enabled' && <Loader2 size={12} className="animate-spin text-[#86868b] ml-auto" />}
          </div>
          <p className="text-[11px] text-[#86868b] dark:text-[#8e8e93] mt-2 leading-relaxed">
            {settings?.enabled
              ? 'Signup form shows on your homepage + every blog post sidebar. Click to turn off.'
              : 'Signup form is hidden everywhere on your blog. Click to start collecting subscribers.'}
          </p>
        </button>
      </div>

      {/* Brand display name + mailing address */}
      <div className="card p-5 mb-6">
        <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-3">Brand &amp; compliance</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-[#3a3a3c] dark:text-[#d2d2d7] mb-1">Sender display name</label>
            <input
              type="text"
              defaultValue={settings?.sender_name || ''}
              onBlur={(e) => saveSetting({ sender_name: e.target.value }, 'sender_name')}
              maxLength={120}
              placeholder="e.g. Gomin Reviews"
              className="w-full text-sm px-3 py-2 rounded-md border border-gray-200 dark:border-white/10 bg-white dark:bg-[#2c2c2e] text-[#1d1d1f] dark:text-[#f5f5f7]"
            />
            <p className="text-[11px] text-[#86868b] dark:text-[#8e8e93] mt-1">Shows on the From line — e.g. &quot;Gomin Reviews &lt;newsletter@…&gt;&quot;.</p>
          </div>
          <div>
            <label className="block text-xs font-medium text-[#3a3a3c] dark:text-[#d2d2d7] mb-1">Mailing address <span className="text-[#ff9500]">(US CAN-SPAM)</span></label>
            <input
              type="text"
              defaultValue={settings?.mailing_address || ''}
              onBlur={(e) => saveSetting({ mailing_address: e.target.value }, 'mailing_address')}
              maxLength={400}
              placeholder="e.g. 123 Main St, Austin TX 78701"
              className="w-full text-sm px-3 py-2 rounded-md border border-gray-200 dark:border-white/10 bg-white dark:bg-[#2c2c2e] text-[#1d1d1f] dark:text-[#f5f5f7]"
            />
            <p className="text-[11px] text-[#86868b] dark:text-[#8e8e93] mt-1">Required by US law in every commercial email. A PO box works.</p>
          </div>
        </div>
      </div>

      {/* Signup form copy — what subscribers actually see on the
          homepage + every blog-post sidebar. All three fields are
          optional (empty → theme default). The right column is a
          1:1 live preview of how the form will render once saved. */}
      <div className="card p-5 mb-6">
        <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">Signup form copy</p>
        <p className="text-xs text-[#86868b] dark:text-[#8e8e93] mb-4 leading-relaxed">
          What subscribers see on your homepage (under the ad strip) and in the sidebar of every blog post.
          Leave any field blank to use the default copy.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div className="flex flex-col gap-3">
            <div>
              <label className="block text-xs font-medium text-[#3a3a3c] dark:text-[#d2d2d7] mb-1">Title</label>
              <input
                type="text"
                value={ctaTitle}
                onChange={(e) => setCtaTitle(e.target.value)}
                maxLength={140}
                placeholder={settings?.sender_name ? `Get the next ${settings.sender_name} review in your inbox` : 'Get the next review in your inbox'}
                className="w-full text-sm px-3 py-2 rounded-md border border-gray-200 dark:border-white/10 bg-white dark:bg-[#2c2c2e] text-[#1d1d1f] dark:text-[#f5f5f7]"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#3a3a3c] dark:text-[#d2d2d7] mb-1">Subtitle</label>
              <textarea
                value={ctaSubtitle}
                onChange={(e) => setCtaSubtitle(e.target.value)}
                maxLength={320}
                rows={3}
                placeholder="No spam. One short email when there’s a new post worth your time or when there are things you might have missed online."
                className="w-full text-sm px-3 py-2 rounded-md border border-gray-200 dark:border-white/10 bg-white dark:bg-[#2c2c2e] text-[#1d1d1f] dark:text-[#f5f5f7]"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#3a3a3c] dark:text-[#d2d2d7] mb-1">Button label</label>
              <input
                type="text"
                value={ctaButton}
                onChange={(e) => setCtaButton(e.target.value)}
                maxLength={40}
                placeholder="Subscribe"
                className="w-full text-sm px-3 py-2 rounded-md border border-gray-200 dark:border-white/10 bg-white dark:bg-[#2c2c2e] text-[#1d1d1f] dark:text-[#f5f5f7]"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#3a3a3c] dark:text-[#d2d2d7] mb-1">Benefit bullets <span className="text-[#86868b] font-normal">(3 lines under the title in the homepage hero)</span></label>
              <input
                type="text"
                value={ctaBullet1}
                onChange={(e) => setCtaBullet1(e.target.value)}
                maxLength={140}
                placeholder="One short email per week — never spam"
                className="w-full text-sm px-3 py-2 rounded-md border border-gray-200 dark:border-white/10 bg-white dark:bg-[#2c2c2e] text-[#1d1d1f] dark:text-[#f5f5f7] mb-2"
              />
              <input
                type="text"
                value={ctaBullet2}
                onChange={(e) => setCtaBullet2(e.target.value)}
                maxLength={140}
                placeholder="Skips the stuff that isn’t worth your time"
                className="w-full text-sm px-3 py-2 rounded-md border border-gray-200 dark:border-white/10 bg-white dark:bg-[#2c2c2e] text-[#1d1d1f] dark:text-[#f5f5f7] mb-2"
              />
              <input
                type="text"
                value={ctaBullet3}
                onChange={(e) => setCtaBullet3(e.target.value)}
                maxLength={140}
                placeholder="Unsubscribe with one click, any time"
                className="w-full text-sm px-3 py-2 rounded-md border border-gray-200 dark:border-white/10 bg-white dark:bg-[#2c2c2e] text-[#1d1d1f] dark:text-[#f5f5f7]"
              />
              <p className="text-[11px] text-[#86868b] dark:text-[#8e8e93] mt-1">Each bullet ≤ 140 chars. Leave a row blank to drop it. All blank = theme defaults.</p>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={() => void saveCta()}
                disabled={!ctaDirty || savingField === 'cta'}
                className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
                  ctaDirty
                    ? 'bg-[#7C3AED] text-white hover:bg-[#6D28D9]'
                    : 'bg-gray-100 dark:bg-white/5 text-[#86868b] cursor-default'
                } disabled:opacity-60`}
              >
                {savingField === 'cta'
                  ? <><Loader2 size={12} className="inline animate-spin mr-1" /> Saving…</>
                  : ctaSaved
                    ? <><CheckCircle size={12} className="inline mr-1" /> Saved</>
                    : ctaDirty ? 'Save changes' : 'No changes to save'}
              </button>
              <p className="text-[11px] text-[#86868b] dark:text-[#8e8e93]">
                The form on your blog updates within a few seconds of saving.
              </p>
            </div>
          </div>

          {/* Live preview — 1:1 with what the WP theme renders. Same inline
              CSS, same widths, same colours. If anything ever drifts here
              vs the production form, this is the place to keep in sync. */}
          <div>
            <p className="text-[10px] uppercase tracking-wide text-[#86868b] dark:text-[#8e8e93] mb-2">Preview</p>
            <NewsletterFormPreview
              senderName={settings?.sender_name || ''}
              title={ctaTitle}
              subtitle={ctaSubtitle}
              button={ctaButton}
              bullets={[ctaBullet1, ctaBullet2, ctaBullet3]}
            />
          </div>
        </div>
      </div>

      {/* Where on the blog the form renders. Two surfaces, each with its
          own radio group. Default ('after_ads' / 'bottom') matches the
          theme's hard-coded placement before this card existed. */}
      <div className="card p-5 mb-6">
        <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">Where the form shows up</p>
        <p className="text-xs text-[#86868b] dark:text-[#8e8e93] mb-4 leading-relaxed">
          Pick where the signup form sits on your homepage and in your blog-post sidebar. Saves and syncs to your blog as soon as you click.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {/* Homepage */}
          <div>
            <p className="text-xs font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-2">Homepage</p>
            <div className="flex flex-col gap-1.5">
              {(Object.keys(HOMEPAGE_PLACEMENT_LABELS) as HomepagePlacement[]).map((slot) => {
                const meta = HOMEPAGE_PLACEMENT_LABELS[slot]
                const current = (settings?.homepage_placement || 'after_ads') as HomepagePlacement
                const selected = current === slot
                return (
                  <label key={slot} className={`flex items-start gap-2 p-2 rounded-md border cursor-pointer transition-colors ${selected ? 'border-[#7C3AED] bg-[#7C3AED]/5' : 'border-gray-200 dark:border-white/10 hover:border-[#7C3AED]/40'}`}>
                    <input
                      type="radio"
                      name="homepage_placement"
                      value={slot}
                      checked={selected}
                      onChange={() => saveSetting({ homepage_placement: slot } as Partial<Settings>, 'homepage_placement')}
                      disabled={savingField === 'homepage_placement'}
                      className="accent-[#7C3AED] mt-0.5 flex-shrink-0"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-[#1d1d1f] dark:text-[#f5f5f7]">{meta.label}</p>
                      <p className="text-[10px] text-[#86868b] dark:text-[#8e8e93] leading-snug">{meta.hint}</p>
                    </div>
                  </label>
                )
              })}
            </div>
          </div>

          {/* Sidebar */}
          <div>
            <p className="text-xs font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-2">Blog-post sidebar</p>
            <div className="flex flex-col gap-1.5">
              {(Object.keys(SIDEBAR_PLACEMENT_LABELS) as SidebarPlacement[]).map((slot) => {
                const meta = SIDEBAR_PLACEMENT_LABELS[slot]
                const current = (settings?.sidebar_placement || 'bottom') as SidebarPlacement
                const selected = current === slot
                return (
                  <label key={slot} className={`flex items-start gap-2 p-2 rounded-md border cursor-pointer transition-colors ${selected ? 'border-[#7C3AED] bg-[#7C3AED]/5' : 'border-gray-200 dark:border-white/10 hover:border-[#7C3AED]/40'}`}>
                    <input
                      type="radio"
                      name="sidebar_placement"
                      value={slot}
                      checked={selected}
                      onChange={() => saveSetting({ sidebar_placement: slot } as Partial<Settings>, 'sidebar_placement')}
                      disabled={savingField === 'sidebar_placement'}
                      className="accent-[#7C3AED] mt-0.5 flex-shrink-0"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-[#1d1d1f] dark:text-[#f5f5f7]">{meta.label}</p>
                      <p className="text-[10px] text-[#86868b] dark:text-[#8e8e93] leading-snug">{meta.hint}</p>
                    </div>
                  </label>
                )
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Sender domain — Milestone 2.
          Three visual states:
          (a) No domain set → empty input + "Add" button + explainer
          (b) Domain set, status pending/failed → show the DNS records to
              paste, a "Verify" button, a status badge, and the remove option
          (c) Verified → green badge + the from-address + remove option */}
      <div className="card p-5 mb-6">
        <div className="flex items-center gap-2 mb-1">
          <Globe size={14} className="text-[#7C3AED]" />
          <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Sender domain</p>
          {settings?.sender_domain && settings.domain_status === 'verified' && (
            <span className="ml-auto inline-flex items-center gap-1 text-[11px] font-semibold px-1.5 py-0.5 rounded-md bg-[#34c759]/10 text-[#34c759]">
              <ShieldCheck size={11} /> Verified
            </span>
          )}
          {settings?.sender_domain && settings.domain_status === 'pending' && (
            <span className="ml-auto inline-flex items-center gap-1 text-[11px] font-semibold px-1.5 py-0.5 rounded-md bg-[#ff9500]/10 text-[#ff9500]">
              Pending
            </span>
          )}
          {settings?.sender_domain && settings.domain_status === 'failed' && (
            <span className="ml-auto inline-flex items-center gap-1 text-[11px] font-semibold px-1.5 py-0.5 rounded-md bg-[#ff3b30]/10 text-[#ff3b30]">
              <AlertCircle size={11} /> Records not found
            </span>
          )}
        </div>
        <p className="text-xs text-[#86868b] dark:text-[#8e8e93] mb-3 leading-relaxed">
          Send newsletters from your own domain (e.g. <code className="font-mono text-[11px]">newsletter@mail.yourdomain.com</code>) so subscribers recognise the sender and inboxes trust the email. Until verified, MVP sends from a shared address.
        </p>

        {/* "Why is this still pending if emails work?" — common confusion
            in support pings. Subscribe/test emails arrive even while the
            user's sender domain is pending because deriveFromAddress()
            falls back to the shared MVP sender. Verified status only
            unlocks the FROM address showing the user's domain — it has
            no bearing on whether mail is being delivered at all. */}
        {settings?.sender_domain && settings.domain_status === 'pending' && (
          <div className="rounded-md border border-[#ff9500]/30 bg-[#ff9500]/[0.06] px-3 py-2 mb-3 flex items-start gap-2 text-[11px] leading-relaxed text-[#1d1d1f] dark:text-[#f5f5f7]">
            <Info size={12} className="text-[#ff9500] mt-0.5 flex-shrink-0" />
            <div className="flex-1">
              <p>
                <strong>Test emails arrive even while this says &ldquo;Pending&rdquo;</strong> — we fall back to a shared sender until your domain is verified. &ldquo;Verified&rdquo; only changes the FROM address subscribers see (so it reads as your brand, not MVP).
              </p>
              {settings.domain_checked_at && (
                <p className="text-[#86868b] dark:text-[#8e8e93] mt-1">
                  Last checked: {new Date(settings.domain_checked_at).toLocaleString()}. We auto-re-check whenever you open this page; click <strong>Verify</strong> below to force a fresh check now.
                </p>
              )}
            </div>
          </div>
        )}

        {/* State (a): no domain set yet → input + add button */}
        {!settings?.sender_domain && (
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex-1 min-w-[220px]">
              <label className="block text-[11px] font-medium text-[#3a3a3c] dark:text-[#d2d2d7] mb-1">Pick a sender subdomain</label>
              <input
                type="text"
                value={domainInput}
                onChange={(e) => setDomainInput(e.target.value)}
                placeholder="mail.yourdomain.com"
                disabled={domainBusy === 'add'}
                className="w-full text-sm px-3 py-2 rounded-md border border-gray-200 dark:border-white/10 bg-white dark:bg-[#2c2c2e] text-[#1d1d1f] dark:text-[#f5f5f7]"
              />
              <p className="text-[11px] text-[#86868b] dark:text-[#8e8e93] mt-1">A subdomain like <code className="font-mono">mail.</code> is recommended — it keeps your root domain&apos;s reputation isolated.</p>
            </div>
            <button
              onClick={() => void addDomain()}
              disabled={domainBusy === 'add' || !domainInput.trim()}
              className="px-3 py-2 rounded-md text-xs font-semibold text-white bg-[#7C3AED] hover:bg-[#6D28D9] disabled:opacity-50 transition-colors"
            >
              {domainBusy === 'add' ? <><Loader2 size={11} className="animate-spin inline mr-1" /> Adding…</> : 'Add domain'}
            </button>
          </div>
        )}

        {/* State (b)+(c): domain is set → show records (always, in case the
            user wants to copy again) + verify + remove */}
        {settings?.sender_domain && (
          <>
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <code className="text-sm font-mono text-[#1d1d1f] dark:text-[#f5f5f7] px-2 py-1 bg-[#f5f5f7] dark:bg-[#2c2c2e] rounded-md">
                newsletter@{settings.sender_domain}
              </code>
              {settings.domain_status !== 'verified' && (
                <button
                  onClick={() => void verifyDomain()}
                  disabled={domainBusy === 'verify'}
                  className="px-3 py-1.5 rounded-md text-xs font-semibold text-white bg-[#7C3AED] hover:bg-[#6D28D9] disabled:opacity-50 transition-colors"
                >
                  {domainBusy === 'verify' ? <><Loader2 size={11} className="animate-spin inline mr-1" /> Checking…</> : <>Verify</>}
                </button>
              )}
              <button
                onClick={() => void removeDomain()}
                disabled={domainBusy === 'remove'}
                className="px-2 py-1 rounded-md text-[11px] font-medium text-[#86868b] hover:text-[#ff3b30] transition-colors"
              >
                {domainBusy === 'remove' ? 'Removing…' : 'Remove'}
              </button>
            </div>

            {/* DNS records — only show until verified */}
            {settings.domain_status !== 'verified' && Array.isArray(settings.dkim_records) && settings.dkim_records.length > 0 && (
              <div className="mt-3 border border-gray-200 dark:border-white/10 rounded-lg overflow-hidden">
                <div className="px-3 py-2 bg-[#f5f5f7] dark:bg-[#1c1c1e] border-b border-gray-200 dark:border-white/10 flex items-start justify-between gap-3 flex-wrap">
                  <div>
                    <p className="text-[11px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Add these {settings.dkim_records.length} DNS records to your domain</p>
                    <p className="text-[11px] text-[#86868b] dark:text-[#8e8e93] mt-0.5 leading-relaxed">
                      Cloudflare, Route 53, and Google DNS support the zone file below as a one-click <strong>Import</strong>. Hostinger / Namecheap: add each row by hand — if the Name column already appends your root domain, paste just the prefix part.
                    </p>
                  </div>
                  {/* Zone-file download — useful for both bulk-import panels AND
                      as a clean copy-paste reference (especially for the long
                      DKIM value, which is a pain to copy from the table cell). */}
                  <button
                    onClick={downloadZoneFile}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-semibold border border-gray-200 dark:border-white/10 bg-white dark:bg-[#2c2c2e] hover:border-[#7C3AED] text-[#7C3AED] flex-shrink-0"
                    title="Download as a BIND zone file — import into Cloudflare / Route 53 / Google DNS in one shot"
                  >
                    <Download size={11} /> Download zone file
                  </button>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-[10px] uppercase tracking-wide text-[#86868b] dark:text-[#8e8e93] border-b border-gray-200 dark:border-white/10">
                        <th className="font-medium px-3 py-2">Type</th>
                        <th className="font-medium px-3 py-2">Name</th>
                        <th className="font-medium px-3 py-2">Value</th>
                        <th className="font-medium px-3 py-2">TTL</th>
                        <th className="font-medium px-3 py-2"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {settings.dkim_records.map((r, i) => {
                        const key = `${r.type}:${r.name}:${i}`
                        return (
                          <tr key={key} className="border-b border-gray-100 dark:border-white/5">
                            <td className="px-3 py-2 font-mono text-[#1d1d1f] dark:text-[#f5f5f7]">
                              {r.type}
                              {r.type === 'MX' && r.priority != null && <span className="text-[#86868b]"> (prio {r.priority})</span>}
                            </td>
                            <td className="px-3 py-2 font-mono text-[#1d1d1f] dark:text-[#f5f5f7] break-all">{r.name}</td>
                            <td className="px-3 py-2 font-mono text-[#1d1d1f] dark:text-[#f5f5f7] break-all max-w-[280px]">{r.value}</td>
                            <td className="px-3 py-2 text-[#86868b] dark:text-[#8e8e93]">{r.ttl || 'Auto'}</td>
                            <td className="px-3 py-2 text-right whitespace-nowrap">
                              <button
                                onClick={() => copyRecord(key, r.value)}
                                className="inline-flex items-center gap-1 text-[11px] text-[#7C3AED] hover:underline"
                              >
                                {copiedRecord === key ? <><CheckCircle size={11} /> Copied</> : <><Copy size={11} /> Copy value</>}
                              </button>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="px-3 py-2 bg-[#f5f5f7] dark:bg-[#1c1c1e] border-t border-gray-200 dark:border-white/10 flex items-center justify-between gap-3 flex-wrap">
                  <p className="text-[11px] text-[#86868b] dark:text-[#8e8e93]">
                    DNS can take a few minutes to an hour to propagate. Add the records, then come back and hit Verify.
                  </p>
                  {/* "Run DNS check" — server-side resolves each record
                      against public DNS and shows per-row match/missing/
                      wrong status. Far more useful than the binary
                      Verify badge for diagnosing exactly which row is
                      the holdup. */}
                  <button
                    type="button"
                    onClick={() => void runDnsCheck()}
                    disabled={domainBusy === 'dns-check'}
                    className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2 py-1 rounded-md border border-[#7C3AED]/30 text-[#7C3AED] hover:bg-[#7C3AED]/10 disabled:opacity-50"
                  >
                    {domainBusy === 'dns-check'
                      ? <><Loader2 size={11} className="animate-spin" /> Checking DNS…</>
                      : <><RefreshCw size={11} /> Run DNS check</>
                    }
                  </button>
                </div>

                {/* DNS check results — per-record diagnostic. Shows
                    exactly what was resolved at the public DNS so the
                    user can pinpoint which row is missing/wrong. */}
                {dnsCheck && (
                  <div className="px-3 py-3 border-t border-gray-200 dark:border-white/10 bg-white dark:bg-[#1c1c1e]">
                    <p className="text-[11px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-2">
                      DNS lookup results
                      {dnsCheck.allMatch
                        ? <span className="ml-2 text-[#34c759]">— all records found ✓</span>
                        : <span className="ml-2 text-[#ff9500]">— some records aren&apos;t matching yet</span>
                      }
                    </p>
                    <div className="flex flex-col gap-2">
                      {dnsCheck.results.map((r, i) => {
                        const ok = r.result === 'match'
                        const soft = r.result === 'partial'
                        const bad = r.result === 'not_found' || r.result === 'wrong' || r.result === 'error'
                        const badgeColor = ok ? 'text-[#34c759] bg-[#34c759]/10'
                          : soft ? 'text-[#ff9500] bg-[#ff9500]/10'
                          : 'text-[#ff3b30] bg-[#ff3b30]/10'
                        const badgeLabel = ok ? 'Match'
                          : soft ? 'Partial match'
                          : r.result === 'not_found' ? 'Not found'
                          : r.result === 'wrong' ? 'Wrong value'
                          : 'DNS error'
                        return (
                          <div key={`${r.type}:${r.hostname}:${i}`} className="rounded-md border border-gray-200 dark:border-white/10 p-2.5">
                            <div className="flex items-center justify-between gap-2 mb-1">
                              <div className="flex items-center gap-2 min-w-0">
                                <span className="font-mono text-[11px] text-[#1d1d1f] dark:text-[#f5f5f7]">{r.type}</span>
                                <span className="font-mono text-[11px] text-[#86868b] dark:text-[#8e8e93] truncate">{r.hostname}</span>
                              </div>
                              <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-md ${badgeColor}`}>{badgeLabel}</span>
                            </div>
                            {bad && r.foundValues.length > 0 && (
                              <p className="text-[10px] text-[#6e6e73] dark:text-[#ebebf0] mb-1">
                                <span className="font-semibold">Found:</span> <code className="font-mono text-[10px] break-all">{r.foundValues[0].slice(0, 200)}{r.foundValues[0].length > 200 ? '…' : ''}</code>
                              </p>
                            )}
                            {r.hint && !ok && (
                              <p className="text-[10px] text-[#86868b] dark:text-[#8e8e93] leading-relaxed">{r.hint}</p>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {domainMsg && (
          <div className={`mt-3 text-xs rounded-md px-3 py-2 ${domainMsg.ok ? 'bg-[#34c759]/10 text-[#34c759]' : 'bg-[#ff3b30]/10 text-[#ff3b30]'}`}>
            {domainMsg.text}
          </div>
        )}
      </div>

      {/* Embed snippet */}
      <div className="card p-5 mb-6">
        <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">Embed the signup form</p>
        <p className="text-xs text-[#86868b] dark:text-[#8e8e93] mb-3 leading-relaxed">
          Paste this shortcode into any WordPress page or post (the MVP plugin renders the styled form).
          For the form to actually save signups, the toggle above must be on.
        </p>
        <div className="flex items-center gap-2 bg-[#f5f5f7] dark:bg-[#2c2c2e] rounded-md px-3 py-2 border border-gray-200 dark:border-white/10">
          <code className="text-xs flex-1 text-[#1d1d1f] dark:text-[#f5f5f7] font-mono overflow-x-auto whitespace-nowrap">
            [mvp-newsletter user=&quot;{settings?.user_id}&quot;]
          </code>
          <button
            onClick={copyShortcode}
            className="flex items-center gap-1 text-xs px-2 py-1 rounded-md hover:bg-white dark:hover:bg-[#1c1c1e] text-[#7C3AED] flex-shrink-0"
          >
            {copied ? <><CheckCircle size={11} /> Copied</> : <><Copy size={11} /> Copy</>}
          </button>
        </div>
      </div>

      {/* Subscribers table */}
      <div className="card p-5">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Subscribers</p>
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => void load()}
              className="flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium border border-gray-200 dark:border-white/10 hover:border-[#7C3AED] text-[#3a3a3c] dark:text-[#d2d2d7]"
              title="Refresh the list"
            >
              <RefreshCw size={11} /> Refresh
            </button>
            <a
              href="/api/newsletter/subscribers?format=csv"
              className="flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium border border-gray-200 dark:border-white/10 hover:border-[#7C3AED] text-[#3a3a3c] dark:text-[#d2d2d7]"
            >
              <Download size={11} /> Export CSV
            </a>
            <button
              onClick={() => setPasteOpen(true)}
              disabled={importing}
              className="flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium border border-gray-200 dark:border-white/10 hover:border-[#7C3AED] text-[#3a3a3c] dark:text-[#d2d2d7] disabled:opacity-60"
              title="Paste emails from Mailchimp, Substack, ConvertKit, or any list — no file needed"
            >
              <Copy size={11} /> Paste list
            </button>
            <label className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold border cursor-pointer ${importing ? 'opacity-60 cursor-wait' : 'hover:border-[#7C3AED]'}`}
              style={{ borderColor: '#d2d2d7', color: '#1d1d1f', background: 'white' }}>
              <input
                type="file"
                accept=".csv,text/csv,text/plain"
                className="hidden"
                disabled={importing}
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) void handleImport(f)
                  e.target.value = ''
                }}
              />
              {importing ? <><Loader2 size={11} className="animate-spin" /> Importing…</> : <><Upload size={11} /> Import CSV</>}
            </label>
          </div>
        </div>

        {importMsg && (
          <div className={`mb-3 text-xs rounded-md px-3 py-2 ${importMsg.ok ? 'bg-[#34c759]/10 text-[#34c759]' : 'bg-[#ff3b30]/10 text-[#ff3b30]'}`}>
            {importMsg.text}
          </div>
        )}

        {subs.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-sm text-[#86868b] dark:text-[#8e8e93] mb-3">No subscribers yet. Once you paste the shortcode on your blog and someone signs up, they&apos;ll show here.</p>
            <Link href="/setup" className="text-xs text-[#7C3AED] hover:underline">Go to Setup → embed the form →</Link>
          </div>
        ) : (
          <div className="overflow-x-auto -mx-5">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-[#86868b] dark:text-[#8e8e93] border-b border-gray-200 dark:border-white/10">
                  <th className="font-medium px-5 py-2">Email</th>
                  <th className="font-medium px-3 py-2">Status</th>
                  <th className="font-medium px-3 py-2">Joined</th>
                  <th className="font-medium px-5 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {subs.map(s => (
                  <tr key={s.id} className="border-b border-gray-100 dark:border-white/5 hover:bg-[#f5f5f7]/50 dark:hover:bg-white/5">
                    <td className="px-5 py-2 text-[#1d1d1f] dark:text-[#f5f5f7]">{s.email}</td>
                    <td className="px-3 py-2">
                      <span className={`text-[11px] px-1.5 py-0.5 rounded-md ${s.status === 'active' ? 'bg-[#34c759]/10 text-[#34c759]' : s.status === 'pending' ? 'bg-[#ff9500]/10 text-[#ff9500]' : 'bg-gray-200 text-[#6e6e73]'}`}>
                        {s.status}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-[#6e6e73] dark:text-[#ebebf0] text-xs">
                      {new Date(s.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-5 py-2 text-right">
                      <button
                        onClick={() => void deleteSubscriber(s.id)}
                        className="text-[#86868b] hover:text-[#ff3b30] transition-colors"
                        title="Permanently delete (GDPR)"
                      >
                        <Trash2 size={13} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Paste-list modal — fastest path for creators moving over from
          Mailchimp / Substack / ConvertKit. The /import API already handles
          newline-separated emails OR a CSV first column, so they can just
          copy the "Email" column from their existing dashboard and paste. */}
      {pasteOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-black/40" onClick={() => setPasteOpen(false)}>
          <div className="bg-white dark:bg-[#1c1c1e] rounded-2xl shadow-2xl max-w-xl w-full p-6" onClick={(e) => e.stopPropagation()}>
            <p className="text-base font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">Paste subscribers</p>
            <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0] mb-3 leading-relaxed">
              Paste a list of emails — one per line, or the first column of a CSV. Works straight from Mailchimp, Substack, ConvertKit, Beehiiv, or anywhere else you exported a list. Imported subscribers come in as <strong>active</strong> (we trust they consented on the other platform).
            </p>
            <textarea
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              rows={10}
              placeholder={"alice@example.com\nbob@example.com\ncarol@example.com\n…"}
              className="w-full text-sm font-mono px-3 py-2 rounded-md border border-gray-200 dark:border-white/10 bg-white dark:bg-[#2c2c2e] text-[#1d1d1f] dark:text-[#f5f5f7]"
              autoFocus
            />
            <p className="text-[11px] text-[#86868b] dark:text-[#8e8e93] mt-2">
              Tier cap respected — anything beyond your limit is skipped (we&apos;ll tell you how many).
            </p>
            <div className="flex items-center justify-end gap-2 mt-4">
              <button
                onClick={() => { setPasteOpen(false); setPasteText('') }}
                className="px-3 py-1.5 rounded-md text-xs font-medium text-[#3a3a3c] dark:text-[#d2d2d7] hover:bg-gray-100 dark:hover:bg-white/5"
              >
                Cancel
              </button>
              <button
                onClick={() => void handlePasteImport()}
                disabled={!pasteText.trim() || importing}
                className="px-3 py-1.5 rounded-md text-xs font-semibold text-white bg-[#7C3AED] hover:bg-[#6D28D9] disabled:opacity-60"
              >
                Import
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Recent broadcasts — Milestone 3. Empty until the creator sends
          their first issue, then shows the last 30 with delivery counters. */}
      {broadcasts.length > 0 && (
        <div className="card p-5 mt-6">
          <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-4">Recent broadcasts</p>
          <div className="overflow-x-auto -mx-5">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-[#86868b] dark:text-[#8e8e93] border-b border-gray-200 dark:border-white/10">
                  <th className="font-medium px-5 py-2">Subject</th>
                  <th className="font-medium px-3 py-2">Status</th>
                  <th className="font-medium px-3 py-2 text-right">Delivered</th>
                  <th className="font-medium px-3 py-2 text-right">Bounced</th>
                  <th className="font-medium px-5 py-2">Sent</th>
                </tr>
              </thead>
              <tbody>
                {broadcasts.map(b => (
                  <tr key={b.id} className="border-b border-gray-100 dark:border-white/5">
                    <td className="px-5 py-2 text-[#1d1d1f] dark:text-[#f5f5f7]">
                      {b.subject}
                      {b.error_message && <p className="text-[10px] text-[#ff9500] mt-0.5">{b.error_message}</p>}
                    </td>
                    <td className="px-3 py-2">
                      <span className={`text-[11px] px-1.5 py-0.5 rounded-md ${b.status === 'sent' ? 'bg-[#34c759]/10 text-[#34c759]' : b.status === 'sending' ? 'bg-[#7C3AED]/10 text-[#7C3AED]' : b.status === 'failed' ? 'bg-[#ff3b30]/10 text-[#ff3b30]' : 'bg-gray-200 text-[#6e6e73]'}`}>
                        {b.status}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right text-xs text-[#3a3a3c] dark:text-[#d2d2d7]">{b.recipients_delivered} / {b.recipients_total}</td>
                    <td className="px-3 py-2 text-right text-xs text-[#3a3a3c] dark:text-[#d2d2d7]">{b.recipients_bounced || 0}</td>
                    <td className="px-5 py-2 text-[#6e6e73] dark:text-[#ebebf0] text-xs">
                      {b.sent_at ? new Date(b.sent_at).toLocaleDateString() : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <ConfirmHost />
    </>
  )
}

// ── Live preview of the WP-rendered signup form ──────────────────────────────
// Mirrors mvp_affiliate_render_newsletter_form() in the plugin — same
// inline styles, same layout, same fallback hierarchy (caller atts →
// dashboard overrides → theme default). Kept here as a tiny component so
// the editor card stays readable.
function NewsletterFormPreview({
  senderName, title, subtitle, button, bullets,
}: {
  /** Current sender_name from settings — drives the title fallback. */
  senderName: string
  /** Live editor value (uncontrolled string). Empty → use the
   *  sender-aware fallback so creators see the actual default they'd
   *  ship with. */
  title: string
  subtitle: string
  button: string
  /** 3-entry array, each can be empty. Empties drop out; all empty falls
   *  back to the theme's default trio. */
  bullets: [string, string, string]
}) {
  const name = senderName.trim()
  const titleFallback = name
    ? `Get the next ${name} review in your inbox`
    : 'Get the next review in your inbox'
  const t = title.trim() || titleFallback
  const s = subtitle.trim() || 'No spam. One short email when there’s a new post worth your time or when there are things you might have missed online.'
  const b = button.trim() || 'Subscribe'
  const customBullets = bullets.map(x => x.trim()).filter(Boolean)
  const previewBullets = customBullets.length > 0 ? customBullets : [
    'One short email per week — never spam',
    "Skips the stuff that isn’t worth your time",
    'Unsubscribe with one click, any time',
  ]
  return (
    // The dashboard preview mirrors the WP theme's mvp-newsletter-hero:
    // gradient band background, two-column layout, copy on the left,
    // compact form (no title/subtitle dupe) on the right. Mobile collapse
    // is omitted — the dashboard editor is desktop-first.
    <div
      className="rounded-2xl border border-gray-200 dark:border-white/10 overflow-hidden"
      style={{
        background: 'linear-gradient(180deg, #f5faff 0%, #ffffff 100%)',
        padding: '20px',
        fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif',
        color: '#1d1d1f',
      }}
    >
      <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 1fr', gap: 20, alignItems: 'center' }}>
        <div>
          <h3 style={{ margin: '0 0 8px', fontSize: 18, lineHeight: 1.2, color: '#1d1d1f', fontWeight: 700 }}>{t}</h3>
          <p style={{ margin: '0 0 12px', fontSize: 12, lineHeight: 1.5, color: '#4a4a4d' }}>{s}</p>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {previewBullets.map((line, i) => (
              <li key={i} style={{ position: 'relative', paddingLeft: 20, fontSize: 12, lineHeight: 1.5, color: '#1d1d1f' }}>
                <span style={{ position: 'absolute', left: 0, top: 3, width: 14, height: 14, borderRadius: 999, background: '#34c759', color: '#fff', fontSize: 8, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>✓</span>
                {line}
              </li>
            ))}
          </ul>
        </div>
        <div style={{ background: '#fff', border: '1px solid rgba(0,0,0,0.08)', borderRadius: 12, padding: 14 }}>
          <input
            type="email"
            placeholder="you@email.com"
            disabled
            style={{ width: '100%', padding: '10px 12px', border: '1px solid rgba(0,0,0,0.15)', borderRadius: 10, fontSize: 13, color: '#1d1d1f', background: '#fff', outline: 'none', marginBottom: 8, boxSizing: 'border-box' }}
          />
          <button
            type="button"
            disabled
            style={{ width: '100%', padding: '10px 16px', border: 'none', borderRadius: 10, background: '#7C3AED', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'default' }}
          >
            {b}
          </button>
        </div>
      </div>
    </div>
  )
}

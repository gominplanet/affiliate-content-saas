/**
 * Multi-site WordPress manager — slots into the existing /setup → WordPress
 * section once the user has at least one site connected. Shows the connected
 * site(s), per-row actions (rename, set as default, disconnect), and an
 * "+ Add another site" button gated to Pro.
 *
 * Backed by /api/wordpress/sites (list + create) and
 * /api/wordpress/sites/[id] (rename / set-default / disconnect).
 *
 * PHASE 2 LIMITATION: this component lets a Pro user add up to 5 sites to
 * the wordpress_sites table, but the rest of the app (blog/generate,
 * publish-to-WP, customize, etc.) still reads from the legacy
 * integrations.wordpress_* columns. Phase 3 migrates every route. Until
 * then we surface a small banner so multi-site Pros don't think a
 * non-default site will receive publishes yet.
 */

'use client'

import { useEffect, useRef, useState } from 'react'
import { useModalA11y } from '@/components/ui/useModalA11y'
import { toast } from 'sonner'
import {
  Plus, Loader2, Star, Pencil, Trash2, ExternalLink, Globe,
  Check, X, AlertCircle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useConfirm } from '@/components/ui/useConfirm'
import type { Tier } from '@/lib/tier'

interface Site {
  id: string
  label: string
  url: string
  username: string
  appPassword: string  // not displayed; here for type completeness
  apiToken: string | null
  isDefault: boolean
}

interface SitesPayload {
  sites: Site[]
  cap: { current: number; max: number; canAddMore: boolean }
  tier: Tier
}

export default function WordPressSitesManager() {
  const [data, setData] = useState<SitesPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [addOpen, setAddOpen] = useState(false)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const { confirm, ConfirmHost } = useConfirm()

  async function load() {
    try {
      const res = await fetch('/api/wordpress/sites')
      if (res.ok) setData(await res.json())
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-6">
        <Loader2 size={16} className="animate-spin text-[#86868b]" />
      </div>
    )
  }

  // No sites yet — let the existing single-site connect flow handle it.
  // This component only renders for users with at least one connected site.
  if (!data || data.sites.length === 0) return null

  const isPro = data.tier === 'pro' || data.tier === 'admin'
  const showAddCTA = isPro || data.sites.length < data.cap.max

  return (
    <div className="card p-5 mt-4">
      <div className="flex items-start justify-between mb-4">
        <div>
          <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">
            Connected WordPress sites
          </p>
          <p className="text-xs text-[#86868b] dark:text-[#8e8e93] mt-0.5">
            {data.cap.current} of {data.cap.max} site{data.cap.max === 1 ? '' : 's'} connected
            {!isPro && data.cap.max === 1 && ' · Upgrade to Pro for up to 5 sites'}
          </p>
        </div>
        {showAddCTA && data.cap.canAddMore && (
          <Button
            variant="primary"
            size="sm"
            leftIcon={<Plus size={12} />}
            onClick={() => setAddOpen(true)}
          >
            Add another site
          </Button>
        )}
        {!data.cap.canAddMore && isPro && (
          <span className="text-xs text-[#86868b]">
            Pro limit reached (5 sites). Remove one to add another.
          </span>
        )}
      </div>

      {/* How routing works — informational banner for multi-site users.
          The publish pipeline is fully per-site as of Phase 3.1: rewrites
          stay on the post's original site automatically; fresh generations
          go to whichever site is marked DEFAULT below; Compare & Guides
          has an explicit "Publish to" picker. */}
      {data.sites.length > 1 && (
        <div className="rounded-xl bg-[#7C3AED]/10 border border-[#7C3AED]/30 p-3 mb-4 flex items-start gap-2">
          <AlertCircle size={14} className="text-[#7C3AED] flex-shrink-0 mt-0.5" />
          <p className="text-xs text-[#3a3a3c] dark:text-[#ebebf0] leading-relaxed">
            <strong>How routing works:</strong> rewriting an existing post stays on its
            original site. Fresh generations publish to the site marked <strong>default</strong>
            {' '}below — change the default with the star button. Compare & Guides has its
            own &ldquo;Publish to&rdquo; picker.
          </p>
        </div>
      )}

      {/* Icon legend — each site row has 3 icon-only action buttons
          (Star / Pencil / Trash2). Per the "hand-hold users as much as
          possible" rule, surface what each icon does in plain English
          above the list so non-technical users don't need to hover.
          Same pattern as the Deals page Recent Deals legend. */}
      <div className="rounded-lg border border-gray-200 dark:border-white/10 bg-[var(--surface-2)] p-3 mb-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-[11px] text-[#86868b] dark:text-[#8e8e93]">
        <span className="font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">What the buttons do:</span>
        <span className="inline-flex items-center gap-1">
          <Star size={11} className="text-[#7C3AED]" />
          <strong className="text-[#1d1d1f] dark:text-[#f5f5f7]">Star</strong> — set as default (fresh blog posts publish here)
        </span>
        <span className="inline-flex items-center gap-1">
          <Pencil size={11} className="text-[#1d1d1f] dark:text-[#f5f5f7]" />
          <strong className="text-[#1d1d1f] dark:text-[#f5f5f7]">Pencil</strong> — rename the label (just for your site picker)
        </span>
        <span className="inline-flex items-center gap-1">
          <Trash2 size={11} className="text-[#ff3b30]" />
          <strong className="text-[#1d1d1f] dark:text-[#f5f5f7]">Trash</strong> — disconnect this site (does NOT delete WordPress posts)
        </span>
      </div>

      <ul className="flex flex-col gap-2">
        {data.sites.map(site => (
          <SiteRow
            key={site.id}
            site={site}
            isRenaming={renamingId === site.id}
            onStartRename={() => setRenamingId(site.id)}
            onCancelRename={() => setRenamingId(null)}
            onRenamed={async () => { setRenamingId(null); await load() }}
            onSetDefault={async () => {
              const res = await fetch(`/api/wordpress/sites/${site.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ makeDefault: true }),
              })
              if (res.ok) {
                toast.success(`${site.label} is now your default site.`)
                await load()
              } else {
                const j = await res.json().catch(() => ({}))
                toast.error(j.error || 'Could not change default site.')
              }
            }}
            onDelete={async () => {
              const ok = await confirm({
                title: `Disconnect ${site.label}?`,
                description: 'Posts published to this site stay live on WordPress, but you won\'t be able to publish or refresh them from MVP anymore.',
                confirmLabel: 'Disconnect',
                destructive: true,
              })
              if (!ok) return
              const res = await fetch(`/api/wordpress/sites/${site.id}`, { method: 'DELETE' })
              if (res.ok) {
                toast.success(`${site.label} disconnected.`)
                await load()
              } else {
                const j = await res.json().catch(() => ({}))
                toast.error(j.error || 'Could not disconnect site.')
              }
            }}
          />
        ))}
      </ul>

      {addOpen && (
        <AddSiteModal
          onClose={() => setAddOpen(false)}
          onAdded={async () => { setAddOpen(false); await load() }}
        />
      )}
      <ConfirmHost />
    </div>
  )
}

// ─── Per-row renderer (incl. inline rename) ─────────────────────────────────

function SiteRow({
  site, isRenaming, onStartRename, onCancelRename, onRenamed,
  onSetDefault, onDelete,
}: {
  site: Site
  isRenaming: boolean
  onStartRename: () => void
  onCancelRename: () => void
  onRenamed: () => void
  onSetDefault: () => void
  onDelete: () => void
}) {
  const [label, setLabel] = useState(site.label)
  const [saving, setSaving] = useState(false)

  async function save() {
    const trimmed = label.trim()
    if (!trimmed) { toast.error('Label cannot be empty.'); return }
    setSaving(true)
    try {
      const res = await fetch(`/api/wordpress/sites/${site.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: trimmed }),
      })
      if (res.ok) {
        toast.success('Site renamed.')
        onRenamed()
      } else {
        const j = await res.json().catch(() => ({}))
        toast.error(j.error || 'Rename failed.')
      }
    } finally { setSaving(false) }
  }

  return (
    <li className="flex items-center gap-3 p-3 rounded-xl bg-[var(--surface)] border border-[var(--border-2)]">
      <div className="w-8 h-8 rounded-lg bg-[#7C3AED]/10 flex items-center justify-center flex-shrink-0">
        <Globe size={14} className="text-[#7C3AED]" />
      </div>
      <div className="flex-1 min-w-0">
        {isRenaming ? (
          <div className="flex items-center gap-1.5">
            <input
              autoFocus
              type="text"
              value={label}
              onChange={e => setLabel(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') save()
                if (e.key === 'Escape') onCancelRename()
              }}
              maxLength={60}
              className="input-field h-7 px-2 text-sm flex-1"
              placeholder="Site label"
            />
            <Button variant="primary" size="sm" onClick={save} loading={saving} aria-label="Save">
              <Check size={12} />
            </Button>
            <Button variant="secondary" size="sm" onClick={onCancelRename} aria-label="Cancel">
              <X size={12} />
            </Button>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-1.5">
              <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] truncate">
                {site.label}
              </p>
              {site.isDefault && (
                <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider bg-[#7C3AED]/15 text-[#7C3AED]">
                  <Star size={9} /> Default
                </span>
              )}
            </div>
            <a
              href={site.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-[#86868b] hover:text-[#7C3AED] inline-flex items-center gap-1"
            >
              {site.url.replace(/^https?:\/\//, '')} <ExternalLink size={10} />
            </a>
          </>
        )}
      </div>

      {!isRenaming && (
        <div className="flex items-center gap-1 flex-shrink-0">
          {!site.isDefault && (
            <Button variant="ghost" size="sm" onClick={onSetDefault} title="Set as default">
              <Star size={12} />
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={onStartRename} title="Rename">
            <Pencil size={12} />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={onDelete}
            title="Disconnect this site"
            className="text-[#86868b] hover:text-[#ff3b30]"
          >
            <Trash2 size={12} />
          </Button>
        </div>
      )}
    </li>
  )
}

// ─── "Add another site" modal ─────────────────────────────────────────────

function AddSiteModal({
  onClose, onAdded,
}: {
  onClose: () => void
  onAdded: () => void
}) {
  // Two paths to connect a site:
  //  - "token": paste the one-line Connection Token from MVP Affiliate
  //    plugin (wp-admin → MVP Affiliate → Generate Connection Token).
  //    Fastest, no fields to fill in. Default because most users
  //    installed our plugin during the wizard.
  //  - "appPassword": legacy 4-field manual flow. For people who don't
  //    have our plugin (e.g. a managed WordPress install where they
  //    can't add plugins) — they generate a WP-native Application
  //    Password and paste the 24-char value here.
  const [mode, setMode] = useState<'token' | 'appPassword'>('token')
  const [label, setLabel] = useState('')
  const [token, setToken] = useState('')
  const [url, setUrl] = useState('')
  const [username, setUsername] = useState('')
  const [appPassword, setAppPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function submit() {
    if (mode === 'token') {
      if (!token.trim()) {
        toast.error('Paste your Connection Token to continue.')
        return
      }
    } else if (!url || !username || !appPassword) {
      toast.error('Fill out URL, username, and application password.')
      return
    }
    setSubmitting(true)
    try {
      const res = await fetch('/api/wordpress/sites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          mode === 'token'
            ? {
                label: label.trim(),
                token: token.trim(),
              }
            : {
                label: label.trim(),
                url: url.trim(),
                username: username.trim(),
                appPassword: appPassword.trim(),
              }
        ),
      })
      const j = await res.json().catch(() => ({}))
      if (res.ok) {
        toast.success(`${label || 'Site'} connected.`)
        onAdded()
      } else if (res.status === 402) {
        toast.error(j.error || 'Pro plan required to connect additional sites.')
      } else {
        toast.error(j.error || 'Could not connect site.')
      }
    } finally { setSubmitting(false) }
  }

  const panelRef = useRef<HTMLDivElement | null>(null)
  const onA11yKey = useModalA11y(true, panelRef, onClose)

  // Cleaned URL for the "Open Application Passwords" deep-link button.
  // wp-admin's Application Passwords page lives at
  // {url}/wp-admin/profile.php#application-passwords-section so we can
  // open it in a new tab with one click as long as the user has typed
  // their Site URL above. Strip trailing slash before appending.
  const cleanUrl = url.trim().replace(/\/+$/, '')
  const appPwUrl = cleanUrl
    ? `${cleanUrl}/wp-admin/profile.php#application-passwords-section`
    : ''

  return (
    <div
      // Backdrop: bumped from black/40 to black/70 + stronger blur so the
      // panel doesn't bleed visually into the page underneath (user
      // feedback 2026-06-05: "pop up window needs to be less transparent").
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-md"
      onClick={onClose}
      onKeyDown={onA11yKey}
      role="presentation"
    >
      <div
        ref={panelRef}
        // Solid background override on the panel itself — the shared
        // `card` class uses a translucent surface that lets the page
        // bleed through. Explicit white/dark fills here so the modal
        // reads as a true overlay, not glass.
        className="card p-6 max-w-md w-full outline-none bg-white dark:bg-[#1c1c1e] shadow-2xl"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Add WordPress site"
        tabIndex={-1}
      >
        <p className="text-base font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">Add another WordPress site</p>
        <p className="text-xs text-[#86868b] dark:text-[#8e8e93] mb-4 leading-relaxed">
          {mode === 'token'
            ? 'Paste the Connection Token from your second site\'s MVP Affiliate plugin and we handle the rest.'
            : 'Paste an Application Password from any WordPress site you control. Step-by-step instructions below.'}
        </p>

        {/* Hosting recommendation — many "add a site" users don't have the
            second blog yet. Point them at our recommended host (affiliate link)
            before the token/app-password fields. */}
        <div className="flex items-center justify-between gap-3 rounded-xl border border-[#7C3AED]/30 bg-[#7C3AED]/[0.05] px-3.5 py-3 mb-4">
          <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0] leading-relaxed">
            Don&apos;t have this blog yet? We recommend <strong className="text-[#1d1d1f] dark:text-[#f5f5f7]">Hostinger</strong> — under $3/mo, free domain year one, 1-click WordPress, and <strong className="text-[#7C3AED]">20% off through our link</strong>.
          </p>
          <a
            href="https://geni.us/MVPhosting"
            target="_blank"
            rel="noopener noreferrer"
            className="btn-primary text-xs flex-shrink-0 inline-flex items-center gap-1.5 whitespace-nowrap"
          >
            Get Hostinger — 20% off <ExternalLink size={12} />
          </a>
        </div>

        {/* Mode switcher — Token (default, MVP plugin path) vs.
            Application Password (legacy/no-plugin path). Same one-of-two
            pattern used elsewhere in the wizard so the UI stays
            consistent. */}
        <div className="flex items-center gap-1 bg-[#f5f5f7] dark:bg-[#000] p-1 rounded-xl mb-4">
          <button
            type="button"
            onClick={() => setMode('token')}
            className={`flex-1 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
              mode === 'token'
                ? 'bg-white dark:bg-[#1c1c1e] text-[#1d1d1f] dark:text-[#f5f5f7] shadow-apple-sm border border-gray-200/80 dark:border-white/10'
                : 'text-[#6e6e73] dark:text-[#ebebf0] hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7]'
            }`}
          >
            Connection Token <span className="text-[10px] text-[#86868b] ml-1">(recommended)</span>
          </button>
          <button
            type="button"
            onClick={() => setMode('appPassword')}
            className={`flex-1 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
              mode === 'appPassword'
                ? 'bg-white dark:bg-[#1c1c1e] text-[#1d1d1f] dark:text-[#f5f5f7] shadow-apple-sm border border-gray-200/80 dark:border-white/10'
                : 'text-[#6e6e73] dark:text-[#ebebf0] hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7]'
            }`}
          >
            Application Password
          </button>
        </div>

        {/* Token mode — instruction block */}
        {mode === 'token' && (
          <details open className="mb-4 rounded-xl border border-[#7C3AED]/20 bg-[#7C3AED]/5 p-4">
            <summary className="text-xs font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] cursor-pointer select-none flex items-center justify-between gap-2">
              <span>How to get a Connection Token (30 sec)</span>
              <span className="text-[10px] uppercase tracking-wider text-[#86868b]">click to expand/collapse</span>
            </summary>
            <ol className="mt-3 flex flex-col gap-2 text-[11px] text-[#6e6e73] dark:text-[#ebebf0] leading-relaxed">
              <li className="flex items-start gap-2">
                <span className="w-4 h-4 rounded-full bg-[#7C3AED]/10 text-[#7C3AED] text-[10px] font-bold flex items-center justify-center flex-shrink-0 mt-0.5">1</span>
                <span>Log in to <strong>wp-admin</strong> on the WordPress site you want to add.</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="w-4 h-4 rounded-full bg-[#7C3AED]/10 text-[#7C3AED] text-[10px] font-bold flex items-center justify-center flex-shrink-0 mt-0.5">2</span>
                <span>
                  In the left sidebar, click <strong>MVP Affiliate</strong>. (If you don&apos;t see it: install the plugin first — <a href="/mvp-affiliate.zip" download className="text-[#7C3AED] hover:underline">download mvpaffiliate-platform.zip</a> → Plugins → Add New → Upload Plugin → Activate.)
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="w-4 h-4 rounded-full bg-[#7C3AED]/10 text-[#7C3AED] text-[10px] font-bold flex items-center justify-center flex-shrink-0 mt-0.5">3</span>
                <span>Click <strong>Generate Connection Token</strong> → copy the long string that appears.</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="w-4 h-4 rounded-full bg-[#7C3AED]/10 text-[#7C3AED] text-[10px] font-bold flex items-center justify-center flex-shrink-0 mt-0.5">4</span>
                <span>Paste it below and click Connect site.</span>
              </li>
            </ol>
            <p className="mt-3 text-[10px] text-[#86868b] dark:text-[#8e8e93]">
              No plugin access? Use the <button type="button" onClick={() => setMode('appPassword')} className="text-[#7C3AED] hover:underline font-medium">Application Password tab</button> instead — manual but works on any WordPress install.
            </p>
          </details>
        )}

        {/* Application Password mode — instruction block */}
        {mode === 'appPassword' && (
          /* "How do I get this?" instructions — always-visible because
              this modal is unusable without them. Numbered + with a
              deep-link button that opens the user's wp-admin Application
              Passwords page directly once they've typed their Site URL. */
          <details open className="mb-4 rounded-xl border border-[#7C3AED]/20 bg-[#7C3AED]/5 p-4">
          <summary className="text-xs font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] cursor-pointer select-none flex items-center justify-between gap-2">
            <span>How to get an Application Password (1 min)</span>
            <span className="text-[10px] uppercase tracking-wider text-[#86868b]">click to expand/collapse</span>
          </summary>
          <ol className="mt-3 flex flex-col gap-2 text-[11px] text-[#6e6e73] dark:text-[#ebebf0] leading-relaxed">
            <li className="flex items-start gap-2">
              <span className="w-4 h-4 rounded-full bg-[#7C3AED]/10 text-[#7C3AED] text-[10px] font-bold flex items-center justify-center flex-shrink-0 mt-0.5">1</span>
              <span>Log in to your WordPress site as an admin user.</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="w-4 h-4 rounded-full bg-[#7C3AED]/10 text-[#7C3AED] text-[10px] font-bold flex items-center justify-center flex-shrink-0 mt-0.5">2</span>
              <span>
                Go to <strong>Users → Profile</strong> in the left sidebar (or click the link below once you&apos;ve typed your Site URL).
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span className="w-4 h-4 rounded-full bg-[#7C3AED]/10 text-[#7C3AED] text-[10px] font-bold flex items-center justify-center flex-shrink-0 mt-0.5">3</span>
              <span>Scroll down to the <strong>Application Passwords</strong> section (near the bottom).</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="w-4 h-4 rounded-full bg-[#7C3AED]/10 text-[#7C3AED] text-[10px] font-bold flex items-center justify-center flex-shrink-0 mt-0.5">4</span>
              <span>
                Type a name like <code className="px-1 py-0.5 rounded bg-white/60 dark:bg-white/10 text-[10px]">MVP Affiliate</code> in the &ldquo;New Application Password Name&rdquo; box → click <strong>Add New Application Password</strong>.
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span className="w-4 h-4 rounded-full bg-[#7C3AED]/10 text-[#7C3AED] text-[10px] font-bold flex items-center justify-center flex-shrink-0 mt-0.5">5</span>
              <span>
                WordPress shows a 24-character password ONCE — copy it (spaces are fine) and paste below.
              </span>
            </li>
          </ol>
          {appPwUrl ? (
            <a
              href={appPwUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-[#7C3AED] hover:underline"
            >
              Open Application Passwords on your site → ↗
            </a>
          ) : (
            <p className="mt-3 text-[10px] text-[#86868b] dark:text-[#8e8e93] italic">
              Type your Site URL below to enable the one-click &ldquo;Open Application Passwords&rdquo; link.
            </p>
          )}
          <p className="mt-2 text-[10px] text-[#86868b] dark:text-[#8e8e93]">
            Don&apos;t see &ldquo;Application Passwords&rdquo;? Your host (commonly Hostinger&apos;s legacy CDN, WPEngine, or some security plugins) may have disabled it. Disable any security plugin temporarily, or contact your host to re-enable Application Passwords. <button type="button" onClick={() => setMode('token')} className="text-[#7C3AED] hover:underline font-medium">Or use our Connection Token instead →</button>
          </p>
          </details>
        )}

        {/* Fields — Label is shared; the rest depends on `mode`. */}
        <div className="flex flex-col gap-3">
          <Field
            label="Label"
            placeholder="e.g. Wine Reviews"
            value={label}
            onChange={setLabel}
            hint="Just for you — shown in the site picker."
          />

          {mode === 'token' ? (
            <Field
              label="Connection Token"
              placeholder="Paste the long string from wp-admin → MVP Affiliate"
              value={token}
              onChange={setToken}
              hint="One-line base64 token. Contains the site URL, username, and Application Password — all encoded."
              type="password"
            />
          ) : (
            <>
              <Field
                label="Site URL"
                placeholder="https://your-site.com"
                value={url}
                onChange={setUrl}
                hint="Full URL with https://. No trailing slash."
              />
              <Field
                label="WordPress username"
                placeholder="admin"
                value={username}
                onChange={setUsername}
              />
              <Field
                label="Application password"
                placeholder="xxxx xxxx xxxx xxxx xxxx xxxx"
                value={appPassword}
                onChange={setAppPassword}
                hint="The 24-character password WordPress shows you ONCE. Spaces are stripped automatically."
                type="password"
              />
            </>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 mt-5 pt-4 border-t border-[var(--border-2)]">
          <Button variant="secondary" onClick={onClose} disabled={submitting}>Cancel</Button>
          <Button variant="primary" onClick={submit} loading={submitting}>Connect site</Button>
        </div>
      </div>
    </div>
  )
}

function Field({
  label, value, onChange, placeholder, hint, type = 'text',
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  hint?: string
  type?: 'text' | 'password'
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-semibold text-[#3a3a3c] dark:text-[#ebebf0]">{label}</span>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="input-field h-9 px-3 text-sm"
      />
      {hint && <span className="text-[11px] text-[#86868b] leading-snug">{hint}</span>}
    </label>
  )
}

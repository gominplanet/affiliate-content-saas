'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  ExternalLink, CheckCircle, ChevronRight, Loader2,
  Globe, Wrench, Sparkles, Link2, Rocket, Eye, EyeOff,
  Download, Upload, X, ArrowLeft, Building2, Wand2,
  Facebook, Pin, MessageCircle, Wifi, Check, LogOut, Save, Linkedin, Lock, Clock,
} from 'lucide-react'
import { createBrowserClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import { metaEnabled, socialEnabled, type GatedSocialPlatform } from '@/lib/feature-flags'
import { effectiveTier } from '@/lib/view-as'
import { Suspense } from 'react'
import WordPressSitesManager from '@/components/dashboard/WordPressSitesManager'

type Mode = 'existing' | 'new' | null
type Step = 1 | 2 | 3 | 4 | 5

const steps = [
  { n: 1, label: 'Hosting', icon: Globe },
  { n: 2, label: 'WordPress', icon: Wrench },
  { n: 3, label: 'Your brand', icon: Sparkles },
  { n: 4, label: 'Launch', icon: Link2 },
  { n: 5, label: 'Done', icon: Rocket },
]

const PRESET_COLORS = [
  { hex: '#f5a623', label: 'Amber' },
  { hex: '#7C3AED', label: 'Blue' },
  { hex: '#34c759', label: 'Green' },
  { hex: '#ff3b30', label: 'Red' },
  { hex: '#af52de', label: 'Purple' },
  { hex: '#ff9f0a', label: 'Orange' },
  { hex: '#5856d6', label: 'Indigo' },
  { hex: '#ff2d55', label: 'Pink' },
]

const STORAGE_KEY = 'affiliateos_setup_v3'

interface ImageData {
  base64: string
  mime: string
  filename: string
  preview: string
}

interface BrandData {
  logo: ImageData | null
  headshot: ImageData | null
  aboutText: string
  contactEmail: string
  youtubeUrl: string
  instagramUrl: string
  tiktokUrl: string
  twitterUrl: string
  pinterestUrl: string
  facebookUrl: string
}

const defaultBrand: BrandData = {
  logo: null, headshot: null, aboutText: '', contactEmail: '',
  youtubeUrl: '', instagramUrl: '', tiktokUrl: '', twitterUrl: '', pinterestUrl: '', facebookUrl: '',
}

// ─── Step indicator ───────────────────────────────────────────────────────────
function StepIndicator({ current }: { current: Step }) {
  return (
    <div className="flex items-center mb-10 overflow-x-auto pb-1">
      {steps.map((s, i) => {
        const done = current > s.n
        const active = current === s.n
        const Icon = s.icon
        return (
          <div key={s.n} className="flex items-center flex-shrink-0">
            <div className="flex flex-col items-center gap-1.5">
              <div className={`w-9 h-9 rounded-full flex items-center justify-center transition-colors ${
                done ? 'bg-[#34c759] text-white' :
                active ? 'bg-[#7C3AED] text-white' :
                'bg-gray-100 text-[#86868b] dark:text-[#8e8e93]'
              }`}>
                {done ? <CheckCircle size={18} /> : <Icon size={16} />}
              </div>
              <span className={`text-xs font-medium whitespace-nowrap ${active ? 'text-[#1d1d1f] dark:text-[#f5f5f7]' : 'text-[#86868b] dark:text-[#8e8e93]'}`}>
                {s.label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div className={`w-12 h-px mx-2 mb-5 flex-shrink-0 ${current > s.n ? 'bg-[#34c759]' : 'bg-gray-200'}`} />
            )}
          </div>
        )
      })}
    </div>
  )
}

// ─── Image upload ─────────────────────────────────────────────────────────────
function ImageUpload({
  label, hint, shape = 'square', value, onChange,
}: {
  label: string
  hint?: string
  shape?: 'circle' | 'square'
  value: ImageData | null
  onChange: (img: ImageData | null) => void
}) {
  const ref = useRef<HTMLInputElement>(null)

  async function handleFile(file: File) {
    if (!file.type.startsWith('image/')) return
    const resized = await resizeImage(file, 800)
    onChange(resized)
  }

  return (
    <div>
      <label className="block text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7] mb-1.5">{label}</label>
      {hint && <p className="text-xs text-[#86868b] dark:text-[#8e8e93] mb-2">{hint}</p>}
      <div className="flex items-center gap-4">
        {value ? (
          <div className="relative">
            <img
              src={value.preview}
              alt=""
              className={`w-20 h-20 object-cover border border-gray-200 dark:border-white/10 ${shape === 'circle' ? 'rounded-full' : 'rounded-xl'}`}
            />
            <button
              type="button"
              onClick={() => onChange(null)}
              className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-[#ff3b30] text-white rounded-full flex items-center justify-center"
            >
              <X size={10} />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => ref.current?.click()}
            className={`w-20 h-20 border-2 border-dashed border-gray-300 hover:border-[#7C3AED] bg-[#f5f5f7] dark:bg-[#000] flex flex-col items-center justify-center gap-1 transition-colors ${shape === 'circle' ? 'rounded-full' : 'rounded-xl'}`}
          >
            <Upload size={16} className="text-[#86868b] dark:text-[#8e8e93]" />
            <span className="text-[10px] text-[#86868b] dark:text-[#8e8e93]">Upload</span>
          </button>
        )}
        <button
          type="button"
          onClick={() => ref.current?.click()}
          className="btn-secondary text-xs"
        >
          {value ? 'Change image' : 'Choose file'}
        </button>
      </div>
      <input
        ref={ref}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = '' }}
      />
    </div>
  )
}

async function resizeImage(file: File, maxSize: number): Promise<ImageData> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      let w = img.width, h = img.height
      if (w > maxSize || h > maxSize) {
        if (w > h) { h = Math.round(h * maxSize / w); w = maxSize }
        else { w = Math.round(w * maxSize / h); h = maxSize }
      }
      const canvas = document.createElement('canvas')
      canvas.width = w; canvas.height = h
      canvas.getContext('2d')!.drawImage(img, 0, 0, w, h)
      const mime = file.type || 'image/jpeg'
      const dataUrl = canvas.toDataURL(mime, 0.88)
      URL.revokeObjectURL(url)
      resolve({
        base64: dataUrl.split(',')[1],
        mime,
        filename: file.name,
        preview: dataUrl,
      })
    }
    img.onerror = reject
    img.src = url
  })
}

// ─── Mode picker ──────────────────────────────────────────────────────────────
function ModePicker({ onSelect }: { onSelect: (m: 'existing' | 'new') => void }) {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-xl font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">Where should your reviews live?</h2>
        <p className="text-sm text-[#6e6e73] dark:text-[#ebebf0]">
          Two very different paths. Pick one — you can always come back and run the other later for a second site.
        </p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">

        {/* Path A — existing site */}
        <button
          onClick={() => onSelect('existing')}
          className="group flex flex-col items-start gap-4 p-6 rounded-2xl border-2 border-gray-200 dark:border-white/10 hover:border-[#7C3AED] bg-white dark:bg-[#1c1c1e] text-left transition-all hover:shadow-md"
        >
          <div className="w-12 h-12 rounded-xl bg-[#7C3AED]/10 flex items-center justify-center group-hover:bg-[#7C3AED]/20 transition-colors">
            <Building2 size={22} className="text-[#7C3AED]" />
          </div>
          <div className="flex-1">
            <p className="text-base font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">I already have a WordPress blog</p>
            <p className="text-sm text-[#6e6e73] dark:text-[#ebebf0] leading-relaxed mb-3">
              Plug MVP into your existing site. Reviews land as drafts on your current theme — your design, your settings, untouched.
            </p>
            <div className="flex flex-col gap-1.5 mb-3">
              {[
                'Only publishes new posts you approve',
                'Never touches your theme or design',
                'Never modifies existing content',
                'Never installs plugins or changes settings',
              ].map(item => (
                <div key={item} className="flex items-start gap-2">
                  <Check size={13} className="text-[#34c759] flex-shrink-0 mt-0.5" />
                  <span className="text-xs text-[#6e6e73] dark:text-[#ebebf0]">{item}</span>
                </div>
              ))}
            </div>
          </div>
          <span className="inline-flex items-center gap-1.5 text-sm font-medium text-[#7C3AED] group-hover:gap-2.5 transition-all">
            Connect my existing site <ChevronRight size={15} />
          </span>
        </button>

        {/* Path B — new site from scratch */}
        <button
          onClick={() => onSelect('new')}
          className="group flex flex-col items-start gap-4 p-6 rounded-2xl border-2 border-gray-200 dark:border-white/10 hover:border-[#34c759] bg-white dark:bg-[#1c1c1e] text-left transition-all hover:shadow-md"
        >
          <div className="w-12 h-12 rounded-xl bg-[#34c759]/10 flex items-center justify-center group-hover:bg-[#34c759]/20 transition-colors">
            <Wand2 size={22} className="text-[#34c759]" />
          </div>
          <div className="flex-1">
            <p className="text-base font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">Build me a new review site from scratch</p>
            <p className="text-sm text-[#6e6e73] dark:text-[#ebebf0] leading-relaxed mb-3">
              Point a blank WordPress install at us and walk away. Theme, pages, navigation, sidebar, footer, branding — all wired up automatically from your Brand Profile.
            </p>
            <div className="flex flex-col gap-1.5 mb-1">
              {[
                'Installs & configures WordPress + theme',
                'Creates your Home, About & Privacy pages',
                'Sets up navigation, logo, and branding',
                'Configures your affiliate sidebar & footer',
              ].map(item => (
                <div key={item} className="flex items-start gap-2">
                  <Wand2 size={13} className="text-[#34c759] flex-shrink-0 mt-0.5" />
                  <span className="text-xs text-[#6e6e73] dark:text-[#ebebf0]">{item}</span>
                </div>
              ))}
            </div>
            <p className="text-[11px] text-[#ff9500] mt-2.5 flex items-center gap-1">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
              Only use this on a brand-new empty WordPress install.
            </p>
          </div>
          <span className="inline-flex items-center gap-1.5 text-sm font-medium text-[#34c759] group-hover:gap-2.5 transition-all">
            Start the setup wizard <ChevronRight size={15} />
          </span>
        </button>

      </div>

      {/* Bottom clarification */}
      <div className="rounded-xl bg-[var(--surface-2)] border border-[var(--border-1)] px-4 py-3 text-xs text-[#6e6e73] dark:text-[#ebebf0] leading-relaxed">
        <strong className="text-[#1d1d1f] dark:text-[#f5f5f7]">Not sure which to pick?</strong> If you already have posts, subscribers, or a design you care about — choose <strong>existing site</strong>. The setup wizard is only for blank new installs and will overwrite default WordPress content.
      </div>
    </div>
  )
}

// ─── Existing site connect ────────────────────────────────────────────────────
function ExistingConnect({ onBack, onDone }: { onBack: () => void; onDone: (url: string) => void }) {
  // ── Primary flow: WordPress core's Authorize-Application redirect.
  //    User types their site URL → we send them to WP's native authorize
  //    screen → they approve → WP redirects back with credentials.
  //    No plugin install required, no copy/paste of any token.
  // ── Fallback flow: the legacy Connection Token paste, kept behind a
  //    collapsed "advanced" toggle for sites that have disabled Application
  //    Passwords entirely (rare, mostly enterprise WP installs). ─────────
  const [siteUrl, setSiteUrl] = useState('')
  const [token, setToken] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showTokenFallback, setShowTokenFallback] = useState(false)

  // onDone is fired from the IntegrationsPanel's wp_oauth handler when the
  // user lands back here after approving — this component just kicks off
  // the redirect, so the unused-prop lint stays satisfied.
  void onDone

  const canSubmitOneClick = siteUrl.trim().length > 3 && !loading
  const canSubmitToken = token.trim().length > 20 && !loading

  function startOneClick(e: React.FormEvent) {
    e.preventDefault()
    const url = siteUrl.trim()
    if (!url) return
    // Hard nav so WP's Authorize-Application screen fully takes over the tab.
    // The OAuth callback drops the user back on /setup?wp_oauth=connected,
    // which the IntegrationsPanel detects and surfaces inline.
    window.location.href = `/api/wordpress/oauth-start?siteUrl=${encodeURIComponent(url)}`
  }

  async function handleTokenConnect() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/wordpress/connect-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: token.trim() }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Connection failed')
      onDone(data.siteUrl)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Connection failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <button onClick={onBack} className="inline-flex items-center gap-1.5 text-sm text-[#7C3AED] hover:opacity-75 mb-4">
          <ArrowLeft size={14} /> Back
        </button>
        <h2 className="text-xl font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">Connect your WordPress site</h2>
        <p className="text-sm text-[#6e6e73] dark:text-[#ebebf0] mb-4">
          Two steps: install our small plugin (so WordPress allows the redirect back to us), then click Connect. The plugin handles the bridge — you never type a password and never paste a token.
        </p>
      </div>

      {/* Step 1 — install the bridge plugin */}
      <div className="rounded-xl border border-blue-200 dark:border-blue-500/30 bg-blue-50/50 dark:bg-blue-500/5 p-5">
        <div className="flex items-center justify-between mb-2">
          <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Step 1 — Install MVP Affiliate plugin</p>
          <span className="text-[10px] font-semibold uppercase tracking-wider text-[#86868b]">Required once</span>
        </div>
        <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0] mb-3">
          WordPress blocks cross-site redirects by default — our plugin whitelists MVP so the one-click connect can work, then quietly powers theme, banner, and footer features.
        </p>
        <a href="/mvp-affiliate.zip" download="mvpaffiliate-platform.zip" className="btn-primary text-sm self-start inline-flex mb-3">
          <Download size={14} /> Download plugin
        </a>
        <ol className="text-xs text-[#6e6e73] dark:text-[#ebebf0] flex flex-col gap-1 list-decimal list-inside">
          <li>In your wp-admin: Plugins → Add New Plugin → Upload Plugin → choose the ZIP → Activate</li>
          <li>That&apos;s it. No menus to click, no settings to change. Move to Step 2 below.</li>
        </ol>
      </div>

      {/* Step 2 — one-click connect */}
      <div className="rounded-xl border border-blue-200 dark:border-blue-500/30 bg-blue-50/50 dark:bg-blue-500/5 p-5">
        <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">Step 2 — Connect WordPress</p>
        <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0] mb-3">
          Enter your site URL. We&apos;ll bounce you to <code className="text-[10px] bg-white/60 dark:bg-white/10 px-1 py-0.5 rounded">wp-admin/authorize-application.php</code> — WordPress&apos;s own permission screen. Click &ldquo;Yes, I approve&rdquo; and you&apos;ll land back here connected.
        </p>
        <form onSubmit={startOneClick} className="flex items-center gap-2">
          <input
            type="url"
            value={siteUrl}
            onChange={e => setSiteUrl(e.target.value)}
            placeholder="https://yoursite.com"
            className="input-field text-sm flex-1"
            autoComplete="url"
            inputMode="url"
          />
          <button type="submit" disabled={!canSubmitOneClick} className="btn-primary text-sm whitespace-nowrap">
            <Link2 size={14} /> Connect WordPress
          </button>
        </form>
        <p className="text-[11px] text-[#86868b] dark:text-[#8e8e93] mt-2">
          You&apos;ll need to be signed in to your WordPress admin in the same browser (or you&apos;ll be prompted to log in there once).
        </p>
      </div>

      {/* Fallback — Connection Token paste (collapsed) */}
      <div>
        <button
          type="button"
          onClick={() => setShowTokenFallback(v => !v)}
          className="text-xs text-[#6e6e73] dark:text-[#8e8e93] hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7] transition-colors"
        >
          {showTokenFallback ? '− Hide advanced' : '+ Use Connection Token instead (advanced — for sites that block Application Passwords)'}
        </button>

        {showTokenFallback && (
          <div className="mt-3 rounded-xl border border-gray-200 dark:border-white/10 bg-[var(--surface-2)] p-5">
            <p className="text-xs font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">Connection Token (legacy plugin flow)</p>
            <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0] mb-3">
              Install our plugin, generate a token in wp-admin, paste it here. Only needed if your host blocks WordPress&apos;s built-in Application Passwords.
            </p>
            <a href="/mvp-affiliate.zip" download="mvpaffiliate-platform.zip" className="btn-secondary text-xs self-start inline-flex mb-3">
              <Download size={12} /> Download plugin ZIP
            </a>
            <ol className="text-xs text-[#6e6e73] dark:text-[#ebebf0] flex flex-col gap-1 list-decimal list-inside mb-3">
              <li>wp-admin → Plugins → Add New → Upload Plugin → choose the ZIP → Activate</li>
              <li>Click the new <strong>MVP Affiliate</strong> sidebar item → <strong>Generate Connection Token</strong></li>
              <li>Paste the token below</li>
            </ol>
            <textarea
              value={token}
              onChange={e => setToken(e.target.value)}
              placeholder="eyJ1cmwiOiJodHRwczovL... (paste full token here)"
              rows={3}
              className="input-field font-mono text-xs resize-y"
            />
            {error && (
              <p className="text-sm text-[#ff3b30] bg-[#ff3b30]/5 border border-[#ff3b30]/20 rounded-lg px-3 py-2 mt-2">{error}</p>
            )}
            <button onClick={handleTokenConnect} disabled={!canSubmitToken} className="btn-secondary text-sm self-start mt-3">
              {loading ? <><Loader2 size={14} className="animate-spin" /> Verifying…</> : <><Link2 size={14} /> Connect with token</>}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Step 1 ───────────────────────────────────────────────────────────────────
function Step1({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  return (
    <div className="flex flex-col gap-6">
      <button onClick={onBack} className="inline-flex items-center gap-1.5 text-sm text-[#7C3AED] hover:opacity-75 self-start">
        <ArrowLeft size={14} /> Back
      </button>
      <div>
        <div className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-[#86868b] dark:text-[#8e8e93] mb-2">
          <span className="w-1.5 h-1.5 rounded-full bg-[#7C3AED]" />
          Step 1 of 4 · ~10 min · you&apos;ll leave this page
        </div>
        <h2 className="text-xl font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">Get hosting + a domain</h2>
        <p className="text-sm text-[#6e6e73] dark:text-[#ebebf0]">
          Your blog needs to live somewhere. Hostinger is what we recommend — under $3/month, a free domain for year one, and <strong>20% off through our link</strong>.
        </p>
      </div>

      {/* Big primary CTA */}
      <div className="card p-5 border border-[#7C3AED]/20 bg-[#7C3AED]/3">
        <div className="flex items-start gap-4">
          <div className="w-10 h-10 rounded-xl bg-[#7C3AED]/10 flex items-center justify-center flex-shrink-0">
            <Globe size={20} className="text-[#7C3AED]" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-0.5">Sign up for Hostinger</p>
            <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0] mb-3">
              <strong className="text-[#7C3AED]">20% off through our link</strong> · free domain (year one) · 1-click WordPress installer · fast SSD hosting · free SSL.
            </p>
            <a href="https://geni.us/MVPhosting" target="_blank" rel="noopener noreferrer" className="btn-primary text-sm">
              Sign up for Hostinger — 20% off → <ExternalLink size={13} />
            </a>
          </div>
        </div>
      </div>

      {/* Pick this exact plan — opinionated picker so users don't get lost on the Hostinger pricing page */}
      <div className="bg-[#f5f5f7] dark:bg-[#000] rounded-xl p-5">
        <p className="text-xs font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-3">Pick this exact plan:</p>
        <div className="flex flex-col gap-2">
          <div className="flex items-start gap-2 p-2 rounded-lg bg-[#34c759]/5 border border-[#34c759]/20">
            <Check size={14} className="text-[#34c759] flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-xs font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Premium plan — $2.99/mo</p>
              <p className="text-[11px] text-[#6e6e73] dark:text-[#ebebf0]">The sweet spot. Free domain, 100 sites, unmetered bandwidth.</p>
            </div>
          </div>
          <div className="flex items-start gap-2 p-2 rounded-lg">
            <X size={14} className="text-[#86868b] flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-xs font-medium text-[#86868b] dark:text-[#8e8e93]">Single plan — too restricted (no email, 1 site only)</p>
            </div>
          </div>
          <div className="flex items-start gap-2 p-2 rounded-lg">
            <X size={14} className="text-[#86868b] flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-xs font-medium text-[#86868b] dark:text-[#8e8e93]">Business plan — overkill, upgrade later if you need it</p>
            </div>
          </div>
        </div>
      </div>

      {/* While-you're-there checklist — keeps the user from making expensive mistakes */}
      <div className="bg-[#f5f5f7] dark:bg-[#000] rounded-xl p-5">
        <p className="text-xs font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-3">While you&apos;re there, do these 3 things:</p>
        <ol className="flex flex-col gap-3">
          <li className="flex items-start gap-3">
            <span className="w-5 h-5 rounded-full bg-[#7C3AED]/10 text-[#7C3AED] text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">1</span>
            <div className="flex-1">
              <p className="text-xs font-medium text-[#1d1d1f] dark:text-[#f5f5f7]">Pick your domain name</p>
              <p className="text-[11px] text-[#6e6e73] dark:text-[#ebebf0] mt-0.5">Short, easy to spell, no hyphens. Hostinger gives you one free for year one.</p>
            </div>
          </li>
          <li className="flex items-start gap-3">
            <span className="w-5 h-5 rounded-full bg-[#7C3AED]/10 text-[#7C3AED] text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">2</span>
            <div className="flex-1">
              <p className="text-xs font-medium text-[#1d1d1f] dark:text-[#f5f5f7]">Pay for 24 or 48 months</p>
              <p className="text-[11px] text-[#6e6e73] dark:text-[#ebebf0] mt-0.5">The $2.99 price only holds on multi-year. The 12-month plan jumps to $11/mo at renewal.</p>
            </div>
          </li>
          <li className="flex items-start gap-3">
            <span className="w-5 h-5 rounded-full bg-[#7C3AED]/10 text-[#7C3AED] text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">3</span>
            <div className="flex-1">
              <p className="text-xs font-medium text-[#1d1d1f] dark:text-[#f5f5f7]"><Lock size={11} className="inline -mt-0.5 mr-1 text-[#7C3AED]" />Save these 2 things in your password manager BEFORE closing the Hostinger tab:</p>
              <ul className="text-[11px] text-[#6e6e73] dark:text-[#ebebf0] mt-1 ml-2 flex flex-col gap-0.5">
                <li>• Your Hostinger account password</li>
                <li>• Your domain name (you&apos;ll type it in Step 3)</li>
              </ul>
            </div>
          </li>
        </ol>
      </div>

      <div className="flex items-center gap-3">
        <button onClick={onNext} className="btn-primary">Done — I have hosting <ChevronRight size={15} /></button>
        <p className="text-xs text-[#86868b] dark:text-[#8e8e93]">Already have hosting elsewhere? Skip ahead.</p>
      </div>
    </div>
  )
}

// ─── Step 2 ───────────────────────────────────────────────────────────────────
function Step2({ onNext }: { onNext: () => void }) {
  return (
    <div className="flex flex-col gap-8">
      <div>
        <div className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-[#86868b] dark:text-[#8e8e93] mb-2">
          <span className="w-1.5 h-1.5 rounded-full bg-[#7C3AED]" />
          Step 2 of 4 · ~5 min · in Hostinger&apos;s control panel
        </div>
        <h2 className="text-xl font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">Install WordPress</h2>
        <p className="text-sm text-[#6e6e73] dark:text-[#ebebf0]">
          WordPress is the software your blog runs on. Hostinger installs it for you in a few clicks.
        </p>
      </div>

      {/* Open hPanel — primary action */}
      <div className="card p-5 border border-[#7C3AED]/20 bg-[#7C3AED]/3">
        <div className="flex items-start gap-4">
          <div className="w-10 h-10 rounded-xl bg-[#7C3AED]/10 flex items-center justify-center flex-shrink-0">
            <Wrench size={20} className="text-[#7C3AED]" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-0.5">Open hPanel</p>
            <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0] mb-3">
              hPanel = Hostinger&apos;s control panel. Think of it as the behind-the-scenes settings page for your site.
            </p>
            <a href="https://hpanel.hostinger.com" target="_blank" rel="noopener noreferrer" className="btn-primary text-sm">
              Open hPanel → <ExternalLink size={13} />
            </a>
          </div>
        </div>
      </div>

      {/* Follow these clicks — numbered steps inside hPanel */}
      <div className="flex flex-col gap-3">
        <p className="text-xs font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] uppercase tracking-wider">Follow these 5 clicks:</p>
        {[
          { title: 'Sign in to hPanel', desc: 'Use the password you saved in Step 1.' },
          { title: 'Click "Websites" in the top nav', desc: 'Then click your domain name.' },
          { title: 'Click "Auto Installer" → WordPress', desc: 'Hostinger&apos;s 1-click WordPress installer.' },
          {
            title: 'Fill in 3 fields',
            desc: 'Site name (anything — change later). Admin email (yours). Admin password: click Generate.',
            highlight: true,
            highlightContent: (
              <div className="flex items-start gap-2 mt-2 p-2.5 rounded-lg bg-[#7C3AED]/10 border border-[#7C3AED]/20">
                <Lock size={13} className="text-[#7C3AED] flex-shrink-0 mt-0.5" />
                <p className="text-[11px] text-[#1d1d1f] dark:text-[#f5f5f7] leading-relaxed">
                  <strong>Save the admin password in your password manager BEFORE clicking anywhere else.</strong>{' '}
                  This is the password for your WordPress admin — losing it means reinstalling WordPress.
                </p>
              </div>
            ),
          },
          { title: 'Click "Install" and wait 1-2 min', desc: 'Green ✓ when done.' },
        ].map(({ title, desc, highlight, highlightContent }, i) => (
          <div key={i} className={`flex items-start gap-4 p-4 rounded-xl ${highlight ? 'bg-[#7C3AED]/5 border border-[#7C3AED]/15' : 'bg-[#f5f5f7] dark:bg-[#000]'}`}>
            <span className="w-6 h-6 rounded-full bg-[#1d1d1f] text-white text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">{i + 1}</span>
            <div className="flex-1">
              <p className="text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7] mb-0.5">{title}</p>
              <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0]">{desc}</p>
              {highlightContent}
            </div>
          </div>
        ))}
      </div>

      {/* Part 2 — install the MVP plugin + generate the connection token.
          Same screen as the WordPress install above so the user can do both
          back-to-back without losing flow. Split with a clear separator so
          they know it's a distinct task. */}
      <div className="border-t border-gray-200 dark:border-white/10 pt-6 -mt-2">
        <div className="mb-4">
          <p className="text-xs font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] uppercase tracking-wider mb-1">Now connect it to MVP (~3 min)</p>
          <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0]">
            Two clicks: install our plugin into the WordPress you just installed, then generate a token. The plugin handles theme, layout, banners, footer — everything else is automatic.
          </p>
        </div>

        {/* DNS sanity check — important to surface NOW, not at launch */}
        <div className="rounded-xl border border-amber-200 dark:border-amber-500/30 bg-amber-50/50 dark:bg-amber-500/5 p-3 mb-4 flex items-start gap-2">
          <Clock size={14} className="text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
          <p className="text-[11px] text-[#6e6e73] dark:text-[#ebebf0] leading-relaxed">
            <strong>Before continuing:</strong> visit your domain in a browser. If it shows a Hostinger placeholder (not a &ldquo;DNS propagating&rdquo; or &ldquo;site not found&rdquo; page), you&apos;re good. If not, give it 15-30 min and refresh — DNS sometimes takes a beat after install.
          </p>
        </div>

        {/* Download */}
        <div className="p-4 rounded-xl bg-[#f5f5f7] dark:bg-[#000] mb-3">
          <p className="text-xs font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-2">Download the plugin (10 sec)</p>
          <a href="/mvp-affiliate.zip" download="mvpaffiliate-platform.zip" className="btn-primary text-sm inline-flex">
            <Download size={14} /> Download mvpaffiliate-platform.zip
          </a>
        </div>

        {/* Install steps */}
        <div className="p-4 rounded-xl bg-[#f5f5f7] dark:bg-[#000] mb-3">
          <p className="text-xs font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-3">Install &amp; activate (90 sec)</p>
          <ol className="flex flex-col gap-2">
            {[
              <>Open your WordPress admin: <span className="font-mono text-[10px] bg-white/60 dark:bg-white/10 px-1 py-0.5 rounded">yourdomain.com/wp-admin</span></>,
              <>Log in with the admin password you saved in Step 2 above.</>,
              <><strong>Plugins</strong> → <strong>Add New Plugin</strong> → <strong>Upload Plugin</strong></>,
              <>Choose the ZIP → <strong>Install Now</strong> → <strong>Activate Plugin</strong></>,
              <>A new <strong>&ldquo;MVP Affiliate&rdquo;</strong> menu appears in the left sidebar → click it.</>,
            ].map((node, i) => (
              <li key={i} className="flex items-start gap-2.5">
                <span className="w-4 h-4 rounded-full bg-[#7C3AED]/10 text-[#7C3AED] text-[10px] font-bold flex items-center justify-center flex-shrink-0 mt-0.5">{i + 1}</span>
                <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0]">{node}</p>
              </li>
            ))}
          </ol>
        </div>

        {/* Generate token */}
        <div className="p-4 rounded-xl bg-[#f5f5f7] dark:bg-[#000]">
          <p className="text-xs font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-3">Generate your connection token (60 sec)</p>
          <ol className="flex flex-col gap-2">
            {[
              <>In the MVP Affiliate menu, click <strong>Install &amp; activate MVP Affiliate theme</strong> → wait 10 sec for the green ✓.</>,
              <>Click <strong>Generate Connection Token</strong> → a long string appears.</>,
              <><strong>Copy it</strong> — you&apos;ll paste it on the next screen.</>,
            ].map((node, i) => (
              <li key={i} className="flex items-start gap-2.5">
                <span className="w-4 h-4 rounded-full bg-[#7C3AED]/10 text-[#7C3AED] text-[10px] font-bold flex items-center justify-center flex-shrink-0 mt-0.5">{i + 1}</span>
                <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0]">{node}</p>
              </li>
            ))}
          </ol>
        </div>
      </div>

      <button onClick={onNext} className="btn-primary self-start">I have my token <ChevronRight size={15} /></button>
    </div>
  )
}

// ─── Step 3 ───────────────────────────────────────────────────────────────────
function Step3({ data, onChange, onNext }: { data: BrandData; onChange: (d: BrandData) => void; onNext: () => void }) {
  function set<K extends keyof BrandData>(key: K, val: BrandData[K]) {
    onChange({ ...data, [key]: val })
  }

  return (
    <div className="flex flex-col gap-7">
      <div>
        <div className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-[#86868b] dark:text-[#8e8e93] mb-2">
          <span className="w-1.5 h-1.5 rounded-full bg-[#7C3AED]" />
          Step 3 of 4 · optional · ~2 min
        </div>
        <h2 className="text-xl font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">Make it yours (optional)</h2>
        <p className="text-sm text-[#6e6e73] dark:text-[#ebebf0]">
          Logo, headshot, bio, social links. All fields are optional — skip anything you don&apos;t have yet and come back to add it from your Brand Profile after launch.
        </p>
      </div>

      <div className="flex flex-col gap-5 p-5 bg-[#f5f5f7] dark:bg-[#000] rounded-xl">
        <p className="text-xs font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] uppercase tracking-wider">Visuals</p>
        <ImageUpload label="Brand logo" hint="Square or circle — shown as your site favicon and in the footer." shape="square" value={data.logo} onChange={v => set('logo', v)} />
        <ImageUpload label="Your photo / headshot" hint="Used on your About page to put a face to the brand." shape="circle" value={data.headshot} onChange={v => set('headshot', v)} />
      </div>

      <div className="flex flex-col gap-4 p-5 bg-[#f5f5f7] dark:bg-[#000] rounded-xl">
        <p className="text-xs font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] uppercase tracking-wider">About you</p>
        <div>
          <label htmlFor="setup-about-text" className="block text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7] mb-1.5">About you / bio</label>
          <textarea id="setup-about-text" name="about-text" value={data.aboutText} onChange={e => set('aboutText', e.target.value)} placeholder="Tell your story. What do you review, why should people trust you, what makes your take different?" rows={5} className="input-field resize-none" />
        </div>
        <div>
          <label htmlFor="setup-contact-email" className="block text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7] mb-1.5">Contact email</label>
          <input id="setup-contact-email" name="contact-email" autoComplete="email" type="email" value={data.contactEmail} onChange={e => set('contactEmail', e.target.value)} placeholder="hello@yourdomain.com" className="input-field" />
          <p className="text-xs text-[#86868b] dark:text-[#8e8e93] mt-1">Shown on your About page and Privacy Policy.</p>
        </div>
      </div>

      <div className="flex flex-col gap-4 p-5 bg-[#f5f5f7] dark:bg-[#000] rounded-xl">
        <p className="text-xs font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] uppercase tracking-wider">Social links</p>
        <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0] -mt-2">Added to your site footer and About page.</p>
        {[
          { label: 'YouTube channel URL', key: 'youtubeUrl' as const, placeholder: 'https://youtube.com/@yourchannel' },
          { label: 'Instagram URL', key: 'instagramUrl' as const, placeholder: 'https://instagram.com/yourhandle' },
          { label: 'TikTok URL', key: 'tiktokUrl' as const, placeholder: 'https://tiktok.com/@yourhandle' },
          { label: 'Twitter / X URL', key: 'twitterUrl' as const, placeholder: 'https://x.com/yourhandle' },
          { label: 'Pinterest URL', key: 'pinterestUrl' as const, placeholder: 'https://pinterest.com/yourhandle' },
          { label: 'Facebook URL', key: 'facebookUrl' as const, placeholder: 'https://facebook.com/yourpage' },
        ].map(({ label, key, placeholder }) => (
          <div key={key}>
            <label htmlFor={`setup-${key}`} className="block text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7] mb-1.5">{label}</label>
            <input id={`setup-${key}`} name={key} autoComplete="url" type="url" value={data[key] as string} onChange={e => set(key, e.target.value)} placeholder={placeholder} className="input-field" />
          </div>
        ))}
      </div>

      <button onClick={onNext} className="btn-primary self-start">Continue <ChevronRight size={15} /></button>
    </div>
  )
}

// ─── Step 4 ───────────────────────────────────────────────────────────────────
function Step4({
  brandData, siteUrl, setSiteUrl, username, setUsername, accentColor, setAccentColor, onNext,
}: {
  brandData: BrandData
  siteUrl: string; setSiteUrl: (v: string) => void
  username: string; setUsername: (v: string) => void
  accentColor: string; setAccentColor: (v: string) => void
  onNext: (url: string) => void
}) {
  const [token, setToken] = useState('')
  const [customHex, setCustomHex] = useState('')
  const [loading, setLoading] = useState(false)
  const [loadingStep, setLoadingStep] = useState('')
  const [error, setError] = useState<string | null>(null)

  const activeColor = customHex.match(/^#[0-9a-fA-F]{6}$/) ? customHex : accentColor
  const canSubmit = token.trim().length > 20 && !loading

  async function handleLaunch() {
    setLoading(true); setError(null); setLoadingStep('Verifying connection token…')
    try {
      // Step 1 — exchange token for stored credentials
      const connectRes = await fetch('/api/wordpress/connect-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: token.trim() }),
      })
      const connectData = await connectRes.json()
      if (!connectRes.ok) throw new Error(connectData.error || 'Token verification failed')
      const connectedUrl = connectData.siteUrl as string
      const connectedUsername = connectData.username as string
      setSiteUrl(connectedUrl)
      setUsername(connectedUsername)

      // Step 2 — kick off the full site setup (brand customizations, social links, etc.)
      setLoadingStep('Setting up your site…')
      const res = await fetch('/api/wordpress/connect-and-setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          siteUrl: connectedUrl,
          username: connectedUsername,
          // Credentials are already stored, but the route still expects them on the
          // request body. We don't have access to the raw password here, so we ask
          // the route to read them from the integrations table by passing token: true.
          fromToken: true,
          accentColor: activeColor,
          logoBase64: brandData.logo?.base64, logoMime: brandData.logo?.mime, logoFilename: brandData.logo?.filename,
          headshotBase64: brandData.headshot?.base64, headshotMime: brandData.headshot?.mime, headshotFilename: brandData.headshot?.filename,
          aboutText: brandData.aboutText || undefined, contactEmail: brandData.contactEmail || undefined,
          youtubeUrl: brandData.youtubeUrl || undefined, instagramUrl: brandData.instagramUrl || undefined,
          tiktokUrl: brandData.tiktokUrl || undefined, twitterUrl: brandData.twitterUrl || undefined,
          pinterestUrl: brandData.pinterestUrl || undefined, facebookUrl: brandData.facebookUrl || undefined,
        }),
      })
      const raw = await res.text()
      let data: Record<string, string> = {}
      try { data = JSON.parse(raw) } catch { throw new Error(`Server returned unexpected response: ${raw.slice(0, 300)}`) }
      if (!res.ok) throw new Error(data.error || 'Setup failed')
      onNext(connectedUrl)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Setup failed. Check your connection token.')
    } finally {
      setLoading(false); setLoadingStep('')
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <div className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-[#86868b] dark:text-[#8e8e93] mb-2">
          <span className="w-1.5 h-1.5 rounded-full bg-[#7C3AED]" />
          Step 4 of 4 · ~1 min · fully automatic
        </div>
        <h2 className="text-xl font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">Launch your blog</h2>
        <p className="text-sm text-[#6e6e73] dark:text-[#ebebf0]">
          Paste your token, pick a brand color, hit Launch. We build your homepage, About page, Privacy page, sidebar and footer in about 60 seconds.
        </p>
      </div>

      <div className="flex flex-col gap-4">
        <div className="rounded-xl border border-blue-200 dark:border-blue-500/30 bg-blue-50/50 dark:bg-blue-500/5 p-4">
          <div className="flex items-center gap-2 mb-2">
            <Lock size={14} className="text-[#7C3AED] flex-shrink-0" />
            <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Paste your Connection Token</p>
          </div>
          <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0] leading-relaxed">
            Get your token from <strong>wp-admin → MVP Affiliate → Generate Connection Token</strong>. The token contains your site URL, username, and a secure Application Password — paste it below and we&apos;ll handle the rest.
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7] mb-1.5">Connection Token</label>
          <textarea
            value={token}
            onChange={e => setToken(e.target.value)}
            placeholder="eyJ1cmwiOiJodHRwczovL... (paste full token here)"
            rows={4}
            className="input-field font-mono text-xs resize-y"
          />
          <p className="text-xs text-[#86868b] dark:text-[#8e8e93] mt-1">A long base64 string. Don&apos;t worry about line breaks — paste it however WordPress copied it.</p>
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7] mb-3">Accent color</label>
        <div className="flex flex-wrap gap-2.5 mb-3">
          {PRESET_COLORS.map(c => (
            <button key={c.hex} title={c.label} onClick={() => { setAccentColor(c.hex); setCustomHex('') }}
              className="w-8 h-8 rounded-full border-2 transition-all"
              style={{ backgroundColor: c.hex, borderColor: accentColor === c.hex && !customHex.match(/^#[0-9a-fA-F]{6}$/) ? '#1d1d1f' : 'transparent', boxShadow: accentColor === c.hex && !customHex.match(/^#[0-9a-fA-F]{6}$/) ? `0 0 0 2px white, 0 0 0 4px ${c.hex}` : 'none' }} />
          ))}
        </div>
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-full border border-gray-200 dark:border-white/10 flex-shrink-0" style={{ backgroundColor: activeColor }} />
          <input type="text" value={customHex} onChange={e => setCustomHex(e.target.value)} placeholder="Custom hex e.g. #e63946" className="input-field max-w-[190px] font-mono text-sm" />
          <span className="text-xs font-bold uppercase tracking-widest px-3 py-1 rounded-full text-white flex-shrink-0" style={{ backgroundColor: activeColor }}>Preview</span>
        </div>
      </div>

      {error && (
        <p className="text-sm text-[#ff3b30] bg-[#ff3b30]/5 border border-[#ff3b30]/20 rounded-lg px-3 py-2">{error}</p>
      )}

      <div className="flex items-center gap-3">
        <button onClick={handleLaunch} disabled={!canSubmit} className="btn-primary">
          {loading ? <><Loader2 size={15} className="animate-spin" /> {loadingStep}</> : <><Sparkles size={15} /> Launch my site</>}
        </button>
        {!loading && <p className="text-xs text-[#86868b] dark:text-[#8e8e93]">~20 seconds</p>}
      </div>
    </div>
  )
}

// ─── Step 5 ───────────────────────────────────────────────────────────────────
function Step5({ wordpressUrl, accentColor }: { wordpressUrl: string; accentColor: string }) {
  const router = useRouter()
  return (
    <div className="flex flex-col items-center gap-5 py-6 text-center">
      <div className="w-16 h-16 rounded-full flex items-center justify-center" style={{ backgroundColor: `${accentColor}25` }}>
        <CheckCircle size={32} style={{ color: accentColor }} />
      </div>
      <div>
        <h2 className="text-xl font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">Your review site is live</h2>
        <p className="text-sm text-[#6e6e73] dark:text-[#ebebf0]">
          Homepage, About, Privacy and navigation are all wired up at{' '}
          <a href={wordpressUrl} target="_blank" rel="noopener noreferrer" className="text-[#7C3AED] hover:underline font-medium">{wordpressUrl}</a>. Now head to YouTube Co-Pilot and generate your first review.
        </p>
      </div>
      <div className="bg-[#f5f5f7] dark:bg-[#000] rounded-xl p-4 text-left w-full max-w-md">
        <p className="text-xs font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-2">What&apos;s next:</p>
        <ul className="text-xs text-[#6e6e73] dark:text-[#ebebf0] space-y-1.5 list-disc list-inside">
          <li>Finish your Brand Profile — tone, writing sample, CTA style</li>
          <li>Connect your YouTube channel below</li>
          <li>Come back to Content and generate your first post</li>
        </ul>
      </div>
      <div className="flex gap-3">
        <a href={wordpressUrl} target="_blank" rel="noopener noreferrer" className="btn-secondary">View site <ExternalLink size={13} /></a>
        <button onClick={() => router.push('/brand')} className="btn-primary">Set up brand profile <ChevronRight size={15} /></button>
      </div>
    </div>
  )
}


/* Danger zone — disconnect WordPress and re-run the guided onboarding funnel
   from step 1. Two-step confirm (no destructive single click). Posts to
   /api/onboarding/restart (clears WP + resets the funnel + drops multi-site
   rows), then full-navigates to /onboarding so the gate + funnel reload clean. */
function DisconnectRestart() {
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)

  async function run() {
    setBusy(true)
    try {
      const res = await fetch('/api/onboarding/restart', { method: 'POST' })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        toast.error(d.error || 'Could not restart setup. Try again.')
        setBusy(false)
        return
      }
      try { localStorage.removeItem(STORAGE_KEY) } catch { /* ignore */ }
      toast.success('WordPress disconnected — restarting setup…')
      window.location.href = '/onboarding'
    } catch {
      toast.error('Something went wrong. Try again.')
      setBusy(false)
    }
  }

  return (
    <div className="card p-5 border border-[#ff3b30]/25">
      <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Disconnect &amp; start over</p>
      <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0] mt-0.5 leading-relaxed mb-3">
        Disconnect this WordPress site and go back through the guided setup from step&nbsp;1. Your YouTube, Brand Profile, voice training and face models are kept — only the WordPress connection is reset.
      </p>
      {!confirming ? (
        <button
          onClick={() => setConfirming(true)}
          className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-[#ff3b30] border border-[#ff3b30]/30 hover:bg-[#ff3b30]/10 transition-colors"
        >
          <LogOut size={12} /> Disconnect WordPress &amp; restart setup
        </button>
      ) : (
        <div className="flex items-center gap-2">
          <button
            onClick={run}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-white bg-[#ff3b30] hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            {busy && <Loader2 size={12} className="animate-spin" />} Yes, disconnect &amp; restart
          </button>
          <button
            onClick={() => setConfirming(false)}
            disabled={busy}
            className="text-xs text-[#6e6e73] dark:text-[#8e8e93] hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7] transition-colors"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  )
}

// ─── Wizard shell ─────────────────────────────────────────────────────────────
function SetupPageInner() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const [tab] = useState<'wordpress' | 'integrations'>(
    searchParams.get('tab') === 'integrations' ? 'integrations' : 'wordpress'
  )

  // RETIRED: the legacy /setup?tab=integrations tab. Everything it held now
  // has a proper home — socials on /connect-socials, Google Search Console +
  // Geniuslink on /brand, YouTube on /connect-youtube, the multi-site manager
  // on the /setup "connected" view. OAuth callbacks were all repointed; this
  // bounce catches any stale bookmark or link so the dead tab never renders.
  useEffect(() => {
    if (searchParams.get('tab') === 'integrations') router.replace('/connect-socials')
  }, [searchParams, router])

  // Scroll-to-hash for in-page anchors like #social-platforms (the
  // sidebar's "Connect Socials" entry uses this). Next App Router
  // doesn't fire native hash scroll when the tab change re-mounts the
  // integrations content, so we wait a tick for the section to paint,
  // then scrollIntoView ourselves. Runs whenever the tab settles.
  useEffect(() => {
    if (tab !== 'integrations') return
    const hash = typeof window === 'undefined' ? '' : window.location.hash.slice(1)
    if (!hash) return
    // RAF + small timeout gives React a chance to render the
    // integrations subtree before we look up the target element.
    const id = setTimeout(() => {
      const el = document.getElementById(hash)
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 80)
    return () => clearTimeout(id)
  }, [tab])
  const [mode, setMode] = useState<Mode>(null)
  const [step, setStep] = useState<Step>(1)
  const [wordpressUrl, setWordpressUrl] = useState('')
  const [accentColor, setAccentColor] = useState('#f5a623')
  const [siteUrl, setSiteUrl] = useState('')
  const [username, setUsername] = useState('')
  const [brandData, setBrandData] = useState<BrandData>(defaultBrand)
  const [hydrated, setHydrated] = useState(false)
  const [setupComplete, setSetupComplete] = useState(false)
  // When true, /setup ignores `setupComplete` and shows the wizard view even
  // for users with a connected site — used by the manager view's "Start wizard"
  // button so a Pro user can walk a SECOND brand-new blog through the same
  // wizard without nuking their existing default site.
  const [forceWizard, setForceWizard] = useState(false)
  const [completedUrl, setCompletedUrl] = useState('')
  const supabase = createBrowserClient()

  useEffect(() => {
    async function init() {
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (user) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          // Only select `wordpress_url`. An older code path also selected
          // `wp_site_url` which doesn't exist on the integrations table —
          // PG returned a column-not-found error, the whole query failed,
          // and `connectedUrl` was always undefined, so the setup page
          // showed the wizard even when wordpress_url was set.
          const { data: intRow } = await supabase.from('integrations').select('wordpress_url').eq('user_id', user.id).single()
          const connectedUrl = intRow?.wordpress_url
          if (connectedUrl) {
            setSetupComplete(true)
            setCompletedUrl(connectedUrl)
            setHydrated(true)
            return
          }
        }
      } catch { /* ignore */ }

      try {
        const raw = localStorage.getItem(STORAGE_KEY)
        if (raw) {
          const d = JSON.parse(raw)
          // If localStorage says we're connected, trust it as a fallback
          if (d.setupComplete && d.completedUrl) {
            setSetupComplete(true)
            setCompletedUrl(d.completedUrl)
            setHydrated(true)
            return
          }
          if (d.mode) setMode(d.mode as Mode)
          if (d.step && d.step < 5) setStep(d.step as Step)
          if (d.brandData) setBrandData(d.brandData)
          if (d.siteUrl) setSiteUrl(d.siteUrl)
          if (d.username) setUsername(d.username)
          if (d.accentColor) setAccentColor(d.accentColor)
          if (d.wordpressUrl) setWordpressUrl(d.wordpressUrl)
        }
      } catch { /* ignore */ }
      setHydrated(true)
    }
    init()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!hydrated) return
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ mode, step, brandData, siteUrl, username, accentColor, wordpressUrl, setupComplete, completedUrl }))
    } catch { /* ignore */ }
  }, [mode, step, brandData, siteUrl, username, accentColor, wordpressUrl, setupComplete, completedUrl, hydrated])

  // ── One-click OAuth landing handler ──────────────────────────────────────
  // After the user approves on WordPress, /api/wordpress/oauth-callback
  // redirects back here with `?wp_oauth=connected`. The parent's init()
  // only fires on mount and may have run before the OAuth round-trip wrote
  // wordpress_url to the DB — leaving setupComplete=false and the wizard
  // showing despite a successful connect. Watch for the callback param,
  // re-fetch the connection state, clear any stale `mode: existing` from
  // localStorage so the connected card renders instead of the wizard.
  useEffect(() => {
    const wpOauth = searchParams.get('wp_oauth')
    if (wpOauth !== 'connected' && wpOauth !== 'connected_warn_host') return
    let cancelled = false
    ;(async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: intRow } = await supabase
          .from('integrations')
          .select('wordpress_url')
          .eq('user_id', user.id)
          .single()
        const connectedUrl = intRow?.wordpress_url
        if (cancelled || !connectedUrl) return
        setSetupComplete(true)
        setCompletedUrl(connectedUrl)
        setMode(null)   // clear any in-progress wizard mode
        setStep(1)
      } catch { /* ignore — init() will eventually catch up */ }
    })()
    return () => { cancelled = true }
  }, [searchParams, supabase])

  async function handleReset() {
    // Clear Supabase wordpress_url so refresh doesn't re-detect as connected
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await supabase.from('integrations').update({
          wordpress_url: null,
          wordpress_username: null,
          wordpress_app_password: null,
          wordpress_api_token: null,
        }).eq('user_id', user.id)
      }
    } catch { /* ignore */ }
    try { localStorage.removeItem(STORAGE_KEY) } catch { /* ignore */ }
    setSetupComplete(false); setCompletedUrl(''); setMode(null); setStep(1); setBrandData(defaultBrand)
    setSiteUrl(''); setUsername(''); setAccentColor('#f5a623'); setWordpressUrl('')
  }

  if (!hydrated) return null


  // ── Legacy Integrations tab — RETIRED ───────────────────────────────────────
  // Render nothing while the effect above redirects to /connect-socials. The
  // old panel (socials / YouTube / affiliate / multi-site) lives on its proper
  // pages now and must never be shown here.
  if (tab === 'integrations') return null

  // ── Already connected — Manager view ──────────────────────────────────────
  // Surfaces the multi-site manager, connection doctor, brand customizations
  // shortcut, and "Add another site" CTA in one clean view. Replaces the old
  // tiny "WordPress connected" card buried inside the Integrations tab.
  if (setupComplete && !forceWizard) {
    return (
      <div className="max-w-2xl mx-auto space-y-4">
        <div className="mb-2">
          <h1 className="text-2xl font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] tracking-tight">Blog Set Up</h1>
          <p className="text-sm text-[#6e6e73] dark:text-[#ebebf0] mt-0.5">
            Your WordPress sites, connection health, and publishing settings.
          </p>
        </div>

        {/* Primary status — current default site at a glance */}
        <div className="card p-5">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-[#34c759]/10 flex items-center justify-center flex-shrink-0">
              <CheckCircle size={18} className="text-[#34c759]" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Your blog is live and connected</p>
              <p className="text-xs text-[#86868b] dark:text-[#8e8e93] truncate mt-0.5">{completedUrl || 'Ready to publish.'}</p>
            </div>
            {completedUrl && (
              <a href={completedUrl} target="_blank" rel="noopener noreferrer" className="btn-secondary text-xs flex-shrink-0">
                Visit blog <ExternalLink size={11} />
              </a>
            )}
          </div>
        </div>

        {/* Multi-site manager — Pro feature. List of all connected sites with
            add/edit/delete/set-default controls. Was previously hidden inside
            the Integrations tab; promoted here as the primary content of /setup
            for returning users. */}
        <WordPressSitesManager />

        {/* Connection doctor — pinpoints security plugins / firewalls blocking
            writes. Surfaced here so users self-serve when posting breaks. */}
        <div className="card p-5 flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Posting trouble?</p>
            <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0] mt-0.5 leading-relaxed">
              Run the connection doctor — it pinpoints the exact plugin, firewall, or CDN rule blocking writes and gives you click-by-click fix steps.
            </p>
          </div>
          <a href="/setup/wp-doctor" className="btn-secondary text-xs flex-shrink-0">
            Run doctor →
          </a>
        </div>

        {/* Brand customizations shortcut — your logo/headshot/social links
            are part of the brand profile, but get pushed to your WordPress
            site on every publish. Surface the link so users know where to
            edit them. */}
        <div className="card p-5 flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Brand customizations</p>
            <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0] mt-0.5 leading-relaxed">
              Logo, headshot, About bio, contact email, social links — all live in your Brand Profile and push to your default WordPress site on every save.
            </p>
          </div>
          <a href="/brand" className="btn-secondary text-xs flex-shrink-0">
            Edit brand →
          </a>
        </div>

        {/* Hosting recommendation — the wizard's Hostinger CTA isn't shown once
            a site is connected, so returning users (e.g. spinning up a 2nd blog)
            never see it. Surface it here as a clear recommendation. Affiliate
            link (geni.us/MVPhosting). */}
        <div className="card p-5 flex items-start gap-3 border border-[#7C3AED]/30 bg-[#7C3AED]/[0.04]">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Need hosting for a new blog? <span className="text-[#7C3AED]">Save 20%</span></p>
            <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0] mt-0.5 leading-relaxed">
              We recommend <strong>Hostinger</strong> — under $3/month, a free domain for year one, and a 1-click WordPress installer. <strong>20% off through our link.</strong> It&apos;s exactly what MVP is built to publish to.
            </p>
          </div>
          <a href="https://geni.us/MVPhosting" target="_blank" rel="noopener noreferrer" className="btn-primary text-xs flex-shrink-0 inline-flex items-center gap-1.5">
            Get Hostinger — 20% off <ExternalLink size={13} />
          </a>
        </div>

        {/* Footnote — for the rare user who wants to build ANOTHER brand-new
            blog from scratch (Hostinger sign-up → install). Most "add a
            site" cases are handled by WordPressSitesManager's own
            "+ Add another site" modal above (paste a token from a live
            site). Kept as a small text link instead of a CTA card so it
            doesn&apos;t compete with the primary add flow. */}
        <p className="text-xs text-[#86868b] dark:text-[#8e8e93] text-center pt-2">
          Setting up a brand-new blog from scratch?{' '}
          <button
            onClick={() => { setForceWizard(true); setMode(null); setStep(1) }}
            className="text-[#7C3AED] hover:underline font-medium"
          >
            Run the full setup wizard →
          </button>
        </p>

        {/* Disconnect WordPress + restart the guided onboarding from step 1. */}
        <DisconnectRestart />
      </div>
    )
  }

  // ── Mode picker ────────────────────────────────────────────────────────────
  if (mode === null) {
    return (
      <div className="max-w-2xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] tracking-tight">Blog Set Up</h1>
          <p className="text-sm text-[#6e6e73] dark:text-[#ebebf0] mt-0.5">Get your WordPress affiliate blog running in a few minutes.</p>
        </div>
        <div className="card p-7">
          <ModePicker onSelect={setMode} />
        </div>
      </div>
    )
  }

  // ── Existing site connect flow ─────────────────────────────────────────────
  if (mode === 'existing') {
    return (
      <div className="max-w-2xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] tracking-tight">Blog Set Up</h1>
        </div>
        <div className="card p-7">
          <ExistingConnect
            onBack={() => setMode(null)}
            onDone={url => {
              setSetupComplete(true); setCompletedUrl(url)
              try { localStorage.removeItem(STORAGE_KEY) } catch { /* ignore */ }
            }}
          />
        </div>
      </div>
    )
  }

  // ── Full new-site wizard ───────────────────────────────────────────────────
  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] tracking-tight">Blog Set Up</h1>
        <p className="text-sm text-[#6e6e73] dark:text-[#ebebf0] mt-0.5">Get your WordPress affiliate blog running in a few minutes.</p>
      </div>

      <div className="flex items-center justify-between mb-2">
        <StepIndicator current={step} />
      </div>
      <div className="mb-4">
        <button onClick={() => { setMode(null); setStep(1) }} className="inline-flex items-center gap-1.5 text-xs text-[#86868b] dark:text-[#8e8e93] hover:text-[#7C3AED] transition-colors">
          <ArrowLeft size={12} /> Change setup type
        </button>
      </div>

      <div className="card p-7">
        {step === 1 && <Step1 onNext={() => setStep(2)} onBack={() => setMode(null)} />}
        {step === 2 && <Step2 onNext={() => setStep(3)} />}
        {step === 3 && <Step3 data={brandData} onChange={setBrandData} onNext={() => setStep(4)} />}
        {step === 4 && (
          <Step4
            brandData={brandData} siteUrl={siteUrl} setSiteUrl={setSiteUrl}
            username={username} setUsername={setUsername}
            accentColor={accentColor} setAccentColor={setAccentColor}
            onNext={url => { setWordpressUrl(url); setStep(5) }}
          />
        )}
        {step === 5 && <Step5 wordpressUrl={wordpressUrl} accentColor={accentColor} />}
      </div>
    </div>
  )
}

export default function SetupPage() {
  return (
    <Suspense>
      <SetupPageInner />
    </Suspense>
  )
}

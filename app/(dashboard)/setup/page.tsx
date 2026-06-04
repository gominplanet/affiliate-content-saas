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
import { metaEnabled, socialEnabled, type GatedSocialPlatform } from '@/lib/feature-flags'
import { Suspense } from 'react'
import { TutorialVideo } from '@/components/TutorialVideo'
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
        <a href="/mvpaffiliate-platform.zip" download="mvpaffiliate-platform.zip" className="btn-primary text-sm self-start inline-flex mb-3">
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
            <a href="/mvpaffiliate-platform.zip" download="mvpaffiliate-platform.zip" className="btn-secondary text-xs self-start inline-flex mb-3">
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
        <h2 className="text-xl font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">Create your Hostinger account</h2>
        <p className="text-sm text-[#6e6e73] dark:text-[#ebebf0]">
          Hostinger is where your affiliate blog will live. You&apos;ll get a domain and fast hosting for under $3/month.
        </p>
      </div>
      <div className="card p-5 border border-[#7C3AED]/20 bg-[#7C3AED]/3">
        <div className="flex items-start gap-4">
          <div className="w-10 h-10 rounded-xl bg-[#7C3AED]/10 flex items-center justify-center flex-shrink-0">
            <Globe size={20} className="text-[#7C3AED]" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-0.5">Hostinger Web Hosting</p>
            <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0] mb-3">
              Includes a free domain name, 1-click WordPress installer, fast SSD hosting, and free SSL.
              The <strong>Premium</strong> plan is the sweet spot.
            </p>
            <a href="https://geni.us/ANaArQ" target="_blank" rel="noopener noreferrer" className="btn-primary text-sm">
              Get Hostinger → <ExternalLink size={13} />
            </a>
          </div>
        </div>
      </div>
      <div className="bg-[#f5f5f7] dark:bg-[#000] rounded-xl p-5">
        <p className="text-xs font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-3">What to do on Hostinger:</p>
        <ol className="flex flex-col gap-3">
          {[
            'Click the link above and choose a hosting plan — Premium or Business recommended.',
            'During checkout, register a new domain name (included free for the first year).',
            'Complete payment and set up your account.',
            'Come back here — the next step will walk you through installing WordPress.',
          ].map((text, i) => (
            <li key={i} className="flex items-start gap-3">
              <span className="w-5 h-5 rounded-full bg-[#7C3AED]/10 text-[#7C3AED] text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">{i + 1}</span>
              <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0]">{text}</p>
            </li>
          ))}
        </ol>
      </div>
      <div className="flex items-center gap-3">
        <button onClick={onNext} className="btn-primary">I have a Hostinger account <ChevronRight size={15} /></button>
        <p className="text-xs text-[#86868b] dark:text-[#8e8e93]">Already signed up? Skip ahead.</p>
      </div>
    </div>
  )
}

// ─── Step 2 ───────────────────────────────────────────────────────────────────
function Step2({ onNext }: { onNext: () => void }) {
  return (
    <div className="flex flex-col gap-8">
      <div>
        <h2 className="text-xl font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">Install WordPress, theme &amp; plugins</h2>
        <p className="text-sm text-[#6e6e73] dark:text-[#ebebf0]">
          Complete all three sections below before moving on. Each one takes about 2 minutes.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        <p className="text-xs font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] uppercase tracking-wider">Part 1 — Install WordPress</p>
        {[
          { title: 'Log in to hPanel', desc: 'Go to hpanel.hostinger.com and sign in to your Hostinger account.', action: { label: 'Open hPanel', href: 'https://hpanel.hostinger.com' } },
          { title: 'Click "WordPress" in the sidebar', desc: 'In the left menu find the WordPress section and click it.' },
          { title: 'Click "Install"', desc: 'Hit Install and select your domain name from the dropdown.' },
          { title: 'Set your admin credentials', desc: 'Enter a username, your email, and a strong password. Write these down — you\'ll need them in the Launch step.' },
          { title: 'Click "Install" and wait ~2 minutes', desc: 'WordPress will install automatically. You\'ll see a success screen when done.' },
        ].map(({ title, desc, action }, i) => (
          <div key={i} className="flex items-start gap-4 p-4 rounded-xl bg-[#f5f5f7] dark:bg-[#000]">
            <span className="w-6 h-6 rounded-full bg-[#1d1d1f] text-white text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">{i + 1}</span>
            <div className="flex-1">
              <p className="text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7] mb-0.5">{title}</p>
              <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0]">{desc}</p>
            </div>
            {action && (
              <a href={action.href} target="_blank" rel="noopener noreferrer" className="btn-secondary text-xs px-3 py-1.5 flex-shrink-0">
                {action.label} <ExternalLink size={11} />
              </a>
            )}
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-3">
        <p className="text-xs font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] uppercase tracking-wider">Part 2 — Install the MVP Affiliate plugin</p>
        <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0]">
          One plugin handles everything: blog layout, banners, social bar, footer, and the connection back to this dashboard. Download it, upload to WordPress, activate. ~60 seconds total.
        </p>
        <div className="p-4 rounded-xl bg-[#f5f5f7] dark:bg-[#000] flex flex-col gap-3">
          <a href="/mvpaffiliate-platform.zip" download="mvpaffiliate-platform.zip" className="btn-primary text-sm self-start inline-flex">
            <Download size={14} /> Download MVP Affiliate plugin
          </a>
          <ol className="flex flex-col gap-2">
            {[
              'In your WordPress admin, go to Plugins → Add New Plugin → Upload Plugin.',
              'Choose the ZIP file you just downloaded and click Install Now.',
              'Click Activate Plugin once it finishes.',
              'You\'ll see a new "MVP Affiliate" menu appear in the sidebar — open it.',
              'Click Install & activate MVP Affiliate theme, then click Generate Connection Token.',
              'Copy the token — you\'ll paste it in the Launch step.',
            ].map((text, i) => (
              <li key={i} className="flex items-start gap-2.5">
                <span className="w-4 h-4 rounded-full bg-[#7C3AED]/10 text-[#7C3AED] text-[10px] font-bold flex items-center justify-center flex-shrink-0 mt-0.5">{i + 1}</span>
                <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0]">{text}</p>
              </li>
            ))}
          </ol>
          <p className="text-[11px] text-[#86868b] dark:text-[#8e8e93]">
            To get to wp-admin: visit <span className="font-mono">yourdomain.com/wp-admin</span> and log in with the credentials you set in Part 1.
          </p>
        </div>
      </div>

      <button onClick={onNext} className="btn-primary self-start">Plugin installed, token ready <ChevronRight size={15} /></button>
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
        <h2 className="text-xl font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">Customize your site</h2>
        <p className="text-sm text-[#6e6e73] dark:text-[#ebebf0]">
          This is what makes your blog feel like <em>yours</em>. All fields are optional — skip what you don&apos;t have yet.
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
        <h2 className="text-xl font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">Launch your review site</h2>
        <p className="text-sm text-[#6e6e73] dark:text-[#ebebf0]">One connection token, one brand color. We auto-install the MVP Affiliate theme + plugin, wire up the homepage, build your About + Privacy pages, and configure your sidebar + footer. About 60 seconds.</p>
      </div>

      <div className="bg-[#f5f5f7] dark:bg-[#000] rounded-xl p-5">
        <p className="text-xs font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-3">Before you launch — quick check:</p>
        <ul className="flex flex-col gap-2">
          {[
            'WordPress is installed and you can log in to wp-admin',
            'The MVP Affiliate plugin is installed and activated (from Step 2)',
            'You\'ve installed Kadence + generated your Connection Token from the MVP Affiliate menu',
            'Your domain is live — not just "DNS propagating" (can take up to 24h after signup)',
          ].map((item, i) => (
            <li key={i} className="flex items-start gap-2">
              <span className="text-[#34c759] mt-0.5 flex-shrink-0">✓</span>
              <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0]">{item}</p>
            </li>
          ))}
        </ul>
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

// ─── Manual Facebook token ────────────────────────────────────────────────────
// ─── Integrations panel (shown after WordPress is connected) ──────────────────
function IntegrationsPanel({ onLoad }: { onLoad: () => void }) {
  const supabase = createBrowserClient()
  const searchParams = useSearchParams()

  const [youtubeChannelId, setYoutubeChannelId] = useState('')
  // Meta cards are hidden from the public while under review, but shown to
  // admins + the reviewer test account (resolved from tier/email in load()).
  // Always true — the per-platform locks below are what actually gate the
  // Connect CTAs. Kept as state for backwards-compat with the three sites
  // below that wrap card chrome in {metaUnlocked && (...)}, but no longer
  // hides anything.
  const [metaUnlocked, setMetaUnlocked] = useState(true)
  // Per-platform admin gate for the FIVE social integrations the user wants
  // locked down (FB / IG / Threads / TikTok / Pinterest). Default to false
  // until load() resolves the user's tier + email; admin unlocks all five,
  // Meta App-Review reviewer email unlocks the three Meta ones.
  const [socialLocks, setSocialLocks] = useState<Record<GatedSocialPlatform, boolean>>({
    facebook: false, instagram: false, threads: false, tiktok: false, pinterest: false,
  })
  const isUnlocked = (p: GatedSocialPlatform) => socialLocks[p]
  // Style helper for the "coming soon" CTA — keeps the card visible but
  // mutes the connect button so users see the feature is on the way + why
  // it's not yet live (under approval with each platform).
  const lockedCta = { opacity: 0.55, pointerEvents: 'none' as const, cursor: 'not-allowed' as const }
  const [facebook, setFacebook] = useState({ connected: false, pageName: '', pageId: '', pages: [] as { id: string; name: string }[] })
  const [fbDisconnecting, setFbDisconnecting] = useState(false)
  const [fbNotice, setFbNotice] = useState<{ ok: boolean; msg: string } | null>(null)
  const [pinterest, setPinterest] = useState({ connected: false, boardId: '', boardName: '', boards: [] as { id: string; name: string }[], fallbackBoard: '' })
  const [ptDisconnecting, setPtDisconnecting] = useState(false)
  const [ptNotice, setPtNotice] = useState<{ ok: boolean; msg: string } | null>(null)
  const [threads, setThreads] = useState({ connected: false, userId: '', username: '' })
  const [thDisconnecting, setThDisconnecting] = useState(false)
  const [thNotice, setThNotice] = useState<{ ok: boolean; msg: string } | null>(null)
  const [linkedin, setLinkedin] = useState({ connected: false, personName: '' })
  const [liDisconnecting, setLiDisconnecting] = useState(false)
  const [liNotice, setLiNotice] = useState<{ ok: boolean; msg: string } | null>(null)
  const [twitter, setTwitter] = useState({ connected: false, handle: '' })
  const [twDisconnecting, setTwDisconnecting] = useState(false)
  const [twNotice, setTwNotice] = useState<{ ok: boolean; msg: string } | null>(null)
  const [bluesky, setBluesky] = useState({ connected: false, handle: '' })
  const [bsHandle, setBsHandle] = useState('')
  const [bsAppPassword, setBsAppPassword] = useState('')
  const [bsConnecting, setBsConnecting] = useState(false)
  const [bsDisconnecting, setBsDisconnecting] = useState(false)
  const [bsNotice, setBsNotice] = useState<{ ok: boolean; msg: string } | null>(null)
  const [telegram, setTelegram] = useState({ connected: false, channelId: '', channelTitle: '' })
  const [tgInput, setTgInput] = useState('')
  const [tgConnecting, setTgConnecting] = useState(false)
  const [tgDisconnecting, setTgDisconnecting] = useState(false)
  const [tgNotice, setTgNotice] = useState<{ ok: boolean; msg: string } | null>(null)
  const [instagram, setInstagram] = useState({ connected: false, username: '' })
  const [igDisconnecting, setIgDisconnecting] = useState(false)
  const [igNotice, setIgNotice] = useState<{ ok: boolean; msg: string } | null>(null)
  // TikTok — Pro feature, Direct Post via Content Posting API
  const [tiktok, setTiktok] = useState({ connected: false, username: '', displayName: '', avatarUrl: '' })
  const [ttDisconnecting, setTtDisconnecting] = useState(false)
  const [ttNotice, setTtNotice] = useState<{ ok: boolean; msg: string } | null>(null)
  const [geniuslinkKey, setGeniuslinkKey] = useState('')
  const [geniuslinkSecret, setGeniuslinkSecret] = useState('')
  const [amazonAssociatesTag, setAmazonAssociatesTag] = useState('')
  const [youtubeOAuthConnected, setYoutubeOAuthConnected] = useState(false)
  const [ytDisconnecting, setYtDisconnecting] = useState(false)
  // Google Search Console connection (read-only) — powers the SEO hub.
  const [gscConnected, setGscConnected] = useState(false)
  const [gscProperty, setGscProperty] = useState<string | null>(null)
  const [gscDisconnecting, setGscDisconnecting] = useState(false)
  const [gscNotice, setGscNotice] = useState<{ ok: boolean; msg: string } | null>(null)
  // When on, publishing a blog post appends a "Full written review" backlink to
  // the source video's YouTube description (video→blog SEO). Default on.
  const [ytBacklink, setYtBacklink] = useState(true)
  const [ytOAuthNotice, setYtOAuthNotice] = useState<{ ok: boolean; msg: string } | null>(null)
  const [wpTesting, setWpTesting] = useState(false)
  const [wpTestResult, setWpTestResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [fixingCss, setFixingCss] = useState(false)
  const [fixCssResult, setFixCssResult] = useState<string | null>(null)
  const [fixingThumbs, setFixingThumbs] = useState(false)
  const [fixThumbsResult, setFixThumbsResult] = useState<string | null>(null)
  const [wpUrl, setWpUrl] = useState('')
  const [wpUsername, setWpUsername] = useState('')
  const [wpAppPassword, setWpAppPassword] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [reconnectToken, setReconnectToken] = useState('')
  const [reconnecting, setReconnecting] = useState(false)
  const [reconnectResult, setReconnectResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [showReconnect, setShowReconnect] = useState(false)
  // One-click WordPress connect (Authorize-Application flow) ────────────────
  // No plugin install, no token paste — just types URL → redirect → done.
  const [oneClickUrl, setOneClickUrl] = useState('')
  const [showTokenFallback, setShowTokenFallback] = useState(false)

  const load = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await supabase.from('integrations').select('*').eq('user_id', user.id).single()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row = data as any
    // Card visibility for Meta integrations: ALWAYS render the cards now —
    // gating moved to the Connect button itself so non-admin users see the
    // feature exists (and that it's locked) instead of it being silently
    // hidden. The per-platform unlock state below controls whether each
    // Connect button is live or shown as a disabled "Admin only" pill.
    setMetaUnlocked(true)
    setSocialLocks({
      facebook:  socialEnabled('facebook',  { tier: row?.tier, email: user.email }),
      instagram: socialEnabled('instagram', { tier: row?.tier, email: user.email }),
      threads:   socialEnabled('threads',   { tier: row?.tier, email: user.email }),
      tiktok:    socialEnabled('tiktok',    { tier: row?.tier, email: user.email }),
      pinterest: socialEnabled('pinterest', { tier: row?.tier, email: user.email }),
    })
    if (row) {
      setYoutubeChannelId(row.youtube_channel_id ?? '')
      setWpUrl(row.wordpress_url ?? '')
      setWpUsername(row.wordpress_username ?? '')
      setWpAppPassword(row.wordpress_app_password ?? '')
      const pages = JSON.parse(row.facebook_pages_json || '[]')
      setFacebook({ connected: !!row.facebook_page_id, pageName: row.facebook_page_name ?? '', pageId: row.facebook_page_id ?? '', pages })
      const boards = JSON.parse(row.pinterest_boards_json || '[]')
      // Connected = we hold a token. A board is NOT required: fresh
      // accounts (and the API sandbox) have zero boards, and we
      // auto-create a per-category board on publish. Gating on board_id
      // made a valid connection show as disconnected.
      setPinterest({ connected: !!row.pinterest_access_token, boardId: row.pinterest_board_id ?? '', boardName: row.pinterest_board_name ?? '', boards, fallbackBoard: row.pinterest_fallback_board ?? '' })
      setThreads({ connected: !!row.threads_access_token, userId: row.threads_user_id ?? '', username: row.threads_username ?? '' })
      setLinkedin({ connected: !!row.linkedin_access_token, personName: row.linkedin_person_name ?? '' })
      setTwitter({ connected: !!row.twitter_access_token, handle: row.twitter_handle ?? '' })
      setBluesky({ connected: !!row.bluesky_handle && !!row.bluesky_app_password, handle: row.bluesky_handle ?? '' })
      setTelegram({
        connected: !!row.telegram_channel_id,
        channelId: row.telegram_channel_id ?? '',
        channelTitle: row.telegram_channel_title ?? '',
      })
      setInstagram({
        connected: !!row.instagram_access_token && !!row.instagram_user_id,
        username: row.instagram_username ?? '',
      })
      setTiktok({
        connected: !!row.tiktok_access_token && !!row.tiktok_open_id,
        username: row.tiktok_username ?? '',
        displayName: row.tiktok_display_name ?? '',
        avatarUrl: row.tiktok_avatar_url ?? '',
      })
      setGeniuslinkKey(row.geniuslink_api_key ?? '')
      setGeniuslinkSecret(row.geniuslink_api_secret ?? '')
      setAmazonAssociatesTag(row.amazon_associates_tag ?? '')
      setYoutubeOAuthConnected(!!row.youtube_oauth_access_token)
      setYtBacklink(row.yt_backlink_enabled !== false)
      setGscConnected(!!row.gsc_oauth_access_token)
      setGscProperty(row.gsc_property ?? null)
    }
    setLoading(false)
    onLoad()
  }, [supabase, onLoad])

  useEffect(() => {
    const fbConnected = searchParams.get('fb_connected')
    const fbError = searchParams.get('fb_error')
    if (fbConnected) setFbNotice({ ok: true, msg: 'Facebook page connected!' })
    if (fbError) setFbNotice({ ok: false, msg: fbError === 'no_pages' ? 'No Facebook pages found on your account.' : `Facebook error: ${fbError}` })
    const ptConnected = searchParams.get('pinterest_connected')
    const ptError = searchParams.get('pinterest_error')
    if (ptConnected) setPtNotice({ ok: true, msg: 'Pinterest connected!' })
    if (ptError) setPtNotice({ ok: false, msg: `Pinterest error: ${ptError}` })
    const thConnected = searchParams.get('threads_connected')
    const thError = searchParams.get('threads_error')
    if (thConnected) { setThNotice({ ok: true, msg: 'Threads connected!' }); load() }
    if (thError) setThNotice({ ok: false, msg: `Threads error: ${decodeURIComponent(thError)}` })
    const liConnected = searchParams.get('linkedin_connected')
    const liError = searchParams.get('linkedin_error')
    if (liConnected) { setLiNotice({ ok: true, msg: 'LinkedIn connected!' }); load() }
    if (liError) setLiNotice({ ok: false, msg: liError === 'callback_failed' ? 'LinkedIn connection failed — please try again.' : `LinkedIn error: ${liError}` })
    const twConnected = searchParams.get('twitter_connected')
    const twError = searchParams.get('twitter_error')
    if (twConnected) { setTwNotice({ ok: true, msg: 'X (Twitter) connected!' }); load() }
    if (twError) setTwNotice({ ok: false, msg: `X error: ${decodeURIComponent(twError)}` })
    const ytConnected = searchParams.get('youtube_oauth_connected')
    const ytError = searchParams.get('youtube_oauth_error')
    if (ytConnected) { setYtOAuthNotice({ ok: true, msg: 'YouTube connected!' }); setYoutubeOAuthConnected(true); load() }
    if (ytError) setYtOAuthNotice({ ok: false, msg: `YouTube error: ${ytError}` })
    const igConnected = searchParams.get('instagram_connected')
    const igError = searchParams.get('instagram_error')
    if (igConnected) { setIgNotice({ ok: true, msg: 'Instagram connected!' }); load() }
    if (igError) setIgNotice({ ok: false, msg: `Instagram error: ${decodeURIComponent(igError)}` })
    const ttConnected = searchParams.get('tiktok_connected')
    const ttError = searchParams.get('tiktok_error')
    if (ttConnected) { setTtNotice({ ok: true, msg: 'TikTok connected!' }); load() }
    if (ttError) setTtNotice({ ok: false, msg: `TikTok error: ${decodeURIComponent(ttError)}` })
    // WordPress one-click OAuth callback. /api/wordpress/oauth-callback
    // redirects here with wp_oauth=connected | connected_warn_host |
    // rejected | error, plus an optional wp_oauth_reason for the error case.
    const wpOauth = searchParams.get('wp_oauth')
    const wpOauthReason = searchParams.get('wp_oauth_reason')
    if (wpOauth === 'connected') {
      setReconnectResult({ ok: true, message: 'WordPress connected!' })
      load()
    } else if (wpOauth === 'connected_warn_host') {
      setReconnectResult({
        ok: true,
        message: 'Saved — but your host may strip Authorization headers (Hostinger / mod_security). Test connection to verify.',
      })
      load()
    } else if (wpOauth === 'rejected') {
      setReconnectResult({ ok: false, message: wpOauthReason || 'Connection declined on your WordPress site.' })
    } else if (wpOauth === 'error') {
      setReconnectResult({ ok: false, message: wpOauthReason || 'WordPress connection failed.' })
    }

    const gscConnectedParam = searchParams.get('gsc_connected')
    const gscErr = searchParams.get('gsc_error')
    const gscProp = searchParams.get('gsc_property')
    const gscNoProp = searchParams.get('gsc_no_property')
    if (gscConnectedParam) {
      setGscNotice({
        ok: true,
        msg: gscProp
          ? `Search Console connected — tracking ${decodeURIComponent(gscProp)}`
          : gscNoProp
            ? 'Search Console connected, but no matching property was found. Make sure this site is a verified property in your Search Console account.'
            : 'Search Console connected!',
      })
      load()
    }
    if (gscErr) setGscNotice({ ok: false, msg: `Search Console error: ${decodeURIComponent(gscErr)}` })
  }, [searchParams, load])

  useEffect(() => { load() }, [load])

  async function save() {
    setSaving(true); setError(null)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    // WordPress credentials are managed via the token flow now; don't overwrite them here.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: err } = await supabase.from('integrations').upsert({
      user_id: user.id,
      youtube_channel_id: youtubeChannelId || null,
      geniuslink_api_key: geniuslinkKey || null,
      geniuslink_api_secret: geniuslinkSecret || null,
      amazon_associates_tag: amazonAssociatesTag || null,
    }, { onConflict: 'user_id' })
    setSaving(false)
    if (err) { setError(err.message) } else { setSaved(true); setTimeout(() => setSaved(false), 2500) }
  }

  async function testWordPress() {
    setWpTesting(true); setWpTestResult(null)
    try {
      const res = await fetch('/api/wordpress/test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: wpUrl, username: wpUsername, password: wpAppPassword }) })
      const data = await res.json()
      setWpTestResult({ ok: data.ok, message: data.message || data.error })
    } catch { setWpTestResult({ ok: false, message: 'Request failed — check your site URL' }) }
    finally { setWpTesting(false) }
  }

  async function reconnectWithToken() {
    setReconnecting(true); setReconnectResult(null)
    try {
      const res = await fetch('/api/wordpress/connect-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: reconnectToken.trim() }),
      })
      const data = await res.json()
      if (!res.ok) {
        setReconnectResult({ ok: false, message: data.error || 'Failed to verify token' })
      } else {
        setReconnectResult({ ok: true, message: `Connected to ${data.siteUrl} as ${data.username}` })
        setReconnectToken('')
        setShowReconnect(false)
        await load()
      }
    } catch (e) {
      setReconnectResult({ ok: false, message: e instanceof Error ? e.message : 'Request failed' })
    } finally {
      setReconnecting(false)
    }
  }

  async function fixCssCorruption() {
    setFixingCss(true); setFixCssResult(null)
    try {
      const res = await fetch('/api/wordpress/fix-css-corruption', { method: 'POST' })
      const data = await res.json()
      if (data.error) setFixCssResult(`Error: ${data.error}`)
      else if (data.affected === 0) setFixCssResult('No corrupted posts found — all clean!')
      else setFixCssResult(`Fixed ${data.fixed} of ${data.affected} affected post${data.affected !== 1 ? 's' : ''}.`)
    } catch { setFixCssResult('Request failed.') }
    finally { setFixingCss(false) }
  }

  async function fixThumbnails() {
    setFixingThumbs(true); setFixThumbsResult(null)
    try {
      const res = await fetch('/api/wordpress/fix-thumbnails', { method: 'POST' })
      const data = await res.json()
      if (data.error) setFixThumbsResult(`Error: ${data.error}`)
      else setFixThumbsResult(`Fixed ${data.fixed} thumbnail${data.fixed !== 1 ? 's' : ''} (${data.skipped} already good, ${data.failed} failed).`)
    } catch { setFixThumbsResult('Request failed.') }
    finally { setFixingThumbs(false) }
  }

  async function disconnectFacebook() {
    setFbDisconnecting(true)
    try {
      const res = await fetch('/api/auth/facebook/disconnect', { method: 'POST' })
      if (res.ok) setFacebook({ connected: false, pageName: '', pageId: '', pages: [] })
    } finally { setFbDisconnecting(false) }
  }

  async function selectFacebookPage(pageId: string) {
    const res = await fetch('/api/auth/facebook/select-page', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pageId }) })
    const data = await res.json()
    if (data.ok) setFacebook(prev => ({ ...prev, pageId: data.page.id, pageName: data.page.name }))
  }

  async function disconnectPinterest() {
    setPtDisconnecting(true)
    try {
      const res = await fetch('/api/auth/pinterest/disconnect', { method: 'POST' })
      if (res.ok) setPinterest({ connected: false, boardId: '', boardName: '', boards: [], fallbackBoard: '' })
    } finally { setPtDisconnecting(false) }
  }

  async function savePinterestFallback(name: string) {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await supabase.from('integrations').update({ pinterest_fallback_board: name.trim() || null }).eq('user_id', user.id)
  }

  async function saveYtBacklink(enabled: boolean) {
    setYtBacklink(enabled)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await supabase.from('integrations').update({ yt_backlink_enabled: enabled }).eq('user_id', user.id)
  }

  async function disconnectYoutube() {
    setYtDisconnecting(true)
    try {
      const res = await fetch('/api/auth/youtube/disconnect', { method: 'POST' })
      if (res.ok) {
        setYoutubeOAuthConnected(false)
        setYtOAuthNotice({ ok: true, msg: 'YouTube disconnected.' })
      }
    } finally { setYtDisconnecting(false) }
  }

  async function disconnectGsc() {
    setGscDisconnecting(true)
    try {
      const res = await fetch('/api/auth/gsc/disconnect', { method: 'POST' })
      if (res.ok) {
        setGscConnected(false)
        setGscProperty(null)
        setGscNotice({ ok: true, msg: 'Search Console disconnected.' })
      }
    } finally { setGscDisconnecting(false) }
  }

  async function disconnectThreads() {
    setThDisconnecting(true)
    try {
      const res = await fetch('/api/auth/threads/disconnect', { method: 'POST' })
      if (res.ok) setThreads({ connected: false, userId: '', username: '' })
    } finally { setThDisconnecting(false) }
  }

  async function disconnectLinkedIn() {
    setLiDisconnecting(true)
    try {
      const res = await fetch('/api/auth/linkedin/disconnect', { method: 'POST' })
      if (res.ok) setLinkedin({ connected: false, personName: '' })
    } finally { setLiDisconnecting(false) }
  }

  async function disconnectTwitter() {
    setTwDisconnecting(true)
    try {
      const res = await fetch('/api/auth/twitter/disconnect', { method: 'POST' })
      if (res.ok) setTwitter({ connected: false, handle: '' })
    } finally { setTwDisconnecting(false) }
  }

  async function connectBluesky() {
    setBsConnecting(true)
    setBsNotice(null)
    try {
      const res = await fetch('/api/auth/bluesky', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ handle: bsHandle, appPassword: bsAppPassword }),
      })
      const d = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
      if (res.ok) {
        setBluesky({ connected: true, handle: d.handle ?? bsHandle })
        setBsAppPassword('')
        setBsNotice({ ok: true, msg: `Connected as @${d.handle ?? bsHandle}!` })
      } else {
        setBsNotice({ ok: false, msg: d.error || 'Bluesky connect failed' })
      }
    } catch (e) {
      setBsNotice({ ok: false, msg: e instanceof Error ? e.message : 'Bluesky connect failed' })
    } finally { setBsConnecting(false) }
  }

  async function disconnectBluesky() {
    setBsDisconnecting(true)
    try {
      const res = await fetch('/api/auth/bluesky/disconnect', { method: 'POST' })
      if (res.ok) {
        setBluesky({ connected: false, handle: '' })
        setBsHandle('')
        setBsNotice(null)
      }
    } finally { setBsDisconnecting(false) }
  }

  async function connectTelegram() {
    setTgConnecting(true)
    setTgNotice(null)
    try {
      const res = await fetch('/api/auth/telegram/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channelId: tgInput }),
      })
      const d = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
      if (res.ok) {
        setTelegram({ connected: true, channelId: d.channelId, channelTitle: d.channelTitle })
        setTgInput('')
        setTgNotice({ ok: true, msg: `Connected to "${d.channelTitle}"` })
      } else {
        setTgNotice({ ok: false, msg: d.error || 'Telegram connect failed' })
      }
    } catch (e) {
      setTgNotice({ ok: false, msg: e instanceof Error ? e.message : 'Telegram connect failed' })
    } finally { setTgConnecting(false) }
  }

  async function disconnectTelegram() {
    setTgDisconnecting(true)
    try {
      const res = await fetch('/api/auth/telegram/disconnect', { method: 'POST' })
      if (res.ok) {
        setTelegram({ connected: false, channelId: '', channelTitle: '' })
        setTgInput('')
        setTgNotice(null)
      }
    } finally { setTgDisconnecting(false) }
  }

  async function disconnectInstagram() {
    setIgDisconnecting(true)
    try {
      const res = await fetch('/api/auth/instagram/disconnect', { method: 'POST' })
      if (res.ok) {
        setInstagram({ connected: false, username: '' })
        setIgNotice(null)
      }
    } finally { setIgDisconnecting(false) }
  }

  async function disconnectTiktok() {
    setTtDisconnecting(true)
    try {
      const res = await fetch('/api/auth/tiktok/disconnect', { method: 'POST' })
      if (res.ok) {
        setTiktok({ connected: false, username: '', displayName: '', avatarUrl: '' })
        setTtNotice(null)
      }
    } finally { setTtDisconnecting(false) }
  }

  if (loading) return (
    <div className="flex items-center gap-2 text-sm text-[#86868b] dark:text-[#8e8e93] py-6">
      <Loader2 size={16} className="animate-spin" /> Loading…
    </div>
  )

  return (
    <div className="flex flex-col gap-5 mt-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Integrations</h2>
          <p className="text-xs text-[#86868b] dark:text-[#8e8e93] mt-0.5 leading-relaxed">
            Connect each platform once. Recommended order: <strong className="text-[#1d1d1f] dark:text-[#f5f5f7]">YouTube</strong> (so we can see your videos) → <strong className="text-[#1d1d1f] dark:text-[#f5f5f7]">Geniuslink</strong> (for affiliate URL routing) → <strong className="text-[#1d1d1f] dark:text-[#f5f5f7]">social platforms</strong> you want to fan out to. Each integration is optional — only connect what you&apos;ll use.
          </p>
        </div>
        {/* Top save — mirrors the Save button at the bottom so users can save
            without scrolling the whole integrations list. */}
        <button onClick={save} disabled={saving} className="btn-primary flex-shrink-0 self-start">
          {saved ? <><Check size={14} /> Saved!</> : saving ? <><Loader2 size={14} className="animate-spin" /> Saving…</> : <><Save size={14} /> Save</>}
        </button>
      </div>

      {/* Security notice */}
      <div className="rounded-xl border border-[#34c759]/30 bg-[#34c759]/5 px-4 py-3.5 flex gap-3">
        <div className="mt-0.5 flex-shrink-0">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#34c759" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
        </div>
        <div className="flex flex-col gap-1">
          <p className="text-xs font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Your credentials are safe</p>
          <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0] leading-relaxed">
            Every API key, password, and access token you enter here is encrypted and stored securely in our database — <strong>nothing is ever saved in your browser or locally on your device</strong>. Credentials are only used server-side to make authenticated API calls on your behalf (posting to your blog, pushing metadata to YouTube, creating affiliate links, etc.). We never share, log, or expose them. You can disconnect any integration or delete your account at any time.
          </p>
        </div>
      </div>

      {/* YouTube */}
      <div className="card p-6">
        <div className="flex items-center gap-3 mb-4 pb-4 border-b border-gray-100 dark:border-white/10">
          <div className="w-8 h-8 rounded-lg bg-red-50 flex items-center justify-center">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="#FF0000"><path d="M23.5 6.19a3.02 3.02 0 0 0-2.12-2.14C19.54 3.5 12 3.5 12 3.5s-7.54 0-9.38.55A3.02 3.02 0 0 0 .5 6.19C0 8.03 0 12 0 12s0 3.97.5 5.81a3.02 3.02 0 0 0 2.12 2.14C4.46 20.5 12 20.5 12 20.5s7.54 0 9.38-.55a3.02 3.02 0 0 0 2.12-2.14C24 15.97 24 12 24 12s0-3.97-.5-5.81zM9.75 15.5v-7l6.5 3.5-6.5 3.5z"/></svg>
          </div>
          <div>
            <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">YouTube</p>
            <p className="text-xs text-[#86868b] dark:text-[#8e8e93]">Sync your public video library for blog post generation</p>
          </div>
        </div>
        <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0] mb-4">
          Your Channel ID lets the tool pull your public video list so you can turn any video into a blog post. Find it at <a href="https://www.youtube.com/account_advanced" target="_blank" rel="noopener noreferrer" className="text-[#7C3AED] hover:underline">youtube.com/account_advanced</a> — it starts with <code className="bg-[var(--surface-2)] px-1 rounded">UC</code>.
        </p>
        <div>
          <label htmlFor="setup-youtube-channel-id" className="block text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7] mb-1.5">Channel ID</label>
          <input id="setup-youtube-channel-id" name="youtube-channel-id" type="text" value={youtubeChannelId} onChange={e => setYoutubeChannelId(e.target.value)} placeholder="UCxxxxxxxxxxxxxxx" className="input-field font-mono text-xs" />
        </div>

        {/* Video→blog backlink toggle — only relevant once YouTube is connected
            (it edits your own video descriptions when you publish a post). */}
        {youtubeOAuthConnected && (
          <label className="flex items-start gap-2 mt-4 pt-4 border-t border-gray-100 dark:border-white/10 cursor-pointer">
            <input
              type="checkbox"
              checked={ytBacklink}
              onChange={e => saveYtBacklink(e.target.checked)}
              className="mt-0.5 rounded border-gray-300"
            />
            <span>
              <span className="block text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7]">Add a blog backlink to my YouTube videos</span>
              <span className="block text-xs text-[#86868b] dark:text-[#8e8e93]">When you publish a post, append a “Full written review” link to that video&apos;s description. Boosts SEO both ways. Added once per video.</span>
            </span>
          </label>
        )}
      </div>

      {/* WordPress connection — Application Password is managed inside the MVP Affiliate plugin */}
      <div className="card p-6">
        <div className="flex items-center gap-3 mb-4 pb-4 border-b border-gray-100 dark:border-white/10">
          <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="#21759B"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/></svg>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">WordPress</p>
            <p className="text-xs text-[#86868b] dark:text-[#8e8e93] truncate">{wpUrl || 'Not connected'}</p>
          </div>
          {wpUrl && wpAppPassword && (
            <span className="flex items-center gap-1 text-xs font-medium text-[#34c759] flex-shrink-0"><Check size={12} /> Connected</span>
          )}
        </div>

        {wpUrl && wpAppPassword ? (
          <>
            <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0] mb-4">
              Connected as <strong>{wpUsername}</strong>. Use the buttons below to verify the connection or run maintenance. To change credentials, click <strong>Update credentials</strong> and reconnect in one click.
            </p>

            <div className="flex flex-wrap items-center gap-3 pt-1">
              <button type="button" onClick={testWordPress} disabled={wpTesting || !wpUrl || !wpUsername || !wpAppPassword} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-gray-200 dark:border-white/10 rounded-lg text-[#1d1d1f] dark:text-[#f5f5f7] hover:border-[#7C3AED]/40 disabled:opacity-40 transition-colors">
                {wpTesting ? <Loader2 size={12} className="animate-spin" /> : <Wifi size={12} />} Test connection
              </button>
              <button type="button" onClick={fixCssCorruption} disabled={fixingCss || !wpUrl} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-gray-200 dark:border-white/10 rounded-lg text-[#1d1d1f] dark:text-[#f5f5f7] hover:border-[#ff3b30]/40 disabled:opacity-40 transition-colors">
                {fixingCss ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Fix corrupted posts
              </button>
              <button type="button" onClick={fixThumbnails} disabled={fixingThumbs || !wpUrl} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-gray-200 dark:border-white/10 rounded-lg text-[#1d1d1f] dark:text-[#f5f5f7] hover:border-[#ff9500]/40 disabled:opacity-40 transition-colors">
                {fixingThumbs ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Fix thumbnails
              </button>
              <button type="button" onClick={() => setShowReconnect(v => !v)} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-gray-200 dark:border-white/10 rounded-lg text-[#86868b] dark:text-[#8e8e93] hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7] hover:border-[#86868b]/40 transition-colors">
                <Save size={12} /> {showReconnect ? 'Cancel' : 'Update credentials'}
              </button>
              {wpTestResult && <span className={`text-xs font-medium ${wpTestResult.ok ? 'text-[#34c759]' : 'text-[#ff3b30]'}`}>{wpTestResult.message}</span>}
              {fixCssResult && <span className={`text-xs font-medium ${fixCssResult.startsWith('Error') ? 'text-[#ff3b30]' : 'text-[#34c759]'}`}>{fixCssResult}</span>}
              {fixThumbsResult && <span className={`text-xs font-medium ${fixThumbsResult.startsWith('Error') ? 'text-[#ff3b30]' : 'text-[#34c759]'}`}>{fixThumbsResult}</span>}
            </div>
          </>
        ) : (
          <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0] mb-4">
            No WordPress site connected yet. Enter your site URL below and we&apos;ll redirect you to WordPress to approve the connection — no plugin install, no copy/paste.
          </p>
        )}

        {/* One-click Connect (Authorize-Application flow) + Token fallback */}
        {(showReconnect || !wpUrl || !wpAppPassword) && (
          <div className="mt-4 rounded-xl border border-blue-200 dark:border-blue-500/30 bg-blue-50/50 dark:bg-blue-500/5 p-4 space-y-3">
            {/* Primary: one-click connect */}
            <div>
              <p className="text-xs font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-2">Connect WordPress (one click)</p>
              <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0] mb-3">
                We&apos;ll take you to your WordPress site&apos;s built-in authorization screen. Sign in once (if needed), click &ldquo;Yes, I approve&rdquo;, and you&apos;re connected. Nothing typed back here.
              </p>
              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  const url = oneClickUrl.trim()
                  if (!url) return
                  // Hard nav so WP's Authorize-Application screen fully takes over the tab.
                  window.location.href = `/api/wordpress/oauth-start?siteUrl=${encodeURIComponent(url)}`
                }}
                className="flex items-center gap-2"
              >
                <input
                  type="url"
                  value={oneClickUrl}
                  onChange={(e) => setOneClickUrl(e.target.value)}
                  placeholder="https://yoursite.com"
                  className="input-field text-xs flex-1"
                  autoComplete="url"
                  inputMode="url"
                />
                <button
                  type="submit"
                  disabled={oneClickUrl.trim().length < 4}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-[#7C3AED] text-white rounded-lg hover:bg-[#0066cc] disabled:opacity-40 transition-colors whitespace-nowrap"
                >
                  <Wifi size={12} /> Connect WordPress
                </button>
              </form>
              {reconnectResult && (
                <p className={`text-xs font-medium mt-2 ${reconnectResult.ok ? 'text-[#34c759]' : 'text-[#ff3b30]'}`}>
                  {reconnectResult.message}
                </p>
              )}
            </div>

            {/* Fallback: Connection Token paste (collapsed by default) */}
            <div className="pt-3 border-t border-blue-200/60 dark:border-blue-500/20">
              <button
                type="button"
                onClick={() => setShowTokenFallback(v => !v)}
                className="text-[11px] text-[#6e6e73] dark:text-[#8e8e93] hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7] transition-colors"
              >
                {showTokenFallback ? '− Hide advanced' : '+ Use Connection Token instead (advanced — for sites that disable Application Passwords)'}
              </button>
              {showTokenFallback && (
                <div className="mt-3">
                  <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0] mb-2">
                    Install the MVP Affiliate plugin on your site → wp-admin → <strong>MVP Affiliate</strong> menu → click <strong>Generate Connection Token</strong> → paste below.
                    {wpUrl && (
                      <>
                        {' '}
                        <a href={`${wpUrl.replace(/\/$/, '')}/wp-admin/admin.php?page=mvp-affiliate`} target="_blank" rel="noopener noreferrer" className="text-[#7C3AED] hover:underline">Open MVP Affiliate page →</a>
                      </>
                    )}
                  </p>
                  <textarea
                    value={reconnectToken}
                    onChange={e => setReconnectToken(e.target.value)}
                    placeholder="eyJ1cmwiOiJodHRwczovL... (paste full token here)"
                    rows={3}
                    className="input-field font-mono text-xs resize-y mb-2"
                  />
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={reconnectWithToken}
                      disabled={reconnecting || reconnectToken.trim().length < 20}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-gray-200 dark:border-white/10 rounded-lg text-[#1d1d1f] dark:text-[#f5f5f7] hover:border-[#7C3AED]/40 disabled:opacity-40 transition-colors"
                    >
                      {reconnecting ? <Loader2 size={12} className="animate-spin" /> : <Wifi size={12} />}
                      Connect with token
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── Coming-soon banner — 5 socials under platform approval ──────────
          Visible to every non-admin user (admins skip it; the reviewer Meta
          test account also skips so the App Review screencast stays clean).
          Replaces the previous "Admin only" framing — the gate isn't about
          the user's tier, it's about each platform's own approval process. */}
      {!isUnlocked('facebook') && (
        <div
          className="card p-5"
          style={{ background: 'linear-gradient(135deg, rgba(124,58,237,0.07) 0%, rgba(124,58,237,0.02) 100%)', borderColor: 'rgba(124,58,237,0.25)' }}
        >
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(124,58,237,0.15)' }}>
              <Clock size={16} style={{ color: '#7C3AED' }} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap mb-1">
                <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">5 integrations coming soon</p>
                <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full" style={{ background: '#7C3AED', color: '#fff' }}>Under review</span>
              </div>
              <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0] leading-relaxed mb-3">
                <strong>Facebook</strong>, <strong>Instagram</strong>, <strong>Threads</strong>, <strong>TikTok</strong> and <strong>Pinterest</strong> are currently going through the official approval process with each platform. They&apos;ll unlock here automatically once approved. Until then, every other channel below (WordPress, LinkedIn, Bluesky, Twitter, Telegram, YouTube, Newsletter) works as normal.
              </p>
              <div className="flex flex-wrap gap-1.5">
                {[
                  { name: 'Facebook', icon: <Facebook size={11} />, bg: '#1877F2' },
                  { name: 'Instagram', icon: <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.16c3.2 0 3.58.012 4.85.07 1.17.054 1.8.249 2.23.413.56.218.96.479 1.38.896.42.42.68.819.9 1.381.16.42.36 1.057.41 2.227.06 1.266.07 1.646.07 4.85s-.01 3.585-.07 4.85c-.06 1.17-.26 1.806-.42 2.228-.23.562-.48.96-.9 1.382-.42.42-.83.679-1.38.896-.42.164-1.06.36-2.23.413-1.27.057-1.65.07-4.85.07s-3.59-.015-4.86-.074c-1.17-.06-1.81-.256-2.24-.421-.57-.224-.96-.479-1.38-.899-.42-.42-.69-.824-.9-1.38-.16-.42-.36-1.065-.42-2.235-.05-1.26-.06-1.65-.06-4.84 0-3.2.02-3.59.06-4.86.06-1.17.26-1.81.42-2.23.21-.57.48-.96.9-1.38.42-.42.81-.69 1.38-.9.42-.17 1.05-.36 2.22-.42 1.28-.05 1.65-.06 4.86-.06l.04.03zM12 7.84a4.16 4.16 0 1 0 0 8.32 4.16 4.16 0 0 0 0-8.32z"/></svg>, bg: 'linear-gradient(45deg, #f09433 0%, #dc2743 50%, #bc1888 100%)' },
                  { name: 'Threads', icon: <MessageCircle size={11} />, bg: '#000' },
                  { name: 'TikTok', icon: <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5.8 20.1a6.34 6.34 0 0 0 10.86-4.43V8.45a8.16 8.16 0 0 0 4.77 1.52v-3.4a4.85 4.85 0 0 1-1.84-.34z"/></svg>, bg: '#000' },
                  { name: 'Pinterest', icon: <Pin size={11} />, bg: '#E60023' },
                ].map(p => (
                  <span
                    key={p.name}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-semibold text-white"
                    style={{ background: p.bg, opacity: 0.85 }}
                  >
                    {p.icon} {p.name}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Facebook */}
      {metaUnlocked && (
      <div className="card p-6">
        <div className="flex items-center gap-3 mb-4 pb-4 border-b border-gray-100 dark:border-white/10">
          <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center">
            <Facebook size={16} className="text-[#1877F2]" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Facebook Page</p>
            <p className="text-xs text-[#86868b] dark:text-[#8e8e93]">Auto-post blog links to your page when published</p>
          </div>
          {facebook.connected && <span className="flex items-center gap-1 text-xs font-medium text-[#34c759]"><Check size={12} /> Connected</span>}
        </div>
        <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0] mb-4">
          Click <strong>Connect Facebook</strong> and you'll be redirected to Facebook to grant permission. We only request access to post on your page's behalf — we never read your personal messages or profile data. Once connected, new blog posts can be shared to your page in one click.
        </p>
        {fbNotice && <p className={`text-xs mb-3 ${fbNotice.ok ? 'text-[#34c759]' : 'text-[#ff3b30]'}`}>{fbNotice.msg}</p>}
        {facebook.connected ? (
          <div className="flex flex-col gap-3">
            {facebook.pages.length > 1 && (
              <div>
                <label className="block text-xs font-medium text-[#1d1d1f] dark:text-[#f5f5f7] mb-1.5">Active page</label>
                <select value={facebook.pageId} onChange={e => selectFacebookPage(e.target.value)} className="input-field text-sm">
                  {facebook.pages.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
            )}
            {facebook.pages.length === 1 && (
              <p className="text-sm text-[#1d1d1f] dark:text-[#f5f5f7] flex items-center gap-2">
                <Link2 size={13} className="text-[#86868b] dark:text-[#8e8e93]" /> {facebook.pageName}
              </p>
            )}
            <button onClick={disconnectFacebook} disabled={fbDisconnecting} className="flex items-center gap-1.5 text-xs text-[#86868b] dark:text-[#8e8e93] hover:text-[#ff3b30] transition-colors self-start">
              {fbDisconnecting ? <Loader2 size={12} className="animate-spin" /> : <LogOut size={12} />} Disconnect
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {isUnlocked('facebook') ? (
              <a
                href="/api/auth/facebook"
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white self-start transition-colors"
                style={{ backgroundColor: '#1877F2' }}
              >
                <Facebook size={14} /> Connect Facebook
              </a>
            ) : (
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white self-start" style={{ ...lockedCta, backgroundColor: '#1877F2' }} title="Under approval — coming soon">
                <Facebook size={14} /> Connect Facebook
                <span className="ml-1 text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-white/25">Coming soon</span>
              </div>
            )}
            <p className="text-[11px] text-[#86868b] dark:text-[#8e8e93] leading-relaxed">
              You&apos;ll be sent to Facebook to grant access — on that screen, <strong>tick every Page</strong> you want to post to (or &ldquo;opt in to all&rdquo;). This is what lets you pick a Page per post.
            </p>
          </div>
        )}
      </div>
      )}

      {/* Pinterest */}
      <div className="card p-6">
        <div className="flex items-center gap-3 mb-4 pb-4 border-b border-gray-100 dark:border-white/10">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: '#fef0f0' }}>
            <Pin size={16} style={{ color: '#E60023' }} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Pinterest</p>
            <p className="text-xs text-[#86868b] dark:text-[#8e8e93]">Pin blog posts to your Pinterest boards</p>
          </div>
          {pinterest.connected && <span className="flex items-center gap-1 text-xs font-medium text-[#34c759]"><Check size={12} /> Connected</span>}
        </div>
        <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0] mb-4">
          Connect via OAuth and each pin is automatically saved to a board that matches the blog post&apos;s category — we create the board for you if it doesn&apos;t exist yet (e.g. an Automotive post → your &ldquo;Automotive&rdquo; board). For posts with no specific category, pins go to the board you name below (created automatically if it doesn&apos;t exist).
        </p>
        {ptNotice && <p className={`text-xs mb-3 ${ptNotice.ok ? 'text-[#34c759]' : 'text-[#ff3b30]'}`}>{ptNotice.msg}</p>}
        {pinterest.connected ? (
          <div className="flex flex-col gap-3">
            <div>
              <label className="block text-xs font-medium text-[#1d1d1f] dark:text-[#f5f5f7] mb-1.5">Board for posts with no category</label>
              <input
                type="text"
                value={pinterest.fallbackBoard}
                onChange={e => setPinterest(prev => ({ ...prev, fallbackBoard: e.target.value }))}
                onBlur={e => savePinterestFallback(e.target.value)}
                placeholder="Reviews"
                className="input-field text-sm"
              />
              <p className="text-[11px] text-[#86868b] dark:text-[#8e8e93] mt-1">
                Defaults to &ldquo;Reviews&rdquo; if left blank. Categorized posts still get their own per-category board.
              </p>
            </div>
            <button onClick={disconnectPinterest} disabled={ptDisconnecting} className="flex items-center gap-1.5 text-xs text-[#86868b] dark:text-[#8e8e93] hover:text-[#ff3b30] transition-colors self-start">
              {ptDisconnecting ? <Loader2 size={12} className="animate-spin" /> : <LogOut size={12} />} Disconnect
            </button>
          </div>
        ) : (
          isUnlocked('pinterest') ? (
            <a
              href="/api/auth/pinterest"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white self-start transition-colors"
              style={{ backgroundColor: '#E60023' }}
            >
              <Pin size={14} /> Connect Pinterest
            </a>
          ) : (
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white self-start" style={{ ...lockedCta, backgroundColor: '#E60023' }} title="Under approval — coming soon">
              <Pin size={14} /> Connect Pinterest
              <span className="ml-1 text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-white/25">Coming soon</span>
            </div>
          )
        )}
      </div>

      {/* Threads */}
      {metaUnlocked && (
      <div className="card p-6">
        <div className="flex items-center gap-3 mb-4 pb-4 border-b border-gray-100 dark:border-white/10">
          <div className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center">
            <MessageCircle size={16} className="text-[#1d1d1f] dark:text-[#f5f5f7]" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Threads</p>
            <p className="text-xs text-[#86868b] dark:text-[#8e8e93]">Auto-post blog summaries to your Threads profile</p>
          </div>
          {threads.connected && <span className="flex items-center gap-1 text-xs font-medium text-[#34c759]"><Check size={12} /> Connected</span>}
        </div>
        <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0] mb-4">
          Click <strong>Connect Threads</strong> and you&apos;ll be redirected to Threads to authorize the connection. We only request permission to read your basic profile and publish posts on your behalf — we never access your inbox or any other account data.
        </p>
        {thNotice && <p className={`text-xs mb-3 ${thNotice.ok ? 'text-[#34c759]' : 'text-[#ff3b30]'}`}>{thNotice.msg}</p>}
        {threads.connected ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-[#1d1d1f] dark:text-[#f5f5f7] flex items-center gap-2">
              <Link2 size={13} className="text-[#86868b] dark:text-[#8e8e93]" /> {threads.username ? <>Connected as <strong>@{threads.username}</strong></> : 'Threads account connected'}
            </p>
            <button onClick={disconnectThreads} disabled={thDisconnecting} className="flex items-center gap-1.5 text-xs text-[#86868b] dark:text-[#8e8e93] hover:text-[#ff3b30] transition-colors self-start">
              {thDisconnecting ? <Loader2 size={12} className="animate-spin" /> : <LogOut size={12} />} Disconnect
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {isUnlocked('threads') ? (
              <a
                href="/api/auth/threads"
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white self-start transition-colors bg-black hover:bg-[#1d1d1f]"
              >
                <MessageCircle size={14} /> Connect Threads
              </a>
            ) : (
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white self-start bg-black" style={lockedCta} title="Under approval — coming soon">
                <MessageCircle size={14} /> Connect Threads
                <span className="ml-1 text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-white/25">Coming soon</span>
              </div>
            )}
          </div>
        )}
      </div>
      )}

      {/* LinkedIn */}
      <div className="card p-6">
        <div className="flex items-center gap-3 mb-4 pb-4 border-b border-gray-100 dark:border-white/10">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: '#e8f0fb' }}>
            <Linkedin size={16} style={{ color: '#0A66C2' }} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">LinkedIn</p>
            <p className="text-xs text-[#86868b] dark:text-[#8e8e93]">Share blog posts as LinkedIn articles with your network</p>
          </div>
          {linkedin.connected && <span className="flex items-center gap-1 text-xs font-medium text-[#34c759]"><Check size={12} /> Connected</span>}
        </div>
        <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0] mb-4">
          Click <strong>Connect LinkedIn</strong> and you'll be redirected to LinkedIn to authorise the connection. We only request permission to post on your profile — we never access your inbox, connections, or any other account data.
        </p>
        {liNotice && <p className={`text-xs mb-3 ${liNotice.ok ? 'text-[#34c759]' : 'text-[#ff3b30]'}`}>{liNotice.msg}</p>}
        {linkedin.connected ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-[#1d1d1f] dark:text-[#f5f5f7] flex items-center gap-2">
              <Link2 size={13} className="text-[#86868b] dark:text-[#8e8e93]" />
              {linkedin.personName || 'LinkedIn account connected'}
            </p>
            <button onClick={disconnectLinkedIn} disabled={liDisconnecting} className="flex items-center gap-1.5 text-xs text-[#86868b] dark:text-[#8e8e93] hover:text-[#ff3b30] transition-colors self-start">
              {liDisconnecting ? <Loader2 size={12} className="animate-spin" /> : <LogOut size={12} />} Disconnect
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <a
              href="/api/auth/linkedin"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white self-start transition-colors"
              style={{ backgroundColor: '#0A66C2' }}
            >
              <Linkedin size={14} /> Connect LinkedIn
            </a>
          </div>
        )}
      </div>

      {/* X (Twitter) */}
      <div className="card p-6">
        <div className="flex items-center gap-3 mb-4 pb-4 border-b border-gray-100 dark:border-white/10">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-black">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="white">
              <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">X (formerly Twitter)</p>
            <p className="text-xs text-[#86868b] dark:text-[#8e8e93]">Post a single tweet linking to each published review</p>
          </div>
          {twitter.connected && <span className="flex items-center gap-1 text-xs font-medium text-[#34c759]"><Check size={12} /> Connected</span>}
        </div>
        <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0] mb-4">
          Click <strong>Connect X</strong> and you&apos;ll be redirected to X to authorise the connection. We only request permission to post a single tweet per published review on your behalf — we never read, follow, like, or engage with other accounts.
        </p>
        {twNotice && <p className={`text-xs mb-3 ${twNotice.ok ? 'text-[#34c759]' : 'text-[#ff3b30]'}`}>{twNotice.msg}</p>}
        {twitter.connected ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-[#1d1d1f] dark:text-[#f5f5f7] flex items-center gap-2">
              <Link2 size={13} className="text-[#86868b] dark:text-[#8e8e93]" />
              Connected as <strong>@{twitter.handle || 'your X account'}</strong>
            </p>
            <button onClick={disconnectTwitter} disabled={twDisconnecting} className="flex items-center gap-1.5 text-xs text-[#86868b] dark:text-[#8e8e93] hover:text-[#ff3b30] transition-colors self-start">
              {twDisconnecting ? <Loader2 size={12} className="animate-spin" /> : <LogOut size={12} />} Disconnect
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <a
              href="/api/auth/twitter"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white self-start transition-colors bg-black hover:bg-[#1a1a1a]"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="white">
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
              </svg>
              Connect X
            </a>
          </div>
        )}
      </div>

      {/* Bluesky */}
      <div className="card p-6">
        <div className="flex items-center gap-3 mb-4 pb-4 border-b border-gray-100 dark:border-white/10">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: '#1185fe' }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="white">
              <path d="M12 10.8c-1.087-2.114-4.046-6.053-6.798-7.995C2.566.944 1.561 1.266.902 1.565.139 1.908 0 3.08 0 3.768c0 .69.378 5.65.624 6.479.815 2.736 3.713 3.66 6.383 3.364-3.911.58-7.386 2.005-2.83 7.078 5.013 5.19 6.87-1.113 7.823-4.308.953 3.195 2.05 9.271 7.733 4.308 4.267-4.308 1.172-6.498-2.74-7.078 2.67.297 5.568-.628 6.383-3.364.246-.828.624-5.79.624-6.478 0-.69-.139-1.861-.902-2.206-.659-.298-1.664-.62-4.3 1.24C16.046 4.748 13.087 8.687 12 10.8z"/>
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Bluesky</p>
            <p className="text-xs text-[#86868b] dark:text-[#8e8e93]">Post each review to Bluesky with an embedded link</p>
          </div>
          {bluesky.connected && <span className="flex items-center gap-1 text-xs font-medium text-[#34c759]"><Check size={12} /> Connected</span>}
        </div>

        <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0] mb-3">
          Bluesky doesn&apos;t use OAuth yet — instead, you generate an <strong>App Password</strong> in Bluesky settings and paste it here.
        </p>
        <ol className="text-xs text-[#6e6e73] dark:text-[#ebebf0] mb-4 list-decimal ml-5 flex flex-col gap-1">
          <li>Open <a href="https://bsky.app/settings/app-passwords" target="_blank" rel="noopener noreferrer" className="text-[#7C3AED] hover:underline">bsky.app/settings/app-passwords</a></li>
          <li>Click <strong>Add App Password</strong> → name it &quot;MVP Affiliate&quot;</li>
          <li>Copy the password (only shown once)</li>
          <li>Paste it below along with your handle</li>
        </ol>

        {bsNotice && <p className={`text-xs mb-3 ${bsNotice.ok ? 'text-[#34c759]' : 'text-[#ff3b30]'}`}>{bsNotice.msg}</p>}

        {bluesky.connected ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-[#1d1d1f] dark:text-[#f5f5f7] flex items-center gap-2">
              <Link2 size={13} className="text-[#86868b] dark:text-[#8e8e93]" />
              Connected as <strong>@{bluesky.handle}</strong>
            </p>
            <button onClick={disconnectBluesky} disabled={bsDisconnecting} className="flex items-center gap-1.5 text-xs text-[#86868b] dark:text-[#8e8e93] hover:text-[#ff3b30] transition-colors self-start">
              {bsDisconnecting ? <Loader2 size={12} className="animate-spin" /> : <LogOut size={12} />} Disconnect
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <input
              type="text"
              value={bsHandle}
              onChange={(e) => setBsHandle(e.target.value)}
              placeholder="yourhandle.bsky.social"
              className="input-field"
              autoComplete="off"
            />
            <input
              type="password"
              value={bsAppPassword}
              onChange={(e) => setBsAppPassword(e.target.value)}
              placeholder="App Password (xxxx-xxxx-xxxx-xxxx)"
              className="input-field"
              autoComplete="off"
            />
            <button
              onClick={connectBluesky}
              disabled={bsConnecting || !bsHandle || !bsAppPassword}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white self-start transition-colors disabled:opacity-60"
              style={{ backgroundColor: '#1185fe' }}
            >
              {bsConnecting ? <Loader2 size={12} className="animate-spin" /> : (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="white">
                  <path d="M12 10.8c-1.087-2.114-4.046-6.053-6.798-7.995C2.566.944 1.561 1.266.902 1.565.139 1.908 0 3.08 0 3.768c0 .69.378 5.65.624 6.479.815 2.736 3.713 3.66 6.383 3.364-3.911.58-7.386 2.005-2.83 7.078 5.013 5.19 6.87-1.113 7.823-4.308.953 3.195 2.05 9.271 7.733 4.308 4.267-4.308 1.172-6.498-2.74-7.078 2.67.297 5.568-.628 6.383-3.364.246-.828.624-5.79.624-6.478 0-.69-.139-1.861-.902-2.206-.659-.298-1.664-.62-4.3 1.24C16.046 4.748 13.087 8.687 12 10.8z"/>
                </svg>
              )}
              {bsConnecting ? 'Connecting…' : 'Connect Bluesky'}
            </button>
          </div>
        )}
      </div>

      {/* Telegram — Pro */}
      <div className="card p-6">
        <div className="flex items-center gap-3 mb-4 pb-4 border-b border-gray-100 dark:border-white/10">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: '#229ED9' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="white">
              <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/>
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Telegram <span className="ml-1 text-[10px] font-medium text-[#7C3AED] uppercase tracking-wider">Pro</span></p>
            <p className="text-xs text-[#86868b] dark:text-[#8e8e93]">Fan out every review to your Telegram channel</p>
          </div>
          {telegram.connected && <span className="flex items-center gap-1 text-xs font-medium text-[#34c759]"><Check size={12} /> Connected</span>}
        </div>

        <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0] mb-3">
          We use one shared MVP Affiliate bot. You add it as an admin to your own Telegram channel, then paste your channel ID below.
        </p>
        <ol className="text-xs text-[#6e6e73] dark:text-[#ebebf0] mb-4 list-decimal ml-5 flex flex-col gap-1">
          <li>Create a Telegram channel (or use an existing one). New channels: open Telegram → menu → <strong>New Channel</strong>.</li>
          <li>Open the channel → tap the channel name → <strong>Administrators</strong> → <strong>Add Administrator</strong> → search for <strong>@MVPAffiliateBot</strong> (or whatever your bot is named) and add it with <strong>Post Messages</strong> permission.</li>
          <li>Set your channel to <strong>Public</strong> and give it a username (e.g. <code>@myreviews</code>) — easiest. Or grab the numeric ID from a tool like <a href="https://t.me/getidsbot" target="_blank" rel="noopener noreferrer" className="text-[#7C3AED] hover:underline">@getidsbot</a> if you want it private.</li>
          <li>Paste your channel ID below (<code>@myreviews</code> or the numeric form like <code>-1001234567890</code>).</li>
        </ol>

        {tgNotice && <p className={`text-xs mb-3 ${tgNotice.ok ? 'text-[#34c759]' : 'text-[#ff3b30]'}`}>{tgNotice.msg}</p>}

        {telegram.connected ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-[#1d1d1f] dark:text-[#f5f5f7] flex items-center gap-2">
              <Link2 size={13} className="text-[#86868b] dark:text-[#8e8e93]" />
              Connected to <strong>{telegram.channelTitle || telegram.channelId}</strong>{telegram.channelTitle && telegram.channelId ? ` (${telegram.channelId})` : ''}
            </p>
            <button onClick={disconnectTelegram} disabled={tgDisconnecting} className="flex items-center gap-1.5 text-xs text-[#86868b] dark:text-[#8e8e93] hover:text-[#ff3b30] transition-colors self-start">
              {tgDisconnecting ? <Loader2 size={12} className="animate-spin" /> : <LogOut size={12} />} Disconnect
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <input
              type="text"
              value={tgInput}
              onChange={(e) => setTgInput(e.target.value)}
              placeholder="@myreviews   or   -1001234567890"
              className="input-field"
              autoComplete="off"
            />
            <button
              onClick={connectTelegram}
              disabled={tgConnecting || !tgInput.trim()}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white self-start transition-colors disabled:opacity-60"
              style={{ backgroundColor: '#229ED9' }}
            >
              {tgConnecting ? <Loader2 size={12} className="animate-spin" /> : (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="white">
                  <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/>
                </svg>
              )}
              {tgConnecting ? 'Connecting…' : 'Connect Telegram'}
            </button>
          </div>
        )}
      </div>

      {/* Instagram — Pro */}
      {metaUnlocked && (
      <div className="card p-6">
        <div className="flex items-center gap-3 mb-4 pb-4 border-b border-gray-100 dark:border-white/10">
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center"
            style={{ background: 'linear-gradient(45deg, #f09433 0%, #e6683c 25%, #dc2743 50%, #cc2366 75%, #bc1888 100%)' }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="white">
              <path d="M12 0C8.74 0 8.333.015 7.053.072 5.775.132 4.905.333 4.14.63c-.789.306-1.459.717-2.126 1.384S.935 3.35.63 4.14C.333 4.905.131 5.775.072 7.053.012 8.333 0 8.74 0 12s.015 3.667.072 4.947c.06 1.277.261 2.148.558 2.913.306.788.717 1.459 1.384 2.126.667.666 1.336 1.079 2.126 1.384.766.296 1.636.499 2.913.558C8.333 23.988 8.74 24 12 24s3.667-.015 4.947-.072c1.277-.06 2.148-.262 2.913-.558.788-.306 1.459-.718 2.126-1.384.666-.667 1.079-1.335 1.384-2.126.296-.765.499-1.636.558-2.913.06-1.28.072-1.687.072-4.947s-.015-3.667-.072-4.947c-.06-1.277-.262-2.149-.558-2.913-.306-.789-.718-1.459-1.384-2.126C21.319 1.347 20.651.935 19.86.63c-.765-.297-1.636-.499-2.913-.558C15.667.012 15.26 0 12 0zm0 2.16c3.203 0 3.585.016 4.85.071 1.17.055 1.805.249 2.227.415.562.217.96.477 1.382.896.419.42.679.819.896 1.381.164.422.36 1.057.413 2.227.057 1.266.07 1.646.07 4.85s-.015 3.585-.074 4.85c-.061 1.17-.256 1.805-.421 2.227-.224.562-.479.96-.899 1.382-.419.419-.824.679-1.38.896-.42.164-1.065.36-2.235.413-1.274.057-1.649.07-4.859.07-3.211 0-3.586-.015-4.859-.074-1.171-.061-1.816-.256-2.236-.421-.569-.224-.96-.479-1.379-.899-.421-.419-.69-.824-.9-1.38-.165-.42-.359-1.065-.42-2.235-.045-1.26-.061-1.649-.061-4.844 0-3.196.016-3.586.061-4.861.061-1.17.255-1.814.42-2.234.21-.57.479-.96.9-1.381.419-.419.81-.689 1.379-.898.42-.166 1.051-.361 2.221-.421 1.275-.045 1.65-.06 4.859-.06l.045.03zm0 3.678c-3.405 0-6.162 2.76-6.162 6.162 0 3.405 2.76 6.162 6.162 6.162 3.405 0 6.162-2.76 6.162-6.162 0-3.405-2.76-6.162-6.162-6.162zM12 16c-2.21 0-4-1.79-4-4s1.79-4 4-4 4 1.79 4 4-1.79 4-4 4zm7.846-10.405c0 .795-.646 1.44-1.44 1.44-.795 0-1.44-.646-1.44-1.44 0-.794.646-1.439 1.44-1.439.793-.001 1.44.645 1.44 1.439z"/>
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Instagram <span className="ml-1 text-[10px] font-medium text-[#7C3AED] uppercase tracking-wider">Pro</span></p>
            <p className="text-xs text-[#86868b] dark:text-[#8e8e93]">Publish reviews as Reels, image Feed posts, or Stories — automatically</p>
          </div>
          {instagram.connected && <span className="flex items-center gap-1 text-xs font-medium text-[#34c759]"><Check size={12} /> Connected</span>}
        </div>

        {igNotice && <p className={`text-xs mb-3 ${igNotice.ok ? 'text-[#34c759]' : 'text-[#ff3b30]'}`}>{igNotice.msg}</p>}

        {instagram.connected ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-[#1d1d1f] dark:text-[#f5f5f7] flex items-center gap-2">
              <Link2 size={13} className="text-[#86868b] dark:text-[#8e8e93]" />
              Connected as <strong>@{instagram.username}</strong>
            </p>
            <div className="flex items-center gap-4">
              <a
                href="/api/auth/instagram"
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#bc1888] hover:underline self-start"
              >
                + Connect another account
              </a>
              <button onClick={disconnectInstagram} disabled={igDisconnecting} className="flex items-center gap-1.5 text-xs text-[#86868b] dark:text-[#8e8e93] hover:text-[#ff3b30] transition-colors self-start">
                {igDisconnecting ? <Loader2 size={12} className="animate-spin" /> : <LogOut size={12} />} Disconnect
              </button>
            </div>
            <p className="text-[11px] text-[#86868b] dark:text-[#8e8e93] leading-relaxed">
              Manage several Instagram accounts? Connect each one — you&apos;ll pick which to post to per review. Tip: on the Instagram screen, use &ldquo;Switch account&rdquo; to add a different one. The most recently connected becomes your default.
            </p>
          </div>
        ) : (
          isUnlocked('instagram') ? (
            <a
              href="/api/auth/instagram"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white self-start transition-opacity hover:opacity-90"
              style={{ background: 'linear-gradient(45deg, #f09433 0%, #e6683c 25%, #dc2743 50%, #cc2366 75%, #bc1888 100%)' }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="white">
                <path d="M12 0C8.74 0 8.333.015 7.053.072 5.775.132 4.905.333 4.14.63c-.789.306-1.459.717-2.126 1.384S.935 3.35.63 4.14C.333 4.905.131 5.775.072 7.053.012 8.333 0 8.74 0 12s.015 3.667.072 4.947c.06 1.277.261 2.148.558 2.913.306.788.717 1.459 1.384 2.126.667.666 1.336 1.079 2.126 1.384.766.296 1.636.499 2.913.558C8.333 23.988 8.74 24 12 24s3.667-.015 4.947-.072c1.277-.06 2.148-.262 2.913-.558.788-.306 1.459-.718 2.126-1.384.666-.667 1.079-1.335 1.384-2.126.296-.765.499-1.636.558-2.913.06-1.28.072-1.687.072-4.947s-.015-3.667-.072-4.947c-.06-1.277-.262-2.149-.558-2.913-.306-.789-.718-1.459-1.384-2.126C21.319 1.347 20.651.935 19.86.63c-.765-.297-1.636-.499-2.913-.558C15.667.012 15.26 0 12 0zm0 5.838c3.405 0 6.162 2.76 6.162 6.162 0 3.405-2.76 6.162-6.162 6.162-3.405 0-6.162-2.76-6.162-6.162 0-3.405 2.76-6.162 6.162-6.162zM12 16c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm7.846-10.405c0 .795-.646 1.44-1.44 1.44-.795 0-1.44-.646-1.44-1.44 0-.794.646-1.439 1.44-1.439.793-.001 1.44.645 1.44 1.439z"/>
              </svg>
              Connect Instagram
            </a>
          ) : (
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white self-start" style={{ ...lockedCta, background: 'linear-gradient(45deg, #f09433 0%, #e6683c 25%, #dc2743 50%, #cc2366 75%, #bc1888 100%)' }} title="Under approval — coming soon">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="white"><path d="M12 0C8.74 0 8.333.015 7.053.072 5.775.132 4.905.333 4.14.63c-.789.306-1.459.717-2.126 1.384S.935 3.35.63 4.14C.333 4.905.131 5.775.072 7.053.012 8.333 0 8.74 0 12s.015 3.667.072 4.947c.06 1.277.261 2.148.558 2.913.306.788.717 1.459 1.384 2.126.667.666 1.336 1.079 2.126 1.384.766.296 1.636.499 2.913.558C8.333 23.988 8.74 24 12 24s3.667-.015 4.947-.072c1.277-.06 2.148-.262 2.913-.558.788-.306 1.459-.718 2.126-1.384.666-.667 1.079-1.335 1.384-2.126.296-.765.499-1.636.558-2.913.06-1.28.072-1.687.072-4.947s-.015-3.667-.072-4.947c-.06-1.277-.262-2.149-.558-2.913-.306-.789-.718-1.459-1.384-2.126C21.319 1.347 20.651.935 19.86.63c-.765-.297-1.636-.499-2.913-.558C15.667.012 15.26 0 12 0zm0 5.838c3.405 0 6.162 2.76 6.162 6.162 0 3.405-2.76 6.162-6.162 6.162-3.405 0-6.162-2.76-6.162-6.162 0-3.405 2.76-6.162 6.162-6.162zM12 16c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm7.846-10.405c0 .795-.646 1.44-1.44 1.44-.795 0-1.44-.646-1.44-1.44 0-.794.646-1.439 1.44-1.439.793-.001 1.44.645 1.44 1.439z"/></svg>
              Connect Instagram
              <span className="ml-1 text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-white/25">Coming soon</span>
            </div>
          )
        )}
      </div>
      )}

      {/* TikTok — Pro feature. Direct Post via Content Posting API. */}
      <div className="card p-6">
        <div className="flex items-center gap-3 mb-4 pb-4 border-b border-gray-100 dark:border-white/10">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-[#000000]">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="white">
              <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5.8 20.1a6.34 6.34 0 0 0 10.86-4.43V8.45a8.16 8.16 0 0 0 4.77 1.52v-3.4a4.85 4.85 0 0 1-1.84-.34z" />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">TikTok <span className="ml-1 text-[10px] font-medium text-[#7C3AED] uppercase tracking-wider">Pro</span></p>
            <p className="text-xs text-[#86868b] dark:text-[#8e8e93]">Direct Post your vertical short reviews to your TikTok feed</p>
          </div>
          {tiktok.connected && <span className="flex items-center gap-1 text-xs font-medium text-[#34c759]"><Check size={12} /> Connected</span>}
        </div>

        {ttNotice && <p className={`text-xs mb-3 ${ttNotice.ok ? 'text-[#34c759]' : 'text-[#ff3b30]'}`}>{ttNotice.msg}</p>}

        {tiktok.connected ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-[#1d1d1f] dark:text-[#f5f5f7] flex items-center gap-2">
              {tiktok.avatarUrl
                ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={tiktok.avatarUrl} alt="" className="w-5 h-5 rounded-full" />
                )
                : <Link2 size={13} className="text-[#86868b] dark:text-[#8e8e93]" />
              }
              {/* Display name and username can both be blank for connections
                  that pre-date the user.info.profile scope we now request —
                  TikTok returns username only with user.info.profile. Fall
                  back gracefully so the card never reads as "Connected as @"
                  with an empty handle; existing users still see something
                  useful and a reconnect populates the richer fields. */}
              Connected as <strong>{tiktok.displayName || (tiktok.username ? `@${tiktok.username}` : 'your TikTok account')}</strong>
              {tiktok.username && tiktok.displayName && <span className="text-[#86868b] font-normal text-xs">· @{tiktok.username}</span>}
            </p>
            <button onClick={disconnectTiktok} disabled={ttDisconnecting} className="flex items-center gap-1.5 text-xs text-[#86868b] dark:text-[#8e8e93] hover:text-[#ff3b30] transition-colors self-start">
              {ttDisconnecting ? <Loader2 size={12} className="animate-spin" /> : <LogOut size={12} />} Disconnect
            </button>
            <p className="text-[11px] text-[#86868b] dark:text-[#8e8e93] leading-relaxed">
              On any post in <a href="/content" className="text-[#7C3AED] hover:underline">Content</a>, click <strong>Post to TikTok</strong> to open the publish screen — pick privacy, comment / duet / stitch, commercial-content disclosure, then post.
            </p>
          </div>
        ) : (
          isUnlocked('tiktok') ? (
            <a
              href="/api/auth/tiktok"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white self-start bg-[#000000] hover:bg-[#1c1c1e] transition-colors"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="white">
                <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5.8 20.1a6.34 6.34 0 0 0 10.86-4.43V8.45a8.16 8.16 0 0 0 4.77 1.52v-3.4a4.85 4.85 0 0 1-1.84-.34z" />
              </svg>
              Connect TikTok
            </a>
          ) : (
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white self-start bg-[#000000]" style={lockedCta} title="Under approval — coming soon">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="white"><path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5.8 20.1a6.34 6.34 0 0 0 10.86-4.43V8.45a8.16 8.16 0 0 0 4.77 1.52v-3.4a4.85 4.85 0 0 1-1.84-.34z" /></svg>
              Connect TikTok
              <span className="ml-1 text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-white/25">Coming soon</span>
            </div>
          )
        )}
      </div>

      {/* YouTube OAuth — for YouTube Studio (draft video metadata) */}
      <div className="card p-5 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-[#ff0000]/10">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="#ff0000"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>
            </div>
            <div>
              <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">YouTube Co-Pilot</p>
              <p className="text-xs text-[#86868b] dark:text-[#8e8e93]">Read draft videos and auto-generate metadata from ASINs</p>
            </div>
          </div>
          {youtubeOAuthConnected && <span className="flex items-center gap-1 text-xs font-medium text-[#34c759]"><Check size={12} /> Connected</span>}
        </div>
        <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0]">
          Click <strong>Connect YouTube</strong> and sign in with the Google account that owns your channel. This grants read access to your private and draft videos so the YouTube Co-Pilot can show them here, and write access to push generated titles, descriptions, and tags back to YouTube — saving you from copy-pasting manually.
        </p>
        <div className="rounded-lg border border-[#ff9500]/30 bg-[#ff9500]/5 px-3 py-2">
          <p className="text-[11px] text-[#1d1d1f] dark:text-[#f5f5f7] leading-relaxed">
            <strong>Naming convention — required:</strong> include the 10-character Amazon ASIN in the video file name or YouTube title before uploading. Example:{' '}
            <span className="font-mono bg-white dark:bg-[#1c1c1e] px-1.5 py-0.5 rounded border border-[#d2d2d7] dark:border-[#3a3a3c]">Vacuum - B08TT4YHG1</span>. Without an ASIN we can&apos;t identify the product or generate the package.
          </p>
        </div>
        {ytOAuthNotice && (
          <p className={`text-xs ${ytOAuthNotice.ok ? 'text-[#34c759]' : 'text-[#ff3b30]'}`}>{ytOAuthNotice.msg}</p>
        )}
        {youtubeOAuthConnected ? (
          <div className="flex flex-col gap-2">
            <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0]">
              Your Google account is connected. Visit <a href="/studio" className="text-[#7C3AED] hover:underline">YouTube Co-Pilot</a> to generate metadata for your draft videos.
            </p>
            <button onClick={disconnectYoutube} disabled={ytDisconnecting} className="flex items-center gap-1.5 text-xs text-[#86868b] dark:text-[#8e8e93] hover:text-[#ff3b30] transition-colors self-start">
              {ytDisconnecting ? <Loader2 size={12} className="animate-spin" /> : <LogOut size={12} />} Disconnect YouTube
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <a
              href="/api/auth/youtube"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white self-start transition-opacity hover:opacity-90"
              style={{ backgroundColor: '#ff0000' }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>
              Connect YouTube
            </a>
          </div>
        )}
      </div>

      {/* Google Search Console */}
      <div className="card p-5 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-[#4285F4]/10">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#4285F4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
            </div>
            <div>
              <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Google Search Console</p>
              <p className="text-xs text-[#86868b] dark:text-[#8e8e93]">See if posts are indexed + the searches that find them</p>
            </div>
          </div>
          {gscConnected && <span className="flex items-center gap-1 text-xs font-medium text-[#34c759]"><Check size={12} /> Connected</span>}
        </div>
        <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0]">
          Connect <strong>read-only</strong> Search Console so MVP can show whether each post is indexed by Google, its impressions, clicks and ranking, and the real queries readers use to find it — the data behind your SEO score and one-click fixes. We never write to your Search Console.
        </p>
        {gscNotice && (
          <p className={`text-xs ${gscNotice.ok ? 'text-[#34c759]' : 'text-[#ff3b30]'}`}>{gscNotice.msg}</p>
        )}
        {gscConnected ? (
          <div className="flex flex-col gap-2">
            <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0]">
              {gscProperty
                ? <>Tracking <span className="font-mono bg-white dark:bg-[#1c1c1e] px-1.5 py-0.5 rounded border border-[#d2d2d7] dark:border-[#3a3a3c]">{gscProperty}</span>.</>
                : 'Connected, but no matching property was found — confirm this site is a verified property in your Search Console account.'}
            </p>
            <button onClick={disconnectGsc} disabled={gscDisconnecting} className="flex items-center gap-1.5 text-xs text-[#86868b] dark:text-[#8e8e93] hover:text-[#ff3b30] transition-colors self-start">
              {gscDisconnecting ? <Loader2 size={12} className="animate-spin" /> : <LogOut size={12} />} Disconnect Search Console
            </button>
          </div>
        ) : (
          <a
            href="/api/auth/gsc"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white self-start transition-opacity hover:opacity-90"
            style={{ backgroundColor: '#4285F4' }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
            Connect Search Console
          </a>
        )}
      </div>

      {/* Geniuslink */}
      <div className="card p-5 flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-[#7C3AED]/10">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#7C3AED" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
          </div>
          <div>
            <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Geniuslink</p>
            <p className="text-xs text-[#86868b] dark:text-[#8e8e93]">Auto-create smart affiliate links from ASINs in YouTube Co-Pilot</p>
          </div>
          {geniuslinkKey && geniuslinkSecret && <span className="ml-auto flex items-center gap-1 text-xs font-medium text-[#34c759]"><Check size={12} /> Connected</span>}
        </div>
        <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0] mb-3">
          Geniuslink turns a plain Amazon product link into a geo-targeted short link (e.g. <code className="bg-[var(--surface-2)] px-1 rounded">geni.us/abc123</code>) that routes shoppers to their local Amazon store. To connect, log in to your Geniuslink account, go to <a href="https://app.geni.us/settings" target="_blank" rel="noopener noreferrer" className="text-[#7C3AED] hover:underline">app.geni.us/settings → Integrate with our API</a>, and copy your <strong>API Key</strong> and <strong>API Secret</strong>.
        </p>
        <div className="flex flex-col gap-3">
          <div>
            <label htmlFor="setup-geniuslink-key" className="block text-xs font-medium text-[#6e6e73] dark:text-[#ebebf0] mb-1">API Key</label>
            <input id="setup-geniuslink-key" name="geniuslink-key" type="text" value={geniuslinkKey} onChange={e => setGeniuslinkKey(e.target.value)} placeholder="e.g. e353413c5f52..." className="input-field text-xs font-mono" />
          </div>
          <div>
            <label htmlFor="setup-geniuslink-secret" className="block text-xs font-medium text-[#6e6e73] dark:text-[#ebebf0] mb-1">API Secret</label>
            <input id="setup-geniuslink-secret" name="geniuslink-secret" type="password" value={geniuslinkSecret} onChange={e => setGeniuslinkSecret(e.target.value)} placeholder="Your Geniuslink API secret" className="input-field text-xs font-mono" />
          </div>
        </div>
      </div>

      {/* Amazon Associates */}
      <div className="card p-5 flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-[#ff9900]/10 flex items-center justify-center flex-shrink-0">
            <span className="text-sm">🛒</span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Amazon Associates</p>
            <p className="text-xs text-[#86868b] dark:text-[#8e8e93]">Used as affiliate link fallback when Geniuslink isn't configured</p>
          </div>
          {amazonAssociatesTag && <span className="ml-auto flex items-center gap-1 text-xs font-medium text-[#34c759]"><Check size={12} /> Connected</span>}
        </div>
        <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0] mb-3">
          If you're not using Geniuslink, your Amazon Associates tracking tag is used as the fallback — it's appended to product URLs so you still earn commissions. Find your tag in <a href="https://affiliate-program.amazon.com/home/account/tag/manage" target="_blank" rel="noopener noreferrer" className="text-[#7C3AED] hover:underline">Amazon Associates → Account → Manage Tracking IDs</a>. It looks like <code className="bg-[var(--surface-2)] px-1 rounded">yourbrand-20</code>.
        </p>
        <div>
          <label htmlFor="setup-amazon-associates-tag" className="block text-xs font-medium text-[#6e6e73] dark:text-[#ebebf0] mb-1">Associates Tag</label>
          <input
            id="setup-amazon-associates-tag"
            name="amazon-associates-tag"
            type="text"
            value={amazonAssociatesTag}
            onChange={e => setAmazonAssociatesTag(e.target.value)}
            placeholder="e.g. yourtag-20"
            className="input-field text-xs font-mono"
          />
        </div>
      </div>

      {error && <p className="text-sm text-[#ff3b30] bg-[#ff3b30]/5 border border-[#ff3b30]/20 rounded-lg px-3 py-2">{error}</p>}

      <button onClick={save} disabled={saving} className="btn-primary self-start">
        {saved ? <><Check size={14} /> Saved!</> : saving ? <><Loader2 size={14} className="animate-spin" /> Saving…</> : <><Save size={14} /> Save</>}
      </button>
    </div>
  )
}

// ─── Wizard shell ─────────────────────────────────────────────────────────────
function SetupPageInner() {
  const searchParams = useSearchParams()
  const [tab, setTab] = useState<'wordpress' | 'integrations'>(
    searchParams.get('tab') === 'integrations' ? 'integrations' : 'wordpress'
  )

  // Keep tab in sync with the URL so sidebar links between "Blog Set Up"
  // and "Integrations" (both at /setup) actually switch tabs when clicked.
  useEffect(() => {
    const next = searchParams.get('tab') === 'integrations' ? 'integrations' : 'wordpress'
    setTab(prev => prev === next ? prev : next)
  }, [searchParams])
  const [mode, setMode] = useState<Mode>(null)
  const [step, setStep] = useState<Step>(1)
  const [wordpressUrl, setWordpressUrl] = useState('')
  const [accentColor, setAccentColor] = useState('#f5a623')
  const [siteUrl, setSiteUrl] = useState('')
  const [username, setUsername] = useState('')
  const [brandData, setBrandData] = useState<BrandData>(defaultBrand)
  const [hydrated, setHydrated] = useState(false)
  const [setupComplete, setSetupComplete] = useState(false)
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

  // ── Tab bar (always shown) ─────────────────────────────────────────────────
  const TabBar = () => (
    <div className="flex items-center gap-1 bg-[#f5f5f7] dark:bg-[#000] p-1 rounded-xl w-fit mb-6">
      {([
        { key: 'wordpress', label: 'WordPress' },
        { key: 'integrations', label: 'Integrations' },
      ] as const).map(({ key, label }) => (
        <button
          key={key}
          onClick={() => setTab(key)}
          className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
            tab === key
              ? 'bg-white dark:bg-[#1c1c1e] text-[#1d1d1f] dark:text-[#f5f5f7] shadow-apple-sm border border-gray-200/80 dark:border-white/10'
              : 'text-[#6e6e73] dark:text-[#ebebf0] hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7]'
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  )

  // ── Integrations tab ───────────────────────────────────────────────────────
  if (tab === 'integrations') {
    return (
      <div className="max-w-2xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] tracking-tight">Site & Integrations</h1>
        </div>
        <TabBar />
        <TutorialVideo sectionKey="integrations" />
        <IntegrationsPanel onLoad={() => {}} />
        {/* Multi-site WordPress manager — Pro feature. Renders only if the
            user has at least one WP site connected; otherwise the existing
            IntegrationsPanel above handles the empty-state connect flow. */}
        <WordPressSitesManager />

        {/* Connection doctor link — surfaces the diagnostic page that
            detects security plugins / CDN WAFs blocking writes. Always
            visible after Integrations so users can self-serve when
            anything goes wrong with WP. */}
        <div className="card p-4 mt-4 border border-gray-200 dark:border-white/10 flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Posting trouble?</p>
            <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0] mt-0.5 leading-relaxed">
              Run the connection doctor — it pinpoints the exact plugin or firewall blocking writes and gives you click-by-click fix steps.
            </p>
          </div>
          <a href="/setup/wp-doctor" className="btn-secondary text-xs flex-shrink-0">
            Run doctor →
          </a>
        </div>
      </div>
    )
  }

  // ── Already connected (WordPress tab) ─────────────────────────────────────
  if (setupComplete) {
    return (
      <div className="max-w-2xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] tracking-tight">Site & Integrations</h1>
        </div>
        <TabBar />
        <TutorialVideo sectionKey="blog-setup" />
        <div className="card p-6">
          <div className="flex items-center gap-3 mb-4 pb-4 border-b border-gray-100 dark:border-white/10">
            <div className="w-9 h-9 rounded-full bg-[#34c759]/10 flex items-center justify-center flex-shrink-0">
              <CheckCircle size={18} className="text-[#34c759]" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">WordPress connected</p>
              <p className="text-xs text-[#86868b] dark:text-[#8e8e93] truncate mt-0.5">{completedUrl || 'Your blog is ready to publish.'}</p>
            </div>
            <span className="flex items-center gap-1 text-xs font-medium text-[#34c759] flex-shrink-0">
              <Check size={12} /> Active
            </span>
          </div>
          <div className="flex items-center gap-3">
            {completedUrl && (
              <a href={completedUrl} target="_blank" rel="noopener noreferrer" className="btn-secondary text-xs">
                Visit blog <ExternalLink size={11} />
              </a>
            )}
            <button
              onClick={handleReset}
              className="flex items-center gap-1.5 text-xs text-[#86868b] dark:text-[#8e8e93] hover:text-[#ff3b30] transition-colors"
            >
              <LogOut size={12} /> Disconnect & connect a different site
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ── Mode picker ────────────────────────────────────────────────────────────
  if (mode === null) {
    return (
      <div className="max-w-2xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] tracking-tight">Site & Integrations</h1>
          <p className="text-sm text-[#6e6e73] dark:text-[#ebebf0] mt-0.5">Connect your affiliate blog to start publishing from YouTube.</p>
        </div>
        <TabBar />
        <TutorialVideo sectionKey="blog-setup" />
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
          <h1 className="text-2xl font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] tracking-tight">Site & Integrations</h1>
        </div>
        <TabBar />
        <TutorialVideo sectionKey="blog-setup" />
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
        <h1 className="text-2xl font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] tracking-tight">Site & Integrations</h1>
        <p className="text-sm text-[#6e6e73] dark:text-[#ebebf0] mt-0.5">Get your WordPress affiliate blog running in minutes.</p>
      </div>
      <TabBar />
      <TutorialVideo sectionKey="blog-setup" />

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

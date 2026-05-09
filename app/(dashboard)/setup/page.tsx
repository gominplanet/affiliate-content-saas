'use client'

import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import {
  ExternalLink, CheckCircle, ChevronRight, Loader2,
  Globe, Wrench, Sparkles, Link2, Rocket, Eye, EyeOff,
  Download, Upload, X,
} from 'lucide-react'
import { createBrowserClient } from '@/lib/supabase/client'

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
  { hex: '#0071e3', label: 'Blue' },
  { hex: '#34c759', label: 'Green' },
  { hex: '#ff3b30', label: 'Red' },
  { hex: '#af52de', label: 'Purple' },
  { hex: '#ff9f0a', label: 'Orange' },
  { hex: '#5856d6', label: 'Indigo' },
  { hex: '#ff2d55', label: 'Pink' },
]

const STORAGE_KEY = 'affiliateos_setup_v2'

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
                active ? 'bg-[#0071e3] text-white' :
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

// ─── Image upload component ───────────────────────────────────────────────────
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
            className={`w-20 h-20 border-2 border-dashed border-gray-300 hover:border-[#0071e3] bg-[#f5f5f7] dark:bg-[#000] flex flex-col items-center justify-center gap-1 transition-colors ${shape === 'circle' ? 'rounded-full' : 'rounded-xl'}`}
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

// ─── Step 1: Hostinger ────────────────────────────────────────────────────────
function Step1({ onNext }: { onNext: () => void }) {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-xl font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">Create your Hostinger account</h2>
        <p className="text-sm text-[#6e6e73] dark:text-[#ebebf0]">
          Hostinger is where your affiliate blog will live. You&apos;ll get a domain and fast hosting for under $3/month.
        </p>
      </div>
      <div className="card p-5 border border-[#0071e3]/20 bg-[#0071e3]/3">
        <div className="flex items-start gap-4">
          <div className="w-10 h-10 rounded-xl bg-[#0071e3]/10 flex items-center justify-center flex-shrink-0">
            <Globe size={20} className="text-[#0071e3]" />
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
              <span className="w-5 h-5 rounded-full bg-[#0071e3]/10 text-[#0071e3] text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">{i + 1}</span>
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

// ─── Step 2: Install WordPress + theme + plugins ──────────────────────────────
function Step2({ onNext }: { onNext: () => void }) {
  return (
    <div className="flex flex-col gap-8">
      <div>
        <h2 className="text-xl font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">Install WordPress, theme &amp; plugins</h2>
        <p className="text-sm text-[#6e6e73] dark:text-[#ebebf0]">
          Complete all three sections below before moving on. Each one takes about 2 minutes.
        </p>
      </div>

      {/* Part A — WordPress */}
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

      {/* Part B — Kadence theme */}
      <div className="flex flex-col gap-3">
        <p className="text-xs font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] uppercase tracking-wider">Part 2 — Install the Kadence theme</p>
        <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0]">
          This is the theme that powers your blog layout. Download the ZIP below, then upload it to WordPress.
        </p>
        <div className="p-4 rounded-xl bg-[#f5f5f7] dark:bg-[#000] flex flex-col gap-3">
          <a href="/api/wordpress/theme" download="kadence-affiliate-child.zip" className="btn-primary text-sm self-start inline-flex">
            <Download size={14} /> Download theme ZIP
          </a>
          <ol className="flex flex-col gap-2">
            {[
              'In your WordPress admin, go to Appearance → Themes.',
              'Click "Add New Theme" → "Upload Theme".',
              'Choose the ZIP file you just downloaded and click Install Now.',
              'Click "Activate" once it finishes.',
            ].map((text, i) => (
              <li key={i} className="flex items-start gap-2.5">
                <span className="w-4 h-4 rounded-full bg-[#0071e3]/10 text-[#0071e3] text-[10px] font-bold flex items-center justify-center flex-shrink-0 mt-0.5">{i + 1}</span>
                <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0]">{text}</p>
              </li>
            ))}
          </ol>
          <p className="text-[11px] text-[#86868b] dark:text-[#8e8e93]">
            To get to wp-admin: visit <span className="font-mono">yourdomain.com/wp-admin</span> and log in with the credentials you set in Part 1.
          </p>
        </div>
      </div>

      {/* Part C — Code Snippets plugin */}
      <div className="flex flex-col gap-3">
        <p className="text-xs font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] uppercase tracking-wider">Part 3 — Install the Code Snippets plugin</p>
        <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0]">
          Code Snippets is a free WordPress plugin that lets the tool install custom features on your blog automatically — things like your social links in the footer and your customization settings. Without it, the Launch step can&apos;t fully configure your site.
        </p>
        <div className="p-4 rounded-xl bg-[#f5f5f7] dark:bg-[#000] flex flex-col gap-3">
          <a
            href="https://wordpress.org/plugins/code-snippets/"
            target="_blank"
            rel="noopener noreferrer"
            className="btn-secondary text-sm self-start inline-flex"
          >
            View on WordPress.org <ExternalLink size={13} />
          </a>
          <ol className="flex flex-col gap-2">
            {[
              'In wp-admin, go to Plugins → Add New Plugin.',
              'Search for "Code Snippets" (by Code Snippets Pro).',
              'Click "Install Now", then "Activate".',
              'You\'ll see a new "Snippets" menu in the sidebar — that\'s it, nothing else to configure.',
            ].map((text, i) => (
              <li key={i} className="flex items-start gap-2.5">
                <span className="w-4 h-4 rounded-full bg-[#0071e3]/10 text-[#0071e3] text-[10px] font-bold flex items-center justify-center flex-shrink-0 mt-0.5">{i + 1}</span>
                <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0]">{text}</p>
              </li>
            ))}
          </ol>
        </div>
      </div>

      <button onClick={onNext} className="btn-primary self-start">Theme &amp; plugins installed <ChevronRight size={15} /></button>
    </div>
  )
}

// ─── Step 3: Brand customization ──────────────────────────────────────────────
function Step3({
  data, onChange, onNext,
}: {
  data: BrandData
  onChange: (d: BrandData) => void
  onNext: () => void
}) {
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

      {/* Logo + Headshot */}
      <div className="flex flex-col gap-5 p-5 bg-[#f5f5f7] dark:bg-[#000] rounded-xl">
        <p className="text-xs font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] uppercase tracking-wider">Visuals</p>
        <ImageUpload
          label="Brand logo"
          hint="Square or circle — shown as your site favicon and in the footer."
          shape="square"
          value={data.logo}
          onChange={v => set('logo', v)}
        />
        <ImageUpload
          label="Your photo / headshot"
          hint="Used on your About page to put a face to the brand."
          shape="circle"
          value={data.headshot}
          onChange={v => set('headshot', v)}
        />
      </div>

      {/* About */}
      <div className="flex flex-col gap-4 p-5 bg-[#f5f5f7] dark:bg-[#000] rounded-xl">
        <p className="text-xs font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] uppercase tracking-wider">About you</p>
        <div>
          <label className="block text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7] mb-1.5">About us / bio</label>
          <textarea
            value={data.aboutText}
            onChange={e => set('aboutText', e.target.value)}
            placeholder="Tell your story. What do you review, why should people trust you, what makes your take different?"
            rows={5}
            className="input-field resize-none"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7] mb-1.5">Contact email</label>
          <input
            type="email"
            value={data.contactEmail}
            onChange={e => set('contactEmail', e.target.value)}
            placeholder="hello@yourdomain.com"
            className="input-field"
          />
          <p className="text-xs text-[#86868b] dark:text-[#8e8e93] mt-1">Shown on your About page and Privacy Policy.</p>
        </div>
      </div>

      {/* Social links */}
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
            <label className="block text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7] mb-1.5">{label}</label>
            <input type="url" value={data[key] as string} onChange={e => set(key, e.target.value)} placeholder={placeholder} className="input-field" />
          </div>
        ))}
      </div>

      <button onClick={onNext} className="btn-primary self-start">
        Continue <ChevronRight size={15} />
      </button>
    </div>
  )
}

// ─── Step 4: Connect & Launch ─────────────────────────────────────────────────
function Step4({
  brandData,
  siteUrl, setSiteUrl,
  username, setUsername,
  accentColor, setAccentColor,
  onNext,
}: {
  brandData: BrandData
  siteUrl: string
  setSiteUrl: (v: string) => void
  username: string
  setUsername: (v: string) => void
  accentColor: string
  setAccentColor: (v: string) => void
  onNext: (url: string) => void
}) {
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [customHex, setCustomHex] = useState('')
  const [loading, setLoading] = useState(false)
  const [loadingStep, setLoadingStep] = useState('')
  const [error, setError] = useState<string | null>(null)

  const activeColor = customHex.match(/^#[0-9a-fA-F]{6}$/) ? customHex : accentColor
  const canSubmit = siteUrl.trim() && username.trim() && password.trim() && !loading

  async function handleLaunch() {
    let url = siteUrl.trim()
    if (!url.startsWith('http')) url = `https://${url}`
    url = url.replace(/\/wp-admin\/?.*$/, '').replace(/\/$/, '')
    setLoading(true)
    setError(null)
    setLoadingStep('Connecting to WordPress…')

    try {
      const res = await fetch('/api/wordpress/connect-and-setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          siteUrl: url,
          username: username.trim(),
          password: password.trim(),
          accentColor: activeColor,
          logoBase64: brandData.logo?.base64,
          logoMime: brandData.logo?.mime,
          logoFilename: brandData.logo?.filename,
          headshotBase64: brandData.headshot?.base64,
          headshotMime: brandData.headshot?.mime,
          headshotFilename: brandData.headshot?.filename,
          aboutText: brandData.aboutText || undefined,
          contactEmail: brandData.contactEmail || undefined,
          youtubeUrl: brandData.youtubeUrl || undefined,
          instagramUrl: brandData.instagramUrl || undefined,
          tiktokUrl: brandData.tiktokUrl || undefined,
          twitterUrl: brandData.twitterUrl || undefined,
          pinterestUrl: brandData.pinterestUrl || undefined,
          facebookUrl: brandData.facebookUrl || undefined,
        }),
      })
      setLoadingStep('Setting up your site…')
      const raw = await res.text()
      let data: Record<string, string> = {}
      try { data = JSON.parse(raw) } catch { throw new Error(`Server returned unexpected response: ${raw.slice(0, 300)}`) }
      if (!res.ok) throw new Error(data.error || 'Setup failed')
      onNext(url)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Setup failed. Check your credentials.')
    } finally {
      setLoading(false)
      setLoadingStep('')
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-xl font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">Connect &amp; launch your site</h2>
        <p className="text-sm text-[#6e6e73] dark:text-[#ebebf0]">
          Enter your WordPress credentials and pick your brand color. We&apos;ll build your site automatically.
        </p>
      </div>

      {/* Pre-flight checklist */}
      <div className="bg-[#f5f5f7] dark:bg-[#000] rounded-xl p-5">
        <p className="text-xs font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-3">Before you launch — quick check:</p>
        <ul className="flex flex-col gap-2">
          {[
            'WordPress is installed and you can log in to wp-admin',
            'The Kadence theme is installed and activated (from Step 2)',
            'The Code Snippets plugin is installed and activated (from Step 2)',
            'Your domain is live — not just "DNS propagating" (can take up to 24h after signup)',
          ].map((item, i) => (
            <li key={i} className="flex items-start gap-2">
              <span className="text-[#34c759] mt-0.5 flex-shrink-0">✓</span>
              <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0]">{item}</p>
            </li>
          ))}
        </ul>
      </div>

      {/* Credentials */}
      <div className="flex flex-col gap-4">
        <div>
          <label className="block text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7] mb-1.5">WordPress site URL</label>
          <input type="text" value={siteUrl} onChange={e => setSiteUrl(e.target.value)} placeholder="yourdomain.com" className="input-field" />
        </div>
        <div>
          <label className="block text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7] mb-1.5">WordPress username</label>
          <input type="text" value={username} onChange={e => setUsername(e.target.value)} placeholder="admin" className="input-field" />
        </div>
        <div>
          <label className="block text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7] mb-1.5">WordPress password</label>
          <div className="relative">
            <input
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="Your wp-admin login password"
              className="input-field pr-10"
            />
            <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#86868b] dark:text-[#8e8e93] hover:text-[#1d1d1f] dark:text-[#f5f5f7]">
              {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
          <p className="text-xs text-[#86868b] dark:text-[#8e8e93] mt-1">The password you set during WordPress installation (the one you use to log into <span className="font-mono">yourdomain.com/wp-admin</span>). Not an application password.</p>
        </div>
      </div>

      {/* Color picker */}
      <div>
        <label className="block text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7] mb-3">Accent color</label>
        <div className="flex flex-wrap gap-2.5 mb-3">
          {PRESET_COLORS.map(c => (
            <button
              key={c.hex}
              title={c.label}
              onClick={() => { setAccentColor(c.hex); setCustomHex('') }}
              className="w-8 h-8 rounded-full border-2 transition-all"
              style={{
                backgroundColor: c.hex,
                borderColor: accentColor === c.hex && !customHex.match(/^#[0-9a-fA-F]{6}$/) ? '#1d1d1f' : 'transparent',
                boxShadow: accentColor === c.hex && !customHex.match(/^#[0-9a-fA-F]{6}$/) ? `0 0 0 2px white, 0 0 0 4px ${c.hex}` : 'none',
              }}
            />
          ))}
        </div>
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-full border border-gray-200 dark:border-white/10 flex-shrink-0" style={{ backgroundColor: activeColor }} />
          <input
            type="text"
            value={customHex}
            onChange={e => setCustomHex(e.target.value)}
            placeholder="Custom hex e.g. #e63946"
            className="input-field max-w-[190px] font-mono text-sm"
          />
          <span className="text-xs font-bold uppercase tracking-widest px-3 py-1 rounded-full text-white flex-shrink-0" style={{ backgroundColor: activeColor }}>
            Preview
          </span>
        </div>
      </div>

      {error && (
        <p className="text-sm text-[#ff3b30] bg-[#ff3b30]/5 border border-[#ff3b30]/20 rounded-lg px-3 py-2">
          {error}
        </p>
      )}

      <div className="flex items-center gap-3">
        <button onClick={handleLaunch} disabled={!canSubmit} className="btn-primary">
          {loading
            ? <><Loader2 size={15} className="animate-spin" /> {loadingStep}</>
            : <><Sparkles size={15} /> Launch my site</>
          }
        </button>
        {!loading && <p className="text-xs text-[#86868b] dark:text-[#8e8e93]">~20 seconds</p>}
      </div>
    </div>
  )
}

// ─── Step 5: Done ─────────────────────────────────────────────────────────────
function Step5({ wordpressUrl, accentColor }: { wordpressUrl: string; accentColor: string }) {
  const router = useRouter()
  return (
    <div className="flex flex-col items-center gap-5 py-6 text-center">
      <div className="w-16 h-16 rounded-full flex items-center justify-center" style={{ backgroundColor: `${accentColor}25` }}>
        <CheckCircle size={32} style={{ color: accentColor }} />
      </div>
      <div>
        <h2 className="text-xl font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">Your site is live!</h2>
        <p className="text-sm text-[#6e6e73] dark:text-[#ebebf0]">
          Home page, About page, Privacy Policy, and navigation are all set up at{' '}
          <a href={wordpressUrl} target="_blank" rel="noopener noreferrer" className="text-[#0071e3] hover:underline font-medium">
            {wordpressUrl}
          </a>
        </p>
      </div>

      <div className="bg-[#f5f5f7] dark:bg-[#000] rounded-xl p-4 text-left w-full max-w-md">
        <p className="text-xs font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-2">What&apos;s next:</p>
        <ul className="text-xs text-[#6e6e73] dark:text-[#ebebf0] space-y-1.5 list-disc list-inside">
          <li>Finish your Brand Profile — tone, writing sample, CTA style</li>
          <li>Connect your YouTube channel in Settings</li>
          <li>Come back to Content and generate your first post</li>
        </ul>
      </div>

      <div className="flex gap-3">
        <a href={wordpressUrl} target="_blank" rel="noopener noreferrer" className="btn-secondary">
          View site <ExternalLink size={13} />
        </a>
        <button onClick={() => router.push('/brand')} className="btn-primary">
          Set up brand profile <ChevronRight size={15} />
        </button>
      </div>
    </div>
  )
}

// ─── Wizard shell ─────────────────────────────────────────────────────────────
export default function SetupPage() {
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

  // Check DB for existing WP connection + load local state
  useEffect(() => {
    async function init() {
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (user) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const { data: intRow } = await (supabase as any)
            .from('integrations')
            .select('wp_site_url')
            .eq('user_id', user.id)
            .single()
          if (intRow?.wp_site_url) {
            setSetupComplete(true)
            setCompletedUrl(intRow.wp_site_url)
            setHydrated(true)
            return
          }
        }
      } catch { /* ignore */ }

      try {
        const raw = localStorage.getItem(STORAGE_KEY)
        if (raw) {
          const d = JSON.parse(raw)
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

  // Persist state whenever it changes
  useEffect(() => {
    if (!hydrated) return
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        step, brandData, siteUrl, username, accentColor, wordpressUrl,
      }))
    } catch { /* ignore quota errors */ }
  }, [step, brandData, siteUrl, username, accentColor, wordpressUrl, hydrated])

  function handleReset() {
    try { localStorage.removeItem(STORAGE_KEY) } catch { /* ignore */ }
    setSetupComplete(false)
    setStep(1)
    setBrandData(defaultBrand)
    setSiteUrl('')
    setUsername('')
    setAccentColor('#f5a623')
    setWordpressUrl('')
  }

  if (!hydrated) return null

  if (setupComplete) {
    return (
      <div className="max-w-2xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] tracking-tight">Blog Setup</h1>
        </div>
        <div className="card p-8 flex flex-col items-center text-center gap-5">
          <div className="w-14 h-14 rounded-full bg-[#34c759]/10 flex items-center justify-center">
            <CheckCircle size={28} className="text-[#34c759]" />
          </div>
          <div>
            <h2 className="text-xl font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-2">Setup completed</h2>
            <p className="text-sm text-[#6e6e73] dark:text-[#ebebf0]">Your WordPress blog is connected and ready to publish content.</p>
          </div>
          <div className="flex gap-3 flex-wrap justify-center">
            <a href={completedUrl} target="_blank" rel="noopener noreferrer" className="btn-secondary flex items-center gap-2">
              Visit Blog <ExternalLink size={13} />
            </a>
            <button onClick={handleReset} className="btn-secondary text-[#ff3b30] border-[#ff3b30]/30 hover:border-[#ff3b30]">
              Reset Setup
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] tracking-tight">Blog Setup</h1>
        <p className="text-sm text-[#6e6e73] dark:text-[#ebebf0] mt-0.5">Get your WordPress affiliate blog running in minutes.</p>
      </div>

      <StepIndicator current={step} />

      <div className="card p-7">
        {step === 1 && <Step1 onNext={() => setStep(2)} />}
        {step === 2 && <Step2 onNext={() => setStep(3)} />}
        {step === 3 && (
          <Step3
            data={brandData}
            onChange={setBrandData}
            onNext={() => setStep(4)}
          />
        )}
        {step === 4 && (
          <Step4
            brandData={brandData}
            siteUrl={siteUrl}
            setSiteUrl={setSiteUrl}
            username={username}
            setUsername={setUsername}
            accentColor={accentColor}
            setAccentColor={setAccentColor}
            onNext={url => { setWordpressUrl(url); setStep(5) }}
          />
        )}
        {step === 5 && <Step5 wordpressUrl={wordpressUrl} accentColor={accentColor} />}
      </div>
    </div>
  )
}

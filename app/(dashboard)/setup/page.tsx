'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  ExternalLink, CheckCircle, ChevronRight, Loader2,
  Globe, Wrench, Link2, Rocket, Eye, EyeOff, Download, Sparkles,
} from 'lucide-react'

type Step = 1 | 2 | 3 | 4

const steps = [
  { n: 1, label: 'Create account', icon: Globe },
  { n: 2, label: 'Install WordPress', icon: Wrench },
  { n: 3, label: 'Connect & design', icon: Link2 },
  { n: 4, label: 'Done', icon: Rocket },
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

function StepIndicator({ current }: { current: Step }) {
  return (
    <div className="flex items-center mb-10">
      {steps.map((s, i) => {
        const done = current > s.n
        const active = current === s.n
        const Icon = s.icon
        return (
          <div key={s.n} className="flex items-center">
            <div className="flex flex-col items-center gap-1.5">
              <div className={`w-9 h-9 rounded-full flex items-center justify-center transition-colors ${
                done ? 'bg-[#34c759] text-white' :
                active ? 'bg-[#0071e3] text-white' :
                'bg-gray-100 text-[#86868b]'
              }`}>
                {done ? <CheckCircle size={18} /> : <Icon size={16} />}
              </div>
              <span className={`text-xs font-medium whitespace-nowrap ${active ? 'text-[#1d1d1f]' : 'text-[#86868b]'}`}>
                {s.label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div className={`w-16 h-px mx-2 mb-5 ${current > s.n ? 'bg-[#34c759]' : 'bg-gray-200'}`} />
            )}
          </div>
        )
      })}
    </div>
  )
}

// ─── Step 1: Create Hostinger account ────────────────────────────────────────
function Step1({ onNext }: { onNext: () => void }) {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-xl font-semibold text-[#1d1d1f] mb-1">Create your Hostinger account</h2>
        <p className="text-sm text-[#6e6e73]">
          Hostinger is where your affiliate blog will live. You'll get a domain and fast hosting for under $3/month.
        </p>
      </div>

      <div className="card p-5 border border-[#0071e3]/20 bg-[#0071e3]/3">
        <div className="flex items-start gap-4">
          <div className="w-10 h-10 rounded-xl bg-[#0071e3]/10 flex items-center justify-center flex-shrink-0">
            <Globe size={20} className="text-[#0071e3]" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-semibold text-[#1d1d1f] mb-0.5">Hostinger Web Hosting</p>
            <p className="text-xs text-[#6e6e73] mb-3">
              Includes a free domain name, 1-click WordPress installer, fast SSD hosting, and free SSL.
              The <strong>Premium</strong> plan is the sweet spot — enough for multiple sites.
            </p>
            <a
              href="https://geni.us/ANaArQ"
              target="_blank"
              rel="noopener noreferrer"
              className="btn-primary text-sm"
            >
              Get Hostinger → <ExternalLink size={13} />
            </a>
          </div>
        </div>
      </div>

      <div className="bg-[#f5f5f7] rounded-xl p-5">
        <p className="text-xs font-semibold text-[#1d1d1f] mb-3">What to do on Hostinger:</p>
        <ol className="flex flex-col gap-3">
          {[
            { n: 1, text: 'Click the link above and choose a hosting plan — Premium or Business recommended.' },
            { n: 2, text: 'During checkout, register a new domain name (included free for the first year).' },
            { n: 3, text: 'Complete payment and set up your account.' },
            { n: 4, text: 'Come back here — the next step will walk you through installing WordPress.' },
          ].map(({ n, text }) => (
            <li key={n} className="flex items-start gap-3">
              <span className="w-5 h-5 rounded-full bg-[#0071e3]/10 text-[#0071e3] text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">
                {n}
              </span>
              <p className="text-xs text-[#6e6e73]">{text}</p>
            </li>
          ))}
        </ol>
      </div>

      <div className="flex items-center gap-3">
        <button onClick={onNext} className="btn-primary">
          I have a Hostinger account <ChevronRight size={15} />
        </button>
        <p className="text-xs text-[#86868b]">Already signed up? Skip ahead.</p>
      </div>
    </div>
  )
}

// ─── Step 2: Install WordPress ────────────────────────────────────────────────
function Step2({ onNext }: { onNext: () => void }) {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-xl font-semibold text-[#1d1d1f] mb-1">Install WordPress on your domain</h2>
        <p className="text-sm text-[#6e6e73]">
          Hostinger has a built-in 1-click WordPress installer. Follow these steps inside hPanel.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        {[
          {
            n: 1,
            title: 'Log in to hPanel',
            desc: 'Go to hpanel.hostinger.com and sign in to your Hostinger account.',
            action: { label: 'Open hPanel', href: 'https://hpanel.hostinger.com' },
          },
          {
            n: 2,
            title: 'Click "WordPress" in the sidebar',
            desc: 'In the left menu, find the WordPress section and click it.',
          },
          {
            n: 3,
            title: 'Click "Install"',
            desc: 'Hit the Install button. Select your domain from the dropdown.',
          },
          {
            n: 4,
            title: 'Set your admin credentials',
            desc: 'Enter an admin username, email, and a strong password. Write these down — you\'ll need them.',
          },
          {
            n: 5,
            title: 'Click "Install" and wait',
            desc: 'WordPress installs in about 1–2 minutes. You\'ll see a success message when done.',
          },
        ].map(({ n, title, desc, action }) => (
          <div key={n} className="flex items-start gap-4 p-4 rounded-xl bg-[#f5f5f7]">
            <span className="w-6 h-6 rounded-full bg-[#1d1d1f] text-white text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">
              {n}
            </span>
            <div className="flex-1">
              <p className="text-sm font-medium text-[#1d1d1f] mb-0.5">{title}</p>
              <p className="text-xs text-[#6e6e73]">{desc}</p>
            </div>
            {action && (
              <a
                href={action.href}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-secondary text-xs px-3 py-1.5 flex-shrink-0"
              >
                {action.label} <ExternalLink size={11} />
              </a>
            )}
          </div>
        ))}
      </div>

      <button onClick={onNext} className="btn-primary self-start">
        WordPress is installed <ChevronRight size={15} />
      </button>
    </div>
  )
}

// ─── Step 3: Connect & Design ─────────────────────────────────────────────────
function Step3({ onNext }: { onNext: (url: string, color: string) => void }) {
  const [siteUrl, setSiteUrl] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [accentColor, setAccentColor] = useState('#f5a623')
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
        }),
      })
      setLoadingStep('Setting up your site…')
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Setup failed')
      onNext(url, activeColor)
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
        <h2 className="text-xl font-semibold text-[#1d1d1f] mb-1">Connect & design your site</h2>
        <p className="text-sm text-[#6e6e73]">
          Enter your WordPress login credentials and pick a color. We&apos;ll set everything up automatically.
        </p>
      </div>

      {/* Theme download */}
      <div className="bg-[#f5f5f7] rounded-xl p-5">
        <p className="text-xs font-semibold text-[#1d1d1f] mb-1">First: install the Kadence theme</p>
        <p className="text-xs text-[#6e6e73] mb-3">
          Download and upload this theme via WP Admin → Appearance → Themes → Add New → Upload Theme.
        </p>
        <a href="/api/wordpress/theme" download="kadence-affiliate-child.zip" className="btn-primary text-sm inline-flex">
          <Download size={14} /> Download theme ZIP
        </a>
      </div>

      {/* Credentials */}
      <div className="flex flex-col gap-4">
        <div>
          <label className="block text-sm font-medium text-[#1d1d1f] mb-1.5">WordPress site URL</label>
          <input
            type="text"
            value={siteUrl}
            onChange={(e) => setSiteUrl(e.target.value)}
            placeholder="yourdomain.com"
            className="input-field"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-[#1d1d1f] mb-1.5">WordPress username</label>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="admin"
            className="input-field"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-[#1d1d1f] mb-1.5">WordPress password</label>
          <div className="relative">
            <input
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Your wp-admin login password"
              className="input-field pr-10"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-[#86868b] hover:text-[#1d1d1f]"
            >
              {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
          <p className="text-xs text-[#86868b] mt-1">Same password you use to log into wp-admin. Never stored — used once to configure your site.</p>
        </div>
      </div>

      {/* Color picker */}
      <div>
        <label className="block text-sm font-medium text-[#1d1d1f] mb-3">Accent color</label>
        <div className="flex flex-wrap gap-2.5 mb-3">
          {PRESET_COLORS.map((c) => (
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
          <div className="w-7 h-7 rounded-full border border-gray-200 flex-shrink-0" style={{ backgroundColor: activeColor }} />
          <input
            type="text"
            value={customHex}
            onChange={(e) => setCustomHex(e.target.value)}
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
            : <><Sparkles size={15} /> Connect &amp; launch site</>
          }
        </button>
        {!loading && <p className="text-xs text-[#86868b]">~15 seconds</p>}
      </div>
    </div>
  )
}

// ─── Step 4: Done ─────────────────────────────────────────────────────────────
function Step4({ wordpressUrl, accentColor }: { wordpressUrl: string; accentColor: string }) {
  const router = useRouter()
  return (
    <div className="flex flex-col items-center gap-5 py-6 text-center">
      <div className="w-16 h-16 rounded-full flex items-center justify-center" style={{ backgroundColor: `${accentColor}25` }}>
        <CheckCircle size={32} style={{ color: accentColor }} />
      </div>
      <div>
        <h2 className="text-xl font-semibold text-[#1d1d1f] mb-1">Your site is live!</h2>
        <p className="text-sm text-[#6e6e73]">
          Home page, categories, and navigation are all set up at{' '}
          <a href={wordpressUrl} target="_blank" rel="noopener noreferrer" className="text-[#0071e3] hover:underline font-medium">
            {wordpressUrl}
          </a>
        </p>
      </div>

      <div className="bg-amber-50 border border-amber-200 rounded-xl p-5 text-left w-full max-w-md">
        <p className="text-xs font-semibold text-amber-900 mb-1">One manual step: assign the nav menu</p>
        <p className="text-xs text-amber-800 mb-2">Your category menu was created — just assign it to the header.</p>
        <ol className="text-xs text-amber-800 space-y-1">
          <li>1. WP Admin → Appearance → Menus</li>
          <li>2. Select your site&apos;s menu from the dropdown</li>
          <li>3. Check &quot;Primary Menu&quot; under Display location</li>
          <li>4. Save Menu</li>
        </ol>
        <a href={`${wordpressUrl}/wp-admin/nav-menus.php`} target="_blank" rel="noopener noreferrer" className="btn-secondary text-xs mt-3 inline-flex">
          Open Menu Settings <ExternalLink size={11} />
        </a>
      </div>

      <div className="bg-[#f5f5f7] rounded-xl p-4 text-left w-full max-w-md">
        <p className="text-xs font-semibold text-[#1d1d1f] mb-2">What&apos;s next:</p>
        <ul className="text-xs text-[#6e6e73] space-y-1.5 list-disc list-inside">
          <li>Set up your Brand Profile — name, niche, tone, writing sample</li>
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

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-[#1d1d1f] tracking-tight">Blog Setup</h1>
        <p className="text-sm text-[#6e6e73] mt-0.5">
          Get your WordPress affiliate blog running in minutes.
        </p>
      </div>

      <StepIndicator current={step} />

      <div className="card p-7">
        {step === 1 && <Step1 onNext={() => setStep(2)} />}
        {step === 2 && <Step2 onNext={() => setStep(3)} />}
        {step === 3 && (
          <Step3 onNext={(url, color) => { setWordpressUrl(url); setAccentColor(color); setStep(4) }} />
        )}
        {step === 4 && <Step4 wordpressUrl={wordpressUrl} accentColor={accentColor} />}
      </div>
    </div>
  )
}

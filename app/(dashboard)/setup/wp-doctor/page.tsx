'use client'

/**
 * WordPress Connection Doctor.
 *
 * Permanent diagnostic page that runs live tests against the user's
 * connected WordPress site(s) and surfaces fix instructions for any
 * detected security plugin / CDN / WAF that's blocking writes.
 *
 * Linked from:
 *   - Setup page (after the WordPress section)
 *   - WordPress publish error messages ("having trouble? Run the doctor")
 *   - WordPressSitesManager (per-site "Diagnose" button)
 *
 * The page is intentionally standalone — no auth-state changes happen
 * here, so a user can land directly and re-test until green without
 * affecting their connection.
 */
import { useEffect, useState } from 'react'
import Header from '@/components/layout/Header'
import { Loader2, CheckCircle2, AlertTriangle, AlertCircle, Info, RotateCw, ExternalLink, Key } from 'lucide-react'
import { SitePicker } from '@/components/SitePicker'
import { toast } from 'sonner'

interface PluginFix {
  id: string
  label: string
  summary: string
  steps: string[]
  severity: 'block' | 'warn' | 'info'
}

interface TestResult {
  id: string
  label: string
  ok: boolean | null
  status?: number
  detail?: string
}

interface DoctorResponse {
  healthy: boolean
  site: { name: string; url: string } | null
  namespaces: string[]
  fixes: PluginFix[]
  edgeBlock: PluginFix | null
  rawSnippet?: string
  tests: TestResult[]
  summary: string
}

export default function WpDoctorPage() {
  // Which connected site to diagnose. Multi-site users see a picker.
  // Single-site users get a hidden picker → defaults to their one site.
  const [siteId, setSiteId] = useState<string | null>(null)
  const [data, setData] = useState<DoctorResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function runDoctor() {
    setLoading(true)
    setError(null)
    try {
      const qs = siteId ? `?siteId=${encodeURIComponent(siteId)}` : ''
      const res = await fetch(`/api/wordpress/compat-check${qs}`)
      const json = await res.json()
      if (!res.ok) {
        setError((json as { error?: string }).error || `HTTP ${res.status}`)
        setData(null)
        return
      }
      setData(json as DoctorResponse)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Connection failed')
    } finally {
      setLoading(false)
    }
  }

  // Auto-run on mount + whenever the user picks a different site. The
  // SitePicker handles its own initial value selection, so we wait for
  // siteId to settle (it goes null → real value once /sites loads).
  useEffect(() => {
    runDoctor()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteId])

  return (
    <>
      <Header
        title="WordPress Connection Doctor"
        subtitle="Runs every check between MVP and your site, names the exact thing blocking writes, and gives you click-by-click fix steps."
      />

      {/* Site picker — hidden by default for single-site users. */}
      <div className="mb-4">
        <SitePicker value={siteId} onChange={setSiteId} label="Diagnose site" />
      </div>

      <PostingKeyPanel siteId={siteId} onSaved={runDoctor} />

      {/* ── Loading / error states ───────────────────────────────────── */}
      {loading && (
        <div className="card p-6 flex items-center gap-3">
          <Loader2 size={18} className="animate-spin text-[#7C3AED]" />
          <p className="text-sm text-[#1d1d1f] dark:text-[#f5f5f7]">Running checks against your WordPress site…</p>
        </div>
      )}

      {error && !loading && (
        <div className="card p-6 border border-[#ff3b30]/30 bg-[#ff3b30]/5">
          <p className="text-sm font-semibold text-[#ff3b30] flex items-center gap-2">
            <AlertCircle size={15} /> Doctor couldn&apos;t run
          </p>
          <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0] mt-1">{error}</p>
          <button onClick={runDoctor} className="btn-primary mt-3">
            <RotateCw size={13} /> Try again
          </button>
        </div>
      )}

      {/* ── Results ──────────────────────────────────────────────────── */}
      {data && !loading && (
        <>
          {/* Hero card — overall verdict + re-test button. */}
          <div
            className={`card p-5 mb-6 border ${
              data.healthy
                ? 'border-[#34c759]/30 bg-[#34c759]/5'
                : 'border-[#ff9500]/30 bg-[#ff9500]/5'
            }`}
          >
            <div className="flex items-start gap-3">
              {data.healthy ? (
                <CheckCircle2 size={20} className="text-[#34c759] mt-0.5 flex-shrink-0" />
              ) : (
                <AlertTriangle size={20} className="text-[#ff9500] mt-0.5 flex-shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">
                  {data.healthy ? 'All checks passed' : 'One or more checks failed'}
                </p>
                <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0] leading-relaxed">
                  {data.summary}
                </p>
                {data.site && (
                  <p className="text-[11px] text-[#86868b] mt-2">
                    Site: <a href={data.site.url} target="_blank" rel="noopener noreferrer" className="text-[#7C3AED] hover:underline inline-flex items-center gap-1">
                      {data.site.url} <ExternalLink size={10} />
                    </a>
                  </p>
                )}
              </div>
              <button onClick={runDoctor} className="btn-secondary text-xs flex-shrink-0">
                <RotateCw size={12} /> Re-test
              </button>
            </div>
          </div>

          {/* Test results — one row per check with a clear pass/fail. */}
          <div className="card p-5 mb-6">
            <h3 className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-3">Diagnostic checks</h3>
            <ul className="flex flex-col gap-2">
              {data.tests.map(t => (
                <li key={t.id} className="flex items-start gap-3 py-2 border-b border-gray-200 dark:border-white/5 last:border-0">
                  <div className="flex-shrink-0 mt-0.5">
                    {t.ok === true && <CheckCircle2 size={16} className="text-[#34c759]" />}
                    {t.ok === false && <AlertCircle size={16} className="text-[#ff3b30]" />}
                    {t.ok === null && <Info size={16} className="text-[#86868b]" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-[#1d1d1f] dark:text-[#f5f5f7]">{t.label}</p>
                    {t.detail && (
                      <p className="text-[11px] text-[#86868b] mt-0.5 font-mono break-all">
                        {t.status ? `HTTP ${t.status} — ` : ''}{t.detail}
                      </p>
                    )}
                    {t.ok === null && !t.detail && (
                      <p className="text-[11px] text-[#86868b] mt-0.5">Skipped (not applicable for this site)</p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>

          {/* Per-stack fix instructions. The first card here is what the
              user actually needs to do — block-severity fixes are
              surfaced first by the API. */}
          {data.fixes.length > 0 && (
            <div className="flex flex-col gap-4">
              <h3 className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">
                Recommended fixes ({data.fixes.length})
              </h3>
              {data.fixes.map(fix => (
                <FixCard key={fix.id} fix={fix} />
              ))}
            </div>
          )}

          {/* Edge-block snippet — when blocked, show what we received so
              support can confirm the WAF page they're hitting. */}
          {data.edgeBlock && data.rawSnippet && (
            <details className="card p-4 mt-4 text-xs">
              <summary className="cursor-pointer text-[#6e6e73] dark:text-[#ebebf0]">Raw response from /wp-json/ (for support)</summary>
              <pre className="mt-2 p-3 bg-gray-100 dark:bg-white/5 rounded overflow-auto text-[10px] font-mono whitespace-pre-wrap">{data.rawSnippet}</pre>
            </details>
          )}

          {/* Discovered REST namespaces — useful for support transparency
              and for the user to see what they have installed. */}
          {data.namespaces.length > 0 && (
            <details className="card p-4 mt-4 text-xs">
              <summary className="cursor-pointer text-[#6e6e73] dark:text-[#ebebf0]">
                Detected plugins ({data.namespaces.length} REST namespaces)
              </summary>
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {data.namespaces.map(ns => (
                  <li key={ns} className="px-2 py-0.5 rounded text-[10px] bg-gray-100 dark:bg-white/5 text-[#6e6e73] dark:text-[#ebebf0] font-mono">
                    {ns}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </>
  )
}

/** Single fix card with copy-friendly step-by-step instructions.
 *  Border + icon are color-coded by severity so users can immediately
 *  see which fix is the actual blocker vs which is informational. */
function FixCard({ fix }: { fix: PluginFix }) {
  const border = fix.severity === 'block'
    ? 'border-[#ff3b30]/30 bg-[#ff3b30]/5'
    : fix.severity === 'warn'
      ? 'border-[#ff9500]/30 bg-[#ff9500]/5'
      : 'border-gray-200 dark:border-white/10'
  const Icon = fix.severity === 'block' ? AlertCircle : fix.severity === 'warn' ? AlertTriangle : Info
  const iconColor = fix.severity === 'block' ? 'text-[#ff3b30]' : fix.severity === 'warn' ? 'text-[#ff9500]' : 'text-[#86868b]'

  return (
    <div className={`card p-5 border ${border}`}>
      <div className="flex items-start gap-3">
        <Icon size={18} className={`${iconColor} mt-0.5 flex-shrink-0`} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">{fix.label}</p>
          <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0] mt-0.5 leading-relaxed">{fix.summary}</p>
          <ol className="mt-3 flex flex-col gap-1.5">
            {fix.steps.map((s, i) => (
              <li key={i} className="text-xs text-[#1d1d1f] dark:text-[#f5f5f7] leading-relaxed flex gap-2">
                <span className="text-[#86868b] font-mono flex-shrink-0">{i + 1}.</span>
                <span className="flex-1">{s}</span>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </div>
  )
}

/**
 * Posting Key paste panel — for hosts where MVP can't auto-fetch the
 * proxy secret from /affiliateos/v1/status because the host strips the
 * Authorization header on requests. The user copies the key from their
 * wp-admin "MVP Affiliate Posting Key" admin notice and pastes it here.
 *
 * Always visible on this page so the user can self-serve without us
 * having to detect the auth-stripping condition first (the user already
 * landed here because something's broken — offering the manual key path
 * is strictly additive).
 *
 * After save: triggers a re-run of the doctor so the user sees the
 * connection turn green immediately.
 */
function PostingKeyPanel({ siteId, onSaved }: { siteId: string | null; onSaved: () => void }) {
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState('')
  const [saving, setSaving] = useState(false)

  async function save() {
    const cleaned = value.trim().toLowerCase()
    if (!cleaned) {
      toast.error('Paste the Posting Key first.')
      return
    }
    setSaving(true)
    try {
      const res = await fetch('/api/wordpress/posting-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ siteId: siteId || undefined, postingKey: cleaned }),
      })
      const json = await res.json()
      if (!res.ok) {
        toast.error(json.error || `HTTP ${res.status}`)
        return
      }
      toast.success('Posting Key saved. Re-running diagnostic…')
      setValue('')
      setOpen(false)
      onSaved()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="card p-4 mb-6 border border-[#7C3AED]/20 bg-[#7C3AED]/[0.03]">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between gap-3 text-left"
      >
        <div className="flex items-center gap-2">
          <Key size={14} className="text-[#7C3AED]" />
          <div>
            <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">
              Posting Key (for hosts that strip the Authorization header)
            </p>
            <p className="text-[11px] text-[#6e6e73] dark:text-[#ebebf0] mt-0.5">
              Some hosts (SiteGround, Hostinger LiteSpeed, certain Apache shared configs) drop the
              Authorization header on POST. If posting from MVP keeps failing with an auth error, paste
              your Posting Key from wp-admin here and we&apos;ll use a direct path that bypasses the header.
            </p>
          </div>
        </div>
        <span className="text-[11px] text-[#7C3AED] font-medium flex-shrink-0">
          {open ? '− Hide' : '+ Paste key'}
        </span>
      </button>

      {open && (
        <div className="mt-4 flex flex-col gap-3">
          <div className="text-xs text-[#6e6e73] dark:text-[#ebebf0] leading-relaxed">
            <p className="font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">Where to find your key</p>
            <ol className="list-decimal ml-4 flex flex-col gap-1">
              <li>Make sure your plugin is on <strong>v1.0.26 or newer</strong> (update from wp-admin → Plugins if not).</li>
              <li>Go to your <strong>WordPress Dashboard</strong> or <strong>Plugins</strong> page.</li>
              <li>Look for the violet notice labeled <strong>&ldquo;MVP Affiliate · Posting Key&rdquo;</strong>.</li>
              <li>Click <strong>Copy</strong> and paste below.</li>
            </ol>
          </div>
          <input
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="64-character hex key (a-f, 0-9)"
            className="w-full px-3 py-2.5 rounded-lg border border-gray-300 dark:border-white/10 bg-white dark:bg-white/5 text-sm font-mono text-[#1d1d1f] dark:text-[#f5f5f7] placeholder:text-[#86868b]/50 focus:outline-none focus:border-[#7C3AED]"
            spellCheck={false}
            autoCapitalize="none"
            autoCorrect="off"
          />
          <div className="flex items-center gap-2">
            <button
              onClick={save}
              disabled={saving}
              className="px-4 py-2 rounded-lg bg-[#7C3AED] hover:bg-[#6D28D9] text-sm font-medium text-white inline-flex items-center gap-1.5 disabled:opacity-50 transition-colors"
            >
              {saving ? <Loader2 size={13} className="animate-spin" /> : <Key size={13} />}
              {saving ? 'Saving…' : 'Save Posting Key'}
            </button>
            <button
              onClick={() => { setOpen(false); setValue('') }}
              className="px-3 py-2 rounded-lg text-sm text-[#6e6e73] dark:text-[#ebebf0] hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7]"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

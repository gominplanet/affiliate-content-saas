'use client'

// In-product, self-service troubleshooter for "my Facebook Page won't connect /
// the wrong one connected." Walks the user through their exact situation. For the
// Business-Manager case Facebook can't surface via OAuth (needs
// business_management, in App Review), it points them at the reliable fix:
// message support so we enable it for their account (add them as an app tester)
// while the review lands. The direct-token box is kept as an advanced fallback,
// but we no longer send people through the System Users flow — Meta now requires
// an app to be added to the Business portfolio before a System User can be
// created, so those steps dead-end at a grayed-out "Add".

import { useState } from 'react'
import { ChevronDown, Loader2, Wrench } from 'lucide-react'

type Situation = 'wrong' | 'missing' | null

export function FacebookFixHelper({
  connected,
  onConnected,
}: {
  connected: boolean
  onConnected: (page: { id: string; name: string }) => void
}) {
  const [open, setOpen] = useState(false)
  const [situation, setSituation] = useState<Situation>(null)
  const [showManual, setShowManual] = useState(false)

  // Manual connect (Business Manager token) state.
  const [token, setToken] = useState('')
  const [pageId, setPageId] = useState('')
  const [busy, setBusy] = useState(false)
  const [choices, setChoices] = useState<{ id: string; name: string }[] | null>(null)
  const [notice, setNotice] = useState<{ ok: boolean; msg: string } | null>(null)

  async function connectManual(pageIdOverride?: string) {
    setBusy(true)
    setNotice(null)
    try {
      const res = await fetch('/api/auth/facebook/connect-manual', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessToken: token.trim(), pageId: (pageIdOverride ?? pageId).trim() || undefined }),
      })
      const data = await res.json()
      if (data.needsPageChoice) {
        setChoices(data.pages || [])
        setNotice({ ok: false, msg: 'That token reaches more than one Page — pick which to connect.' })
        return
      }
      if (!res.ok || !data.ok) {
        setNotice({ ok: false, msg: data.error || 'Could not connect that Page.' })
        return
      }
      onConnected({ id: data.pageId, name: data.pageName })
      setNotice({ ok: true, msg: `Connected ${data.pageName}. You're all set.` })
      setToken(''); setPageId(''); setChoices(null)
    } catch (e) {
      setNotice({ ok: false, msg: e instanceof Error ? e.message : 'Could not connect that Page.' })
    } finally {
      setBusy(false)
    }
  }

  const Step = ({ n, children }: { n: number; children: React.ReactNode }) => (
    <li className="flex gap-2">
      <span className="flex-none w-4 h-4 mt-0.5 rounded-full bg-[#7C3AED] text-white text-[10px] font-bold flex items-center justify-center">{n}</span>
      <span>{children}</span>
    </li>
  )

  return (
    <div className="rounded-lg border border-gray-200 dark:border-white/10 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-3 py-2.5 text-left text-xs font-medium text-[#1d1d1f] dark:text-[#f5f5f7] hover:bg-black/[.02] dark:hover:bg-white/[.03]"
      >
        <Wrench size={13} className="text-[#7C3AED]" />
        Wrong Page, or your Page isn’t showing? Fix it here
        <ChevronDown size={14} className={`ml-auto transition-transform ${open ? 'rotate-180' : ''} text-[#86868b]`} />
      </button>

      {open && (
        <div className="px-3 pb-3 pt-1 border-t border-gray-100 dark:border-white/5 flex flex-col gap-3">
          {/* Situation picker */}
          <div>
            <p className="text-[11px] font-medium text-[#86868b] dark:text-[#8e8e93] mb-1.5">Which is happening?</p>
            <div className="flex flex-col gap-1.5">
              <button
                type="button"
                onClick={() => { setSituation('wrong'); setShowManual(false) }}
                className={`text-left text-xs px-3 py-2 rounded-md border transition-colors ${situation === 'wrong' ? 'border-[#7C3AED] bg-[#7C3AED]/5' : 'border-gray-200 dark:border-white/10 hover:border-[#7C3AED]/50'}`}
              >
                The wrong Page connected, but I can see my real Page in a list
              </button>
              <button
                type="button"
                onClick={() => { setSituation('missing'); setShowManual(false) }}
                className={`text-left text-xs px-3 py-2 rounded-md border transition-colors ${situation === 'missing' ? 'border-[#7C3AED] bg-[#7C3AED]/5' : 'border-gray-200 dark:border-white/10 hover:border-[#7C3AED]/50'}`}
              >
                My Page isn’t showing at all (or only the wrong one shows)
              </button>
            </div>
          </div>

          {/* Situation A — wrong page, list available */}
          {situation === 'wrong' && (
            <div className="text-xs text-[#1d1d1f] dark:text-[#f5f5f7] leading-relaxed rounded-md bg-black/[.02] dark:bg-white/[.03] p-3">
              <p className="font-medium mb-1.5">Easy fix:</p>
              <ol className="flex flex-col gap-1.5">
                <Step n={1}>Look for the <strong>Active page</strong> dropdown just above this box.</Step>
                <Step n={2}>Open it and choose the Page you actually want.</Step>
                <Step n={3}>That’s it — your posts now go to that Page.</Step>
              </ol>
              <p className="text-[11px] text-[#86868b] dark:text-[#8e8e93] mt-2">No dropdown, only one Page? Then your real Page didn’t come through — choose the option above instead.</p>
            </div>
          )}

          {/* Situation B — page missing */}
          {situation === 'missing' && (
            <div className="flex flex-col gap-3">
              <div className="text-xs text-[#1d1d1f] dark:text-[#f5f5f7] leading-relaxed rounded-md bg-black/[.02] dark:bg-white/[.03] p-3">
                <p className="font-medium mb-1.5">Step 1 — Reconnect and switch your Page ON (2 minutes):</p>
                <ol className="flex flex-col gap-1.5">
                  <Step n={1}>Click <strong>Disconnect</strong> below, then <strong>Connect Facebook</strong> again.</Step>
                  <Step n={2}>Facebook shows a blue screen: <em>“What do you want to allow MVP to access?”</em> with your Pages listed, each with a switch.</Step>
                  <Step n={3}>Switch <strong>ON</strong> the Page you want — or tap <strong>“Opt in to all”</strong> if you see it.</Step>
                  <Step n={4}>Tap <strong>Continue</strong>. Back in MVP, your Page should now appear to pick.</Step>
                </ol>
              </div>

              <div className="text-xs text-[#1d1d1f] dark:text-[#f5f5f7] leading-relaxed rounded-md bg-black/[.02] dark:bg-white/[.03] p-3">
                <p className="font-medium mb-1.5">Step 2 — Still missing? Your Page is inside a Business Manager.</p>
                <p className="text-[11px] text-[#86868b] dark:text-[#8e8e93] mb-2">Facebook hides those from apps. Pick the easier route for you:</p>

                <p className="font-medium">Option A (no tech — recommended):</p>
                <ol className="flex flex-col gap-1.5 mb-3">
                  <Step n={1}>Open your Facebook <strong>Page → Settings → Page access</strong>.</Step>
                  <Step n={2}>Under <strong>People with Facebook access</strong>, click <strong>Add New</strong>, add <strong>your own profile</strong>, give it <strong>full control</strong>, confirm with your password.</Step>
                  <Step n={3}>Come back here and do <strong>Step 1</strong> again. Your Page will now show up.</Step>
                </ol>

                <p className="font-medium mt-1">Still not showing? We&rsquo;ll switch it on for you.</p>
                <p className="text-[11px] text-[#86868b] dark:text-[#8e8e93] mb-2">
                  Business-Manager Pages need a Meta permission (<code>business_management</code>) that we&rsquo;re getting approved right now. Message us on the <strong>Help</strong> button (bottom-right of the app) and we&rsquo;ll enable it for your account the same day, then your Page appears here. Nothing technical needed on your end.
                </p>

                <button
                  type="button"
                  onClick={() => setShowManual(s => !s)}
                  className="text-[11px] font-medium text-[#7C3AED] hover:underline"
                >
                  {showManual ? 'Hide advanced option' : 'Advanced: connect directly with a Page token'}
                </button>

                {showManual && (
                  <div className="mt-2 flex flex-col gap-2">
                    <p className="text-[11px] text-[#86868b] dark:text-[#8e8e93]">
                      Only if you already have a <strong>Page access token</strong> (e.g. from Facebook&rsquo;s Graph API Explorer with <strong>pages_manage_posts</strong>). Most people should use the Help route above instead.
                    </p>
                    <input
                      type="text"
                      value={pageId}
                      onChange={e => setPageId(e.target.value)}
                      placeholder="Page ID (optional — only if it asks)"
                      className="input-field text-xs"
                    />
                    <textarea
                      value={token}
                      onChange={e => setToken(e.target.value)}
                      placeholder="Paste your Page or System-User access token"
                      rows={3}
                      className="input-field text-xs font-mono"
                    />
                    {choices && choices.length > 0 && (
                      <div className="flex flex-col gap-1">
                        <span className="text-[11px] text-[#86868b] dark:text-[#8e8e93]">Pick the Page to connect:</span>
                        {choices.map(p => (
                          <button
                            key={p.id}
                            type="button"
                            disabled={busy}
                            onClick={() => connectManual(p.id)}
                            className="text-left text-xs px-3 py-1.5 rounded-md border border-gray-200 dark:border-white/10 hover:border-[#7C3AED] disabled:opacity-50"
                          >
                            {p.name} <span className="text-[10px] text-[#86868b]">({p.id})</span>
                          </button>
                        ))}
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => connectManual()}
                      disabled={busy || token.trim().length < 20}
                      className="btn-primary text-xs self-start disabled:opacity-50 inline-flex items-center gap-1.5"
                    >
                      {busy && <Loader2 size={12} className="animate-spin" />} Connect this Page
                    </button>
                  </div>
                )}
              </div>

              {notice && (
                <p className={`text-[11px] ${notice.ok ? 'text-[#34c759]' : 'text-[#ff3b30]'}`}>{notice.msg}</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

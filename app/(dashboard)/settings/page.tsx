'use client'

import { useState, useEffect, useCallback } from 'react'
import Header from '@/components/layout/Header'
import { User, Key, Bell, Eye, EyeOff, Save, Check, Loader2, Wifi } from 'lucide-react'
import { createBrowserClient } from '@/lib/supabase/client'

type Tab = 'profile' | 'integrations' | 'notifications'

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-lg transition-colors ${
        active
          ? 'bg-white text-[#1d1d1f] shadow-apple-sm border border-gray-200/80'
          : 'text-[#6e6e73] hover:text-[#1d1d1f]'
      }`}
    >
      {children}
    </button>
  )
}

function SecretField({
  label, value, onChange, placeholder, hint,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder: string
  hint?: string
}) {
  const [show, setShow] = useState(false)
  return (
    <div>
      <label className="block text-sm font-medium text-[#1d1d1f] mb-1.5">{label}</label>
      <div className="relative">
        <input
          type={show ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="input-field pr-10 font-mono text-xs"
        />
        <button
          type="button"
          onClick={() => setShow(!show)}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-[#86868b] hover:text-[#1d1d1f]"
        >
          {show ? <EyeOff size={14} /> : <Eye size={14} />}
        </button>
      </div>
      {hint && <p className="text-xs text-[#86868b] mt-1">{hint}</p>}
    </div>
  )
}

function Toggle({ label, description, defaultChecked }: { label: string; description: string; defaultChecked?: boolean }) {
  const [checked, setChecked] = useState(defaultChecked ?? false)
  return (
    <div className="flex items-start justify-between gap-4 py-3 border-b border-gray-100 last:border-0">
      <div>
        <p className="text-sm font-medium text-[#1d1d1f]">{label}</p>
        <p className="text-xs text-[#86868b] mt-0.5">{description}</p>
      </div>
      <button
        onClick={() => setChecked(!checked)}
        className={`relative inline-flex h-5 w-9 items-center rounded-full flex-shrink-0 transition-colors ${
          checked ? 'bg-[#34c759]' : 'bg-gray-200'
        }`}
      >
        <span className={`inline-block h-4 w-4 rounded-full bg-white shadow-sm transform transition-transform ${
          checked ? 'translate-x-4.5' : 'translate-x-0.5'
        }`} />
      </button>
    </div>
  )
}

interface IntegrationData {
  youtube_channel_id: string
  wordpress_url: string
  wordpress_username: string
  wordpress_app_password: string
  wordpress_api_token: string
}

const DEFAULT_INTEGRATIONS: IntegrationData = {
  youtube_channel_id: '',
  wordpress_url: '',
  wordpress_username: '',
  wordpress_app_password: '',
  wordpress_api_token: '',
}

export default function SettingsPage() {
  const supabase = createBrowserClient()
  const [tab, setTab] = useState<Tab>('integrations')
  const [integrations, setIntegrations] = useState<IntegrationData>(DEFAULT_INTEGRATIONS)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [wpTesting, setWpTesting] = useState(false)
  const [wpTestResult, setWpTestResult] = useState<{ ok: boolean; message: string } | null>(null)

  const load = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const { data } = await supabase
      .from('integrations')
      .select('*')
      .eq('user_id', user.id)
      .single()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row = data as any
    if (row) {
      setIntegrations({
        youtube_channel_id: row.youtube_channel_id ?? '',
        wordpress_url: row.wordpress_url ?? '',
        wordpress_username: row.wordpress_username ?? '',
        wordpress_app_password: row.wordpress_app_password ?? '',
        wordpress_api_token: row.wordpress_api_token ?? '',
      })
    }
    setLoading(false)
  }, [supabase])

  useEffect(() => { load() }, [load])

  function setField(key: keyof IntegrationData, value: string) {
    setIntegrations((prev) => ({ ...prev, [key]: value }))
  }

  async function testWordPress() {
    setWpTesting(true)
    setWpTestResult(null)
    try {
      const res = await fetch('/api/wordpress/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: integrations.wordpress_url,
          username: integrations.wordpress_username,
          password: integrations.wordpress_app_password,
          apiToken: integrations.wordpress_api_token || undefined,
        }),
      })
      const data = await res.json()
      setWpTestResult({ ok: data.ok, message: data.message || data.error })
    } catch {
      setWpTestResult({ ok: false, message: 'Request failed — check your site URL' })
    } finally {
      setWpTesting(false)
    }
  }

  async function saveIntegrations() {
    setSaving(true)
    setError(null)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const { error: err } = await supabase.from('integrations').upsert(
      {
        user_id: user.id,
        youtube_channel_id: integrations.youtube_channel_id || null,
        wordpress_url: integrations.wordpress_url || null,
        wordpress_username: integrations.wordpress_username || null,
        wordpress_app_password: integrations.wordpress_app_password || null,
        wordpress_api_token: integrations.wordpress_api_token || null,
      },
      { onConflict: 'user_id' },
    )
    setSaving(false)
    if (err) {
      setError(err.message)
    } else {
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    }
  }

  return (
    <>
      <Header title="Settings" subtitle="Manage your account, integrations and notifications." />

      <div className="flex items-center gap-1 bg-[#f5f5f7] p-1 rounded-xl w-fit mb-6">
        <TabButton active={tab === 'profile'} onClick={() => setTab('profile')}>
          <User size={14} /> Profile
        </TabButton>
        <TabButton active={tab === 'integrations'} onClick={() => setTab('integrations')}>
          <Key size={14} /> Integrations
        </TabButton>
        <TabButton active={tab === 'notifications'} onClick={() => setTab('notifications')}>
          <Bell size={14} /> Notifications
        </TabButton>
      </div>

      {/* Integrations tab */}
      {tab === 'integrations' && (
        <div className="max-w-xl flex flex-col gap-5">
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-[#86868b] py-8">
              <Loader2 size={16} className="animate-spin" /> Loading…
            </div>
          ) : (
            <>
              {/* YouTube */}
              <div className="card p-6">
                <div className="flex items-center gap-3 mb-4 pb-4 border-b border-gray-100">
                  <div className="w-8 h-8 rounded-lg bg-red-50 flex items-center justify-center">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="#FF0000"><path d="M23.5 6.19a3.02 3.02 0 0 0-2.12-2.14C19.54 3.5 12 3.5 12 3.5s-7.54 0-9.38.55A3.02 3.02 0 0 0 .5 6.19C0 8.03 0 12 0 12s0 3.97.5 5.81a3.02 3.02 0 0 0 2.12 2.14C4.46 20.5 12 20.5 12 20.5s7.54 0 9.38-.55a3.02 3.02 0 0 0 2.12-2.14C24 15.97 24 12 24 12s0-3.97-.5-5.81zM9.75 15.5v-7l6.5 3.5-6.5 3.5z"/></svg>
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-[#1d1d1f]">YouTube</p>
                    <p className="text-xs text-[#86868b]">Paste your channel ID to sync videos</p>
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-[#1d1d1f] mb-1.5">Channel ID</label>
                  <input
                    type="text"
                    value={integrations.youtube_channel_id}
                    onChange={(e) => setField('youtube_channel_id', e.target.value)}
                    placeholder="UCxxxxxxxxxxxxxxx"
                    className="input-field font-mono text-xs"
                  />
                  <p className="text-xs text-[#86868b] mt-1">Found in your YouTube Studio → Settings → Channel → Advanced</p>
                </div>
              </div>

              {/* WordPress */}
              <div className="card p-6">
                <div className="flex items-center gap-3 mb-4 pb-4 border-b border-gray-100">
                  <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="#21759B"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/></svg>
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-[#1d1d1f]">WordPress</p>
                    <p className="text-xs text-[#86868b]">Auto-publish blog posts</p>
                  </div>
                </div>
                <div className="flex flex-col gap-4">
                  <div>
                    <label className="block text-sm font-medium text-[#1d1d1f] mb-1.5">WordPress Site URL</label>
                    <input
                      type="url"
                      value={integrations.wordpress_url}
                      onChange={(e) => setField('wordpress_url', e.target.value)}
                      placeholder="https://yourdomain.com"
                      className="input-field"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-[#1d1d1f] mb-1.5">WordPress Username</label>
                    <input
                      type="text"
                      value={integrations.wordpress_username}
                      onChange={(e) => setField('wordpress_username', e.target.value)}
                      placeholder="admin"
                      className="input-field"
                    />
                  </div>
                  <SecretField
                    label="Application Password"
                    value={integrations.wordpress_app_password}
                    onChange={(v) => setField('wordpress_app_password', v)}
                    placeholder="xxxx xxxx xxxx xxxx xxxx xxxx"
                    hint="WP Admin → Users → Profile → Application Passwords"
                  />
                  <SecretField
                    label={<>API Token <span className="text-xs font-normal text-[#86868b]">— recommended for Hostinger</span></>}
                    value={integrations.wordpress_api_token}
                    onChange={(v) => setField('wordpress_api_token', v)}
                    placeholder="ctt_k8mP2xQnR5vL9wJ3..."
                    hint="Set this in wp-config.php as CONTENT_TOOL_TOKEN and install the mu-plugin — bypasses host auth issues"
                  />
                  {/* Test connection */}
                  <div className="flex items-center gap-3 pt-1">
                    <button
                      type="button"
                      onClick={testWordPress}
                      disabled={wpTesting || !integrations.wordpress_url || !integrations.wordpress_username || !integrations.wordpress_app_password}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-gray-200 rounded-lg text-[#1d1d1f] hover:border-[#0071e3]/40 disabled:opacity-40 transition-colors"
                    >
                      {wpTesting ? <Loader2 size={12} className="animate-spin" /> : <Wifi size={12} />}
                      Test connection
                    </button>
                    {wpTestResult && (
                      <span className={`text-xs font-medium ${wpTestResult.ok ? 'text-[#34c759]' : 'text-[#ff3b30]'}`}>
                        {wpTestResult.message}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {error && (
                <p className="text-sm text-[#ff3b30] bg-[#ff3b30]/5 border border-[#ff3b30]/20 rounded-lg px-3 py-2">
                  {error}
                </p>
              )}

              <button onClick={saveIntegrations} disabled={saving} className="btn-primary self-start">
                {saved
                  ? <><Check size={14} /> Saved!</>
                  : saving
                  ? <><Loader2 size={14} className="animate-spin" /> Saving…</>
                  : <><Save size={14} /> Save</>
                }
              </button>
            </>
          )}
        </div>
      )}

      {/* Profile tab */}
      {tab === 'profile' && (
        <div className="max-w-xl flex flex-col gap-5">
          <div className="card p-6">
            <h2 className="text-sm font-semibold text-[#1d1d1f] mb-4">Personal Information</h2>
            <div className="flex flex-col gap-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-[#1d1d1f] mb-1.5">First name</label>
                  <input type="text" className="input-field" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[#1d1d1f] mb-1.5">Last name</label>
                  <input type="text" className="input-field" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-[#1d1d1f] mb-1.5">Email</label>
                <input type="email" className="input-field" />
              </div>
            </div>
          </div>
          <button className="btn-primary self-start"><Save size={14} /> Save changes</button>
        </div>
      )}

      {/* Notifications tab */}
      {tab === 'notifications' && (
        <div className="max-w-xl">
          <div className="card p-6">
            <h2 className="text-sm font-semibold text-[#1d1d1f] mb-4">Email Notifications</h2>
            <Toggle label="New video detected" description="Get notified when a new YouTube video is found." defaultChecked />
            <Toggle label="Blog post published" description="Confirmation when a post is published to WordPress." defaultChecked />
            <Toggle label="Draft ready for review" description="Alert when social drafts are waiting for approval." defaultChecked />
            <Toggle label="Job failures" description="Immediate alert when a generation or publishing job fails." defaultChecked />
            <Toggle label="Weekly digest" description="Weekly summary of your content pipeline." />
          </div>
        </div>
      )}
    </>
  )
}

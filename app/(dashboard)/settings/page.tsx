'use client'

import React, { useState, useEffect, useCallback, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import Header from '@/components/layout/Header'
import { Key, Eye, EyeOff, Save, Check, Loader2, Wifi, Facebook, Link2, LogOut, Pin, MessageCircle, CreditCard, Zap, CheckCircle } from 'lucide-react'
import { TIERS, type Tier } from '@/lib/tier'
import { createBrowserClient } from '@/lib/supabase/client'

type Tab = 'integrations' | 'billing'

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-lg transition-colors ${
        active
          ? 'bg-white dark:bg-[#1c1c1e] text-[#1d1d1f] dark:text-[#f5f5f7] shadow-apple-sm border border-gray-200/80 dark:border-white/10'
          : 'text-[#6e6e73] dark:text-[#ebebf0] hover:text-[#1d1d1f] dark:text-[#f5f5f7]'
      }`}
    >
      {children}
    </button>
  )
}

function SecretField({
  label, value, onChange, placeholder, hint,
}: {
  label: React.ReactNode
  value: string
  onChange: (v: string) => void
  placeholder: string
  hint?: string
}) {
  const [show, setShow] = useState(false)
  return (
    <div>
      <label className="block text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7] mb-1.5">{label}</label>
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
          className="absolute right-3 top-1/2 -translate-y-1/2 text-[#86868b] dark:text-[#8e8e93] hover:text-[#1d1d1f] dark:text-[#f5f5f7]"
        >
          {show ? <EyeOff size={14} /> : <Eye size={14} />}
        </button>
      </div>
      {hint && <p className="text-xs text-[#86868b] dark:text-[#8e8e93] mt-1">{hint}</p>}
    </div>
  )
}

function Toggle({ label, description, checked, onChange }: { label: string; description: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-start justify-between gap-4 py-3 border-b border-gray-100 last:border-0">
      <div>
        <p className="text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7]">{label}</p>
        <p className="text-xs text-[#86868b] dark:text-[#8e8e93] mt-0.5">{description}</p>
      </div>
      <button
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-5 w-9 items-center rounded-full flex-shrink-0 transition-colors ${
          checked ? 'bg-[#34c759]' : 'bg-gray-200'
        }`}
      >
        <span className={`inline-block h-4 w-4 rounded-full bg-white dark:bg-[#1c1c1e] shadow-sm transform transition-transform ${
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

interface FacebookData {
  connected: boolean
  pageName: string
  pageId: string
  pages: { id: string; name: string }[]
}

interface PinterestData {
  connected: boolean
  boardId: string
  boardName: string
  boards: { id: string; name: string }[]
}

interface ThreadsData {
  connected: boolean
  userId: string
  username?: string
}

const DEFAULT_INTEGRATIONS: IntegrationData = {
  youtube_channel_id: '',
  wordpress_url: '',
  wordpress_username: '',
  wordpress_app_password: '',
  wordpress_api_token: '',
}

function ManualFacebookToken({ onConnected }: { onConnected: () => void }) {
  const [token, setToken] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    if (!token.trim()) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/auth/facebook/manual-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pageAccessToken: token.trim() }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to save token')
      onConnected()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0]">
        Paste your Facebook Page Access Token below.{' '}
        <a
          href="https://developers.facebook.com/tools/explorer/"
          target="_blank"
          rel="noopener noreferrer"
          className="text-[#0071e3] hover:underline"
        >
          Get it from Graph API Explorer →
        </a>
      </p>
      <input
        type="text"
        value={token}
        onChange={(e) => setToken(e.target.value)}
        placeholder="EAAxxxxxxx..."
        className="input-field font-mono text-xs"
      />
      {error && <p className="text-xs text-[#ff3b30]">{error}</p>}
      <button
        onClick={save}
        disabled={saving || !token.trim()}
        className="flex items-center gap-2 px-4 py-2 bg-[#1877F2] text-white text-sm font-medium rounded-lg hover:bg-[#1877F2]/90 transition-colors self-start disabled:opacity-50"
      >
        {saving ? <Loader2 size={14} className="animate-spin" /> : <Facebook size={14} />}
        {saving ? 'Connecting…' : 'Connect Page'}
      </button>
    </div>
  )
}

function ManualThreadsToken({ onConnected }: { onConnected: (username: string) => void }) {
  const [token, setToken] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    if (!token.trim()) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/auth/threads/manual-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessToken: token.trim() }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to save token')
      onConnected(data.username)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0]">
        Generate a long-lived token in the{' '}
        <a href="https://developers.facebook.com" target="_blank" rel="noopener noreferrer" className="text-[#0071e3] hover:underline">
          Meta Developer Portal
        </a>
        {' '}→ MVP FLOW → Threads API → Settings → User Token Generator, then paste it below.
      </p>
      <input
        type="text"
        value={token}
        onChange={(e) => setToken(e.target.value)}
        placeholder="THQWJh..."
        className="input-field font-mono text-xs"
      />
      {error && <p className="text-xs text-[#ff3b30]">{error}</p>}
      <button
        onClick={save}
        disabled={saving || !token.trim()}
        className="flex items-center gap-2 px-4 py-2 bg-[#1d1d1f] text-white text-sm font-medium rounded-lg hover:bg-black transition-colors self-start disabled:opacity-50"
      >
        {saving ? <Loader2 size={14} className="animate-spin" /> : <MessageCircle size={14} />}
        {saving ? 'Connecting…' : 'Connect Threads'}
      </button>
    </div>
  )
}

function BillingTab({ tier }: { tier: Tier }) {
  const [portalLoading, setPortalLoading] = useState(false)
  const [checkoutLoading, setCheckoutLoading] = useState<string | null>(null)
  const currentTier = TIERS[tier]
  const isPaid = tier !== 'free' && tier !== 'admin'

  async function openPortal() {
    setPortalLoading(true)
    const res = await fetch('/api/stripe/portal', { method: 'POST' })
    const { url, error } = await res.json()
    if (error) { alert(error); setPortalLoading(false); return }
    window.location.href = url
  }

  async function upgrade(t: string) {
    setCheckoutLoading(t)
    const res = await fetch('/api/stripe/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tier: t }),
    })
    const { url, error } = await res.json()
    if (error) { alert(error); setCheckoutLoading(null); return }
    window.location.href = url
  }

  return (
    <div className="max-w-xl flex flex-col gap-5">
      {/* Current plan */}
      <div className="card p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Current Plan</h2>
          {isPaid && (
            <button
              onClick={openPortal}
              disabled={portalLoading}
              className="text-xs text-[#0071e3] hover:underline disabled:opacity-60 flex items-center gap-1"
            >
              {portalLoading ? <Loader2 size={11} className="animate-spin" /> : null}
              Manage subscription
            </button>
          )}
        </div>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#0071e3]/10 flex items-center justify-center">
            <Zap size={18} className="text-[#0071e3]" />
          </div>
          <div>
            <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">{currentTier.label}</p>
            <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0]">
              {'lifetimeMax' in currentTier && currentTier.lifetimeMax
                ? `${currentTier.lifetimeMax} posts total (free trial)`
                : currentTier.videosPerWeek
                ? `${currentTier.videosPerWeek} videos / week`
                : currentTier.videosPerDay
                ? `${currentTier.videosPerDay} video${currentTier.videosPerDay > 1 ? 's' : ''} / day`
                : 'Unlimited'}
              {currentTier.price > 0 ? ` · $${currentTier.price}/month` : ''}
            </p>
          </div>
        </div>
      </div>

      {/* Upgrade options */}
      {tier !== 'admin' && (
        <div className="card p-6">
          <h2 className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-4">
            {isPaid ? 'Change plan' : 'Upgrade your plan'}
          </h2>
          <div className="flex flex-col gap-3">
            {(['starter', 'growth', 'pro'] as Tier[]).filter(t => t !== tier && t !== 'free' && t !== 'admin').map((t) => {
              const plan = TIERS[t]
              return (
                <div key={t} className="flex items-center justify-between p-4 rounded-xl border border-gray-200 dark:border-white/10 hover:border-[#0071e3]/40 transition-colors">
                  <div>
                    <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">{plan.label}</p>
                    <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0]">
                      {plan.videosPerWeek ? `Up to ${plan.videosPerWeek} videos/week` : `Up to ${plan.videosPerDay} video${(plan.videosPerDay ?? 0) > 1 ? 's' : ''}/day`}
                      {' · '}${plan.price}/month
                    </p>
                  </div>
                  <button
                    onClick={() => upgrade(t)}
                    disabled={checkoutLoading === t}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold bg-[#0071e3] text-white hover:bg-[#0062c4] disabled:opacity-60 transition-colors"
                  >
                    {checkoutLoading === t ? <Loader2 size={11} className="animate-spin" /> : <CheckCircle size={11} />}
                    {checkoutLoading === t ? 'Redirecting…' : 'Select'}
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

function SettingsPage() {
  const supabase = createBrowserClient()
  const searchParams = useSearchParams()
  const [tab, setTab] = useState<Tab>('integrations')
  const [integrations, setIntegrations] = useState<IntegrationData>(DEFAULT_INTEGRATIONS)
  const [facebook, setFacebook] = useState<FacebookData>({ connected: false, pageName: '', pageId: '', pages: [] })
  const [fbDisconnecting, setFbDisconnecting] = useState(false)
  const [fbNotice, setFbNotice] = useState<{ ok: boolean; msg: string } | null>(null)
  const [pinterest, setPinterest] = useState<PinterestData>({ connected: false, boardId: '', boardName: '', boards: [] })
  const [ptDisconnecting, setPtDisconnecting] = useState(false)
  const [ptNotice, setPtNotice] = useState<{ ok: boolean; msg: string } | null>(null)
  const [threads, setThreads] = useState<ThreadsData>({ connected: false, userId: '', username: '' })
  const [thDisconnecting, setThDisconnecting] = useState(false)
  const [thNotice, setThNotice] = useState<{ ok: boolean; msg: string } | null>(null)
  const [tier, setTier] = useState<Tier>('starter')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [wpTesting, setWpTesting] = useState(false)
  const [wpTestResult, setWpTestResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [fixingCss, setFixingCss] = useState(false)
  const [fixCssResult, setFixCssResult] = useState<string | null>(null)
  const [fixingThumbs, setFixingThumbs] = useState(false)
  const [fixThumbsResult, setFixThumbsResult] = useState<string | null>(null)



  const load = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (supabase as any)
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
      const pages = JSON.parse(row.facebook_pages_json || '[]')
      setFacebook({
        connected: !!row.facebook_page_id,
        pageName: row.facebook_page_name ?? '',
        pageId: row.facebook_page_id ?? '',
        pages,
      })
      const boards = JSON.parse(row.pinterest_boards_json || '[]')
      setPinterest({
        connected: !!row.pinterest_access_token && !!row.pinterest_board_id,
        boardId: row.pinterest_board_id ?? '',
        boardName: row.pinterest_board_name ?? '',
        boards,
      })
      setThreads({
        connected: !!row.threads_access_token,
        userId: row.threads_user_id ?? '',
        username: row.threads_username ?? '',
      })
      setTier((row.tier as Tier) ?? 'free')
    }
    setLoading(false)
  }, [supabase])

  const loadProfile = useCallback(async () => {
    const res = await fetch('/api/profile')
    if (!res.ok) return
    const data = await res.json()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Handle OAuth redirect params
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
    if (thConnected) setThNotice({ ok: true, msg: 'Threads connected!' })
    if (thError) setThNotice({ ok: false, msg: `Threads error: ${thError}` })
  }, [searchParams])

  useEffect(() => { load() }, [load])
  useEffect(() => { loadProfile() }, [loadProfile])

  function setField(key: keyof IntegrationData, value: string) {
    setIntegrations((prev) => ({ ...prev, [key]: value }))
  }

  function connectFacebook() {
    window.location.href = '/api/auth/facebook'
  }

  async function disconnectFacebook() {
    setFbDisconnecting(true)
    await fetch('/api/auth/facebook/disconnect', { method: 'POST' })
    setFacebook({ connected: false, pageName: '', pageId: '', pages: [] })
    setFbDisconnecting(false)
  }

  async function selectFacebookPage(pageId: string) {
    const res = await fetch('/api/auth/facebook/select-page', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pageId }),
    })
    const data = await res.json()
    if (data.ok) {
      setFacebook((prev) => ({ ...prev, pageId: data.page.id, pageName: data.page.name }))
    }
  }

  function connectPinterest() {
    window.location.href = '/api/auth/pinterest'
  }

  async function disconnectPinterest() {
    setPtDisconnecting(true)
    await fetch('/api/auth/pinterest/disconnect', { method: 'POST' })
    setPinterest({ connected: false, boardId: '', boardName: '', boards: [] })
    setPtDisconnecting(false)
  }

  async function selectPinterestBoard(boardId: string) {
    const board = pinterest.boards.find((b) => b.id === boardId)
    if (!board) return
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase as any).from('integrations').update({
      pinterest_board_id: board.id,
      pinterest_board_name: board.name,
    }).eq('user_id', user.id)
    setPinterest((prev) => ({ ...prev, boardId: board.id, boardName: board.name }))
  }

  function connectThreads() {
    window.location.href = '/api/auth/threads'
  }

  async function disconnectThreads() {
    setThDisconnecting(true)
    await fetch('/api/auth/threads/disconnect', { method: 'POST' })
    setThreads({ connected: false, userId: '', username: '' })
    setThDisconnecting(false)
  }

  async function fixCssCorruption() {
    setFixingCss(true)
    setFixCssResult(null)
    try {
      const res = await fetch('/api/wordpress/fix-css-corruption', { method: 'POST' })
      const data = await res.json()
      if (data.error) {
        setFixCssResult(`Error: ${data.error}`)
      } else if (data.affected === 0) {
        setFixCssResult('No corrupted posts found — all clean!')
      } else {
        setFixCssResult(`Fixed ${data.fixed} of ${data.affected} affected post${data.affected !== 1 ? 's' : ''}.`)
      }
    } catch {
      setFixCssResult('Request failed.')
    } finally {
      setFixingCss(false)
    }
  }

  async function fixThumbnails() {
    setFixingThumbs(true)
    setFixThumbsResult(null)
    try {
      const res = await fetch('/api/wordpress/fix-thumbnails', { method: 'POST' })
      const data = await res.json()
      if (data.error) {
        setFixThumbsResult(`Error: ${data.error}`)
      } else {
        setFixThumbsResult(`Fixed ${data.fixed} thumbnail${data.fixed !== 1 ? 's' : ''} (${data.skipped} already good, ${data.failed} failed).`)
      }
    } catch {
      setFixThumbsResult('Request failed.')
    } finally {
      setFixingThumbs(false)
    }
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
      <Header title="Settings" subtitle="Manage your account and integrations." />

      <div className="flex items-center gap-1 bg-[#f5f5f7] dark:bg-[#000] p-1 rounded-xl w-fit mb-6">
        <TabButton active={tab === 'integrations'} onClick={() => setTab('integrations')}>
          <Key size={14} /> Integrations
        </TabButton>

        <TabButton active={tab === 'billing'} onClick={() => setTab('billing')}>
          <CreditCard size={14} /> Billing
        </TabButton>
      </div>

      {/* Integrations tab */}
      {tab === 'integrations' && (
        <div className="max-w-xl flex flex-col gap-5">
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-[#86868b] dark:text-[#8e8e93] py-8">
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
                    <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">YouTube</p>
                    <p className="text-xs text-[#86868b] dark:text-[#8e8e93]">Paste your channel ID to sync videos</p>
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7] mb-1.5">Channel ID</label>
                  <input
                    type="text"
                    value={integrations.youtube_channel_id}
                    onChange={(e) => setField('youtube_channel_id', e.target.value)}
                    placeholder="UCxxxxxxxxxxxxxxx"
                    className="input-field font-mono text-xs"
                  />
                  <p className="text-xs text-[#86868b] dark:text-[#8e8e93] mt-1">Found in your YouTube Studio → Settings → Channel → Advanced</p>
                </div>
              </div>

              {/* WordPress */}
              <div className="card p-6">
                <div className="flex items-center gap-3 mb-4 pb-4 border-b border-gray-100">
                  <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="#21759B"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/></svg>
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">WordPress</p>
                    <p className="text-xs text-[#86868b] dark:text-[#8e8e93]">Auto-publish blog posts</p>
                  </div>
                </div>
                <div className="flex flex-col gap-4">
                  <div>
                    <label className="block text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7] mb-1.5">WordPress Site URL</label>
                    <input
                      type="url"
                      value={integrations.wordpress_url}
                      onChange={(e) => setField('wordpress_url', e.target.value)}
                      placeholder="https://yourdomain.com"
                      className="input-field"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7] mb-1.5">WordPress Username</label>
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
                    label={<>API Token <span className="text-xs font-normal text-[#86868b] dark:text-[#8e8e93]">— recommended for Hostinger</span></>}
                    value={integrations.wordpress_api_token}
                    onChange={(v) => setField('wordpress_api_token', v)}
                    placeholder="ctt_k8mP2xQnR5vL9wJ3..."
                    hint="Set this in wp-config.php as CONTENT_TOOL_TOKEN and install the mu-plugin — bypasses host auth issues"
                  />
                  {/* Test connection */}
                  <div className="flex flex-wrap items-center gap-3 pt-1">
                    <button
                      type="button"
                      onClick={testWordPress}
                      disabled={wpTesting || !integrations.wordpress_url || !integrations.wordpress_username || !integrations.wordpress_app_password}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-gray-200 dark:border-white/10 rounded-lg text-[#1d1d1f] dark:text-[#f5f5f7] hover:border-[#0071e3]/40 disabled:opacity-40 transition-colors"
                    >
                      {wpTesting ? <Loader2 size={12} className="animate-spin" /> : <Wifi size={12} />}
                      Test connection
                    </button>
                    <button
                      type="button"
                      onClick={fixCssCorruption}
                      disabled={fixingCss || !integrations.wordpress_url}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-gray-200 dark:border-white/10 rounded-lg text-[#1d1d1f] dark:text-[#f5f5f7] hover:border-[#ff3b30]/40 disabled:opacity-40 transition-colors"
                    >
                      {fixingCss ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                      Fix corrupted posts
                    </button>
                    {wpTestResult && (
                      <span className={`text-xs font-medium ${wpTestResult.ok ? 'text-[#34c759]' : 'text-[#ff3b30]'}`}>
                        {wpTestResult.message}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={fixThumbnails}
                      disabled={fixingThumbs || !integrations.wordpress_url}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-gray-200 dark:border-white/10 rounded-lg text-[#1d1d1f] dark:text-[#f5f5f7] hover:border-[#ff9500]/40 disabled:opacity-40 transition-colors"
                    >
                      {fixingThumbs ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                      Fix thumbnails
                    </button>
                    {fixCssResult && (
                      <span className={`text-xs font-medium ${fixCssResult.startsWith('Error') ? 'text-[#ff3b30]' : 'text-[#34c759]'}`}>
                        {fixCssResult}
                      </span>
                    )}
                    {fixThumbsResult && (
                      <span className={`text-xs font-medium ${fixThumbsResult.startsWith('Error') ? 'text-[#ff3b30]' : 'text-[#34c759]'}`}>
                        {fixThumbsResult}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Facebook */}
              <div className="card p-6">
                <div className="flex items-center gap-3 mb-4 pb-4 border-b border-gray-100">
                  <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center">
                    <Facebook size={16} className="text-[#1877F2]" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Facebook Page</p>
                    <p className="text-xs text-[#86868b] dark:text-[#8e8e93]">Auto-post blog links to your page when published</p>
                  </div>
                  {facebook.connected && (
                    <span className="flex items-center gap-1 text-xs font-medium text-[#34c759]">
                      <Check size={12} /> Connected
                    </span>
                  )}
                </div>

                {fbNotice && (
                  <p className={`text-xs mb-3 ${fbNotice.ok ? 'text-[#34c759]' : 'text-[#ff3b30]'}`}>
                    {fbNotice.msg}
                  </p>
                )}

                {facebook.connected ? (
                  <div className="flex flex-col gap-3">
                    {facebook.pages.length > 1 && (
                      <div>
                        <label className="block text-xs font-medium text-[#1d1d1f] dark:text-[#f5f5f7] mb-1.5">Active page</label>
                        <select
                          value={facebook.pageId}
                          onChange={(e) => selectFacebookPage(e.target.value)}
                          className="input-field text-sm"
                        >
                          {facebook.pages.map((p) => (
                            <option key={p.id} value={p.id}>{p.name}</option>
                          ))}
                        </select>
                      </div>
                    )}
                    {facebook.pages.length === 1 && (
                      <p className="text-sm text-[#1d1d1f] dark:text-[#f5f5f7] flex items-center gap-2">
                        <Link2 size={13} className="text-[#86868b] dark:text-[#8e8e93]" />
                        {facebook.pageName}
                      </p>
                    )}
                    <button
                      onClick={disconnectFacebook}
                      disabled={fbDisconnecting}
                      className="flex items-center gap-1.5 text-xs text-[#86868b] dark:text-[#8e8e93] hover:text-[#ff3b30] transition-colors self-start"
                    >
                      {fbDisconnecting ? <Loader2 size={12} className="animate-spin" /> : <LogOut size={12} />}
                      Disconnect
                    </button>
                  </div>
                ) : (
                  <ManualFacebookToken onConnected={() => { load() }} />
                )}
              </div>

              {/* Pinterest */}
              <div className="card p-6">
                <div className="flex items-center gap-3 mb-4 pb-4 border-b border-gray-100">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: '#fef0f0' }}>
                    <Pin size={16} style={{ color: '#E60023' }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Pinterest</p>
                    <p className="text-xs text-[#86868b] dark:text-[#8e8e93]">Pin blog posts to your Pinterest boards</p>
                  </div>
                  {pinterest.connected && (
                    <span className="flex items-center gap-1 text-xs font-medium text-[#34c759]">
                      <Check size={12} /> Connected
                    </span>
                  )}
                </div>

                {ptNotice && (
                  <p className={`text-xs mb-3 ${ptNotice.ok ? 'text-[#34c759]' : 'text-[#ff3b30]'}`}>
                    {ptNotice.msg}
                  </p>
                )}

                {pinterest.connected ? (
                  <div className="flex flex-col gap-3">
                    {pinterest.boards.length > 1 ? (
                      <div>
                        <label className="block text-xs font-medium text-[#1d1d1f] dark:text-[#f5f5f7] mb-1.5">Active board</label>
                        <select
                          value={pinterest.boardId}
                          onChange={(e) => selectPinterestBoard(e.target.value)}
                          className="input-field text-sm"
                        >
                          {pinterest.boards.map((b) => (
                            <option key={b.id} value={b.id}>{b.name}</option>
                          ))}
                        </select>
                      </div>
                    ) : (
                      <p className="text-sm text-[#1d1d1f] dark:text-[#f5f5f7] flex items-center gap-2">
                        <Link2 size={13} className="text-[#86868b] dark:text-[#8e8e93]" />
                        {pinterest.boardName || pinterest.boardId}
                      </p>
                    )}
                    <button
                      onClick={disconnectPinterest}
                      disabled={ptDisconnecting}
                      className="flex items-center gap-1.5 text-xs text-[#86868b] dark:text-[#8e8e93] hover:text-[#ff3b30] transition-colors self-start"
                    >
                      {ptDisconnecting ? <Loader2 size={12} className="animate-spin" /> : <LogOut size={12} />}
                      Disconnect
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-col gap-3">
                    <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0]">Connect your Pinterest account to pin blog posts directly from the content page.</p>
                    <button
                      onClick={connectPinterest}
                      className="flex items-center gap-2 px-4 py-2 text-white text-sm font-medium rounded-lg transition-colors self-start"
                      style={{ background: '#E60023' }}
                    >
                      <Pin size={14} />
                      Connect Pinterest
                    </button>
                  </div>
                )}
              </div>

              {/* Threads */}
              <div className="card p-6">
                <div className="flex items-center gap-3 mb-4 pb-4 border-b border-gray-100">
                  <div className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center">
                    <MessageCircle size={16} className="text-[#1d1d1f] dark:text-[#f5f5f7]" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Threads</p>
                    <p className="text-xs text-[#86868b] dark:text-[#8e8e93]">Auto-post blog summaries to your Threads profile</p>
                  </div>
                  {threads.connected && (
                    <span className="flex items-center gap-1 text-xs font-medium text-[#34c759]">
                      <Check size={12} /> Connected
                    </span>
                  )}
                </div>

                {thNotice && (
                  <p className={`text-xs mb-3 ${thNotice.ok ? 'text-[#34c759]' : 'text-[#ff3b30]'}`}>
                    {thNotice.msg}
                  </p>
                )}

                {threads.connected ? (
                  <div className="flex flex-col gap-3">
                    <p className="text-sm text-[#1d1d1f] dark:text-[#f5f5f7] flex items-center gap-2">
                      <Link2 size={13} className="text-[#86868b] dark:text-[#8e8e93]" />
                      {threads.username ? `@${threads.username}` : 'Threads account connected'}
                    </p>
                    <button
                      onClick={disconnectThreads}
                      disabled={thDisconnecting}
                      className="flex items-center gap-1.5 text-xs text-[#86868b] dark:text-[#8e8e93] hover:text-[#ff3b30] transition-colors self-start"
                    >
                      {thDisconnecting ? <Loader2 size={12} className="animate-spin" /> : <LogOut size={12} />}
                      Disconnect
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-col gap-3">
                    <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0]">Connect your Threads account to post blog summaries directly from the content page.</p>
                    <button
                      onClick={connectThreads}
                      className="flex items-center gap-2 px-4 py-2 bg-[#1d1d1f] text-white text-sm font-medium rounded-lg hover:bg-black transition-colors self-start"
                    >
                      <MessageCircle size={14} />
                      Connect Threads
                    </button>
                  </div>
                )}
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


      {/* Billing tab */}
      {tab === 'billing' && (
        <BillingTab tier={tier} />
      )}
    </>
  )
}

export default function SettingsPageWrapper() {
  return (
    <Suspense>
      <SettingsPage />
    </Suspense>
  )
}

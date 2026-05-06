'use client'

import { useState } from 'react'
import Header from '@/components/layout/Header'
import { User, Key, Bell, Eye, EyeOff, Save } from 'lucide-react'

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

function ApiKeyField({ label, placeholder, envKey }: { label: string; placeholder: string; envKey: string }) {
  const [show, setShow] = useState(false)
  const [value, setValue] = useState('')
  return (
    <div>
      <label className="block text-sm font-medium text-[#1d1d1f] mb-1.5">{label}</label>
      <div className="relative">
        <input
          type={show ? 'text' : 'password'}
          value={value}
          onChange={(e) => setValue(e.target.value)}
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
      <p className="text-xs text-[#86868b] mt-1">Stored encrypted. Env var: <code className="font-mono bg-gray-100 px-1 rounded">{envKey}</code></p>
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

export default function SettingsPage() {
  const [tab, setTab] = useState<Tab>('profile')

  return (
    <>
      <Header title="Settings" subtitle="Manage your account, integrations and notifications." />

      {/* Tab bar */}
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

      {/* Profile tab */}
      {tab === 'profile' && (
        <div className="max-w-xl flex flex-col gap-5">
          <div className="card p-6">
            <h2 className="text-sm font-semibold text-[#1d1d1f] mb-4">Personal Information</h2>
            <div className="flex flex-col gap-4">
              <div className="flex items-center gap-4 pb-4 border-b border-gray-100">
                <div className="w-14 h-14 rounded-full bg-[#0071e3]/10 flex items-center justify-center text-xl font-semibold text-[#0071e3]">
                  J
                </div>
                <div>
                  <button className="btn-secondary text-xs">Change photo</button>
                  <p className="text-xs text-[#86868b] mt-1">JPG, PNG up to 2MB</p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-[#1d1d1f] mb-1.5">First name</label>
                  <input type="text" defaultValue="Jane" className="input-field" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[#1d1d1f] mb-1.5">Last name</label>
                  <input type="text" defaultValue="Smith" className="input-field" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-[#1d1d1f] mb-1.5">Email</label>
                <input type="email" defaultValue="jane@example.com" className="input-field" />
              </div>
            </div>
          </div>

          <div className="card p-6">
            <h2 className="text-sm font-semibold text-[#1d1d1f] mb-4">Change Password</h2>
            <div className="flex flex-col gap-4">
              <div>
                <label className="block text-sm font-medium text-[#1d1d1f] mb-1.5">Current password</label>
                <input type="password" placeholder="••••••••" className="input-field" />
              </div>
              <div>
                <label className="block text-sm font-medium text-[#1d1d1f] mb-1.5">New password</label>
                <input type="password" placeholder="Min. 8 characters" className="input-field" />
              </div>
            </div>
          </div>

          <button className="btn-primary self-start">
            <Save size={14} /> Save changes
          </button>

          <div className="card p-5 border-[#ff3b30]/20 bg-[#ff3b30]/3">
            <h2 className="text-sm font-semibold text-[#ff3b30] mb-1">Danger Zone</h2>
            <p className="text-xs text-[#6e6e73] mb-3">Permanently delete your account and all data.</p>
            <button className="btn-danger text-xs">Delete account</button>
          </div>
        </div>
      )}

      {/* Integrations tab */}
      {tab === 'integrations' && (
        <div className="max-w-xl flex flex-col gap-5">
          <div className="card p-6">
            <div className="flex items-center gap-3 mb-4 pb-4 border-b border-gray-100">
              <div className="w-8 h-8 rounded-lg bg-red-50 flex items-center justify-center">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="#FF0000"><path d="M23.5 6.19a3.02 3.02 0 0 0-2.12-2.14C19.54 3.5 12 3.5 12 3.5s-7.54 0-9.38.55A3.02 3.02 0 0 0 .5 6.19C0 8.03 0 12 0 12s0 3.97.5 5.81a3.02 3.02 0 0 0 2.12 2.14C4.46 20.5 12 20.5 12 20.5s7.54 0 9.38-.55a3.02 3.02 0 0 0 2.12-2.14C24 15.97 24 12 24 12s0-3.97-.5-5.81zM9.75 15.5v-7l6.5 3.5-6.5 3.5z"/></svg>
              </div>
              <div>
                <p className="text-sm font-semibold text-[#1d1d1f]">YouTube</p>
                <p className="text-xs text-[#86868b]">Sync videos and transcripts</p>
              </div>
            </div>
            <div className="flex flex-col gap-4">
              <ApiKeyField label="YouTube API Key" placeholder="AIzaSy..." envKey="YOUTUBE_API_KEY" />
              <div>
                <label className="block text-sm font-medium text-[#1d1d1f] mb-1.5">Channel ID</label>
                <input type="text" placeholder="UCxxxxxxxxxxxxxxx" className="input-field font-mono text-xs" />
              </div>
            </div>
          </div>

          <div className="card p-6">
            <div className="flex items-center gap-3 mb-4 pb-4 border-b border-gray-100">
              <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="#21759B"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/></svg>
              </div>
              <div>
                <p className="text-sm font-semibold text-[#1d1d1f]">WordPress / Hostinger</p>
                <p className="text-xs text-[#86868b]">Auto-publish blog posts</p>
              </div>
            </div>
            <div className="flex flex-col gap-4">
              <div>
                <label className="block text-sm font-medium text-[#1d1d1f] mb-1.5">WordPress Site URL</label>
                <input type="url" placeholder="https://yourdomain.com" className="input-field" />
              </div>
              <ApiKeyField label="Application Password" placeholder="xxxx xxxx xxxx xxxx xxxx xxxx" envKey="WORDPRESS_APP_PASSWORD" />
              <ApiKeyField label="Hostinger API Key (optional)" placeholder="hs_live_..." envKey="HOSTINGER_API_KEY" />
            </div>
          </div>

          {/* VidIQ */}
          <div className="card p-6">
            <div className="flex items-center gap-3 mb-4 pb-4 border-b border-gray-100">
              <div className="w-8 h-8 rounded-lg bg-purple-50 flex items-center justify-center">
                <svg width="16" height="16" viewBox="0 0 32 32" fill="none"><rect width="32" height="32" rx="8" fill="#7B2FBE"/><text x="5" y="22" fontSize="14" fontWeight="bold" fill="white">V</text></svg>
              </div>
              <div>
                <p className="text-sm font-semibold text-[#1d1d1f]">VidIQ</p>
                <p className="text-xs text-[#86868b]">Keyword research, video analytics & transcripts</p>
              </div>
              <a href="https://geni.us/I8Hz" target="_blank" rel="noopener noreferrer" className="ml-auto text-xs text-[#0071e3] hover:underline">
                Create account ↗
              </a>
            </div>
            <ApiKeyField label="VidIQ API Key" placeholder="vidiq_..." envKey="VIDIQ_API_KEY" />
          </div>

          {/* Geniuslink */}
          <div className="card p-6">
            <div className="flex items-center gap-3 mb-4 pb-4 border-b border-gray-100">
              <div className="w-8 h-8 rounded-lg bg-orange-50 flex items-center justify-center">
                <svg width="16" height="16" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#FF6B35"/><text x="5" y="22" fontSize="14" fontWeight="bold" fill="white">G</text></svg>
              </div>
              <div>
                <p className="text-sm font-semibold text-[#1d1d1f]">Geniuslink <span className="badge bg-[#ff9500]/10 text-[#ff9500] ml-1">Recommended</span></p>
                <p className="text-xs text-[#86868b]">Smart affiliate links that work globally</p>
              </div>
              <a href="https://geni.us/Y70p9R" target="_blank" rel="noopener noreferrer" className="ml-auto text-xs text-[#0071e3] hover:underline">
                Create account ↗
              </a>
            </div>
            <ApiKeyField label="Geniuslink API Key" placeholder="gl_..." envKey="GENIUSLINK_API_KEY" />
          </div>

          <button className="btn-primary self-start">
            <Save size={14} /> Save API keys
          </button>
        </div>
      )}

      {/* Notifications tab */}
      {tab === 'notifications' && (
        <div className="max-w-xl">
          <div className="card p-6">
            <h2 className="text-sm font-semibold text-[#1d1d1f] mb-4">Email Notifications</h2>
            <div>
              <Toggle label="New video detected" description="Get notified when a new YouTube video is found in your channel." defaultChecked />
              <Toggle label="Blog post published" description="Confirmation when a post is successfully published to WordPress." defaultChecked />
              <Toggle label="Draft ready for review" description="Alert when social drafts are generated and waiting for approval." defaultChecked />
              <Toggle label="Job failures" description="Immediate alert when a content generation or publishing job fails." defaultChecked />
              <Toggle label="Weekly digest" description="Weekly summary of your content pipeline performance." />
            </div>
          </div>
        </div>
      )}
    </>
  )
}

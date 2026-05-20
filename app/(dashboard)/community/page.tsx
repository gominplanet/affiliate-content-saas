/**
 * Community page. Renders Discord's official live presence widget +
 * a server-rendered invite button + member count pulled from the
 * widget.json API.
 *
 * The widget.json fetch is cached (revalidate: 300s) so we don't
 * hammer Discord on every page load; an outage doesn't break the
 * page — we fall back to the canonical invite URL.
 */

import type { Metadata } from 'next'
import Header from '@/components/layout/Header'
import { MessagesSquare, ExternalLink, Users } from 'lucide-react'
import {
  DISCORD_SERVER_ID,
  DISCORD_INVITE_URL,
  DISCORD_WIDGET_URL,
  DISCORD_WIDGET_JSON_URL,
} from '@/lib/community'

export const metadata: Metadata = { title: 'Community' }

interface WidgetJson {
  instant_invite?: string | null
  presence_count?: number
  members?: Array<{ id: string; username: string; avatar_url?: string; status?: string }>
}

async function fetchWidget(): Promise<WidgetJson | null> {
  if (!DISCORD_WIDGET_JSON_URL) return null
  try {
    const res = await fetch(DISCORD_WIDGET_JSON_URL, {
      next: { revalidate: 300 }, // 5-minute ISR cache
    })
    if (!res.ok) return null
    return (await res.json()) as WidgetJson
  } catch {
    return null
  }
}

export default async function CommunityPage() {
  if (!DISCORD_SERVER_ID) {
    return (
      <>
        <Header title="Community" subtitle="The Discord server isn't published yet." />
      </>
    )
  }

  const widget = await fetchWidget()
  const invite = widget?.instant_invite || DISCORD_INVITE_URL
  const presence = widget?.presence_count

  return (
    <>
      <Header
        title="Community"
        subtitle="Hang out with other creators, ask questions, share what works, give us feedback. We're in there too."
      />

      <div className="max-w-4xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Left/main column — invite CTA + live member presence */}
        <div className="md:col-span-2 flex flex-col gap-4">
          <div
            className="card p-5"
            style={{ background: 'linear-gradient(180deg, rgba(88,101,242,0.06) 0%, transparent 100%)', borderColor: 'rgba(88,101,242,0.25)' }}
          >
            <div className="flex items-start gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-[#5865F2]/15 flex items-center justify-center flex-shrink-0">
                <MessagesSquare size={20} className="text-[#5865F2]" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-base font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">MVP Affiliate on Discord</p>
                <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0] mt-0.5">
                  Free to join. The fastest way to ask questions, request features, and see what other creators are shipping.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              <a
                href={invite}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold text-white transition-colors"
                style={{ background: '#5865F2' }}
              >
                <MessagesSquare size={14} /> Join the server <ExternalLink size={12} />
              </a>
              {typeof presence === 'number' && (
                <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[#34c759]">
                  <span className="relative flex w-2 h-2">
                    <span className="absolute inline-flex h-full w-full rounded-full bg-[#34c759] opacity-60 animate-ping" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-[#34c759]" />
                  </span>
                  <Users size={12} className="text-[#6e6e73]" />
                  {presence.toLocaleString()} online right now
                </span>
              )}
            </div>
          </div>

          {/* Embedded Discord widget — Discord's own iframe, dark theme. */}
          <div className="card p-4">
            <p className="text-[11px] uppercase tracking-wider font-semibold text-[#86868b] mb-2">Live presence</p>
            <iframe
              src={DISCORD_WIDGET_URL}
              width="100%"
              height="500"
              allowTransparent
              frameBorder={0}
              sandbox="allow-popups allow-popups-to-escape-sandbox allow-same-origin allow-scripts"
              className="rounded-lg border border-gray-200 dark:border-white/10"
              title="Discord community widget"
            />
          </div>
        </div>

        {/* Right column — what's in the server */}
        <aside className="flex flex-col gap-4">
          <div className="card p-5">
            <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-3">What you&apos;ll find inside</p>
            <ul className="flex flex-col gap-2.5 text-xs text-[#6e6e73] dark:text-[#ebebf0]">
              <li className="flex items-start gap-2">
                <span className="text-[#5865F2] mt-0.5">●</span>
                <span><span className="font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">#announcements</span> — new features, model swaps, planned downtime.</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-[#5865F2] mt-0.5">●</span>
                <span><span className="font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">#help</span> — questions about setup, integrations, generation issues.</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-[#5865F2] mt-0.5">●</span>
                <span><span className="font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">#feedback</span> — request features, vote on what we build next.</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-[#5865F2] mt-0.5">●</span>
                <span><span className="font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">#showcase</span> — share posts, channels, brand collabs you landed.</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-[#5865F2] mt-0.5">●</span>
                <span><span className="font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">#brand-outreach</span> — swap notes on pitching brands.</span>
              </li>
            </ul>
          </div>

          <div className="card p-5 text-xs text-[#6e6e73] dark:text-[#ebebf0] leading-relaxed">
            <p className="font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">House rules</p>
            <p>Be kind, no self-promo spam (showcase is fine), no DMing other members without consent. We&apos;re a small community — keep it useful.</p>
          </div>
        </aside>
      </div>
    </>
  )
}

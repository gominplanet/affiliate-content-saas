'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useTheme } from 'next-themes'
import {
  LayoutDashboard,
  PlaySquare,
  Palette,
  AlertTriangle,
  UserCog,
  ChevronRight,
  ChevronDown,
  type LucideIcon,
  Wrench,
  Plug,
  CreditCard,
  Sun,
  Moon,
  Paintbrush,
  ExternalLink,
  KeyRound,
  LogOut,
  Star,
  Clapperboard,
  Flame,
  Zap,
  Check,
  Loader2,
  HandCoins,
  Menu,
  TrendingUp,
  Megaphone,
  Newspaper,
  Camera,
  DollarSign,
  Handshake,
  GraduationCap,
  MessagesSquare,
  Bot,
  Scale,
  Gauge,
  Mail,
  Sparkles,
  FileVideo,
  Users,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { SALES_PAUSED } from '@/lib/sales-paused'
import { whitelabelFromRow, type WhitelabelConfig } from '@/lib/whitelabel'
import { metaEnabled } from '@/lib/feature-flags'
import { createBrowserClient } from '@/lib/supabase/client'
import { getViewAsTier, setViewAsTier } from '@/lib/view-as'
import { toast } from 'sonner'
import type { Tier } from '@/lib/tier'
import { resetTutorials } from '@/components/TutorialVideo'
import { COMMUNITY_LABEL, COMMUNITY_TOOLTIP } from '@/lib/community'
import { useConfirm } from '@/components/ui/useConfirm'

// Sidebar nav, grouped by workflow phase. Dashboard is pinned at the very
// top with Blog Set Up + Integrations directly beneath it — those two are
// the "one-time per site" links creators jump to constantly during setup
// and rarely after, so they belong above the workflow groups, not buried
// inside one. Everything else lives in a collapsible group: Customize →
// Create & Publish → Grow & Earn → Collaborate → Communicate → Learn & Help.
//
// Setup is split into Blog Set Up (WordPress wizard) and Integrations
// (3rd-party social connectors) — both route to /setup with different ?tab=
// values; active highlighting uses the query param.
type NavMatchKind = 'exact' | 'prefix' | 'setup-wp' | 'setup-int'
type NavItem = { href: string; label: string; icon: LucideIcon; matchKind: NavMatchKind; badge?: string }
type NavGroup = {
  id: string
  /** Shown in caps in the sidebar header — kept short so the label fits
   *  on one line at 240px sidebar width. */
  label: string
  /** Icon rendered to the LEFT of the label in a small coloured chip.
   *  Keeps each section visually distinct without a full background tint. */
  icon: LucideIcon
  /** Accent colour for the chip + (subtly) the uppercase label. Each
   *  section gets its own colour so the eye lands quickly. */
  accent: string
  items: NavItem[]
}

// Pinned (top of sidebar, no group header). Dashboard is the home view;
// Blog Set Up + Integrations sit right under it because creators hit them
// constantly while configuring a site and bury them inside a group hides
// the most-clicked destinations during onboarding.
const pinnedNav: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, matchKind: 'exact' },
  { href: '/setup', label: 'Blog Set Up', icon: Wrench, matchKind: 'setup-wp' },
  { href: '/setup?tab=integrations', label: 'Integrations', icon: Plug, matchKind: 'setup-int' },
]

const navGroups: NavGroup[] = [
  {
    id: 'setup',
    // Renamed from "Set Up" → "Customize" once Blog Set Up + Integrations
    // moved into pinnedNav. The remaining items (Brand Profile, Customize
    // Blog, Photobooth, Learning) are all about shaping how the site /
    // creator presents themselves — "Customize" reads truer than "Set Up".
    label: 'Customize',
    icon: Paintbrush,
    accent: '#5856d6', // indigo — kept from the Set Up era for continuity
    items: [
      { href: '/brand', label: 'Brand Profile', icon: Palette, matchKind: 'prefix' },
      { href: '/customize', label: 'Customize Blog', icon: Paintbrush, matchKind: 'prefix' },
      { href: '/photobooth', label: 'Photobooth', icon: Camera, matchKind: 'prefix' },
      { href: '/learn', label: 'Learning', icon: GraduationCap, matchKind: 'prefix' },
    ],
  },
  {
    id: 'create',
    label: 'Create & Publish',
    icon: Sparkles,
    accent: '#af52de', // purple — "create"
    items: [
      // Script generator is the FIRST step of the creator workflow —
      // sits before Co-Pilot (which is post-production metadata).
      { href: '/script', label: 'Video Script & Shot List', icon: FileVideo, matchKind: 'prefix' },
      { href: '/studio', label: 'YouTube Co-Pilot', icon: Clapperboard, matchKind: 'prefix' },
      { href: '/content', label: 'Library', icon: PlaySquare, matchKind: 'prefix' },
      { href: '/comparison', label: 'Compare & Guides', icon: Scale, matchKind: 'prefix' },
      { href: '/instagram-burner', label: 'Instagram Burner', icon: Flame, matchKind: 'prefix' },
    ],
  },
  {
    id: 'grow',
    label: 'Grow & Earn',
    icon: TrendingUp,
    accent: '#34c759', // green — "grow"
    items: [
      { href: '/seo', label: 'SEO & Indexing', icon: Gauge, matchKind: 'prefix' },
      { href: '/analytics', label: 'Analytics', icon: TrendingUp, matchKind: 'prefix' },
    ],
  },
  {
    id: 'collaborate',
    label: 'Collaborate',
    icon: Handshake,
    accent: '#ff9500', // orange — "deals"
    items: [
      { href: '/campaigns', label: 'Creator Campaigns', icon: Megaphone, matchKind: 'prefix' },
      { href: '/collaborations', label: 'Brand Deals', icon: Handshake, matchKind: 'prefix' },
    ],
  },
  {
    id: 'communicate',
    label: 'Communicate',
    icon: Mail,
    accent: '#ff2d55', // pink — "send"
    items: [
      { href: '/newsletter', label: 'Newsletter', icon: Mail, matchKind: 'prefix' },
    ],
  },
  {
    id: 'learn',
    label: 'Learn & Help',
    icon: GraduationCap,
    accent: '#ffcc00', // yellow — "discover"
    items: [
      { href: '/assistant', label: 'AI Assistant', icon: Bot, matchKind: 'prefix' },
      { href: '/tutorials', label: 'Tutorials', icon: GraduationCap, matchKind: 'prefix' },
    ],
  },
]

const SIDEBAR_GROUPS_KEY = 'mvp_sidebar_groups'

const secondaryNav = [
  { href: '/billing', label: 'Plan & Billing', icon: CreditCard },
  // API access — only relevant for Pro users, but always visible so
  // Creator/Studio users can discover it + see the upgrade pitch.
  { href: '/developers', label: 'API Access', icon: KeyRound },
  // White-label branding — Pro-only; same paywall pattern as Developers.
  { href: '/branding', label: 'Branding', icon: Paintbrush },
  // Agency seats — multi-user under one Pro subscription. Same paywall
  // pattern as the other Pro features (non-Pro users hit it as upsell).
  { href: '/agency', label: 'Team Seats', icon: Users },
  // Rewardful-hosted affiliate dashboard — opens in a new tab. Hidden
  // while sales are paused (no point recruiting new affiliates when
  // their referrals can't actually buy).
  ...(SALES_PAUSED
    ? []
    : [{ href: 'https://mvp-affiliate.getrewardful.com/signup', label: 'Earn 10% — Refer', icon: HandCoins, external: true as const, accent: '#34c759' }]),
  // Admin-only links (Users, Failures, AI Cost) live in the isAdmin block
  // in the render — NOT here — so non-admins never see them.
]

export default function Sidebar({ email, wpSiteUrl: wpSiteUrlProp }: { email?: string; wpSiteUrl?: string | null }) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const router = useRouter()
  const { theme, setTheme } = useTheme()
  const supabase = createBrowserClient()
  const { confirm, ConfirmHost } = useConfirm()
  const [wpSiteUrl, setWpSiteUrl] = useState<string | null>(wpSiteUrlProp ?? null)
  const [isAdmin, setIsAdmin] = useState(false)
  // White-label config — populated client-side from the integrations row in
  // the effect below. Non-Pro users get a config that points at MVP defaults
  // (helpers/whitelabel.ts guarantees this), so the render path is the same.
  const [whitelabel, setWhitelabel] = useState<WhitelabelConfig | null>(null)
  // Whether Meta surfaces (Instagram Burner link) are visible: on for everyone
  // post-approval, else admins + the App-Review test account.
  const [metaUnlocked, setMetaUnlocked] = useState(metaEnabled())
  // Admin-only "view as tier" preview. 'admin' = your real view (no override).
  const [viewAs, setViewAs] = useState<Tier>('admin')
  useEffect(() => { setViewAs(getViewAsTier() ?? 'admin') }, [])
  const [geniusConnected, setGeniusConnected] = useState(false)
  const [purging, setPurging] = useState(false)
  const [purged, setPurged] = useState(false)
  // Mobile drawer state — sidebar is hidden offscreen below lg and slides in
  // when this is true. Auto-closes on every route change.
  const [mobileOpen, setMobileOpen] = useState(false)
  const [tutorialsRestored, setTutorialsRestored] = useState(false)
  useEffect(() => { setMobileOpen(false) }, [pathname, searchParams])

  // Collapsible nav groups. We store ONLY the groups the user has explicitly
  // collapsed (default = open), persisted per-browser. The group containing
  // the current page is always force-opened regardless of stored state.
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({})
  useEffect(() => {
    try { setOpenGroups(JSON.parse(localStorage.getItem(SIDEBAR_GROUPS_KEY) || '{}')) } catch { /* default all-open */ }
  }, [])
  function toggleGroup(id: string) {
    setOpenGroups(prev => {
      const next = { ...prev, [id]: !(prev[id] ?? true) }
      try { localStorage.setItem(SIDEBAR_GROUPS_KEY, JSON.stringify(next)) } catch { /* ignore */ }
      return next
    })
  }

  async function purgeCache() {
    setPurging(true)
    setPurged(false)
    try {
      const res = await fetch('/api/wordpress/purge-cache', { method: 'POST' })
      const json = await res.json().catch(() => ({}))
      // Always log the full response so we can inspect what the snippet refresh did
      // eslint-disable-next-line no-console
      console.log('[Purge Site Cache] response:', json)
      if (!res.ok) {
        // 2026-06-02 audit: replaced raw alert() with sonner toast
        // (the rest of the app uses toast consistently — these two
        // alerts were the only holdouts).
        toast.error(json.error || 'Cache purge failed.')
        return
      }
      // Legacy Code Snippets error surface removed — the new theme-based
      // architecture doesn't depend on Code Snippets.
      setPurged(true)
      toast.success('Site cache purged.')
      setTimeout(() => setPurged(false), 2500)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Cache purge failed.')
    } finally {
      setPurging(false)
    }
  }

  // Re-fetch on every route change so the link is always up to date
  useEffect(() => {
    // 1. Check localStorage immediately (instant, no network round-trip)
    try {
      const raw = localStorage.getItem('affiliateos_setup_v3')
      if (raw) {
        const d = JSON.parse(raw)
        if (d.completedUrl) setWpSiteUrl(d.completedUrl)
      }
    } catch { /* ignore */ }

    // 2. Also fetch from Supabase so we pick up changes from other sessions
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return
      // Type inferred from .maybeSingle() — drop the manual Record<string,string>
      // annotation that no longer matches the regenerated row shape.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(supabase as any)
        .from('integrations')
        .select('wordpress_url,tier,geniuslink_api_key,geniuslink_api_secret,whitelabel_logo_url,whitelabel_brand_name,whitelabel_accent_color')
        .eq('user_id', user.id)
        .maybeSingle()
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .then(({ data }: { data: any }) => {
          const url = data?.wordpress_url || null
          if (url) setWpSiteUrl(url)
          setIsAdmin(data?.tier === 'admin')
          setMetaUnlocked(metaEnabled({ tier: data?.tier, email: user.email }))
          setGeniusConnected(!!data?.geniuslink_api_key && !!data?.geniuslink_api_secret)
          // White-label config — resolved client-side from the integrations
          // row so the sidebar can render the Pro user's brand without a
          // separate fetch. Falls through to MVP defaults when fields are
          // null or tier isn't Pro.
          setWhitelabel(whitelabelFromRow(data))
        })
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname])

  async function handleLogout() {
    await supabase.auth.signOut()
    router.push('/login')
  }

  const isActive = (href: string) =>
    href === '/dashboard' ? pathname === '/dashboard' : pathname.startsWith(href)

  // Tab-aware active state for Blog Set Up vs Integrations (both live at /setup)
  const isActiveTabbed = (matchKind: 'exact' | 'prefix' | 'setup-wp' | 'setup-int', href: string) => {
    if (matchKind === 'exact')      return pathname === href
    if (matchKind === 'setup-wp')   return pathname.startsWith('/setup') && searchParams?.get('tab') !== 'integrations'
    if (matchKind === 'setup-int')  return pathname.startsWith('/setup') && searchParams?.get('tab') === 'integrations'
    // 'prefix'
    return pathname.startsWith(href)
  }

  // Render a single nav link (shared by pinned items + grouped items).
  const renderNavLink = (item: NavItem) => {
    const { href, label, icon: Icon, matchKind, badge } = item
    // Analytics is Geniuslink-only — hide it until Geniuslink is connected.
    if (href === '/analytics' && !geniusConnected) return null
    return (
      <Link key={label} href={href} className={cn('nav-item', isActiveTabbed(matchKind, href) && 'active')}>
        <Icon size={16} className="flex-shrink-0" />
        <span className="flex-1">{label}</span>
        {badge && (
          <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-[#ff9500]/15 text-[#9a5d00] flex-shrink-0">
            {badge}
          </span>
        )}
      </Link>
    )
  }

  // Which group holds the current page — it's always shown expanded.
  const activeGroupId = navGroups.find(g => g.items.some(it => isActiveTabbed(it.matchKind, it.href)))?.id ?? null

  return (
    <>
      {/* Mobile hamburger — visible below lg, fixed top-left so it stays put as
          the user scrolls. The dashboard layout adds top padding on mobile so
          page content doesn't slide under this button. */}
      <button
        type="button"
        onClick={() => setMobileOpen(true)}
        className="lg:hidden fixed top-3 left-3 z-40 w-10 h-10 rounded-xl bg-white dark:bg-[#1c1c1e] border border-gray-200 dark:border-white/10 shadow-sm flex items-center justify-center text-[#1d1d1f] dark:text-[#f5f5f7]"
        aria-label="Open menu"
      >
        <Menu size={18} />
      </button>

      {/* Backdrop — only on mobile when drawer is open. Click anywhere to close. */}
      {mobileOpen && (
        <div
          className="lg:hidden fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
          onClick={() => setMobileOpen(false)}
        />
      )}

      <aside
        className={cn(
          'sidebar flex flex-col h-screen overflow-y-auto z-50',
          // Desktop: classic sticky sidebar
          'lg:sticky lg:top-0 lg:translate-x-0',
          // Mobile: fixed off-canvas drawer that slides in when open
          'fixed top-0 left-0 transition-transform duration-200 ease-out',
          mobileOpen ? 'translate-x-0 shadow-2xl' : '-translate-x-full',
        )}
      >
      {/* Logo — renders the white-label config when set (Pro users), else
          falls back to the default MVP Affiliate wordmark. */}
      <div className="px-3 pt-3 pb-3" style={{ borderBottom: '1px solid var(--border-2)' }}>
        <Link
          href="/dashboard"
          className="block group"
          aria-label={`${whitelabel?.brandName ?? 'MVP Affiliate'} — Dashboard`}
        >
          {whitelabel?.logoUrl ? (
            // Pro user with a custom logo — render it without the multiply
            // blend (which is the right effect for the MVP word-mark on a
            // grey background but generally wrong for arbitrary logos).
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={whitelabel.logoUrl}
              alt={whitelabel.brandName}
              className="w-full h-auto max-h-12 object-contain group-hover:opacity-90 transition-opacity"
            />
          ) : (
            // Default MVP word-mark.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src="/mvp-affiliate-logo.webp"
              alt="MVP Affiliate"
              className="w-full h-auto rounded-2xl object-contain mix-blend-multiply dark:mix-blend-screen group-hover:opacity-90 transition-opacity"
            />
          )}
        </Link>
      </div>

      {/* Primary nav */}
      <nav className="flex-1 px-3 pt-4 pb-2 flex flex-col gap-0.5">
        {/* Pinned — Dashboard + the two one-time-per-site config destinations
            (Blog Set Up + Integrations). These sit OUTSIDE a workflow group
            because creators hit them constantly during onboarding and burying
            them inside a collapsed section hides the most-clicked links. */}
        {pinnedNav.map(renderNavLink)}

        {/* Collapsible workflow groups: Customize → Create & Publish → Grow &
            Earn → Collaborate → Communicate → Learn & Help. The group
            containing the current page is always open; other collapses are
            remembered per browser. */}
        {/* Workflow sections. Each header shows a small coloured chip with
            the section's icon + the label in bold uppercase tracking. The
            chip colour is the section's accent — different for each — so
            the eye can find the right section without re-reading every
            label. The group containing the current page is always open;
            other collapses are remembered per browser. */}
        {navGroups.map((group) => {
          const isOpen = activeGroupId === group.id || (openGroups[group.id] ?? true)
          const GroupIcon = group.icon
          return (
            <div key={group.id} className="mt-4">
              <button
                type="button"
                onClick={() => toggleGroup(group.id)}
                className="w-full flex items-center gap-2 px-2 mb-1.5 hover:opacity-80 transition-opacity"
                aria-expanded={isOpen}
              >
                <span
                  className="inline-flex items-center justify-center w-5 h-5 rounded-md flex-shrink-0"
                  style={{ background: `${group.accent}1f`, color: group.accent }}
                  aria-hidden
                >
                  <GroupIcon size={12} strokeWidth={2.5} />
                </span>
                <span
                  className="text-[11px] font-bold uppercase tracking-[0.08em] flex-1 text-left"
                  style={{ color: group.accent }}
                >
                  {group.label}
                </span>
                <ChevronDown size={12} className={cn('flex-shrink-0 transition-transform opacity-50', !isOpen && '-rotate-90')} />
              </button>
              {isOpen && (
                <div className="flex flex-col gap-0.5">
                  {group.items.filter(it => metaUnlocked || it.href !== '/instagram-burner').map(renderNavLink)}
                </div>
              )}
            </div>
          )
        })}

        {/* Community — the MVP Affiliate Facebook group hub (internal page). */}
        <Link
          href="/community"
          className={cn('nav-item', isActive('/community') && 'active')}
          title={COMMUNITY_TOOLTIP}
          style={!isActive('/community') ? { color: '#1877F2' } : undefined}
        >
          <MessagesSquare size={16} className="flex-shrink-0" />
          <span style={!isActive('/community') ? { fontWeight: 500 } : undefined}>{COMMUNITY_LABEL}</span>
        </Link>

        {/* Visit Blog */}
        <a
          href={wpSiteUrl || '/setup'}
          target={wpSiteUrl ? '_blank' : '_self'}
          rel="noopener noreferrer"
          className="nav-item"
          style={wpSiteUrl ? {} : { opacity: 0.45 }}
        >
          <ExternalLink size={16} className="flex-shrink-0" style={wpSiteUrl ? { color: '#7C3AED' } : {}} />
          <span style={wpSiteUrl ? { color: '#7C3AED', fontWeight: 500 } : {}}>Visit Blog</span>
        </a>

        {/* WordPress Admin — direct link to wp-admin for the connected site.
            Only renders when a site is connected; otherwise the wp-admin URL
            is meaningless. */}
        {wpSiteUrl && (
          <button
            onClick={async () => {
              const ok = await confirm({
                title: 'Open WordPress admin?',
                description:
                  'Editing posts, theme files or plugin settings directly in WordPress can break the MVP Affiliate setup — theme + plugin sync, Brand Profile push, and the cache layer all depend on MVP being the source of truth. Continue at your own risk.',
                confirmLabel: 'Open WP admin',
                cancelLabel: 'Stay in MVP',
                destructive: true,
              })
              if (ok) window.open(`${wpSiteUrl.replace(/\/$/, '')}/wp-admin`, '_blank', 'noopener,noreferrer')
            }}
            className="nav-item w-full text-left"
            title="Open your WordPress admin (shows a warning first)"
          >
            <KeyRound size={16} className="flex-shrink-0" style={{ color: '#5856d6' }} />
            <span style={{ color: '#5856d6', fontWeight: 500 }}>WP Admin</span>
          </button>
        )}

        {/* Purge cache — prominent global action, always active */}
        {(
          <button
            onClick={purgeCache}
            disabled={purging}
            className="mt-3 flex items-center justify-center gap-2 w-full px-3 py-2.5 rounded-lg text-xs font-semibold text-white transition-all disabled:opacity-60"
            style={{
              background: purged
                ? 'linear-gradient(135deg, #34c759 0%, #30b450 100%)'
                : 'linear-gradient(135deg, #ff9500 0%, #ff6b00 100%)',
              boxShadow: purged
                ? '0 2px 8px rgba(52,199,89,0.3)'
                : '0 2px 8px rgba(255,149,0,0.3)',
            }}
            title="Clear LiteSpeed cache so your latest changes appear on the live blog"
          >
            {purging
              ? <><Loader2 size={14} className="animate-spin" /> Clearing cache…</>
              : purged
              ? <><Check size={14} /> Cache cleared!</>
              : <><Zap size={14} /> Purge Site Cache</>
            }
          </button>
        )}

        {/* Recommended Tools */}
        <div className="mt-4 mb-2 pt-4" style={{ borderTop: '1px solid var(--border-2)' }}>
          <p className="section-label px-2 mb-2 flex items-center gap-1.5">
            <Star size={10} className="text-[#ff9500]" /> Recommended Tools
          </p>
          {[
            { label: 'Oink', href: 'https://geni.us/2y5sBo' },
            { label: 'Levanta', href: 'https://geni.us/GCad5Q' },
            { label: 'PartnerBoost', href: 'https://geni.us/Z0q3hY' },
            { label: 'Archer Affiliate', href: 'https://geni.us/khuHTe' },
            { label: 'Geniuslink', href: 'https://geni.us/Y70p9R' },
          ].map(({ label, href }) => (
            <a
              key={label}
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="nav-item"
            >
              <ExternalLink size={13} className="flex-shrink-0 opacity-50" />
              {label}
            </a>
          ))}
        </div>

        <div className="mt-4 mb-2 pt-4" style={{ borderTop: '1px solid var(--border-2)' }}>
          <p className="section-label px-2 mb-2">System</p>
          {secondaryNav.map((item) => {
            const { href, label, icon: Icon } = item
            const danger = 'danger' in item && (item as { danger?: boolean }).danger === true
            const external = 'external' in item && item.external
            const accent = 'accent' in item ? item.accent : undefined

            if (external) {
              return (
                <a
                  key={href}
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="nav-item"
                  style={accent ? { color: accent } : undefined}
                >
                  <Icon size={16} className="flex-shrink-0" />
                  <span className="flex-1">{label}</span>
                  <ExternalLink size={11} className="opacity-60 flex-shrink-0" />
                </a>
              )
            }

            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  'nav-item',
                  isActive(href) && 'active',
                  danger && !isActive(href) && 'hover:!text-[#ff3b30]',
                )}
              >
                <Icon size={16} className="flex-shrink-0" />
                {label}
              </Link>
            )
          })}
          {isAdmin && (
            <>
              <Link
                href="/admin/users"
                className={cn('nav-item', isActive('/admin/users') && 'active')}
              >
                <UserCog size={16} className="flex-shrink-0" />
                Users (admin)
              </Link>
              <Link
                href="/admin/failures"
                className={cn('nav-item', isActive('/admin/failures') && 'active', !isActive('/admin/failures') && 'hover:!text-[#ff3b30]')}
              >
                <AlertTriangle size={16} className="flex-shrink-0" />
                Failures
              </Link>
              <Link
                href="/admin/costs"
                className={cn('nav-item', isActive('/admin/costs') && 'active')}
              >
                <DollarSign size={16} className="flex-shrink-0" />
                AI Cost (admin)
              </Link>
              <Link
                href="/admin/announcement"
                className={cn('nav-item', isActive('/admin/announcement') && 'active')}
              >
                <Newspaper size={16} className="flex-shrink-0" />
                News banner (admin)
              </Link>
            </>
          )}
          {isAdmin && (
            <div className="px-3 py-2">
              <label className="block text-[10px] font-semibold uppercase tracking-wide text-[#86868b] mb-1">View as tier</label>
              <select
                value={viewAs}
                onChange={(e) => {
                  const v = e.target.value as 'admin' | 'pro' | 'creator' | 'trial'
                  setViewAs(v)
                  setViewAsTier(v === 'admin' ? null : v)
                  // Reload so every page re-reads tier through effectiveTier().
                  window.location.reload()
                }}
                className="w-full text-xs rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-[#1c1c1e] px-2 py-1.5"
                title="Preview the UI as each tier sees it. Visual only — your real admin access is unchanged."
              >
                <option value="admin">My view (Admin)</option>
                <option value="pro">Pro</option>
                <option value="creator">Creator</option>
                <option value="trial">Free Trial</option>
              </select>
              {viewAs !== 'admin' && (
                <p className="text-[10px] text-[#ff9500] mt-1">Previewing as {viewAs} · visual only</p>
              )}
            </div>
          )}
          {/* Re-show every dismissed in-page tutorial video. */}
          <button
            onClick={() => { resetTutorials(); setTutorialsRestored(true); setTimeout(() => setTutorialsRestored(false), 2000) }}
            className="nav-item w-full"
            title="Bring back every dismissed in-page tutorial video"
          >
            <GraduationCap size={16} className="flex-shrink-0" />
            <span className="flex-1 text-left">{tutorialsRestored ? 'Tutorials restored ✓' : 'Show tutorials'}</span>
          </button>
        </div>
      </nav>

      {/* Footer: theme toggle + user */}
      <div className="px-3 pb-4 pt-3" style={{ borderTop: '1px solid var(--border-2)' }}>
        {/* Dark mode toggle */}
        <button
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          className="nav-item w-full mb-2 justify-between"
        >
          <div className="flex items-center gap-3">
            {theme === 'dark'
              ? <Moon size={16} className="flex-shrink-0" />
              : <Sun size={16} className="flex-shrink-0" />}
            <span>{theme === 'dark' ? 'Dark mode' : 'Light mode'}</span>
          </div>
          {/* Toggle pill */}
          <div className={`relative w-9 h-5 rounded-full transition-colors ${theme === 'dark' ? 'bg-[#7C3AED]' : 'bg-gray-300'}`}>
            <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all ${theme === 'dark' ? 'left-[18px]' : 'left-0.5'}`} />
          </div>
        </button>

        {/* User */}
        <Link
          href="/billing"
          className="flex items-center gap-2.5 px-2 py-2 rounded-lg transition-colors group hover:opacity-80"
          style={{ background: 'var(--surface-2)' }}
        >
          <div className="w-7 h-7 rounded-full bg-[#7C3AED]/10 flex items-center justify-center flex-shrink-0">
            <span className="text-xs font-semibold text-[#7C3AED]">
              {email?.[0]?.toUpperCase() ?? 'U'}
            </span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium truncate" style={{ color: 'var(--text)' }}>{email ?? 'Account'}</p>
          </div>
          <ChevronRight size={14} style={{ color: 'var(--text-3)' }} className="opacity-0 group-hover:opacity-100 transition-opacity" />
        </Link>

        {/* Logout */}
        <button
          onClick={handleLogout}
          className="nav-item w-full mt-1 hover:!text-[#ff3b30]"
        >
          <LogOut size={16} className="flex-shrink-0" />
          Sign out
        </button>
      </div>
    </aside>
    <ConfirmHost />
    </>
  )
}

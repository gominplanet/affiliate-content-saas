// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential. No copying, redistribution, reverse-engineering, or reuse. See LICENSE.
//
// DashboardShellV2 — the new live dashboard chrome.
//
// Replaces the legacy components/layout/Sidebar.tsx as the wrapper for
// every (dashboard)/* route. Lifted from /app/preview/PreviewClientShell
// (the redesign we ran for ~2 weeks behind an admin gate) and adapted to
// production state: real nav routes, real user/tier/site data, next-themes
// integration, and the admin "View as tier" dropdown.
//
// Visual language summary (matches the preview tutorials were calibrated
// against):
//   - CSS-variable theme system (dark + light), toggled via sun/moon
//   - Grouped nav: Today / Create / Manage / Measure / Settings
//   - Collapsible sidebar with chevron toggle
//   - Site picker chip in the topbar (multi-site Pro users; single-site
//     users still see their site name)
//   - Notification bell + "Ask anything" kbd hint placeholder
//
// The legacy Sidebar.tsx component is intentionally NOT deleted — keep
// it for rollback while the new chrome bakes. Delete in a follow-up
// commit once we're confident.
'use client'

import { useState, useEffect, useCallback } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import Link from 'next/link'
import { useTheme } from 'next-themes'
import { createBrowserClient } from '@/lib/supabase/client'
import { getViewAsTier, setViewAsTier } from '@/lib/view-as'
import type { Tier } from '@/lib/tier'
import {
  Home, Youtube, Library, Mail, Palette, Brush, TrendingUp,
  Settings, CreditCard, Bot, ChevronsLeft, ChevronsRight,
  Bell, ChevronDown, Sparkles, PenLine, Scale, Calendar,
  Sun, Moon, BookOpen, BadgePercent, Handshake,
  Flame, GraduationCap, KeyRound, Users, LogOut, ExternalLink,
  UserCog, AlertTriangle, DollarSign, Newspaper, Plug, Wrench,
  Camera, MessageCircle, Activity, BarChart3, Upload, Wand2, ShieldCheck,
  Share2, UserSquare, Lightbulb, LifeBuoy, Link2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import NotificationBell from './NotificationBell'
import { HelpDeskButton } from '@/components/HelpDeskSidebar'

// Wrapper to handle context safely
function HelpDeskButtonWrapper() {
  try {
    return <HelpDeskButton />
  } catch {
    return null
  }
}

interface NavItemDef {
  href: string
  icon: React.ReactNode
  label: string
  badge?: number
  /** Hide unless gate is true. Used for showBuyingGuides + showDeals
   *  + admin-only links. */
  gate?: boolean
  /** External link — opens in a new tab. Used for the Recommended Tools
   *  group (Oink, Levanta, etc.) — those are partner-affiliate links
   *  the user earns commission on, so they get a small ExternalLink
   *  glyph + always-new-tab behaviour. */
  external?: boolean
}

interface NavGroupDef {
  label: string
  items: NavItemDef[]
}

// Per-theme CSS variable definitions. Components reference these via
// `style={{ background: 'var(--bg)' }}` so flipping a theme is one state
// change instead of editing every JSX color string.
const DARK_VARS: React.CSSProperties = {
  ['--bg' as string]: '#0E0E11',
  ['--bg-sidebar' as string]: '#0B0B0E',
  ['--surface' as string]: 'rgba(255,255,255,0.03)',
  ['--surface-hover' as string]: 'rgba(255,255,255,0.06)',
  ['--surface-bright' as string]: 'rgba(255,255,255,0.09)',
  ['--surface-selected' as string]: 'rgba(124,58,237,0.10)',
  ['--border' as string]: 'rgba(255,255,255,0.08)',
  ['--border-bright' as string]: 'rgba(255,255,255,0.14)',
  ['--text' as string]: '#F5F5F7',
  ['--text-muted' as string]: 'rgba(255,255,255,0.92)',
  // Body / nav items / most label text. Was 0.55 — too grey, users on
  // dark mode reported eye-strain on the sidebar. Bumped to 0.86 so a
  // resting nav row reads as actual white-ish, with the active state
  // staying accent-violet. Hover still goes to --text (pure white).
  ['--text-soft' as string]: 'rgba(255,255,255,0.86)',
  ['--text-subtle' as string]: 'rgba(255,255,255,0.78)',
  // Section labels (GROW, COLLABORATE…). Was 0.40 — barely visible.
  // Bumped to 0.65 with letter-spacing still in the component to keep
  // the "small caps section header" rhythm.
  ['--text-faint' as string]: 'rgba(255,255,255,0.65)',
  ['--text-dim' as string]: 'rgba(255,255,255,0.50)',
  ['--card-shadow' as string]: 'inset 0 1px 0 rgba(255,255,255,0.04), 0 1px 2px rgba(0,0,0,0.2)',
  ['--kbd-bg' as string]: 'rgba(255,255,255,0.06)',
  ['--hero-opacity' as string]: '0.35',
  ['--nav-active-bg' as string]: 'rgba(124,58,237,0.20)',
  ['--nav-active-text' as string]: '#D4C4FF',
}

const LIGHT_VARS: React.CSSProperties = {
  ['--bg' as string]: '#FAFAF8',
  ['--bg-sidebar' as string]: '#F4F2EE',
  ['--surface' as string]: '#FFFFFF',
  ['--surface-hover' as string]: 'rgba(0,0,0,0.04)',
  ['--surface-bright' as string]: 'rgba(0,0,0,0.06)',
  ['--surface-selected' as string]: 'rgba(124,58,237,0.08)',
  ['--border' as string]: 'rgba(0,0,0,0.10)',
  ['--border-bright' as string]: 'rgba(0,0,0,0.18)',
  ['--text' as string]: '#1D1D1F',
  ['--text-muted' as string]: 'rgba(0,0,0,0.86)',
  // Bumped to match the dark-mode readability calibration (0.82 → 0.78
  // → 0.65). Body / nav rows now look proper black-ink instead of
  // washed out grey.
  ['--text-soft' as string]: 'rgba(0,0,0,0.78)',
  ['--text-subtle' as string]: 'rgba(0,0,0,0.68)',
  ['--text-faint' as string]: 'rgba(0,0,0,0.55)',
  ['--text-dim' as string]: 'rgba(0,0,0,0.40)',
  ['--card-shadow' as string]: '0 1px 3px rgba(0,0,0,0.04), 0 0 0 1px rgba(0,0,0,0.02)',
  ['--kbd-bg' as string]: 'rgba(0,0,0,0.05)',
  ['--hero-opacity' as string]: '0.18',
  ['--nav-active-bg' as string]: 'rgba(124,58,237,0.10)',
  ['--nav-active-text' as string]: '#7C3AED',
}

interface DashboardShellV2Props {
  email?: string
  wpSiteUrl: string | null
  tier: Tier | string
  showBuyingGuides: boolean
  showDeals: boolean
  children: React.ReactNode
}

export default function DashboardShellV2({
  email,
  wpSiteUrl,
  tier,
  showBuyingGuides,
  showDeals,
  children,
}: DashboardShellV2Props) {
  const pathname = usePathname() || ''
  const router = useRouter()
  const { theme, setTheme } = useTheme()
  const supabase = createBrowserClient()
  const isDark = theme !== 'light' // default to dark when unset

  // Persist collapsed state across navigations.
  const [collapsed, setCollapsed] = useState(false)
  useEffect(() => {
    try {
      const saved = localStorage.getItem('mvp_shell_collapsed')
      if (saved === '1') setCollapsed(true)
    } catch { /* ignore */ }
  }, [])
  useEffect(() => {
    try { localStorage.setItem('mvp_shell_collapsed', collapsed ? '1' : '0') } catch { /* ignore */ }
  }, [collapsed])

  const isAdmin = tier === 'admin'

  // Admin "view as tier" dropdown state. Sourced from localStorage so the
  // sidebar reflects whichever tier the admin is currently previewing.
  const [viewAs, setViewAs] = useState<Tier>('admin')
  useEffect(() => { setViewAs(getViewAsTier() ?? 'admin') }, [])

  // ── Nav definition ────────────────────────────────────────────────────
  // Mirrors the preview's IA but maps to the real routes. Gates honor the
  // server-supplied showBuyingGuides + showDeals (Pro/Studio tiering +
  // 500-post catalogue threshold) and metaEnabled (Instagram Burner).
  //
  // IA restructure 2026-06-05: a new "Set up" group sits between Today and
  // Create. It collects everything a brand-new user has to touch ONCE to
  // get the platform working for them: WordPress install, integrations,
  // brand identity, voice training, blog appearance, tutorials. Pulled
  // those items out of Manage and Settings so onboarding reads
  // top-to-bottom: see your dashboard -> set things up -> start creating.
  // The old Manage group folded into Today (Library is a "where am I
  // now" surface, same as Dashboard).
  // Build the WP-site shortcut URLs once so the group definition stays
  // declarative. Both external links — open in a new tab and don't
  // prefetch. Guarded by wpSiteUrl below so the whole group disappears
  // for users who haven't connected WordPress yet (avoids a dead nav
  // entry that does nothing).
  // wpBase / wpVisitHref / wpAdminHref were used by the now-removed
  // "Your Blog" sidebar group. The topbar uses `wpSiteUrl` directly
  // (computes the wp-admin suffix inline) so we no longer need the
  // pre-computed locals. Kept this comment so the deletion is
  // explained. 2026-06-08.

  const NAV_GROUPS: NavGroupDef[] = [
    // ── IA RESTRUCTURE 2026-06-12 (onboarding-funnel epic, Phase 1) ──────────
    // Sidebar regrouped into the funnel-aligned sections a user actually moves
    // through: SET UP (the 7 onboarding steps, in funnel order) → CREATE →
    // GROW → COLLABORATE → HELP & COMMUNITY. Dashboard sits headerless at the
    // top; Plan & Billing in its own small Account group at the bottom.
    // Hidden (routes alive, just unlinked): Analytics, Title audit, Instagram
    // Burner — not surfaced for now. The standalone Photobooth "Create" entry
    // folded into the single Face Models step (same /photobooth route).
    //
    // Headerless top item.
    {
      label: '',
      items: [
        { href: '/dashboard', icon: <Home size={15} />, label: 'Dashboard' },
      ],
    },
    {
      // SET UP — the onboarding spine, in the exact order the funnel walks a
      // new user through (Phase 2 turns these into guided Save-&-Next cards):
      //   1. WordPress      -> get a blog installed + connected (hard gate)
      //   2. YouTube        -> OAuth connect (channel ID auto-derived; Phase 2)
      //   3. Affiliate Links-> Geniuslink keys + groups / Amazon tag fallback
      //   4. Brand Profile  -> name, niches, tone
      //   5. Voice Training -> teach the AI your writing voice (LEARN)
      //   6. Customize Blog -> theme colors, layout, hero copy
      //   7. Face Models    -> upload selfies, train the reference model
      // NOTE (interim): Affiliate Links + Brand Profile both point at /brand
      // today (Geniuslink lives inside the brand page). Phase 2 splits
      // Geniuslink into its own funnel card/route.
      label: 'Set up',
      items: [
        { href: '/setup', icon: <Wrench size={15} />, label: 'WordPress' },
        // YouTube gets its OWN focused page (it's the most important integration
        // — every video→blog flow starts here), separate from the full socials
        // grid. "Connect Socials" sits at the bottom of SET UP for everything else.
        { href: '/connect-youtube', icon: <Youtube size={15} />, label: 'YouTube' },
        { href: '/brand', icon: <Palette size={15} />, label: 'Brand Profile' },
        { href: '/learn', icon: <Sparkles size={15} />, label: 'Voice Training' },
        { href: '/customize', icon: <Brush size={15} />, label: 'Customize Blog' },
        { href: '/photobooth', icon: <UserSquare size={15} />, label: 'Face Models' },
        { href: '/connect-socials', icon: <Share2 size={15} />, label: 'Connect Socials' },
      ],
    },
    {
      label: 'Create',
      items: [
        { href: '/co-pilot', icon: <Youtube size={15} />, label: 'YouTube Co-Pilot' },
        // "Library" renamed -> "Blog Post Generator" (2026-06-12 IA).
        { href: '/content', icon: <Library size={15} />, label: 'Blog Post Generator' },
        // Socials connection moved to SET UP > "Connect Socials" (it's setup,
        // not a create action). YouTube has its own SET UP > "YouTube" entry.
        { href: '/comparison', icon: <Scale size={15} />, label: 'Comparisons' },
        { href: '/buying-guides', icon: <BookOpen size={15} />, label: 'Buying Guides', gate: showBuyingGuides },
        { href: '/deals', icon: <BadgePercent size={15} />, label: 'Deals Hub', gate: showDeals },
        { href: '/script', icon: <PenLine size={15} />, label: 'Scriptwriter' },
        { href: '/newsletter', icon: <Mail size={15} />, label: 'Newsletter' },
        // Instagram Burner hidden 2026-06-12 (not ready). Route stays alive.
      ],
    },
    {
      label: 'Grow',
      items: [
        { href: '/seo', icon: <TrendingUp size={15} />, label: 'SEO & Indexing' },
        // Analytics + Title audit hidden 2026-06-12. Routes stay alive
        // (/analytics, /tools/title-audit) — just unlinked for now.
      ],
    },
    {
      label: 'Collaborate',
      items: [
        { href: '/collaborations', icon: <Handshake size={15} />, label: 'Brand Deals' },
        { href: '/agency', icon: <Users size={15} />, label: 'Virtual Assistant' },
      ],
    },
    {
      // HELP & COMMUNITY — support + learning surfaces. "Create a Help Ticket"
      // (-> /support) ships in Phase 3 with its DB table + admin inbox; the
      // nav entry is added then.
      label: 'Help & Community',
      items: [
        { href: '/brainstorm', icon: <Lightbulb size={15} />, label: 'Brainstorm' },
        { href: '/assistant', icon: <Bot size={15} />, label: 'MVP Help Desk' },
        { href: '/support', icon: <LifeBuoy size={15} />, label: 'Create a Help Ticket' },
        { href: '/tutorials', icon: <GraduationCap size={15} />, label: 'Tutorials' },
        { href: '/community', icon: <MessageCircle size={15} />, label: 'Community' },
      ],
    },
    {
      // Account — kept reachable; not part of the funnel IA but billing must
      // always be one click away (upgrades).
      label: 'Account',
      items: [
        { href: '/billing', icon: <CreditCard size={15} />, label: 'Plan & Billing' },
        // API Access (/developers) + White-label (/branding) remain hidden.
      ],
    },
    // Recommended tools — external partner-affiliate links the user earns
    // commission on. Carried over from the legacy Sidebar's "RECOMMENDED
    // TOOLS" block. Sits low in the IA (last public-user group) because
    // they're discovery items, not daily-driver routes. Each opens in a
    // new tab via external:true.
    //
    // Order is intentional, NOT alphabetical: Oink first (highest revenue
    // converter for this user), Geniuslink second (the user's own
    // wrapping tool that ties into every other affiliate link in the
    // dashboard), then the three programs in revenue-rank order.
    {
      label: 'Recommended tools',
      items: [
        { href: 'https://geni.us/2y5sBo', icon: <ExternalLink size={13} />, label: 'Oink', external: true },
        { href: 'https://geni.us/Y70p9R', icon: <ExternalLink size={13} />, label: 'Geniuslink', external: true },
        { href: 'https://geni.us/GCad5Q', icon: <ExternalLink size={13} />, label: 'Levanta', external: true },
        { href: 'https://geni.us/Z0q3hY', icon: <ExternalLink size={13} />, label: 'PartnerBoost', external: true },
        { href: 'https://geni.us/khuHTe', icon: <ExternalLink size={13} />, label: 'Archer Affiliate', external: true },
      ],
    },
    // Admin-only block. Only added to NAV_GROUPS when isAdmin so
    // non-admins never see these entries.
    //
    // Order: people / health first (Users, Failures), then
    // dollars + observability (AI Cost, Blog Quality, Template
    // Performance), then content tooling (Creator Campaigns
    // catalog, Designer-text playground, News banner), then
    // ops (Encrypt Secrets). Daily-drivers up top, one-off
    // tools below.
    ...(isAdmin ? [{
      label: 'Admin',
      items: [
        { href: '/admin/users', icon: <UserCog size={15} />, label: 'Users (admin)' },
        { href: '/admin/support-tickets', icon: <LifeBuoy size={15} />, label: 'Support tickets' },
        { href: '/admin/failures', icon: <AlertTriangle size={15} />, label: 'Failures' },
        { href: '/admin/cron', icon: <Activity size={15} />, label: 'Cron health' },
        // Title audit moved to /tools/title-audit and is now Creator+ accessible.
        // Admins still reach it via that route (the new gate allows trial+ paid;
        // admins are 'paid' in this taxonomy). No admin entry needed here. */
        { href: '/admin/costs', icon: <DollarSign size={15} />, label: 'AI Cost (admin)' },
        { href: '/admin/blog-quality', icon: <Activity size={15} />, label: 'Blog Quality' },
        { href: '/admin/template-performance', icon: <BarChart3 size={15} />, label: 'Template Performance' },
        { href: '/admin/creator-campaigns', icon: <Upload size={15} />, label: 'Creator Campaigns (admin)' },
        { href: '/admin/designer-text', icon: <Wand2 size={15} />, label: 'Designer Text Playground' },
        { href: '/admin/announcement', icon: <Newspaper size={15} />, label: 'News banner (admin)' },
        { href: '/admin/encrypt-secrets', icon: <ShieldCheck size={15} />, label: 'Encrypt Secrets' },
      ],
    }] : []),
  ]

  // ── Active-route detection. Match by prefix so a child route still
  // highlights its parent (e.g. /admin/users/123 lights /admin/users).
  const isActive = useCallback((href: string) => {
    // Special case: /setup?tab=integrations vs /setup vs
    // /setup?tab=integrations#social-platforms — all three target /setup
    // but should highlight independently. Splitting on '#' first then '?'
    // lets us match against pathname + ?tab + #hash separately so the
    // sidebar correctly disambiguates "Integrations" from
    // "Connect Socials" (same tab, different hash anchor).
    if (href.includes('?') || href.includes('#')) {
      // Split hash off first so the query parser doesn't pick it up.
      const [pathAndQuery, hashTarget] = href.split('#')
      const [path, query] = pathAndQuery.split('?')
      const tabKey = query ? new URLSearchParams(query).get('tab') : null
      if (typeof window !== 'undefined') {
        if (pathname !== path) return false
        const currentTab = new URLSearchParams(window.location.search).get('tab')
        const currentHash = window.location.hash.slice(1)
        if (tabKey !== null && currentTab !== tabKey) return false
        if (hashTarget) {
          // Entries with a hash only highlight when that hash is in the
          // URL. Entries WITHOUT a hash should NOT highlight when a hash
          // entry is the active one — otherwise both light up.
          return currentHash === hashTarget
        }
        return !currentHash
      }
      return false
    }
    if (href === '/dashboard') return pathname === '/dashboard'
    if (href === '/setup') {
      if (pathname !== '/setup') return false
      if (typeof window !== 'undefined') {
        const currentTab = new URLSearchParams(window.location.search).get('tab')
        return currentTab !== 'integrations'
      }
      return true
    }
    return pathname.startsWith(href)
  }, [pathname])

  async function handleLogout() {
    await supabase.auth.signOut()
    router.push('/login')
  }

  const userInitial = (email || 'U').slice(0, 1).toUpperCase()
  const wpHostname = wpSiteUrl ? wpSiteUrl.replace(/^https?:\/\//, '').replace(/\/+$/, '').slice(0, 24) : null

  return (
    <div
      style={{
        ...(isDark ? DARK_VARS : LIGHT_VARS),
        backgroundColor: 'var(--bg)',
        color: 'var(--text)',
      }}
      className="min-h-screen font-[Inter,system-ui,sans-serif] flex"
    >
      {/* ── Sidebar ───────────────────────────────────────────────────── */}
      <aside
        className={`${collapsed ? 'w-[68px]' : 'w-[232px]'} flex-shrink-0 border-r flex flex-col transition-[width] duration-200 sticky top-0 h-screen`}
        style={{ backgroundColor: 'var(--bg-sidebar)', borderColor: 'var(--border)' }}
      >
        {/* Brand + collapse toggle */}
        <div className="px-4 pt-5 pb-4 flex items-center justify-between">
          <Link href="/dashboard" className="flex items-center gap-2">
            <span className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#7C3AED] to-[#C026D3] flex items-center justify-center font-bold text-white text-[14px]">M</span>
            {!collapsed && (
              <span className="font-semibold text-[15px] tracking-tight" style={{ color: 'var(--text)' }}>
                MVP Affiliate
              </span>
            )}
          </Link>
          {!collapsed && (
            <button onClick={() => setCollapsed(true)} className="opacity-40 hover:opacity-90 transition-opacity" title="Collapse sidebar">
              <ChevronsLeft size={14} />
            </button>
          )}
        </div>

        {collapsed && (
          <button onClick={() => setCollapsed(false)} className="mx-auto mb-3 opacity-40 hover:opacity-90 transition-opacity" title="Expand sidebar">
            <ChevronsRight size={14} />
          </button>
        )}

        {/* Nav groups */}
        <nav className="flex-1 px-2 flex flex-col gap-5 overflow-y-auto pb-3">
          {NAV_GROUPS.map((group) => {
            const visibleItems = group.items.filter((it) => it.gate !== false)
            if (visibleItems.length === 0) return null
            return (
              <div key={group.label}>
                {!collapsed && group.label && (
                  <p
                    className="px-2.5 mb-1.5 text-[11px] uppercase tracking-[0.14em] font-semibold"
                    style={{ color: 'var(--text-faint)' }}
                  >
                    {group.label}
                  </p>
                )}
                <div className="flex flex-col gap-0.5">
                  {visibleItems.map((item) => (
                    <NavItem
                      key={item.href + item.label}
                      item={item}
                      active={isActive(item.href)}
                      collapsed={collapsed}
                    />
                  ))}
                </div>
              </div>
            )
          })}

          {/* Admin View-as dropdown — same lib/view-as.ts wiring as the
              legacy sidebar. Only renders when the real DB tier is admin
              (gated server-side via the `tier` prop). */}
          {isAdmin && !collapsed && (
            <div className="px-2.5">
              <p className="mb-1.5 text-[10px] uppercase tracking-[0.15em] font-medium" style={{ color: 'var(--text-faint)' }}>
                Admin · view as
              </p>
              <select
                value={viewAs}
                onChange={(e) => {
                  const v = e.target.value as Tier
                  setViewAs(v)
                  setViewAsTier(v === 'admin' ? null : v)
                  window.location.reload()
                }}
                className="w-full text-[12px] rounded-md px-2 py-1.5 border"
                style={{
                  backgroundColor: 'var(--surface)',
                  borderColor: 'var(--border)',
                  color: 'var(--text)',
                }}
                title="Preview the UI as each tier sees it. Visual only, your real admin access is unchanged."
              >
                <option value="admin">My view (Admin)</option>
                <option value="pro">Pro</option>
                <option value="studio">Studio</option>
                <option value="creator">Creator</option>
                <option value="trial">Free Trial</option>
              </select>
              {viewAs !== 'admin' && (
                <p className="mt-1 text-[10px]" style={{ color: '#FF9500' }}>
                  Previewing as {viewAs} · visual only
                </p>
              )}
            </div>
          )}
        </nav>

        {/* User pill */}
        <div className="border-t p-3" style={{ borderColor: 'var(--border)' }}>
          <div
            className={`flex items-center gap-2 px-2 py-1.5 rounded-lg group ${collapsed ? 'justify-center' : ''}`}
            style={{ backgroundColor: 'transparent' }}
          >
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-emerald-400 to-cyan-400 flex items-center justify-center text-[13px] font-semibold text-white flex-shrink-0">
              {userInitial}
            </div>
            {!collapsed && (
              <>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-semibold truncate" style={{ color: 'var(--text)' }}>
                    {email || 'Account'}
                  </p>
                  <p className="text-[11px] font-medium truncate" style={{ color: 'var(--text-faint)' }}>
                    {String(tier).charAt(0).toUpperCase() + String(tier).slice(1)} plan
                  </p>
                </div>
                <button
                  onClick={handleLogout}
                  className="opacity-40 group-hover:opacity-90 transition-opacity"
                  title="Sign out"
                >
                  <LogOut size={13} />
                </button>
              </>
            )}
          </div>
        </div>
      </aside>

      {/* ── Main column ───────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Topbar */}
        <div
          className="border-b px-8 py-3 flex items-center gap-3 backdrop-blur-md sticky top-0 z-10"
          style={{
            borderColor: 'var(--border)',
            backgroundColor: isDark ? 'rgba(14,14,17,0.85)' : 'rgba(250,250,248,0.85)',
          }}
        >
          {/* Site chip — shows the connected WordPress hostname. Click
              opens Setup → Integrations. Multi-site picker comes in a
              follow-up (needs wordpress_sites API wiring + dropdown). */}
          <Link
            href="/setup?tab=integrations"
            className="flex items-center gap-2 px-3 py-2 rounded-lg border text-[13px] font-medium transition-colors"
            style={{
              backgroundColor: 'var(--surface)',
              borderColor: 'var(--border)',
              color: 'var(--text)',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--surface-hover)')}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'var(--surface)')}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-[#7C3AED]" />
            {wpHostname || 'No WordPress yet'}
            <ChevronDown size={12} style={{ color: 'var(--text-faint)' }} />
          </Link>

          <div className="ml-auto flex items-center gap-3">
            {/* WP admin shortcut — links straight into wp-admin if a site
                is connected. */}
            {wpSiteUrl && (
              <>
                {/* Visit Blog — opens the LIVE WordPress site in a new
                    tab. Paired with WP Admin so both topbar shortcuts
                    are right next to each other. The old sidebar
                    "Your Blog" group was removed 2026-06-08 — these
                    two buttons replace it. */}
                <a
                  href={wpSiteUrl.replace(/\/+$/, '')}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-3 py-2 rounded-lg border text-[12px] font-medium inline-flex items-center gap-1.5 transition-colors"
                  style={{
                    backgroundColor: 'var(--surface)',
                    borderColor: 'var(--border)',
                    color: 'var(--text-soft)',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--surface-hover)')}
                  onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'var(--surface)')}
                  title="Open your live blog in a new tab"
                >
                  Visit Blog <ExternalLink size={11} />
                </a>
                <a
                  href={`${wpSiteUrl.replace(/\/+$/, '')}/wp-admin`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-3 py-2 rounded-lg border text-[12px] font-medium inline-flex items-center gap-1.5 transition-colors"
                  style={{
                    backgroundColor: 'var(--surface)',
                    borderColor: 'var(--border)',
                    color: 'var(--text-soft)',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--surface-hover)')}
                  onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'var(--surface)')}
                  title="Open WordPress admin in a new tab"
                >
                  WP Admin <ExternalLink size={11} />
                </a>
              </>
            )}

            {/* Theme toggle */}
            <button
              onClick={() => setTheme(isDark ? 'light' : 'dark')}
              className="p-1.5 rounded-lg transition-colors"
              style={{ color: 'var(--text-soft)' }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = 'var(--surface-hover)'
                e.currentTarget.style.color = 'var(--text)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'transparent'
                e.currentTarget.style.color = 'var(--text-soft)'
              }}
              title={`Switch to ${isDark ? 'light' : 'dark'} mode`}
            >
              {isDark ? <Sun size={14} /> : <Moon size={14} />}
            </button>

            {/* Help Desk button — replaces the old "Ask anything" Link. Rendered here,
                opens the panel which persists via context. */}
            {/* Dynamic import to avoid server-side errors when HelpDeskButton needs context */}
            <div suppressHydrationWarning>
              <HelpDeskButtonWrapper />
            </div>

            {/* Notification bell — last 7 days of scheduled-post results
                (completed / failed). Driven by /api/notifications which
                queries scheduled_posts updated_at desc. Polling 60s.
                See components/layout/NotificationBell.tsx. */}
            <NotificationBell />
          </div>
        </div>

        {/* Page content. Generous max-width so the new chrome doesn't
            crush wide content (e.g. the comparison table on /comparison
            or the catalogue grid on /content). */}
        <main className="flex-1 overflow-y-auto w-full">
          <div className="max-w-7xl px-4 sm:px-6 lg:px-8 pt-6 pb-12">
            {children}
          </div>
        </main>
      </div>
    </div>
  )
}

// ── Sub-components ──────────────────────────────────────────────────────

function NavItem({ item, active, collapsed }: { item: NavItemDef; active: boolean; collapsed: boolean }) {
  // External items (Recommended tools) open in a new tab via a plain <a>
  // — Next.js Link's prefetcher is wasted on offsite URLs, and we want
  // target="_blank" + rel="noopener" for safety on partner links.
  const className = cn(
    // 14px + font-semibold + py-2 for legibility (calibrated for the
    // dark theme in commit 929cdb4).
    'relative flex items-center gap-2.5 py-2 rounded-lg text-[14px] font-semibold transition-colors',
    collapsed ? 'justify-center' : 'px-2.5',
  )
  const style: React.CSSProperties = {
    backgroundColor: active ? 'var(--nav-active-bg)' : 'transparent',
    color: active ? 'var(--nav-active-text)' : 'var(--text-soft)',
  }
  const onMouseEnter = (e: React.MouseEvent<HTMLElement>) => {
    if (!active) {
      e.currentTarget.style.backgroundColor = 'var(--surface-hover)'
      e.currentTarget.style.color = 'var(--text)'
    }
  }
  const onMouseLeave = (e: React.MouseEvent<HTMLElement>) => {
    if (!active) {
      e.currentTarget.style.backgroundColor = 'transparent'
      e.currentTarget.style.color = 'var(--text-soft)'
    }
  }

  const inner = (
    <>
      {/* Left indicator bar — only for active internal items. External
          tools never get the bar even on hover. */}
      {active && <span className="absolute -left-2 top-2 bottom-2 w-[3px] rounded-r-full bg-[#7C3AED]" />}
      <span className="flex-shrink-0">{item.icon}</span>
      {!collapsed && <span className="flex-1 truncate">{item.label}</span>}
      {/* External-link glyph — small tail icon hinting "opens off-site".
          Hidden when the sidebar is collapsed (the row icon is already
          ExternalLink in that mode). */}
      {!collapsed && item.external && (
        <ExternalLink size={11} className="opacity-60 flex-shrink-0" />
      )}
      {!collapsed && item.badge !== undefined && (
        <span
          className="text-[11px] tabular-nums px-1.5 py-0.5 rounded font-semibold"
          style={{
            backgroundColor: active ? 'rgba(124,58,237,0.22)' : 'var(--surface-bright)',
            color: active ? 'var(--nav-active-text)' : 'var(--text-soft)',
          }}
        >
          {item.badge}
        </span>
      )}
    </>
  )

  if (item.external) {
    return (
      <a
        href={item.href}
        target="_blank"
        rel="noopener noreferrer"
        title={collapsed ? `${item.label} (opens in new tab)` : undefined}
        className={className}
        style={style}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
      >
        {inner}
      </a>
    )
  }

  return (
    <Link
      href={item.href}
      title={collapsed ? item.label : undefined}
      className={className}
      style={style}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {inner}
    </Link>
  )
}


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

import { useState, useEffect, useCallback, Fragment } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import Link from 'next/link'
import { useTheme } from 'next-themes'
import { createBrowserClient } from '@/lib/supabase/client'
import { getViewAsTier, setViewAsTier } from '@/lib/view-as'
import { tierBadge } from '@/lib/tier-badge'
import { canUpgradeTier, TIERS } from '@/lib/tier'
import { canSeeNav, canBrowseDealRadar, canUsePassport } from '@/lib/feature-access'
import type { Tier } from '@/lib/tier'
import {
  Home, Youtube, Library, Mail, Palette, Brush, TrendingUp,
  Settings, CreditCard, Bot, ChevronsLeft, ChevronsRight,
  Bell, ChevronDown, Sparkles, PenLine, Scale, Calendar,
  Sun, Moon, BookOpen, BadgePercent, Handshake, Radar, Bookmark,
  KeyRound, Users, LogOut, ExternalLink,
  UserCog, AlertTriangle, DollarSign, Newspaper, Plug, Wrench,
  Camera, MessageCircle, Activity, BarChart3, Wand2, ShieldCheck,
  Share2, UserSquare, LifeBuoy, Link2, FlaskConical, Store, Send, ShoppingBag, Megaphone,
  Inbox, PackageSearch, Rocket, Database, History, Globe,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { DEALS_HUB_PAUSED } from '@/lib/deal-occasion'
import NotificationBell from './NotificationBell'
import WpUpdateTopbarButton from './WpUpdateTopbarButton'
import TopbarSearch from './TopbarSearch'
import WpConnectionDoctorButton from './WpConnectionDoctorButton'
import PurgeCacheTopbarButton from './PurgeCacheTopbarButton'
import ScoutTopbarButton from './ScoutTopbarButton'
import SocialHealthTopbarButton from './SocialHealthTopbarButton'
import UsageBar from './UsageBar'
import UsageNudge from './UsageNudge'
import AmazonTagNudge from './AmazonTagNudge'
import { passportLinkUrl } from '@/lib/passport-links'
import SiteSwitcherChip from './SiteSwitcherChip'
import { HelpDeskButton } from '@/components/HelpDeskSidebar'
import AmazonUpgradeGate from '@/components/upgrade/AmazonUpgradeGate'
import PermalinkAutoHeal from '@/components/PermalinkAutoHeal'
import AnnouncementModal from '@/components/dashboard/AnnouncementModal'

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
  /** Small pill on the right: a count (e.g. unread) or a short status word
   *  like "Paused". */
  badge?: number | string
  /** Hide unless gate is true. Used for showBuyingGuides + showDeals
   *  + admin-only links. */
  gate?: boolean
  /** External link — opens in a new tab. Used for the Recommended Tools
   *  group (Oink, Levanta, etc.) — those are partner-affiliate links
   *  the user earns commission on, so they get a small ExternalLink
   *  glyph + always-new-tab behaviour. */
  external?: boolean
  /** Optional TEXT colour to make a row pop (e.g. Oink = Barbie pink, the
   *  highest-converting partner link). Tints the label + icon; background
   *  stays normal. Persists through hover/active. */
  highlight?: string
  /** Optional small sub-label rendered ABOVE this item, starting a visual
   *  sub-group inside a section (with a little top spacing). Used by the Amazon
   *  consolidated hub to break its long list into Create / Find & earn / etc. */
  subheading?: string
}

interface NavGroupDef {
  label: string
  items: NavItemDef[]
  /** Optional accent colour for the section header — tints the label text +
   *  the leading icon so a special zone (e.g. Labs) reads as distinct from
   *  the default grey section headers. */
  accent?: string
  /** Optional leading icon rendered before the section label. Pairs with
   *  `accent` to give a group its own identity. */
  icon?: React.ReactNode
}

// ── Per-section sidebar identity ────────────────────────────────────────────
// Every nav section gets its own accent colour + a leading icon on its header
// (the treatment we first gave Labs), so the sidebar reads as colour-coded
// zones. Each accent is TWO tones — a bright one for the near-black dark
// sidebar (#0B0B0E) and a deeper one for the near-white light sidebar
// (#F4F2EE) — because a single mid-tone washes out on one end. Resolved per
// theme at render time, keyed by the group label. Hues are spread so adjacent
// sections stay distinct and steer clear of the brand violet (active state),
// Oink pink, and amber warnings.
const SECTION_ACCENTS: Record<string, { dark: string; light: string }> = {
  'Set up':            { dark: '#60A5FA', light: '#1D4ED8' }, // blue      — foundational
  'Create':            { dark: '#FACC15', light: '#A16207' }, // yellow    — creative core
  'Amazon Influencer': { dark: '#FB923C', light: '#C2410C' }, // orange    — Amazon storefront
  'Grow':              { dark: '#C084FC', light: '#7E22CE' }, // purple    — growth
  'Research':          { dark: '#A3E635', light: '#4D7C0F' }, // green     — find products & campaigns
  'Source & Earn':     { dark: '#A3E635', light: '#4D7C0F' }, // green     — find & monetize (legacy key)
  'Collaborate':       { dark: '#F472B6', light: '#BE185D' }, // pink      — deals / people
  'Labs':              { dark: '#F87171', light: '#DC2626' }, // red       — experimental
  'Help & Community':  { dark: '#5EEAD4', light: '#0D9488' }, // turquoise — support
  'Account':           { dark: '#94A3B8', light: '#475569' }, // slate     — neutral utility
  'Recommended tools': { dark: '#2DD4BF', light: '#0F766E' }, // teal      — discovery
  'Admin':             { dark: '#F87171', light: '#B91C1C' }, // red       — control / danger
}

// Leading icon per section header (matches the Labs flask). Keyed by label.
const SECTION_ICONS: Record<string, React.ReactNode> = {
  'Set up': <Plug size={12} />,
  'Create': <Sparkles size={12} />,
  'Amazon Influencer': <ShoppingBag size={12} />,
  'Research': <PackageSearch size={12} />,
  'Source & Earn': <DollarSign size={12} />,
  'Grow': <BarChart3 size={12} />,
  'Collaborate': <Share2 size={12} />,
  'Labs': <FlaskConical size={12} />,
  'Help & Community': <LifeBuoy size={12} />,
  'Account': <UserCog size={12} />,
  'Recommended tools': <Wrench size={12} />,
  'Admin': <ShieldCheck size={12} />,
}

// Turn a #RRGGBB section accent into an rgba() wash so every section can render
// as its own colour-coded card (background + border) derived from its accent —
// one source of truth for the header colour AND the card tint.
function hexToRgba(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return hex
  const n = parseInt(m[1], 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`
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
  showBurner: boolean
  /** Content-only ("bring your own theme") user — hide MVP-theme-only nav
   *  items like Customize Blog. Defaults false. */
  contentOnly?: boolean
  children: React.ReactNode
}

export default function DashboardShellV2({
  email,
  wpSiteUrl,
  tier,
  showBuyingGuides,
  showDeals,
  showBurner,
  contentOnly = false,
  children,
}: DashboardShellV2Props) {
  const pathname = usePathname() || ''
  const router = useRouter()
  const { theme, setTheme } = useTheme()
  const supabase = createBrowserClient()
  const isDark = theme !== 'light' // default to dark when unset

  // Some pages mutate the query string with raw history.replaceState (e.g.
  // /content switching to the Social-Push/Published tab). That doesn't change
  // `pathname` or fire a router update, so the active-highlight below — which
  // reads window.location.search — would go stale. Bump a counter on those
  // events so isActive recomputes and the right sidebar item lights up.
  const [locTick, setLocTick] = useState(0)
  useEffect(() => {
    const bump = () => setLocTick((t) => t + 1)
    window.addEventListener('popstate', bump)
    window.addEventListener('mvp:locationchange', bump)
    return () => {
      window.removeEventListener('popstate', bump)
      window.removeEventListener('mvp:locationchange', bump)
    }
  }, [])

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

  // The Admin section is a long list of tools most sessions never touch, so keep
  // it COLLAPSED by default and let the admin expand it on demand (choice
  // persisted). It force-opens while you're actually on an /admin page so the
  // active tool stays visible.
  const [adminOpen, setAdminOpen] = useState(false)
  useEffect(() => {
    try { if (localStorage.getItem('mvp_admin_nav_open') === '1') setAdminOpen(true) } catch { /* ignore */ }
  }, [])
  useEffect(() => {
    try { localStorage.setItem('mvp_admin_nav_open', adminOpen ? '1' : '0') } catch { /* ignore */ }
  }, [adminOpen])

  const isAdmin = tier === 'admin'

  // Admin "view as tier" — sourced from localStorage. This now re-gates the
  // SIDEBAR itself (not just the badge): previewing as Free Trial shows exactly
  // the nav a real trial user gets, so what's hidden/locked can be trusted. It
  // stays a VISUAL preview — the real account keeps its access and every route
  // still enforces the real tier; this only changes which nav entries render.
  const [viewAs, setViewAs] = useState<Tier>('admin')
  useEffect(() => { setViewAs(getViewAsTier() ?? 'admin') }, [])

  // The tier the SIDEBAR is drawn for: the previewed tier when an admin is
  // "viewing as", the real tier for everyone else. isAdmin deliberately stays on
  // the REAL tier so the admin tools + the view-as dropdown never vanish while
  // previewing (you'd have no way back).
  const effectiveTier: Tier = isAdmin && viewAs !== 'admin' ? viewAs : (tier as Tier)

  // Paid = any non-trial plan (Creator, Studio, Pro, admin). Not a feature
  // gate on its own — used for generic paid-vs-trial UI copy.
  const isPaid = effectiveTier !== 'trial'
  // Feature nav gates come from lib/feature-access.ts so the sidebar and
  // the enforcing routes are described in one place. See that file: the
  // nav is a hint, the route is the law.
  const isPro = canSeeNav('labs', effectiveTier)
  const canUseFinders = canSeeNav('finders', effectiveTier)
  // Server passes showBuyingGuides/showDeals for the REAL tier; recompute from
  // effectiveTier so the preview is accurate. Identical to the props when not
  // previewing (effectiveTier === tier then), so real users are unaffected.
  // Articles (Create → Articles): its own cap, open to Creator/Studio/Pro (+admin).
  // Only 0 (trial, Amazon) is NOT entitled; null (admin, unlimited) and any
  // positive cap ARE. Note: DON'T coalesce null→0 here — that hid it from admin.
  const canUseArticles = TIERS[effectiveTier]?.articlesPerMonth !== 0
  const showBuyingGuidesEff = isAdmin ? canSeeNav('buyingGuides', effectiveTier) : showBuyingGuides
  const showDealsEff = isAdmin ? canSeeNav('deals', effectiveTier) : showDeals
  // The Amazon Influencer section (thumbnails + research + social) is the
  // standalone Amazon tier's home, and is also shared into Studio + Pro.
  const canAmazonHub = (['amazon', 'studio', 'pro', 'admin'] as string[]).includes(effectiveTier)

  // Admin-only: count of OPEN support tickets (not yet answered/closed). Drives
  // the red "Support" alert in the topbar so the founder catches new tickets
  // from any page. Polls every 60s; only fetched for admins.
  const [openTickets, setOpenTickets] = useState(0)
  useEffect(() => {
    if (!isAdmin) return
    let cancelled = false
    const load = async () => {
      try {
        const res = await fetch('/api/admin/support-tickets/open-count')
        if (!res.ok || cancelled) return
        const d = await res.json()
        if (!cancelled) setOpenTickets(Number(d?.count) || 0)
      } catch { /* transient — interval retries */ }
    }
    load()
    const t = setInterval(load, 60_000)
    return () => { cancelled = true; clearInterval(t) }
  }, [isAdmin])
  const ticketAlert = isAdmin && openTickets > 0

  // Unread brand inquiries — drives the count badge on the "Brand Inquiries"
  // nav item so a creator sees at a glance how many new brand messages are
  // waiting. Cheap head-count query (?count=1); polled every 60s AND refetched
  // on navigation so the badge clears right after they open the inbox (which
  // marks everything read). Runs for every user — the query is owner-scoped and
  // returns 0 fast for anyone who hasn't enabled the feature.
  const [unreadBrand, setUnreadBrand] = useState(0)
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const res = await fetch('/api/brand-inquiries?count=1')
        if (!res.ok || cancelled) return
        const d = await res.json()
        if (!cancelled) setUnreadBrand(Number(d?.unread) || 0)
      } catch { /* transient — interval retries */ }
    }
    load()
    const t = setInterval(load, 60_000)
    return () => { cancelled = true; clearInterval(t) }
  }, [pathname])

  // Sidebar brand badge. Every tier has its own square lockup (the art already
  // contains the "MVP Affiliate" wordmark, so it replaces the mark AND title).
  // An admin previewing another tier sees that tier's badge. If art is ever
  // missing for a tier, the shell falls back to the purple "M" + title.
  const badgeTier: Tier | string = isAdmin && viewAs !== 'admin' ? viewAs : tier
  const brandBadge = tierBadge(badgeTier)

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
        { href: '/tutorials', icon: <BookOpen size={15} />, label: 'Tutorials' },
        { href: '/setup', icon: <Wrench size={15} />, label: 'WordPress' },
        // YouTube gets its OWN focused page (it's the most important integration
        // — every video→blog flow starts here), separate from the full socials
        // grid. "Connect Socials" sits at the bottom of SET UP for everything else.
        { href: '/connect-youtube', icon: <Youtube size={15} />, label: 'YouTube' },
        { href: '/brand', icon: <Palette size={15} />, label: 'Brand Profile' },
        { href: '/learn', icon: <Sparkles size={15} />, label: 'Voice Training' },
        // Customize Blog drives the MVP theme's colors/layout/hero — useless
        // for content-only ("bring your own theme") users, so hide it for them.
        { href: '/customize', icon: <Brush size={15} />, label: 'Customize Blog', gate: !contentOnly },
        { href: '/photobooth', icon: <UserSquare size={15} />, label: 'Face Models' },
        { href: '/connect-socials', icon: <Share2 size={15} />, label: 'Connect Socials' },
        // External Integrations — connect your own API keys for outside networks
        // (Levanta, PartnerBoost, Wayward). Paid tiers only (matches the API gate).
        { href: '/external-integrations', icon: <Plug size={15} />, label: 'External Integrations', gate: canUseFinders },
        // Ads — one home for AdSense + affiliate banners. Shown to everyone:
        // AdSense injection works on BYO-theme sites too (via the MVP plugin),
        // and the /ads page itself hides the theme-only banner blocks for
        // content-only sites.
        { href: '/ads', icon: <Megaphone size={15} />, label: 'Ads' },
        // Social Launch Kit — graduated OUT of Labs into SET UP (under Ads),
        // opened to ALL PAID tiers (canUseFinders = tier !== 'trial'), 2026-07-08.
        { href: '/social-launch-kit', icon: <Rocket size={15} />, label: 'Social Launch Kit', gate: canUseFinders },
      ],
    },
    {
      label: 'Create',
      items: [
        { href: '/co-pilot', icon: <Youtube size={15} />, label: 'YouTube Co-Pilot' },
        // "Library" renamed -> "Blog Post Generator" (2026-06-12 IA).
        { href: '/content', icon: <Library size={15} />, label: 'Blog Post Generator' },
        // Jumps straight to the "Published Posts & Social Push" tab — publish or
        // schedule any existing post to every connected channel.
        { href: '/content?tab=posts', icon: <Send size={15} />, label: 'Social Push' },
        // Clip Factory — turn one long video into vertical Reels/TikToks/Shorts.
        // Graduated from Labs 2026-08; Pro-only (page + APIs already Pro-gated,
        // capped at 50 finished Shorts/month, source videos capped at 10 min).
        { href: '/clip-factory', icon: <Rocket size={15} />, label: 'Clip Factory', gate: isPro },
        // Deal Radar moved to the RESEARCH section (2026-07-30) — it's a
        // product-discovery tool, so it lives with the other research finders.
        // Link in Bio — a shoppable affiliate "Shop Grid" page at /s/<handle>,
        // auto-filled from posted products. All paid tiers (same gate as Deal Radar).
        { href: '/link-in-bio', icon: <Link2 size={15} />, label: 'Link in Bio', gate: canSeeNav('dealRadar', effectiveTier) },
        // Socials connection moved to SET UP > "Connect Socials" (it's setup,
        // not a create action). YouTube has its own SET UP > "YouTube" entry.
        { href: '/comparison', icon: <Scale size={15} />, label: 'Comparisons' },
        { href: '/buying-guides', icon: <BookOpen size={15} />, label: 'Buying Guides', gate: showBuyingGuidesEff },
        // Articles — informational (non-product) long-form article generator.
        // v1 is admin-only while we test it, so it's gated on isAdmin (the REAL
        // tier, never re-gated by "view as").
        { href: '/articles', icon: <Newspaper size={15} />, label: 'Articles', gate: canUseArticles },
        // Idea Lists → Shopping Guide — read an Amazon idea list, score the
        // products, publish a curated shopping-guide post. Paid tiers.
        { href: '/idea-lists', icon: <ShoppingBag size={15} />, label: 'Idea Lists', gate: canUseFinders },
        // MVP x LTK — paste an LTK link → SEO blog post with the LTK link as the
        // CTA. Graduated OUT of Labs into Create (right under Buying Guides) and
        // opened to ALL PAID tiers (canUseFinders = tier !== 'trial'), 2026-07-08.
        { href: '/ltk', icon: <Sparkles size={15} />, label: 'MVP x LTK', gate: canUseFinders },
        { href: '/deals', icon: <BadgePercent size={15} />, label: 'Deals Hub', gate: showDealsEff, badge: DEALS_HUB_PAUSED ? 'Paused' : undefined },
        { href: '/script', icon: <PenLine size={15} />, label: 'Scriptwriter' },
        { href: '/newsletter', icon: <Mail size={15} />, label: 'Newsletter' },
        // Shop Burner retired 2026-08 → /instagram-burner redirects to
        // /clip-factory, which now hosts the single-clip flow AND the ported
        // batch/schedule mode.
      ],
    },
    {
      // AMAZON INFLUENCER — the storefront creator's home: turn a product link
      // into a thumbnail (MVP Art Director), find products to review, and push
      // to Pinterest / Instagram / Facebook. Own the Amazon tier; shared into
      // Studio + Pro. Gated by canAmazonHub so the whole section hides for tiers
      // that don't include it (empty groups return null).
      label: 'Amazon Influencer',
      items: [
        { href: '/amazon/thumbnails', icon: <Sparkles size={15} />, label: 'Thumbnail Generator', gate: canAmazonHub },
        { href: '/amazon/research', icon: <PackageSearch size={15} />, label: 'Research', gate: canAmazonHub },
        { href: '/amazon/social', icon: <Share2 size={15} />, label: 'Social Influencer', gate: canAmazonHub },
      ],
    },
    {
      // RESEARCH — where a creator goes to FIND products & campaigns worth
      // making content about (2026-07-30, renamed from "Source & Earn" and
      // folded in Deal Radar). AMZ Product Research = the whole Amazon catalogue
      // + Affiliate+ (Creator Connections). Deal Radar = live Amazon deals.
      // Levanta / PartnerBoost = external affiliate-program finders. Placed right
      // under Create. RESEARCH is the FREE-discovery magnet — every signed-in
      // tier (incl. Free Trial) sees ALL the finders here, so cold prospects can
      // explore what MVP surfaces. AMZ Research is genuinely free (search is open
      // to every tier; the page only gates paid ACTIONS). Deal Radar browse is
      // open. Levanta / PartnerBoost stay visible but their pages show the
      // upgrade card on trial (paid external-network finders). Section colour
      // comes from the shared SECTION_ACCENTS wash keyed off this label.
      label: 'Research',
      items: [
        { href: '/amz-finder', icon: <PackageSearch size={15} />, label: 'AMZ Research' },
        { href: '/deal-radar', icon: <Radar size={15} />, label: 'Deal Radar', gate: canBrowseDealRadar(effectiveTier) },
        { href: '/cc-campaigns', icon: <BadgePercent size={15} />, label: 'CC Campaigns', gate: canBrowseDealRadar(effectiveTier) },
        { href: '/epc-library', icon: <TrendingUp size={15} />, label: 'EPC Library', gate: canBrowseDealRadar(effectiveTier) },
        { href: '/saved-campaigns', icon: <Bookmark size={15} />, label: 'Saved Campaigns', gate: canBrowseDealRadar(effectiveTier) },
        { href: '/levanta', icon: <ShoppingBag size={15} />, label: 'MVP x Levanta' },
        { href: '/partnerboost', icon: <Store size={15} />, label: 'MVP x PartnerBoost' },
        // MVP x Wayward — graduated out of Labs 2026-08. Amazon Attribution catalog
        // (300k+ products, 20–30% commissions); page/APIs gated by the user's own
        // Wayward key, so it sits with the other network finders (no tier gate).
        { href: '/wayward', icon: <ShoppingBag size={15} />, label: 'MVP x Wayward' },
      ],
    },
    {
      label: 'Grow',
      items: [
        // Passport Links — MVP-native geo-routing (each visitor → their own
        // country's Amazon) + click analytics + Geniuslink-style groups. Graduated
        // out of Labs 2026-08; Studio + Pro only (gate: canUsePassport).
        { href: '/passport', icon: <Globe size={15} />, label: 'Passport Links', gate: canUsePassport(effectiveTier) },
        { href: '/seo', icon: <TrendingUp size={15} />, label: 'SEO & Indexing' },
        // Storefront moved into LABS 2026-08 (gate: isPro) while the SCOUT
        // full-year + full-catalog sync is finished — released publicly once
        // ready. See the Labs group below.
        // Pulse — which hashtags actually earn reach, learned from your posts +
        // pooled across MVP per niche. Feeds proven tags back into captions.
        { href: '/pulse', icon: <Activity size={15} />, label: 'Pulse', gate: isPro },
      ],
    },
    // Site Tools nav group removed 2026-08-15 — the five post-publish utilities
    // (Title Check, Clean Links, Duplicates, Fix 404s, Fix Formatting) all live
    // under SEO & Indexing now, reached via the shared SeoHubTabs bar on /seo
    // and each /tools/* page. A separate top-level group just duplicated them.
    // The /tools/* routes still exist; they're only no longer a second nav home.
    {
      label: 'Collaborate',
      items: [
        // One consolidated timeline of every brand relationship (inbound + pitches + campaigns).
        { href: '/brand-hub', icon: <History size={15} />, label: 'Brand Hub' },
        { href: '/collaborations', icon: <Handshake size={15} />, label: 'Brand Deals' },
        // Inbound: brand messages from the blog's "Work with brands" banner.
        { href: '/brand-inquiries', icon: <Inbox size={15} />, label: 'Brand Inquiries', badge: unreadBrand > 0 ? unreadBrand : undefined },
        { href: '/agency', icon: <Users size={15} />, label: 'Virtual Assistant' },
      ],
    },
    // Recommended tools — external partner-affiliate links the user earns
    // commission on. Placed ABOVE Labs (user request 2026-06-23) so the
    // revenue-converting discovery links sit higher than the experimental Labs
    // zone. Each opens in a new tab via external:true. Order is intentional,
    // NOT alphabetical: Oink first (highest revenue converter), Geniuslink
    // second (the user's own wrapping tool), then programs in revenue-rank order.
    {
      label: 'Recommended tools',
      items: [
        { href: 'https://geni.us/2y5sBo', icon: <ExternalLink size={13} />, label: 'Oink', external: true, highlight: '#E0218A' },
        { href: 'https://geni.us/Y70p9R', icon: <ExternalLink size={13} />, label: 'Geniuslink', external: true },
        { href: 'https://geni.us/GCad5Q', icon: <ExternalLink size={13} />, label: 'Levanta', external: true },
        { href: 'https://geni.us/Z0q3hY', icon: <ExternalLink size={13} />, label: 'PartnerBoost', external: true },
        { href: 'https://geni.us/khuHTe', icon: <ExternalLink size={13} />, label: 'Archer Affiliate', external: true },
        { href: 'https://geni.us/9qSLP', icon: <ExternalLink size={13} />, label: 'Cha-Ching Automate', external: true },
        { href: passportLinkUrl('trybe'), icon: <ExternalLink size={13} />, label: 'TRYBE', external: true },
      ],
    },
    // LABS — experimental tools, Pro-only (gate: isPro), NOT promoted on
    // landing/pricing until they graduate out. Retired 2026-07-08 (Social Launch
    // Kit graduated to SET UP), re-opened 2026-07-11 for Instagram Auto-DM
    // (Phase 1; dormant until Meta approves the messaging permissions).
    {
      label: 'Labs',
      items: [
        // AMZ Storefront — SCOUT-synced Amazon earnings + full-catalog analytics.
        // In LABS (Pro/admin-only) while the full-year + full-storefront sync is
        // finished; graduates back to "Grow" (gate: isPaid) when it's ready.
        { href: '/storefront', icon: <BarChart3 size={15} />, label: 'AMZ Storefront', gate: isPro },
        // Storefront Stats (/analytics) retired 2026-08 — the SCOUT-synced AMZ
        // Storefront dashboard (/brainstorm) is the real per-product earnings
        // view now, so the Geniuslink-clicks Labs page was dropped to kill the
        // name clash and the empty state for storefront-only creators.
        { href: '/instagram-dm', icon: <MessageCircle size={15} />, label: 'Instagram Auto-DM', gate: isPro },
        // MVP x Wayward graduated out of Labs 2026-08 → now under the network
        // finders, right below MVP x PartnerBoost.
        // Clip Factory graduated out of Labs 2026-08 → now lives under Create
        // (between Social Push and Link in Bio), open to all Pro tiers.
        // Deal Radar graduated out of Labs 2026-07-27 → now lives under
        // Create > Social Push, open to all paid tiers.
      ],
    },
    {
      // HELP & COMMUNITY — support + learning surfaces. "Create a Help Ticket"
      // (-> /support) ships in Phase 3 with its DB table + admin inbox; the
      // nav entry is added then.
      label: 'Help & Community',
      items: [
        { href: '/assistant', icon: <Bot size={15} />, label: 'MVP Help Desk' },
        { href: '/support', icon: <LifeBuoy size={15} />, label: 'Create a Help Ticket' },
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
        { href: '/admin/subscriptions', icon: <CreditCard size={15} />, label: 'Duplicate Subs (admin)' },
        { href: '/admin/blog-quality', icon: <Activity size={15} />, label: 'Blog Quality' },
        { href: '/admin/template-performance', icon: <BarChart3 size={15} />, label: 'Template Performance' },
        { href: '/admin/designer-text', icon: <Wand2 size={15} />, label: 'Designer Text Playground' },
        { href: '/admin/announcement', icon: <Newspaper size={15} />, label: 'News banner (admin)' },
        { href: '/admin/broadcast', icon: <Megaphone size={15} />, label: 'Broadcast email (admin)' },
        { href: '/admin/encrypt-secrets', icon: <ShieldCheck size={15} />, label: 'Encrypt Secrets' },
        { href: '/admin/cc-import', icon: <Database size={15} />, label: 'CC Catalog Import' },
      ],
    }] : []),
  ]

  // Amazon-tier sidebar: pull their hub (Amazon Influencer) to the top, then a
  // divider, then the rest of MVP — with a small "unlock" pill on the sections
  // their plan doesn't include. Amazon ONLY; every other tier keeps the default
  // order untouched.
  const amazonView = effectiveTier === 'amazon'
  // Walled garden (2026-08-13): an Amazon Influencer opening anything outside
  // their plan (blog / YouTube / newsletter / SEO / blog-tools) gets the upgrade
  // panel instead of the page. Denylist of PATH PREFIXES rather than an
  // allowlist, so account/billing/admin/support + every Amazon and shared
  // research-deal tool stay reachable by default (locking billing would trap the
  // user off the upgrade flow). Gated in the shell so it covers the sidebar
  // click, a dashboard card, and a pasted deep link from one place.
  const AMAZON_LOCKED_PREFIXES: { prefix: string; label: string; redirect?: { href: string; cta: string; body: string } }[] = [
    // Connect Socials isn't an upgrade for Amazon — they connect their approved
    // networks (Facebook, Pinterest, Instagram) from Social Influencer, so point
    // them there instead of showing the generic upsell.
    { prefix: '/connect-socials', label: 'Connect your socials', redirect: { href: '/amazon/social', cta: 'Go to Social Influencer', body: 'Amazon Influencers connect their approved networks (Facebook, Pinterest and Instagram) right inside Social Influencer, where you also publish your designs. Connect them there in one place.' } },
    { prefix: '/setup', label: 'WordPress & Blog Setup' },
    { prefix: '/connect-youtube', label: 'YouTube' },
    { prefix: '/learn', label: 'Voice Training' },
    { prefix: '/customize', label: 'Customize Blog' },
    { prefix: '/co-pilot', label: 'YouTube Co-Pilot' },
    { prefix: '/content', label: 'Blog Post Generator' },
    { prefix: '/clip-factory', label: 'Clip Factory' },
    { prefix: '/comparison', label: 'Comparison Posts' },
    { prefix: '/buying-guides', label: 'Buying Guides' },
    { prefix: '/idea-lists', label: 'Idea Lists' },
    { prefix: '/deals', label: 'Deals Hub' },
    { prefix: '/script', label: 'Scriptwriter' },
    { prefix: '/newsletter', label: 'Newsletter' },
    { prefix: '/ads', label: 'Ads' },
    { prefix: '/seo', label: 'SEO & Indexing' },
    { prefix: '/pulse', label: 'Pulse' },
    { prefix: '/tools', label: 'Blog Tools' },
    // Partner-network finders are Creator/Studio/Pro only (the Amazon plan is
    // Amazon-only, and these publish to a WordPress blog the plan doesn't have).
    // External Integrations only holds these finders' API keys, so it locks too.
    { prefix: '/levanta', label: 'MVP Levanta' },
    { prefix: '/partnerboost', label: 'MVP PartnerBoost' },
    { prefix: '/wayward', label: 'MVP Wayward' },
    { prefix: '/external-integrations', label: 'External Integrations' },
  ]
  const amazonLocked = amazonView
    ? AMAZON_LOCKED_PREFIXES.find((l) => pathname === l.prefix || pathname.startsWith(`${l.prefix}/`) || pathname.startsWith(`${l.prefix}?`))
    : undefined
  // Section label → the tier that unlocks it. Shown as a pill (amazon view only)
  // on sections this plan can't use. 'Create' is the blog/YouTube content area,
  // which the Amazon Influencer plan intentionally excludes.
  const AMAZON_LOCKED_SECTION: Record<string, string> = { Create: 'Creator+' }
  // Amazon view: the orange hub holds ALL the plan's tools, sub-grouped (Create
  // / Find & earn / Your brand / Account & help). Everything the Amazon plan
  // includes lives here; the rest of MVP still renders below (with the walled
  // garden showing an upgrade panel on access). Items moved into the hub — plus
  // the research finders surfaced inside the Research hub page — are stripped
  // from the groups below so nothing shows twice.
  const AMAZON_HUB: NavGroupDef = {
    label: 'Amazon Influencer',
    items: [
      { href: '/amazon/thumbnails', icon: <Sparkles size={15} />, label: 'Thumbnail Generator', subheading: 'Create' },
      { href: '/amazon/social', icon: <Share2 size={15} />, label: 'Social Influencer' },
      { href: '/social-launch-kit', icon: <Rocket size={15} />, label: 'Social Launch Kit' },
      { href: '/link-in-bio', icon: <Link2 size={15} />, label: 'Link in Bio' },
      // AMZ Storefront pulled from the Amazon hub 2026-08 — in LABS (admin/Pro)
      // until the SCOUT full-year + full-catalog sync is finished.
      { href: '/amazon/research', icon: <PackageSearch size={15} />, label: 'Research', subheading: 'Find & earn' },
      { href: '/brand-hub', icon: <History size={15} />, label: 'Brand Hub' },
      { href: '/collaborations', icon: <Handshake size={15} />, label: 'Brand Deals' },
      { href: '/brand-inquiries', icon: <Inbox size={15} />, label: 'Brand Inquiries', badge: unreadBrand > 0 ? unreadBrand : undefined },
      { href: '/brand', icon: <Palette size={15} />, label: 'Brand Profile', subheading: 'Your brand' },
      { href: '/photobooth', icon: <UserSquare size={15} />, label: 'Face Models' },
      { href: '/assistant', icon: <Bot size={15} />, label: 'MVP Help Desk', subheading: 'Account & help' },
      { href: '/support', icon: <LifeBuoy size={15} />, label: 'Create a Help Ticket' },
      { href: '/community', icon: <MessageCircle size={15} />, label: 'Community' },
      { href: '/billing', icon: <CreditCard size={15} />, label: 'Plan & Billing' },
    ],
  }
  const AMAZON_HUB_HREFS = new Set<string>(
    AMAZON_HUB.items.map((i) => i.href).concat([
      // Surfaced INSIDE the Research hub page, so no duplicate sidebar rows.
      '/amz-finder', '/deal-radar', '/cc-campaigns', '/saved-campaigns',
    ]),
  )
  const orderedGroups: NavGroupDef[] = (() => {
    if (!amazonView) return NAV_GROUPS
    const dash = NAV_GROUPS.find((g) => !g.label) // headerless Dashboard row stays on top
    const rest = NAV_GROUPS
      .filter((g) => g !== dash && g.label !== 'Amazon Influencer')
      .map((g) => ({ ...g, items: g.items.filter((it) => !AMAZON_HUB_HREFS.has(it.href)) }))
      .filter((g) => g.items.length > 0)
    return [dash, AMAZON_HUB, ...rest].filter(Boolean) as NavGroupDef[]
  })()

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
    // Blog Post Generator (/content) vs Social Push (/content?tab=posts): don't
    // light up the base item when the Social-Push tab is the active one.
    if (href === '/content') {
      if (pathname !== '/content') return false
      if (typeof window !== 'undefined') {
        return new URLSearchParams(window.location.search).get('tab') !== 'posts'
      }
      return true
    }
    return pathname.startsWith(href)
    // locTick: force recompute when a page mutates ?tab via replaceState.
  }, [pathname, locTick])

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
        {/* Brand + collapse toggle. Each tier shows its own square badge — the
            artwork already contains the "MVP Affiliate" wordmark, so it stands
            in for BOTH the mark and the title. The purple "M" + title branch is
            a fallback for any tier whose art is missing. */}
        {brandBadge ? (
          <div className={`relative ${collapsed ? 'px-3 pt-4 pb-2' : 'px-4 pt-4 pb-3'}`}>
            <Link href="/dashboard" className="block" title={`MVP Affiliate ${brandBadge.label}`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={brandBadge.src}
                alt={`MVP Affiliate ${brandBadge.label}`}
                width={collapsed ? 40 : 112}
                height={collapsed ? 40 : 112}
                draggable={false}
                className={`${collapsed ? 'w-10 h-10' : 'w-28 h-28'} mx-auto select-none`}
              />
            </Link>
            {!collapsed && (
              <button
                onClick={() => setCollapsed(true)}
                className="absolute top-3 right-3 opacity-40 hover:opacity-90 transition-opacity"
                title="Collapse sidebar"
              >
                <ChevronsLeft size={14} />
              </button>
            )}
          </div>
        ) : (
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
        )}

        {/* Upgrade CTA, directly under the tier badge. Shown for every tier that
            can still move up a plan (Trial, Creator, Studio) — never for Pro
            (top plan) or admin (staff, nothing to buy). Follows the previewed
            tier when an admin uses "View as tier". */}
        {canUpgradeTier(badgeTier) && (
          <div className={`${collapsed ? 'px-2' : 'px-4'} -mt-1 mb-2 flex justify-center`}>
            <Link
              href="/billing"
              title="Upgrade your plan"
              className={`inline-flex items-center justify-center gap-1 rounded-full font-semibold transition-opacity hover:opacity-80 ${
                collapsed ? 'p-1.5' : 'px-2.5 py-1 text-[11px]'
              }`}
              style={{ color: '#7C3AED', background: 'rgba(124,58,237,0.10)' }}
            >
              <Sparkles size={collapsed ? 15 : 12} />
              {!collapsed && 'Upgrade'}
            </Link>
          </div>
        )}

        {collapsed && (
          <button onClick={() => setCollapsed(false)} className="mx-auto mb-3 opacity-40 hover:opacity-90 transition-opacity" title="Expand sidebar">
            <ChevronsRight size={14} />
          </button>
        )}

        {/* Nav groups */}
        <nav className="flex-1 px-2 flex flex-col gap-5 overflow-y-auto pb-3">
          {orderedGroups.map((group) => {
            const visibleItems = group.items.filter((it) => it.gate !== false)
            if (visibleItems.length === 0) return null
            // Amazon view: a labelled divider after their hub separates "your
            // plan" from the rest of MVP.
            const showDividerAfter = amazonView && group.label === 'Amazon Influencer'
            // Amazon view: "unlock with X" pill on sections this plan can't use.
            const lockPill = amazonView ? AMAZON_LOCKED_SECTION[group.label] : undefined
            // Per-section header identity (colour + icon), theme-aware, keyed by
            // label. group.accent/group.icon win if a group sets them explicitly.
            const palette = group.label ? SECTION_ACCENTS[group.label] : undefined
            const headerAccent = group.accent ?? (palette ? (isDark ? palette.dark : palette.light) : undefined)
            const headerIcon = group.icon ?? (group.label ? SECTION_ICONS[group.label] : undefined)
            // Every named section (except neutral Account / Admin) renders as its
            // own colour-coded card — a faint wash + border in the section's
            // accent hue, like Source & Earn's green. Derived from headerAccent so
            // the card tint always tracks the header colour (see SECTION_ACCENTS).
            const isCard =
              !!group.label &&
              group.label !== 'Account' &&
              group.label !== 'Admin' &&
              !collapsed &&
              !!headerAccent
            const cardStyle = isCard && headerAccent
              ? {
                  backgroundColor: hexToRgba(headerAccent, isDark ? 0.10 : 0.08),
                  borderColor: hexToRgba(headerAccent, isDark ? 0.30 : 0.22),
                }
              : undefined
            // Admin group collapses to just its header when not in use (long,
            // rarely-touched tool list). Other groups always render their items.
            const isAdminGroup = group.label === 'Admin'
            const collapsibleSection = isAdminGroup && !collapsed
            const sectionOpen = !collapsibleSection || adminOpen || pathname.startsWith('/admin')
            return (
              <Fragment key={group.label || 'dashboard'}>
              <div
                className={cn(isCard && 'rounded-xl border p-2')}
                style={cardStyle}
              >
                {!collapsed && group.label && (
                  collapsibleSection ? (
                    <button
                      type="button"
                      onClick={() => setAdminOpen((o) => !o)}
                      className="w-full px-2.5 mb-1.5 text-[11px] uppercase tracking-[0.14em] font-semibold flex items-center gap-1.5 hover:opacity-80 transition-opacity"
                      style={{ color: headerAccent || 'var(--text-faint)' }}
                      aria-expanded={sectionOpen}
                      title={sectionOpen ? 'Collapse admin tools' : 'Expand admin tools'}
                    >
                      {headerIcon}
                      {group.label}
                      <ChevronDown
                        size={12}
                        className="ml-auto transition-transform"
                        style={{ transform: sectionOpen ? 'rotate(0deg)' : 'rotate(-90deg)' }}
                      />
                    </button>
                  ) : (
                    <p
                      className="px-2.5 mb-1.5 text-[11px] uppercase tracking-[0.14em] font-semibold flex items-center gap-1.5"
                      style={{ color: headerAccent || 'var(--text-faint)' }}
                    >
                      {headerIcon}
                      {group.label}
                      {lockPill && (
                        <span
                          className="ml-auto text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded"
                          title={`Included on ${lockPill.replace('+', ' and up')} plans`}
                          style={{ background: hexToRgba(headerAccent || '#7C3AED', isDark ? 0.22 : 0.14), color: headerAccent || 'var(--text-faint)' }}
                        >
                          {lockPill}
                        </span>
                      )}
                    </p>
                  )
                )}
                {sectionOpen && (
                  <div className="flex flex-col gap-0.5">
                    {visibleItems.map((item, idx) => (
                      <Fragment key={item.href + item.label}>
                        {!collapsed && item.subheading && (
                          <p
                            className={cn('px-2.5 pb-0.5 text-[9.5px] uppercase tracking-[0.12em] font-semibold', idx > 0 && 'pt-2')}
                            style={{ color: 'var(--text-faint)' }}
                          >
                            {item.subheading}
                          </p>
                        )}
                        <NavItem
                          item={item}
                          active={isActive(item.href)}
                          collapsed={collapsed}
                        />
                      </Fragment>
                    ))}
                  </div>
                )}
              </div>
              {showDividerAfter && (
                <div className="flex items-center gap-2 px-1 pt-0.5">
                  <span className="h-px flex-1" style={{ background: 'var(--border)' }} />
                  <span className="text-[9px] uppercase tracking-[0.14em] font-semibold" style={{ color: 'var(--text-faint)' }}>More in MVP</span>
                  <span className="h-px flex-1" style={{ background: 'var(--border)' }} />
                </div>
              )}
              </Fragment>
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
                title="Preview the UI as each tier sees it. Re-gates the sidebar so you see exactly what that tier sees; your real admin access is unchanged."
              >
                <option value="admin">My view (Admin)</option>
                <option value="pro">Pro</option>
                <option value="studio">Studio</option>
                <option value="amazon">Amazon Influencer</option>
                <option value="creator">Creator</option>
                <option value="trial">Free Trial</option>
              </select>
              {viewAs !== 'admin' && (
                <p className="mt-1 text-[10px]" style={{ color: '#FF9500' }}>
                  Previewing as {viewAs} · sidebar re-gated, your access unchanged
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
          {/* Site chip — shows the connected WordPress hostname. For single-site
              users it links to /setup (the multi-site manager). For Pro users
              with 2+ connected sites it becomes a real switcher: picking a blog
              sets it as the default, which the whole app follows. */}
          {/* The site chip is a WordPress switcher. Amazon Influencers have no
              WP site (sites: 0), so it would render "No WordPress yet" linking to
              a walled-off /setup — a confusing dead-end. Hide it for Amazon. */}
          {!amazonView && <SiteSwitcherChip currentHostname={wpHostname} />}

          {/* Search MVP — jump to any page or section (Geniuslink, upload
              brand logo, AdSense…). ⌘K focuses it from anywhere. */}
          <TopbarSearch isAdmin={isAdmin} />

          <div className="ml-auto flex items-center gap-3">
            {/* Get / Update SCOUT — a load-unpacked extension never auto-
                updates, so the latest zip is reachable here next to the WP
                theme-update button. Renders nothing when SCOUT is current. */}
            <ScoutTopbarButton />
            {/* Dead social connection alert — self-hides unless a channel has
                failed several scheduled posts in a row (expired token, or a
                platform still in the schedule that was never connected). Not
                gated on wpSiteUrl: it's about socials, not WordPress. */}
            <SocialHealthTopbarButton />
            {/* WP admin shortcut — links straight into wp-admin if a site
                is connected. */}
            {wpSiteUrl && (
              <>
                {/* Global update alert — shows on EVERY page (not just the
                    Dashboard hero where WpUpdatePill lives) whenever a theme/
                    plugin update is available, so the user catches it from
                    wherever they are. Renders nothing when the site is current. */}
                <WpUpdateTopbarButton />
                {/* Fix connection — self-hides unless a recent publish was
                    blocked by the user's WordPress site (firewall/deactivated
                    plugin). Amber alert → Connection Doctor. Same
                    only-when-actionable pattern as the update button above. */}
                <WpConnectionDoctorButton />
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
                {/* Clear Cache — one click purges the site's page cache
                    (LiteSpeed/SG/Cloudflare) so brand + theme changes go live
                    immediately. Sits next to Visit Blog / WP Admin. */}
                <PurgeCacheTopbarButton />
              </>
            )}

            {/* Support tickets — always visible (not gated on a WP connection).
                Regular users go to /support to open a ticket. ADMIN goes to the
                ticket queue, and the button turns RED with a count whenever
                there are OPEN tickets waiting (admin only). */}
            <Link
              href={isAdmin ? '/admin/support-tickets' : '/support'}
              className="px-3 py-2 rounded-lg border text-[12px] font-medium inline-flex items-center gap-1.5 transition-colors"
              style={
                ticketAlert
                  ? { backgroundColor: '#ff3b30', borderColor: '#ff3b30', color: '#fff' }
                  : { backgroundColor: 'var(--surface)', borderColor: 'var(--border)', color: 'var(--text-soft)' }
              }
              onMouseEnter={(e) => { if (!ticketAlert) e.currentTarget.style.backgroundColor = 'var(--surface-hover)' }}
              onMouseLeave={(e) => { if (!ticketAlert) e.currentTarget.style.backgroundColor = 'var(--surface)' }}
              title={ticketAlert
                ? `${openTickets} open support ticket${openTickets === 1 ? '' : 's'} waiting`
                : 'Open a support ticket'}
            >
              <LifeBuoy size={12} /> Support{ticketAlert ? ` (${openTickets})` : ''}
            </Link>

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

        {/* Plan-usage strip — every metered action for this plan, directly
            under the topbar so nothing capped is invisible. Self-hides on
            unlimited plans. */}
        <UsageBar />
        {/* Proactive nudge when a limit is 80%+ this period. Dismissible per
            period; self-hides otherwise. */}
        <UsageNudge />
        {/* Alert when no Amazon Associates tag is set — Amazon affiliate links
            can't earn without it. Dismissible; self-hides once a tag exists. */}
        <AmazonTagNudge />

        {/* Page content. Generous max-width so the new chrome doesn't
            crush wide content (e.g. the comparison table on /comparison
            or the catalogue grid on /content). */}
        <main className="flex-1 overflow-y-auto w-full">
          {/* Silent daily self-heal for stale post URLs after a permalink change. */}
          <PermalinkAutoHeal />
          {/* Action-needed announcement popup (admin-managed, variant 'modal'). */}
          <AnnouncementModal />
          <div className="max-w-7xl px-4 sm:px-6 lg:px-8 pt-6 pb-12">
            {amazonLocked ? <AmazonUpgradeGate feature={amazonLocked.label} redirect={amazonLocked.redirect} /> : children}
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
  // Barbie-pink (or any) TEXT colour for a spotlighted row (e.g. Oink) — the
  // letters + icon are tinted, background stays normal so it pops without a
  // heavy block. Stays pink on hover/active.
  const hl = item.highlight
  const style: React.CSSProperties = {
    backgroundColor: active ? 'var(--nav-active-bg)' : 'transparent',
    color: hl || (active ? 'var(--nav-active-text)' : 'var(--text-soft)'),
  }
  const onMouseEnter = (e: React.MouseEvent<HTMLElement>) => {
    if (active) return
    e.currentTarget.style.backgroundColor = 'var(--surface-hover)'
    if (!hl) e.currentTarget.style.color = 'var(--text)'
  }
  const onMouseLeave = (e: React.MouseEvent<HTMLElement>) => {
    if (active) return
    e.currentTarget.style.backgroundColor = 'transparent'
    if (!hl) e.currentTarget.style.color = 'var(--text-soft)'
  }

  const inner = (
    <>
      {/* Left indicator bar — only for active internal items. External
          tools never get the bar even on hover. */}
      {active && <span className="absolute -left-2 top-2 bottom-2 w-[3px] rounded-r-full" style={{ background: hl || '#7C3AED' }} />}
      <span className="relative flex-shrink-0">
        {item.icon}
        {/* Collapsed sidebar has no room for the count pill, so an unread count
            shows as a red dot on the icon instead — otherwise a new brand
            inquiry would be completely invisible to anyone who collapses the
            nav. Numeric badges only: word badges ("Paused") aren't alerts. */}
        {collapsed && typeof item.badge === 'number' && item.badge > 0 && (
          <>
            <span
              className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full"
              style={{ backgroundColor: '#ff3b30', boxShadow: '0 0 0 2px var(--bg-sidebar)' }}
              aria-hidden="true"
            />
            <span className="sr-only">{item.badge} unread</span>
          </>
        )}
      </span>
      {!collapsed && <span className="flex-1 truncate">{item.label}</span>}
      {/* External-link glyph — small tail icon hinting "opens off-site".
          Hidden when the sidebar is collapsed (the row icon is already
          ExternalLink in that mode). */}
      {!collapsed && item.external && (
        <ExternalLink size={11} className="opacity-60 flex-shrink-0" />
      )}
      {!collapsed && item.badge !== undefined && (
        // A numeric badge is an unread count (e.g. new brand inquiries) — render
        // it as a prominent red notification pill so it actually catches the
        // eye. Word badges (e.g. "Paused") stay subtle in the neutral style.
        typeof item.badge === 'number' ? (
          <span
            className="text-[11px] tabular-nums min-w-[18px] h-[18px] px-1.5 rounded-full font-bold flex items-center justify-center text-white"
            style={{ backgroundColor: '#ff3b30' }}
          >
            {item.badge > 99 ? '99+' : item.badge}
          </span>
        ) : (
          <span
            className="text-[11px] tabular-nums px-1.5 py-0.5 rounded font-semibold"
            style={{
              backgroundColor: active ? 'rgba(124,58,237,0.22)' : 'var(--surface-bright)',
              color: active ? 'var(--nav-active-text)' : 'var(--text-soft)',
            }}
          >
            {item.badge}
          </span>
        )
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


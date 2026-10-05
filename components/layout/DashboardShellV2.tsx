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

import SoldCampaignsDaily from '@/components/earnings/SoldCampaignsDaily'
import { previewOpenToPro, canUsePreview } from '@/lib/labs-preview'
import { hasVideoTools } from '@/lib/amazon-plan'
import { NEWSLETTER_FOR_MEMBERS } from '@/lib/feature-flags'
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
  UserCog, AlertTriangle, DollarSign, Newspaper, Plug, Wrench, ImageOff,
  Camera, MessageCircle, Activity, BarChart3, Wand2, ShieldCheck,
  Share2, UserSquare, LifeBuoy, Link2, FlaskConical, Store, Send, ShoppingBag, Megaphone,
  Inbox, PackageSearch, Rocket, Database, History, Globe, Radio, Gauge, Repeat, Star, Pin, Menu, X, Scissors, ClipboardList } from 'lucide-react'
import { useNavFavorites, MAX_NAV_FAVORITES } from '@/lib/nav-favorites'
import { cn } from '@/lib/utils'
// Deals Hub runs only while Amazon has a real sale event on (Prime Day, Big
// Deal Days, Black Friday and so on) and is deliberately off between them. The
// badge says "Seasonal", never "Paused": paused reads as broken, and this is a
// working feature waiting for an event.
import { DEALS_HUB_PAUSED } from '@/lib/deal-occasion'
import NotificationBell from './NotificationBell'
import WpUpdateTopbarButton from './WpUpdateTopbarButton'
import TopbarSearch from './TopbarSearch'
import WpConnectionDoctorButton from './WpConnectionDoctorButton'
import RecapTopbarButton from './RecapTopbarButton'
import PurgeCacheTopbarButton from './PurgeCacheTopbarButton'
import ScoutTopbarButton from './ScoutTopbarButton'
import SocialHealthTopbarButton from './SocialHealthTopbarButton'
import UsageBar from './UsageBar'
import UsageNudge from './UsageNudge'
import AmazonTagNudge from './AmazonTagNudge'
// TRYBE referral link (direct, so it never depends on the Passport short domain).
import SiteSwitcherChip from './SiteSwitcherChip'
import { HelpDeskButton } from '@/components/HelpDeskSidebar'
import AmazonUpgradeGate from '@/components/upgrade/AmazonUpgradeGate'
import PermalinkAutoHeal from '@/components/PermalinkAutoHeal'
import AnnouncementModal from '@/components/dashboard/AnnouncementModal'
import ReconnectCheckup from '@/components/dashboard/ReconnectCheckup'

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
  /** The pages this row stands for, drawn as a tab bar above each of them
   *  (SectionTabs). The row is lit on any of them. */
  tabs?: NavItemDef[]
  /** Amazon plan: 'included' rows stay in their section, 'inside' rows are
   *  reached from within another page, anything else goes to More with Pro. */
  onAmazon?: 'included' | 'inside'
  /** Other addresses that light this row without being tabs of it (a page's
   *  own tab that belongs to this row, e.g. Social Push's scheduled queue). */
  alsoActiveOn?: string[]
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
  'Find products':     { dark: '#A3E635', light: '#4D7C0F' }, // green     — find products & campaigns
  'Make videos':       { dark: '#FACC15', light: '#A16207' }, // yellow    — the creative core
  'Blog':              { dark: '#60A5FA', light: '#1D4ED8' }, // blue      — written content
  'Share':             { dark: '#FB923C', light: '#C2410C' }, // orange    — out to the networks
  'Work with brands':  { dark: '#F472B6', light: '#BE185D' }, // pink      — deals / people
  'Your setup':        { dark: '#94A3B8', light: '#475569' }, // slate     — connections & account
  'Help':              { dark: '#5EEAD4', light: '#0D9488' }, // turquoise — support
  'More with Pro':     { dark: '#C084FC', light: '#7E22CE' }, // purple    — Amazon plan's upgrade shelf
  'Set up':            { dark: '#60A5FA', light: '#1D4ED8' }, // blue      — foundational
  'Create':            { dark: '#FACC15', light: '#A16207' }, // yellow    — creative core
  'Amazon Influencer': { dark: '#FB923C', light: '#C2410C' }, // orange    — Amazon storefront
  'Grow':              { dark: '#C084FC', light: '#7E22CE' }, // purple    — growth
  'Research':          { dark: '#A3E635', light: '#4D7C0F' }, // green     — find products & campaigns
  'Source & Earn':     { dark: '#A3E635', light: '#4D7C0F' }, // green     — find & monetize (legacy key)
  'Collaborate':       { dark: '#F472B6', light: '#BE185D' }, // pink      — deals / people
  'Labs':              { dark: '#F87171', light: '#DC2626' }, // red       — experimental
  'My features':       { dark: '#F472B6', light: '#BE185D' }, // pink      — the creator's own picks
  'Help & Community':  { dark: '#5EEAD4', light: '#0D9488' }, // turquoise — support
  'Account':           { dark: '#94A3B8', light: '#475569' }, // slate     — neutral utility
  'Recommended tools': { dark: '#2DD4BF', light: '#0F766E' }, // teal      — discovery
  'Recommended programs': { dark: '#2DD4BF', light: '#0F766E' }, // teal    — earn / networks
  'Admin':             { dark: '#F87171', light: '#B91C1C' }, // red       — control / danger
}

// Leading icon per section header (matches the Labs flask). Keyed by label.
const SECTION_ICONS: Record<string, React.ReactNode> = {
  'Find products': <PackageSearch size={12} />,
  'Make videos': <Youtube size={12} />,
  'Blog': <Library size={12} />,
  'Share': <Share2 size={12} />,
  'Work with brands': <Handshake size={12} />,
  'Your setup': <Settings size={12} />,
  'Help': <LifeBuoy size={12} />,
  'More with Pro': <Sparkles size={12} />,
  'Set up': <Plug size={12} />,
  'Create': <Sparkles size={12} />,
  'Amazon Influencer': <ShoppingBag size={12} />,
  'Research': <PackageSearch size={12} />,
  'Source & Earn': <DollarSign size={12} />,
  'Grow': <BarChart3 size={12} />,
  'Collaborate': <Share2 size={12} />,
  'Labs': <FlaskConical size={12} />,
  'My features': <Star size={12} />,
  'Help & Community': <LifeBuoy size={12} />,
  'Account': <UserCog size={12} />,
  'Recommended tools': <Wrench size={12} />,
  'Recommended programs': <ShoppingBag size={12} />,
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
  useEffect(() => { setMobileOpen(false) }, [pathname])
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
  // PHONES: below md the sidebar is a drawer, opened from the menu button in
  // the top bar and closed by a tap outside or by moving to another page. On a
  // phone it always shows full width, whatever the desktop collapse state.
  const [mobileOpen, setMobileOpen] = useState(false)
  const [isNarrow, setIsNarrow] = useState(false)
  const railCollapsed = collapsed && !isNarrow
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mq = window.matchMedia('(max-width: 767px)')
    const on = () => setIsNarrow(mq.matches)
    on()
    mq.addEventListener?.('change', on)
    return () => mq.removeEventListener?.('change', on)
  }, [])
  useEffect(() => {
    try {
      const saved = localStorage.getItem('mvp_shell_collapsed')
      if (saved === '1') setCollapsed(true)
    } catch { /* ignore */ }
  }, [])
  useEffect(() => {
    try { localStorage.setItem('mvp_shell_collapsed', collapsed ? '1' : '0') } catch { /* ignore */ }
  }, [collapsed])

  // EVERY SECTION FOLDS. Each named section (Set up, Create, Research, Admin…)
  // is just its header until clicked open, so the menu is a short list of
  // sections rather than a long scroll of features. Unset, a section is open
  // only while it holds the page you are on; once you open or close one, that
  // choice is kept (this browser). My features never folds: it is the list you
  // pinned to be one click away.
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({})
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('mvp_nav_sections') || '{}') as Record<string, boolean>
      // The Admin fold predates this and kept its own key.
      if (saved.Admin === undefined && localStorage.getItem('mvp_admin_nav_open') === '1') saved.Admin = true
      setOpenSections(saved)
    } catch { /* ignore */ }
  }, [])
  const toggleSection = (label: string, open: boolean) => {
    setOpenSections((prev) => {
      const next = { ...prev, [label]: open }
      try { localStorage.setItem('mvp_nav_sections', JSON.stringify(next)) } catch { /* ignore */ }
      return next
    })
  }
  // MY FEATURES: the pages this creator starred, pinned at the top of the sidebar.
  const { favorites, toggle: toggleFavorite, savedTo: favoritesSavedTo } = useNavFavorites()
  const [editingFavorites, setEditingFavorites] = useState(false)
  const [favoritesNote, setFavoritesNote] = useState<string | null>(null)
  const [favoritesHintHidden, setFavoritesHintHidden] = useState(true)
  useEffect(() => {
    try { setFavoritesHintHidden(window.localStorage.getItem('mvp_nav_fav_hint_hidden') === '1') } catch { setFavoritesHintHidden(false) }
  }, [])
  const starFeature = (href: string, label: string) => {
    const { full } = toggleFavorite(href)
    setFavoritesNote(full ? `My features holds ${MAX_NAV_FAVORITES}. Take one out to add ${label}.` : null)
  }

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
  //
  // 'trial' is here because the free plan IS the Amazon trial now: an Amazon
  // product, a finished design with their own face on it, downloaded. Hiding the
  // hub from them hid the entire thing the ads are selling, and the trial's
  // limits are enforced by the caps in lib/tier.ts and the Associates-tag
  // qualifier in lib/free-trial.ts, not by the sidebar. Publishing those designs
  // stays paid (trial has no connected socials), so the wall lands when they try
  // to post, holding a finished design.
  // Creator was the only plan shut out of the Amazon hub, including the free
  // trial, which made "upgrade to Creator" a downgrade in visible surface. Every
  // plan sees it now and the ALLOCATION is what differs: Creator's Thumbnail
  // Generator and Research work on their own limits, and Social Influencer is
  // where their zero design allowance is stated plainly with the Amazon plan
  // offered. A tier gate on the door was hiding the reason to walk through it.
  const canAmazonHub = (['trial', 'creator', 'amazon', 'studio', 'pro', 'admin'] as string[]).includes(effectiveTier)

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

  // Amazon plan: see AMAZON_LOCKED_PREFIXES and orderedGroups below.
  const amazonView = effectiveTier === 'amazon'

  // ── Nav definition ────────────────────────────────────────────────────
  // MENU BY JOB (Seb approved the mockup 2026-10-05). The sidebar is grouped by
  // what a creator is trying to do: find a product, make a video, write for the
  // blog, share it, work with brands, set things up, get help. Pages that were
  // one tool spread over several menu rows are ONE row now, and their pages
  // share a tab bar (the `tabs` of a row, drawn above the page by SectionTabs
  // below). Every old address still opens; it just lights up its new row and
  // the right tab. Gates are unchanged: the nav is a hint, the route is the law.
  //
  // onAmazon says what the Amazon plan sees: 'included' rows sit in their job
  // sections, 'inside' rows are reached from within another page (the research
  // finders inside Product research), and everything else is listed once under
  // "More with Pro" instead of a locked row in every section.
  const NAV_GROUPS: NavGroupDef[] = [
    // Headerless top item.
    {
      label: '',
      items: [
        { href: '/dashboard', icon: <Home size={15} />, label: 'Dashboard', onAmazon: 'included' },
      ],
    },
    {
      label: 'Find products',
      items: [
        // AMZ Research (the whole catalog + Creator Connections) and the Amazon
        // hub's Research are one job. The Amazon plan opens straight on its own.
        {
          href: amazonView ? '/amazon/research' : '/amz-finder', icon: <PackageSearch size={15} />, label: 'Product research', onAmazon: 'included',
          tabs: [
            { href: '/amz-finder', icon: null, label: 'Catalog search', gate: !amazonView },
            { href: '/amazon/research', icon: null, label: 'Amazon research', gate: canAmazonHub },
          ],
        },
        { href: '/deal-radar', icon: <Radar size={15} />, label: 'Deal Radar', gate: canBrowseDealRadar(effectiveTier), onAmazon: 'inside' },
        // Browse, join, save and the pay table are one Creator Connections tool.
        {
          href: '/cc-campaigns', icon: <BadgePercent size={15} />, label: 'Brand campaigns', gate: canBrowseDealRadar(effectiveTier), onAmazon: 'inside',
          tabs: [
            { href: '/cc-campaigns', icon: null, label: 'All campaigns' },
            { href: '/joined-campaigns', icon: null, label: 'Joined' },
            { href: '/saved-campaigns', icon: null, label: 'Saved' },
            { href: '/epc-library', icon: null, label: 'Best paying' },
          ],
        },
        // The networks beyond Amazon. Each page is still gated by the member's
        // own key (Levanta, PartnerBoost, Wayward) or by plan (LTK).
        {
          href: '/levanta', icon: <Store size={15} />, label: 'Partner programs',
          tabs: [
            { href: '/levanta', icon: null, label: 'Levanta' },
            { href: '/partnerboost', icon: null, label: 'PartnerBoost and Walmart' },
            { href: '/wayward', icon: null, label: 'Wayward' },
            { href: '/ltk', icon: null, label: 'LTK', gate: canUseFinders },
          ],
        },
        { href: '/idea-lists', icon: <ShoppingBag size={15} />, label: 'Idea lists', gate: canUseFinders },
      ],
    },
    {
      label: 'Make videos',
      items: [
        // The Amazon plan has its six video additions since 2026-10-05 (Seb):
        // one YouTube channel and Co-Pilot, Bulk Amazon upload, Clip Factory
        // with its own allowance, YouTube comments and Amazon Live.
        { href: '/co-pilot', icon: <Youtube size={15} />, label: 'YouTube Co-Pilot', onAmazon: 'included' },
        { href: '/amazon/thumbnails', icon: <Sparkles size={15} />, label: 'Thumbnails', gate: canAmazonHub, onAmazon: 'included' },
        { href: '/script', icon: <PenLine size={15} />, label: 'Scriptwriter' },
        // Pro, and the Amazon plan with its own allowance (lib/amazon-plan).
        { href: '/clip-factory', icon: <Scissors size={15} />, label: 'Clip Factory', gate: hasVideoTools(effectiveTier), onAmazon: 'included' },
        // Was Liftoff: up to ten videos to YouTube and every chosen Amazon
        // country from one press. Pro and the Amazon plan.
        { href: '/liftoff', icon: <Rocket size={15} />, label: 'Bulk Amazon upload', gate: hasVideoTools(effectiveTier), badge: 'New', onAmazon: 'included' },
        // Pinned Comments and Encore (on sale comments) both write the comment
        // under the creator's own videos; Encore edits the pinned one.
        {
          href: '/first-comments', icon: <Pin size={15} />, label: 'YouTube comments', badge: 'New', onAmazon: 'included',
          gate: canUsePreview('first_comment', effectiveTier) || canUsePreview('on_sale', effectiveTier),
          tabs: [
            { href: '/first-comments', icon: null, label: 'Pinned comments', gate: canUsePreview('first_comment', effectiveTier) },
            { href: '/encore', icon: null, label: 'On sale comments', gate: canUsePreview('on_sale', effectiveTier) },
          ],
        },
        // Before the show and after it.
        {
          href: '/amazon-live', icon: <Radio size={15} />, label: 'Amazon Live', badge: 'New', onAmazon: 'included',
          gate: canUsePreview('amazon_live', effectiveTier),
          tabs: [
            { href: '/amazon-live', icon: null, label: 'Prep', gate: canUsePreview('amazon_live', effectiveTier) },
            { href: '/live-followup', icon: null, label: 'Follow-up', gate: canUsePreview('live_followup', effectiveTier) },
          ],
        },
      ],
    },
    {
      label: 'Blog',
      items: [
        { href: '/content', icon: <Library size={15} />, label: 'Blog posts' },
        {
          href: '/comparison', icon: <Scale size={15} />, label: 'Comparisons and guides',
          tabs: [
            { href: '/comparison', icon: null, label: 'Comparisons' },
            { href: '/buying-guides', icon: null, label: 'Buying guides', gate: showBuyingGuidesEff },
          ],
        },
        { href: '/articles', icon: <Newspaper size={15} />, label: 'Articles', gate: canUseArticles },
        // Deal posts whose sale is over become lasting reviews at the same address.
        { href: '/ended-deals', icon: <Wand2 size={15} />, label: 'Ended deals', gate: previewOpenToPro('deal_aftercare') ? isPro : isAdmin, badge: 'New' },
        { href: '/seo', icon: <TrendingUp size={15} />, label: 'SEO and indexing' },
        // AdSense injection works on BYO-theme sites too, so shown to everyone.
        { href: '/ads', icon: <Megaphone size={15} />, label: 'Ads' },
        // Drives the MVP theme, so useless for content-only ("bring your own
        // theme") sites.
        { href: '/customize', icon: <Brush size={15} />, label: 'Blog design', gate: !contentOnly },
        // Retired for members 2026-10-05 (lib/feature-flags NEWSLETTER_FOR_MEMBERS);
        // admin keeps it, and the page tells anyone else it has been retired.
        { href: '/newsletter', icon: <Mail size={15} />, label: 'Newsletter', gate: NEWSLETTER_FOR_MEMBERS || effectiveTier === 'admin' },
      ],
    },
    {
      label: 'Share',
      items: [
        // The "Published Posts & Social Push" tab of /content.
        { href: '/content?tab=posts', icon: <Send size={15} />, label: 'Social Push', alsoActiveOn: ['/content?tab=scheduled'] },
        // Was Social Influencer: pins, Instagram posts and stories for a product.
        { href: '/amazon/social', icon: <Share2 size={15} />, label: 'Social designs', gate: canAmazonHub, onAmazon: 'included' },
        { href: '/social-launch-kit', icon: <Rocket size={15} />, label: 'Social Launch Kit', gate: canUseFinders, onAmazon: 'included' },
        { href: '/meta', icon: <Users size={15} />, label: 'Meta Hub', gate: previewOpenToPro('facebook_setup') ? isPro : isAdmin, badge: 'New' },
        // Was Pulse: which hashtags actually earn reach, from your posts and
        // pooled across MVP per niche.
        { href: '/pulse', icon: <Activity size={15} />, label: 'Hashtag insights', gate: isPro },
        { href: '/link-in-bio', icon: <Link2 size={15} />, label: 'Link in Bio', gate: canSeeNav('dealRadar', effectiveTier), onAmazon: 'included' },
        // The Amazon plan includes Passport (lib/feature-access NAV_ACCESS.passport).
        { href: '/passport', icon: <Globe size={15} />, label: 'Passport links', gate: canUsePassport(effectiveTier), onAmazon: 'included' },
        { href: '/deals', icon: <BadgePercent size={15} />, label: 'Deals Hub', gate: showDealsEff, badge: DEALS_HUB_PAUSED ? 'Seasonal' : undefined },
      ],
    },
    {
      label: 'Work with brands',
      items: [
        // Was Brand Deals: it writes and sends pitch emails.
        { href: '/collaborations', icon: <Handshake size={15} />, label: 'Brand pitches', onAmazon: 'included' },
        // Inbound messages, the timeline of every brand, and the recap to send them.
        {
          href: '/brand-inquiries', icon: <Inbox size={15} />, label: 'Brand inbox', badge: unreadBrand > 0 ? unreadBrand : undefined, onAmazon: 'included',
          tabs: [
            { href: '/brand-inquiries', icon: null, label: 'Inquiries', badge: unreadBrand > 0 ? unreadBrand : undefined },
            { href: '/brand-hub', icon: null, label: 'History' },
            { href: '/brand-recap', icon: null, label: 'Recap', gate: previewOpenToPro('brand_recap') ? isPro : isAdmin },
          ],
        },
      ],
    },
    {
      label: 'Your setup',
      items: [
        // Everything MVP posts to or reads from. The Amazon plan connects its
        // social networks inside Social designs (see AMAZON_LOCKED_PREFIXES)
        // and its one YouTube channel here.
        {
          href: amazonView ? '/connect-youtube' : '/setup', icon: <Plug size={15} />, label: 'Connections', onAmazon: 'included',
          tabs: [
            { href: '/setup', icon: null, label: 'Blog', gate: !amazonView },
            { href: '/connect-youtube', icon: null, label: 'YouTube' },
            { href: '/connect-socials', icon: null, label: 'Socials', gate: !amazonView },
            { href: '/external-integrations', icon: null, label: 'Other tools', gate: canUseFinders && !amazonView },
          ],
        },
        {
          href: '/brand', icon: <Palette size={15} />, label: 'Brand and voice', onAmazon: 'included',
          tabs: [
            { href: '/brand', icon: null, label: 'Brand profile' },
            { href: '/learn', icon: null, label: 'Writing voice', gate: !amazonView },
          ],
        },
        { href: '/photobooth', icon: <UserSquare size={15} />, label: 'Face models', onAmazon: 'included' },
        { href: '/agency', icon: <Users size={15} />, label: 'Team' },
        {
          href: '/billing', icon: <CreditCard size={15} />, label: 'Plan and usage', onAmazon: 'included',
          tabs: [
            { href: '/billing', icon: null, label: 'Plan and billing' },
            { href: '/usage', icon: null, label: 'Usage' },
          ],
        },
      ],
    },
    // LABS: ADMIN ONLY (Seb, 2026-10-02: "make Labs invisible to everyone
    // except me"). Every item here is gated isAdmin, and each page and route
    // refuses non-admins on its own. A feature leaves Labs to reach Pro.
    {
      label: 'Labs',
      items: [
        // AMZ Storefront: SCOUT-synced Amazon earnings + full-catalog analytics,
        // here while the full-year + full-storefront sync is finished.
        { href: '/storefront', icon: <BarChart3 size={15} />, label: 'AMZ Storefront', gate: isAdmin },
        // Admin only while in Labs (lib/labs-preview earnings).
        { href: '/earnings', icon: <TrendingUp size={15} />, label: 'Amazon Earnings', gate: isAdmin },
        // Dormant until Meta approves the messaging permissions.
        { href: '/instagram-dm', icon: <MessageCircle size={15} />, label: 'Instagram Auto-DM', gate: isAdmin },
        // Brand Radar: storefront + TikTok ingestion into the brands a creator
        // has worked with. Ships dark until a provider token is set.
        { href: '/brand-radar', icon: <Radar size={15} />, label: 'Brand Radar', gate: isAdmin },
        // TikTok Shop: add a TikTok Shop product by pasting its link. Reads and
        // lists products; it does not yet make a post from one.
        { href: '/tiktok-shop', icon: <ShoppingBag size={15} />, label: 'TikTok Shop', gate: isAdmin, badge: 'New' },
        // Plan this video: a joined Creator Connections campaign turned into a
        // filming plan. Admin only while it is tested (lib/labs-preview video_plan).
        { href: '/plan-video', icon: <ClipboardList size={15} />, label: 'Plan This Video', gate: isAdmin, badge: 'New' },
      ],
    },
    {
      label: 'Help',
      items: [
        // Was MVP Help Desk: the assistant that answers questions about MVP.
        { href: '/assistant', icon: <Bot size={15} />, label: 'Ask MVP', onAmazon: 'included' },
        {
          href: '/tutorials', icon: <BookOpen size={15} />, label: 'Tutorials and support', onAmazon: 'included',
          tabs: [
            { href: '/tutorials', icon: null, label: 'Tutorials' },
            { href: '/support', icon: null, label: 'Contact support' },
            { href: '/community', icon: null, label: 'Community' },
          ],
        },
      ],
    },
    // Admin-only block. Only added to NAV_GROUPS when isAdmin so
    // non-admins never see these entries. Daily drivers up top.
    ...(isAdmin ? [{
      label: 'Admin',
      items: [
        { href: '/admin/users', icon: <UserCog size={15} />, label: 'Users (admin)' },
        { href: '/admin/support-tickets', icon: <LifeBuoy size={15} />, label: 'Support tickets' },
        { href: '/admin/failures', icon: <AlertTriangle size={15} />, label: 'Failures' },
        { href: '/admin/cron', icon: <Activity size={15} />, label: 'Cron health' },
        { href: '/admin/costs', icon: <DollarSign size={15} />, label: 'AI Cost (admin)' },
        { href: '/admin/subscriptions', icon: <CreditCard size={15} />, label: 'Duplicate Subs (admin)' },
        { href: '/admin/blog-quality', icon: <Activity size={15} />, label: 'Blog Quality' },
        { href: '/admin/hotlinked', icon: <ImageOff size={15} />, label: 'Hot-linked posts' },
        { href: '/admin/link-reports', icon: <ShieldCheck size={15} />, label: 'Link reports (mvpl.ink)' },
        { href: '/admin/template-performance', icon: <BarChart3 size={15} />, label: 'Template Performance' },
        { href: '/admin/designer-text', icon: <Wand2 size={15} />, label: 'Designer Text Playground' },
        { href: '/admin/announcement', icon: <Newspaper size={15} />, label: 'News banner (admin)' },
        { href: '/admin/broadcast', icon: <Megaphone size={15} />, label: 'Broadcast email (admin)' },
        { href: '/admin/audio-tracks', icon: <Globe size={15} />, label: 'YouTube audio tracks' },
        { href: '/admin/youtube-cookies', icon: <ShieldCheck size={15} />, label: 'YouTube cookies (downloader)' },
        { href: '/admin/encrypt-secrets', icon: <ShieldCheck size={15} />, label: 'Encrypt Secrets' },
        { href: '/admin/cc-import', icon: <Database size={15} />, label: 'CC Catalog Import' },
      ],
    }] : []),
  ]

  // Walled garden (2026-08-13): an Amazon Influencer opening anything outside
  // their plan (blog / YouTube / SEO / blog-tools) gets the upgrade
  // panel instead of the page. Denylist of PATH PREFIXES rather than an
  // allowlist, so account/billing/admin/support + every Amazon and shared
  // research-deal tool stay reachable by default (locking billing would trap the
  // user off the upgrade flow). Gated in the shell so it covers the sidebar
  // click, a dashboard card, and a pasted deep link from one place.
  const AMAZON_LOCKED_PREFIXES: { prefix: string; label: string; redirect?: { href: string; cta: string; body: string } }[] = [
    // Connect Socials isn't an upgrade for Amazon — they connect their approved
    // networks (Facebook, Pinterest, Instagram) from Social Influencer, so point
    // them there instead of showing the generic upsell.
    { prefix: '/connect-socials', label: 'Connect your socials', redirect: { href: '/amazon/social', cta: 'Go to Social designs', body: 'On the Amazon plan you connect your approved networks (Facebook, Pinterest and Instagram) right inside Social designs, where you also publish your designs. Connect them there in one place.' } },
    { prefix: '/setup', label: 'Blog connection' },
    { prefix: '/learn', label: 'Writing voice' },
    { prefix: '/customize', label: 'Blog design' },
    { prefix: '/content', label: 'Blog posts' },
    { prefix: '/comparison', label: 'Comparisons' },
    { prefix: '/buying-guides', label: 'Buying Guides' },
    { prefix: '/idea-lists', label: 'Idea lists' },
    { prefix: '/deals', label: 'Deals Hub' },
    { prefix: '/script', label: 'Scriptwriter' },
    // While the member newsletter is retired there is nothing to upgrade to,
    // so the page shows its retired notice instead of an upsell.
    ...(NEWSLETTER_FOR_MEMBERS ? [{ prefix: '/newsletter', label: 'Newsletter' }] : []),
    { prefix: '/ads', label: 'Ads' },
    { prefix: '/seo', label: 'SEO and indexing' },
    { prefix: '/pulse', label: 'Hashtag insights' },
    { prefix: '/tools', label: 'Blog Tools' },
    // Partner-network finders are Creator/Studio/Pro only (the Amazon plan is
    // Amazon-only, and these publish to a WordPress blog the plan doesn't have).
    // External Integrations only holds these finders' API keys, so it locks too.
    { prefix: '/levanta', label: 'Levanta' },
    { prefix: '/partnerboost', label: 'PartnerBoost and Walmart' },
    { prefix: '/wayward', label: 'Wayward' },
    { prefix: '/external-integrations', label: 'Other tools' },
  ]
  const amazonLocked = amazonView
    ? AMAZON_LOCKED_PREFIXES.find((l) => pathname === l.prefix || pathname.startsWith(`${l.prefix}/`) || pathname.startsWith(`${l.prefix}?`))
    : undefined
  // Amazon view: the job sections keep only what the plan includes, and every
  // other row is listed once under "More with Pro", above Labs and Admin (the
  // walled garden above shows the upgrade panel when one is opened). Rows the
  // plan reaches from inside another page ('inside') are not listed twice.
  const orderedGroups: NavGroupDef[] = (() => {
    if (!amazonView) return NAV_GROUPS
    const more: NavItemDef[] = []
    const jobs: NavGroupDef[] = []
    const staff: NavGroupDef[] = []
    for (const g of NAV_GROUPS) {
      if (g.label === 'Labs' || g.label === 'Admin') { staff.push(g); continue }
      for (const it of g.items) if (!it.onAmazon && it.gate !== false) more.push(it)
      const keep = g.items.filter((it) => it.onAmazon === 'included')
      if (keep.length) jobs.push({ ...g, items: keep })
    }
    return [...jobs, { label: 'More with Pro', items: more }, ...staff]
  })()

  // MY FEATURES, right under the Dashboard row: the starred pages, in the
  // order they were starred, drawn from the menu this creator can actually
  // see. A starred page their plan no longer shows simply is not listed.
  const groupsWithFavorites: NavGroupDef[] = (() => {
    const seen = new Map<string, NavItemDef>()
    for (const g of orderedGroups) for (const it of g.items) {
      if (it.gate !== false && !it.external) {
        // A page that is now a tab of a merged row (a star placed before the
        // menu was regrouped) shows as that row.
        for (const h of [it.href, ...(it.tabs ?? []).filter((t) => t.gate !== false).map((t) => t.href)]) if (!seen.has(h)) seen.set(h, it)
      }
    }
    const items = Array.from(new Set(favorites.map((h) => seen.get(h)).filter((it): it is NavItemDef => !!it))).map((it) => ({ ...it, subheading: undefined }))
    const mine: NavGroupDef = { label: 'My features', items }
    const dashIdx = orderedGroups.findIndex((g) => !g.label)
    return dashIdx >= 0
      ? [...orderedGroups.slice(0, dashIdx + 1), mine, ...orderedGroups.slice(dashIdx + 1)]
      : [mine, ...orderedGroups]
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
    // Blog posts (/content) vs Social Push (/content?tab=posts and its
    // scheduled queue): don't light the base item on Social Push's tabs.
    if (href === '/content') {
      if (pathname !== '/content') return false
      if (typeof window !== 'undefined') {
        const tab = new URLSearchParams(window.location.search).get('tab')
        return tab !== 'posts' && tab !== 'scheduled'
      }
      return true
    }
    return pathname === href || pathname.startsWith(`${href}/`)
    // locTick: force recompute when a page mutates ?tab via replaceState.
  }, [pathname, locTick])

  // A merged row (Brand campaigns, Connections...) is lit on any of its tabs.
  const itemActive = useCallback(
    (item: NavItemDef) => isActive(item.href) || (item.tabs ?? []).some((t) => t.gate !== false && isActive(t.href))
      || (item.alsoActiveOn ?? []).some(isActive),
    [isActive],
  )
  // The row whose tab bar this page wears: one of its open tabs is this page
  // and it has at least two. Drawn above the page by SectionTabs.
  const tabbedItem = orderedGroups
    .flatMap((g) => g.items)
    .find((it) => it.gate !== false && (it.tabs ?? []).filter((t) => t.gate !== false).length > 1
      && (it.tabs ?? []).some((t) => t.gate !== false && isActive(t.href)))

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
      {mobileOpen && (
        <div className="fixed inset-0 z-30 bg-black/40 md:hidden" onClick={() => setMobileOpen(false)} aria-hidden="true" />
      )}
      <aside
        className={`${railCollapsed ? 'md:w-[68px]' : 'md:w-[232px]'} w-[264px] flex-shrink-0 border-r flex flex-col transition-[width,transform] duration-200 fixed md:sticky top-0 left-0 z-40 h-screen ${mobileOpen ? 'translate-x-0' : '-translate-x-full'} md:translate-x-0`}
        style={{ backgroundColor: 'var(--bg-sidebar)', borderColor: 'var(--border)' }}
      >
        {/* Brand + collapse toggle. Each tier shows its own square badge — the
            artwork already contains the "MVP Affiliate" wordmark, so it stands
            in for BOTH the mark and the title. The purple "M" + title branch is
            a fallback for any tier whose art is missing. */}
        {brandBadge ? (
          <div className={`relative ${railCollapsed ? 'px-3 pt-4 pb-2' : 'px-4 pt-4 pb-3'}`}>
            <Link href="/dashboard" className="block" title={`MVP Affiliate ${brandBadge.label}`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={brandBadge.src}
                alt={`MVP Affiliate ${brandBadge.label}`}
                width={railCollapsed ? 40 : 112}
                height={railCollapsed ? 40 : 112}
                draggable={false}
                className={`${railCollapsed ? 'w-10 h-10' : 'w-28 h-28'} mx-auto select-none`}
              />
            </Link>
            {!railCollapsed && (
              <button
                onClick={() => (isNarrow ? setMobileOpen(false) : setCollapsed(true))}
                className="absolute top-3 right-3 opacity-40 hover:opacity-90 transition-opacity"
                title={isNarrow ? 'Close the menu' : 'Collapse sidebar'}
                aria-label={isNarrow ? 'Close the menu' : 'Collapse sidebar'}
              >
                {isNarrow ? <X size={18} /> : <ChevronsLeft size={14} />}
              </button>
            )}
          </div>
        ) : (
          <div className="px-4 pt-5 pb-4 flex items-center justify-between">
            <Link href="/dashboard" className="flex items-center gap-2">
              <span className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#7C3AED] to-[#C026D3] flex items-center justify-center font-bold text-white text-[14px]">M</span>
              {!railCollapsed && (
                <span className="font-semibold text-[15px] tracking-tight" style={{ color: 'var(--text)' }}>
                  MVP Affiliate
                </span>
              )}
            </Link>
            {!railCollapsed && (
              <button onClick={() => (isNarrow ? setMobileOpen(false) : setCollapsed(true))} className="opacity-40 hover:opacity-90 transition-opacity" title={isNarrow ? 'Close the menu' : 'Collapse sidebar'} aria-label={isNarrow ? 'Close the menu' : 'Collapse sidebar'}>
                {isNarrow ? <X size={18} /> : <ChevronsLeft size={14} />}
              </button>
            )}
          </div>
        )}

        {/* Upgrade CTA, directly under the tier badge. Shown for every tier that
            can still move up a plan (Trial, Creator, Studio) — never for Pro
            (top plan) or admin (staff, nothing to buy). Follows the previewed
            tier when an admin uses "View as tier". */}
        {canUpgradeTier(badgeTier) && (
          <div className={`${railCollapsed ? 'px-2' : 'px-4'} -mt-1 mb-2 flex justify-center`}>
            <Link
              href="/billing"
              title="Upgrade your plan"
              className={`inline-flex items-center justify-center gap-1 rounded-full font-semibold transition-opacity hover:opacity-80 ${
                railCollapsed ? 'p-1.5' : 'px-2.5 py-1 text-[11px]'
              }`}
              style={{ color: '#7C3AED', background: 'rgba(124,58,237,0.10)' }}
            >
              <Sparkles size={railCollapsed ? 15 : 12} />
              {!railCollapsed && 'Upgrade'}
            </Link>
          </div>
        )}

        {railCollapsed && (
          <button onClick={() => setCollapsed(false)} className="mx-auto mb-3 opacity-40 hover:opacity-90 transition-opacity" title="Expand sidebar">
            <ChevronsRight size={14} />
          </button>
        )}

        {/* Nav groups */}
        <nav className="flex-1 px-2 flex flex-col gap-3 overflow-y-auto pb-3">
          {groupsWithFavorites.map((group) => {
            const visibleItems = group.items.filter((it) => it.gate !== false)
            const isFavorites = group.label === 'My features'
            // An empty My features says how to fill it, once, until dismissed.
            if (isFavorites && visibleItems.length === 0) {
              if (railCollapsed || favoritesHintHidden) return null
              return (
                <div key="my-features-hint" className="rounded-xl border border-dashed px-3 py-2.5 text-[12px]" style={{ borderColor: 'var(--border)', color: 'var(--text-soft)' }}>
                  <p className="flex items-center gap-1.5 font-semibold text-[11px] uppercase tracking-[0.14em] mb-1" style={{ color: isDark ? '#F472B6' : '#BE185D' }}>
                    <Star size={12} /> My features
                  </p>
                  <p>Tap the star next to any feature to pin it here, at the top.</p>
                  <div className="mt-1.5 flex gap-3">
                    <button type="button" onClick={() => setEditingFavorites((e) => !e)} className="font-semibold underline" style={{ color: 'var(--text)' }}>{editingFavorites ? 'Hide the stars' : 'Show the stars'}</button>
                    <button type="button" onClick={() => { setFavoritesHintHidden(true); try { window.localStorage.setItem('mvp_nav_fav_hint_hidden', '1') } catch { /* fine */ } }} className="underline">Not now</button>
                  </div>
                </div>
              )
            }
            if (visibleItems.length === 0) return null
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
              !railCollapsed &&
              !!headerAccent
            const cardStyle = isCard && headerAccent
              ? {
                  backgroundColor: hexToRgba(headerAccent, isDark ? 0.10 : 0.08),
                  borderColor: hexToRgba(headerAccent, isDark ? 0.30 : 0.22),
                }
              : undefined
            // Every named section folds to its header (see openSections). The
            // icon-only rail and My features always show their items.
            const collapsibleSection = !railCollapsed && !!group.label && !isFavorites
            const holdsActive = visibleItems.some((it) => itemActive(it)) || (group.label === 'Admin' && pathname.startsWith('/admin'))
            const sectionOpen = !collapsibleSection || (openSections[group.label] ?? holdsActive)
            return (
              <Fragment key={group.label || 'dashboard'}>
              <div
                className={cn(isCard && 'rounded-xl border p-2')}
                style={cardStyle}
              >
                {!railCollapsed && group.label && (
                  collapsibleSection ? (
                    <button
                      type="button"
                      onClick={() => toggleSection(group.label, !sectionOpen)}
                      className={cn('w-full px-2.5 text-[11px] uppercase tracking-[0.14em] font-semibold flex items-center gap-1.5 hover:opacity-80 transition-opacity', sectionOpen && 'mb-1.5')}
                      style={{ color: headerAccent || 'var(--text-faint)' }}
                      aria-expanded={sectionOpen}
                      title={sectionOpen ? `Close ${group.label}` : `Open ${group.label}`}
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
                      {isFavorites && (
                        <button
                          type="button"
                          onClick={() => setEditingFavorites((e) => !e)}
                          className="ml-auto normal-case tracking-normal text-[11px] font-semibold underline"
                          style={{ color: 'var(--text-soft)' }}
                        >
                          {editingFavorites ? 'Done' : 'Edit'}
                        </button>
                      )}
                    </p>
                  )
                )}
                {sectionOpen && (
                  <div className="flex flex-col gap-0.5">
                    {visibleItems.map((item, idx) => (
                      <Fragment key={item.href + item.label}>
                        {!railCollapsed && item.subheading && (
                          <p
                            className={cn('px-2.5 pb-0.5 text-[9.5px] uppercase tracking-[0.12em] font-semibold', idx > 0 && 'pt-2')}
                            style={{ color: 'var(--text-faint)' }}
                          >
                            {item.subheading}
                          </p>
                        )}
                        <div className="relative group/nav">
                          <NavItem
                            item={item}
                            active={itemActive(item)}
                            collapsed={railCollapsed}
                          />
                          {/* THE STAR: pins a feature to My features, or takes it
                              out. Shown on hover, and always while editing, so
                              the menu stays calm the rest of the time. */}
                          {!railCollapsed && !item.external && (() => {
                            const starred = favorites.includes(item.href)
                            return (
                              <button
                                type="button"
                                onClick={(e) => { e.preventDefault(); e.stopPropagation(); starFeature(item.href, item.label) }}
                                aria-label={starred ? `Take ${item.label} out of My features` : `Add ${item.label} to My features`}
                                aria-pressed={starred}
                                title={starred ? 'Take out of My features' : 'Add to My features'}
                                className={cn(
                                  'absolute right-1 top-1/2 -translate-y-1/2 p-1 rounded-md transition-opacity focus-visible:opacity-100',
                                  editingFavorites ? 'opacity-100' : 'opacity-0 group-hover/nav:opacity-100',
                                )}
                                style={{ background: 'var(--bg-sidebar, var(--surface))', color: starred ? (isDark ? '#F472B6' : '#BE185D') : 'var(--text-faint)' }}
                              >
                                <Star size={13} fill={starred ? 'currentColor' : 'none'} />
                              </button>
                            )
                          })()}
                        </div>
                      </Fragment>
                    ))}
                  </div>
                )}
                {isFavorites && !railCollapsed && (favoritesNote || favoritesSavedTo === 'device') && (
                  <p className="px-2.5 pt-1 text-[10.5px]" style={{ color: '#D97706' }}>
                    {favoritesNote || 'Saved on this browser only for now, so it will not show on your other devices.'}
                  </p>
                )}
              </div>
              </Fragment>
            )
          })}

          {/* Admin View-as dropdown — same lib/view-as.ts wiring as the
              legacy sidebar. Only renders when the real DB tier is admin
              (gated server-side via the `tier` prop). */}
          {isAdmin && !railCollapsed && (
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
            className={`flex items-center gap-2 px-2 py-1.5 rounded-lg group ${railCollapsed ? 'justify-center' : ''}`}
            style={{ backgroundColor: 'transparent' }}
          >
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-emerald-400 to-cyan-400 flex items-center justify-center text-[13px] font-semibold text-white flex-shrink-0">
              {userInitial}
            </div>
            {!railCollapsed && (
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
          className="border-b px-3 sm:px-5 md:px-8 py-3 flex items-center gap-2 sm:gap-3 backdrop-blur-md sticky top-0 z-20"
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
          <button
            onClick={() => setMobileOpen(true)}
            className="md:hidden p-2 -ml-1 rounded-lg flex-shrink-0"
            style={{ color: 'var(--text)' }}
            aria-label="Open the menu"
          >
            <Menu size={18} />
          </button>
          {/* NEVER SHRINK THE CHIP. The phone layout gave its wrapper min-w-0,
              so on a crowded topbar it shrank to nothing while its text stayed
              visible, and the search box slid over it and took every click:
              a Pro member's blog switcher "stopped working". The chip keeps its
              width; the search box is what gives way. */}
          {!amazonView && <div className="hidden sm:block flex-shrink-0"><SiteSwitcherChip currentHostname={wpHostname} /></div>}

          {/* Search MVP — jump to any page or section (Geniuslink, upload
              brand logo, AdSense…). ⌘K focuses it from anywhere. */}
          <div className="min-w-0 flex-1 md:flex-initial md:basis-72"><TopbarSearch isAdmin={isAdmin} /></div>

          <div className="ml-auto flex items-center gap-2 sm:gap-3 flex-shrink-0">
            {/* Week recap: flashes until this week's recap is opened. */}
            <RecapTopbarButton />
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
                  className="px-3 py-2 rounded-lg border text-[12px] font-medium hidden lg:inline-flex items-center gap-1.5 transition-colors"
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
                  className="px-3 py-2 rounded-lg border text-[12px] font-medium hidden lg:inline-flex items-center gap-1.5 transition-colors"
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
                <span className="hidden lg:contents"><PurgeCacheTopbarButton /></span>
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
              <LifeBuoy size={12} /> <span className="hidden sm:inline">Support</span>{ticketAlert ? ` (${openTickets})` : ''}
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
          {/* Sold-product campaigns, accepted once a day through SCOUT. */}
          <SoldCampaignsDaily />
          {/* Action-needed announcement popup (admin-managed, variant 'modal'). */}
          <AnnouncementModal />
          <ReconnectCheckup />
          <div className="max-w-7xl px-4 sm:px-6 lg:px-8 pt-6 pb-12">
            {!amazonLocked && tabbedItem && <SectionTabs item={tabbedItem} isActive={isActive} />}
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


// The tab bar of a merged row (Brand campaigns, Connections, Brand inbox...),
// drawn above each of its pages so the pages read as one tool. Only the tabs
// this account can open are shown; the current page is underlined.
function SectionTabs({ item, isActive }: { item: NavItemDef; isActive: (href: string) => boolean }) {
  const tabs = (item.tabs ?? []).filter((t) => t.gate !== false)
  return (
    <nav aria-label={item.label} className="mb-5 flex gap-1 overflow-x-auto border-b" style={{ borderColor: 'var(--border)' }}>
      {tabs.map((t) => {
        const on = isActive(t.href)
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={on ? 'page' : undefined}
            className="-mb-px flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2.5 text-[13.5px] font-semibold transition-colors"
            style={{ color: on ? 'var(--text)' : 'var(--text-faint)', borderColor: on ? '#7C3AED' : 'transparent' }}
          >
            {t.label}
            {typeof t.badge === 'number' && t.badge > 0 && (
              <span className="rounded-full px-1.5 text-[10px] font-bold text-white" style={{ backgroundColor: '#ff3b30' }}>{t.badge}</span>
            )}
          </Link>
        )
      })}
    </nav>
  )
}

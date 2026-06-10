// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// /pro-tour — the long-form capabilities tour of what's shipped on Pro today.
//
// One canonical place a creator can read and link out to that shows the full
// surface area of the platform. Linked from the dashboard banner so visitors
// can find it on day one, but also a marketing/sales page worth referring to
// when someone asks "what does this actually do?"
//
// Design notes:
//   - Reads as an editorial article, NOT a feature checklist. The content is
//     prose because the goal is to convey philosophy + capability density,
//     not a side-by-side comparison table (the /pricing page handles that).
//   - Section icons + spacing are consistent with the rest of the dashboard
//     (lucide-react, --surface / --border / --text tokens, rounded-2xl cards).
//   - Sticky table of contents on desktop so a long page stays navigable;
//     collapses below the lead paragraph on mobile.
//   - CTAs to relevant in-app routes are sprinkled where they help; the
//     closing CTA routes to /billing.
//   - Fact-grounded tone — every sentence describes something that actually
//     ships today. No "coming soon," no roadmap items. If a feature is
//     pending third-party approval (TikTok et al.), it is OMITTED here so
//     the page never sells what doesn't work.

import type { Metadata } from 'next'
import Link from 'next/link'
import {
  Compass, FileText, Youtube, Search, Mail, Handshake, Lightbulb,
  Layers, Users, Plug, MessageSquare, Code, Sparkles,
  ArrowRight, CheckCircle2, ArrowUpRight,
} from 'lucide-react'

export const metadata: Metadata = {
  title: 'Pro capabilities tour',
  description: 'Every Pro feature live on MVP Affiliate today.',
}

// ── Table of contents structure ───────────────────────────────────────────
// Each entry maps to an in-page anchor below. Title + a short blurb so the
// sidebar reads as a real preview, not just labels.
const SECTIONS: Array<{ id: string; label: string }> = [
  { id: 'engine',       label: 'The blog content engine' },
  { id: 'copilot',      label: 'YouTube Co-Pilot' },
  { id: 'seo',          label: 'SEO that moves rank' },
  { id: 'newsletter',   label: 'Newsletter' },
  { id: 'collabs',      label: 'Brand outreach' },
  { id: 'brainstorm',   label: 'Brainstorm' },
  { id: 'multisite',    label: 'Multi-site WordPress' },
  { id: 'vas',          label: 'Virtual Assistants' },
  { id: 'plugin',       label: 'WordPress plugin + theme' },
  { id: 'helpdesk',     label: 'AI Help Desk' },
  { id: 'api',          label: 'API access' },
  { id: 'misc',         label: 'Tools we built for ourselves' },
]

export default function ProTourPage() {
  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--page-bg)' }}>
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-10 sm:py-14">

        {/* ── Hero ─────────────────────────────────────────────────────── */}
        <header className="mb-10">
          <div className="flex items-center gap-2 mb-4">
            <Compass size={14} className="text-[#7C3AED]" />
            <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-soft)' }}>
              Capabilities tour
            </span>
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight mb-4" style={{ color: 'var(--text)' }}>
            Everything Pro unlocks on MVP Affiliate today
          </h1>
          <p className="text-[15px] leading-relaxed max-w-3xl" style={{ color: 'var(--text-soft)' }}>
            If you&apos;re running review content as a real business — multiple sites, a team, a growing newsletter,
            brand deals — you&apos;ve outgrown the &quot;one tool per job&quot; approach. This is the full tour of what&apos;s
            shipped on Pro right now. No roadmap, no &quot;coming soon.&quot; Just what works today.
          </p>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-[220px_1fr] gap-10">

          {/* ── Sticky TOC ───────────────────────────────────────────── */}
          <aside className="hidden lg:block">
            <nav className="sticky top-24">
              <p className="text-[10px] font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--text-soft)' }}>
                In this tour
              </p>
              <ul className="space-y-1.5 text-[13px]">
                {SECTIONS.map(s => (
                  <li key={s.id}>
                    <a
                      href={`#${s.id}`}
                      className="block py-1 hover:text-[#7C3AED] transition-colors"
                      style={{ color: 'var(--text-soft)' }}
                    >
                      {s.label}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          </aside>

          {/* ── Body ─────────────────────────────────────────────────── */}
          <article className="space-y-12 min-w-0">

            {/* Opening — the philosophy */}
            <section
              className="rounded-2xl border p-6"
              style={{
                backgroundColor: 'var(--surface)',
                borderColor: 'var(--border)',
                boxShadow: 'var(--card-shadow)',
              }}
            >
              <div className="flex items-start gap-3">
                <CheckCircle2 size={20} className="text-[#7C3AED] flex-shrink-0 mt-0.5" />
                <div>
                  <h2 className="text-[15px] font-semibold mb-2" style={{ color: 'var(--text)' }}>
                    Fact-grounded, every time
                  </h2>
                  <p className="text-[14px] leading-relaxed" style={{ color: 'var(--text-soft)' }}>
                    Every word you generate on MVP is fact-grounded. We never invent specs, prices, or experiences a creator
                    didn&apos;t actually have. If your transcript says you tested it in your kitchen for three weeks, that&apos;s what
                    the post says. If it doesn&apos;t say something, we don&apos;t make it up. That&apos;s the differentiator — and it&apos;s the
                    reason Google increasingly ranks MVP-built posts above the AI-generated noise.
                  </p>
                </div>
              </div>
            </section>

            {/* ── 1. Blog engine ───────────────────────────────────── */}
            <Section id="engine" icon={<FileText size={18} />} title="The blog content engine">
              <p>
                This is the core of what Pro buys you. You connect your YouTube channel, sync your videos, and from any
                video MVP generates a full SEO blog post in about three minutes — complete with featured image, in-article
                images, internal links, schema markup, OG tags, alt text, and a quick verdict box. It auto-publishes to your
                WordPress site with one click.
              </p>
              <h3>What Pro gets you here that lower tiers don&apos;t</h3>
              <ul>
                <li>
                  <strong>Comparison posts.</strong> Drop in 2–10 YouTube URLs of different products, MVP scrapes Amazon
                  for each, ranks them on real spec data, and writes a multi-product round-up with a verdict box, pros/cons
                  table, and best-for categories. Same fact-grounded promise: no invented features.
                </li>
                <li>
                  <strong>Buying guides.</strong> Write a &quot;how to pick a [category]&quot; guide that pulls together the products
                  from your channel, your niche expertise, and structured buying criteria. Indexed differently than reviews
                  and pulls a different search audience.
                </li>
                <li>
                  <strong>Multi-site publishing.</strong> Connect up to 5 WordPress sites. Each post can be routed to any
                  site, each site can run a different brand, each site gets its own Geniuslink tracking group, and the site
                  picker is built into every generation surface.
                </li>
                <li>
                  <strong>Higher generation caps.</strong> Pro lifts the monthly post + image + script limits well past what
                  Creator and Studio offer.
                </li>
              </ul>
              <h3>Built into every post, but worth knowing about</h3>
              <p>
                <strong>The LEARN voice profile.</strong> Every time you publish, MVP reads what you just shipped and quietly
                updates a model of your voice — opening hook style, sentence length, what you love, what annoys you, the
                exact words you use for &quot;good enough&quot; vs &quot;skip it.&quot; The next post is more <em>you</em> than the last.
                After five published posts you start hearing yourself in the drafts.
              </p>
              <p>
                <strong>The rewrite feedback loop.</strong> When you click &quot;Rewrite&quot; with notes, those notes don&apos;t just apply
                to that one regeneration — they accumulate on your profile and get applied to every future generation. The
                AI gets smarter about your specific taste over time.
              </p>
              <p>
                <strong>In-article images.</strong> MVP uses scene-grounded generation to render shots of your actual product
                in real-world settings — never the listing photo, never a generic stock image. We vision-pick the clean
                product reference image first (Amazon&apos;s main image is often a lifestyle collage with props), then render fresh.
              </p>
              <p>
                <strong>Schedule + cascade.</strong> Pick a future date, MVP queues the post, drafts the newsletter,
                schedules the WordPress publish, fires IndexNow when it goes live, and appends the YouTube description
                backlink — all on the same timer. Bulk-schedule a week&apos;s worth of videos in one shot.
              </p>
              <p>
                <strong>Rebuild legacy posts.</strong> If you have old WP posts from before MVP, point a YouTube video at
                them and we rewrite the body in your current voice without touching the slug or URL — preserving inbound
                links and SEO authority.
              </p>
              <SectionCta href="/content" label="Open your Library" />
            </Section>

            {/* ── 2. YouTube Co-Pilot ──────────────────────────────── */}
            <Section id="copilot" icon={<Youtube size={18} />} title="YouTube Co-Pilot">
              <p>
                The Studio surface — your title, description, tags, pinned comment, and thumbnail generator for any YouTube
                video.
              </p>
              <ul>
                <li>
                  Generates an optimized title, a search-engine-ready description with chapters and your affiliate link,
                  pinned comment, and tag set in one shot.
                </li>
                <li>
                  Builds thumbnails grounded in the actual video. With the Chrome extension installed, MVP captures real
                  frames from the video tab and uses them as the base — your face, the actual product, the actual lighting.
                  You stop generating thumbnails that look nothing like what&apos;s in the video.
                </li>
                <li>
                  <strong>Variant generation:</strong> pick 1–10 variants per click. Most Pro creators generate three, test
                  two on YouTube, keep the winner.
                </li>
                <li>
                  <strong>Your Face models:</strong> upload 4–20 headshots, name the face (&quot;Me,&quot; &quot;Co-host,&quot; etc.), and MVP
                  uses them as identity references in every composed thumbnail. Pro gives you five face slots — enough for
                  the host, a co-host, and a few project-specific looks.
                </li>
                <li>
                  <strong>Saved style presets:</strong> lock in your channel&apos;s thumbnail aesthetic with reference images.
                  Pick a preset, MVP applies that visual brief on every generation.
                </li>
                <li>
                  <strong>Per-video Amazon attribution:</strong> every YouTube description Geniuslink gets an{' '}
                  <code>ascsubtag</code> matching the video ID, so when Amazon ships you the report you can see which video
                  earned which dollar.
                </li>
              </ul>
              <p>
                The MVP-YOUTUBE Geniuslink group catches every YouTube-description click separately from your blog clicks,
                so your analytics dashboard tells you whether to invest the next hour writing a blog post or recording a video.
              </p>
              <SectionCta href="/co-pilot" label="Open YouTube Co-Pilot" />
            </Section>

            {/* ── 3. SEO ──────────────────────────────────────────── */}
            <Section id="seo" icon={<Search size={18} />} title="SEO that actually moves rank">
              <p>
                The SEO hub is the dashboard most Pro creators check first thing every morning.
              </p>
              <ul>
                <li>
                  Every published post listed with its on-page score, indexing status (indexed / submitted / unknown),
                  last-crawl date, and 28-day clicks / impressions / position from Google Search Console.
                </li>
                <li>
                  The score is calculated against current SEO best practices — answer-first lead lines, schema completeness,
                  internal linking, keyword density, FAQ presence, image alt text. Click any post for the breakdown and a
                  one-click &quot;fix all&quot; button.
                </li>
                <li>
                  <strong>Bulk index:</strong> select up to 50 posts and submit them all to IndexNow (Bing, Yandex, Copilot)
                  sequentially. Google indexes via the daily GSC sweep separately.
                </li>
                <li>
                  <strong>Title audit:</strong> scan your whole archive for posts whose title&apos;s product doesn&apos;t match the
                  body&apos;s product. This catches the rare hallucination — sometimes one slipped through before our newer
                  fact-check layer existed. One click rewrites the title in WP without touching the slug.
                </li>
                <li>
                  <strong>Per-source click analytics.</strong> We split your Geniuslink clicks by source: YouTube descriptions
                  go to MVP-YOUTUBE, each blog site goes to its own per-domain group. You see exactly which surface is converting.
                </li>
              </ul>
              <SectionCta href="/seo" label="Open the SEO hub" />
            </Section>

            {/* ── 4. Newsletter ──────────────────────────────────── */}
            <Section id="newsletter" icon={<Mail size={18} />} title="Newsletter (Resend + custom domain)">
              <p>
                Newsletter on Pro is a real owned-audience play, not a token feature.
              </p>
              <ul>
                <li>
                  Connect your custom domain to Resend in one wizard. MVP creates the Resend domain, surfaces the exact DNS
                  records you need to paste, then polls until verification — auto-confirming the moment your DNS propagates.
                </li>
                <li>Capped subscriber list well into the tens of thousands.</li>
                <li>
                  <strong>Compose:</strong> live preview as you type, segment picker, A/B subject line testing, schedule
                  send for any future date.
                </li>
                <li>
                  <strong>Auto-embed:</strong> the MVP theme renders your signup form on the homepage and in the sidebar of
                  every post automatically — no shortcode pasting. Mid-article inline form is configurable per blog from
                  Customize.
                </li>
                <li>
                  <strong>Segment builder:</strong> target subscribers by source, signup date, or behavioral tags. Send the
                  new-grill review only to people who signed up via your grill posts.
                </li>
                <li>
                  Sender name override and per-placement CTA copy so the homepage form, the sidebar, and the mid-article
                  inline form can each have different framing.
                </li>
              </ul>
              <SectionCta href="/newsletter" label="Open Newsletter" />
            </Section>

            {/* ── 5. Brand outreach ───────────────────────────────── */}
            <Section id="collabs" icon={<Handshake size={18} />} title="Brand outreach / Collaborations">
              <p>
                This is the surface that pays for the whole subscription for most Pro creators.
              </p>
              <ul>
                <li>
                  <strong>AI-generated brand pitch emails.</strong> Enter the brand name, the products they sell, what
                  you&apos;re offering (sponsored video, social posts, affiliate-only deal, free product in exchange for a
                  review), and MVP writes a tailored cold email — researching the brand, citing your actual track record,
                  listing your reach platforms, attaching your media kit URL.
                </li>
                <li>
                  <strong>100 pitches per month on Pro.</strong> Most creators send 20–40 a month to land 3–8 partnerships.
                </li>
                <li>
                  Auto-prefilled from your Brand Profile: every platform you&apos;ve connected or listed shows up as a &quot;your
                  offer&quot; pill. Your portfolio URL, media kit URL, livestream link, banner-ad inventory, production-fee
                  bracket, and shipping preferences flow in automatically.
                </li>
                <li>
                  <strong>Multi-channel reach offer:</strong> blog, YouTube, Instagram, Facebook, Pinterest, X — every
                  platform you&apos;ve listed shows up in the pitch, so brands see your full reach without you typing it twice.
                </li>
                <li>
                  <strong>Track record + example links:</strong> list your three best previous collabs (with URLs) and MVP
                  weaves them into every pitch as credibility anchors.
                </li>
              </ul>
              <SectionCta href="/collaborations" label="Open Collaborations" />
            </Section>

            {/* ── 6. Brainstorm ────────────────────────────────────── */}
            <Section id="brainstorm" icon={<Lightbulb size={18} />} title="Brainstorm — performance-driven idea engine">
              <p>
                Open the Brainstorm page and MVP shows you the last 90 days of your YouTube + WordPress performance side-by-side.
              </p>
              <ul>
                <li>Top 5 + bottom 5 YouTube videos by views (with thumbnails).</li>
                <li>Top 5 + bottom 5 blog posts by clicks (with GSC data merged in).</li>
                <li>Niche performance grid: every niche you&apos;ve published in, ranked by total clicks and average CTR.</li>
                <li>
                  <strong>Coverage gaps:</strong> niches you claim on your Brand Profile but haven&apos;t actually published
                  in over the window. The &quot;you said you do this but you haven&apos;t&quot; signal.
                </li>
                <li>
                  One-click AI idea generation that reads your performance data and proposes specific next videos to
                  record — not generic ideas, but the ones our coaching model thinks fit <em>your</em> channel&apos;s pattern.
                </li>
              </ul>
              <SectionCta href="/brainstorm" label="Open Brainstorm" />
            </Section>

            {/* ── 7. Multi-site ────────────────────────────────────── */}
            <Section id="multisite" icon={<Layers size={18} />} title="Multi-site WordPress (up to 5 sites)">
              <p>
                If you run more than one review site — a main brand plus a niche-specific spinoff, or a multi-language
                network — Pro is built for you.
              </p>
              <ul>
                <li>
                  Connect up to 5 sites. Each lives as its own entry in your Pro account with its own credentials, its own
                  Geniuslink group, its own brand profile data flowing through, its own newsletter, its own Customize settings.
                </li>
                <li>
                  The Add Site modal accepts either the standard wp-admin connection or a one-shot Connection Token from
                  the MVP Affiliate plugin — paste, it decodes, you&apos;re connected.
                </li>
                <li>
                  Set a default site and use the site picker on every content surface (Library, Studio, Comparison,
                  Newsletter, SEO) to route work to a specific site.
                </li>
                <li>
                  Per-site SEO dashboard — your SEO hub shows posts from all sites with their site name as a column, so a
                  3-site Pro user sees their whole network in one view.
                </li>
              </ul>
              <SectionCta href="/setup" label="Manage your sites" />
            </Section>

            {/* ── 8. Virtual Assistants ──────────────────────────── */}
            <Section id="vas" icon={<Users size={18} />} title="Virtual Assistants">
              <p>You&apos;re not running this business alone anymore. Pro includes VA seats.</p>
              <ul>
                <li>
                  Invite a VA by email. They sign up under your account on your single Pro subscription — no separate billing.
                </li>
                <li>
                  <strong>Full workspace sharing.</strong> Your invited VA logs in and sees your videos, posts, brand
                  profile, integrations, WordPress sites, face library, thumbnail styles, collaborations, performance
                  dashboard, SEO data — everything they need to ship content on your behalf.
                </li>
                <li>Usage caps and AI cost still bill against your single Pro plan, so VA seats don&apos;t multiply your spend.</li>
                <li>
                  <strong>Permission gating:</strong> VAs cannot access your billing, your integrations setup wizard, your
                  Brand Profile editor, or invite other VAs. Read + content-generation access only.
                </li>
              </ul>
              <SectionCta href="/agency" label="Invite a Virtual Assistant" />
            </Section>

            {/* ── 9. WordPress plugin + theme ────────────────────── */}
            <Section id="plugin" icon={<Plug size={18} />} title="WordPress plugin + theme">
              <p>
                Pro creators use the MVP Affiliate theme + plugin (free, ships with every account). This is the
                infrastructure layer that makes the rest of MVP feel like one product.
              </p>
              <ul>
                <li>
                  Theme self-updates from wp-admin — every new theme version shows a red &quot;Update now&quot; banner inside
                  WordPress, one click installs.
                </li>
                <li>
                  Plugin auto-installs when you connect a site. Manages all customization data via a single option that
                  flows from MVP.
                </li>
                <li>
                  <strong>Body-auth proxy:</strong> hosts that strip the Authorization header on POST (Hostinger, some
                  shared LiteSpeed setups) used to break MVP writes. The plugin now exposes a proxy endpoint authenticated
                  via request body, so writes survive any reverse-proxy quirk.
                </li>
                <li>
                  <strong>Topic hub pages:</strong> auto-generated landing pages for each niche, pulling in your latest
                  posts in that category.
                </li>
                <li>
                  <strong>AI Product Finder:</strong> a branded recommendation widget embedded in every blog post that lets
                  your readers narrow products by their actual constraints.
                </li>
                <li>
                  Sticky TOC, in-article newsletter signup, footer customization, header banner, schema enrichment, OG
                  image generation, IndexNow ping, LiteSpeed cache integration on save.
                </li>
              </ul>
              <SectionCta href="/customize" label="Customize your blog" />
            </Section>

            {/* ── 10. Help Desk ─────────────────────────────────── */}
            <Section id="helpdesk" icon={<MessageSquare size={18} />} title="AI Help Desk">
              <p>
                The MVP Help Desk knows your account, your features, your brand, your voice, your recent posts, your
                published patterns.
              </p>
              <ul>
                <li>
                  Ask it &quot;what should I publish this week&quot; and it reads your performance data and tells you.
                </li>
                <li>
                  Ask it &quot;rewrite this section in my voice&quot; and it pulls your LEARN profile and your recent voice anchors.
                </li>
                <li>
                  <strong>Memory:</strong> import your existing context from other AI tools (paste your existing memory
                  dump, MVP normalizes and persists it).
                </li>
                <li>
                  Auto-rolling memory: as you chat over weeks, the Help Desk distills patterns into a persistent memory
                  layer that survives sessions.
                </li>
                <li>Renders markdown, auto-links internal MVP routes, surfaces feature documentation on demand.</li>
              </ul>
              <SectionCta href="/assistant" label="Open Help Desk" />
            </Section>

            {/* ── 11. API ─────────────────────────────────────────── */}
            <Section id="api" icon={<Code size={18} />} title="API access (Pro-exclusive)">
              <p>
                For Pro creators with engineering resources or who want to wire MVP into their own internal tools:
              </p>
              <ul>
                <li>Generate API keys from the dashboard.</li>
                <li>
                  Endpoints: <code>/api/v1/me</code> (account info), <code>/api/v1/blog-posts</code> (list + create + read
                  by ID), <code>/api/v1/health</code> (uptime check).
                </li>
                <li>Authenticated via Bearer token. Standard REST. Documented under /docs/api.</li>
              </ul>
              <SectionCta href="/developers" label="Manage API keys" />
            </Section>

            {/* ── 13. Misc tools ──────────────────────────────────── */}
            <Section id="misc" icon={<Sparkles size={18} />} title="Tools that exist because we built them for ourselves">
              <p>A few features that didn&apos;t fit into the categories above but Pro creators rely on:</p>
              <ul>
                <li>
                  <strong>Photobooth:</strong> AI-composed product-in-scene image generator that uses your face models.
                  Generates lifestyle shots for in-blog embedding and visual asset libraries.
                </li>
                <li>
                  <strong>Failed-schedule warnings:</strong> the Library surfaces any post whose scheduled publish or
                  cascade leg failed, with a one-click retry.
                </li>
                <li>
                  <strong>Schedule cascade:</strong> link a post&apos;s schedule to its newsletter send — they all fire at the
                  same timestamp.
                </li>
                <li>
                  <strong>In-app notification bell:</strong> every failed job, every approval needed, every scheduling
                  event surfaces in the bell so you don&apos;t have to monitor multiple dashboards.
                </li>
              </ul>
            </Section>

            {/* ── Closing CTA ────────────────────────────────────── */}
            <section
              className="rounded-2xl border p-7 sm:p-8"
              style={{
                background: 'linear-gradient(135deg, rgba(124, 58, 237, 0.10), rgba(168, 85, 247, 0.06))',
                borderColor: 'rgba(124, 58, 237, 0.30)',
              }}
            >
              <h2 className="text-xl font-bold mb-3" style={{ color: 'var(--text)' }}>
                Why Pro, and why now
              </h2>
              <p className="text-[14px] leading-relaxed mb-3" style={{ color: 'var(--text-soft)' }}>
                Creator-tier MVP gets you the writer. Pro gets you the <em>business</em>. Multiple sites, a team, a real
                newsletter, brand-deal pipeline, performance analytics that drive your editorial calendar, the infrastructure
                to run all of it from one dashboard.
              </p>
              <p className="text-[14px] leading-relaxed mb-5" style={{ color: 'var(--text-soft)' }}>
                If you&apos;re spending more than 8 hours a week on content operations across multiple tools — Pro is built to
                give you those hours back.
              </p>
              <Link
                href="/billing"
                className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg text-[13px] font-semibold text-white"
                style={{ background: '#7C3AED' }}
              >
                Manage your plan <ArrowUpRight size={13} />
              </Link>
            </section>

          </article>
        </div>
      </div>
    </div>
  )
}

// ── Section primitive ─────────────────────────────────────────────────────
// Wraps each capability section so headings, icon, anchor, and body prose
// styling stay consistent without copy-pasting a header per section.
// `prose-tour` is the local class that styles <p>, <ul>, <li>, <h3>, etc.
function Section({
  id, icon, title, children,
}: {
  id: string
  icon: React.ReactNode
  title: string
  children: React.ReactNode
}) {
  return (
    <section id={id} className="scroll-mt-24">
      <div className="flex items-center gap-3 mb-4">
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ background: 'rgba(124, 58, 237, 0.12)', color: '#7C3AED' }}
        >
          {icon}
        </div>
        <h2 className="text-xl font-bold tracking-tight" style={{ color: 'var(--text)' }}>
          {title}
        </h2>
      </div>
      <div className="prose-tour space-y-4 text-[14.5px] leading-relaxed" style={{ color: 'var(--text-soft)' }}>
        {children}
      </div>
      <style>{`
        .prose-tour h3 {
          font-size: 14px;
          font-weight: 700;
          letter-spacing: -0.01em;
          color: var(--text);
          margin-top: 1.5rem;
          margin-bottom: 0.5rem;
        }
        .prose-tour ul {
          list-style: disc;
          padding-left: 1.25rem;
          margin: 0.5rem 0;
        }
        .prose-tour li {
          margin: 0.5rem 0;
        }
        .prose-tour strong {
          color: var(--text);
          font-weight: 600;
        }
        .prose-tour code {
          font-family: var(--font-geist-mono, ui-monospace, monospace);
          font-size: 12.5px;
          padding: 1px 6px;
          border-radius: 4px;
          background: var(--surface-bright);
          color: var(--text);
        }
      `}</style>
    </section>
  )
}

// ── In-section CTA ────────────────────────────────────────────────────────
// A small inline "go use this now" link below each section so a reader who
// wants to act on what they just read has the route surfaced. Subtle styling
// so it doesn't compete with section prose.
function SectionCta({ href, label }: { href: string; label: string }) {
  return (
    <div className="pt-2">
      <Link
        href={href}
        className="inline-flex items-center gap-1 text-[13px] font-semibold text-[#7C3AED] hover:text-[#9D6BFF]"
      >
        {label} <ArrowRight size={13} />
      </Link>
    </div>
  )
}

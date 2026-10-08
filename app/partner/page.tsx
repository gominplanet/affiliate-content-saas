// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// /partner — a letter from Seb to the communities and groups he wants to
// partner with (Seb, 2026-10-08: "a special hidden page on the MVP website
// that would be a message for some groups"). Hidden means: not in the
// sitemap, not linked from anywhere, and asked not to be indexed. It is sent
// by hand to the people it is written for.
//
// The prices and counts are read from the plans, never typed, so the letter
// cannot promise what checkout does not charge. After the price change the
// "lock it in" paragraph says the current price instead.

import type { Metadata } from 'next'
import NextImage from 'next/image'
import { Newsreader } from 'next/font/google'
import { ArrowRight, Mail } from 'lucide-react'
import { TIERS } from '@/lib/tier'
import { MAX_ITEMS as BULK_UPLOAD_MAX_VIDEOS } from '@/lib/launch-batch'
import { PRICES_BEFORE, NEW_MEMBER_PRICES, newPricesLive } from '@/lib/price-schedule'

const serif = Newsreader({ subsets: ['latin'], style: ['normal', 'italic'], weight: ['400', '500', '600'], display: 'swap', variable: '--font-letter' })

export const metadata: Metadata = {
  title: 'A note from Seb | MVP Affiliate',
  description: 'Why I built MVP Affiliate, what it does for creators like your members, and the partnership I would like to build with your community.',
  robots: { index: false, follow: false, googleBot: { index: false, follow: false } },
}

// Checked hourly, so the price paragraph turns over on November 1 by itself.
export const revalidate = 3600

const C = {
  paper: '#FBFAF7',
  card: '#FFFFFF',
  ink: '#16131F',
  soft: '#5B5668',
  line: '#E7E3EE',
  violet: '#6D28D9',
  violetSoft: '#F1EBFE',
  gold: '#F6C343',
  night: '#120E1C',
}

const EMAIL = 'us@gominplanet.com'
const SITE = 'https://www.mvpaffiliate.io'

type Feature = { title: string; tag?: string; body: React.ReactNode; image?: { src: string; alt: string; w: number; h: number } }

export default function PartnerLetter() {
  const later = newPricesLive()
  const amazonNow = later ? NEW_MEMBER_PRICES.amazon.month : PRICES_BEFORE.amazon.month
  const proNow = later ? NEW_MEMBER_PRICES.pro.month : PRICES_BEFORE.pro.month
  const vaSeats = TIERS.pro.vaSeats

  const features: Feature[] = [
    {
      title: 'One video in, the whole package out.',
      body: <>I give it a video and a product. It writes the review on my own blog, builds the thumbnail with my own face on it, writes the YouTube title, description and tags, cuts vertical clips for Reels and TikTok, and posts to every social channel I have connected.</>,
      image: { src: '/png/mvp-video-to-blog.png', alt: 'One YouTube video becoming a blog post, a vertical clip and social posts in MVP', w: 1731, h: 909 },
    },
    {
      title: 'Bulk Amazon and YouTube upload.',
      tag: 'Saves me the most time',
      body: <>I set up to {BULK_UPLOAD_MAX_VIDEOS} videos in one sitting, choose my call to action and thumbnail look once, give each video its product, and press Launch. MVP burns the CTA onto each video, builds every thumbnail, writes the titles, descriptions and tags, schedules the YouTube uploads with paid promotion and AI disclosure already set, and sends each one to my Amazon storefront. One press, then I walk away.</>,
    },
    {
      title: 'TRYBE outreach.',
      tag: 'Just added',
      body: <>It searches TRYBE for brands that genuinely fit my channel, reads each brand&rsquo;s profile and website before deciding, and drafts a first message to each. It does not blind message every brand on the platform, which is the thing that gets creators ignored.</>,
    },
    {
      title: 'Amazon brand campaigns.',
      body: <>The same idea on Creator Connections. I see the live campaigns worth my time with the commission, the spots left and the days remaining, and I can pitch up to a hundred brands in one go from my own profile. Joining a campaign stays my decision; nothing gets accepted on my behalf.</>,
    },
    {
      title: 'It is not Amazon only.',
      body: <>MVP also connects Levanta, PartnerBoost, Walmart, Wayward and LTK, so creators who earn outside Amazon are not locked out. Same workflow, same links, more programs to pull from.</>,
    },
    {
      title: 'Passport links, on our own mvpl.ink domain.',
      body: <>Every affiliate link sends the shopper to their own country&rsquo;s Amazon with my tag for that country, so a viewer in Germany does not land on the US store and buy nothing. Everyone else charges per click for this and the bill grows as you grow. On MVP it is unlimited links and unlimited clicks, no per click cost, no overage, included on every plan.</>,
    },
    {
      title: 'Amazon Live.',
      body: <>Prep before the live, and the follow up after it.</>,
    },
  ]

  return (
    <main className={serif.variable} style={{ background: C.paper, color: C.ink, minHeight: '100vh' }}>
      <style>{`
        .pl-wrap { max-width: 1080px; margin: 0 auto; padding: 0 20px; }
        .pl-letter { font-family: var(--font-letter), Georgia, 'Times New Roman', serif; font-size: 19px; line-height: 1.65; }
        .pl-display { font-family: var(--font-jakarta), var(--font-sans), system-ui, sans-serif; letter-spacing: -0.01em; word-spacing: 0.04em; text-wrap: balance; }
        .pl-ui { font-family: var(--font-sans), system-ui, sans-serif; }
        .pl-hero { display: grid; gap: 40px; grid-template-columns: 1fr; align-items: center; }
        .pl-feature { display: grid; gap: 28px; grid-template-columns: 1fr; padding: 34px 0; border-top: 1px solid ${C.line}; }
        .pl-prices { display: grid; gap: 16px; grid-template-columns: 1fr; }
        .pl-thumbs { display: grid; gap: 10px; grid-template-columns: repeat(2, 1fr); }
        .pl-chip { display: inline-flex; align-items: center; border: 1px solid ${C.line}; background: ${C.card}; border-radius: 999px; padding: 6px 12px; font-size: 13px; font-weight: 600; }
        .pl-btn:focus-visible, .pl-link:focus-visible { outline: 3px solid ${C.gold}; outline-offset: 3px; }
        @media (min-width: 820px) {
          .pl-hero { grid-template-columns: 1.15fr 0.85fr; gap: 56px; }
          .pl-feature { grid-template-columns: 0.9fr 1.1fr; gap: 48px; }
          .pl-prices { grid-template-columns: 1fr 1fr; }
          .pl-thumbs { grid-template-columns: repeat(4, 1fr); }
        }
      `}</style>

      {/* ── masthead ─────────────────────────────────────────────────────── */}
      <header className="pl-wrap pl-ui" style={{ display: 'flex', alignItems: 'center', gap: 12, paddingTop: 22, paddingBottom: 22 }}>
        <NextImage src="/mvp-affiliate-logo.webp" alt="MVP Affiliate" width={36} height={36} style={{ borderRadius: 9 }} />
        <span style={{ fontWeight: 700, letterSpacing: '0.08em', fontSize: 13 }}>MVP AFFILIATE</span>
        <span style={{ marginLeft: 'auto', fontSize: 12, letterSpacing: '0.12em', textTransform: 'uppercase', color: C.soft }}>For community partners</span>
      </header>

      {/* ── hello ────────────────────────────────────────────────────────── */}
      <section className="pl-wrap" style={{ paddingTop: 28, paddingBottom: 56 }}>
        <div className="pl-hero">
          <div>
            <h1 className="pl-display" style={{ color: C.ink, fontSize: 'clamp(40px, 6vw, 68px)', lineHeight: 1.02, fontWeight: 800, margin: 0 }}>
              Hi, I&rsquo;m Seb.
            </h1>
            <div className="pl-letter" style={{ marginTop: 22, maxWidth: '36em', display: 'grid', gap: 18 }}>
              <p style={{ margin: 0 }}>
                My wife Michelle and I are Amazon Influencers and content creators. We run{' '}
                <strong>Gomin Reviews</strong>, a YouTube channel and review site where we showcase our product reviews every week.
              </p>
              <p style={{ margin: 0 }}>
                <strong>MVP Affiliate</strong> is the platform I built to run that operation. It started as my own tooling, because nothing on the
                market did what I needed, and I opened it to other creators once it was already doing the work for me every day.
              </p>
            </div>
          </div>
          <figure style={{ margin: 0 }}>
            <div style={{ position: 'relative', borderRadius: 22, overflow: 'hidden', boxShadow: '0 24px 60px -24px rgba(22,19,31,0.35)', aspectRatio: '4 / 5', maxWidth: 420, marginLeft: 'auto', marginRight: 'auto' }}>
              <NextImage src="/png/sebmichelle.webp" alt="Seb and Michelle on a dock by the water" fill sizes="(min-width: 820px) 420px, 100vw" style={{ objectFit: 'cover' }} priority />
            </div>
            <figcaption className="pl-ui" style={{ fontSize: 13, color: C.soft, textAlign: 'center', marginTop: 12 }}>
              Seb and Michelle, Gomin Reviews
            </figcaption>
          </figure>
        </div>
      </section>

      {/* ── what it does ─────────────────────────────────────────────────── */}
      <section style={{ background: C.card, borderTop: `1px solid ${C.line}`, borderBottom: `1px solid ${C.line}` }}>
        <div className="pl-wrap" style={{ paddingTop: 56, paddingBottom: 40 }}>
          <p className="pl-ui" style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: C.violet, margin: 0 }}>Here is what it does</p>
          <div style={{ marginTop: 18 }}>
            {features.map((f, i) => (
              <article key={f.title} className="pl-feature">
                <div>
                  {f.tag && (
                    <span className="pl-ui" style={{ display: 'inline-block', fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', background: i === 2 ? C.gold : C.violetSoft, color: i === 2 ? C.ink : C.violet, borderRadius: 6, padding: '4px 8px', marginBottom: 12 }}>{f.tag}</span>
                  )}
                  <h2 className="pl-display" style={{ color: C.ink, fontSize: 'clamp(24px, 3vw, 30px)', lineHeight: 1.15, fontWeight: 750, margin: 0 }}>{f.title}</h2>
                </div>
                <div>
                  <p className="pl-letter" style={{ margin: 0, color: C.ink }}>{f.body}</p>
                  {f.image && (
                    <div style={{ marginTop: 22, borderRadius: 16, overflow: 'hidden', border: `1px solid ${C.line}` }}>
                      <NextImage src={f.image.src} alt={f.image.alt} width={f.image.w} height={f.image.h} sizes="(min-width: 820px) 560px, 100vw" style={{ width: '100%', height: 'auto', display: 'block' }} />
                    </div>
                  )}
                  {i === 0 && (
                    <div style={{ marginTop: 12 }}>
                      <div className="pl-thumbs">
                        {['/png/mvp-tn1.png', '/png/mvp-tn2.png', '/png/mvp-tn3.png', '/png/mvp-tn4.png'].map((src, n) => (
                          <div key={src} style={{ position: 'relative', aspectRatio: '16 / 9', borderRadius: 10, overflow: 'hidden', border: `1px solid ${C.line}` }}>
                            <NextImage src={src} alt={`A review thumbnail MVP made, example ${n + 1}`} fill sizes="(min-width: 820px) 140px, 50vw" style={{ objectFit: 'cover' }} />
                          </div>
                        ))}
                      </div>
                      <p className="pl-ui" style={{ fontSize: 12.5, color: C.soft, margin: '8px 0 0' }}>Thumbnails MVP built for real review videos.</p>
                    </div>
                  )}
                  {i === 1 && (
                    <div className="pl-ui" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 18 }}>
                      {[`Up to ${BULK_UPLOAD_MAX_VIDEOS} videos`, 'CTA and thumbnails done', 'YouTube scheduled', 'Amazon storefront', 'One press'].map((t) => <span key={t} className="pl-chip">{t}</span>)}
                    </div>
                  )}
                  {i === 4 && (
                    <div className="pl-ui" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 18 }}>
                      {['Amazon', 'Levanta', 'PartnerBoost', 'Walmart', 'Wayward', 'LTK'].map((t) => <span key={t} className="pl-chip">{t}</span>)}
                    </div>
                  )}
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ── SCOUT ────────────────────────────────────────────────────────── */}
      <section style={{ background: C.night, color: '#F4F1FA' }}>
        <div className="pl-wrap" style={{ paddingTop: 64, paddingBottom: 64 }}>
          <p className="pl-ui" style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: C.gold, margin: 0 }}>How the Amazon side is even possible</p>
          <h2 className="pl-display" style={{ color: '#FFFFFF', fontSize: 'clamp(28px, 4vw, 42px)', lineHeight: 1.1, fontWeight: 800, margin: '14px 0 0', maxWidth: '20em' }}>
            Amazon gives nobody an API for this. So we built SCOUT.
          </h2>
          <p className="pl-letter" style={{ marginTop: 20, maxWidth: '38em', color: '#D9D3E6' }}>
            Amazon gives nobody an API for Creator Connections, storefront uploads or creator reporting. So MVP ships SCOUT, our own Chrome
            extension, which works inside your own logged in Amazon account and does the work for you. That is why MVP can do things on Amazon
            that other tools simply cannot reach. Nothing is scraped from anyone else&rsquo;s account and no password ever leaves your browser.
          </p>
        </div>
      </section>

      {/* ── team + pricing ───────────────────────────────────────────────── */}
      <section className="pl-wrap" style={{ paddingTop: 64, paddingBottom: 24 }}>
        <article className="pl-feature" style={{ borderTop: 'none', paddingTop: 0 }}>
          <h2 className="pl-display" style={{ color: C.ink, fontSize: 'clamp(24px, 3vw, 30px)', lineHeight: 1.15, fontWeight: 750, margin: 0 }}>Team access.</h2>
          <p className="pl-letter" style={{ margin: 0 }}>
            Pro includes {vaSeats === 3 ? 'three' : vaSeats} virtual assistant seats. A VA you invite works inside your workspace on your videos,
            blog posts and brand profile, while your connected accounts and API keys stay yours alone and are never shared with them. If your
            members work with editors or assistants, this matters.
          </p>
        </article>

        <article className="pl-feature">
          <h2 className="pl-display" style={{ color: C.ink, fontSize: 'clamp(24px, 3vw, 30px)', lineHeight: 1.15, fontWeight: 750, margin: 0 }}>Pricing.</h2>
          <div>
            <div className="pl-prices pl-ui">
              {[
                { name: 'Amazon', now: amazonNow, next: NEW_MEMBER_PRICES.amazon.month },
                { name: 'Pro', now: proNow, next: NEW_MEMBER_PRICES.pro.month },
              ].map((p) => (
                <div key={p.name} style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 16, padding: '18px 20px' }}>
                  <p style={{ margin: 0, fontSize: 13, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: C.soft }}>{p.name}</p>
                  <p style={{ margin: '6px 0 0', fontSize: 34, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>
                    ${p.now}<span style={{ fontSize: 15, fontWeight: 600, color: C.soft }}> a month</span>
                  </p>
                  {!later && <p style={{ margin: '4px 0 0', fontSize: 13, color: C.soft }}>Goes up to ${p.next} on November 1</p>}
                </div>
              ))}
            </div>
            <p className="pl-letter" style={{ margin: '18px 0 0' }}>
              {later
                ? <>Amazon at ${amazonNow} a month, Pro at ${proNow} a month.</>
                : <>Both go up on November 1, to ${NEW_MEMBER_PRICES.amazon.month} and ${NEW_MEMBER_PRICES.pro.month}. Anyone who joins before November 1 keeps the lower price for as long as they stay subscribed, so there is a real reason to move this month.</>}
            </p>
          </div>
        </article>
      </section>

      {/* ── the partnership ──────────────────────────────────────────────── */}
      <section className="pl-wrap" style={{ paddingTop: 24, paddingBottom: 72 }}>
        <div style={{ background: C.violetSoft, borderRadius: 24, padding: 'clamp(24px, 5vw, 48px)' }}>
          <p className="pl-ui" style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: C.violet, margin: 0 }}>On a partnership</p>
          <p className="pl-letter" style={{ fontSize: 'clamp(21px, 2.4vw, 25px)', lineHeight: 1.5, margin: '14px 0 0', maxWidth: '34em' }}>
            I would rather build something for your members than hand you the standard affiliate terms. A dedicated referral link, a members
            rate, and a commission arrangement that works for the community. Tell me what your people need and I will build it around that.
          </p>
          <div className="pl-ui" style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 28 }}>
            <a className="pl-btn" href={`mailto:${EMAIL}?subject=${encodeURIComponent('Partnership with MVP Affiliate')}`}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: C.ink, color: '#fff', borderRadius: 12, padding: '13px 20px', fontWeight: 700, fontSize: 15, textDecoration: 'none' }}>
              <Mail size={17} /> Email Seb
            </a>
            <a className="pl-btn" href={SITE}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: C.card, color: C.ink, border: `1px solid ${C.line}`, borderRadius: 12, padding: '13px 20px', fontWeight: 700, fontSize: 15, textDecoration: 'none' }}>
              See MVP Affiliate <ArrowRight size={17} />
            </a>
          </div>
        </div>

        {/* ── sign-off ── */}
        <div style={{ marginTop: 40 }}>
          <p className="pl-letter" style={{ fontSize: 34, fontStyle: 'italic', margin: 0 }}>Seb</p>
          <p className="pl-ui" style={{ margin: '6px 0 0', fontSize: 14, color: C.soft }}>
            <a className="pl-link" href={`mailto:${EMAIL}`} style={{ color: C.ink, fontWeight: 600 }}>{EMAIL}</a>
            {'  ·  '}
            <a className="pl-link" href={SITE} style={{ color: C.ink, fontWeight: 600 }}>mvpaffiliate.io</a>
          </p>
        </div>
      </section>
    </main>
  )
}

// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Public /affiliates recruitment landing — redesign (2026-06-17) from the
// "affiliates-landing-reference" brief: light, navy ink, blue→indigo gradient,
// the logo's checkmark as the signature device, Plus Jakarta Sans display +
// Inter body. Self-contained: all styling lives in the scoped <style> block
// below (every selector prefixed `.aff` so nothing leaks into the rest of the
// app, which is dark-themed). Only this file is a client component (the
// estimator slider + the FAQ accordion need state); the page.tsx wrapper stays
// server for metadata.
//
// TERMS ARE THE PUBLIC PROMISE — they mirror the live Rewardful campaign and
// were confirmed by the operator (2026-06-17), overriding the reference draft:
//   Commission 10% recurring (for life, while subscribed) · 60-day cookie ·
//   $50 min · monthly via Stripe after a 60-day clearance · audience gets
//   20% off their first 3 months (double-sided, promo code yUrNXwso).
// Change a number here AND in Rewardful — they must match.
'use client'

import { useState } from 'react'

const CAMPAIGN = {
  commissionPct: 10,
  audienceDiscount: '20% off their first 3 months',
  cookieDays: 60,
  payoutThreshold: 50,
  payoutMethod: 'Stripe',
  clearanceDays: 60,
  promoCode: 'yUrNXwso',
  signupUrl: process.env.NEXT_PUBLIC_AFFILIATE_SIGNUP_URL || 'https://mvp-affiliate.getrewardful.com/signup',
  loginUrl: 'https://mvp-affiliate.getrewardful.com/login',
} as const

const RATE = CAMPAIGN.commissionPct / 100
const TIERS = { Creator: 49, Studio: 99, Pro: 199 } as const
type PlanKey = keyof typeof TIERS
const money = (n: number) => '$' + Math.round(n).toLocaleString('en-US')

// Shared checkmark — the logo's signature device. `solid` = gradient tile,
// white stroke; otherwise a soft tinted circle with a blue stroke.
function Check({ solid = false, className = '' }: { solid?: boolean; className?: string }) {
  return (
    <span className={`${solid ? 'mk' : 'check'} ${className}`}>
      <svg viewBox="0 0 24 24" fill="none">
        <path d="M5 13l4 4 9-11" stroke={solid ? '#fff' : '#3C60F0'} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  )
}

function BrandMark() {
  return (
    <span className="tile">
      <svg viewBox="0 0 24 24" fill="none"><path d="M5 13l4 4 9-11" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
    </span>
  )
}

export default function AffiliatesClient() {
  return (
    <div className="aff">
      <Nav />
      <Hero />
      <Why />
      <How />
      <Deal />
      <Product />
      <Proof />
      <Faq />
      <FinalCta />
      <Footer />
      <AffStyles />
    </div>
  )
}

function Nav() {
  return (
    <nav>
      <div className="nav-in">
        <a className="logo" href="/"><BrandMark /> MVP Affiliate</a>
        <div className="nav-links">
          <a href="#why">Why promote</a>
          <a href="#how">How it works</a>
          <a href="#deal">Commission</a>
          <a href="#faq">FAQ</a>
        </div>
        <a href={CAMPAIGN.signupUrl} target="_blank" rel="noopener" className="btn btn-grad nav-cta">Become an affiliate</a>
      </div>
    </nav>
  )
}

function Hero() {
  // Earnings card amounts are honest at 10%: Pro $199→$19.90, Studio $99→$9.90.
  const rows = [
    { in: 'JM', nm: 'Jordan M.', ac: 'Upgraded to Pro', amt: '+$19.90', grad: 'linear-gradient(135deg,#3C60F0,#6A3CF0)' },
    { in: 'AK', nm: 'Aisha K.', ac: 'Studio plan', amt: '+$9.90', grad: 'linear-gradient(135deg,#6A3CF0,#9B5CF0)' },
    { in: 'TR', nm: 'Theo R.', ac: 'Upgraded to Pro', amt: '+$19.90', grad: 'linear-gradient(135deg,#2945C9,#3C60F0)' },
  ]
  return (
    <header className="hero">
      <div className="wrap hero-grid">
        <div>
          <span className="eyebrow rise"><span className="d" />MVP Affiliate · Partner Program</span>
          <h1 className="rise d1">Recommend the tool you already use. <span className="grad-text">Earn {CAMPAIGN.commissionPct}%, every month.</span></h1>
          <p className="lead rise d2">You already know who needs this — every Amazon creator drowning in manual posting. Share your link, they sign up, and you earn {CAMPAIGN.commissionPct}% recurring on every payment they make, for as long as they stay. No caps. No expiry.</p>
          <div className="hero-cta rise d2">
            <a href={CAMPAIGN.signupUrl} target="_blank" rel="noopener" className="btn btn-grad btn-lg">Apply to join →</a>
            <a href="#how" className="btn btn-ghost btn-lg">See how it works</a>
          </div>
          <div className="trust rise d3">
            <span><Check />Built by Top Platinum Amazon Influencers</span>
            <span><Check />Recurring for life</span>
            <span><Check />{CAMPAIGN.cookieDays}-day cookie</span>
          </div>
        </div>

        <div className="hero-card rise d2">
          <div className="hc-top">
            <span className="lbl">Your earnings</span>
            <span className="live"><span className="pulse" />Live</span>
          </div>
          {rows.map((r) => (
            <div className="ref-row" key={r.in}>
              <span className="av" style={{ background: r.grad }}>{r.in}</span>
              <span className="who"><span className="nm">{r.nm}</span><br /><span className="ac">{r.ac}</span></span>
              <span className="amt">{r.amt}<small>/mo</small> <Check solid /></span>
            </div>
          ))}
          <div className="hc-total">
            <span className="t-l">Recurring this month<small>+ every month they stay subscribed</small></span>
            <span className="t-v grad-text">$49.70</span>
          </div>
        </div>
      </div>
    </header>
  )
}

function Why() {
  const cards = [
    { h: `${CAMPAIGN.commissionPct}% recurring — not a one-time bounty`, p: 'Earn every single month your referral stays subscribed. One good recommendation becomes income that compounds, not a single payout you forget about.' },
    { h: 'It practically sells itself', p: "Every Amazon creator feels the pain of turning videos into blogs, posts, and pitches by hand. You're not selling — you're handing them the fix." },
    { h: 'You promote with proof', p: "Show your own results. A real before/after from your own workflow beats any ad — and it's the most convincing pitch there is." },
    { h: 'We hand you the assets', p: 'A 60-second demo clip, swipe copy, and ready-to-post social graphics. Drop in your link and go. Need something custom? Just ask.' },
  ]
  return (
    <section id="why" className="sec">
      <div className="wrap">
        <div className="sec-head">
          <div className="kicker">Why promote MVP Affiliate</div>
          <h2>The easiest thing you&apos;ll ever recommend</h2>
          <p className="sub">You&apos;re not cold-pitching a product you barely know. You use it daily, your audience has the exact problem it solves, and the commission keeps paying long after the share.</p>
        </div>
        <div className="vgrid">
          {cards.map((c) => (
            <div className="vcard" key={c.h}>
              <Check solid />
              <h3>{c.h}</h3>
              <p>{c.p}</p>
            </div>
          ))}
        </div>
        {/* Double-sided incentive — the kept 20%-off hook. */}
        <div className="dual">
          <Check solid />
          <p><b>Your audience saves too.</b> Anyone who signs up through your link — or with your promo code <code>{CAMPAIGN.promoCode}</code> — gets <b>{CAMPAIGN.audienceDiscount}</b>. The link auto-applies it at checkout; the code works anywhere a link won&apos;t fit. Same {CAMPAIGN.commissionPct}% to you either way.</p>
        </div>
      </div>
    </section>
  )
}

function How() {
  const steps = [
    { h: 'Apply & get approved', p: 'A two-minute application. We approve for fit — creators and reviewers whose audience overlaps with ours. No follower minimums.' },
    { h: 'Share your link or code', p: `Drop your link in video descriptions, posts, and your newsletter — or share your promo code ${CAMPAIGN.promoCode} for shoutouts. A ${CAMPAIGN.cookieDays}-day cookie means even slow decisions still get credited to you.` },
    { h: 'Earn every month', p: `${CAMPAIGN.commissionPct}% recurring, paid monthly via ${CAMPAIGN.payoutMethod} once you clear $${CAMPAIGN.payoutThreshold}. Watch clicks, signups, and commissions in your dashboard in real time.` },
  ]
  return (
    <section id="how" className="sec alt">
      <div className="wrap">
        <div className="sec-head center">
          <div className="kicker">How it works</div>
          <h2>Approved to earning in three steps</h2>
        </div>
        <div className="steps">
          {steps.map((s, i) => (
            <div className="step" key={s.h}>
              <span className="sn">{i + 1}</span>
              <h3>{s.h}</h3>
              <p>{s.p}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

function Deal() {
  const specs = [
    { l: 'Commission', v: <><em>{CAMPAIGN.commissionPct}%</em> recurring</> },
    { l: 'Duration', v: <>For life*</> },
    { l: 'Cookie window', v: <>{CAMPAIGN.cookieDays} days</> },
    { l: 'Payouts', v: <>Monthly</> },
    { l: 'Minimum payout', v: <>${CAMPAIGN.payoutThreshold}</> },
    { l: 'Paid via', v: <>{CAMPAIGN.payoutMethod}</> },
  ]
  return (
    <section id="deal" className="sec">
      <div className="wrap">
        <div className="deal">
          <div className="deal-grid">
            <div>
              <h2>The deal, in plain numbers</h2>
              <div className="deal-specs">
                {specs.map((s) => (
                  <div className="dspec" key={s.l}><div className="dl">{s.l}</div><div className="dv">{s.v}</div></div>
                ))}
              </div>
              <p className="deal-note">*Founding affiliates earn for the lifetime of every customer. Commission is a share of revenue — it only exists when your referrals are paying. Your audience gets {CAMPAIGN.audienceDiscount} too.</p>
            </div>
            <Estimator />
          </div>
        </div>
      </div>
    </section>
  )
}

function Estimator() {
  const [plan, setPlan] = useState<PlanKey>('Studio')
  const [n, setN] = useState(10)
  const mo = n * TIERS[plan] * RATE
  return (
    <div className="est">
      <div className="et">What could you earn?</div>
      <div className="plan-tog" role="group" aria-label="Plan">
        {(Object.keys(TIERS) as PlanKey[]).map((p) => (
          <button key={p} className={p === plan ? 'on' : ''} onClick={() => setPlan(p)} type="button">{p}</button>
        ))}
      </div>
      <div className="row-top"><label htmlFor="est-n">Active referrals</label><span className="rv">{n}</span></div>
      <input
        id="est-n" type="range" min={1} max={50} step={1} value={n}
        onChange={(e) => setN(+e.target.value)}
        aria-valuetext={`${n} referrals on the ${plan} plan`}
      />
      <div className="est-out">
        <div className="eo-v">{money(mo)}<small>/mo</small></div>
        <div className="eo-y">recurring per year<b>{money(mo * 12)}</b></div>
      </div>
    </div>
  )
}

function Product() {
  const feats = [
    <><b>The agent pipeline</b> turns a video into a full blog post, social fan-out, thumbnails, and brand-pitch emails — automatically.</>,
    <><b>YouTube autopilot</b> watches a channel and drafts content the moment a new video lands.</>,
    <>A <b>branded review site</b> for every creator — their content, their domain, their links.</>,
    <>Free to start — <b>5 reviews on the house</b>, no card. That&apos;s an easy first click for your audience.</>,
  ]
  return (
    <section className="sec alt">
      <div className="wrap prod-grid">
        <div>
          <div className="kicker">What you&apos;re promoting</div>
          <h2 style={{ marginBottom: 18 }}>One YouTube video in. A week of content out.</h2>
          <ul className="feat-list">
            {feats.map((f, i) => <li key={i}><Check /><span>{f}</span></li>)}
          </ul>
        </div>
        <div className="prod-mock">
          <div className="bar"><i /><span>mvpaffiliate.io · pipeline</span></div>
          <div className="flow">
            <span className="pill src">▶ YouTube video</span>
            <span className="arr">→</span>
            <span className="pill">Blog post</span>
            <span className="pill">Social posts</span>
            <span className="pill">Thumbnails</span>
            <span className="pill">Brand pitch</span>
          </div>
        </div>
      </div>
    </section>
  )
}

function Proof() {
  return (
    <section className="sec">
      <div className="wrap">
        <div className="quote">
          <div className="qm">“</div>
          <p>We built this to run our own storefront — top 1% conversion, Top Platinum status. Now we&apos;re paying creators to grow it with us.</p>
          <div className="by"><b>Seb &amp; Michelle</b> · Founders, MVP Affiliate</div>
          <div className="badges">
            <span className="badge"><Check />Real-time dashboard</span>
            <span className="badge"><Check />Tracking via Rewardful</span>
            <span className="badge"><Check />No follower minimums</span>
          </div>
        </div>
      </div>
    </section>
  )
}

function Faq() {
  const items = [
    { q: 'How much can I realistically earn?', a: `It depends on your audience and plan mix. At ${CAMPAIGN.commissionPct}% recurring: every Creator referral is about $${(49 * RATE).toFixed(2)}/mo, Studio about $${(99 * RATE).toFixed(2)}/mo, and Pro about $${(199 * RATE).toFixed(2)}/mo — for as long as they stay. Use the estimator above to model your own numbers.` },
    { q: 'When and how do I get paid?', a: `Monthly, via ${CAMPAIGN.payoutMethod}, once your balance clears $${CAMPAIGN.payoutThreshold} and the commission passes a ${CAMPAIGN.clearanceDays}-day refund-protection window. You connect your payout account once during onboarding and commissions land automatically after that.` },
    { q: 'Does my audience get anything?', a: `Yes — it's a double-sided deal. Anyone who signs up through your link, or uses your promo code ${CAMPAIGN.promoCode}, gets ${CAMPAIGN.audienceDiscount}. The link applies it automatically; the code works anywhere a link doesn't fit.` },
    { q: 'How long does the referral cookie last?', a: `${CAMPAIGN.cookieDays} days. If someone clicks your link and signs up any time in that window, the referral is credited to you — so slow decisions still earn.` },
    { q: 'Do commissions really last for the life of the customer?', a: 'Founding affiliates earn for as long as their referral stays subscribed. You keep earning month after month with zero extra work; the stream stops only if they cancel.' },
    { q: 'Can I run paid ads to my link?', a: 'Yes — content, email, social, and paid traffic are all welcome. The one rule: no bidding on our brand terms (e.g. "MVP Affiliate") in paid search. Everything else is fair game.' },
    { q: 'Who is this program for?', a: "Creators, reviewers, and newsletter operators whose audience includes Amazon influencers and content creators. If the people who follow you would benefit from automating their content, you're a fit — reach matters less than relevance." },
  ]
  const [open, setOpen] = useState<number | null>(0)
  return (
    <section id="faq" className="sec alt">
      <div className="wrap">
        <div className="sec-head center">
          <div className="kicker">FAQ</div>
          <h2>The details, sorted</h2>
        </div>
        <div className="faq">
          {items.map((it, i) => (
            <div className={`qa ${open === i ? 'open' : ''}`} key={it.q}>
              <button type="button" aria-expanded={open === i} onClick={() => setOpen(open === i ? null : i)}>
                {it.q}
                <svg className="ic" viewBox="0 0 24 24" fill="none"><path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" /></svg>
              </button>
              <div className="a"><div className="a-in">{it.a}</div></div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

function FinalCta() {
  return (
    <section id="apply" className="sec">
      <div className="wrap">
        <div className="final">
          <h2>Ready to earn on every creator you bring?</h2>
          <p>Apply in two minutes. Free to join, approved for fit.</p>
          <a href={CAMPAIGN.signupUrl} target="_blank" rel="noopener" className="btn btn-white btn-lg">Become an affiliate →</a>
          <div className="fine">No cost · No follower minimum · {CAMPAIGN.commissionPct}% recurring · {CAMPAIGN.cookieDays}-day cookie</div>
        </div>
      </div>
    </section>
  )
}

function Footer() {
  return (
    <footer>
      <div className="wrap foot-in">
        <a className="logo" href="/"><BrandMark /> MVP Affiliate</a>
        <div className="fl">
          <a href="#why">Why promote</a>
          <a href="#how">How it works</a>
          <a href="#deal">Commission</a>
          <a href="#faq">FAQ</a>
          <a href={CAMPAIGN.loginUrl} target="_blank" rel="noopener">Affiliate login</a>
          <a href="/terms">Terms</a>
        </div>
        <div className="copy">© {new Date().getFullYear()} Gominplanet Holdings Ltd</div>
      </div>
    </footer>
  )
}

// All styling scoped under `.aff` so it never touches the dark-themed app.
function AffStyles() {
  return (
    <style>{`
.aff{
  --ink:#0C1A33; --body:#49526A; --muted:#79839B;
  --bg:#FFFFFF; --soft:#F6F8FD; --tint:#EEF2FE; --tint-2:#E7ECFE; --border:#E6EAF3;
  --blue:#3C60F0; --indigo:#6A3CF0; --blue-deep:#2945C9;
  --grad:linear-gradient(118deg,#3C60F0 0%,#6A3CF0 100%);
  --maxw:1080px; --r:16px; --r-sm:11px;
  --sh-sm:0 1px 3px rgba(12,26,51,.06),0 1px 2px rgba(12,26,51,.04);
  --sh-card:0 24px 60px -28px rgba(60,96,240,.40),0 8px 24px -16px rgba(12,26,51,.18);
  background:var(--bg); color:var(--body);
  font-family:var(--font-jakarta),var(--font-sans),-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
  line-height:1.62; -webkit-font-smoothing:antialiased;
}
.aff *{box-sizing:border-box}
.aff h1,.aff h2,.aff h3{font-family:var(--font-jakarta),sans-serif;color:var(--ink);line-height:1.12;letter-spacing:-.02em;margin:0}
.aff p{font-family:var(--font-sans),sans-serif}
.aff a{color:var(--blue);text-decoration:none}
.aff section{scroll-margin-top:80px}
.aff .wrap{max-width:var(--maxw);margin:0 auto;padding:0 24px}
.aff .grad-text{background:var(--grad);-webkit-background-clip:text;background-clip:text;color:transparent}
.aff .mk{width:36px;height:36px;border-radius:10px;background:var(--grad);display:grid;place-items:center;flex:none}
.aff .mk svg{width:20px;height:20px}
.aff .check{width:22px;height:22px;border-radius:50%;background:var(--tint);display:grid;place-items:center;flex:none}
.aff .check svg{width:13px;height:13px}
.aff .btn{display:inline-flex;align-items:center;gap:8px;font-family:var(--font-jakarta),sans-serif;font-weight:700;font-size:15px;padding:13px 22px;border-radius:11px;cursor:pointer;border:1px solid transparent;transition:.18s}
.aff .btn-grad{background:var(--grad);color:#fff;box-shadow:0 8px 20px -8px rgba(60,96,240,.6)}
.aff .btn-grad:hover{transform:translateY(-1px);box-shadow:0 12px 26px -8px rgba(60,96,240,.7)}
.aff .btn-ghost{background:#fff;color:var(--ink);border-color:var(--border)}
.aff .btn-ghost:hover{border-color:var(--blue);color:var(--blue)}
.aff .btn-lg{font-size:16px;padding:15px 28px}
.aff nav{position:sticky;top:0;z-index:50;background:rgba(255,255,255,.86);backdrop-filter:blur(12px);border-bottom:1px solid var(--border)}
.aff .nav-in{max-width:var(--maxw);margin:0 auto;padding:13px 24px;display:flex;align-items:center;gap:20px}
.aff .logo{display:flex;align-items:center;gap:10px;font-family:var(--font-jakarta),sans-serif;font-weight:800;color:var(--ink);font-size:17px;letter-spacing:-.02em}
.aff .logo .tile{width:30px;height:30px;border-radius:9px;background:var(--grad);display:grid;place-items:center}
.aff .logo .tile svg{width:17px;height:17px}
.aff .nav-links{display:flex;gap:6px;margin-left:auto}
.aff .nav-links a{color:var(--body);font-size:14px;font-weight:500;padding:7px 12px;border-radius:9px}
.aff .nav-links a:hover{color:var(--ink);background:var(--soft)}
.aff .nav-cta{margin-left:6px}
.aff header.hero{padding:64px 0 56px;position:relative;overflow:hidden}
.aff header.hero::before{content:"";position:absolute;width:720px;height:560px;right:-160px;top:-180px;background:radial-gradient(closest-side,rgba(106,60,240,.10),transparent 70%);pointer-events:none}
.aff .hero-grid{display:grid;grid-template-columns:1.05fr .95fr;gap:48px;align-items:center}
.aff .eyebrow{display:inline-flex;align-items:center;gap:8px;font-family:var(--font-jakarta),sans-serif;font-weight:700;font-size:12.5px;letter-spacing:.06em;text-transform:uppercase;color:var(--blue);background:var(--tint);border:1px solid var(--tint-2);padding:6px 12px;border-radius:999px;margin-bottom:22px}
.aff .eyebrow .d{width:6px;height:6px;border-radius:50%;background:var(--grad)}
.aff .hero h1{font-size:clamp(36px,5.4vw,56px);font-weight:800;margin-bottom:20px}
.aff .hero p.lead{font-size:clamp(16px,2vw,19px);color:var(--body);max-width:52ch;margin:0 0 28px}
.aff .hero-cta{display:flex;gap:12px;flex-wrap:wrap;margin-bottom:22px}
.aff .trust{display:flex;flex-wrap:wrap;gap:8px 18px;font-size:13px;color:var(--muted)}
.aff .trust span{display:flex;align-items:center;gap:7px}
.aff .trust .check{width:18px;height:18px}
.aff .hero-card{background:#fff;border:1px solid var(--border);border-radius:18px;box-shadow:var(--sh-card);padding:22px;position:relative}
.aff .hc-top{display:flex;justify-content:space-between;align-items:center;margin-bottom:18px}
.aff .hc-top .lbl{font-family:var(--font-jakarta),sans-serif;font-weight:700;font-size:13px;color:var(--ink)}
.aff .live{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--muted)}
.aff .live .pulse{width:8px;height:8px;border-radius:50%;background:#22C55E;box-shadow:0 0 0 0 rgba(34,197,94,.5);animation:affpulse 2s infinite}
@keyframes affpulse{70%{box-shadow:0 0 0 7px rgba(34,197,94,0)}100%{box-shadow:0 0 0 0 rgba(34,197,94,0)}}
.aff .ref-row{display:flex;align-items:center;gap:12px;padding:11px 0;border-top:1px solid var(--soft)}
.aff .ref-row:first-of-type{border-top:none}
.aff .av{width:34px;height:34px;border-radius:50%;display:grid;place-items:center;font-family:var(--font-jakarta),sans-serif;font-weight:700;font-size:13px;color:#fff;flex:none}
.aff .ref-row .who{flex:1;min-width:0}
.aff .ref-row .nm{font-weight:600;color:var(--ink);font-size:14px}
.aff .ref-row .ac{font-size:12.5px;color:var(--muted)}
.aff .ref-row .amt{font-family:var(--font-jakarta),sans-serif;font-weight:700;font-size:14px;color:var(--ink);display:flex;align-items:center;gap:7px;white-space:nowrap}
.aff .ref-row .amt small{color:var(--muted);font-weight:500}
.aff .ref-row .amt .mk{width:20px;height:20px;border-radius:6px}
.aff .ref-row .amt .mk svg{width:12px;height:12px}
.aff .hc-total{margin-top:16px;padding-top:16px;border-top:1px dashed var(--border);display:flex;justify-content:space-between;align-items:flex-end}
.aff .hc-total .t-l{font-size:13px;color:var(--muted)}
.aff .hc-total .t-l small{display:block;font-size:11.5px;margin-top:2px}
.aff .hc-total .t-v{font-family:var(--font-jakarta),sans-serif;font-weight:800;font-size:30px}
.aff .sec{padding:62px 0}
.aff .sec.alt{background:var(--soft);border-top:1px solid var(--border);border-bottom:1px solid var(--border)}
.aff .sec-head{max-width:640px;margin-bottom:38px}
.aff .sec-head.center{margin:0 auto 42px;text-align:center}
.aff .kicker{font-family:var(--font-jakarta),sans-serif;font-weight:700;font-size:12.5px;letter-spacing:.08em;text-transform:uppercase;color:var(--blue);margin-bottom:12px}
.aff .sec h2{font-size:clamp(26px,3.4vw,38px);font-weight:800;margin-bottom:14px}
.aff .sec .sub{font-size:16.5px;color:var(--body)}
.aff .vgrid{display:grid;grid-template-columns:repeat(2,1fr);gap:18px}
.aff .vcard{background:#fff;border:1px solid var(--border);border-radius:var(--r);padding:24px;box-shadow:var(--sh-sm)}
.aff .vcard .mk{margin-bottom:16px}
.aff .vcard h3{font-size:18px;font-weight:700;margin-bottom:8px}
.aff .vcard p{margin:0;font-size:14.5px;color:var(--body)}
.aff .dual{margin-top:18px;display:flex;gap:14px;align-items:flex-start;background:var(--tint);border:1px solid var(--tint-2);border-radius:var(--r);padding:20px 22px}
.aff .dual p{margin:0;font-size:14.5px;color:var(--body)}
.aff .dual b{color:var(--ink);font-weight:700}
.aff .dual code{font-family:var(--font-mono),monospace;font-size:13px;background:#fff;border:1px solid var(--tint-2);border-radius:6px;padding:1px 7px;color:var(--blue-deep);font-weight:600}
.aff .steps{display:grid;grid-template-columns:repeat(3,1fr);gap:20px}
.aff .step{position:relative;padding-top:8px}
.aff .step .sn{font-family:var(--font-jakarta),sans-serif;font-weight:800;font-size:15px;color:#fff;width:36px;height:36px;border-radius:10px;background:var(--grad);display:grid;place-items:center;margin-bottom:16px}
.aff .step h3{font-size:18px;font-weight:700;margin-bottom:8px}
.aff .step p{margin:0;font-size:14.5px;color:var(--body)}
.aff .deal{background:var(--ink);border-radius:20px;padding:40px;color:#fff;position:relative;overflow:hidden}
.aff .deal::after{content:"";position:absolute;width:520px;height:520px;right:-180px;bottom:-220px;background:radial-gradient(closest-side,rgba(106,60,240,.45),transparent 70%)}
.aff .deal-grid{display:grid;grid-template-columns:1.1fr 1fr;gap:40px;align-items:center;position:relative;z-index:1}
.aff .deal h2{color:#fff;font-size:clamp(24px,3vw,32px);margin-bottom:22px}
.aff .deal-note{color:#9DB0D8;font-size:12.5px;margin:22px 0 0}
.aff .deal-specs{display:grid;grid-template-columns:1fr 1fr;gap:18px 28px}
.aff .dspec .dl{font-size:12px;color:#9DB0D8;text-transform:uppercase;letter-spacing:.06em;font-weight:600;margin-bottom:4px;font-family:var(--font-jakarta),sans-serif}
.aff .dspec .dv{font-family:var(--font-jakarta),sans-serif;font-weight:800;font-size:22px;color:#fff}
.aff .dspec .dv em{font-style:normal;background:linear-gradient(118deg,#7FA0FF,#B79DFF);-webkit-background-clip:text;background-clip:text;color:transparent}
.aff .est{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.14);border-radius:var(--r);padding:22px;backdrop-filter:blur(4px)}
.aff .est .et{font-family:var(--font-jakarta),sans-serif;font-weight:700;font-size:14px;color:#fff;margin-bottom:16px}
.aff .plan-tog{display:flex;gap:6px;background:rgba(0,0,0,.22);border-radius:10px;padding:4px;margin-bottom:18px}
.aff .plan-tog button{flex:1;background:none;border:none;color:#AFBEE0;font-family:var(--font-jakarta),sans-serif;font-weight:700;font-size:13px;padding:8px;border-radius:7px;cursor:pointer}
.aff .plan-tog button.on{background:var(--grad);color:#fff}
.aff .est .row-top{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:8px}
.aff .est .row-top label{font-size:13px;color:#C7D3EC}
.aff .est .row-top .rv{font-family:var(--font-jakarta),sans-serif;font-weight:700;color:#fff;font-size:14px}
.aff .est input[type=range]{-webkit-appearance:none;appearance:none;width:100%;height:5px;border-radius:99px;background:rgba(255,255,255,.18);outline:none;cursor:pointer}
.aff .est input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:18px;height:18px;border-radius:50%;background:#fff;border:4px solid var(--indigo);cursor:pointer}
.aff .est input[type=range]::-moz-range-thumb{width:14px;height:14px;border-radius:50%;background:#fff;border:4px solid var(--indigo);cursor:pointer}
.aff .est input[type=range]:focus-visible{box-shadow:0 0 0 3px rgba(127,160,255,.5)}
.aff .est-out{margin-top:20px;display:flex;align-items:flex-end;justify-content:space-between;gap:12px}
.aff .est-out .eo-v{font-family:var(--font-jakarta),sans-serif;font-weight:800;font-size:34px;color:#fff;line-height:1}
.aff .est-out .eo-v small{font-size:14px;color:#AFBEE0;font-weight:600}
.aff .est-out .eo-y{text-align:right;font-size:12.5px;color:#9DB0D8}
.aff .est-out .eo-y b{display:block;font-family:var(--font-jakarta),sans-serif;font-weight:700;font-size:17px;color:#fff}
.aff .prod-grid{display:grid;grid-template-columns:1fr 1fr;gap:44px;align-items:center}
.aff .feat-list{list-style:none;margin:0;padding:0;display:grid;gap:14px}
.aff .feat-list li{display:flex;gap:12px;align-items:flex-start;font-size:15px;color:var(--body)}
.aff .feat-list li b{color:var(--ink);font-weight:600}
.aff .prod-mock{background:var(--soft);border:1px solid var(--border);border-radius:var(--r);padding:8px}
.aff .prod-mock .bar{height:auto;background:#fff;border:1px solid var(--border);border-radius:7px;margin:8px;display:flex;align-items:center;padding:6px 8px;gap:6px}
.aff .prod-mock .bar i{width:7px;height:7px;border-radius:50%;background:var(--grad);flex:none}
.aff .prod-mock .bar span{font-size:11px;color:var(--muted)}
.aff .flow{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:14px;justify-content:center}
.aff .pill{background:#fff;border:1px solid var(--border);border-radius:9px;padding:8px 12px;font-size:12.5px;font-weight:600;color:var(--ink);display:flex;gap:7px;align-items:center}
.aff .pill.src{background:var(--grad);color:#fff;border:none}
.aff .arr{color:var(--muted);font-weight:700}
.aff .quote{max-width:760px;margin:0 auto;text-align:center}
.aff .quote .qm{font-family:var(--font-jakarta),sans-serif;font-weight:800;font-size:48px;line-height:1;background:var(--grad);-webkit-background-clip:text;background-clip:text;color:transparent}
.aff .quote p{font-family:var(--font-jakarta),sans-serif;font-weight:600;font-size:clamp(19px,2.6vw,26px);color:var(--ink);line-height:1.4;margin:10px 0 22px;letter-spacing:-.01em}
.aff .quote .by{font-size:14.5px;color:var(--muted)}
.aff .quote .by b{color:var(--ink)}
.aff .badges{display:flex;justify-content:center;flex-wrap:wrap;gap:10px;margin-top:22px}
.aff .badge{font-size:12.5px;color:var(--body);background:#fff;border:1px solid var(--border);border-radius:999px;padding:7px 14px;display:flex;align-items:center;gap:7px}
.aff .badge .check{width:18px;height:18px}
.aff .faq{max-width:760px;margin:0 auto}
.aff .qa{border:1px solid var(--border);border-radius:var(--r-sm);background:#fff;margin-bottom:10px;overflow:hidden}
.aff .qa button{width:100%;text-align:left;background:none;border:none;padding:18px 20px;font-family:var(--font-jakarta),sans-serif;font-weight:700;font-size:15.5px;color:var(--ink);cursor:pointer;display:flex;justify-content:space-between;align-items:center;gap:16px}
.aff .qa .ic{flex:none;width:22px;height:22px;color:var(--blue);transition:transform .22s}
.aff .qa.open .ic{transform:rotate(45deg)}
.aff .qa .a{max-height:0;overflow:hidden;transition:max-height .26s ease}
.aff .qa .a-in{padding:0 20px 18px;font-size:14.5px;color:var(--body)}
.aff .qa.open .a{max-height:320px}
.aff .final{background:var(--grad);border-radius:22px;padding:52px 40px;text-align:center;color:#fff;position:relative;overflow:hidden}
.aff .final h2{color:#fff;font-size:clamp(26px,3.4vw,38px);margin-bottom:12px}
.aff .final p{color:rgba(255,255,255,.92);font-size:17px;margin:0 0 26px}
.aff .final .btn-white{background:#fff;color:var(--blue-deep)}
.aff .final .btn-white:hover{transform:translateY(-1px)}
.aff .final .fine{margin-top:16px;font-size:13px;color:rgba(255,255,255,.85)}
.aff footer{padding:40px 0 56px;border-top:1px solid var(--border)}
.aff .foot-in{display:flex;justify-content:space-between;flex-wrap:wrap;gap:16px;align-items:center}
.aff .foot-in .fl{display:flex;gap:18px;font-size:13.5px;flex-wrap:wrap}
.aff .foot-in .fl a{color:var(--body)}
.aff .foot-in .fl a:hover{color:var(--ink)}
.aff .copy{font-size:12.5px;color:var(--muted)}
.aff .rise{opacity:0;transform:translateY(16px);animation:affrise .7s cubic-bezier(.2,.7,.2,1) forwards}
.aff .d1{animation-delay:.06s}.aff .d2{animation-delay:.14s}.aff .d3{animation-delay:.22s}
@keyframes affrise{to{opacity:1;transform:none}}
@media(max-width:880px){
  .aff .hero-grid,.aff .deal-grid,.aff .prod-grid{grid-template-columns:1fr;gap:32px}
  .aff .vgrid,.aff .steps,.aff .deal-specs{grid-template-columns:1fr}
  .aff .deal-specs{gap:18px}
  .aff .nav-links{display:none}
  .aff .deal{padding:30px}
}
@media(prefers-reduced-motion:reduce){.aff *{animation:none!important;transition:none!important}.aff .rise{opacity:1;transform:none}}
`}</style>
  )
}

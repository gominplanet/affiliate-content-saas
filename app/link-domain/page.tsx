// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// The front door of the short-link domain.
//
// Typing mvpl.ink on its own used to 302 straight to the main site. A domain
// whose root is itself a redirect, serving nothing but redirects underneath, is
// one of the things spam filters and domain reputation services look for: there
// is no page anywhere on it, so there is nothing to assess except the fact that
// everything bounces. Pinterest already refuses links on it for exactly that
// family of reason.
//
// So the root serves a real page that answers the three questions a reviewer,
// a filter, or a suspicious visitor actually has: what is this domain, who runs
// it, and how do I reach them. That is a small page, and it is the difference
// between a domain that looks operated and one that looks disposable.
//
// Rendered on the server with no JavaScript and no redirect of any kind, since
// a meta refresh or a scripted bounce here would recreate the exact signal this
// page exists to remove.

import type { Metadata } from 'next'

export const dynamic = 'force-static'

const APP = process.env.NEXT_PUBLIC_APP_URL || 'https://www.mvpaffiliate.io'

export const metadata: Metadata = {
  title: 'mvpl.ink — short links by MVP Affiliate',
  description:
    'mvpl.ink is the link shortener operated by MVP Affiliate. Links on this domain are created by creators using MVP Affiliate and send visitors to the retailer for the product being recommended.',
  robots: { index: true, follow: true },
  alternates: { canonical: 'https://www.mvpl.ink/' },
}

export default function LinkDomainRootPage() {
  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '48px 24px',
        background: '#0b0b0f',
        color: '#f5f5f7',
        fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
      }}
    >
      <div style={{ maxWidth: 640, width: '100%' }}>
        <p style={{ fontSize: 13, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#8e8e93', margin: 0 }}>
          MVP Affiliate
        </p>
        <h1 style={{ fontSize: 34, lineHeight: 1.2, margin: '10px 0 18px', fontWeight: 700 }}>
          mvpl.ink is a short link service for creators
        </h1>

        <p style={{ fontSize: 16, lineHeight: 1.65, color: '#d1d1d6', margin: '0 0 16px' }}>
          Creators who publish product reviews use MVP Affiliate to make and manage their
          links. A link on this domain was created by one of them, and sends you to the
          retailer selling the product they were talking about, in your own country where
          that product is available.
        </p>

        <p style={{ fontSize: 16, lineHeight: 1.65, color: '#d1d1d6', margin: '0 0 16px' }}>
          Those creators earn a commission when someone buys through their link, at no
          extra cost to you. That is what the disclosure on their post or video refers to.
        </p>

        <p style={{ fontSize: 16, lineHeight: 1.65, color: '#d1d1d6', margin: '0 0 28px' }}>
          There is nothing to see at this address on its own. A link here always has a
          short code after the slash.
        </p>

        <div style={{ borderTop: '1px solid #2c2c2e', paddingTop: 22 }}>
          <h2 style={{ fontSize: 15, margin: '0 0 10px', fontWeight: 600 }}>Who operates this domain</h2>
          <p style={{ fontSize: 15, lineHeight: 1.65, color: '#d1d1d6', margin: '0 0 8px' }}>
            MVP Affiliate, by Gominplanet.
          </p>
          <p style={{ fontSize: 15, lineHeight: 1.65, color: '#d1d1d6', margin: 0 }}>
            <a href={APP} style={{ color: '#7c9cff' }}>{APP.replace(/^https?:\/\//, '')}</a>
            {' · '}
            <a href="mailto:support@mvpaffiliate.io" style={{ color: '#7c9cff' }}>support@mvpaffiliate.io</a>
          </p>
        </div>

        {/* Named plainly, because a reviewer looking at a shortener wants to know
            whether anyone is policing it. Saying so is free and true. */}
        <div style={{ borderTop: '1px solid #2c2c2e', paddingTop: 22, marginTop: 22 }}>
          <h2 style={{ fontSize: 15, margin: '0 0 10px', fontWeight: 600 }}>Reporting a link</h2>
          <p style={{ fontSize: 15, lineHeight: 1.65, color: '#d1d1d6', margin: 0 }}>
            Links here point only to retail product pages, and every one is tied to the
            creator who made it. If you find one that does not, send it to{' '}
            <a href="mailto:abuse@mvpaffiliate.io" style={{ color: '#7c9cff' }}>abuse@mvpaffiliate.io</a>{' '}
            and it will be switched off.
          </p>
        </div>
      </div>
    </main>
  )
}

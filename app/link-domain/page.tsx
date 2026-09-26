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
import LinkDomainShell, { ld } from '@/components/link-domain/LinkDomainShell'

export const dynamic = 'force-static'


export const metadata: Metadata = {
  title: 'mvpl.ink, short links by MVP Affiliate',
  description:
    'mvpl.ink is the link shortener operated by MVP Affiliate. Links on this domain are created by creators using MVP Affiliate and send visitors to the retailer for the product being recommended.',
  robots: { index: true, follow: true },
  alternates: { canonical: 'https://www.mvpl.ink/' },
}

export default function LinkDomainRootPage() {
  return (
    <LinkDomainShell title="mvpl.ink is a short link service for creators">
      <p style={ld.p}>
        Creators who publish product reviews use MVP Affiliate to make and manage their
        links. A link on this domain was created by one of them, and sends you to the
        retailer selling the product they were talking about, in your own country where
        that product is available.
      </p>
      <p style={ld.p}>
        Those creators earn a commission when someone buys through their link, at no
        extra cost to you. That is what the disclosure on their post or video refers to.
      </p>
      <p style={{ ...ld.p, margin: 0 }}>
        There is nothing to see at this address on its own. A link here always has a
        short code after the slash.
      </p>

      <section style={ld.section}>
        <h2 style={ld.h2}>See where a link goes first</h2>
        <p style={{ ...ld.p, margin: 0 }}>
          Add a plus sign to the end of any link, like <strong>mvpl.ink/abc123+</strong>, to see the store and the
          product it goes to without going there.
        </p>
      </section>

      <section style={ld.section}>
        <h2 style={ld.h2}>Who operates this domain</h2>
        <p style={{ ...ld.p, margin: 0 }}>
          MVP Affiliate, by Gominplanet. Reach us at{' '}
          <a href="mailto:support@mvpaffiliate.io" style={ld.a}>support@mvpaffiliate.io</a>.
        </p>
      </section>

      {/* Named plainly, because a reviewer looking at a shortener wants to know
          whether anyone is policing it. The policy and the form are the proof. */}
      <section style={ld.section}>
        <h2 style={ld.h2}>Reporting a link</h2>
        <p style={{ ...ld.p, margin: 0 }}>
          Links here point only to retail product pages, and every one is tied to the
          creator who made it. The <a href="/link-policy" style={ld.a}>link policy</a> says what is allowed. If you
          find a link that breaks it, <a href="/report-a-link" style={ld.a}>report it</a> and it will be switched off.
        </p>
      </section>
    </LinkDomainShell>
  )
}

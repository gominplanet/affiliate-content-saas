// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// mvpl.ink/link-policy — the published rules for links on the short domain.
//
// A shortener with no written rules is, to a spam filter, a shortener anyone
// can use for anything. This page is the rule book a Pinterest reviewer reads
// when deciding whether the domain is policed: who can make a link, where a
// link may go, how a visitor sees the destination first, and what happens to
// a link that breaks the rules. Everything it says is what the code does:
//   - only signed in MVP Affiliate creators on a paid plan can make a link
//     (canUsePassport), with burst limits per account (lib/passport-abuse)
//   - the redirect is a server 302 with no page in between and no cookie
//     (app/go/[code]/route.ts)
//   - the click log keeps country, device and source, never an IP or a name
//   - private addresses, loops back to MVP and credential tricks are refused
//     (isSafePassportDestination)
//   - a reported link can be switched off on its own (migration 319, and the
//     admin Link reports screen)

import type { Metadata } from 'next'
import LinkDomainShell, { ld } from '@/components/link-domain/LinkDomainShell'

export const dynamic = 'force-static'

export const metadata: Metadata = {
  title: 'Link policy for mvpl.ink',
  description: 'What links on mvpl.ink may point to, how to see where a link goes before you click it, and how to report one that breaks the rules.',
  robots: { index: true, follow: true },
  alternates: { canonical: 'https://www.mvpl.ink/link-policy' },
}

export default function LinkPolicyPage() {
  return (
    <LinkDomainShell eyebrow="mvpl.ink" title="Link policy">
      <p style={ld.p}>
        mvpl.ink is the short link domain of MVP Affiliate. Creators who review products use it so one link sends each
        viewer to the right store for their country. These are the rules every link on this domain follows.
      </p>

      <section style={ld.section}>
        <h2 style={ld.h2}>Who can make a link</h2>
        <p style={{ ...ld.p, margin: 0 }}>
          Only creators with a paid MVP Affiliate account, signed in, can make links here. There is no public form to
          shorten a link, and every link is tied to the account that made it. Each account has a limit on how many links it
          can make in an hour and in a day, set far above what a real creator needs, so a flood of links stops at one account.
        </p>
      </section>

      <section style={ld.section}>
        <h2 style={ld.h2}>Where a link may go</h2>
        <ul style={{ margin: '0 0 0 18px', padding: 0 }}>
          <li style={ld.li}>A product page on Amazon, in the visitor&apos;s own country where the product is sold there.</li>
          <li style={ld.li}>A product page on another retailer or a brand&apos;s own store, chosen by the creator.</li>
        </ul>
        <p style={{ ...ld.p, margin: '10px 0 0' }}>
          Not allowed: links to anything other than the product being recommended, downloads, adult content, gambling, scams,
          phishing, malware, or pages that hide what they are. Links to private network addresses, links that loop back to
          MVP Affiliate, and addresses with hidden login details in them are refused when the link is made.
        </p>
      </section>

      <section style={ld.section}>
        <h2 style={ld.h2}>See where a link goes before you click it</h2>
        <p style={{ ...ld.p, margin: 0 }}>
          Add a plus sign to the end of any link: <strong>mvpl.ink/abc123+</strong> shows the store and the product the
          link goes to, without going there. From that page you can continue to the store or report the link.
        </p>
      </section>

      <section style={ld.section}>
        <h2 style={ld.h2}>How a link behaves</h2>
        <ul style={{ margin: '0 0 0 18px', padding: 0 }}>
          <li style={ld.li}>It sends you straight to the store in one step. There is no page in between, no pop up and no script.</li>
          <li style={ld.li}>It sets no cookie.</li>
          <li style={ld.li}>
            For the creator&apos;s own stats it notes the country, the type of device and where the click came from. It does
            not record your IP address or anything that names you.
          </li>
          <li style={ld.li}>
            The creator may earn a commission if you buy, at no extra cost to you. Their post or video carries the disclosure.
          </li>
        </ul>
      </section>

      <section style={ld.section}>
        <h2 style={ld.h2}>When a link breaks these rules</h2>
        <p style={{ ...ld.p, margin: 0 }}>
          Anyone can <a href="/report-a-link" style={ld.a}>report a link</a>, no account needed. Every report is reviewed. A
          link that breaks these rules is switched off on its own, without affecting anyone else&apos;s links, and an account
          that keeps breaking them has all of its links switched off. A switched off link no longer goes to the store.
        </p>
      </section>
    </LinkDomainShell>
  )
}

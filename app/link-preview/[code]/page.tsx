// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// mvpl.ink/CODE+ — where a link goes, without going there.
//
// The same convention bit.ly uses. Pinterest's rule for redirects is "no
// surprises": a person should be able to know where a link takes them. This
// page is that answer for every link on the domain, reachable by anyone,
// including a reviewer checking whether the domain hides its destinations.
//
// It reads the stored link and says plainly what it is: live and going to a
// named store, switched off, or not a link at all. Nothing redirects from
// here; continuing is a normal link the visitor chooses to press.

import type { Metadata } from 'next'
import { createAdminClient } from '@/lib/supabase/admin'
import { passportLinkUrl } from '@/lib/passport-links'
import { linkIsLive } from '@/lib/passport-abuse'
import { describeLinkTarget } from '@/lib/link-trust'
import LinkDomainShell, { ld } from '@/components/link-domain/LinkDomainShell'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Where this mvpl.ink link goes',
  // A preview per code is not something a search engine should list.
  robots: { index: false, follow: false },
}

export default async function LinkPreviewPage({ params }: { params: Promise<{ code: string }> }) {
  const { code: raw } = await params
  const code = /^[A-Za-z0-9]{4,16}$/.test(raw || '') ? raw : null

  let link: { asin?: string | null; destination_url?: string | null; label?: string | null; disabled?: boolean | null } | null = null
  let lookupFailed = false
  if (code) {
    try {
      // select('*'): an unknown column in a named list fails the whole read.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (createAdminClient() as any).from('passport_links').select('*').eq('code', code).maybeSingle()
      if (error) lookupFailed = true
      link = data ?? null
    } catch { lookupFailed = true }
  }

  const shown = code ? `mvpl.ink/${code}` : 'This address'

  if (lookupFailed) {
    return (
      <LinkDomainShell eyebrow="Link preview" title={shown}>
        <p style={ld.p}>The link could not be looked up just now, so this page cannot say where it goes. Please try again in a minute.</p>
      </LinkDomainShell>
    )
  }

  if (!code || !link || (!link.asin && !link.destination_url)) {
    return (
      <LinkDomainShell eyebrow="Link preview" title={shown}>
        <p style={ld.p}>
          There is no link with this code on mvpl.ink. Check that it was copied in full. A link here is a short code after the
          slash, like mvpl.ink/abc123.
        </p>
      </LinkDomainShell>
    )
  }

  const target = describeLinkTarget(link)
  const live = linkIsLive(link)

  return (
    <LinkDomainShell eyebrow="Link preview" title={shown}>
      {!live ? (
        <div role="status" style={{ border: '1px solid #ff9f0a', background: 'rgba(255,159,10,0.08)', borderRadius: 10, padding: '14px 16px', marginBottom: 18 }}>
          <p style={{ ...ld.p, margin: 0, color: '#f5f5f7' }}>
            <strong>This link has been switched off.</strong> It no longer goes to the store. Opening it takes you to the MVP
            Affiliate home page instead.
          </p>
        </div>
      ) : null}

      <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '10px 18px', fontSize: 15 }}>
        <dt style={{ color: '#8e8e93' }}>Goes to</dt>
        <dd style={{ margin: 0, color: '#f5f5f7', fontWeight: 600 }}>{target.store}</dd>
        {target.product && (<>
          <dt style={{ color: '#8e8e93' }}>Product</dt>
          <dd style={{ margin: 0, color: '#d1d1d6' }}>{target.product}</dd>
        </>)}
        {target.address && (<>
          <dt style={{ color: '#8e8e93' }}>Address</dt>
          <dd style={{ margin: 0, color: '#d1d1d6', wordBreak: 'break-all' }}>{target.address}</dd>
        </>)}
        <dt style={{ color: '#8e8e93' }}>Made by</dt>
        <dd style={{ margin: 0, color: '#d1d1d6' }}>A creator using MVP Affiliate</dd>
      </dl>

      <p style={{ ...ld.p, marginTop: 18 }}>
        {target.kind === 'amazon'
          ? 'Opening the link sends you straight to this product on Amazon, in your own country’s store when it is sold there, otherwise on amazon.com.'
          : 'Opening the link sends you straight to this page.'}{' '}
        The creator may earn a commission if you buy, at no extra cost to you.
      </p>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
        {live && <a href={passportLinkUrl(code)} rel="nofollow sponsored" style={ld.button}>Continue to {target.store}</a>}
        <a href={`/report-a-link?code=${encodeURIComponent(code)}`} style={ld.a}>Report this link</a>
      </div>
    </LinkDomainShell>
  )
}

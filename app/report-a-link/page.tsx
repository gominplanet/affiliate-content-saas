// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// mvpl.ink/report-a-link — anyone reports a link, no account needed.
//
// A plain HTML form posting to /api/link-report, which answers with a
// redirect back here. No script: it has to work for a reviewer or a visitor
// with JavaScript off, on the short domain, with nothing loaded but the page.
//
// The answer says what happened. "Sent" appears only when the report was
// saved. When it could not be saved the page says so and gives the email
// address, so a failure never reads as a report someone will look at.

import type { Metadata } from 'next'
import LinkDomainShell, { ld } from '@/components/link-domain/LinkDomainShell'
import { LINK_REPORT_REASONS, LINK_REPORT_API } from '@/lib/link-trust'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Report an mvpl.ink link',
  description: 'Report a link on mvpl.ink that goes somewhere it should not. No account needed.',
  robots: { index: true, follow: true },
  alternates: { canonical: 'https://www.mvpl.ink/report-a-link' },
}

const ERRORS: Record<string, string> = {
  no_code: 'That does not look like an mvpl.ink link. Paste the whole link, for example mvpl.ink/abc123.',
  no_reason: 'Pick what is wrong with the link.',
  too_many: 'Too many reports from this connection in the last hour. Try again later, or email abuse@mvpaffiliate.io.',
  save: 'Your report could not be saved. Nothing was sent. Please email it to abuse@mvpaffiliate.io instead.',
  form: 'The form did not arrive. Please try again.',
}

export default async function ReportALinkPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const q = await searchParams
  const one = (k: string) => { const v = q[k]; return (Array.isArray(v) ? v[0] : v) || '' }
  const sent = one('sent') === '1'
  const error = ERRORS[one('error')] || null
  const prefill = (one('link') || (one('code') ? `mvpl.ink/${one('code')}` : '')).slice(0, 200)

  return (
    <LinkDomainShell eyebrow="mvpl.ink" title="Report a link">
      {sent ? (
        <div role="status" style={{ border: '1px solid #30d158', background: 'rgba(48,209,88,0.08)', borderRadius: 10, padding: '14px 16px', marginBottom: 18 }}>
          <p style={{ ...ld.p, margin: 0, color: '#f5f5f7' }}>
            <strong>Report received.</strong> It has been saved and will be reviewed. If the link breaks the{' '}
            <a href="/link-policy" style={ld.a}>link policy</a>, it will be switched off.
          </p>
        </div>
      ) : (
        <p style={ld.p}>
          Found a link on mvpl.ink that goes somewhere it should not? Tell us here. You do not need an account. Every report is
          reviewed, and a link that breaks the <a href="/link-policy" style={ld.a}>link policy</a> is switched off.
        </p>
      )}

      {error && (
        <div role="alert" style={{ border: '1px solid #ff453a', background: 'rgba(255,69,58,0.08)', borderRadius: 10, padding: '14px 16px', marginBottom: 18 }}>
          <p style={{ ...ld.p, margin: 0, color: '#f5f5f7' }}>{error}</p>
        </div>
      )}

      <form method="post" action={LINK_REPORT_API} style={{ display: 'grid', gap: 18 }}>
        <div>
          <label htmlFor="link" style={ld.label}>The link</label>
          <input id="link" name="link" required defaultValue={sent ? '' : prefill} placeholder="mvpl.ink/abc123" style={ld.input} autoComplete="off" />
        </div>

        <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
          <legend style={ld.label}>What is wrong with it</legend>
          <div style={{ display: 'grid', gap: 8 }}>
            {LINK_REPORT_REASONS.map((r) => (
              <label key={r.key} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 15, color: '#d1d1d6', cursor: 'pointer' }}>
                <input type="radio" name="reason" value={r.key} required style={{ marginTop: 4 }} />
                <span>{r.label}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <div>
          <label htmlFor="details" style={ld.label}>Anything else we should know <span style={{ fontWeight: 400, color: '#8e8e93' }}>(optional)</span></label>
          <textarea id="details" name="details" rows={4} maxLength={1000} style={{ ...ld.input, resize: 'vertical' }} placeholder="Where you saw it, where it took you" />
        </div>

        <div>
          <label htmlFor="email" style={ld.label}>Your email <span style={{ fontWeight: 400, color: '#8e8e93' }}>(optional, only if you want an answer)</span></label>
          <input id="email" name="email" type="email" maxLength={200} style={ld.input} autoComplete="email" />
        </div>

        {/* Left empty by people, who never see it. Filled by bots. */}
        <div aria-hidden="true" style={{ position: 'absolute', left: '-10000px', width: 1, height: 1, overflow: 'hidden' }}>
          <label htmlFor="website">Leave this empty</label>
          <input id="website" name="website" tabIndex={-1} autoComplete="off" />
        </div>

        <div>
          <button type="submit" style={ld.button}>Send report</button>
        </div>
      </form>
    </LinkDomainShell>
  )
}

// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// The frame every page on mvpl.ink shares: the front page, the link policy,
// the report form and the link preview. Server rendered, no script, inline
// styles, so each page is a complete document a reviewer or a filter can read
// with nothing loaded but the HTML.

import type { CSSProperties, ReactNode } from 'react'

export const LINK_HOME = 'https://www.mvpl.ink/'
const APP = process.env.NEXT_PUBLIC_APP_URL || 'https://www.mvpaffiliate.io'

export const ld = {
  p: { fontSize: 16, lineHeight: 1.65, color: '#d1d1d6', margin: '0 0 16px' } as CSSProperties,
  h2: { fontSize: 15, margin: '0 0 10px', fontWeight: 600 } as CSSProperties,
  section: { borderTop: '1px solid #2c2c2e', paddingTop: 22, marginTop: 22 } as CSSProperties,
  a: { color: '#7c9cff' } as CSSProperties,
  li: { fontSize: 15, lineHeight: 1.6, color: '#d1d1d6', marginBottom: 6 } as CSSProperties,
  input: {
    width: '100%', boxSizing: 'border-box', padding: '10px 12px', borderRadius: 8, border: '1px solid #3a3a3c',
    background: '#161618', color: '#f5f5f7', fontSize: 15, fontFamily: 'inherit',
  } as CSSProperties,
  label: { display: 'block', fontSize: 14, fontWeight: 600, margin: '0 0 6px' } as CSSProperties,
  button: {
    padding: '11px 18px', borderRadius: 8, border: 0, background: '#7c9cff', color: '#0b0b0f',
    fontSize: 15, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', textDecoration: 'none', display: 'inline-block',
  } as CSSProperties,
}

export default function LinkDomainShell({ eyebrow = 'MVP Affiliate', title, children }: { eyebrow?: string; title: string; children: ReactNode }) {
  return (
    <main
      style={{
        minHeight: '100vh', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '56px 20px',
        background: '#0b0b0f', color: '#f5f5f7', fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
      }}
    >
      <div style={{ maxWidth: 640, width: '100%' }}>
        <p style={{ fontSize: 13, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#8e8e93', margin: 0 }}>{eyebrow}</p>
        <h1 style={{ fontSize: 32, lineHeight: 1.2, margin: '10px 0 18px', fontWeight: 700, textWrap: 'balance' }}>{title}</h1>
        {children}
        <nav style={{ ...ld.section, display: 'flex', flexWrap: 'wrap', gap: '8px 18px', fontSize: 14 }} aria-label="mvpl.ink">
          <a href={LINK_HOME} style={ld.a}>mvpl.ink</a>
          <a href="/link-policy" style={ld.a}>Link policy</a>
          <a href="/report-a-link" style={ld.a}>Report a link</a>
          <a href={APP} style={ld.a}>{APP.replace(/^https?:\/\//, '')}</a>
          <a href="mailto:abuse@mvpaffiliate.io" style={ld.a}>abuse@mvpaffiliate.io</a>
        </nav>
      </div>
    </main>
  )
}

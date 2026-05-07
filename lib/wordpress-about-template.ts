export interface AboutPageOptions {
  brandName: string
  authorName?: string | null
  aboutText: string
  accentColor: string
  headshotUrl?: string
  contactEmail?: string
  youtubeUrl?: string
  instagramUrl?: string
  tiktokUrl?: string
  twitterUrl?: string
}

function esc(str: string) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export function generateAboutPage(opts: AboutPageOptions): { title: string; content: string } {
  const { brandName, authorName, aboutText, accentColor, headshotUrl, contactEmail, youtubeUrl, instagramUrl, tiktokUrl, twitterUrl } = opts

  const socials: string[] = []
  if (youtubeUrl) socials.push(`<a class="ab-social" href="${esc(youtubeUrl)}" target="_blank" rel="noopener">▶ YouTube</a>`)
  if (instagramUrl) socials.push(`<a class="ab-social" href="${esc(instagramUrl)}" target="_blank" rel="noopener">◈ Instagram</a>`)
  if (tiktokUrl) socials.push(`<a class="ab-social" href="${esc(tiktokUrl)}" target="_blank" rel="noopener">♪ TikTok</a>`)
  if (twitterUrl) socials.push(`<a class="ab-social" href="${esc(twitterUrl)}" target="_blank" rel="noopener">✕ Twitter</a>`)

  const css = `
.ab-wrap{max-width:680px;margin:0 auto;padding:20px 0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
.ab-hero{display:flex;gap:32px;align-items:flex-start;margin-bottom:40px}
.ab-headshot{width:150px;height:150px;border-radius:50%;object-fit:cover;flex-shrink:0;border:4px solid ${accentColor}22}
.ab-name{font-size:28px;font-weight:700;color:#1d1d1f;margin:0 0 4px}
.ab-by{font-size:14px;color:${accentColor};font-weight:600;margin:0 0 16px}
.ab-text{font-size:15px;color:#3d3d3f;line-height:1.7;margin:0}
.ab-socials{display:flex;flex-wrap:wrap;gap:10px;margin-top:20px}
.ab-social{display:inline-flex;align-items:center;gap:5px;font-size:13px;font-weight:600;color:#fff;background:${accentColor};padding:7px 16px;border-radius:100px;text-decoration:none}
.ab-social:hover{opacity:.85}
.ab-contact{background:#f5f5f7;border-radius:16px;padding:28px;margin-top:40px}
.ab-contact h2{font-size:18px;font-weight:700;color:#1d1d1f;margin:0 0 8px}
.ab-contact p{font-size:14px;color:#6e6e73;margin:0}
.ab-contact a{color:${accentColor};text-decoration:none;font-weight:600}
@media(max-width:600px){.ab-hero{flex-direction:column;align-items:center;text-align:center}.ab-socials{justify-content:center}}
  `.trim()

  const content = `<!-- wp:html -->
<style>${css}</style>
<div class="ab-wrap">
  <div class="ab-hero">
    ${headshotUrl ? `<img class="ab-headshot" src="${esc(headshotUrl)}" alt="${esc(authorName || brandName)}" />` : ''}
    <div>
      <h1 class="ab-name">${esc(brandName)}</h1>
      ${authorName ? `<p class="ab-by">By ${esc(authorName)}</p>` : ''}
      <div class="ab-text">${esc(aboutText).replace(/\n/g, '<br>')}</div>
      ${socials.length ? `<div class="ab-socials">${socials.join('')}</div>` : ''}
    </div>
  </div>
  ${contactEmail ? `
  <div class="ab-contact">
    <h2>Get in Touch</h2>
    <p>Have questions or want to collaborate? Reach us at <a href="mailto:${esc(contactEmail)}">${esc(contactEmail)}</a></p>
  </div>` : ''}
</div>
<!-- /wp:html -->`

  return { title: `About ${brandName}`, content }
}

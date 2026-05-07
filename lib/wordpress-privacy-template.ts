export function generatePrivacyPolicy(brandName: string, siteUrl: string, contactEmail?: string): { title: string; content: string } {
  const year = new Date().getFullYear()
  const domain = siteUrl.replace(/^https?:\/\//, '')
  const email = contactEmail || `contact@${domain}`

  const content = `<!-- wp:html -->
<div style="max-width:680px;margin:0 auto;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:15px;color:#3d3d3f;line-height:1.7">

<p><strong>Last updated:</strong> ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</p>

<h2>1. Introduction</h2>
<p>${brandName} ("we", "us", or "our") operates ${siteUrl}. This page explains our privacy practices for visitors to our site.</p>

<h2>2. Affiliate Disclosure</h2>
<p>${brandName} is a participant in affiliate advertising programs. When you click links on our site and make a purchase, we may earn a commission at no extra cost to you. We only recommend products we believe in. All opinions are our own.</p>

<h2>3. Information We Collect</h2>
<p>We do not collect personally identifiable information unless you voluntarily submit it (e.g., via a contact form or comment). We may collect anonymous usage data through analytics tools to understand how visitors use our site.</p>

<h2>4. Cookies</h2>
<p>Our site may use cookies to improve your browsing experience. Third-party services such as Google Analytics and affiliate networks may also place cookies on your device. You can disable cookies in your browser settings at any time.</p>

<h2>5. Third-Party Links</h2>
<p>Our site contains links to third-party websites. We are not responsible for the privacy practices of those sites and encourage you to review their policies.</p>

<h2>6. Google Analytics</h2>
<p>We may use Google Analytics to collect anonymous traffic data. You can opt out using the <a href="https://tools.google.com/dlpage/gaoptout" target="_blank" rel="noopener">Google Analytics Opt-out Browser Add-on</a>.</p>

<h2>7. Amazon Associates</h2>
<p>${brandName} is a participant in the Amazon Services LLC Associates Program, an affiliate advertising program designed to provide a means for sites to earn advertising fees by advertising and linking to Amazon.com.</p>

<h2>8. Children's Privacy</h2>
<p>Our site is not directed to children under 13. We do not knowingly collect personal information from children.</p>

<h2>9. Changes to This Policy</h2>
<p>We may update this policy from time to time. Changes will be posted on this page with an updated date.</p>

<h2>10. Contact Us</h2>
<p>If you have any questions about this privacy policy, please contact us at <a href="mailto:${email}">${email}</a>.</p>

<p style="margin-top:40px;font-size:13px;color:#86868b">© ${year} ${brandName}. All rights reserved.</p>

</div>
<!-- /wp:html -->`

  return { title: 'Privacy Policy', content }
}

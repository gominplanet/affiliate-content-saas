export const metadata = { title: 'Terms of Service — Gomin Planet Content Tool' }

export default function TermsPage() {
  return (
    <main className="max-w-3xl mx-auto px-6 py-16 text-[#1d1d1f] dark:text-[#f5f5f7]">
      <h1 className="text-3xl font-bold mb-2">Terms of Service</h1>
      <p className="text-sm text-[#86868b] dark:text-[#8e8e93] mb-10">Last updated: May 8, 2025</p>

      <section className="prose prose-sm max-w-none space-y-8 text-[#374151] leading-relaxed">

        <div>
          <h2 className="text-lg font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-2">1. Acceptance of Terms</h2>
          <p>
            By using the Gomin Planet Content Tool (&quot;the App&quot;), you agree to these Terms of Service.
            If you do not agree, do not use the App.
          </p>
        </div>

        <div>
          <h2 className="text-lg font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-2">2. Description of Service</h2>
          <p>
            The App is a content generation and distribution tool that helps you create blog posts
            from YouTube videos and publish them to WordPress and Facebook Pages.
          </p>
        </div>

        <div>
          <h2 className="text-lg font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-2">3. Your Responsibilities</h2>
          <ul className="list-disc ml-5 space-y-1">
            <li>You are responsible for all content published through the App</li>
            <li>You must comply with Facebook&apos;s Terms of Service and Community Standards</li>
            <li>You must own or have rights to the YouTube content you process</li>
            <li>You must not use the App to post spam, misleading, or illegal content</li>
            <li>Affiliate disclosures in generated content are your responsibility to verify</li>
          </ul>
        </div>

        <div>
          <h2 className="text-lg font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-2">4. Facebook Integration</h2>
          <p>
            When you connect a Facebook Page, you authorize the App to post content to that Page
            on your behalf. Posts are only created when you explicitly click the &quot;Post to Facebook&quot;
            button. You can revoke this access at any time from the Settings page or directly
            from your Facebook account settings.
          </p>
        </div>

        <div>
          <h2 className="text-lg font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-2">5. AI-Generated Content</h2>
          <p>
            Content is generated using AI (Anthropic Claude). You should review all generated content
            before publishing. We are not responsible for inaccuracies in AI-generated content.
          </p>
        </div>

        <div>
          <h2 className="text-lg font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-2">6. Limitation of Liability</h2>
          <p>
            The App is provided &quot;as is&quot; without warranties of any kind. We are not liable for any
            damages arising from your use of the App, including but not limited to content published
            to your social media accounts or website.
          </p>
        </div>

        <div>
          <h2 className="text-lg font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-2">7. Changes to Terms</h2>
          <p>
            We may update these terms at any time. Continued use of the App constitutes acceptance
            of the updated terms.
          </p>
        </div>

        <div>
          <h2 className="text-lg font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-2">8. Contact</h2>
          <p>
            Questions about these terms? Contact us at{' '}
            <a href="mailto:us@gominplanet.com" className="text-[#0071e3] hover:underline">us@gominplanet.com</a>.
          </p>
        </div>

      </section>
    </main>
  )
}

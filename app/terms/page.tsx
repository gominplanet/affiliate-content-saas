export const metadata = { title: 'Terms of Service — MVP Affiliate' }

export default function TermsPage() {
  return (
    <main className="max-w-3xl mx-auto px-6 py-16 text-[#1d1d1f] dark:text-[#f5f5f7]">
      <h1 className="text-3xl font-bold mb-2">Terms of Service</h1>
      <p className="text-sm text-[#86868b] dark:text-[#8e8e93] mb-10">Last updated: May 13, 2026</p>

      <section className="prose prose-sm max-w-none space-y-8 text-[#374151] leading-relaxed">

        <div>
          <h2 className="text-lg font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-2">1. Acceptance of Terms</h2>
          <p>
            By creating an account or using MVP Affiliate (&quot;the App&quot;, &quot;we&quot;, &quot;us&quot;),
            you agree to these Terms of Service. If you do not agree, do not use the App. The App is
            operated by Gominplanet Holdings Ltd.
          </p>
        </div>

        <div>
          <h2 className="text-lg font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-2">2. Description of Service</h2>
          <p>
            MVP Affiliate is a content generation and publishing tool for individual creators. It helps
            you draft product review blog posts, publish them to your own self-hosted WordPress site, and
            optionally distribute them as Pins on your own Pinterest business account, posts on your own
            Facebook Pages, or videos on your own TikTok account. All publishing actions are initiated by
            you; the App does not autonomously post on your behalf.
          </p>
        </div>

        <div>
          <h2 className="text-lg font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-2">3. Your Account</h2>
          <p>
            You are responsible for keeping your account credentials secure and for all activity that
            occurs under your account. You must be at least 16 years old to use the App. One account per
            person; do not share accounts.
          </p>
        </div>

        <div>
          <h2 className="text-lg font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-2">4. Acceptable Use</h2>
          <ul className="list-disc ml-5 space-y-1">
            <li>You own or have the right to publish all content you put through the App.</li>
            <li>You comply with the Terms of Service and Community Guidelines of every platform you connect (Pinterest, Facebook, TikTok, WordPress, etc.).</li>
            <li>You do not use the App to publish spam, misleading, fraudulent, deceptive, infringing, hateful, or illegal content.</li>
            <li>You include any affiliate disclosures required by law and by the platforms you publish to.</li>
            <li>You do not attempt to bypass rate limits, automate engagement, or otherwise manipulate the platforms the App connects to.</li>
            <li>You do not reverse engineer, decompile, disassemble, scrape, crawl, or attempt to derive the source code, prompts, models, or methods of the App, or access it other than through the interfaces we provide.</li>
            <li>You do not copy, resell, rent, sublicense, white-label, or redistribute the App or any part of it, and you do not use it (or data/outputs derived from it) to build, train, or operate a competing product or service.</li>
            <li>You do not access or attempt to access other users&apos; data.</li>
          </ul>
        </div>

        <div>
          <h2 className="text-lg font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-2">5. Pinterest Integration</h2>
          <p>
            When you connect a Pinterest business account, you authorize MVP Affiliate to (a) read your
            own boards, Pins, and account information, and (b) create new boards and Pins on your behalf
            when you click an explicit publish action inside the App. The App never creates Pins in the
            background, never schedules content outside of explicit user actions, and never interacts
            with accounts other than the one you connect. You can disconnect Pinterest from the App
            Settings page at any time, and you can revoke MVP Affiliate&apos;s access directly from your
            Pinterest account&apos;s connected apps settings.
          </p>
          <p className="mt-3">
            You agree that your use of Pinterest features through MVP Affiliate is subject to the{' '}
            <a href="https://policy.pinterest.com/en/terms-of-service" target="_blank" rel="noopener noreferrer" className="text-[#0071e3] hover:underline">Pinterest Terms of Service</a>,{' '}
            <a href="https://policy.pinterest.com/en/community-guidelines" target="_blank" rel="noopener noreferrer" className="text-[#0071e3] hover:underline">Community Guidelines</a>, and{' '}
            <a href="https://developers.pinterest.com/_/_/policy/developer-guidelines" target="_blank" rel="noopener noreferrer" className="text-[#0071e3] hover:underline">Developer Guidelines</a>.
          </p>
        </div>

        <div>
          <h2 className="text-lg font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-2">6. Facebook Integration</h2>
          <p>
            When you connect a Facebook Page, you authorize MVP Affiliate to publish a post to that Page
            only when you explicitly click a publish action. You can revoke this access from the App
            Settings page or directly from your Facebook account&apos;s Business Integrations settings.
          </p>
        </div>

        <div>
          <h2 className="text-lg font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-2">7. TikTok Integration</h2>
          <p>
            When you connect a TikTok account, you authorize MVP Affiliate to (a) read your basic profile
            information (open_id, display name, avatar, and — if granted — profile link and bio) and (b)
            upload or publish a video to that authorized TikTok account only when you explicitly click a
            publish action inside the App. The App never posts in the background, never schedules content
            outside of explicit user actions, and never interacts with TikTok accounts other than the one
            you connect. You can disconnect TikTok from the App Settings page at any time, and you can
            revoke MVP Affiliate&apos;s access directly from your TikTok account settings under &quot;Manage
            app permissions&quot;.
          </p>
          <p className="mt-3">
            You agree that your use of TikTok features through MVP Affiliate is subject to the{' '}
            <a href="https://www.tiktok.com/legal/terms-of-service" target="_blank" rel="noopener noreferrer" className="text-[#0071e3] hover:underline">TikTok Terms of Service</a>,{' '}
            <a href="https://www.tiktok.com/community-guidelines" target="_blank" rel="noopener noreferrer" className="text-[#0071e3] hover:underline">TikTok Community Guidelines</a>, and{' '}
            <a href="https://developers.tiktok.com/doc/tiktok-api-terms-of-service" target="_blank" rel="noopener noreferrer" className="text-[#0071e3] hover:underline">TikTok Developer Terms of Service</a>.
          </p>
        </div>

        <div>
          <h2 className="text-lg font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-2">8. AI-Generated Content</h2>
          <p>
            The App generates draft content using a pipeline of specialized AI agents. AI-generated content
            may contain inaccuracies, factual errors, or unintended language. You are responsible for
            reviewing and editing all generated content before publishing, and for ensuring it complies with
            the policies of the platforms you publish to and with applicable law (including required
            affiliate disclosures).
          </p>
        </div>

        <div>
          <h2 className="text-lg font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-2">9. Subscription and Billing</h2>
          <p>
            Some features require a paid subscription, billed through Stripe. Subscriptions renew
            automatically until cancelled. You can cancel anytime from the Billing page; cancellation
            takes effect at the end of the current billing period. Fees already paid are non-refundable
            except where required by law.
          </p>
        </div>

        <div>
          <h2 className="text-lg font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-2">10. Termination</h2>
          <p>
            You may stop using the App and delete your account at any time. We may suspend or terminate
            your account if you breach these Terms or use the App in a way that puts our integrations
            (including Pinterest and Facebook) at risk. On termination, we delete your stored data and
            third-party tokens within 30 days, except where retention is required by law.
          </p>
        </div>

        <div>
          <h2 className="text-lg font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-2">11. Disclaimer of Warranties</h2>
          <p>
            The App is provided &quot;as is&quot; and &quot;as available&quot; without warranties of any
            kind, express or implied. We do not warrant that the App will be uninterrupted, error-free,
            or that AI-generated content will meet your requirements.
          </p>
        </div>

        <div>
          <h2 className="text-lg font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-2">12. Limitation of Liability</h2>
          <p>
            To the maximum extent permitted by law, MVP Affiliate and Gominplanet Holdings Ltd are not
            liable for any indirect, incidental, special, consequential, or punitive damages arising from
            your use of the App, including damages arising from content you publish to third-party
            platforms. Our aggregate liability is limited to the fees you paid us in the 12 months
            preceding the claim.
          </p>
        </div>

        <div>
          <h2 className="text-lg font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-2">13. Changes to These Terms</h2>
          <p>
            We may update these Terms. The &quot;Last updated&quot; date reflects the most recent
            revision. Material changes will be announced via in-app notice or email. Continued use of
            the App after changes take effect constitutes acceptance of the updated Terms.
          </p>
        </div>

        <div>
          <h2 className="text-lg font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-2">14. Governing Law</h2>
          <p>
            These Terms are governed by the laws of British Columbia, Canada, without regard to its
            conflict of laws principles. Any disputes will be resolved in the courts of British Columbia.
          </p>
        </div>

        <div>
          <h2 className="text-lg font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-2">15. Intellectual Property &amp; Restrictions</h2>
          <p>
            The App, including its software, source code, design, prompts, AI generation
            logic, content pipelines, and all related know-how, is the proprietary and
            confidential property of Gominplanet / MVP Affiliate and is protected by
            intellectual property and trade-secret law. We grant you a limited,
            non-exclusive, non-transferable right to use the App for your own affiliate
            content while your subscription is active — and nothing more. No ownership or
            license to the underlying software or methods is transferred to you.
          </p>
          <p className="mt-3">
            You may not, directly or indirectly: (a) reverse engineer, decompile,
            disassemble, or attempt to derive the source code, prompts, or methods of the
            App; (b) copy, modify, distribute, resell, rent, sublicense, or white-label the
            App or any part of it; (c) use the App, or any data or output obtained from it,
            to build, train, or operate a competing product or service; or (d) remove or
            obscure any proprietary notice. Content you generate for your own sites remains
            yours; the App and its technology remain ours. We reserve all rights not
            expressly granted and may pursue all available remedies for misuse or
            misappropriation.
          </p>
        </div>

        <div>
          <h2 className="text-lg font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-2">16. Contact</h2>
          <p>
            Questions about these Terms? Contact us at{' '}
            <a href="mailto:us@gominplanet.com" className="text-[#0071e3] hover:underline">us@gominplanet.com</a>.
          </p>
        </div>

      </section>
    </main>
  )
}

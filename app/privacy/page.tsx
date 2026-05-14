export const metadata = { title: 'Privacy Policy — MVP Affiliate' }

export default function PrivacyPage() {
  return (
    <main className="max-w-3xl mx-auto px-6 py-16 text-[#1d1d1f] dark:text-[#f5f5f7]">
      <h1 className="text-3xl font-bold mb-2">Privacy Policy</h1>
      <p className="text-sm text-[#86868b] dark:text-[#8e8e93] mb-10">Last updated: May 13, 2026</p>

      <section className="prose prose-sm max-w-none space-y-8 text-[#374151] leading-relaxed">

        <div>
          <h2 className="text-lg font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-2">1. About This App</h2>
          <p>
            MVP Affiliate (&quot;the App&quot;, &quot;we&quot;, &quot;us&quot;) is a SaaS tool used by individual
            content creators (bloggers, YouTubers, affiliate marketers) to generate, publish, and distribute
            product review content to their own websites and social accounts. The App is operated by
            Gomin Planet Holdings Ltd (<a href="mailto:us@gominplanet.com" className="text-[#0071e3] hover:underline">us@gominplanet.com</a>).
          </p>
        </div>

        <div>
          <h2 className="text-lg font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-2">2. Data We Collect From You</h2>
          <ul className="list-disc ml-5 mt-2 space-y-1">
            <li>Account email address and name (provided at signup)</li>
            <li>Brand profile information you enter (brand name, bio, logo, social URLs, contact email)</li>
            <li>YouTube channel ID (provided by you)</li>
            <li>WordPress site URL and Application Password (provided by you, stored encrypted)</li>
            <li>Generated blog content and publishing history</li>
            <li>Analytics on content the App has produced for you (post counts, publishing dates)</li>
          </ul>
        </div>

        <div>
          <h2 className="text-lg font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-2">3. Pinterest Data</h2>
          <p>
            When you connect your Pinterest business account to MVP Affiliate, we use Pinterest&apos;s OAuth
            flow and request the minimum scopes needed for the features you use. Specifically:
          </p>
          <ul className="list-disc ml-5 mt-2 space-y-1">
            <li><strong>boards:read</strong> — to list the boards on your own Pinterest account so you can choose where new Pins are saved.</li>
            <li><strong>boards:write</strong> — to create a new board on your behalf, only when you explicitly request one inside the App.</li>
            <li><strong>pins:read</strong> — to retrieve metrics (impressions, saves, outbound clicks) for Pins the App has helped you publish, shown back to you inside the App.</li>
            <li><strong>pins:write</strong> — to create new Pins linking to review articles you have published through MVP Affiliate. Pins are only created when you explicitly click a publish action; no Pin is ever created in the background.</li>
            <li><strong>user_accounts:read</strong> — to identify which Pinterest account you have connected so the App can display &quot;Connected as @yourhandle&quot; in the settings UI.</li>
          </ul>
          <p className="mt-3">We do <strong>not</strong>:</p>
          <ul className="list-disc ml-5 mt-2 space-y-1">
            <li>Sell, rent, share, or transfer your Pinterest data to any third party.</li>
            <li>Use your Pinterest data for advertising or to train AI models.</li>
            <li>Read, follow, save, or interact with content on Pinterest accounts other than your own.</li>
            <li>Bulk-create, automate engagement on, or schedule Pins outside of explicit user actions.</li>
            <li>Store your Pinterest password — we use OAuth tokens only, encrypted at rest.</li>
          </ul>
          <p className="mt-3">
            Pinterest access tokens are stored encrypted in our database. You can disconnect Pinterest at
            any time from the Settings page in the App, which immediately revokes and deletes the stored
            token. You can also revoke MVP Affiliate&apos;s access directly from your Pinterest account
            settings under &quot;Apps&quot;.
          </p>
        </div>

        <div>
          <h2 className="text-lg font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-2">4. Facebook Data</h2>
          <p>
            If you connect a Facebook Page, we request only the scopes needed to list your Pages
            (<strong>pages_show_list</strong>) and publish a post when you explicitly click the
            &quot;Post to Facebook&quot; button (<strong>pages_manage_posts</strong>). We do not post in the
            background, do not read personal profile data, and do not use Facebook data for advertising.
            You can disconnect at any time from the Settings page; we delete the stored access token on
            disconnection.
          </p>
        </div>

        <div>
          <h2 className="text-lg font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-2">5. How We Use Your Data</h2>
          <ul className="list-disc ml-5 space-y-1">
            <li>To generate blog posts from your inputs (product URLs, YouTube videos, etc.)</li>
            <li>To publish posts to your WordPress site</li>
            <li>To create Pins or social posts on platforms you have explicitly connected, only when you trigger a publish action</li>
            <li>To display your content history and analytics inside the App</li>
            <li>To send transactional account emails (login confirmations, billing receipts)</li>
          </ul>
          <p className="mt-3">
            We never publish anything on your behalf without a direct, explicit user action. There is no
            background scheduling, no automated bulk distribution, and no &quot;set and forget&quot; posting.
          </p>
        </div>

        <div>
          <h2 className="text-lg font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-2">6. Data Storage and Security</h2>
          <p>
            Account data, content, and integration credentials are stored in Supabase (PostgreSQL) on
            servers in the United States. OAuth access tokens and other secrets are stored encrypted at
            rest. Access to production data is restricted to authorized personnel and protected by
            multi-factor authentication.
          </p>
        </div>

        <div>
          <h2 className="text-lg font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-2">7. Data Retention and Deletion</h2>
          <p>
            We retain your data for as long as your account is active. To delete your account and all
            associated data, email{' '}
            <a href="mailto:us@gominplanet.com" className="text-[#0071e3] hover:underline">us@gominplanet.com</a>{' '}
            from the address registered to the account. We will delete your account and all associated
            data within 30 days of receiving the request, including any Pinterest, Facebook, and other
            third-party tokens we hold for you.
          </p>
        </div>

        <div>
          <h2 className="text-lg font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-2">8. Third-Party Services</h2>
          <p>MVP Affiliate integrates with the following services on your behalf:</p>
          <ul className="list-disc ml-5 mt-2 space-y-1">
            <li>Pinterest (Pin creation and analytics — only the connected business account)</li>
            <li>Facebook / Meta (Page posting — only Pages you authorize)</li>
            <li>YouTube Data API (channel and video data)</li>
            <li>WordPress REST API (publishing to your own self-hosted WordPress site)</li>
            <li>Large-language-model providers used to power our AI agent pipeline (content generation)</li>
            <li>Supabase (data storage)</li>
            <li>Stripe (billing and subscription management)</li>
            <li>Vercel (web hosting)</li>
          </ul>
          <p className="mt-3">Each service&apos;s own privacy policy governs their handling of your data.</p>
        </div>

        <div>
          <h2 className="text-lg font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-2">9. Children</h2>
          <p>
            MVP Affiliate is not directed to anyone under the age of 16. We do not knowingly collect
            personal data from children. If you believe a child has provided us with personal data,
            contact us and we will delete it.
          </p>
        </div>

        <div>
          <h2 className="text-lg font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-2">10. Changes to This Policy</h2>
          <p>
            We may update this Privacy Policy. The &quot;Last updated&quot; date at the top reflects the
            most recent revision. Material changes will be announced via an in-app notice or email.
          </p>
        </div>

        <div>
          <h2 className="text-lg font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-2">11. Contact</h2>
          <p>
            For privacy questions, deletion requests, or any other concerns, contact us at{' '}
            <a href="mailto:us@gominplanet.com" className="text-[#0071e3] hover:underline">us@gominplanet.com</a>.
          </p>
        </div>

      </section>
    </main>
  )
}

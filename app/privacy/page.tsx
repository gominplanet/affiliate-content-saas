export const metadata = { title: 'Privacy Policy — Gomin Planet Content Tool' }

export default function PrivacyPage() {
  return (
    <main className="max-w-3xl mx-auto px-6 py-16 text-[#1d1d1f] dark:text-[#f5f5f7]">
      <h1 className="text-3xl font-bold mb-2">Privacy Policy</h1>
      <p className="text-sm text-[#86868b] dark:text-[#8e8e93] mb-10">Last updated: May 8, 2025</p>

      <section className="prose prose-sm max-w-none space-y-8 text-[#374151] leading-relaxed">

        <div>
          <h2 className="text-lg font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-2">1. About This App</h2>
          <p>
            The Gomin Planet Content Tool (&quot;the App&quot;) is a content management platform that helps creators
            generate, publish, and distribute blog posts and social media content from YouTube videos.
            It is operated by Gomin Planet (us@gominplanet.com).
          </p>
        </div>

        <div>
          <h2 className="text-lg font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-2">2. Data We Collect</h2>
          <p>When you connect your Facebook account, we request the following permissions:</p>
          <ul className="list-disc ml-5 mt-2 space-y-1">
            <li><strong>pages_show_list</strong> — to list the Facebook Pages you manage so you can select which page to post to.</li>
            <li><strong>pages_manage_posts</strong> — to publish content to your selected Facebook Page on your behalf, only when you click the &quot;Post to Facebook&quot; button.</li>
          </ul>
          <p className="mt-3">We also collect:</p>
          <ul className="list-disc ml-5 mt-2 space-y-1">
            <li>Your email address and name (via account registration)</li>
            <li>YouTube channel ID (provided by you)</li>
            <li>WordPress site credentials (provided by you, stored encrypted)</li>
            <li>Generated blog content and post history</li>
          </ul>
        </div>

        <div>
          <h2 className="text-lg font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-2">3. How We Use Your Data</h2>
          <ul className="list-disc ml-5 space-y-1">
            <li>To generate blog posts from your YouTube content</li>
            <li>To publish posts to your WordPress site</li>
            <li>To post content to your Facebook Page <strong>only when you explicitly trigger it</strong></li>
            <li>To display your content history within the App</li>
          </ul>
          <p className="mt-3">
            We do not post to Facebook automatically. All Facebook posts are manually triggered by you.
          </p>
        </div>

        <div>
          <h2 className="text-lg font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-2">4. Data Storage and Security</h2>
          <p>
            Your data is stored securely in Supabase (PostgreSQL), hosted on servers in the United States.
            Access tokens are stored in encrypted form and are never shared with third parties.
            We use industry-standard security practices to protect your data.
          </p>
        </div>

        <div>
          <h2 className="text-lg font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-2">5. Facebook Data</h2>
          <p>
            We access your Facebook Page data solely to enable posting on your behalf. We do not:
          </p>
          <ul className="list-disc ml-5 mt-2 space-y-1">
            <li>Sell your Facebook data to third parties</li>
            <li>Use your Page data for advertising</li>
            <li>Access personal profile data beyond what is needed for page management</li>
            <li>Post to Facebook without your explicit action</li>
          </ul>
          <p className="mt-3">
            You can disconnect your Facebook account at any time from the Settings page.
            Upon disconnection, we delete your stored access token.
          </p>
        </div>

        <div>
          <h2 className="text-lg font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-2">6. Data Deletion</h2>
          <p>
            To request deletion of your data, email us at <a href="mailto:us@gominplanet.com" className="text-[#0071e3] hover:underline">us@gominplanet.com</a>.
            We will delete your account and all associated data within 30 days.
          </p>
        </div>

        <div>
          <h2 className="text-lg font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-2">7. Third-Party Services</h2>
          <p>The App integrates with:</p>
          <ul className="list-disc ml-5 mt-2 space-y-1">
            <li>Facebook / Meta (Page posting)</li>
            <li>YouTube Data API (video data)</li>
            <li>WordPress REST API (blog publishing)</li>
            <li>Anthropic Claude API (content generation)</li>
            <li>Supabase (data storage)</li>
          </ul>
          <p className="mt-3">Each service&apos;s own privacy policy governs their data handling.</p>
        </div>

        <div>
          <h2 className="text-lg font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-2">8. Contact</h2>
          <p>
            For privacy questions or data requests, contact us at{' '}
            <a href="mailto:us@gominplanet.com" className="text-[#0071e3] hover:underline">us@gominplanet.com</a>.
          </p>
        </div>

      </section>
    </main>
  )
}

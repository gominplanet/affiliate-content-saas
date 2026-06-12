import type { Metadata, Viewport } from 'next'
import { Inter, Geist_Mono } from 'next/font/google'
import Script from 'next/script'
import { ThemeProvider } from 'next-themes'
import './globals.css'

// Self-hosted, subset-optimized, variable fonts via next/font. Loading these
// at the root layout means every page (dashboard + marketing) gets crisp,
// consistent typography on every OS — including Windows + Android, which
// don't have SF Pro and were rendering Arial under the old stack.
const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-sans',
})

const geistMono = Geist_Mono({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-mono',
})

export const metadata: Metadata = {
  title: {
    default: 'MVP Affiliate',
    template: '%s · MVP Affiliate',
  },
  description: 'Automate your affiliate content pipeline from YouTube to blog to social.',
  other: {
    // Pinterest domain verification — links mvpaffiliate.io to our Pinterest
    // business account so the Pinterest Developer Platform can verify the
    // app's website during API access review.
    'p:domain_verify': '5e1f4647f3b22f7c34b62e98e2ece410',
  },
}

export const viewport: Viewport = {
  themeColor: '#ffffff',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // Rewardful affiliate tracking — only loads when key is set in env, so
  // dev/preview builds without the env var don't fire the script.
  const rewardfulKey = process.env.NEXT_PUBLIC_REWARDFUL_KEY
  return (
    <html lang="en" suppressHydrationWarning className={`${inter.variable} ${geistMono.variable}`}>
      <body suppressHydrationWarning>
        {/* Impact.com site verification. Rendered as a literal tag (not via
            metadata.other) because Impact's crawler checks the `value`
            attribute, and Next's metadata API only emits `content`. React 19
            hoists this <meta> into <head>. */}
        <meta name="impact-site-verification" value="e55f7edf-8f38-42e9-8db5-ef3793169671" />
        {rewardfulKey && (
          <>
            <Script
              id="rewardful-queue"
              strategy="beforeInteractive"
            >{`(function(w,r){w._rwq=r;w[r]=w[r]||function(){(w[r].q=w[r].q||[]).push(arguments)}})(window,'rewardful');`}</Script>
            <Script
              src="https://r.wdfl.co/rw.js"
              data-rewardful={rewardfulKey}
              strategy="afterInteractive"
            />
          </>
        )}
        {/* Default theme flipped to 'dark' for the V2 dashboard chrome
            (task #143). next-themes persists the user choice in
            localStorage, so anyone who toggled to a specific theme
            previously keeps their pick. Only first-load users see the
            new dark default. */}
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}>
          {children}
        </ThemeProvider>
      </body>
    </html>
  )
}

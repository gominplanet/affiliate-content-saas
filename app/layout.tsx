import type { Metadata, Viewport } from 'next'
import Script from 'next/script'
import { ThemeProvider } from 'next-themes'
import './globals.css'

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
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning>
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
        <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false}>
          {children}
        </ThemeProvider>
      </body>
    </html>
  )
}

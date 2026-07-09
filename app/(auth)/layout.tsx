import Image from 'next/image'

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#f5f5f7] dark:bg-[#000] flex items-center justify-center p-6">
      <div className="w-full max-w-4xl flex flex-col md:flex-row items-stretch gap-8 md:gap-16">

        {/* Left — Logo */}
        <div className="flex-1 flex items-center justify-center">
          <Image
            src="/mvp-affiliate-logo.webp"
            alt="MVP Affiliate"
            width={320}
            height={320}
            className="w-56 h-56 md:w-80 md:h-80 object-contain mix-blend-multiply dark:mix-blend-screen"
            priority
          />
        </div>

        {/* Right — Form */}
        <div className="flex-1 flex items-center justify-center">
          <div className="w-full max-w-sm">
            {children}
            {/* Always give logged-out users a way to reach a human — the in-app
                Help/Support links require a session, so a user stuck at the door
                (captcha or email-confirmation trouble) would otherwise have no
                path forward. */}
            <p className="text-center text-xs mt-5 text-[#6e6e73] dark:text-[#8e8e93]">
              Trouble signing in? Email{' '}
              <a href="mailto:support@mvpaffiliate.io" className="text-[#7C3AED] hover:underline font-medium">
                support@mvpaffiliate.io
              </a>
            </p>
          </div>
        </div>

      </div>
    </div>
  )
}

import Image from 'next/image'

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#f5f5f7] dark:bg-[#000] flex items-center justify-center p-6">
      <div className="w-full max-w-4xl flex flex-col md:flex-row items-stretch gap-8 md:gap-16">

        {/* Left — Logo */}
        <div className="flex-1 flex items-center justify-center">
          <Image
            src="/mvp-affiliate-logo.png"
            alt="MVP Affiliate"
            width={320}
            height={320}
            className="rounded-3xl w-56 h-56 md:w-80 md:h-80 object-contain"
            priority
          />
        </div>

        {/* Right — Form */}
        <div className="flex-1 flex items-center justify-center">
          <div className="w-full max-w-sm">
            {children}
          </div>
        </div>

      </div>
    </div>
  )
}

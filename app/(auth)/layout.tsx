import Image from 'next/image'

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#f5f5f7] dark:bg-[#000] flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center mb-3">
            <Image
              src="/mvp-affiliate-logo.png"
              alt="MVP Affiliate"
              width={80}
              height={80}
              className="rounded-2xl"
              priority
            />
          </div>
        </div>
        {children}
      </div>
    </div>
  )
}

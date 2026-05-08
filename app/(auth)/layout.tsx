export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#f5f5f7] dark:bg-[#000] flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-[#0071e3] mb-4 shadow-apple-md">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" className="text-white">
              <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <h1 className="text-xl font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">AffiliateOS</h1>
          <p className="text-sm text-[#6e6e73] dark:text-[#ebebf0] mt-1">Content automation platform</p>
        </div>
        {children}
      </div>
    </div>
  )
}

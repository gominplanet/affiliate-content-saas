/** Instant server-rendered skeleton while the (heavy, client) page hydrates. */
export default function Loading() {
  return (
    <div className="animate-pulse flex flex-col gap-4">
      <div className="h-8 w-56 rounded-lg bg-gray-200 dark:bg-white/10" />
      <div className="h-4 w-80 max-w-full rounded bg-gray-100 dark:bg-white/5" />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mt-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-44 rounded-xl bg-gray-100 dark:bg-white/5" />
        ))}
      </div>
    </div>
  )
}

interface HeaderProps {
  title: string
  subtitle?: string
  actions?: React.ReactNode
}

export default function Header({ title, subtitle, actions }: HeaderProps) {
  return (
    // On mobile we stack title above actions so neither gets squeezed.
    // sm:flex-row brings them side-by-side once there's room.
    //
    // Title bumped to text-2xl/text-3xl (was text-xl/text-2xl) so it reads as
    // a real page heading instead of a section label. Tracking tight + leading
    // tight keeps it dense at the bigger size.
    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-7 sm:mb-8">
      <div className="min-w-0">
        <h1
          className="text-2xl sm:text-3xl font-semibold tracking-tight leading-tight"
          style={{ color: 'var(--text)' }}
        >
          {title}
        </h1>
        {subtitle && (
          <p
            className="text-[15px] mt-1.5 leading-relaxed max-w-2xl"
            style={{ color: 'var(--text-2)' }}
          >
            {subtitle}
          </p>
        )}
      </div>
      {actions && <div className="flex items-center gap-2 flex-wrap sm:flex-shrink-0 sm:ml-4">{actions}</div>}
    </div>
  )
}

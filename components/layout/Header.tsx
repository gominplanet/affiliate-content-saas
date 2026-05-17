interface HeaderProps {
  title: string
  subtitle?: string
  actions?: React.ReactNode
}

export default function Header({ title, subtitle, actions }: HeaderProps) {
  return (
    // On mobile we stack title above actions so neither gets squeezed.
    // sm:flex-row brings them side-by-side once there's room.
    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-6 sm:mb-7">
      <div className="min-w-0">
        <h1 className="text-xl sm:text-2xl font-semibold tracking-tight" style={{ color: 'var(--text)' }}>{title}</h1>
        {subtitle && <p className="text-sm mt-0.5" style={{ color: 'var(--text-2)' }}>{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 flex-wrap sm:flex-shrink-0 sm:ml-4">{actions}</div>}
    </div>
  )
}

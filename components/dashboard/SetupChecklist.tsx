'use client'

import { useState, useEffect } from 'react'
import { CheckCircle, Circle, ChevronDown, ChevronUp, ExternalLink } from 'lucide-react'

const STORAGE_KEY = 'mvp_setup_checklist_v1'

interface Step {
  id: string
  label: string
  description: string
  href: string
  required: boolean
  done: boolean
}

const steps: Step[] = [
  {
    id: 'hostinger',
    label: 'Get a domain + WordPress host',
    description: 'Your reviews need somewhere to live. Hostinger gives you a domain + WordPress install in about 5 minutes — that\'s the only piece that isn\'t built into MVP.',
    href: 'https://geni.us/MVPhosting',
    required: true,
    done: false,
  },
  {
    id: 'geniuslink',
    label: 'Sign up for Geniuslink',
    description: 'Optional but worth it. Geniuslink turns every Amazon link into a geo-routed affiliate link that pays you on .com, .co.uk, .ca and the rest — and tracks every click. Without it, we fall back to plain US Amazon links.',
    href: 'https://geni.us/Y70p9R',
    required: false,
    done: false,
  },
]

export default function SetupChecklist() {
  const [completed, setCompleted] = useState<Record<string, boolean>>({})
  const [collapsed, setCollapsed] = useState(false)
  const [hydrated, setHydrated] = useState(false)

  // Load from localStorage on mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) {
        const parsed = JSON.parse(raw)
        setCompleted(parsed.completed ?? {})
        setCollapsed(parsed.collapsed ?? false)
      }
    } catch { /* ignore */ }
    setHydrated(true)
  }, [])

  // Persist to localStorage whenever state changes
  useEffect(() => {
    if (!hydrated) return
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ completed, collapsed }))
    } catch { /* ignore */ }
  }, [completed, collapsed, hydrated])

  function toggle(id: string) {
    setCompleted((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  const allRequired = steps.filter((s) => s.required)
  const doneCount = allRequired.filter((s) => completed[s.id]).length
  const allDone = doneCount === allRequired.length

  // Hide on first render to avoid hydration flash, then hide permanently once all done
  if (!hydrated) return null
  if (allDone) return null

  return (
    <div className={`card mb-6 overflow-hidden border ${allDone ? 'border-[#34c759]/30' : 'border-[#7C3AED]/20'}`}>
      {/* Header */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-gray-50 dark:bg-[#2c2c2e]/60 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${
            allDone ? 'bg-[#34c759]/15 text-[#34c759]' : 'bg-[#7C3AED]/10 text-[#7C3AED]'
          }`}>
            {allDone ? '✓' : `${doneCount}/${allRequired.length}`}
          </div>
          <div className="text-left">
            <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">
              {allDone ? 'External accounts ready' : 'Before you generate — two external accounts'}
            </p>
            <p className="text-xs text-[#86868b] dark:text-[#8e8e93]">
              {allDone
                ? 'All required accounts are set up.'
                : `${allRequired.length - doneCount} required · 1 recommended — opens in a new tab`}
            </p>
          </div>
        </div>
        {collapsed ? <ChevronDown size={16} className="text-[#86868b] dark:text-[#8e8e93]" /> : <ChevronUp size={16} className="text-[#86868b] dark:text-[#8e8e93]" />}
      </button>

      {/* Steps */}
      {!collapsed && (
        <div className="border-t border-gray-100 dark:border-white/10">
          {steps.map((step, i) => {
            const done = !!completed[step.id]
            return (
              <div
                key={step.id}
                className={`flex items-start gap-4 px-5 py-4 ${
                  i !== steps.length - 1 ? 'border-b border-gray-100 dark:border-white/10' : ''
                }`}
              >
                {/* Checkbox */}
                <button
                  onClick={() => toggle(step.id)}
                  className="mt-0.5 flex-shrink-0"
                >
                  {done
                    ? <CheckCircle size={20} className="text-[#34c759]" />
                    : <Circle size={20} className="text-[#d2d2d7]" />
                  }
                </button>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <p className={`text-sm font-medium ${done ? 'text-[#86868b] dark:text-[#8e8e93] line-through' : 'text-[#1d1d1f] dark:text-[#f5f5f7]'}`}>
                      {step.label}
                    </p>
                    {!step.required && (
                      <span className="badge bg-[#ff9500]/10 text-[#ff9500]">Recommended</span>
                    )}
                  </div>
                  <p className="text-xs text-[#86868b] dark:text-[#8e8e93]">{step.description}</p>
                </div>

                {/* CTA */}
                {!done && (
                  <a
                    href={step.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn-primary text-xs px-3 py-1.5 flex-shrink-0"
                    onClick={() => toggle(step.id)}
                  >
                    Create account <ExternalLink size={11} />
                  </a>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

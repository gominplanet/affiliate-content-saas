'use client'

import { useState } from 'react'
import { CheckCircle, Circle, ChevronDown, ChevronUp, ExternalLink } from 'lucide-react'

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
    label: 'Create your Hostinger account',
    description: 'Get web hosting + a domain for your affiliate blog. Takes 5 minutes.',
    href: 'https://geni.us/ANaArQ',
    required: true,
    done: false,
  },
  {
    id: 'vidiq',
    label: 'Create your VidIQ account',
    description: 'Connect your YouTube channel for keyword research, analytics and transcripts.',
    href: 'https://geni.us/I8Hz',
    required: true,
    done: false,
  },
  {
    id: 'geniuslink',
    label: 'Create a Geniuslink account',
    description: 'Recommended. Smart affiliate links that work globally and track every click.',
    href: 'https://geni.us/Y70p9R',
    required: false,
    done: false,
  },
]

export default function SetupChecklist() {
  const [completed, setCompleted] = useState<Record<string, boolean>>({})
  const [collapsed, setCollapsed] = useState(false)

  function toggle(id: string) {
    setCompleted((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  const allRequired = steps.filter((s) => s.required)
  const doneCount = allRequired.filter((s) => completed[s.id]).length
  const allDone = doneCount === allRequired.length

  if (allDone && collapsed) return null

  return (
    <div className={`card mb-6 overflow-hidden border ${allDone ? 'border-[#34c759]/30' : 'border-[#0071e3]/20'}`}>
      {/* Header */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-gray-50/60 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${
            allDone ? 'bg-[#34c759]/15 text-[#34c759]' : 'bg-[#0071e3]/10 text-[#0071e3]'
          }`}>
            {allDone ? '✓' : `${doneCount}/${allRequired.length}`}
          </div>
          <div className="text-left">
            <p className="text-sm font-semibold text-[#1d1d1f]">
              {allDone ? 'Setup complete!' : 'Get started — create your accounts'}
            </p>
            <p className="text-xs text-[#86868b]">
              {allDone
                ? 'All required accounts are set up.'
                : `${allRequired.length - doneCount} required step${allRequired.length - doneCount !== 1 ? 's' : ''} remaining`}
            </p>
          </div>
        </div>
        {collapsed ? <ChevronDown size={16} className="text-[#86868b]" /> : <ChevronUp size={16} className="text-[#86868b]" />}
      </button>

      {/* Steps */}
      {!collapsed && (
        <div className="border-t border-gray-100">
          {steps.map((step, i) => {
            const done = !!completed[step.id]
            return (
              <div
                key={step.id}
                className={`flex items-start gap-4 px-5 py-4 ${
                  i !== steps.length - 1 ? 'border-b border-gray-100' : ''
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
                    <p className={`text-sm font-medium ${done ? 'text-[#86868b] line-through' : 'text-[#1d1d1f]'}`}>
                      {step.label}
                    </p>
                    {!step.required && (
                      <span className="badge bg-[#ff9500]/10 text-[#ff9500]">Recommended</span>
                    )}
                  </div>
                  <p className="text-xs text-[#86868b]">{step.description}</p>
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

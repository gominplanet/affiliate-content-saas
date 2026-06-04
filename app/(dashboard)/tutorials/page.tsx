/**
 * All-in-one tutorial page. Lists every TUTORIALS entry (lib/tutorials.ts)
 * with its embed + a deep link to the page it lives on. Sidebar reaches
 * it between Analytics and Visit Blog.
 *
 * Converted to an RSC (#47) — no state, no effects, no handlers, just a map
 * over a constant. Removing 'use client' takes this whole page out of the
 * client bundle (Header + the lucide icons + Link all server-render fine),
 * shrinking the dashboard's per-route JS for one of the most-linked
 * sidebar destinations.
 */

import Link from 'next/link'
import { ArrowRight, GraduationCap } from 'lucide-react'
import PageHero from '@/components/layout/PageHero'
import { TUTORIALS } from '@/lib/tutorials'

export const metadata = { title: 'Tutorials' }

export default function TutorialsPage() {
  return (
    <>
      <PageHero
        title="Tutorials"
        subtitle="Every walkthrough in one place. Each section also shows its own tutorial at the top of the page — you can dismiss it inline and bring them all back from the sidebar."
      />

      <div className="max-w-3xl mx-auto flex flex-col gap-8">
        {TUTORIALS.map(t => (
          <section key={t.sectionKey} className="card p-5">
            <div className="flex items-start gap-3 mb-4">
              <div className="w-8 h-8 rounded-full bg-[#7C3AED]/10 flex items-center justify-center flex-shrink-0">
                <GraduationCap size={16} className="text-[#7C3AED]" />
              </div>
              <div className="flex-1 min-w-0">
                <h2 className="text-base font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">{t.title}</h2>
                <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0] mt-0.5">{t.description}</p>
              </div>
              <Link
                href={t.href}
                className="btn-secondary text-xs flex items-center gap-1.5 flex-shrink-0"
                title={`Go to ${t.title}`}
              >
                Open <ArrowRight size={11} />
              </Link>
            </div>
            <div className="aspect-video w-full rounded-lg overflow-hidden border border-gray-200 dark:border-white/10 bg-black">
              <iframe
                src={`https://www.youtube.com/embed/${t.videoId}`}
                title={t.title}
                frameBorder={0}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                allowFullScreen
                loading="lazy"
                className="w-full h-full"
              />
            </div>
          </section>
        ))}
      </div>
    </>
  )
}

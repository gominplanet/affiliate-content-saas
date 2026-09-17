// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// GET /api/cron/rehost-hotlinked
//
// Every two hours, move creators' pictures off our image server and onto their
// own sites. The sweep itself lives in lib/rehost-sweep, shared with the admin
// "Run now" button, because a scheduled run that only reports into a Vercel log
// cannot be checked by anyone: "nothing changed" reads the same whether it
// failed or whether it worked on a creator whose site you cannot see.
//
// Auth: Vercel cron sends `Authorization: Bearer ${CRON_SECRET}`.
import { NextResponse } from 'next/server'
import { runHotlinkedSweep } from '@/lib/rehost-sweep'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function GET(request: Request) {
  const auth = request.headers.get('authorization') ?? ''
  const secret = process.env.CRON_SECRET
  if (!secret) return NextResponse.json({ error: 'CRON_SECRET not set on server' }, { status: 500 })
  if (auth !== `Bearer ${secret}`) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const report = await runHotlinkedSweep()
  return NextResponse.json(report, { status: report.ok ? 200 : 500 })
}

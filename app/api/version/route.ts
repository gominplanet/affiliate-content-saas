// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// GET /api/version — which commit is actually serving this request.
//
// Written because there was no way to answer that question. Vercel reports both
// the production and the branch-preview deployment to GitHub under the same
// status context, and GitHub keeps only the most recent one per context, so a
// "failure" on a commit could be either lane. That ambiguity produced three
// wrong calls in one day: a deploy reported as broken that had actually shipped,
// a claim that most pushes were not shipping when they were, and a config error
// chased for two extra builds because the first failure was read as the usual
// preview flake.
//
// The dashboard has the answer, but reading a screenshot is not a check you can
// run. This is: one request, no auth, and it names the commit.
//
// Public on purpose. A short commit SHA identifies a build and nothing else: it
// is not a credential, it grants no access, and without the repository it says
// nothing. The branch name is deliberately NOT included — `env` already
// distinguishes production from preview, which is the only thing anyone needs
// from here.
import { NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const sha = (process.env.VERCEL_GIT_COMMIT_SHA || '').slice(0, 7)
  return NextResponse.json(
    {
      // 'local' when running outside Vercel, so a dev machine cannot be mistaken
      // for a deployment.
      sha: sha || 'local',
      // 'production' | 'preview' | 'development'. The whole reason this exists:
      // the two Vercel lanes are indistinguishable from the outside otherwise.
      env: process.env.VERCEL_ENV || 'development',
    },
    // Never cached. A stale answer here is worse than no answer, because the
    // point is to know what is serving RIGHT NOW.
    { headers: { 'Cache-Control': 'no-store, max-age=0' } },
  )
}

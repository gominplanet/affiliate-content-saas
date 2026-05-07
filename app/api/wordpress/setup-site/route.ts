import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createWordPressService } from '@/services/wordpress'
import { generateHomePage } from '@/lib/wordpress-home-template'

export const maxDuration = 30

export async function POST(request: Request) {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { accentColor = '#f5a623' } = await request.json()

    // ── Load brand + WP credentials ──────────────────────────────────────────
    const [{ data: brand }, { data: integration }] = await Promise.all([
      supabase.from('brand_profiles').select('name,niches').eq('user_id', user.id).single(),
      supabase.from('integrations')
        .select('wordpress_url,wordpress_username,wordpress_app_password,wordpress_api_token')
        .eq('user_id', user.id).single(),
    ])

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b = brand as any
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const wp = integration as any

    if (!wp?.wordpress_url || !wp?.wordpress_username || !wp?.wordpress_app_password) {
      return NextResponse.json({ error: 'WordPress not connected' }, { status: 400 })
    }

    const brandName = b?.name || 'My Review Blog'
    const niches: string[] = Array.isArray(b?.niches) ? b.niches : []
    const siteUrl = wp.wordpress_url as string

    const wpService = createWordPressService(
      siteUrl,
      wp.wordpress_username,
      wp.wordpress_app_password,
      wp.wordpress_api_token || undefined,
    )

    // Verify credentials and role before doing anything
    const encoded = Buffer.from(`${wp.wordpress_username}:${wp.wordpress_app_password}`).toString('base64')
    const meRes = await fetch(`${siteUrl}/wp-json/wp/v2/users/me`, {
      headers: { Authorization: `Basic ${encoded}` },
    })
    if (!meRes.ok) {
      return NextResponse.json({
        error: 'WordPress authentication failed. Go back and reconnect with valid credentials.',
      }, { status: 400 })
    }
    const me = await meRes.json() as { name: string; roles?: string[] }
    const roles = me.roles || []
    if (!roles.some(r => ['administrator', 'editor'].includes(r))) {
      return NextResponse.json({
        error: `Your WordPress user "${me.name}" has the role "${roles[0] || 'unknown'}". An Administrator or Editor is required. Please change your role in WP Admin → Users, then try again.`,
      }, { status: 400 })
    }

    // Probe: verify POST requests actually work (LiteSpeed/Apache can strip
    // Authorization headers on POST even when GET succeeds).
    const probeRes = await fetch(`${siteUrl}/wp-json/wp/v2/posts`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${encoded}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ title: '__probe__', status: 'draft' }),
    })
    if (!probeRes.ok) {
      const probeBody = await probeRes.json().catch(() => ({})) as Record<string, unknown>
      const code = probeBody.code as string | undefined
      if (probeRes.status === 401 || code === 'rest_cannot_create' || code === 'rest_not_logged_in') {
        return NextResponse.json({
          error: 'auth_header_stripped',
          message: 'Your server is blocking write requests to WordPress. This is common on Hostinger / LiteSpeed hosting and is fixed with a one-line change to your .htaccess file.',
          fix: 'Open hPanel → File Manager → public_html → .htaccess, then add these two lines directly below the line that says "# BEGIN WordPress":\n\nRewriteEngine On\nRewriteRule .* - [E=HTTP_AUTHORIZATION:%{HTTP:Authorization}]\n\nSave the file, then click "Launch my site" again.',
        }, { status: 400 })
      }
      // Any other error — surface it
      return NextResponse.json({
        error: `WordPress write test failed (${probeRes.status}): ${JSON.stringify(probeBody).slice(0, 200)}`,
      }, { status: 400 })
    }
    // Clean up the probe post
    const probePost = await probeRes.json() as { id: number }
    await fetch(`${siteUrl}/wp-json/wp/v2/posts/${probePost.id}?force=true`, {
      method: 'DELETE',
      headers: { Authorization: `Basic ${encoded}` },
    }).catch(() => {/* non-fatal */})

    const steps: string[] = []

    // ── 1. Set site title ─────────────────────────────────────────────────────
    try {
      await wpService.setSiteSettings({ title: brandName, description: `${brandName} — honest product reviews` })
      steps.push('Site title updated')
    } catch { steps.push('Site title: skipped (permissions)') }

    // ── 2. Create categories ──────────────────────────────────────────────────
    const categories: { name: string; slug: string; id: number }[] = []
    for (const niche of niches) {
      try {
        const id = await wpService.createCategory(niche)
        const slug = niche.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
        categories.push({ name: niche, slug, id })
      } catch { /* skip if category creation fails */ }
    }
    if (categories.length) steps.push(`Categories created: ${categories.map(c => c.name).join(', ')}`)

    // ── 3. Create home page ───────────────────────────────────────────────────
    const { title, content } = generateHomePage({
      brandName,
      accentColor,
      categories,
      siteUrl,
    })

    const page = await wpService.createPage(title, content)
    steps.push(`Home page created (ID ${page.id})`)

    // ── 4. Set as front page ──────────────────────────────────────────────────
    try {
      await wpService.setSiteSettings({ show_on_front: 'page', page_on_front: page.id })
      steps.push('Front page set')
    } catch { steps.push('Front page: set manually in Settings → Reading') }

    // ── 5. Inject thumbnail CSS ───────────────────────────────────────────────
    const THUMBNAIL_CSS = `.post-thumbnail img,.wp-post-image,.wp-block-post-featured-image img,.entry-thumbnail img,.featured-image img{width:100%!important;height:auto!important;aspect-ratio:16/9;object-fit:cover}`
    try {
      await wpService.injectGlobalCss(THUMBNAIL_CSS, 'gomin-thumbnail-ratio')
      steps.push('Thumbnail CSS injected')
    } catch { /* non-fatal */ }

    // ── 6. Create nav menu ────────────────────────────────────────────────────
    const menuItems = [
      { title: 'All Reviews', url: siteUrl + '/' },
      ...categories.map(c => ({ title: c.name, url: `${siteUrl}/category/${c.slug}/` })),
    ]
    await wpService.createNavMenu(brandName, menuItems)
    steps.push('Nav menu created')

    return NextResponse.json({
      ok: true,
      siteUrl,
      pageUrl: page.link,
      steps,
      manualSteps: [
        'In WP Admin → Appearance → Menus: assign the new menu to "Primary" location',
      ],
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[/api/wordpress/setup-site]', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

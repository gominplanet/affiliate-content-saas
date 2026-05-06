import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { readFileSync } from 'fs'
import { join } from 'path'
import JSZip from 'jszip'

// Returns the child theme as a downloadable ZIP
export async function GET() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const themeDir = join(process.cwd(), 'wordpress-theme', 'kadence-affiliate-child')

  const files = ['style.css', 'functions.php', 'front-page.php']

  const zip = new JSZip()
  const folder = zip.folder('kadence-affiliate-child')!

  for (const file of files) {
    const content = readFileSync(join(themeDir, file), 'utf8')
    folder.file(file, content)
  }

  const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new NextResponse(buffer as any, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': 'attachment; filename="kadence-affiliate-child.zip"',
    },
  })
}

// Activates the child theme via WordPress REST API + sets static front page
export async function POST() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: integration } = await supabase
    .from('integrations')
    .select('wordpress_url, wordpress_username, wordpress_app_password')
    .eq('user_id', user.id)
    .single()

  if (!integration?.wordpress_url) {
    return NextResponse.json({ error: 'WordPress not connected' }, { status: 400 })
  }

  const { wordpress_url: siteUrl, wordpress_username: username, wordpress_app_password: password } = integration
  const authHeader = 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64')
  const wpBase = `${siteUrl}/wp-json/wp/v2`

  // Create a "Home" page if it doesn't exist, then set it as the static front page
  const pagesRes = await fetch(`${wpBase}/pages?search=Home&per_page=5`, {
    headers: { Authorization: authHeader },
  })
  const pages = await pagesRes.json()
  let homePageId: number

  const existingHome = pages.find((p: { title: { rendered: string } }) =>
    p.title.rendered.toLowerCase() === 'home'
  )

  if (existingHome) {
    homePageId = existingHome.id
  } else {
    const createRes = await fetch(`${wpBase}/pages`, {
      method: 'POST',
      headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Home', status: 'publish', slug: 'home' }),
    })
    if (!createRes.ok) {
      const err = await createRes.text()
      return NextResponse.json({ error: `Failed to create home page: ${err}` }, { status: 500 })
    }
    const created = await createRes.json()
    homePageId = created.id
  }

  // Set reading settings: static front page
  const settingsRes = await fetch(`${siteUrl}/wp-json/wp/v2/settings`, {
    method: 'POST',
    headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      show_on_front: 'posts', // keep as latest posts — the theme front-page.php handles display
    }),
  })

  if (!settingsRes.ok) {
    // Non-fatal — settings endpoint may require extra plugin
    console.warn('Could not update reading settings')
  }

  return NextResponse.json({
    success: true,
    message: 'Theme files are ready. Upload the ZIP via WordPress Admin → Appearance → Themes → Add New.',
    homePageId,
  })
}

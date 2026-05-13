import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { wpLogin, getNonce } from '@/lib/wordpress-login'
import { AFFILIATEOS_FULL_PHP, AFFILIATEOS_SNIPPET_NAME } from '@/lib/wordpress-plugin'

async function ensureCodeSnippet(
  siteUrl: string,
  cookies: string,
  nonce: string,
  name: string,
  code: string,
): Promise<void> {
  const headers = { Cookie: cookies, 'X-WP-Nonce': nonce, 'Content-Type': 'application/json' }
  const listRes = await fetch(`${siteUrl}/wp-json/code-snippets/v1/snippets`, { headers })
  if (!listRes.ok) throw new Error(`Code Snippets plugin responded ${listRes.status}. Is it installed and activated?`)
  const list = await listRes.json() as { snippets?: { id: number; name: string }[] }
  const snippets = list.snippets ?? (Array.isArray(list) ? list as { id: number; name: string }[] : [])
  const existing = snippets.find((s) => s.name === name)
  const payload = { name, code, active: true, scope: 'global' }
  if (existing) {
    await fetch(`${siteUrl}/wp-json/code-snippets/v1/snippets/${existing.id}`, {
      method: 'POST', headers, body: JSON.stringify(payload),
    })
  } else {
    await fetch(`${siteUrl}/wp-json/code-snippets/v1/snippets`, {
      method: 'POST', headers, body: JSON.stringify(payload),
    })
  }
}

// Inline PHP removed — now imported from @/lib/wordpress-plugin
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _INLINE_PHP_REMOVED = `
// ─── AffiliateOS — auto-installed by AffiliateOS dashboard ───────────────────
// Do not edit manually — use the AffiliateOS dashboard to manage settings.

if (!function_exists('affiliateos_get_data')) {

add_action('rest_api_init', function () {
    register_rest_route('affiliateos/v1', '/customizations', [
        [
            'methods'             => 'GET',
            'callback'            => 'affiliateos_get_customizations',
            'permission_callback' => '__return_true',
        ],
        [
            'methods'             => 'POST',
            'callback'            => 'affiliateos_save_customizations',
            'permission_callback' => '__return_true',
        ],
    ]);
});

function affiliateos_save_customizations(WP_REST_Request \$request) {
    \$data = \$request->get_json_params();
    update_option('affiliateos_customizations', \$data);
    do_action('litespeed_purge_all');
    if (function_exists('wp_cache_flush')) wp_cache_flush();
    return new WP_REST_Response(['saved' => true], 200);
}

function affiliateos_get_customizations() {
    return new WP_REST_Response(get_option('affiliateos_customizations', []), 200);
}

function affiliateos_get_data() {
    static \$cache = null;
    if (\$cache === null) \$cache = get_option('affiliateos_customizations', []);
    return \$cache;
}

function affiliateos_render_block(\$block) {
    if (empty(\$block['enabled'])) return;
    if ((\$block['type'] ?? 'image') === 'image') {
        \$img  = esc_url(\$block['imageUrl'] ?? '');
        \$link = esc_url(\$block['linkUrl'] ?? '');
        if (!\$img) return;
        echo '<div class="affiliateos-block affiliateos-image-block" style="margin:12px 0;width:350px;max-width:100%;">';
        if (\$link) echo '<a href="' . \$link . '" target="_blank" rel="nofollow noopener">';
        echo '<img src="' . \$img . '" alt="" style="width:100%;height:auto;display:block;" />';
        if (\$link) echo '</a>';
        echo '</div>';
    } else {
        \$html = \$block['html'] ?? '';
        if (!\$html) return;
        echo '<div class="affiliateos-block affiliateos-html-block" style="margin:12px 0;width:350px;max-width:100%;">';
        echo \$html;
        echo '</div>';
    }
}

// Sidebar blocks — rendered after the default sidebar widgets
add_action('kadence_after_sidebar_widget_area', function () {
    \$data    = affiliateos_get_data();
    \$sidebar = \$data['sidebar'] ?? [];
    foreach (\$sidebar as \$block) affiliateos_render_block(\$block);
});

// Also support standard WP sidebar hook for non-Kadence themes
add_action('dynamic_sidebar_after', function () {
    if (!doing_action('kadence_after_sidebar_widget_area')) {
        \$data    = affiliateos_get_data();
        \$sidebar = \$data['sidebar'] ?? [];
        foreach (\$sidebar as \$block) affiliateos_render_block(\$block);
    }
}, 10, 2);

// In-content blocks — injected after the specified paragraph
add_filter('the_content', function (\$content) {
    \$data      = affiliateos_get_data();
    \$incontent = \$data['incontent'] ?? [];
    if (empty(\$incontent) || !is_single()) return \$content;

    \$by_position = [];
    foreach (\$incontent as \$block) {
        if (empty(\$block['enabled'])) continue;
        \$pos = intval(\$block['position'] ?? 2);
        \$by_position[\$pos][] = \$block;
    }
    if (empty(\$by_position)) return \$content;

    \$parts = preg_split('/(<\\/p>)/i', \$content, -1, PREG_SPLIT_DELIM_CAPTURE);
    \$output     = '';
    \$para_count = 0;

    for (\$i = 0; \$i < count(\$parts); \$i++) {
        \$output .= \$parts[\$i];
        if (isset(\$parts[\$i]) && strtolower(\$parts[\$i]) === '</p>') {
            \$para_count++;
            if (isset(\$by_position[\$para_count])) {
                ob_start();
                foreach (\$by_position[\$para_count] as \$block) affiliateos_render_block(\$block);
                \$output .= ob_get_clean();
            }
        }
    }
    return \$output;
});

// Fix: ensure published posts show on archives/categories/homepage
add_action('pre_get_posts', function (WP_Query \$query) {
    if (is_admin() || !\$query->is_main_query()) return;
    if (is_home() || is_front_page()) {
        \$query->set('posts_per_page', 12);
        \$query->set('post_status', 'publish');
    }
    if (is_category() || is_tag() || is_archive() || is_search()) {
        \$query->set('posts_per_page', 12);
        \$query->set('post_status', 'publish');
        \$query->set('ignore_sticky_posts', false);
    }
});

// You Might Also Like — 8 random posts below main content
add_action('kadence_after_main_content', function () {
    if (!is_singular('post') && !is_home() && !is_front_page() && !is_archive()) return;
    \$exclude = is_singular('post') ? [get_the_ID()] : [];
    \$random_posts = new WP_Query([
        'post_type'           => 'post',
        'post_status'         => 'publish',
        'posts_per_page'      => 8,
        'orderby'             => 'rand',
        'post__not_in'        => \$exclude,
        'ignore_sticky_posts' => 1,
    ]);
    if (!\$random_posts->have_posts()) return;
    ?>
    <div class="affiliateos-random-posts" style="max-width:1200px;margin:48px auto;padding:0 20px;">
      <h3 style="font-size:1.1rem;font-weight:700;margin:0 0 20px;color:var(--global-palette1,#1a1a2e);">You Might Also Like</h3>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:20px;">
        <?php while (\$random_posts->have_posts()): \$random_posts->the_post(); ?>
        <a href="<?php the_permalink(); ?>" style="text-decoration:none;color:inherit;display:flex;flex-direction:column;border-radius:10px;overflow:hidden;border:1px solid #e5e5ea;transition:box-shadow .2s;" onmouseover="this.style.boxShadow='0 4px 16px rgba(0,0,0,.1)'" onmouseout="this.style.boxShadow='none'">
          <?php if (has_post_thumbnail()): ?>
          <div style="aspect-ratio:16/9;overflow:hidden;">
            <?php the_post_thumbnail('medium', ['style' => 'width:100%;height:100%;object-fit:cover;display:block;']); ?>
          </div>
          <?php endif; ?>
          <div style="padding:12px 14px 14px;">
            <p style="font-size:0.85rem;font-weight:600;margin:0;line-height:1.4;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;"><?php the_title(); ?></p>
          </div>
        </a>
        <?php endwhile; wp_reset_postdata(); ?>
      </div>
    </div>
    <?php
});

// Logo header banner — full-width bar at the very top of every page
add_action('wp_body_open', function () {
    \$data     = affiliateos_get_data();
    \$about    = \$data['about'] ?? [];
    \$logo_url = \$about['logoUrl'] ?? '';
    if (!\$logo_url) return;
    \$bg = (\$about['headerBg'] ?? 'black') === 'white' ? '#ffffff' : '#000000';
    ?>
    <div class="affiliateos-logo-banner" style="background:<?php echo \$bg; ?>;width:100%;padding:10px 20px;text-align:center;">
      <a href="<?php echo esc_url(home_url('/')); ?>" style="display:inline-block;line-height:0;">
        <img src="<?php echo esc_url(\$logo_url); ?>" alt="<?php echo esc_attr(get_bloginfo('name')); ?>" style="height:50px;width:auto;max-width:100%;object-fit:contain;" />
      </a>
    </div>
    <?php
}, 5);

// Also hook into kadence_before_header for Kadence theme support
add_action('kadence_before_header', function () {
    \$data     = affiliateos_get_data();
    \$about    = \$data['about'] ?? [];
    \$logo_url = \$about['logoUrl'] ?? '';
    if (!\$logo_url) return;
    \$bg = (\$about['headerBg'] ?? 'black') === 'white' ? '#ffffff' : '#000000';
    ?>
    <div class="affiliateos-logo-banner" style="background:<?php echo \$bg; ?>;width:100%;padding:10px 20px;text-align:center;">
      <a href="<?php echo esc_url(home_url('/')); ?>" style="display:inline-block;line-height:0;">
        <img src="<?php echo esc_url(\$logo_url); ?>" alt="<?php echo esc_attr(get_bloginfo('name')); ?>" style="height:50px;width:auto;max-width:100%;object-fit:contain;" />
      </a>
    </div>
    <?php
}, 5);

// Top social bar — slim strip above header (Kadence)
add_action('kadence_before_header', function () {
    \$data    = affiliateos_get_data();
    \$profile = \$data['profile'] ?? [];
    \$social_defs = [
        'youtubeUrl'   => ['label' => 'YouTube',   'svg' => '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.5 12 3.5 12 3.5s-7.5 0-9.4.6A3 3 0 0 0 .5 6.2C0 8.1 0 12 0 12s0 3.9.5 5.8a3 3 0 0 0 2.1 2.1C4.5 20.5 12 20.5 12 20.5s7.5 0 9.4-.6a3 3 0 0 0 2.1-2.1C24 15.9 24 12 24 12s0-3.9-.5-5.8zM9.8 15.5V8.5l6.3 3.5-6.3 3.5z"/></svg>'],
        'facebookUrl'  => ['label' => 'Facebook',  'svg' => '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M24 12.1C24 5.4 18.6 0 12 0S0 5.4 0 12.1C0 18.1 4.4 23.1 10.1 24v-8.4H7.1v-3.5h3V9.4c0-3 1.8-4.7 4.5-4.7 1.3 0 2.7.2 2.7.2v3h-1.5c-1.5 0-2 .9-2 1.9v2.2h3.4l-.5 3.5H14V24C19.6 23.1 24 18.1 24 12.1z"/></svg>'],
        'instagramUrl' => ['label' => 'Instagram', 'svg' => '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.2c3.2 0 3.6 0 4.9.1 3.3.1 4.8 1.7 4.9 4.9.1 1.3.1 1.6.1 4.8 0 3.2 0 3.6-.1 4.8-.1 3.2-1.7 4.8-4.9 4.9-1.3.1-1.6.1-4.9.1-3.2 0-3.6 0-4.8-.1-3.3-.1-4.8-1.7-4.9-4.9C2.2 15.6 2.2 15.2 2.2 12c0-3.2 0-3.6.1-4.8C2.4 3.9 4 2.3 7.2 2.3c1.2-.1 1.6-.1 4.8-.1zM12 0C8.7 0 8.3 0 7.1.1 2.7.3.3 2.7.1 7.1.0 8.3 0 8.7 0 12c0 3.3 0 3.7.1 4.9.2 4.4 2.6 6.8 7 7C8.3 24 8.7 24 12 24c3.3 0 3.7 0 4.9-.1 4.4-.2 6.8-2.6 7-7 .1-1.2.1-1.6.1-4.9 0-3.3 0-3.7-.1-4.9C23.7 2.7 21.3.3 16.9.1 15.7 0 15.3 0 12 0zm0 5.8a6.2 6.2 0 1 0 0 12.4A6.2 6.2 0 0 0 12 5.8zm0 10.2a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm6.4-11.8a1.4 1.4 0 1 0 0 2.8 1.4 1.4 0 0 0 0-2.8z"/></svg>'],
        'tiktokUrl'    => ['label' => 'TikTok',    'svg' => '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M19.6 3.3A4.8 4.8 0 0 1 14.9 0h-3.6v16.4a2.9 2.9 0 0 1-2.9 2.5 2.9 2.9 0 0 1-2.9-2.9 2.9 2.9 0 0 1 2.9-2.9c.3 0 .5 0 .8.1V9.5a6.4 6.4 0 0 0-.8-.1 6.5 6.5 0 0 0-6.5 6.5 6.5 6.5 0 0 0 6.5 6.5 6.5 6.5 0 0 0 6.5-6.5V8.2a8.4 8.4 0 0 0 4.9 1.6V6.2a4.8 4.8 0 0 1-2.2-2.9z"/></svg>'],
        'twitterUrl'   => ['label' => 'X',         'svg' => '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M18.3 1.5h3.5L14.3 10l8.8 11.5H16l-5.2-6.8-6 6.8H1.3l8-9.2L1 1.5h7l4.7 6.2 5.6-6.2zm-1.2 18.5h1.9L7 3.4H5L17.1 20z"/></svg>'],
        'pinterestUrl' => ['label' => 'Pinterest', 'svg' => '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.4 0 0 5.4 0 12c0 5.1 3.2 9.5 7.8 11.2-.1-.9-.2-2.4.1-3.4.2-.8 1.5-6.5 1.5-6.5s-.4-.8-.4-1.9c0-1.8 1.1-3.2 2.4-3.2 1.1 0 1.7.8 1.7 1.8 0 1.1-.7 2.8-1 4.3-.3 1.3.6 2.3 1.8 2.3 2.1 0 3.6-2.3 3.6-5.5 0-2.9-2-4.9-4.9-4.9-3.3 0-5.3 2.5-5.3 5.1 0 1 .4 2.1.9 2.7.1.1.1.2.1.4-.1.4-.3 1.3-.3 1.5-.1.2-.2.3-.4.2-1.5-.7-2.4-2.9-2.4-4.7 0-3.8 2.8-7.4 8.1-7.4 4.2 0 7.5 3 7.5 7.1 0 4.2-2.6 7.6-6.3 7.6-1.2 0-2.4-.6-2.8-1.4l-.8 2.9c-.3 1-.9 2.2-1.4 3 1 .3 2.1.5 3.2.5 6.6 0 12-5.4 12-12C24 5.4 18.6 0 12 0z"/></svg>'],
    ];
    \$has_links = false;
    foreach (\$social_defs as \$key => \$_) {
        if (!empty(\$profile[\$key])) { \$has_links = true; break; }
    }
    if (!\$has_links) return;
    ?>
    <div class="affiliateos-topbar" style="background:var(--global-palette1,#1a1a2e);padding:6px 20px;">
      <div style="max-width:1200px;margin:0 auto;display:flex;align-items:center;justify-content:flex-end;gap:8px;">
        <?php foreach (\$social_defs as \$key => \$info):
            if (empty(\$profile[\$key])) continue;
        ?>
        <a href="<?php echo esc_url(\$profile[\$key]); ?>" target="_blank" rel="noopener" aria-label="<?php echo esc_attr(\$info['label']); ?>"
           style="display:flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:6px;background:rgba(255,255,255,0.1);color:#fff;text-decoration:none;">
          <?php echo \$info['svg']; ?>
        </a>
        <?php endforeach; ?>
      </div>
    </div>
    <?php
}, 10);

// Footer section — bio, socials, custom links
add_action('wp_footer', function () {
    \$data    = affiliateos_get_data();
    \$footer  = \$data['footer'] ?? [];
    \$profile = \$data['profile'] ?? [];
    \$bio          = trim(\$footer['bio'] ?? (\$profile['authorBio'] ?? (\$data['about']['bio'] ?? '')));
    \$socials      = \$footer['socials'] ?? [];
    if (empty(\$socials['youtube'])   && !empty(\$profile['youtubeUrl']))   \$socials['youtube']   = \$profile['youtubeUrl'];
    if (empty(\$socials['facebook'])  && !empty(\$profile['facebookUrl']))  \$socials['facebook']  = \$profile['facebookUrl'];
    if (empty(\$socials['instagram']) && !empty(\$profile['instagramUrl'])) \$socials['instagram'] = \$profile['instagramUrl'];
    if (empty(\$socials['threads'])   && !empty(\$profile['threadsUrl']))   \$socials['threads']   = \$profile['threadsUrl'];
    if (empty(\$socials['pinterest']) && !empty(\$profile['pinterestUrl'])) \$socials['pinterest'] = \$profile['pinterestUrl'];
    if (empty(\$socials['tiktok'])    && !empty(\$profile['tiktokUrl']))    \$socials['tiktok']    = \$profile['tiktokUrl'];
    if (empty(\$socials['twitter'])   && !empty(\$profile['twitterUrl']))   \$socials['twitter']   = \$profile['twitterUrl'];
    if (empty(\$socials['contact'])   && !empty(\$profile['contactEmail'])) \$socials['contact']   = \$profile['contactEmail'];
    \$links        = \$footer['links'] ?? [];
    \$headshot_url = trim(\$profile['headshotUrl'] ?? '');
    \$author_name  = trim(\$profile['authorName'] ?? '');
    if (!\$bio && !\$headshot_url && !\$author_name && empty(array_filter((array)\$socials)) && empty(\$links)) return;
    \$social_icons = [
        'youtube'   => ['label' => 'YouTube',   'svg' => '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.5 12 3.5 12 3.5s-7.5 0-9.4.6A3 3 0 0 0 .5 6.2C0 8.1 0 12 0 12s0 3.9.5 5.8a3 3 0 0 0 2.1 2.1C4.5 20.5 12 20.5 12 20.5s7.5 0 9.4-.6a3 3 0 0 0 2.1-2.1C24 15.9 24 12 24 12s0-3.9-.5-5.8zM9.8 15.5V8.5l6.3 3.5-6.3 3.5z"/></svg>'],
        'instagram' => ['label' => 'Instagram', 'svg' => '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.2c3.2 0 3.6 0 4.9.1 3.3.1 4.8 1.7 4.9 4.9.1 1.3.1 1.6.1 4.8 0 3.2 0 3.6-.1 4.8-.1 3.2-1.7 4.8-4.9 4.9-1.3.1-1.6.1-4.9.1-3.2 0-3.6 0-4.8-.1-3.3-.1-4.8-1.7-4.9-4.9C2.2 15.6 2.2 15.2 2.2 12c0-3.2 0-3.6.1-4.8C2.4 3.9 4 2.3 7.2 2.3c1.2-.1 1.6-.1 4.8-.1zM12 0C8.7 0 8.3 0 7.1.1 2.7.3.3 2.7.1 7.1.0 8.3 0 8.7 0 12c0 3.3 0 3.7.1 4.9.2 4.4 2.6 6.8 7 7C8.3 24 8.7 24 12 24c3.3 0 3.7 0 4.9-.1 4.4-.2 6.8-2.6 7-7 .1-1.2.1-1.6.1-4.9 0-3.3 0-3.7-.1-4.9C23.7 2.7 21.3.3 16.9.1 15.7 0 15.3 0 12 0zm0 5.8a6.2 6.2 0 1 0 0 12.4A6.2 6.2 0 0 0 12 5.8zm0 10.2a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm6.4-11.8a1.4 1.4 0 1 0 0 2.8 1.4 1.4 0 0 0 0-2.8z"/></svg>'],
        'tiktok'    => ['label' => 'TikTok',    'svg' => '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M19.6 3.3A4.8 4.8 0 0 1 14.9 0h-3.6v16.4a2.9 2.9 0 0 1-2.9 2.5 2.9 2.9 0 0 1-2.9-2.9 2.9 2.9 0 0 1 2.9-2.9c.3 0 .5 0 .8.1V9.5a6.4 6.4 0 0 0-.8-.1 6.5 6.5 0 0 0-6.5 6.5 6.5 6.5 0 0 0 6.5 6.5 6.5 6.5 0 0 0 6.5-6.5V8.2a8.4 8.4 0 0 0 4.9 1.6V6.2a4.8 4.8 0 0 1-2.2-2.9z"/></svg>'],
        'twitter'   => ['label' => 'X',         'svg' => '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M18.3 1.5h3.5L14.3 10l8.8 11.5H16l-5.2-6.8-6 6.8H1.3l8-9.2L1 1.5h7l4.7 6.2 5.6-6.2zm-1.2 18.5h1.9L7 3.4H5L17.1 20z"/></svg>'],
        'pinterest' => ['label' => 'Pinterest', 'svg' => '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.4 0 0 5.4 0 12c0 5.1 3.2 9.5 7.8 11.2-.1-.9-.2-2.4.1-3.4.2-.8 1.5-6.5 1.5-6.5s-.4-.8-.4-1.9c0-1.8 1.1-3.2 2.4-3.2 1.1 0 1.7.8 1.7 1.8 0 1.1-.7 2.8-1 4.3-.3 1.3.6 2.3 1.8 2.3 2.1 0 3.6-2.3 3.6-5.5 0-2.9-2-4.9-4.9-4.9-3.3 0-5.3 2.5-5.3 5.1 0 1 .4 2.1.9 2.7.1.1.1.2.1.4-.1.4-.3 1.3-.3 1.5-.1.2-.2.3-.4.2-1.5-.7-2.4-2.9-2.4-4.7 0-3.8 2.8-7.4 8.1-7.4 4.2 0 7.5 3 7.5 7.1 0 4.2-2.6 7.6-6.3 7.6-1.2 0-2.4-.6-2.8-1.4l-.8 2.9c-.3 1-.9 2.2-1.4 3 1 .3 2.1.5 3.2.5 6.6 0 12-5.4 12-12C24 5.4 18.6 0 12 0z"/></svg>'],
        'facebook'  => ['label' => 'Facebook',  'svg' => '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M24 12.1C24 5.4 18.6 0 12 0S0 5.4 0 12.1C0 18.1 4.4 23.1 10.1 24v-8.4H7.1v-3.5h3V9.4c0-3 1.8-4.7 4.5-4.7 1.3 0 2.7.2 2.7.2v3h-1.5c-1.5 0-2 .9-2 1.9v2.2h3.4l-.5 3.5H14V24C19.6 23.1 24 18.1 24 12.1z"/></svg>'],
        'threads'   => ['label' => 'Threads',   'svg' => '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12.2 2C7 2 3.7 5.5 3.7 10.5c0 3.3 1.4 5.8 3.8 7.2-.3.8-.4 1.7-.3 2.5.2 1.1.9 1.9 1.9 2.3.3.1.7.1 1 .1 1.3 0 2.6-.7 3.3-1.8.6.1 1.2.2 1.8.2 5.3 0 8.5-3.5 8.5-8.5S17.5 2 12.2 2zm.8 15c-.5 0-1-.1-1.5-.2l-.7-.2-.4.6c-.4.7-1.2 1.1-1.9 1-.4-.1-.7-.4-.8-.9-.1-.5 0-1 .2-1.5l.3-.7-.7-.3C5.6 14.5 4.7 12.8 4.7 10.5c0-4.2 2.7-7.5 7.5-7.5 4.5 0 7.5 3 7.5 7.5 0 4.3-2.8 7.5-7.5 7.5l-.2-.1v.1z"/></svg>'],
        'contact'   => ['label' => 'Contact',   'svg' => '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4-8 5-8-5V6l8 5 8-5v2z"/></svg>'],
    ];
    ?>
    <div class="affiliateos-footer" style="background:var(--global-palette1,#1a1a2e);color:#fff;padding:40px 20px;">
      <div style="max-width:1200px;margin:0 auto;display:flex;flex-wrap:wrap;gap:32px;align-items:flex-start;">
        <?php if (\$headshot_url || \$author_name || \$bio): ?>
        <div style="flex:1;min-width:220px;display:flex;gap:16px;align-items:flex-start;">
          <?php if (\$headshot_url): ?>
          <img src="<?php echo esc_url(\$headshot_url); ?>" alt="<?php echo esc_attr(\$author_name); ?>" style="width:60px;height:60px;border-radius:50%;object-fit:cover;flex-shrink:0;border:2px solid rgba(255,255,255,0.2);" />
          <?php endif; ?>
          <div>
            <?php if (\$author_name): ?>
            <p style="font-size:0.9rem;font-weight:700;margin:0 0 4px;"><?php echo esc_html(\$author_name); ?></p>
            <?php endif; ?>
            <?php if (\$bio): ?>
            <p style="font-size:0.875rem;line-height:1.6;opacity:0.8;margin:0;"><?php echo esc_html(\$bio); ?></p>
            <?php endif; ?>
          </div>
        </div>
        <?php endif; ?>
        <?php
        \$has_socials = false;
        foreach (\$social_icons as \$key => \$info) {
            if (!empty(\$socials[\$key])) { \$has_socials = true; break; }
        }
        if (\$has_socials): ?>
        <div style="min-width:160px;">
          <p style="font-size:0.75rem;font-weight:600;text-transform:uppercase;letter-spacing:.08em;opacity:.5;margin:0 0 12px;">Follow</p>
          <div style="display:flex;flex-wrap:wrap;gap:10px;">
            <?php foreach (\$social_icons as \$key => \$info):
                if (empty(\$socials[\$key])) continue;
                \$href = (\$key === 'contact') ? 'mailto:' . antispambot(\$socials[\$key]) : esc_url(\$socials[\$key]);
            ?>
            <a href="<?php echo \$href; ?>" <?php if (\$key !== 'contact') echo 'target="_blank" rel="noopener"'; ?> aria-label="<?php echo esc_attr(\$info['label']); ?>"
               style="display:flex;align-items:center;justify-content:center;width:36px;height:36px;border-radius:8px;background:rgba(255,255,255,.12);color:#fff;text-decoration:none;">
              <?php echo \$info['svg']; ?>
            </a>
            <?php endforeach; ?>
          </div>
        </div>
        <?php endif; ?>
        <?php if (!empty(\$links)): ?>
        <div style="min-width:140px;">
          <p style="font-size:0.75rem;font-weight:600;text-transform:uppercase;letter-spacing:.08em;opacity:.5;margin:0 0 12px;">Links</p>
          <ul style="list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px;">
            <?php foreach (\$links as \$link):
                if (empty(\$link['label']) || empty(\$link['url'])) continue;
            ?>
            <li>
              <a href="<?php echo esc_url(\$link['url']); ?>" style="color:rgba(255,255,255,.75);text-decoration:none;font-size:0.875rem;"><?php echo esc_html(\$link['label']); ?></a>
            </li>
            <?php endforeach; ?>
          </ul>
        </div>
        <?php endif; ?>
      </div>
    </div>
    <?php
}, 20); // wp_footer priority 20 — before the default footer

// Also hook kadence_before_footer for Kadence theme
add_action('kadence_before_footer', function () {
    do_action('affiliateos_render_footer');
});

} // end if (!function_exists('affiliateos_get_data'))
`

// ── GET: check if AffiliateOS is already active on the site ──────────────────

export async function GET() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: intRow } = await (supabase as any)
    .from('integrations')
    .select('wordpress_url, wordpress_username, wordpress_app_password')
    .eq('user_id', user.id)
    .single()

  if (!intRow?.wordpress_url) {
    return NextResponse.json({ status: 'no_wp', message: 'No WordPress site connected yet.' })
  }

  const siteUrl = intRow.wordpress_url.replace(/\/$/, '')

  // Ping the AffiliateOS endpoint — if it responds it's already installed
  try {
    const res = await fetch(`${siteUrl}/wp-json/affiliateos/v1/customizations`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
    })
    if (res.ok) {
      return NextResponse.json({ status: 'active', siteUrl })
    }
    return NextResponse.json({ status: 'not_installed', siteUrl })
  } catch {
    return NextResponse.json({ status: 'not_installed', siteUrl })
  }
}

// ── POST: install / update the AffiliateOS Code Snippet ──────────────────────

export async function POST() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: intRow } = await (supabase as any)
    .from('integrations')
    .select('wordpress_url, wordpress_username, wordpress_app_password, wordpress_api_token')
    .eq('user_id', user.id)
    .single()

  if (!intRow?.wordpress_url || !intRow?.wordpress_username) {
    return NextResponse.json({ error: 'WordPress credentials not found. Save your WordPress URL and username first.' }, { status: 400 })
  }

  const siteUrl = intRow.wordpress_url.replace(/\/$/, '')
  const username = intRow.wordpress_username
  // Prefer the original admin password (wordpress_api_token) for login; fall back to app password
  const password = intRow.wordpress_api_token || intRow.wordpress_app_password

  if (!password) {
    return NextResponse.json({ error: 'WordPress password not found. Please re-enter your credentials in Integrations.' }, { status: 400 })
  }

  try {
    // 1. Login to get session cookies
    const loginResult = await wpLogin(siteUrl, username, password)
    if (!loginResult.ok) {
      const msg = loginResult.reason === 'unreachable'
        ? 'Could not reach your WordPress site. Check the URL in Integrations.'
        : 'WordPress login failed. Check your username and password in Integrations.'
      return NextResponse.json({ error: msg }, { status: 400 })
    }
    const cookies = loginResult.cookies

    // 2. Get nonce
    const nonce = await getNonce(siteUrl, cookies)

    // 3. Push the Code Snippet
    await ensureCodeSnippet(siteUrl, cookies, nonce, AFFILIATEOS_SNIPPET_NAME, AFFILIATEOS_FULL_PHP)

    return NextResponse.json({ ok: true, message: 'AffiliateOS installed successfully! Your site now supports banners, social bar, footer, and logo header.' })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[install-plugin] error:', msg)

    if (msg.includes('Code Snippets plugin')) {
      return NextResponse.json({
        error: 'code_snippets_missing',
        message: 'The Code Snippets plugin is not installed on your site.',
        installUrl: `${siteUrl}/wp-admin/plugin-install.php?s=code+snippets&tab=search&type=term`,
      }, { status: 422 })
    }

    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

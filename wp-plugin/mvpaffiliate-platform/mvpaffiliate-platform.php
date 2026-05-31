<?php
/**
 * Plugin Name: MVP Affiliate Platform
 * Plugin URI: https://www.mvpaffiliate.io
 * Description: Connects this WordPress site to the MVP Affiliate dashboard. Provides REST endpoints, blog customizations, banners, social bar, footer, logo header, and "You might also like" section.
 * Version: 1.0.22
 * Author: MVP Affiliate
 * Author URI: https://www.mvpaffiliate.io
 * License: GPLv2 or later
 * Text Domain: mvpaffiliate-platform
 * Requires at least: 5.6
 * Requires PHP: 7.4
 */

if (!defined('ABSPATH')) exit;

define('MVP_AFFILIATE_VERSION', '1.0.22');

// ─── 0. allow MVP to receive Authorize-Application redirects ──────────────────
// WordPress core's wp-admin/authorize-application.php calls wp_safe_redirect()
// after the user clicks "Yes, I approve" — and wp_safe_redirect() silently
// rewrites cross-domain destinations to the wp-admin dashboard unless the
// target host is in `allowed_redirect_hosts`. That's a CSRF safeguard, but
// it also blocks our one-click OAuth flow (user gets dumped at wp-admin and
// the freshly minted Application Password is lost).
//
// Whitelist mvpaffiliate.io explicitly so the post-approval redirect carries
// the credentials back to our /api/wordpress/oauth-callback. Scoped to just
// our own domains — doesn't widen the allowlist for any other host.
add_filter('allowed_redirect_hosts', function ($hosts) {
    $hosts[] = 'mvpaffiliate.io';
    $hosts[] = 'www.mvpaffiliate.io';
    return $hosts;
});

// ─── 1. Authorization header fix ───────────────────────────────────────────────
// Runs at every PHP request, before WordPress REST auth checks.
// Hostinger, SiteGround, and some shared Apache configs strip the Authorization
// header before PHP sees it, but leave it as REDIRECT_HTTP_AUTHORIZATION.
if (!isset($_SERVER['HTTP_AUTHORIZATION']) && isset($_SERVER['REDIRECT_HTTP_AUTHORIZATION'])) {
    $_SERVER['HTTP_AUTHORIZATION'] = $_SERVER['REDIRECT_HTTP_AUTHORIZATION'];
}

// ─── 2. Activation: patch .htaccess for hosts where PHP-level fix isn't enough ─
register_activation_hook(__FILE__, 'mvp_affiliate_activate');
if (!function_exists('mvp_affiliate_activate')) {
    function mvp_affiliate_activate() {
        $htaccess = ABSPATH . '.htaccess';
        if (file_exists($htaccess) && is_writable($htaccess)) {
            $content = file_get_contents($htaccess);
            if (strpos($content, 'MVP Affiliate — forward Authorization') === false) {
                $fix = "# MVP Affiliate — forward Authorization header to PHP\n"
                    . "<IfModule mod_rewrite.c>\n"
                    . "RewriteEngine On\n"
                    . "RewriteCond %{HTTP:Authorization} .\n"
                    . "RewriteRule .* - [E=HTTP_AUTHORIZATION:%{HTTP:Authorization}]\n"
                    . "</IfModule>\n\n";
                file_put_contents($htaccess, $fix . $content);
            }
        }
        if (!get_option('mvp_affiliate_installed_at')) {
            update_option('mvp_affiliate_installed_at', time());
        }
        if (!get_option('affiliateos_indexnow_key')) {
            update_option('affiliateos_indexnow_key', bin2hex(random_bytes(16)));
        }
    }
}

// ─── 2b. IndexNow — instant Bing/Copilot/Yandex indexing ──────────────────────
// MVP's dashboard submits URLs to IndexNow, which verifies site ownership by
// fetching a key file at https://thissite/{key}.txt. We generate a per-site key
// (lazily, so already-active installs get one) and serve that file. The key is
// reported to the dashboard via /status so MVP can sign its submissions.
if (!function_exists('mvp_affiliate_indexnow_key')) {
    function mvp_affiliate_indexnow_key() {
        $key = get_option('affiliateos_indexnow_key');
        if (!$key) {
            $key = bin2hex(random_bytes(16)); // 32 hex chars
            update_option('affiliateos_indexnow_key', $key);
        }
        return $key;
    }
}
add_action('init', function () {
    $key = get_option('affiliateos_indexnow_key');
    if (!$key) return;
    $path = trim((string) (parse_url($_SERVER['REQUEST_URI'] ?? '', PHP_URL_PATH) ?: ''), '/');
    if ($path === $key . '.txt') {
        header('Content-Type: text/plain; charset=utf-8');
        echo $key;
        exit;
    }
});

// ─── 2c. Self-healing on publish: purge sitemap cache + ping IndexNow ─────────
// WordPress builds the sitemap dynamically, but hosts (LiteSpeed/Hostinger,
// SiteGround, etc.) cache the sitemap response for days — so a freshly
// published post can sit out of the sitemap until the cache TTL lapses (the
// "missing from sitemap" problem). On publish we purge the sitemap URLs and
// ping IndexNow so the new post is discoverable immediately on Bing/Copilot.
if (!function_exists('mvp_affiliate_purge_sitemap_cache')) {
    function mvp_affiliate_purge_sitemap_cache() {
        $urls = array(
            home_url('/wp-sitemap.xml'),
            home_url('/wp-sitemap-posts-post-1.xml'),
            home_url('/sitemap.xml'),
            home_url('/sitemap_index.xml'),
            home_url('/post-sitemap.xml'),
        );
        // LiteSpeed Cache (Hostinger) — precise per-URL purge.
        foreach ($urls as $u) { do_action('litespeed_purge_url', $u); }
        // SiteGround Optimizer — no public per-URL purge, so flush dynamic cache.
        do_action('sg_cachepress_purge_cache');
        // Other common caches (no-op if the plugin/function isn't present).
        if (function_exists('rocket_clean_domain')) { rocket_clean_domain(); }
        if (function_exists('w3tc_flush_all')) { w3tc_flush_all(); }
        if (function_exists('wp_cache_clear_cache')) { wp_cache_clear_cache(); }
        // Core object cache (the dynamic sitemap reads from it).
        wp_cache_flush();
    }
}
if (!function_exists('mvp_affiliate_indexnow_submit')) {
    function mvp_affiliate_indexnow_submit($urls) {
        $key = get_option('affiliateos_indexnow_key');
        if (!$key || empty($urls)) return;
        $host = wp_parse_url(home_url(), PHP_URL_HOST);
        if (!$host) return;
        wp_remote_post('https://api.indexnow.org/indexnow', array(
            'headers'  => array('Content-Type' => 'application/json; charset=utf-8'),
            'body'     => wp_json_encode(array(
                'host'        => $host,
                'key'         => $key,
                'keyLocation' => home_url('/' . $key . '.txt'),
                'urlList'     => array_values(array_unique($urls)),
            )),
            'timeout'  => 8,
            'blocking' => false, // fire-and-forget — never delay the publish
        ));
    }
}
add_action('transition_post_status', function ($new_status, $old_status, $post) {
    if (!$post || $post->post_type !== 'post' || $new_status !== 'publish') return;
    if (wp_is_post_revision($post->ID) || wp_is_post_autosave($post->ID)) return;
    mvp_affiliate_purge_sitemap_cache();
    mvp_affiliate_indexnow_submit(array(get_permalink($post->ID)));
}, 20, 3);

// ─── 3. Data accessor ─────────────────────────────────────────────────────────
if (!function_exists('mvp_affiliate_get_data')) {
    function mvp_affiliate_get_data() {
        static $cache = null;
        if ($cache === null) $cache = get_option('affiliateos_customizations', []);
        return $cache;
    }
}

// ─── 4. REST endpoints ────────────────────────────────────────────────────────
add_action('rest_api_init', function () {
    register_rest_route('affiliateos/v1', '/customizations', [
        [
            'methods'             => 'GET',
            'callback'            => 'mvp_affiliate_rest_get_customizations',
            'permission_callback' => '__return_true',
        ],
        [
            'methods'             => 'POST',
            'callback'            => 'mvp_affiliate_rest_save_customizations',
            'permission_callback' => function () { return current_user_can('manage_options'); },
        ],
    ]);
});

if (!function_exists('mvp_affiliate_rest_get_customizations')) {
    function mvp_affiliate_rest_get_customizations() {
        return new WP_REST_Response(get_option('affiliateos_customizations', []), 200);
    }
}

if (!function_exists('mvp_affiliate_rest_save_customizations')) {
    function mvp_affiliate_rest_save_customizations(WP_REST_Request $request) {
        $data = $request->get_json_params();
        update_option('affiliateos_customizations', $data);
        do_action('litespeed_purge_all');
        if (function_exists('wp_cache_flush')) wp_cache_flush();
        return new WP_REST_Response(['saved' => true], 200);
    }
}

// ─── 5. Block renderer (shared by sidebar + in-content) ───────────────────────
// Guarded — the MVP Affiliate theme defines a string-returning version of this
// with the same name. Without the guard, activating the plugin while the theme
// is active triggers a "Cannot redeclare" fatal error.
if (!function_exists('mvp_affiliate_render_block')) {
    function mvp_affiliate_render_block($block) {
        if (empty($block['enabled'])) return;
        if (($block['type'] ?? 'image') === 'image') {
            $img  = esc_url($block['imageUrl'] ?? '');
            $link = esc_url($block['linkUrl'] ?? '');
            if (!$img) return;
            echo '<div class="affiliateos-block affiliateos-image-block" style="margin:12px 0;width:350px;max-width:100%;">';
            if ($link) echo '<a href="' . $link . '" target="_blank" rel="nofollow noopener">';
            echo '<img src="' . $img . '" alt="" style="width:100%;height:auto;display:block;" />';
            if ($link) echo '</a>';
            echo '</div>';
        } else {
            $html = $block['html'] ?? '';
            if (!$html) return;
            echo '<div class="affiliateos-block affiliateos-html-block" style="margin:12px 0;width:350px;max-width:100%;">';
            echo $html;
            echo '</div>';
        }
    }
}

// ─── 6. Sidebar blocks ────────────────────────────────────────────────────────
add_action('kadence_after_sidebar_widget_area', function () {
    $sidebar = mvp_affiliate_get_data()['sidebar'] ?? [];
    foreach ($sidebar as $block) mvp_affiliate_render_block($block);
});
add_action('dynamic_sidebar_after', function () {
    if (!doing_action('kadence_after_sidebar_widget_area')) {
        $sidebar = mvp_affiliate_get_data()['sidebar'] ?? [];
        foreach ($sidebar as $block) mvp_affiliate_render_block($block);
    }
}, 10, 2);

// ─── 7. In-content blocks ─────────────────────────────────────────────────────
add_filter('the_content', function ($content) {
    $incontent = mvp_affiliate_get_data()['incontent'] ?? [];
    if (empty($incontent) || !is_single()) return $content;

    $by_position = [];
    foreach ($incontent as $block) {
        if (empty($block['enabled'])) continue;
        $pos = intval($block['position'] ?? 2);
        $by_position[$pos][] = $block;
    }
    if (empty($by_position)) return $content;

    $parts = preg_split('/(<\/p>)/i', $content, -1, PREG_SPLIT_DELIM_CAPTURE);
    $output = '';
    $para_count = 0;
    for ($i = 0; $i < count($parts); $i++) {
        $output .= $parts[$i];
        if (isset($parts[$i]) && strtolower($parts[$i]) === '</p>') {
            $para_count++;
            if (isset($by_position[$para_count])) {
                ob_start();
                foreach ($by_position[$para_count] as $block) mvp_affiliate_render_block($block);
                $output .= ob_get_clean();
            }
        }
    }
    return $output;
});

// ─── 8. Query fixes ───────────────────────────────────────────────────────────
add_action('pre_get_posts', function (WP_Query $query) {
    if (is_admin() || !$query->is_main_query()) return;
    if (is_home() || is_front_page()) {
        $query->set('posts_per_page', 12);
        $query->set('post_status', 'publish');
    }
    if (is_category() || is_tag() || is_archive() || is_search()) {
        $query->set('posts_per_page', 12);
        $query->set('post_status', 'publish');
        $query->set('ignore_sticky_posts', false);
    }
});

// ─── 9. "You might also like" ─────────────────────────────────────────────────
add_action('kadence_after_main_content', function () {
    if (mvp_affiliate_theme_active()) return;
    if (!is_singular('post') && !is_home() && !is_front_page() && !is_archive()) return;
    $exclude = is_singular('post') ? [get_the_ID()] : [];
    $random = new WP_Query([
        'post_type' => 'post', 'post_status' => 'publish',
        'posts_per_page' => 8, 'orderby' => 'rand',
        'post__not_in' => $exclude, 'ignore_sticky_posts' => 1,
    ]);
    if (!$random->have_posts()) return;
    ?>
    <div class="mvpaffiliate-random-posts" style="max-width:1200px;margin:48px auto;padding:0 20px;">
      <h3 style="font-size:1.1rem;font-weight:700;margin:0 0 20px;color:var(--global-palette1,#1a1a2e);">You Might Also Like</h3>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:20px;">
        <?php while ($random->have_posts()): $random->the_post(); ?>
        <a href="<?php the_permalink(); ?>" style="text-decoration:none;color:inherit;display:flex;flex-direction:column;border-radius:10px;overflow:hidden;border:1px solid #e5e5ea;">
          <?php if (has_post_thumbnail()): ?>
          <div style="aspect-ratio:16/9;overflow:hidden;"><?php the_post_thumbnail('medium', ['style' => 'width:100%;height:100%;object-fit:cover;display:block;']); ?></div>
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

// ─── Helper: is the MVP Affiliate theme active? ──────────────────────────────
// When the theme is active, it handles all rendering (logo banner, footer,
// social bar). The plugin's own renderers below skip themselves to avoid
// duplicate output.
if (!function_exists('mvp_affiliate_theme_active')) {
    function mvp_affiliate_theme_active(): bool {
        return apply_filters('mvp_affiliate_theme_active', false);
    }
}

// ─── 10. Logo header banner ───────────────────────────────────────────────────
// Renders on multiple hooks to survive themes/page templates that skip some hooks.
$mvp_affiliate_logo_banner = function () {
    if (mvp_affiliate_theme_active()) return;
    static $rendered = false;
    if ($rendered) return;
    $about = mvp_affiliate_get_data()['about'] ?? [];
    $logo_url = $about['logoUrl'] ?? '';
    if (!$logo_url) return;
    $rendered = true;
    $bg = ($about['headerBg'] ?? 'black') === 'white' ? '#ffffff' : '#000000';
    ?>
    <div class="mvpaffiliate-logo-banner" style="background:<?php echo $bg; ?>;width:100%;padding:10px 20px;text-align:center;position:relative;z-index:9999;">
      <a href="<?php echo esc_url(home_url('/')); ?>" style="display:inline-block;line-height:0;">
        <img src="<?php echo esc_url($logo_url); ?>" alt="<?php echo esc_attr(get_bloginfo('name')); ?>" style="height:80px;width:auto;max-width:100%;object-fit:contain;" />
      </a>
    </div>
    <?php
};
add_action('wp_body_open',            $mvp_affiliate_logo_banner, 5);
add_action('kadence_before_header',   $mvp_affiliate_logo_banner, 5);
add_action('get_header',              $mvp_affiliate_logo_banner, 5);
add_action('astra_header_before',     $mvp_affiliate_logo_banner, 5);
add_action('generate_before_header',  $mvp_affiliate_logo_banner, 5);

// Fallback: inject the banner via JS at <body> open if no hook fired by wp_footer.
// This guarantees the banner appears even on themes that don't call wp_body_open.
add_action('wp_footer', function () use ($mvp_affiliate_logo_banner) {
    if (mvp_affiliate_theme_active()) return;
    $about = mvp_affiliate_get_data()['about'] ?? [];
    $logo_url = $about['logoUrl'] ?? '';
    if (!$logo_url) return;
    $bg = ($about['headerBg'] ?? 'black') === 'white' ? '#ffffff' : '#000000';
    $name = esc_js(get_bloginfo('name'));
    $home = esc_js(home_url('/'));
    $logo_js = esc_js($logo_url);
    ?>
    <script>
    (function(){
      if (document.querySelector('.mvpaffiliate-logo-banner')) return;
      var div = document.createElement('div');
      div.className = 'mvpaffiliate-logo-banner';
      div.style.cssText = 'background:<?php echo $bg; ?>;width:100%;padding:10px 20px;text-align:center;position:relative;z-index:9999;';
      div.innerHTML = '<a href="<?php echo $home; ?>" style="display:inline-block;line-height:0;"><img src="<?php echo $logo_js; ?>" alt="<?php echo $name; ?>" style="height:80px;width:auto;max-width:100%;object-fit:contain;" /></a>';
      document.body.insertBefore(div, document.body.firstChild);
    })();
    </script>
    <?php
}, 1);

// ─── 11. Top social bar ───────────────────────────────────────────────────────
add_action('kadence_before_header', function () {
    if (mvp_affiliate_theme_active()) return;
    $profile = mvp_affiliate_get_data()['profile'] ?? [];
    $defs = [
        'youtubeUrl'   => 'YouTube',
        'facebookUrl'  => 'Facebook',
        'instagramUrl' => 'Instagram',
        'tiktokUrl'    => 'TikTok',
        'twitterUrl'   => 'X',
        'pinterestUrl' => 'Pinterest',
    ];
    $has = false;
    foreach ($defs as $k => $_) if (!empty($profile[$k])) { $has = true; break; }
    if (!$has) return;
    ?>
    <div class="mvpaffiliate-topbar" style="background:var(--global-palette1,#1a1a2e);padding:6px 20px;">
      <div style="max-width:1200px;margin:0 auto;display:flex;justify-content:flex-end;gap:8px;">
        <?php foreach ($defs as $k => $label):
            if (empty($profile[$k])) continue; ?>
        <a href="<?php echo esc_url($profile[$k]); ?>" target="_blank" rel="noopener" aria-label="<?php echo esc_attr($label); ?>"
           style="display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:6px;background:rgba(255,255,255,0.1);color:#fff;text-decoration:none;font-size:11px;font-weight:600;">
          <?php echo esc_html(substr($label, 0, 1)); ?>
        </a>
        <?php endforeach; ?>
      </div>
    </div>
    <?php
}, 10);

// ─── 12. Footer (bio + socials + custom links) ────────────────────────────────
add_action('wp_footer', function () {
    if (mvp_affiliate_theme_active()) return;
    $data    = mvp_affiliate_get_data();
    $footer  = $data['footer'] ?? [];
    $profile = $data['profile'] ?? [];
    // Fallback chain that falls through on empty strings (?? doesn't).
    $bio = '';
    foreach ([
        $footer['bio']            ?? '',
        $profile['authorBio']     ?? '',
        $data['about']['bio']     ?? '',
    ] as $candidate) {
        $candidate = trim((string)$candidate);
        if ($candidate !== '') { $bio = $candidate; break; }
    }
    $socials      = $footer['socials'] ?? [];
    if (empty($socials['youtube'])   && !empty($profile['youtubeUrl']))   $socials['youtube']   = $profile['youtubeUrl'];
    if (empty($socials['facebook'])  && !empty($profile['facebookUrl']))  $socials['facebook']  = $profile['facebookUrl'];
    if (empty($socials['instagram']) && !empty($profile['instagramUrl'])) $socials['instagram'] = $profile['instagramUrl'];
    if (empty($socials['threads'])   && !empty($profile['threadsUrl']))   $socials['threads']   = $profile['threadsUrl'];
    if (empty($socials['pinterest']) && !empty($profile['pinterestUrl'])) $socials['pinterest'] = $profile['pinterestUrl'];
    if (empty($socials['tiktok'])    && !empty($profile['tiktokUrl']))    $socials['tiktok']    = $profile['tiktokUrl'];
    if (empty($socials['twitter'])   && !empty($profile['twitterUrl']))   $socials['twitter']   = $profile['twitterUrl'];
    if (empty($socials['contact'])   && !empty($profile['contactEmail'])) $socials['contact']   = $profile['contactEmail'];
    $links        = $footer['links'] ?? [];
    $headshot_url = trim($profile['headshotUrl'] ?? '');
    $author_name  = trim($profile['authorName'] ?? '');
    if (!$bio && !$headshot_url && !$author_name && empty(array_filter((array)$socials)) && empty($links)) return;
    $social_labels = [
        'youtube'   => 'YouTube',
        'instagram' => 'Instagram',
        'tiktok'    => 'TikTok',
        'twitter'   => 'X',
        'pinterest' => 'Pinterest',
        'facebook'  => 'Facebook',
        'threads'   => 'Threads',
        'contact'   => 'Email',
    ];
    ?>
    <div class="mvpaffiliate-footer" style="background:var(--global-palette1,#1a1a2e);color:#fff;padding:40px 20px;">
      <div style="max-width:1200px;margin:0 auto;display:flex;flex-wrap:wrap;gap:32px;align-items:flex-start;">
        <?php if ($headshot_url || $author_name || $bio): ?>
        <div style="flex:1;min-width:220px;display:flex;gap:16px;align-items:flex-start;">
          <?php if ($headshot_url): ?>
          <img src="<?php echo esc_url($headshot_url); ?>" alt="<?php echo esc_attr($author_name); ?>" style="width:60px;height:60px;border-radius:50%;object-fit:cover;flex-shrink:0;border:2px solid rgba(255,255,255,0.2);" />
          <?php endif; ?>
          <div>
            <?php if ($author_name): ?>
            <p style="font-size:0.9rem;font-weight:700;margin:0 0 4px;"><?php echo esc_html($author_name); ?></p>
            <?php endif; ?>
            <?php if ($bio): ?>
            <p style="font-size:0.875rem;line-height:1.6;opacity:0.8;margin:0;"><?php echo esc_html($bio); ?></p>
            <?php endif; ?>
          </div>
        </div>
        <?php endif; ?>
        <?php $has_socials = false;
        foreach ($social_labels as $k => $_) if (!empty($socials[$k])) { $has_socials = true; break; }
        if ($has_socials): ?>
        <div style="min-width:160px;">
          <p style="font-size:0.75rem;font-weight:600;text-transform:uppercase;letter-spacing:.08em;opacity:.5;margin:0 0 12px;">Follow</p>
          <div style="display:flex;flex-wrap:wrap;gap:10px;">
            <?php foreach ($social_labels as $k => $label):
                if (empty($socials[$k])) continue;
                $href = ($k === 'contact') ? 'mailto:' . antispambot($socials[$k]) : esc_url($socials[$k]); ?>
            <a href="<?php echo $href; ?>" <?php if ($k !== 'contact') echo 'target="_blank" rel="noopener"'; ?> aria-label="<?php echo esc_attr($label); ?>"
               style="display:inline-flex;align-items:center;justify-content:center;width:36px;height:36px;border-radius:8px;background:rgba(255,255,255,.12);color:#fff;text-decoration:none;font-weight:600;font-size:12px;">
              <?php echo esc_html(substr($label, 0, 1)); ?>
            </a>
            <?php endforeach; ?>
          </div>
        </div>
        <?php endif; ?>
        <?php if (!empty($links)): ?>
        <div style="min-width:140px;">
          <p style="font-size:0.75rem;font-weight:600;text-transform:uppercase;letter-spacing:.08em;opacity:.5;margin:0 0 12px;">Links</p>
          <ul style="list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px;">
            <?php foreach ($links as $link):
                if (empty($link['label']) || empty($link['url'])) continue; ?>
            <li><a href="<?php echo esc_url($link['url']); ?>" style="color:rgba(255,255,255,.75);text-decoration:none;font-size:0.875rem;"><?php echo esc_html($link['label']); ?></a></li>
            <?php endforeach; ?>
          </ul>
        </div>
        <?php endif; ?>
      </div>
    </div>
    <?php
}, 20);

add_action('kadence_before_footer', function () { do_action('mvp_affiliate_render_footer'); });

// ─── 13. Force front page template — only when no MVP Affiliate Theme is active.
// When the theme is active it owns the homepage layout via front-page.php and we
// must NOT redirect WP to page.php (which would loop the_content() over every
// post and stack full articles on the homepage).
add_filter('frontpage_template', function ($t) {
    if (mvp_affiliate_theme_active()) return $t;
    return get_page_template();
});

// ─── 13b. Inject accent color as CSS overrides ────────────────────────────────
// Maps profile.primaryColor / profile.accentColor onto Kadence's global palette
// and common link/button selectors, so the brand color is reflected everywhere.
add_action('wp_head', function () {
    if (mvp_affiliate_theme_active()) return;
    $profile = mvp_affiliate_get_data()['profile'] ?? [];
    $primary = trim($profile['primaryColor'] ?? ($profile['accentColor'] ?? ''));
    if (!$primary) return;
    $secondary = trim($profile['secondaryColor'] ?? $primary);
    ?>
    <style id="mvp-affiliate-colors">
      :root {
        --global-palette1: <?php echo esc_attr($primary); ?>;
        --global-palette-highlight: <?php echo esc_attr($primary); ?>;
        --global-palette-highlight-alt: <?php echo esc_attr($secondary); ?>;
        --mvp-affiliate-primary: <?php echo esc_attr($primary); ?>;
        --mvp-affiliate-secondary: <?php echo esc_attr($secondary); ?>;
      }
      a, .entry-title a, .site-title a { color: <?php echo esc_attr($primary); ?>; }
      .wp-block-button__link, .button, button.btn-primary,
      .single-post .tagcloud a, .term-badge,
      a.kadence-tag, .post-categories a {
        background-color: <?php echo esc_attr($primary); ?> !important;
        border-color: <?php echo esc_attr($primary); ?> !important;
      }
    </style>
    <?php
}, 100);

// ─── 13c. SEO structured data (JSON-LD @graph + meta description + OpenGraph) ─
// The MVP Affiliate app generates per-post SEO data and sends it as registered
// post meta via the WP REST API. We register the meta (so REST accepts writes)
// and render it in <head> on single posts. No dependency on Yoast/RankMath.
add_action('init', function () {
    $args = [
        'type'          => 'string',
        'single'        => true,
        'show_in_rest'  => true,
        'auth_callback' => function () { return current_user_can('edit_posts'); },
    ];
    register_post_meta('post', 'mvp_jsonld', $args);
    register_post_meta('post', 'mvp_meta_description', $args);
    register_post_meta('post', 'mvp_og_image', $args);
});

add_action('wp_head', function () {
    if (!is_singular('post')) return;
    $post_id = get_queried_object_id();
    if (!$post_id) return;

    $desc   = trim((string) get_post_meta($post_id, 'mvp_meta_description', true));
    $og     = trim((string) get_post_meta($post_id, 'mvp_og_image', true));
    $jsonld = trim((string) get_post_meta($post_id, 'mvp_jsonld', true));

    if ($desc !== '') {
        echo "\n<meta name=\"description\" content=\"" . esc_attr($desc) . "\" />";
        echo "\n<meta property=\"og:description\" content=\"" . esc_attr($desc) . "\" />";
        echo "\n<meta name=\"twitter:description\" content=\"" . esc_attr($desc) . "\" />";
    }
    echo "\n<meta property=\"og:title\" content=\"" . esc_attr(get_the_title($post_id)) . "\" />";
    echo "\n<meta property=\"og:type\" content=\"article\" />";
    echo "\n<meta property=\"og:url\" content=\"" . esc_url(get_permalink($post_id)) . "\" />";
    echo "\n<meta property=\"og:site_name\" content=\"" . esc_attr(get_bloginfo('name')) . "\" />";
    echo "\n<meta property=\"article:published_time\" content=\"" . esc_attr(get_the_date('c', $post_id)) . "\" />";
    echo "\n<meta property=\"article:modified_time\" content=\"" . esc_attr(get_the_modified_date('c', $post_id)) . "\" />";
    // (Canonical is left to WP core / Kadence, which emit rel=canonical by
    //  default — adding our own would risk a duplicate canonical tag.)
    if ($og !== '') {
        echo "\n<meta property=\"og:image\" content=\"" . esc_url($og) . "\" />";
        echo "\n<meta name=\"twitter:card\" content=\"summary_large_image\" />";
        echo "\n<meta name=\"twitter:image\" content=\"" . esc_url($og) . "\" />";
    }
    if ($jsonld !== '') {
        // Decode + re-encode so only well-formed JSON is printed, and JSON_HEX_TAG
        // escapes < / > (neutralizes any "</script>" breakout). Never echo raw.
        $decoded = json_decode($jsonld, true);
        if (is_array($decoded)) {
            echo "\n<script type=\"application/ld+json\">"
               . wp_json_encode($decoded, JSON_UNESCAPED_UNICODE | JSON_HEX_TAG | JSON_HEX_AMP)
               . "</script>\n";
        }
    }
}, 5);

// ─── 13b. Custom <head> meta tags (site verification, etc.) ──────────────────
// Users paste verification tags (Google Search Console, Pinterest, Facebook,
// Bing…) in the dashboard's Customize Blog page. We print them in <head> on
// every page, but sanitize HARD: wp_kses only lets a bare <meta> through with
// a fixed attribute whitelist. Scripts, styles, event handlers, arbitrary
// HTML — all stripped. A malformed entry simply renders nothing.
add_action('wp_head', function () {
    $tags = mvp_affiliate_get_data()['headMetaTags'] ?? [];
    if (!is_array($tags) || empty($tags)) return;

    // Attribute whitelist. `content` is the HTML standard, but several
    // verification services use non-standard attributes:
    //   - Impact uses value=
    //   - some use itemprop=
    // All of these are inert metadata attrs (no script execution), so
    // they're safe to allow. Anything NOT listed here is stripped.
    $allowed = [
        'meta' => [
            'name'       => true,
            'property'   => true,
            'http-equiv' => true,
            'content'    => true,
            'value'      => true,
            'itemprop'   => true,
            'charset'    => true,
        ],
    ];

    echo "\n<!-- MVP Affiliate: custom meta -->\n";
    foreach ($tags as $raw) {
        if (!is_string($raw)) continue;
        $clean = trim(wp_kses($raw, $allowed));
        // After sanitisation it must still actually be a <meta> tag.
        if ($clean !== '' && stripos($clean, '<meta') === 0) {
            echo $clean . "\n";
        }
    }
}, 1);

// ─── 14. LiteSpeed REST cache fix (one-time, on activation) ───────────────────
add_action('admin_init', function () {
    if (get_option('mvp_affiliate_ls_patched')) return;
    update_option('litespeed.conf.cache-rest', 0);
    $conf = get_option('litespeed.conf', []);
    if (is_array($conf)) {
        $conf['cache-rest'] = 0;
        update_option('litespeed.conf', $conf);
    }
    if (class_exists('LiteSpeed\\Purge')) do_action('litespeed_purge_all');
    update_option('mvp_affiliate_ls_patched', 1);
});

// ─── 15. Admin menu + Connect page ────────────────────────────────────────────
add_action('admin_menu', function () {
    add_menu_page(
        'MVP Affiliate',
        'MVP Affiliate',
        'manage_options',
        'mvp-affiliate',
        'mvp_affiliate_admin_page',
        'dashicons-chart-line',
        30
    );
});

if (!function_exists('mvp_affiliate_admin_page')) {
function mvp_affiliate_admin_page() {
    if (!current_user_can('manage_options')) return;

    $current_user = wp_get_current_user();
    $site_url = home_url();
    $token = null;
    $token_error = null;
    $active_stylesheet = wp_get_theme()->get_stylesheet();
    $theme_installed   = $active_stylesheet === 'mvp-affiliate-theme'
        || $active_stylesheet === 'mvp-affiliate'
        || wp_get_theme('mvp-affiliate-theme')->exists();
    $theme_active = $active_stylesheet === 'mvp-affiliate-theme' || $active_stylesheet === 'mvp-affiliate';
    $theme_status_msg = null;

    // Handle theme install action
    if (!empty($_POST['mvp_affiliate_action']) && $_POST['mvp_affiliate_action'] === 'install_theme'
        && check_admin_referer('mvp_affiliate_install_theme')) {
        $result = mvp_affiliate_install_theme();
        if (is_wp_error($result)) {
            $theme_status_msg = ['error', $result->get_error_message()];
        } else {
            $theme_status_msg = ['success', 'MVP Affiliate theme installed and activated.'];
            $theme_installed = true;
            $theme_active    = true;
        }
    }

    // Handle connect action: generate Application Password + build token
    if (!empty($_POST['mvp_affiliate_action']) && $_POST['mvp_affiliate_action'] === 'generate_token'
        && check_admin_referer('mvp_affiliate_generate_token')) {
        $created = WP_Application_Passwords::create_new_application_password(
            $current_user->ID,
            ['name' => 'MVP Affiliate']
        );
        if (is_wp_error($created)) {
            $token_error = $created->get_error_message();
        } else {
            // create_new_application_password returns [unhashed_password, $item]
            $unhashed = $created[0];
            $payload = [
                'url'      => $site_url,
                'username' => $current_user->user_login,
                'password' => $unhashed,
                'version'  => MVP_AFFILIATE_VERSION,
            ];
            // base64url encode for URL/clipboard friendliness
            $token = rtrim(strtr(base64_encode(json_encode($payload)), '+/', '-_'), '=');
        }
    }

    ?>
    <div class="wrap" style="max-width:760px;">
      <h1 style="margin-bottom:6px;">MVP Affiliate</h1>
      <p style="color:#6e6e73;margin-top:0;">Two steps to wire this site to your MVP Affiliate dashboard — install the theme, then generate a connection token.</p>

      <?php if ($theme_status_msg): ?>
      <div class="notice notice-<?php echo esc_attr($theme_status_msg[0]); ?>" style="margin-top:16px;">
        <p><?php echo esc_html($theme_status_msg[1]); ?></p>
      </div>
      <?php endif; ?>

      <!-- Theme step -->
      <div style="background:#fff;border:1px solid #dcdcde;border-radius:8px;padding:20px;margin-top:20px;">
        <h2 style="font-size:16px;margin:0 0 4px;">Step 1 — Install the MVP Affiliate theme</h2>
        <p style="margin:0 0 12px;color:#6e6e73;">Editorial layout, hero card on the homepage, clean review-post pages, automatic brand colors. Built specifically for affiliate review sites.</p>
        <?php if ($theme_active): ?>
          <p style="color:#1d8348;margin:0;"><span class="dashicons dashicons-yes-alt" style="color:#1d8348;"></span> MVP Affiliate theme is active.</p>
        <?php else: ?>
          <form method="post" style="margin:0;">
            <?php wp_nonce_field('mvp_affiliate_install_theme'); ?>
            <input type="hidden" name="mvp_affiliate_action" value="install_theme" />
            <button type="submit" class="button button-primary">Install &amp; activate MVP Affiliate theme</button>
          </form>
          <p style="margin:10px 0 0;color:#86868b;font-size:12px;">This downloads the theme from MVP Affiliate, installs it, and activates it. Your existing posts and pages stay exactly as they are.</p>
        <?php endif; ?>
      </div>

      <!-- Connect step -->
      <div style="background:#fff;border:1px solid #dcdcde;border-radius:8px;padding:20px;margin-top:16px;">
        <h2 style="font-size:16px;margin:0 0 4px;">Step 2 — Get your Connection Token</h2>
        <p style="margin:0 0 12px;color:#6e6e73;">Generates a one-time token tied to a dedicated &quot;MVP Affiliate&quot; application password. Paste it into the MVP Affiliate setup wizard to finish the connection.</p>

        <?php if ($token_error): ?>
        <div class="notice notice-error inline" style="margin:0 0 12px;"><p><?php echo esc_html($token_error); ?></p></div>
        <?php endif; ?>

        <?php if ($token): ?>
        <p style="margin:0 0 8px;font-weight:600;">Your Connection Token:</p>
        <textarea readonly onclick="this.select();" style="width:100%;height:90px;font-family:monospace;font-size:12px;padding:10px;border:1px solid #dcdcde;border-radius:6px;background:#f6f7f7;"><?php echo esc_textarea($token); ?></textarea>
        <p style="margin:8px 0 0;color:#6e6e73;font-size:12px;">Copy this token and paste it in the MVP Affiliate setup wizard. Token is valid as long as the "MVP Affiliate" application password exists (manage in Users → Profile → Application Passwords).</p>
        <?php else: ?>
        <form method="post" style="margin:0;">
          <?php wp_nonce_field('mvp_affiliate_generate_token'); ?>
          <input type="hidden" name="mvp_affiliate_action" value="generate_token" />
          <button type="submit" class="button button-primary">Generate Connection Token</button>
        </form>
        <?php endif; ?>
      </div>

      <div style="margin-top:24px;color:#86868b;font-size:12px;">
        MVP Affiliate plugin v<?php echo esc_html(MVP_AFFILIATE_VERSION); ?> · Logged in as <strong><?php echo esc_html($current_user->user_login); ?></strong>
      </div>
    </div>
    <?php
}
} // end if (!function_exists('mvp_affiliate_admin_page'))

// ─── 16. MVP Affiliate theme installer ────────────────────────────────────────
if (!function_exists('mvp_affiliate_install_theme')) {
    function mvp_affiliate_install_theme() {
        $existing = wp_get_theme('mvp-affiliate-theme');
        if ($existing->exists()) {
            switch_theme('mvp-affiliate-theme');
            return true;
        }
        if (!class_exists('Theme_Upgrader')) {
            require_once ABSPATH . 'wp-admin/includes/class-wp-upgrader.php';
        }
        if (!class_exists('Automatic_Upgrader_Skin')) {
            require_once ABSPATH . 'wp-admin/includes/class-automatic-upgrader-skin.php';
        }
        $zip_url = 'https://www.mvpaffiliate.io/mvp-affiliate-theme.zip';
        $upgrader = new Theme_Upgrader(new Automatic_Upgrader_Skin());
        $result = $upgrader->install($zip_url);
        if (is_wp_error($result)) return $result;
        if (!$result) return new WP_Error('install_failed', 'Theme installation failed. The download URL may be unreachable.');
        switch_theme('mvp-affiliate-theme');
        return true;
    }
}

// ─── 17. Add settings link on Plugins page ────────────────────────────────────
add_filter('plugin_action_links_' . plugin_basename(__FILE__), function ($links) {
    array_unshift($links, '<a href="' . admin_url('admin.php?page=mvp-affiliate') . '">Connect</a>');
    return $links;
});

// ─── 18. Self-update: native "Update available" on the Plugins page ──────────
// Polls https://www.mvpaffiliate.io/api/wp-version (cached 6h, shared with
// the theme via a function_exists guard) and injects an entry into WP's
// plugin-update transient when a newer version is published. The user then
// gets the normal "update now" link — no delete-and-reinstall.
if (!function_exists('mvp_affiliate_fetch_remote_version')) {
    function mvp_affiliate_fetch_remote_version() {
        $cached = get_transient('mvp_affiliate_remote_version');
        if ($cached !== false) return $cached;
        $res = wp_remote_get('https://www.mvpaffiliate.io/api/wp-version', [
            'timeout' => 8,
            'headers' => ['Accept' => 'application/json'],
        ]);
        if (is_wp_error($res) || (int) wp_remote_retrieve_response_code($res) !== 200) {
            set_transient('mvp_affiliate_remote_version', null, 30 * MINUTE_IN_SECONDS);
            return null;
        }
        $data = json_decode(wp_remote_retrieve_body($res), true);
        if (!is_array($data)) return null;
        set_transient('mvp_affiliate_remote_version', $data, 6 * HOUR_IN_SECONDS);
        return $data;
    }
}

add_filter('pre_set_site_transient_update_plugins', function ($transient) {
    if (!is_object($transient)) return $transient;
    $info = mvp_affiliate_fetch_remote_version();
    if (empty($info['plugin']['version'])) return $transient;

    $basename = plugin_basename(__FILE__); // mvpaffiliate-platform/mvpaffiliate-platform.php
    $latest   = (string) $info['plugin']['version'];
    $package  = (string) ($info['plugin']['download_url'] ?? '');

    if ($package && version_compare(MVP_AFFILIATE_VERSION, $latest, '<')) {
        $transient->response[$basename] = (object) [
            'slug'        => 'mvpaffiliate-platform',
            'plugin'      => $basename,
            'new_version' => $latest,
            'url'         => 'https://www.mvpaffiliate.io',
            'package'     => $package,
        ];
    } else {
        unset($transient->response[$basename]);
    }
    return $transient;
});

// ── Prominent "update available" banner ─────────────────────────────────────
// Matches the theme's banner: a bold RED notice at the top of every wp-admin
// page when a newer plugin version is published, with a one-click "Update now"
// button. WordPress's native Plugins-page hint is easy to miss. Only renders
// for users who can update plugins; disappears once they're current.
add_action('admin_notices', function () {
    if (!current_user_can('update_plugins')) return;
    $info = mvp_affiliate_fetch_remote_version();
    if (empty($info['plugin']['version'])) return;
    $latest = (string) $info['plugin']['version'];
    if (!version_compare(MVP_AFFILIATE_VERSION, $latest, '<')) return;

    $basename   = plugin_basename(__FILE__);
    $update_url = wp_nonce_url(
        self_admin_url('update.php?action=upgrade-plugin&plugin=' . $basename),
        'upgrade-plugin_' . $basename
    );
    ?>
    <div class="notice notice-error" style="border-left-width:6px;border-left-color:#d63638;background:#fcf0f1;padding:16px 18px;">
      <p style="font-size:15px;margin:0 0 10px;color:#1d2327;">
        <span style="display:inline-block;font-weight:700;color:#d63638;">⚠ MVP Affiliate plugin update available — v<?php echo esc_html($latest); ?></span>
        <span style="opacity:.85;"> (you're on v<?php echo esc_html(MVP_AFFILIATE_VERSION); ?>). Update now to get the latest fixes and features.</span>
      </p>
      <p style="margin:0;">
        <a href="<?php echo esc_url($update_url); ?>" class="button button-primary" style="background:#d63638;border-color:#d63638;box-shadow:none;text-shadow:none;font-weight:600;">
          Update plugin now
        </a>
        <a href="<?php echo esc_url(self_admin_url('plugins.php')); ?>" style="margin-left:10px;color:#d63638;">View in Plugins</a>
      </p>
    </div>
    <?php
});

// "View details" modal on the Plugins page — minimal but prevents a WP error
// when the user clicks the version link on the update row.
add_filter('plugins_api', function ($result, $action, $args) {
    if ($action !== 'plugin_information' || empty($args->slug) || $args->slug !== 'mvpaffiliate-platform') {
        return $result;
    }
    $info = mvp_affiliate_fetch_remote_version();
    $latest = $info['plugin']['version'] ?? MVP_AFFILIATE_VERSION;
    return (object) [
        'name'          => 'MVP Affiliate Platform',
        'slug'          => 'mvpaffiliate-platform',
        'version'       => $latest,
        'author'        => 'MVP Affiliate',
        'homepage'      => 'https://www.mvpaffiliate.io',
        'download_link' => $info['plugin']['download_url'] ?? '',
        'sections'      => [
            'description' => 'Connects this WordPress site to the MVP Affiliate dashboard.',
        ],
    ];
}, 10, 3);

// ─── 19. Dashboard-driven update (no wp-admin trip) ──────────────────────────
// Two REST routes the MVP Affiliate dashboard calls with Basic Auth:
//   GET  /affiliateos/v1/status      -> installed plugin + theme versions
//   POST /affiliateos/v1/self-update -> pull + install the latest zips
//
// The dashboard compares /status against /api/wp-version to decide whether
// to show an "Update now" button, then hits /self-update on click.
add_action('rest_api_init', function () {
    register_rest_route('affiliateos/v1', '/status', [
        'methods'             => 'GET',
        'callback'            => 'mvp_affiliate_rest_status',
        'permission_callback' => function () { return current_user_can('manage_options'); },
    ]);
    register_rest_route('affiliateos/v1', '/self-update', [
        'methods'             => 'POST',
        'callback'            => 'mvp_affiliate_rest_self_update',
        'permission_callback' => function () { return current_user_can('manage_options'); },
    ]);
    // On-demand sitemap cache purge — lets the dashboard clear a stale host
    // cache so newly published posts appear in the sitemap immediately.
    register_rest_route('affiliateos/v1', '/purge-sitemap', [
        'methods'             => 'POST',
        'callback'            => function () {
            if (function_exists('mvp_affiliate_purge_sitemap_cache')) {
                mvp_affiliate_purge_sitemap_cache();
            }
            return new WP_REST_Response(['ok' => true], 200);
        },
        'permission_callback' => function () { return current_user_can('manage_options'); },
    ]);
});

if (!function_exists('mvp_affiliate_rest_status')) {
    function mvp_affiliate_rest_status() {
        $theme = wp_get_theme('mvp-affiliate-theme');
        return new WP_REST_Response([
            'plugin_version' => MVP_AFFILIATE_VERSION,
            'theme_version'  => $theme->exists() ? (string) $theme->get('Version') : null,
            'theme_active'   => (get_stylesheet() === 'mvp-affiliate-theme'),
            'indexnow_key'   => mvp_affiliate_indexnow_key(),
        ], 200);
    }
}

if (!function_exists('mvp_affiliate_rest_self_update')) {
    function mvp_affiliate_rest_self_update() {
        // Fresh version data — drop our 6h cache so we compare against the
        // true latest, not a stale value.
        delete_transient('mvp_affiliate_remote_version');
        $info = mvp_affiliate_fetch_remote_version();
        if (!$info) {
            return new WP_REST_Response(['error' => 'Could not reach the MVP Affiliate version endpoint.'], 502);
        }

        if (!class_exists('WP_Upgrader')) {
            require_once ABSPATH . 'wp-admin/includes/class-wp-upgrader.php';
        }
        if (!class_exists('Automatic_Upgrader_Skin')) {
            require_once ABSPATH . 'wp-admin/includes/class-automatic-upgrader-skin.php';
        }
        require_once ABSPATH . 'wp-admin/includes/file.php';
        require_once ABSPATH . 'wp-admin/includes/misc.php';
        require_once ABSPATH . 'wp-admin/includes/plugin.php';
        require_once ABSPATH . 'wp-admin/includes/class-plugin-upgrader.php';
        require_once ABSPATH . 'wp-admin/includes/class-theme-upgrader.php';

        $results = ['theme' => null, 'plugin' => null];

        // ── THEME: use the canonical transient + upgrade() path ─────────────
        // install()+overwrite is unreliable for the *active* theme (WP guards
        // the running theme dir). upgrade() against a primed update_themes
        // transient is exactly what wp-admin's "update now" does, and it
        // handles the active-theme swap correctly.
        $theme_latest = $info['theme']['version'] ?? null;
        $theme_zip    = $info['theme']['download_url'] ?? null;
        $theme_slug   = 'mvp-affiliate-theme';
        $theme        = wp_get_theme($theme_slug);
        $theme_local  = $theme->exists() ? (string) $theme->get('Version') : '0';

        if ($theme_zip && $theme_latest && version_compare($theme_local, $theme_latest, '<')) {
            try {
                $tt = get_site_transient('update_themes');
                if (!is_object($tt)) $tt = new stdClass();
                if (!isset($tt->response) || !is_array($tt->response)) $tt->response = [];
                $tt->response[$theme_slug] = [
                    'theme'       => $theme_slug,
                    'new_version' => $theme_latest,
                    'url'         => 'https://www.mvpaffiliate.io',
                    'package'     => $theme_zip,
                ];
                set_site_transient('update_themes', $tt);

                $skin = new Automatic_Upgrader_Skin();
                $up   = new Theme_Upgrader($skin);
                $r    = $up->upgrade($theme_slug);
                $msgs = method_exists($skin, 'get_upgrade_messages') ? $skin->get_upgrade_messages() : [];

                if (is_wp_error($r)) {
                    $results['theme'] = ['ok' => false, 'error' => $r->get_error_message(), 'log' => $msgs];
                } elseif ($r === false || $r === null) {
                    $results['theme'] = ['ok' => false, 'error' => 'Theme upgrade returned no result', 'log' => $msgs];
                } else {
                    $results['theme'] = ['ok' => true, 'from' => $theme_local, 'to' => $theme_latest];
                }
            } catch (\Throwable $e) {
                $results['theme'] = ['ok' => false, 'error' => $e->getMessage()];
            }
        } else {
            $results['theme'] = ['ok' => true, 'skipped' => 'up-to-date', 'version' => $theme_local];
        }

        // ── PLUGIN: same canonical transient + upgrade() path ───────────────
        $plugin_latest = $info['plugin']['version'] ?? null;
        $plugin_zip    = $info['plugin']['download_url'] ?? null;
        $basename      = plugin_basename(__FILE__);

        if ($plugin_zip && $plugin_latest && version_compare(MVP_AFFILIATE_VERSION, $plugin_latest, '<')) {
            try {
                $pt = get_site_transient('update_plugins');
                if (!is_object($pt)) $pt = new stdClass();
                if (!isset($pt->response) || !is_array($pt->response)) $pt->response = [];
                $pt->response[$basename] = (object) [
                    'slug'        => 'mvpaffiliate-platform',
                    'plugin'      => $basename,
                    'new_version' => $plugin_latest,
                    'url'         => 'https://www.mvpaffiliate.io',
                    'package'     => $plugin_zip,
                ];
                set_site_transient('update_plugins', $pt);

                $skin = new Automatic_Upgrader_Skin();
                $up   = new Plugin_Upgrader($skin);
                $r    = $up->upgrade($basename);
                $msgs = method_exists($skin, 'get_upgrade_messages') ? $skin->get_upgrade_messages() : [];

                // upgrade() can deactivate on file swap — keep it on.
                if (!is_plugin_active($basename)) activate_plugin($basename);

                if (is_wp_error($r)) {
                    $results['plugin'] = ['ok' => false, 'error' => $r->get_error_message(), 'log' => $msgs];
                } elseif ($r === false || $r === null) {
                    $results['plugin'] = ['ok' => false, 'error' => 'Plugin upgrade returned no result', 'log' => $msgs];
                } else {
                    $results['plugin'] = ['ok' => true, 'from' => MVP_AFFILIATE_VERSION, 'to' => $plugin_latest];
                }
            } catch (\Throwable $e) {
                $results['plugin'] = ['ok' => false, 'error' => $e->getMessage()];
            }
        } else {
            $results['plugin'] = ['ok' => true, 'skipped' => 'up-to-date', 'version' => MVP_AFFILIATE_VERSION];
        }

        // Bust caches so the new code/markup is served immediately.
        do_action('litespeed_purge_all');
        if (function_exists('wp_cache_flush')) wp_cache_flush();
        delete_site_transient('update_themes');
        delete_site_transient('update_plugins');
        delete_transient('mvp_affiliate_remote_version');

        $allOk = (!empty($results['theme']['ok'])) && (!empty($results['plugin']['ok']));
        return new WP_REST_Response(['ok' => $allOk, 'results' => $results], $allOk ? 200 : 207);
    }
}

// ─── 11. Newsletter signup shortcode ──────────────────────────────────────────
// Renders [mvp-newsletter user="<creator-user-id>"] as a styled signup form
// that POSTs to https://www.mvpaffiliate.io/api/newsletter/subscribe. The
// creator pastes the shortcode (with their own user id baked in) anywhere
// they want subscribers to come from — sidebar, footer, end of every post.
//
// Carries a honeypot field ("hp") that bots fill and humans don't — we
// silently 200 on those server-side so the bot's signal stays positive
// without polluting the list.
//
// Once submitted, all UI states live INSIDE the form's container: success
// ("check your inbox"), error ("please use a valid email"), and the
// "already subscribed" path. No page reload, no extra plugins required.
add_shortcode('mvp-newsletter', 'mvp_newsletter_shortcode');
if (!function_exists('mvp_newsletter_shortcode')) {
    function mvp_newsletter_shortcode($atts) {
        // Parse attrs — `user` (the creator's MVP user id, a UUID) is
        // OPTIONAL now: when missing, we read it from the customizations
        // option (1.0.15+, pushed by MVP automatically). `title` +
        // `subtitle` + `button` let creators override the default copy
        // per-placement without editing the plugin.
        $atts = shortcode_atts([
            'user'     => '',
            'title'    => 'Get the next review in your inbox',
            'subtitle' => 'No spam. One short email when there’s a new post worth your time or when there are things you might have missed online.',
            'button'   => 'Subscribe',
        ], $atts, 'mvp-newsletter');

        $user_id = trim($atts['user']);
        // Auto-fill from customizations.newsletter.userId when the
        // shortcode omitted the attribute (the new auto-embed flow).
        if ($user_id === '') {
            $cust = get_option('affiliateos_customizations', []);
            $nl = is_array($cust['newsletter'] ?? null) ? $cust['newsletter'] : [];
            $user_id = is_string($nl['userId'] ?? null) ? trim($nl['userId']) : '';
        }
        if (!preg_match('/^[0-9a-f-]{36}$/i', $user_id)) {
            return '<div style="padding:12px;border:1px solid #f5c6cb;background:#fdecea;color:#a94442;border-radius:8px;font-size:13px;">[mvp-newsletter] is missing a valid user id. Make sure the shortcode reads <code>[mvp-newsletter user="…"]</code> with your MVP user id — or enable the newsletter in your MVP dashboard so the user id auto-populates.</div>';
        }
        return mvp_affiliate_render_newsletter_form([
            'user_id'  => $user_id,
            'title'    => $atts['title'],
            'subtitle' => $atts['subtitle'],
            'button'   => $atts['button'],
        ]);
    }
}

// Shared renderer used by BOTH the [mvp-newsletter] shortcode AND the MVP
// theme's auto-embed (homepage + sidebar). Single source of truth for the
// form's HTML / inline CSS / submit JS — change the form here and every
// surface updates.
//
// Args (associative array):
//   user_id   string — the creator's MVP user id (UUID). Required.
//   title     string — H3 above the form.
//   subtitle  string — supporting line below the title.
//   button    string — submit button label.
//
// Returns escaped HTML ready to echo. Returns '' if user_id is invalid
// (so callers don't render a broken form).
if (!function_exists('mvp_affiliate_render_newsletter_form')) {
    function mvp_affiliate_render_newsletter_form($args = []) {
        $user_id  = isset($args['user_id'])  ? trim((string) $args['user_id']) : '';
        if (!preg_match('/^[0-9a-f-]{36}$/i', $user_id)) {
            return '';
        }
        $title    = isset($args['title'])    ? (string) $args['title']    : 'Get the next review in your inbox';
        $subtitle = isset($args['subtitle']) ? (string) $args['subtitle'] : 'No spam. One short email when there’s a new post worth your time or when there are things you might have missed online.';
        $button   = isset($args['button'])   ? (string) $args['button']   : 'Subscribe';
        // Compact mode skips the title + subtitle (used by the theme's
        // hero wrapper, which renders them on the LEFT column instead —
        // showing them again on the right would duplicate).
        $compact  = !empty($args['compact']);

        // The API base — same domain that runs this plugin's REST sister
        // endpoints (customizations, status, self-update). Filterable for dev.
        $api_base = apply_filters('mvp_affiliate_api_base', 'https://www.mvpaffiliate.io');
        $form_id  = 'mvp-newsletter-' . wp_generate_uuid4();

        // All inline so the form works whether or not the MVP theme
        // is active. Esc’d aggressively — every attribute is creator-supplied.
        ob_start();
        ?>
<div class="mvp-newsletter" id="<?php echo esc_attr($form_id); ?>" style="max-width:480px;margin:24px auto;padding:24px;border-radius:14px;background:#ffffff;border:1px solid rgba(0,0,0,0.08);box-shadow:0 1px 2px rgba(0,0,0,0.04);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1d1d1f;">
  <?php if (!$compact): ?>
  <h3 style="margin:0 0 6px;font-size:18px;line-height:1.3;color:#1d1d1f;"><?php echo esc_html($title); ?></h3>
  <p style="margin:0 0 14px;font-size:13px;line-height:1.5;color:#6e6e73;"><?php echo esc_html($subtitle); ?></p>
  <?php endif; ?>
  <form class="mvp-newsletter-form" novalidate style="display:flex;gap:8px;flex-wrap:wrap;">
    <input type="email" name="email" required placeholder="you@email.com" autocomplete="email" style="flex:1 1 200px;min-width:0;padding:11px 12px;border:1px solid rgba(0,0,0,0.15);border-radius:10px;font-size:14px;color:#1d1d1f;background:#fff;outline:none;" />
    <!-- Honeypot: hidden via inline CSS; bots fill it, we silently drop their signups server-side. -->
    <input type="text" name="hp" tabindex="-1" autocomplete="off" aria-hidden="true" style="position:absolute;left:-9999px;top:-9999px;height:0;width:0;opacity:0;" />
    <button type="submit" style="padding:11px 18px;border:none;border-radius:10px;background:#0071e3;color:#ffffff;font-size:14px;font-weight:600;cursor:pointer;"><?php echo esc_html($button); ?></button>
  </form>
  <p class="mvp-newsletter-msg" role="status" aria-live="polite" style="margin:10px 0 0;font-size:12px;line-height:1.5;color:#6e6e73;min-height:1.5em;"></p>
</div>
<script>
(function(){
  var root = document.getElementById(<?php echo wp_json_encode($form_id); ?>);
  if (!root) return;
  var form = root.querySelector('.mvp-newsletter-form');
  var msg  = root.querySelector('.mvp-newsletter-msg');
  var btn  = form.querySelector('button[type="submit"]');
  var origLabel = btn.textContent;
  form.addEventListener('submit', function(e){
    e.preventDefault();
    msg.style.color = '#6e6e73';
    msg.textContent = '';
    var email = (form.email.value || '').trim();
    var hp    = (form.hp.value || '').trim();
    if (!email) { msg.style.color = '#ff3b30'; msg.textContent = 'Please enter your email.'; return; }
    btn.disabled = true; btn.textContent = 'Subscribing…';
    fetch(<?php echo wp_json_encode($api_base . '/api/newsletter/subscribe'); ?>, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        creatorUserId: <?php echo wp_json_encode($user_id); ?>,
        email: email,
        hp: hp,
        sourceUrl: window.location.href
      })
    }).then(function(r){ return r.json().then(function(d){ return { ok: r.ok, data: d }; }); })
      .then(function(res){
        btn.disabled = false; btn.textContent = origLabel;
        if (!res.ok) {
          msg.style.color = '#ff3b30';
          msg.textContent = (res.data && res.data.error) ? res.data.error : 'Something went wrong. Please try again.';
          return;
        }
        if (res.data.alreadySubscribed) {
          msg.style.color = '#34c759';
          msg.textContent = "You're already on the list. Thanks!";
        } else {
          msg.style.color = '#34c759';
          msg.textContent = 'Check your inbox to confirm your subscription.';
        }
        form.reset();
      })
      .catch(function(){
        btn.disabled = false; btn.textContent = origLabel;
        msg.style.color = '#ff3b30';
        msg.textContent = 'Network error. Please try again.';
      });
  });
})();
</script>
        <?php
        return ob_get_clean();
    }
}

// ─── 20. Sticky affiliate CTA bar (every single post, scroll-triggered) ───────
// Renders a fixed bottom-of-viewport bar with the product name + an Amazon
// (or generic) buy button. Auto-extracts the first affiliate URL from the
// post content — works on every existing post without re-generation. JS is
// minimal, inline, and idempotent: shows after the user scrolls past the
// hero, dismissable with an X (sessionStorage so it stays dismissed for
// the rest of the visit but reappears next session).
//
// Wirecutter / RTINGS / The Strategist all do this; measured affiliate
// revenue lift is typically 15-35% over static-only CTAs.
add_action('wp_footer', 'mvp_affiliate_render_sticky_cta');
if (!function_exists('mvp_affiliate_render_sticky_cta')) {
    function mvp_affiliate_render_sticky_cta() {
        if (!is_singular('post')) return;
        $post = get_post();
        if (!$post) return;

        // First affiliate URL wins (geni.us → amzn.to → amazon.* TLD).
        // We deliberately don't surface arbitrary outbound links — only
        // links the user wrote with an affiliate-tracking purpose.
        $url = null;
        if (preg_match('#https?://(?:www\\.)?geni\\.us/[A-Za-z0-9]+#', $post->post_content, $m)) $url = $m[0];
        if (!$url && preg_match('#https?://(?:www\\.)?amzn\\.to/[A-Za-z0-9]+#', $post->post_content, $m)) $url = $m[0];
        if (!$url && preg_match('#https?://(?:www\\.)?amazon\\.[a-z.]+/[^\\s"\'<>]+#', $post->post_content, $m)) $url = rtrim($m[0], '.,;');
        if (!$url) return;

        $is_amazon = (bool) preg_match('/amazon\\.|amzn\\.to|geni\\.us/i', $url);
        $cta_text  = $is_amazon ? "Check Today's Price on Amazon →" : "Get The Best Price Today →";
        $title     = $post->post_title;
        // Trim long titles so they don't overflow on mobile
        if (mb_strlen($title) > 48) $title = mb_substr($title, 0, 45) . '…';
        ?>
<style>
#mvp-sticky-cta{position:fixed;bottom:0;left:0;right:0;background:#fff;border-top:2px solid #FF6B00;box-shadow:0 -4px 16px rgba(0,0,0,.12);padding:10px 14px;z-index:9999;display:none;align-items:center;gap:10px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
#mvp-sticky-cta .mvp-sc-info{flex:1;min-width:0}
#mvp-sticky-cta .mvp-sc-eyebrow{margin:0;font-size:10px;font-weight:700;color:#86868b;text-transform:uppercase;letter-spacing:.6px}
#mvp-sticky-cta .mvp-sc-title{margin:2px 0 0;font-size:13px;font-weight:700;color:#1d1d1f;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;line-height:1.2}
#mvp-sticky-cta .mvp-sc-btn{flex-shrink:0;display:inline-flex;align-items:center;justify-content:center;gap:6px;background:linear-gradient(135deg,#FF9900 0%,#FF6B00 100%);color:#fff;padding:11px 16px;border-radius:8px;font-weight:700;text-decoration:none;font-size:13px;white-space:nowrap;min-height:44px;box-sizing:border-box;box-shadow:0 2px 6px rgba(255,107,0,.25)}
#mvp-sticky-cta .mvp-sc-btn:hover{filter:brightness(.95);text-decoration:none;color:#fff}
#mvp-sticky-cta .mvp-sc-close{flex-shrink:0;background:none;border:none;font-size:22px;color:#86868b;cursor:pointer;padding:0;line-height:1;min-width:32px;min-height:32px;display:flex;align-items:center;justify-content:center}
#mvp-sticky-cta .mvp-sc-close:hover{color:#1d1d1f}
@media (max-width:480px){
  #mvp-sticky-cta{padding:8px 10px;gap:8px}
  #mvp-sticky-cta .mvp-sc-eyebrow{font-size:9px}
  #mvp-sticky-cta .mvp-sc-title{font-size:12px}
  #mvp-sticky-cta .mvp-sc-btn{padding:10px 12px;font-size:12px}
}
</style>
<div id="mvp-sticky-cta" role="region" aria-label="Buy this product">
  <div class="mvp-sc-info">
    <p class="mvp-sc-eyebrow">Reviewed in this post</p>
    <p class="mvp-sc-title"><?php echo esc_html($title); ?></p>
  </div>
  <a class="mvp-sc-btn" href="<?php echo esc_url($url); ?>" target="_blank" rel="noopener sponsored nofollow"><?php echo esc_html($cta_text); ?></a>
  <button type="button" class="mvp-sc-close" aria-label="Dismiss" id="mvp-sticky-cta-close">×</button>
</div>
<script>
(function(){
  var bar = document.getElementById('mvp-sticky-cta');
  if (!bar) return;
  // Per-post dismissal — clicking X hides the bar for THIS post only,
  // not every other review in the same session. Each review is its own
  // potential conversion; one dismiss shouldn't kill the next.
  var key = 'mvp-sc-dismissed:' + location.pathname;
  try { if (sessionStorage.getItem(key)) return; } catch(e){}
  var shown = false;
  function check(){ if (shown) return; if (window.scrollY > 450) { bar.style.display = 'flex'; shown = true; } }
  window.addEventListener('scroll', check, { passive: true });
  check();
  var close = document.getElementById('mvp-sticky-cta-close');
  if (close) close.addEventListener('click', function(){
    bar.style.display = 'none';
    try { sessionStorage.setItem(key, '1'); } catch(e){}
  });
})();
</script>
        <?php
    }
}

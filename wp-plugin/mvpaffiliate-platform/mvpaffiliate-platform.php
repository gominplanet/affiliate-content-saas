<?php
/**
 * Plugin Name: MVP Affiliate Platform
 * Plugin URI: https://www.mvpaffiliate.io
 * Description: Connects this WordPress site to the MVP Affiliate dashboard. Provides REST endpoints, blog customizations, banners, social bar, footer, logo header, and "You might also like" section.
 * Version: 1.0.1
 * Author: MVP Affiliate
 * Author URI: https://www.mvpaffiliate.io
 * License: GPLv2 or later
 * Text Domain: mvpaffiliate-platform
 * Requires at least: 5.6
 * Requires PHP: 7.4
 */

if (!defined('ABSPATH')) exit;

define('MVP_AFFILIATE_VERSION', '1.0.0');

// ─── 1. Authorization header fix ───────────────────────────────────────────────
// Runs at every PHP request, before WordPress REST auth checks.
// Hostinger, SiteGround, and some shared Apache configs strip the Authorization
// header before PHP sees it, but leave it as REDIRECT_HTTP_AUTHORIZATION.
if (!isset($_SERVER['HTTP_AUTHORIZATION']) && isset($_SERVER['REDIRECT_HTTP_AUTHORIZATION'])) {
    $_SERVER['HTTP_AUTHORIZATION'] = $_SERVER['REDIRECT_HTTP_AUTHORIZATION'];
}

// ─── 2. Activation: patch .htaccess for hosts where PHP-level fix isn't enough ─
register_activation_hook(__FILE__, 'mvp_affiliate_activate');
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
    // Mark the install timestamp so the admin page knows we're freshly activated
    if (!get_option('mvp_affiliate_installed_at')) {
        update_option('mvp_affiliate_installed_at', time());
    }
}

// ─── 3. Data accessor ─────────────────────────────────────────────────────────
function mvp_affiliate_get_data() {
    static $cache = null;
    if ($cache === null) $cache = get_option('affiliateos_customizations', []);
    return $cache;
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

function mvp_affiliate_rest_get_customizations() {
    return new WP_REST_Response(get_option('affiliateos_customizations', []), 200);
}

function mvp_affiliate_rest_save_customizations(WP_REST_Request $request) {
    $data = $request->get_json_params();
    update_option('affiliateos_customizations', $data);
    do_action('litespeed_purge_all');
    if (function_exists('wp_cache_flush')) wp_cache_flush();
    return new WP_REST_Response(['saved' => true], 200);
}

// ─── 5. Block renderer (shared by sidebar + in-content) ───────────────────────
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

// ─── 13. Force front page template (lets us control homepage) ─────────────────
add_filter('frontpage_template', function ($t) { return get_page_template(); });

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
      <p style="color:#6e6e73;margin-top:0;">Connect this WordPress site to your MVP Affiliate dashboard.</p>

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
        <p style="margin:0 0 12px;color:#6e6e73;">Click below to generate a one-time token. Paste it into MVP Affiliate to connect this site.</p>

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

// ─── 16. MVP Affiliate theme installer ────────────────────────────────────────
// Downloads the theme zip from MVP Affiliate's CDN and installs/activates it.
// The theme slug after install is 'mvp-affiliate-theme'.
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
    // The zip is hosted alongside the plugin zip on MVP Affiliate.
    $zip_url = 'https://www.mvpaffiliate.io/mvp-affiliate-theme.zip';
    $upgrader = new Theme_Upgrader(new Automatic_Upgrader_Skin());
    $result = $upgrader->install($zip_url);
    if (is_wp_error($result)) return $result;
    if (!$result) return new WP_Error('install_failed', 'Theme installation failed. The download URL may be unreachable.');
    switch_theme('mvp-affiliate-theme');
    return true;
}

// ─── 17. Add settings link on Plugins page ────────────────────────────────────
add_filter('plugin_action_links_' . plugin_basename(__FILE__), function ($links) {
    array_unshift($links, '<a href="' . admin_url('admin.php?page=mvp-affiliate') . '">Connect</a>');
    return $links;
});

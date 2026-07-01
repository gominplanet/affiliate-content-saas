<?php
/**
 * Plugin Name: MVP Affiliate Platform
 * Plugin URI: https://www.mvpaffiliate.io
 * Description: Connects this WordPress site to the MVP Affiliate dashboard. Provides REST endpoints, blog customizations, banners, social bar, footer, logo header, and "You might also like" section.
 * Version: 1.0.60
 * Author: MVP Affiliate
 * Author URI: https://www.mvpaffiliate.io
 * License: GPLv2 or later
 * Text Domain: mvpaffiliate-platform
 * Requires at least: 5.6
 * Requires PHP: 7.4
 */

if (!defined('ABSPATH')) exit;

// Single source of truth: read the version from this file's own "Version:"
// header (line 6). Previously this was a hard-coded string that drifted
// behind the header on every bump — the /status endpoint reported the stale
// constant, the dashboard banner kept saying "update available" after
// successful updates because the *reported* version never moved. WP's
// get_file_data() parses plugin header comments and is always available at
// plugin-load time. Fallback string is only used if get_file_data is somehow
// missing (it shouldn't be — WP core defines it in functions.php).
$mvp_affiliate_self_meta = function_exists('get_file_data')
    ? get_file_data(__FILE__, ['Version' => 'Version'])
    : ['Version' => '1.0.48'];
define('MVP_AFFILIATE_VERSION', (string) ($mvp_affiliate_self_meta['Version'] ?: '1.0.48'));
unset($mvp_affiliate_self_meta);

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

// ─── 1. Authorization header fix (zero-touch — no .htaccess needed) ──────────
// Runs at every PHP request, before WordPress REST auth checks.
// Different hosts hide the Authorization header in different places:
//   - Hostinger / shared Apache: REDIRECT_HTTP_AUTHORIZATION
//   - LiteSpeed (some configs): REDIRECT_REDIRECT_HTTP_AUTHORIZATION (double-redirect)
//   - PHP-CGI hosts: apache_request_headers() carries it but $_SERVER does not
// We probe all four locations so users on ANY of these hosts never need
// to manually patch their .htaccess. The activation hook (below) still
// also writes the .htaccess rule as belt-and-suspenders for hosts where
// even this PHP-level shim can't see the header.
if (!isset($_SERVER['HTTP_AUTHORIZATION'])) {
    if (isset($_SERVER['REDIRECT_HTTP_AUTHORIZATION'])) {
        $_SERVER['HTTP_AUTHORIZATION'] = $_SERVER['REDIRECT_HTTP_AUTHORIZATION'];
    } elseif (isset($_SERVER['REDIRECT_REDIRECT_HTTP_AUTHORIZATION'])) {
        $_SERVER['HTTP_AUTHORIZATION'] = $_SERVER['REDIRECT_REDIRECT_HTTP_AUTHORIZATION'];
    } elseif (function_exists('apache_request_headers')) {
        $headers = apache_request_headers();
        if (is_array($headers)) {
            // Header names are case-insensitive in HTTP but the array keys may
            // vary across Apache builds. Normalize to lower-case for lookup.
            $lower = array_change_key_case($headers, CASE_LOWER);
            if (isset($lower['authorization'])) {
                $_SERVER['HTTP_AUTHORIZATION'] = $lower['authorization'];
            }
        }
    }
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

        // ── Auto-configure LiteSpeed Cache for performance ────────────────────
        // Most Hostinger / SiteGround / cPanel hosts ship LiteSpeed Cache with
        // factory defaults that leave 30-50% page-speed gains on the table.
        // We enable the proven-safe optimizations on plugin activation so the
        // user gets the wins without ever opening the LiteSpeed admin. Only
        // touches keys that are well-known and safe; user can override any of
        // these later via wp-admin → LiteSpeed Cache → Cache without us
        // overwriting their choices (this only runs on activation).
        if (class_exists('LiteSpeed\Core') || defined('LSCWP_V') || is_plugin_active('litespeed-cache/litespeed-cache.php')) {
            $conf = get_option('litespeed.conf', []);
            if (!is_array($conf)) $conf = [];
            $defaults = [
                'optm-css_min'         => 1, // Minify CSS
                'optm-js_min'          => 1, // Minify JS
                'optm-html_min'        => 1, // Minify HTML
                'optm-css_comb'        => 1, // Combine CSS
                'optm-js_comb'         => 1, // Combine JS
                'optm-css_async'       => 1, // Async render-blocking CSS
                'optm-js_defer'        => 2, // Defer JS (delayed)
                'media-lazy'           => 1, // Lazy-load images
                'media-iframe_lazy'    => 1, // Lazy-load iframes
                'media-lazyjs_inline'  => 1, // Inline lazy-load JS
                'img_optm-webp_replace' => 1, // Use WebP versions of images when available
                'img_optm-auto'        => 1, // Auto-pull image optimization (requires QUIC.cloud connection — user does that once)
                'cache-mobile'         => 1, // Cache mobile views
                'cache-browser'        => 1, // Browser cache
            ];
            $updated = false;
            foreach ($defaults as $key => $val) {
                if (!array_key_exists($key, $conf)) {
                    $conf[$key] = $val;
                    $updated = true;
                }
            }
            if ($updated) {
                update_option('litespeed.conf', $conf);
                // LiteSpeed reads config on init; clear any cached entries
                // pointing at the OLD options so the new ones go live.
                if (function_exists('do_action')) do_action('litespeed_purge_all');
            }
        }
        if (!get_option('mvp_affiliate_installed_at')) {
            update_option('mvp_affiliate_installed_at', time());
        }
        if (!get_option('affiliateos_indexnow_key')) {
            update_option('affiliateos_indexnow_key', bin2hex(random_bytes(16)));
        }
        // Mint the body-auth proxy secret. The dashboard reads this via
        // /affiliateos/v1/status after a successful Application Password
        // connect, then sends it as a JSON-body field on every write
        // (instead of relying on the Authorization header that some hosts
        // strip on POST). 32 bytes = 64 hex chars — generous entropy and
        // immune to brute-force at the timing of a normal request.
        if (!get_option('affiliateos_proxy_secret')) {
            // random_bytes throws on hosts with no CSPRNG (rare but exists
            // on stripped-down PHP builds). Fall back to wp_generate_password
            // which is also cryptographically strong but tolerates a
            // missing CSPRNG.
            try {
                $secret = bin2hex(random_bytes(32));
            } catch (\Throwable $e) {
                $secret = wp_generate_password(64, false);
            }
            update_option('affiliateos_proxy_secret', $secret);
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
        // Skip staging / localhost — IndexNow rejects those + we'd spam our
        // own logs. Cover common dev hostnames (localhost, *.local, *.test,
        // *.dev, *.lan, IP literals, .ngrok.io tunnels).
        $h = strtolower($host);
        if (
            $h === 'localhost' ||
            substr($h, -6) === '.local' ||
            substr($h, -5) === '.test' ||
            substr($h, -4) === '.dev' ||
            substr($h, -4) === '.lan' ||
            substr($h, -9) === '.ngrok.io' ||
            substr($h, -12) === '.ngrok-free.app' ||
            (bool) preg_match('/^\d+\.\d+\.\d+\.\d+$/', $h)
        ) return;
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

if (!function_exists('mvp_affiliate_sanitize_customizations')) {
    /** Deep-sanitize the customizations payload before persisting.
     *  - HTML strings get wp_kses_post (no <script>, no iframes by default,
     *    blocks the stored-XSS path that compounds with the block renderer
     *    echoing $block['html'] raw).
     *  - URL strings get esc_url_raw.
     *  - Colors get a hex-allowlist regex (prevents `;}body{...` CSS
     *    breakout in the inline <style> block).
     *  - Arbitrary scalars get sanitize_text_field as a baseline.
     *  Whitelist-friendly — unknown keys still pass through but every
     *  scalar is filtered, so a poisoned admin POST can't ship raw HTML
     *  site-wide via this route. */
    function mvp_affiliate_sanitize_customizations($val, $key_path = '') {
        if (is_array($val)) {
            $out = [];
            foreach ($val as $k => $v) {
                $out[$k] = mvp_affiliate_sanitize_customizations($v, $key_path . '/' . $k);
            }
            return $out;
        }
        if (is_bool($val) || is_int($val) || is_float($val) || is_null($val)) return $val;
        if (!is_string($val)) return '';

        // Key-based dispatch — applies the right escape for the slot.
        $lower = strtolower($key_path);
        // Site-verification <meta> tags (headMetaTags[]) — keep the bare tag.
        // sanitize_text_field() strips ALL tags, which silently blanked every
        // verification meta (Google/Pinterest/Impact/PartnerBoost…) on save, so
        // the tag never reached the <head>. Harden with the SAME meta-only
        // allowlist the head-injector uses (no scripts/styles/arbitrary HTML),
        // so this is safe while actually preserving the tag.
        if (preg_match('#/headMetaTags(/|$)#i', $key_path)) {
            $allowed_meta = ['meta' => [
                'name' => true, 'property' => true, 'http-equiv' => true,
                'content' => true, 'value' => true, 'itemprop' => true, 'charset' => true,
            ]];
            return trim(wp_kses($val, $allowed_meta));
        }
        if (preg_match('#/(html|content|body|blockHtml)$#i', $key_path)) {
            return wp_kses_post($val);
        }
        if (preg_match('#/(url|href|src|link|logo|image|photo|banner)#i', $key_path)) {
            return esc_url_raw($val);
        }
        if (preg_match('#/(color|bg|background)#i', $key_path)) {
            // Tight: only #abc, #abcdef, #abcdef00 (rgb + optional alpha).
            return preg_match('/^#[0-9a-f]{3,8}$/i', $val) ? $val : '';
        }
        return sanitize_text_field($val);
    }
}
if (!function_exists('mvp_affiliate_rest_save_customizations')) {
    function mvp_affiliate_rest_save_customizations(WP_REST_Request $request) {
        $data = $request->get_json_params();
        if (!is_array($data)) $data = [];
        $clean = mvp_affiliate_sanitize_customizations($data);
        update_option('affiliateos_customizations', $clean);
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
            // wp_kses_post — defense-in-depth in case a poisoned option
            // value bypassed mvp_affiliate_sanitize_customizations (older
            // rows, hand-edited DB, etc.). Strips <script>, <iframe>, on*
            // handlers, javascript: URIs. Same allowlist WP uses for
            // post_content.
            echo wp_kses_post($html);
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

// ─── 7c. Mid-article newsletter form (every single post, configurable) ───────
// Inline email-capture form rendered at a chosen paragraph position on every
// single review post. Same submit endpoint + visual treatment as the
// [mvp-newsletter] shortcode (re-uses mvp_affiliate_render_newsletter_form),
// just placed inline-with-content instead of in the sidebar.
//
// Config in /customize → Mid-article newsletter (priority 8 so it slots
// AFTER the trust block at 5 but BEFORE the in-content ads at 10).
// Return the offset in $content immediately AFTER the balanced close of the
// first `<div class="gr-verdict-box">` (which wraps the Quick Verdict text AND
// the Buy-if / Skip-if columns), or false if there's no verdict box. Used so the
// inline newsletter is never injected INSIDE the verdict box. Walks div opens /
// closes to find the matching </div> (the box contains nested gr-verdict-col
// divs, so a naive first-</div> won't do).
if (!function_exists('mvp_affiliate_after_verdict_box')) {
    function mvp_affiliate_after_verdict_box($content) {
        $marker = stripos($content, 'gr-verdict-box');
        if ($marker === false) return false;
        $start = strrpos(substr($content, 0, $marker), '<div');
        if ($start === false) return false;
        $len = strlen($content);
        $i = $start;
        $depth = 0;
        while ($i < $len) {
            $open  = stripos($content, '<div', $i);
            $close = stripos($content, '</div', $i);
            if ($close === false) return false; // malformed — bail, don't move it
            if ($open !== false && $open < $close) { $depth++; $i = $open + 4; }
            else {
                $depth--; $i = $close + 5;
                if ($depth === 0) return $i; // matched the box's own closing </div>
            }
        }
        return false;
    }
}

add_filter('the_content', function ($content) {
    if (!is_singular('post')) return $content;
    $data = mvp_affiliate_get_data();
    $nl = is_array($data['newsletter'] ?? null) ? $data['newsletter'] : [];
    $inline = is_array($nl['inlineMidArticle'] ?? null) ? $nl['inlineMidArticle'] : [];
    if (empty($inline['enabled'])) return $content;
    if (empty($nl['userId']) || !preg_match('/^[0-9a-f-]{36}$/i', (string) $nl['userId'])) return $content;

    $after_para = max(1, min(8, intval($inline['afterParagraph'] ?? 3)));
    $title    = trim((string) ($inline['title']    ?? 'Want the best Amazon finds in your inbox?'));
    $subtitle = trim((string) ($inline['subtitle'] ?? 'A short monthly email with the products I tested + actually liked. No spam.'));
    $button   = trim((string) ($inline['button']   ?? 'Subscribe'));
    if (!$title)    $title    = 'Want the best Amazon finds in your inbox?';
    if (!$subtitle) $subtitle = 'A short monthly email with the products I tested + actually liked. No spam.';
    if (!$button)   $button   = 'Subscribe';

    // 2026-06-08 BUG FIX: mvp_affiliate_render_newsletter_form RETURNS its
    // HTML (it uses its own ob_start/ob_get_clean internally — see line
    // 2976). The previous code here wrapped the call in another ob_start
    // expecting it to ECHO, so the outer buffer was always empty, $form was
    // always '', and the early-return below silently dropped the inline
    // form on every post. Direct assignment makes the form render.
    $form = mvp_affiliate_render_newsletter_form([
        'user_id'  => $nl['userId'],
        'title'    => $title,
        'subtitle' => $subtitle,
        'button'   => $button,
    ]);
    if (!$form) return $content;

    // Wrap so we can scope margin to inline placement (denser than sidebar/footer)
    $form = '<div style="margin:32px 0">' . $form . '</div>';

    // 2026-06-08 FIX: count paragraphs starting from the FIRST <h2> in the
    // content. Earlier code scanned the full content, which meant the
    // author block (3 inline <p> tags), pros/cons hero, and any other
    // pre-body prepended content all counted as paragraphs — so "After
    // paragraph 3" actually fired at the END of the author block, right at
    // the top of the article. Splitting at the first <h2> isolates the
    // body section (the AI emits the hook opener as the first H2 — see
    // services/claude prompt §4-A) and counts only its <p> tags.
    $body_start = stripos($content, '<h2');
    if ($body_start === false) {
        // No H2 found — post might be unusually structured. Fall back to
        // scanning the whole content (same as the previous behavior).
        $body_start = 0;
    }
    // NEVER inject inside the Quick Verdict box. The verdict box wraps both the
    // verdict text AND the Buy-if / Skip-if columns, so counting paragraphs from
    // the first heading could land the form between them (a box-inside-a-box).
    // If a verdict box exists, start the paragraph scan AFTER it closes.
    $verdict_end = mvp_affiliate_after_verdict_box($content);
    if ($verdict_end !== false && $verdict_end > $body_start) {
        $body_start = $verdict_end;
    }
    $prefix = substr($content, 0, $body_start);
    $body   = substr($content, $body_start);

    // Walk body paragraphs and inject after the Nth </p>
    $parts = preg_split('/(<\/p>)/i', $body, -1, PREG_SPLIT_DELIM_CAPTURE);
    $output = '';
    $para_count = 0;
    $inserted = false;
    for ($i = 0; $i < count($parts); $i++) {
        $output .= $parts[$i];
        if (!$inserted && isset($parts[$i]) && strtolower($parts[$i]) === '</p>') {
            $para_count++;
            if ($para_count === $after_para) {
                $output .= $form;
                $inserted = true;
            }
        }
    }
    // If the body had fewer paragraphs than the threshold, append at the
    // end of the body (still before the FAQ) so the form has a shot.
    if (!$inserted) $output .= $form;
    return $prefix . $output;
}, 8);

// ─── 7b. Reviewer Trust Block (top of every single post) ──────────────────────
// Renders an inline author byline directly above the post content based on
// the user's blog_customizations.authorBlock config (set in /customize on
// the MVP dashboard). Plugin-side rendering means it shows on EVERY post —
// including ones generated before this feature existed — and re-renders
// instantly when the user changes their config (no post re-generation).
//
// Disable: customize → Reviewer Trust Block → toggle off.
add_filter('the_content', function ($content) {
    if (!is_singular('post')) return $content;
    $data = mvp_affiliate_get_data();
    $ab = $data['authorBlock'] ?? null;
    if (!$ab || empty($ab['enabled'])) return $content;
    $name    = trim((string) ($ab['name'] ?? ''));
    $tagline = trim((string) ($ab['tagline'] ?? ''));
    if (!$name || !$tagline) return $content;
    $photo     = esc_url((string) ($ab['photoUrl']  ?? ''));
    $link      = esc_url((string) ($ab['linkUrl']   ?? ''));
    $linkLabel = trim((string) ($ab['linkLabel'] ?? 'More about me'));
    if (!$linkLabel) $linkLabel = 'More about me';

    ob_start(); ?>
<div class="gr-author-block" style="display:flex;align-items:flex-start;gap:14px;padding:14px 16px;margin:0 0 24px;border:1px solid #e5e5e7;border-left:4px solid #FFC200;border-radius:6px;background:#fafafa">
  <?php if ($photo): ?>
    <img src="<?php echo $photo; ?>" alt="<?php echo esc_attr($name); ?>" loading="lazy" style="flex-shrink:0;width:56px;height:56px;border-radius:50%;object-fit:cover;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.1)" />
  <?php endif; ?>
  <div style="flex:1;min-width:0">
    <p style="margin:0;font-size:11px;font-weight:800;color:#86868b;text-transform:uppercase;letter-spacing:.8px">Reviewed by</p>
    <p style="margin:2px 0 6px;font-size:15px;font-weight:700;color:#1d1d1f;line-height:1.2"><?php echo esc_html($name); ?></p>
    <p style="margin:0;font-size:13px;color:#3a3a3c;line-height:1.5"><?php echo esc_html($tagline); ?><?php if ($link): ?> <a href="<?php echo $link; ?>" target="_blank" rel="noopener" style="color:#0071e3;text-decoration:none;font-weight:600;white-space:nowrap"><?php echo esc_html($linkLabel); ?> →</a><?php endif; ?></p>
  </div>
</div>
    <?php
    return ob_get_clean() . $content;
}, 5);  // priority 5 so this runs BEFORE the in-content ads filter at 10

// ─── 7c. Updated/Edited meta line + Author bio card (bottom of every post) ────
// Two trust signals every major review site (Tom's Guide / TechRadar / PCMag /
// Digital Trends) renders on every review:
//   1. "Updated [date]" inline meta — daily/weekly refresh signal that Google
//      uses for ranking + tells readers the content is maintained.
//   2. "About the reviewer" card at the foot with photo, name, title,
//      experience paragraph — PCMag's "OUR EXPERT" model. Strong E-E-A-T
//      signal + reader trust.
//
// Both render via the_content filter so they appear on EVERY post (including
// legacy ones generated before this feature existed). The author config is
// the same blog_customizations.authorBlock that drives the top trust block —
// reusing the data avoids a second /customize panel.
//
// Disable: customize → Reviewer Trust Block → toggle off (same toggle —
// both the top byline and the bottom bio card live or die together).
add_filter('the_content', function ($content) {
    if (!is_singular('post')) return $content;
    $data = mvp_affiliate_get_data();
    $ab = $data['authorBlock'] ?? null;
    if (!$ab || empty($ab['enabled'])) return $content;
    $name    = trim((string) ($ab['name'] ?? ''));
    $tagline = trim((string) ($ab['tagline'] ?? ''));
    if (!$name || !$tagline) return $content;
    $photo     = esc_url((string) ($ab['photoUrl']  ?? ''));
    $link      = esc_url((string) ($ab['linkUrl']   ?? ''));
    $linkLabel = trim((string) ($ab['linkLabel'] ?? 'Read more about me'));
    if (!$linkLabel) $linkLabel = 'Read more about me';
    // Bio paragraph — fall back to the tagline if no separate long-form bio
    // is configured. Most users will only fill the tagline so this preserves
    // the existing behaviour while giving power users a richer bio surface.
    $bio = trim((string) ($ab['bio'] ?? ''));
    if (!$bio) $bio = $tagline;

    // Dates — WP exposes post_modified (UTC) which is exactly the freshness
    // signal Google looks for. Show "Updated" only if it differs from the
    // publish date by more than 24h; otherwise the publish date alone is
    // less noisy. Format matches major review sites: "May 28, 2026".
    $post_id = get_the_ID();
    $published_ts = get_post_time('U', true, $post_id);
    $modified_ts  = get_post_modified_time('U', true, $post_id);
    $published_human = get_the_date('F j, Y', $post_id);
    $modified_human  = get_post_modified_time('F j, Y', false, $post_id);
    $show_updated    = ($modified_ts - $published_ts) > 86400;

    ob_start(); ?>
<div class="gr-post-meta" style="margin:32px 0 16px;padding:12px 0;border-top:1px solid #e5e5e7;border-bottom:1px solid #e5e5e7;display:flex;align-items:center;gap:16px;flex-wrap:wrap;font-size:12px;color:#86868b">
  <span style="font-weight:600;color:#3a3a3c">Published <?php echo esc_html($published_human); ?></span>
  <?php if ($show_updated): ?>
    <span aria-hidden="true">·</span>
    <span style="font-weight:600;color:#1d1d1f"><span style="text-transform:uppercase;letter-spacing:.5px;font-size:10px;color:#86868b">Updated</span> <?php echo esc_html($modified_human); ?></span>
  <?php endif; ?>
  <span aria-hidden="true">·</span>
  <span>Reviewed by <strong style="color:#1d1d1f"><?php echo esc_html($name); ?></strong></span>
  <span aria-hidden="true">·</span>
  <a href="<?php echo esc_url(home_url('/how-we-test/')); ?>" style="color:#7C3AED;text-decoration:none;font-weight:600">How we test →</a>
  <?php
  // Primary tag link — surfaces the topic hub. Use the first tag that
  // isn't the "buying-guide" tag (which is a content-format marker, not
  // a topic). Falls back silently if the post has no tags.
  $post_tags = wp_get_post_tags(get_the_ID());
  $primary_tag = null;
  foreach ($post_tags as $t) {
      if ($t->slug !== 'buying-guide' && $t->slug !== 'comparison') { $primary_tag = $t; break; }
  }
  if ($primary_tag): ?>
    <span aria-hidden="true">·</span>
    <a href="<?php echo esc_url(get_tag_link($primary_tag->term_id)); ?>" style="color:#7C3AED;text-decoration:none;font-weight:600">More <?php echo esc_html($primary_tag->name); ?> →</a>
  <?php endif; ?>
</div>

<div class="gr-author-bio-card" style="margin:24px 0 8px;padding:20px;border:1px solid #e5e5e7;border-radius:8px;background:#fafafa;display:flex;gap:18px;align-items:flex-start">
  <?php if ($photo): ?>
    <img src="<?php echo $photo; ?>" alt="<?php echo esc_attr($name); ?>" loading="lazy" style="flex-shrink:0;width:84px;height:84px;border-radius:50%;object-fit:cover;border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.08)" />
  <?php endif; ?>
  <div style="flex:1;min-width:0">
    <p style="margin:0;font-size:11px;font-weight:800;color:#86868b;text-transform:uppercase;letter-spacing:.8px">About the reviewer</p>
    <p style="margin:4px 0 6px;font-size:18px;font-weight:700;color:#1d1d1f;line-height:1.25"><?php echo esc_html($name); ?></p>
    <p style="margin:0;font-size:14px;color:#3a3a3c;line-height:1.55"><?php echo esc_html($bio); ?></p>
    <?php if ($link): ?>
      <p style="margin:10px 0 0">
        <a href="<?php echo $link; ?>" target="_blank" rel="noopener" style="font-size:13px;color:#0071e3;text-decoration:none;font-weight:600"><?php echo esc_html($linkLabel); ?> →</a>
      </p>
    <?php endif; ?>
  </div>
</div>
    <?php
    return $content . ob_get_clean();
}, 20);  // priority 20 so this runs AFTER the in-content ads filter at 10
         // and AFTER any other content modifiers — we want the bio card to
         // be literally the last thing before the comments / related posts.

// ─── 7d. Pros & Cons highlight box (top of every review) ─────────────────────
//
// Tom's Guide / TechRadar / PCMag all open every review with a scannable
// pros + cons block above the fold. It's the single biggest determinant of
// whether a visitor scrolls or bounces.
//
// Approach: scan the post content for a "Pros" + "Cons" heading pair,
// extract the <ul>s that follow each, and lift the pair into a styled
// two-column hero box at the very top of the article. Works retroactively
// on every existing review — no re-generation needed.
//
// Filter priority 6 so it runs AFTER the author block (priority 5) but
// BEFORE the in-content ads (priority 10). End result: byline → pros/cons
// hero → ads → main content.
add_filter('the_content', function ($content) {
    if (!is_singular('post')) return $content;

    // Match "<h2>Pros</h2><ul>...</ul>" — case-insensitive, tolerant of
    // attributes on the h2/h3 and either heading level. Same for Cons.
    if (!preg_match('/<(h2|h3)[^>]*>\s*pros\s*<\/\1>\s*(<ul[^>]*>.*?<\/ul>)/is', $content, $pm)) return $content;
    if (!preg_match('/<(h2|h3)[^>]*>\s*cons\s*<\/\1>\s*(<ul[^>]*>.*?<\/ul>)/is', $content, $cm)) return $content;

    $pros_ul = $pm[2];
    $cons_ul = $cm[2];

    // Build the hero block. We re-style the <li>s via the wrapper class so
    // the original markup stays untouched (and any explicit inline styles
    // on the source list still win).
    ob_start(); ?>
<div class="gr-proscons-hero" style="display:grid;grid-template-columns:1fr 1fr;gap:0;margin:0 0 28px;border:1px solid #e5e5e7;border-radius:10px;overflow:hidden;background:#fafafa">
  <div style="padding:18px 20px;border-right:1px solid #e5e5e7;background:linear-gradient(180deg,#f0fdf4 0%,#fafafa 100%)">
    <div style="display:flex;align-items:center;gap:6px;margin-bottom:10px">
      <span style="display:inline-flex;width:20px;height:20px;border-radius:999px;background:#16a34a;color:#fff;align-items:center;justify-content:center;font-size:13px;font-weight:700;line-height:1">+</span>
      <span style="font-size:12px;font-weight:800;color:#15803d;text-transform:uppercase;letter-spacing:.8px">Pros</span>
    </div>
    <div class="gr-pc-list gr-pc-pros"><?php echo $pros_ul; ?></div>
  </div>
  <div style="padding:18px 20px;background:linear-gradient(180deg,#fef2f2 0%,#fafafa 100%)">
    <div style="display:flex;align-items:center;gap:6px;margin-bottom:10px">
      <span style="display:inline-flex;width:20px;height:20px;border-radius:999px;background:#dc2626;color:#fff;align-items:center;justify-content:center;font-size:14px;font-weight:700;line-height:1">−</span>
      <span style="font-size:12px;font-weight:800;color:#b91c1c;text-transform:uppercase;letter-spacing:.8px">Cons</span>
    </div>
    <div class="gr-pc-list gr-pc-cons"><?php echo $cons_ul; ?></div>
  </div>
</div>
<style>
  .gr-proscons-hero .gr-pc-list ul { margin: 0; padding: 0; list-style: none; }
  .gr-proscons-hero .gr-pc-list li {
    position: relative; padding: 4px 0 4px 22px; font-size: 14px; line-height: 1.5; color: #1d1d1f;
  }
  .gr-proscons-hero .gr-pc-pros li::before {
    content: "✓"; position: absolute; left: 0; top: 4px; color: #16a34a; font-weight: 700;
  }
  .gr-proscons-hero .gr-pc-cons li::before {
    content: "×"; position: absolute; left: 0; top: 4px; color: #dc2626; font-weight: 700; font-size: 16px;
  }
  @media (max-width: 600px) {
    .gr-proscons-hero { grid-template-columns: 1fr !important; }
    .gr-proscons-hero > div:first-child { border-right: 0 !important; border-bottom: 1px solid #e5e5e7; }
  }
</style>
    <?php
    return ob_get_clean() . $content;
}, 6);

// ─── 7e. "Editors' Pick" badge on high-scoring reviews (≥ 4.5) ────────────────
//
// Visual differentiator on top-rated reviews. PCMag's gold "Editors' Choice"
// is one of their most clicked listing-page elements.
//
// Score source: parse the .gr-sc-num text inside the existing scorecard
// block (rendered by the blog generator). Avoids needing post-meta plumbing.
// If score ≥ 4.5, render a corner badge pinned to the top-right of the
// post. CSS-only — no JS runtime cost.
add_action('wp_footer', function () {
    if (!is_singular('post')) return;
    ?>
<style>
  .gr-editors-pick-badge {
    position: fixed; top: 96px; right: 24px; z-index: 99;
    background: linear-gradient(135deg, #FFC200 0%, #FFAB00 100%);
    color: #1d1d1f; font: 800 11px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    padding: 8px 14px 8px 10px; border-radius: 999px; text-transform: uppercase;
    letter-spacing: .8px; box-shadow: 0 6px 18px rgba(255,194,0,.4);
    display: none; align-items: center; gap: 6px; pointer-events: none;
  }
  .gr-editors-pick-badge.is-shown { display: inline-flex; }
  .gr-editors-pick-badge::before {
    content: "★"; font-size: 13px; line-height: 1;
  }
  @media (max-width: 900px) { .gr-editors-pick-badge { display: none !important; } }
</style>
<div class="gr-editors-pick-badge" id="gr-ep-badge">Editors&rsquo; Pick</div>
<script>
(function () {
  // Parse the verdict score off the existing scorecard. The blog generator
  // renders it as <div class="gr-sc-num">4.7</div> — always exactly one
  // decimal, always at the top of the verdict block. If no score is found,
  // the badge stays hidden.
  var num = document.querySelector('.gr-sc-num');
  if (!num) return;
  var score = parseFloat((num.textContent || '').trim());
  if (!isFinite(score) || score < 4.5) return;
  var b = document.getElementById('gr-ep-badge');
  if (b) b.classList.add('is-shown');
})();
</script>
    <?php
});

// ─── 7f. Related reviews carousel (bottom of every review) ───────────────────
//
// The single biggest retention play on every Tom's Guide / PCMag /
// TechRadar review page: a row of "Related" cards at the foot pulling
// visitors into the next review. We pull by shared tags first (most
// semantically related), fall back to category, then to most-recent if
// neither has a hit.
//
// Filter priority 22 — runs AFTER the author bio card at 20 so the row
// sits below it, just before comments / sidebar widgets.
add_filter('the_content', function ($content) {
    if (!is_singular('post')) return $content;
    $current_id = get_the_ID();
    if (!$current_id) return $content;

    // Transient cache for related-post IDs (12h TTL). Cuts 1-3 WP_Query
    // hits per single-post view → big DB win on busy sites without
    // an object cache. Cache stores IDs only (cheap); we re-hydrate post
    // objects for current titles/thumbnails.
    $cache_key = 'mvp_related_v1_' . $current_id;
    $cached_ids = get_transient($cache_key);
    if (is_array($cached_ids) && !empty($cached_ids)) {
        $related = array_values(array_filter(array_map('get_post', $cached_ids)));
    } else {
        $related = [];
    }

    if (empty($related)) {
        // ── Find related posts (tag overlap first, category fallback) ─────
        $tag_ids = wp_get_post_tags($current_id, ['fields' => 'ids']);
        $cat_ids = wp_get_post_categories($current_id, ['fields' => 'ids']);

        if (!empty($tag_ids)) {
            $q = new WP_Query([
                'post_type'           => 'post',
                'posts_per_page'      => 6,
                'post__not_in'        => [$current_id],
                'tag__in'             => $tag_ids,
                'orderby'             => 'date',
                'order'               => 'DESC',
                'ignore_sticky_posts' => true,
                'no_found_rows'       => true,
            ]);
            $related = $q->posts;
            wp_reset_postdata();
        }
        if (count($related) < 4 && !empty($cat_ids)) {
            $exclude = array_map(function ($p) { return $p->ID; }, $related);
            $exclude[] = $current_id;
            $needed = 6 - count($related);
            $q = new WP_Query([
                'post_type'           => 'post',
                'posts_per_page'      => $needed,
                'post__not_in'        => $exclude,
                'category__in'        => $cat_ids,
                'orderby'             => 'date',
                'order'               => 'DESC',
                'ignore_sticky_posts' => true,
                'no_found_rows'       => true,
            ]);
            $related = array_merge($related, $q->posts);
            wp_reset_postdata();
        }
        if (count($related) < 4) {
            $exclude = array_map(function ($p) { return $p->ID; }, $related);
            $exclude[] = $current_id;
            $needed = 6 - count($related);
            $q = new WP_Query([
                'post_type'           => 'post',
                'posts_per_page'      => $needed,
                'post__not_in'        => $exclude,
                'orderby'             => 'date',
                'order'               => 'DESC',
                'ignore_sticky_posts' => true,
                'no_found_rows'       => true,
            ]);
            $related = array_merge($related, $q->posts);
            wp_reset_postdata();
        }
        // Cache the IDs only — re-hydrate next time so titles/thumbs stay fresh.
        set_transient($cache_key, array_values(array_map(function ($p) { return $p->ID; }, $related)), 12 * HOUR_IN_SECONDS);
    }
    if (count($related) < 3) return $content;

    // ── Render ────────────────────────────────────────────────────────────
    ob_start(); ?>
<section class="gr-related-reviews" style="margin:48px 0 16px;padding:24px 0;border-top:1px solid #e5e5e7">
  <h2 style="margin:0 0 16px;font-size:13px;font-weight:800;color:#86868b;text-transform:uppercase;letter-spacing:1px">More reviews you'll want to read</h2>
  <div class="gr-rr-scroll" style="display:grid;grid-auto-flow:column;grid-auto-columns:minmax(220px,1fr);gap:16px;overflow-x:auto;scroll-snap-type:x mandatory;padding:4px 0 12px;scrollbar-width:thin">
    <?php foreach ($related as $p):
        $img = get_the_post_thumbnail_url($p->ID, 'medium');
        $url = get_permalink($p->ID);
        $title = get_the_title($p->ID); ?>
      <a class="gr-rr-card" href="<?php echo esc_url($url); ?>" style="scroll-snap-align:start;display:flex;flex-direction:column;border:1px solid #e5e5e7;border-radius:10px;overflow:hidden;text-decoration:none;color:#1d1d1f;background:#fff;transition:transform .15s,box-shadow .15s">
        <?php if ($img): ?>
          <div style="aspect-ratio:16/9;background:#f5f5f7 url(<?php echo esc_url($img); ?>) center/cover no-repeat"></div>
        <?php else: ?>
          <div style="aspect-ratio:16/9;background:#f5f5f7"></div>
        <?php endif; ?>
        <div style="padding:12px 14px 14px;flex:1">
          <p style="margin:0;font-size:14px;font-weight:700;line-height:1.35;color:#1d1d1f"><?php echo esc_html($title); ?></p>
          <p style="margin:10px 0 0;font-size:12px;font-weight:600;color:#7C3AED">Read review →</p>
        </div>
      </a>
    <?php endforeach; ?>
  </div>
</section>
<style>
  .gr-related-reviews .gr-rr-card:hover { transform: translateY(-2px); box-shadow: 0 8px 24px rgba(0,0,0,.08); }
  .gr-related-reviews .gr-rr-scroll::-webkit-scrollbar { height: 6px; }
  .gr-related-reviews .gr-rr-scroll::-webkit-scrollbar-thumb { background: #d2d2d7; border-radius: 999px; }
</style>
    <?php
    return $content . ob_get_clean();
}, 22);  // after 7c (priority 20 — author bio card) so this sits below it

// ─── 7g. "Recently Updated" homepage strip ───────────────────────────────────
//
// TechRadar's hallmark first strip — surfaces the 6 most-recently edited
// reviews so the homepage feels FRESH on every visit, even when no new
// content has shipped. Sort key is post_modified (covers both freshly-
// published and edited-then-republished).
//
// Rendered into wp_footer as a JS-inserted block that prepends itself to
// the first .entry-content / .site-content / main element. Falls back to
// document.body. Works across Kadence / Astra / GeneratePress / any theme
// without needing per-theme hooks.
add_action('wp_footer', function () {
    if (!is_home() && !is_front_page()) return;

    $q = new WP_Query([
        'post_type'           => 'post',
        'posts_per_page'      => 6,
        'orderby'             => 'modified',
        'order'               => 'DESC',
        'ignore_sticky_posts' => true,
        'no_found_rows'       => true,
    ]);
    if (!$q->have_posts()) return;

    $cards = [];
    foreach ($q->posts as $p) {
        $cards[] = [
            'title'    => get_the_title($p->ID),
            'url'      => get_permalink($p->ID),
            'image'    => get_the_post_thumbnail_url($p->ID, 'medium') ?: '',
            'modified' => get_the_modified_date('M j', $p->ID),
        ];
    }
    wp_reset_postdata();
    ?>
<style>
  .gr-recently-updated {
    max-width: 1200px; margin: 24px auto 32px; padding: 0 20px;
    font: 14px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }
  .gr-recently-updated h2 {
    margin: 0 0 14px; font-size: 13px; font-weight: 800; color: #86868b;
    text-transform: uppercase; letter-spacing: 1px;
  }
  .gr-recently-updated .gr-ru-scroll {
    display: grid; grid-auto-flow: column; grid-auto-columns: minmax(200px, 1fr);
    gap: 14px; overflow-x: auto; scroll-snap-type: x mandatory;
    padding: 2px 0 10px; scrollbar-width: thin;
  }
  .gr-recently-updated .gr-ru-card {
    scroll-snap-align: start; display: flex; flex-direction: column;
    border: 1px solid #e5e5e7; border-radius: 10px; overflow: hidden;
    text-decoration: none; color: #1d1d1f; background: #fff;
    transition: transform .15s, box-shadow .15s;
  }
  .gr-recently-updated .gr-ru-card:hover { transform: translateY(-2px); box-shadow: 0 8px 24px rgba(0,0,0,.08); }
  .gr-recently-updated .gr-ru-image { aspect-ratio: 16/9; background: #f5f5f7 center/cover no-repeat; position: relative; }
  .gr-recently-updated .gr-ru-pill {
    position: absolute; top: 8px; left: 8px; background: rgba(255,194,0,.95); color: #1d1d1f;
    font-size: 10px; font-weight: 800; padding: 3px 7px; border-radius: 999px;
    text-transform: uppercase; letter-spacing: .5px;
  }
  .gr-recently-updated .gr-ru-body { padding: 10px 12px 12px; }
  .gr-recently-updated .gr-ru-title { margin: 0; font-size: 13px; font-weight: 700; line-height: 1.35; color: #1d1d1f; }
  .gr-recently-updated .gr-ru-scroll::-webkit-scrollbar { height: 6px; }
  .gr-recently-updated .gr-ru-scroll::-webkit-scrollbar-thumb { background: #d2d2d7; border-radius: 999px; }
</style>
<script>
(function () {
  var data = <?php echo wp_json_encode($cards); ?>;
  if (!data || !data.length) return;

  // Skip posts the visitor can already see above the strip (the MVP theme's
  // hero + Editor's Picks show the newest posts, which are usually also the
  // most recently *modified* — without this the strip repeats the exact same
  // thumbnails that sit right above it and the homepage looks broken/spammy).
  var seen = {};
  document.querySelectorAll('.mvp-lead a[href], .mvp-section-picks a[href]').forEach(function (a) {
    seen[a.href.replace(/\/+$/, '')] = true;
  });
  data = data.filter(function (c) { return !seen[String(c.url).replace(/\/+$/, '')]; });
  if (data.length < 2) return; // a 1-card "strip" looks like a glitch — skip

  var wrap = document.createElement('div');
  wrap.className = 'gr-recently-updated';
  var html = '<h2>Recently updated</h2><div class="gr-ru-scroll">';
  data.forEach(function (c) {
    var img = c.image ? ('background-image:url(' + c.image.replace(/"/g, '%22') + ')') : '';
    html += '<a class="gr-ru-card" href="' + c.url + '">'
         +    '<div class="gr-ru-image" style="' + img + '"><span class="gr-ru-pill">Updated ' + c.modified + '</span></div>'
         +    '<div class="gr-ru-body"><p class="gr-ru-title">' + c.title.replace(/</g, '&lt;') + '</p></div>'
         + '</a>';
  });
  html += '</div>';
  wrap.innerHTML = html;

  // Place the strip BELOW the "Pick of the Day" / Editor's Pick hero so the
  // featured post stays the first thing visitors see. CRITICAL: anchors must
  // be normalized to their closest <section> — on the MVP Affiliate theme the
  // homepage articles live INSIDE css grids (.mvp-grid-4), and inserting the
  // strip next to an article there makes it a grid ITEM: cards overlap at
  // random sizes (the "messy Editor's Picks" bug, 2026-06-11). The strip must
  // only ever be a full-width sibling BETWEEN sections, never inside one.
  function placeAfter(el) {
    if (!el) return false;
    el = el.closest('section') || el;
    if (!el.parentNode) return false;
    el.parentNode.insertBefore(wrap, el.nextSibling);
    return true;
  }

  if (placeAfter(document.querySelector('.mvp-pick-homepage, .mvp-pick'))) return;

  // MVP Affiliate theme front page: drop the strip after the Editor's Picks
  // strip (or the lead hero) as its own row.
  if (placeAfter(document.querySelector('.mvp-section-picks, .mvp-lead'))) return;

  var firstArticle = document.querySelector(
    '.entry-content article:first-of-type, ' +
    '.site-content article:first-of-type, ' +
    'main article:first-of-type, ' +
    '#content article:first-of-type, ' +
    '#main article:first-of-type'
  );
  if (placeAfter(firstArticle)) return;

  // Fallback — prepend to main container.
  var host = document.querySelector('.entry-content, .site-content, main, #content, #main')
          || document.body;
  host.insertBefore(wrap, host.firstChild);
})();
</script>
    <?php
});

// ─── 7h. "/how-we-test" virtual methodology page ─────────────────────────────
//
// PCMag / Tom's Guide / TechRadar all link from every review to a "How we
// test" methodology page — strong E-E-A-T signal for Google + reader trust.
// We register a virtual route at /how-we-test/ that renders fully from the
// plugin (no WP page row needed). Content is auto-built from the brand
// profile so each user's site has a methodology page out of the box.
//
// The meta strip on every review (7c) will link to /how-we-test/ — added
// in the same plugin version.
// Two-path detection — we intercept the URL directly in template_redirect
// so we don't rely on WP's rewrite-rules cache (which only flushes on
// permalink-save or fresh plugin activation; plugin UPDATES don't fire
// register_activation_hook). The rewrite rule below is kept as a hint
// for completeness but the path match is what actually fires the page.
add_action('init', function () {
    add_rewrite_rule('^how-we-test/?$', 'index.php?gr_methodology=1', 'top');
});
add_filter('query_vars', function ($vars) {
    $vars[] = 'gr_methodology';
    return $vars;
});
add_action('template_redirect', function () {
    $is_methodology = intval(get_query_var('gr_methodology')) === 1;
    if (!$is_methodology) {
        // Fallback path detection — works whether rewrite rules were
        // flushed or not. We compare the request path against /how-we-test
        // with optional trailing slash.
        $uri = isset($_SERVER['REQUEST_URI']) ? (string) $_SERVER['REQUEST_URI'] : '';
        $path = trim((string) parse_url($uri, PHP_URL_PATH), '/');
        // Account for sites installed in a subdirectory.
        $home_path = trim((string) parse_url(home_url('/'), PHP_URL_PATH), '/');
        if ($home_path !== '' && strpos($path, $home_path . '/') === 0) {
            $path = substr($path, strlen($home_path) + 1);
        }
        if ($path !== 'how-we-test') return;
    }

    $data = mvp_affiliate_get_data();
    $brand_name = get_bloginfo('name');
    $author = $data['authorBlock'] ?? [];
    $author_name = trim((string) ($author['name'] ?? ''));
    $author_bio  = trim((string) ($author['tagline'] ?? ''));
    $author_photo = trim((string) ($author['photoUrl'] ?? ''));

    status_header(200);
    get_header();
    ?>
<main class="gr-how-we-test" style="max-width:760px;margin:48px auto;padding:0 20px;font:16px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1d1d1f">
  <p style="margin:0 0 8px;font-size:12px;font-weight:800;color:#7C3AED;text-transform:uppercase;letter-spacing:.8px">Methodology</p>
  <h1 style="margin:0 0 16px;font-size:36px;line-height:1.1;font-weight:800">How we test products at <?php echo esc_html($brand_name); ?></h1>
  <p style="font-size:18px;color:#3a3a3c;margin:0 0 32px">Every review on this site comes from a product we've actually had in our hands. No press releases. No specs read off a website. But not every review is the same kind of test — some are deep dives, some are first impressions, some are first-time tries. The review itself will tell you which kind it is, and the score reflects that.</p>

  <?php if ($author_name && $author_photo): ?>
  <div style="display:flex;align-items:center;gap:14px;padding:14px 16px;margin:0 0 32px;border:1px solid #e5e5e7;border-left:4px solid #FFC200;border-radius:6px;background:#fafafa">
    <img src="<?php echo esc_url($author_photo); ?>" alt="<?php echo esc_attr($author_name); ?>" loading="lazy" style="flex-shrink:0;width:56px;height:56px;border-radius:50%;object-fit:cover;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.1)" />
    <div>
      <p style="margin:0;font-size:11px;font-weight:800;color:#86868b;text-transform:uppercase;letter-spacing:.8px">Lead reviewer</p>
      <p style="margin:2px 0 4px;font-size:16px;font-weight:700">​<?php echo esc_html($author_name); ?></p>
      <?php if ($author_bio): ?><p style="margin:0;font-size:13px;color:#3a3a3c"><?php echo esc_html($author_bio); ?></p><?php endif; ?>
    </div>
  </div>
  <?php endif; ?>

  <h2 style="font-size:22px;margin:32px 0 12px;font-weight:700">What we test</h2>
  <p>Products in our catalogue are purchased, requested, or accepted as samples under a clear policy: we keep editorial control of every word. Reviews are not paid placements. Affiliate links are how the site stays free for readers — they never change what we say about a product.</p>

  <h2 style="font-size:22px;margin:32px 0 12px;font-weight:700">The four kinds of reviews you'll see</h2>
  <p>Not every product gets the same kind of test. We use four review types depending on the product, the question we're trying to answer, and how much time we've spent with it. The review itself will say which kind you're reading.</p>
  <div style="display:grid;gap:14px;margin:18px 0 8px">
    <div style="padding:14px 16px;border:1px solid #e5e5e7;border-left:4px solid #7C3AED;border-radius:6px;background:#fafafa">
      <p style="margin:0 0 4px;font-size:11px;font-weight:800;color:#7C3AED;text-transform:uppercase;letter-spacing:.8px">Full Review</p>
      <p style="margin:0;font-size:14px;color:#3a3a3c">We've used the product across multiple sessions in the real context it was built for. The pros and cons in a full review are the ones that surfaced over time — not the ones we noticed in the first ten minutes.</p>
    </div>
    <div style="padding:14px 16px;border:1px solid #e5e5e7;border-left:4px solid #FFC200;border-radius:6px;background:#fafafa">
      <p style="margin:0 0 4px;font-size:11px;font-weight:800;color:#a87600;text-transform:uppercase;letter-spacing:.8px">First Impressions</p>
      <p style="margin:0;font-size:14px;color:#3a3a3c">A day-one or week-one take. Useful for products you want a fast read on, with the caveat that we may come back and update the post once we've lived with it longer.</p>
    </div>
    <div style="padding:14px 16px;border:1px solid #e5e5e7;border-left:4px solid #0071e3;border-radius:6px;background:#fafafa">
      <p style="margin:0 0 4px;font-size:11px;font-weight:800;color:#0071e3;text-transform:uppercase;letter-spacing:.8px">First-Time Test</p>
      <p style="margin:0;font-size:14px;color:#3a3a3c">We've never used a product like this before. The review is written from the perspective of someone learning the category from scratch — which often catches friction a power user wouldn't even notice.</p>
    </div>
    <div style="padding:14px 16px;border:1px solid #e5e5e7;border-left:4px solid #16a34a;border-radius:6px;background:#fafafa">
      <p style="margin:0 0 4px;font-size:11px;font-weight:800;color:#15803d;text-transform:uppercase;letter-spacing:.8px">Out-of-the-Box Test</p>
      <p style="margin:0;font-size:14px;color:#3a3a3c">How the product fares with zero practice and no manual reading. If something needs a video tutorial before it makes sense, this kind of review surfaces that fast.</p>
    </div>
  </div>

  <h2 style="font-size:22px;margin:32px 0 12px;font-weight:700">What every review has in common</h2>
  <ul style="padding-left:22px">
    <li><strong>Hands-on, not desk-research.</strong> We don't review products from spec sheets. If you're reading a review here, we've held the product or used it.</li>
    <li><strong>Specific claims, not vibes.</strong> If we say something is loud, we say how loud. If we say it's heavy, we say how heavy or what we struggled to carry.</li>
    <li><strong>Trade-offs called out.</strong> No product is perfect. Every review names at least one real downside — and which buyer that downside actually matters to.</li>
    <li><strong>Score reflects the test.</strong> A First Impressions 4.5 isn't a promise the product stays a 4.5 forever — it's the score it earned in the test we ran. When deeper use changes the number, we update the post.</li>
  </ul>

  <h2 style="font-size:22px;margin:32px 0 12px;font-weight:700">How we score</h2>
  <p>Every review carries a 1–5 score. The label next to the number tells you what the score means in plain English:</p>
  <table style="width:100%;border-collapse:collapse;margin:14px 0 0;border:1px solid #e5e5e7;border-radius:6px;overflow:hidden;font-size:14px">
    <thead><tr style="background:#fafafa"><th style="text-align:left;padding:10px 14px;border-bottom:1px solid #e5e5e7;font-size:11px;text-transform:uppercase;letter-spacing:.6px;color:#86868b">Score</th><th style="text-align:left;padding:10px 14px;border-bottom:1px solid #e5e5e7;font-size:11px;text-transform:uppercase;letter-spacing:.6px;color:#86868b">Means</th></tr></thead>
    <tbody>
      <tr><td style="padding:10px 14px;border-bottom:1px solid #f0f0f0;font-weight:700">4.6–5.0</td><td style="padding:10px 14px;border-bottom:1px solid #f0f0f0">Exceptional</td></tr>
      <tr><td style="padding:10px 14px;border-bottom:1px solid #f0f0f0;font-weight:700">4.1–4.5</td><td style="padding:10px 14px;border-bottom:1px solid #f0f0f0">Excellent</td></tr>
      <tr><td style="padding:10px 14px;border-bottom:1px solid #f0f0f0;font-weight:700">3.6–4.0</td><td style="padding:10px 14px;border-bottom:1px solid #f0f0f0">Very Good</td></tr>
      <tr><td style="padding:10px 14px;border-bottom:1px solid #f0f0f0;font-weight:700">3.1–3.5</td><td style="padding:10px 14px;border-bottom:1px solid #f0f0f0">Good</td></tr>
      <tr><td style="padding:10px 14px;border-bottom:1px solid #f0f0f0;font-weight:700">2.6–3.0</td><td style="padding:10px 14px;border-bottom:1px solid #f0f0f0">Mixed</td></tr>
      <tr><td style="padding:10px 14px;border-bottom:1px solid #f0f0f0;font-weight:700">2.1–2.5</td><td style="padding:10px 14px;border-bottom:1px solid #f0f0f0">Disappointing</td></tr>
      <tr><td style="padding:10px 14px;font-weight:700">1.0–2.0</td><td style="padding:10px 14px">Avoid</td></tr>
    </tbody>
  </table>

  <h2 style="font-size:22px;margin:32px 0 12px;font-weight:700">Updates &amp; corrections</h2>
  <p>Reviews are living documents. When a product gets a meaningful update — a software change, a price shift that flips the verdict, or a long-term issue we couldn't see on day one — we revisit the post and bump the &ldquo;Updated&rdquo; date you see at the top. If we got something wrong, we mark the correction inline and explain what changed.</p>

  <h2 style="font-size:22px;margin:32px 0 12px;font-weight:700">Affiliate disclosure</h2>
  <p>Links to retailers (Amazon, Geniuslink, and others) on this site may earn a small commission when you click through and buy. That's how the site stays free. It never changes our score, our verdict, or which products we recommend. We've turned down products that didn't earn a recommendation, and we've kept products in the &ldquo;Avoid&rdquo; tier even when an affiliate would have rather we softened the language.</p>
</main>
    <?php
    get_footer();
    exit;
});
// Flush rewrites once on activation so the new rule is live without a manual
// permalink-save trip. Hooked to a transient so it runs exactly once.
register_activation_hook(__FILE__, function () {
    flush_rewrite_rules();
});
add_action('init', function () {
    if (get_option('gr_how_we_test_flushed_v1')) return;
    flush_rewrite_rules();
    update_option('gr_how_we_test_flushed_v1', 1);
}, 99);

// ─── 7i. Topic hub on tag + category archive pages ───────────────────────────
//
// Every tag (and primary category) archive on the site becomes a "Best
// [topic]" hub page. PCMag / Tom's Guide / TechRadar each have their hub
// pages as the highest-traffic non-review URLs — they aggregate every
// related review and surface the buying guide for the category.
//
// What this renders BEFORE the archive's normal post grid:
//   - Editorial header (topic title + count + description)
//   - Buying-guide promo card IF a guide tagged 'buying-guide' has the
//     matching seo_keyword or topic term in its title
//
// Injected via wp_footer JS so theme-independent — works on Kadence /
// Astra / GeneratePress / any classic theme. Inserts above the first
// .archive-description / .page-header / first <article> in main.
add_action('wp_footer', function () {
    if (!(is_tag() || is_category())) return;
    $term = get_queried_object();
    if (!$term || !isset($term->name)) return;

    $count       = isset($term->count) ? intval($term->count) : 0;
    $description = isset($term->description) ? wp_strip_all_tags($term->description) : '';
    $name        = (string) $term->name;
    $slug        = (string) ($term->slug ?? '');

    // Look up a buying guide that's likely about this topic. The guide
    // generator tags every guide with 'buying-guide' and writes the topic
    // into the title ("Best <topic> for 2026"). Match by case-insensitive
    // substring on the term name.
    $guide_url = '';
    $guide_title = '';
    $guide_img = '';
    if ($slug !== 'buying-guide') {
        // Resolve the 'buying-guide' tag.
        $bg_tag = get_term_by('slug', 'buying-guide', 'post_tag');
        if ($bg_tag) {
            $guide_q = new WP_Query([
                'post_type'           => 'post',
                'tag_id'              => $bg_tag->term_id,
                'posts_per_page'      => 10,
                's'                   => $name, // fuzzy match by title
                'ignore_sticky_posts' => true,
                'no_found_rows'       => true,
            ]);
            if ($guide_q->have_posts()) {
                $best = $guide_q->posts[0];
                $guide_url   = get_permalink($best->ID);
                $guide_title = get_the_title($best->ID);
                $guide_img   = get_the_post_thumbnail_url($best->ID, 'medium') ?: '';
            }
            wp_reset_postdata();
        }
    }

    $hub_label = is_tag() ? 'Topic' : 'Category';
    ?>
<style>
  .gr-topic-hub {
    max-width: 1200px; margin: 24px auto 32px; padding: 0 20px;
    font: 14px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }
  .gr-topic-hub .gr-th-eyebrow {
    font-size: 11px; font-weight: 800; color: #7C3AED;
    text-transform: uppercase; letter-spacing: 1px; margin: 0 0 8px;
  }
  .gr-topic-hub .gr-th-title {
    font-size: 32px; font-weight: 800; line-height: 1.1; margin: 0 0 8px;
    color: var(--global-palette1, #1d1d1f);
  }
  .gr-topic-hub .gr-th-meta {
    font-size: 14px; color: #6e6e73; margin: 0 0 16px;
  }
  .gr-topic-hub .gr-th-desc {
    font-size: 15px; line-height: 1.6; color: #3a3a3c; margin: 0 0 24px;
    max-width: 720px;
  }
  .gr-topic-hub .gr-th-guide {
    display: flex; gap: 16px; padding: 16px;
    background: linear-gradient(135deg, #f5f0ff 0%, #ede7ff 100%);
    border: 1px solid #d4c4ff; border-radius: 12px;
    text-decoration: none; color: inherit; transition: transform .15s, box-shadow .15s;
    margin: 0 0 24px;
  }
  .gr-topic-hub .gr-th-guide:hover { transform: translateY(-2px); box-shadow: 0 8px 24px rgba(124,58,237,.15); }
  .gr-topic-hub .gr-th-guide-image {
    flex-shrink: 0; width: 140px; aspect-ratio: 16/9; border-radius: 8px;
    background: #fff center/cover no-repeat;
  }
  .gr-topic-hub .gr-th-guide-body { min-width: 0; flex: 1; padding: 4px 0; }
  .gr-topic-hub .gr-th-guide-eyebrow {
    font-size: 10px; font-weight: 800; color: #7C3AED;
    text-transform: uppercase; letter-spacing: .8px; margin: 0 0 4px;
  }
  .gr-topic-hub .gr-th-guide-title {
    font-size: 17px; font-weight: 700; line-height: 1.3; margin: 0 0 6px;
    color: #1d1d1f;
  }
  .gr-topic-hub .gr-th-guide-cta {
    font-size: 13px; font-weight: 600; color: #7C3AED;
  }
  @media (max-width: 600px) {
    .gr-topic-hub .gr-th-title { font-size: 24px; }
    .gr-topic-hub .gr-th-guide-image { width: 96px; }
  }
</style>
<script>
(function () {
  var data = <?php echo wp_json_encode([
      'eyebrow'      => $hub_label,
      'title'        => $name,
      'count'        => $count,
      'description'  => $description,
      'guideUrl'     => $guide_url,
      'guideTitle'   => $guide_title,
      'guideImage'   => $guide_img,
  ]); ?>;
  if (!data || !data.title) return;
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  var html = '<div class="gr-topic-hub">'
    + '<p class="gr-th-eyebrow">' + escapeHtml(data.eyebrow) + '</p>'
    + '<h1 class="gr-th-title">Best ' + escapeHtml(data.title) + ' reviews</h1>'
    + '<p class="gr-th-meta">' + escapeHtml(String(data.count)) + ' review' + (data.count === 1 ? '' : 's') + ' in this topic</p>';
  if (data.description) {
    html += '<p class="gr-th-desc">' + escapeHtml(data.description) + '</p>';
  }
  if (data.guideUrl && data.guideTitle) {
    var img = data.guideImage ? ('background-image:url(' + data.guideImage.replace(/"/g, '%22') + ')') : '';
    html += '<a class="gr-th-guide" href="' + data.guideUrl + '">'
         +    '<div class="gr-th-guide-image" style="' + img + '"></div>'
         +    '<div class="gr-th-guide-body">'
         +      '<p class="gr-th-guide-eyebrow">✦ Buying guide</p>'
         +      '<p class="gr-th-guide-title">' + escapeHtml(data.guideTitle) + '</p>'
         +      '<p class="gr-th-guide-cta">See our top picks →</p>'
         +    '</div>'
         +  '</a>';
  }
  html += '</div>';
  var wrap = document.createElement('div');
  wrap.innerHTML = html;
  var hub = wrap.firstChild;

  // Place ABOVE the post grid. Try in order:
  // 1. .archive-description / .page-header / .term-description (replace title)
  // 2. First article in main
  // 3. Top of main container
  var anchor = document.querySelector('.archive-description, .page-header, .term-description');
  if (anchor && anchor.parentNode) {
    anchor.parentNode.insertBefore(hub, anchor);
    anchor.style.display = 'none'; // hide the theme's default archive header (we replaced it)
    return;
  }
  var firstArticle = document.querySelector('.entry-content article:first-of-type, main article:first-of-type, .site-content article:first-of-type, #content article:first-of-type');
  if (firstArticle && firstArticle.parentNode) {
    firstArticle.parentNode.insertBefore(hub, firstArticle);
    return;
  }
  var host = document.querySelector('.entry-content, .site-content, main, #content, #main') || document.body;
  host.insertBefore(hub, host.firstChild);
})();
</script>
    <?php
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
//
// `orderby=rand` on a posts table is a known killer — MySQL does a full-table
// sort on every page hit. Replace with a cached pool of 50 recent IDs that we
// shuffle in PHP per request. Refresh once a day.
add_action('kadence_after_main_content', function () {
    if (mvp_affiliate_theme_active()) return;
    if (!is_singular('post') && !is_home() && !is_front_page() && !is_archive()) return;

    $pool_key = 'mvp_random_pool_v1';
    $pool = get_transient($pool_key);
    if (!is_array($pool) || empty($pool)) {
        $q = new WP_Query([
            'post_type'           => 'post',
            'post_status'         => 'publish',
            'posts_per_page'      => 50,
            'orderby'             => 'date',
            'order'               => 'DESC',
            'fields'              => 'ids',
            'ignore_sticky_posts' => true,
            'no_found_rows'       => true,
        ]);
        $pool = $q->posts;
        wp_reset_postdata();
        if (!empty($pool)) set_transient($pool_key, $pool, DAY_IN_SECONDS);
    }
    if (empty($pool)) return;

    $current = is_singular('post') ? get_the_ID() : 0;
    $candidates = array_values(array_filter($pool, function ($id) use ($current) { return (int) $id !== (int) $current; }));
    shuffle($candidates);
    $pick_ids = array_slice($candidates, 0, 8);
    if (empty($pick_ids)) return;

    $random = new WP_Query([
        'post_type'           => 'post',
        'post_status'         => 'publish',
        'posts_per_page'      => count($pick_ids),
        'post__in'            => $pick_ids,
        'orderby'             => 'post__in',
        'ignore_sticky_posts' => true,
        'no_found_rows'       => true,
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
    <div class="mvpaffiliate-logo-banner" style="background:<?php echo esc_attr($bg); ?>;width:100%;padding:10px 20px;text-align:center;position:relative;z-index:9999;">
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
      div.style.cssText = 'background:<?php echo esc_js($bg); ?>;width:100%;padding:10px 20px;text-align:center;position:relative;z-index:9999;';
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

// ─── 11b. Sticky "On this page" table of contents ─────────────────────────────
// Every major review site (Tom's Guide, TechRadar, PCMag, Digital Trends) puts
// a Jump-To menu on every long-form review. Pure reader UX + dwell-time signal
// Google likes. We scan the post body for H2/H3 headings, generate slugged
// anchors if they don't already have IDs, and render a floating sidebar
// that highlights the current section as the reader scrolls.
//
//   Desktop (≥1100px): fixed right-rail panel, ~240px wide.
//   Mobile  (<1100px): collapsible card pinned just under the post title.
//
// Skips when the post has fewer than 3 H2s — TOCs on short posts feel like
// scaffolding rather than navigation.
add_action('wp_footer', function () {
    if (!is_singular('post')) return;
    // Skip TOC on Deals Hub posts. Deal posts have a tight 4-section
    // structure (At a glance / Why / What you're getting / Before you
    // buy) that doesn't benefit from a Jump-To menu — the post is short
    // enough to read top-to-bottom. We detect by sniffing the raw post
    // content for the [mvp_deal_banner] shortcode (always emitted by the
    // dashboard at the top of every deal post).
    $post = get_post();
    if ($post && is_string($post->post_content) && stripos($post->post_content, '[mvp_deal_banner') !== false) return;
    ?>
<style id="gr-toc-styles">
  .gr-toc{font-family:inherit;font-size:13px;line-height:1.4}
  .gr-toc__title{font-size:11px;font-weight:800;color:#86868b;text-transform:uppercase;letter-spacing:.8px;margin:0 0 10px;padding-bottom:8px;border-bottom:1px solid #e5e5e7}
  .gr-toc__list{list-style:none;padding:0;margin:0}
  .gr-toc__item{margin:0;padding:0}
  .gr-toc__link{display:block;padding:6px 8px;border-radius:6px;color:#3a3a3c;text-decoration:none;border-left:2px solid transparent;transition:all .15s ease}
  .gr-toc__link:hover{background:#f5f5f7;color:#1d1d1f}
  .gr-toc__link.is-active{background:#fff5d1;color:#1d1d1f;font-weight:600;border-left-color:#FFC200}
  .gr-toc__item--h3 .gr-toc__link{padding-left:20px;font-size:12px;color:#6e6e73}
  /* Desktop — fixed right-rail panel. */
  @media(min-width:1100px){
    #gr-toc{position:fixed;top:120px;right:24px;width:240px;max-height:calc(100vh - 160px);overflow-y:auto;background:#fff;border:1px solid #e5e5e7;border-radius:8px;padding:14px 12px;box-shadow:0 1px 3px rgba(0,0,0,.04);z-index:50}
  }
  /* Mobile — sticky card pinned under the post title. */
  @media(max-width:1099px){
    #gr-toc{position:relative;margin:0 0 24px;background:#fafafa;border:1px solid #e5e5e7;border-radius:8px;padding:12px 14px}
    .gr-toc__list{max-height:0;overflow:hidden;transition:max-height .25s ease}
    #gr-toc.is-open .gr-toc__list{max-height:600px}
    .gr-toc__title{margin:0;padding:0;cursor:pointer;display:flex;align-items:center;justify-content:space-between}
    .gr-toc__title::after{content:'▾';transition:transform .2s ease;font-size:12px}
    #gr-toc.is-open .gr-toc__title::after{transform:rotate(180deg)}
    #gr-toc.is-open .gr-toc__title{margin-bottom:10px;padding-bottom:8px;border-bottom:1px solid #e5e5e7}
  }
  @media print{#gr-toc{display:none}}
</style>
<script>
(function(){
  if (document.getElementById('gr-toc')) return;
  // Match the theme's content container — Gomin Reviews theme uses
  // .entry-content, Kadence uses .entry-content too, classic themes
  // sometimes use .post-content. Try the common ones in order.
  var article = document.querySelector('.entry-content') || document.querySelector('.post-content') || document.querySelector('article .single-content');
  if (!article) return;
  var headings = article.querySelectorAll('h2, h3');
  // Filter out the FAQ heading + related-posts heading + any heading inside
  // helper widgets (cta cards, verdict boxes) — they're not body sections.
  var bodyHeadings = [];
  for (var i = 0; i < headings.length; i++) {
    var h = headings[i];
    if (h.closest('.gr-cta-card, .gr-verdict-box, .gr-scorecard, .gr-rating-box, .gr-author-bio-card, .gr-post-meta, .gr-related-reviews')) continue;
    bodyHeadings.push(h);
  }
  // Skip TOC entirely on short posts — under 3 H2s feels like padding.
  var h2Count = bodyHeadings.filter(function(h){ return h.tagName === 'H2' }).length;
  if (h2Count < 3) return;

  // Slugify utility — turns heading text into an anchor id. Strips
  // accents, lowercases, replaces non-alphanumerics with dashes.
  function slugify(s){
    return (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'')
      .replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,60);
  }
  var seen = {};
  var items = bodyHeadings.map(function(h){
    if (!h.id) {
      var base = slugify(h.textContent);
      var id = base;
      var n = 1;
      while (seen[id] || document.getElementById(id)) { id = base + '-' + (++n); }
      h.id = id;
    }
    seen[h.id] = true;
    return { id: h.id, text: h.textContent.trim(), level: h.tagName.toLowerCase() };
  });
  if (items.length === 0) return;

  // Build the TOC element.
  var toc = document.createElement('aside');
  toc.id = 'gr-toc';
  toc.className = 'gr-toc';
  toc.setAttribute('aria-label', 'On this page');
  var html = '<p class="gr-toc__title">On this page</p><ul class="gr-toc__list">';
  for (var j = 0; j < items.length; j++) {
    var it = items[j];
    html += '<li class="gr-toc__item gr-toc__item--' + it.level + '">' +
            '<a class="gr-toc__link" href="#' + it.id + '" data-target="' + it.id + '">' +
            it.text.replace(/</g,'&lt;') + '</a></li>';
  }
  html += '</ul>';
  toc.innerHTML = html;

  // Desktop placement: append to <body> so position:fixed works cleanly.
  // Mobile placement: insert before the article so it sits between the
  // title and the body. We always insert before .entry-content; the CSS
  // makes the mobile vs desktop layout the difference.
  var insertBefore = article;
  if (insertBefore && insertBefore.parentNode) {
    insertBefore.parentNode.insertBefore(toc, insertBefore);
  } else {
    document.body.appendChild(toc);
  }

  // Mobile collapse toggle — the whole title is clickable.
  var title = toc.querySelector('.gr-toc__title');
  if (title) {
    title.addEventListener('click', function(e){
      if (window.innerWidth >= 1100) return; // desktop is always open
      toc.classList.toggle('is-open');
    });
  }

  // Smooth-scroll on click + close the mobile collapse.
  toc.addEventListener('click', function(e){
    var link = e.target.closest('.gr-toc__link');
    if (!link) return;
    e.preventDefault();
    var id = link.getAttribute('data-target');
    var target = document.getElementById(id);
    if (target) {
      var top = target.getBoundingClientRect().top + window.pageYOffset - 80;
      window.scrollTo({ top: top, behavior: 'smooth' });
      history.replaceState(null, '', '#' + id);
      if (window.innerWidth < 1100) toc.classList.remove('is-open');
    }
  });

  // Scroll-spy: highlight the link whose heading is currently near the top.
  // Throttled to ~60fps via requestAnimationFrame so it scales smoothly
  // even on posts with 15+ headings.
  var links = toc.querySelectorAll('.gr-toc__link');
  var rafScheduled = false;
  function updateActive(){
    rafScheduled = false;
    var activeIdx = 0;
    for (var k = 0; k < items.length; k++) {
      var el = document.getElementById(items[k].id);
      if (!el) continue;
      if (el.getBoundingClientRect().top - 120 < 0) activeIdx = k;
      else break;
    }
    for (var m = 0; m < links.length; m++) {
      links[m].classList.toggle('is-active', m === activeIdx);
    }
  }
  function onScroll(){
    if (!rafScheduled) {
      rafScheduled = true;
      requestAnimationFrame(updateActive);
    }
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  updateActive();
})();
</script>
    <?php
});

// ─── 11c. AI Product Finder — floating ask-anything widget ────────────────────
//
// What it does: visitors click the floating pill bottom-right ("Ask {Brand}"),
// type a real-world question ("sleep mask for side sleepers under $30"), and
// get 3 ranked reviews from THIS blog's catalogue with a one-line "why it
// fits" reason on each card. Powered by Haiku on the MVP backend; the blog's
// reviews are the entire knowledge base.
//
// Brand naming: the widget asks the backend for the brand name; if missing
// it falls back to the WordPress site name (get_bloginfo('name')). User-facing
// strings: "Ask {Brand}" on the pill, "Tell me what you're shopping for"
// on the input placeholder.
//
// Display gate: hidden on /wp-admin and on customizer previews. Otherwise
// shown on every public front-end page.
add_action('wp_footer', function () {
    if (is_admin()) return;
    // Skip on login / password-recovery / activation flows — the widget
    // has no business on those screens and was rendering on wp-login.php
    // because is_admin() is false there. $GLOBALS['pagenow'] is set by
    // WP core before wp_footer fires.
    $pagenow = isset($GLOBALS['pagenow']) ? (string) $GLOBALS['pagenow'] : '';
    if (in_array($pagenow, ['wp-login.php', 'wp-register.php', 'wp-activate.php', 'wp-signup.php'], true)) return;
    // Brand name renders inside two HTML <span>s, so esc_html. Site URL
    // renders inside a JS string literal so esc_js. Mixing these risks XSS
    // or broken JS, hence the two-escape split.
    $brand_fallback_html = esc_html(get_bloginfo('name'));
    $site_url            = esc_js(home_url('/'));
    $backend             = 'https://www.mvpaffiliate.io';
    ?>
<style id="mvp-pf-css">
  /* Two modes — see the JS below for how we toggle between them.
     2026-06-07: was a big bottom-center pill that competed with the
     orange sticky Amazon CTA — user feedback "too intrusive". Now we
     try to drop the button INSIDE the theme's sticky header next to
     the search icon, and only fall back to a small floating icon
     when that injection can't find an obvious anchor. */

  /* Default (fallback) — small floating circular icon in the top-right.
     Set far enough from the top to clear most sticky headers. Much
     less intrusive than the old bottom-center pill. */
  .mvp-pf-fab {
    position: fixed; top: 80px; right: 16px;
    z-index: 9998;
    width: 36px; height: 36px;
    background: #7C3AED; color: #fff; border: 0; border-radius: 999px;
    font: 600 13px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    box-shadow: 0 6px 16px rgba(124,58,237,.30); cursor: pointer; display: inline-flex;
    align-items: center; justify-content: center; padding: 0;
    transition: transform .12s ease, box-shadow .12s ease;
  }
  .mvp-pf-fab .mvp-pf-spark {
    width: 16px; height: 16px; display: inline-flex; align-items: center; justify-content: center; font-size: 14px;
  }
  /* Label is hidden in icon mode; revealed only when the button has
     been injected as a pill into the header (mvp-pf-fab--inline). */
  .mvp-pf-fab #mvp-pf-fab-label { display: none; }
  .mvp-pf-fab:hover { transform: translateY(-1px); box-shadow: 0 8px 22px rgba(124,58,237,.40); }

  /* Injected variant — sits inside the host theme's header next to the
     search icon. Drops the fixed positioning and matches a normal
     header-icon-button footprint. */
  .mvp-pf-fab--inline {
    position: static; top: auto; right: auto;
    width: auto; height: auto;
    padding: 6px 12px 6px 10px; gap: 6px;
    border-radius: 999px;
    box-shadow: 0 2px 6px rgba(124,58,237,.20);
    vertical-align: middle; margin: 0 4px;
  }
  .mvp-pf-fab--inline #mvp-pf-fab-label { display: inline; font-size: 12px; }
  .mvp-pf-fab--inline .mvp-pf-spark { background: rgba(255,255,255,.18); border-radius: 999px; width: 18px; height: 18px; }
  .mvp-pf-fab--inline:hover { transform: none; }
  @media (max-width: 600px) {
    /* On phones the header is dense — drop the label so it stays an icon. */
    .mvp-pf-fab--inline { padding: 6px; gap: 0; }
    .mvp-pf-fab--inline #mvp-pf-fab-label { display: none; }
  }

  .mvp-pf-panel {
    /* In both fallback (top-right icon) and inline (header icon) modes
       the panel pops DOWN from the icon. Anchored top-right so it
       never collides with the bottom sticky Amazon CTA. */
    position: fixed; top: 124px; right: 16px;
    z-index: 10001;
    width: 360px; max-width: calc(100vw - 32px); max-height: 70vh; overflow: auto;
    background: #fff; color: #1d1d1f; border: 1px solid #e5e5e7; border-radius: 14px;
    box-shadow: 0 24px 60px rgba(0,0,0,.18); font: 14px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }
  .mvp-pf-panel header {
    padding: 14px 16px 10px; border-bottom: 1px solid #f0f0f0;
    display: flex; align-items: center; justify-content: space-between; gap: 8px;
  }
  .mvp-pf-panel header .ttl { font-weight: 700; font-size: 15px; color: #1d1d1f; }
  .mvp-pf-panel header .sub { font-size: 11px; color: #6e6e73; margin-top: 2px; }
  .mvp-pf-panel header button {
    background: none; border: 0; font-size: 22px; line-height: 1; color: #6e6e73; cursor: pointer; padding: 0 6px;
  }
  .mvp-pf-panel .form { padding: 12px 16px; display: flex; gap: 8px; }
  .mvp-pf-panel .form input {
    flex: 1; border: 1px solid #d2d2d7; border-radius: 8px; padding: 10px 12px; font: inherit; color: #1d1d1f;
    outline: none;
  }
  .mvp-pf-panel .form input:focus { border-color: #7C3AED; box-shadow: 0 0 0 3px rgba(124,58,237,.15); }
  .mvp-pf-panel .form button {
    background: #7C3AED; color: #fff; border: 0; border-radius: 8px; padding: 0 14px; font: 600 13px/1 inherit; cursor: pointer;
  }
  .mvp-pf-panel .results { padding: 4px 16px 16px; }
  .mvp-pf-panel .empty { padding: 14px 16px 20px; font-size: 13px; color: #6e6e73; }
  .mvp-pf-panel .card {
    display: flex; gap: 10px; padding: 10px; border: 1px solid #f0f0f0; border-radius: 10px; margin-top: 10px;
    background: #fafafa; text-decoration: none; color: #1d1d1f;
  }
  .mvp-pf-panel .card:hover { background: #f0e9ff; border-color: #d4c4ff; }
  .mvp-pf-panel .card img {
    width: 64px; height: 64px; object-fit: cover; border-radius: 8px; flex-shrink: 0; background: #eee;
  }
  .mvp-pf-panel .card .body { min-width: 0; }
  .mvp-pf-panel .card .name { font-weight: 700; font-size: 14px; line-height: 1.2; margin-bottom: 4px; color: #1d1d1f; }
  .mvp-pf-panel .card .why { font-size: 12px; color: #3a3a3c; line-height: 1.4; }
  .mvp-pf-panel .card .score {
    display: inline-block; font-size: 11px; font-weight: 700; color: #7C3AED; background: rgba(124,58,237,.1);
    padding: 2px 6px; border-radius: 4px; margin-top: 4px;
  }
  .mvp-pf-spin {
    display: inline-block; width: 14px; height: 14px; border: 2px solid #d2d2d7; border-top-color: #7C3AED;
    border-radius: 999px; animation: mvp-pf-rot .8s linear infinite; vertical-align: middle; margin-right: 6px;
  }
  @keyframes mvp-pf-rot { to { transform: rotate(360deg); } }
  .mvp-pf-hidden { display: none !important; }
  @media (prefers-color-scheme: dark) {
    .mvp-pf-panel { background: #1c1c1e; color: #f5f5f7; border-color: #2c2c2e; }
    .mvp-pf-panel header { border-bottom-color: #2c2c2e; }
    .mvp-pf-panel header .ttl { color: #f5f5f7; }
    .mvp-pf-panel header .sub { color: #98989d; }
    .mvp-pf-panel .form input { background: #2c2c2e; border-color: #3a3a3c; color: #f5f5f7; }
    .mvp-pf-panel .card { background: #2c2c2e; border-color: #3a3a3c; color: #f5f5f7; }
    .mvp-pf-panel .card:hover { background: #3a2c5e; border-color: #7C3AED; }
    .mvp-pf-panel .card .name { color: #f5f5f7; }
    .mvp-pf-panel .card .why { color: #d2d2d7; }
  }
</style>
<button class="mvp-pf-fab" id="mvp-pf-fab" aria-label="Ask for product picks">
  <span class="mvp-pf-spark" aria-hidden="true">✦</span><span id="mvp-pf-fab-label">Ask <?php echo $brand_fallback_html; ?></span>
</button>
<div class="mvp-pf-panel mvp-pf-hidden" id="mvp-pf-panel" role="dialog" aria-labelledby="mvp-pf-title">
  <header>
    <div>
      <div class="ttl" id="mvp-pf-title">Ask <?php echo $brand_fallback_html; ?></div>
      <div class="sub">AI-powered picks from our reviews</div>
    </div>
    <button id="mvp-pf-close" aria-label="Close">×</button>
  </header>
  <form class="form" id="mvp-pf-form">
    <input id="mvp-pf-q" type="text" placeholder="Tell me what you're shopping for…" maxlength="300" autocomplete="off" />
    <button type="submit">Ask</button>
  </form>
  <div class="results" id="mvp-pf-results"></div>
</div>
<script>
(function () {
  var fab   = document.getElementById('mvp-pf-fab');
  var panel = document.getElementById('mvp-pf-panel');
  var title = document.getElementById('mvp-pf-title');
  var label = document.getElementById('mvp-pf-fab-label');
  var form  = document.getElementById('mvp-pf-form');
  var input = document.getElementById('mvp-pf-q');
  var out   = document.getElementById('mvp-pf-results');
  var close = document.getElementById('mvp-pf-close');
  if (!fab || !panel) return;

  var SITE = '<?php echo $site_url; ?>';
  var API  = '<?php echo $backend; ?>/api/blog/product-finder';
  var brandKnown = false;

  // Try to drop the button INTO the theme's sticky header next to the
  // search icon. If we can find a recognizable search-toggle anchor,
  // we switch the FAB into "inline pill" mode and remove its floating
  // position. Otherwise it stays in the default small top-right icon
  // (fallback) — still much less intrusive than the old bottom-center
  // pill that competed with the sticky Amazon CTA bar. 2026-06-07.
  function tryInjectIntoHeader() {
    // Selectors ordered most-specific (Kadence sticky) → most-generic
    // (any header element that looks like a search trigger). First
    // match wins and we stop.
    var candidates = [
      // Kadence sticky header search trigger (the user's theme):
      '.kadence-sticky-header-inner .kadence-header-search-toggle',
      '.kadence-sticky-header-inner [class*="search-toggle"]',
      '.kadence-sticky-header-inner [class*="header-search"]',
      // Kadence non-sticky header (so the button still gets a home
      // when the sticky variant isn't enabled):
      '.site-header .kadence-header-search-toggle',
      '.kadence-header-search-toggle',
      // Generic — most themes name search toggles something like this:
      '.header-search-toggle',
      '.search-toggle-open',
      '.menu-item-search',
      'header [class*="search-toggle"]',
      'header [class*="header-search"]',
      'nav [class*="search-toggle"]',
    ];
    for (var i = 0; i < candidates.length; i++) {
      var anchor = document.querySelector(candidates[i]);
      if (anchor && anchor.parentNode) {
        // Found a search icon — drop the FAB right after it as a
        // sibling. Move it instead of cloning so the existing click
        // listeners + panel id wiring keeps working.
        anchor.parentNode.insertBefore(fab, anchor.nextSibling);
        fab.classList.add('mvp-pf-fab--inline');
        return true;
      }
    }
    return false;
  }

  // Headers sometimes render after DOMContentLoaded (Kadence's sticky
  // header is JS-mounted). Try immediately, then re-try a few times to
  // catch late-mounted headers. If still not found we leave the FAB
  // in floating-icon fallback mode.
  var attempts = 0;
  (function tryLater() {
    if (tryInjectIntoHeader()) return;
    attempts++;
    if (attempts < 6) setTimeout(tryLater, 300);
  })();

  fab.addEventListener('click', function () {
    panel.classList.toggle('mvp-pf-hidden');
    if (!panel.classList.contains('mvp-pf-hidden')) setTimeout(function () { input.focus(); }, 50);
  });
  close.addEventListener('click', function () { panel.classList.add('mvp-pf-hidden'); });

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var q = (input.value || '').trim();
    if (!q) return;
    out.innerHTML = '<div class="empty"><span class="mvp-pf-spin"></span>Finding the best picks…</div>';

    fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ site: SITE, q: q }),
    })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (x) {
        if (!x.ok) {
          out.innerHTML = '<div class="empty">' + escapeHtml(x.j && x.j.error || 'Couldn\'t reach the finder.') + '</div>';
          return;
        }
        // Re-brand once the backend tells us the canonical brand name
        if (!brandKnown && x.j.brand) {
          var bn = 'Ask ' + escapeHtml(x.j.brand);
          title.textContent = 'Ask ' + x.j.brand;
          label.textContent = 'Ask ' + x.j.brand;
          brandKnown = true;
        }
        var picks = (x.j && x.j.picks) || [];
        if (picks.length === 0) {
          out.innerHTML = '<div class="empty">Nothing in our reviews matches that yet. Try a different phrase.</div>';
          return;
        }
        var html = '';
        picks.forEach(function (p) {
          var img = p.image ? '<img src="' + escapeHtml(p.image) + '" alt="" loading="lazy" />' : '<img alt="" />';
          var score = p.score ? '<div class="score">' + escapeHtml(p.score) + '/5</div>' : '';
          html += '<a class="card" href="' + escapeHtml(p.url) + '">'
            + img
            + '<div class="body"><div class="name">' + escapeHtml(p.title) + '</div>'
            + '<div class="why">' + escapeHtml(p.reason) + '</div>'
            + score + '</div></a>';
        });
        out.innerHTML = html;
      })
      .catch(function () {
        out.innerHTML = '<div class="empty">Couldn\'t reach the finder. Try again in a moment.</div>';
      });
  });
})();
</script>
    <?php
});

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

// ─── 13c2. FAQ structured data (FAQPage JSON-LD) ─────────────────────────────
//
// Every review the blog generator produces ends with a "Frequently Asked
// Questions" H2 followed by H3 question + answer paragraph(s). Google
// rewards FAQPage schema with rich results (expandable Q/A snippets in
// search) — one of the highest-leverage SEO additions per line of code.
//
// We scan the post content from the FAQ heading onward, extract question
// + answer pairs, and emit a SEPARATE <script type="application/ld+json">
// for the FAQPage (lives alongside the existing Review schema written by
// the blog generator into mvp_jsonld post-meta).
add_action('wp_head', function () {
    if (!is_singular('post')) return;
    $post = get_post(get_queried_object_id());
    if (!$post || !$post->post_content) return;

    // Find the FAQ section start — case-insensitive, tolerant of heading
    // level + class attributes.
    if (!preg_match('/<(h2|h3)[^>]*>\s*(?:Frequently\s+Asked\s+Questions|FAQ|FAQs)\s*<\/\1>/i', $post->post_content, $hm, PREG_OFFSET_CAPTURE)) return;
    $faq_start = $hm[0][1] + strlen($hm[0][0]);
    $faq_chunk = substr($post->post_content, $faq_start);

    // Cut at the next H2 (next major section, e.g. wrap-up)
    if (preg_match('/<h2[^>]*>/i', $faq_chunk, $nxt, PREG_OFFSET_CAPTURE)) {
        $faq_chunk = substr($faq_chunk, 0, $nxt[0][1]);
    }

    // Pull every H3 question + the content that follows (until the next H3
    // or end of chunk).
    if (!preg_match_all('/<h3[^>]*>(.*?)<\/h3>(.*?)(?=<h3|\z)/is', $faq_chunk, $qa_matches, PREG_SET_ORDER)) return;

    $items = [];
    foreach ($qa_matches as $m) {
        $q = trim(html_entity_decode(strip_tags((string) $m[1]), ENT_QUOTES, 'UTF-8'));
        // Strip tags but preserve some text structure (paragraph breaks → spaces)
        $a_html = (string) $m[2];
        $a_html = preg_replace('/<\/(p|li|ul|ol|div)>/i', ' ', $a_html);
        $a = trim(html_entity_decode(strip_tags($a_html), ENT_QUOTES, 'UTF-8'));
        $a = preg_replace('/\s+/', ' ', $a);
        if ($q === '' || $a === '' || mb_strlen($a) < 20) continue;
        $items[] = [
            '@type' => 'Question',
            'name'  => $q,
            'acceptedAnswer' => [
                '@type' => 'Answer',
                'text'  => $a,
            ],
        ];
        if (count($items) >= 10) break; // Google ignores >10 anyway
    }
    if (count($items) < 2) return; // need at least 2 Q/A for FAQPage to qualify

    $faq = [
        '@context'   => 'https://schema.org',
        '@type'      => 'FAQPage',
        'mainEntity' => $items,
    ];
    echo "\n<script type=\"application/ld+json\">"
       . wp_json_encode($faq, JSON_UNESCAPED_UNICODE | JSON_HEX_TAG | JSON_HEX_AMP)
       . "</script>\n";
}, 6);

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

// ─── 13c. Google AdSense (BYO-theme sites) ───────────────────────────────────
// The MVP Affiliate THEME injects AdSense itself, so we skip when it's active
// (avoids loading adsbygoogle.js twice → the exact double-script error). On a
// 3rd-party / custom theme (Kadence, Astra, Elementor, etc.) the theme won't,
// so the plugin does it here from the dashboard-saved ca-pub publisher ID:
// the google-adsense-account verification meta + Google's official Auto-ads
// loader. Built from a strictly-validated ID — never raw user markup.
add_action('wp_head', function () {
    if (mvp_affiliate_theme_active()) return;
    $id = trim(mvp_affiliate_get_data()['adsenseClientId'] ?? '');
    if (!preg_match('/^ca-pub-\d{10,20}$/', $id)) return;
    echo "\n<!-- MVP Affiliate: Google AdSense -->\n";
    echo '<meta name="google-adsense-account" content="' . esc_attr($id) . '">' . "\n";
    echo '<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=' . esc_attr($id) . '" crossorigin="anonymous"></script>' . "\n";
}, 1);

// Serve /ads.txt from the saved publisher ID (BYO-theme sites — the theme
// serves its own when active). Only fires when WP handles the request; a real
// ads.txt file on disk is served by the web server first and left untouched.
add_action('init', function () {
    if (mvp_affiliate_theme_active()) return;
    $path = isset($_SERVER['REQUEST_URI']) ? (string) wp_parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH) : '';
    if (strtolower(rtrim($path, '/')) !== '/ads.txt') return;
    $id = '';
    $raw = trim(mvp_affiliate_get_data()['adsenseClientId'] ?? '');
    if (preg_match('/^ca-pub-(\d{10,20})$/', $raw, $m)) $id = $m[1];
    if ($id === '') return; // no AdSense configured → let WP handle /ads.txt normally
    header('Content-Type: text/plain; charset=utf-8');
    echo "google.com, pub-{$id}, DIRECT, f08c47fec0942fa0\n";
    exit;
});

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
        <h2 style="font-size:16px;margin:0 0 4px;">Step 2 — Get your Posting Key</h2>
        <p style="margin:0 0 12px;color:#6e6e73;">Generates a one-time token tied to a dedicated &quot;MVP Affiliate&quot; application password. Paste it into the MVP Affiliate setup wizard to finish the connection.</p>

        <?php if ($token_error): ?>
        <div class="notice notice-error inline" style="margin:0 0 12px;"><p><?php echo esc_html($token_error); ?></p></div>
        <?php endif; ?>

        <?php if ($token): ?>
        <p style="margin:0 0 8px;font-weight:600;">Your Posting Key:</p>
        <textarea readonly onclick="this.select();" style="width:100%;height:90px;font-family:monospace;font-size:12px;padding:10px;border:1px solid #dcdcde;border-radius:6px;background:#f6f7f7;"><?php echo esc_textarea($token); ?></textarea>
        <p style="margin:8px 0 0;color:#6e6e73;font-size:12px;">Copy this token and paste it in the MVP Affiliate setup wizard. Token is valid as long as the "MVP Affiliate" application password exists (manage in Users → Profile → Application Passwords).</p>
        <?php else: ?>
        <form method="post" style="margin:0;">
          <?php wp_nonce_field('mvp_affiliate_generate_token'); ?>
          <input type="hidden" name="mvp_affiliate_action" value="generate_token" />
          <button type="submit" class="button button-primary">Generate Posting Key</button>
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

// ─── Posting Key notice ────────────────────────────────────────────────
// Shows the body-auth proxy secret (we call it "Posting Key" in user copy —
// "Connection Token" is already used for the legacy setup-wizard flow) in
// wp-admin so the user can copy-paste it into the MVP dashboard. Needed
// for hosts (SiteGround, Hostinger LiteSpeed, some Apache shared) that
// STRIP the Authorization header on POST requests — MVP's normal "Connect
// via Application Password" flow can't fetch the secret from /status on
// those hosts, so the user pastes it manually instead.
//
// Defense in depth: the secret is normally minted by the activation hook, but
// upgrade-in-place sometimes skips activation. mvp_affiliate_ensure_proxy_secret()
// runs on every admin pageload and mints if missing, so the notice ALWAYS has
// a value to show.
//
// Display rules:
//   - Only to users who can update plugins (admin-level)
//   - Only on Dashboard + Plugins page (not noisy on every screen)
//   - Dismissible per-user (stores affiliateos_token_notice_dismissed user meta)
function mvp_affiliate_ensure_proxy_secret() {
    if (!get_option('affiliateos_proxy_secret')) {
        update_option('affiliateos_proxy_secret', bin2hex(random_bytes(32)));
    }
}
add_action('admin_init', 'mvp_affiliate_ensure_proxy_secret');

// AJAX: dismiss the connection-token notice for this user.
add_action('wp_ajax_mvp_affiliate_dismiss_token_notice', function () {
    check_ajax_referer('mvp_affiliate_token_notice', 'nonce');
    update_user_meta(get_current_user_id(), 'affiliateos_token_notice_dismissed', 1);
    wp_send_json_success();
});

add_action('admin_notices', function () {
    if (!current_user_can('update_plugins')) return;
    // Dismissed by this user? skip.
    if (get_user_meta(get_current_user_id(), 'affiliateos_token_notice_dismissed', true)) return;
    // Only on Dashboard + Plugins page.
    $screen = function_exists('get_current_screen') ? get_current_screen() : null;
    $allowed_screens = ['dashboard', 'plugins'];
    if (!$screen || !in_array($screen->base, $allowed_screens, true)) return;
    $secret = (string) get_option('affiliateos_proxy_secret', '');
    if ($secret === '') return; // ensure_proxy_secret should have set it; bail if not
    $nonce = wp_create_nonce('mvp_affiliate_token_notice');
    ?>
    <div class="notice notice-info is-dismissible mvp-affiliate-token-notice" style="border-left-color:#7C3AED;padding:14px 16px;" data-nonce="<?php echo esc_attr($nonce); ?>">
      <p style="font-size:14px;margin:0 0 8px;color:#1d2327;">
        <strong style="color:#7C3AED;">MVP Affiliate · Posting Key</strong>
      </p>
      <p style="font-size:13px;margin:0 0 10px;color:#3c434a;line-height:1.5;">
        Paste this token into your MVP dashboard at <strong>Settings → WordPress Sites → Posting Key</strong>.
        Required only if posting from MVP fails with an authentication error (some hosts block the Authorization header on POST).
      </p>
      <p style="margin:0;display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
        <code id="mvp-affiliate-token" style="background:#f0f0f1;padding:8px 12px;border-radius:4px;font-size:12px;user-select:all;font-family:Menlo,Consolas,monospace;word-break:break-all;flex:1;min-width:280px;"><?php echo esc_html($secret); ?></code>
        <button type="button" class="button button-primary" id="mvp-affiliate-token-copy" style="background:#7C3AED;border-color:#7C3AED;box-shadow:none;text-shadow:none;">Copy</button>
      </p>
      <script>
      (function(){
        var notice = document.currentScript.closest('.mvp-affiliate-token-notice');
        if (!notice) return;
        var btn   = notice.querySelector('#mvp-affiliate-token-copy');
        var code  = notice.querySelector('#mvp-affiliate-token');
        if (btn && code) {
          btn.addEventListener('click', function () {
            navigator.clipboard.writeText(code.textContent.trim()).then(function () {
              var old = btn.textContent;
              btn.textContent = 'Copied!';
              btn.style.background = '#10B981';
              btn.style.borderColor = '#10B981';
              setTimeout(function () {
                btn.textContent = old;
                btn.style.background = '#7C3AED';
                btn.style.borderColor = '#7C3AED';
              }, 1600);
            });
          });
        }
        // Dismiss → remember server-side.
        notice.addEventListener('click', function (e) {
          if (e.target.classList && e.target.classList.contains('notice-dismiss')) {
            var nonce = notice.getAttribute('data-nonce');
            var fd = new FormData();
            fd.append('action', 'mvp_affiliate_dismiss_token_notice');
            fd.append('nonce', nonce);
            fetch(ajaxurl, { method: 'POST', body: fd, credentials: 'same-origin' });
          }
        });
      })();
      </script>
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
        // Lazy-mint the proxy secret for installs that pre-date v1.0.25 (the
        // activation hook only runs on fresh activations, not on auto-upgrade).
        // Same lazy pattern as the IndexNow key above so the dashboard can
        // always rely on a value being present after an /status read.
        $proxySecret = get_option('affiliateos_proxy_secret');
        if (!$proxySecret) {
            $proxySecret = bin2hex(random_bytes(32));
            update_option('affiliateos_proxy_secret', $proxySecret);
        }
        return new WP_REST_Response([
            'plugin_version' => MVP_AFFILIATE_VERSION,
            'theme_version'  => $theme->exists() ? (string) $theme->get('Version') : null,
            'theme_active'   => (get_stylesheet() === 'mvp-affiliate-theme'),
            'indexnow_key'   => mvp_affiliate_indexnow_key(),
            // The body-auth proxy secret. Stored by the dashboard against
            // this site's wordpress_sites row and sent on every write so we
            // don't need to rely on the Authorization header passing through
            // hosts that strip it on POST.
            'proxy_secret'   => $proxySecret,
        ], 200);
    }
}

// ─── Body-auth proxy endpoint ─────────────────────────────────────────────────
// POST /wp-json/affiliateos/v1/proxy
// Body: { token: <proxy_secret>, method: "POST", path: "/wp/v2/posts", body: {...}, query: {...} }
//
// Why this endpoint exists:
//   The standard /wp-json/wp/v2/* routes require Basic Auth (Authorization
//   header) for writes. Some hosts (Hostinger LiteSpeed, certain shared
//   Apache configs) strip the Authorization header on POST requests BEFORE
//   PHP sees it — Basic Auth then fails with no way for the user to know.
//
//   This endpoint takes auth from the JSON BODY instead of the header, so
//   it's immune to header-stripping. It validates the token against the
//   stored secret, then dispatches the requested WP REST call internally
//   (via rest_do_request) as the site's primary administrator.
//
// Security:
//   - 32-byte hex secret (64 chars) — brute-force at HTTP timing is infeasible
//   - hash_equals() for constant-time compare (no timing attack)
//   - Failed attempts are rate-limited via a 60-second cooldown counter
//     stored in the affiliateos_proxy_brute transient
//   - Returns 401 generically on bad token (doesn't leak whether the
//     token exists)
add_action('rest_api_init', function () {
    register_rest_route('affiliateos/v1', '/proxy', [
        'methods'             => 'POST',
        'callback'            => 'mvp_affiliate_rest_proxy',
        // Public route — gated by the body-token check inside the callback.
        // Standard permission_callback can't read the body, so it'd block
        // legitimate requests too.
        'permission_callback' => '__return_true',
    ]);
});

if (!function_exists('mvp_affiliate_rest_proxy')) {
    function mvp_affiliate_rest_proxy(WP_REST_Request $request) {
        $body = $request->get_json_params();
        if (!is_array($body)) {
            return new WP_REST_Response(['code' => 'bad_request', 'message' => 'Request body must be JSON.'], 400);
        }
        $token = isset($body['token']) ? (string) $body['token'] : '';
        $stored = (string) get_option('affiliateos_proxy_secret', '');

        // Brute-force guard. Per-IP AND per-site so an attacker can't lock
        // out legitimate MVP backend calls just by spamming bad tokens.
        // Site-wide counter survives as a backstop; per-IP is the
        // attacker-resistant lane.
        $ip = isset($_SERVER['REMOTE_ADDR']) ? preg_replace('/[^0-9a-f:.]/i', '', (string) $_SERVER['REMOTE_ADDR']) : 'unknown';
        $bruteKeyIp   = 'affiliateos_proxy_brute_' . md5($ip);
        $bruteKeySite = 'affiliateos_proxy_brute';
        $bruteIp   = (int) get_transient($bruteKeyIp);
        $bruteSite = (int) get_transient($bruteKeySite);
        if ($bruteIp >= 5 || $bruteSite >= 50) {
            return new WP_REST_Response(['code' => 'rate_limited', 'message' => 'Too many bad attempts; try again in a minute.'], 429);
        }

        if (!$stored || strlen($token) !== strlen($stored) || !hash_equals($stored, $token)) {
            set_transient($bruteKeyIp,   $bruteIp + 1,   60);
            set_transient($bruteKeySite, $bruteSite + 1, 60);
            return new WP_REST_Response(['code' => 'bad_token', 'message' => 'Invalid proxy token.'], 401);
        }
        // On success, clear the IP counter so a legit caller isn't punished
        // for a single fat-fingered try earlier in the minute.
        delete_transient($bruteKeyIp);

        // Authenticate as the site's primary administrator so capability
        // checks in the dispatched REST call (current_user_can('edit_posts'),
        // etc.) succeed exactly as if the admin had made the request directly.
        $admins = get_users(['role' => 'administrator', 'number' => 1, 'orderby' => 'ID']);
        if (empty($admins)) {
            return new WP_REST_Response(['code' => 'no_admin', 'message' => 'No administrator user on this site.'], 500);
        }
        wp_set_current_user($admins[0]->ID);

        // Internal dispatch: build a fresh WP_REST_Request and hand it to
        // rest_do_request(). This is identical to a normal REST hit — same
        // permission_callbacks, same hooks, same sanitization — just sourced
        // from inside PHP instead of an HTTP request.
        $method = isset($body['method']) ? strtoupper((string) $body['method']) : 'GET';
        $path = isset($body['path']) ? (string) $body['path'] : '/';
        // Path-shape check: no `..`, no `/wp-admin`, no protocol-relative,
        // and matches a recognisable REST path skeleton.
        if (!preg_match('#^/[A-Za-z0-9_/\-]+$#', $path) || strpos($path, '..') !== false) {
            return new WP_REST_Response(['code' => 'bad_path', 'message' => 'Path must look like /wp/v2/posts'], 400);
        }
        // Hard route allowlist — without this, a leaked proxy_secret = full
        // site takeover (POST /wp/v2/users to create an admin, POST
        // /wp/v2/plugins to install a malicious plugin, etc). The dashboard
        // only ever needs these routes; deny everything else.
        $allowed_path_patterns = [
            '#^/wp/v2/posts(?:/[0-9]+)?$#',
            '#^/wp/v2/pages(?:/[0-9]+)?$#',
            '#^/wp/v2/media(?:/[0-9]+)?$#',
            '#^/wp/v2/tags(?:/[0-9]+)?$#',
            '#^/wp/v2/categories(?:/[0-9]+)?$#',
            '#^/wp/v2/users/me$#',
            '#^/affiliateos/v1/.+$#',
        ];
        $allowed = false;
        foreach ($allowed_path_patterns as $pat) {
            if (preg_match($pat, $path)) { $allowed = true; break; }
        }
        if (!$allowed) {
            return new WP_REST_Response(['code' => 'forbidden_path', 'message' => 'Proxy route not in allowlist.'], 403);
        }
        $inner = new WP_REST_Request($method, $path);
        if (!empty($body['body']) && is_array($body['body'])) {
            $inner->set_body_params($body['body']);
            // Also set as JSON params so REST routes that use get_json_params()
            // see the same values — covers both content-type code paths.
            $inner->set_header('Content-Type', 'application/json');
            $inner->set_body(wp_json_encode($body['body']));
        }
        if (!empty($body['query']) && is_array($body['query'])) {
            $inner->set_query_params($body['query']);
        }
        $response = rest_do_request($inner);

        // Forward the inner response status + body so the dashboard sees
        // exactly what /wp/v2/posts would have returned directly.
        $status = method_exists($response, 'get_status') ? $response->get_status() : 200;
        $data = method_exists($response, 'get_data') ? $response->get_data() : null;
        return new WP_REST_Response($data, $status);
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

        // ── HMAC signing (v1.0.27+) ──────────────────────────────────────────
        // Sign (creatorUserId | origin | timestamp) with the site's
        // proxy_secret so the dashboard can verify the form actually came
        // from a WordPress shortcode render — not from a botnet POSTing
        // arbitrary user_ids to spam a creator's Resend sender.
        //
        // The same secret is already minted by /affiliateos/v1/status
        // and known to the dashboard (wordpress_sites.api_token). If
        // the secret happens to be missing (unusual — admin_init mints
        // it), we emit empty ts/sig and the dashboard accept-but-warns.
        $hmac_secret = (string) get_option('affiliateos_proxy_secret', '');
        $hmac_ts     = (string) time(); // UNIX seconds
        $origin      = '';
        if (function_exists('home_url')) {
            $home   = home_url();
            $parsed = parse_url($home);
            if (!empty($parsed['host'])) {
                $origin = strtolower($parsed['host']);
            }
        }
        $hmac_payload = $user_id . '|' . $origin . '|' . $hmac_ts;
        $hmac_sig     = $hmac_secret ? hash_hmac('sha256', $hmac_payload, $hmac_secret) : '';

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
        sourceUrl: window.location.href,
        // HMAC fields (plugin v1.0.27+). Empty strings on installs that
        // somehow lack the proxy_secret — dashboard accept-but-warns.
        origin: <?php echo wp_json_encode($origin); ?>,
        ts: <?php echo wp_json_encode($hmac_ts); ?>,
        sig: <?php echo wp_json_encode($hmac_sig); ?>
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

// ─── 19a. "Work with brands" CTA — discreet top-of-page button + modal ──────
// When a creator enables brandCta in /customize, every page gets a small,
// fixed "Are you a brand?" pill. Brands click it to either (a) jump straight
// to the creator's media kit, or (b) open a modal with a short pitch + an
// in-app contact form whose message lands in the creator's MVP dashboard
// inbox — no public email exposed.
//
// Theme-independent: injected via wp_footer with inline CSS + vanilla JS,
// positioned fixed so it works on Kadence / Astra / GeneratePress / anything.
//
// Security mirrors the newsletter form (section 19): HMAC-signed
// (creatorUserId|origin|ts with the site's proxy_secret), a honeypot field,
// and hCaptcha rendered with the public site key the dashboard passes down in
// brandCta.hcaptchaSiteKey — the /api/brand-inquiry endpoint verifies the
// token server-side and requires the brand's name + email so the creator can
// always reply.
add_action('wp_footer', 'mvp_affiliate_render_brand_cta');
if (!function_exists('mvp_affiliate_render_brand_cta')) {
    function mvp_affiliate_render_brand_cta() {
        $bc = mvp_affiliate_get_data()['brandCta'] ?? [];
        if (!is_array($bc) || empty($bc['enabled'])) return;

        $owner_id = isset($bc['ownerId']) ? trim((string) $bc['ownerId']) : '';
        if (!preg_match('/^[0-9a-f-]{36}$/i', $owner_id)) return;

        $inbox     = !empty($bc['inbox']);
        $media_kit = isset($bc['mediaKitUrl']) ? trim((string) $bc['mediaKitUrl']) : '';
        if ($media_kit !== '' && !preg_match('#^https?://#i', $media_kit)) $media_kit = '';
        // "Link straight to media kit" only makes sense when a URL is set.
        $direct_link = !empty($bc['directLink']) && $media_kit !== '';
        // Nothing actionable configured → don't render a dead button.
        if (!$inbox && $media_kit === '') return;

        $headline = (isset($bc['headline']) && trim((string) $bc['headline']) !== '')
            ? (string) $bc['headline']
            : 'Are you a brand that wants to get featured here?';
        $intro    = isset($bc['intro']) ? (string) $bc['intro'] : '';
        $site_key = isset($bc['hcaptchaSiteKey']) ? trim((string) $bc['hcaptchaSiteKey']) : '';

        $api_base = apply_filters('mvp_affiliate_api_base', 'https://www.mvpaffiliate.io');
        $uid = wp_generate_uuid4();

        // HMAC — identical scheme to the newsletter form so the dashboard's
        // shared verifier accepts it.
        $hmac_secret = (string) get_option('affiliateos_proxy_secret', '');
        $hmac_ts     = (string) time();
        $origin      = '';
        if (function_exists('home_url')) {
            $parsed = parse_url(home_url());
            if (!empty($parsed['host'])) $origin = strtolower($parsed['host']);
        }
        $hmac_sig = $hmac_secret
            ? hash_hmac('sha256', $owner_id . '|' . $origin . '|' . $hmac_ts, $hmac_secret)
            : '';

        ob_start();
        ?>
<style>
  /* A proper labeled pill — the JS below docks it right next to the
     "Ask {Brand}" product-finder button, following it whether that button
     stays a floating icon (top-right) or gets injected into the theme header. */
  .mvp-brandcta-pill{position:fixed;top:80px;right:16px;z-index:9998;display:inline-flex;align-items:center;gap:8px;padding:10px 18px;border-radius:999px;background:#111114;color:#fff;border:1px solid rgba(255,255,255,0.14);font:600 14px/1 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;text-decoration:none;cursor:pointer;box-shadow:0 6px 18px rgba(0,0,0,0.28);transition:transform .12s ease,box-shadow .12s ease;}
  .mvp-brandcta-pill:hover{transform:translateY(-1px);box-shadow:0 8px 24px rgba(0,0,0,0.36);}
  .mvp-brandcta-pill .mvp-brandcta-spark{display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;border-radius:999px;background:rgba(255,255,255,0.16);font-size:13px;}
  /* Fixed fallback: dock just LEFT of the product-finder icon at right:16px. */
  .mvp-brandcta-pill.is-beside{right:62px;top:80px;}
  /* Header-injected: match the product-finder inline pill footprint. */
  .mvp-brandcta-pill.is-inline{position:static;top:auto;right:auto;margin:0 4px;padding:7px 14px 7px 10px;font-size:12px;box-shadow:0 2px 6px rgba(0,0,0,0.20);vertical-align:middle;}
  .mvp-brandcta-pill.is-inline:hover{transform:none;}
  @media (max-width:600px){.mvp-brandcta-pill.is-inline{padding:7px;gap:0;}.mvp-brandcta-pill.is-inline .mvp-brandcta-label{display:none;}}
</style>
<div class="mvp-brandcta" id="mvp-brandcta-<?php echo esc_attr($uid); ?>" style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <?php if ($direct_link): ?>
  <!-- Direct-link mode: the pill is just an outbound link to the media kit. -->
  <a class="mvp-brandcta-pill" id="mvp-brandcta-pill-<?php echo esc_attr($uid); ?>" href="<?php echo esc_url($media_kit); ?>" target="_blank" rel="nofollow noopener">
    <span class="mvp-brandcta-spark" aria-hidden="true">✦</span><span class="mvp-brandcta-label">Are you a brand?</span>
  </a>
  <?php else: ?>
  <button type="button" class="mvp-brandcta-pill" id="mvp-brandcta-pill-<?php echo esc_attr($uid); ?>" data-open>
    <span class="mvp-brandcta-spark" aria-hidden="true">✦</span><span class="mvp-brandcta-label">Are you a brand?</span>
  </button>

  <div class="mvp-brandcta-overlay" id="mvp-brandcta-overlay-<?php echo esc_attr($uid); ?>" role="dialog" aria-modal="true" aria-labelledby="mvp-brandcta-title-<?php echo esc_attr($uid); ?>"
       style="display:none;position:fixed;inset:0;z-index:99991;background:rgba(0,0,0,0.55);align-items:center;justify-content:center;padding:20px;">
    <div class="mvp-brandcta-card"
         style="width:100%;max-width:460px;max-height:90vh;overflow-y:auto;background:#ffffff;color:#1d1d1f;border-radius:18px;padding:26px;box-shadow:0 20px 60px rgba(0,0,0,0.35);position:relative;">
      <button type="button" data-close aria-label="Close"
              style="position:absolute;top:12px;right:12px;width:30px;height:30px;border:none;border-radius:8px;background:rgba(0,0,0,0.05);color:#6e6e73;font-size:18px;line-height:1;cursor:pointer;">×</button>
      <h3 id="mvp-brandcta-title-<?php echo esc_attr($uid); ?>" style="margin:0 0 8px;font-size:19px;line-height:1.3;font-weight:700;padding-right:28px;"><?php echo esc_html($headline); ?></h3>
      <?php if ($intro !== ''): ?>
      <p style="margin:0 0 18px;font-size:14px;line-height:1.55;color:#3a3a3c;white-space:pre-line;"><?php echo esc_html($intro); ?></p>
      <?php else: ?>
      <p style="margin:0 0 18px;font-size:14px;line-height:1.55;color:#3a3a3c;">Tell me a bit about your brand and what you have in mind — I read every message.</p>
      <?php endif; ?>

      <?php if ($media_kit !== ''): ?>
      <a href="<?php echo esc_url($media_kit); ?>" target="_blank" rel="nofollow noopener"
         style="display:block;text-align:center;padding:12px 16px;border-radius:11px;background:#0071e3;color:#fff;font-size:14px;font-weight:600;text-decoration:none;margin-bottom:<?php echo $inbox ? '18px' : '0'; ?>;">View my media kit →</a>
      <?php endif; ?>

      <?php if ($inbox): ?>
      <?php if ($media_kit !== ''): ?><div style="text-align:center;font-size:12px;color:#8e8e93;margin-bottom:14px;">or send a message</div><?php endif; ?>
      <form class="mvp-brandcta-form" novalidate style="display:flex;flex-direction:column;gap:10px;">
        <input type="text" name="name" required placeholder="Your name *" autocomplete="name"
               style="padding:11px 12px;border:1px solid rgba(0,0,0,0.15);border-radius:10px;font-size:14px;color:#1d1d1f;background:#fff;outline:none;" />
        <input type="email" name="email" required placeholder="Your email *" autocomplete="email"
               style="padding:11px 12px;border:1px solid rgba(0,0,0,0.15);border-radius:10px;font-size:14px;color:#1d1d1f;background:#fff;outline:none;" />
        <input type="text" name="company" placeholder="Brand / company (optional)" autocomplete="organization"
               style="padding:11px 12px;border:1px solid rgba(0,0,0,0.15);border-radius:10px;font-size:14px;color:#1d1d1f;background:#fff;outline:none;" />
        <textarea name="message" required rows="4" placeholder="What would you like to work on? *"
                  style="padding:11px 12px;border:1px solid rgba(0,0,0,0.15);border-radius:10px;font-size:14px;color:#1d1d1f;background:#fff;outline:none;resize:vertical;"></textarea>
        <!-- Honeypot: hidden; bots fill it, humans don't → server silently drops. -->
        <input type="text" name="hp" tabindex="-1" autocomplete="off" aria-hidden="true"
               style="position:absolute;left:-9999px;top:-9999px;height:0;width:0;opacity:0;" />
        <?php if ($site_key !== ''): ?>
        <div class="h-captcha" data-sitekey="<?php echo esc_attr($site_key); ?>" style="margin:2px 0;"></div>
        <?php endif; ?>
        <button type="submit"
                style="padding:12px 18px;border:none;border-radius:11px;background:#1d1d1f;color:#fff;font-size:14px;font-weight:600;cursor:pointer;">Send message</button>
        <p class="mvp-brandcta-msg" role="status" aria-live="polite" style="margin:2px 0 0;font-size:12px;line-height:1.5;color:#6e6e73;min-height:1.4em;"></p>
      </form>
      <?php endif; ?>
    </div>
  </div>
  <?php endif; ?>
</div>
<?php if (!$direct_link && $inbox && $site_key !== ''): ?>
<script src="https://js.hcaptcha.com/1/api.js" async defer></script>
<?php endif; ?>
<script>
(function(){
  // Look up by stable id (not via a wrapper) because the placement logic
  // below moves the pill OUT of its wrapper and next to the product-finder
  // button — a wrapper-scoped query would then find nothing.
  var pill = document.getElementById(<?php echo wp_json_encode('mvp-brandcta-pill-' . $uid); ?>);
  if (!pill) return;

  // ── Placement: dock the pill right next to the "Ask {Brand}" button ──
  // The product-finder button (#mvp-pf-fab) either floats top-right or gets
  // injected into the theme header. We follow it: re-check for a few seconds
  // (it can inject late, after the sticky header mounts) and sit right after
  // it, matching header-pill vs floating-icon styling.
  var ticks = 0;
  function place(){
    var pf = document.getElementById('mvp-pf-fab');
    if (pf && pf.parentNode){
      if (pill.previousElementSibling !== pf) pf.parentNode.insertBefore(pill, pf.nextSibling);
      var inline = pf.classList.contains('mvp-pf-fab--inline');
      pill.classList.toggle('is-inline', inline);
      pill.classList.toggle('is-beside', !inline);
    }
  }
  place();
  var pt = setInterval(function(){ place(); if (++ticks >= 12) clearInterval(pt); }, 300);

  // ── Modal (skipped in direct-link mode — no overlay is rendered) ──
  var overlay = document.getElementById(<?php echo wp_json_encode('mvp-brandcta-overlay-' . $uid); ?>);
  if (!overlay) return;
  function open(){ overlay.style.display = 'flex'; document.addEventListener('keydown', onKey); }
  function close(){ overlay.style.display = 'none'; document.removeEventListener('keydown', onKey); }
  function onKey(e){ if (e.key === 'Escape') close(); }
  pill.addEventListener('click', open);
  overlay.querySelectorAll('[data-close]').forEach(function(el){ el.addEventListener('click', close); });
  overlay.addEventListener('click', function(e){ if (e.target === overlay) close(); });

  var form = overlay.querySelector('.mvp-brandcta-form');
  if (!form) return; // inbox disabled: modal shows only the media-kit button.
  var msg = overlay.querySelector('.mvp-brandcta-msg');
  var btn = form.querySelector('button[type="submit"]');
  var origLabel = btn.textContent;
  function val(sel){ var el = form.querySelector(sel); return el ? (el.value || '').trim() : ''; }
  form.addEventListener('submit', function(e){
    e.preventDefault();
    msg.style.color = '#6e6e73'; msg.textContent = '';
    // Read via querySelector, not form.name / form.submit — a control named
    // "name" collides with HTMLFormElement.name and would read empty.
    var name    = val('[name="name"]');
    var email   = val('[name="email"]');
    var company = val('[name="company"]');
    var message = val('[name="message"]');
    var hp      = val('[name="hp"]');
    if (!name)    { msg.style.color = '#ff3b30'; msg.textContent = 'Please add your name.'; return; }
    if (!email)   { msg.style.color = '#ff3b30'; msg.textContent = 'Please add your email so they can reply.'; return; }
    if (!message) { msg.style.color = '#ff3b30'; msg.textContent = 'Please add a short message.'; return; }
    // hCaptcha token (if the widget is present on the page).
    var captchaEl = form.querySelector('textarea[name="h-captcha-response"]');
    var captchaToken = captchaEl ? (captchaEl.value || '') : '';
    btn.disabled = true; btn.textContent = 'Sending…';
    fetch(<?php echo wp_json_encode($api_base . '/api/brand-inquiry'); ?>, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        creatorUserId: <?php echo wp_json_encode($owner_id); ?>,
        name: name,
        email: email,
        company: company,
        message: message,
        hp: hp,
        hcaptchaToken: captchaToken,
        sourceUrl: window.location.href,
        origin: <?php echo wp_json_encode($origin); ?>,
        ts: <?php echo wp_json_encode($hmac_ts); ?>,
        sig: <?php echo wp_json_encode($hmac_sig); ?>
      })
    }).then(function(r){ return r.json().then(function(d){ return { ok: r.ok, data: d }; }); })
      .then(function(res){
        btn.disabled = false; btn.textContent = origLabel;
        if (!res.ok || !res.data || res.data.ok === false) {
          msg.style.color = '#ff3b30';
          msg.textContent = (res.data && res.data.error) ? res.data.error : 'Something went wrong. Please try again.';
          if (window.hcaptcha) { try { window.hcaptcha.reset(); } catch(_){} }
          return;
        }
        msg.style.color = '#34c759';
        msg.textContent = 'Thanks — your message was sent. They’ll be in touch.';
        form.reset();
        if (window.hcaptcha) { try { window.hcaptcha.reset(); } catch(_){} }
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
        echo ob_get_clean();
    }
}

// ─── 19b. Deals Hub banner shortcode (1.0.40+) ─────────────────────────────
// Renders [mvp_deal_banner end_date="..." badge="..." code="..." url="..."]
// as a self-contained deal banner at the top of a deal post — a violet card
// with the savings badge, the optional promo code (copy-to-clipboard), a
// big CTA button, and (when end_date is given) a live JS countdown that
// flips to "Deal ended" once the date passes.
//
// All atts are optional — missing pieces just don't render. Safe fallback:
// with NO atts the shortcode emits nothing at all (so an older post that
// re-renders without atts looks normal).
//
// Inlined CSS + minimal vanilla JS so the banner works whether the MVP
// Affiliate theme is active or not.
add_shortcode('mvp_deal_banner', 'mvp_deal_banner_shortcode');
if (!function_exists('mvp_deal_banner_shortcode')) {
    function mvp_deal_banner_shortcode($atts) {
        $atts = shortcode_atts([
            'end_date' => '',
            'badge'    => '',
            'code'     => '',
            'url'      => '',
        ], $atts, 'mvp_deal_banner');

        $end_date = trim((string) $atts['end_date']);
        $badge    = trim((string) $atts['badge']);
        $code     = trim((string) $atts['code']);
        $url      = trim((string) $atts['url']);

        // Validate the URL early; if it's not http(s) drop it so we don't
        // emit a junk <a href>. Empty URL is also fine.
        if ($url !== '' && !preg_match('#^https?://#i', $url)) {
            $url = '';
        }

        // Nothing to render → emit nothing. Keeps older / mis-pasted
        // shortcodes from leaving an empty card on the page.
        if ($badge === '' && $code === '' && $url === '' && $end_date === '') {
            return '';
        }

        $banner_id = 'mvp-deal-banner-' . wp_generate_uuid4();

        // Try to parse end_date into an ISO timestamp the JS countdown can
        // consume. We accept yyyy-mm-dd, full ISO, or anything strtotime
        // understands. Empty → countdown block hidden.
        $end_iso = '';
        if ($end_date !== '') {
            $ts = strtotime($end_date);
            if ($ts !== false) {
                // Use UTC ISO so the JS countdown is timezone-agnostic.
                $end_iso = gmdate('c', $ts);
            }
        }

        ob_start();
        ?>
<div class="mvp-deal-banner" id="<?php echo esc_attr($banner_id); ?>" data-end="<?php echo esc_attr($end_iso); ?>" style="margin:20px 0;padding:20px;border-radius:14px;background:linear-gradient(135deg,#7C3AED 0%,#C026D3 100%);color:#fff;box-shadow:0 4px 18px rgba(124,58,237,0.25);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <div style="display:flex;gap:16px;flex-wrap:wrap;align-items:center;justify-content:space-between;">
    <div style="flex:1 1 240px;min-width:0;">
      <?php if ($badge !== ''): ?>
      <div style="display:inline-block;padding:5px 10px;border-radius:999px;background:#ffffff;color:#7C3AED;font-size:11px;font-weight:800;letter-spacing:0.6px;text-transform:uppercase;margin-bottom:8px;"><?php echo esc_html($badge); ?></div>
      <?php endif; ?>
      <div style="font-size:18px;font-weight:700;line-height:1.3;margin-bottom:6px;">Active deal · save while it lasts</div>
      <?php if ($code !== ''): ?>
      <div style="margin-top:8px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
        <span style="font-size:12px;opacity:0.9;">Code:</span>
        <code class="mvp-deal-code" data-code="<?php echo esc_attr($code); ?>" style="padding:4px 10px;border-radius:8px;background:rgba(255,255,255,0.18);font-size:13px;font-weight:700;letter-spacing:0.5px;border:1px dashed rgba(255,255,255,0.4);"><?php echo esc_html($code); ?></code>
        <button type="button" class="mvp-deal-copy" style="padding:4px 10px;border:none;border-radius:8px;background:#fff;color:#7C3AED;font-size:11px;font-weight:700;cursor:pointer;letter-spacing:0.4px;">Copy</button>
      </div>
      <?php endif; ?>
      <?php if ($end_iso !== ''): ?>
      <div class="mvp-deal-countdown" style="margin-top:10px;font-size:13px;opacity:0.95;">
        <span class="mvp-deal-countdown-label">Deal ends in</span>
        <strong class="mvp-deal-countdown-value" style="font-size:14px;">…</strong>
      </div>
      <?php endif; ?>
    </div>
    <?php if ($url !== ''): ?>
    <a href="<?php echo esc_url($url); ?>" rel="nofollow sponsored" target="_blank" class="mvp-deal-cta" style="display:inline-block;padding:18px 32px;border-radius:14px;background:#ffffff;color:#7C3AED;font-size:18px;font-weight:800;text-decoration:none;letter-spacing:0.3px;flex-shrink:0;box-shadow:0 6px 16px rgba(0,0,0,0.18);">See the deal →</a>
    <?php endif; ?>
  </div>
</div>
<script>
(function(){
  var root = document.getElementById('<?php echo esc_js($banner_id); ?>');
  if (!root) return;

  // ── Copy-to-clipboard for the promo code ──
  var copyBtn = root.querySelector('.mvp-deal-copy');
  var codeEl  = root.querySelector('.mvp-deal-code');
  if (copyBtn && codeEl) {
    copyBtn.addEventListener('click', function(){
      var code = codeEl.getAttribute('data-code') || codeEl.textContent || '';
      if (!code) return;
      var done = function(){
        var prev = copyBtn.textContent;
        copyBtn.textContent = 'Copied!';
        setTimeout(function(){ copyBtn.textContent = prev || 'Copy'; }, 1400);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(code).then(done).catch(done);
      } else {
        // Fallback for older browsers
        try {
          var ta = document.createElement('textarea');
          ta.value = code;
          document.body.appendChild(ta);
          ta.select();
          document.execCommand('copy');
          document.body.removeChild(ta);
          done();
        } catch(e) { done(); }
      }
    });
  }

  // ── Countdown / "Deal ended" ──
  var endStr = root.getAttribute('data-end') || '';
  if (!endStr) return;
  var endMs = Date.parse(endStr);
  if (isNaN(endMs)) return;

  var labelEl = root.querySelector('.mvp-deal-countdown-label');
  var valueEl = root.querySelector('.mvp-deal-countdown-value');
  if (!valueEl) return;

  function tick(){
    var diff = endMs - Date.now();
    if (diff <= 0) {
      if (labelEl) labelEl.textContent = '';
      valueEl.textContent = 'This deal has ended';
      // Visually demote the banner so a stale deal post still looks honest
      root.style.opacity = '0.78';
      root.style.filter = 'grayscale(0.4)';
      var cta = root.querySelector('.mvp-deal-cta');
      if (cta) {
        cta.style.background = 'rgba(255,255,255,0.45)';
        cta.style.color = 'rgba(124,58,237,0.6)';
        cta.style.pointerEvents = 'none';
        cta.textContent = 'Deal ended';
      }
      return;
    }
    var days = Math.floor(diff / 86400000);
    var hrs  = Math.floor((diff % 86400000) / 3600000);
    var mins = Math.floor((diff % 3600000) / 60000);
    var parts = [];
    if (days > 0) parts.push(days + 'd');
    parts.push(hrs + 'h');
    parts.push(mins + 'm');
    valueEl.textContent = parts.join(' ');
  }
  tick();
  setInterval(tick, 60000);
})();
</script>
        <?php
        return ob_get_clean();
    }
}

// ─── 19c. Deals Hub end-of-article CTA shortcode (1.0.41+) ─────────────────
// Renders [mvp_deal_cta url="..." code="..." badge="..."] as a standalone
// full-width violet button at the END of a deal post. Mirrors the styling
// of the top-of-post [mvp_deal_banner] CTA but bigger (it's the post's
// closing call-to-action and competes only with itself for attention).
// Plays well next to the existing sticky-CTA bar from section 20 — the
// sticky bar is a floating reminder; this is the post's terminal nudge.
add_shortcode('mvp_deal_cta', 'mvp_deal_cta_shortcode');
if (!function_exists('mvp_deal_cta_shortcode')) {
    function mvp_deal_cta_shortcode($atts) {
        $atts = shortcode_atts([
            'url'   => '',
            'code'  => '',
            'badge' => '',
            'label' => '', // optional override for the button text
        ], $atts, 'mvp_deal_cta');

        $url   = trim((string) $atts['url']);
        $code  = trim((string) $atts['code']);
        $badge = trim((string) $atts['badge']);
        $label = trim((string) $atts['label']);

        // Drop non-http URLs to avoid emitting a broken anchor.
        if ($url !== '' && !preg_match('#^https?://#i', $url)) {
            $url = '';
        }
        // No URL → emit nothing (a CTA with nowhere to go is worse than
        // no CTA at all).
        if ($url === '') {
            return '';
        }

        $btn_label = $label !== ''
            ? $label
            : ($code !== '' ? 'Apply code ' . $code . ' on Amazon' : 'Get this deal on Amazon');

        ob_start();
        ?>
<div class="mvp-deal-cta-block" style="margin:32px 0;padding:28px;border-radius:16px;background:linear-gradient(135deg,#7C3AED 0%,#C026D3 100%);color:#fff;box-shadow:0 6px 22px rgba(124,58,237,0.30);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;text-align:center;">
  <?php if ($badge !== ''): ?>
  <div style="display:inline-block;padding:6px 14px;border-radius:999px;background:#ffffff;color:#7C3AED;font-size:11px;font-weight:800;letter-spacing:0.8px;text-transform:uppercase;margin-bottom:14px;"><?php echo esc_html($badge); ?></div>
  <?php endif; ?>
  <div style="font-size:22px;font-weight:800;line-height:1.25;margin-bottom:10px;">Ready to grab the deal?</div>
  <p style="margin:0 0 18px;font-size:14px;line-height:1.5;opacity:0.92;max-width:520px;margin-left:auto;margin-right:auto;">Tap the button to go straight to the live offer on Amazon. Pricing can change without notice while it&apos;s active.</p>
  <a href="<?php echo esc_url($url); ?>" rel="nofollow sponsored" target="_blank" style="display:inline-block;padding:18px 38px;border-radius:14px;background:#ffffff;color:#7C3AED;font-size:18px;font-weight:800;text-decoration:none;letter-spacing:0.4px;box-shadow:0 6px 16px rgba(0,0,0,0.20);"><?php echo esc_html($btn_label); ?> →</a>
  <?php if ($code !== ''): ?>
  <div style="margin-top:14px;font-size:13px;opacity:0.9;">
    Promo code: <code style="padding:3px 10px;border-radius:8px;background:rgba(255,255,255,0.20);font-weight:700;letter-spacing:0.5px;border:1px dashed rgba(255,255,255,0.4);"><?php echo esc_html($code); ?></code>
  </div>
  <?php endif; ?>
</div>
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
        // 2026-06-09: aligned to the new "Get the best price..." voice
        // (was "Check Today's Price on Amazon" / "Get The Best Price Today").
        $cta_text  = $is_amazon ? "Get the best price on Amazon →" : "Get the best price today →";
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

// ─── 20. Reader UX upgrades (v1.0.44, 2026-06-08) ──────────────────────────
//
// Four small but high-leverage reader-UX additions, ALL injected via
// wp_footer so they have zero impact on the article HTML the generator
// produces:
//
//   A. Reading progress bar  — thin colored line across the top of the
//      viewport that fills as the reader scrolls. Same signal Wirecutter
//      / NYT use to make long-form feel digestible.
//   B. FAQ accordion          — finds the "Frequently Asked Questions" H2
//      and collapses each following H3 + paragraph into a tap-to-expand
//      pair. Content stays in the DOM (SEO-safe) — only CSS hides it.
//   C. Jump-to-verdict pill   — mobile-only floating button that appears
//      after the reader scrolls past the verdict box and lets them jump
//      back with one tap. Complements the sticky TOC.
//   D. Best-for badges        — CSS hooks for the `.gr-best-for-tags`
//      container the generator emits inside the verdict box. The badges
//      themselves are added in the generator prompt (commit pair: WP + AI).
//
// All four are scoped to single-post pages only.
add_action('wp_footer', 'mvp_affiliate_render_reader_ux');
if (!function_exists('mvp_affiliate_render_reader_ux')) {
    function mvp_affiliate_render_reader_ux() {
        if (!is_singular('post')) return;
        ?>
<style>
/* A. Reading progress bar — thin fixed bar at very top of viewport */
#mvp-progress{position:fixed;top:0;left:0;height:3px;width:0;background:linear-gradient(90deg,#FFC200,#FF6B00);z-index:9998;transition:width 60ms linear;pointer-events:none}
@media(prefers-reduced-motion:reduce){#mvp-progress{transition:none}}

/* B. FAQ accordion — collapsed-by-default tap-to-expand. Each FAQ Q is the
   H3 that follows the "Frequently Asked Questions" H2; A is the next P (or
   subsequent siblings until the next H3). JS wraps them into .mvp-faq-item
   divs with a button and a body. */
.mvp-faq-item{border-bottom:1px solid #e5e5e7;margin:0}
.mvp-faq-item:first-of-type{border-top:1px solid #e5e5e7}
.mvp-faq-q{width:100%;text-align:left;background:none;border:none;padding:18px 36px 18px 0;font-size:17px;font-weight:700;color:#1d1d1f;cursor:pointer;display:flex;align-items:center;justify-content:space-between;position:relative;font-family:inherit;line-height:1.4}
.mvp-faq-q:hover{color:#FF6B00}
.mvp-faq-q::after{content:"";flex-shrink:0;width:12px;height:12px;margin-left:16px;border-right:2px solid currentColor;border-bottom:2px solid currentColor;transform:rotate(45deg);transition:transform .2s ease}
.mvp-faq-item.is-open .mvp-faq-q::after{transform:rotate(-135deg)}
.mvp-faq-a{max-height:0;overflow:hidden;transition:max-height .3s ease;color:#3a3a3c;font-size:16px;line-height:1.65}
.mvp-faq-item.is-open .mvp-faq-a{max-height:2000px;padding:0 0 18px}
.mvp-faq-a > *:first-child{margin-top:0}
.mvp-faq-a > *:last-child{margin-bottom:0}
@media(prefers-reduced-motion:reduce){.mvp-faq-a{transition:none}}

/* C. Jump-to-verdict pill — mobile only, floating bottom-left so it
   doesn't conflict with the sticky CTA on the right. */
#mvp-jump-verdict{position:fixed;bottom:80px;left:14px;background:#1d1d1f;color:#fff;border:none;border-radius:999px;padding:11px 18px;font-size:13px;font-weight:700;box-shadow:0 4px 16px rgba(0,0,0,.25);cursor:pointer;display:none;align-items:center;gap:8px;z-index:9997;font-family:inherit;text-decoration:none}
#mvp-jump-verdict:hover{background:#000;color:#fff;text-decoration:none}
#mvp-jump-verdict svg{flex-shrink:0}
@media(min-width:769px){#mvp-jump-verdict{display:none !important}}

/* D. Best-for badges — chips inside the verdict box. The generator emits
   <div class="gr-best-for-tags"><span class="gr-best-for-tag">Budget</span>…</div>
   when applicable (1-3 badges). */
.gr-best-for-tags{display:flex;flex-wrap:wrap;gap:6px;margin:14px 0 0;padding-top:14px;border-top:1px solid #e5e5e7}
.gr-best-for-tag{display:inline-flex;align-items:center;gap:5px;background:#fff8e1;color:#9a6400;border:1px solid #ffd54f;border-radius:999px;padding:4px 10px;font-size:11px;font-weight:700;letter-spacing:.4px;text-transform:uppercase;line-height:1.4}
.gr-best-for-tag::before{content:"";display:inline-block;width:6px;height:6px;background:currentColor;border-radius:50%}

/* E. AT A GLANCE specs table (#7, 2026-06-08) — compact 4-6 row table the
   generator emits between the scorecard and the body. Scan-friendly two-
   column layout: bold spec name left, value right. */
.gr-specs-table{width:100%;border-collapse:collapse;margin:24px 0 32px;font-size:14px;line-height:1.5;background:#fff;border:1px solid #e5e5e7;border-radius:6px;overflow:hidden}
.gr-specs-table tr{border-bottom:1px solid #f0f0f0}
.gr-specs-table tr:last-child{border-bottom:none}
.gr-specs-table tr:nth-child(odd){background:#fafafa}
.gr-specs-table th{text-align:left;font-weight:700;color:#1d1d1f;padding:10px 16px;width:38%;vertical-align:middle;font-size:13px;letter-spacing:.2px}
.gr-specs-table td{padding:10px 16px;color:#3a3a3c;vertical-align:middle}
@media(max-width:520px){
  .gr-specs-table{font-size:13px}
  .gr-specs-table th{padding:9px 12px;width:44%}
  .gr-specs-table td{padding:9px 12px}
}
.gr-specs-table::before{display:block;content:"At a glance";font-size:11px;font-weight:800;letter-spacing:1.2px;text-transform:uppercase;color:#86868b;padding:12px 16px 8px;border-bottom:1px solid #f0f0f0;background:#fff}

/* F. Inline mini-comparison (#12, 2026-06-08) — VS competitors table the
   generator emits ONLY when transcript names 2 specific alternatives.
   Highlight the "this product" column with a subtle accent so the reader
   sees what they're comparing against. */
.gr-vs-comparison{width:100%;border-collapse:collapse;margin:32px 0 8px;font-size:14px;background:#fff;border:1px solid #e5e5e7;border-radius:6px;overflow:hidden}
.gr-vs-comparison thead th{background:#f5f5f7;font-size:12px;font-weight:800;color:#1d1d1f;padding:14px 12px;text-align:left;letter-spacing:.3px;border-bottom:2px solid #e5e5e7}
.gr-vs-comparison thead th.gr-vs-this{background:#fff8e1;color:#9a6400}
.gr-vs-comparison tbody th{text-align:left;font-weight:700;color:#86868b;padding:12px;font-size:11px;letter-spacing:.8px;text-transform:uppercase;width:22%;border-bottom:1px solid #f0f0f0}
.gr-vs-comparison tbody td{padding:12px;color:#1d1d1f;font-weight:500;border-bottom:1px solid #f0f0f0;vertical-align:middle}
.gr-vs-comparison tbody td.gr-vs-this{background:#fffbe8;font-weight:700}
.gr-vs-comparison tr:last-child th,.gr-vs-comparison tr:last-child td{border-bottom:none}
.gr-vs-source{font-size:12px;color:#86868b;margin:0 0 32px;text-align:right}
@media(max-width:520px){
  .gr-vs-comparison{font-size:12px}
  .gr-vs-comparison thead th,.gr-vs-comparison tbody th,.gr-vs-comparison tbody td{padding:9px 8px}
}

/* H. What we'd improve (#14, 2026-06-08, opt-in) — manufacturer-facing
   critique block between the body and FAQ. Styled with a soft amber
   left rail so it reads as editorial commentary, not another Cons list.
   Only renders when the user opted in via Brand Profile + the AI emitted
   the block. */
.gr-improvements{background:#fffaf0;border-left:4px solid #f59e0b;border-radius:0 6px 6px 0;padding:20px 24px;margin:32px 0}
.gr-improvements-title{font-size:14px !important;font-weight:800 !important;letter-spacing:.6px;text-transform:uppercase;color:#92400e !important;margin:0 0 8px !important;padding:0 !important;border:0 !important}
.gr-improvements-lead{font-size:15px;color:#3a3a3c;margin:0 0 14px}
.gr-improvements-list{margin:0;padding:0 0 0 20px;color:#3a3a3c}
.gr-improvements-list li{margin:0 0 10px;line-height:1.55}
.gr-improvements-list li:last-child{margin-bottom:0}
.gr-improvements-list strong{color:#1d1d1f;font-weight:700}

/* G. Also Consider cards (#8, 2026-06-08) — clickable internal-link cards
   inline (mid-post, just before FAQ via lib/internal-links.ts). Each card
   shows a post-type chip + title + arrow. Three-up on desktop, stacked
   on mobile. */
.gr-also-consider{margin:36px 0;padding:24px 0;border-top:1px solid #e5e5e7;border-bottom:1px solid #e5e5e7}
.gr-ac-heading{font-size:13px !important;font-weight:800 !important;letter-spacing:1.2px;text-transform:uppercase;color:#86868b !important;margin:0 0 16px !important;padding:0 !important;border:0 !important}
.gr-ac-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}
.gr-ac-card{position:relative;display:flex;flex-direction:column;gap:8px;background:#fff;border:1px solid #e5e5e7;border-radius:8px;padding:16px 18px 22px;text-decoration:none;transition:transform .15s ease,box-shadow .15s ease,border-color .15s ease;color:inherit}
.gr-ac-card:hover{transform:translateY(-2px);box-shadow:0 8px 24px rgba(0,0,0,.06);border-color:#d2d2d7;text-decoration:none;color:inherit}
.gr-ac-chip{align-self:flex-start;background:#f5f5f7;color:#3a3a3c;font-size:10px;font-weight:800;letter-spacing:.6px;text-transform:uppercase;padding:3px 8px;border-radius:999px;line-height:1.4}
.gr-ac-title{font-size:15px;font-weight:700;color:#1d1d1f;line-height:1.35;letter-spacing:-.01em;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.gr-ac-arrow{position:absolute;bottom:14px;right:16px;font-size:18px;color:#86868b;transition:color .15s ease,transform .15s ease}
.gr-ac-card:hover .gr-ac-arrow{color:#FF6B00;transform:translateX(2px)}
@media(max-width:768px){
  .gr-ac-grid{grid-template-columns:1fr;gap:8px}
  .gr-ac-card{padding:14px 16px 18px}
}
</style>

<!-- A. Reading progress bar -->
<div id="mvp-progress" aria-hidden="true"></div>

<!-- C. Jump-to-verdict floating pill (mobile) -->
<a id="mvp-jump-verdict" href="#mvp-verdict-anchor" aria-label="Jump to verdict">
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 11 12 14 22 4"></polyline><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"></path></svg>
  Verdict
</a>

<script>
(function(){
  // A. Progress bar — recompute on scroll, throttled via rAF.
  var bar = document.getElementById('mvp-progress');
  if (bar) {
    var ticking = false;
    function update(){
      var h = document.documentElement;
      var max = (h.scrollHeight - h.clientHeight) || 1;
      var pct = Math.min(100, Math.max(0, (h.scrollTop / max) * 100));
      bar.style.width = pct + '%';
      ticking = false;
    }
    window.addEventListener('scroll', function(){
      if (!ticking) { window.requestAnimationFrame(update); ticking = true; }
    }, { passive: true });
    update();
  }

  // B. FAQ accordion — find "Frequently Asked Questions" H2 (case-insensitive
  // match on heading text), then walk forward through siblings collapsing
  // each H3 + everything before the next H3 into a .mvp-faq-item.
  function buildFAQ(){
    var heads = document.querySelectorAll('article h2, .entry-content h2, .mvp-single-body h2, .post-content h2');
    var faqHeader = null;
    for (var i = 0; i < heads.length; i++) {
      if (/^\s*frequently asked questions\s*$/i.test(heads[i].textContent || '')) {
        faqHeader = heads[i]; break;
      }
    }
    if (!faqHeader) return;
    // Non-FAQ blocks that may follow the last Q&A — the CTA card, hashtags,
    // related reviews, author bio, newsletter, product finder. The accordion
    // must STOP at these so the last answer doesn't swallow them into its
    // collapsible panel (they belong AFTER the FAQ, as normal post content).
    var FAQ_STOP = '.gr-cta-card, .gr-tags, .gr-related-reviews, .gr-author-bio-card, .gr-newsletter-cta, .gr-product-finder, .gr-price-strip';
    function isFaqStop(el){
      return !el || el.tagName === 'H2' || (el.matches && el.matches(FAQ_STOP));
    }
    var node = faqHeader.nextElementSibling;
    while (node) {
      // Stop at the next H2 (e.g. Related Reviews) or any post-chrome block.
      if (node.tagName === 'H2' || (node.matches && node.matches(FAQ_STOP))) break;
      if (node.tagName === 'H3') {
        // Collect this Q's answer = every sibling up to the next H3/H2 or the
        // first post-chrome block (CTA card, tags, …).
        var q = node;
        var body = [];
        var next = q.nextElementSibling;
        while (next && next.tagName !== 'H3' && !isFaqStop(next)) {
          body.push(next);
          next = next.nextElementSibling;
        }
        // Wrap into an accordion item, inserted in q's position.
        var item = document.createElement('div');
        item.className = 'mvp-faq-item';
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'mvp-faq-q';
        btn.setAttribute('aria-expanded', 'false');
        btn.textContent = q.textContent || '';
        var ans = document.createElement('div');
        ans.className = 'mvp-faq-a';
        for (var j = 0; j < body.length; j++) ans.appendChild(body[j]);
        item.appendChild(btn);
        item.appendChild(ans);
        q.parentNode.insertBefore(item, q);
        q.parentNode.removeChild(q);
        btn.addEventListener('click', function(){
          var parent = this.parentNode;
          var open = parent.classList.toggle('is-open');
          this.setAttribute('aria-expanded', open ? 'true' : 'false');
        });
        node = next;
        continue;
      }
      node = node.nextElementSibling;
    }
  }
  // Wait for DOM ready (in case article body renders after wp_footer fires)
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', buildFAQ);
  } else {
    buildFAQ();
  }

  // C. Jump-to-verdict pill — show only AFTER the reader scrolls past the
  // verdict box, hide when they're already inside it.
  var pill = document.getElementById('mvp-jump-verdict');
  if (pill) {
    var verdict = null;
    function findVerdict(){
      verdict = document.getElementById('mvp-verdict-anchor')
        || document.querySelector('.gr-scorecard')
        || document.querySelector('.gr-verdict-box');
    }
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', findVerdict);
    } else { findVerdict(); }
    var pillTicking = false;
    function pillUpdate(){
      if (!verdict) { pillTicking = false; return; }
      var rect = verdict.getBoundingClientRect();
      // Show only after the verdict has scrolled OFF the top, AND when the
      // reader is at least 600px past it (so the pill doesn't flicker for
      // micro-scrolls right at the boundary).
      var scrolledPast = rect.bottom < -200;
      pill.style.display = scrolledPast ? 'inline-flex' : 'none';
      pillTicking = false;
    }
    window.addEventListener('scroll', function(){
      if (!pillTicking) { window.requestAnimationFrame(pillUpdate); pillTicking = true; }
    }, { passive: true });
  }
})();
</script>
        <?php
    }
}

// ─── 20b. Add an anchor to the verdict box so the jump-pill knows where to go ─
// The generator emits `<div class="gr-verdict-box">` but doesn't include an
// id. Rather than re-prompt the AI, we filter the content and prepend an
// invisible anchor div right before the verdict box.
add_filter('the_content', function ($content) {
    if (!is_singular('post')) return $content;
    if (strpos($content, 'id="mvp-verdict-anchor"') !== false) return $content; // already added
    $anchor = '<div id="mvp-verdict-anchor" aria-hidden="true" style="position:relative;top:-80px"></div>';
    // Insert immediately before the first gr-verdict-box. If no verdict box,
    // pass through unchanged.
    return preg_replace(
        '/(<div class="gr-verdict-box")/i',
        $anchor . '$1',
        $content,
        1
    ) ?: $content;
}, 25);

// ─── 20c. Clickable video timestamps (#10, v1.0.44, 2026-06-08) ────────────
//
// Generator writes [mm:ss] markers inline next to specific moments from
// the video (e.g. "battery hit 20% after 6 hours of mixed use [9:15]").
// This filter:
//   1. Wraps each [mm:ss] in a clickable .gr-ts span carrying data-ts in
//      seconds, so the footer JS can seek the embedded YouTube player.
//   2. Upgrades the embedded YouTube iframe with ?enablejsapi=1 +
//      id="mvp-yt-player" so the YT IFrame API can address it.
// Footer JS (in mvp_affiliate_render_reader_ux_timestamps below) loads the
// API on first timestamp click — zero cost on posts without timestamps.
add_filter('the_content', 'mvp_affiliate_inject_timestamps', 30);
if (!function_exists('mvp_affiliate_inject_timestamps')) {
    function mvp_affiliate_inject_timestamps($content) {
        if (!is_singular('post')) return $content;
        // 1. Wrap [mm:ss] / [m:ss] / [h:mm:ss] inside body paragraphs.
        //    Skip if pattern appears inside an existing <a> or inside
        //    <pre>/<code> blocks (cheap heuristic via tag mask below).
        //    We're permissive on minute width: 1–2 digits; strict on seconds: 2 digits.
        $pattern = '/\[(\d{1,2}):(\d{2})(?::(\d{2}))?\]/';
        $content = preg_replace_callback($pattern, function ($m) {
            // Compute total seconds. [h:mm:ss] → h*3600 + mm*60 + ss; [mm:ss] → mm*60 + ss.
            if (isset($m[3]) && $m[3] !== '') {
                $sec = (intval($m[1]) * 3600) + (intval($m[2]) * 60) + intval($m[3]);
                $label = $m[1] . ':' . str_pad($m[2], 2, '0', STR_PAD_LEFT) . ':' . $m[3];
            } else {
                $sec = (intval($m[1]) * 60) + intval($m[2]);
                $label = intval($m[1]) . ':' . str_pad($m[2], 2, '0', STR_PAD_LEFT);
            }
            // Span renders inline; href="#mvp-yt-player" gives keyboard +
            // no-JS fallback (scrolls reader to the video on click).
            return '<a class="gr-ts" data-ts="' . $sec . '" href="#mvp-yt-player" aria-label="Play video at ' . esc_attr($label) . '">' . esc_html($label) . '</a>';
        }, $content);

        // 2. Upgrade the YouTube embed iframe(s) — add enablejsapi=1 + an id
        //    we can find from JS. Match the existing `<iframe src=".../embed/{ID}"`
        //    pattern. If the URL already has query params, append with &;
        //    otherwise prepend ?. Idempotent: skip if enablejsapi is already there.
        $content = preg_replace_callback(
            '#<iframe([^>]*)src="(https?://(?:www\.)?youtube(?:-nocookie)?\.com/embed/[^"]+)"([^>]*)>#i',
            function ($m) {
                $before = $m[1];
                $url = $m[2];
                $after = $m[3];
                if (strpos($url, 'enablejsapi=1') === false) {
                    $url .= (strpos($url, '?') === false ? '?' : '&') . 'enablejsapi=1&origin=' . urlencode(home_url());
                }
                // Add id if not already present in either attribute group.
                if (strpos($before . $after, ' id=') === false) {
                    $after .= ' id="mvp-yt-player"';
                }
                return '<iframe' . $before . 'src="' . $url . '"' . $after . '>';
            },
            $content
        );

        return $content;
    }
}

// ─── 20d. Footer JS for timestamp clicks — YouTube IFrame API loader ───────
add_action('wp_footer', 'mvp_affiliate_render_timestamp_js');
if (!function_exists('mvp_affiliate_render_timestamp_js')) {
    function mvp_affiliate_render_timestamp_js() {
        if (!is_singular('post')) return;
        ?>
<style>
.gr-ts{display:inline-flex;align-items:center;gap:2px;background:#1d1d1f;color:#fff !important;padding:1px 7px 1px 5px;border-radius:4px;font-size:0.85em;font-weight:600;text-decoration:none;line-height:1.3;margin:0 2px;cursor:pointer;font-variant-numeric:tabular-nums;letter-spacing:.2px;vertical-align:baseline;transition:background .15s ease,transform .12s ease;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
.gr-ts:hover{background:#FF6B00;color:#fff !important;text-decoration:none;transform:translateY(-1px)}
.gr-ts::before{content:"▶";font-size:.62em;opacity:.8;margin-right:1px;line-height:1}
</style>
<script>
(function(){
  var pending = null;     // First timestamp clicked while API loads → seek when ready.
  var player  = null;     // YT.Player instance once available.
  var apiLoaded = false;  // YT API script tag injected?

  function loadYouTubeApi(){
    if (apiLoaded) return;
    apiLoaded = true;
    var s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    s.async = true;
    document.head.appendChild(s);
  }

  // Global callback the YT API calls when ready.
  window.onYouTubeIframeAPIReady = function(){
    var iframe = document.getElementById('mvp-yt-player');
    if (!iframe || typeof YT === 'undefined' || !YT.Player) return;
    try {
      player = new YT.Player('mvp-yt-player', {
        events: {
          onReady: function(){
            if (pending !== null) {
              try { player.seekTo(pending, true); player.playVideo(); } catch(e){}
              pending = null;
            }
          }
        }
      });
    } catch(e) { /* if YT.Player ctor throws, click falls back to anchor jump */ }
  };

  function seek(sec){
    if (player && typeof player.seekTo === 'function') {
      try { player.seekTo(sec, true); player.playVideo(); } catch(e){}
    } else {
      pending = sec;
      loadYouTubeApi();
    }
  }

  function bind(){
    document.querySelectorAll('.gr-ts').forEach(function(el){
      if (el.dataset.bound) return;
      el.dataset.bound = '1';
      el.addEventListener('click', function(ev){
        var ts = parseInt(el.getAttribute('data-ts'), 10);
        if (!isNaN(ts) && document.getElementById('mvp-yt-player')) {
          // Let the # navigation scroll the video into view, then seek.
          // (Default anchor jump still fires unless we preventDefault.)
          // We DO want the scroll-to-player behavior, so don't prevent.
          seek(ts);
        }
      });
    });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else { bind(); }
})();
</script>
        <?php
    }
}

// ─── 20e. Legacy CTA copy rewrite (v1.0.49+, 2026-06-09) ──────────────────
//
// 2026-06-08/09: the AI prompt + price-strip injector switched to the new
// "Get the best price..." voice. New posts ship with the new copy, but
// existing posts have older strings baked into their stored content in
// WordPress — regenerating every one is tedious. This filter rewrites
// legacy copy at render time so old posts match the new branding without
// touching the post bodies.
//
// Surfaces handled:
//   - .gr-cta-btn         (end-of-post + mid-article yellow CTA card)
//     Old: "Find Out More →" or "Get Yours Today on Amazon|Here →"
//     New: "Get the best price on Amazon|today →"
//   - .gr-price-strip-btn (inline blue/orange CTA strip under verdict)
//     Old: "Check Today's Price on Amazon ..." / "Get The Best Price Today"
//     New: "Get the best price on Amazon ..." / "Get the best price today"
//
// The mobile sticky bar is NOT a baked-into-content surface — its text
// comes from PHP at render time, so it updates automatically when the
// plugin updates (no rewrite needed there).
//
// Idempotent: if a post already has new copy, the regex doesn't match
// and the content passes through unchanged.
//
// 2026-06-09 (v1.0.51): yellow .gr-cta-btn voice unified with the price
// strip — now rewrites "Get Yours Today..." (the previous attempt) too,
// and widened Amazon detection so Geniuslink (geni.us) products no
// longer fall through to the "Here" variant.
add_filter('the_content', 'mvp_affiliate_rewrite_legacy_cta', 35);
if (!function_exists('mvp_affiliate_rewrite_legacy_cta')) {
    function mvp_affiliate_rewrite_legacy_cta($content) {
        if (!is_singular('post')) return $content;
        $has_old_yellow = (stripos($content, 'find out more') !== false)
                        || (stripos($content, 'Get Yours Today') !== false);
        $has_old_strip  = (stripos($content, "Check Today's Price on Amazon") !== false)
                        || (stripos($content, 'Get The Best Price Today') !== false)
                        || (preg_match('/Get [^<]+ — Best Price Today/i', $content) === 1);
        if (!$has_old_yellow && !$has_old_strip) return $content; // fast path

        // ── End-of-post + mid-article yellow CTA card (.gr-cta-btn) ─────────
        if ($has_old_yellow) {
            $content = preg_replace_callback(
                '#<a([^>]*\bclass="gr-cta-btn"[^>]*)>(.*?)</a>#is',
                function ($m) {
                    $attrs = $m[1];
                    $inner = $m[2];
                    $is_legacy = (stripos($inner, 'find out more') !== false)
                              || (stripos($inner, 'Get Yours Today') !== false);
                    if (!$is_legacy) return $m[0];
                    $href = '';
                    if (preg_match('/\bhref="([^"]*)"/i', $attrs, $hm)) $href = $hm[1];
                    $is_amazon = (bool) preg_match('/amazon\.[a-z.]+\b|\bamzn\.to\b|\bgeni\.us\b|\ba\.co\b/i', $href);
                    $new_text  = $is_amazon ? 'Get the best price on Amazon →' : 'Get the best price today →';
                    return '<a' . $attrs . '>' . $new_text . '</a>';
                },
                $content
            ) ?: $content;
        }

        // ── Inline price-strip CTA (.gr-price-strip-btn) ───────────────────
        if ($has_old_strip) {
            $content = preg_replace_callback(
                '#<a([^>]*\bclass="gr-price-strip-btn"[^>]*)>(.*?)</a>#is',
                function ($m) {
                    $attrs = $m[1];
                    $inner = $m[2];
                    $is_legacy =
                        stripos($inner, "Check Today's Price on Amazon") !== false
                        || stripos($inner, 'Get The Best Price Today') !== false
                        || preg_match('/Get [^<]+ — Best Price Today/i', $inner) === 1;
                    if (!$is_legacy) return $m[0];

                    $href = '';
                    if (preg_match('/\bhref="([^"]*)"/i', $attrs, $hm)) $href = $hm[1];
                    $is_amazon = (bool) preg_match('/amazon\.|amzn\.to|geni\.us/i', $href);

                    // Try to preserve productName from the legacy label so
                    // we don't lose the SEO-friendly product-specific copy.
                    // Patterns:
                    //   "Check Today's Price on Amazon for {NAME} →"
                    //   "Get {NAME} — Best Price Today →"
                    $product_name = '';
                    if (preg_match('/Check Today\'s Price on Amazon for (.+?)\s*→/i', $inner, $pm)) {
                        $product_name = trim(strip_tags($pm[1]));
                    } elseif (preg_match('/Get (.+?)\s*—\s*Best Price Today/i', $inner, $pm)) {
                        $product_name = trim(strip_tags($pm[1]));
                    }

                    if ($is_amazon) {
                        $new_text = $product_name
                            ? '🛒 Get the best price on Amazon for ' . esc_html($product_name) . ' →'
                            : '🛒 Get the best price on Amazon →';
                    } else {
                        $new_text = $product_name
                            ? '🔗 Get the best price today for ' . esc_html($product_name) . ' →'
                            : '🔗 Get the best price today →';
                    }
                    return '<a' . $attrs . '>' . $new_text . '</a>';
                },
                $content
            ) ?: $content;
        }

        return $content;
    }
}

// ─── 14. AI-readiness: /llms.txt + AI-crawler robots allowlist ───────────────
// Make every MVP-managed blog discoverable + citable by AI shopping agents
// (ChatGPT, Claude, Perplexity, Google AI). This is the affiliate-publisher
// analog of Shopify's UCP "discovery layer": we don't transact, we make the
// content the agent trusts, quotes, and links.
//
//   (a) /llms.txt — a markdown "map for AI" (llmstxt.org convention): site
//       summary + a prioritized list of review / guide / comparison posts.
//   (b) robots.txt — explicitly ALLOW the major AI crawlers (many hosts and
//       security plugins block them by default → silent invisibility to AI).

// (a) Serve /llms.txt. Intercept early on `init` by the raw request path so it
//     works regardless of permalink / rewrite state. Cached 6h in a transient
//     so it's one query per refresh, not per hit; busted on post save/delete.
add_action('init', function () {
    $path = parse_url($_SERVER['REQUEST_URI'] ?? '', PHP_URL_PATH);
    if ($path !== '/llms.txt') return;

    $body = get_transient('mvp_llms_txt');
    if ($body === false) {
        $name = get_bloginfo('name');
        $desc = get_bloginfo('description');
        $lines = [];
        $lines[] = '# ' . $name;
        if ($desc) $lines[] = '> ' . $desc;
        $lines[] = '';
        $lines[] = 'Fact-grounded product reviews, comparisons, and buying guides based on real hands-on testing and verified product specs, written to help shoppers and AI shopping assistants make an accurate choice. Posts may contain affiliate links.';
        $lines[] = '';
        $lines[] = '## Reviews & guides';

        $q = new WP_Query([
            'post_type'           => 'post',
            'post_status'         => 'publish',
            'posts_per_page'      => 200,
            'orderby'             => 'date',
            'order'               => 'DESC',
            'no_found_rows'       => true,
            'ignore_sticky_posts' => true,
        ]);
        foreach ($q->posts as $p) {
            $title = trim(get_the_title($p));
            $url   = get_permalink($p);
            $ex    = trim(wp_strip_all_tags(get_the_excerpt($p)));
            if (strlen($ex) > 160) $ex = substr($ex, 0, 157) . '...';
            if ($title === '' || !$url) continue;
            $lines[] = $ex !== '' ? '- [' . $title . '](' . $url . '): ' . $ex
                                  : '- [' . $title . '](' . $url . ')';
        }
        wp_reset_postdata();

        $lines[] = '';
        $lines[] = '## Product catalog';
        $lines[] = '- [Machine-readable product feed (JSON)](' . home_url('/products.json') . ') — every reviewed product with its buy link, price/availability, and rating.';
        $lines[] = '';
        $lines[] = '## About';
        $lines[] = '- [Home](' . home_url('/') . ')';

        $body = implode("\n", $lines) . "\n";
        set_transient('mvp_llms_txt', $body, 6 * HOUR_IN_SECONDS);
    }

    header('Content-Type: text/plain; charset=utf-8');
    header('X-Robots-Tag: noindex'); // the map file itself needn't be indexed
    echo $body;
    exit;
}, 1);

// Bust the llms.txt + products.json caches on any publish/update/delete so they
// stay current.
add_action('save_post', function ($post_id) {
    if (wp_is_post_revision($post_id)) return;
    delete_transient('mvp_llms_txt');
    delete_transient('mvp_products_json');
});
add_action('deleted_post', function () {
    delete_transient('mvp_llms_txt');
    delete_transient('mvp_products_json');
});

// (b) AI-crawler allowlist appended to WordPress's virtual robots.txt.
//     CAVEAT: only applies when WP serves the virtual robots.txt (no static
//     robots.txt file on disk). If a static file exists, these blocks must be
//     added there manually.
add_filter('robots_txt', function ($output) {
    $bots = [
        'GPTBot', 'OAI-SearchBot', 'ChatGPT-User',  // OpenAI
        'ClaudeBot', 'Claude-Web', 'anthropic-ai',  // Anthropic
        'PerplexityBot',                            // Perplexity
        'Google-Extended',                          // Google AI / Gemini
        'Applebot-Extended',                        // Apple Intelligence
        'Amazonbot', 'meta-externalagent',          // Amazon, Meta
    ];
    $extra = "\n# AI assistants - explicitly allowed (MVP Affiliate AI-readiness)\n";
    foreach ($bots as $b) {
        $extra .= "User-agent: {$b}\nAllow: /\n\n";
    }
    $extra .= '# AI content map: ' . home_url('/llms.txt') . "\n";
    $extra .= '# Product catalog: ' . home_url('/products.json') . "\n";
    return $output . $extra;
}, 10, 1);

// (c) /products.json — a machine-readable product catalog (the affiliate-
//     publisher analog of Shopify's Catalog API). Aggregates every reviewed
//     product from the per-post schema we already emit (post meta mvp_jsonld:
//     Product + Offer + Review), so AI shopping agents can ingest the whole
//     catalogue in one fetch: name, buy link, price/availability, rating.
//     Cached 6h (busted on post save/delete above). Public + CORS-open.
add_action('init', function () {
    $path = parse_url($_SERVER['REQUEST_URI'] ?? '', PHP_URL_PATH);
    if ($path !== '/products.json') return;

    $body = get_transient('mvp_products_json');
    if ($body === false) {
        $products = [];
        $q = new WP_Query([
            'post_type'           => 'post',
            'post_status'         => 'publish',
            'posts_per_page'      => 500,
            'orderby'             => 'date',
            'order'               => 'DESC',
            'no_found_rows'       => true,
            'ignore_sticky_posts' => true,
            'meta_key'            => 'mvp_jsonld', // only posts that carry our schema
        ]);
        foreach ($q->posts as $p) {
            $raw = get_post_meta($p->ID, 'mvp_jsonld', true);
            if (!$raw) continue;
            $data = json_decode($raw, true);
            if (!is_array($data) || empty($data['@graph']) || !is_array($data['@graph'])) continue;

            $product = null; $review = null;
            foreach ($data['@graph'] as $node) {
                $t = $node['@type'] ?? '';
                if ($t === 'Product' && !$product) $product = $node;
                if ($t === 'Review' && !$review) $review = $node;
            }
            if (!$product || empty($product['name'])) continue;

            $entry = [
                'name'      => $product['name'],
                'reviewUrl' => get_permalink($p),
            ];
            if (!empty($product['image'])) {
                $entry['image'] = is_array($product['image']) ? ($product['image'][0] ?? null) : $product['image'];
            }
            if (!empty($product['brand']['name'])) $entry['brand'] = $product['brand']['name'];
            if (!empty($product['url'])) $entry['buyUrl'] = $product['url'];
            if (!empty($product['offers']) && is_array($product['offers'])) {
                $offer = $product['offers'];
                if (!empty($offer['url'])) $entry['buyUrl'] = $offer['url'];
                if (isset($offer['price'])) $entry['price'] = $offer['price'];
                if (!empty($offer['priceCurrency'])) $entry['priceCurrency'] = $offer['priceCurrency'];
                if (!empty($offer['availability'])) $entry['availability'] = $offer['availability'];
            }
            if ($review && !empty($review['reviewRating']['ratingValue'])) {
                $entry['rating'] = $review['reviewRating']['ratingValue'];
                $entry['ratingMax'] = $review['reviewRating']['bestRating'] ?? 5;
            }
            $entry['datePublished'] = get_the_date('c', $p);
            $products[] = $entry;
        }
        wp_reset_postdata();

        $body = wp_json_encode([
            'site'      => home_url('/'),
            'name'      => get_bloginfo('name'),
            'generated' => gmdate('c'),
            'count'     => count($products),
            'products'  => $products,
        ], JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT);
        set_transient('mvp_products_json', $body, 6 * HOUR_IN_SECONDS);
    }

    header('Content-Type: application/json; charset=utf-8');
    header('Access-Control-Allow-Origin: *'); // public catalog — agents fetch cross-origin
    echo $body;
    exit;
}, 1);

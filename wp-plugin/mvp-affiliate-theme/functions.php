<?php
/**
 * MVP Affiliate Theme — functions.php
 *
 * Theme setup, asset loading, customization data helper, and CSS variable
 * injection. The MVP Affiliate plugin manages all settings/data via the
 * affiliateos_customizations WordPress option; this theme reads from it.
 */

if (!defined('ABSPATH')) exit;

define('MVP_AFFILIATE_THEME_VERSION', '1.0.0');

// ── Theme support ───────────────────────────────────────────────────────────
add_action('after_setup_theme', function () {
    add_theme_support('title-tag');
    add_theme_support('post-thumbnails');
    add_theme_support('automatic-feed-links');
    add_theme_support('responsive-embeds');
    add_theme_support('align-wide');
    add_theme_support('editor-styles');
    add_theme_support('html5', ['comment-list', 'comment-form', 'search-form', 'gallery', 'caption', 'style', 'script', 'navigation-widgets']);
    add_theme_support('custom-logo', [
        'height'      => 80,
        'width'       => 240,
        'flex-width'  => true,
        'flex-height' => true,
    ]);

    register_nav_menus([
        'primary' => __('Primary Menu', 'mvp-affiliate'),
        'footer'  => __('Footer Menu',  'mvp-affiliate'),
    ]);

    // Custom image sizes for review cards
    add_image_size('mvp-card',       640,  360, true);  // 16:9
    add_image_size('mvp-card-large', 1200, 675, true); // hero
});

// ── Sidebar / widget area ───────────────────────────────────────────────────
add_action('widgets_init', function () {
    register_sidebar([
        'name'          => __('Post Sidebar', 'mvp-affiliate'),
        'id'            => 'sidebar-1',
        'description'   => 'Appears beside single review posts',
        'before_widget' => '<section id="%1$s" class="widget %2$s">',
        'after_widget'  => '</section>',
        'before_title'  => '<h3 class="widget-title">',
        'after_title'   => '</h3>',
    ]);
});

// ── Font theme map ──────────────────────────────────────────────────────────
// Keys must match the FONT_THEMES list in the dashboard's BrandPage.
function mvp_affiliate_font_theme_config(string $key): array {
    $map = [
        'editorial' => [
            'google' => '',
            'heading' => '"Charter", "Georgia", "Cambria", "Times New Roman", serif',
            'body'    => '-apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
        ],
        'modern' => [
            'google' => 'family=Inter:wght@400;500;600;700;800',
            'heading' => '"Inter", -apple-system, BlinkMacSystemFont, sans-serif',
            'body'    => '"Inter", -apple-system, BlinkMacSystemFont, sans-serif',
        ],
        'classic' => [
            'google' => 'family=Playfair+Display:wght@700;800&family=Lora:wght@400;500',
            'heading' => '"Playfair Display", Georgia, serif',
            'body'    => '"Lora", Georgia, "Times New Roman", serif',
        ],
        'bold' => [
            'google' => 'family=Space+Grotesk:wght@500;600;700&family=DM+Sans:wght@400;500;700',
            'heading' => '"Space Grotesk", -apple-system, BlinkMacSystemFont, sans-serif',
            'body'    => '"DM Sans", -apple-system, BlinkMacSystemFont, sans-serif',
        ],
        'minimal' => [
            'google' => '',
            'heading' => '-apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif',
            'body'    => '-apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif',
        ],
    ];
    return $map[$key] ?? $map['editorial'];
}

// ── Asset loading ───────────────────────────────────────────────────────────
add_action('wp_enqueue_scripts', function () {
    wp_enqueue_style(
        'mvp-affiliate-main',
        get_template_directory_uri() . '/assets/css/main.css',
        [],
        MVP_AFFILIATE_THEME_VERSION
    );
    wp_enqueue_script(
        'mvp-affiliate-main',
        get_template_directory_uri() . '/assets/js/main.js',
        [],
        MVP_AFFILIATE_THEME_VERSION,
        true
    );

    // Brand colors + font theme from saved customizations
    $data    = mvp_affiliate_data();
    $profile = $data['profile'] ?? [];
    $primary    = trim($profile['primaryColor'] ?? ($profile['accentColor'] ?? '#0071e3'));
    $secondary  = trim($profile['secondaryColor'] ?? '#34c759');
    $font_theme = trim($profile['fontTheme'] ?? 'editorial');
    $fonts = mvp_affiliate_font_theme_config($font_theme);

    // Google Fonts (if needed) — load BEFORE main.css so font-family is available
    if (!empty($fonts['google'])) {
        wp_enqueue_style(
            'mvp-affiliate-fonts',
            'https://fonts.googleapis.com/css2?' . $fonts['google'] . '&display=swap',
            [],
            null
        );
    }

    // Inline CSS variable overrides
    $css = sprintf(
        ':root {--mvp-primary:%s;--mvp-secondary:%s;--mvp-font-serif:%s;--mvp-font-sans:%s;}',
        esc_html($primary),
        esc_html($secondary),
        $fonts['heading'],
        $fonts['body']
    );
    wp_add_inline_style('mvp-affiliate-main', $css);
});

// ── Customizations data helper ─────────────────────────────────────────────
// Returns the affiliateos_customizations option as a normalized array.
if (!function_exists('mvp_affiliate_data')) {
    function mvp_affiliate_data(): array {
        static $cache = null;
        if ($cache === null) {
            $raw = get_option('affiliateos_customizations', []);
            $cache = is_array($raw) ? $raw : [];
        }
        return $cache;
    }
}

// ── Tell the plugin we're rendering — so it can skip its own renderers ─────
add_filter('mvp_affiliate_theme_active', '__return_true');

// ── Helpers (shortcut accessors) ────────────────────────────────────────────
require_once get_template_directory() . '/inc/template-tags.php';
require_once get_template_directory() . '/inc/customizations.php';

// ── Excerpt tweaks ──────────────────────────────────────────────────────────
add_filter('excerpt_length', function () { return 28; });
add_filter('excerpt_more',   function () { return '…'; });

// ── Comments (used in templates) ────────────────────────────────────────────
add_action('after_setup_theme', function () {
    add_theme_support('comment-list');
});

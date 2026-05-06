<?php
/**
 * Magazine-style homepage for affiliate review blogs.
 * Inspired by gominreviews.com — works as a Kadence child theme front-page.
 */

get_header();

// ── Fetch data ────────────────────────────────────────────────────────────────
$all_posts = get_posts([
    'numberposts' => 20,
    'post_status' => 'publish',
    'orderby'     => 'date',
    'order'       => 'DESC',
]);

$hero     = $all_posts[0] ?? null;
$sidebar  = array_slice($all_posts, 1, 4);
$latest   = array_slice($all_posts, 1, 8);
$more     = array_slice($all_posts, 9, 8);

// All categories (excluding Uncategorized)
$categories = get_categories(['hide_empty' => true, 'exclude' => get_option('default_category')]);

// Brand info from blog options (fallback to Kadence global settings if available)
$brand_name  = get_bloginfo('name');
$brand_desc  = get_bloginfo('description');
$about_text  = get_option('affiliateos_about_text', 'We test every product and tell you the truth — good, bad, or ugly.');
$author_name = get_option('affiliateos_author_name', '');
$author_img  = get_option('affiliateos_author_img', '');

// Category emoji map (extend as needed)
$cat_icons = [
    'Kitchen'                 => '🍳',
    'Home'                    => '🏠',
    'Tech'                    => '💻',
    'Beauty'                  => '💄',
    'Fitness'                 => '🏋️',
    'Outdoor'                 => '🏕️',
    'Pet'                     => '🐾',
    'Gaming'                  => '🎮',
    'Clothing'                => '👕',
    'Clothing & Accessories'  => '👕',
    'Automotive'              => '🚗',
    'Tools'                   => '🔧',
    'Garden'                  => '🌿',
    'Food'                    => '🍔',
    'Travel'                  => '✈️',
    'Books'                   => '📚',
    'Music'                   => '🎵',
    'Baby'                    => '👶',
    'Office'                  => '🖊️',
    'Finance'                 => '💰',
    'Health'                  => '❤️',
    'Arts'                    => '🎨',
    'Software'                => '💾',
];

function aff_icon(string $name, array $map): string {
    foreach ($map as $key => $icon) {
        if (stripos($name, $key) !== false) return $icon;
    }
    return '📦';
}

function aff_excerpt(int $post_id, int $words = 18): string {
    $excerpt = get_the_excerpt($post_id);
    if (!$excerpt) {
        $excerpt = wp_trim_words(strip_tags(get_post_field('post_content', $post_id)), $words);
    }
    return esc_html($excerpt);
}

function aff_cat_label(int $post_id): string {
    $cats = get_the_category($post_id);
    if (empty($cats)) return '';
    $name = $cats[0]->name;
    if (strtolower($name) === 'uncategorized') {
        $cats = array_slice($cats, 1);
        $name = $cats[0]->name ?? '';
    }
    return esc_html($name);
}
?>
<!DOCTYPE html>
<html <?php language_attributes(); ?>>
<head>
<meta charset="<?php bloginfo('charset'); ?>">
<meta name="viewport" content="width=device-width, initial-scale=1">
<?php wp_head(); ?>
<style>
/* ── Reset & base ─────────────────────────────────────────────────────────── */
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#fff;color:#1a1a1a;font-size:15px;line-height:1.5}
img{display:block;max-width:100%}
a{text-decoration:none;color:inherit}

/* ── Layout ───────────────────────────────────────────────────────────────── */
.aff-wrap{max-width:1200px;margin:0 auto;padding:0 24px}
.aff-page{max-width:1200px;margin:0 auto}

/* ── Header ───────────────────────────────────────────────────────────────── */
.aff-header{border-bottom:1px solid #e8e8e8;padding:0 24px}
.aff-header-inner{max-width:1200px;margin:0 auto;display:flex;align-items:center;justify-content:space-between;height:60px}
.aff-logo{font-size:18px;font-weight:900;letter-spacing:-0.5px;color:#111}
.aff-logo span{color:#FFC200}

/* ── Nav ──────────────────────────────────────────────────────────────────── */
.aff-nav{background:#111;padding:0 24px}
.aff-nav-inner{max-width:1200px;margin:0 auto;display:flex;gap:0;overflow-x:auto;scrollbar-width:none}
.aff-nav-inner::-webkit-scrollbar{display:none}
.aff-nav a{font-size:11px;font-weight:800;letter-spacing:1.5px;text-transform:uppercase;color:rgba(255,255,255,.7);padding:12px 14px;white-space:nowrap;display:block;transition:color .15s}
.aff-nav a:hover,.aff-nav a.active{color:#FFC200}

/* ── Tag pill ─────────────────────────────────────────────────────────────── */
.aff-tag{display:inline-block;font-size:9px;font-weight:900;letter-spacing:1.5px;text-transform:uppercase;color:#fff;background:#111;padding:3px 8px;margin-bottom:8px}

/* ── Hero ─────────────────────────────────────────────────────────────────── */
.aff-hero{display:grid;grid-template-columns:1fr 340px;gap:28px;padding:28px 24px 0;max-width:1200px;margin:0 auto}
.aff-hero-main img{width:100%;aspect-ratio:16/9;object-fit:cover}
.aff-hero-main h2{font-size:26px;font-weight:900;line-height:1.2;margin:10px 0 8px}
.aff-hero-main h2 a:hover{color:#FFC200;transition:color .15s}
.aff-hero-main p{font-size:14px;color:#555;line-height:1.65}
.aff-hero-side{display:flex;flex-direction:column;border-top:1px solid #e8e8e8}
.aff-side-card{display:grid;grid-template-columns:110px 1fr;gap:12px;padding:12px 0;border-bottom:1px solid #e8e8e8;align-items:start}
.aff-side-card img{width:110px;height:70px;object-fit:cover}
.aff-side-card h4{font-size:13px;font-weight:700;line-height:1.35;color:#1a1a1a}
.aff-side-card h4 a:hover{color:#FFC200;transition:color .15s}

/* ── Section header ───────────────────────────────────────────────────────── */
.aff-section{max-width:1200px;margin:0 auto;padding:32px 24px 0}
.aff-section-hdr{display:flex;align-items:center;justify-content:space-between;margin-bottom:18px}
.aff-section-title{font-size:11px;font-weight:900;letter-spacing:2px;text-transform:uppercase;border-bottom:3px solid #FFC200;padding-bottom:6px;color:#111}
.aff-section-link{font-size:11px;font-weight:700;color:#666;transition:color .15s}
.aff-section-link:hover{color:#111}

/* ── Post grid ────────────────────────────────────────────────────────────── */
.aff-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:22px}
.aff-card img{width:100%;aspect-ratio:16/10;object-fit:cover;margin-bottom:10px}
.aff-card h3{font-size:14px;font-weight:700;line-height:1.35}
.aff-card h3 a:hover{color:#FFC200;transition:color .15s}
.aff-card p{font-size:12px;color:#666;margin-top:5px;line-height:1.6}

/* ── Divider ──────────────────────────────────────────────────────────────── */
.aff-divider{border:none;border-top:1px solid #e8e8e8;margin:32px 24px 0;max-width:1200px;display:block}

/* ── About bar ────────────────────────────────────────────────────────────── */
.aff-about{background:#111;margin-top:40px;padding:32px 24px}
.aff-about-inner{max-width:1200px;margin:0 auto;display:grid;grid-template-columns:auto 1fr auto;gap:24px;align-items:center}
.aff-about-img{width:80px;height:80px;border-radius:50%;object-fit:cover;border:3px solid #FFC200;flex-shrink:0;background:#222}
.aff-about-badge{font-size:9px;font-weight:900;letter-spacing:2px;text-transform:uppercase;background:#FFC200;color:#111;padding:3px 10px;display:inline-block;margin-bottom:8px}
.aff-about-body p{font-size:13px;line-height:1.7;color:#bbb}
.aff-about-body strong{color:#fff}
.aff-about-cta a{display:inline-block;background:#FFC200;color:#111;font-size:10px;font-weight:900;letter-spacing:1.5px;text-transform:uppercase;padding:11px 18px;transition:background .15s;white-space:nowrap}
.aff-about-cta a:hover{background:#fff}

/* ── Category grid ────────────────────────────────────────────────────────── */
.aff-cats{display:grid;grid-template-columns:repeat(auto-fill,minmax(100px,1fr));gap:10px}
.aff-cat-card{display:flex;flex-direction:column;align-items:center;gap:6px;padding:18px 8px;border:2px solid #e8e8e8;text-decoration:none;color:#111;transition:all .2s;border-radius:3px}
.aff-cat-card:hover{border-color:#FFC200;background:#111;color:#FFC200;transform:translateY(-2px)}
.aff-cat-icon{font-size:24px;line-height:1}
.aff-cat-name{font-size:9px;font-weight:900;letter-spacing:1.2px;text-transform:uppercase;text-align:center}

/* ── Footer ───────────────────────────────────────────────────────────────── */
.aff-footer{background:#111;color:#aaa;margin-top:48px;padding:36px 24px 24px}
.aff-footer-inner{max-width:1200px;margin:0 auto;display:grid;grid-template-columns:1fr 1fr 1fr;gap:32px;padding-bottom:24px;border-bottom:1px solid rgba(255,255,255,.1);margin-bottom:20px}
.aff-footer-brand-name{font-size:16px;font-weight:900;color:#fff;margin-bottom:6px}
.aff-footer-brand-name span{color:#FFC200}
.aff-footer-desc{font-size:12px;line-height:1.7}
.aff-footer-col h5{font-size:9px;font-weight:900;letter-spacing:2px;text-transform:uppercase;color:#fff;margin-bottom:14px}
.aff-footer-col a{display:block;font-size:13px;color:#888;margin-bottom:8px;transition:color .15s}
.aff-footer-col a:hover{color:#FFC200}
.aff-footer-bottom{max-width:1200px;margin:0 auto;display:flex;align-items:center;justify-content:space-between;font-size:11px;color:#555}
.aff-footer-bottom a{color:#555;transition:color .15s}
.aff-footer-bottom a:hover{color:#aaa}

/* ── Responsive ───────────────────────────────────────────────────────────── */
@media(max-width:768px){
  .aff-hero{grid-template-columns:1fr;padding:16px 16px 0}
  .aff-hero-side{display:none}
  .aff-hero-main h2{font-size:20px}
  .aff-grid{grid-template-columns:repeat(2,1fr);gap:14px}
  .aff-section{padding:24px 16px 0}
  .aff-about-inner{grid-template-columns:auto 1fr;gap:16px}
  .aff-about-img{width:60px;height:60px}
  .aff-about-cta{grid-column:1/-1}
  .aff-about-cta a{display:block;text-align:center}
  .aff-cats{grid-template-columns:repeat(3,1fr)}
  .aff-footer-inner{grid-template-columns:1fr}
  .aff-footer-bottom{flex-direction:column;gap:8px;align-items:flex-start}
  .aff-wrap,.aff-header,.aff-nav,.aff-about,.aff-footer{padding-left:16px;padding-right:16px}
}
@media(max-width:420px){
  .aff-grid{grid-template-columns:1fr}
  .aff-cats{grid-template-columns:repeat(2,1fr)}
}
</style>
</head>
<body <?php body_class(); ?>>
<?php wp_body_open(); ?>

<!-- ── Header ──────────────────────────────────────────────────────────────── -->
<header class="aff-header">
  <div class="aff-header-inner">
    <a href="<?php echo esc_url(home_url('/')); ?>" class="aff-logo">
      <?php echo esc_html($brand_name); ?>
    </a>
  </div>
</header>

<!-- ── Nav ─────────────────────────────────────────────────────────────────── -->
<nav class="aff-nav">
  <div class="aff-nav-inner">
    <a href="<?php echo esc_url(home_url('/')); ?>" class="active">All Reviews</a>
    <?php foreach ($categories as $cat) : ?>
      <a href="<?php echo esc_url(get_category_link($cat->term_id)); ?>">
        <?php echo esc_html($cat->name); ?>
      </a>
    <?php endforeach; ?>
  </div>
</nav>

<!-- ── Hero ────────────────────────────────────────────────────────────────── -->
<?php if ($hero) :
  $hero_img = get_the_post_thumbnail_url($hero->ID, 'large');
  $hero_cat = aff_cat_label($hero->ID);
?>
<div class="aff-hero">
  <div class="aff-hero-main">
    <?php if ($hero_img) : ?>
      <a href="<?php echo esc_url(get_permalink($hero->ID)); ?>">
        <img src="<?php echo esc_url($hero_img); ?>" alt="<?php echo esc_attr($hero->post_title); ?>" loading="eager">
      </a>
    <?php endif; ?>
    <?php if ($hero_cat) : ?>
      <span class="aff-tag"><?php echo $hero_cat; ?></span>
    <?php endif; ?>
    <h2><a href="<?php echo esc_url(get_permalink($hero->ID)); ?>"><?php echo esc_html($hero->post_title); ?></a></h2>
    <p><?php echo aff_excerpt($hero->ID, 22); ?></p>
  </div>

  <div class="aff-hero-side">
    <?php foreach ($sidebar as $post) :
      $img = get_the_post_thumbnail_url($post->ID, 'medium');
      $cat = aff_cat_label($post->ID);
    ?>
      <div class="aff-side-card">
        <?php if ($img) : ?>
          <a href="<?php echo esc_url(get_permalink($post->ID)); ?>">
            <img src="<?php echo esc_url($img); ?>" alt="<?php echo esc_attr($post->post_title); ?>" loading="lazy">
          </a>
        <?php endif; ?>
        <div>
          <?php if ($cat) : ?>
            <span class="aff-tag"><?php echo $cat; ?></span>
          <?php endif; ?>
          <h4><a href="<?php echo esc_url(get_permalink($post->ID)); ?>"><?php echo esc_html($post->post_title); ?></a></h4>
        </div>
      </div>
    <?php endforeach; ?>
  </div>
</div>
<?php endif; ?>

<!-- ── Latest Reviews ───────────────────────────────────────────────────────── -->
<?php if (!empty($latest)) : ?>
<div class="aff-section">
  <div class="aff-section-hdr">
    <span class="aff-section-title">Latest Reviews</span>
    <a href="<?php echo esc_url(home_url('/')); ?>" class="aff-section-link">All reviews →</a>
  </div>
  <div class="aff-grid">
    <?php foreach ($latest as $post) :
      $img = get_the_post_thumbnail_url($post->ID, 'medium_large');
      $cat = aff_cat_label($post->ID);
    ?>
      <div class="aff-card">
        <?php if ($img) : ?>
          <a href="<?php echo esc_url(get_permalink($post->ID)); ?>">
            <img src="<?php echo esc_url($img); ?>" alt="<?php echo esc_attr($post->post_title); ?>" loading="lazy">
          </a>
        <?php endif; ?>
        <?php if ($cat) : ?><span class="aff-tag"><?php echo $cat; ?></span><?php endif; ?>
        <h3><a href="<?php echo esc_url(get_permalink($post->ID)); ?>"><?php echo esc_html($post->post_title); ?></a></h3>
        <p><?php echo aff_excerpt($post->ID, 16); ?></p>
      </div>
    <?php endforeach; ?>
  </div>
</div>
<?php endif; ?>

<!-- ── More Reviews ─────────────────────────────────────────────────────────── -->
<?php if (!empty($more)) : ?>
<div class="aff-section">
  <div class="aff-section-hdr">
    <span class="aff-section-title">More Reviews</span>
    <a href="<?php echo esc_url(home_url('/')); ?>" class="aff-section-link">View all →</a>
  </div>
  <div class="aff-grid">
    <?php foreach ($more as $post) :
      $img = get_the_post_thumbnail_url($post->ID, 'medium_large');
      $cat = aff_cat_label($post->ID);
    ?>
      <div class="aff-card">
        <?php if ($img) : ?>
          <a href="<?php echo esc_url(get_permalink($post->ID)); ?>">
            <img src="<?php echo esc_url($img); ?>" alt="<?php echo esc_attr($post->post_title); ?>" loading="lazy">
          </a>
        <?php endif; ?>
        <?php if ($cat) : ?><span class="aff-tag"><?php echo $cat; ?></span><?php endif; ?>
        <h3><a href="<?php echo esc_url(get_permalink($post->ID)); ?>"><?php echo esc_html($post->post_title); ?></a></h3>
        <p><?php echo aff_excerpt($post->ID, 16); ?></p>
      </div>
    <?php endforeach; ?>
  </div>
</div>
<?php endif; ?>

<!-- ── About bar ────────────────────────────────────────────────────────────── -->
<div class="aff-about">
  <div class="aff-about-inner">
    <?php if ($author_img) : ?>
      <img class="aff-about-img" src="<?php echo esc_url($author_img); ?>" alt="<?php echo esc_attr($author_name); ?>">
    <?php else : ?>
      <div class="aff-about-img" style="display:flex;align-items:center;justify-content:center;font-size:28px;">🙋</div>
    <?php endif; ?>

    <div class="aff-about-body">
      <span class="aff-about-badge">About Us</span>
      <p><?php echo esc_html($about_text ?: $brand_desc); ?></p>
    </div>

    <div class="aff-about-cta">
      <a href="<?php echo esc_url(home_url('/contact')); ?>">Work With Us →</a>
    </div>
  </div>
</div>

<!-- ── Browse by Category ────────────────────────────────────────────────────── -->
<?php if (!empty($categories)) : ?>
<div class="aff-section">
  <div class="aff-section-hdr">
    <span class="aff-section-title">Browse by Category</span>
    <a href="<?php echo esc_url(home_url('/')); ?>" class="aff-section-link">All reviews →</a>
  </div>
  <div class="aff-cats">
    <?php foreach ($categories as $cat) : ?>
      <a class="aff-cat-card" href="<?php echo esc_url(get_category_link($cat->term_id)); ?>">
        <span class="aff-cat-icon"><?php echo aff_icon($cat->name, $cat_icons); ?></span>
        <span class="aff-cat-name"><?php echo esc_html($cat->name); ?></span>
      </a>
    <?php endforeach; ?>
  </div>
</div>
<?php endif; ?>

<!-- ── Footer ───────────────────────────────────────────────────────────────── -->
<footer class="aff-footer">
  <div class="aff-footer-inner">
    <div>
      <div class="aff-footer-brand-name"><?php echo esc_html($brand_name); ?></div>
      <p class="aff-footer-desc"><?php echo esc_html($brand_desc ?: 'Real reviews. Smarter choices.'); ?></p>
    </div>
    <div class="aff-footer-col">
      <h5>Explore</h5>
      <?php foreach (array_slice($categories, 0, 6) as $cat) : ?>
        <a href="<?php echo esc_url(get_category_link($cat->term_id)); ?>"><?php echo esc_html($cat->name); ?></a>
      <?php endforeach; ?>
    </div>
    <div class="aff-footer-col">
      <h5>Links</h5>
      <?php wp_nav_menu(['theme_location' => 'footer', 'container' => false, 'items_wrap' => '%3$s', 'walker' => new class extends Walker_Nav_Menu {
          function start_el(&$output, $data_object, $depth = 0, $args = null, $current_object_id = 0) {
              $output .= '<a href="' . esc_url($data_object->url) . '">' . esc_html($data_object->title) . '</a>';
          }
      }]); ?>
    </div>
  </div>
  <div class="aff-footer-bottom">
    <span class="aff-footer-copy">© <?php echo date('Y'); ?> <?php echo esc_html($brand_name); ?> · <?php _e('All rights reserved', 'kadence-affiliate-child'); ?></span>
    <span>As an Amazon Associate we earn from qualifying purchases.</span>
  </div>
</footer>

<?php wp_footer(); ?>
</body>
</html>

<?php if (!defined('ABSPATH')) exit;
get_header();

// ─── Build a pool of all published posts so each section can exclude
//     the IDs that have already been rendered above. ───────────────────────
$all_post_ids = get_posts([
    'numberposts' => -1,
    'post_type'   => 'post',
    'post_status' => 'publish',
    'fields'      => 'ids',
    'orderby'     => 'date',
    'order'       => 'DESC',
]);
$used_ids = [];
?>

<main class="mvp-main mvp-frontpage">

  <?php /* ─── BIG EDITORIAL HERO — most recent post ─────────────────── */ ?>
  <?php
  $hero_ids = array_diff($all_post_ids, $used_ids);
  $hero_id  = !empty($hero_ids) ? reset($hero_ids) : null;
  if ($hero_id):
      $used_ids[] = $hero_id;
      $hero_post = get_post($hero_id);
      setup_postdata($GLOBALS['post'] = $hero_post);
  ?>
  <section class="mvp-lead">
    <div class="mvp-container">
      <a href="<?php echo esc_url(get_permalink($hero_id)); ?>" class="mvp-lead-link">
        <?php if (has_post_thumbnail($hero_id)): ?>
        <div class="mvp-lead-image">
          <?php echo get_the_post_thumbnail($hero_id, 'mvp-card-large', ['loading' => 'eager', 'fetchpriority' => 'high']); ?>
        </div>
        <?php endif; ?>
        <div class="mvp-lead-body">
          <p class="mvp-lead-eyebrow">
            <span class="mvp-lead-pick">Editor&rsquo;s Pick</span>
            <?php
            $hero_cats = get_the_category($hero_id);
            if (!empty($hero_cats)) {
                echo ' · <span class="mvp-lead-cat">' . esc_html($hero_cats[0]->name) . '</span>';
            }
            ?>
          </p>
          <h2 class="mvp-lead-title"><?php echo esc_html(get_the_title($hero_id)); ?></h2>
          <?php $excerpt = wp_trim_words(get_the_excerpt($hero_id), 36); if ($excerpt): ?>
          <p class="mvp-lead-dek"><?php echo esc_html($excerpt); ?></p>
          <?php endif; ?>
          <p class="mvp-lead-byline">
            By <strong><?php echo esc_html(get_the_author_meta('display_name', $hero_post->post_author)); ?></strong>
            <span class="mvp-lead-dot">·</span>
            <span class="mvp-lead-updated">Updated <?php echo esc_html(get_the_modified_date('M j, Y', $hero_id)); ?></span>
          </p>
          <span class="mvp-lead-cta">Read the review →</span>
        </div>
      </a>
    </div>
  </section>
  <?php wp_reset_postdata(); endif; ?>

  <?php /* ─── EDITOR'S PICKS STRIP — next 4 posts ───────────────────── */ ?>
  <?php
  $picks_ids = array_slice(array_values(array_diff($all_post_ids, $used_ids)), 0, 4);
  if (!empty($picks_ids)):
      $used_ids = array_merge($used_ids, $picks_ids);
  ?>
  <section class="mvp-section mvp-section-picks">
    <div class="mvp-container">
      <header class="mvp-section-header">
        <h2 class="mvp-section-title">Editor&rsquo;s Picks</h2>
        <a href="<?php echo esc_url(home_url('/?s=&post_type=post')); ?>" class="mvp-section-link">All reviews →</a>
      </header>
      <div class="mvp-grid mvp-grid-4">
        <?php foreach ($picks_ids as $pid): $post = get_post($pid); setup_postdata($post); ?>
        <article class="mvp-card">
          <a href="<?php the_permalink(); ?>" class="mvp-card-link">
            <?php if (has_post_thumbnail()): ?>
            <div class="mvp-card-image"><?php the_post_thumbnail('mvp-card', ['loading' => 'lazy']); ?></div>
            <?php endif; ?>
            <div class="mvp-card-body">
              <?php echo mvp_affiliate_category_badge(); ?>
              <h3 class="mvp-card-title"><?php the_title(); ?></h3>
              <div class="mvp-card-meta"><?php mvp_affiliate_posted_meta(); ?></div>
            </div>
          </a>
        </article>
        <?php endforeach; wp_reset_postdata(); ?>
      </div>
    </div>
  </section>
  <?php endif; ?>

  <?php /* ─── PICK OF THE DAY ─────────────────────────────────────────
       Renders only if the user has enabled Pick of the Day AND ticked
       "Show on homepage" in Customize Blog. Tracks the picked post in
       $used_ids so it never duplicates in category sections below.    */ ?>
  <?php
  $pick_config = function_exists('mvp_affiliate_pick_of_day_config')
      ? mvp_affiliate_pick_of_day_config()
      : [];
  if (!empty($pick_config['enabled']) && !empty($pick_config['showOnHomepage'])):
      $pick_post = function_exists('mvp_affiliate_pick_of_day')
          ? mvp_affiliate_pick_of_day()
          : null;
      if ($pick_post):
          $used_ids[] = $pick_post->ID;
          $pick_html = mvp_affiliate_render_pick_of_day('homepage');
          if ($pick_html):
  ?>
  <section class="mvp-section mvp-section-pick">
    <div class="mvp-container">
      <?php echo $pick_html; ?>
    </div>
  </section>
  <?php
          endif;
      endif;
  endif;
  ?>

  <?php /* ─── HOMEPAGE 3-UP AD STRIP ────────────────────────────────────
       Three banner slots managed in Customize Blog → Homepage Banner
       Strip. Empty slots render a "Your ad here" placeholder with the
       same 16:9 shape so the layout stays consistent. */ ?>
  <?php $homepage_ads = function_exists('mvp_affiliate_homepage_ads')
      ? mvp_affiliate_homepage_ads()
      : []; ?>
  <section class="mvp-section mvp-ad-strip">
    <div class="mvp-container">
      <div class="mvp-grid mvp-grid-3">
        <?php foreach ($homepage_ads as $ad):
            $img  = $ad['imageUrl'] ?? '';
            $href = $ad['linkUrl']  ?? '';
        ?>
        <?php if ($img): ?>
          <?php if ($href): ?><a href="<?php echo esc_url($href); ?>" target="_blank" rel="noopener sponsored" class="mvp-ad-slot mvp-ad-slot-filled"><?php endif; ?>
          <?php if (!$href): ?><div class="mvp-ad-slot mvp-ad-slot-filled"><?php endif; ?>
            <img src="<?php echo esc_url($img); ?>" alt="" loading="lazy" />
          <?php if ($href): ?></a><?php else: ?></div><?php endif; ?>
        <?php else: ?>
          <div class="mvp-ad-slot mvp-ad-slot-empty">
            <span class="mvp-ad-slot-label">Your ad here</span>
          </div>
        <?php endif; ?>
        <?php endforeach; ?>
      </div>
    </div>
  </section>

  <?php /* ─── BY CATEGORY — for each category w/ ≥1 unused post, show 3 ─ */ ?>
  <?php
  $categories = get_categories([
      'orderby' => 'count',
      'order'   => 'DESC',
      'hide_empty' => true,
  ]);
  // Skip the default "Uncategorized" category if it sneaks in
  $categories = array_filter($categories, fn($c) => $c->slug !== 'uncategorized');

  foreach ($categories as $cat):
      // Pick up to 3 posts in this category that haven't already been rendered.
      $cat_posts = get_posts([
          'numberposts' => 3,
          'post_type'   => 'post',
          'post_status' => 'publish',
          'category'    => $cat->term_id,
          'exclude'     => $used_ids,
      ]);
      // Require at least 3 unused posts in a category — otherwise the
      // 3-column grid renders with 1 or 2 awkward gaps. Those posts roll
      // into "Recently Published" at the bottom instead.
      if (count($cat_posts) < 3) continue;
      foreach ($cat_posts as $p) $used_ids[] = $p->ID;
  ?>
  <section class="mvp-section mvp-section-cat">
    <div class="mvp-container">
      <header class="mvp-section-header">
        <h2 class="mvp-section-title"><?php echo esc_html($cat->name); ?></h2>
        <a href="<?php echo esc_url(get_category_link($cat->term_id)); ?>" class="mvp-section-link">All in <?php echo esc_html($cat->name); ?> →</a>
      </header>
      <div class="mvp-grid mvp-grid-3">
        <?php foreach ($cat_posts as $p): setup_postdata($GLOBALS['post'] = $p); ?>
        <article class="mvp-card">
          <a href="<?php echo esc_url(get_permalink($p)); ?>" class="mvp-card-link">
            <?php if (has_post_thumbnail($p)): ?>
            <div class="mvp-card-image"><?php echo get_the_post_thumbnail($p, 'mvp-card', ['loading' => 'lazy']); ?></div>
            <?php endif; ?>
            <div class="mvp-card-body">
              <?php echo mvp_affiliate_category_badge(); ?>
              <h3 class="mvp-card-title"><?php echo esc_html(get_the_title($p)); ?></h3>
              <div class="mvp-card-meta"><?php mvp_affiliate_posted_meta(); ?></div>
            </div>
          </a>
        </article>
        <?php endforeach; wp_reset_postdata(); ?>
      </div>
    </div>
  </section>
  <?php endforeach; ?>

  <?php /* ─── RECENTLY PUBLISHED — vertical list of remaining posts ─── */ ?>
  <?php
  $remaining_ids = array_slice(array_values(array_diff($all_post_ids, $used_ids)), 0, 10);
  if (!empty($remaining_ids)):
  ?>
  <section class="mvp-section mvp-section-recent">
    <div class="mvp-container">
      <header class="mvp-section-header">
        <h2 class="mvp-section-title">Recently Published</h2>
        <a href="<?php echo esc_url(home_url('/?s=&post_type=post')); ?>" class="mvp-section-link">View archive →</a>
      </header>
      <ul class="mvp-recent-list">
        <?php foreach ($remaining_ids as $pid): $p = get_post($pid); ?>
        <li class="mvp-recent-item">
          <a href="<?php echo esc_url(get_permalink($p)); ?>" class="mvp-recent-link">
            <time class="mvp-recent-date" datetime="<?php echo esc_attr(get_the_date('c', $p)); ?>">
              <?php echo esc_html(get_the_date('M j', $p)); ?>
            </time>
            <span class="mvp-recent-title"><?php echo esc_html(get_the_title($p)); ?></span>
            <?php $rc = get_the_category($p->ID); if (!empty($rc)): ?>
            <span class="mvp-recent-cat"><?php echo esc_html($rc[0]->name); ?></span>
            <?php endif; ?>
          </a>
        </li>
        <?php endforeach; ?>
      </ul>
    </div>
  </section>
  <?php endif; ?>

</main>

<?php get_footer();

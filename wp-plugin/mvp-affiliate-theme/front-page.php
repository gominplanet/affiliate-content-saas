<?php if (!defined('ABSPATH')) exit;
get_header();

$brand   = get_bloginfo('name');
$tagline = get_bloginfo('description');
?>

<main class="mvp-main">

  <!-- Hero -->
  <section class="mvp-hero">
    <div class="mvp-container">
      <h1 class="mvp-hero-title"><?php echo esc_html($brand); ?></h1>
      <?php if ($tagline): ?>
      <p class="mvp-hero-tagline"><?php echo esc_html($tagline); ?></p>
      <?php endif; ?>
    </div>
  </section>

  <!-- Featured: 8 equal-sized cards (4-col on desktop, responsive down). -->
  <?php
  $featured = new WP_Query([
      'post_type'           => 'post',
      'post_status'         => 'publish',
      'posts_per_page'      => 8,
      'ignore_sticky_posts' => 1,
  ]);
  if ($featured->have_posts()):
  ?>
  <section class="mvp-section mvp-section-featured">
    <div class="mvp-container">
      <div class="mvp-grid mvp-grid-4">
        <?php while ($featured->have_posts()): $featured->the_post(); ?>
        <article class="mvp-card">
          <a href="<?php the_permalink(); ?>" class="mvp-card-link">
            <?php if (has_post_thumbnail()): ?>
            <div class="mvp-card-image">
              <?php the_post_thumbnail('mvp-card', ['loading' => 'lazy']); ?>
            </div>
            <?php endif; ?>
            <div class="mvp-card-body">
              <?php echo mvp_affiliate_category_badge(); ?>
              <h2 class="mvp-card-title"><?php the_title(); ?></h2>
              <div class="mvp-card-meta">
                <?php mvp_affiliate_posted_meta(); ?>
              </div>
            </div>
          </a>
        </article>
        <?php endwhile; wp_reset_postdata(); ?>
      </div>
    </div>
  </section>
  <?php endif; ?>

  <!-- Pick of the Day (homepage section) -->
  <?php $pick_html = mvp_affiliate_render_pick_of_day('homepage'); ?>
  <?php if ($pick_html): ?>
  <section class="mvp-section mvp-section-pick">
    <div class="mvp-container">
      <?php echo $pick_html; ?>
    </div>
  </section>
  <?php endif; ?>

  <!-- Latest reviews grid (more posts, excluding the 8 in the featured grid) -->
  <?php
  $more_q = new WP_Query([
      'post_type'           => 'post',
      'post_status'         => 'publish',
      'posts_per_page'      => 9,
      'offset'              => 8,
      'ignore_sticky_posts' => 1,
  ]);
  if ($more_q->have_posts()):
  ?>
  <section class="mvp-section">
    <div class="mvp-container">
      <header class="mvp-section-header">
        <h2 class="mvp-section-title">Latest Reviews</h2>
        <a href="<?php echo esc_url(home_url('/?s=&post_type=post')); ?>" class="mvp-section-link">All reviews →</a>
      </header>
      <div class="mvp-grid mvp-grid-3">
        <?php while ($more_q->have_posts()): $more_q->the_post(); ?>
        <article class="mvp-card">
          <a href="<?php the_permalink(); ?>" class="mvp-card-link">
            <?php if (has_post_thumbnail()): ?>
            <div class="mvp-card-image">
              <?php the_post_thumbnail('mvp-card', ['loading' => 'lazy']); ?>
            </div>
            <?php endif; ?>
            <div class="mvp-card-body">
              <?php echo mvp_affiliate_category_badge(); ?>
              <h3 class="mvp-card-title"><?php the_title(); ?></h3>
              <div class="mvp-card-meta">
                <?php mvp_affiliate_posted_meta(); ?>
              </div>
            </div>
          </a>
        </article>
        <?php endwhile; wp_reset_postdata(); ?>
      </div>
    </div>
  </section>
  <?php endif; ?>

  <!-- Featured Categories: top 3 categories with their latest posts -->
  <?php
  $top_cats = get_categories(['number' => 3, 'orderby' => 'count', 'order' => 'DESC']);
  if (!empty($top_cats)):
  ?>
  <section class="mvp-section mvp-section-categories">
    <div class="mvp-container">
      <header class="mvp-section-header">
        <h2 class="mvp-section-title">Browse by Category</h2>
      </header>
      <div class="mvp-grid mvp-grid-3">
        <?php foreach ($top_cats as $cat): ?>
        <a href="<?php echo esc_url(get_category_link($cat->term_id)); ?>" class="mvp-category-card">
          <h3 class="mvp-category-card-title"><?php echo esc_html($cat->name); ?></h3>
          <p class="mvp-category-card-count"><?php echo intval($cat->count); ?> review<?php echo $cat->count === 1 ? '' : 's'; ?> →</p>
        </a>
        <?php endforeach; ?>
      </div>
    </div>
  </section>
  <?php endif; ?>

</main>

<?php get_footer();

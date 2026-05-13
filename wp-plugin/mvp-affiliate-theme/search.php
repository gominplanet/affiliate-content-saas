<?php if (!defined('ABSPATH')) exit;
get_header();
?>
<main class="mvp-main mvp-archive">
  <div class="mvp-container">
    <header class="mvp-archive-header">
      <p class="mvp-archive-eyebrow">Search results</p>
      <h1 class="mvp-archive-title"><?php printf('"%s"', esc_html(get_search_query())); ?></h1>
    </header>

    <?php if (have_posts()): ?>
    <div class="mvp-grid mvp-grid-3">
      <?php while (have_posts()): the_post(); ?>
      <article class="mvp-card">
        <a href="<?php the_permalink(); ?>" class="mvp-card-link">
          <?php if (has_post_thumbnail()): ?>
          <div class="mvp-card-image"><?php the_post_thumbnail('mvp-card', ['loading' => 'lazy']); ?></div>
          <?php endif; ?>
          <div class="mvp-card-body">
            <?php echo mvp_affiliate_category_badge(); ?>
            <h2 class="mvp-card-title"><?php the_title(); ?></h2>
            <p class="mvp-card-excerpt"><?php echo esc_html(wp_trim_words(get_the_excerpt(), 22)); ?></p>
          </div>
        </a>
      </article>
      <?php endwhile; ?>
    </div>
    <nav class="mvp-pagination"><?php the_posts_pagination(['prev_text' => '← Previous', 'next_text' => 'Next →']); ?></nav>
    <?php else: ?>
    <p class="mvp-empty">No results for "<?php echo esc_html(get_search_query()); ?>". Try a different search.</p>
    <div class="mvp-search-again"><?php get_search_form(); ?></div>
    <?php endif; ?>
  </div>
</main>
<?php get_footer();

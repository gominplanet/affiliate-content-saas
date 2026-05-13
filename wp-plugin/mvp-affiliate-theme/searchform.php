<?php if (!defined('ABSPATH')) exit; ?>
<form role="search" method="get" class="mvp-searchform" action="<?php echo esc_url(home_url('/')); ?>">
  <label for="mvp-s" class="screen-reader-text">Search</label>
  <input type="search" id="mvp-s" name="s" placeholder="Search reviews…" value="<?php echo esc_attr(get_search_query()); ?>" autocomplete="off" />
  <button type="submit" class="mvp-searchform-submit" aria-label="Search">
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m21 21-3.5-3.5"/></svg>
  </button>
</form>

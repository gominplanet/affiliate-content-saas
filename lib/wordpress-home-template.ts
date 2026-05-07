export interface HomePageOptions {
  brandName: string
  accentColor: string
  categories: { name: string; slug: string }[]
  siteUrl: string
}

function escHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export function generateHomePage(opts: HomePageOptions): { title: string; content: string } {
  const { brandName, accentColor, categories, siteUrl } = opts
  const base = siteUrl.replace(/\/$/, '')

  const tabLinks = [
    `<a href="${base}/" class="gr-tab gr-tab-all">All Reviews</a>`,
    ...categories.map(c => `<a href="${base}/category/${c.slug}/" class="gr-tab">${escHtml(c.name)}</a>`),
  ].join('')

  const css = [
    `.gr-tabs{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:28px;padding-bottom:14px;border-bottom:2px solid #f0f0f0}`,
    `.gr-tab{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#86868b;text-decoration:none;padding:6px 14px;border-radius:100px;transition:all .15s}`,
    `.gr-tab:hover,.gr-tab-all{background:${accentColor};color:#fff}`,
    `.gr-hero{display:grid;grid-template-columns:1fr 300px;gap:24px;margin-bottom:40px}`,
    `.gr-hero-main a img{width:100%;aspect-ratio:16/9;object-fit:cover;border-radius:12px;display:block}`,
    `.gr-hero-main h2{font-size:22px;font-weight:700;line-height:1.3;margin:8px 0 0}`,
    `.gr-hero-main h2 a,.gr-side-card h3 a,.gr-card h3 a{color:#1d1d1f;text-decoration:none}`,
    `.gr-hero-main h2 a:hover,.gr-side-card h3 a:hover,.gr-card h3 a:hover{color:${accentColor}}`,
    `.gr-excerpt{font-size:13px;color:#6e6e73;line-height:1.5;margin:8px 0 0}`,
    `.gr-hero-side{display:flex;flex-direction:column;gap:12px}`,
    `.gr-side-card{display:flex;gap:10px;align-items:flex-start}`,
    `.gr-side-card img{width:120px;height:68px;object-fit:cover;border-radius:8px;flex-shrink:0;display:block}`,
    `.gr-side-card h3{font-size:13px;font-weight:600;line-height:1.3;margin:0}`,
    `.gr-section-title{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#86868b;margin:0 0 16px}`,
    `.gr-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:20px}`,
    `.gr-card img{width:100%;aspect-ratio:16/9;object-fit:cover;border-radius:10px;display:block}`,
    `.gr-card h3{font-size:14px;font-weight:600;line-height:1.3;margin:0}`,
    `.gr-tag{display:inline-block;background:#1d1d1f;color:#fff;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;padding:3px 8px;border-radius:4px;margin:10px 0 5px;text-decoration:none}`,
    `@media(max-width:768px){.gr-hero{grid-template-columns:1fr}.gr-grid{grid-template-columns:repeat(2,1fr)}}`,
    `@media(max-width:480px){.gr-grid{grid-template-columns:1fr}}`,
  ].join('')

  const js = `(function(){
  fetch('/wp-json/wp/v2/posts?per_page=10&orderby=date&order=desc&_embed=wp:featuredmedia,wp:term')
    .then(function(r){return r.json()})
    .then(function(posts){
      var el=document.getElementById('gr-home');
      if(!el||!posts||!posts.length)return;
      function thumb(p){
        var html=(p.content&&p.content.rendered)||'';
        var key='youtube.com/embed/';
        var i=html.indexOf(key);
        if(i>-1){var s=i+key.length,e=html.indexOf('"',s);if(e>-1)return'https://img.youtube.com/vi/'+html.slice(s,e)+'/maxresdefault.jpg';}
        var fm=p._embedded&&p._embedded['wp:featuredmedia']&&p._embedded['wp:featuredmedia'][0];
        return(fm&&fm.source_url)||'';
      }
      function label(p){
        var terms=p._embedded&&p._embedded['wp:term']||[];
        var cats=terms[0]?terms[0].filter(function(t){return t.taxonomy==='category'&&t.slug!=='uncategorized'}):[];
        return cats.length?cats[0].name:(terms[1]&&terms[1][0]?terms[1][0].name:'');
      }
      function tag(l){return l?'<span class="gr-tag">'+l+'</span>':'';}
      function img(t,href){return t?'<a href="'+href+'"><img src="'+t+'" alt="" loading="lazy"></a>':'';}
      var html='';
      if(posts.length>=5){
        var h=posts[0],ht=thumb(h),hl=label(h);
        var exc=h.excerpt&&h.excerpt.rendered?h.excerpt.rendered.replace(/<[^>]+>/g,'').slice(0,160):'';
        html+='<div class="gr-hero"><div class="gr-hero-main">'+img(ht,h.link)+tag(hl)+'<h2><a href="'+h.link+'">'+h.title.rendered+'</a></h2>'+(exc?'<p class="gr-excerpt">'+exc+'</p>':'')+'</div><div class="gr-hero-side">';
        posts.slice(1,5).forEach(function(p){var t=thumb(p),l=label(p);html+='<div class="gr-side-card">'+img(t,p.link)+'<div>'+tag(l)+'<h3><a href="'+p.link+'">'+p.title.rendered+'</a></h3></div></div>';});
        html+='</div></div>';
      }
      var grid=posts.length>=5?posts.slice(5):posts;
      if(grid.length){
        html+='<p class="gr-section-title">LATEST REVIEWS</p><div class="gr-grid">';
        grid.forEach(function(p){var t=thumb(p),l=label(p);html+='<div class="gr-card">'+img(t,p.link)+tag(l)+'<h3><a href="'+p.link+'">'+p.title.rendered+'</a></h3></div>';});
        html+='</div>';
      }
      el.innerHTML=html;
    }).catch(function(){});
})();`

  const content = `<!-- wp:html -->
<style>${css}</style>
<div class="gr-tabs">${tabLinks}</div>
<div id="gr-home"></div>
<script>${js}</script>
<!-- /wp:html -->`

  return { title: brandName, content }
}

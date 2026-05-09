export interface HomePageOptions {
  brandName: string
  accentColor: string
  categories: { name: string; slug: string }[]
  siteUrl: string
  tagline?: string
  youtubeUrl?: string
  instagramUrl?: string
  tiktokUrl?: string
  twitterUrl?: string
  pinterestUrl?: string
  facebookUrl?: string
  contactEmail?: string
  affiliateDisclaimer?: string
}

export function generateHomePage(opts: HomePageOptions): { title: string; content: string } {
  const { brandName, accentColor, siteUrl, tagline, affiliateDisclaimer } = opts
  const base = siteUrl.replace(/\/$/, '')
  const ac = accentColor || '#af52de'

  const css = [
    `.gr-tabs{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:28px;padding-bottom:14px;border-bottom:2px solid #f0f0f0}`,
    `.gr-tab{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#86868b;text-decoration:none;padding:6px 14px;border-radius:100px;transition:all .15s}`,
    `.gr-tab:hover,.gr-tab-all{background:${ac};color:#fff}`,
    `.gr-hero{display:grid;grid-template-columns:1fr 300px;gap:24px;margin-bottom:40px}`,
    `.gr-hero-main a img{width:100%;aspect-ratio:16/9;object-fit:cover;border-radius:12px;display:block}`,
    `.gr-hero-main h2{font-size:22px;font-weight:700;line-height:1.3;margin:8px 0 0}`,
    `.gr-hero-main h2 a,.gr-side-card h3 a,.gr-card h3 a{color:#1d1d1f;text-decoration:none}`,
    `.gr-hero-main h2 a:hover,.gr-side-card h3 a:hover,.gr-card h3 a:hover{color:${ac}}`,
    `.gr-excerpt{font-size:13px;color:#6e6e73;line-height:1.5;margin:8px 0 0}`,
    `.gr-hero-side{display:grid;grid-template-columns:1fr 1fr;gap:10px}`,
    `.gr-side-card{display:flex;flex-direction:column;gap:6px}`,
    `.gr-side-card img{width:100%;aspect-ratio:16/9;object-fit:cover;border-radius:8px;display:block}`,
    `.gr-side-card h3{font-size:12px;font-weight:600;line-height:1.3;margin:0}`,
    `.gr-section-title{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#86868b;margin:0 0 16px}`,
    `.gr-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:20px}`,
    `.gr-card img{width:100%;aspect-ratio:16/9;object-fit:cover;border-radius:10px;display:block}`,
    `.gr-card h3{font-size:14px;font-weight:600;line-height:1.3;margin:0}`,
    `.gr-tag{display:inline-block;background:#1d1d1f;color:#fff;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;padding:3px 8px;border-radius:4px;margin:10px 0 5px;text-decoration:none}`,
    `@media(max-width:768px){.gr-hero{grid-template-columns:1fr}.gr-grid{grid-template-columns:repeat(2,1fr)}.gr-hero-side{grid-template-columns:1fr}}`,
    `@media(max-width:480px){.gr-grid{grid-template-columns:1fr}}`,
    `.gr-footer{margin-top:48px;padding-top:24px;border-top:1px solid #e8e8ed;display:flex;flex-direction:column;gap:12px;align-items:center;text-align:center}`,
    `.gr-footer-socials{display:flex;flex-wrap:wrap;gap:8px;justify-content:center}`,
    `.gr-footer-social{font-size:12px;font-weight:600;color:${ac};text-decoration:none;padding:5px 12px;border:1.5px solid ${ac}33;border-radius:100px;transition:all .15s}`,
    `.gr-footer-social:hover{background:${ac};color:#fff}`,
    `.gr-footer-copy{font-size:12px;color:#aeaeb2;margin:0}`,
    `.gr-footer-disclaimer{font-size:11px;color:#c7c7cc;line-height:1.5;max-width:600px;margin:0}`,
  ].join('')

  const disclaimer = affiliateDisclaimer
    || `${brandName} uses affiliate links. When you buy through our links, we may earn a commission at no extra cost to you.`
  const year = new Date().getFullYear()

  // All content is fetched dynamically: categories, posts, and social links.
  // This means the page stays up-to-date without needing to re-run setup.
  const js = `(function(){
var BASE='${base}';
Promise.all([
fetch(BASE+'/wp-json/wp/v2/categories?per_page=20&exclude=1&orderby=count&order=desc&_fields=id,name,slug,link').then(function(r){return r.json()}).catch(function(){return[];}),
fetch(BASE+'/wp-json/wp/v2/posts?per_page=23&orderby=date&order=desc&_embed=wp:featuredmedia,wp:term').then(function(r){return r.json()}).catch(function(){return[];}),
fetch(BASE+'/wp-json/affiliateos/v1/customizations').then(function(r){return r.json()}).catch(function(){return{};})
]).then(function(res){
var cats=res[0],posts=res[1],cust=res[2];
var tabsEl=document.getElementById('gr-tabs-wrap');
if(tabsEl){var th='<div class="gr-tabs"><a href="'+BASE+'/" class="gr-tab gr-tab-all">All Reviews</a>';(cats||[]).forEach(function(c){if(c.slug!=='uncategorized')th+='<a href="'+c.link+'" class="gr-tab">'+c.name+'</a>';});th+='</div>';tabsEl.innerHTML=th;}
var el=document.getElementById('gr-home');
if(el&&posts&&posts.length){
function thumb(p){var h=(p.content&&p.content.rendered)||'';var k='youtube.com/embed/';var i=h.indexOf(k);if(i>-1){var s=i+k.length,e=h.indexOf('"',s);if(e>-1)return'https://img.youtube.com/vi/'+h.slice(s,e)+'/maxresdefault.jpg';}var fm=p._embedded&&p._embedded['wp:featuredmedia']&&p._embedded['wp:featuredmedia'][0];return(fm&&fm.source_url)||'';}
function lbl(p){var t=p._embedded&&p._embedded['wp:term']||[];var c=t[0]?t[0].filter(function(x){return x.taxonomy==='category'&&x.slug!=='uncategorized'}):[];return c.length?c[0].name:(t[1]&&t[1][0]?t[1][0].name:'');}
function tag(l){return l?'<span class="gr-tag">'+l+'</span>':'';}
function img(t,href){return t?'<a href="'+href+'"><img src="'+t+'" alt="" loading="lazy"></a>':'';}
var html='';
if(posts.length>=7){var h=posts[0],ht=thumb(h),hl=lbl(h);var exc=h.excerpt&&h.excerpt.rendered?h.excerpt.rendered.replace(/<[^>]+>/g,'').slice(0,160):'';html+='<div class="gr-hero"><div class="gr-hero-main">'+img(ht,h.link)+tag(hl)+'<h2><a href="'+h.link+'">'+h.title.rendered+'</a></h2>'+(exc?'<p class="gr-excerpt">'+exc+'</p>':'')+'</div><div class="gr-hero-side">';posts.slice(1,7).forEach(function(p){var t=thumb(p),l=lbl(p);html+='<div class="gr-side-card">'+img(t,p.link)+'<div>'+tag(l)+'<h3><a href="'+p.link+'">'+p.title.rendered+'</a></h3></div></div>';});html+='</div></div>';}
var grid=posts.length>=7?posts.slice(7):posts;
if(grid.length){html+='<p class="gr-section-title">LATEST REVIEWS</p><div class="gr-grid">';grid.forEach(function(p){var t=thumb(p),l=lbl(p);html+='<div class="gr-card">'+img(t,p.link)+tag(l)+'<h3><a href="'+p.link+'">'+p.title.rendered+'</a></h3></div>';});html+='</div>';}
el.innerHTML=html;}
var footerEl=document.getElementById('gr-footer-wrap');
if(footerEl){var soc=(cust&&cust.footer&&cust.footer.socials)||{};var pro=(cust&&cust.profile)||{};var items=[{icon:'\\u25ba',label:'YouTube',url:soc.youtube||pro.youtubeUrl||''},{icon:'\\u25c8',label:'Instagram',url:soc.instagram||pro.instagramUrl||''},{icon:'\\u266a',label:'TikTok',url:soc.tiktok||pro.tiktokUrl||''},{icon:'\\u2715',label:'Twitter',url:soc.twitter||pro.twitterUrl||''},{icon:'\\ud83d\\udccc',label:'Pinterest',url:soc.pinterest||pro.pinterestUrl||''},{icon:'f',label:'Facebook',url:soc.facebook||pro.facebookUrl||''},{icon:'\\u25ce',label:'Threads',url:soc.threads||pro.threadsUrl||''},{icon:'\\u2709',label:'Contact',url:soc.contact||pro.contactEmail||''}];var fh='<div class="gr-footer"><div class="gr-footer-socials">';items.forEach(function(s){if(!s.url)return;var href=s.label==='Contact'?'mailto:'+s.url:(s.url.startsWith('http')?s.url:'https://'+s.url);fh+='<a class="gr-footer-social" href="'+href+'" target="_blank" rel="noopener">'+s.icon+' '+s.label+'</a>';});fh+='</div><p class="gr-footer-copy">\\u00a9 '+new Date().getFullYear()+' ${brandName.replace(/'/g, "\\'")}${tagline ? ` \\u2014 ${tagline.replace(/'/g, "\\'")}` : ''}</p><p class="gr-footer-disclaimer">${disclaimer.replace(/'/g, "\\'")}</p></div>';footerEl.innerHTML=fh;}
}).catch(function(){});
})();`

  const content = `<!-- wp:html -->
<style>${css}</style>
<div id="gr-tabs-wrap"></div>
<div id="gr-home"></div>
<div id="gr-footer-wrap"></div>
<script>${js}<\/script>
<!-- /wp:html -->`

  return { title: brandName, content }
}

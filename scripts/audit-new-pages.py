"""Read-only audit of the built release and the four assigned new URLs."""
from pathlib import Path
from html.parser import HTMLParser
from urllib.parse import urlsplit,unquote
from collections import Counter
import json,re
root=Path(__file__).resolve().parents[1];dist=root/'dist'
class Page(HTMLParser):
    def __init__(self,html):
        super().__init__();self.tags=[];self.text=[];self.current=None;self.scripts=[];self.depth=0;self.inhead=False;self.feed(html)
    def handle_starttag(self,tag,attrs):
        a=dict(attrs);self.tags.append((tag,a,self.inhead or tag=='head'))
        if tag=='head':self.inhead=True
        if tag=='script' and a.get('type')=='application/ld+json':self.current=[]
    def handle_endtag(self,tag):
        if tag=='head':self.inhead=False
        if tag=='script' and self.current is not None:self.scripts.append(''.join(self.current));self.current=None
    def handle_data(self,data):
        self.text.append(data)
        if self.current is not None:self.current.append(data)
    def meta(self,key):return [a.get('content','') for t,a,h in self.tags if t=='meta' and h and (a.get('name')==key or a.get('property')==key)]
def target(url):
    path=unquote(urlsplit(url).path)
    if not path.startswith('/'):return None
    return dist/(path.lstrip('/')+'index.html' if path.endswith('/') else path.lstrip('/'))
allpages={p.relative_to(dist).as_posix():Page(p.read_text(encoding='utf-8')) for p in dist.rglob('*.html')}
sitemap=(dist/'sitemap.xml').read_text(encoding='utf-8')
routes=['/slesari/','/slesari/slesar-po-remontu-dst/','/slesari/slesar-po-remontu-am/','/mashinisty-spetstehniki/motorist-tsementirovochnogo-agregata/']
result=[]
for route in routes:
    file=target(route);r=dict(path=route,file_exists=file.exists(),in_sitemap=('https://abs-engineer.ru'+route) in sitemap)
    if not file.exists():result.append(r);continue
    html=file.read_text(encoding='utf-8');p=Page(html)
    schema=[];errors=[]
    def collect(v):
        if isinstance(v,list):
            for x in v:collect(x)
        elif isinstance(v,dict):
            if '@type' in v:schema.extend(v['@type'] if isinstance(v['@type'],list) else [v['@type']])
            for x in v.values():collect(x)
    for s in p.scripts:
        try:collect(json.loads(s))
        except Exception as e:errors.append(str(e))
    links=[a['href'] for t,a,h in p.tags if t=='a' and a.get('href','').startswith('/')]
    broken=[u for u in links if target(u) and not target(u).exists()]
    r.update(title=re.search(r'<title>(.*?)</title>',html,re.S).group(1),description=p.meta('description'),robots=p.meta('robots'),canonical=[a.get('href') for t,a,h in p.tags if t=='link' and h and a.get('rel')=='canonical'],open_graph=p.meta('og:url'),twitter=p.meta('twitter:card'),h1_count=sum(t=='h1' for t,a,h in p.tags),schema_types=schema,schema_errors=errors,verification=p.meta('yandex-verification'),old_verification_present='0a783d38e5c12117' in html,metrika_init_count=len(re.findall(r"ym\(112567157,\s*'init'",html)),metrika_noscript='https://mc.yandex.ru/watch/112567157' in html,prototype_links=sorted(set(u for u in links if u.startswith('/_prototype/'))),broken_links=sorted(set(broken)),missing_alt=sum(t=='img' and 'alt' not in a for t,a,h in p.tags),header_count=sum(t=='header' for t,a,h in p.tags),request_sections=sum(a.get('id')=='request' for t,a,h in p.tags),policy_placeholder='Политика обработки персональных данных: ссылка будет добавлена' in html,template_claims=[s for s in ['3 дня','35+','24/7'] if s in html])
    result.append(r)
schemaerrors=[];brokenall=[]
for name,p in allpages.items():
    for s in p.scripts:
        try:json.loads(s)
        except Exception as e:schemaerrors.append(dict(file=name,error=str(e)))
    for t,a,h in p.tags:
        for attr in ['href','src','action']:
            u=a.get(attr,'')
            if u.startswith('/') and not u.startswith('//') and target(u) and not target(u).exists():brokenall.append(dict(file=name,url=u))
latent=[]
for slug in ['motorist-tsementirovochnogo-agregata','slesar-po-remontu-dst','slesar-po-remontu-am']:
    model=json.loads((root/f'src/data/pages/preview-{slug}.json').read_text(encoding='utf-8'))
    latent.append(dict(slug=slug,status=model['status'],source_schema=model.get('schema',[])))
summary=dict(date='2026-10-29',html_files=len(allpages),sitemap_urls=len(re.findall('<loc>',sitemap)),new_pages=result,source_schema_not_emitted=latent,json_ld_syntax_errors=schemaerrors,missing_internal_resources=brokenall,scope='Local dist only; no production changes or third-party validator submission')
out=root/'seo-research/predeploy-2026-10-29';out.mkdir(parents=True,exist_ok=True)
(out/'audit.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps(summary,ensure_ascii=False,indent=2))

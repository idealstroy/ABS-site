from pathlib import Path
import json
from docx import Document
from docx.oxml.ns import qn
root=Path(__file__).resolve().parents[1]
old='/mashinisty-spetstehniki/'
new='/slesari/'
slugs=['slesar-po-remontu-dst','slesar-po-remontu-am']
def replace_urls(s):
    for slug in slugs:s=s.replace(old+slug+'/',new+slug+'/')
    return s
for name in ['src/data/planned-specialties.json','seo-research/specialties-2026-10-22/research.json']:
    p=root/name;d=json.loads(p.read_text(encoding='utf-8'))
    for page in d['pages']:
        if page['slug'].startswith('slesar-'):
            page['path']=new+page['slug']+'/'
            page['parent']=new
            page['parentNote']='Раздел «Слесари», утверждён пользователем 29.10.2026.'
    if name.startswith('src/'):
        d['updated']='2026-10-29'
        d['sections']=[{'title':'Машинисты','path':old},{'title':'Слесари','path':new,'status':'planned'}]
        if not any(x['slug']==slugs[1] for x in d['pages']):
            d['pages'].append({'slug':slugs[1],'title':'Слесарь по ремонту АМ','step':'18в','path':new+slugs[1]+'/','parent':new,'level':3,'template':'specialist','status':'preview','workingText':'Textes/Текст страницы - Слесарь по ремонту АМ.docx'})
    p.write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
p=root/'seo-research/specialties-2026-10-22/seo-brief.md'
p.write_text(replace_urls(p.read_text(encoding='utf-8')),encoding='utf-8')
for name in ['правила/Дорожная карта создания сайта АБС.docx','Textes/Текст страницы - Слесарь по ремонту ДСТ.docx','Textes/Текст страницы - Слесарь по ремонту АМ.docx']:
    p=root/name;d=Document(p)
    for para in d.element.body.iter(qn('w:p')):
        nodes=list(para.iter(qn('w:t')));s=''.join(n.text or '' for n in nodes);v=replace_urls(s)
        if name.startswith('Textes/'):
            v=v.replace('Машинисты спецтехники — '+old,'Слесари — '+new)
        if v!=s and nodes:
            nodes[0].text=v
            for n in nodes[1:]:n.text=''
    # Parent rows in each locksmith step's section, without changing machinists.
    if name.startswith('правила/'):
        active=False
        for e in d.element.body:
            text=''.join(n.text or '' for n in e.iter(qn('w:t')))
            if text.startswith('ПУНКТ '):active=text.startswith(('ПУНКТ 18б','ПУНКТ 18в'))
            if active:
                for n in e.iter(qn('w:t')):
                    if n.text:n.text=n.text.replace(old,new)
        if not any('Раздел «Слесари»' in x.text for x in d.paragraphs):
            d.add_heading('Раздел Слесари',level=1)
            d.add_paragraph('Добавлен 29 октября 2026 года. Страница раздела: /slesari/. Дочерние страницы: /slesari/slesar-po-remontu-dst/ и /slesari/slesar-po-remontu-am/. Уровень раздела — 2, специальностей — 3. Создать страницу категории по действующему шаблону, подключить две карточки, хлебные крошки и навигацию при интеграции. Моторист цементировочного агрегата остаётся в разделе /mashinisty-spetstehniki/.')
    d.save(p)
print('Assigned production URL structure; preview URLs retained')

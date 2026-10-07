"""Export the alternative homepage copy from its sole working Word document."""
import json
from pathlib import Path
from docx import Document
from docx.oxml.ns import qn

root = Path(__file__).resolve().parents[1]
source = root / 'Textes' / 'Текст страницы - Альтернативная главная АБС.docx'
target = root / 'src/data/pages/home-solution.json'
doc = Document(source)
copy = {}
for paragraph in doc.paragraphs:
    for bookmark in paragraph._p.findall(qn('w:bookmarkStart')):
        key = bookmark.get(qn('w:name'))
        if key and key != '_GoBack':
            copy[key] = paragraph.text
home = json.loads((root/'src/data/pages/prototype-home.json').read_text(encoding='utf-8'))
page = {
    'output': '_prototype/home-solution/index.html',
    'path': '/_prototype/home-solution/',
    'status': 'ready',
    'template': 'home-alternative',
    'pageType': 'home-alternative',
    'bodyClass': 'page-template page-template--home home-solution',
    'seo': {**home['seo'], 'robots':'noindex, nofollow', 'canonical':'https://abs-engineer.ru/_prototype/home-solution/'},
    'h1': copy.pop('h1'),
    'copy': copy,
    'specialistGroups': home['specialistGroups'],
    'solution': {'heroImage':'/assets/images/home-solution-hero.png', 'heroWidth':1895, 'heroHeight':830, 'heroAlt':'Водители и машинисты согласуют работы с руководителем на строительной площадке'},
    'showForm': True,
    'faq': [{'question':copy[f'solutionFaq{i}Question'], 'answer':copy[f'solutionFaq{i}Answer']} for i in range(1,6)],
    'breadcrumbs': [], 'cards': [], 'blocks': [], 'cta': None,
    'links': [], 'images': [], 'schema': [], 'region': {},
}
target.write_text(json.dumps(page, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
print(f'Exported {len(copy)} paragraphs from {source.name}')

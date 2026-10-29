from pathlib import Path
from copy import deepcopy
from docx import Document
from docx.oxml.ns import qn
from lxml import etree as E
import json, shutil

root=Path(__file__).resolve().parents[2]
qa=root/'tmp/specialties-2026-10-22'
source=root/'правила/Дорожная карта создания сайта АБС.docx'
backup=qa/'before-roadmap.docx'
if not backup.exists():shutil.copyfile(source,backup)
doc=Document(backup)
data=json.loads((Path(__file__).parent/'research.json').read_text(encoding='utf-8'))

def set_paragraph_xml(p,text):
    ts=p.findall('.//'+qn('w:t'))
    if not ts:return
    ts[0].text=text
    ts[0].set(qn('xml:space'),'preserve')
    for t in ts[1:]:t.text=''
def text(p):return ''.join(p.itertext()) if False else ''.join(t.text or '' for t in p.findall('.//'+qn('w:t')))
body=doc.element.body
elements=list(body)
start=next(i for i,e in enumerate(elements) if e.tag==qn('w:p') and text(e)=='ПУНКТ 18')
end=next(i for i,e in enumerate(elements) if i>start and e.tag==qn('w:p') and text(e)=='ПУНКТ 19')
segment=elements[start:end]
oldtitle='Подбор машинистов автовышки и автогидроподъемников'
oldcluster='машинист автовышки и автогидроподъемника'
oldurl='/mashinisty-spetstehniki/mashinist-avtovyshki/'
anchor=elements[end]
for p in data['pages']:
    for original in segment:
        clone=deepcopy(original)
        paragraphs=[clone] if clone.tag==qn('w:p') else clone.findall('.//'+qn('w:p'))
        for para in paragraphs:
            value=text(para)
            value=value.replace(oldtitle,p['h1']).replace(oldcluster,p['sheet']).replace(oldurl,p['path'])
            value=value.replace('ПУНКТ 18','ПУНКТ '+p['step']+' [ЗАПЛАНИРОВАН]')
            if value.startswith('Создать и внедрить страницу'):
                value='Создать и внедрить страницу '+p['title']
            if value.startswith('Начинать после:'):
                value='Начинать после: пункт '+('18' if p['step']=='18а' else '18а')+'. Добавлено в план 22 октября 2026 года.'
            if value.startswith('Действия: Изучить объединенный раздел'):
                value='Действия: Изучить вкладку «'+p['sheet']+'» в существующей книге «Семантическое ядро Сайт АБС.xlsx». Фразы конкурентов и синтезированные маски разделены. Частотности не проверены: до SEO-ТЗ измерить их отдельно и сохранить источник, регион и дату.'
            if value.startswith('Действия: Проанализировать Яндекс и Google'):
                value='Действия: Использовать реестр конкурентов seo-research/specialties-2026-10-22/research.json. Отделять точную специальность от смежных услуг и рекрутинг от предоставления персонала. Проверить выдачу, структуру и формулировки; не копировать обещания конкурентов.'
            if value.startswith('Действия: Сравнить страницу с родителем'):
                value='Действия: Разместить страницу в рабочей ветке /mashinisty-spetstehniki/. Перед интеграцией проверить название раздела и меню. '+p['focus']
            if value.startswith('Действия: Сформировать') or value.startswith('Действия: Описать аудиторию'):
                value+=' Заголовок единственной формы: «Оставьте заявку». Нижнюю дублирующую форму не добавлять.'
            if value.startswith('Действия: Внедрить') or value.startswith('Действия: Подключить header'):
                value+=' Сохранить действующие коды Яндекс Метрики, верификации и сторонние скрипты общего шаблона.'
            set_paragraph_xml(para,value)
        anchor.addprevious(clone)

for paragraph in doc.paragraphs:
    t=paragraph.text
    new=t
    if t.startswith('Версия 3.0'):new='Версия 3.1  |  Две новые специальности добавлены 22 октября 2026 года'
    if 'Пункты 3–19 создают' in t:new=t.replace('Пункты 3–19','Пункты 3–18, 18а и 18б')
    if t=='Начинать после: утверждены пункты 3–19':new='Начинать после: утверждены все страницы, включая новые пункты 18а и 18б.'
    if 'Результат: Рабочая карта из 17' in t:new=t.replace('17','18')
    if new!=t:
        set_paragraph_xml(paragraph._p,new)
doc.tables[0].cell(0,0).text='25 основных\nи 2 дополнительных пункта'
doc.tables[0].cell(0,1).text='18\nстраниц SEO-структуры'
def insert_row_after(table,ref,values):
    new=deepcopy(ref._tr)
    ref._tr.addnext(new)
    from docx.table import _Row
    row=_Row(new,table)
    for c,v in zip(row.cells,values):set_paragraph_xml(c.paragraphs[0]._p,v)
    return row
table=doc.tables[2]
ref=table.rows[-1]
for p in data['pages']:
    ref=insert_row_after(table,ref,[p['step'],p['title'],'3',p['path']])
control=doc.tables[-1]
ref=next(r for r in control.rows if r.cells[0].text=='18')
for p in data['pages']:
    ref=insert_row_after(control,ref,[p['step'],'Создать страницу '+p['title'],'Запланирован','18' if p['step']=='18а' else '18а','Обязательна','Кластер добавлен в ядро. Частотность не проверена. Текст, вёрстка и приёмка впереди.'])
for table in doc.tables:
    for row in table.rows:
        for cell in row.cells:
            for paragraph in cell.paragraphs:
                if 'Объединить 17 принятых страниц' in paragraph.text:
                    set_paragraph_xml(paragraph._p,paragraph.text.replace('17','18'))
doc.save(source)
print('UPDATED',source,'paragraphs',len(doc.paragraphs),'tables',len(doc.tables))

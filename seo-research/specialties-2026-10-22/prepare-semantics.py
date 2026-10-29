from pathlib import Path
import csv,json,re
root=Path(__file__).resolve().parent
research=json.loads((root/'research.json').read_text(encoding='utf-8'))
if research.get('verification',{}).get('b2bOnly'):
    raise SystemExit('Рабочее ядро очищено: не перезаписывать коммерческие кандидаты сырыми данными. Источник: 06_b2b_core.csv.')
records=[]
def classify(phrase):
    s=phrase.lower()
    if re.search(r'вакан|работ[ауые]|работать|ищу работу|трудоустрой|резюме|зарплат|заработ|суперджоб|хедхантер|hh\b|требует|требуются',s):return 'Вакансии и поиск работы','Исключить из целевого B2B-ядра'
    if re.search(r'обуч|учеб|курс|короч|удостовер|билет|экзамен|купить|пособие|скачать|тест|повышение квалификации',s):return 'Обучение и документы','Исключить из целевого B2B-ядра'
    if re.search(r'инструк|еткс|профстандарт|окз|окпдтр|код |код$|расшифров|что |кто |чем | это|обязанност|сокращ|стандарт|разряд|вредн|отзыв|вопрос|условия труда|допускается|профессия|охрана труда|пенсия|требования|характеристика|сиз|список 2|льготн',s):return 'Справочный или квалификационный','Не продвигать как отдельный B2B-запрос'
    if 'ищу моториста' in s:return 'Возможный коммерческий','Проверить выдачу перед включением'
    if re.search(r'подбор|отбор|предоставлен|аутстафф|аренда персонала',s):return 'Возможный коммерческий','Проверить выдачу перед включением'
    return 'Смешанный профессиональный','Использовать только с B2B-контекстом страницы'
for p,filename,expected in zip(research['pages'],('motorist-bukvarix.csv','mechanic-bukvarix.csv'),(131,23)):
    raw=(root/'raw'/filename).read_bytes()
    try:txt=raw.decode('utf-8-sig')
    except UnicodeDecodeError:txt=raw.decode('cp1251')
    rows=list(csv.reader(txt.splitlines(),delimiter=';'))
    assert len(rows)-1==expected,(filename,len(rows)-1)
    for row in rows[1:]:
        phrase,words,chars,broad,exact=row
        intent,decision=classify(phrase)
        records.append(dict(keyword=phrase,frequency=int(broad),exact_frequency=int(exact),mask_parent=p['title'],source='Bukvarix',region='Весь мир',date='2026-10-22',cache_date=None,depth=0,page=p['slug'],intent=intent,decision=decision,url='https://www.bukvarix.com/keywords/?q='+__import__('urllib.parse',fromlist=['quote']).quote(p['title'])))
(root/'verified-keywords.json').write_text(json.dumps(records,ensure_ascii=False,indent=2),encoding='utf-8')
for filename,rows in [('03_semantics_raw.csv',records),('04_excluded.csv',[r for r in records if r['decision'].startswith('Исключить')]),('05_topic_candidates.csv',[r for r in records if r['intent'] in ('Смешанный профессиональный','Возможный коммерческий')])]:
    with (root/filename).open('w',encoding='utf-8-sig',newline='')as f:
        w=csv.DictWriter(f,fieldnames=list(records[0]));w.writeheader();w.writerows(rows)
log=[]
for p in research['pages']:
    masks=[p['title'],*p['masks']]
    if p['slug'].startswith('motorist'):masks.insert(1,'подбор моториста цементировочного агрегата')
    else:masks[1:1]=['слесарь по ремонту дорожно-строительной техники','слесарь по ремонту дорожно-строительных машин и тракторов']
    for i,mask in enumerate(masks):
        log.append(dict(mask=mask,date='2026-10-22',region='Весь мир',source='Bukvarix',results=131 if i==0 and p['slug'].startswith('motorist') else 23 if i==0 else 0,status='Выгрузка сохранена'if i==0 else 'Ключевые слова не найдены в базе; частотность не присваивается',url='https://www.bukvarix.com/keywords/?q='+__import__('urllib.parse',fromlist=['quote']).quote(mask)))
(root/'bukvarix-query-log.json').write_text(json.dumps(log,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({'raw_rows':len(records),'excluded':sum(r['decision'].startswith('Исключить')for r in records),'mixed':sum(r['intent']=='Смешанный профессиональный'for r in records),'queries':len(log)},ensure_ascii=False))

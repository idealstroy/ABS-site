from pathlib import Path
from urllib.parse import quote
import csv,json,shutil,re,importlib.util,io
from zipfile import ZipFile
root=Path(__file__).resolve().parents[1]
out=root/'seo-research/slesari-category-2026-10-29'
qa=root/'tmp/slesari-core-final';qa.mkdir(parents=True,exist_ok=True)
book='Семантическое ядро Сайт АБС.xlsx'
def readcsv(p):
    with p.open(encoding='utf-8-sig',newline='') as f:return list(csv.DictReader(f))
def writecsv(p,rows,fields):
    buffer=io.StringIO(newline='')
    w=csv.DictWriter(buffer,fieldnames=fields);w.writeheader();w.writerows(rows)
    content=buffer.getvalue()
    if p.exists() and p.read_bytes().decode('utf-8-sig')==content:return
    with p.open('w',encoding='utf-8-sig',newline='') as f:f.write(content)
if '--merge' not in __import__('sys').argv:
    masks=readcsv(out/'07_masks.csv')
    for r in masks:
        src=Path('C:/Users/marke/Downloads')/(r['mask']+'.csv')
        if r['mask']=='подбор слесаря':src=src.with_name('подбор слесаря (1).csv')
        if src.exists():shutil.copy2(src,out/'raw'/(r['mask']+'.csv'))
    raw=[];logs=[]
    for p in sorted((out/'raw').glob('*.csv')):
        data=list(csv.reader(p.read_text(encoding='utf-8-sig').splitlines(),delimiter=';'))
        rows=[r for r in data[1:] if r]
        mask=p.stem;url='https://www.bukvarix.com/keywords/?q='+quote(mask)
        logs.append(dict(mask=mask,rows=len(rows),date='2026-10-29',region='Весь мир',url=url,source='Bukvarix',cache_date=None))
        for r in rows:raw.append(dict(keyword=r[0],frequency=int(r[3]),exact=int(r[4]),mask_parent=mask,source='Bukvarix',depth=0,region='Весь мир',date='2026-10-29',url=url))
    for m in masks:
        found=next((r for r in logs if r['mask']==m['mask']),None)
        m['status']='Проверена; выгрузка сохранена' if found else 'Проверена; не найдено в базе; частотность неизвестна'
        if not found:logs.append(dict(mask=m['mask'],rows=0,status='Не найдено; не приравнивать к нулевой частотности',date='2026-10-29',region='Весь мир',url='https://www.bukvarix.com/keywords/?q='+quote(m['mask']),source='Bukvarix',cache_date=None))
    fields=['keyword','frequency','exact','mask_parent','source','depth','region','date','url']
    writecsv(out/'03_semantics_raw.csv',raw,fields)
    writecsv(out/'07_masks.csv',masks,['mask','kind','status'])
    (out/'query-log.json').write_text(json.dumps(logs,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    unique={}
    for r in raw:unique.setdefault((r['keyword'].lower().replace('ё','е'),r['region']),r)
    accepted=[];rejected=[]
    for r in unique.values():
        k=r['keyword']
        if re.search('ваканс|работ[ауые]|работу|вахт|резюме|жиль|обучен|удостоверен|еткс|окз|инструкц|обязанност|разряд|фото| это',k):reason='Вакансии, обучение, справочный или нормативный интент'
        elif 'сборщик' in k:reason='Другая специальность'
        elif not re.search('подбор|аутсорсинг|аутстаффинг|нанять|предоставление',k):reason='Название профессии без подтверждённого коммерческого интента'
        elif 'заявка' in k:reason='Поиск образца заявки; B2B-интент не подтверждён'
        else:
            accepted.append({**r,'target':'/slesari/','status':'Коммерческий поиск слесаря; общая фраза, не отдельный спрос на спецтехнику'});continue
        rejected.append({**r,'reason':reason})
    assert all(r['exact']>=0 for r in accepted)
    writecsv(out/'06_b2b_core.csv',accepted,fields+['target','status'])
    writecsv(out/'08_final_excluded.csv',rejected,fields+['reason'])
    report=dict(masks=len(masks),checked_masks=len(masks),raw=len(raw),unique=len(unique),accepted=len(accepted),rejected=len(rejected),zero_exact=sum(r['exact']==0 for r in unique.values()),source='Bukvarix',region='Весь мир',date='2026-10-29',cache_date=None)
    (out/'final-check.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    (qa/'accepted.json').write_text(json.dumps(accepted,ensure_ascii=False,indent=2),encoding='utf-8')
    if not (qa/('before-'+book)).exists():
        shutil.copy2(root/'The structure and semantics of the website'/book,qa/('before-'+book))
    print(json.dumps(report,ensure_ascii=False));print(json.dumps(accepted,ensure_ascii=False))
else:
    spec=importlib.util.spec_from_file_location('preserve',root/'seo-research/specialties-2026-10-22/preserve-workbooks.py')
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);module.QA=qa
    module.merge(book)
    # Original worksheet files are retained byte-for-byte by the merge.
    with ZipFile(qa/('before-'+book)) as z:a={n:z.read(n) for n in z.namelist()}
    with ZipFile(root/'The structure and semantics of the website'/book) as z:b={n:z.read(n) for n in z.namelist()}
    old_sheets=[n for n in a if n.startswith('xl/worksheets/')]
    assert all(a[n]==b[n] for n in old_sheets),'Existing worksheet changed'
    from openpyxl import load_workbook
    wb=load_workbook(root/'The structure and semantics of the website'/book,read_only=True,data_only=False)
    sheet=wb['Слесари'];rows=list(sheet.values)
    expected=json.loads((qa/'accepted.json').read_text(encoding='utf-8'))
    assert len(rows)==len(expected)+2
    assert all(isinstance(r[3],(int,float)) and r[3]>=0 for r in rows[2:])
    assert len({(r[0],r[4]) for r in rows[2:]})==len(expected)
    print('VERIFIED',len(old_sheets),'original worksheet parts unchanged;',len(expected),'measured commercial phrases on Слесари')

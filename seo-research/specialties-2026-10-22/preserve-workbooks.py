"""Merge artifact-authored additions without reserializing unrelated workbook parts."""
from pathlib import Path
from copy import deepcopy
from zipfile import ZipFile, ZIP_DEFLATED
from lxml import etree as E
import json, posixpath, re

ROOT=Path(__file__).resolve().parents[2]
QA=ROOT/'tmp/specialties-2026-10-22'
NS='http://schemas.openxmlformats.org/spreadsheetml/2006/main'
REL='http://schemas.openxmlformats.org/officeDocument/2006/relationships'
PKG='http://schemas.openxmlformats.org/package/2006/relationships'
CT='http://schemas.openxmlformats.org/package/2006/content-types'
Q=lambda tag:'{'+NS+'}'+tag
def parse(b): return E.fromstring(b)
def xml(e): return E.tostring(e,encoding='UTF-8',xml_declaration=True,standalone=True)
def target(base,t): return posixpath.normpath(posixpath.join(posixpath.dirname(base),t)) if not t.startswith('/') else t[1:]
def sheets(parts):
    wb=parse(parts['xl/workbook.xml'])
    rs=parse(parts['xl/_rels/workbook.xml.rels'])
    refs={r.get('Id'):target('xl/workbook.xml',r.get('Target')) for r in rs}
    return wb,rs,{s.get('name'):(s,refs[s.get('{'+REL+'}id')]) for s in wb.find(Q('sheets'))}
def strings(parts):
    if 'xl/sharedStrings.xml' not in parts:return []
    return [deepcopy(n) for n in parse(parts['xl/sharedStrings.xml'])]
def literal(cell,ss):
    c=deepcopy(cell)
    if c.get('t')=='s':
        val=c.find(Q('v')); item=ss[int(val.text)]
        c.remove(val);c.set('t','inlineStr')
        inline=E.SubElement(c,Q('is'))
        for ch in item: inline.append(deepcopy(ch))
    return c
def signature(cell,ss):
    c=literal(cell,ss)
    formula=c.findtext(Q('f'))
    if formula is not None:return ('formula',formula)
    if c.get('t')=='inlineStr':return ('text',''.join(c.find(Q('is')).itertext()))
    return (c.get('t') or 'n',c.findtext(Q('v')))

def merge(file,replace_rows=None):
    with ZipFile(QA/('before-'+file)) as z: out={n:z.read(n) for n in z.namelist()}
    with ZipFile(QA/('candidate-'+file)) as z: cand={n:z.read(n) for n in z.namelist()}
    ow,ors,os=sheets(out);cw,crs,cs=sheets(cand)
    oss,css=strings(out),strings(cand)
    newnames=[n for n in cs if n not in os]
    # Existing cells retain original font/fill/alignment/style references.
    for name,(ce,cp) in cs.items():
        if name not in os:continue
        op=os[name][1]; original=parse(out[op]); candidate=parse(cand[cp])
        od=original.find(Q('sheetData')); cd=candidate.find(Q('sheetData'))
        oc={c.get('r'):c for c in od.iter(Q('c'))}
        orows={r.get('r'):r for r in od}
        last_data=max((int(r.get('r')) for r in od if any(c.find(Q('v')) is not None or c.find(Q('is')) is not None for c in r)),default=1)
        template={re.sub(r'\d','',c.get('r')):c.get('s') for c in orows[str(last_data)]}
        changed=False
        for row in cd:
            ri=int(row.get('r')); dest=orows.get(str(ri))
            for c in row:
                if c.tag!=Q('c'):continue
                address=c.get('r'); old=oc.get(address)
                if old is not None and signature(old,oss)==signature(c,css):continue
                # Ignore empty cells that the exporter materialized.
                if old is None and c.find(Q('v')) is None and c.find(Q('is')) is None and c.find(Q('f')) is None:continue
                if dest is None:
                    dest=E.Element(Q('row'),**{k:v for k,v in row.attrib.items() if k in ('r','ht','customHeight')})
                    od.append(dest);orows[str(ri)]=dest
                nc=literal(c,css)
                style=old.get('s') if old is not None else template.get(re.sub(r'\d','',address))
                if style is not None:nc.set('s',style)
                else:nc.attrib.pop('s',None)
                if old is not None:dest.replace(old,nc)
                else:dest.append(nc)
                changed=True
            if changed and ri>last_data and dest is not None:
                for k in ('ht','customHeight'):
                    if row.get(k):dest.set(k,row.get(k))
        if replace_rows and name in replace_rows:
            end=replace_rows[name]
            for row in list(od):
                if int(row.get('r'))>=3:od.remove(row)
            for row in cd:
                ri=int(row.get('r'))
                if ri<3 or ri>end:continue
                nr=E.Element(Q('row'),**{k:v for k,v in row.attrib.items() if k in ('r','ht','customHeight')})
                for c in row:
                    if c.tag!=Q('c'):continue
                    nc=literal(c,css);old=oc.get(c.get('r'))
                    style=old.get('s') if old is not None else template.get(re.sub(r'\d','',c.get('r')))
                    if style is not None:nc.set('s',style)
                    else:nc.attrib.pop('s',None)
                    nr.append(nc)
                od.append(nr)
            dimension=original.find(Q('dimension'))
            if dimension is None:
                dimension=E.Element(Q('dimension'))
                original.insert(1 if original.find(Q('sheetPr')) is not None else 0,dimension)
            dimension.set('ref',f'A1:M{end}')
            changed=True
        if changed:
            dim=original.find(Q('dimension'))
            if dim is not None and candidate.find(Q('dimension')) is not None and not(replace_rows and name in replace_rows):dim.set('ref',candidate.find(Q('dimension')).get('ref'))
            af=original.find(Q('autoFilter'))
            if af is not None:
                end=max(int(r.get('r')) for r in od)
                af.set('ref',re.sub(r'\d+$',str(end),af.get('ref')))
            out[op]=xml(original)
    # Preserve native table definitions while extending only changed table ranges/headers.
    original_tables={parse(b).get('name'):p for p,b in out.items() if re.match(r'xl/tables/[^/]+\.xml$',p)}
    for p,b in cand.items():
        if not re.match(r'xl/tables/[^/]+\.xml$',p):continue
        ct=parse(b);op=original_tables.get(ct.get('name'))
        if not op:continue
        ot=parse(out[op])
        if ot.get('ref')!=ct.get('ref'):
            ot.set('ref',ct.get('ref'))
            if ot.find(Q('autoFilter')) is not None:ot.find(Q('autoFilter')).set('ref',ct.get('ref'))
        for a,bcol in zip(ot.find(Q('tableColumns')),ct.find(Q('tableColumns'))):
            if a.get('name')!=bcol.get('name'):a.set('name',bcol.get('name'))
        out[op]=xml(ot)
    if newnames:
        # Append resource/style records so all original style IDs keep their meaning.
        ost=parse(out['xl/styles.xml']);cst=parse(cand['xl/styles.xml'])
        offsets={}
        num_map={}
        ons=ost.find(Q('numFmts'))
        if ons is None:ons=E.Element(Q('numFmts'));ost.insert(0,ons)
        nextnum=max([163]+[int(n.get('numFmtId')) for n in ons])+1
        for n in cst.find(Q('numFmts')) or []:
            cp=deepcopy(n);num_map[int(n.get('numFmtId'))]=nextnum;cp.set('numFmtId',str(nextnum));ons.append(cp);nextnum+=1
        ons.set('count',str(len(ons)))
        for tag in ('fonts','fills','borders','cellStyleXfs','cellXfs'):
            dst=ost.find(Q(tag));src=cst.find(Q(tag));offsets[tag]=len(dst)
            for n in src:
                cp=deepcopy(n)
                if tag in ('cellStyleXfs','cellXfs'):
                    for attr,ref in [('fontId','fonts'),('fillId','fills'),('borderId','borders')]:
                        if cp.get(attr) is not None:cp.set(attr,str(int(cp.get(attr))+offsets[ref]))
                    if cp.get('numFmtId') and int(cp.get('numFmtId')) in num_map:cp.set('numFmtId',str(num_map[int(cp.get('numFmtId'))]))
                    if tag=='cellXfs' and cp.get('xfId') is not None:cp.set('xfId',str(int(cp.get('xfId'))+offsets['cellStyleXfs']))
                dst.append(cp)
            dst.set('count',str(len(dst)))
        out['xl/styles.xml']=xml(ost)
        types=parse(out['[Content_Types].xml'])
        existing_ids={r.get('Id') for r in ors}
        sid=max(int(s.get('sheetId')) for s in ow.find(Q('sheets')))
        tableid=max([0]+[int(re.search(r'table(\d+)\.xml$',p).group(1)) for p in out if re.search(r'xl/tables/table\d+\.xml$',p)])
        for name in newnames:
            sid+=1;ce,cp=cs[name]
            dest=f'xl/worksheets/sheet{sid}.xml'
            sheet=parse(cand[cp])
            for c in list(sheet.iter(Q('c'))):
                nc=literal(c,css)
                if nc.get('s') is not None:nc.set('s',str(int(nc.get('s'))+offsets['cellXfs']))
                c.getparent().replace(c,nc)
            out[dest]=xml(sheet)
            rid='rId'+str(sid+100)
            while rid in existing_ids:rid+='x'
            existing_ids.add(rid)
            ns=deepcopy(ce);ns.set('sheetId',str(sid));ns.set('{'+REL+'}id',rid)
            ow.find(Q('sheets')).append(ns)
            E.SubElement(ors,'{'+PKG+'}Relationship',Id=rid,Type=REL+'/worksheet',Target='worksheets/'+posixpath.basename(dest))
            E.SubElement(types,'{'+CT+'}Override',PartName='/'+dest,ContentType='application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml')
            relpath=posixpath.dirname(cp)+'/_rels/'+posixpath.basename(cp)+'.rels'
            if relpath in cand:
                rs=parse(cand[relpath])
                for rel in rs:
                    if rel.get('Type').endswith('/table'):
                        oldtarget=target(cp,rel.get('Target'));tableid+=1
                        newtarget=f'xl/tables/table{tableid}.xml'
                        table=parse(cand[oldtarget]);table.set('id',str(tableid));out[newtarget]=xml(table)
                        rel.set('Target','../tables/'+posixpath.basename(newtarget))
                        E.SubElement(types,'{'+CT+'}Override',PartName='/'+newtarget,ContentType='application/vnd.openxmlformats-officedocument.spreadsheetml.table+xml')
                    else:raise ValueError('Unexpected relationship in added sheet')
                out[posixpath.dirname(dest)+'/_rels/'+posixpath.basename(dest)+'.rels']=xml(rs)
        out['xl/workbook.xml']=xml(ow);out['xl/_rels/workbook.xml.rels']=xml(ors);out['[Content_Types].xml']=xml(types)
    output=ROOT/'The structure and semantics of the website'/file
    tmp=QA/('merged-'+file)
    with ZipFile(tmp,'w',ZIP_DEFLATED) as z:
        for n,b in out.items():z.writestr(n,b)
    output.write_bytes(tmp.read_bytes())
    print('PRESERVED',file,'new sheets',newnames)
if __name__=='__main__':
    for name in ('struktura_saita_ABS_SEO_updated.xlsx','Семантическое ядро Сайт АБС.xlsx'):merge(name)

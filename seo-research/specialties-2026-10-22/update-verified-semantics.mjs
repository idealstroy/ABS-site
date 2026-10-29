import fs from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {FileBlob,SpreadsheetFile} from "@oai/artifact-tool";
const folder=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(folder,"../..");
if(JSON.parse(await fs.readFile(path.join(folder,"research.json"),"utf8")).verification?.b2bOnly) throw new Error("Ядро очищено до коммерческого интента. Повторный импорт полной сырой выгрузки запрещён; используйте 06_b2b_core.csv.");
const qa=path.join(root,"tmp/specialties-content-2026-10-22");
await fs.mkdir(qa,{recursive:true});
const filename="Семантическое ядро Сайт АБС.xlsx",original=path.join(root,"The structure and semantics of the website",filename);
const backup=path.join(qa,"before-"+filename);
const exists=await fs.access(backup).then(()=>true,()=>false);
if(!exists&&!process.argv.includes("--inspect"))await fs.copyFile(original,backup);
const wb=await SpreadsheetFile.importXlsx(await FileBlob.load(exists?backup:original));
const research=JSON.parse(await fs.readFile(path.join(folder,"research.json"),"utf8"));
const records=JSON.parse(await fs.readFile(path.join(folder,"verified-keywords.json"),"utf8"));
const log=JSON.parse(await fs.readFile(path.join(folder,"bukvarix-query-log.json"),"utf8"));
const day=(Date.UTC(2026,9,22)-Date.UTC(1899,11,30))/86400000;
async function render(sheetName,range,name){
  const png=await wb.render({sheetName,range,scale:1.1,format:"png"});
  await fs.writeFile(path.join(qa,name),new Uint8Array(await png.arrayBuffer()));
}
if(process.argv.includes("--inspect")){
  await render(research.pages[0].sheet,"A1:F9","before-motorist.png");
  await render(research.pages[1].sheet,"A1:F12","before-mechanic.png");
  console.log((await wb.inspect({kind:"table",range:`'${research.pages[0].sheet}'!A1:M5`,include:"values,formulas",maxChars:2000})).ndjson);
  process.exit(0);
}
for(const p of research.pages){
  const sheet=wb.worksheets.getItem(p.sheet),rows=sheet.getUsedRange().values;
  const byKeyword=new Map(rows.slice(2).map((r,i)=>[String(r[0]).toLowerCase(),i+3]));
  const pending=[];
  sheet.getRange("C2:D2").values=[["База [Bukvarix]","Точная [Bukvarix]"]];
  for(const rec of records.filter(r=>r.page===p.slug)){
    const values=[rec.keyword,day,rec.frequency,rec.exact_frequency,rec.region,rec.source,rec.url,rec.intent,"Фраза и частотности из CSV Bukvarix","Проверено 22.10.2026; дата базы не указана",rec.mask_parent,p.path,rec.decision];
    const row=byKeyword.get(rec.keyword.toLowerCase());
    if(row)sheet.getRangeByIndexes(row-1,0,1,13).values=[values];
    else pending.push(values);
  }
  const zeroMasks=new Set(log.filter(x=>x.results===0).map(x=>x.mask.toLowerCase()));
  for(let i=2;i<rows.length;i++){
    if(zeroMasks.has(String(rows[i][0]).toLowerCase())){
      sheet.getRange(`J${i+1}`).values=[["В базе Bukvarix ключ не найден; частотность неизвестна"]];
      sheet.getRange(`M${i+1}`).values=[["Сохранить как маску; не считать подтверждённым запросом"]];
    }
  }
  if(pending.length)sheet.tables.items[0].rows.add(null,pending);
  const end=sheet.getUsedRange().values.length;
  sheet.getRange(`B3:B${end}`).setNumberFormat("dd.mm.yyyy");
  sheet.getRange(`C3:D${end}`).setNumberFormat("#,##0");
  const added=sheet.getRangeByIndexes(rows.length,0,pending.length,13);
  added.format.wrapText=true;added.format.verticalAlignment="center";added.format.rowHeight=48;
  console.log("UPDATED",p.sheet,{measured:records.filter(r=>r.page===p.slug).length,added:pending.length,totalRows:end});
}
wb.recalculate();
console.log((await wb.inspect({kind:"table",range:"'моторист цементировочного агр'!A3:F4",include:"values",maxChars:1000})).ndjson);
await(await SpreadsheetFile.exportXlsx(wb)).save(path.join(qa,"candidate-"+filename));
await render(research.pages[0].sheet,"A1:F9","motorist-verified.png");
await render(research.pages[1].sheet,"A1:F12","mechanic-verified.png");

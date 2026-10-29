import fs from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {FileBlob,SpreadsheetFile} from "@oai/artifact-tool";
const folder=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(folder,"../..");
const qa=path.join(root,"tmp/specialties-b2b-clean-2026-10-22");
await fs.mkdir(qa,{recursive:true});
const filename="Семантическое ядро Сайт АБС.xlsx",file=path.join(root,"The structure and semantics of the website",filename);
const backup=path.join(qa,"before-"+filename);
const exists=await fs.access(backup).then(()=>true,()=>false);
const wb=await SpreadsheetFile.importXlsx(await FileBlob.load(exists?backup:file));
const plan=JSON.parse(await fs.readFile(path.join(folder,"research.json"),"utf8"));
const approved=new Set([
  "подбор моториста цементировочного агрегата",
  "отбор мотористов цементировочного агрегата",
  "аутстаффинг мотористов цементировочного агрегата",
  "предоставление мотористов цементировочного агрегата",
  "аренда персонала моторист цементировочного агрегата",
  "моторист ца персонал на объект",
  "ищу моториста цементировочного агрегата",
  "подбор слесаря по ремонту дорожно-строительной техники и тракторов",
  "найти слесаря по ремонту техники",
  "подбор и найм слесаря по ремонту дорожно-строительной техники",
  "отбор слесарей по ремонту дст",
  "аутстаффинг слесарей по ремонту дст",
  "предоставление слесарей по ремонту спецтехники",
  "аренда персонала слесарь по ремонту дст",
  "слесари по ремонту дорожно-строительной техники для компаний"
]);
const report={kept:[],removed:[],rowLimits:{}};
function reason(phrase){
 const s=phrase.toLowerCase();
 if(/вакан|работ[ауые]|трудоустр|резюме|зарплат|требует|требуются/.test(s))return "Вакансии и поиск работы";
 if(/обуч|учеб|курс|короч|удостовер|билет|экзамен|пособие|скачать|тест/.test(s))return "Обучение и документы";
 if(/еткс|окз|профстандарт|окпдтр|инструк|код |стандарт|охран|сиз|вредн|льготн|пенси|разряд|допускается|список 2/.test(s))return "Нормативный или справочный запрос";
 if(/что|кто |чем |это|отзыв|вопрос|расшифров|профессия|характеристик|обязанност|требования/.test(s))return "Информационный запрос";
 return "Общее название или неоднозначный интент без поиска специалиста";
}
async function render(sheetName,range,name){
 const p=await wb.render({sheetName,range,scale:1.1,format:"png"});
 await fs.writeFile(path.join(qa,name),new Uint8Array(await p.arrayBuffer()));
}
if(process.argv.includes("--inspect")){
 await render(plan.pages[0].sheet,"A1:F10","before-motorist.png");
 await render(plan.pages[1].sheet,"A1:F12","before-mechanic.png");
 console.log("Baseline rendered");process.exit(0);
}
if(!exists)await fs.copyFile(file,backup);
for(const p of plan.pages){
 const s=wb.worksheets.getItem(p.sheet),all=s.getUsedRange().values;
 const kept=[];
 for(const row of all.slice(2)){
  if(!row[0])continue;
  const phrase=String(row[0]),keep=approved.has(phrase.toLowerCase());
  if(!keep){report.removed.push({page:p.slug,keyword:phrase,reason:reason(phrase),values:row});continue;}
  const next=Array.from({length:13},(_,i)=>row[i]??null);
  next[7]="Поиск / предоставление специалистов";
  next[12]=typeof next[2]==="number"?"Оставить: ищет специалиста; не считать точный B2B-спрос подтверждённым":"Оставить как коммерческую формулировку; частотность не подтверждена";
  kept.push(next);report.kept.push({page:p.slug,keyword:phrase,values:next});
 }
 const oldTable=s.tables.items[0],tableName=oldTable.name,style=oldTable.style;
 oldTable.delete();
 s.getRangeByIndexes(2,0,all.length-2,13).clear({applyTo:"contents"});
 s.getRangeByIndexes(2,0,kept.length,13).values=kept;
 const last=kept.length+2;
 const table=s.tables.add(`A2:M${last}`,true,tableName);table.style=style;
 s.getRange(`B3:B${last}`).setNumberFormat("dd.mm.yyyy");
 s.getRange(`C3:D${last}`).setNumberFormat("#,##0");
 report.rowLimits[p.sheet]=last;
 console.log(p.sheet,{kept:kept.length,removed:all.slice(2).filter(r=>r[0]).length-kept.length});
}
wb.recalculate();
await(await SpreadsheetFile.exportXlsx(wb)).save(path.join(qa,"candidate-"+filename));
await fs.writeFile(path.join(qa,"clean-report.json"),JSON.stringify(report,null,2));
await render(plan.pages[0].sheet,"A1:F9","motorist-clean.png");
await render(plan.pages[1].sheet,"A1:F10","mechanic-clean.png");
console.log({kept:report.kept.length,removed:report.removed.length});

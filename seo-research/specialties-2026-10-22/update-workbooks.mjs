import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const folder = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(folder, "../..");
const qa = path.join(root, "tmp/specialties-2026-10-22");
await fs.mkdir(qa, { recursive: true });
const data = JSON.parse(await fs.readFile(path.join(folder, "research.json"), "utf8"));
const files = {
  structure: "struktura_saita_ABS_SEO_updated.xlsx",
  core: "Семантическое ядро Сайт АБС.xlsx",
};
const workbooks = {};
for (const [key, file] of Object.entries(files)) {
  const source = path.join(root, "The structure and semantics of the website", file);
  const backup = path.join(qa,`before-${file}`);
  const input = await fs.access(backup).then(()=>backup,()=>source);
  workbooks[key] = await SpreadsheetFile.importXlsx(await FileBlob.load(input));
  console.log(key, (await workbooks[key].inspect({ kind: "sheet", include: "id,name", maxChars: 4500 })).ndjson);
}
async function preview(wb, sheetName, range, file) {
  const png = await wb.render({ sheetName, range, scale: 1.25, format: "png" });
  await fs.writeFile(path.join(qa, file), new Uint8Array(await png.arrayBuffer()));
}
if (process.argv.includes("--inspect")) {
  await preview(workbooks.structure, "Структура сайта", "A12:H17", "structure-before.png");
  await preview(workbooks.core, "водители категории B", "A1:H5", "core-before.png");
  console.log((await workbooks.structure.inspect({kind:"table",range:"Перелинковка!A14:G20",include:"values,formulas",maxChars:3000})).ndjson);
  process.exit(0);
}
const core = workbooks.core;
const structure = workbooks.structure;
const phrases = (p) => p.observed.map(x => x[0]);
const lastRow = (sheet) => {
  const rows = sheet.getUsedRange().values;
  let end = rows.length;
  while(end && rows[end-1].every(v => v == null || v === "")) end--;
  return end;
};
function append(wb, name, rows, cols) {
  const sheet = wb.worksheets.getItem(name);
  const start = lastRow(sheet) + 1;
  const range = sheet.getRangeByIndexes(start-1, 0, rows.length, cols);
  const source = sheet.getRangeByIndexes(start-2, 0, 1, cols);
  for(let i=0;i<rows.length;i++) range.getRow(i).copyFrom(source,"all");
  range.values = rows.map(row => Array.from({length:cols},(_,i)=>row[i]??null));
  range.format.wrapText = true;
  range.format.autofitRows();
  // Extend existing filter tables only through supported row insertion when applicable.
  return start;
}
for(const p of data.pages) {
  const sheet = core.worksheets.add(p.sheet);
  sheet.showGridLines = false;
  sheet.getRange("A1").values = [[p.title]];
  sheet.getRange("A2:M2").values = [["Фраза","Дата сбора","База [YW]","Точная [YW]","Регион","Источник","URL источника","Интент","Происхождение","Статус частотности","Маска-источник","URL страницы","Решение"]];
  const sourceFor = id => data.sources.find(s=>s.id===id);
  const rows = [
    ...p.observed.map(([phrase,origin,id])=>[phrase,(Date.UTC(2026,9,22)-Date.UTC(1899,11,30))/86400000,null,null,"Россия",sourceFor(id)?.company||"Решение пользователя",sourceFor(id)?.url||null,"B2B, уточнять интент",origin,"Не проверялась",p.title,p.path,"Кандидат для страницы; не доказательство спроса"]),
    ...p.masks.map(phrase=>[phrase,(Date.UTC(2026,9,22)-Date.UTC(1899,11,30))/86400000,null,null,"Россия","Маска по конкурентной тематике",null,"B2B","Синтезированная маска, не найденный запрос","Не проверялась",p.title,p.path,"Проверить в Wordstat/Bukvarix"])
  ];
  sheet.getRangeByIndexes(2,0,rows.length,13).values = rows;
  sheet.getRangeByIndexes(0,0,rows.length+2,13).format.font = {name:"Calibri",size:11};
  sheet.getRange("A1").format.font = {name:"Calibri",size:12,bold:true};
  sheet.getRange("A2:M2").format = {fill:"#1F4E78",font:{name:"Calibri",size:11,bold:true,color:"#FFFFFF"},wrapText:true,verticalAlignment:"center",rowHeight:36};
  const widths = [51,16,14,14,15,28,40,25,32,22,39,45,45];
  widths.forEach((width,i)=>sheet.getRangeByIndexes(0,i,rows.length+2,1).format.columnWidth=width);
  const body=sheet.getRangeByIndexes(2,0,rows.length,13);
  body.format.wrapText=true; body.format.verticalAlignment="center"; body.format.rowHeight=60;
  sheet.getRangeByIndexes(2,1,rows.length,1).setNumberFormat("dd.mm.yyyy");
  sheet.getRangeByIndexes(2,2,rows.length,2).setNumberFormat("#,##0");
  sheet.freezePanes.freezeRows(2);
  sheet.tables.add(`A2:M${rows.length+2}`,true,p.step==="18а"?"CementingMotoristKeywords":"DSTMechanicKeywords").style="TableStyleMedium2";
  sheet.getRangeByIndexes(2,1,rows.length,1).setNumberFormat("dd.mm.yyyy");
}
const map = core.worksheets.getItem("Карта");
for(let i=0;i<data.pages.length;i++) {
  map.getRange(`A${18+i}:D${18+i}`).copyFrom(map.getRange("A16:D16"),"all");
  map.getRange(`A${18+i}:D${18+i}`).values=[[null,null,null,data.pages[i].sheet]];
}
append(structure,"Структура сайта",data.pages.map(p=>[3,"машинисты спецтехники",p.title,p.path,p.h1,p.sheet,phrases(p).join("; "),"Добавлено 22.10.2026. Запланировано. Частотности не проверены. Рабочий родитель; публикация после подготовки и приёмки."]),8);
append(structure,"Карта сайта",data.pages.map(p=>["Главная","машинисты спецтехники",p.title,p.path]),4);
append(structure,"Сводка кластеров",data.pages.map(p=>[p.sheet,"Дочерняя, план",p.path,p.observed.length,phrases(p).join("; ")]),5);
append(structure,"Паспорт структуры",data.pages.map((p,i)=>[17+i,3,"Специалист",p.title,p.path,p.parent,p.h1,p.h1,p.sheet,p.observed.length,p.intent,"Частотность не проверена","Специалист","Запланирована 22.10.2026"]),14);
append(structure,"Интенты и границы",data.pages.map((p,i)=>[17+i,p.path,p.masks.slice(0,3).join("; "),"Регион, график, тип техники и профиль работ",data.excluded.join("; "),p.focus]),6);
append(structure,"Перелинковка",data.pages.map((p,i)=>[17+i,p.path,p.parent,"—",`Главная > Машинисты спецтехники > ${p.title}`,"Родитель; главная; заявка; 2–4 релевантных соседа","Карточка категории; каталог главной; меню после готовности"]),7);
append(structure,"Региональный шаблон",data.pages.map((p,i)=>[17+i,p.path,`/{region-slug}${p.path}`,"Self-canonical после запуска регионов","Только шаблон; не генерировать"]),5);
append(structure,"Реестр источников",[[0,"Новые специальности","Решение пользователя от 22.10.2026","2026-10-22","Две страницы, пункты 18а и 18б","Прямое указание"],...data.sources.map(s=>[2,s.company,s.url,"2026-10-22",s.type,"Источник формулировок, не частотности"])],6);
append(structure,"Вопросы согласования",[[7,"Моторист цементировочного агрегата","В исходном ядре отсутствует","Отдельная страница; источники и маски собраны","Пункт 18а","Добавлено в план","Пользователь подтвердил специальность"],[8,"Слесарь по ремонту ДСТ","В исходном ядре отсутствует","Отдельная страница; ДСТ раскрыть как дорожно-строительную технику","Пункт 18б","Добавлено в план","Прямое указание пользователя"],[9,"Размещение новых специальностей","Пока используется существующая ветка специалистов спецтехники","Не переименовывать категорию; уточнить место в меню перед интеграцией","Навигация","Рабочее решение",""],[10,"Частотность новых кластеров","У конкурентов найдены формулировки, спрос не измерен","Проверить частотности отдельно; не записывать нули","Обе новые страницы","Не проверена",""]],7);
const control=structure.worksheets.getItem("Контроль пункта 1");
for(let row=5;row<=9;row++) {
  const old=control.getRange(`B${row}`).formulas[0][0];
  if(old) control.getRange(`B${row}`).formulas=[[old.replaceAll("A5:A20","A5:A22").replaceAll("B5:B20","B5:B22").replaceAll("L5:L20","L5:L22")]];
}
structure.worksheets.getItem("Паспорт структуры").getRange("A2").values=[["18 страниц SEO-структуры: 16 исходных и 2 новые запланированные. Региональные копии не создаются."]];
control.getRange("D5").values=[["Исходная SEO-структура расширена до 18 страниц: главная, 2 категории и 15 специалистов. Две новые страницы добавлены по решению пользователя 22.10.2026. Формулировки конкурентов сохранены отдельно от масок; частотности не проверены. Добавление в план не означает готовность к публикации."]];
control.getRange("A12").values=[["Два новых URL и кластера добавлены 22.10.2026. Тексты, проверка частотностей, вёрстка и приёмка этих страниц впереди. Прежние статусы остальных страниц не пересматривались."]];
const links=structure.worksheets.getItem("Перелинковка");
for(let row=5;row<=20;row++) {
  if(links.getRange(`B${row}`).values[0][0]==="/mashinisty-spetstehniki/") {
    const old=links.getRange(`D${row}`).values[0][0]||"";
    links.getRange(`D${row}`).values=[[`${old}\n${data.pages.map(p=>p.path).join("\n")}`]];
    links.getRange(`D${row}`).format.wrapText=true;
    links.getRange(`A${row}:G${row}`).format.autofitRows();
  }
}
for(const [key,wb]of Object.entries(workbooks)) {
  wb.recalculate();
  const errors=await wb.inspect({kind:"match",searchTerm:"#REF!|#DIV/0!|#VALUE!|#NAME\\?|#NUM!|#SPILL!|#CALC!",options:{useRegex:true,maxResults:30},maxChars:2000});
  console.log("FORMULA CHECK",key,errors.ndjson);
  const source=path.join(root,"The structure and semantics of the website",files[key]);
  const backup=path.join(qa,`before-${files[key]}`);
  if(!await fs.access(backup).then(()=>true,()=>false)) await fs.copyFile(source,backup);
  await (await SpreadsheetFile.exportXlsx(wb)).save(path.join(qa,`candidate-${files[key]}`));
}
await preview(core,data.pages[0].sheet,"A1:F9","motorist-after.png");
await preview(core,data.pages[1].sheet,"A1:F12","mechanic-after.png");
await preview(structure,"Паспорт структуры","A20:F22","passport-after.png");
console.log("UPDATED two workbooks");

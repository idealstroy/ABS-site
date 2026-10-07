import fs from "node:fs/promises";
import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const inputPath = "C:/Users/marke/АБС/The structure and semantics of the website/Семантическое ядро Сайт АБС.xlsx";
const workDir = "C:/Users/marke/АБС/seo-research/drivers-category-b";
const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(inputPath));
const sheet = workbook.worksheets.getItem("водители категории B");
const before = await workbook.render({ sheetName: "водители категории B", range: "A1:J4", scale: 1, format: "png" });
await fs.writeFile(`${workDir}/category-b-before.png`, new Uint8Array(await before.arrayBuffer()));

const existing = sheet.getRange("A3:A4").values.flat().map(value => String(value).toLowerCase());
if (existing.includes("найти водителя легкового автомобиля")) throw new Error("Phrase already exists");
const table = sheet.tables.getItem("CategoryBKeywords");
table.rows.add(null, [[
  "найти водителя легкового автомобиля", 46296, 84, 0, "Весь мир",
  "найти водителя на легковой автомобиль", "Bukvarix",
  "Поиск водителя; коммерческий интент требует проверки",
  "Кандидат категории B; смысловой дубль «найти водителя на легковой автомобиль» исключён",
  "Проверено в Bukvarix; полный сбор прерван временной блокировкой IP"
]]);
sheet.getRange("B5").setNumberFormat("dd.mm.yyyy");
sheet.getRange("C5:D5").setNumberFormat("#,##0");
sheet.getRange("A5:J5").format.rowHeight = 32;
const after = await workbook.render({ sheetName: "водители категории B", range: "A1:J5", scale: 1, format: "png" });
await fs.writeFile(`${workDir}/category-b-after.png`, new Uint8Array(await after.arrayBuffer()));
const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(`${workDir}/category-b-updated-candidate.xlsx`);
console.log((await workbook.inspect({ kind: "region", sheetId: "водители категории B", range: "A1:J5", maxChars: 5000 })).ndjson);

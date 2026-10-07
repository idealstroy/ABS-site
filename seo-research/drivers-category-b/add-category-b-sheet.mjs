import fs from "node:fs/promises";
import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const inputPath = "C:/Users/marke/АБС/The structure and semantics of the website/Семантическое ядро Сайт АБС.xlsx";
const workDir = "C:/Users/marke/АБС/seo-research/drivers-category-b";
const outputPath = `${workDir}/semantic-core-category-b-candidate.xlsx`;
const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(inputPath));
console.log((await workbook.inspect({ kind: "sheet", include: "id,name", maxChars: 4000 })).ndjson);

const before = await workbook.render({
  sheetName: "водитель спецтехника",
  range: "A1:G8",
  scale: 1,
  format: "png",
});
await fs.writeFile(`${workDir}/existing-sheet-preview.png`, new Uint8Array(await before.arrayBuffer()));

if (process.argv.includes("--inspect")) process.exit(0);

const sheet = workbook.worksheets.add("водители категории B");
sheet.showGridLines = false;
sheet.getRange("A1").values = [["Водители категории B"]];
sheet.getRange("A1").format.font = { name: "Calibri", size: 11, italic: true, color: "#666666" };
sheet.getRange("A2:J4").values = [
  ["Фраза", "Дата проверки", "База [Bukvarix]", "\"!\" [Bukvarix]", "Регион", "Маска-источник", "Источник", "Интент", "Решение", "Статус данных"],
  ["подбор водителей категории в", 46296, 3, 0, "Весь мир", "подбор водителей категории в", "Bukvarix", "Коммерческий B2B", "Кандидат категории B", "Проверенная выборка; полная выгрузка не получена"],
  ["агентство по подбору водителей категории в", 46296, 4, 0, "Весь мир", "подбор водителей категории в", "Bukvarix", "Коммерческий B2B", "Кандидат категории B", "Проверенная выборка; полная выгрузка не получена"],
];
const table = sheet.tables.add("A2:J4", true, "CategoryBKeywords");
table.style = "TableStyleMedium2";
sheet.getRange("A1:J4").format.font = { name: "Calibri", size: 11 };
sheet.getRange("A1").format.font = { name: "Calibri", size: 11, italic: true, color: "#666666" };
sheet.getRange("B3:B4").setNumberFormat("dd.mm.yyyy");
sheet.getRange("C3:D4").setNumberFormat("#,##0");
const widths = { A: 48, B: 18, C: 19, D: 19, E: 16, F: 38, G: 15, H: 22, I: 23, J: 52 };
for (const [column, width] of Object.entries(widths)) sheet.getRange(`${column}:${column}`).format.columnWidth = width;
sheet.getRange("A2:J4").format.verticalAlignment = "center";
sheet.getRange("A2:J2").format.rowHeight = 34;
sheet.getRange("A3:J4").format.rowHeight = 32;
sheet.freezePanes.freezeRows(2);

workbook.recalculate();
console.log((await workbook.inspect({ kind: "region", sheetId: "водители категории B", range: "A1:J4", maxChars: 4000 })).ndjson);
const preview = await workbook.render({
  sheetName: "водители категории B",
  range: "A1:J4",
  scale: 1,
  format: "png",
});
await fs.writeFile(`${workDir}/category-b-preview.png`, new Uint8Array(await preview.arrayBuffer()));
const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(outputPath);
console.log(`SAVED ${outputPath}`);

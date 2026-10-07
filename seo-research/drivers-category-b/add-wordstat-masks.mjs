import fs from "node:fs/promises";
import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const root = "C:/Users/marke/АБС/seo-research/drivers-category-b";
const input = "C:/Users/marke/АБС/The structure and semantics of the website/Семантическое ядро Сайт АБС.xlsx";
const lines = (await fs.readFile(`${root}/05_wordstat_masks.csv`, "utf8")).trim().split(/\r?\n/);
const entries = lines.slice(1).map(line => {
  const [mask, base, exact, baseEnd, exactEnd, region, date, source, type] = line.split(";");
  return { mask, base: Number(base), exact: Number(exact), baseEnd, exactEnd, region, date, source, type };
});
if (entries.length !== 43 || new Set(entries.map(x => x.mask)).size !== 43) throw new Error("Mask count/uniqueness mismatch");
if (entries.some(x => !Number.isInteger(x.base) || !Number.isInteger(x.exact))) throw new Error("Invalid frequency");

const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(input));
const sheet = workbook.worksheets.getItem("водители категории B");
const before = await workbook.render({ sheetName: "водители категории B", range: "A1:J5", scale: 1, format: "png" });
await fs.writeFile(`${root}/category-b-wordstat-before.png`, new Uint8Array(await before.arrayBuffer()));

const priorKeys = sheet.getRange("A3:A5").values.flat().map(value => String(value).toLocaleLowerCase("ru"));
if (priorKeys.filter(x => x === "подбор водителей категории в").length !== 1) throw new Error("Expected existing Cyrillic B key exactly once");
const existing = entries.find(x => x.mask === "подбор водителей категории В");
const period = end => `30.08.2026 – ${end}`;
sheet.getRange("K2:N2").values = [["Wordstat база", "Wordstat в кавычках", "Период базы", "Период кавычек"]];
sheet.getRange("K3:N3").values = [[existing.base, existing.exact, period(existing.baseEnd), period(existing.exactEnd)]];
sheet.getRange("G3").values = [["Bukvarix + Яндекс Вордстат"]];
sheet.getRange("J3").values = [["Букварикс C:D; Вордстат K:N, точная — фраза в кавычках"]];

const toAdd = entries.filter(x => x.mask !== existing.mask);
const rows = toAdd.map(x => [
  x.mask, 46296, null, null, x.region, x.mask, x.source,
  x.type === "контрольная" ? "Контрольная общая маска" : "Маска категории B",
  x.type === "контрольная" ? "Не относить к B автоматически" : "Кандидат; проверить интент и релевантность",
  "Wordstat: без операторов / фраза в кавычках",
  x.base, x.exact, period(x.baseEnd), period(x.exactEnd),
]);
sheet.getRange(`A6:N${5 + rows.length}`).values = rows;
sheet.getRange(`B6:B${5 + rows.length}`).setNumberFormat("dd.mm.yyyy");
sheet.getRange(`K3:L${5 + rows.length}`).setNumberFormat("#,##0");
sheet.getRange("K:K").format.columnWidth = 18;
sheet.getRange("L:L").format.columnWidth = 23;
sheet.getRange("M:N").format.columnWidth = 29;
sheet.getRange(`A6:N${5 + rows.length}`).format.rowHeight = 30;

sheet.tables.getItem("CategoryBKeywords").delete();
const table = sheet.tables.add(`A2:N${5 + rows.length}`, true, "CategoryBKeywords");
table.style = "TableStyleMedium2";
const preview = await workbook.render({ sheetName: "водители категории B", range: "A1:N9", scale: 1, format: "png" });
await fs.writeFile(`${root}/category-b-wordstat-after.png`, new Uint8Array(await preview.arrayBuffer()));
const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(`${root}/category-b-wordstat-candidate.xlsx`);
console.log(`SAVED ${root}/category-b-wordstat-candidate.xlsx; ${toAdd.length} new mask rows`);

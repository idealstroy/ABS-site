import { build } from "./build.mjs";
import { check } from "./check.mjs";
import { testForm } from "./test-form.mjs";

const built = await build();
const checked = await check();
const form = await testForm();

process.stdout.write(`Build: ${built.pages} pages\n`);
process.stdout.write(`Checks: ${checked.html} HTML pages, ${checked.files} files\n`);
process.stdout.write(`Form: full local cycle to ${form.recipient}\n`);


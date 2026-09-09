import { spawn } from "node:child_process";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");
const logFile = path.join(dist, "var", "submissions.log");
const host = "127.0.0.1";
const port = "4176";
const baseUrl = `http://${host}:${port}`;

const waitForServer = async () => {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/request/`);
      if (response.ok) return;
    } catch {
      // The PHP process may need a moment to bind the port.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("PHP test server did not start");
};

const submit = (values) => fetch(`${baseUrl}/actions/send-request.php`, {
  method: "POST",
  body: new URLSearchParams(values),
  redirect: "manual",
});

export const testForm = async () => {
  await rm(logFile, { force: true });
  const server = spawn("php", ["-S", `${host}:${port}`, "-t", dist], {
    env: { ...process.env, ABS_FORM_TRANSPORT: "file" },
    stdio: "ignore",
  });

  try {
    await waitForServer();
    const valid = await submit({
      name: "Тест АБС",
      phone: "+7 917 400-10-59",
      region: "Тестовый регион",
      comment: "Автоматическая проверка формы.",
      consent: "yes",
      source: "Автоматический тест",
      source_url: `${baseUrl}/request/`,
      page_type: "test",
      city: "",
      region_slug: "",
      company_site: "",
      submitted_at: String(Date.now() - 5000),
    });
    if (valid.status !== 303 || valid.headers.get("location") !== "/thanks/") {
      throw new Error(`Valid form did not redirect to thanks: ${valid.status} ${valid.headers.get("location")}`);
    }

    const record = JSON.parse((await readFile(logFile, "utf8")).trim());
    if (record.recipient !== "info@abs-engineer.ru" || record.data.phone !== "+7 917 400-10-59") {
      throw new Error("Valid form data was not passed to the configured recipient");
    }

    const invalid = await submit({
      name: "",
      phone: "1",
      consent: "",
      submitted_at: String(Date.now() - 5000),
    });
    if (invalid.status !== 303 || invalid.headers.get("location") !== "/request/?status=error") {
      throw new Error(`Invalid form did not redirect to error: ${invalid.status} ${invalid.headers.get("location")}`);
    }

    return { recipient: record.recipient };
  } finally {
    if (server.exitCode === null) {
      const stopped = new Promise((resolve) => server.once("exit", resolve));
      server.kill();
      await stopped;
    }
  }
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await testForm();
  process.stdout.write(`Form cycle passed for ${result.recipient}\n`);
}

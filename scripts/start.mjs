import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { build } from "./build.mjs";

const { dist } = await build();
const host = process.env.HOST || "127.0.0.1";
const port = process.env.PORT || "8080";
const router = fileURLToPath(new URL("./router.php", import.meta.url));
const server = spawn("php", ["-S", `${host}:${port}`, "-t", dist, router], {
  env: { ...process.env, ABS_FORM_TRANSPORT: "file" },
  stdio: "inherit",
});

process.stdout.write(`Local site: http://${host}:${port}/_prototype/home/\n`);
process.stdout.write("Local form submissions are written to dist/var/submissions.log and are not emailed.\n");

const stop = () => server.kill();
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
server.on("exit", (code) => process.exit(code ?? 0));

// Starts Martin against the local development database.
//
// Reads DATABASE_URL from the git-ignored .env so the connection string never lands in a script,
// a log line or the repository (chapter 10.150). Windows-friendly: no shell quoting involved.
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const envFile = `${repositoryRoot}.env`;

if (process.env["DATABASE_URL"] === undefined && existsSync(envFile)) {
    for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
        const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
        if (match?.[1] && process.env[match[1]] === undefined) {
            process.env[match[1]] = match[2];
        }
    }
}

const databaseUrl = process.env["DATABASE_URL"];
if (!databaseUrl) {
    console.error("DATABASE_URL is not set; run scripts/dev/install-toolchain.ps1 first");
    process.exit(1);
}

const listen = process.env["MARTIN_LISTEN"] ?? "127.0.0.1:3010";

// A shell that was opened before install-toolchain.ps1 ran does not have the tools on PATH yet,
// so fall back to the install location instead of failing with "command not found".
const fallbackBinary = "C:/tools/martin/martin.exe";
const binary = process.env["MARTIN_BIN"] ?? (existsSync(fallbackBinary) ? fallbackBinary : "martin");

// 🔴 Martin nimmt sich ohne Angabe 20 Verbindungen auf einmal und startet GAR NICHT, wenn der Cluster sie nicht
// hergibt ("Unable to get a Postgres connection from the pool"). Lokal teilen sich mehrere Sitzungen und ihre
// Testläufe dieselben 50 Verbindungen; am 2026-10-05 waren 34 belegt, Martin bekam seine 20 nicht und die Karte
// blieb leer. Acht reichen für die Entwicklung, und es bleibt Luft für die anderen. Auf dem VPS setzt die Unit
// ihren eigenen Wert (`MARTIN_POOL_SIZE`, `ops/runtime/runtime-foundation.sh`), dies hier gilt nur lokal.
const poolSize = process.env["MARTIN_POOL_SIZE"] ?? "8";

// 🔴 Lokal ohne Kachelspeicher (WI-0128 E13, Betreiber 2026-10-11 „3.A“): Martin hält Kacheln sonst im Speicher und liefert nach
// einer Bearbeitung im Ortseditor den alten Stand, auch mit `?r=` im Pfad (Befund N7, gemessen mit Martin 1.16.1). Die Karte folgt
// dem Speichern nur, wenn jede Kachel frisch aus der Datenbank kommt. Die Stage-Seite schätzt Claudio ein; dies hier gilt nur lokal.
const cacheSize = process.env["MARTIN_CACHE_SIZE"] ?? "0";

const martin = spawn(
    binary,
    ["--listen-addresses", listen, "--pool-size", poolSize, "--cache-size", cacheSize, databaseUrl],
    { stdio: "inherit" },
);
martin.on("error", (error) => {
    console.error(`could not start martin (${binary}): ${error.message}`);
    process.exit(1);
});
martin.on("exit", (code) => process.exit(code ?? 0));

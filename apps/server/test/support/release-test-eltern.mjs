// Ein Ersatz für den Server in `release-test-abgeloest.test.ts` (WI-0248 L): startet den Ersatz-Starter (`release-test-lang.mjs`) und wird dann hart
// beendet, wie `node --watch` den Server beendet (`child.kill()`, unter Windows TerminateProcess).
//
//     node release-test-eltern.mjs <ordner> abgeloest|gebunden
//
// - `abgeloest`: wie der Dienst (`starteAbgeloest` aus `src/system/release-test-prozess.ts`).
// - `gebunden`: wie vorher: ein gewöhnliches Kind mit Pipe zum Elternprozess. Die Kontrolle, dass der Test den Fehler wirklich fängt.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { setTimeout } from "node:timers";
import { URL, fileURLToPath, pathToFileURL } from "node:url";

const [, , ordner, modus] = process.argv;
const lang = fileURLToPath(new URL("./release-test-lang.mjs", import.meta.url));
const ausgabe = join(ordner, "ausgabe.log");

if (modus === "abgeloest") {
    const { starteAbgeloest } = await import(
        pathToFileURL(fileURLToPath(new URL("../../src/system/release-test-prozess.ts", import.meta.url))).href
    );
    const start = starteAbgeloest(process.execPath, [lang, ordner, "--commit", "x", "--json"], {
        ausgabeDatei: ausgabe,
        env: process.env,
    });
    // Das Ablehnen von `ende` behandeln, wie es der Dienst tut.
    start.ende.then(
        () => undefined,
        () => undefined,
    );
} else {
    spawn(process.execPath, [lang, ordner, "--commit", "x", "--json"], {
        stdio: ["ignore", "pipe", "ignore"],
        env: process.env,
        windowsHide: true,
    });
}

// Warten, bis der Ersatz-Starter angelaufen ist, dann sterben (nicht vorher: Das Kind soll schon laufen, wenn der Server stirbt).
const bis = Date.now() + 20_000;
while (!existsSync(join(ordner, "gestartet.txt")) && Date.now() < bis) await new Promise((ok) => setTimeout(ok, 20));
process.kill(process.pid, "SIGTERM");
// Unter Windows endet der Prozess sofort; sonst die Zeit bis zum Signal überbrücken.
await new Promise((ok) => setTimeout(ok, 5_000));

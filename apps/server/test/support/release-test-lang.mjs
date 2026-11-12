// Ein Ersatz für `scripts/dev/release-abholer.ts`, der lange genug läuft, um den Server zu überleben (WI-0248 L, `release-test-abgeloest.test.ts`).
// Er legt `gestartet.txt` an, wartet ein paar Sekunden, legt dann `fertig.txt` an und schreibt die JSON-Zeile eines gelungenen Starts nach stdout.
// Er startet nie einen echten Test.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { setTimeout } from "node:timers";

const ordner = process.argv[2];
writeFileSync(join(ordner, "gestartet.txt"), String(process.pid));
setTimeout(() => {
    writeFileSync(join(ordner, "fertig.txt"), JSON.stringify({ pid: process.pid, ppid: process.ppid }));
    process.stdout.write(`${JSON.stringify({ status: "gestartet", grund: "Ersatz-Start", startvermerk: true })}\n`);
}, 2_500);

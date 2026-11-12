import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, expect } from "vitest";
import { DEFAULT_WAIT_S, leaseTestDatabase, type TestDatabaseLease } from "./apps/server/test/support/test-db-lock.ts";
import {
    ladeEnvDatei,
    merkeSkip,
    skipGrund,
    stelleJobsAufTestdatenbank,
} from "./apps/server/test/support/test-umgebung.ts";

// .env laden (vorhandene Variablen gewinnen), Kindprozesse von Jobarten auf die Testdatenbank stellen (WI-0189, Review T1-05).
ladeEnvDatei(fileURLToPath(new URL(".env", import.meta.url)));
stelleJobsAufTestdatenbank();

/**
 * Eine Testdatei, die an `TEST_DATABASE_URL` geht, bekommt die Testdatenbank für sich allein, auch
 * gegenüber anderen Sitzungen (WI-0101). `vitest.config.ts` hält denselben Vertrag mit
 * `fileParallelism: false` innerhalb eines Prozesses; hier gilt er über Prozesse hinweg.
 *
 * 🪤 Erkannt wird die Datei an ihrem eigenen Quelltext, nicht an einer Liste: wer
 * `TEST_DATABASE_URL` liest, nimmt die Sperre. Eine Liste wäre beim nächsten neuen Test still falsch.
 */
const testPath = (expect.getState().testPath ?? "").replace(/\\/g, "/");
const databaseUrl = process.env["TEST_DATABASE_URL"];
const usesTestDatabase = (): boolean => {
    if (databaseUrl === undefined || !/\/apps\/server\/test\//.test(testPath)) return false;
    try {
        return readFileSync(testPath, "utf8").includes("TEST_DATABASE_URL");
    } catch {
        return false;
    }
};

// Die Weboberfläche lädt jede Sprachtafel außer Deutsch erst bei Bedarf (WI-0235). Ihre Tests wechseln die Sprache mitten im
// Fall und erwarten den Text sofort; darum liegen dort alle Tafeln vorab bereit. 🪤 Der Pfad steht in einer Variablen: Ein
// wörtlicher Import zöge die Weboberfläche in den Typcheck der Servertests (node16), wo ihre Importe ohne Endung rot sind.
const I18N_DER_WEBOBERFLAECHE = "./apps/web/src/i18n/i18n.ts";
if (/\/apps\/web\//.test(testPath)) {
    const i18n = (await import(I18N_DER_WEBOBERFLAECHE)) as { ladeAlleTafeln: () => Promise<void> };
    await i18n.ladeAlleTafeln();
}

// Überspringt diese Datei mangels Datenbank, hält sie das für die Schlusszeile des Laufs fest (vitest.global-setup.ts).
const grund = skipGrund(testPath);
if (grund) merkeSkip(grund, testPath);

if (usesTestDatabase()) {
    let lease: TestDatabaseLease | undefined;
    beforeAll(
        async () => {
            lease = await leaseTestDatabase(databaseUrl as string, testPath.replace(/^.*\/test\//, ""));
        },
        // Die Wartezeit selbst plus Luft für Verbindung und Aufräumen: die Grenze des Hooks darf nie
        // VOR der Wartezeit zuschlagen, sonst wäre eine belegte Datenbank ein roter Fall.
        (DEFAULT_WAIT_S + 60) * 1000,
    );
    afterAll(async () => {
        await lease?.release();
        lease = undefined;
    }, 30_000);
}

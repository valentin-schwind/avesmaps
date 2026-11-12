import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Die Umgebung eines Testlaufs (WI-0189): `.env` laden, Kindprozesse von Jobarten auf die Testdatenbank stellen und melden,
 * was mangels Datenbank übersprungen wurde. Genutzt von `vitest.setup.ts` (je Testdatei) und `vitest.global-setup.ts` (einmal
 * je Lauf).
 *
 * 🔴 Alles hier meldet nur. Fehlt eine Datenbank, laufen die Tests wie bisher als sichtbarer Skip; die Meldung sagt nur, wie
 * viele es waren, damit „grün“ nicht mehr heißt, dass alles lief (Review S1-07, S3-12). Kein Lauf wird angehalten.
 */

/** Name der Variable der Testdatenbank. Als Konstante, damit ein Test über diese Hilfe nicht selbst die Sperre der Testdatenbank nimmt (`vitest.setup.ts` erkennt Nutzer am Text). */
export const TESTDB_VAR = "TEST_DATABASE_URL";

/** Verzeichnis, in das jede Testdatei ihren Skip-Grund schreibt; der globale Teil legt es an und liest es am Ende. */
export const MELDUNGEN_VAR = "AVESMAPS_TEST_MELDUNGEN";

export type SkipGrund = "testdatenbank" | "entwicklungsdatenbank";

/** Minimaler `.env`-Lader. Vorhandene Umgebungsvariablen gewinnen immer, CI und Deployments werden nie überschrieben. */
export function ladeEnvDatei(pfad: string): void {
    if (!existsSync(pfad)) return;
    for (const line of readFileSync(pfad, "utf8").split(/\r?\n/)) {
        const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
        if (match?.[1] && process.env[match[1]] === undefined) {
            process.env[match[1]] = match[2];
        }
    }
}

/**
 * Kindprozesse von Jobarten öffnen ihre Datenbank über `JOBS_DATABASE_URL`, sonst über `DATABASE_URL`
 * (`apps/server/src/jobs/job-database.ts`), und erben die Umgebung des Laufs (`apps/server/src/jobs/child-process.ts`). Ohne
 * diese Vorgabe schriebe ein echter Kindprozess im Test in die Entwicklungsdatenbank (Review T1-05). Ist eine Testdatenbank
 * gesetzt und `JOBS_DATABASE_URL` nicht, zeigt sie deshalb auf die Testdatenbank. `DATABASE_URL` bleibt, die Routing-Gates
 * lesen sie bewusst.
 *
 * 🪤 Jobarten, die ein Werkzeug mit `loadConfig` starten (etwa `legacy_zug`), lesen `DATABASE_URL` und sind hiervon nicht
 * gedeckt. Ein Test, der so ein Kind echt startet, biegt `DATABASE_URL` weiter selbst um.
 */
export function stelleJobsAufTestdatenbank(env: NodeJS.ProcessEnv = process.env): boolean {
    const test = env["TEST_DATABASE_URL"];
    if (!test || env["JOBS_DATABASE_URL"] !== undefined) return false;
    env["JOBS_DATABASE_URL"] = test;
    return true;
}

/**
 * Welche Datenbank eine Testdatei braucht, erkannt an ihrem eigenen Quelltext wie die Sperre in `vitest.setup.ts`: Wer
 * `TEST_DATABASE_URL` liest, braucht die Testdatenbank; wer nur `DATABASE_URL` liest, die Entwicklungsdatenbank (Routing-Korpus
 * und Dateninvarianten). Eine Liste wäre beim nächsten neuen Test still falsch.
 */
export function gebrauchteDatenbank(quelltext: string): SkipGrund | null {
    if (quelltext.includes("TEST_DATABASE_URL")) return "testdatenbank";
    if (/process\.env(\["DATABASE_URL"\]|\.DATABASE_URL)/.test(quelltext)) return "entwicklungsdatenbank";
    return null;
}

/** Der Grund, aus dem diese Datei überspringt, oder `null`, wenn ihre Datenbank gesetzt ist oder sie keine braucht. */
export function skipGrund(testPath: string, env: NodeJS.ProcessEnv = process.env): SkipGrund | null {
    if (!/\/apps\/server\/test\//.test(testPath)) return null;
    let quelltext: string;
    try {
        quelltext = readFileSync(testPath, "utf8");
    } catch {
        return null;
    }
    const grund = gebrauchteDatenbank(quelltext);
    if (grund === "testdatenbank" && !env["TEST_DATABASE_URL"]) return grund;
    if (grund === "entwicklungsdatenbank" && !env["DATABASE_URL"]) return grund;
    return null;
}

/** Hält fest, dass diese Datei übersprungen wird. Ohne das Verzeichnis des globalen Teils (etwa bei einem Aufruf ohne Konfiguration) tut es nichts. */
export function merkeSkip(grund: SkipGrund, testPath: string, env: NodeJS.ProcessEnv = process.env): void {
    const dir = env[MELDUNGEN_VAR];
    if (!dir || !existsSync(dir)) return;
    const name = `${grund}-${createHash("sha256").update(testPath).digest("hex").slice(0, 16)}`;
    writeFileSync(join(dir, name), testPath);
}

/** Zählt die Meldungen je Grund. */
export function zaehleSkips(dir: string): Record<SkipGrund, number> {
    const zahl: Record<SkipGrund, number> = { testdatenbank: 0, entwicklungsdatenbank: 0 };
    if (!existsSync(dir)) return zahl;
    for (const name of readdirSync(dir)) {
        if (name.startsWith("testdatenbank-")) zahl.testdatenbank += 1;
        else if (name.startsWith("entwicklungsdatenbank-")) zahl.entwicklungsdatenbank += 1;
    }
    return zahl;
}

/** Die Zeilen, die am Ende des Laufs stehen; leer, wenn nichts mangels Datenbank übersprungen wurde. */
export function skipZeilen(zahl: Record<SkipGrund, number>): string[] {
    const zeilen: string[] = [];
    if (zahl.testdatenbank > 0) {
        zeilen.push(
            `⚠ ${zahl.testdatenbank} Testdatei(en) mit Datenbank sind ganz oder teilweise übersprungen, weil TEST_DATABASE_URL fehlt. ` +
                "Grün heißt in diesem Lauf nicht, dass sie liefen.",
        );
    }
    if (zahl.entwicklungsdatenbank > 0) {
        zeilen.push(
            `⚠ ${zahl.entwicklungsdatenbank} Testdatei(en) gegen die Entwicklungsdatenbank (Routing-Korpus, Dateninvarianten) ` +
                "sind ganz oder teilweise übersprungen, weil DATABASE_URL fehlt.",
        );
    }
    return zeilen;
}

/** Legt das Meldeverzeichnis an (leer). */
export function legeMeldungenAn(dir: string): void {
    mkdirSync(dir, { recursive: true });
}

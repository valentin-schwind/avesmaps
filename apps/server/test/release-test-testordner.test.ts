import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Kein Test des Release-Tests schreibt in die echte Datenwurzel (WI-0248, 2026-10-24: `C:\avesmaps3d-data\release-abholer\starter-aaaaaaaaaaaa.log` mit
 * `{"status":"gestartet",…}` stammte aus einem Test mit Schein-SHA).
 *
 * Ursache: Der Dienst löst den Starter als eigenen Prozess ab und legt dessen Ausgabe als `starter-<sha12>.log` in `config.releaseTest.ausgabe`, ohne diese
 * Angabe in `<AVESMAPS_DATEN>/release-abholer` (Vorgabe `C:/avesmaps3d-data`). Die Rauchtests der Schreibwege (`schreibwege-app-rolle.test.ts`,
 * `system-protokollpflicht.test.ts`) starten die Route mit einem Ersatz-Starter (`support/release-test-starter.mjs`), setzten aber `ausgabe` nicht.
 *
 * Der Wächter: Jede Testdatei, die den Ersatz-Starter benutzt, muss in derselben Konfiguration `ausgabe` setzen, und zwar nicht auf die Vorgabe.
 */
const ORDNER = import.meta.dirname;

describe("🔴 Tests mit dem Ersatz-Starter setzen ihren Ausgabeordner selbst", () => {
    const dateien = readdirSync(ORDNER)
        .filter((name) => name.endsWith(".test.ts") && name !== "release-test-testordner.test.ts")
        .filter((name) => readFileSync(join(ORDNER, name), "utf8").includes("release-test-starter.mjs"));

    it("es gibt Testdateien mit dem Ersatz-Starter (sonst prüft dieser Wächter nichts)", () => {
        expect(dateien.length).toBeGreaterThanOrEqual(3);
    });

    it.each(dateien)("%s: setzt `ausgabe` (der Wegwerfordner für `starter-<sha12>.log`)", (name) => {
        const text = readFileSync(join(ORDNER, name), "utf8");
        // Grob, aber ausreichend: Der Schlüssel `ausgabe:` muss in der Datei stehen. Wer den Ersatz-Starter einhängt und die Ausgabe vergisst, fällt hier auf.
        expect(text, `${name}: kein \`ausgabe:\` neben dem Ersatz-Starter`).toMatch(/ausgabe\s*:/u);
        // Und nie die echte Datenwurzel als Ausgabe.
        expect(text, `${name}: die echte Datenwurzel als Ausgabe`).not.toMatch(
            /ausgabe\s*:\s*["'`]C:[/\\]+avesmaps3d-data/iu,
        );
    });
});

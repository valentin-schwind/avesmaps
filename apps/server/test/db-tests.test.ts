import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { dbTestDateien, ersteMeldung, leseTestDateien, wertAus } from "../../../scripts/dev/db-tests.ts";
import { TESTDB_VAR } from "./support/test-umgebung.ts";

/**
 * Die Datenbanktests eines Laufs (`scripts/dev/db-tests.ts`, WI-0224): welche Dateien es sind und wie das JSON von Vitest zu lesen
 * ist. Problemfälle: eine Datei, die nur die Entwicklungsdatenbank liest, gehört nicht in den Durchgang im Wegwerf-Postgres; ein roter
 * Hook ist rot, nicht übersprungen; eine ganz übersprungene Datei ist nicht grün.
 *
 * 🪤 Die Namen der Datenbankvariablen stehen hier zusammengesetzt, damit diese Datei nicht selbst als Datenbanktest zählt.
 */
const ENTWICKLUNGSDB_VAR = ["DATABASE", "URL"].join("_");
const farbe = (text: string): string => `${String.fromCharCode(27)}[31m${text}${String.fromCharCode(27)}[39m`;

describe("dbTestDateien", () => {
    it("🔴 nimmt nur Dateien, die die Testdatenbank lesen, sortiert; die Entwicklungsdatenbank und Dateien ohne Datenbank nicht", () => {
        const liste = dbTestDateien([
            { pfad: "apps/server/test/z.test.ts", text: `process.env["${TESTDB_VAR}"]` },
            { pfad: "apps/server/test/korpus.test.ts", text: `process.env["${ENTWICKLUNGSDB_VAR}"]` },
            { pfad: "apps/server/test/a.test.ts", text: `const u = process.env["${TESTDB_VAR}"];` },
            { pfad: "apps/web/test/oberflaeche.test.ts", text: "// keine Datenbank" },
        ]);
        expect(liste).toEqual(["apps/server/test/a.test.ts", "apps/server/test/z.test.ts"]);
    });
});

describe("ersteMeldung", () => {
    it("🔴 ohne Farbcodes, die ersten vier Zeilen in einer, gekürzt", () => {
        const text = `${farbe("AssertionError")}: erwartet 1\n\nzweite\ndritte\nvierte\nfünfte`;
        expect(ersteMeldung([text])).toBe("AssertionError: erwartet 1 | zweite | dritte | vierte");
        expect(ersteMeldung(["x".repeat(500)], 50)).toHaveLength(50);
        expect(ersteMeldung([])).toBe("");
        expect(ersteMeldung(["", "  ", "echte Meldung"])).toBe("echte Meldung");
    });
});

describe("wertAus", () => {
    const wurzel = "C:\\GIT\\avesmaps3D\\.claude\\worktrees\\x";
    const json = {
        testResults: [
            {
                name: `${wurzel}\\apps\\server\\test\\gruen.test.ts`,
                status: "passed",
                startTime: 1000,
                endTime: 3500,
                assertionResults: [
                    { fullName: "a", status: "passed" },
                    { fullName: "b", status: "pending" },
                ],
            },
            {
                name: "C:/GIT/avesmaps3D/.claude/worktrees/x/apps/server/test/rot.test.ts",
                status: "failed",
                startTime: 0,
                endTime: 10,
                assertionResults: [
                    { fullName: "ok", status: "passed" },
                    {
                        fullName: "Gebiet > Umhängen",
                        status: "failed",
                        failureMessages: [farbe("Error: 409 statt 200")],
                    },
                ],
            },
            {
                name: `${wurzel}\\apps\\server\\test\\hook.test.ts`,
                status: "failed",
                message: "Hook timed out in 10000ms",
                assertionResults: [],
            },
            {
                name: `${wurzel}\\apps\\server\\test\\uebersprungen.test.ts`,
                status: "passed",
                assertionResults: [{ fullName: "c", status: "skipped" }],
            },
            { name: `${wurzel}\\apps\\server\\test\\leer.test.ts`, status: "passed", assertionResults: [] },
        ],
    };
    const e = wertAus(json, wurzel);

    it("🔴 grün, rot mit erstem rotem Fall und Meldung, roter Hook, ganz übersprungen; Pfade relativ mit Schrägstrich", () => {
        expect(e.map((x) => [x.datei, x.status])).toEqual([
            ["apps/server/test/gruen.test.ts", "gruen"],
            ["apps/server/test/rot.test.ts", "rot"],
            ["apps/server/test/hook.test.ts", "rot"],
            ["apps/server/test/uebersprungen.test.ts", "uebersprungen"],
            ["apps/server/test/leer.test.ts", "uebersprungen"],
        ]);
        expect(e[1]).toMatchObject({ test: "Gebiet > Umhängen", meldung: "Error: 409 statt 200" });
        expect(e[2]).toMatchObject({ test: "(Datei: Hook oder Import)", meldung: "Hook timed out in 10000ms" });
        expect(e[0]?.dauerMs).toBe(2500);
    });

    it("kein JSON oder keine Ergebnisse: leere Liste", () => {
        expect(wertAus(null, wurzel)).toEqual([]);
        expect(wertAus({}, wurzel)).toEqual([]);
    });
});

describe("leseTestDateien", () => {
    it("findet Testdateien unter apps/<paket>/test und packages/<paket>/test mit Text, ohne node_modules", () => {
        const wurzel = mkdtempSync(join(tmpdir(), "avesmaps3d-dbtests-"));
        try {
            const lege = (pfad: string, text: string): void => {
                mkdirSync(join(wurzel, pfad, ".."), { recursive: true });
                writeFileSync(join(wurzel, pfad), text);
            };
            lege("apps/server/test/a.test.ts", "A");
            lege("apps/server/test/unter/b.test.ts", "B");
            lege("apps/server/test/node_modules/x/c.test.ts", "C");
            lege("apps/web/test/d.test.ts", "D");
            lege("apps/web/test/hilfe.ts", "H");
            lege("packages/shared/test/e.test.ts", "E");
            const liste = leseTestDateien(wurzel).sort((x, y) => x.pfad.localeCompare(y.pfad));
            expect(liste).toEqual([
                { pfad: "apps/server/test/a.test.ts", text: "A" },
                { pfad: "apps/server/test/unter/b.test.ts", text: "B" },
                { pfad: "apps/web/test/d.test.ts", text: "D" },
                { pfad: "packages/shared/test/e.test.ts", text: "E" },
            ]);
        } finally {
            rmSync(wurzel, { recursive: true, force: true });
        }
    });
});

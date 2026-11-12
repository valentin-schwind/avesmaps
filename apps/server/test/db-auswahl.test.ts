import { describe, expect, it } from "vitest";
import { waehleDbDateien, waehleDbDateienKleineStufe } from "../../../scripts/dev/db-auswahl.ts";
import type { TestDatei } from "../../../scripts/dev/pruef-auswahl.ts";
import { TESTDB_VAR } from "./support/test-umgebung.ts";

/**
 * Welche Datenbanktests der volle Lauf fährt (`scripts/dev/db-auswahl.ts`, WI-0224, Hauptorchestrierung 2026-10-18: „diese prüfungen dauern ewig“).
 * Problemfälle: ein Push in einem Fach-Ordner fährt die Dateien des Bereichs und nicht alle; was jeden Test speist (Migration, shared, Hilfsbauteile,
 * Wurzel von `src`) fährt alle; eine Route erreicht ihre Tests über `buildApp` und den Dateinamen, nicht über einen Import des Ordners; Web,
 * Skripte und Doku wählen nichts; `--voll` und eine unbestimmbare Änderung fahren alle.
 *
 * 🪤 Die Namen der Datenbankvariablen stehen zusammengesetzt, damit diese Datei nicht selbst als Datenbanktest zählt.
 */
const ENTWICKLUNGSDB_VAR = ["DATABASE", "URL"].join("_");
const db = (zeilen: string): string => `const url = process.env["${TESTDB_VAR}"];\n${zeilen}`;

const TESTS: TestDatei[] = [
    {
        pfad: "apps/server/test/editor-territories-routes.test.ts",
        text: db('import { buildApp } from "../src/app.ts";'),
    },
    {
        pfad: "apps/server/test/territories.test.ts",
        text: db('import { importTerritories } from "../src/migration/territory-import.ts";'),
    },
    {
        pfad: "apps/server/test/editor-place-edit.test.ts",
        text: db('import { placeUpdate } from "../src/editor/place-update.ts";'),
    },
    { pfad: "apps/server/test/jobs-routes.test.ts", text: db('import { x } from "../src/jobs/handlers.ts";') },
    {
        pfad: "apps/server/test/schreibwege/weg.test.ts",
        text: db('import { x } from "../../src/editor/path-update.ts";'),
    },
    { pfad: "apps/server/test/korpus.test.ts", text: `const url = process.env["${ENTWICKLUNGSDB_VAR}"];` },
    { pfad: "apps/server/test/route-api.test.ts", text: "// ohne Datenbank" },
    { pfad: "apps/web/test/panel.test.ts", text: "// Web" },
];
const ALLE = [
    "apps/server/test/editor-place-edit.test.ts",
    "apps/server/test/editor-territories-routes.test.ts",
    "apps/server/test/jobs-routes.test.ts",
    "apps/server/test/schreibwege/weg.test.ts",
    "apps/server/test/territories.test.ts",
];
const waehle = (geaendert: string[] | undefined, voll = false) =>
    waehleDbDateien({ geaendert, voll, testDateien: TESTS });

describe("waehleDbDateien", () => {
    it("🔴 `--voll` und eine unbestimmbare oder leere Änderung fahren alle Dateien mit Testdatenbank (nicht die der Entwicklungsdatenbank)", () => {
        for (const a of [waehle(["docs/x.md"], true), waehle(undefined), waehle([])]) {
            expect(a.dateien).toEqual(ALLE);
            expect(a).toMatchObject({ alle: true, gesamt: 5, ausgelassen: 0 });
        }
        expect(waehle(["docs/x.md"], true).grund).toBe("--voll");
    });

    it("🔴 ein Fach-Ordner fährt die Dateien, die aus ihm importieren, auch aus einer Unterordner-Datei, und nennt die Zahl der ausgelassenen", () => {
        const a = waehle(["apps/server/src/editor/path-update.ts"]);
        expect(a.dateien).toEqual([
            "apps/server/test/editor-place-edit.test.ts",
            "apps/server/test/schreibwege/weg.test.ts",
        ]);
        expect(a).toMatchObject({ alle: false, gesamt: 5, ausgelassen: 3 });
        expect(a.grund).toBe("Fach-Ordner editor");
    });

    it("🔴 eine Route erreicht ihre Tests über den Dateinamen: `editor-territories.ts` wählt `editor-territories-routes` und `territories`", () => {
        const a = waehle(["apps/server/src/routes/editor-territories.ts"]);
        expect(a.dateien).toEqual([
            "apps/server/test/editor-territories-routes.test.ts",
            "apps/server/test/territories.test.ts",
        ]);
        expect(a.grund).toBe("Fach-Ordner routes");
    });

    it("🔴 eine geänderte Datenbank-Testdatei läuft selbst; eine ohne Datenbank wählt nichts", () => {
        expect(waehle(["apps/server/test/jobs-routes.test.ts"])).toMatchObject({
            dateien: ["apps/server/test/jobs-routes.test.ts"],
            grund: "1 geänderte Tests",
        });
        expect(waehle(["apps/server/test/route-api.test.ts"]).dateien).toEqual([]);
    });

    it("🔴 was jeden Test speist, fährt alle: Migration, shared, config, db, Wurzel von src, Hilfsbauteile, Wurzeldateien", () => {
        for (const datei of [
            "apps/server/migrations/0160_x.sql",
            "packages/shared/src/index.ts",
            "config/design-canon/avesmaps.json",
            "apps/server/src/db/migrate.ts",
            "apps/server/src/app.ts",
            "apps/server/test/support/auth-fixture.ts",
            "package.json",
            "vitest.setup.ts",
        ]) {
            const a = waehle(["scripts/dev/x.ts", datei]);
            expect(a, datei).toMatchObject({ alle: true, ausgelassen: 0 });
            expect(a.grund, datei).toContain(datei);
        }
    });

    it("🔴 Web, Skripte, Doku und Planung wählen nichts; Windows-Trenner gelten", () => {
        const a = waehle([
            "apps/web/src/app.vue",
            "scripts/dev/vor-dem-push.ts",
            "docs/regeln/x.md",
            "project-control/state/current.md",
        ]);
        expect(a).toMatchObject({ dateien: [], alle: false, gesamt: 5, ausgelassen: 5 });
        expect(a.grund).toBe("keine geänderte Datei berührt einen Datenbanktest");
        expect(waehle(["apps\\server\\src\\jobs\\handlers.ts"]).dateien).toEqual([
            "apps/server/test/jobs-routes.test.ts",
        ]);
    });

    it("ein Fach-Ordner ohne Treffer wählt nichts, ein zweiter dazu fährt dessen Dateien", () => {
        expect(waehle(["apps/server/src/terrain/x.ts"]).dateien).toEqual([]);
        const a = waehle(["apps/server/src/terrain/x.ts", "apps/server/src/jobs/handlers.ts"]);
        expect(a.dateien).toEqual(["apps/server/test/jobs-routes.test.ts"]);
        expect(a.grund).toBe("Fach-Ordner jobs, terrain");
    });
});

describe("waehleDbDateienKleineStufe", () => {
    const LESER: TestDatei[] = [
        ...TESTS,
        {
            pfad: "apps/server/test/sprachtafel-db.test.ts",
            text: db('readFileSync("apps/web/src/i18n/de.ts"); // Sprachtafel gegen die Datenbank'),
        },
        { pfad: "apps/server/test/regeln-db.test.ts", text: db('join("docs/regeln", "entwicklung.md")') },
        { pfad: "apps/server/test/agenten-db.test.ts", text: db('readFileSync("AGENTS.md")') },
    ];
    const FILTER = [
        "apps/server/test/sprachtafel-db.test.ts",
        "apps/server/test/regeln-db.test.ts",
        "apps/server/test/agenten-db.test.ts",
        "apps/web/test",
    ];
    const waehleKlein = (geaendert: string[] | undefined) =>
        waehleDbDateienKleineStufe({ geaendert, filter: FILTER, testDateien: LESER });

    it("🔴 nur die Kandidaten der Stufe, die einen geänderten Pfad oder dessen Ordner nennen", () => {
        expect(waehleKlein(["apps/web/src/i18n/en.ts"]).dateien).toEqual(["apps/server/test/sprachtafel-db.test.ts"]);
        expect(waehleKlein(["docs/regeln/befehle.md"]).dateien).toEqual(["apps/server/test/regeln-db.test.ts"]);
        expect(waehleKlein(["AGENTS.md", "docs/design/x.md"]).dateien).toEqual(["apps/server/test/agenten-db.test.ts"]);
        const a = waehleKlein(["docs/regeln/befehle.md"]);
        expect(a).toMatchObject({ alle: false, ausgelassen: a.gesamt - 1 });
    });

    it("🔴 ein Push, den kein Datenbanktest liest, wählt nichts (und braucht kein PostgreSQL)", () => {
        const a = waehleKlein(["apps/web/e2e/karteneinstellungen.spec.ts"]);
        expect(a.dateien).toEqual([]);
        expect(a.grund).toBe("kein Datenbanktest der Stufe nennt eine geänderte Datei");
        expect(waehleKlein([]).dateien).toEqual([]);
    });

    it("🔴 Dateien außerhalb der Stufe zählen nicht, auch wenn sie einen geänderten Pfad nennen; nicht bestimmbar: alle Kandidaten", () => {
        // `editor-place-edit` steht nicht im Filter der Stufe.
        expect(waehleKlein(["apps/server/src/editor/place-update.ts"]).dateien).toEqual([]);
        const alle = waehleKlein(undefined);
        expect(alle.dateien).toEqual([
            "apps/server/test/agenten-db.test.ts",
            "apps/server/test/regeln-db.test.ts",
            "apps/server/test/sprachtafel-db.test.ts",
        ]);
        expect(alle.grund).toMatch(/nicht bestimmbar/);
    });

    it("Windows-Trenner gelten", () => {
        expect(waehleKlein(["docs\\regeln\\befehle.md"]).dateien).toEqual(["apps/server/test/regeln-db.test.ts"]);
    });
});

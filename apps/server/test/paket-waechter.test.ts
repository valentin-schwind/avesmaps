import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { pruefePaket, REGEL_BEI_ROT, type PaketMessung } from "../../../scripts/dev/paket-grenzen.ts";
import {
    bytesJeQuelle,
    fuerJedesStueck,
    herkunft,
    KLASSEN,
    startDateien,
    vlq,
} from "../../../scripts/dev/paket-herkunft.ts";

/**
 * Der Wächter des Besucherpakets (`scripts/dev/paket-waechter.ts`, WI-0235). Anlass: Das Start-JS wuchs vom 06.10. bis 19.10. von 2,0 auf
 * 7,0 MB, darin der ganze Editor und neun Sprachtafeln, ohne dass ein Lauf die Größe ansah. Geprüft wird der reine Teil ohne Bau.
 */
describe("Herkunft einer Quelle im Bau", () => {
    it.each([
        ["../../src/i18n/de.ts", "Sprachtafeln"],
        ["../../src/i18n/sv.ts", "Sprachtafeln"],
        ["../../src/i18n/i18n.ts", "Karte"],
        ["../../src/ortseditor/ortseditor-fenster.vue", "Editor"],
        ["../../src/map/geometrie/ort.ts", "Editor"],
        ["../../src/map/place-layers.ts", "Karte"],
        ["../../src/auth/session-state.ts", "Karte"],
        ["../../src/auth/anmelden-fenster.vue", "Anmeldung"],
        ["../../src/auth/verwaltung-person.vue", "Editor"],
        ["../../src/kartenserien/verwaltung-kartenserien.vue", "Editor"],
        ["../../src/app.vue", "app.vue"],
        ["../../../../node_modules/maplibre-gl/dist/maplibre-gl.mjs", "MapLibre"],
        ["../../../../node_modules/@vue/runtime-core/dist/runtime-core.esm-bundler.js", "Vue"],
        ["../../../../node_modules/@sinclair/typebox/build/esm/index.mjs", "Bibliotheken"],
        ["../../../../packages/shared/dist/design-canon.js", "shared"],
        ["../../../../config/zoom-bands/standard.json", "config"],
    ])("%s → %s", (quelle, klasse) => {
        expect(herkunft(quelle)).toBe(klasse);
    });

    it("ohne Quelle oder unbekannt: ohne Zuordnung, nie still eine Klasse", () => {
        expect(herkunft(undefined)).toBe("ohne Zuordnung");
        expect(herkunft("\u0000rolldown/runtime.js")).toBe("ohne Zuordnung");
        expect(KLASSEN).toContain("ohne Zuordnung");
    });
});

describe("Startdateien aus index.html", () => {
    it("Modul-Skript und modulepreload zählen zum Start-JS, Stilblätter zum CSS; Favicon und theme-start.js nicht", () => {
        const html = `<!doctype html><head>
            <script src="/theme-start.js"></script>
            <link rel="icon" href="/favicon.ico">
            <script type="module" crossorigin src="/assets/main-AAA.js"></script>
            <link rel="modulepreload" crossorigin href="/assets/theme-toggle-BBB.js">
            <link rel="stylesheet" crossorigin href="/assets/theme-toggle-CCC.css">
            <link rel="stylesheet" crossorigin href="/assets/main-DDD.css">
        </head>`;
        expect(startDateien(html)).toEqual({
            js: ["assets/main-AAA.js", "assets/theme-toggle-BBB.js"],
            css: ["assets/theme-toggle-CCC.css", "assets/main-DDD.css"],
        });
    });
});

describe("Source Map lesen", () => {
    it("VLQ: Null, Vorzeichen und Fortsetzungsziffer", () => {
        expect(vlq("AAAA")).toEqual([0, 0, 0, 0]);
        expect(vlq("CAAC")).toEqual([1, 0, 0, 1]);
        expect(vlq("D")).toEqual([-1]);
        expect(vlq("gB")).toEqual([16]);
    });

    it("🔴 die Stücke ergeben lückenlos die Datei, und jedes Byte gehört der Quelle seines Segments", () => {
        // Zeile 0: ab Spalte 0 a.ts, ab Spalte 3 b.ts; Zeile 1: ab Spalte 1 weiter b.ts (die Quelle zählt über Zeilen fort).
        const code = "abcdäf\nxyz";
        const map = { sources: ["a.ts", "b.ts"], mappings: "AAAA,GCAA;CAAA" };
        const stuecke: string[] = [];
        fuerJedesStueck(code, map, (_quelle, stueck) => stuecke.push(stueck));
        expect(stuecke.join("")).toBe(code);

        const bytes = bytesJeQuelle(code, map);
        expect(bytes.get("a.ts")).toBe(3);
        expect(bytes.get("b.ts")).toBe(4 + 2); // „däf“ mit ä als zwei Bytes, dann „yz“
        expect(bytes.get(undefined)).toBe(2); // „\n“ und das „x“ vor dem ersten Segment der Zeile
    });
});

function messung(teil: Partial<PaketMessung> & { editor?: number } = {}): PaketMessung {
    const klassen = Object.fromEntries(KLASSEN.map((k) => [k, { roh: 0, gzip: 0 }])) as Record<
        (typeof KLASSEN)[number],
        { roh: number; gzip: number }
    >;
    klassen.Editor = { roh: teil.editor ?? 0, gzip: 0 };
    return {
        jsRoh: 1000,
        jsGzip: 500 * 1024,
        cssRoh: 0,
        cssGzip: 0,
        klassen,
        editorQuellen: teil.editor
            ? [{ quelle: "../../src/ortseditor/ortseditor-fenster.vue", bytes: teil.editor }]
            : [],
        ...teil,
    };
}

describe("Urteil des Wächters", () => {
    it("unter der Grenze und Editor noch nicht abgetrennt: grün, der Editoranteil steht als Meldung da", () => {
        const urteil = pruefePaket(messung({ editor: 300 * 1024 }), { startJsGzipKb: 600, editorGetrennt: false });
        expect(urteil.gruen).toBe(true);
        expect(urteil.zeilen.join("\n")).toMatch(/Meldung {2}Editor im Startpaket: 300 KB roh/);
    });

    it("🔴 über der Grenze: rot, mit Messwert und Grenze", () => {
        const urteil = pruefePaket(messung({ jsGzip: 601 * 1024 }), { startJsGzipKb: 600, editorGetrennt: false });
        expect(urteil.gruen).toBe(false);
        expect(urteil.zeilen[0]).toMatch(/ROT {3}Start-JS 601 KB gzip, Grenze 600 KB/);
        // Die Regel der Sperrklinke steht in der Meldung selbst (Hauptorchestrierung 2026-10-19, Wahl B).
        expect(urteil.zeilen).toContain(`  ROT   ${REGEL_BEI_ROT}`);
        expect(REGEL_BEI_ROT).toBe("Paket über der Grenze: optimieren oder den Betreiber um Anhebung bitten.");
    });

    it("unter der Grenze steht die Regel nicht da", () => {
        const urteil = pruefePaket(messung({ jsGzip: 599 * 1024 }), { startJsGzipKb: 600, editorGetrennt: false });
        expect(urteil.zeilen.join("\n")).not.toContain(REGEL_BEI_ROT);
    });

    it("🔴 nach der Trennung: jedes Editor-Byte im Startpaket ist rot und nennt die größten Quellen", () => {
        const urteil = pruefePaket(messung({ editor: 12 * 1024 }), { startJsGzipKb: 600, editorGetrennt: true });
        expect(urteil.gruen).toBe(false);
        expect(urteil.zeilen.join("\n")).toMatch(
            /ROT {3}Editor im Startpaket: 12 KB roh.*src\/ortseditor\/ortseditor-fenster\.vue/,
        );
    });

    it("nach der Trennung ohne Editor-Code: grün", () => {
        const urteil = pruefePaket(messung(), { startJsGzipKb: 600, editorGetrennt: true });
        expect(urteil).toEqual({
            gruen: true,
            zeilen: expect.arrayContaining(["  grün  kein Editor-Code im Startpaket"]),
        });
    });
});

/**
 * 🔴 `@avesmaps3d/shared` trägt `"sideEffects": false` (WI-0235, 2026-10-26): Der Bau lässt jedes Modul des Pakets weg, dessen Ausgaben die Seite nicht
 * nennt. Die Verträge des Servers (WikiSync, Kanal, Discord, Inhalte) lagen sonst alle im Start-JS jedes Besuchers: 1.037 statt 1.004 KB gzip,
 * Grenze 1.025. Das Merkmal gilt nur, solange kein Modul etwas BEIM LADEN tut: Eine Anweisung auf oberster Ebene (ein `Registry.set(…)`, ein
 * Aufruf) verschwände aus dem Paket der Seite, sobald niemand etwas aus dieser Datei benennt - still, ohne Fehler beim Bauen.
 */
describe("Das shared-Paket ist frei von Nebenwirkungen beim Laden", () => {
    const wurzel = join(import.meta.dirname, "..", "..", "..", "packages", "shared");

    function quellen(ordner: string): string[] {
        return readdirSync(ordner, { withFileTypes: true }).flatMap((eintrag) =>
            eintrag.isDirectory()
                ? quellen(join(ordner, eintrag.name))
                : eintrag.name.endsWith(".ts") && !eintrag.name.endsWith(".d.ts")
                  ? [join(ordner, eintrag.name)]
                  : [],
        );
    }

    it("package.json sagt es dem Bau", () => {
        const paket = JSON.parse(readFileSync(join(wurzel, "package.json"), "utf8")) as { sideEffects?: unknown };
        expect(paket.sideEffects).toBe(false);
    });

    it("🔴 keine Datei von shared hat eine Anweisung auf oberster Ebene, die nur wirkt", () => {
        const dateien = quellen(join(wurzel, "src"));
        expect(dateien.length).toBeGreaterThan(50);
        const wirkend: string[] = [];
        for (const datei of dateien) {
            const quelle = ts.createSourceFile(datei, readFileSync(datei, "utf8"), ts.ScriptTarget.ES2023, true);
            for (const anweisung of quelle.statements) {
                // Deklarationen, Importe und Ausgaben tun nichts beim Laden; `void _x;` ist der Beleg eines Typvergleichs (`gebirge/vertrag.ts`).
                const nurDeklaration =
                    ts.isImportDeclaration(anweisung) ||
                    ts.isExportDeclaration(anweisung) ||
                    ts.isExportAssignment(anweisung) ||
                    ts.isVariableStatement(anweisung) ||
                    ts.isFunctionDeclaration(anweisung) ||
                    ts.isClassDeclaration(anweisung) ||
                    ts.isEnumDeclaration(anweisung) ||
                    ts.isTypeAliasDeclaration(anweisung) ||
                    ts.isInterfaceDeclaration(anweisung) ||
                    ts.isModuleDeclaration(anweisung) ||
                    ts.isEmptyStatement(anweisung) ||
                    (ts.isExpressionStatement(anweisung) &&
                        ts.isVoidExpression(anweisung.expression) &&
                        ts.isIdentifier(anweisung.expression.expression));
                if (!nurDeklaration) {
                    const zeile = quelle.getLineAndCharacterOfPosition(anweisung.getStart()).line + 1;
                    wirkend.push(`${datei.slice(wurzel.length + 1)}:${zeile}: ${anweisung.getText().slice(0, 60)}`);
                }
            }
        }
        expect(wirkend).toEqual([]);
    });
});

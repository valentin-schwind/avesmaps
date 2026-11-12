import { readFileSync, readdirSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Wächter der Gelände-Sicht (WI-0271 L1, Migration 0268; Vali 2026-10-31 „Ja, D“; Leserliste und Form mit der Topographie-Koordination).
 *
 * `terrain_peak` nimmt künftig auch Landmarken ohne Geländewirkung auf (Höhle, Wasserfall, Quelle …). Nur Berggipfel und Vulkan formen
 * Gelände. Darum lesen alle Geländeleser die Sicht `terrain_peak_gelaende`, nie die Tabelle: Läse eine Stelle die Tabelle, würde eine Höhle
 * zum Berg (Gipfel mit Vorgabehöhe, Kegel, Fingerabdruck, Anzeigehöhe), und der Gebirge-Reiter gäbe sie als Gipfel aus.
 *
 * Methode: statisch über den Quelltext, ohne Datenbank (wie `compute-height-isolation.test.ts`). Gesucht wird `FROM`/`JOIN terrain_peak`
 * ohne Nachsilbe; `terrain_peak_gelaende`, `_render`, `_wiki_assignment`, `_source` und `_canon` sind andere Namen und fallen nicht darunter.
 * Schreibende Anweisungen (`INSERT INTO`, `UPDATE terrain_peak`) lesen nicht und sind kein Fund.
 *
 * Wer eine Stelle in den bewachten Dateien wirklich auf der Tabelle braucht (alle Arten, etwa die Liste aller Objekte), trägt sie mit
 * Begründung in `ERLAUBT` ein; die Zahl muss stimmen, damit eine zweite Lesestelle nicht unter derselben Erlaubnis durchrutscht.
 */

const WURZEL = resolve(import.meta.dirname, "..", "..", "..");
const SERVER = resolve(WURZEL, "apps", "server", "src");

function tsDateien(ordner: string): string[] {
    return readdirSync(ordner, { withFileTypes: true }).flatMap((eintrag) => {
        const pfad = resolve(ordner, eintrag.name);
        if (eintrag.isDirectory()) return tsDateien(pfad);
        return eintrag.name.endsWith(".ts") ? [pfad] : [];
    });
}

/** Die Geländeleser: alles unter `terrain/` und `gebirge/`, dazu Gebirge-Editor, Bezüge und die Prüfer, die Gipfel als Gebirgsteil lesen. */
const BEWACHT = [
    ...tsDateien(resolve(SERVER, "terrain")),
    ...tsDateien(resolve(WURZEL, "packages", "shared", "src", "gebirge")),
    resolve(SERVER, "editor", "landscapes.ts"),
    resolve(SERVER, "editor", "landscape-update.ts"),
    resolve(SERVER, "editor", "peak-update.ts"),
    resolve(SERVER, "abgleiche", "bezuege.ts"),
    resolve(SERVER, "migration", "terrain.ts"),
    resolve(SERVER, "migration", "verify-terrain.ts"),
];

/** Bewusste Lesestellen auf der Tabelle selbst, je Datei mit Anzahl und Grund. */
const ERLAUBT: Readonly<Record<string, { anzahl: number; grund: string }>> = {
    "apps/server/src/editor/landscapes.ts": {
        anzahl: 1,
        grund: "Die Liste aller Objekte der Derographie (`peaks` neben `rows`): jede Art, auch Landmarken ohne Gelände.",
    },
    "apps/server/src/editor/peak-update.ts": {
        anzahl: 2,
        grund: "Das Objekt selbst zum Bearbeiten lesen (mit und ohne Sperre), gleich welcher Art; `gebirgeAmGipfel` liest die Sicht.",
    },
    "apps/server/src/migration/terrain.ts": {
        anzahl: 2,
        grund: "Abgleich und Stilllegung des Legacy-Zugs (I10): nur Legacy-Zeilen, deren Arten die eigene Liste `TERRAIN_PEAK_SUBTYPES` hält.",
    },
};

const LESEN = /\b(?:FROM|JOIN)\s+terrain_peak\b/giu;

function lesestellen(datei: string): number {
    return [...readFileSync(datei, "utf8").matchAll(LESEN)].length;
}

const name = (datei: string): string => relative(WURZEL, datei).split(sep).join("/");

describe("Wächter der Gelände-Sicht (WI-0271)", () => {
    it("🔴 kein Geländeleser liest `terrain_peak` direkt, nur die Sicht `terrain_peak_gelaende`", () => {
        const funde = BEWACHT.map((datei) => ({ datei: name(datei), anzahl: lesestellen(datei) }))
            .filter(({ datei, anzahl }) => anzahl > (ERLAUBT[datei]?.anzahl ?? 0))
            .map(
                ({ datei, anzahl }) =>
                    `${datei}: ${String(anzahl)} Lesestelle(n) auf terrain_peak, erlaubt ${String(ERLAUBT[datei]?.anzahl ?? 0)}`,
            );
        expect(funde).toEqual([]);
    });

    it("die Erlaubnisliste ist nicht größer als nötig (eine erledigte Ausnahme fällt auf)", () => {
        const zuViel = Object.entries(ERLAUBT)
            .filter(([datei, { anzahl }]) => lesestellen(resolve(WURZEL, datei)) < anzahl)
            .map(([datei]) => datei);
        expect(zuViel).toEqual([]);
    });

    it("die Geländeleser nutzen die Sicht wirklich (der Wächter prüft nicht ins Leere)", () => {
        const mitSicht = BEWACHT.filter((datei) => readFileSync(datei, "utf8").includes("terrain_peak_gelaende")).map(
            name,
        );
        expect(mitSicht).toEqual(
            expect.arrayContaining([
                "apps/server/src/terrain/inputs.ts",
                "apps/server/src/terrain/domain/inputs.ts",
                "apps/server/src/terrain/domain/input-index.ts",
                "apps/server/src/terrain/display-height/inputs.ts",
                "apps/server/src/terrain/verify-dem.ts",
                "apps/server/src/editor/landscapes.ts",
                "apps/server/src/editor/landscape-update.ts",
                "apps/server/src/editor/peak-update.ts",
                "apps/server/src/abgleiche/bezuege.ts",
                "apps/server/src/migration/terrain.ts",
                "apps/server/src/migration/verify-terrain.ts",
            ]),
        );
    });
});

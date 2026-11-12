import { describe, expect, it } from "vitest";
import type { EditorTerritoryHierarchy, EditorTerritoryHierarchyTerritory } from "@avesmaps3d/shared";
import { hierarchieVon, traegtWurzel, type HierarchieZeile } from "../src/gebietseditor/hierarchie.ts";

/**
 * Der Reiter „Hierarchie“, gerechnet (WI-0209 A3; EDIT-0005 §3; EDIT-0003 T23): dieselbe Regel wie der Nachweis N2, je Band gezeigt,
 * verdeckt oder aus, dazu ∅ und ∩. Benannte Fälle je Regel; den Abgleich mit der echten Ableitung führt
 * `apps/server/test/editor-territories-routes.test.ts` („N2 im Teilbaum“).
 *
 * Problemfälle: Ein Obergebiet mit weiter Spanne steht als gezeigt da, obwohl ein Untergebiet gewinnt; ein Band ohne Gebiet fällt nicht
 * auf; Legacys Überlappung fehlt oder trifft offene Spannen; über dem obersten abgeleiteten Band zeigt der Reiter etwas anderes als die
 * Karte; ein Gebiet außerhalb des Anzeigejahrs steht als verdeckt da; ein Nachfahre als Wurzel braucht neue Daten vom Server.
 */

const REICH = "a3000000-0000-4000-8000-000000000001";
const PROVINZ = "a3000000-0000-4000-8000-000000000002";
const BARONIE = "a3000000-0000-4000-8000-000000000003";
const NEBEN = "a3000000-0000-4000-8000-000000000004";
const OBEN = "a3000000-0000-4000-8000-000000000009";

const gebiet = (
    id: string,
    name: string,
    parent: string | undefined,
    spanne: [number, number] | undefined,
    extra: Partial<EditorTerritoryHierarchyTerritory> = {},
): EditorTerritoryHierarchyTerritory => ({
    id,
    name,
    ...(parent ? { parent } : {}),
    ...(spanne ? { minZoom: spanne[0], maxZoom: spanne[1] } : {}),
    color: "#808080",
    order: 0,
    ...extra,
});
const flaeche = (n: number, territory: string, extra: Record<string, number> = {}) => ({
    id: `a3000000-0000-4000-8000-0000000001${String(n).padStart(2, "0")}`,
    territory,
    ...extra,
});
const daten = (
    territories: EditorTerritoryHierarchyTerritory[],
    areas: ReturnType<typeof flaeche>[],
    derivedMaxBand = 8,
): EditorTerritoryHierarchy => ({ yearBf: 1049, derivedMaxBand, territories, areas });

const zeile = (h: ReturnType<typeof hierarchieVon>, id: string): HierarchieZeile => {
    const z = h?.zeilen.find((x) => x.id === id);
    if (!z) throw new Error(`keine Zeile ${id}`);
    return z;
};
/** Die Bänder einer Stufe, kurz zum Vergleichen. */
const baender = (z: HierarchieZeile, stufe: string): number[] => z.stufen.flatMap((s, b) => (s === stufe ? [b] : []));

describe("Gezeigt, verdeckt, aus", () => {
    it("🔴 die engste Spanne gewinnt: das Reich mit offener Spanne ist unter Provinz und Baronie verdeckt", () => {
        const h = hierarchieVon(
            daten(
                [
                    gebiet(REICH, "Reich", undefined, [0, 8]),
                    gebiet(PROVINZ, "Provinz", REICH, [2, 3]),
                    gebiet(BARONIE, "Baronie", PROVINZ, [4, 8]),
                ],
                [flaeche(1, BARONIE)],
            ),
            REICH,
        );
        expect(h?.zeilen.map((z) => [z.id, z.tiefe])).toEqual([
            [REICH, 0],
            [PROVINZ, 1],
            [BARONIE, 2],
        ]);
        expect(baender(zeile(h, REICH), "gezeigt")).toEqual([0, 1]);
        expect(baender(zeile(h, REICH), "verdeckt")).toEqual([2, 3, 4, 5, 6, 7, 8]);
        expect(baender(zeile(h, PROVINZ), "gezeigt")).toEqual([2, 3]);
        expect(baender(zeile(h, PROVINZ), "aus")).toEqual([0, 1, 4, 5, 6, 7, 8]);
        expect(baender(zeile(h, BARONIE), "gezeigt")).toEqual([4, 5, 6, 7, 8]);
        expect(zeile(h, BARONIE).luecken).toEqual([]);
    });

    it("ein Gebiet ohne Fläche darunter ist nirgends verdeckt, nur aus", () => {
        const h = hierarchieVon(
            daten([gebiet(REICH, "Reich", undefined, [0, 8]), gebiet(NEBEN, "Leer", REICH, [2, 8])], []),
            REICH,
        );
        expect(baender(zeile(h, NEBEN), "aus")).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
        expect(baender(zeile(h, REICH), "aus")).toHaveLength(9);
    });

    it("🔴 über dem obersten abgeleiteten Band zeigt der Reiter, was die Karte zeigt: das oberste abgeleitete", () => {
        // Abgeleitet bis 6: Band 7 und 8 zeigen die Provinz, denn bei 6 gewinnt sie; die Baronie (7 bis 8) erscheint dort nie.
        const h = hierarchieVon(
            daten(
                [gebiet(PROVINZ, "Provinz", undefined, [2, 8]), gebiet(BARONIE, "Baronie", PROVINZ, [7, 8])],
                [flaeche(1, BARONIE)],
                6,
            ),
            PROVINZ,
        );
        expect(h?.kartenBand).toBe(6);
        expect(baender(zeile(h, PROVINZ), "gezeigt")).toEqual([2, 3, 4, 5, 6, 7, 8]);
        expect(baender(zeile(h, BARONIE), "gezeigt")).toEqual([]);
        expect(baender(zeile(h, BARONIE), "verdeckt")).toEqual([]);
    });

    it("ohne Ableitung rechnet der Reiter mit allen Bändern und sagt es", () => {
        const h = hierarchieVon(daten([gebiet(REICH, "Reich", undefined, [0, 8])], [flaeche(1, REICH)], -1), REICH);
        expect(h).toMatchObject({ abgeleitet: false, kartenBand: 8 });
        expect(baender(zeile(h, REICH), "gezeigt")).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    });

    it("🔴 ein Gebiet außerhalb des Anzeigejahrs ist überall aus, auch mit Fläche", () => {
        const h = hierarchieVon(
            daten(
                [
                    gebiet(REICH, "Reich", undefined, [0, 1]),
                    gebiet(BARONIE, "Vergangen", REICH, [2, 8], { validToBf: 1000 }),
                ],
                [flaeche(1, BARONIE)],
            ),
            REICH,
        );
        expect(zeile(h, BARONIE).imJahr).toBe(false);
        expect(baender(zeile(h, BARONIE), "aus")).toHaveLength(9);
        expect(zeile(h, BARONIE).luecken).toEqual([]);
    });
});

describe("Befunde", () => {
    it("🔴 ∅ Lücke: Liegt ein Band in keiner Spanne der Kette, zeigt die eigene Fläche dort nichts", () => {
        const h = hierarchieVon(
            daten(
                [
                    gebiet(REICH, "Reich", undefined, [0, 1]),
                    gebiet(PROVINZ, "Provinz", REICH, [2, 3]),
                    gebiet(BARONIE, "Baronie", PROVINZ, [6, 8]),
                ],
                [flaeche(1, BARONIE)],
            ),
            REICH,
        );
        expect(zeile(h, BARONIE).luecken).toEqual([4, 5]);
        expect(zeile(h, PROVINZ).luecken).toEqual([]);
    });

    it("🔴 ∩ Überlappung wie Legacys Warnung: geschlossene Spannen von Obergebieten (vom Elter aufwärts) und Kindern", () => {
        const h = hierarchieVon(
            daten(
                [
                    gebiet(REICH, "Reich", undefined, [0, 3]),
                    gebiet(PROVINZ, "Provinz", REICH, [2, 4]),
                    gebiet(BARONIE, "Baronie", PROVINZ, [4, 8]),
                    // Offen (ohne Grenzen) zählt nie, wie in Legacy.
                    gebiet(NEBEN, "Offen", PROVINZ, undefined),
                ],
                [flaeche(1, BARONIE)],
            ),
            REICH,
        );
        expect(zeile(h, BARONIE).ueber).toEqual([{ id: PROVINZ, name: "Provinz", von: 2, bis: 4, richtung: "oben" }]);
        expect(zeile(h, PROVINZ).ueber.map((u) => [u.name, u.richtung])).toEqual([
            ["Reich", "oben"],
            ["Baronie", "unten"],
        ]);
        expect(zeile(h, NEBEN).ueber).toEqual([]);
    });
});

describe("Wurzel", () => {
    const stand = daten(
        [
            gebiet(OBEN, "Kaiserreich", undefined, [0, 1], { above: true }),
            gebiet(REICH, "Königreich", OBEN, [2, 3]),
            gebiet(PROVINZ, "Grafschaft", REICH, [4, 5]),
            gebiet(BARONIE, "Baronie", PROVINZ, [6, 8]),
        ],
        [flaeche(1, BARONIE)],
    );

    it("🔴 die Daten eines Gebiets tragen jeden Nachfahren als Wurzel, nie die Kette darüber", () => {
        expect(traegtWurzel(stand, REICH)).toBe(true);
        expect(traegtWurzel(stand, BARONIE)).toBe(true);
        expect(traegtWurzel(stand, OBEN)).toBe(false);
        expect(hierarchieVon(stand, OBEN)).toBeUndefined();
        const ab = hierarchieVon(stand, PROVINZ);
        expect(ab?.zeilen.map((z) => z.name)).toEqual(["Grafschaft", "Baronie"]);
        // Die Kette darüber zählt für die Regel: In Band 0 bis 3 zeigt die Fläche das Kaiser- und das Königreich.
        expect(baender(zeile(ab, PROVINZ), "gezeigt")).toEqual([4, 5]);
    });

    it("Geschwister stehen nach Reihenfolge, dann nach Name", () => {
        const h = hierarchieVon(
            daten(
                [
                    gebiet(REICH, "Reich", undefined, [0, 1]),
                    gebiet(BARONIE, "Zwei", REICH, [2, 8], { order: 2 }),
                    gebiet(NEBEN, "Beta", REICH, [2, 8], { order: 1 }),
                    gebiet(PROVINZ, "Alpha", REICH, [2, 8], { order: 1 }),
                ],
                [],
            ),
            REICH,
        );
        expect(h?.zeilen.map((z) => z.name)).toEqual(["Reich", "Alpha", "Beta", "Zwei"]);
        expect(zeile(h, REICH).kinder).toEqual([PROVINZ, NEBEN, BARONIE]);
    });
});

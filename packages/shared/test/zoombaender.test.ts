import { describe, expect, it } from "vitest";
import {
    AVENTURIA_PATH_CARTOGRAPHY,
    AVENTURIA_ZOOM_BANDS,
    MAX_BAND,
    ZOOMBAND_GRUPPEN,
    ZOOMBAND_SPUREN,
    bandInterpolateExpression,
    reiheMitSpanne,
    spannenFilter,
    spannenObergrenze,
    wirksameZoombaender,
    zoombandFolge,
    zoombandSpur,
    zoomspanneGueltig,
} from "../src/index.ts";

/**
 * Die Zoombänder (WI-0221): die eine Liste der Spuren, die Karte, Server und Reiter lesen, und die reinen Bausteine, mit denen die
 * Karte sie anwendet.
 */

describe("die Spuren der Zoombänder", () => {
    it("🔴 jede Kennung genau einmal, jede Vorgabe gültig, jede Gruppe vertreten", () => {
        const ids = ZOOMBAND_SPUREN.map((spur) => spur.id);
        expect(new Set(ids).size).toBe(ids.length);
        for (const spur of ZOOMBAND_SPUREN) {
            expect(zoomspanneGueltig(spur.vorgabe), spur.id).toBe(true);
            expect(spur.id, spur.id).toBe(`${spur.gruppe}.${spur.zeile}.${spur.spur}`);
            // Dieselbe Form prüft die Tafel (Migration 0168), sonst ließe sich eine Spur nicht speichern.
            expect(spur.id).toMatch(/^[a-z]+\.[A-Za-z0-9_]+\.[a-z]+$/);
        }
        expect([...new Set(ZOOMBAND_SPUREN.map((spur) => spur.gruppe))]).toEqual([...ZOOMBAND_GRUPPEN]);
    });

    it("🔴 Orte starten mit Legacys gespeichertem Stand (F3, MCS-032), Stadtviertel mit der Größentafel", () => {
        expect(zoombandSpur("orte.dorf.zeichen")?.vorgabe).toEqual({ von: 4, bis: MAX_BAND });
        expect(zoombandSpur("orte.dorf.name")?.vorgabe).toEqual({ von: 5, bis: MAX_BAND });
        expect(zoombandSpur("orte.metropole.zeichen")?.vorgabe).toEqual({ von: 0, bis: MAX_BAND });
        const viertel = AVENTURIA_ZOOM_BANDS.marker["stadtviertel"] ?? [];
        expect(zoombandSpur("orte.stadtviertel.zeichen")?.vorgabe.von).toBe(viertel.findIndex((d) => d !== null));
    });

    it("🔴 Wege beginnen, wo ihre Breite über 0 steigt; Bäche ab Band 4 (OPS-000036); Namen je Art ohne Grenze (Betreiber 2026-10-18)", () => {
        for (const art of ["Reichsstrasse", "Strasse", "Weg", "Pfad", "Gebirgspass", "Wuestenpfad", "bach"]) {
            const breite = AVENTURIA_PATH_CARTOGRAPHY.widthScale[art] ?? [];
            expect(zoombandSpur(`wege.${art}.linie`)?.vorgabe.von, art).toBe(breite.findIndex((f) => f > 0));
        }
        expect(zoombandSpur("wege.bach.linie")?.vorgabe.von).toBe(4);
        expect(zoombandSpur("wege.Pfad.name")?.vorgabe).toEqual({ von: 0, bis: MAX_BAND });
        // Bachnamen haben ihre eigene Spanne: Der Schriftlauf trägt `is_bach` (Migration 0199).
        expect(zoombandSpur("wege.bach.name")?.vorgabe).toEqual({ von: 0, bis: MAX_BAND });
        expect(zoombandSpur("wege.Flussweg.kontur")?.vorgabe.von).toBe(
            AVENTURIA_PATH_CARTOGRAPHY.water.outlineFromBand,
        );
    });

    it("🔴 Herrschaftsgebiete und Seewege sind nur zur Ansicht (F1)", () => {
        const ansicht = ZOOMBAND_SPUREN.filter((spur) => spur.nurAnsicht !== undefined).map((spur) => spur.id);
        expect(ansicht).toEqual([
            "wege.Seeweg.linie",
            "gebiete.reiche.flaeche",
            "gebiete.ebenen.flaeche",
            "gebiete.innengrenzen.linie",
            "gebiete.grenznamen.name",
        ]);
    });
});

describe("wirksame Spannen", () => {
    it("🔴 gültige Abweichungen gehen vor, alles andere übergeht die Karte still", () => {
        const wirksam = wirksameZoombaender({
            "orte.dorf.name": { von: 3, bis: 7 },
            "orte.stadt.name": { von: 6, bis: 2 },
            "orte.drache.name": { von: 1, bis: 8 },
            "wege.Weg.linie": "nah",
        });
        expect(wirksam["orte.dorf.name"]).toEqual({ von: 3, bis: 7 });
        expect(wirksam["orte.stadt.name"]).toEqual(zoombandSpur("orte.stadt.name")?.vorgabe);
        expect(wirksam["wege.Weg.linie"]).toEqual(zoombandSpur("wege.Weg.linie")?.vorgabe);
        expect(wirksam).not.toHaveProperty("orte.drache.name");
        expect(Object.keys(wirksam)).toHaveLength(ZOOMBAND_SPUREN.length);
    });

    it("🔴 die Folge einer Spanne: Stil, solange sie in ihrer Grenze bleibt; weiter braucht Namensläufe oder Kacheln", () => {
        const name = zoombandSpur("landschaften.wald.name")!;
        expect(zoombandFolge(name, { von: name.vorgabe.von + 1, bis: 8 })).toBe("stil");
        expect(zoombandFolge(name, { von: name.vorgabe.von - 1, bis: 8 })).toBe("namen");
        const linie = zoombandSpur("gelaende.hoehen500.linie")!;
        expect(zoombandFolge(linie, { von: linie.vorgabe.von - 1, bis: 8 })).toBe("kacheln");
        expect(zoombandFolge(zoombandSpur("orte.dorf.name")!, { von: 0, bis: 3 })).toBe("stil");
    });
});

describe("Bausteine der Karte", () => {
    it("🔴 eine Reihe auf eine Spanne: vor `von` leer, früher als die Tafel mit ihrem ersten Wert, dahinter unverändert", () => {
        const reihe = [null, null, 1.33, 2.54, 4.86, 9.28, 17.74, 17.74, 17.74];
        expect(reiheMitSpanne(reihe, { von: 4, bis: 8 }, null)).toEqual([
            null,
            null,
            null,
            null,
            4.86,
            9.28,
            17.74,
            17.74,
            17.74,
        ]);
        expect(reiheMitSpanne(reihe, { von: 0, bis: 8 }, null)).toEqual([
            1.33, 1.33, 1.33, 2.54, 4.86, 9.28, 17.74, 17.74, 17.74,
        ]);
        // Breiten: 0 heißt „nicht auf der Karte“, wie in der Wegetafel.
        expect(reiheMitSpanne([0, 0, 0.3, 0.9], { von: 1, bis: 8 }, 0)).toEqual([0, 0.3, 0.3, 0.9]);
    });

    it("🔴 Obergrenze und ganze Spanne als Filter je Klasse; ohne Grenze `true`", () => {
        expect(spannenObergrenze({ dorf: 8, stadt: 8 }, "subtype")).toBe(true);
        expect(spannenObergrenze({ dorf: 5, stadt: 8 }, "subtype")).toEqual([
            "match",
            ["get", "subtype"],
            "dorf",
            ["<", ["zoom"], 7],
            true,
        ]);
        expect(spannenFilter({ Weg: { von: 0, bis: 8 } }, "subtype")).toBe(true);
        expect(spannenFilter({ Weg: { von: 3, bis: 6 }, Pfad: { von: 2, bis: 8 } }, "subtype")).toEqual([
            "match",
            ["get", "subtype"],
            "Weg",
            ["all", [">=", ["zoom"], 4], ["<", ["zoom"], 8]],
            "Pfad",
            [">=", ["zoom"], 3],
            true,
        ]);
    });

    it("🪤 ein Band ohne jeden Wert wird 0, kein leeres `match` (MapLibre lehnt es samt dem ganzen Ausdruck ab)", () => {
        const ausdruck = bandInterpolateExpression({ dorf: [null, 2, 3, 4, 5, 6, 7, 8, 9] }, "subtype") as unknown[];
        expect(ausdruck[4]).toBe(0);
        expect(ausdruck[6]).toEqual(["match", ["get", "subtype"], "dorf", 2, 0]);
    });
});

import { describe, expect, it } from "vitest";
import type { Queryable } from "../src/database.ts";
import {
    LADER_ABFRAGEN,
    WEGARTEN_VERBORGEN,
    alsFlaeche,
    alsLinie,
    ladeKartenSvgDaten,
} from "../src/karten-export/svg/daten.ts";

/**
 * Der Lader des SVG-Abzugs (WI-0280 K2): Was er der Datenbank schickt und wie er die Antworten ordnet.
 *
 * Reine Funktionstests gegen eine Attrappe der Verbindung, ohne Datenbank: Die Attrappe schreibt jeden Text mit, den der Lader abschickt,
 * und antwortet mit Festwerten. Das echte Lesen gegen die Entwicklungsdatenbank prüft ein Wegwerflauf (Bericht zu WI-0280 K2).
 *
 * 🔴 Map Mutation Guard: Der Lader liest nur. Der erste Fall hält das für jede Zeile fest, die er abschickt, auch für künftige.
 */

interface Aufruf {
    text: string;
    werte: readonly unknown[];
}

const polygon = JSON.stringify({
    type: "Polygon",
    coordinates: [
        [
            [0, 0],
            [10, 0],
            [10, 10],
            [0, 10],
            [0, 0],
        ],
    ],
});
const mehrfach = JSON.stringify({
    type: "MultiPolygon",
    coordinates: [
        [
            [
                [0, 0],
                [1, 0],
                [1, 1],
                [0, 0],
            ],
        ],
        [
            [
                [5, 5],
                [6, 5],
                [6, 6],
                [5, 5],
            ],
            [
                [5.2, 5.2],
                [5.5, 5.2],
                [5.5, 5.5],
                [5.2, 5.2],
            ],
        ],
    ],
});
const linie = JSON.stringify({
    type: "LineString",
    coordinates: [
        [1, 2],
        [3, 4],
        [5, 6],
    ],
});
const punkt = JSON.stringify({ type: "Point", coordinates: [1, 2] });
const einPunktLinie = JSON.stringify({ type: "LineString", coordinates: [[1, 2]] });

function antwort(text: string): unknown[] {
    // Reihenfolge: das Spezielle zuerst, `terrain_peak_gelaende` enthält den Namen von `terrain_peak`.
    if (text.includes("FROM climate_band")) {
        return [
            {
                kennung: "tropisch",
                landschaft: "",
                name: "Tropische Zone",
                ebene: "klima",
                typ: "tropisch",
                geometrie: polygon,
            },
        ];
    }
    if (text.includes("FROM region_area")) {
        return [
            { kennung: "a1", landschaft: "l1", name: "Wald", ebene: "vegetation", typ: "wald", geometrie: mehrfach },
            { kennung: "a2", landschaft: "l2", name: "Leer", ebene: "vegetation", typ: "wald", geometrie: null },
            { kennung: "a3", landschaft: "l3", name: "Punkt", ebene: "topographie", typ: "ohne_typ", geometrie: punkt },
            { kennung: "a4", landschaft: "l4", name: "Seltsam", ebene: "unbekannt", typ: "see", geometrie: polygon },
        ];
    }
    if (text.includes("FROM territory_shape")) {
        return [{ kennung: "t1", name: "Kosch", typ: "Fürstentum", geometrie: polygon }];
    }
    if (text.includes("FROM path p")) {
        return [
            { kennung: "w1", name: "Fluss", art: "Flussweg", bach: true, beschriftung: true, geometrie: linie },
            { kennung: "w2", name: "Stummel", art: "Weg", bach: false, beschriftung: true, geometrie: einPunktLinie },
            { kennung: "w3", name: "Ohne", art: "Pfad", bach: false, beschriftung: false, geometrie: null },
        ];
    }
    if (text.includes("FROM powerline")) return [{ kennung: "k1", name: "Nord", geometrie: linie }];
    if (text.includes("FROM place p")) {
        return [{ kennung: "o1", name: "Gareth", art: "metropole", x: 551.625, y: 532.969, beschriftung: true }];
    }
    if (text.includes("FROM terrain_peak_gelaende")) return [{ x: 10, y: 20, hoehe: 4000 }];
    if (text.includes("FROM terrain_peak p")) {
        return [{ kennung: "m1", name: "Donnerfall", art: "wasserfall", x: 1, y: 2, hoehe: null }];
    }
    if (text.includes("FROM map_label")) return [{ kennung: "b1", name: "Mittelreich", x: 3, y: 4 }];
    if (text.includes("SELECT coalesce(max(o.seq)")) return [{ seq: "16" }];
    if (text.includes("SELECT coalesce((")) return [{ seq: "12" }];
    if (text.includes("FROM migration_run")) return [{ zeit: "2026-10-31T20:43:58Z" }];
    throw new Error(`Der Lader schickt eine Abfrage, die dieser Test nicht kennt: ${text.slice(0, 120)}`);
}

function attrappe(): { sql: Queryable; aufrufe: Aufruf[] } {
    const aufrufe: Aufruf[] = [];
    const sql = (strings: TemplateStringsArray, ...werte: unknown[]): Promise<unknown[]> => {
        const text = strings.join("?");
        aufrufe.push({ text, werte });
        return Promise.resolve(antwort(text));
    };
    return { sql: sql as unknown as Queryable, aufrufe };
}

const VERBOTEN =
    /\b(INSERT|UPDATE|DELETE|TRUNCATE|DROP|ALTER|CREATE|GRANT|REVOKE|LOCK|COPY|CALL|DO|VACUUM|REFRESH|NOTIFY|LISTEN|SET|INTO|MERGE|REINDEX|CLUSTER|ANALYZE)\b/iu;

describe("Lader: nur lesen", () => {
    it("🔴 schickt ausschließlich SELECT, kein Schreiben, keine Sperre, keine Sitzungsänderung", async () => {
        const { sql, aufrufe } = attrappe();
        await ladeKartenSvgDaten(sql, "aventuria");
        expect(aufrufe).toHaveLength(LADER_ABFRAGEN);
        for (const { text } of aufrufe) {
            expect(text.trim(), text.slice(0, 80)).toMatch(/^SELECT\b/u);
            expect(VERBOTEN.exec(text)?.[0], text.slice(0, 120)).toBeUndefined();
            expect(text).not.toMatch(/\bFOR\s+(UPDATE|SHARE|NO KEY UPDATE|KEY SHARE)\b/iu);
            // Mehrere Anweisungen in einem Text wären ein zweiter Weg an der Prüfung vorbei.
            expect(text.replace(/;\s*$/u, "")).not.toContain(";");
        }
    });

    it("bindet die Domäne als Parameter und schreibt sie nie in den Text", async () => {
        const { sql, aufrufe } = attrappe();
        await ladeKartenSvgDaten(sql, "aventuria");
        for (const { text } of aufrufe) expect(text).not.toContain("aventuria");
        const mitDomaene = aufrufe.filter(({ werte }) => werte.includes("aventuria"));
        // Alle außer dem Klimaband (die Tafel kennt keine Domäne) und dem Import-Stand (über alle Domänen) fragen nach der Domäne.
        expect(mitDomaene.length).toBe(LADER_ABFRAGEN - 2);
    });
});

describe("Lader: dieselbe Sichtbarkeit wie die Karte", () => {
    it("filtert nach den Bedingungen der Renderansichten", async () => {
        const { sql, aufrufe } = attrappe();
        await ladeKartenSvgDaten(sql, "aventuria");
        const text = (teil: string): string => aufrufe.find((a) => a.text.includes(teil))?.text ?? "";
        // Landschaften: Teilfläche und Landschaft aktiv, Landschaft nicht verborgen (`region_area_render`).
        expect(text("FROM region_area")).toMatch(/a\.is_active AND r\.is_active AND NOT r\.is_hidden/u);
        // Orte: aktiv und nicht verborgen (verborgene zeichnet nur der Editor).
        expect(text("FROM place p")).toMatch(/p\.is_active AND NOT p\.is_hidden/u);
        // Wege: aktiv, ohne die Wegarten, die die Karte nicht zeigt.
        expect(text("FROM path p")).toMatch(/p\.is_active AND p\.subtype <> ALL/u);
        // Kraftlinien: die gezeichnete Bahn, nicht die Sehne.
        expect(text("FROM powerline")).toMatch(/drawn_geom/u);
        expect(text("FROM powerline")).toMatch(/p\.is_active/u);
        // Landmarken: wie `terrain_peak_render` (aktiv, Namen an), dazu nicht verborgen und nicht „nur Gelände“.
        const landmarken = text("FROM terrain_peak p");
        expect(landmarken).toMatch(/p\.is_active AND p\.show_name/u);
        expect(landmarken).toContain("'verborgen' = ANY (p.merkmale)");
        expect(landmarken).toContain("'nur_gelaende' = ANY (p.merkmale)");
        // Beschriftungen wie `map_label_render`.
        expect(text("FROM map_label")).toMatch(/l\.is_active AND l\.show_name IS DISTINCT FROM false/u);
        expect(text("FROM map_label")).toMatch(/v\.is_hidden/u);
        // Gebiete: abgeleitete Form im höchsten Band, nur mit gültiger Ableitung.
        const gebiete = text("FROM territory_shape");
        expect(gebiete).toContain("z.derived_revision IS NOT NULL");
        expect(gebiete).toContain("t.is_active");
        expect(gebiete).toMatch(/s\.band = \(SELECT max\(h\.band\)/u);
        // Die Gipfel für die Höhe kommen über die Sicht des Geländes, nie über die Tabelle (eine Höhle ist kein Berg).
        expect(text("FROM terrain_peak_gelaende")).toContain("g.height_schritt > 0");
    });

    it("lässt die Seewege weg, weil die Karte keine zeigt", async () => {
        expect(WEGARTEN_VERBORGEN).toEqual(["Seeweg"]);
        const { sql, aufrufe } = attrappe();
        await ladeKartenSvgDaten(sql, "aventuria");
        const wege = aufrufe.find((a) => a.text.includes("FROM path p"));
        expect(wege?.werte).toContainEqual(["Seeweg"]);
    });
});

describe("Lader: Zuordnung der Antworten", () => {
    it("ordnet Klimabänder vor Landschaften, lässt Leeres und Falsches fallen und nimmt Polygone wie Mehrfachflächen", async () => {
        const { sql } = attrappe();
        const daten = await ladeKartenSvgDaten(sql, "aventuria");
        // Das Klimaband steht zuerst; Teilfläche ohne Geometrie und ein Punkt statt einer Fläche fallen weg.
        // Das Band trägt Legacys UUID als dauerhafte Kennung (Vertrag der Terrain-Pipeline), nicht seine Zonenart.
        expect(daten.flaechen.map((f) => f.kennung)).toEqual(["0339b0a1-8bc3-4003-8757-b4e93f530644", "a1", "a4"]);
        expect(daten.flaechen[0]).toMatchObject({ ebene: "klima", typ: "tropisch", landschaft: "" });
        expect(daten.flaechen[1]?.flaeche).toHaveLength(2);
        expect(daten.flaechen[1]?.flaeche[1]).toHaveLength(2);
        // Eine unbekannte Ebene wird nie zu einem Namen, den kein Filter kennt.
        expect(daten.flaechen[2]?.ebene).toBe("topographie");
    });

    it("liest Linien, wirft Stummel weg und führt den Bach als Flussweg mit Merkmal", async () => {
        const { sql } = attrappe();
        const daten = await ladeKartenSvgDaten(sql, "aventuria");
        expect(daten.wege).toEqual([
            {
                kennung: "w1",
                name: "Fluss",
                art: "Flussweg",
                bach: true,
                beschriftung: true,
                punkte: [
                    [1, 2],
                    [3, 4],
                    [5, 6],
                ],
            },
        ]);
        expect(daten.kraftlinien).toEqual([
            {
                kennung: "k1",
                name: "Nord",
                punkte: [
                    [1, 2],
                    [3, 4],
                    [5, 6],
                ],
            },
        ]);
    });

    it("reicht Orte, Landmarken, Namen, Gipfel, Gebiete und die drei Stände durch", async () => {
        const { sql } = attrappe();
        const daten = await ladeKartenSvgDaten(sql, "aventuria");
        expect(daten.orte).toEqual([
            { kennung: "o1", name: "Gareth", art: "metropole", x: 551.625, y: 532.969, beschriftung: true },
        ]);
        expect(daten.landmarken).toEqual([
            { kennung: "m1", name: "Donnerfall", art: "wasserfall", x: 1, y: 2, hoehe: null },
        ]);
        expect(daten.beschriftungen).toEqual([{ kennung: "b1", name: "Mittelreich", x: 3, y: 4 }]);
        expect(daten.gipfel).toEqual([{ x: 10, y: 20, hoehe: 4000 }]);
        expect(daten.gebiete).toHaveLength(1);
        expect(daten.gebiete[0]).toMatchObject({ kennung: "t1", name: "Kosch", typ: "Fürstentum" });
        expect(daten.staende).toEqual({
            kartenfassung: "16",
            landschaftsfassung: "12",
            importstand: "2026-10-31T20:43:58Z",
        });
    });

    it("bleibt bei leeren Antworten ein vollständiges, leeres Ergebnis: die Stände sind „0“ und fehlen nicht", async () => {
        const leer = ((): Promise<unknown[]> => Promise.resolve([])) as unknown as Queryable;
        const daten = await ladeKartenSvgDaten(leer, "aventuria");
        expect(daten.staende).toEqual({ kartenfassung: "0", landschaftsfassung: "0", importstand: null });
        for (const liste of [
            daten.flaechen,
            daten.gebiete,
            daten.wege,
            daten.kraftlinien,
            daten.orte,
            daten.landmarken,
            daten.beschriftungen,
            daten.gipfel,
        ]) {
            expect(liste).toEqual([]);
        }
    });

    it("liest GeoJSON: Polygon, MultiPolygon, LineString; alles andere ist leer", () => {
        expect(alsFlaeche(polygon)).toHaveLength(1);
        expect(alsFlaeche(mehrfach)).toHaveLength(2);
        expect(alsFlaeche(punkt)).toEqual([]);
        expect(alsFlaeche(linie)).toEqual([]);
        expect(alsFlaeche(null)).toEqual([]);
        expect(alsLinie(linie)).toHaveLength(3);
        expect(alsLinie(polygon)).toEqual([]);
        expect(alsLinie(JSON.stringify({ type: "MultiLineString", coordinates: [[[1, 2]]] }))).toEqual([]);
        expect(alsLinie(null)).toEqual([]);
    });
});

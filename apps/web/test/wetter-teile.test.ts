import { describe, expect, it } from "vitest";
import { PbfWriter } from "pbf";
import {
    WETTER_PRESET_VORGABEN,
    WETTER_SYMBOL_VORGABEN,
    WETTER_URL,
    wetterJahreswerte,
    wettermodellVorgaben,
    type WetterJahrSpalte,
} from "@avesmaps3d/shared";
import { ladeWetterDaten, modellFuerEngine } from "../src/map/wetter/wetter-daten.ts";
import { WETTER_VORGABEN } from "../src/map/wetter/engine/wetter-engine.ts";
import { tageZwischen } from "../src/map/wetter/wetter-jahr.ts";
import { wetterTag } from "../src/map/wetter/wetter-schalter.ts";
import { symboleFuerEngine } from "../src/map/wetter/wetter-symbole.ts";
import { leseMvtEbene } from "../src/map/wetter/wetter-mvt.ts";

/**
 * Teile des Wetters, die WI-0288 aus dem Prototyp gelöst hat: die Jahreszeit aus den Presets, der Leseweg (Stufe 2) und der eigene Leser
 * für die Vegetationskacheln. Am echten Stapel stimmte der Leser in allen 7.033 Objekten und 291.898 Punkten der vier Kacheln von Zoom 1
 * mit `@mapbox/vector-tile` überein (Vergleich 2026-11-07 im Scratchpad); hier steht die Form fest.
 */

const zickzack = (n: number): number => (n < 0 ? -2 * n - 1 : 2 * n);

/** Eine Kachel mit einer Ebene: zwei Objekte, ein Quadrat mit Loch und ein Punkt; Werte als Text, Ganzzahl, Kommazahl, Wahrheit. */
function kachel(): Uint8Array {
    const ebene = new PbfWriter();
    ebene.writeVarintField(15, 2);
    ebene.writeStringField(1, "region_area_render");
    // Quadrat 0..10 mit Loch 2..4, je Zeile ein Befehl mit seinen Zahlen.
    // prettier-ignore
    const quadrat = [
        1 | (1 << 3), zickzack(0), zickzack(0),
        2 | (3 << 3), zickzack(10), zickzack(0), zickzack(0), zickzack(10), zickzack(-10), zickzack(0),
        7 | (1 << 3),
        1 | (1 << 3), zickzack(2), zickzack(-8),
        2 | (2 << 3), zickzack(2), zickzack(0), zickzack(0), zickzack(2),
        7 | (1 << 3),
    ];
    const objekte: [number[], number[]][] = [
        [[0, 0, 1, 1, 2, 2], quadrat],
        [
            [0, 3, 3, 4],
            [1 | (1 << 3), zickzack(5), zickzack(6)],
        ],
    ];
    for (const [marken, geometrie] of objekte) {
        const o = new PbfWriter();
        o.writePackedVarint(2, marken);
        o.writeVarintField(3, 3);
        o.writePackedVarint(4, geometrie);
        ebene.writeBytesField(2, o.finish());
    }
    for (const k of ["region_layer", "stack_order", "anteil", "sichtbar"]) ebene.writeStringField(3, k);
    const werte: ((w: PbfWriter) => void)[] = [
        (w) => w.writeStringField(1, "vegetation"),
        (w) => w.writeSVarintField(6, -3),
        (w) => w.writeDoubleField(3, 0.25),
        (w) => w.writeStringField(1, "wald"),
        (w) => w.writeBooleanField(7, true),
    ];
    for (const schreibe of werte) {
        const w = new PbfWriter();
        schreibe(w);
        ebene.writeBytesField(4, w.finish());
    }
    ebene.writeVarintField(5, 4096);
    const k = new PbfWriter();
    k.writeBytesField(3, ebene.finish());
    return k.finish();
}

describe("Vektorkachel lesen", () => {
    it("liest Eigenschaften und Ringe wie loadGeometry, ClosePath wiederholt den ersten Punkt", () => {
        const ebene = leseMvtEbene(kachel(), "region_area_render");
        expect(ebene?.extent).toBe(4096);
        expect(ebene?.objekte.map((o) => o.eigenschaften)).toEqual([
            { region_layer: "vegetation", stack_order: -3, anteil: 0.25 },
            { region_layer: "wald", sichtbar: true },
        ]);
        expect(ebene?.objekte[0]?.ringe).toEqual([
            [
                { x: 0, y: 0 },
                { x: 10, y: 0 },
                { x: 10, y: 10 },
                { x: 0, y: 10 },
                { x: 0, y: 0 },
            ],
            [
                { x: 2, y: 2 },
                { x: 4, y: 2 },
                { x: 4, y: 4 },
                { x: 2, y: 2 },
            ],
        ]);
        expect(ebene?.objekte[1]?.ringe).toEqual([[{ x: 5, y: 6 }]]);
    });

    it("eine fehlende Ebene ist undefined", () => {
        expect(leseMvtEbene(kachel(), "path_render")).toBeUndefined();
        expect(leseMvtEbene(new Uint8Array(), "region_area_render")).toBeUndefined();
    });
});

describe("Jahreszeit aus den Presets", () => {
    const jahreswert = (k: WetterJahrSpalte, tag: number | null): number =>
        wetterJahreswerte(WETTER_PRESET_VORGABEN, tag)[k];

    it("ohne Reisebeginn gilt der Kartenstandard WETTER_VORGABEN, am 15. Rahja (Tag 345) ebenso", () => {
        expect(wetterTag(null)).toBeNull();
        for (const k of ["tn", "ts", "sunEl", "cov", "thick", "wind", "stuerme", "evapMeer"] as const) {
            expect(jahreswert(k, null)).toBe(WETTER_VORGABEN[k]);
            expect(jahreswert(k, 345)).toBeCloseTo(WETTER_VORGABEN[k], 9);
        }
    });

    it("die Tage des Namenlosen liegen hinter dem 30. Rahja; ihr Preset liegt am 3. Tag", () => {
        expect(wetterTag({ month: "rahja", day: 30 })).toBe(360);
        expect(wetterTag({ month: "namenlos", day: 3 })).toBe(363);
        // Am 3. Tag des Namenlosen gilt dessen Preset (Sonnenkraft 0,75), am 15. Praios das Praios-Preset.
        expect(jahreswert("sunPower", 363)).toBeCloseTo(0.75, 9);
        expect(jahreswert("sunPower", 15)).toBeCloseTo(WETTER_PRESET_VORGABEN[1]!.werte.sunPower, 9);
    });

    it("der Sprung zwischen zwei Daten zählt über den Jahreswechsel, von und nach „unbestimmt“ als 15 Tage", () => {
        expect(tageZwischen(10, 40)).toBe(30);
        expect(tageZwischen(360, 5)).toBe(10);
        expect(tageZwischen(null, 120)).toBe(15);
        expect(tageZwischen(120, null)).toBe(15);
        expect(tageZwischen(null, null)).toBe(0);
    });
});

describe("Leseweg und Vorgaben der Engine (Stufe 2)", () => {
    it("🔴 WETTER_VORGABEN der Engine: Wettermodell und Kartenstandard aus dem geteilten Paket, die Auflösung „auto“", () => {
        expect(WETTER_VORGABEN).toMatchObject({
            ...modellFuerEngine(wettermodellVorgaben()),
            res: "auto",
            wolken: true,
            partikel: false,
        });
        expect(WETTER_VORGABEN).toMatchObject({
            conf: 1.35,
            tn: -6,
            takt: 30,
            mittelAb: 900,
            nahVoll: 45,
            eFern: 2560,
        });
        expect(modellFuerEngine({ ...wettermodellVorgaben(), res: 0.5 })["res"]).toBe(0.5);
    });

    it("🔴 ohne Antwort, mit Fehler oder mit Unsinn gelten die Vorgaben", async () => {
        const kaputt = (async () => {
            throw new Error("weg");
        }) as unknown as typeof fetch;
        expect((await ladeWetterDaten(kaputt)).nurVorgaben).toBe(true);
        const fehler = (async () => new Response("nein", { status: 503 })) as unknown as typeof fetch;
        expect((await ladeWetterDaten(fehler)).nurVorgaben).toBe(true);
        const unsinn = (async () => Response.json({ presets: "x" })) as unknown as typeof fetch;
        expect((await ladeWetterDaten(unsinn)).presets).toBe(WETTER_PRESET_VORGABEN);
    });

    it("eine Antwort kommt an, die Icons in der Form der Engine", async () => {
        let gefragt = "";
        const symbole = WETTER_SYMBOL_VORGABEN.map((symbol, i) => ({ ...symbol, sichtbar: i !== 0, revision: 0 }));
        const antwort = (async (url: string) => {
            gefragt = url;
            return Response.json({
                presets: WETTER_PRESET_VORGABEN.map((preset) => ({ ...preset, revision: 0 })),
                symbole,
                modell: { revision: 1, werte: { ...wettermodellVorgaben(), conf: 2 }, verstellt: ["conf"] },
                quelle: { presets: "vorgabe", symbole: "vorgabe", modell: "gespeichert" },
            });
        }) as unknown as typeof fetch;
        const daten = await ladeWetterDaten(antwort);
        expect(gefragt).toBe(WETTER_URL);
        expect(daten.nurVorgaben).toBe(false);
        expect(daten.modell["conf"]).toBe(2);
        const engine = symboleFuerEngine(daten.symbole);
        expect(engine).toHaveLength(13);
        // Der Westwind des Prototyps zeigt wieder nach Osten mit −0,153 im Bogenmaß; ausgeblendet wirkt er weiter.
        expect(engine[0]).toMatchObject({ kind: "wind", x: 341, z: 617, s: 12.04, r: 150, sichtbar: false });
        expect(engine[0]!.dir).toBeCloseTo(-0.153, 9);
        expect(engine[3]).toMatchObject({ kind: "wirbel", spin: -1, dir: 0 });
    });

    it("🔴 ein Mahlstrom wird zur Quelle der Engine mit Drehsinn und Stärke, ohne Richtung", () => {
        const [quelle] = symboleFuerEngine([
            {
                id: "0288aaaa-0000-4000-8000-000000000003",
                art: "mahlstrom",
                name: null,
                nameZeigen: false,
                sichtbar: true,
                x: 10,
                z: 20,
                reichweite: 60,
                staerke: 4,
                richtung: null,
                drehsinn: 1,
                wikiTitel: null,
            },
        ]);
        expect(quelle).toMatchObject({ kind: "mahlstrom", spin: 1, s: 4, r: 60, dir: 0 });
    });
});

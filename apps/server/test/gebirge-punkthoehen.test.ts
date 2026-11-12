import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
    buildMountainRaster,
    durchhangTiefen,
    faelltZumFreienEnde,
    kammPunktHoehen,
    kegelProminenz,
    linieMitHoehen,
    nebengipfelVorgabe,
    punktHoehen,
    rechneRueckennetz,
    rueckennetzRegler,
    talBoden,
    typVorschlag,
    type Kamm,
    type NetzLinie,
    type RueckenErgebnis,
    type V12Input,
} from "@avesmaps3d/shared";
import { AVENTURIA_TERRAIN_RECIPES } from "../src/terrain/domain/recipes.ts";
import { zelleAn } from "./support/gebirge-form.ts";

/**
 * Höhen je Punkt im Rückennetz (WI-0249 P9; Betreiber 2026-10-24: „ich will, dass kämme, nebengipfel, täler und mulden definierte höhen
 * haben“). Rein, ohne Datenbank.
 *
 * Problemfälle: Eine Linie ohne eigene Punkthöhe rechnet anders als vorher (Fassung 17, 18 oder 19 nicht bytegleich, Fingerabdruck der Saat
 * geändert); ein Stützpunkt mit eigener Höhe trägt nicht genau sie; der Durchhang wirkt gegen die Kammhöhe statt gegen die Verbindung der
 * beiden Nachbarhöhen; ein Talstützpunkt gibt die Sohle nicht vor; die Vorgaben im Editor weichen von der Rechnung ab.
 */

interface Fall {
    input: V12Input;
    kaemmeLang?: Kamm[];
}
const blutzinnen = JSON.parse(
    readFileSync(new URL("./fixtures/rueckennetz/blutzinnen.json", import.meta.url), "utf8"),
) as Fall;

const sha = (h: Float64Array) =>
    createHash("sha1")
        .update(Buffer.from(h.buffer, h.byteOffset, h.byteLength))
        .digest("hex")
        .slice(0, 12);
/** Jede Linie mit einer Liste nur aus `null`: das Modell muss sie wie „keine Punkthöhen“ lesen. */
const nurVorgaben = (kaemme: readonly NetzLinie[]): NetzLinie[] =>
    kaemme.map((k) => ({ ...k, hoehen: k.punkte.map(() => null) }));

describe("Punkthöhen: ohne eigene Höhe Zeichen für Zeichen wie zuvor", () => {
    const input = { ...blutzinnen.input, zelle: 0.5 };
    it("in den Fassungen 17, 18 und 19 (Saat des Geländes, Typ Kette, mit Tälern und Mulde)", () => {
        const mitSenken: V12Input = {
            ...input,
            kaemme: [
                ...input.kaemme!,
                {
                    punkte: [
                        [442, 694],
                        [446, 690],
                        [450, 686],
                    ],
                    rang: "tal",
                },
            ],
            mulden: [{ x: 452, y: 676, h: null }],
        };
        for (const version of [17, 18, 19]) {
            const gruppe = AVENTURIA_TERRAIN_RECIPES.get(version)?.gebirgsPresets ?? null;
            const regler = rueckennetzRegler(gruppe, "kettengebirge", {});
            const ohne = buildMountainRaster({ ...mitSenken, rueckennetz: regler });
            const leer = buildMountainRaster({
                ...mitSenken,
                kaemme: nurVorgaben(mitSenken.kaemme!),
                rueckennetz: regler,
            });
            expect(sha(leer.h), `Fassung ${String(version)}`).toBe(sha(ohne.h));
        }
    }, 120_000);

    it("die Linie im Vertrag trägt ohne eigene Höhe kein Feld `hoehen` (Fingerabdruck der Saat bleibt)", () => {
        const punkte: [number, number][] = [
            [1, 2],
            [3, 4],
        ];
        expect(JSON.stringify(linieMitHoehen(punkte, "haupt", null))).toBe(JSON.stringify({ punkte, rang: "haupt" }));
        expect(JSON.stringify(linieMitHoehen(punkte, "haupt", [null, null]))).toBe(
            JSON.stringify({ punkte, rang: "haupt" }),
        );
        // Eine Liste anderer Länge zählt als keine, Werte werden auf ganze Schritt in den Grenzen gelegt.
        expect(linieMitHoehen(punkte, "tal", [5])).toEqual({ punkte, rang: "tal" });
        expect(linieMitHoehen(punkte, "neben", [70000.4, null])).toEqual({
            punkte,
            rang: "neben",
            hoehen: [65535, null],
        });
    });
});

describe("Punkthöhen: Kämme", () => {
    // Ein Hauptkamm West–Ost (Punkte bei x = 4, 10, 20, 34), ohne Rauschen und ohne den Sattel der V12 (wie die Durchhang-Fälle in
    // `gebirge-rueckennetz.test.ts`).
    const basis: V12Input = {
        bounds: { min_x: 0, min_y: 0, max_x: 40, max_y: 30 },
        geometry: {
            type: "Polygon",
            coordinates: [
                [
                    [0, 0],
                    [40, 0],
                    [40, 30],
                    [0, 30],
                    [0, 0],
                ],
            ],
        },
        peaks: [],
        kurve: null,
        fluesse: [],
        seen: [],
        regler: { koernung: 9, stufen: 4, erosion: 3, maximalhoehe: 2400, rauschen: 0, sattel: 1 },
        saat: 4711,
        zelle: 0.25,
    };
    const kamm = (hoehen?: (number | null)[]): NetzLinie => ({
        punkte: [
            [4, 15],
            [10, 15],
            [20, 15],
            [34, 15],
        ],
        rang: "haupt",
        ...(hoehen ? { hoehen } : {}),
    });
    const t = typVorschlag("kettengebirge");
    const rechne = (linie: NetzLinie, durchhang?: number): RueckenErgebnis =>
        rechneRueckennetz(
            { ...basis, kaemme: [linie] },
            {
                struktur: t.struktur,
                form: { ...t.form, kammMuster: 0, ...(durchhang === undefined ? {} : { durchhang }) },
            },
            { stufe: "grundform", talbodenFest: 0.3, hypsometrie: false },
        );
    const hoehe = (e: RueckenErgebnis, x: number, y = 15) => e.h[zelleAn(e, x, y)] as number;

    it("ein Stützpunkt mit eigener Höhe trägt genau sie; dazwischen geht die Höhe linear über", () => {
        const e = rechne(kamm([2400, 1200, null, 1800]));
        const gewicht = e.netz.kanten.find((k) => k.quelle === "gezeichnet")!.gewicht;
        expect(gewicht[0]).toBe(2400 / 2400);
        expect(gewicht[1]).toBe(1200 / 2400);
        expect(gewicht[3]).toBe(1800 / 2400);
        // x = 20 liegt bei 10 von 24 E zwischen 1200 und 1800 (Unruhe 0,9 bis 1).
        expect(gewicht[2]! * 2400).toBeGreaterThan(0.89 * (1200 + (600 * 10) / 24));
        expect(gewicht[2]! * 2400).toBeLessThan(1.01 * (1200 + (600 * 10) / 24));
        // Auf der Achse steht der Kamm bei x = 10 auf seiner Höhe; ohne eigene Höhen (Rangvorgabe Hauptkamm) liegt er deutlich höher.
        expect(Math.abs(hoehe(e, 10) - 1200)).toBeLessThan(30);
        expect(hoehe(rechne(kamm()), 10)).toBeGreaterThan(hoehe(e, 10) + 500);
    }, 60_000);

    it("der Durchhang wirkt gegen die Verbindung der beiden Nachbarhöhen, die Punkte bleiben", () => {
        const linie = kamm([1600, 1600, 2400, 2400]);
        const ohne = rechne(linie);
        const mit = rechne(linie, 0.15);
        // Zwischen 10 (1600) und 20 (2400): der Sattel liegt unter der Verbindung, bei x = 15 also unter ihrem Mittel.
        const verbindung = (hoehe(ohne, 10) + hoehe(ohne, 20)) / 2;
        expect(Math.abs(hoehe(ohne, 15) - verbindung)).toBeLessThan(0.02 * verbindung);
        expect(hoehe(mit, 15)).toBeLessThan(verbindung * (1 - 0.08));
        expect(hoehe(mit, 15)).toBeGreaterThan(verbindung * (1 - 0.2));
        for (const x of [10, 20]) expect(Math.abs(hoehe(mit, x) - hoehe(ohne, x))).toBeLessThan(2);
        // Ein freies Ende mit eigener Höhe trägt: Das erste Segment hängt durch, ohne eigene Höhe nicht.
        const tiefen = durchhangTiefen([linie], [], { haupt: 0.15, neben: 0.2 });
        expect(tiefen[0]![0]).toBeGreaterThan(0);
        expect(durchhangTiefen([kamm()], [], { haupt: 0.15, neben: 0.2 })[0]![0]).toBe(0);
    }, 60_000);
});

describe("Punkthöhen: Täler", () => {
    it("ein Talstützpunkt mit eigener Höhe gibt die Sohle vor; ohne eigene bleibt der Boden des Talbodens", () => {
        const input = { ...blutzinnen.input, zelle: 0.5 };
        const tal = (hoehen?: (number | null)[]): NetzLinie => ({
            punkte: [
                [442, 694],
                [446, 690],
                [450, 686],
            ],
            rang: "tal",
            ...(hoehen ? { hoehen } : {}),
        });
        const rechne = (linie: NetzLinie) =>
            rechneRueckennetz(input, "kettengebirge", {
                kaemme: [...input.kaemme!, linie],
                stufe: "grundform",
                talbodenFest: 0.4,
            });
        const tief = rechne(tal([50, 50, 50]));
        const vorgabe = rechne(tal());
        // Ohne eigene Höhe laufen die freien Enden aus (Talboden 289 nur in der Mitte); mit eigener Höhe drückt das Tal an jedem
        // Stützpunkt auf seine Sohle (die Zellmitte liegt neben der Achse: ein Rest des V bleibt).
        for (const [x, y] of [
            [442, 694],
            [446, 690],
            [450, 686],
        ] as const) {
            const k = zelleAn(tief, x, y);
            expect(tief.h[k]!).toBeLessThan(vorgabe.h[k]! - 50);
            expect(tief.h[k]!).toBeLessThan(250);
        }
    }, 60_000);
});

describe("Punkthöhen: die Vorgaben im Editor (`punktHoehen`)", () => {
    it("zeigt eigene Werte als eigen und an Punkten ohne Wert die Vorgabe der Rechnung", () => {
        const lage = { kammhoehe: 3000, peaks: [{ x: 10, y: 10, h: 3600 }], talboden: 0.3 };
        const netz = {
            kaemme: [
                {
                    punkte: [
                        [10, 10],
                        [14, 10],
                        [18, 10],
                    ] as [number, number][],
                    rang: "haupt" as const,
                },
                {
                    punkte: [
                        [18, 10],
                        [18, 16],
                    ] as [number, number][],
                    rang: "neben" as const,
                    hoehen: [null, 2500],
                },
                {
                    punkte: [
                        [20, 20],
                        [24, 20],
                    ] as [number, number][],
                    rang: "tal" as const,
                },
            ],
            nebengipfel: [
                { x: 30, y: 30, h: null },
                { x: 32, y: 30, h: 2222 },
            ],
            mulden: [{ x: 24, y: 20, h: null }],
        };
        const h = punktHoehen(netz, lage);
        // Der Kamm beginnt am Gipfel: Er trägt dessen Höhe als Vorgabe.
        expect(h.linien[0]![0]).toEqual({ h: 3600, eigen: false });
        // Dieselbe Rechnung wie die Saat (ohne Unruhe).
        const roh = kammPunktHoehen(
            netz.kaemme,
            [
                { x: 10, y: 10, h: 3600 },
                { x: 30, y: 30, h: 2400 },
                { x: 32, y: 30, h: 2222 },
            ],
            3000,
        );
        expect(h.linien[0]!.map((p) => p.h)).toEqual(roh[0]!.map(Math.round));
        expect(h.linien[1]![1]).toEqual({ h: 2500, eigen: true });
        // Täler und Mulden ohne eigene Höhe: der abgeleitete Talboden.
        const boden = talBoden(3000, 0.3);
        expect(h.linien[2]!.map((p) => p.h)).toEqual([boden, boden]);
        expect(h.mulden[0]).toEqual({ h: boden, eigen: false });
        expect(h.nebengipfel).toEqual([
            { h: nebengipfelVorgabe(3000, 0.3), eigen: false },
            { h: 2222, eigen: true },
        ]);
    });
});

describe("Punkthöhen sind absolut: die Ableitung des Talbodens ignoriert sie", () => {
    // Betreiber 2026-10-25 (Stage): „wenn ich einen gipfel erhöhe, dann senkt sich das restliche gebirge ab. wenn ich einen gipfel senke, dann
    // hebt sich das gebirge wieder.“ Ursache: Die Suche nach dem Talboden (HI-Band oder Durchschnittshöhe) sah die Punkthöhen; ein höherer
    // Punkt hob Höchsthöhe und Mittel an, die Suche setzte den Talboden um, und das ganze Gebirge zog mit. Problemfälle: der abgeleitete Talboden
    // hängt an einer Punkthöhe; Zellen weit weg vom geänderten Punkt wandern mit.
    const basis: V12Input = {
        bounds: { min_x: 0, min_y: 0, max_x: 40, max_y: 30 },
        geometry: {
            type: "Polygon",
            coordinates: [
                [
                    [0, 0],
                    [40, 0],
                    [40, 30],
                    [0, 30],
                    [0, 0],
                ],
            ],
        },
        peaks: [],
        kurve: null,
        fluesse: [],
        seen: [],
        regler: { koernung: 9, stufen: 4, erosion: 3, maximalhoehe: 2400, rauschen: 0, sattel: 1 },
        saat: 4711,
        zelle: 0.5,
    };
    const t = typVorschlag("kettengebirge");
    const rechne = (letzte: number, ziel: "hi" | "mittel"): RueckenErgebnis =>
        rechneRueckennetz(
            {
                ...basis,
                kaemme: [
                    {
                        punkte: [
                            [4, 15],
                            [10, 15],
                            [20, 15],
                            [34, 15],
                        ],
                        rang: "haupt",
                        hoehen: [1800, 1800, 1800, letzte],
                    },
                ],
            },
            { struktur: t.struktur, form: { ...t.form } },
            { stufe: "grundform", band: t.band, ...(ziel === "mittel" ? { mittelZiel: 700 } : {}) },
        );
    // Weit vom Punkt bei x = 34: der Kamm weiter westlich und seine Flanken. Die Grundform (nur die Hebung) ist hier ohne die Zufälle der Erosion; die
    // Ableitung des Talbodens rechnet auch dann ihre Proben als Landschaft.
    const FERN: [number, number][] = [
        [10, 8],
        [10, 22],
        [4, 19],
        [14, 22],
    ];
    const hoehe = (e: RueckenErgebnis, x: number, y: number) => e.h[zelleAn(e, x, y)] as number;

    for (const ziel of ["hi", "mittel"] as const) {
        it(`ein höherer oder tieferer Punkt lässt Talboden und Rest des Gebirges stehen (${ziel === "hi" ? "HI-Band" : "Durchschnittshöhe"})`, () => {
            const gleich = rechne(1800, ziel);
            const hoeher = rechne(2400, ziel);
            const tiefer = rechne(1200, ziel);
            // Der abgeleitete Talboden hängt nur an der Vorgabe-Form, nicht an der Höhe eines Punkts.
            expect(hoeher.talboden).toBe(gleich.talboden);
            expect(tiefer.talboden).toBe(gleich.talboden);
            // Der Punkt selbst folgt seiner Höhe, der Rest bleibt (vorher wanderten diese Zellen um mehrere hundert Schritt).
            expect(hoehe(hoeher, 34, 15)).toBeGreaterThan(hoehe(gleich, 34, 15) + 400);
            expect(hoehe(tiefer, 34, 15)).toBeLessThan(hoehe(gleich, 34, 15) - 100);
            for (const [x, y] of FERN) {
                expect(
                    Math.abs(hoehe(hoeher, x, y) - hoehe(gleich, x, y)),
                    `(${String(x)}, ${String(y)}) höher`,
                ).toBeLessThan(5);
                expect(
                    Math.abs(hoehe(tiefer, x, y) - hoehe(gleich, x, y)),
                    `(${String(x)}, ${String(y)}) tiefer`,
                ).toBeLessThan(5);
            }
        }, 120_000);
    }
});

describe("Fassung 19: Nebengipfel- und Muldenhöhen verschieben den Talboden nicht", () => {
    // Vali 2026-10-25: „Ja: Nebengipfel- und Muldenhöhen sollen den Talboden auch nicht mehr verschieben, aber nur in Fassung 19 (17 und 18
    // bleiben bytegleich).“ Problemfälle: In Fassung 19 hängt der abgeleitete Talboden an der Höhe eines Nebengipfels oder einer Mulde; in
    // Fassung 18 ändert sich etwas (der Schalter wirkt dort), das Bytegleich der Fassungen 17 und 18 hält der Test oben.
    const input = { ...blutzinnen.input, zelle: 1 };
    const talboden = (version: number, nebenH: number, muldeH: number | null): number | undefined => {
        const gruppe = AVENTURIA_TERRAIN_RECIPES.get(version)?.gebirgsPresets ?? null;
        const regler = rueckennetzRegler(gruppe, "kettengebirge", {});
        return buildMountainRaster({
            ...input,
            nebengipfel: input.nebengipfel!.map((n, i) => (i === 5 ? { ...n, h: nebenH } : n)),
            mulden: [{ x: 452, y: 676, h: muldeH }],
            rueckennetz: regler,
        }).talboden;
    };

    it("der Schalter hängt an der Fassung: nur mit Presets (Fassung 19) gesetzt", () => {
        const gruppe = (version: number) => AVENTURIA_TERRAIN_RECIPES.get(version)?.gebirgsPresets ?? null;
        expect(rueckennetzRegler(gruppe(19), "kettengebirge", {}).punktHoehenAbsolut).toBe(true);
        for (const version of [17, 18])
            expect(rueckennetzRegler(gruppe(version), "kettengebirge", {})).not.toHaveProperty("punktHoehenAbsolut");
    });

    it("Fassung 19 hält den Talboden bei geänderter Nebengipfel- und Muldenhöhe konstant, Fassung 18 nicht", () => {
        const f19 = [
            talboden(19, 2100, null),
            talboden(19, 4000, null),
            talboden(19, 2100, 100),
            talboden(19, 800, 3000),
        ];
        expect(new Set(f19).size).toBe(1);
        const f18 = [
            talboden(18, 2100, null),
            talboden(18, 4000, null),
            talboden(18, 2100, 100),
            talboden(18, 800, 3000),
        ];
        expect(new Set(f18).size).toBeGreaterThan(1);
    }, 240_000);
});

describe("Eine Punkthöhe verschiebt nur ihren Punkt (Blutzinnen, Fassung 19, echte Kämme)", () => {
    // Betreiber 2026-10-25 (Stage): „kammhöhen, lassen sich nicht in der höhe verschieben. das gebirge drumrum senkt sich ab“. Problemfälle: Der
    // gezogene Punkt folgt seiner Höhe nicht; das Gelände fern vom Punkt wandert mit (vorher der abgeleitete Talboden: bis 243 Schritt); die
    // grobe Vorschau rechnet nach dem Ziehen mit dem Talboden des Typs statt dem abgeleiteten (Blutzinnen: 0,2 statt 0,85, im Mittel 527 Schritt
    // tiefer, bis 1.561). Der Punkt liegt genau auf einem Nebengipfel (so rastet der Editor ein), hat wie jeder Punkt eine eigene Höhe, und Punkt
    // und Nebengipfel werden zusammen gesetzt (der Editor setzt jeden deckungsgleichen Punkt, `mitHoehen`).
    const gruppe = AVENTURIA_TERRAIN_RECIPES.get(19)?.gebirgsPresets ?? null;
    const regler = rueckennetzRegler(gruppe, "kettengebirge", {});
    const NEBEN = 3;
    const nebengipfel = blutzinnen.input.nebengipfel!;
    const ziel = nebengipfel[NEBEN]!;
    const lang = blutzinnen.kaemmeLang!;
    const abstand = (s: number): number => Math.hypot(lang[0]!.punkte[s]![0] - ziel.x, lang[0]!.punkte[s]![1] - ziel.y);
    let stelle = 0;
    lang[0]!.punkte.forEach((_, s) => {
        if (abstand(s) < abstand(stelle)) stelle = s;
    });
    const kaemme0: Kamm[] = lang.map((k, i) =>
        i === 0
            ? { ...k, punkte: k.punkte.map((p, s) => (s === stelle ? [ziel.x, ziel.y] : [...p])) as [number, number][] }
            : k,
    );
    const vorgabe = kammPunktHoehen(
        kaemme0,
        [...blutzinnen.input.peaks, ...nebengipfel].map((p) => ({
            x: p.x,
            y: p.y,
            h: Number(p.h) > 0 ? Number(p.h) : 2300,
        })),
        2300,
        0.92,
    )[0]!;
    /** Jeder Punkt des Hauptkamms mit eigener Höhe; der Punkt auf dem Nebengipfel und der Nebengipfel um `zus` verschoben. */
    const mit = (zus: number) => ({
        kaemme: kaemme0.map((k, i) =>
            i === 0
                ? {
                      ...k,
                      hoehen: k.punkte.map((_, s) => Math.round(s === stelle ? Number(ziel.h) + zus : vorgabe[s]!)),
                  }
                : k,
        ),
        nebengipfel: nebengipfel.map((n, i) => (i === NEBEN ? { ...n, h: Number(n.h) + zus } : n)),
    });
    const fern = (e: { w: number; bounds: { min_x: number; min_y: number }; cell: number }, k: number): number =>
        Math.hypot(
            e.bounds.min_x + (k % e.w) * e.cell - ziel.x,
            e.bounds.min_y + Math.floor(k / e.w) * e.cell - ziel.y,
        );

    for (const zus of [600, -600]) {
        it(`Gelände: der Punkt folgt seiner Höhe (${String(zus)} Schritt), das Gebirge fern davon bleibt (Talboden gleich)`, () => {
            const rechne = (z: number) =>
                buildMountainRaster({ ...blutzinnen.input, zelle: 0.5, ...mit(z), rueckennetz: regler });
            const vorher = rechne(0);
            const nachher = rechne(zus);
            const k = zelleAn(vorher, ziel.x, ziel.y);
            // Kodierung des Geländes: auf ganze Schritt gerundet (`rasterSamples`).
            expect(Math.round(vorher.h[k]!)).toBe(Number(ziel.h));
            expect(Math.abs(Math.round(nachher.h[k]!) - (Number(ziel.h) + zus))).toBeLessThanOrEqual(1);
            expect(nachher.talboden).toBe(vorher.talboden);
            let weit = 0;
            let summe = 0;
            let ausreisser = 0;
            let groesste = 0;
            for (let m = 0; m < vorher.h.length; m++) {
                if (!vorher.eigen[m] || fern(vorher, m) <= 12) continue;
                const d = Math.abs(nachher.h[m]! - vorher.h[m]!);
                weit++;
                summe += d;
                if (d > 15) ausreisser++;
                groesste = Math.max(groesste, d);
            }
            expect(weit).toBeGreaterThan(1000);
            // Rest: die Massenbilanz der Erosion (alle freien Zellen heben sich um den Abtrag) und ein paar Zellen, in denen sich eine Rinne um
            // die tieferen Kegel anderer Nebengipfel umlegt (Neigung 0,2: höchstens 3 % der Zellen, bis 70 Schritt, an Zusammenflüssen 13 bis 20 E
            // weit; mit der alten Neigung 0,08 keine und höchstens 5 Schritt); nicht 243 Schritt im ganzen Gebirge wie mit wanderndem Talboden.
            expect(ausreisser / weit).toBeLessThan(0.05);
            expect(groesste).toBeLessThan(100);
            expect(summe / weit).toBeLessThan(5);
        }, 120_000);
    }

    it("Vorschau: mit dem gemerkten Talboden bleibt das Gebirge fern vom gezogenen Punkt stehen, grob wie fein", () => {
        // Wie `rechneVorschau` (apps/web/src/gebirge-vorschau/rechnen.ts) mit den Reglern der Fassung 19.
        const vorschau = (z: number, kante: number, talbodenFest: number | undefined) => {
            const zelle = Math.max(0.25, 52 / kante);
            return rechneRueckennetz(
                { ...blutzinnen.input, zelle, vorschauZelleMin: 0.25 },
                { struktur: regler.struktur, form: regler.form },
                {
                    kaemme: mit(z).kaemme,
                    nebengipfel: mit(z).nebengipfel.map((n) => ({
                        x: n.x,
                        y: n.y,
                        ...(n.h === null ? {} : { h: n.h }),
                    })),
                    mulden: [],
                    stufe: "landschaft",
                    hypsometrie: talbodenFest === undefined,
                    talbodenFest,
                    band: regler.band,
                    gratMin: regler.gratMin,
                    punktHoehenAbsolut: true,
                },
            );
        };
        const fein0 = vorschau(0, 640, undefined);
        const fein1 = vorschau(600, 640, undefined);
        // Die Ableitung sieht die Punkthöhen nicht: derselbe Talboden, den die Oberfläche unter einem Schlüssel ohne Punkthöhen behält.
        expect(fein1.talboden).toBe(fein0.talboden);
        const grob0 = vorschau(0, 96, fein0.talboden);
        const grob1 = vorschau(600, 96, fein0.talboden);
        const k = zelleAn(grob1, ziel.x, ziel.y);
        expect(grob1.h[k]!).toBeGreaterThan(grob0.h[k]! + 400);
        let weit = 0;
        let summe = 0;
        for (let m = 0; m < grob0.h.length; m++) {
            if (!grob0.eigen[m] || fern(grob0, m) <= 12) continue;
            weit++;
            summe += grob1.h[m]! - grob0.h[m]!;
        }
        expect(weit).toBeGreaterThan(300);
        // Gemessen +3 im Mittel (Massenbilanz der Erosion); mit dem Talboden des Typs lagen dieselben Zellen 527 Schritt tiefer.
        expect(Math.abs(summe / weit)).toBeLessThan(20);
    }, 240_000);
});

describe("Nebengipfel sind spitze Kegel, auch auf Kammhöhe und höher gezogen (Blutzinnen, Fassung 19)", () => {
    // Betreiber 2026-10-25 (Stage): „die nebengipfel sehen aus wie tafelberge, vorher hatte ich einen spitz hinbekommen, aber ich weiß nicht mehr
    // wie, … jetzt krieg ichs nicht mehr hin, dass berge spitz sind“. Gemessen (Blutzinnen, alle 18 Nebengipfel auf Kammhöhe 2.300, der Hauptkamm
    // mit eigener Höhe an jedem Punkt, wie der Editor ihn anlegt): Die Spitze war schon vorher die höchste Stelle, ohne Plateau und ohne Kappung
    // bei der Kammhöhe oder darüber (S4: +600); nur flach: Prominenz 10 % (230 Schritt) bei Neigung 0,08 (kanonische Gipfel 0,6 bis 0,8), die acht
    // Nachbarzellen 0,25 E weit fielen 75 bis 104 Schritt, dazu die Tönung weiß auf der flachen Kammplatte. Und „Steilheit der Nebengipfel“ wirkte nur bis
    // 0,10 (Radius an der Untergrenze 0,75 E): Jeder höhere Wert änderte nichts. Problemfälle: eine Spitze ohne Fall zu den Nachbarn (Plateau); eine
    // Spitze, die ihre Höhe nicht trägt (gekappt oder durch die Mulden-Prüfung gehoben); die Steilheit ohne Wirkung.
    const regler = rueckennetzRegler(AVENTURIA_TERRAIN_RECIPES.get(19)?.gebirgsPresets ?? null, "kettengebirge", {});
    const KAMM = 2300;
    const ng = blutzinnen.input.nebengipfel!;
    /** Alle Nebengipfel auf Kammhöhe (um `zus` gehoben), der Hauptkamm mit einem Punkt auf jedem Nebengipfel in 0,9 E und eigener Höhe überall. */
    const fall = (zus: Record<number, number> = {}) => {
        const lang = blutzinnen.kaemmeLang!.map((k) => ({
            ...k,
            punkte: k.punkte.map((p) => [...p]) as [number, number][],
        }));
        const hoehen = lang[0]!.punkte.map(() => KAMM);
        ng.forEach((n, i) => {
            let beste = -1;
            let abstand = 0.9;
            lang[0]!.punkte.forEach((p, s) => {
                const d = Math.hypot(p[0] - n.x, p[1] - n.y);
                if (d < abstand) {
                    abstand = d;
                    beste = s;
                }
            });
            if (beste < 0) return;
            lang[0]!.punkte[beste] = [n.x, n.y];
            hoehen[beste] = KAMM + (zus[i] ?? 0);
        });
        return {
            kaemme: lang.map((k, i) => (i === 0 ? { ...k, hoehen } : k)),
            nebengipfel: ng.map((n, i) => ({ x: n.x, y: n.y, h: KAMM + (zus[i] ?? 0) })),
        };
    };
    const rechne = (zus: Record<number, number> = {}, kopfNeigung?: number) =>
        rechneRueckennetz(
            { ...blutzinnen.input, zelle: 0.25 },
            {
                struktur: regler.struktur,
                form: { ...regler.form, ...(kopfNeigung === undefined ? {} : { kopfNeigung }) },
            },
            {
                ...fall(zus),
                mulden: [],
                stufe: "landschaft",
                hypsometrie: false,
                talbodenFest: 0.74,
                band: regler.band,
                gratMin: regler.gratMin,
                punktHoehenAbsolut: true,
            },
        );
    /** Höhe der Spitzenzelle und der Fall zu ihren acht Nachbarzellen (Schritt): kleinster und mittlerer. */
    const spitze = (e: RueckenErgebnis, i: number) => {
        const k = zelleAn(e, ng[i]!.x, ng[i]!.y);
        const faelle: number[] = [];
        for (const dk of [-e.w - 1, -e.w, -e.w + 1, -1, 1, e.w - 1, e.w, e.w + 1])
            if (e.eigen[k + dk]) faelle.push((e.h[k] as number) - (e.h[k + dk] as number));
        return {
            h: e.h[k] as number,
            kleinster: Math.min(...faelle),
            mittlerer: faelle.reduce((a, b) => a + b, 0) / faelle.length,
        };
    };
    const alle = ng.map((_, i) => i);

    it("kegelProminenz: bis zur Radiusgrenze unverändert, darüber steigt der Kegel mit der Steilheit (Neigung = Höhe / Radius)", () => {
        expect(kegelProminenz(230, 0.08)).toBe(230);
        expect(kegelProminenz(230, 0.1)).toBe(230);
        expect(kegelProminenz(230, 0)).toBe(230);
        expect(kegelProminenz(230, 0.2)).toBeCloseTo(0.2 * 0.75 * 3000, 6);
        expect(kegelProminenz(230, 0.4)).toBeGreaterThan(kegelProminenz(230, 0.2));
    });

    it("🔴 die Spitze trägt Kammhöhe und höher gezogen ihre Höhe, ist die höchste Stelle, und die Nachbarn fallen ab (kein Plateau)", () => {
        const e = rechne({ 3: 600, 5: 600 });
        for (const i of alle) {
            const s = spitze(e, i);
            expect(
                Math.abs(s.h - (KAMM + (i === 3 || i === 5 ? 600 : 0))),
                `Nebengipfel ${String(i)}`,
            ).toBeLessThanOrEqual(1);
            // Mindestens 150 Schritt auf 0,25 E (6 % der Kammhöhe); vorher 75 bis 104 und damit ein Plateau von rund 1 E Durchmesser.
            expect(s.kleinster, `Nebengipfel ${String(i)}`).toBeGreaterThanOrEqual(150);
        }
    }, 120_000);

    it("🔴 die Steilheit wirkt auch über 0,10: steiler, je höher der Wert; 0,08 bleibt wie zuvor flach", () => {
        const flach = rechne({}, 0.08);
        const mittel = rechne({}, 0.2);
        const steil = rechne({}, 0.4);
        for (const i of [3, 5, 9]) {
            const [a, b, c] = [flach, mittel, steil].map((e) => spitze(e, i));
            // Die Spitze bleibt bei jeder Steilheit auf ihrer Höhe.
            for (const s of [a!, b!, c!]) expect(Math.abs(s.h - KAMM)).toBeLessThanOrEqual(1);
            expect(a!.kleinster, `Nebengipfel ${String(i)} flach`).toBeLessThan(110);
            expect(b!.kleinster, `Nebengipfel ${String(i)} mittel`).toBeGreaterThan(1.7 * a!.kleinster);
            expect(c!.kleinster, `Nebengipfel ${String(i)} steil`).toBeGreaterThan(1.7 * b!.kleinster);
        }
    }, 240_000);
});

describe("Punkthöhen: hinter dem letzten Knoten fällt die Linie zum freien Ende ab", () => {
    // Raschtulswall auf der Stage (2026-10-30): Punkt 0 trägt 3.200, Punkt 37 liegt auf dem Djer Tulam (9.000); die 17 Punkte dahinter
    // blieben auf 9.000 statt zum freien Ende hin abzufallen. Hier im Kleinen: Hauptkamm von x = 0 bis 40, der Gipfel bei x = 20.
    const gipfel = [{ x: 20, y: 10, h: 9000 }];
    const hauptkamm: NetzLinie = {
        punkte: [
            [0, 10],
            [10, 10],
            [20, 10],
            [30, 10],
            [40, 10],
        ],
        rang: "haupt",
        hoehen: [3200, null, null, null, null],
    };
    const sporn: NetzLinie = {
        punkte: [
            [40, 10],
            [40, 20],
        ],
        rang: "neben",
    };

    it("🔴 zum freien Ende hin linear auf 90 % des Knotens, höchstens die Kammhöhe; davor wie bisher", () => {
        const [h] = kammPunktHoehen([hauptkamm], gipfel, 1500);
        expect(h!.map(Math.round)).toEqual([
            3200, 6100, 9000,
            // Halbwegs von 9.000 nach min(1.500, 8.100); der Auslauf von 2 E wirkt erst am Ende.
            5250,
            // Das freie Ende: 1.500 mit dem Auslauf (0,6).
            900,
        ]);
        expect(faelltZumFreienEnde([hauptkamm], gipfel)).toBe(true);
    });

    it("an einem eingerasteten Ende bleibt die Höhe des Knotens; ohne offenes Ende ändert sich nichts", () => {
        const [h] = kammPunktHoehen([hauptkamm, sporn], gipfel, 1500);
        expect(h!.slice(2).map(Math.round)).toEqual([9000, 9000, 9000]);
        expect(faelltZumFreienEnde([hauptkamm, sporn], gipfel)).toBe(false);
        // Eigene Höhe am Ende, keine eigene Höhe, nur ein Tal: kein Fall der Regel (Fingerabdruck der Saat bleibt).
        expect(faelltZumFreienEnde([{ ...hauptkamm, hoehen: [3200, null, null, null, 2000] }], gipfel)).toBe(false);
        expect(faelltZumFreienEnde([{ punkte: hauptkamm.punkte, rang: "haupt" }], gipfel)).toBe(false);
        expect(faelltZumFreienEnde([{ ...hauptkamm, rang: "tal" }], gipfel)).toBe(false);
    });

    it("vor dem ersten Knoten genauso zum freien Anfang hin", () => {
        const umgekehrt: NetzLinie = {
            punkte: [...hauptkamm.punkte].reverse(),
            rang: "haupt",
            hoehen: [null, null, null, null, 3200],
        };
        const [h] = kammPunktHoehen([umgekehrt], gipfel, 1500);
        expect(h!.map(Math.round)).toEqual([900, 5250, 9000, 6100, 3200]);
    });
});

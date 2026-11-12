import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
    eigeneZiele,
    pointInGeometry,
    rechneRueckennetz,
    rueckennetzRegler,
    seePlatz,
    TREFFEN,
    TREFFEN_FLUSS_QUELLE,
    TREFFEN_QUELLE,
    TREFFEN_SEE_QUELLE,
    triffPunkte,
    type RueckenErgebnis,
    type TreffArt,
    type V12Geometry,
    type V12Input,
} from "@avesmaps3d/shared";
import { AVENTURIA_TERRAIN_RECIPES } from "../src/terrain/domain/recipes.ts";
import { treffenMarke } from "../src/terrain/inputs.ts";

/**
 * Seen wie Flüsse (WI-0259; Vali 2026-10-30 auf die Frage, ob das Ufer eines hoch gesetzten Sees nachzieht wie beim Fluss: „nein genau, das
 * verhält sich dann glaub genau gleich“): Ein See mit eigener Höhe trägt seinen Spiegel, und das Ufer folgt ihm nach den Regeln von `TREFFEN`
 * (`treffen.ts`). Ein Fluss mit eigenen Höhen schließt am Ufer an die Höhe des Sees an.
 *
 * Problemfälle: Ein See auf 1.500 über Gelände 500 steht hinter einem Damm; der Hang steigt über den Spiegel; eine Seezelle ändert sich; die
 * tiefe Seite des Ufers bleibt unter dem Spiegel (ein Median über das ganze Ufer); Fluss und See heben und senken an der Mündung dieselben
 * Zellen gegeneinander; ein Gebirge ohne Seehöhe ändert Saat oder Fingerabdruck.
 */

/** Ein Raster w × w ab (0, 0), überall `grund`; `wasser` sind Bett und See (Senke, nicht gewollt), wie die Saat (`rechne.ts`) sie sperrt. */
function feld(w: number, cell: number, grund: (x: number, y: number) => number) {
    const h = new Float64Array(w * w);
    for (let z = 0; z < w * w; z++) h[z] = grund((z % w) * cell, Math.floor(z / w) * cell);
    const wasser = new Uint8Array(w * w);
    const darf = (k: number, art: TreffArt) => art === "punkt" || wasser[k] === 0;
    return { w, hh: w, cell, x0: 0, y0: 0, h, wasser, darf };
}
type Feld = ReturnType<typeof feld>;
const k = (r: Feld, x: number, y: number) => Math.round(y / r.cell) * r.w + Math.round(x / r.cell);
const quadrat = (a: number, b: number, c: number, d: number): V12Geometry => ({
    type: "Polygon",
    coordinates: [
        [
            [a, b],
            [c, b],
            [c, d],
            [a, d],
            [a, b],
        ],
    ],
});
/** Füllt den See auf seinen Spiegel, wie `wasserFest` es tut, und sperrt ihn. Gibt seine Zellen zurück. */
function fuelle(r: Feld, see: V12Geometry, spiegel: number): number[] {
    const zellen: number[] = [];
    for (let z = 0; z < r.h.length; z++)
        if (pointInGeometry([(z % r.w) * r.cell, Math.floor(z / r.w) * r.cell], see)) {
            r.h[z] = spiegel;
            r.wasser[z] = 1;
            zellen.push(z);
        }
    return zellen;
}

describe("Seen wie Flüsse: die Regel (`triffPunkte`, `eigeneZiele`)", () => {
    it("🔴 ein See auf 1.500 in Gelände 500: das Ufer wird ein weicher Hang, fällt nach außen stetig ab, nie über 1.500; der See bleibt", () => {
        const r = feld(80, 0.1, () => 500);
        const see = quadrat(3, 3, 5, 5);
        const zellen = fuelle(r, see, 1500);
        const ziele = eigeneZiele({ seen: [{ g: see }], seeHoehen: [{ x: 4, y: 4, h: 1500 }] });
        // Das Ufer, 8 E Umfang: 16 Punkte im Abstand 0,5 E, geschlossen.
        expect(ziele.punkte.length).toBe(16);
        expect(ziele.punkte.every((p) => p.wasser === "see" && p.h === 1500)).toBe(true);
        expect(ziele.strecken.length).toBe(16);
        expect(ziele.strecken.at(-1)).toEqual([15, 0]);
        // Vorher ein Damm: am See 1.500, gleich daneben 500.
        expect(r.h[k(r, 4, 5.1)]).toBe(500);
        const bericht = triffPunkte(r, ziele);
        expect(bericht.gilt.every(Boolean)).toBe(true);
        for (const d of bericht.nachher) expect(Math.abs(d)).toBeLessThanOrEqual(1);
        for (const z of zellen) expect(r.h[z]).toBe(1500);
        // Nach jeder Seite: am Ufer der Spiegel, dann stetig fallend, weich, nach dem Hang der Grund.
        for (const [dx, dy] of [
            [0, 1],
            [0, -1],
            [1, 0],
            [-1, 0],
        ] as const) {
            const quer = Array.from(
                { length: 25 },
                (_, n) => r.h[k(r, 4 + dx * (1.1 + 0.1 * n), 4 + dy * (1.1 + 0.1 * n))]!,
            );
            expect(quer[0]!).toBeGreaterThanOrEqual(1499);
            for (let n = 1; n < quer.length; n++) {
                expect(quer[n]!).toBeLessThanOrEqual(quer[n - 1]! + 1e-9);
                expect(quer[n - 1]! - quer[n]!).toBeLessThan(300);
            }
            expect(quer.at(-1)).toBe(500);
        }
        expect(Math.max(...r.h)).toBeLessThanOrEqual(1500 + 1e-9);
    });

    it("🔴 je Uferpunkt gemessen: auch die tiefe Seite eines Ufers am Hang erreicht den Spiegel", () => {
        // Nördlich des Sees 1.450, südlich 500: Ein Median über das ganze Ufer stünde am Ziel, bevor die Südseite es erreicht.
        const r = feld(80, 0.1, (_x, y) => (y >= 4 ? 1450 : 500));
        const see = quadrat(3, 3, 5, 5);
        fuelle(r, see, 1500);
        triffPunkte(r, eigeneZiele({ seen: [{ g: see }], seeHoehen: [{ x: 4, y: 4, h: 1500 }] }));
        expect(r.h[k(r, 4, 2.9)]).toBeGreaterThanOrEqual(1490);
        expect(r.h[k(r, 4, 5.1)]).toBeGreaterThanOrEqual(1490);
        expect(Math.max(...r.h)).toBeLessThanOrEqual(1500 + 1e-9);
    });

    it("🔴 ein Fluss durch einen gehobenen See: die Kette endet und beginnt am Ufer auf der Höhe des Sees, das Ufer an der Mündung geht über", () => {
        const r = feld(100, 0.1, () => 500);
        const see = quadrat(4, 3, 6, 5);
        const zellen = fuelle(r, see, 1500);
        // Der Fluss 1.800 → 1.200 über die Bogenlänge; die Stützpunkte 4,5 und 5,5 liegen im See.
        const lauf: [number, number][] = [1, 2, 3, 4.5, 5.5, 7, 8, 9].map((x) => [x, 4]);
        for (let x = 1; x <= 9; x += 0.05) {
            const z = k(r, x, 4);
            if (r.wasser[z]) continue;
            r.h[z] = 1800 - 75 * (x - 1);
            r.wasser[z] = 1;
        }
        const ziele = eigeneZiele({
            fluesse: [{ p: lauf }],
            seen: [{ g: see }],
            flussHoehen: [
                { x: 1, y: 4, h: 1800 },
                { x: 9, y: 4, h: 1200 },
            ],
            seeHoehen: [{ x: 5, y: 4, h: 1500 }],
        });
        const an = (x: number, y: number) => ziele.punkte.findIndex((p) => Math.hypot(p.x - x, p.y - y) < 1e-9);
        // Am Ufer, wo der Lauf es kreuzt: zwei Punkte auf der Höhe des Sees, die Kette führt bis an das eine und vom anderen weiter.
        const ein = ziele.punkte.findIndex((p) => p.wasser === "see" && p.x === 4 && p.y === 4);
        const aus = ziele.punkte.findIndex((p) => p.wasser === "see" && p.x === 6 && p.y === 4);
        expect(ziele.punkte[ein]!.h).toBe(1500);
        expect(ziele.punkte[aus]!.h).toBe(1500);
        expect(ziele.strecken).toContainEqual([an(3, 4), ein]);
        expect(ziele.strecken).toContainEqual([aus, an(7, 4)]);
        expect(ziele.punkte.some((p) => p.wasser === "fluss" && (p.x === 4.5 || p.x === 5.5))).toBe(false);
        const bericht = triffPunkte(r, ziele);
        expect(bericht.gilt.every(Boolean)).toBe(true);
        for (const d of bericht.nachher) expect(Math.abs(d)).toBeLessThanOrEqual(1);
        for (const z of zellen) expect(r.h[z]).toBe(1500);
        // Das Ufer des Flusses folgt seiner Höhe, an der Mündung geht es stetig zur Höhe des Sees über (keine Stufe, kein Graben).
        const ufer = [2, 2.5, 3, 3.5, 3.9].map((x) => r.h[k(r, x, 4.2)]!);
        expect(ufer[0]!).toBeGreaterThan(1650);
        for (let n = 1; n < ufer.length; n++) expect(Math.abs(ufer[n]! - ufer[n - 1]!)).toBeLessThan(120);
        expect(ufer.at(-1)!).toBeGreaterThan(1450);
        expect(ufer.at(-1)!).toBeLessThan(1650);
        expect(Math.max(...r.h)).toBeLessThanOrEqual(1800 + 1e-9);
    });

    it("🔴 OPS-000086: um einen gehobenen See bleibt ein ebener Rand auf dem Spiegel, dahinter ein Hang; das Becken: Höheres bleibt stehen", () => {
        // Nördlich des Sees Wand auf 2.500, südlich Tiefland auf 500.
        const r = feld(100, 0.1, (_x, y) => (y >= 7 ? 2500 : 500));
        const see = quadrat(4, 4, 6, 6);
        fuelle(r, see, 1500);
        const ziele = eigeneZiele({ seen: [{ g: see }], seeHoehen: [{ x: 5, y: 5, h: 1500 }] });
        expect(ziele.punkte.every((p) => p.rand === TREFFEN.seeRandE)).toBe(true);
        triffPunkte(r, ziele);
        // Nach Süden: bis 1 E vom Ufer der Spiegel, dann fällt der Boden, höchstens mit der Neigung `steil`, stetig bis zum Tiefland.
        for (const d of [0.1, 0.5, 0.9]) expect(r.h[k(r, 5, 4 - d)]).toBe(1500);
        const quer = Array.from({ length: 25 }, (_, n) => r.h[k(r, 5, 3 - 0.1 * n)]!);
        for (let n = 1; n < quer.length; n++) {
            expect(quer[n]!).toBeLessThanOrEqual(quer[n - 1]! + 1e-9);
            expect(quer[n - 1]! - quer[n]!).toBeLessThanOrEqual(TREFFEN.steil * 3000 * 0.1 + 1);
        }
        expect(quer.at(-1)).toBe(500);
        // Nach Norden: Die Wand auf 2.500 bleibt, nur das Ufer folgt dem Spiegel; nichts fällt unter ihn.
        expect(r.h[k(r, 5, 9)]).toBe(2500);
        for (const d of [0.1, 0.5, 0.9]) expect(r.h[k(r, 5, 6 + d)]!).toBeGreaterThanOrEqual(1500);
    });

    it("🔴 OPS-000086: der Rand hebt nur Land: Wasser und Bett bleiben, eine Insel bekommt keinen, ein Punkt mit eigener Höhe behält sie", () => {
        const r = feld(100, 0.1, () => 500);
        // Ein See mit Insel: Die Insel trägt keinen Rand, nur ihre Kette wie bisher.
        const see: V12Geometry = {
            type: "Polygon",
            coordinates: [
                [
                    [3, 3],
                    [7, 3],
                    [7, 7],
                    [3, 7],
                    [3, 3],
                ],
                [
                    [4.5, 4.5],
                    [5.5, 4.5],
                    [5.5, 5.5],
                    [4.5, 5.5],
                    [4.5, 4.5],
                ],
            ],
        };
        fuelle(r, see, 1500);
        // Ein Bett im Rand, und eine Mulde mit eigener Höhe im Rand.
        for (let y = 0; y <= 3; y += 0.05) r.wasser[k(r, 5, y)] = 1;
        const ziele = eigeneZiele({
            seen: [{ g: see }],
            seeHoehen: [{ x: 3.5, y: 3.5, h: 1500 }],
            mulden: [{ x: 8, y: 5, h: 700 }],
        });
        const ufer = ziele.punkte.filter((p) => p.wasser === "see");
        const inInsel = (p: { x: number; y: number }) => p.x >= 4.5 && p.x <= 5.5 && p.y >= 4.5 && p.y <= 5.5;
        expect(ufer.filter(inInsel).every((p) => p.rand === undefined)).toBe(true);
        expect(ufer.filter((p) => !inInsel(p)).every((p) => p.rand === TREFFEN.seeRandE)).toBe(true);
        triffPunkte(r, ziele);
        // Das Bett bleibt, daneben der Rand.
        expect(r.h[k(r, 5, 2.5)]).toBe(500);
        expect(r.h[k(r, 5.5, 2.5)]).toBe(1500);
        // Die Mulde trifft ihre Höhe, der Rand blendet um sie aus.
        expect(r.h[k(r, 8, 5)]).toBe(700);
        expect(Math.max(...r.h)).toBeLessThanOrEqual(1500 + 1e-9);
    });

    it("🔴 OPS-000086: ein See ohne eigene Höhe bekommt keinen Rand, die Rechnung bleibt", () => {
        const r = feld(60, 0.1, () => 500);
        const see = quadrat(2, 2, 4, 4);
        const vorher = Float64Array.from(r.h);
        const ziele = eigeneZiele({ seen: [{ g: see }] });
        expect(ziele.punkte).toEqual([]);
        triffPunkte(r, ziele);
        expect(Array.from(r.h)).toEqual(Array.from(vorher));
    });

    it("🔴 ohne Seehöhe dieselben Ziele wie zuvor (also dieselbe Rechnung)", () => {
        const see = quadrat(4, 3, 6, 5);
        const basis = {
            kaemme: [
                {
                    punkte: [
                        [0, 0],
                        [5, 0],
                    ] as [number, number][],
                    hoehen: [2000, 2100],
                },
            ],
            fluesse: [{ p: [1, 3, 4.5, 7].map((x) => [x, 4] as [number, number]) }],
            flussHoehen: [
                { x: 1, y: 4, h: 1800 },
                { x: 7, y: 4, h: 1200 },
            ],
            seen: [{ g: see }],
        };
        const ohne = eigeneZiele(basis);
        expect(eigeneZiele({ ...basis, seeHoehen: [] })).toEqual(ohne);
        // Eine Seehöhe außerhalb jedes Sees bindet nichts.
        expect(eigeneZiele({ ...basis, seeHoehen: [{ x: 20, y: 20, h: 900 }] })).toEqual(ohne);
        expect(ohne.punkte.some((p) => p.wasser === "see")).toBe(false);
    });
});

const blutzinnen = JSON.parse(
    readFileSync(new URL("./fixtures/rueckennetz/blutzinnen.json", import.meta.url), "utf8"),
) as { input: V12Input };
const regler = (version: number) =>
    rueckennetzRegler(AVENTURIA_TERRAIN_RECIPES.get(version)?.gebirgsPresets ?? null, "kettengebirge", {});

describe("Seen wie Flüsse in der Saat (Blutzinnen, Fassung 19)", () => {
    const see = blutzinnen.input.seen[0]!;
    const imSee = (x: number, y: number) => pointInGeometry([x, y], see.g);
    const SPIEGEL = 2300;
    /** Blutzinnen ohne eine eigene Höhe an Kämmen und Nebengipfeln: Nur der See trägt eine. */
    const mit: V12Input = {
        ...blutzinnen.input,
        kaemme: (blutzinnen.input.kaemme ?? []).map((kamm) => ({ ...kamm, hoehen: kamm.punkte.map(() => null) })),
        nebengipfel: (blutzinnen.input.nebengipfel ?? []).map((n) => ({ ...n, h: null })),
        seeHoehen: [{ ...seePlatz(see.g), h: SPIEGEL }],
    };
    const rechne = (input: V12Input, treffen: boolean): RueckenErgebnis => {
        const r = regler(19);
        return rechneRueckennetz(
            { ...input, zelle: 0.5 },
            { struktur: r.struktur, form: r.form },
            {
                band: r.band,
                gratMin: r.gratMin,
                ...(r.punktHoehenAbsolut ? { punktHoehenAbsolut: true } : {}),
                ...(treffen ? {} : { treffen: false as const }),
            },
        );
    };
    /** Das Umland wie `treffen.ts` in der Saat: Median der Zellen der Fläche ohne Senke im Ring von 1,5 bis 3 Zellen. */
    const umland = (e: RueckenErgebnis, x: number, y: number): number => {
        const werte: number[] = [];
        for (let j = 0; j < e.hh; j++)
            for (let i = 0; i < e.w; i++) {
                const d = Math.hypot(e.bounds.min_x + i * e.cell - x, e.bounds.min_y + j * e.cell - y) / e.cell;
                const z = j * e.w + i;
                if (d > 1.5 && d <= 3 && e.eigen[z] === 1 && e.senke[z] === 0) werte.push(e.h[z]!);
            }
        werte.sort((p, q) => p - q);
        const m = werte.length >> 1;
        return werte.length % 2 === 1 ? werte[m]! : (werte[m - 1]! + werte[m]!) / 2;
    };

    it("🔴 das Ufer folgt dem Spiegel; der See bleibt, nichts steigt über ihn, nur Land ändert sich", () => {
        const ziele = eigeneZiele(mit);
        expect(ziele.punkte.length).toBeGreaterThanOrEqual(8);
        expect(ziele.punkte.every((p) => p.wasser === "see" && p.h === SPIEGEL)).toBe(true);
        const vorher = rechne(mit, false);
        const nachher = rechne(mit, true);
        // Vorher lag das Ufer im Mittel Hunderte Schritt unter dem Spiegel; nachher auf ihm. Bis auf einen Rest wie am Fluss: Auf diesem groben
        // Raster (0,5 E) reicht der Ring eines Uferpunkts drei Nachbarn weit, deren Stücke schon getroffen sind (gemessen höchstens 31 Schritt,
        // auf dem Raster der Saat, 0,25 E, höchstens 10).
        const vorherMittel = ziele.punkte.reduce((s, p) => s + umland(vorher, p.x, p.y), 0) / ziele.punkte.length;
        expect(vorherMittel).toBeLessThan(SPIEGEL - 300);
        const rest = ziele.punkte.map((p) => Math.abs(umland(nachher, p.x, p.y) - SPIEGEL));
        expect(Math.max(...rest)).toBeLessThanOrEqual(40);
        expect(rest.reduce((a, b) => a + b, 0) / rest.length).toBeLessThanOrEqual(5);
        let geaendert = 0;
        for (let z = 0; z < vorher.h.length; z++) {
            const x = vorher.bounds.min_x + (z % vorher.w) * vorher.cell;
            const y = vorher.bounds.min_y + Math.floor(z / vorher.w) * vorher.cell;
            if (imSee(x, y)) expect(nachher.h[z]).toBe(vorher.h[z]);
            if (nachher.h[z] === vorher.h[z]) continue;
            geaendert++;
            expect(vorher.senke[z]).toBe(0);
            expect(nachher.h[z]!).toBeLessThanOrEqual(SPIEGEL + 1e-9);
        }
        expect(geaendert).toBeGreaterThan(20);
    }, 240_000);

    it("Fingerabdruck: die Marke der Seen nur, wo ein Uferpunkt Ziel ist", () => {
        const ohne: V12Input = { ...mit };
        delete ohne.seeHoehen;
        expect(treffenMarke({ ...ohne, rueckennetz: regler(19) })).toBe("");
        expect(treffenMarke({ ...mit, rueckennetz: regler(19) })).toBe(`|${TREFFEN_QUELLE}|${TREFFEN_SEE_QUELLE}`);
        // Mit einer Kammhöhe dazu; mit einer Flusshöhe dazu beide Marken des Wassers.
        const kamm: V12Input = {
            ...mit,
            kaemme: (mit.kaemme ?? []).map((k, i) => (i === 0 ? { ...k, hoehen: k.punkte.map(() => 2300) } : k)),
        };
        expect(treffenMarke({ ...kamm, rueckennetz: regler(19) })).toBe(`|${TREFFEN_QUELLE}|${TREFFEN_SEE_QUELLE}`);
        const fluss = blutzinnen.input.fluesse[0]!;
        const drin = fluss.p.filter(([x, y]) => pointInGeometry([x, y], blutzinnen.input.geometry) && !imSee(x, y));
        expect(
            treffenMarke({
                ...kamm,
                flussHoehen: [{ x: drin[0]![0], y: drin[0]![1], h: 1200 }],
                rueckennetz: regler(19),
            }),
        ).toBe(`|${TREFFEN_QUELLE}|${TREFFEN_FLUSS_QUELLE}|${TREFFEN_SEE_QUELLE}`);
        expect(treffenMarke({ ...mit, rueckennetz: regler(18) })).toBe("");
    });
});

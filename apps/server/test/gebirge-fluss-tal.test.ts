import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
    eigeneZiele,
    pointInGeometry,
    rechneRueckennetz,
    rueckennetzRegler,
    seePlatz,
    TREFFEN_FLUSS_QUELLE,
    TREFFEN_QUELLE,
    triffPunkte,
    type RueckenErgebnis,
    type TreffArt,
    type V12Input,
} from "@avesmaps3d/shared";
import type { StoredRaster } from "../src/terrain/dem-tiles.ts";
import type { DomainInputs } from "../src/terrain/domain/inputs.ts";
import { AVENTURIA_TERRAIN_RECIPES } from "../src/terrain/domain/recipes.ts";
import { triffEigeneHoehen } from "../src/terrain/domain/rueckennetz-flaechen.ts";
import { treffenMarke } from "../src/terrain/inputs.ts";

/**
 * Fluss als Tal (WI-0259, OPS-071; Vali 2026-10-30: „flüsse [sind] automatische kammtäler …, deren verlauf im kammeditor auch in der höhe
 * verändert werden kann“): Ein Fluss mit eigenen Höhen wirkt wie ein gezeichnetes Tal mit eigenen Höhen. Das Umland folgt der Flusshöhe nach den
 * Regeln von `TREFFEN`, das Bett und jeder See bleiben (`treffen.ts`).
 *
 * Problemfälle: Ein Fluss auf 2.300 über Umland 500 bleibt ein Damm (OPS-071, Thomas auf der Stage); der Hang steigt über den Fluss oder fällt
 * nicht stetig ab; die Kette folgt der Luftlinie statt dem Lauf; ein See ändert sich; ein Gebirge ohne eigene Flusshöhen ändert Saat oder
 * Fingerabdruck; im Gelände greift die Regel nicht, weil Bett und Kern im gesperrten Flusskorridor liegen.
 */

/** Ein Raster w × w ab (0, 0), überall `grund`; `wasser` sind Bett und See (Senke, nicht gewollt). */
function feld(w: number, cell: number, grund: number) {
    const h = new Float64Array(w * w).fill(grund);
    const wasser = new Uint8Array(w * w);
    // Wie die Saat (`rechne.ts`): im Kern eines Punkts jede Zelle, im Kern einer Strecke kein Wasser, im Abfall keine Senke.
    const darf = (k: number, art: TreffArt) => art === "punkt" || wasser[k] === 0;
    return { w, hh: w, cell, x0: 0, y0: 0, h, wasser, darf };
}
type Feld = ReturnType<typeof feld>;
const k = (r: Feld, x: number, y: number) => Math.round(y / r.cell) * r.w + Math.round(x / r.cell);

/** Brennt das Bett ein wie `wasserFest`: jede Zelle unter dem Lauf auf die Höhe über die Bogenlänge, als Wasser markiert. */
function bett(r: Feld, p: readonly (readonly [number, number])[], hoehe: (s: number) => number): void {
    let s0 = 0;
    for (let s = 1; s < p.length; s++) {
        const [ax, ay] = p[s - 1]!;
        const [bx, by] = p[s]!;
        const l = Math.hypot(bx - ax, by - ay);
        for (let t = 0; t <= 200; t++) {
            const u = t / 200;
            const z = k(r, ax + (bx - ax) * u, ay + (by - ay) * u);
            if (r.wasser[z]) continue;
            r.h[z] = hoehe(s0 + l * u);
            r.wasser[z] = 1;
        }
        s0 += l;
    }
}

describe("Fluss als Tal: die Regel (`triffPunkte`, `eigeneZiele`)", () => {
    it("🔴 ein Fluss auf 2.300 quer über Gelände 500 wird ein weicher Hang statt eines Damms, fällt zur Seite stetig ab, nie über 2.300", () => {
        const r = feld(60, 0.1, 500);
        const lauf: [number, number][] = [0.5, 1.5, 2.5, 3.5, 4.5, 5.5].map((x) => [x, 3]);
        bett(r, lauf, () => 2300);
        // Nur die Enden tragen eine eigene Höhe; die vier dazwischen bekommen sie über die Bogenlänge.
        const ziele = eigeneZiele({
            fluesse: [{ p: lauf }],
            flussHoehen: [
                { x: 0.5, y: 3, h: 2300 },
                { x: 5.5, y: 3, h: 2300 },
            ],
        });
        expect(ziele.punkte.map((p) => [p.x, p.h, p.wasser])).toEqual(lauf.map(([x]) => [x, 2300, "fluss"]));
        expect(ziele.strecken).toEqual([
            [0, 1],
            [1, 2],
            [2, 3],
            [3, 4],
            [4, 5],
        ]);
        const bettVorher = Array.from(r.h).filter((_, z) => r.wasser[z] === 1);
        // Vorher der Damm: am Bett 2.300, gleich daneben 500.
        expect(r.h[k(r, 3, 3.1)]).toBe(500);
        const bericht = triffPunkte(r, ziele);
        expect(bericht.gilt.every(Boolean)).toBe(true);
        for (const d of bericht.vorher) expect(d).toBeCloseTo(-1800, 6);
        for (const d of bericht.nachher) expect(Math.abs(d)).toBeLessThanOrEqual(1);
        // Das Bett bleibt Zelle für Zelle.
        expect(Array.from(r.h).filter((_, z) => r.wasser[z] === 1)).toEqual(bettVorher);
        // Der Querschnitt bei x = 3 nach Norden und nach Süden: am Ufer die Flusshöhe, dann stetig fallend, weich, und nach dem Hang der Grund.
        for (const richtung of [1, -1]) {
            const quer = Array.from({ length: 25 }, (_, n) => r.h[k(r, 3, 3 + richtung * 0.1 * (n + 1))]!);
            expect(quer[0]!).toBeGreaterThanOrEqual(2299);
            for (let n = 1; n < quer.length; n++) {
                expect(quer[n]!).toBeLessThanOrEqual(quer[n - 1]! + 1e-9);
                expect(quer[n - 1]! - quer[n]!).toBeLessThan(300);
            }
            expect(quer.at(-1)).toBe(500);
        }
        expect(Math.max(...r.h)).toBeLessThanOrEqual(2300 + 1e-9);
    });

    it("🔴 zwei angeheftete Punkte und ein freier dazwischen: die Kette folgt dem Lauf, nicht der Luftlinie", () => {
        const r = feld(70, 0.1, 500);
        // Ein Knick: 4 E nach Osten, dann 4 E nach Norden. Der freie Knickpunkt trägt die Höhe über die Bogenlänge (2.000 → 1.600: 1.800).
        const lauf: [number, number][] = [
            [1, 1],
            [5, 1],
            [5, 5],
        ];
        bett(r, lauf, (s) => 2000 - 50 * s);
        const ziele = eigeneZiele({
            fluesse: [{ p: lauf }],
            flussHoehen: [
                { x: 1, y: 1, h: 2000 },
                { x: 5, y: 5, h: 1600 },
            ],
        });
        expect(ziele.punkte.map((p) => p.h)).toEqual([2000, 1800, 1600]);
        expect(ziele.strecken).toEqual([
            [0, 1],
            [1, 2],
        ]);
        triffPunkte(r, ziele);
        // Neben beiden Schenkeln das Umland auf der Höhe des Laufs dort (1.900 und 1.700), nie über die höhere Zielhöhe.
        expect(r.h[k(r, 3, 1.2)]).toBeGreaterThan(1850);
        expect(r.h[k(r, 3, 1.2)]).toBeLessThanOrEqual(2000);
        expect(r.h[k(r, 5.2, 3)]).toBeGreaterThan(1650);
        expect(r.h[k(r, 5.2, 3)]).toBeLessThanOrEqual(1800);
        // Auf der Luftlinie zwischen den angehefteten Punkten, 2 E von beiden Schenkeln: Grund. Eine Strecke von (1, 1) nach (5, 5) höbe hier.
        expect(r.h[k(r, 3, 3)]).toBe(500);
        expect(Math.max(...r.h)).toBeLessThanOrEqual(2000 + 1e-9);
    });

    it("🔴 ein See bleibt unberührt; ein Stützpunkt im See ist kein Ziel, die Kette bricht dort", () => {
        const r = feld(80, 0.1, 500);
        const see = {
            type: "Polygon" as const,
            coordinates: [
                [
                    [3.2, 3.2],
                    [4.8, 3.2],
                    [4.8, 4.8],
                    [3.2, 4.8],
                    [3.2, 3.2],
                ],
            ],
        };
        for (let z = 0; z < r.h.length; z++)
            if (pointInGeometry([(z % r.w) * r.cell, Math.floor(z / r.w) * r.cell], see)) {
                r.h[z] = 800;
                r.wasser[z] = 1;
            }
        const lauf: [number, number][] = [0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5].map((x) => [x, 4]);
        bett(r, lauf, () => 2000);
        const ziele = eigeneZiele({
            fluesse: [{ p: lauf }],
            seen: [{ g: see }],
            flussHoehen: [
                { x: 0.5, y: 4, h: 2000 },
                { x: 7.5, y: 4, h: 2000 },
            ],
        });
        expect(ziele.punkte.map((p) => p.x)).toEqual([0.5, 1.5, 2.5, 5.5, 6.5, 7.5]);
        expect(ziele.strecken).toEqual([
            [0, 1],
            [1, 2],
            [3, 4],
            [4, 5],
        ]);
        const seeVorher: number[] = [];
        for (let z = 0; z < r.h.length; z++)
            if (pointInGeometry([(z % r.w) * r.cell, Math.floor(z / r.w) * r.cell], see)) seeVorher.push(r.h[z]!);
        triffPunkte(r, ziele);
        const seeNachher: number[] = [];
        for (let z = 0; z < r.h.length; z++)
            if (pointInGeometry([(z % r.w) * r.cell, Math.floor(z / r.w) * r.cell], see)) seeNachher.push(r.h[z]!);
        expect(seeNachher).toEqual(seeVorher);
        expect(seeNachher.every((h) => h === 800)).toBe(true);
        // Das Ufer des Flusses vor dem See folgt der Flusshöhe.
        expect(r.h[k(r, 1.5, 4.2)]).toBeGreaterThan(1950);
    });

    it("🔴 ohne eigene Flusshöhen dieselben Ziele wie zuvor (also dieselbe Rechnung), und der Fingerabdruck bleibt", () => {
        const kaemme = [
            {
                punkte: [
                    [0, 0],
                    [5, 0],
                ] as [number, number][],
                hoehen: [2000, 2100],
            },
        ];
        const fluesse = [
            {
                p: [
                    [0, 2],
                    [5, 2],
                ] as [number, number][],
            },
        ];
        const ohne = eigeneZiele({ kaemme });
        expect(eigeneZiele({ kaemme, fluesse })).toEqual(ohne);
        expect(eigeneZiele({ kaemme, fluesse, flussHoehen: [] })).toEqual(ohne);
        // Eine Höhe an einer Stelle ohne Stützpunkt bindet nichts.
        expect(eigeneZiele({ kaemme, fluesse, flussHoehen: [{ x: 2.5, y: 2, h: 900 }] })).toEqual(ohne);
        expect(ohne.punkte.some((p) => p.wasser !== undefined)).toBe(false);
    });
});

const blutzinnen = JSON.parse(
    readFileSync(new URL("./fixtures/rueckennetz/blutzinnen.json", import.meta.url), "utf8"),
) as { input: V12Input };
const regler = (version: number) =>
    rueckennetzRegler(AVENTURIA_TERRAIN_RECIPES.get(version)?.gebirgsPresets ?? null, "kettengebirge", {});
/** Blutzinnen ohne eine eigene Höhe an Kämmen und Nebengipfeln: Nur der Fluss trägt welche. */
const ohneKammHoehen = (): V12Input => ({
    ...blutzinnen.input,
    kaemme: (blutzinnen.input.kaemme ?? []).map((kamm) => ({ ...kamm, hoehen: kamm.punkte.map(() => null) })),
    nebengipfel: (blutzinnen.input.nebengipfel ?? []).map((n) => ({ ...n, h: null })),
});

describe("Fluss als Tal in der Saat (Blutzinnen, Fassung 19)", () => {
    const see = blutzinnen.input.seen[0]!;
    const drin = (x: number, y: number) => pointInGeometry([x, y], blutzinnen.input.geometry);
    const imSee = (x: number, y: number) => pointInGeometry([x, y], see.g);
    // Der Fluss der Vorlage läuft fast ganz außerhalb der Fläche: ein Probefluss quer durch ihre Mitte, alle 0,75 E ein Stützpunkt, das längste
    // Stück in der Fläche und außerhalb des Sees. Ein Stützpunkt nach dem Anfang und einer vor dem Ende tragen 2.300, die dazwischen sind frei.
    const lauf = (() => {
        const b = blutzinnen.input.bounds;
        const y = (b.min_y + b.max_y) / 2;
        let bestes: [number, number][] = [];
        let jetzt: [number, number][] = [];
        for (let x = b.min_x; x <= b.max_x; x += 0.75) {
            if (!drin(x, y) || imSee(x, y)) {
                jetzt = [];
                continue;
            }
            jetzt.push([x, y]);
            if (jetzt.length > bestes.length) bestes = jetzt.slice();
        }
        return bestes;
    })();
    const flussHoehen = [lauf[1]!, lauf.at(-2)!].map(([x, y]) => ({ x, y, h: 2300 }));
    const probefluss = { n: "Probefluss", bach: false, dir: "forward" as const, p: lauf };
    const mit: V12Input = { ...ohneKammHoehen(), fluesse: [probefluss], flussHoehen };
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
    /** Das Umland wie `treffen.ts` in der Saat (das Bett ist eine Zelle breit): Median der Zellen der Fläche ohne Senke im Ring von 1,5 bis 3 Zellen. */
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

    it("🔴 das Umland folgt der Flusshöhe; Bett und See bleiben, nichts steigt über den Fluss", () => {
        const ziele = eigeneZiele(mit);
        expect(lauf.length).toBeGreaterThanOrEqual(8);
        expect(ziele.punkte.length).toBe(lauf.length - 2);
        expect(ziele.punkte.every((p) => p.wasser === "fluss" && p.h === 2300)).toBe(true);
        const vorher = rechne(mit, false);
        const nachher = rechne(mit, true);
        // Vorher ein Damm: das Umland im Mittel Hunderte Schritt unter dem Fluss; nachher auf ihm (bis auf wenige Schritt: Bei Stützpunkten alle
        // 0,75 E reicht der Ring in die Stücke der Nachbarn, die schon getroffen sind, und der Median schließt langsam). Das Bett bleibt.
        const vorherMittel = ziele.punkte.reduce((s, p) => s + umland(vorher, p.x, p.y), 0) / ziele.punkte.length;
        expect(vorherMittel).toBeLessThan(2300 - 300);
        for (const p of ziele.punkte) {
            expect(Math.abs(umland(nachher, p.x, p.y) - 2300)).toBeLessThanOrEqual(10);
            const bett =
                Math.round((p.y - vorher.bounds.min_y) / vorher.cell) * vorher.w +
                Math.round((p.x - vorher.bounds.min_x) / vorher.cell);
            expect(nachher.h[bett]).toBe(vorher.h[bett]);
        }
        let geaendert = 0;
        for (let z = 0; z < vorher.h.length; z++) {
            if (nachher.h[z] === vorher.h[z]) continue;
            geaendert++;
            // Nie Wasser, nie eine Senke, nie über den Fluss.
            expect(vorher.senke[z]).toBe(0);
            expect(nachher.h[z]!).toBeLessThanOrEqual(2300 + 1e-9);
        }
        expect(geaendert).toBeGreaterThan(20);
        // Der See: jede Zelle wie zuvor.
        for (let z = 0; z < vorher.h.length; z++) {
            const x = vorher.bounds.min_x + (z % vorher.w) * vorher.cell;
            const y = vorher.bounds.min_y + Math.floor(z / vorher.w) * vorher.cell;
            if (imSee(x, y)) expect(nachher.h[z]).toBe(vorher.h[z]);
        }
    }, 240_000);

    it("Fingerabdruck: die Marke der Flüsse nur, wo ein Flusspunkt Ziel ist", () => {
        const kammHoehen: V12Input = {
            ...blutzinnen.input,
            fluesse: [probefluss],
            kaemme: (blutzinnen.input.kaemme ?? []).map((kamm) => ({ ...kamm, hoehen: kamm.punkte.map(() => 2300) })),
        };
        expect(treffenMarke({ ...kammHoehen, rueckennetz: regler(19) })).toBe(`|${TREFFEN_QUELLE}`);
        expect(treffenMarke({ ...ohneKammHoehen(), rueckennetz: regler(19) })).toBe("");
        expect(treffenMarke({ ...mit, rueckennetz: regler(19) })).toBe(`|${TREFFEN_QUELLE}|${TREFFEN_FLUSS_QUELLE}`);
        expect(treffenMarke({ ...kammHoehen, flussHoehen, rueckennetz: regler(19) })).toBe(
            `|${TREFFEN_QUELLE}|${TREFFEN_FLUSS_QUELLE}`,
        );
        // Eine Flusshöhe im See bindet nichts; in Fassung 18 gibt es keine Marke.
        const platz = seePlatz(see.g);
        expect(imSee(platz.x, platz.y)).toBe(true);
        const imSeeFluss = { ...probefluss, p: [[platz.x, platz.y], lauf[0]!] as [number, number][] };
        expect(
            treffenMarke({
                ...kammHoehen,
                fluesse: [imSeeFluss],
                flussHoehen: [{ ...platz, h: 2300 }],
                rueckennetz: regler(19),
            }),
        ).toBe(`|${TREFFEN_QUELLE}`);
        expect(treffenMarke({ ...mit, rueckennetz: regler(18) })).toBe("");
    });
});

describe("Fluss als Tal im Gelände (`triffEigeneHoehen`)", () => {
    const N = 2048;
    const CELL = 1024 / N;
    const flaeche = {
        type: "Polygon" as const,
        coordinates: [
            [
                [200, 200],
                [240, 200],
                [240, 240],
                [200, 240],
                [200, 200],
            ],
        ],
    };
    // Ein Fluss von West nach Ost bei y = 220,25 (Zellmitte), Bett auf 2.300, Umland 900; der Korridor (±2 Zellen) ist gesperrt wie
    // `dryLandMask` (Gitterausrichtung, Zeile 0 im Norden).
    const Y = 220.25;
    const lauf: [number, number][] = [205, 210, 215, 220, 225, 230, 235].map((x) => [x, Y]);
    function raster(): StoredRaster {
        const samples = new Uint16Array(N * N);
        for (let j = 0; j < N; j++) {
            const y = (j + 0.5) * CELL;
            if (y < 190 || y > 250) continue;
            for (let i = 0; i < N; i++) {
                const x = (i + 0.5) * CELL;
                if (x < 190 || x > 250) continue;
                samples[j * N + i] = Math.abs(y - Y) < 0.1 && x >= 205 && x <= 235 ? 2300 : 900;
            }
        }
        return { width: N, height: N, cell: CELL, originX: CELL / 2, originY: CELL / 2, samples };
    }
    const korridor = (gy: number) => Math.abs((N - 1 - gy + 0.5) * CELL - Y) <= 2 * CELL + 1e-9;
    const trocken = new Uint8Array(N * N).fill(1);
    for (let gy = 0; gy < N; gy++) if (korridor(gy)) trocken.fill(0, gy * N, (gy + 1) * N);
    const ziele = eigeneZiele({
        fluesse: [{ p: lauf }],
        flussHoehen: [
            { x: 205, y: Y, h: 2300 },
            { x: 235, y: Y, h: 2300 },
        ],
        geometry: flaeche,
    });

    it("🔴 das Umland jenseits des Korridors folgt der Flusshöhe; Korridor und Bett bleiben, nichts über 2.300", () => {
        const vorher = raster();
        const r = raster();
        const input = {
            rueckennetz: [{ id: "rn", geometry: flaeche, deckel: 2400, ziele }],
        } as unknown as DomainInputs;
        const [bericht] = triffEigeneHoehen(r, input, trocken);
        expect(bericht!.gilt.every(Boolean)).toBe(true);
        for (const d of bericht!.vorher) expect(d).toBeLessThan(-1000);
        for (const d of bericht!.nachher) expect(Math.abs(d)).toBeLessThanOrEqual(1);
        let geaendert = 0;
        for (let j = 0; j < N; j++)
            for (let i = 0; i < N; i++) {
                const z = j * N + i;
                if (r.samples[z] === vorher.samples[z]) continue;
                geaendert++;
                expect(korridor(N - 1 - j), `Korridor ${String((j + 0.5) * CELL)}`).toBe(false);
                expect(r.samples[z]!).toBeLessThanOrEqual(2300);
            }
        expect(geaendert).toBeGreaterThan(100);
        // Gleich jenseits des Korridors (3 Zellen vom Fluss) die Flusshöhe.
        const ufer = r.samples[Math.round((Y + 3 * CELL - CELL / 2) / CELL) * N + Math.round((220 - CELL / 2) / CELL)]!;
        expect(ufer).toBeGreaterThanOrEqual(2290);
    }, 60_000);
});

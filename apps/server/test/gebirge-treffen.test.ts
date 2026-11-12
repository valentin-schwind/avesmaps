import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
    eigeneZiele,
    liesBilinear,
    rechneRueckennetz,
    rueckennetzRegler,
    TREFFEN,
    treffReichweite,
    triffPunkte,
    zelleAmPunkt,
    type Kamm,
    type RueckenErgebnis,
    type V12Input,
} from "@avesmaps3d/shared";
import type { StoredRaster } from "../src/terrain/dem-tiles.ts";
import type { DomainInputs } from "../src/terrain/domain/inputs.ts";
import { AVENTURIA_TERRAIN_RECIPES } from "../src/terrain/domain/recipes.ts";
import { triffEigeneHoehen } from "../src/terrain/domain/rueckennetz-flaechen.ts";
import { treffenMarke } from "../src/terrain/inputs.ts";

/**
 * Punkt trifft seine Höhe (WI-0249, Fassung 19; Vali wählte: Punkt trifft seine Höhe, 2026-10-26): Ein Punkt mit eigener Höhe hat dort genau
 * diese Höhe; Auslaufen zum Umriss, Rinnen und Erosion wirken nur zwischen den Punkten (`treffen.ts`, `triffEigeneHoehen`).
 *
 * Problemfälle: Die Fläche liegt am Punkt Hunderte Schritt unter seiner Höhe (Blutzinnen mit 2.300 an jedem Kammpunkt: im Mittel gut 500
 * darunter); ein Gebirge ohne eigene Höhen rechnet anders als vorher oder ändert seinen Fingerabdruck; zwei widersprüchliche Höhen dicht
 * beieinander schaukeln sich zur Nadel auf; ein Punkt am Umriss hebt eine einzelne Zelle; der Kamm zwischen zwei Punkten steigt über beide;
 * das Gelände ändert Flüsse, Seen oder fremde Flächen.
 */

const blutzinnen = JSON.parse(
    readFileSync(new URL("./fixtures/rueckennetz/blutzinnen.json", import.meta.url), "utf8"),
) as { input: V12Input; kaemmeLang?: Kamm[] };
const KAMM = 2300;
const ZELLE = 0.5;

const sha = (h: Float64Array) =>
    createHash("sha1")
        .update(Buffer.from(h.buffer, h.byteOffset, h.byteLength))
        .digest("hex")
        .slice(0, 12);

/** Wie im Editor: jeder Kammpunkt mit der Kammhöhe (Startwert), an einem Nebengipfel mit eigener Höhe (näher als 1 E) dessen Höhe. */
function mitEigenenHoehen(): V12Input {
    const neben = blutzinnen.input.nebengipfel ?? [];
    return {
        ...blutzinnen.input,
        kaemme: (blutzinnen.kaemmeLang ?? blutzinnen.input.kaemme ?? []).map((k) => ({
            ...k,
            hoehen: k.punkte.map(([x, y]) => {
                const n = neben.find((g) => Number(g.h) > 0 && Math.hypot(g.x - x, g.y - y) < 1);
                return n ? Number(n.h) : KAMM;
            }),
        })),
    };
}
/** Dasselbe Netz ohne eine einzige eigene Höhe. */
function ohneEigeneHoehen(): V12Input {
    return {
        ...blutzinnen.input,
        kaemme: (blutzinnen.kaemmeLang ?? blutzinnen.input.kaemme ?? []).map((k) => ({
            ...k,
            hoehen: k.punkte.map(() => null),
        })),
        nebengipfel: (blutzinnen.input.nebengipfel ?? []).map((n) => ({ ...n, h: null })),
    };
}

function regler(version: number) {
    return rueckennetzRegler(AVENTURIA_TERRAIN_RECIPES.get(version)?.gebirgsPresets ?? null, "kettengebirge", {});
}

/** Die Saat wie `rueckennetzRaster`, wahlweise ohne Anheften (`treffen: false`). */
function rechne(input: V12Input, version: number, treffen = true): RueckenErgebnis {
    const r = regler(version);
    return rechneRueckennetz(
        { ...input, zelle: ZELLE },
        { struktur: r.struktur, form: r.form },
        {
            band: r.band,
            gratMin: r.gratMin,
            ...(r.punktHoehenAbsolut ? { punktHoehenAbsolut: true } : {}),
            ...(treffen ? {} : { treffen: false as const }),
        },
    );
}

/** Die Zelle am Punkt (`zelleAmPunkt`): dort trägt die Fläche die Höhe des Punkts. */
const zelle = (e: RueckenErgebnis, x: number, y: number) =>
    zelleAmPunkt({ w: e.w, hh: e.hh, cell: e.cell, x0: e.bounds.min_x, y0: e.bounds.min_y }, x, y);
const lies = (e: RueckenErgebnis, x: number, y: number) => e.h[zelle(e, x, y)] as number;
/** Liegt der Punkt mit seinem Kern in der Fläche (die Zelle am Punkt und ihre acht Nachbarn)? */
const ganzDrin = (e: RueckenErgebnis, x: number, y: number) => {
    const k = zelle(e, x, y);
    if (k < 0) return false;
    return [-e.w - 1, -e.w, -e.w + 1, -1, 0, 1, e.w - 1, e.w, e.w + 1].every((d) => e.eigen[k + d] === 1);
};
/** Bilinear zwischen den Zellen, wie Wegfindung und Karte lesen: Hier zählt nur, dass es nah an der Höhe bleibt. */
const liesZwischen = (e: RueckenErgebnis, x: number, y: number) =>
    liesBilinear({ w: e.w, hh: e.hh, cell: e.cell, x0: e.bounds.min_x, y0: e.bounds.min_y, h: e.h }, x, y);

describe("Punkt trifft seine Höhe: Saat und Vorschau (Blutzinnen, Fassung 19)", () => {
    const mit = mitEigenenHoehen();
    const ziele = eigeneZiele(mit);
    let gerechnet: { vorher: RueckenErgebnis; nachher: RueckenErgebnis } | undefined;
    const beide = () => (gerechnet ??= { vorher: rechne(mit, 19, false), nachher: rechne(mit, 19) });

    it("🔴 jeder Punkt mit eigener Höhe in der Fläche trifft sie (höchstens 10 Schritt); vorher lag die Fläche im Mittel Hunderte darunter", () => {
        const { vorher, nachher } = beide();
        // In der Fläche und ohne Widerspruch: Ein Kammpunkt 1,07 E neben einem Nebengipfel mit 1.700 statt 2.300 weicht bei 0,5 E Zellweite
        // dem Nebengipfel (drei Zellen, `TREFFEN.widerspruchZellen`).
        const nah = TREFFEN.widerspruchZellen * vorher.cell;
        const drin = ziele.punkte.filter(
            (z) =>
                ganzDrin(vorher, z.x, z.y) &&
                !ziele.punkte.some(
                    (o) => (o.vorrang ?? 0) > (z.vorrang ?? 0) && o.h !== z.h && Math.hypot(o.x - z.x, o.y - z.y) < nah,
                ),
        );
        expect(drin.length).toBeGreaterThanOrEqual(30);
        const abVorher = drin.map((z) => Math.abs(lies(vorher, z.x, z.y) - z.h));
        const abNachher = drin.map((z) => Math.abs(lies(nachher, z.x, z.y) - z.h));
        expect(abVorher.reduce((a, b) => a + b, 0) / drin.length).toBeGreaterThan(300);
        expect(Math.max(...abNachher)).toBeLessThanOrEqual(10);
        // Bilinear zwischen den Zellen (Wegfindung, Karte): im Mittel weniger als halb so weit weg wie vorher (am schmalen Grat liegt zwischen
        // zwei Zellen von 0,5 E viel Hang; feiner wird es enger).
        const zwischen = drin.map((z) => Math.abs(liesZwischen(nachher, z.x, z.y) - z.h));
        expect(zwischen.reduce((a, b) => a + b, 0) / drin.length).toBeLessThan(
            abVorher.reduce((a, b) => a + b, 0) / drin.length / 2,
        );
    }, 120_000);

    it("abseits aller Punkte und Strecken bleibt die Fläche Zelle für Zelle", () => {
        const { vorher, nachher } = beide();
        const weit = treffReichweite(vorher.cell);
        const abstandStrecke = (x: number, y: number, a: { x: number; y: number }, b: { x: number; y: number }) => {
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy || 1)));
            return Math.hypot(x - a.x - t * dx, y - a.y - t * dy);
        };
        let fern = 0;
        for (let k = 0; k < vorher.h.length; k++) {
            const x = vorher.bounds.min_x + (k % vorher.w) * vorher.cell;
            const y = vorher.bounds.min_y + Math.floor(k / vorher.w) * vorher.cell;
            if (ziele.punkte.some((z) => Math.hypot(z.x - x, z.y - y) <= weit)) continue;
            if (ziele.strecken.some(([a, b]) => abstandStrecke(x, y, ziele.punkte[a]!, ziele.punkte[b]!) <= weit))
                continue;
            fern++;
            expect(nachher.h[k]).toBe(vorher.h[k]);
        }
        expect(fern).toBeGreaterThan(1000);
    }, 120_000);

    it("ohne eigene Höhe Zeichen für Zeichen wie zuvor, und in Fassung 17 und 18 auch mit", () => {
        const ohne = ohneEigeneHoehen();
        expect(eigeneZiele(ohne).punkte).toEqual([]);
        expect(sha(rechne(ohne, 19).h)).toBe(sha(rechne(ohne, 19, false).h));
        for (const version of [17, 18]) expect(sha(rechne(mit, version).h)).toBe(sha(rechne(mit, version, false).h));
    }, 240_000);

    it("Fingerabdruck der Saat: die Marke nur mit den Presets der Fassung und mindestens einer eigenen Höhe", () => {
        expect(treffenMarke({ ...mit, rueckennetz: regler(19) })).toMatch(/^\|treffen@/);
        expect(treffenMarke({ ...ohneEigeneHoehen(), rueckennetz: regler(19) })).toBe("");
        expect(treffenMarke({ ...mit, rueckennetz: regler(18) })).toBe("");
        expect(treffenMarke({ ...mit })).toBe("");
    });
});

/** Ein Raster w × w ab (0, 0), Höhe je Zelle aus `h`. */
function feld(w: number, h: (i: number, j: number) => number, cell = 1) {
    const werte = new Float64Array(w * w);
    for (let j = 0; j < w; j++) for (let i = 0; i < w; i++) werte[j * w + i] = h(i, j);
    return { w, hh: w, cell, x0: 0, y0: 0, h: werte };
}

describe("Punkt trifft seine Höhe: die Regeln des Anheftens (`triffPunkte`)", () => {
    it("ein Punkt allein trifft; ein großer Unterschied wird ein breiter Hang, keine Nadel", () => {
        // Zellweite 0,1 E (300 Schritt): 1.800 Schritt Unterschied werden ein Hang von 1,5 E Radius.
        const r = feld(60, () => 1000, 0.1);
        const bericht = triffPunkte(r, [{ x: 3.03, y: 2.96, h: 2800 }]);
        expect(Math.abs(bericht.nachher[0]!)).toBeLessThanOrEqual(0.5);
        // Der Hang fällt weich ab: nie mehr als 300 Schritt je Zelle (eine Neigung von 1), und 1,6 E weiter steht wieder der Grund.
        let steilste = 0;
        for (let j = 1; j < 60; j++)
            for (let i = 1; i < 60; i++)
                steilste = Math.max(
                    steilste,
                    Math.abs(r.h[j * 60 + i]! - r.h[j * 60 + i - 1]!),
                    Math.abs(r.h[j * 60 + i]! - r.h[(j - 1) * 60 + i]!),
                );
        expect(steilste).toBeLessThan(300);
        expect(r.h[30 * 60 + 46]).toBe(1000);
    });

    it("🔴 Widerspruch: zwei verschiedene Höhen dichter als drei Zellen; der Nebengipfel gilt, der Stützpunkt weicht, keine Nadel", () => {
        const r = feld(40, () => 1000);
        const bericht = triffPunkte(r, [
            { x: 20, y: 20, h: 2300, vorrang: 1 },
            { x: 21, y: 20, h: 1900, vorrang: 2 },
        ]);
        expect(bericht.gilt).toEqual([false, true]);
        expect(Math.abs(bericht.nachher[1]!)).toBeLessThanOrEqual(0.5);
        expect(Math.max(...r.h)).toBeLessThanOrEqual(1900.5);
    });

    it("am Rand: ein Punkt, dessen Zelle außerhalb liegt, hebt nichts; liegt sie innen, bleiben die Zellen außerhalb", () => {
        const r = feld(20, () => 500);
        const darf = (k: number) => k % 20 < 10;
        // x = 9,6: Die Zelle am Punkt ist Spalte 10 (außerhalb): kein Ziel.
        const aussen = triffPunkte({ ...r, darf }, [{ x: 9.6, y: 10, h: 2000 }]);
        expect(aussen.gilt).toEqual([false]);
        expect(Math.max(...r.h)).toBe(500);
        // x = 9,4: Zelle und mehr als die Hälfte des Kerns innen: trifft, die Zellen außerhalb bleiben.
        const innen = triffPunkte({ ...r, darf }, [{ x: 9.4, y: 10, h: 2000 }]);
        expect(innen.gilt).toEqual([true]);
        expect(Math.abs(innen.nachher[0]!)).toBeLessThanOrEqual(0.5);
        for (let j = 0; j < 20; j++) for (let i = 10; i < 20; i++) expect(r.h[j * 20 + i]).toBe(500);
    });

    it("eine Strecke hebt den Kamm zwischen ihren Punkten mit, nie über die höhere Zielhöhe; Rinnen bleiben als Rinnen", () => {
        // Ein Kamm entlang y = 20 auf 1500, mit einer Rinne bei x = 20 und einer Kuppe bei x = 26, die schon über 2000 steht.
        const r = feld(48, (i, j) => {
            const quer = 1500 - 120 * Math.abs(j - 20);
            if (i === 20) return quer - 300;
            if (i === 26) return quer + 700;
            return quer;
        });
        const bericht = triffPunkte(r, {
            punkte: [
                { x: 10, y: 20, h: 2000 },
                { x: 34, y: 20, h: 2000 },
            ],
            strecken: [[0, 1]],
        });
        expect(bericht.nachher.map((d) => Math.abs(d) <= 0.5)).toEqual([true, true]);
        // Mitte zwischen den Punkten: mit gehoben, nicht stehen geblieben (keine Perlenkette).
        expect(r.h[20 * 48 + 16]!).toBeGreaterThan(1900);
        // Die Rinne bleibt tiefer als ihre Nachbarn, die Kuppe wird nicht weiter gehoben.
        expect(r.h[20 * 48 + 20]!).toBeLessThan(r.h[20 * 48 + 19]! - 100);
        expect(r.h[20 * 48 + 26]!).toBe(2200);
        expect(Math.max(...r.h)).toBeLessThanOrEqual(2200);
    });

    it("eigeneZiele: Kammpunkte mit Höhe und ihre Strecken, Nebengipfel und Mulden mit Höhe, nichts im See, ein Ort nur einmal", () => {
        // Seespiegel sind keine Ziele (der See trägt seine Höhe); Flusspunkte nur mit eigenen Flusshöhen (WI-0259, `gebirge-fluss-tal.test.ts`).
        const see = {
            type: "Polygon" as const,
            coordinates: [
                [
                    [50, 50],
                    [60, 50],
                    [60, 60],
                    [50, 60],
                    [50, 50],
                ],
            ],
        };
        const z = eigeneZiele({
            kaemme: [
                {
                    punkte: [
                        [0, 0],
                        [5, 0],
                        [10, 0],
                        [15, 0],
                    ],
                    hoehen: [2000, 2100, null, 2200],
                },
            ],
            nebengipfel: [
                { x: 5, y: 0, h: 2100 },
                { x: 30, y: 30, h: null },
                { x: 55, y: 55, h: 1800 },
            ],
            mulden: [{ x: 40, y: 40, h: 600 }],
            seen: [{ g: see }],
        });
        expect(z.punkte.map((p) => [p.x, p.y, p.h, p.vorrang])).toEqual([
            [0, 0, 2000, 1],
            [5, 0, 2100, 2],
            [15, 0, 2200, 1],
            [40, 40, 600, 2],
        ]);
        // Nur zwischen benachbarten Punkten mit eigener Höhe: 0–5; 5–15 nicht (dazwischen ein Punkt ohne).
        expect(z.strecken).toEqual([[0, 1]]);
    });
});

describe("Punkt trifft seine Höhe im Gelände (`triffEigeneHoehen`)", () => {
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
    const relief = (x: number, y: number) =>
        x > 200 && x < 240 && y > 200 && y < 240
            ? 1200 + 300 * Math.sin(x / 2.3) * Math.cos(y / 3.1) - 40 * Math.abs(y - 220)
            : 40;
    function raster(): StoredRaster {
        const samples = new Uint16Array(N * N);
        for (let j = 0; j < N; j++) {
            const y = (j + 0.5) * CELL;
            if (y < 190 || y > 250) continue;
            for (let i = 0; i < N; i++) {
                const x = (i + 0.5) * CELL;
                if (x < 190 || x > 250) continue;
                samples[j * N + i] = Math.max(0, Math.round(relief(x, y)));
            }
        }
        return { width: N, height: N, cell: CELL, originX: CELL / 2, originY: CELL / 2, samples };
    }
    // Trocken überall außer einem Flusskorridor bei x = 230 (Gitterausrichtung, Zeile 0 im Norden).
    const trocken = new Uint8Array(N * N).fill(1);
    const korridor = (gx: number) => Math.abs((gx + 0.5) * CELL - 230) < 1;
    for (let gy = 0; gy < N; gy++) for (let gx = 0; gx < N; gx++) if (korridor(gx)) trocken[gy * N + gx] = 0;
    const ziele = eigeneZiele({
        kaemme: [
            {
                punkte: [
                    [205, 220],
                    [215, 220],
                    [225, 220],
                ],
                hoehen: [1900, 2100, 2000],
            },
        ],
        nebengipfel: [{ x: 212, y: 230, h: 1700 }],
    });
    const input = (mitZielen: boolean) =>
        ({
            rueckennetz: [{ id: "rn", geometry: flaeche, deckel: 2400, ...(mitZielen ? { ziele } : {}) }],
        }) as unknown as DomainInputs;

    it("🔴 jeder Punkt trifft auf ganze Schritt; außerhalb der Fläche und im Flusskorridor bleibt jede Zelle", () => {
        const vorher = raster();
        const r = raster();
        const [bericht] = triffEigeneHoehen(r, input(true), trocken);
        expect(bericht!.gilt).toEqual([true, true, true, true]);
        for (const d of bericht!.nachher) expect(Math.abs(d)).toBeLessThanOrEqual(1);
        expect(Math.max(...bericht!.vorher.map(Math.abs))).toBeGreaterThan(300);
        let geaendert = 0;
        for (let j = 0; j < N; j++) {
            const y = (j + 0.5) * CELL;
            if (y < 190 || y > 250) continue;
            for (let i = 0; i < N; i++) {
                const x = (i + 0.5) * CELL;
                if (r.samples[j * N + i] === vorher.samples[j * N + i]) continue;
                geaendert++;
                expect(x > 200 && x < 240 && y > 200 && y < 240, `Zelle ${String(x)}, ${String(y)}`).toBe(true);
                expect(korridor(i), `Korridor ${String(x)}`).toBe(false);
            }
        }
        expect(geaendert).toBeGreaterThan(100);
    }, 60_000);

    it("ohne Ziele bleibt das Gelände Zeichen für Zeichen", () => {
        const vorher = raster();
        const r = raster();
        expect(triffEigeneHoehen(r, input(false), trocken)).toEqual([]);
        expect(Buffer.from(r.samples.buffer).equals(Buffer.from(vorher.samples.buffer))).toBe(true);
    }, 60_000);
});

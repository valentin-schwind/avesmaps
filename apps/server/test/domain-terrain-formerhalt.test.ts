import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { grid } from "../src/terrain/hydrology/grid.ts";
import type { StoredRaster } from "../src/terrain/dem-tiles.ts";
import { fensterLeser, formerhaltFenster } from "../src/terrain/domain/formerhalt.ts";
import { generateDomainTerrain } from "../src/terrain/domain/generate.ts";
import { formInitialTerrain } from "../src/terrain/domain/initial-terrain.ts";
import type { DomainInputs } from "../src/terrain/domain/inputs.ts";
import { composeMaterials } from "../src/terrain/domain/materials.ts";
import { landscapeSampler } from "../src/terrain/hydrology/landscape.ts";
import { AVENTURIA_TERRAIN_RECIPES, type TerrainRecipe } from "../src/terrain/domain/recipes.ts";
import { bette, stelleKoepfeWieder, type RueckennetzNetz } from "../src/terrain/domain/rueckennetz-flaechen.ts";

/**
 * Formerhalt der Rückennetz-Gebirge in der Domäne (WI-0249 P2): Einbettung auf das Land (Schritt 3) und ungeglättetes Material mit
 * Formfaktor in Einschneiden und Diffusion (Schritt 4). Ohne `mountainMorphology.rueckennetz` (Fassung 17 und 18) rechnet das Gelände
 * Zeichen für Zeichen wie vor WI-0249 P2: Die Prüfsumme unten ist mit dem Code von `origin/master` f3cf74b39 gerechnet.
 */

function polygon(x0: number, y0: number, x1: number, y1: number) {
    return {
        type: "Polygon" as const,
        coordinates: [
            [
                [x0, y0],
                [x1, y0],
                [x1, y1],
                [x0, y1],
                [x0, y0],
            ],
        ],
    };
}

const RN = polygon(200, 200, 280, 280);
const N = 256;
const CELL = 1024 / N;

/** Ein Kamm West–Ost durch die Mitte mit einem Gipfel; Saat auf dem Gitter (Zeile 0 im Süden), 0 am Umriss. */
function saat(): StoredRaster {
    const width = 21;
    const samples = new Uint16Array(width * width);
    for (let j = 0; j < width; j++)
        for (let i = 0; i < width; i++) {
            const x = 200 + CELL / 2 + i * CELL,
                y = 200 + CELL / 2 + j * CELL;
            const rand = Math.min(x - 200, 280 - x, y - 200, 280 - y);
            const kamm = Math.exp(-0.5 * ((y - 240) / 10) ** 2);
            const quer = 0.35 + 0.15 * Math.cos((x - 200) / 6);
            samples[j * width + i] = Math.round(2000 * Math.min(1, rand / 12) * (kamm * 0.8 + quer * 0.4));
        }
    return { width, height: width, cell: CELL, originX: 200 + CELL / 2, originY: 200 + CELL / 2, samples };
}

/** Kamm und Punkt auf Zellmitten des Testgitters (4 E): Die Weiten des Formerhalts (bis 1,25 E) sind kleiner als eine Zelle. */
const NETZ: RueckennetzNetz = {
    kaemme: [
        [
            [202, 238],
            [278, 238],
        ],
    ],
    punkte: [{ x: 242, y: 238 }],
};

function domain(extra: Partial<DomainInputs> = {}): DomainInputs {
    const continent = polygon(0, 0, 1024, 1024);
    return {
        continent: { id: "land", fingerprint: "land", geometry: continent },
        land: [continent],
        seeds: [saat()],
        peaks: [{ id: "g", name: "Gipfel", x: 240, y: 240, h: 2000 }],
        fingerprint: "fixture",
        water: [],
        landscapes: [{ layer: "topographie", type: "gebirge", geometry: RN }],
        rivers: { rivers: [], lakes: [], fingerprint: "no-rivers" },
        rueckennetz: [{ id: "rn", geometry: RN, deckel: 2000, netz: NETZ }],
        ...extra,
    };
}

const F18 = AVENTURIA_TERRAIN_RECIPES.get(18)!;
const mit = (formerhalt: NonNullable<TerrainRecipe["mountainMorphology"]["rueckennetz"]>): TerrainRecipe => {
    const recipe = structuredClone(F18);
    recipe.mountainMorphology.rueckennetz = formerhalt;
    return recipe;
};
const sha = (samples: Uint16Array) =>
    createHash("sha256").update(Buffer.from(samples.buffer)).digest("hex").slice(0, 16);

describe("WI-0249 P2: Formerhalt der Rückennetz-Gebirge im Gelände", () => {
    it("🔴 rechnet ohne Formerhalt (Fassung 18) Zeichen für Zeichen wie vor P2, auch mit Netz am Gebirge", () => {
        const raster = generateDomainTerrain(domain(), F18, N).raster;
        expect(sha(raster.samples)).toBe(VOR_P2);
        // Ein leerer Eintrag legt nur Saaten auf das Gitter (Lader); das Gelände selbst rechnet wie ohne.
        expect(sha(generateDomainTerrain(domain(), mit({}), N).raster.samples)).toBe(VOR_P2);
    }, 120_000);

    it("bettet die Saat höhenbewusst ein: am Umriss das Land, ab dem k-fachen Land die Saat genau, dazwischen steigend", () => {
        expect(bette(400, 0, 3)).toBe(400);
        expect(bette(400, 1200, 3)).toBe(1200);
        expect(bette(400, 2000, 3)).toBe(2000);
        let vorher = -Infinity;
        for (let s = 0; s <= 2000; s += 25) {
            const h = bette(400, s, 3);
            expect(h).toBeGreaterThan(vorher);
            expect(h).toBeGreaterThanOrEqual(Math.max(400, s) - 1e-9);
            vorher = h;
        }
        // Stetig am oberen Ende: kein Knick.
        expect(bette(400, 1199, 3) - bette(400, 1198, 3)).toBeCloseTo(1, 2);
        // Ohne Land oder mit k unter 2 das Maximum.
        expect(bette(0, 500, 3)).toBe(500);
        expect(bette(400, 100, 1.5)).toBe(400);
    });

    it("hält mit der Einbettung Täler und Flanken am Umriss, statt sie auf das Land zu heben", () => {
        const g = grid(N);
        const alt = formInitialTerrain(g, domain(), F18).height;
        const neu = formInitialTerrain(g, domain(), mit({ einbettung: 2 })).height;
        // Zellen der Fläche, in denen die Saat unter dem Land liegt: Mit dem Maximum stehen sie alle auf dem Land, jetzt nach der Saat
        // gestaffelt (die Spanne der Höhen dort bleibt).
        const zellen: number[] = [];
        const roh = saat();
        for (let j = 1; j < roh.height - 1; j++)
            for (let i = 1; i < roh.width - 1; i++) {
                const gx = Math.floor((roh.originX + i * CELL) / CELL),
                    gy = Math.floor((1024 - (roh.originY + j * CELL)) / CELL);
                const k = gy * N + gx;
                if (roh.samples[j * roh.width + i]! < alt[k]! - 1) zellen.push(k);
            }
        expect(zellen.length).toBeGreaterThan(10);
        const spanne = (h: Float32Array) =>
            Math.max(...zellen.map((k) => h[k]!)) - Math.min(...zellen.map((k) => h[k]!));
        expect(spanne(neu)).toBeGreaterThan(spanne(alt) + 50);
        // Außerhalb der Fläche und auf Kammhöhe unverändert.
        expect(neu[Math.floor((1024 - 600) / CELL) * N + Math.floor(600 / CELL)]).toBe(
            alt[Math.floor((1024 - 600) / CELL) * N + Math.floor(600 / CELL)],
        );
    });

    it("setzt im Fenster das ungeglättete Material und schützt Kamm und Gipfel weich, nicht um Flüsse", () => {
        const g = grid(N);
        const input = domain({
            rivers: {
                rivers: [
                    {
                        id: "f",
                        bach: false,
                        direction: null,
                        coordinates: [
                            [258, 280],
                            [258, 200],
                        ],
                    } as unknown as DomainInputs["rivers"]["rivers"][number],
                ],
                lakes: [],
                fingerprint: "f",
            },
        });
        const land = new Uint8Array(N * N).fill(1);
        const materials = composeMaterials(g, land, input.landscapes, F18, F18.generator.materialBlur);
        expect(formerhaltFenster(g, input, F18, materials)).toEqual([]);
        expect(formerhaltFenster(g, input, mit({ einbettung: 2 }), materials)).toEqual([]);
        const fenster = formerhaltFenster(
            g,
            input,
            mit({ materialRand: 2, kernErosion: 0.25, kernDiffusion: 0.5 }),
            materials,
        );
        expect(fenster).toHaveLength(1);
        const lies = fensterLeser(fenster, N);
        const an = (x: number, y: number, feld: "erodibility" | "diffusivity") =>
            lies(feld, Math.floor(x / CELL), Math.floor((1024 - y) / CELL));
        const typ = F18.topographie["gebirge"]!;
        // Auf dem Kamm, weit vom Umriss: Wert des Gebirges mal Kernfaktor; am Gipfel ebenso.
        expect(an(226, 238, "erodibility")).toBeCloseTo(typ.erodibility * 0.25, 5);
        expect(an(226, 238, "diffusivity")).toBeCloseTo(typ.diffusivity * 0.5, 5);
        expect(an(242, 238, "erodibility")).toBeCloseTo(typ.erodibility * 0.25, 5);
        // Auf der Flanke 12 E vom Kamm: voll erodierbar mit dem Wert des Gebirges.
        expect(an(226, 250, "erodibility")).toBeCloseTo(typ.erodibility, 5);
        // Am Fluss quer über den Kamm: kein Schutz.
        expect(an(258, 238, "erodibility")).toBeCloseTo(typ.erodibility, 5);
        // Ohne Formfaktor im Fenster nur das Material; ohne `materialRand` das Materialfeld selbst.
        const nurFaktor = fensterLeser(formerhaltFenster(g, input, mit({ kernErosion: 0.5 }), materials), N);
        const zelle = [Math.floor(226 / CELL), Math.floor((1024 - 250) / CELL)] as const;
        const sample = landscapeSampler(materials.m, N);
        expect(nurFaktor("erodibility", ...zelle)).toBeCloseTo(sample(materials.erodibility, ...zelle), 5);
        // Außerhalb der Fläche nichts.
        expect(Number.isNaN(an(190, 238, "erodibility"))).toBe(true);
    });

    it("lässt mit `hebungFolgt` das Hebungsgewicht im Fenster dem Gestein folgen, außerhalb nichts", () => {
        const g = grid(N);
        const input = domain();
        const land = new Uint8Array(N * N).fill(1);
        const materials = composeMaterials(g, land, input.landscapes, F18, F18.generator.materialBlur);
        const ohne = formerhaltFenster(g, input, mit({ materialRand: 2, kernErosion: 0.25 }), materials);
        expect(ohne[0]!.upliftWeight).toBeUndefined();
        const fenster = formerhaltFenster(
            g,
            input,
            mit({ materialRand: 2, kernErosion: 0.25, hebungFolgt: 1 }),
            materials,
        );
        const lies = fensterLeser(fenster, N);
        const sample = landscapeSampler(materials.m, N);
        // Ein Faktor je Gebirge (Summe der Erodierbarkeit im Fenster gegen das Materialfeld): auf Kamm und Flanke dasselbe Verhältnis.
        const zellen = [
            [226, 238],
            [226, 250],
        ].map(([x, y]) => [Math.floor(x! / CELL), Math.floor((1024 - y!) / CELL)] as const);
        const faktoren = zellen.map((z) => lies("upliftWeight", ...z) / sample(materials.upliftWeight, ...z));
        expect(faktoren[0]).toBeCloseTo(faktoren[1]!, 5);
        expect(faktoren[0]).toBeLessThan(1);
        expect(Number.isNaN(lies("upliftWeight", Math.floor(190 / CELL), Math.floor((1024 - 238) / CELL)))).toBe(true);
    });

    it("hebt mit `hebungFolgt` das Gebirge über die Erosion nicht stärker als ohne Formerhalt; die Masse bleibt erhalten", () => {
        const mittelInnen = (r: StoredRaster) => {
            let summe = 0,
                n = 0;
            for (let j = 0; j < N; j++)
                for (let i = 0; i < N; i++) {
                    const x = (i + 0.5) * CELL,
                        y = (j + 0.5) * CELL;
                    if (x > 204 && x < 276 && y > 204 && y < 276) {
                        summe += r.samples[j * N + i]!;
                        n++;
                    }
                }
            return summe / n;
        };
        const lauf = (f: Parameters<typeof mit>[0]) => generateDomainTerrain(domain(), mit(f), N);
        const vorher = lauf({});
        const formerhalt = lauf({ materialRand: 2, kernErosion: 0.25, kernDiffusion: 0.3 });
        const folgt = lauf({ materialRand: 2, kernErosion: 0.25, kernDiffusion: 0.3, hebungFolgt: 1 });
        // Ohne `hebungFolgt` wächst das Gebirge, weil weniger Abtrag auf dasselbe Hebungsgewicht trifft; mit ihm nicht mehr als vorher.
        expect(mittelInnen(formerhalt.raster)).toBeGreaterThan(mittelInnen(vorher.raster));
        expect(mittelInnen(folgt.raster)).toBeLessThan(mittelInnen(formerhalt.raster));
        // Die Rückverteilung gibt den Verlust jeder Runde zurück: Masse nach der Runde gleich der vor ihr (bis auf Rundung).
        for (const runde of folgt.report.masses)
            expect(Math.abs(runde.after - runde.before) / runde.before).toBeLessThan(1e-4);
    }, 120_000);

    it("erodiert mit Formfaktor den Kamm weniger als ohne, die Flanken wie zuvor", () => {
        const ohne = generateDomainTerrain(domain(), mit({}), N).raster;
        const mitFaktor = generateDomainTerrain(domain(), mit({ kernErosion: 0.25, kernDiffusion: 0.3 }), N).raster;
        // Mittel einer Zeile (Gitterausrichtung des gespeicherten Rasters: Zeile 0 im Süden).
        const zeile = (r: StoredRaster, y: number) => {
            const j = Math.floor(y / CELL);
            let summe = 0,
                n = 0;
            for (let x = 210; x <= 270; x += CELL, n++) summe += r.samples[j * N + Math.floor(x / CELL)]!;
            return summe / n;
        };
        // Der Kamm (y = 238) steht höher über seiner Flanke (y = 254) als ohne Formerhalt; die Flanke selbst bleibt fast gleich.
        const relief = (r: StoredRaster) => zeile(r, 238) - zeile(r, 254);
        expect(relief(mitFaktor)).toBeGreaterThan(relief(ohne) + 10);
        expect(Math.abs(zeile(mitFaktor, 254) - zeile(ohne, 254))).toBeLessThan(10);
    }, 120_000);
});

describe("WI-0249 P2: Erosion im Gelände und Sättel", () => {
    /** Ein Fluss quer durch das Gebirge (Nord–Süd bei x = 258). */
    const FLUSS: DomainInputs["rivers"] = {
        rivers: [
            {
                id: "f",
                bach: false,
                direction: null,
                coordinates: [
                    [258, 280],
                    [258, 200],
                ],
            } as unknown as DomainInputs["rivers"]["rivers"][number],
        ],
        lakes: [],
        fingerprint: "f",
    };
    const mitErosion = (erosion: number | undefined, extra: Partial<DomainInputs> = {}) =>
        domain({
            rueckennetz: [
                { id: "rn", geometry: RN, deckel: 2000, netz: NETZ, ...(erosion === undefined ? {} : { erosion }) },
            ],
            ...extra,
        });
    const FORMERHALT = { materialRand: 2, kernErosion: 0.25, kernDiffusion: 0.5 } as const;

    it("drosselt Erodierbarkeit und Diffusivität im Fenster mit dem Anteil des Typs, frei um Flüsse; volle Erosion rechnet wie zuvor", () => {
        const g = grid(N);
        const land = new Uint8Array(N * N).fill(1);
        const materials = composeMaterials(g, land, domain().landscapes, F18, F18.generator.materialBlur);
        const fenster = (erosion: number | undefined, recipe = mit(FORMERHALT)) =>
            formerhaltFenster(g, mitErosion(erosion, { rivers: FLUSS }), recipe, materials);
        // Volle Erosion (fehlend oder 1): dieselben Fenster wie vor dem Wert.
        expect(fenster(1)).toEqual(fenster(undefined));
        const voll = fensterLeser(fenster(undefined), N);
        const halb = fensterLeser(fenster(0.5), N);
        const zelle = (x: number, y: number) => [Math.floor(x / CELL), Math.floor((1024 - y) / CELL)] as const;
        for (const feld of ["erodibility", "diffusivity"] as const) {
            // Kamm und Flanke: halbe Erosion; am Fluss voll.
            expect(halb(feld, ...zelle(226, 238)) / voll(feld, ...zelle(226, 238))).toBeCloseTo(0.5, 5);
            expect(halb(feld, ...zelle(226, 250)) / voll(feld, ...zelle(226, 250))).toBeCloseTo(0.5, 5);
            expect(halb(feld, ...zelle(258, 250))).toBeCloseTo(voll(feld, ...zelle(258, 250)), 5);
        }
        // Ohne Formerhalt im Rezept (Fassung 18) nur mit gedrosselter Erosion ein Fenster: das Materialfeld mal dem Anteil.
        expect(fenster(undefined, F18)).toEqual([]);
        const nur = fensterLeser(fenster(0.3, F18), N);
        const sample = landscapeSampler(materials.m, N);
        expect(nur("erodibility", ...zelle(226, 250))).toBeCloseTo(
            sample(materials.erodibility, ...zelle(226, 250)) * 0.3,
            5,
        );
        expect(Number.isNaN(nur("erodibility", ...zelle(190, 238)))).toBe(true);
    });

    it("lässt mit Erosion im Gelände 0 die eingebettete Saat stehen; der Fluss quer durch das Gebirge fällt weiter", () => {
        const recipe = mit({ ...FORMERHALT, hebungFolgt: 1 });
        const lauf = (erosion: number | undefined) => {
            const sichten = new Map<string, Float32Array>();
            const ergebnis = generateDomainTerrain(
                mitErosion(erosion, { rivers: FLUSS }),
                recipe,
                N,
                undefined,
                undefined,
                undefined,
                undefined,
                (phase, sicht) => {
                    if (phase === "seed" || phase === "erosion") sichten.set(phase, Float32Array.from(sicht.hoehe));
                },
            );
            // Mittlere Änderung der Erosion im Inneren (Zeile 0 im Norden), ohne die Zellen am Fluss.
            const seed = sichten.get("seed")!;
            const nach = sichten.get("erosion")!;
            let summe = 0,
                n = 0;
            for (let j = 0; j < N; j++)
                for (let i = 0; i < N; i++) {
                    const x = (i + 0.5) * CELL,
                        y = 1024 - (j + 0.5) * CELL;
                    if (x > 206 && x < 274 && y > 206 && y < 274 && Math.abs(x - 258) > 6) {
                        summe += Math.abs(nach[j * N + i]! - seed[j * N + i]!);
                        n++;
                    }
                }
            return { aenderung: summe / n, raster: ergebnis.raster };
        };
        const voll = lauf(undefined);
        const aus = lauf(0);
        expect(voll.aenderung).toBeGreaterThan(20);
        expect(aus.aenderung).toBeLessThan(0.2 * voll.aenderung);
        // Der Fluss fällt auf seinem ganzen Lauf durch das Gebirge in eine Richtung (gespeichertes Raster: Zeile 0 im Süden).
        const flusslauf: number[] = [];
        for (let y = 202; y <= 278; y += CELL)
            flusslauf.push(aus.raster.samples[Math.floor(y / CELL) * N + Math.floor(258 / CELL)]!);
        const faellt = flusslauf.every((h, k) => k === 0 || h <= flusslauf[k - 1]!);
        const steigt = flusslauf.every((h, k) => k === 0 || h >= flusslauf[k - 1]!);
        expect(faellt || steigt).toBe(true);
    }, 240_000);

    it("hebt die Köpfe der Nebengipfel nach der Erosion zur Saat, nie tiefer, nicht am Fluss (`stelleKoepfeWieder`)", () => {
        // 10 × 10 E auf 0,25 E (Zeile 0 im Süden), ab 200/200: abgetragenes Gelände 1.000, die Saat ein Kopf 1.600 bei 205/205.
        const w = 40;
        const raster = (wert: number): StoredRaster => ({
            cell: 0.25,
            originX: 200.125,
            originY: 200.125,
            width: w,
            height: w,
            samples: new Uint16Array(w * w).fill(wert),
        });
        const saat = raster(0);
        for (let j = 0; j < w; j++)
            for (let i = 0; i < w; i++) {
                const d = Math.hypot(200.125 + i * 0.25 - 205, 200.125 + j * 0.25 - 205);
                saat.samples[j * w + i] = Math.round(1600 - 300 * Math.min(1, d));
            }
        const fluss = {
            id: "f",
            bach: false,
            direction: null,
            coordinates: [
                [205.75, 200],
                [205.75, 210],
            ],
        } as unknown as DomainInputs["rivers"]["rivers"][number];
        const eingabe = (kopf?: number) =>
            domain({
                seeds: [saat],
                rivers: { rivers: [fluss], lakes: [], fingerprint: "f" },
                rueckennetz: [
                    {
                        id: "rn",
                        geometry: RN,
                        deckel: 2000,
                        saat: 0,
                        netz: { kaemme: [], punkte: [{ x: 205, y: 205, ...(kopf === undefined ? {} : { kopf }) }] },
                    },
                ],
            });
        const an = (r: StoredRaster, x: number, y: number) =>
            r.samples[Math.round((y - 200.125) / 0.25) * w + Math.round((x - 200.125) / 0.25)]!;
        const erlaubt = new Uint8Array(w * w).fill(1);
        const ohne = raster(1000);
        expect(stelleKoepfeWieder(ohne, eingabe(), erlaubt)).toBe(0);
        const mit = raster(1000);
        expect(stelleKoepfeWieder(mit, eingabe(1), erlaubt)).toBeGreaterThan(0);
        // Am Punkt die Saat, bis zum halben Radius voll, außerhalb des Radius nichts; am Fluss (0,5 E) nichts.
        expect(an(mit, 205.125, 205.125)).toBeGreaterThan(1500);
        expect(an(mit, 204.625, 205.125)).toBe(Math.round(1600 - 300 * Math.hypot(0.375, 0.125)));
        expect(an(mit, 203.875, 205.125)).toBe(1000);
        expect(an(mit, 205.625, 205.125)).toBe(1000);
        // Nie tiefer: Gelände über der Saat bleibt.
        const hoch = raster(1700);
        stelleKoepfeWieder(hoch, eingabe(1), erlaubt);
        expect(hoch.samples.every((v) => v === 1700)).toBe(true);
    });

    it("schützt einen Nebengipfel mit Kegel über seinen Kopfradius wie einen Gipfelkern (`kopf`)", () => {
        const n = 1024;
        const g = grid(n);
        const land = new Uint8Array(n * n).fill(1);
        const materials = composeMaterials(g, land, domain().landscapes, F18, F18.generator.materialBlur);
        const mitPunkt = (kopf?: number) =>
            domain({
                rueckennetz: [
                    {
                        id: "rn",
                        geometry: RN,
                        deckel: 2000,
                        netz: { kaemme: [], punkte: [{ x: 240.5, y: 250.5, ...(kopf === undefined ? {} : { kopf }) }] },
                    },
                ],
            });
        const lies = (kopf?: number) =>
            fensterLeser(
                formerhaltFenster(g, mitPunkt(kopf), mit({ materialRand: 2, kernErosion: 0.25 }), materials),
                n,
            );
        const an = (l: ReturnType<typeof lies>, d: number) => l("erodibility", 240, Math.floor(1024 - 250.5 - d));
        const typ = F18.topographie["gebirge"]!;
        // Am Punkt beide voll geschützt; 1 E daneben nur mit Kopfradius 2 E (voll bis 1 E), ohne ihn fast frei.
        expect(an(lies(), 0)).toBeCloseTo(typ.erodibility * 0.25, 5);
        expect(an(lies(2), 0)).toBeCloseTo(typ.erodibility * 0.25, 5);
        expect(an(lies(2), 1)).toBeCloseTo(typ.erodibility * 0.25, 5);
        expect(an(lies(), 1)).toBeGreaterThan(typ.erodibility * 0.7);
    }, 60_000);

    it("schützt an durchhängenden Kämmen die Kammpunkte wie Gipfel und gibt die Segmentmitten frei (`sattelAbtrag`)", () => {
        // Auf 1 E (1024²): Kammpunkte auf Zellmitten, zwei Segmente von 20 E (voll durchhängend).
        const n = 1024;
        const g = grid(n);
        const land = new Uint8Array(n * n).fill(1);
        const materials = composeMaterials(g, land, domain().landscapes, F18, F18.generator.materialBlur);
        const netz: RueckennetzNetz = {
            kaemme: [
                [
                    [220.5, 240.5],
                    [240.5, 240.5],
                    [260.5, 240.5],
                ],
            ],
            punkte: [],
            sattel: [[0.15, 0.15]],
        };
        const input = domain({ rueckennetz: [{ id: "rn", geometry: RN, deckel: 2000, netz }] });
        const lies = (sattelAbtrag?: number) =>
            fensterLeser(
                formerhaltFenster(
                    g,
                    input,
                    mit({
                        materialRand: 2,
                        kernErosion: 0.25,
                        ...(sattelAbtrag === undefined ? {} : { sattelAbtrag }),
                    }),
                    materials,
                ),
                n,
            );
        const an = (l: ReturnType<typeof lies>, x: number) => l("erodibility", Math.floor(x), Math.floor(1024 - 240.5));
        const typ = F18.topographie["gebirge"]!;
        const ohne = lies();
        const mitAbtrag = lies(0.5);
        // Ohne den Wert: Punkt und Segmentmitte gleich geschützt (Faktor 0,25).
        expect(an(ohne, 230.5)).toBeCloseTo(typ.erodibility * 0.25, 5);
        expect(an(ohne, 240.5)).toBeCloseTo(typ.erodibility * 0.25, 5);
        // Mit ihm: der Punkt wie ein Gipfelkern, die Mitte zur Hälfte frei (1 − 0,75 · 0,5).
        expect(an(mitAbtrag, 240.5)).toBeCloseTo(typ.erodibility * 0.25, 5);
        expect(an(mitAbtrag, 230.5)).toBeCloseTo(typ.erodibility * 0.625, 3);
        // Dazwischen weich steigend.
        expect(an(mitAbtrag, 236.5)).toBeGreaterThan(an(mitAbtrag, 240.5));
        expect(an(mitAbtrag, 236.5)).toBeLessThan(an(mitAbtrag, 230.5));
        // Ohne Durchhang am Netz bleibt alles wie ohne den Wert.
        const gerade = domain({
            rueckennetz: [{ id: "rn", geometry: RN, deckel: 2000, netz: { kaemme: netz.kaemme, punkte: netz.punkte } }],
        });
        expect(
            formerhaltFenster(g, gerade, mit({ materialRand: 2, kernErosion: 0.25, sattelAbtrag: 0.5 }), materials),
        ).toEqual(formerhaltFenster(g, gerade, mit({ materialRand: 2, kernErosion: 0.25 }), materials));
    }, 60_000);
});

describe("WI-0249: Erosionsfestigkeit je Gebirge (Fassung 19)", () => {
    // Betreiber 2026-10-25: „schön wärs, wenn ich jedem modellierten gebirge sagen könnte, wie stark es von der hydraulischen erosion
    // beeinflusst werden darf“. 0 = wie die Landschaftsart (Zeichen für Zeichen wie ohne den Wert), 1 = die Erosion der Landfläche lässt es
    // unberührt: Erodierbarkeit der Zellen mal (1 − F), dazu das Hebungsgewicht der Rückverteilung; Hangdiffusion bleibt. Problemfälle: 0 ändert
    // etwas; 1 lässt Einschneiden oder Rückverteilung das Gebirge noch verändern; die Diffusivität sinkt mit; ein Fluss schneidet nicht mehr.
    const FLUSS: DomainInputs["rivers"] = {
        rivers: [
            {
                id: "f",
                bach: false,
                direction: null,
                coordinates: [
                    [258, 280],
                    [258, 200],
                ],
            } as unknown as DomainInputs["rivers"]["rivers"][number],
        ],
        lakes: [],
        fingerprint: "f",
    };
    const mitFestigkeit = (festigkeit: number | undefined, extra: Partial<DomainInputs> = {}) =>
        domain({
            rueckennetz: [
                {
                    id: "rn",
                    geometry: RN,
                    deckel: 2000,
                    netz: NETZ,
                    ...(festigkeit === undefined ? {} : { festigkeit }),
                },
            ],
            ...extra,
        });
    const FORMERHALT = { materialRand: 2, kernErosion: 0.25, kernDiffusion: 0.5, hebungFolgt: 1 } as const;
    const zelle = (x: number, y: number) => [Math.floor(x / CELL), Math.floor((1024 - y) / CELL)] as const;

    it("🔴 im Fenster: Erodierbarkeit und Hebungsgewicht mal (1 − F), die Diffusivität bleibt, am Fluss voll; 0 rechnet wie ohne den Wert", () => {
        const g = grid(N);
        const land = new Uint8Array(N * N).fill(1);
        const materials = composeMaterials(g, land, domain().landscapes, F18, F18.generator.materialBlur);
        const fenster = (festigkeit: number | undefined, recipe = mit(FORMERHALT)) =>
            formerhaltFenster(g, mitFestigkeit(festigkeit, { rivers: FLUSS }), recipe, materials);
        expect(fenster(0)).toEqual(fenster(undefined));
        const ohne = fensterLeser(fenster(undefined), N);
        const halb = fensterLeser(fenster(0.5), N);
        const ganz = fensterLeser(fenster(1), N);
        for (const [x, y] of [
            [226, 238],
            [226, 250],
        ] as const) {
            expect(halb("erodibility", ...zelle(x, y)) / ohne("erodibility", ...zelle(x, y))).toBeCloseTo(0.5, 5);
            expect(halb("upliftWeight", ...zelle(x, y)) / ohne("upliftWeight", ...zelle(x, y))).toBeCloseTo(0.5, 5);
            expect(ganz("erodibility", ...zelle(x, y))).toBe(0);
            expect(ganz("upliftWeight", ...zelle(x, y))).toBe(0);
            // Die Hangdiffusion bleibt.
            expect(ganz("diffusivity", ...zelle(x, y))).toBeCloseTo(ohne("diffusivity", ...zelle(x, y)), 5);
        }
        // Am Fluss kein Schutz: Er schneidet wie zuvor durch.
        expect(ganz("erodibility", ...zelle(258, 250))).toBeCloseTo(ohne("erodibility", ...zelle(258, 250)), 5);
        // Außerhalb der Fläche kein Fenster (am Umriss blendet der Schutz über `materialRand` ein; das Testgitter ist mit 4 E zu grob dafür).
        expect(Number.isNaN(ganz("erodibility", ...zelle(190, 238)))).toBe(true);
        // Ohne Formerhalt im Rezept (Fassung 18) gibt es das Fenster nur mit Wert; ohne Wert keins.
        expect(fenster(undefined, F18)).toEqual([]);
        const nur = fensterLeser(fenster(0.4, F18), N);
        const sample = landscapeSampler(materials.m, N);
        expect(nur("erodibility", ...zelle(226, 250))).toBeCloseTo(
            sample(materials.erodibility, ...zelle(226, 250)) * 0.6,
            5,
        );
    });

    it("🔴 im Gelände: mit 100 % verändert die Erosion das Innere kaum (nur die Hangdiffusion), mit 0 % rechnet es Zeichen für Zeichen wie ohne den Wert", () => {
        const recipe = mit(FORMERHALT);
        const lauf = (festigkeit: number | undefined) => {
            const sichten = new Map<string, Float32Array>();
            const ergebnis = generateDomainTerrain(
                mitFestigkeit(festigkeit, { rivers: FLUSS }),
                recipe,
                N,
                undefined,
                undefined,
                undefined,
                undefined,
                (phase, sicht) => {
                    if (phase === "seed" || phase === "erosion") sichten.set(phase, Float32Array.from(sicht.hoehe));
                },
            );
            const seed = sichten.get("seed")!;
            const nach = sichten.get("erosion")!;
            let summe = 0;
            let n = 0;
            let hoeher = 0;
            for (let j = 0; j < N; j++)
                for (let i = 0; i < N; i++) {
                    const x = (i + 0.5) * CELL;
                    const y = 1024 - (j + 0.5) * CELL;
                    if (x > 206 && x < 274 && y > 206 && y < 274 && Math.abs(x - 258) > 6) {
                        summe += Math.abs(nach[j * N + i]! - seed[j * N + i]!);
                        hoeher += nach[j * N + i]! - seed[j * N + i]!;
                        n++;
                    }
                }
            return { aenderung: summe / n, hoeher: hoeher / n, raster: ergebnis.raster };
        };
        const ohne = lauf(undefined);
        const null0 = lauf(0);
        const fest = lauf(1);
        expect(sha(null0.raster.samples)).toBe(sha(ohne.raster.samples));
        expect(ohne.aenderung).toBeGreaterThan(20);
        // Mit 100 % bleibt nur die Hangdiffusion (und der Rand); weder Einschneiden noch Rückverteilung tragen das Innere ab oder auf.
        expect(fest.aenderung).toBeLessThan(0.2 * ohne.aenderung);
    }, 240_000);
});

/** `generateDomainTerrain(domain(), Fassung 18, 256)` auf `origin/master` f3cf74b39 (vor WI-0249 P2). */
const VOR_P2 = "7a62a14a460db32b";

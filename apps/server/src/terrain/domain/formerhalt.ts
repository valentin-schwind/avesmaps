import { durchhangAnteil, durchhangProfil, FORM_KAMM_E, FORM_KERN_E } from "@avesmaps3d/shared";
import { cellX, cellY, MAP_EXTENT, type Grid, type Plane } from "../hydrology/grid.ts";
import { landscapeSampler } from "../hydrology/landscape.ts";
import { distanceTransform, fillWindow, type AreaGeometry } from "../hydrology/water.ts";
import type { DomainInputs } from "./inputs.ts";
import type { MaterialFields } from "./materials.ts";
import type { TerrainRecipe } from "./recipes.ts";

/**
 * Formerhalt der Rückennetz-Gebirge in der Erosion (WI-0249 P2 Schritt 4, Variante V1): keine neue Runde und keine Zwangsrechnung, nur
 * die Stoffwerte, die der vorhandene Einschneide- und Diffusionsschritt ohnehin je Zelle liest, je Gebirge in einem Fenster.
 *
 * - **Ungeglättetes Material** (`materialRand`): Die Materialfelder entstehen auf 1 E mit 5 E Unschärfe. In schmalen Gebirgen gilt
 *   deshalb nicht die Erodierbarkeit des Gebirges (0,08), sondern im Median 0,47 (Blutzinnen; am Umriss über 1), die Diffusivität 1,3
 *   bis 1,6 statt 1. In der Fläche gilt der Wert des Gebirges, vom Umriss nach innen über `materialRand` E eingeblendet (logarithmisch,
 *   wie die Materialien gemischt werden); außerhalb der Fläche bleibt alles, wie es war.
 * - **Formfaktor** (`kernErosion`, `kernDiffusion`): An gezeichneten Kämmen (bis 0,25 E, weich aus bis 1 E) und an gesetzten Punkten
 *   (Gipfel und Nebengipfel, bis 0,5 E, aus bis 1,25 E) nehmen Einschneiden und Hangdiffusion nur diesen Anteil; Flanken und Täler
 *   erodieren voll und bilden weiter Rinnen. Weich auslaufend: keine Mauern entlang der Kämme, keine runden Kappen auf den Gipfeln. Um
 *   Flüsse (bis 0,25 E, aus bis 1 E) gilt kein Schutz: Ein Fluss schneidet durch einen Kamm wie bisher.
 * - **Sättel** (`sattelAbtrag`): Hängt der Typ zwischen den Kammpunkten durch (`RueckennetzNetz.sattel`), schützt der Formfaktor die
 *   Kammpunkte wie Gipfelkerne, und an der Kammachse gibt er die Segmentmitten um `sattelAbtrag · Anteil(L) · Profil(u)` frei (dieselbe
 *   Form wie der Durchhang der Saat): Die Sättel tragen mehr ab als die Punkte.
 * - **Erosion im Gelände** (Typwert `form.gelaendeErosion`, `RueckennetzGebirge.erosion`): Erodierbarkeit und Diffusivität des
 *   Gebirges mal diesem Anteil, vom Umriss nach innen über `materialRand` eingeblendet (keine Mauer am Umriss), um Flüsse wie beim
 *   Formfaktor frei. Mit `hebungFolgt` folgt ihm die Rückverteilung; bei 0 bleibt die eingebettete Saat stehen.
 *
 * Das Feld rechnet einmal je Lauf. Außerhalb der Fenster und ohne den Eintrag im Rezept liest die Erosion Zeichen für Zeichen dasselbe.
 */

/**
 * Ein Gebirge: das Fenster seiner Zellen (Spalte, Zeile; Zeile 0 im Norden) mit Erodierbarkeit und Diffusivität, NaN außerhalb; mit
 * `hebungFolgt` auch das Hebungsgewicht der Rückverteilung.
 */
export interface FormerhaltFenster {
    x0: number;
    y0: number;
    w: number;
    h: number;
    erodibility: Float32Array;
    diffusivity: Float32Array;
    upliftWeight?: Float32Array;
}
/** Die Felder eines Fensters, die die Erosion liest. */
export type FensterFeld = "erodibility" | "diffusivity" | "upliftWeight";

/** Kammachse voll bis 0,25 E, aus bei 1 E; Gipfelkern voll bis 0,5 E, aus bei 1,25 E: dieselben Weiten wie das Muster am Kamm der Saat. */
const [KAMM_KERN_E, KAMM_AUSLAUF_E] = FORM_KAMM_E;
const [GIPFEL_KERN_E, GIPFEL_AUSLAUF_E] = FORM_KERN_E;
/** VORSCHLAG: Um Flüsse kein Schutz bis 0,25 E, voller Schutz ab 1 E. */
export const FLUSS_FREI_E = 0.25;
export const FLUSS_AUSLAUF_E = 0.75;

const glatt = (t: number): number => {
    const u = Math.max(0, Math.min(1, t));
    return u * u * (3 - 2 * u);
};

function rahmen(geometry: AreaGeometry): [number, number, number, number] {
    let x0 = Infinity,
        y0 = Infinity,
        x1 = -Infinity,
        y1 = -Infinity;
    const polygone = (
        geometry.type === "MultiPolygon" ? geometry.coordinates : [geometry.coordinates]
    ) as number[][][][];
    for (const polygon of polygone)
        for (const ring of polygon)
            for (const [x, y] of ring as [number, number][]) {
                x0 = Math.min(x0, x);
                y0 = Math.min(y0, y);
                x1 = Math.max(x1, x);
                y1 = Math.max(y1, y);
            }
    return [x0, y0, x1, y1];
}

/** VORSCHLAG: Breite (E), über die die Erosion im Gelände vom Umriss nach innen einblendet, wenn das Rezept keinen `materialRand` führt. */
export const EROSION_RAND_E = 1.5;

/**
 * Stempelt `wert(d, s, t)` (Abstand in E; Segment s ab 1 und Lage t von 0 bis 1 darin) entlang eines Linienzugs bis `reich` E in das
 * Fenster; behält je Zelle das Beste (`besser`).
 */
function stempleLinie(
    g: Grid,
    plane: Plane,
    feld: Float32Array,
    punkte: readonly (readonly [number, number])[],
    reich: number,
    wert: (d: number, s: number, t: number) => number,
    besser: (neu: number, alt: number) => boolean,
): void {
    const r = Math.ceil(reich / g.cell);
    const stemple = (px: number, py: number, s: number, t: number): void => {
        const ci = Math.floor(px / g.cell) - plane.x0;
        const cj = Math.floor((MAP_EXTENT - py) / g.cell) - plane.y0;
        for (let j = Math.max(0, cj - r); j <= Math.min(plane.height - 1, cj + r); j++)
            for (let i = Math.max(0, ci - r); i <= Math.min(plane.width - 1, ci + r); i++) {
                const d = Math.hypot(cellX(g, plane.x0 + i) - px, cellY(g, plane.y0 + j) - py);
                if (d > reich) continue;
                const v = wert(d, s, t);
                const k = j * plane.width + i;
                if (besser(v, feld[k]!)) feld[k] = v;
            }
    };
    if (punkte.length === 1) stemple(punkte[0]![0], punkte[0]![1], 0, 0);
    for (let s = 1; s < punkte.length; s++) {
        const [ax, ay] = punkte[s - 1]!;
        const [bx, by] = punkte[s]!;
        const l = Math.hypot(bx - ax, by - ay);
        const schritte = Math.max(1, Math.ceil(l / (g.cell / 2)));
        for (let t = s === 1 ? 0 : 1; t <= schritte; t++)
            stemple(ax + ((bx - ax) * t) / schritte, ay + ((by - ay) * t) / schritte, s, t / schritte);
    }
}

/**
 * Die Fenster aller Rückennetz-Gebirge; leer ohne den Formerhalt des Rezepts (Einbettung allein braucht keins) und ohne Gebirge mit
 * gedrosselter Erosion im Gelände.
 */
export function formerhaltFenster(
    g: Grid,
    input: DomainInputs,
    recipe: TerrainRecipe,
    materials: MaterialFields,
): FormerhaltFenster[] {
    if (!input.rueckennetz?.length) return [];
    const f = recipe.mountainMorphology.rueckennetz ?? {};
    const formerhalt = f.materialRand !== undefined || f.kernErosion !== undefined || f.kernDiffusion !== undefined;
    if (
        !formerhalt &&
        !input.rueckennetz.some((gebirge) => (gebirge.erosion ?? 1) < 1 || (gebirge.festigkeit ?? 0) > 0)
    )
        return [];
    const typ = recipe.topographie["gebirge"];
    const sample = landscapeSampler(materials.m, g.n);
    const kernE = f.kernErosion ?? 1;
    const kernD = f.kernDiffusion ?? 1;
    const sattelAbtrag = f.sattelAbtrag ?? 0;
    const fenster: FormerhaltFenster[] = [];
    for (const gebirge of input.rueckennetz) {
        const erosion = gebirge.erosion ?? 1;
        // Erosionsfestigkeit (Fassung 19): 0 bis 1, nur über 0 (sonst Zeichen für Zeichen wie zuvor).
        const festigkeit = (gebirge.festigkeit ?? 0) > 0 ? Math.min(1, gebirge.festigkeit!) : 0;
        if (!formerhalt && !(erosion < 1) && !(festigkeit > 0)) continue;
        const [bx0, by0, bx1, by1] = rahmen(gebirge.geometry);
        const x0 = Math.max(0, Math.floor(bx0 / g.cell) - 1);
        const x1 = Math.min(g.n - 1, Math.ceil(bx1 / g.cell) + 1);
        const y0 = Math.max(0, Math.floor((MAP_EXTENT - by1) / g.cell) - 1);
        const y1 = Math.min(g.n - 1, Math.ceil((MAP_EXTENT - by0) / g.cell) + 1);
        if (x1 < x0 || y1 < y0) continue;
        const plane: Plane = { width: x1 - x0 + 1, height: y1 - y0 + 1, cell: g.cell, x0, y0 };
        const zellen = plane.width * plane.height;
        const drin = new Uint8Array(zellen);
        fillWindow(g, plane, gebirge.geometry, (k) => {
            drin[k] = 1;
        });
        // Abstand zum Umriss nach innen (Zellen): zur nächsten Zelle außerhalb; der Rand des Fensters liegt außerhalb der Fläche.
        const innen = new Float32Array(zellen);
        if (f.materialRand !== undefined || erosion < 1 || festigkeit > 0)
            distanceTransform(plane, (k) => drin[k] === 0, innen);
        // Nähe zu Kammachse und Gipfelkern (1 bis 0), ohne Schutz um Flüsse.
        const naehe = new Float32Array(zellen);
        const netz = gebirge.netz;
        const groesser = (neu: number, alt: number) => neu > alt;
        const schutz = netz !== undefined && (kernE < 1 || kernD < 1);
        // Um Flüsse 0 bis 0,25 E, weich auf 1 bei 1 E: dort kein Schutz und keine gedrosselte Erosion.
        let fluss: Float32Array | null = null;
        if (schutz || erosion < 1 || festigkeit > 0) {
            fluss = new Float32Array(zellen).fill(1);
            for (const river of input.rivers.rivers)
                stempleLinie(
                    g,
                    plane,
                    fluss,
                    river.coordinates,
                    FLUSS_FREI_E + FLUSS_AUSLAUF_E,
                    (d) => glatt((d - FLUSS_FREI_E) / FLUSS_AUSLAUF_E),
                    (neu, alt) => neu < alt,
                );
        }
        if (schutz) {
            // Sättel: nur mit dem Wert des Rezepts und an Kämmen, deren Typ durchhängt.
            const sattel = sattelAbtrag > 0 ? netz.sattel : undefined;
            netz.kaemme.forEach((kamm, nr) => {
                const tiefen = sattel?.[nr];
                const frei = (s: number, t: number): number => {
                    if (!tiefen || !((tiefen[s - 1] ?? 0) > 0)) return 1;
                    const [ax, ay] = kamm[s - 1]!;
                    const [bx, by] = kamm[s]!;
                    const l = Math.hypot(bx - ax, by - ay);
                    return 1 - sattelAbtrag * durchhangAnteil(l) * durchhangProfil(t, l);
                };
                stempleLinie(
                    g,
                    plane,
                    naehe,
                    kamm,
                    KAMM_KERN_E + KAMM_AUSLAUF_E,
                    tiefen
                        ? (d, s, t) => (1 - glatt((d - KAMM_KERN_E) / KAMM_AUSLAUF_E)) * frei(s, t)
                        : (d) => 1 - glatt((d - KAMM_KERN_E) / KAMM_AUSLAUF_E),
                    groesser,
                );
            });
            // Die Punkte eines durchhängenden Segments sind Kerne wie die Gipfel (doppelte stempeln dasselbe). Ein Nebengipfel mit Kegel
            // (`kopf`, Kopfradius) ist ein Kern über diesen Radius: voll bis zu seiner Hälfte, aus nach drei Vierteln mehr.
            const kerne: { x: number; y: number; voll?: number; aus?: number }[] = netz.punkte.map((p) =>
                p.kopf !== undefined
                    ? {
                          x: p.x,
                          y: p.y,
                          voll: Math.max(GIPFEL_KERN_E, 0.5 * p.kopf),
                          aus: Math.max(GIPFEL_AUSLAUF_E, 0.75 * p.kopf),
                      }
                    : p,
            );
            if (sattel)
                netz.kaemme.forEach((kamm, nr) =>
                    (sattel[nr] ?? []).forEach((tiefe, s) => {
                        if (!(tiefe > 0)) return;
                        kerne.push({ x: kamm[s]![0], y: kamm[s]![1] }, { x: kamm[s + 1]![0], y: kamm[s + 1]![1] });
                    }),
                );
            for (const p of kerne) {
                const voll = p.voll ?? GIPFEL_KERN_E;
                const aus = p.aus ?? GIPFEL_AUSLAUF_E;
                stempleLinie(g, plane, naehe, [[p.x, p.y]], voll + aus, (d) => 1 - glatt((d - voll) / aus), groesser);
            }
            for (let k = 0; k < zellen; k++) naehe[k] = naehe[k]! * fluss![k]!;
        }
        // Erosion im Gelände: Anteil je Zelle, vom Umriss nach innen eingeblendet; null bei voller Erosion.
        let anteil: Float32Array | null = null;
        if (erosion < 1) {
            anteil = new Float32Array(zellen);
            const rand = f.materialRand ?? EROSION_RAND_E;
            for (let k = 0; k < zellen; k++) {
                const mu = glatt((Math.max(0, innen[k]! - 0.5) * g.cell) / rand);
                anteil[k] = 1 - (1 - erosion) * mu * fluss![k]!;
            }
        }
        // Erosionsfestigkeit je Zelle: wie die Erosion im Gelände vom Umriss nach innen eingeblendet und um Flüsse frei; sie wirkt auf das
        // Einschneiden (Erodierbarkeit) und das Hebungsgewicht der Rückverteilung, nicht auf die Hangdiffusion.
        let fest: Float32Array | null = null;
        if (festigkeit > 0) {
            fest = new Float32Array(zellen);
            const rand = f.materialRand ?? EROSION_RAND_E;
            for (let k = 0; k < zellen; k++) {
                const mu = glatt((Math.max(0, innen[k]! - 0.5) * g.cell) / rand);
                fest[k] = 1 - festigkeit * mu * fluss![k]!;
            }
        }
        const erodibility = new Float32Array(zellen).fill(Number.NaN);
        const diffusivity = new Float32Array(zellen).fill(Number.NaN);
        const folgt = f.hebungFolgt ?? 0;
        const upliftWeight = folgt > 0 || fest ? new Float32Array(zellen).fill(Number.NaN) : undefined;
        let summeNeu = 0;
        let summeAlt = 0;
        for (let j = 0; j < plane.height; j++)
            for (let i = 0; i < plane.width; i++) {
                const k = j * plane.width + i;
                if (!drin[k]) continue;
                const x = x0 + i,
                    y = y0 + j;
                const eMaterial = sample(materials.erodibility, x, y);
                let e = eMaterial;
                let d = sample(materials.diffusivity, x, y);
                if (f.materialRand !== undefined && typ) {
                    // Abstand der Zellmitte zum Umriss: eine halbe Zelle weniger als zur Mitte der nächsten Zelle außerhalb.
                    const mu = glatt((Math.max(0, innen[k]! - 0.5) * g.cell) / f.materialRand);
                    e = Math.exp((1 - mu) * Math.log(e) + mu * Math.log(typ.erodibility));
                    d = Math.exp((1 - mu) * Math.log(d) + mu * Math.log(typ.diffusivity));
                }
                const formfaktor = e * (1 - (1 - kernE) * naehe[k]!);
                erodibility[k] = (anteil ? formfaktor * anteil[k]! : formfaktor) * (fest ? fest[k]! : 1);
                diffusivity[k] = d * (1 - (1 - kernD) * naehe[k]!) * (anteil ? anteil[k]! : 1);
                if (upliftWeight) {
                    upliftWeight[k] = sample(materials.upliftWeight, x, y);
                    // Ohne die Erosion im Gelände: Sie wirkt je Zelle (unten).
                    summeNeu += Math.fround(formfaktor);
                    summeAlt += eMaterial;
                }
            }
        // Rückverteilung (`hebungFolgt`): Das Hebungsgewicht des ganzen Gebirges sinkt im Verhältnis, in dem sein Abtrag sinkt (Summe der
        // Erodierbarkeit im Fenster gegen das Materialfeld), damit weniger Abtrag nicht in mehr Hebung umschlägt. Ein Faktor je Gebirge,
        // nicht je Zelle: Die Verteilung der Hebung im Gebirge bleibt, wie sie war. Je Zelle (Gestein oder Kammschutz) verschob sie die
        // Hebung ins Innere oder von den Kämmen weg; gemessen wanderte die Kammlage der Blutzinnen 1,06 E von der gezeichneten Linie.
        // Die Erosion im Gelände dagegen je Zelle (mit derselben Potenz): Unter der regionalen Rückverteilung hebt sich ein gleichmäßiger
        // Faktor im Inneren eines Gebirges heraus (Normierung je Umgebung), und die Sättigung schob den Überschuss gerade in die Zellen mit
        // kleinem Gewicht. Mit Gewicht 0 hebt nichts das Gebirge (bei 0 bleibt die Saat stehen); am Umriss und um Flüsse blendet es ein.
        // Die Erosionsfestigkeit je Zelle mit Potenz 1, auch ohne `hebungFolgt`: Was nicht abgetragen wird, bekommt auch nichts zurück (mit 1 wird
        // das Gewicht im Inneren 0). Ohne `hebungFolgt` bleibt sonst alles beim Materialfeld.
        if (upliftWeight && summeAlt > 0) {
            const faktor = folgt > 0 ? Math.pow(summeNeu / summeAlt, folgt) : 1;
            for (let k = 0; k < zellen; k++)
                if (!Number.isNaN(upliftWeight[k]!)) {
                    const gewicht = anteil
                        ? upliftWeight[k]! * faktor * Math.pow(anteil[k]!, folgt)
                        : upliftWeight[k]! * faktor;
                    upliftWeight[k] = fest ? gewicht * fest[k]! : gewicht;
                }
        }
        fenster.push({
            x0,
            y0,
            w: plane.width,
            h: plane.height,
            erodibility,
            diffusivity,
            ...(upliftWeight ? { upliftWeight } : {}),
        });
    }
    return fenster;
}

/**
 * Liest einen Wert der Fenster an Spalte `x`, Zeile `y`; NaN, wo kein Fenster ihn setzt. Je Zeile stehen die Fenster, die sie schneiden,
 * in einer Tafel: Ohne Fenster in der Zeile kostet die Abfrage einen Vergleich.
 */
export function fensterLeser(
    fenster: readonly FormerhaltFenster[],
    n: number,
): (feld: FensterFeld, x: number, y: number) => number {
    const zeilen: (FormerhaltFenster[] | undefined)[] = new Array(n);
    for (const f of fenster) for (let y = f.y0; y < Math.min(n, f.y0 + f.h); y++) (zeilen[y] ??= []).push(f);
    return (feld, x, y) => {
        const reihe = zeilen[y];
        if (reihe === undefined) return Number.NaN;
        for (const f of reihe) {
            if (x < f.x0 || x >= f.x0 + f.w) continue;
            const werte = f[feld];
            if (werte === undefined) continue;
            const v = werte[(y - f.y0) * f.w + (x - f.x0)]!;
            if (!Number.isNaN(v)) return v;
        }
        return Number.NaN;
    };
}

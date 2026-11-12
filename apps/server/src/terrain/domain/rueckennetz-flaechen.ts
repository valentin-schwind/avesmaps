import {
    durchhangAus,
    durchhangTiefen,
    kaemmeAusPunkten,
    kopfRadius,
    treffReichweite,
    triffPunkte,
    type V12Input,
} from "@avesmaps3d/shared";
import type { StoredRaster } from "../dem-tiles.ts";
import { grid, type Grid } from "../hydrology/grid.ts";
import { fillArea, fillWindow } from "../hydrology/water.ts";
import type { DomainInputs } from "./inputs.ts";

/**
 * Gebirge aus gezeichneten Kämmen (Rückennetz, WI-0247, Hauptorchestrierung 2026-10-21 „Fix A“): Ihre Saat ist schon die fertige Form
 * mit Ästen, Tälern und Rinnen. Die Formschritte, die das Gelände für V12-Saaten braucht (Saat-Glättung, Saatfeld, Bruchstücke,
 * Gebirgsinneres), wischten sie aus: An den Blutzinnen glich das fertige Gelände der Vorschau nur noch zu 0,30 statt 0,91. In diesen
 * Flächen übernimmt das Gelände die Saat deshalb ohne diese Schritte und deckelt sie auf die Kammhöhe. Die Erosion des Geländes wirkt
 * weiter (Betreiber 2026-10-21: „wir brauchen natürlich die erosion auf unseren gebirgen“), ebenso Flüsse, Seen, Gipfel und Feinstufe.
 * Ohne Rückennetz-Gebirge gibt es keine Maske, und jeder Schritt rechnet Zeichen für Zeichen wie zuvor.
 */

/** Die Zellen der Rückennetz-Gebirge (Gitterausrichtung, Zeile 0 im Norden); ohne solche Gebirge keine Maske. */
export function rueckennetzMaske(g: Grid, input: DomainInputs): Uint8Array | undefined {
    if (!input.rueckennetz?.length) return undefined;
    const maske = new Uint8Array(g.n * g.n);
    for (const gebirge of input.rueckennetz)
        fillArea(g, gebirge.geometry, (k) => {
            maske[k] = 1;
        });
    return maske;
}

/**
 * Die Höhe jedes Rückennetz-Gebirges auf seine Kammhöhe deckeln (gespeicherte Ausrichtung, Zeile 0 im Süden): Die Hebung der
 * Erosion gibt den abgetragenen Stoff auf alle Gebirge zurück und hob die Blutzinnen über ihren höchsten Gipfel (2.946 statt 2.300). Die Gipfel
 * setzt der Aufrufer danach exakt. Gibt die Zahl der gedeckelten Zellen zurück.
 */
export function deckleRueckennetz(raster: StoredRaster, input: DomainInputs): number {
    if (!input.rueckennetz?.length) return 0;
    const g = grid(raster.width);
    const n = g.n;
    let gedeckelt = 0;
    for (const gebirge of input.rueckennetz)
        fillArea(g, gebirge.geometry, (k) => {
            const index = (n - 1 - Math.floor(k / n)) * n + (k % n);
            if (raster.samples[index]! > gebirge.deckel) {
                raster.samples[index] = gebirge.deckel;
                gedeckelt++;
            }
        });
    return gedeckelt;
}

/**
 * Das gezeichnete Netz eines Rückennetz-Gebirges, wie die Domäne es für den Formerhalt braucht (WI-0249 P2, `formerhalt.ts`): die Kämme
 * (ohne Täler; trägt das Gebirge nur Punkte und rechnet mit Köpfen, der Spannbaum der Punkte wie in der Saat) und die gesetzten Punkte
 * (kanonische Gipfel der Fläche und Nebengipfel). Es folgt aus derselben Eingabe wie die Saat und steht darum nicht im Fingerabdruck.
 */
export interface RueckennetzNetz {
    kaemme: [number, number][][];
    /**
     * Gesetzte Punkte; `kopf` ist der Kopfradius eines Nebengipfels (E, WI-0249 P2, `kopfRadius`): Mit der Kopfneigung des Typs ist jeder
     * Nebengipfel ein Kegel, dessen Radius aus der Prominenz folgt, und der Formerhalt schützt ihn wie einen Gipfelkern über diesen Radius.
     * Fehlt er, ist der Punkt ein Gipfelkern wie zuvor.
     */
    punkte: { x: number; y: number; kopf?: number }[];
    /**
     * Durchhang je Segment jedes Kamms (Tiefe als Anteil der Höhe, `durchhangTiefen`), nur wenn der Typ durchhängt: Dort schützt der
     * Formerhalt die Kammpunkte und gibt die Segmentmitten frei (`sattelAbtrag`). Fehlt er, rechnet der Formerhalt wie zuvor.
     */
    sattel?: number[][];
}

export function rueckennetzNetz(
    input: Pick<V12Input, "kaemme" | "nebengipfel" | "peaks" | "rueckennetz"> & Partial<Pick<V12Input, "regler">>,
): RueckennetzNetz {
    const kopf = Number(input.rueckennetz?.form.kopf) || 0;
    const neigung = Number(input.rueckennetz?.form.kopfNeigung) || 0;
    const kamm = Number(input.regler?.maximalhoehe) > 0 ? Number(input.regler!.maximalhoehe) : 1500;
    const radius = kopf > 0 && neigung > 0 ? kopfRadius(kopf * kamm, neigung) : undefined;
    const punkte: RueckennetzNetz["punkte"] = [
        ...input.peaks.map(({ x, y }) => ({ x, y })),
        ...(input.nebengipfel ?? []).map(({ x, y }) => ({ x, y, ...(radius !== undefined ? { kopf: radius } : {}) })),
    ];
    const gezeichnet = (input.kaemme ?? []).filter((k) => k.rang !== "tal");
    const kaemme =
        gezeichnet.length === 0 && (Number(input.rueckennetz?.form.kopf) || 0) > 0
            ? kaemmeAusPunkten(punkte)
            : gezeichnet;
    const durchhang = input.rueckennetz ? durchhangAus(input.rueckennetz.form) : undefined;
    return {
        kaemme: kaemme.map((k) => k.punkte.map(([x, y]) => [x, y] as [number, number])),
        punkte,
        ...(durchhang ? { sattel: durchhangTiefen(kaemme, punkte, durchhang) } : {}),
    };
}

/**
 * Erosion im Gelände eines Rückennetz-Gebirges (WI-0249 P2; Betreiber 2026-10-23: „pro gebirgstyp einen wert angeben wie stark die
 * hydraulische erosion auf ein gebirge noch wirken soll. 1 = wie jetzt, voll bis 0 = nichts, die ergebnisse der gebirgsvorschau bleiben“):
 * der Typwert `form.gelaendeErosion` in 0 bis 1, nur wenn er unter 1 liegt (sonst rechnet das Gelände wie zuvor). Er steht mit den Reglern
 * des Gebirges im Fingerabdruck der Saat und zählt darum nicht noch einmal.
 */
export function gelaendeErosion(input: Pick<V12Input, "rueckennetz">): number | undefined {
    const wert = Number(input.rueckennetz?.form.gelaendeErosion);
    return Number.isFinite(wert) && wert < 1 ? Math.max(0, wert) : undefined;
}

/**
 * Die Einbettung einer Rückennetz-Saat auf das Land (WI-0249 P2 Schritt 3, `mountainMorphology.rueckennetz.einbettung` = k): Die Saat
 * ist auf 0 am Umriss gerechnet, das Land liegt dort bei einigen hundert Schritt. Das Maximum hob deshalb ein Drittel der Blutzinnen um
 * 333 Schritt auf das Land und machte die Täler am Umriss eben (P1). Hier steht die Saat auf dem Land, das bis zum k-fachen seiner
 * Höhe mitträgt und darüber schwindet: `h = Saat + Land · (1 − Saat / (k · Land))²` unterhalb von `k · Land`, darüber die Saat genau.
 * Am Umriss (Saat 0) gilt das Land; die Höhe steigt stetig mit der Saat (Steigung am Fuß 1 − 2/k, k ≥ 2), also keine neuen Senken,
 * kein Knick und keine Ebene am Fuß: Täler unter der Landhöhe behalten ihr Gefälle, gestaucht statt eingeebnet. Oberhalb von k · Land
 * bleiben alle Höhen und ihre Unterschiede genau (Kämme, Gipfel). Keine pauschale Addition der Gebirgshöhe auf das Land.
 *
 * Gemessen an den Blutzinnen (WI-0249 P2, nach der Einbettung): Gegen das Maximum kostet k = 2 12 Schritt Grat und 9 Kuppe, die Form
 * der Täler (Hochpass-Korrelation zur Saat) steigt von 0,962 auf 0,971; größere k halten die Täler genauer und kosten mehr Grat
 * (k = 3: −32, 0,981; k = 5: −58, 0,994).
 */
export function bette(land: number, saat: number, k: number): number {
    if (!(land > 0) || !(k >= 2)) return Math.max(land, saat);
    const oben = k * land;
    return saat >= oben ? saat : saat + land * (1 - Math.max(0, saat) / oben) ** 2;
}

/** VORSCHLAG (WI-0249 P2): Bis zu diesem Abstand (E) von einem Fluss bleibt ein Kopf, wie Erosion und Brennen ihn lassen. */
export const KOPF_FLUSS_E = 0.5;

/** Bilinear in einer Saat (Zeile 0 im Süden), NaN außerhalb; wie `sample` in `dem-tiles.ts`. */
function saatAn(r: StoredRaster, x: number, y: number): number {
    const fx = (x - r.originX) / r.cell;
    const fy = (y - r.originY) / r.cell;
    if (fx < 0 || fy < 0 || fx > r.width - 1 || fy > r.height - 1) return Number.NaN;
    const i = Math.min(Math.floor(fx), Math.max(0, r.width - 2));
    const j = Math.min(Math.floor(fy), Math.max(0, r.height - 2));
    const tx = fx - i;
    const ty = fy - j;
    const right = Math.min(i + 1, r.width - 1);
    const up = Math.min(j + 1, r.height - 1);
    const s = r.samples;
    return (
        (s[j * r.width + i] ?? 0) * (1 - tx) * (1 - ty) +
        (s[j * r.width + right] ?? 0) * tx * (1 - ty) +
        (s[up * r.width + i] ?? 0) * (1 - tx) * ty +
        (s[up * r.width + right] ?? 0) * tx * ty
    );
}

const glatt = (t: number): number => {
    const u = Math.max(0, Math.min(1, t));
    return u * u * (3 - 2 * u);
};

/** Abstand eines Punkts zu einem Linienzug. */
function abstand(punkte: readonly (readonly [number, number])[], x: number, y: number): number {
    let best = Infinity;
    for (let s = 1; s < punkte.length; s++) {
        const [ax, ay] = punkte[s - 1]!;
        const [bx, by] = punkte[s]!;
        const vx = bx - ax;
        const vy = by - ay;
        const t = Math.max(0, Math.min(1, ((x - ax) * vx + (y - ay) * vy) / (vx * vx + vy * vy || 1e-9)));
        best = Math.min(best, Math.hypot(x - ax - t * vx, y - ay - t * vy));
    }
    return best;
}

/**
 * Köpfe der Nebengipfel nach der Erosion wiederherstellen (WI-0249 P2, Betreiber 2026-10-24: „noch nicht wirklich ‚stabil‘ … das klappt
 * bei normalen gipfeln etwas besser“), wie `restoreSummits` die kanonischen Gipfel: Im Kopfradius eines Nebengipfels mit Kegel (`kopf`)
 * hebt sich das Gelände zur Saat (der Vorschau, die die Köpfe formt), voll bis zum halben Radius, weich aus bis zum Radius; nie senken,
 * nur trockenes Land (`erlaubt`, Zeile 0 im Norden), nicht bis 0,5 E an einem Fluss. Die Erosion trug sonst 70 % der Prominenz ab (Blutzinnen:
 * 291 Schritt in der Vorschau, 86 nach der groben Erosion), auch mit Kernschutz und gedrosselter Erosion. Ohne Kegel tut sie nichts.
 * Gibt die Zahl der gehobenen Zellen zurück.
 */
export function stelleKoepfeWieder(raster: StoredRaster, input: DomainInputs, erlaubt: Uint8Array): number {
    if (!input.rueckennetz?.length) return 0;
    const n = raster.width;
    const { cell } = raster;
    let gehoben = 0;
    // Rahmen der Flussläufe einmal: Je Kopf zählen nur die Flüsse, deren Rahmen ihn mit Radius und Abstand berührt.
    const fluesse = input.rivers.rivers.map((r) => {
        let x0 = Infinity,
            y0 = Infinity,
            x1 = -Infinity,
            y1 = -Infinity;
        for (const [x, y] of r.coordinates) {
            x0 = Math.min(x0, x);
            y0 = Math.min(y0, y);
            x1 = Math.max(x1, x);
            y1 = Math.max(y1, y);
        }
        return { linie: r.coordinates, x0, y0, x1, y1 };
    });
    for (const gebirge of input.rueckennetz) {
        const saat = gebirge.saat !== undefined ? input.seeds[gebirge.saat] : undefined;
        if (!saat || !gebirge.netz) continue;
        for (const p of gebirge.netz.punkte) {
            const radius = p.kopf;
            if (radius === undefined) continue;
            const weit = radius + KOPF_FLUSS_E;
            const nahe = fluesse
                .filter((f) => f.x0 - weit <= p.x && p.x <= f.x1 + weit && f.y0 - weit <= p.y && p.y <= f.y1 + weit)
                .map((f) => f.linie);
            const i0 = Math.max(0, Math.floor((p.x - radius - raster.originX) / cell));
            const i1 = Math.min(n - 1, Math.ceil((p.x + radius - raster.originX) / cell));
            const j0 = Math.max(0, Math.floor((p.y - radius - raster.originY) / cell));
            const j1 = Math.min(raster.height - 1, Math.ceil((p.y + radius - raster.originY) / cell));
            for (let j = j0; j <= j1; j++)
                for (let i = i0; i <= i1; i++) {
                    const x = raster.originX + i * cell;
                    const y = raster.originY + j * cell;
                    const d = Math.hypot(x - p.x, y - p.y);
                    if (d >= radius || !erlaubt[(n - 1 - j) * n + i]) continue;
                    const k = j * n + i;
                    const jetzt = raster.samples[k]!;
                    const form = saatAn(saat, x, y);
                    if (!(form > jetzt)) continue;
                    if (nahe.some((linie) => abstand(linie, x, y) < KOPF_FLUSS_E)) continue;
                    const gewicht = 1 - glatt((d / radius - 0.5) / 0.5);
                    const neu = Math.round(jetzt + gewicht * (form - jetzt));
                    if (neu > jetzt) {
                        raster.samples[k] = neu;
                        gehoben++;
                    }
                }
        }
    }
    return gehoben;
}

/**
 * Punkt trifft seine Höhe im Gelände (WI-0249, Fassung 19; Vali wählte: Punkt trifft seine Höhe, 2026-10-26): Nach Erosion, Brennen und Köpfen
 * heftet jedes Rückennetz-Gebirge seine Punkte mit eigener Höhe (`RueckennetzGebirge.ziele`) weich auf diese Höhe (`triffPunkte`), nur in seiner
 * Fläche und nur auf trockenem Land (`erlaubt`, Gitterausrichtung): Flüsse fallen weiter, Seen bleiben eben, Ufer und Flusskorridore bleiben,
 * wie Brennen und Seen sie ließen; nie über die Saat hinaus (das Vorbild vor der Erosion). Stützpunkte von Flüssen mit eigenen Höhen (WI-0259)
 * messen ihr Umland jenseits des gesperrten Korridors (`treffen.ts`) und heben es wie die Saat zur Flusshöhe zurück. Gespeicherte Ausrichtung,
 * Zeile 0 im Süden; ganze Schritt. Ohne Ziele ändert sich keine Zelle. Gibt je
 * Gebirge mit Zielen die Abweichungen vorher und nachher zurück (Fläche − Ziel, Schritt; `NaN` außerhalb des Rasters).
 */
export function triffEigeneHoehen(
    raster: StoredRaster,
    input: DomainInputs,
    erlaubt: Uint8Array,
): { id: string; vorher: number[]; nachher: number[]; gilt: boolean[] }[] {
    const berichte: { id: string; vorher: number[]; nachher: number[]; gilt: boolean[] }[] = [];
    if (!input.rueckennetz?.length) return berichte;
    const n = raster.width;
    const { cell } = raster;
    const g: Grid = { n, cell };
    const rand = treffReichweite(cell) + cell;
    for (const gebirge of input.rueckennetz) {
        const ziele = gebirge.ziele;
        if (!ziele || ziele.punkte.length === 0) continue;
        // Das Fenster: alle Ziele mit dem größten Radius; die Fläche des Gebirges nur darin (Gitterausrichtung, Zeile 0 im Norden).
        let x0 = Infinity,
            y0 = Infinity,
            x1 = -Infinity,
            y1 = -Infinity;
        for (const z of ziele.punkte) {
            x0 = Math.min(x0, z.x - rand);
            y0 = Math.min(y0, z.y - rand);
            x1 = Math.max(x1, z.x + rand);
            y1 = Math.max(y1, z.y + rand);
        }
        const i0 = Math.max(0, Math.floor((x0 - raster.originX) / cell));
        const i1 = Math.min(n - 1, Math.ceil((x1 - raster.originX) / cell));
        const j0 = Math.max(0, Math.floor((y0 - raster.originY) / cell));
        const j1 = Math.min(raster.height - 1, Math.ceil((y1 - raster.originY) / cell));
        if (i1 < i0 || j1 < j0) continue;
        const fenster = { width: i1 - i0 + 1, height: j1 - j0 + 1, cell, x0: i0, y0: n - 1 - j1 };
        const drin = new Uint8Array(fenster.width * fenster.height);
        fillWindow(g, fenster, gebirge.geometry, (k) => {
            drin[k] = 1;
        });
        // Das Vorbild: die Saat (schon angeheftet), vor der Erosion des Geländes.
        const saat = gebirge.saat !== undefined ? input.seeds[gebirge.saat] : undefined;
        const bericht = triffPunkte(
            {
                w: n,
                hh: raster.height,
                cell,
                x0: raster.originX,
                y0: raster.originY,
                h: raster.samples,
                ganzzahlig: true,
                darf: (k) => {
                    const i = k % n;
                    const gy = n - 1 - Math.floor(k / n);
                    if (i < i0 || i > i1 || gy < fenster.y0 || gy >= fenster.y0 + fenster.height) return false;
                    return drin[(gy - fenster.y0) * fenster.width + (i - i0)] === 1 && erlaubt[gy * n + i] === 1;
                },
                ...(saat
                    ? {
                          vorbild: (k: number) =>
                              saatAn(saat, raster.originX + (k % n) * cell, raster.originY + Math.floor(k / n) * cell),
                      }
                    : {}),
            },
            ziele,
        );
        berichte.push({ id: gebirge.id, ...bericht });
    }
    return berichte;
}

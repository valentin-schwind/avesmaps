/**
 * Aus der Grundform ein Gebirge (WI-0246, aus dem Entwurf Meilenstein 2). Mit den Bausteinen der V12 (`../`), in ihrer Folge:
 * - **Täler** aus Flüssen und Seen (`valleys.ts`, Talbreite und Taltiefe des Gebirges): Achsen auf ihren Talboden, Seen eben.
 * - **Erosion** (`erosion.ts`, Stufen 0 bis 5 wie das Rinnennetz): Senken füllen, Fließrichtung, Abtrag, Kriechen, Hebung um den Abtrag.
 *   Fest bleiben Gipfelkerne, Talachsen und Seen; gegen das Rinnennetz halten der Erhalt und, nahe den Strängen, `GRAT_ERHALT`
 *   (feste Kammlinien standen wie Mauern).
 * - **Senkenfüllung** am Ende (Priority-Flood mit kleinem Gefälle): keine inneren Senken außer Seen und Talachsen, die dokumentiert
 *   sind (`senke`). Das schließt die Lücke des Prototyps (204 Senken).
 * - **Pässe** nach der Erosion: das Längsprofil auf die Grenzsteigung gesenkt, quer weich (`paesse.ts`).
 * - **Gipfel** sind bereits Teil der Grundform und erodieren mit. Nur ihre exakte Zielzelle bleibt verankert.
 */
import { avesmapsHydroErosionsSchritte, ECOSYSTEM_HYDRO_ABTRAG, ECOSYSTEM_HYDRO_KRIECHEN } from "../constants.ts";
import { erosionsSchritt, type ErosionsZustand } from "../erosion.ts";
import { pointInGeometry } from "../geometry.ts";
import type { Raster } from "../raster.ts";
import { randFeld, type RueckenRaster } from "./ausschnitt.ts";
import type { V12Input } from "../types.ts";
import { formeKoepfe, type KopfForm, type KopfPunkt } from "./koepfe.ts";
import { legePaesse, type Pass } from "./paesse.ts";
import { baueEcosystemTaeler, baueEcosystemTalIndex, ecosystemTalAbzug } from "../valleys.ts";
import { bogen, flussHoeheAn, flussMarken, seeSpiegel } from "./wasser.ts";

export interface LandschaftErgebnis {
    h: Float64Array;
    /** 1, wo eine Senke gewollt ist (See, Talachse). */
    senke: Uint8Array;
    /** Zahl der Erosionsdurchläufe. */
    durchlaeufe: number;
    /** Mit Köpfen: die wirksame Höhe je Nebengipfel nach der Landschaft (ein Nebengipfel über einer Mulde steigt). */
    nebengipfel?: readonly { x: number; y: number; h: number }[];
}

/** Ein Haufen nach Höhe (kleinste zuerst) für die Senkenfüllung. */
class Haufen {
    private k: number[] = [];
    private v: number[] = [];
    get leer(): boolean {
        return this.k.length === 0;
    }
    push(wert: number, zelle: number): void {
        this.k.push(zelle);
        this.v.push(wert);
        let i = this.k.length - 1;
        while (i > 0) {
            const e = (i - 1) >> 1;
            if ((this.v[e] as number) <= wert) break;
            [this.k[i], this.k[e]] = [this.k[e] as number, this.k[i] as number];
            [this.v[i], this.v[e]] = [this.v[e] as number, this.v[i] as number];
            i = e;
        }
    }
    pop(): number {
        const oben = this.k[0] as number;
        const k = this.k.pop() as number;
        const v = this.v.pop() as number;
        if (this.k.length > 0) {
            this.k[0] = k;
            this.v[0] = v;
            let i = 0;
            for (;;) {
                const a = 2 * i + 1;
                const b = a + 1;
                let m = i;
                if (a < this.k.length && (this.v[a] as number) < (this.v[m] as number)) m = a;
                if (b < this.k.length && (this.v[b] as number) < (this.v[m] as number)) m = b;
                if (m === i) break;
                [this.k[i], this.k[m]] = [this.k[m] as number, this.k[i] as number];
                [this.v[i], this.v[m]] = [this.v[m] as number, this.v[i] as number];
                i = m;
            }
        }
        return oben;
    }
}

/** Füllt jede innere Senke so, dass das Wasser zum Rand oder in eine gewollte Senke abfließt (Gefälle `eps` je Zelle). */
/**
 * Flüsse fallen (Tor „Flüsse fallend“): Der Talboden der V12 ist ein kumulativer Tiefstwert mit Restanteil des Geländes und steigt dort,
 * wo ein Fluss einen Rücken quert; ein Bergsee kann höher liegen als sein ganzer Zufluss (Blutsee in den Trollzacken: Spiegel 1070,
 * Zufluss 11–59 Schritt; auch in der V12, dort 200–1400 Schritt Anstieg). Entlang jedes Laufs in Fließrichtung (`dir`, sonst vom höheren
 * Ende her) wird eingeschnitten: jede Zelle höchstens so hoch wie die vorige. Erreicht ein Lauf einen See, der höher liegt, sinkt der
 * ganze See auf die Höhe des Zuflusses (der See liegt im Tal, nicht darüber). Weil ein gesenkter See die Abflüsse betrifft, die schon
 * eingeschnitten waren, läuft das bis zur Ruhe (alles sinkt nur, endet also). Die Laufzellen werden Senke (Abfluss der Füllung).
 *
 * `fest` (WI-0249, eigene Höhen an Flüssen und Seen, `wasserFest`; Vali wählte A, 2026-10-26): Zellen mit einer Zahl tragen genau sie, und an
 * ihnen gilt die Regel nicht. Ein Lauf geht von dort mit dieser Höhe weiter; ein See mit eigenem Spiegel sinkt nicht auf seinen Zufluss.
 * Ohne `fest` Zeichen für Zeichen wie zuvor.
 */
export function lasseFluesseFallen(
    r: Raster,
    h: Float64Array,
    fluesse: readonly { p: readonly (readonly [number, number])[]; dir?: string | null }[],
    imSee: Uint8Array,
    senke: Uint8Array,
    fest?: Float64Array,
): void {
    const istFest = (k: number): boolean => fest !== undefined && !Number.isNaN(fest[k] as number);
    if (fest) for (let k = 0; k < h.length; k++) if (istFest(k)) h[k] = fest[k] as number;
    // Seen als zusammenhängende Flächen (8er-Nachbarschaft).
    const seeNr = new Int32Array(r.w * r.hh).fill(-1);
    const seeZellen: number[][] = [];
    for (let s = 0; s < imSee.length; s++) {
        if (!imSee[s] || seeNr[s]! >= 0) continue;
        const zellen = [s];
        seeNr[s] = seeZellen.length;
        for (let q = 0; q < zellen.length; q++) {
            const k = zellen[q]!;
            const i = k % r.w;
            const j = (k - i) / r.w;
            for (let dj = -1; dj <= 1; dj++)
                for (let di = -1; di <= 1; di++) {
                    const ni = i + di;
                    const nj = j + dj;
                    if (ni < 0 || nj < 0 || ni >= r.w || nj >= r.hh) continue;
                    const nk = nj * r.w + ni;
                    if (imSee[nk] && seeNr[nk]! < 0) {
                        seeNr[nk] = seeZellen.length;
                        zellen.push(nk);
                    }
                }
        }
        seeZellen.push(zellen);
    }
    const laeufe: number[][] = [];
    for (const f of fluesse) {
        const zellen: number[] = [];
        for (let s = 1; s < f.p.length; s++) {
            const [ax, ay] = f.p[s - 1]!;
            const [bx, by] = f.p[s]!;
            const stueck = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / (r.cell * 0.05)));
            for (let t = s === 1 ? 0 : 1; t <= stueck; t++) {
                const i = r.i(ax + ((bx - ax) * t) / stueck);
                const j = r.j(ay + ((by - ay) * t) / stueck);
                if (i < 0 || j < 0 || i >= r.w || j >= r.hh) continue;
                const k = j * r.w + i;
                if (r.drin[k] && zellen.at(-1) !== k) zellen.push(k);
            }
        }
        if (zellen.length < 2) continue;
        const rueckwaerts =
            f.dir === "reverse" || (f.dir !== "forward" && (h[zellen[0]!] as number) < (h[zellen.at(-1)!] as number));
        laeufe.push(rueckwaerts ? zellen.reverse() : zellen);
    }
    for (const lauf of laeufe) for (const k of lauf) senke[k] = 1;
    for (let runde = 0; runde < 20; runde++) {
        let geaendert = false;
        for (const lauf of laeufe) {
            let bisher = h[lauf[0]!] as number;
            for (let s = 1; s < lauf.length; s++) {
                const k = lauf[s]!;
                if (istFest(k)) {
                    // Eine eigene Höhe: Die Regel gilt hier nicht, der Lauf geht mit ihr weiter.
                    bisher = h[k] as number;
                    continue;
                }
                if ((h[k] as number) > bisher) {
                    if (imSee[k])
                        for (const z of seeZellen[seeNr[k]!]!) {
                            if (!istFest(z)) h[z] = Math.min(h[z] as number, bisher);
                        }
                    else h[k] = bisher;
                    geaendert = true;
                }
                bisher = h[k] as number;
            }
        }
        if (!geaendert) break;
    }
}

/**
 * Die Zellen mit eigener Höhe an Gewässern (WI-0249, `rueckennetz/wasser.ts`): jede Zelle eines Sees mit eigenem Spiegel; jede Zelle eines
 * Flusses zwischen zwei Stützpunkten mit eigener Höhe (linear über die Bogenlänge) und die Zelle eines einzeln gesetzten Stützpunkts. Ein
 * Fluss im See trägt den See. `undefined` ohne eigene Höhen (dann rechnet alles Zeichen für Zeichen wie zuvor).
 */
export function wasserFest(
    r: Raster,
    fluesse: readonly { p: readonly (readonly [number, number])[] }[],
    seen: readonly { g?: Parameters<typeof pointInGeometry>[1] | null | undefined }[],
    flussHoehen: V12Input["flussHoehen"],
    seeHoehen: V12Input["seeHoehen"],
): Float64Array | undefined {
    if (!flussHoehen?.length && !seeHoehen?.length) return undefined;
    const fest = new Float64Array(r.w * r.hh).fill(Number.NaN);
    let gesetzt = false;
    const spiegel = seeSpiegel(seen, seeHoehen);
    if (spiegel.some((h) => h !== null))
        for (let j = 0; j < r.hh; j++)
            for (let i = 0; i < r.w; i++) {
                const k = j * r.w + i;
                if (!r.drin[k]) continue;
                const s = seen.findIndex(
                    (see, nr) => spiegel[nr] !== null && !!see.g && pointInGeometry([r.x(i), r.y(j)], see.g),
                );
                if (s < 0) continue;
                fest[k] = spiegel[s] as number;
                gesetzt = true;
            }
    for (const f of fluesse) {
        const marken = flussMarken(f.p, flussHoehen, seen);
        if (marken.length === 0) continue;
        const laenge = bogen(f.p);
        // Zuerst die Zellen der gesetzten Stützpunkte selbst (genau ihre Höhe), dann die Strecken dazwischen.
        for (const m of marken) {
            const v = laenge.indexOf(m.s);
            const punkt = v >= 0 ? f.p[v] : undefined;
            if (punkt === undefined) continue;
            const i = r.i(punkt[0]);
            const j = r.j(punkt[1]);
            if (i < 0 || j < 0 || i >= r.w || j >= r.hh || !r.drin[j * r.w + i]) continue;
            if (!Number.isNaN(fest[j * r.w + i] as number)) continue;
            fest[j * r.w + i] = m.h;
            gesetzt = true;
        }
        for (let s = 1; s < f.p.length; s++) {
            const [ax, ay] = f.p[s - 1]!;
            const [bx, by] = f.p[s]!;
            const stueck = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / (r.cell * 0.05)));
            for (let t = 0; t <= stueck; t++) {
                const u = t / stueck;
                const i = r.i(ax + (bx - ax) * u);
                const j = r.j(ay + (by - ay) * u);
                if (i < 0 || j < 0 || i >= r.w || j >= r.hh) continue;
                const k = j * r.w + i;
                // Im See gilt der See (oder die Regel, wenn er keinen eigenen Spiegel hat).
                if (!r.drin[k] || !Number.isNaN(fest[k] as number)) continue;
                if (seen.some((see) => !!see.g && pointInGeometry([r.x(i), r.y(j)], see.g))) continue;
                const wert = flussHoeheAn(marken, laenge[s - 1]! + (laenge[s]! - laenge[s - 1]!) * u, r.cell * 0.75);
                if (wert === undefined) continue;
                fest[k] = wert;
                gesetzt = true;
            }
        }
    }
    return gesetzt ? fest : undefined;
}

/** VORSCHLAG: Anteil des fehlenden Erhalts, den die Kammlinie zusätzlich behält (0 = wie die Fläche, 1 = unerodiert). */
export const GRAT_ERHALT = 0.8;
/** VORSCHLAG: wie stark ein Strang den Talabzug neben der Flussachse dämpft (0 = gar nicht, 1 = ganz). */
export const GRAT_TALSCHUTZ = 0.8;

export function fuelleSenken(r: Raster, h: Float64Array, senke: Uint8Array, eps = 0.01, fixpunkte?: Uint8Array): void {
    const fertig = new Uint8Array(h.length);
    const q = new Haufen();
    for (let j = 0; j < r.hh; j++)
        for (let i = 0; i < r.w; i++) {
            const k = j * r.w + i;
            if (!r.drin[k]) {
                fertig[k] = 1;
                continue;
            }
            let rand = i === 0 || j === 0 || i === r.w - 1 || j === r.hh - 1;
            for (let dj = -1; dj <= 1 && !rand; dj++)
                for (let di = -1; di <= 1; di++) if (!r.drin[(j + dj) * r.w + i + di]) rand = true;
            // Ränder und gewollte Senken sind Abflüsse; verankerte Gipfelzellen
            // werden ebenfalls nicht von der Füllung überschrieben.
            if (rand || senke[k] || fixpunkte?.[k]) {
                fertig[k] = 1;
                q.push(h[k] as number, k);
            }
        }
    while (!q.leer) {
        const k = q.pop();
        const i = k % r.w;
        const j = (k - i) / r.w;
        for (let dj = -1; dj <= 1; dj++)
            for (let di = -1; di <= 1; di++) {
                if (!di && !dj) continue;
                const ni = i + di;
                const nj = j + dj;
                if (ni < 0 || nj < 0 || ni >= r.w || nj >= r.hh) continue;
                const m = nj * r.w + ni;
                if (fertig[m]) continue;
                fertig[m] = 1;
                h[m] = Math.max(h[m] as number, (h[k] as number) + eps);
                q.push(h[m] as number, m);
            }
    }
}

/** Nur die Zielzelle sichern; Flanken werden weder gekappt noch nachträglich geformt. */
export function sichereGipfel(
    r: Raster,
    h: Float64Array,
    peaks: readonly { x: number; y: number; h: number | null }[],
    kammhoehe: number,
): void {
    for (const p of peaks) {
        const pi = r.i(p.x);
        const pj = r.j(p.y);
        if (pi < 0 || pj < 0 || pi >= r.w || pj >= r.hh || !r.drin[pj * r.w + pi]) continue;
        const ziel = Number(p.h) > 0 ? Number(p.h) : kammhoehe;
        h[pj * r.w + pi] = ziel;
    }
}

export function formeLandschaft(
    r: RueckenRaster,
    grund: Float64Array,
    e: V12Input,
    erosion: number,
    kammhoehe: number,
    erhalt = 0,
    paesse: readonly Pass[] = [],
    nebengipfel: readonly { x: number; y: number; h: number }[] = [],
    randBreite = 2,
    gratNaehe: Float32Array | null = null,
    /** Gewollte Senken aus gezeichneten Tälern und Mulden (`senken.ts`): Die Senkenfüllung lässt sie stehen. */
    gewollt: Uint8Array | null = null,
    /** Köpfe der gesetzten Punkte (WI-0249 P2, `koepfe.ts`): nach Erosion und Pässen erneut geformt, vor der Senkenfüllung. */
    koepfe?: { punkte: readonly KopfPunkt[]; prominenz: number; form?: KopfForm },
    /** Meldet das Ende jedes Abschnitts (WI-0249 P6, `RueckenOptionen.phase`); nur melden. */
    phase?: (name: string) => void,
): LandschaftErgebnis {
    const n = r.w * r.hh;
    const h = grund.slice();
    const reg = e.regler || {};
    const peaks = Array.isArray(e.peaks) ? e.peaks : [];
    const seen = Array.isArray(e.seen) ? e.seen : [];
    const fluesse = Array.isArray(e.fluesse) ? e.fluesse : [];
    const senke = gewollt ? gewollt.slice() : new Uint8Array(n);
    const imSee = new Uint8Array(n);
    // Achse und Kern gezeichneter Täler und Mulden bleiben wie die Talachse eines Flusses fest: Die Erosion schnitte sonst als Abfluss
    // weit unter ihren Boden (Blutzinnen: 122 statt 606 Schritt).
    const fest = gewollt ? gewollt.slice() : new Uint8Array(n);
    // Nur die verankerte Zielzelle bleibt fest. Auch unmittelbar daneben muss
    // das Wasser Rinnen bilden können; eine feste Scheibe erzeugte runde Kappen.
    const gipfelFix = new Uint8Array(n);
    for (const p of [...peaks, ...nebengipfel]) {
        const i = r.i(p.x);
        const j = r.j(p.y);
        if (i < 0 || j < 0 || i >= r.w || j >= r.hh || !r.drin[j * r.w + i]) continue;
        fest[j * r.w + i] = 1;
        gipfelFix[j * r.w + i] = 1;
    }

    // Täler: wie die V12, mit Talbreite und Taltiefe des Gebirges.
    const initial = h.slice();
    if (seen.length || fluesse.length) {
        const tal = baueEcosystemTaeler(r, h, fluesse, seen, (i, x, y) => pointInGeometry([x, y], seen[i]?.g), {
            talbreite: reg.talbreite,
            einschnitt: reg.einschnitt,
        });
        if (tal.segmente.length) {
            const talIndex = baueEcosystemTalIndex(tal.segmente, e.bounds);
            for (let j = 0; j < r.hh; j++)
                for (let i = 0; i < r.w; i++) {
                    const k = j * r.w + i;
                    if (!r.drin[k]) continue;
                    const start = initial[k] as number;
                    if (tal.achse[k]) {
                        h[k] = Math.max(0, Math.min(start, tal.achseBoden[k] as number));
                        senke[k] = 1;
                        fest[k] = 1;
                        continue;
                    }
                    if (fest[k]) continue;
                    // Gezeichnete Kanten gehen der Talbreite vor, nicht dem Fluss: neben der Achse den Abzug unter einem Strang dämpfen.
                    const schutz = 1 - GRAT_TALSCHUTZ * (gratNaehe ? (gratNaehe[k] as number) : 0);
                    const abzug = ecosystemTalAbzug(talIndex, r.x(i), r.y(j), start) * schutz;
                    if (abzug > 0) h[k] = Math.max(0, start - abzug);
                }
        }
        for (let k = 0; k < n; k++)
            if (tal.imSee[k]) {
                imSee[k] = 1;
                senke[k] = 1;
                fest[k] = 1;
            }
    }
    for (let k = 0; k < n; k++) if (r.drin[k] && !((h[k] as number) > 0)) fest[k] = 1;
    phase?.("landschaft/taeler");
    const vorErosion = h.slice();

    // Erosion der V12.
    let hebungZellen = 0;
    for (let k = 0; k < n; k++) if (r.drin[k] && !fest[k]) hebungZellen++;
    const durchlaeufe = avesmapsHydroErosionsSchritte(erosion);
    const zustand: ErosionsZustand = { r, h, festEro: fest, senke, hebungZellen, accVorgabe: null };
    for (let it = 0; it < durchlaeufe; it++)
        erosionsSchritt(zustand, { K: ECOSYSTEM_HYDRO_ABTRAG, D: ECOSYSTEM_HYDRO_KRIECHEN });
    const fertig = zustand.h;
    phase?.("landschaft/erosion");
    // Erhalt: ein Teil der Form vor der Erosion (mit Tälern) bleibt, damit die Rücken gegen das Rinnennetz bestehen; vor der Senkenfüllung.
    // Auf den Strängen (`gratNaehe`) mehr Erhalt, damit jede gezeichnete Kante als Grat bleibt (Tor „Grat“); weich, sonst Mauern.
    for (let k = 0; k < n; k++) {
        if (!r.drin[k] || senke[k]) continue;
        const e = erhalt + (1 - erhalt) * GRAT_ERHALT * (gratNaehe ? (gratNaehe[k] as number) : 0);
        if (e > 0) fertig[k] = (1 - e) * (fertig[k] as number) + e * (vorErosion[k] as number);
    }

    // Rand: Die Erosion der V12 hebt nach jedem Schritt alle freien Zellen um den Abtrag an, auch am Umriss (Grimmfrostöde mit 21 Flüssen:
    // gut 380 Schritt in der ersten Randzellreihe). Den Zuwachs über die Grundform hinaus über die Randbreite des Typs ausblenden, wie die Hebung.
    const rand = randFeld(r);
    for (let k = 0; k < n; k++) {
        if (!r.drin[k] || senke[k] || (fertig[k] as number) <= (grund[k] as number)) continue;
        const abRand = ((rand[k] as number) * r.cell) / 3;
        const fase = Math.pow(Math.max(0, Math.min(1, (abRand - 0.24) / Math.max(0.5, randBreite))), 0.85);
        fertig[k] = (grund[k] as number) + ((fertig[k] as number) - (grund[k] as number)) * fase;
    }

    // Pässe: das Gelände entlang der Route zum Sattel senken (`paesse.ts`).
    phase?.("landschaft/erhalt");
    legePaesse(r, fertig, paesse);
    phase?.("landschaft/paesse");
    // Die Erosion rundet die Köpfe ab, und ihre Hebung kann einen festen Punkt einsenken: Das Profil gilt wieder. Ein Nebengipfel über
    // einer Mulde steigt dabei; seine neue Höhe sichert `sichereGipfel` unten.
    const gesetzt = koepfe
        ? (() => {
              const wirksam = formeKoepfe(r, fertig, koepfe.punkte, koepfe.prominenz, koepfe.form);
              return nebengipfel.map((n, i) => ({ ...n, h: Math.max(n.h, wirksam[i] as number) }));
          })()
        : nebengipfel;
    // Keine globale horizontale Kappung: gezeichnete Kämme und eigene Nebengipfelhöhen
    // dürfen über einem anderen kanonischen Gipfel liegen. Nur dessen lokale Spitze wird gesichert.
    if (koepfe) phase?.("landschaft/koepfe");
    sichereGipfel(r, fertig, gesetzt, kammhoehe);
    sichereGipfel(r, fertig, peaks, kammhoehe);
    fuelleSenken(r, fertig, senke, 0.01, gipfelFix);
    // Die Flussläufe zuletzt (sonst hebt die Füllung die Einschnitte wieder an); sie sind Abflüsse, die zweite Füllung führt zu ihnen.
    // Eigene Höhen an Flüssen und Seen (WI-0249, nur mit Werten der Eingabe, die der Lader nur in Fassung 19 setzt): Dort gilt die Regel nicht.
    const wasserFix = wasserFest(r, fluesse, seen, e.flussHoehen, e.seeHoehen);
    if (wasserFix) for (let k = 0; k < n; k++) if (!Number.isNaN(wasserFix[k] as number)) senke[k] = 1;
    lasseFluesseFallen(r, fertig, fluesse, imSee, senke, wasserFix);
    fuelleSenken(r, fertig, senke, 0.01, gipfelFix);
    phase?.("landschaft/senken");
    return { h: fertig, senke, durchlaeufe, ...(koepfe ? { nebengipfel: gesetzt } : {}) };
}

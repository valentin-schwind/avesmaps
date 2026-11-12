/**
 * Die Hebung aus dem Rückennetz (Entwurf; Vorlage UpliftRasterizer des Prototyps): je Kante ein Rücken quer zu ihr, mit wechselnder
 * Breite; die Rücken verschmelzen über das Maximum. 🔴 Nicht über eine p-Norm wie im Prototyp: Wo viele kurze Kanten an einem Knoten
 * enden (Betreiber 2026-10-20: „deutlich kürzer und verzweigter“), stünde dort ein Wulst (drei Kanten: 3^(1/3,6) ≈ 1,36-fach). Darunter ein Sockel im Kern der Fläche (die Talböden zwischen den Strängen), darüber das Grundrauschen, zum Rand hin auf 0.
 * Die Gipfel werden als weiche Höhenconstraints in diese Grundform eingebettet. Danach erodieren ihre Flanken mit dem Gelände.
 */
import { fbm, wertRauschen, zellMuster } from "../noise.ts";
import type { Raster } from "../raster.ts";
import { randFeld, randMaxE, type RueckenRaster } from "./ausschnitt.ts";
import type { V12Peak, V12Controls } from "../types.ts";
import type { Rueckennetz } from "./netz.ts";
import { durchhangProfil } from "./kaemme.ts";

/** Die Form (Achsen „Reliefalter“ und „Material“ des Vorschlags); Werte je Typ in `typen.ts`. */
export interface FormRegler {
    /** Halbe Breite eines Rückens (E). */
    breite: number;
    /** 0 = runder Rücken, 1 = scharfer Grat. */
    schaerfe: number;
    /** Höhe der Talböden im Kern als Anteil der Kammhöhe (0 bis 1). */
    talboden: number;
    /** Stärke des Grundrauschens (± Anteil). */
    rauschen: number;
    /** Größe der gröbsten Buckel des Rauschens (E). */
    koernung: number;
    /** Über wie viele E die Höhe am Rand auf 0 ausläuft. */
    randBreite: number;
    /** Rinnennetz: Stufe der Erosion 0 bis 5 wie in der V12 (Meilenstein 2). */
    erosion: number;
    /** Wie viel der Grundform nach der Erosion bleibt (0 = nur Erosion, 1 = keine): hält die Rücken gegen das Rinnennetz. */
    erhalt: number;
    /**
     * Gratlinie: schmale Zusatzhöhe (0,45 E) auf jedem Strang als Anteil der Kammhöhe. Damit jede gezeichnete Kante als Grat erkennbar
     * bleibt, auch bei runden, breiten Typen (Hauptorchestrierung 2026-10-20, Tor „Grat“).
     */
    grat: number;
    /** Gratbreite: Breite der Gratlinie quer zur Kante (E, Standardabweichung); daneben liegt die Furche. Vorgabe 0,45. */
    gratBreite?: number;
    /**
     * Köpfe (WI-0249 P2): Mindestprominenz jedes Nebengipfels und kanonischen Gipfels als Anteil der Kammhöhe (`koepfe.ts`). Fehlt er
     * oder ist 0, rechnet die Form wie vor WI-0249 P2 (Fassung 17 und 18 führen ihn nicht); mit ihm rechnen auch Gebirge, die nur
     * Nebengipfel tragen, das Rückennetz (Kämme als Spannbaum der Punkte).
     */
    kopf?: number;
    /**
     * Kopfneigung (WI-0249 P2, `koepfe.ts`, `KopfForm`): mittlere Neigung des Kegels jedes Nebengipfels vom Punkt zum Sattel (Schritt je
     * Schritt); der Radius folgt aus der Prominenz wie bei den kanonischen Gipfeln, das Gelände darunter hebt sich zum Kegel (Sockel). Fehlt
     * sie oder ist 0, bleibt der Kopf wie zuvor (Sattel in 0,75 E).
     */
    kopfNeigung?: number;
    /**
     * Muster am Kamm (WI-0249 P2): Anteil des Grundmusters (Rauschen oder Zellen) an gezeichneten Kämmen (voll bis 0,25 E, aus bei 1 E)
     * und gesetzten Punkten (voll bis 0,5 E, aus bei 1,25 E); 1 oder fehlend wie vor P2. Die Zellen haben einen Mittelwert von −0,44 und
     * drückten gezeichnete Kämme auf 0,81 bis 0,94 ihrer Höhe (P3, `wi-0249-grundmuster/befund.md`); mit 0 bestimmt allein der Kamm seine
     * Höhe, das Muster wirkt auf den Flanken.
     */
    kammMuster?: number;
    /**
     * Durchhang der Hauptkämme (WI-0249 P2, `kaemme.ts`): um diesen Anteil ihrer Höhe sinkt die Mitte eines langen Segments zwischen zwei
     * Kammpunkten (kurze weniger, `durchhangAnteil`); die Punkte bleiben. Fehlt er oder ist 0, laufen die Kämme gerade wie zuvor.
     */
    durchhang?: number;
    /** Durchhang der Nebenkämme, ebenso. */
    durchhangNeben?: number;
    /**
     * Erosion im Gelände (WI-0249 P2): Anteil der hydraulischen Erosion, der im Endgelände noch auf das Gebirge wirkt (1 oder fehlend =
     * voll wie zuvor, 0 = das eingebettete Ergebnis der Vorschau bleibt stehen). Die Vorschau selbst liest ihn nicht.
     */
    gelaendeErosion?: number;
}

export function hebe(
    r: RueckenRaster,
    netz: Rueckennetz,
    reg: FormRegler,
    kammhoehe: number,
    saat: number,
    peaks: readonly V12Peak[],
    nebengipfel: readonly V12Peak[] = [],
    werte: V12Controls = {},
): Float64Array {
    const n = r.w * r.hh;
    const summe = new Float64Array(n);
    const kanteMax = new Float64Array(n);
    const gratFeld = new Float64Array(n);
    const huelle = new Float64Array(n);
    // Die Kantenhöhe W über den Sockel umrechnen, bevor die Rücken verschmelzen: Im Kern steht dann auf der Kante genau W (verankert an
    // Gipfeln und Nebengipfeln). Die Mischung s + (1 − s)·W hob den Grat sonst über seine Nebengipfel (Ehernes Schwert, Schild: 4700
    // neben 4000). Liegt W unter dem Talboden, bleibt die Kante mit mindestens GRAT_UEBER_SOCKEL × W über ihm stehen (Trollzacken als
    // Plateau). Umrechnen vor dem Maximum hält alles stetig (eine bestimmende Kante je Zelle gab Stufen, wo die Kante wechselt).
    const T = Math.min(0.95, Math.max(0, reg.talboden));
    const ueberSockel = (W: number): number => Math.max(GRAT_UEBER_SOCKEL * W, (W - T) / (1 - T));
    const beruehrt: number[] = [];
    const breite = Math.max(0.3, reg.breite);
    const reichweite = breite * 3.2;
    const gratBreite = Math.max(0.1, reg.gratBreite ?? 0.45);
    // Die Furche neben der Gratlinie reicht über 2 E (Hülle), auch bei schmalen Typen.
    const reichweiteGrat = Math.max(reichweite, 5);

    netz.kanten.forEach((kante, kn) => {
        for (let s = 1; s < kante.punkte.length; s++) {
            const [ax, ay] = kante.punkte[s - 1]!;
            const [bx, by] = kante.punkte[s]!;
            const wa = kante.gewicht[s - 1] ?? 1;
            const wb = kante.gewicht[s] ?? 1;
            const vx = bx - ax;
            const vy = by - ay;
            const l2 = vx * vx + vy * vy || 1e-9;
            // Breite wechselt entlang der Kante (gleiche Saat, eigene Lage je Kante).
            const w =
                breite * (0.85 + 0.3 * (0.5 + 0.5 * wertRauschen(saat + 701 + kn, (ax + bx) / 6, (ay + by) / 6, 1)));
            const weit = kante.art === "strang" ? reichweiteGrat : reichweite;
            const i0 = Math.max(0, r.i(Math.min(ax, bx) - weit));
            const i1 = Math.min(r.w - 1, r.i(Math.max(ax, bx) + weit));
            const j0 = Math.max(0, r.j(Math.min(ay, by) - weit));
            const j1 = Math.min(r.hh - 1, r.j(Math.max(ay, by) + weit));
            for (let j = j0; j <= j1; j++) {
                for (let i = i0; i <= i1; i++) {
                    const k = j * r.w + i;
                    if (!r.drin[k]) continue;
                    const px = r.x(i) - ax;
                    const py = r.y(j) - ay;
                    const t = Math.max(0, Math.min(1, (px * vx + py * vy) / l2));
                    const d = Math.hypot(px - t * vx, py - t * vy);
                    if (d > weit) continue;
                    const x = d / w;
                    const rund = Math.exp(-0.5 * x * x);
                    const spitz = Math.pow(Math.max(0, 1 - x / 2.6), 1 + (werte.bergform ?? 0.7));
                    const quer = rund * (1 - reg.schaerfe) + spitz * reg.schaerfe;
                    const wert = ueberSockel(wa + (wb - wa) * t) * quer;
                    if (kante.art === "strang") {
                        const W = wa + (wb - wa) * t;
                        const linie = W * Math.exp(-0.5 * (d / gratBreite) ** 2);
                        if (linie > (gratFeld[k] as number)) gratFeld[k] = linie;
                        const um = W * Math.exp(-0.5 * (d / 2) ** 2);
                        if (um > (huelle[k] as number)) huelle[k] = um;
                    }
                    if (d > reichweite) continue;
                    if (wert > (kanteMax[k] as number)) {
                        if (kanteMax[k] === 0) beruehrt.push(k);
                        kanteMax[k] = wert;
                    }
                }
            }
        }
        for (const k of beruehrt) {
            summe[k] = Math.max(summe[k] as number, kanteMax[k] as number);
            kanteMax[k] = 0;
        }
        beruehrt.length = 0;
    });

    // Randabstand in E (die Fase von `randAbstand` zählt 3 je Zelle).
    const rand = randFeld(r);
    const randMax = randMaxE(r, rand);
    // Rücken dürfen bis 1,2 × Kammhöhe, zwischen höheren Gipfeln bis zu deren Höhe (Grimmfrostöde: Kamm 3600, Gipfel bis 6800).
    let grenze = Math.max(
        1.2,
        ...[...peaks, ...nebengipfel].map((p) => (Number(p.h) > 0 ? Number(p.h) : 0) / kammhoehe),
    );
    for (const kante of netz.kanten) for (const gewicht of kante.gewicht) grenze = Math.max(grenze, gewicht);
    // Sockelgrenze um gesetzte Punkte: höchstens 90 % ihrer Höhe, nach außen um SOCKEL_ANSTIEG Schritt je E steigend. So darf der
    // Talboden anderswo hoch liegen, ohne über einen niedrigen Nebengipfel zu steigen (Blutzinnen: L 1700 deckelte sonst die ganze Fläche).
    const sockelGrenze = new Float64Array(n).fill(Infinity);
    for (const p of [...peaks, ...nebengipfel]) {
        const ph = Number(p.h) > 0 ? Number(p.h) : kammhoehe;
        const reich = Math.max(0, (kammhoehe * reg.talboden - 0.9 * ph) / SOCKEL_ANSTIEG);
        if (!(reich > 0)) continue;
        for (let j = Math.max(0, r.j(p.y - reich)); j <= Math.min(r.hh - 1, r.j(p.y + reich)); j++)
            for (let i = Math.max(0, r.i(p.x - reich)); i <= Math.min(r.w - 1, r.i(p.x + reich)); i++) {
                const k = j * r.w + i;
                const g = (0.9 * ph + SOCKEL_ANSTIEG * Math.hypot(r.x(i) - p.x, r.y(j) - p.y)) / kammhoehe;
                if (g < (sockelGrenze[k] as number)) sockelGrenze[k] = g;
            }
    }
    // Muster am Kamm (WI-0249 P2): Nähe zu gezeichneten Kämmen und gesetzten Punkten, wie das Feld des Formerhalts im Gelände.
    const kammMuster = reg.kammMuster === undefined ? 1 : Math.max(0, Math.min(1, reg.kammMuster));
    const musterNaehe = kammMuster < 1 ? formNaehe(r, netz, [...peaks, ...nebengipfel]) : null;
    const h = new Float64Array(n);
    // Durchhang (WI-0249 P2): Für die Sättel (unten) je Zelle die Höhe vor der Senkung, der Talboden und die Fase; ohne durchhängende
    // Kante keine.
    const saettel = netz.kanten.some((kante) => kante.durchhang?.some((t) => t > 0));
    const roh = saettel ? new Float64Array(n) : null;
    const boden = saettel ? new Float64Array(n) : null;
    const fasen = saettel ? new Float64Array(n) : null;
    for (let j = 0; j < r.hh; j++) {
        for (let i = 0; i < r.w; i++) {
            const k = j * r.w + i;
            if (!r.drin[k]) continue;
            const abRand = ((rand[k] as number) * r.cell) / 3;
            // Sockelanstieg und Randauslauf mit der Flächenbreite skalieren: An schmalen Flächen (Blutzinnen, Median 1,25 E vom Umriss)
            // lag sonst fast alles im Anstieg, das HI blieb unter 0,35 (Randbreite 5 E deckelte es allein auf 0,31).
            const kern = Math.min(1, abRand / Math.max(1, randMax * 0.35));
            const sockel = Math.min(reg.talboden * kern * kern * (3 - 2 * kern), sockelGrenze[k] as number);
            // Gratlinie als Furche: neben jeder Strangkante um Grat × W tiefer (Hülle über 2 E minus schmale Linie der Gratbreite, Vorgabe 0,45 E). Auf der Kante
            // bleibt die verankerte Höhe, die Flanken fallen unabhängig vom Sockel (Schild: Rücken 3 E breit, sonst kaum Grat).
            const grat = Math.min(1, reg.grat ?? 0);
            const ruecken = summe[k] as number;
            const furche = grat * Math.max(0, (huelle[k] as number) - (gratFeld[k] as number));
            // Rauschen auf dem Sockel nur zur Hälfte: Bei hohem Sockel (Schild 0,7) stünde der Grat sonst unter den Buckeln des Sockels.
            const stufen = Math.max(1, Math.min(8, Math.round(werte.stufen ?? 4)));
            const koernung = Math.max(0.5, reg.koernung);
            const muster =
                werte.muster === "zellen"
                    ? 2 * zellMuster(saat, r.x(i), r.y(j), koernung, 0.45 * reg.rauschen).c - 1
                    : fbm(saat, r.x(i), r.y(j), koernung, stufen, 0.5);
            const rausch =
                reg.rauschen * muster * (musterNaehe ? 1 - (1 - kammMuster) * (musterNaehe[k] as number) : 1);
            const z =
                kammhoehe *
                (sockel * (1 + 0.5 * rausch) +
                    (1 - sockel) * Math.min(ueberSockel(grenze), ruecken) * (1 + rausch) -
                    furche);
            const fase = Math.pow(
                Math.max(0, Math.min(1, (abRand - 0.24) / Math.max(0.5, Math.min(reg.randBreite, 0.4 * randMax)))),
                0.85,
            );
            h[k] = Math.max(0, z * fase);
            if (roh) {
                roh[k] = z;
                boden![k] = kammhoehe * sockel * (1 + 0.5 * rausch);
                fasen![k] = fase;
            }
        }
    }
    if (roh) {
        // Ein Sattel sinkt höchstens bis knapp über den Talboden (Sockel), sonst läge er in einem massigen Gebirge unter dem Boden daneben
        // (Talboden 0,85: Sattel 1.897 unter einer Fläche von 1.970), und das Querprofil wäre eine Kerbe statt eines Rückens. Fehlt der
        // Spielraum, hängt das ganze Segment flacher durch: Die Form X\_/X und die Breite der Senkung bleiben (je Zelle begrenzt, sänke nur
        // der schmale Grat über dem Boden, und die Erosion der Vorschau verwischte ihn).
        const spiel = (k: number): number =>
            (SATTEL_UEBER_BODEN * Math.max(0, (roh[k] as number) - (boden![k] as number))) / kammhoehe;
        const senkung = senkeSaettel(r, netz, breite, spiel, [...peaks, ...nebengipfel]);
        for (let k = 0; k < n; k++) {
            const tief = senkung[k] as number;
            if (!(tief > 0)) continue;
            h[k] = Math.max(0, ((roh[k] as number) - kammhoehe * tief) * (fasen![k] as number));
        }
    }
    setzeGipfel(r, h, nebengipfel, kammhoehe, NEBENGIPFEL_FORM);
    setzeGipfel(r, h, peaks, kammhoehe);
    return h;
}

/** VORSCHLAG (WI-0249 P2): Um jeden Punkt eines durchhängenden Segments bleibt die Höhe bis zu diesem Abstand (E) stehen, weich auslaufend. */
export const DURCHHANG_PUNKT_E = 1;
/** VORSCHLAG (WI-0249 P2): Ein Sattel sinkt höchstens um diesen Anteil der Höhe seines Grats über dem Talboden (je Segment). */
export const SATTEL_UEBER_BODEN = 0.8;

/**
 * Die Senkung der Sättel (WI-0249 P2, Durchhang, `kaemme.ts`) als Anteil der Kammhöhe je Zelle; null ohne durchhängende Kante. Je Segment
 * mit Tiefe: `Tiefe · Profil(u) · W(u)` auf der Achse (W die Kantenhöhe zwischen den Punkten), quer so breit wie der Rücken
 * (`exp(−½ (d / Breite)²)`): Der Sattel sinkt mit seinen Flanken, das Querprofil bleibt gewölbt. Ein Abzug statt eines kleineren Gewichts,
 * weil `ueberSockel` das Gewicht über einem hohen Talboden staucht. Je Segment höchstens `SATTEL_UEBER_BODEN` des Grats über dem Talboden
 * (bei 30, 50 und 70 %); fehlt der Spielraum, hängt es flacher durch. Um jeden Punkt eines solchen Segments und um jeden Gipfel und
 * Nebengipfel (bis `DURCHHANG_PUNKT_E`, weich wie `setzeGipfel`) keine Senkung, auch nicht aus dem Sattel eines Nachbarkamms: Die Punkte
 * bleiben stehen.
 */
function senkeSaettel(
    r: RueckenRaster,
    netz: Rueckennetz,
    breite: number,
    /** Spielraum einer Zelle (Anteil der Kammhöhe): so tief darf ihr Sattel höchstens sinken. */
    spiel: (k: number) => number,
    /** Gipfel und Nebengipfel: Um sie bleibt die Höhe stehen wie um die Kammpunkte (sonst höbe `setzeGipfel` ihr Umland nach). */
    punkte: readonly { x: number; y: number }[],
): Float64Array {
    const kanten = netz.kanten.filter((k) => k.durchhang?.some((t) => t > 0));
    const n = r.w * r.hh;
    const senkung = new Float64Array(n);
    const schutz = new Float64Array(n);
    const reich = 3 * breite;
    const kasten = (x0: number, y0: number, x1: number, y1: number, je: (k: number, x: number, y: number) => void) => {
        for (let j = Math.max(0, r.j(y0)); j <= Math.min(r.hh - 1, r.j(y1)); j++)
            for (let i = Math.max(0, r.i(x0)); i <= Math.min(r.w - 1, r.i(x1)); i++) {
                const k = j * r.w + i;
                if (r.drin[k]) je(k, r.x(i), r.y(j));
            }
    };
    for (const kante of kanten)
        for (let s = 1; s < kante.punkte.length; s++) {
            const tiefe = kante.durchhang![s - 1] ?? 0;
            if (!(tiefe > 0)) continue;
            const [ax, ay] = kante.punkte[s - 1]!;
            const [bx, by] = kante.punkte[s]!;
            const wa = kante.gewicht[s - 1] ?? 1;
            const wb = kante.gewicht[s] ?? 1;
            const vx = bx - ax;
            const vy = by - ay;
            const l2 = vx * vx + vy * vy || 1e-9;
            const l = Math.sqrt(l2);
            // Spielraum bei 30, 50 und 70 % des Segments (der Grat bis 0,5 E neben der Linie): Reicht er nicht, hängt das ganze Segment
            // flacher durch.
            let anteil = 1;
            for (const u of [0.3, 0.5, 0.7]) {
                const soll = tiefe * durchhangProfil(u, l) * (wa + (wb - wa) * u);
                let grat = -1;
                kasten(ax + vx * u - 0.5, ay + vy * u - 0.5, ax + vx * u + 0.5, ay + vy * u + 0.5, (k, x, y) => {
                    if (Math.hypot(x - ax - vx * u, y - ay - vy * u) <= 0.5) grat = Math.max(grat, spiel(k));
                });
                if (grat >= 0 && soll > 0) anteil = Math.min(anteil, grat / soll);
            }
            if (!(anteil > 0)) continue;
            kasten(
                Math.min(ax, bx) - reich,
                Math.min(ay, by) - reich,
                Math.max(ax, bx) + reich,
                Math.max(ay, by) + reich,
                (k, x, y) => {
                    const t = ((x - ax) * vx + (y - ay) * vy) / l2;
                    if (!(t > 0 && t < 1)) return;
                    const d = Math.hypot(x - ax - t * vx, y - ay - t * vy);
                    if (d > reich) return;
                    const wert =
                        anteil *
                        tiefe *
                        durchhangProfil(t, l) *
                        (wa + (wb - wa) * t) *
                        Math.exp(-0.5 * (d / breite) ** 2);
                    if (wert > (senkung[k] as number)) senkung[k] = wert;
                },
            );
            for (const [px, py] of [
                [ax, ay],
                [bx, by],
            ] as const)
                kasten(
                    px - DURCHHANG_PUNKT_E,
                    py - DURCHHANG_PUNKT_E,
                    px + DURCHHANG_PUNKT_E,
                    py + DURCHHANG_PUNKT_E,
                    (k, x, y) => {
                        const u = Math.min(1, Math.hypot(x - px, y - py) / DURCHHANG_PUNKT_E);
                        const g = (1 - u) ** 4 * (1 + 4 * u);
                        if (g > (schutz[k] as number)) schutz[k] = g;
                    },
                );
        }
    for (const p of punkte)
        kasten(
            p.x - DURCHHANG_PUNKT_E,
            p.y - DURCHHANG_PUNKT_E,
            p.x + DURCHHANG_PUNKT_E,
            p.y + DURCHHANG_PUNKT_E,
            (k, x, y) => {
                const u = Math.min(1, Math.hypot(x - p.x, y - p.y) / DURCHHANG_PUNKT_E);
                const g = (1 - u) ** 4 * (1 + 4 * u);
                if (g > (schutz[k] as number)) schutz[k] = g;
            },
        );
    for (let k = 0; k < n; k++) senkung[k] = (senkung[k] as number) * (1 - (schutz[k] as number));
    return senkung;
}

/** VORSCHLAG (WI-0249 P2): Nähe zur Kammachse voll bis 0,25 E, aus bei 1 E; zum Gipfelkern voll bis 0,5 E, aus bei 1,25 E (wie im Gelände). */
export const FORM_KAMM_E: readonly [number, number] = [0.25, 0.75];
export const FORM_KERN_E: readonly [number, number] = [0.5, 0.75];

/** Nähe (1 bis 0, weich) zu gezeichneten Strängen (`quelle` gezeichnet) und gesetzten Punkten, je Zelle in der Fläche. */
export function formNaehe(
    r: RueckenRaster,
    netz: Rueckennetz,
    punkte: readonly { x: number; y: number }[],
): Float32Array {
    const naehe = new Float32Array(r.w * r.hh);
    const stemple = (x: number, y: number, [voll, aus]: readonly [number, number]): void => {
        const reich = voll + aus;
        for (let j = Math.max(0, r.j(y - reich)); j <= Math.min(r.hh - 1, r.j(y + reich)); j++)
            for (let i = Math.max(0, r.i(x - reich)); i <= Math.min(r.w - 1, r.i(x + reich)); i++) {
                const k = j * r.w + i;
                if (!r.drin[k]) continue;
                const t = Math.max(0, Math.min(1, (Math.hypot(r.x(i) - x, r.y(j) - y) - voll) / aus));
                const g = 1 - t * t * (3 - 2 * t);
                if (g > (naehe[k] as number)) naehe[k] = g;
            }
    };
    for (const kante of netz.kanten) {
        if (kante.art !== "strang" || kante.quelle !== "gezeichnet") continue;
        for (let s = 1; s < kante.punkte.length; s++) {
            const [ax, ay] = kante.punkte[s - 1]!;
            const [bx, by] = kante.punkte[s]!;
            const l = Math.hypot(bx - ax, by - ay);
            const schritte = Math.max(1, Math.ceil(l / (r.cell / 2)));
            for (let t = s === 1 ? 0 : 1; t <= schritte; t++)
                stemple(ax + ((bx - ax) * t) / schritte, ay + ((by - ay) * t) / schritte, FORM_KAMM_E);
        }
    }
    for (const p of punkte) stemple(p.x, p.y, FORM_KERN_E);
    return naehe;
}

/** Ohne eigene Höhe trägt ein Gipfel die Kammhöhe; seine Korrektur gehört zur Grundform vor der Erosion. */
/** Reichweite der weichen Höhenkorrektur vor der Erosion. */
export interface GipfelForm {
    radius: number;
}
/** VORSCHLAG: Eine Kante unter dem Talboden steht mindestens mit diesem Anteil ihrer Höhe über dem Sockel (sonst verschwände sie). */
export const GRAT_UEBER_SOCKEL = 0.5;
/** VORSCHLAG: Anstieg der Sockelgrenze um gesetzte Punkte (Schritt je E). */
export const SOCKEL_ANSTIEG = 300;
export const GIPFEL_FORM: GipfelForm = { radius: 5 };
/** Nebengipfel sind kleiner: Sie sollen den Kamm nicht flach drücken (Betreiber 2026-10-20, „sekundäre berggipfel“). */
export const NEBENGIPFEL_FORM: GipfelForm = { radius: 3 };

export function setzeGipfel(
    r: Raster,
    h: Float64Array,
    peaks: readonly V12Peak[],
    kammhoehe: number,
    form: GipfelForm = GIPFEL_FORM,
): void {
    for (const p of peaks) {
        const pi = r.i(p.x);
        const pj = r.j(p.y);
        if (pi < 0 || pj < 0 || pi >= r.w || pj >= r.hh || !r.drin[pj * r.w + pi]) continue;
        const ziel = Number(p.h) > 0 ? Number(p.h) : kammhoehe;
        const mitte = h[pj * r.w + pi] as number;
        const radius = form.radius;
        const reich = Math.ceil(radius / r.cell);
        for (let j = Math.max(0, pj - reich); j <= Math.min(r.hh - 1, pj + reich); j++) {
            for (let i = Math.max(0, pi - reich); i <= Math.min(r.w - 1, pi + reich); i++) {
                const k = j * r.w + i;
                if (!r.drin[k]) continue;
                const d = Math.hypot(r.x(i) - r.x(pi), r.y(j) - r.y(pj));
                const t = Math.min(1, d / radius);
                // C2-stetig am Rand: kein Ring, keine kreisförmige Abbruchkante.
                const gewicht = (1 - t) ** 4 * (1 + 4 * t);
                // Bestehende Rücken und Einschnitte erhalten statt einen Kegel aufzuprägen.
                const relief = mitte > 1 ? Math.min(1, (h[k] as number) / mitte) : 1;
                h[k] = Math.max(0, (h[k] as number) + (ziel - mitte) * gewicht * relief);
            }
        }
        h[pj * r.w + pi] = ziel;
    }
}

/**
 * Der Rückennetz-Bauer (Entwurf, nicht Produkt; Betreiber 2026-10-20: „wir nehmen ein neues berechnungsmodell für die gebirge, um auf
 * die verzweigeten rücken zu kommen“; Vorlage RidgeGraphBuilder aus `topographie-19-test/ridgegraph-prototyp/`).
 *
 * Anders als der Prototyp setzt er die Rücken nicht von Hand, sondern leitet sie aus der Fläche ab:
 * - **Leitkurve:** die gezeichnete Kammlinie (ohne Umkehr), sonst der Spannbaum der Gipfel, sonst die Längsachse der Fläche; an beiden
 *   Enden gerade verlängert, bis sie die Fläche verlässt.
 * - **Breite je Stelle:** quer zur Leitkurve gemessen, links und rechts getrennt.
 * - **Stränge:** Ihre Zahl folgt der Breite (Breite × Füllung / Abstand). Wird die Fläche breiter, gabelt sich ein Strang (gemeinsamer
 *   Knoten), wird sie schmaler, laufen zwei zusammen (gemeinsamer Knoten). Jeder Strang wandert langsam und pseudozufällig um seinen
 *   Platz; kommen sich zwei zu nahe, vereinigen sie sich.
 * - **Äste:** von den äußeren Strängen schräg nach außen zum Rand, kürzer als der Weg dorthin; zwischen ihnen liegen die Quertäler.
 * Alles in Kartenkoordinaten (E) und pseudozufällig aus der EINEN Saat des Gebirges.
 */
import { kammOhneUmkehr } from "./linien.ts";
import { fbm, wertRauschen } from "../noise.ts";
import type { Raster } from "../raster.ts";
import { spannbaum } from "../ridge.ts";
import type { V12Input } from "../types.ts";

/** Die Struktur eines Gebirges (Achse „Struktur“ des Vorschlags); Werte je Typ in `typen.ts`. */
export interface StrukturRegler {
    /** Abstand benachbarter Stränge (E). */
    abstand: number;
    /** Wie viel der Breite die Stränge füllen (0 bis 1); klein = Kern, groß = bis an den Rand. */
    fuellung: number;
    /** Höchstzahl der Stränge nebeneinander. */
    straengeMax: number;
    /** Wie weit ein Strang um seinen Platz wandert, in Strangabständen (0 bis 1). */
    wandern: number;
    /** Über welche Länge (E) ein Strang einmal hin und her wandert. */
    welle: number;
    /** Abstand der Äste entlang eines äußeren Strangs (E); 0 = keine Äste. */
    astAbstand: number;
    /** Länge eines Astes als Anteil des Wegs bis zum Rand (0 bis 1). */
    astLaenge: number;
}

export type KantenArt = "strang" | "ast";

export interface Kante {
    art: KantenArt;
    /** Woher die Kante kommt: gezeichnet (Kamm der Redaktion) oder vom Modell erzeugt (Rückfall, Äste). */
    quelle: "gezeichnet" | "erzeugt";
    /** Punkte in Kartenkoordinaten (E). */
    punkte: [number, number][];
    /** Gewicht je Punkt (0 bis 1): wie hoch der Rücken dort ist, bevor die Hebung ihn formt. */
    gewicht: number[];
    /** Durchhang je Segment (WI-0249 P2, `durchhangTiefen`): Anteil der Kammhöhe, um den die Segmentmitte sinkt; fehlt er, keiner. */
    durchhang?: number[];
}

export interface Knoten {
    art: "gabelung" | "vereinigung" | "ast";
    x: number;
    y: number;
}

export interface Rueckennetz {
    leitkurve: [number, number][];
    kanten: Kante[];
    knoten: Knoten[];
}

const SCHRITT = 0.5;

/** Die Leitkurven: Kammlinie ohne Umkehr, sonst Spannbaum der Gipfel, sonst die Längsachse der Fläche. */
function leitkurven(e: V12Input, r: Raster): [number, number][][] {
    if (Array.isArray(e.kurve) && e.kurve.length >= 2) {
        const stuecke = kammOhneUmkehr([e.kurve]) as [number, number][][];
        if (stuecke.length > 0) return stuecke.map((s) => s.map(([x, y]) => [x, y] as [number, number]));
    }
    const peaks = Array.isArray(e.peaks) ? e.peaks : [];
    if (peaks.length >= 2) {
        return spannbaum(peaks).map(([a, b]) => [
            [peaks[a]!.x, peaks[a]!.y],
            [peaks[b]!.x, peaks[b]!.y],
        ]);
    }
    // Die Längsachse: Hauptachse der Zellen der Fläche (Trägheit), durch den Schwerpunkt.
    let n = 0;
    let mx = 0;
    let my = 0;
    for (let j = 0; j < r.hh; j++)
        for (let i = 0; i < r.w; i++)
            if (r.drin[j * r.w + i]) {
                n++;
                mx += r.x(i);
                my += r.y(j);
            }
    mx /= Math.max(1, n);
    my /= Math.max(1, n);
    let sxx = 0;
    let syy = 0;
    let sxy = 0;
    for (let j = 0; j < r.hh; j++)
        for (let i = 0; i < r.w; i++) {
            if (!r.drin[j * r.w + i]) continue;
            const dx = r.x(i) - mx;
            const dy = r.y(j) - my;
            sxx += dx * dx;
            syy += dy * dy;
            sxy += dx * dy;
        }
    const winkel = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    return [
        [
            [mx - Math.cos(winkel), my - Math.sin(winkel)],
            [mx + Math.cos(winkel), my + Math.sin(winkel)],
        ],
    ];
}

/** Ist ein Punkt in der Fläche (Rasterzelle)? */
const drin = (r: Raster, x: number, y: number): boolean => {
    const i = r.i(x);
    const j = r.j(y);
    return i >= 0 && j >= 0 && i < r.w && j < r.hh && r.drin[j * r.w + i] === 1;
};

/**
 * Tastet eine Leitkurve in festen Schritten ab, an beiden Enden gerade verlängert, bis sie die Fläche verlässt. Je Stelle: Lage,
 * Richtung (geglättet) und die Breite links und rechts.
 */
function tasteAb(r: Raster, kurve: [number, number][]) {
    const lage: [number, number][] = [];
    // Gleichmäßig abtasten.
    for (let s = 1; s < kurve.length; s++) {
        const [ax, ay] = kurve[s - 1]!;
        const [bx, by] = kurve[s]!;
        const l = Math.hypot(bx - ax, by - ay);
        const n = Math.max(1, Math.round(l / SCHRITT));
        for (let k = s === 1 ? 0 : 1; k <= n; k++) lage.push([ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n]);
    }
    // Verlängern, solange die Fläche weitergeht (mit Spielraum über kleine Buchten).
    const verlaengere = (vorn: boolean): void => {
        for (let runde = 0; runde < 400; runde++) {
            const a = vorn ? lage[1]! : lage[lage.length - 2]!;
            const b = vorn ? lage[0]! : lage[lage.length - 1]!;
            const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
            const p: [number, number] = [b[0] + ((b[0] - a[0]) / l) * SCHRITT, b[1] + ((b[1] - a[1]) / l) * SCHRITT];
            let weiter = false;
            for (let v = 0; v <= 4 && !weiter; v++) {
                weiter = drin(r, p[0] + ((b[0] - a[0]) / l) * v * SCHRITT, p[1] + ((b[1] - a[1]) / l) * v * SCHRITT);
            }
            if (!weiter) return;
            if (vorn) lage.unshift(p);
            else lage.push(p);
        }
    };
    if (lage.length >= 2) {
        verlaengere(true);
        verlaengere(false);
    }
    // Richtung, geglättet über ±3 Schritte.
    const richtung = lage.map((_, k) => {
        const a = lage[Math.max(0, k - 3)]!;
        const b = lage[Math.min(lage.length - 1, k + 3)]!;
        const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
        return [(b[0] - a[0]) / l, (b[1] - a[1]) / l] as [number, number];
    });
    // Breite: entlang der Normalen bis zur ersten Stelle außerhalb.
    const breite = (k: number, seite: 1 | -1): number => {
        const [x, y] = lage[k]!;
        const [dx, dy] = richtung[k]!;
        const nx = -dy * seite;
        const ny = dx * seite;
        let s = 0;
        while (s < 200 && drin(r, x + nx * (s + r.cell), y + ny * (s + r.cell))) s += r.cell;
        return s;
    };
    const glatt = (werte: number[]): number[] =>
        werte.map((_, k) => {
            let summe = 0;
            let n = 0;
            for (let d = -4; d <= 4; d++) {
                const v = werte[k + d];
                if (v !== undefined) {
                    summe += v;
                    n++;
                }
            }
            return summe / n;
        });
    const links = glatt(lage.map((_, k) => breite(k, 1)));
    const rechts = glatt(lage.map((_, k) => breite(k, -1)));
    return { lage, richtung, links, rechts };
}

interface Strang {
    id: number;
    /** Stelle (Schritt), an der der Strang entstand; vor 8 E vereinigt er sich nicht. */
    seit: number;
    s: number;
    punkte: [number, number][];
    gewicht: number[];
}

/** Baut das Rückennetz einer Fläche. */
export function baueRueckennetz(e: V12Input, r: Raster, reg: StrukturRegler, saat: number): Rueckennetz {
    const kanten: Kante[] = [];
    const knoten: Knoten[] = [];
    let leit: [number, number][] = [];
    let naechsteId = 0;
    // Ohne Füllung kein Netz (Schild, Inselberg): nur Sockel und Gipfel.
    if (!(reg.fuellung > 0)) return { leitkurve: [], kanten, knoten };
    for (const kurve of leitkurven(e, r)) {
        const { lage, richtung, links, rechts } = tasteAb(r, kurve);
        if (lage.length < 2) continue;
        if (leit.length === 0) leit = lage;
        const abstand = Math.max(0.5, reg.abstand);
        const punktBei = (k: number, s: number): [number, number] => {
            const [x, y] = lage[k]!;
            const [dx, dy] = richtung[k]!;
            return [x - dy * s, y + dx * s];
        };
        const aktiv: Strang[] = [];
        const beende = (st: Strang): void => {
            if (st.punkte.length >= 2)
                kanten.push({ art: "strang", quelle: "erzeugt", punkte: st.punkte, gewicht: st.gewicht });
        };
        for (let k = 0; k < lage.length; k++) {
            const t = k * SCHRITT;
            const wl = links[k]!;
            const wr = rechts[k]!;
            const spanne = (wl + wr) * reg.fuellung;
            const mitte = (wl - wr) / 2;
            const ziel = Math.max(1, Math.min(reg.straengeMax, Math.floor(spanne / abstand) + 1));
            // Gabeln: ein Strang mehr, wo die Fläche breiter wird (der mit dem größten Abstand zum Nachbarn teilt sich).
            if (aktiv.length === 0) {
                aktiv.push({ id: naechsteId++, seit: -999, s: mitte, punkte: [], gewicht: [] });
            } else if (aktiv.length < ziel && k % 4 === 0) {
                aktiv.sort((a, b) => a.s - b.s);
                const grenzen = [mitte - spanne / 2, ...aktiv.map((a) => a.s), mitte + spanne / 2];
                let best = 0;
                for (let g = 0; g < aktiv.length; g++) {
                    const luecke = Math.max(
                        (grenzen[g + 1] as number) - (grenzen[g] as number),
                        (grenzen[g + 2] as number) - (grenzen[g + 1] as number),
                    );
                    if (luecke > best) best = g;
                }
                const mutter = aktiv[best]!;
                const p = punktBei(k, mutter.s);
                knoten.push({ art: "gabelung", x: p[0], y: p[1] });
                mutter.seit = k;
                aktiv.push({
                    id: naechsteId++,
                    seit: k,
                    s: mutter.s,
                    punkte: [p],
                    gewicht: [mutter.gewicht.at(-1) ?? 1],
                });
            }
            // Plätze: gleichmäßig über die gefüllte Spanne, dazu das Wandern.
            aktiv.sort((a, b) => a.s - b.s);
            const n = aktiv.length;
            const schritt = n > 1 ? Math.min(abstand * 1.25, spanne / (n - 1)) : 0;
            aktiv.forEach((st, idx) => {
                const platz = mitte + (idx - (n - 1) / 2) * schritt;
                const wandern =
                    reg.wandern * abstand * 0.6 * fbm(saat + 401 + st.id * 17, t, st.id * 13.7, reg.welle, 2, 0.5);
                st.s += (platz + wandern - st.s) * 0.18;
                st.s = Math.max(-wr * 0.95, Math.min(wl * 0.95, st.s));
            });
            // Vereinigen: zu nahe Nachbarn oder mehr Stränge als Platz.
            aktiv.sort((a, b) => a.s - b.s);
            for (let g = 0; g + 1 < aktiv.length; g++) {
                const a = aktiv[g]!;
                const b = aktiv[g + 1]!;
                if (k - a.seit < 16 || k - b.seit < 16) continue;
                const zuViele = aktiv.length > ziel && k % 4 === 2;
                if (b.s - a.s < abstand * 0.5 || (zuViele && b.s - a.s < abstand * 0.9)) {
                    const bleibt = Math.abs(a.s - mitte) < Math.abs(b.s - mitte) ? a : b;
                    const geht = bleibt === a ? b : a;
                    const p = punktBei(k, bleibt.s);
                    geht.punkte.push(p);
                    geht.gewicht.push(geht.gewicht.at(-1) ?? 1);
                    knoten.push({ art: "vereinigung", x: p[0], y: p[1] });
                    beende(geht);
                    aktiv.splice(aktiv.indexOf(geht), 1);
                    break;
                }
            }
            // Punkte setzen; das Gewicht sinkt zu den Enden der Leitkurve und nach außen.
            const ende = Math.min(1, (Math.min(k, lage.length - 1 - k) * SCHRITT) / 3);
            for (const st of aktiv) {
                const q = Math.abs(st.s - mitte) / Math.max(abstand, spanne / 2);
                const sattel =
                    0.88 + 0.12 * wertRauschen(saat + 503 + st.id * 29, t / (reg.welle * 0.7), st.id * 3.1, 1);
                st.punkte.push(punktBei(k, st.s));
                st.gewicht.push(Math.max(0.15, (1 - 0.35 * q * q) * sattel * (0.55 + 0.45 * ende)));
            }
        }
        for (const st of aktiv) beende(st);

        // Äste: von den äußersten Strängen je Seite schräg nach außen.
        if (reg.astAbstand > 0) {
            const straenge = kanten.filter((kante) => kante.art === "strang");
            for (const [seiteNr, seite] of [
                [0, 1],
                [1, -1],
            ] as const) {
                let lauf = wertRauschen(saat + 601 + seiteNr, seiteNr * 7.1, 0.5, 1) * reg.astAbstand;
                for (let k = 0; k < lage.length; k += 2) {
                    lauf += 2 * SCHRITT;
                    if (lauf < reg.astAbstand) continue;
                    lauf = 0.35 * reg.astAbstand * wertRauschen(saat + 607 + seiteNr, k * 0.37, 1.3, 1);
                    // Der äußerste Strang auf dieser Seite an dieser Stelle.
                    const [lx, ly] = lage[k]!;
                    const [dx, dy] = richtung[k]!;
                    let ausserst: [number, number] | null = null;
                    let bestS = -Infinity;
                    let gewicht = 1;
                    for (const st of straenge) {
                        st.punkte.forEach(([px, py], pi) => {
                            const vor = (px - lx) * dx + (py - ly) * dy;
                            if (Math.abs(vor) > SCHRITT * 0.6) return;
                            const quer = ((px - lx) * -dy + (py - ly) * dx) * seite;
                            if (quer > bestS) {
                                bestS = quer;
                                ausserst = [px, py];
                                gewicht = st.gewicht[pi] ?? 1;
                            }
                        });
                    }
                    if (ausserst === null) continue;
                    const rand = (seite === 1 ? links[k]! : rechts[k]!) - bestS;
                    if (rand < 1.5) continue;
                    const laenge =
                        rand * reg.astLaenge * (0.75 + 0.25 * wertRauschen(saat + 613, k * 0.91, seiteNr, 1));
                    // Schräg nach außen, leicht vorwärts oder rückwärts (pseudozufällig).
                    const schraeg = 0.45 * wertRauschen(saat + 619, k * 0.53, seiteNr * 2.3, 1);
                    const nx = -dy * seite + dx * schraeg;
                    const ny = dx * seite + dy * schraeg;
                    const nl = Math.hypot(nx, ny) || 1;
                    const [ax, ay] = ausserst as [number, number];
                    const punkte: [number, number][] = [];
                    const gew: number[] = [];
                    const stuecke = Math.max(2, Math.round(laenge / SCHRITT));
                    for (let p = 0; p <= stuecke; p++) {
                        const f = p / stuecke;
                        const biege = 0.6 * Math.sin(f * Math.PI) * wertRauschen(saat + 631, k * 0.29, p * 0.4, 1);
                        punkte.push([
                            ax + (nx / nl) * laenge * f - (ny / nl) * biege,
                            ay + (ny / nl) * laenge * f + (nx / nl) * biege,
                        ]);
                        gew.push(gewicht * (0.85 - 0.6 * f));
                    }
                    knoten.push({ art: "ast", x: ax, y: ay });
                    kanten.push({ art: "ast", quelle: "erzeugt", punkte, gewicht: gew });
                }
            }
        }
    }
    return { leitkurve: leit, kanten, knoten };
}

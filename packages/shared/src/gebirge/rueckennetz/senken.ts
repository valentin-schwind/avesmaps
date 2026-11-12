/**
 * Täler und Mulden im Rückennetz (Betreiber 2026-10-21 über die Hauptorchestrierung: „zu haupt- und nebenkamm das gegenteil "tal" …,
 * dass das gebirge wieder runterdrückt. diesselbe gewichtung wie nebenkämme - nur nach unten. und den "gegengipfel" ein punkt, der eine
 * mulde (krater) macht“). Beide drücken die Grundform nach der Hebung nach unten, vor Tälern der Flüsse und Erosion der Landschaft, damit
 * sich Rinnen und Abfluss nach ihnen richten:
 * - **Tal:** eine Linie mit dem Gewicht eines Nebenkamms, nach unten gespiegelt. Ein Nebenkamm steht um `ueberSockel(0,9)` des Wegs
 *   vom Sockel zur Kammhöhe über dem Sockel; ein Tal liegt um denselben Anteil des Sockels darunter. Breite wie ein Rücken (`hebung.ts`),
 *   im Querschnitt ein V; ein freies Ende läuft über höchstens 2 E aus, ein Ende an einer Mulde trägt deren Boden.
 * - **Mulde:** ein Punkt, eine Schüssel mit dem Kegel eines Nebengipfels (2 E) auf ihren Boden, ohne eigene Höhe auf den Boden der Täler.
 * Gedrückt wird nur, was über dem Ziel liegt; Achse und Muldenkern sind gewollte Senken, die Senkenfüllung lässt sie stehen.
 */
import { wertRauschen } from "../noise.ts";
import type { RueckenRaster } from "./ausschnitt.ts";
import { GRAT_UEBER_SOCKEL, NEBENGIPFEL_FORM, type FormRegler } from "./hebung.ts";
import { KAMM_FANG_E } from "./netz-vertrag.ts";

/** Ein Tal als Eingabe: ein Linienzug in E, mit der Höhe der Talsohle je Stützpunkt (WI-0249 P9, `null` = Vorgabe). */
export interface TalEingabe {
    punkte: readonly (readonly [number, number])[];
    hoehen?: readonly (number | null)[] | undefined;
}

/** Eine Mulde als Eingabe; ohne Höhe gilt der Boden der Täler. */
export interface MuldeEingabe {
    id?: string;
    x: number;
    y: number;
    h?: number | null;
}

/** Das Gewicht eines Nebenkamms (`kaemme.ts`), hier nach unten. */
export const TAL_GEWICHT = 0.9;
/** Der Kern einer Mulde (E): Hier bleibt ihr Boden als gewollte Senke stehen. */
export const MULDE_KERN_E = 0.5;

/** Der Boden eines Tals ohne Anker und einer Mulde ohne Höhe (Schritt): der Sockel, um das Gewicht eines Nebenkamms gesenkt. */
export function talBoden(kammhoehe: number, talboden: number): number {
    const T = Math.min(0.95, Math.max(0, talboden));
    const ueber = Math.max(GRAT_UEBER_SOCKEL * TAL_GEWICHT, (TAL_GEWICHT - T) / (1 - T));
    return Math.max(0, Math.round(kammhoehe * T * (1 - Math.min(1, ueber))));
}

/**
 * Drückt `h` (Schritt, das Raster `r`) an Tälern und Mulden nach unten und gibt die gewollten Senken zurück (1 auf Talachse und
 * Muldenkern). Ohne Täler und Mulden bleibt `h` unberührt.
 */
export function drueckeSenken(
    r: RueckenRaster,
    h: Float64Array,
    taeler: readonly TalEingabe[],
    mulden: readonly MuldeEingabe[],
    form: Pick<FormRegler, "breite">,
    kammhoehe: number,
    talboden: number,
    saat: number,
): Uint8Array {
    const n = r.w * r.hh;
    const gewollt = new Uint8Array(n);
    if (taeler.length === 0 && mulden.length === 0) return gewollt;
    const boden = talBoden(kammhoehe, talboden);
    const muldenBoden = mulden.map((m) =>
        Number(m.h) >= 0 && m.h !== null && m.h !== undefined ? Number(m.h) : boden,
    );
    // Je Zelle das tiefste Ziel aller Täler und Mulden mit seinem Gewicht: Gedrückt wird mit dem stärksten Zug, nicht mit der Summe.
    const ziel = new Float64Array(n).fill(Infinity);
    const zug = new Float64Array(n);
    const nimm = (k: number, z: number, g: number): void => {
        const alt = zug[k] as number;
        // Der stärkere Zug zählt; bei gleichem Zug das tiefere Ziel.
        if (g > alt || (g === alt && z < (ziel[k] as number))) {
            zug[k] = g;
            ziel[k] = z;
        }
    };
    const breite = Math.max(0.3, form.breite);
    const reichweite = breite * 3.2;
    const muldeAn = muldenAnker(mulden, muldenBoden);

    taeler.forEach((tal, tn) => {
        const punkte = tal.punkte;
        if (punkte.length < 2) return;
        const laenge = talLaengen(punkte);
        const gesamt = laenge.at(-1) ?? 0;
        if (!(gesamt > 0)) return;
        const eigen = talSohle(tal, laenge, muldeAn, boden);
        // Ein Ende mit eigener Höhe läuft nicht aus (WI-0249 P9): Es ist festgelegt wie ein Ende an einer Mulde.
        const ankerA = eigenAn(tal, 0) ?? muldeAn(punkte[0]!);
        const ankerB = eigenAn(tal, punkte.length - 1) ?? muldeAn(punkte.at(-1)!);
        const zA = ankerA ?? boden;
        const zB = ankerB ?? boden;
        const auslauf = Math.min(2, gesamt / 2);
        for (let s = 1; s < punkte.length; s++) {
            const [ax, ay] = punkte[s - 1]!;
            const [bx, by] = punkte[s]!;
            const vx = bx - ax;
            const vy = by - ay;
            const l2 = vx * vx + vy * vy || 1e-9;
            // Breite wechselt entlang des Tals wie bei den Rücken (eigene Lage je Tal).
            const w =
                breite * (0.85 + 0.3 * (0.5 + 0.5 * wertRauschen(saat + 761 + tn, (ax + bx) / 6, (ay + by) / 6, 1)));
            const i0 = Math.max(0, r.i(Math.min(ax, bx) - reichweite));
            const i1 = Math.min(r.w - 1, r.i(Math.max(ax, bx) + reichweite));
            const j0 = Math.max(0, r.j(Math.min(ay, by) - reichweite));
            const j1 = Math.min(r.hh - 1, r.j(Math.max(ay, by) + reichweite));
            for (let j = j0; j <= j1; j++)
                for (let i = i0; i <= i1; i++) {
                    const k = j * r.w + i;
                    if (!r.drin[k]) continue;
                    const px = r.x(i) - ax;
                    const py = r.y(j) - ay;
                    const t = Math.max(0, Math.min(1, (px * vx + py * vy) / l2));
                    const d = Math.hypot(px - t * vx, py - t * vy);
                    if (d > reichweite) continue;
                    const lauf = (laenge[s - 1] as number) + t * Math.sqrt(l2);
                    const vorn = ankerA === null ? Math.min(1, lauf / Math.max(1e-6, auslauf)) : 1;
                    const hinten = ankerB === null ? Math.min(1, (gesamt - lauf) / Math.max(1e-6, auslauf)) : 1;
                    // Ein Tal schneidet als V ein (das spitze Querprofil der Rücken), sonst läse es sich als breite Delle, nicht als Linie.
                    const g = TAL_GEWICHT * Math.pow(Math.max(0, 1 - d / w / 2.6), 1.7) * Math.min(vorn, hinten);
                    if (!(g > 0)) continue;
                    nimm(
                        k,
                        eigen
                            ? (eigen[s - 1] as number) + ((eigen[s] as number) - (eigen[s - 1] as number)) * t
                            : zA + (zB - zA) * (lauf / gesamt),
                        g,
                    );
                    if (d < r.cell * 0.75 && Math.min(vorn, hinten) >= 1) gewollt[k] = 1;
                }
        }
    });

    const radius = NEBENGIPFEL_FORM.radius;
    mulden.forEach((m, mn) => {
        const z = muldenBoden[mn] as number;
        for (let j = Math.max(0, r.j(m.y - radius)); j <= Math.min(r.hh - 1, r.j(m.y + radius)); j++)
            for (let i = Math.max(0, r.i(m.x - radius)); i <= Math.min(r.w - 1, r.i(m.x + radius)); i++) {
                const k = j * r.w + i;
                if (!r.drin[k]) continue;
                const d = Math.hypot(r.x(i) - m.x, r.y(j) - m.y);
                if (d >= radius) continue;
                // Die Schüssel: der Kegel eines Nebengipfels, umgedreht; im Kern ganz auf den Boden.
                nimm(
                    k,
                    z,
                    d <= MULDE_KERN_E ? 1 : Math.pow(1 - ((d - MULDE_KERN_E) / (radius - MULDE_KERN_E)) ** 2, 2),
                );
                if (d <= MULDE_KERN_E) gewollt[k] = 1;
            }
    });

    for (let k = 0; k < n; k++) {
        const g = zug[k] as number;
        if (!(g > 0)) continue;
        const z = ziel[k] as number;
        const v = h[k] as number;
        if (v > z) h[k] = v - g * (v - z);
    }
    return gewollt;
}

/** Der Boden der Mulde an `p` (die nächste unter `KAMM_FANG_E`), sonst `null`. */
function muldenAnker(
    mulden: readonly MuldeEingabe[],
    muldenBoden: readonly number[],
): (p: readonly [number, number]) => number | null {
    return (p) => {
        let best: number | null = null;
        let bd = KAMM_FANG_E;
        mulden.forEach((m, i) => {
            const d = Math.hypot(m.x - p[0], m.y - p[1]);
            if (d < bd) {
                bd = d;
                best = muldenBoden[i] as number;
            }
        });
        return best;
    };
}

/** Die Bogenlänge bis zu jedem Punkt eines Tals (E). */
function talLaengen(punkte: readonly (readonly [number, number])[]): number[] {
    const laenge: number[] = [0];
    for (let s = 1; s < punkte.length; s++)
        laenge.push(
            (laenge[s - 1] as number) +
                Math.hypot(punkte[s]![0] - punkte[s - 1]![0], punkte[s]![1] - punkte[s - 1]![1]),
        );
    return laenge;
}

/** Die eigene Höhe des Stützpunkts `s` (WI-0249 P9), sonst `null`. */
function eigenAn(tal: TalEingabe, s: number): number | null {
    const h = tal.hoehen?.[s];
    return h === null || h === undefined ? null : h;
}

/**
 * Die Talsohle je Stützpunkt eines Tals MIT eigenen Punkthöhen (WI-0249 P9), sonst `null`: Ein Punkt mit eigener Höhe gibt die Sohle genau
 * vor, ein Punkt an einer Mulde deren Boden; dazwischen geht sie über die Bogenlänge linear über, jenseits des letzten festen Punkts bleibt sie
 * auf dessen Höhe. Zwischen zwei Stützpunkten zieht `drueckeSenken` linear (wie ohne Punkthöhen von Ende zu Ende).
 */
function talSohle(
    tal: TalEingabe,
    laenge: readonly number[],
    muldeAn: (p: readonly [number, number]) => number | null,
    boden: number,
): number[] | null {
    if (!tal.hoehen?.some((h) => h !== null && h !== undefined)) return null;
    const n = tal.punkte.length;
    const fest = tal.punkte.map((p, s) => eigenAn(tal, s) ?? muldeAn(p));
    return tal.punkte.map((_, s) => {
        const hier = fest[s];
        if (hier !== null && hier !== undefined) return hier;
        let i = s - 1;
        while (i >= 0 && fest[i] === null) i--;
        let j = s + 1;
        while (j < n && fest[j] === null) j++;
        const hi = i >= 0 ? (fest[i] as number) : null;
        const hj = j < n ? (fest[j] as number) : null;
        if (hi !== null && hj !== null)
            return hi + ((hj - hi) * (laenge[s]! - laenge[i]!)) / Math.max(1e-9, laenge[j]! - laenge[i]!);
        return hi ?? hj ?? boden;
    });
}

/**
 * Die Talsohle an jedem Stützpunkt eines Tals (Schritt, ungerundet), wie `drueckeSenken` sie anzieht: was der Kammeditor an einem Punkt ohne
 * eigene Höhe als Vorgabe zeigt (WI-0249 P9). `boden` ist `talBoden(Kammhöhe, Talboden)`, die Mulden mit ihrem Boden (ohne eigenen: `boden`).
 */
export function talPunktHoehen(tal: TalEingabe, mulden: readonly MuldeEingabe[], boden: number): number[] {
    const muldeAn = muldenAnker(
        mulden,
        mulden.map((m) => (Number(m.h) >= 0 && m.h !== null && m.h !== undefined ? Number(m.h) : boden)),
    );
    const laenge = talLaengen(tal.punkte);
    const gesamt = laenge.at(-1) ?? 0;
    const eigen = talSohle(tal, laenge, muldeAn, boden);
    if (eigen) return eigen;
    const zA = muldeAn(tal.punkte[0]!) ?? boden;
    const zB = muldeAn(tal.punkte.at(-1)!) ?? boden;
    return laenge.map((l) => (gesamt > 0 ? zA + (zB - zA) * (l / gesamt) : zA));
}

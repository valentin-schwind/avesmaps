/**
 * Köpfe der gesetzten Punkte (WI-0249 P2 Schritt 1): Jeder Nebengipfel und jeder kanonische Gipfel wird in der Form des Rückennetzes eine
 * lokale Erhebung mit Prominenz. Ein weicher Formanker, keine zweite Zwangsrechnung neben der Hebung:
 *
 * - **Senken statt Heben:** Liegt das Gelände um einen Punkt höher als ein Kopfprofil (der Punkt, nach außen um `prominenz` bis zum
 *   Sattel in `radius` fallend), senkt es sich auf dieses Profil; tiefer liegendes Gelände bleibt. So bekommt ein Nebengipfel unter dem
 *   Kamm um ihn einen eigenen Kopf mit Sattel zum höheren Kamm, statt Schulter oder Einsenkung zu bleiben (Blutzinnen in der Vorschau: 8
 *   von 18 Nebengipfeln mit Kopf). Hinter dem Sattel läuft die Senkung weich zum Gelände aus: kein Ring, keine Stufe.
 * - **Andere Punkte schützen:** Um jeden anderen gesetzten Punkt läuft die Senkung aus. Ein Kopf drückt keinen Nachbarn zur Nadel; eng
 *   benachbarte Punkte bilden ein Massiv (der niedrigere wird Schulter des höheren, Betreiber 2026-10-23).
 * - **Kein abflussloser Graben:** Wäre der Sattel ringsum höher als das Profil (der Punkt liegt in einer Mulde oder auf einer Hochfläche
 *   über ihm), entstünde ein Graben, den die Senkenfüllung wieder zuschüttete; der Punkt bliebe Einsenkung (Blutzinnen im Plateau-Typ).
 *   Ein Nebengipfel steigt dann so weit, dass sein Sattel auf dem Abfluss liegt. Kanonische Gipfel behalten immer ihre Höhe.
 *
 * Positionen bleiben unverändert (die Zelle des Punkts trägt den Kopf); kanonische Gipfel stehen exakt auf ihrer Höhe.
 */
import { SCHRITT_JE_EINHEIT } from "../constants.ts";
import type { Raster } from "../raster.ts";

/** Ein gesetzter Punkt mit Höhe (Schritt); `fest`: kanonischer Gipfel, Höhe exakt. */
export interface KopfPunkt {
    x: number;
    y: number;
    h: number;
    fest: boolean;
}

/** VORSCHLAG: Abstand vom Punkt bis zum Sattel (E), mindestens zwei Zellen. */
export const KOPF_RADIUS_E = 0.75;
/** VORSCHLAG: Breite, über die die Senkung hinter dem Sattel zum Gelände ausläuft (E), mindestens zwei Zellen. */
export const KOPF_AUSLAUF_E = 0.75;
/** VORSCHLAG: Um einen anderen gesetzten Punkt läuft die Senkung über diese Weite aus (E), mindestens anderthalb Zellen. */
export const KOPF_SCHUTZ_E = 0.5;

/**
 * Der Kegel eines Kopfs (WI-0249 P2, Betreiber 2026-10-24: „die neuen bergspitzen der nebengipfel … sieht mehr aus wie kleine spitzen, das
 * klappt bei normalen gipfeln etwas besser, die ragen wirklich heraus“): mit der Kopfneigung (Typwert `form.kopfNeigung`) bekommt jeder
 * Nebengipfel einen Kegel nach dem Formmodell der kanonischen Gipfel (`summit-shape.ts`: Radius = Höhe / (Neigung · 3.000 Schritt je E),
 * Profil `(1 − u)^1,3`), hier mit der Prominenz als Höhe. Ohne den Wert bleibt der Kopf wie zuvor (Sattel in 0,75 E, Profil `1 − (1 − u)²`).
 */
export interface KopfForm {
    /**
     * Mittlere Neigung des Kopfs vom Punkt zum Sattel (Schritt je Schritt); der Radius folgt aus der Prominenz. Gelände unter dem Kegel
     * hebt sich zu ihm (Sockel), voll bis zur Hälfte des Radius, weich aus bis zum Sattel.
     */
    neigung: number;
}
/** VORSCHLAG: Profil des Kegels wie die kanonischen Gipfel (`alpine.summit.profile` 1,15 bis 1,45). */
export const KOPF_PROFIL = 1.3;
/** VORSCHLAG: Größter Kopfradius (E): Ein sehr flacher Kopf reicht nicht über ein ganzes Gebirge. */
export const KOPF_RADIUS_MAX_E = 2;

/** Radius des Kegels (E) aus Prominenz (Schritt) und Kopfneigung, wie der Radius eines kanonischen Gipfels aus Höhe und Neigung. */
export function kopfRadius(prominenz: number, neigung: number): number {
    return Math.min(
        KOPF_RADIUS_MAX_E,
        Math.max(KOPF_RADIUS_E, prominenz / (Math.max(1e-6, neigung) * SCHRITT_JE_EINHEIT)),
    );
}

/**
 * Die Höhe des Kegels über seinem Sattel (Schritt), die die Steilheit verlangt (WI-0249 P9, Betreiber 2026-10-25: „die nebengipfel sehen aus wie
 * tafelberge … ich krieg nicht mehr hin, dass berge spitz sind“). Bis zur Neigung, bei der der Radius die Untergrenze `KOPF_RADIUS_E` erreicht
 * (bei 230 Schritt Prominenz 0,10), bleibt es die Prominenz des Typs, und die Steilheit stellt den Radius, wie zuvor (Zeichen für Zeichen
 * gleich). Jenseits davon änderte sie früher nichts mehr: Der Radius blieb bei `KOPF_RADIUS_E`, die Kegel flach. Jetzt steigt dort die Höhe des
 * Kegels, sodass seine mittlere Neigung die gestellte ist (Radius `KOPF_RADIUS_E`, Höhe = Neigung · Radius · 3.000 Schritt je E).
 */
export function kegelProminenz(prominenz: number, neigung: number): number {
    if (!(prominenz > 0) || !(neigung > 0)) return prominenz;
    const radius = prominenz / (neigung * SCHRITT_JE_EINHEIT);
    return radius >= KOPF_RADIUS_E ? prominenz : neigung * KOPF_RADIUS_E * SCHRITT_JE_EINHEIT;
}

const glatt = (t: number): number => {
    const u = Math.max(0, Math.min(1, t));
    return u * u * (3 - 2 * u);
};
/** Kopfprofil 0 am Punkt bis 1 am Sattel: oben spitz (Kegel), am Sattel flach. */
const spitz = (t: number): number => {
    const u = Math.max(0, Math.min(1, t));
    return 1 - (1 - u) * (1 - u);
};
/** Kegelprofil der kanonischen Gipfel: `1 − (1 − u)^KOPF_PROFIL`. */
const kegel = (t: number): number => 1 - Math.pow(1 - Math.max(0, Math.min(1, t)), KOPF_PROFIL);

interface Anker {
    k: number;
    x: number;
    y: number;
    h: number;
    fest: boolean;
}

/**
 * Formt die Köpfe in `h` (Schritt, Raster der Rechnung). `prominenz` in Schritt; ≤ 0 lässt alles unverändert. Gibt die wirksame Höhe je
 * Punkt zurück (ein Nebengipfel über einer Mulde steigt, sonst seine Höhe).
 */
export function formeKoepfe(
    r: Raster,
    h: Float64Array,
    punkte: readonly KopfPunkt[],
    prominenzBasis: number,
    /** Kegel nach dem Formmodell der kanonischen Gipfel (`KopfForm`); ohne ihn der Kopf wie zuvor. */
    form?: KopfForm,
): number[] {
    const hoehen = punkte.map((p) => p.h);
    if (!(prominenzBasis > 0) || punkte.length === 0) return hoehen;
    const mitKegel = form !== undefined && form.neigung > 0;
    const prominenz = mitKegel ? kegelProminenz(prominenzBasis, form.neigung) : prominenzBasis;
    const radius = Math.max(mitKegel ? kopfRadius(prominenzBasis, form.neigung) : KOPF_RADIUS_E, 2 * r.cell);
    const profil = mitKegel ? kegel : spitz;
    const auslauf = Math.max(KOPF_AUSLAUF_E, 2 * r.cell);
    const schutz = Math.max(KOPF_SCHUTZ_E, 1.5 * r.cell);
    const reich = radius + auslauf;
    // Je Zelle ein Anker mit der Zielhöhe des Punkts, nicht der Höhe, die dort steht: `setzeGipfel` setzt die kanonischen Gipfel nach den
    // Nebengipfeln und verschiebt einen Nebengipfel bis 5 E daneben mit (P3: bis +36 Schritt). Ein kanonischer Gipfel gewinnt die Zelle.
    const anker = new Map<number, Anker>();
    const ankerVon: (Anker | null)[] = punkte.map((p) => {
        const i = r.i(p.x);
        const j = r.j(p.y);
        if (i < 0 || j < 0 || i >= r.w || j >= r.hh || !r.drin[j * r.w + i]) return null;
        const k = j * r.w + i;
        const da = anker.get(k);
        if (da === undefined) {
            const a: Anker = { k, x: r.x(i), y: r.y(j), h: p.h, fest: p.fest };
            anker.set(k, a);
            return a;
        }
        // Dieselbe Zelle: Der spätere Punkt gilt wie bei `sichereGipfel`, ein kanonischer Gipfel vor jedem Nebengipfel.
        if (p.fest || !da.fest) {
            da.h = p.h;
            da.fest ||= p.fest;
        }
        return da;
    });
    const alle = [...anker.values()];
    // Mulden-Prüfung je Nebengipfel (vor jeder Senkung): auf 16 Strahlen ab dem Sattel der höchste Punkt bis hinter den Auslauf; der
    // niedrigste dieser Ränder ist der Abfluss. Ein Strahl, der die Fläche verlässt, ist offen.
    const strahlRand = (a: Anker, wx: number, wy: number): number => {
        let rand = -Infinity;
        for (let d = radius; d <= reich + 0.5; d += r.cell / 2) {
            const i = r.i(a.x + wx * d);
            const j = r.j(a.y + wy * d);
            if (i < 0 || j < 0 || i >= r.w || j >= r.hh || !r.drin[j * r.w + i]) break;
            rand = Math.max(rand, h[j * r.w + i] as number);
        }
        return rand;
    };
    const wirksam = new Map<Anker, number>();
    for (const a of alle) {
        let abfluss = Infinity;
        for (let s = 0; s < 16; s++)
            abfluss = Math.min(abfluss, strahlRand(a, Math.cos((s * Math.PI) / 8), Math.sin((s * Math.PI) / 8)));
        // Die Mulden-Prüfung mit der Prominenz des Typs, nicht mit der gehobenen des steilen Kegels: Die Erhebung rund um den Punkt (`setzeGipfel`)
        // liegt schon nahe an seiner Höhe, eine höhere Prominenz hielte sie für eine Mulde und höbe den Punkt über seine eigene Höhe.
        wirksam.set(a, !a.fest && abfluss > a.h - prominenzBasis ? abfluss + prominenzBasis : a.h);
    }
    const senkung = new Float32Array(r.w * r.hh);
    const beruehrt: number[] = [];
    for (const a of alle) {
        const ziel = wirksam.get(a)!;
        const nachbarn = alle.filter((b) => b !== a && Math.hypot(b.x - a.x, b.y - a.y) < reich + schutz);
        const i0 = Math.max(0, r.i(a.x - reich));
        const i1 = Math.min(r.w - 1, r.i(a.x + reich));
        const j0 = Math.max(0, r.j(a.y - reich));
        const j1 = Math.min(r.hh - 1, r.j(a.y + reich));
        for (let j = j0; j <= j1; j++)
            for (let i = i0; i <= i1; i++) {
                const k = j * r.w + i;
                if (!r.drin[k] || k === a.k) continue;
                const d = Math.hypot(r.x(i) - a.x, r.y(j) - a.y);
                if (d >= reich) continue;
                const deckel = ziel - prominenz * profil(d / radius);
                const ueber = (h[k] as number) - deckel;
                if (!(ueber > 0)) continue;
                let gewicht = 1 - glatt((d - radius) / auslauf);
                for (const b of nachbarn) gewicht *= glatt(Math.hypot(r.x(i) - b.x, r.y(j) - b.y) / schutz);
                const s = gewicht * ueber;
                if (s > (senkung[k] as number)) {
                    if (senkung[k] === 0) beruehrt.push(k);
                    senkung[k] = s;
                }
            }
    }
    for (const k of beruehrt) h[k] = Math.max(0, (h[k] as number) - (senkung[k] as number));
    // Sockel (mit Kegel): Gelände unter dem Kegel eines Nebengipfels hebt sich zu ihm, voll bis zur Hälfte des Radius, weich aus bis zum
    // Sattel; um andere Punkte nicht (sie bleiben, wie sie sind). So steht der Kopf mit eigenem Körper auf dem Kamm statt als Spitze.
    if (mitKegel)
        for (const a of alle) {
            if (a.fest) continue;
            const ziel = wirksam.get(a)!;
            const nachbarn = alle.filter((b) => b !== a && Math.hypot(b.x - a.x, b.y - a.y) < radius + schutz);
            for (let j = Math.max(0, r.j(a.y - radius)); j <= Math.min(r.hh - 1, r.j(a.y + radius)); j++)
                for (let i = Math.max(0, r.i(a.x - radius)); i <= Math.min(r.w - 1, r.i(a.x + radius)); i++) {
                    const k = j * r.w + i;
                    if (!r.drin[k] || anker.has(k)) continue;
                    const d = Math.hypot(r.x(i) - a.x, r.y(j) - a.y);
                    if (d >= radius) continue;
                    const kegelHoehe = ziel - prominenz * profil(d / radius);
                    const unter = kegelHoehe - (h[k] as number);
                    if (!(unter > 0)) continue;
                    let gewicht = 1 - glatt((d / radius - 0.5) / 0.5);
                    for (const b of nachbarn) gewicht *= glatt(Math.hypot(r.x(i) - b.x, r.y(j) - b.y) / schutz);
                    h[k] = (h[k] as number) + gewicht * unter;
                }
        }
    // Ein gestiegener Nebengipfel bekommt seinen Kopf über dem Gelände (nur heben, im Radius bis zum Sattel).
    for (const a of alle) {
        const ziel = wirksam.get(a)!;
        if (ziel > a.h)
            for (let j = Math.max(0, r.j(a.y - radius)); j <= Math.min(r.hh - 1, r.j(a.y + radius)); j++)
                for (let i = Math.max(0, r.i(a.x - radius)); i <= Math.min(r.w - 1, r.i(a.x + radius)); i++) {
                    const k = j * r.w + i;
                    if (!r.drin[k] || (k !== a.k && anker.has(k))) continue;
                    const d = Math.hypot(r.x(i) - a.x, r.y(j) - a.y);
                    if (d >= radius) continue;
                    h[k] = Math.max(h[k] as number, ziel - prominenz * profil(d / radius));
                }
        h[a.k] = ziel;
    }
    return ankerVon.map((a, n) => (a === null ? (hoehen[n] as number) : wirksam.get(a)!));
}

import { SEA, type Grid } from "../hydrology/grid.ts";
import { fillArea, type AreaGeometry } from "../hydrology/water.ts";

/**
 * Die Naht zwischen zwei angedockten Flächen (OPS-000089, Vali 2026-11-07: „An gemeinsamen Grenzen fällt nichts mehr ab. „docken“ zwei gebirge aneinander an, soll es so
 * aussehen als ob die gebirge zusammengehören.“).
 *
 * Seit jedes Gebirge an einer gemeinsamen Grenze nicht mehr ausläuft (`andock`, `gebirge/raster.ts`), stehen dort zwei fertige Flächen nebeneinander, jede mit eigener Höhe. Hier
 * treffen sie sich: An jeder Zelle der Naht fehlt `T − h`, und die Korrektur blendet über `breite` nach innen aus. So bleibt das Muster beider Flächen, nur angehoben oder gesenkt.
 *
 * - **Das Ziel `T`** ist die Mitte beider Seiten. An einer Hochebene (`bFest`) ist es ihre Höhe: Sie behält sie, das Gebirge passt sich an.
 * - **Zwei Durchgänge:** Der erste glättet die Fehlbeträge entlang der Naht (ein Grat, der die Naht kreuzt, bekäme sonst eine eigene Beule) und blendet über die volle Breite aus; der
 *   zweite nimmt den Rest ungeglättet über eine schmale Breite, damit keine Stufe bleibt.
 * - **Nur Land:** Zellen im Meer bleiben. Wo sich zwei Flächen überlappen, ist die Zelle die von `a`, und nur Zellen, die an die andere Seite grenzen, sind Naht.
 */

export interface GebirgsNaht {
    readonly a: AreaGeometry;
    readonly b: AreaGeometry;
    /** `b` ist eine Hochebene: Sie behält ihre Höhe. */
    readonly bFest: boolean;
}

/** VORSCHLAG: Über so viele E glättet der erste Durchgang die Fehlbeträge entlang der Naht, und über so viele läuft der zweite aus. */
export const NAHT_GLAETTUNG_E = 1;

const NACHBARN = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
] as const;

interface Fenster {
    x0: number;
    y0: number;
    w: number;
    h: number;
}

const glatt = (t: number): number => t * t * (3 - 2 * t);

/** Kastenfilter über beide Richtungen, gleitend; `radius` 0 lässt das Feld. */
function kasten(feld: Float32Array, w: number, h: number, radius: number): void {
    if (radius <= 0) return;
    const zeile = new Float32Array(Math.max(w, h));
    for (let y = 0; y < h; y += 1) {
        let summe = 0;
        for (let x = -radius; x < w; x += 1) {
            if (x + radius < w) summe += feld[y * w + x + radius]!;
            if (x - radius - 1 >= 0) summe -= zeile[x - radius - 1]!;
            if (x >= 0) zeile[x] = feld[y * w + x]!;
            if (x >= 0) feld[y * w + x] = summe;
        }
    }
    for (let x = 0; x < w; x += 1) {
        let summe = 0;
        for (let y = -radius; y < h; y += 1) {
            if (y + radius < h) summe += feld[(y + radius) * w + x]!;
            if (y - radius - 1 >= 0) summe -= zeile[y - radius - 1]!;
            if (y >= 0) zeile[y] = feld[y * w + x]!;
            if (y >= 0) feld[y * w + x] = summe;
        }
    }
}

/** Ein Durchgang: Fehlbeträge an der Naht, entlang der Naht geglättet, nach innen ausgeblendet. */
function durchgang(
    g: Grid,
    height: Float32Array,
    classes: Uint8Array,
    marke: Uint8Array,
    paare: readonly (readonly [number, number])[],
    bFest: boolean,
    glaettung: number,
    breite: number,
): number {
    const n = g.n;
    const reichweite = Math.max(1, Math.round(breite / g.cell));
    const radius = Math.round(glaettung / g.cell);
    let x0 = n;
    let y0 = n;
    let x1 = -1;
    let y1 = -1;
    for (const paar of paare)
        for (const k of paar) {
            const x = k % n;
            const y = Math.floor(k / n);
            if (x < x0) x0 = x;
            if (x > x1) x1 = x;
            if (y < y0) y0 = y;
            if (y > y1) y1 = y;
        }
    const f: Fenster = {
        x0: Math.max(0, x0 - reichweite - radius - 1),
        y0: Math.max(0, y0 - reichweite - radius - 1),
        w: 0,
        h: 0,
    };
    f.w = Math.min(n - 1, x1 + reichweite + radius + 1) - f.x0 + 1;
    f.h = Math.min(n - 1, y1 + reichweite + radius + 1) - f.y0 + 1;
    const stelle = (k: number): number => (Math.floor(k / n) - f.y0) * f.w + ((k % n) - f.x0);
    const zahl = f.w * f.h;
    // 🔴 Die Fehlbeträge beider Seiten vor der ersten Korrektur: Sonst misst die zweite Seite an der schon gehobenen ersten.
    const fehlA = new Float32Array(paare.length);
    const fehlB = new Float32Array(paare.length);
    paare.forEach(([a, b], p) => {
        const ziel = bFest ? height[b]! : (height[a]! + height[b]!) / 2;
        fehlA[p] = ziel - height[a]!;
        fehlB[p] = ziel - height[b]!;
    });
    // Je Seite (1 = a, 2 = b) Summe und Zahl der Fehlbeträge.
    let geaendert = 0;
    for (const seite of bFest ? [1] : [1, 2]) {
        const summe = new Float32Array(zahl);
        const menge = new Float32Array(zahl);
        paare.forEach(([a, b], p) => {
            const i = stelle(seite === 1 ? a : b);
            summe[i]! += seite === 1 ? fehlA[p]! : fehlB[p]!;
            menge[i]! += 1;
        });
        const naht = new Uint8Array(zahl);
        for (let i = 0; i < zahl; i += 1) if (menge[i]! > 0) naht[i] = 1;
        kasten(summe, f.w, f.h, radius);
        kasten(menge, f.w, f.h, radius);
        // Ausbreiten: Jede Zelle dieser Seite übernimmt den Fehlbetrag der nächsten Nahtzelle.
        const quelle = new Int32Array(zahl).fill(-1);
        const schlange = new Int32Array(zahl);
        let ende = 0;
        for (let i = 0; i < zahl; i += 1)
            if (naht[i]) {
                quelle[i] = i;
                schlange[ende++] = i;
            }
        for (let kopf = 0; kopf < ende; kopf += 1) {
            const i = schlange[kopf]!;
            const x = i % f.w;
            const y = Math.floor(i / f.w);
            const q = quelle[i]!;
            const qx = q % f.w;
            const qy = Math.floor(q / f.w);
            const k = (y + f.y0) * n + x + f.x0;
            const weg = Math.hypot(x - qx, y - qy);
            if (!(classes[k]! & SEA)) {
                const anteil = 1 - glatt(Math.min(1, weg / reichweite));
                const korrektur = (summe[q]! / Math.max(1, menge[q]!)) * anteil;
                if (korrektur !== 0) {
                    height[k]! += korrektur;
                    geaendert += 1;
                }
            }
            for (const [dx, dy] of NACHBARN) {
                const nx = x + dx;
                const ny = y + dy;
                if (nx < 0 || ny < 0 || nx >= f.w || ny >= f.h) continue;
                const ni = ny * f.w + nx;
                if (quelle[ni] !== -1) continue;
                if (marke[(ny + f.y0) * n + nx + f.x0] !== seite) continue;
                if (Math.hypot(nx - qx, ny - qy) > reichweite) continue;
                quelle[ni] = q;
                schlange[ende++] = ni;
            }
        }
    }
    return geaendert;
}

/** Gleicht die Höhe aller Nähte an (`height` und `classes` im Gitter, Zeile 0 im Norden); gibt die Zahl der geänderten Zellen zurück. */
export function gleicheNaehteAn(
    g: Grid,
    height: Float32Array,
    classes: Uint8Array,
    naehte: readonly GebirgsNaht[],
    breite: number,
): number {
    const n = g.n;
    const marke = new Uint8Array(n * n);
    let geaendert = 0;
    for (const naht of naehte) {
        fillArea(g, naht.a, (k) => {
            marke[k] = 1;
        });
        const paare: (readonly [number, number])[] = [];
        fillArea(g, naht.b, (k) => {
            if (marke[k] !== 1) marke[k] = 2;
        });
        fillArea(g, naht.b, (k) => {
            if (marke[k] !== 2 || classes[k]! & SEA) return;
            const x = k % n;
            const y = Math.floor(k / n);
            for (const [dx, dy] of NACHBARN.slice(0, 4)) {
                const nx = x + dx!;
                const ny = y + dy!;
                if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
                const a = ny * n + nx;
                if (marke[a] === 1 && !(classes[a]! & SEA)) paare.push([a, k]);
            }
        });
        if (paare.length > 0) {
            geaendert += durchgang(g, height, classes, marke, paare, naht.bFest, NAHT_GLAETTUNG_E, breite);
            geaendert += durchgang(g, height, classes, marke, paare, naht.bFest, 0, NAHT_GLAETTUNG_E);
        }
        fillArea(g, naht.a, (k) => {
            marke[k] = 0;
        });
        fillArea(g, naht.b, (k) => {
            marke[k] = 0;
        });
    }
    return geaendert;
}

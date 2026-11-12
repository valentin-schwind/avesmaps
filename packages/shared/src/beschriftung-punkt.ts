/**
 * Der Punkt, an den „Position zurücksetzen“ eine Beschriftung legt (WI-0232): der Point of Inaccessibility ihrer Fläche, also der Punkt
 * mit dem größten Abstand zu allen Kanten (Owner 25.08.2026 in Legacy, wörtlich: „dass es an den point of inaccesiblity zurückverschoben
 * wird“). Wie Legacys `avesmapsComputeLabelPoint` (Mirror a7f2dac8, `js/third-party/polylabel.js#L162-L184`): je Polygon der Punkt nach
 * dem Verfahren von polylabel (Gitter, Zellen nach ihrem größten möglichen Abstand, verfeinert bis zur Genauigkeit), bei mehreren Teilen
 * der mit dem größten Abstand. Koordinaten in Karteneinheiten (MCS `aventuria-v1`), Ringe als GeoJSON-Ringe.
 *
 * Reine Rechnung ohne Karte: der Browser legt mit ihr die Beschriftung in den Entwurf, die Tests prüfen sie allein.
 */

export type Ring = readonly (readonly [number, number])[];
/** Außenring, danach die Löcher. */
export type PolygonRinge = readonly Ring[];

/** Legacys Genauigkeit (`polylabel(rings, 1.0)`), in Karteneinheiten. */
export const BESCHRIFTUNG_PUNKT_GENAUIGKEIT = 1;

export interface BeschriftungsPunkt {
    x: number;
    y: number;
    /** Abstand zur nächsten Kante. */
    abstand: number;
}

/** Abstand eines Punkts zum Rand des Polygons, positiv innen, negativ außen. */
function vorzeichenAbstand(x: number, y: number, ringe: PolygonRinge): number {
    let innen = false;
    let quadrat = Infinity;
    for (const ring of ringe) {
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
            const [ax, ay] = ring[i]!;
            const [bx, by] = ring[j]!;
            if (ay > y !== by > y && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) innen = !innen;
            quadrat = Math.min(quadrat, streckenAbstandQuadrat(x, y, ax, ay, bx, by));
        }
    }
    return (innen ? 1 : -1) * Math.sqrt(quadrat);
}

function streckenAbstandQuadrat(x: number, y: number, ax: number, ay: number, bx: number, by: number): number {
    let px = ax;
    let py = ay;
    const dx = bx - ax;
    const dy = by - ay;
    if (dx !== 0 || dy !== 0) {
        const t = ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy);
        if (t > 1) {
            px = bx;
            py = by;
        } else if (t > 0) {
            px += dx * t;
            py += dy * t;
        }
    }
    return (x - px) ** 2 + (y - py) ** 2;
}

interface Zelle {
    x: number;
    y: number;
    /** Halbe Kantenlänge. */
    h: number;
    /** Abstand der Mitte zum Rand. */
    d: number;
    /** Größter Abstand, den ein Punkt der Zelle haben kann. */
    max: number;
}

const zelle = (x: number, y: number, h: number, ringe: PolygonRinge): Zelle => {
    const d = vorzeichenAbstand(x, y, ringe);
    return { x, y, h, d, max: d + h * Math.SQRT2 };
};

/** Ein Haufen nach `max`, größte zuerst. */
class Haufen {
    private readonly daten: Zelle[] = [];
    get laenge(): number {
        return this.daten.length;
    }
    hinein(z: Zelle): void {
        const d = this.daten;
        d.push(z);
        let i = d.length - 1;
        while (i > 0) {
            const eltern = (i - 1) >> 1;
            if (d[eltern]!.max >= d[i]!.max) break;
            [d[eltern], d[i]] = [d[i]!, d[eltern]!];
            i = eltern;
        }
    }
    heraus(): Zelle {
        const d = this.daten;
        const oben = d[0]!;
        const letzte = d.pop()!;
        if (d.length > 0) {
            d[0] = letzte;
            let i = 0;
            for (;;) {
                const l = 2 * i + 1;
                const r = l + 1;
                let groesste = i;
                if (l < d.length && d[l]!.max > d[groesste]!.max) groesste = l;
                if (r < d.length && d[r]!.max > d[groesste]!.max) groesste = r;
                if (groesste === i) break;
                [d[groesste], d[i]] = [d[i]!, d[groesste]!];
                i = groesste;
            }
        }
        return oben;
    }
}

/** Der Schwerpunkt des Außenrings als erste Schätzung (wie polylabel); bei Fläche null der erste Punkt. */
function schwerpunktZelle(ringe: PolygonRinge): Zelle {
    const ring = ringe[0]!;
    let flaeche = 0;
    let x = 0;
    let y = 0;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [ax, ay] = ring[i]!;
        const [bx, by] = ring[j]!;
        const f = ax * by - bx * ay;
        x += (ax + bx) * f;
        y += (ay + by) * f;
        flaeche += f * 3;
    }
    if (flaeche === 0) return zelle(ring[0]![0], ring[0]![1], 0, ringe);
    return zelle(x / flaeche, y / flaeche, 0, ringe);
}

/** Der Point of Inaccessibility EINES Polygons; `null` ohne brauchbaren Außenring. */
export function polygonPunkt(
    ringe: PolygonRinge,
    genauigkeit: number = BESCHRIFTUNG_PUNKT_GENAUIGKEIT,
): BeschriftungsPunkt | null {
    const aussen = ringe[0];
    if (aussen === undefined || aussen.length < 3) return null;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const [x, y] of aussen) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
    }
    const breite = maxX - minX;
    const hoehe = maxY - minY;
    const kante = Math.min(breite, hoehe);
    if (!Number.isFinite(kante)) return null;
    if (kante === 0) return { x: minX, y: minY, abstand: 0 };
    let h = kante / 2;
    const schlange = new Haufen();
    for (let x = minX; x < maxX; x += kante) {
        for (let y = minY; y < maxY; y += kante) schlange.hinein(zelle(x + h, y + h, h, ringe));
    }
    let beste = schwerpunktZelle(ringe);
    const mitte = zelle(minX + breite / 2, minY + hoehe / 2, 0, ringe);
    if (mitte.d > beste.d) beste = mitte;
    while (schlange.laenge > 0) {
        const z = schlange.heraus();
        if (z.d > beste.d) beste = z;
        if (z.max - beste.d <= genauigkeit) continue;
        h = z.h / 2;
        schlange.hinein(zelle(z.x - h, z.y - h, h, ringe));
        schlange.hinein(zelle(z.x + h, z.y - h, h, ringe));
        schlange.hinein(zelle(z.x - h, z.y + h, h, ringe));
        schlange.hinein(zelle(z.x + h, z.y + h, h, ringe));
    }
    return { x: beste.x, y: beste.y, abstand: beste.d };
}

/** Der Punkt einer Fläche aus einem oder mehreren Polygonen: der Teil mit dem größten Abstand gewinnt (wie Legacy). */
export function beschriftungsPunkt(
    polygone: readonly PolygonRinge[],
    genauigkeit: number = BESCHRIFTUNG_PUNKT_GENAUIGKEIT,
): BeschriftungsPunkt | null {
    let beste: BeschriftungsPunkt | null = null;
    for (const ringe of polygone) {
        const p = polygonPunkt(ringe, genauigkeit);
        if (p !== null && (beste === null || p.abstand > beste.abstand)) beste = p;
    }
    return beste;
}

/**
 * Der freie Platz am Zielpunkt (Legacys `avesmapsLabelZurueckFreierPunkt`, `map-features-labels.js#L2055-L2075`): der Punkt selbst,
 * solange keine andere Beschriftung derselben Fläche näher als `schritt` liegt, sonst je ein Schritt nach rechts unten. Gedeckelt wie
 * dort: n Nachbarn lassen von 2n + 1 Kandidaten mindestens einen frei. Die Einheit wählt der Aufrufer (Legacy: 20 Bildschirmpixel).
 * `richtung` ist „rechts unten“ in den Achsen des Aufrufers: in Karteneinheiten (y wächst nach Norden) `[1, -1]`.
 */
export function freierPunkt(
    ziel: readonly [number, number],
    belegte: readonly (readonly [number, number])[],
    schritt: number,
    richtung: readonly [number, number] = [1, 1],
): [number, number] {
    for (let n = 0; n <= belegte.length * 2; n += 1) {
        const kandidat: [number, number] = [ziel[0] + n * schritt * richtung[0], ziel[1] + n * schritt * richtung[1]];
        if (!belegte.some(([x, y]) => Math.hypot(x - kandidat[0], y - kandidat[1]) < schritt)) return kandidat;
    }
    return [ziel[0], ziel[1]];
}

/**
 * Die Geometrie des SVG-Abzugs (WI-0280 K2), Portierung aus Legacys `js/pages/svg-export-build.js`.
 *
 * 🔴 KOORDINATEN. Die Karte (`aventuria-v1`, `config/map-domains/aventuria.json`) misst 0…1024 in beiden Achsen, x nach Osten, y nach
 * NORDEN. Legacy speichert und liefert dieselben Zahlen unverändert (der Ortsimport rührt sie nicht an: Gareth liegt in beiden bei
 * 551,625 / 532,969). Ein SVG zählt y nach UNTEN, also gilt für jeden Punkt
 *
 *     x_svg = x          y_svg = 1024 − y          (viewBox „0 0 1024 1024“, je zwei Nachkommastellen)
 *
 * Ohne die Spiegelung stünde die Karte auf dem Kopf, und das sieht man einer großen Datei nicht an, bevor sie in einem Programm
 * offen ist. Die Größe steht in `width`/`height`; bei 32768 Bildpunkten ist eine Einheit 32 Bildpunkte, und das ist genau das Raster
 * der Kartenserien (`sourcePixels` 32768): Bildpunkt (x · 32, (1024 − y) · 32) von oben links. Die Rechnung am Ort steht im Bericht
 * zu WI-0280 K2 und in `karten-svg.test.ts` (Gareth, Punin).
 *
 * 🔴 DIE GLÄTTUNG IST EXAKT, nicht genähert. Ein Catmull-Rom-Segment IST eine kubische Bézierkurve; die Karte tastet es mit 8 Punkten
 * ab (`LEGACY_CATMULL`, `packages/shared/src/catmull-rom.ts`), hier steht dieselbe Kurve als `C`. Umrechnung Hermite → Bézier mit
 * der Tangente `m = (nächster − vorheriger) × Spannung`: `C1 = P1 + m1/3`, `C2 = P2 − m2/3`. Bei einer offenen Linie behalten
 * erster und letzter Punkt ihren Nachbarn als eigenen Nachbarn (die Endpunkte wandern nicht), bei einem Ring ist der Nachbar des
 * ersten Punktes der LETZTE: sonst bekäme die Fläche an ihrem willkürlichen Startpunkt eine Ecke.
 *
 * Nur `M`, `L`, `C` und `Z`, immer absolut. Das ist eine Zusage der Übergabe (`docs/svg-export-semantik-uebergabe.md`).
 */

/** Ein Kartenpunkt `[x, y]` in `aventuria-v1` (y nach Norden). */
export type Punkt = readonly [number, number];
/** Ein geschlossener Ring; der erste Punkt darf am Ende wiederholt sein (GeoJSON). */
export type Ring = readonly Punkt[];
/** Ein Polygon: Außenring zuerst, JEDER weitere Ring ist ein Loch. */
export type Teilflaeche = readonly Ring[];
/** Eine Fläche aus einem (Polygon) oder mehreren Polygonen (MultiPolygon). */
export type Flaeche = readonly Teilflaeche[];

/** Die Kantenlänge des Zeichenraums. */
export const ZEICHENRAUM = 1024;

interface SvgPunkt {
    x: number;
    y: number;
}

/** Auf zwei Nachkommastellen: bei 1024 Einheiten Kantenlänge ein Hundertstel Bildpunkt. */
export function rund(zahl: number): number {
    return Math.round(zahl * 100) / 100;
}

/** Der Kartenpunkt im Zeichenraum: y gespiegelt, auf zwei Stellen gerundet. */
export function svgPunkt(x: number, y: number): SvgPunkt {
    return { x: rund(x), y: rund(ZEICHENRAUM - y) };
}

function glatterAbschnitt(p0: SvgPunkt, p1: SvgPunkt, p2: SvgPunkt, p3: SvgPunkt, spannung: number): string {
    const c1x = p1.x + ((p2.x - p0.x) * spannung) / 3;
    const c1y = p1.y + ((p2.y - p0.y) * spannung) / 3;
    const c2x = p2.x - ((p3.x - p1.x) * spannung) / 3;
    const c2y = p2.y - ((p3.y - p1.y) * spannung) / 3;
    return `C${rund(c1x)} ${rund(c1y)} ${rund(c2x)} ${rund(c2y)} ${p2.x} ${p2.y}`;
}

/** Eine offene Linie als Bézierkurve. Weniger als zwei Punkte ergeben nichts. */
function glatteLinie(punkte: readonly SvgPunkt[], spannung: number): string {
    if (punkte.length < 2) return "";
    const bei = (index: number): SvgPunkt => punkte[Math.max(0, Math.min(punkte.length - 1, index))] as SvgPunkt;
    const stuecke = [`M${(punkte[0] as SvgPunkt).x} ${(punkte[0] as SvgPunkt).y}`];
    for (let index = 0; index < punkte.length - 1; index += 1) {
        stuecke.push(glatterAbschnitt(bei(index - 1), bei(index), bei(index + 1), bei(index + 2), spannung));
    }
    return stuecke.join("");
}

/**
 * Die Pfaddaten einer Linie: `M`/`L` oder, geglättet, `M`/`C`. Leer bei einer Linie ohne Punkt.
 * Ein einzelner Punkt ist ein `M` allein, auch geglättet.
 */
export function linienDaten(koordinaten: readonly Punkt[], glatt: boolean, spannung: number): string {
    const punkte = koordinaten.map(([x, y]) => svgPunkt(x, y));
    if (punkte.length === 0) return "";
    if (glatt && punkte.length >= 2) return glatteLinie(punkte, spannung);
    return punkte.map((punkt, index) => `${index === 0 ? "M" : "L"}${punkt.x} ${punkt.y}`).join("");
}

/**
 * Ein geschlossener Ring als umlaufende Bézierkurve. Der wiederholte Schlusspunkt wird vorher entfernt, sonst entstünde dort ein
 * Nullsegment und mit ihm eine Delle. Unter drei verschiedenen Punkten ist eine Rundung sinnlos: leer, der Aufrufer fällt auf
 * den Polygonzug zurück.
 */
function glatterRing(punkte: readonly SvgPunkt[], spannung: number): string {
    let ring = punkte;
    if (ring.length > 1) {
        const erster = ring[0] as SvgPunkt;
        const letzter = ring[ring.length - 1] as SvgPunkt;
        if (erster.x === letzter.x && erster.y === letzter.y) ring = ring.slice(0, -1);
    }
    if (ring.length < 3) return "";
    const anzahl = ring.length;
    const um = (index: number): SvgPunkt => ring[((index % anzahl) + anzahl) % anzahl] as SvgPunkt;
    const stuecke = [`M${um(0).x} ${um(0).y}`];
    for (let index = 0; index < anzahl; index += 1) {
        stuecke.push(glatterAbschnitt(um(index - 1), um(index), um(index + 1), um(index + 2), spannung));
    }
    return `${stuecke.join("")}Z`;
}

/** Die Pfaddaten eines Rings, mit `Z`. Leer bei einem Ring ohne Punkt. */
export function ringDaten(ring: Ring, glatt: boolean, spannung: number): string {
    if (glatt) {
        const kurve = glatterRing(
            ring.map(([x, y]) => svgPunkt(x, y)),
            spannung,
        );
        if (kurve) return kurve;
    }
    const daten = linienDaten(ring, false, spannung);
    return daten ? `${daten}Z` : "";
}

/**
 * Die Pfaddaten einer Fläche. 💣 Der erste Ring eines Polygons ist der Außenrand, JEDER weitere ein LOCH. Wer nur den ersten
 * zeichnet, füllt Binnenseen zu, und die Karte sieht dabei richtig aus; `fill-rule="evenodd"` an der Gruppe macht aus dem zweiten
 * Ring das Loch.
 */
export function flaechenDaten(flaeche: Flaeche, glatt: boolean, spannung: number): string {
    return flaeche
        .map((teil) =>
            teil
                .map((ring) => ringDaten(ring, glatt, spannung))
                .filter(Boolean)
                .join(""),
        )
        .filter(Boolean)
        .join("");
}

/** Strahlensatz-Test, die Standardform. */
function punktImRing(x: number, y: number, ring: Ring): boolean {
    let innen = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
        const [xi, yi] = ring[i] as Punkt;
        const [xj, yj] = ring[j] as Punkt;
        if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) innen = !innen;
    }
    return innen;
}

/**
 * Liegt der Punkt in der Fläche? 💣 Löcher zählen: Ein Punkt im Binnensee eines Kontinents liegt NICHT im Kontinent. Wer nur den
 * Außenring prüft, ordnet jede Insel im See der Landmasse zu.
 */
export function punktInFlaeche(x: number, y: number, flaeche: Flaeche): boolean {
    for (const teil of flaeche) {
        const aussen = teil[0];
        if (!aussen || !punktImRing(x, y, aussen)) continue;
        let imLoch = false;
        for (let index = 1; index < teil.length; index += 1) {
            if (punktImRing(x, y, teil[index] as Ring)) {
                imLoch = true;
                break;
            }
        }
        if (!imLoch) return true;
    }
    return false;
}

export interface Huellbox {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
}

/** Die Hüllbox der Außenringe, `null` bei einer Fläche ohne Punkt. */
export function huellbox(flaeche: Flaeche): Huellbox | null {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let gesehen = false;
    for (const teil of flaeche) {
        for (const [x, y] of teil[0] ?? []) {
            gesehen = true;
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
        }
    }
    return gesehen ? { minX, minY, maxX, maxY } : null;
}

/**
 * Der Punkt, der eine Fläche vertritt: die Mitte ihrer Hüllbox, nicht der echte Schwerpunkt. Für „in welchem Band liegt das“
 * genau genug und in einem Durchgang. ⚠️ Systematische Unterschätzung bei großen Flächen: Ein Wald, der halb über einem Gebirge
 * liegt, dessen Mitte aber daneben, hat KEIN Relief (die Übergabe nennt es ausdrücklich).
 */
export function vertreterPunktFlaeche(flaeche: Flaeche): Punkt | null {
    const box = huellbox(flaeche);
    return box ? [(box.minX + box.maxX) / 2, (box.minY + box.maxY) / 2] : null;
}

/**
 * Der Punkt, der eine Linie vertritt: ihre MITTE, nicht der Anfang. Ein Fluss beginnt im Gebirge und endet im Meer, und sein
 * Anfang beantwortet die Frage nach seiner Umgebung falsch.
 */
export function vertreterPunktLinie(punkte: readonly Punkt[]): Punkt | null {
    if (punkte.length === 0) return null;
    return punkte[Math.floor(punkte.length / 2)] ?? null;
}

/**
 * Flächeninhalt in Einheiten² (Gaußsche Trapezformel über die Außenringe, Löcher abgezogen). Für die Matrix wichtiger als die
 * ANZAHL: 500 Waldflecken und 3 Waldmeere zählen gleich, wirken im Bild aber gar nicht gleich.
 */
export function flaecheninhalt(flaeche: Flaeche): number {
    let summe = 0;
    for (const teil of flaeche) {
        teil.forEach((ring, index) => {
            let doppelt = 0;
            for (let k = 0, j = ring.length - 1; k < ring.length; j = k, k += 1) {
                const [xj, yj] = ring[j] as Punkt;
                const [xk, yk] = ring[k] as Punkt;
                doppelt += xj * yk - xk * yj;
            }
            summe += (index === 0 ? 1 : -1) * Math.abs(doppelt / 2);
        });
    }
    return summe;
}

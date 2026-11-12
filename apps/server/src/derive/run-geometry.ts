import type { Point } from "./chordal-axis.ts";
import { pathLength } from "./chordal-axis.ts";

/**
 * Was jeder Schriftlauf braucht, egal worauf er läuft.
 *
 * ⭐ Diese Datei entstand, als die WEGE eine Beschriftung brauchten (WI-0010 P5) — und zwar durch
 * HERAUSZIEHEN aus `label-runs.ts`, nicht durch Kopieren. Die Frage „passt dieser Name auf diese
 * Kurve, und wo liegt ihre ruhigste Stelle" hat nichts mit Landschaften zu tun.
 *
 * 🪤 Was hier bewusst NICHT steht: die Ableitung einer Mittelachse aus einer Fläche
 * (`buildAxisGraph`, `longestPath`, Triangulation) und die Glättung (`fitCurve`, `calmToChord`).
 * Beides ist landschaftsspezifisch — und für Wege sogar schädlich:
 *
 *   * Ein Weg IST schon eine Linie. Es gibt keine Achse abzuleiten.
 *   * Die Weggeometrie ist AUTHORITATIV. Wer sie glättet, lässt den Namen neben dem Weg laufen.
 *     Bei einer Landschaft ist die Achse selbst abgeleitet, dort darf geglättet werden.
 */

export type { Point };

/**
 * Wie stark die Ruhesuche zur Mitte ihres Abschnitts zieht (MCS-008).
 *
 * 🪤 Der Wert stammt aus Legacys Kurvenbeschriftung und hält den Namen in der Nähe der Mitte, wenn
 * kein Stück deutlich ruhiger ist als ein anderes. Er ist überschreibbar, weil ein Weg eine andere
 * Form hat als eine Landschaftsachse — aber die Vorgabe ist dieselbe.
 */
export const ANCHOR_WEIGHT = 2.5;

/**
 * Karteneinheiten je Bildschirmpixel auf einer Zoomstufe.
 *
 * Der Kartenraum ist 1024 Einheiten breit und fuellt die ganze Web-Mercator-Weite; auf Stufe z ist
 * die Welt 512 * 2^z Pixel breit. Die Namensbreite kommt in Pixeln aus der Glyphenmetrik, die
 * Kurve liegt in Karteneinheiten - ohne diese Umrechnung waere die Zusicherung "der Lauf ist
 * laenger als sein Name" ein Vergleich zweier verschiedener Dinge.
 */
export function mapUnitsPerPixel(zoom: number): number {
    return 1024 / (512 * 2 ** zoom);
}

/**
 * Teilt einen Kurvenzug in genau `count` gleiche Instanzen.
 *
 * Gleiche Bogenabschnitte, dazwischen je eine Mindestlücke, außen nicht. Passt eine Instanz nicht,
 * wird **nicht** eine weggelassen, sondern für die kleinere Zahl vollständig neu verteilt — sonst
 * stünden zwei Namen ungleich verteilt auf einer Kurve (Betreiberregel, MCS-008).
 */
export function splitIntoInstances(curve: readonly Point[], count: number, gap: number): Point[][] {
    const total = pathLength(curve);
    const share = (total - gap * (count - 1)) / count;
    if (share <= 0) {
        return [];
    }
    const runs: Point[][] = [];
    for (let index = 0; index < count; index += 1) {
        const from = (share + gap) * index;
        runs.push(sliceByLength(curve, from, from + share));
    }
    return runs.every((run) => run.length >= 2) ? runs : [];
}

/**
 * Die niedrigste ganze Zoomstufe, auf der `count` Instanzen des Namens nebeneinander passen.
 *
 * Ganzzahlig und aufgerundet, weil MapLibre die Kachelstufe abrundet: zwischen zwei Stufen wird die
 * Kurve am Schirm nur länger, nie kürzer. Wer hier abrundete, verspräche Platz, den es am unteren
 * Rand der Stufe noch nicht gibt.
 */
export function zoomWhereInstancesFit(
    curveLength: number,
    count: number,
    nameWidthPixels: number,
    gapPixels: number,
    limit: number,
): number | null {
    for (let zoom = 0; zoom <= limit; zoom += 1) {
        const unitsPerPixel = mapUnitsPerPixel(zoom);
        const usable = curveLength - gapPixels * unitsPerPixel * (count - 1);
        if (usable / count >= nameWidthPixels * unitsPerPixel) {
            return zoom;
        }
    }
    return null;
}

/**
 * Sucht in einem Abschnitt das ruhigste Fenster der Länge `windowLength`.
 *
 * 💣 Ohne diesen Schritt steht der Name auf der Mitte des Abschnitts — und bei einer gebogenen
 * Fläche ist die Mitte genau der Scheitel, an dem das Polynom am weitesten von der Fläche
 * wegläuft. Gemessen: ohne Ruhesuche lag der beschriftete Teil bei 62 von 124 Läufen außerhalb
 * seiner eigenen Fläche, bei der Schwarzen Sichel zu zwei Dritteln.
 *
 * Kosten wie Legacy: integrierte absolute Kursänderung plus ein Ankergewicht mal dem normierten
 * Abstand zur Sollmitte (MCS-008). Das Ankergewicht hält den Namen in der Nähe der Mitte, wenn kein
 * Stück deutlich ruhiger ist als ein anderes.
 */
export function calmestWindow(
    curve: readonly Point[],
    windowLength: number,
    anchorWeight = ANCHOR_WEIGHT,
    accept: (window: Point[]) => boolean = () => true,
): Point[] {
    const from = calmestWindowStart(curve, windowLength, anchorWeight, accept);
    if (from === null) {
        return [];
    }
    return pathLength(curve) <= windowLength ? [...curve] : sliceByLength(curve, from, from + windowLength);
}

/**
 * Wie `calmestWindow`, aber mit der LAGE des Fensters: seinem Beginn in Bogenlänge. `null`, wenn
 * keine Stelle angenommen wird. Die Lage braucht, wer das Fenster danach noch symmetrisch
 * verlängern will, ohne seine Mitte zu verschieben.
 */
export function calmestWindowStart(
    curve: readonly Point[],
    windowLength: number,
    anchorWeight = ANCHOR_WEIGHT,
    accept: (window: Point[]) => boolean = () => true,
): number | null {
    const total = pathLength(curve);
    if (total <= windowLength) {
        return accept([...curve]) ? 0 : null;
    }
    const steps = 48;
    const span = total - windowLength;
    let best: number | null = null;
    let bestCost = Number.POSITIVE_INFINITY;
    for (let step = 0; step <= steps; step += 1) {
        const from = (span * step) / steps;
        const window = sliceByLength(curve, from, from + windowLength);
        if (window.length < 2 || !accept(window)) {
            continue;
        }
        let turning = 0;
        for (let index = 2; index < window.length; index += 1) {
            const a = window[index - 2] as Point;
            const b = window[index - 1] as Point;
            const c = window[index] as Point;
            const first = Math.atan2(b.y - a.y, b.x - a.x);
            const second = Math.atan2(c.y - b.y, c.x - b.x);
            let difference = Math.abs(second - first);
            while (difference > Math.PI) {
                difference = Math.abs(difference - 2 * Math.PI);
            }
            turning += difference;
        }
        // 💣 Normiert auf die FREIE Strecke, nicht auf die halbe Kurve. Legacys Kommentar nennt den
        // Effekt beim Namen: ohne diese Normierung wandern bei einer gebogenen Fläche alle
        // Instanzen an dieselbe Stelle - bei der Schwarzen Sichel standen zwei Grundlinien
        // gemessen 4 Pixel auseinander, wo 566 Pixel Platz waren. Das sieht aus wie eine Kollision
        // und ist die Fenstersuche; wer daraufhin die Kollisionsschwelle nachzieht, zementiert den
        // Fehler.
        const free = Math.max(span / 2, Number.EPSILON);
        const offset = Math.abs(from + windowLength / 2 - total / 2) / free;
        const cost = turning + anchorWeight * offset;
        if (cost < bestCost) {
            bestCost = cost;
            best = from;
        }
    }
    return best;
}

/**
 * Würde MapLibre einen Namen der Länge `labelLength` in die MITTE dieser Linie setzen?
 *
 * 💣 MapLibre verwirft einen Linienname STILL, wenn die Linie unter ihm zu stark knickt
 * (`checkMaxAngle`, symbol/check_max_angle.ts): entlang des Namens darf in keinem Stück der Länge
 * `angleWindow` (MapLibre: 3/5 der Schriftgröße) die Summe der Richtungsänderungen `maxLocal`
 * überschreiten (`text-max-angle`, Vorgabe 45°). `symbol-placement: line-center` setzt den Namen
 * genau auf die Mitte der Linie — also prüft diese Funktion genau dort.
 *
 * ⭐ Dazu Legacys Deckel über den GANZEN Namen (`PATH_LABEL_MAX_TURN_DEG`, 90°): „passt ein Name
 * nur noch in einen Bogen, wird er nicht gezeichnet." MapLibre kennt nur den örtlichen Deckel;
 * ein Name, der in vielen kleinen Schritten einmal im Kreis läuft, bestünde dort.
 *
 * Alle Längen in derselben Einheit wie die Linie.
 */
export function labelFitsAngle(
    line: readonly Point[],
    labelLength: number,
    angleWindow: number,
    maxLocal: number,
    maxTotal: number,
): boolean {
    const total = pathLength(line);
    if (labelLength > total) {
        return false;
    }
    const from = (total - labelLength) / 2;
    const to = from + labelLength;
    const ecken: { at: number; delta: number }[] = [];
    let travelled = 0;
    for (let index = 1; index < line.length - 1; index += 1) {
        const a = line[index - 1] as Point;
        const b = line[index] as Point;
        const c = line[index + 1] as Point;
        travelled += Math.hypot(b.x - a.x, b.y - a.y);
        if (travelled <= from || travelled >= to) {
            continue;
        }
        let delta = Math.abs(Math.atan2(c.y - b.y, c.x - b.x) - Math.atan2(b.y - a.y, b.x - a.x));
        if (delta > Math.PI) {
            delta = 2 * Math.PI - delta;
        }
        ecken.push({ at: travelled, delta });
    }
    let summe = 0;
    let fenster = 0;
    let erste = 0;
    for (const ecke of ecken) {
        summe += ecke.delta;
        fenster += ecke.delta;
        while (ecke.at - (ecken[erste] as { at: number }).at > angleWindow) {
            fenster -= (ecken[erste] as { delta: number }).delta;
            erste += 1;
        }
        if (fenster > maxLocal || summe > maxTotal) {
            return false;
        }
    }
    return true;
}

/** Schneidet ein Stück nach Bogenlänge heraus. */
export function sliceByLength(points: readonly Point[], from: number, to: number): Point[] {
    const output: Point[] = [];
    let travelled = 0;
    for (let index = 1; index < points.length; index += 1) {
        const a = points[index - 1] as Point;
        const b = points[index] as Point;
        const length = Math.hypot(b.x - a.x, b.y - a.y);
        if (length === 0) {
            continue;
        }
        const segmentStart = travelled;
        const segmentEnd = travelled + length;
        if (segmentEnd >= from && segmentStart <= to) {
            const enter = Math.max(from, segmentStart);
            const leave = Math.min(to, segmentEnd);
            const at = (distance: number): Point => {
                const ratio = (distance - segmentStart) / length;
                return { x: a.x + (b.x - a.x) * ratio, y: a.y + (b.y - a.y) * ratio };
            };
            if (output.length === 0) {
                output.push(at(enter));
            }
            output.push(at(leave));
        }
        travelled = segmentEnd;
    }
    return output;
}

/**
 * Wie viel länger als der Name ein verlängerter Lauf wird: MapLibre setzt mit `line-center` nur, was ganz auf die Linie
 * passt, und die Kanten der Glyphen brauchen etwas Luft.
 */
export const NAME_ROOM = 1.05;

/**
 * Der Ausweichraum eines Kurvennamens: ein Viertel der Namenslänge vor und hinter dem Kern (Betreiber 2026-10-11: „A, überlappungen
 * sind einfach scheisse. kannst du nicht versuchen etwas auszuweichen, wenn du schon längere läufe baust?“). Die Kachel schneidet
 * daraus bis zu fünf Kandidaten, die Mitte und je ⅛ und ¼ vor und zurück (`landscape_label_run_tile`, Migration 0110), und MapLibre
 * nimmt den ersten freien.
 *
 * 💣 DIE GRENZE ¼ IST HART, dieselbe wie bei den Wegnamen (`SLIDE_SHARE`, Migration 0030): Kandidaten werden auf der ganzen Stufe
 * geschnitten und bis z + 0,99 gezeichnet. Liegen ihre Mitten mehr als eine halbe Namenslänge auseinander, überdecken sie sich dort
 * nicht mehr, und derselbe Name stünde zweimal.
 */
export const AUSWEICHRAUM = 0.25;

/**
 * Der Lauf eines einzelnen Namens: der Kern, an beiden Enden gleich weit entlang seiner Sehne verlängert, um den Ausweichraum und,
 * wo der Kern kürzer ist als der Name, so weit, dass er ihn trägt (I7). Die angesetzten Stücke sind je EIN Segment; der Lauf ohne
 * seinen ersten und letzten Punkt ist der Kern (`kurvenstueck`).
 *
 * 💣 Zu kurz (Befund 2026-10-11): Bis hierher hieß es, ein zu kurzer Lauf schade nicht, „das Punktlabel steht ohnehin“. Das stimmt
 * nicht: Eine Region mit Kurvenlauf zeigt ihr Punktlabel nicht (`has_curve_run`), und MapLibre setzt mit `line-center` keinen
 * Namen, der länger ist als seine Linie. Gemessen am Satz 179380: 34 Läufe in 26 Regionen, auf deren Stufe der Name GANZ fehlte
 * (Dairuchsee auf z5: Lauf 94 px, Name breiter). Legacy verlängert in genau diesem Fall und lässt nie einen Namen aus
 * (`js/map-features/curve-label-fit.js:163-181` und `:340-370` an avesmaps@13d0183ab; „Ein Name faellt nie aus“, `:437-439`).
 * Die Schrift verkleinert Legacy dazwischen bis 8 px; das geht in MapLibre nicht je Lauf, die Verlängerung ohne Deckel deckt es ab.
 *
 * 🪤 Legacy verlängert entlang der Tangente der Enden. An einer S-förmigen Kurve dreht das die Sehne, und der Lauf knickt danach
 * über 30 Grad gegen sie (I4; am Satz 179380 drei Läufe mit 34 bis 38 Grad). Entlang der Sehne bleibt sie, wo sie ist: Die
 * angesetzten Stücke liegen auf ihr, der Kern dazwischen ist schon beruhigt.
 *
 * 🪤 Ist ein zu kurzer Kern gebogen, dreht die Linie unter dem Namen trotzdem zu stark: MapLibre verwirft ihn dann still
 * (`text-max-angle`, Nauriti z3). Wer `passt` mitgibt, bekommt in diesem Fall die Sehne selbst als Kern, also einen geraden Lauf.
 */
export function ausweichLauf(kern: readonly Point[], needed: number, passt?: (points: Point[]) => boolean): Point[] {
    const lauf = entlangDerSehne(kern, needed);
    if (!passt || kern.length <= 2 || pathLength(kern) >= needed || passt(lauf)) return lauf;
    return entlangDerSehne([kern[0] as Point, kern[kern.length - 1] as Point], needed);
}

function entlangDerSehne(kern: readonly Point[], needed: number): Point[] {
    const length = pathLength(kern);
    const erstes = kern[0] as Point;
    const letztes = kern[kern.length - 1] as Point;
    const sehne = Math.hypot(letztes.x - erstes.x, letztes.y - erstes.y);
    if (kern.length < 2 || sehne === 0) return [...kern];
    const rest = (length < needed ? (needed * NAME_ROOM - length) / 2 : 0) + AUSWEICHRAUM * needed;
    const dx = ((letztes.x - erstes.x) / sehne) * rest;
    const dy = ((letztes.y - erstes.y) / sehne) * rest;
    return [{ x: erstes.x - dx, y: erstes.y - dy }, ...kern, { x: letztes.x + dx, y: letztes.y + dy }];
}

/**
 * Das Stück eines Laufs, das aus der Kurve stammt: ohne die zwei Stücke, die `ausweichLauf` an einen Einzellauf setzt. Ein Satz mit
 * mehreren Instanzen weicht nicht aus (seine Lücke ist kleiner als zwei Ausweichräume; die Kandidaten zweier Instanzen verdrängten
 * sich gegenseitig) und ist ganz Kurve. Dieselbe Regel steht im Verifier (I5).
 */
export function kurvenstueck(points: readonly Point[], instanceCount: number): Point[] {
    return instanceCount === 1 && points.length >= 4 ? points.slice(1, -1) : [...points];
}

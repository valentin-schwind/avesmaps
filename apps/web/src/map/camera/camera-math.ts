/**
 * Die Rechenregeln der 3D-Kamera (WI-0016, Spezifikation `docs/design/3d-navigation.md`).
 *
 * Nur reine Funktionen: was hier steht, lässt sich ohne Browser und ohne Karte prüfen. Wie die
 * Kamera fährt, entscheidet `camera.ts`; wohin sie darf, steht hier.
 *
 * 🪤 „Drehung" ist MapLibres `bearing`: die Himmelsrichtung, in die der obere Bildrand zeigt. Steigt
 * sie, wendet sich der Blick nach rechts, und die Karte dreht sich gegen den Uhrzeigersinn.
 *
 * 🪤 Eine einzige Ausnahme von „rein": die Vorgabe der zusätzlichen Grenze fragt, ob mit dem Finger bedient wird
 * (`geraetegrenze`). Sie steht hier, weil jede Bewegung durch `clampPitch` geht - nicht nur die Karte.
 */
import { kurvenWert, ZOOM_KURVE_VORGABE, type KurvenPunkt } from "@avesmaps3d/shared";
import { coarsePointer } from "../../controls/camera-settings";

/** Der 3D-Knopf kippt auf diese Neigung, sofern die Grenze nach Zoom es erlaubt (D2, Spez. § 6). */
export const TILT_PRESET = 45;

/**
 * Höchste Neigung am Zeigergerät; am Finger gilt `PITCH_CEILING_TOUCH`.
 *
 * 🔴 **Betreiber 2026-10-13**, am Gerät abgenommen: „80° fühlt sich gut an als max, lass es so" (gemessen bei 80,3° auf
 * Zoom 8,6). MapLibres eigener Anschlag läge bei 85°.
 *
 * 🪤 Dass man hier oben überhaupt noch klicken kann, hängt an `installHorizonQueryFix` (`query-horizont.ts`): Ohne den
 * Eingriff findet MapLibre über 71,5° keine Kachel mehr, und Orte wie Wege sind nicht mehr treffbar. Das Sichtfeld
 * bleibt deshalb MapLibres Vorgabe von 36,87° - ein engeres hob die Grenze zwar auch, sah aber aus wie ein Teleobjektiv
 * (Betreiber: „die leute finden 20° nicht so gut"). `e2e/camera-horizont.spec.ts` wacht am echten Renderer darüber.
 */
export const PITCH_CEILING = 80;

/**
 * Höchste Neigung am Finger (Betreiber 2026-10-13: „Nur am Zeigergerät"). Kein neuer Wert, sondern der bisherige
 * Anschlag: die Neigung ist der größte Kostentreiber des Geländes (siehe `zusatzgrenze`), und die nackte Karte
 * stürzt auf dem iPhone des Betreibers in extremen Winkeln ab. Er wirkt als Vorgabe der `zusatzgrenze`, also über
 * allen Stützstellen, und gilt damit für JEDE Bewegung: Gesten, Fahrten, Tasten, Reise und Links.
 */
export const PITCH_CEILING_TOUCH = 60;

/**
 * Die Neigung, mit der die Reise fliegt (Betreiber 2026-10-14: „die neigung auf 65°"; davor 75°, davor „aufs maximum"
 * vom 2026-09-27, was damals 60° waren).
 *
 * 🪤 Ein eigener Wert, nicht der Anschlag. Eine Wiedergabe ist der Dauerzustand, und die Neigung ist der teuerste
 * Posten des Geländes: Die Zahl der Zwischenbilder steigt mit ihr (gemessen am 2026-10-14 in iPhone-Maßen, Stufe 0:
 * 30° = 43 MB, 60° = 192 MB, 80° = 298 MB). Am Finger zieht `PITCH_CEILING_TOUCH` sie weiter auf 60° (`zusatzgrenze`).
 */
export const FLIGHT_PITCH = 65;

/** Unter dieser Abweichung rastet die Karte auf Norden ein (MapLibre-Vorgabe `bearingSnap`). */
export const NORTH_SNAP = 7;

/** Acht Himmelsrichtungen: N, NO, O, SO, S, SW, W, NW. */
const COMPASS_STEP = 45;

/**
 * Die Neigungsgrenze nach MapLibre-Zoom (D3, Spez. § 7): man darf nicht ins Leere blicken.
 *
 * 🪤 MapLibre-Zoom, nicht Zoomband. Das Entwicklerpanel zählt wie Legacy eine Stufe niedriger
 * (WI-0015); die Stützstellen hier sind MapLibre-Werte.
 *
 * ⭐ Eine Regel, keine Wertetabelle: je Zoomstufe 15° mehr, bis `PITCH_CEILING` erreicht ist. Die Staffel bis 5
 * stand schon so da (D3); der steile Blick kommt deshalb erst in der Nähe, wo nichts ins Leere zeigt.
 */
const PITCH_LIMIT_STOPS: readonly (readonly [zoom: number, pitch: number])[] = [
    [3, 30],
    [4, 45],
    [5, 60],
    [6, 75],
    [7, PITCH_CEILING],
];

/** Was dieses Gerät an Neigung trägt: am Finger der alte Anschlag, am Zeigergerät keine zusätzliche Grenze. */
const geraetegrenze = coarsePointer ? PITCH_CEILING_TOUCH : undefined;

/**
 * Eine zusätzliche Obergrenze über allen Stützstellen, in Grad. `undefined` heißt: keine außer der des Geräts.
 *
 * 🔴 **Wofür.** Gemessen am 2026-10-12 auf dem iPhone des Betreibers und im iPhone-Fenster: Die Neigung ist der mit
 * Abstand größte Kostentreiber des Geländes. Dieselbe Karte, nur gekippt — 0 bis 30°: 2 Geländekacheln und 53 MB
 * Texturen; 50°: 4 und 106 MB; 60°: 109 MB; 85°: 9 Kacheln und **228 MB**. Das Vierfache allein aus dem Winkel.
 *
 * Belegt ist dabei, dass es NICHT an unserem Code liegt: Eine nackte Seite aus MapLibre, unseren Höhenkacheln und
 * unserem Stil — ohne Vue, ohne Route, ohne eigene Ebenen — stürzt auf demselben Gerät ab, sobald der Betreiber in
 * einen extremen Winkel kippt, und läuft sonst stabil.
 *
 * Welcher Wert ein Telefon trägt, lässt sich hier nicht messen, nur dort: `?maxneigung=<grad>` (`map/flug-probe.ts`).
 */
let zusatzgrenze: number | undefined = geraetegrenze;

/**
 * Setzt die zusätzliche Obergrenze (siehe `zusatzgrenze`); ohne Angabe gilt wieder die Grenze dieses Geräts.
 *
 * 🪤 `?maxneigung=` darf auch nach OBEN über den Gerätedeckel hinaus - sonst ließe sich am Finger nie messen,
 * welchen Winkel ein Telefon trägt.
 */
export function setMaxPitch(grad: number | undefined): void {
    zusatzgrenze = grad ?? geraetegrenze;
}

/** Höchste erlaubte Neigung bei diesem Zoom; zwischen den Stützstellen linear. */
export function maxPitchForZoom(zoom: number): number {
    const nachZoom = maxPitchNachZoom(zoom);
    return zusatzgrenze === undefined ? nachZoom : Math.min(nachZoom, zusatzgrenze);
}

function maxPitchNachZoom(zoom: number): number {
    const first = PITCH_LIMIT_STOPS[0];
    const last = PITCH_LIMIT_STOPS[PITCH_LIMIT_STOPS.length - 1];
    if (!first || !last) {
        return PITCH_CEILING;
    }
    if (zoom <= first[0]) {
        return first[1];
    }
    if (zoom >= last[0]) {
        return last[1];
    }
    for (let index = 1; index < PITCH_LIMIT_STOPS.length; index += 1) {
        const upper = PITCH_LIMIT_STOPS[index];
        const lower = PITCH_LIMIT_STOPS[index - 1];
        if (upper && lower && zoom <= upper[0]) {
            const share = (zoom - lower[0]) / (upper[0] - lower[0]);
            return lower[1] + share * (upper[1] - lower[1]);
        }
    }
    return last[1];
}

/** Eine Neigung in die erlaubten Grenzen legen: nie unter 0, nie über die Grenze des Zooms. */
export function clampPitch(pitch: number, zoom: number): number {
    return Math.min(Math.max(pitch, 0), maxPitchForZoom(zoom));
}

/** Spielraum, in dem eine Neigung als „auf der Kurve“ gilt, in Grad: Die Adresse rundet auf ein Zehntel. */
const AUF_DER_KURVE = 0.5;

/**
 * Die Zoomkurve: Stützpunkte aus MapLibre-Zoom und Neigung, eingestellt in der Systemsteuerung (Reiter „Standardwerte“, Panel
 * „Zoomkurve“; `packages/shared/src/system/karteneinstellungen.ts`), gelesen beim Start der Karte (`setZoomKurve`). Ohne Antwort gilt die
 * Vorgabe der Tafel: 25° bei angezeigtem Zoom 1, 45° bei 5, 80° bei 8,5.
 *
 * 🔴 Betreiber 2026-11-09, nach zwei festen Kurven: „bis 5 will ich eigentlich gar keine veränderung - nur ganz sanft … mit 5 als einzige
 * veränderung in der steigungs funktion“, dann „kannst du einen freien editor von stützpunkten auf einer funktion (wie bei lüfterkurven)
 * … tun?“.
 */
let zoomKurve: readonly KurvenPunkt[] = ZOOM_KURVE_VORGABE;

/** Setzt die Zoomkurve; ohne Angabe gilt wieder die Vorgabe. */
export function setZoomKurve(punkte: readonly KurvenPunkt[] | undefined): void {
    zoomKurve = punkte !== undefined && punkte.length > 0 ? punkte : ZOOM_KURVE_VORGABE;
}

/** Die Neigung, der der Blick beim Zoomen folgt: die Zoomkurve an dieser Stelle, nie steiler als die Grenze des Zooms. */
export function begleitNeigung(zoom: number): number {
    return Math.min(kurvenWert(zoomKurve, zoom), maxPitchForZoom(zoom));
}

/**
 * Steht der Blick auf der Kurve seines Zooms (`begleitNeigung`)? Flach (2D) nie.
 *
 * ⭐ **Die Neigung folgt der Kurve** (Betreiber 2026-11-08 „Ja, folgen lassen“, 2026-11-09 die Kurve). Wer auf ihr steht (nach dem
 * 3D-Knopf), bleibt auf ihr, wohin der Zoom auch geht. Wer selbst neigt, flacher oder steiler, behält seine Neigung.
 */
export function aufDerKurve(view: { pitch: number; zoom: number }): boolean {
    return view.pitch >= AUF_DER_KURVE && Math.abs(view.pitch - begleitNeigung(view.zoom)) <= AUF_DER_KURVE;
}

/** Die Neigung nach einem Zoomschritt von Ring oder Taste: auf der Kurve die des neuen Zooms, sonst die bisherige (die Karte klemmt). */
export function neigungNachZoom(from: { pitch: number; zoom: number }, zoom: number): number {
    return aufDerKurve(from) ? begleitNeigung(zoom) : from.pitch;
}

/**
 * Die Neigung einer Geste (Rad, Finger, Doppelklick, Strg + Ziehen), für MapLibres `transformCameraUpdate` (siehe `aufDerKurve`).
 *
 * `wunsch` ist MapLibres gewünschter Stand nach der Geste, `vorher` der gezeichnete Blick davor. Die Kamera zieht den gewünschten Stand
 * auf das Ergebnis nach (`camera.ts`); eine Geste, die nur zoomt oder verschiebt, bringt also die gezeichnete Neigung mit. Ändert sie
 * die Neigung, neigt jemand selbst: Das gilt. Sonst folgt ein Blick auf der Kurve ihr.
 */
export function neigungBeimZoom(
    wunsch: { pitch: number; zoom: number },
    vorher: { pitch: number; zoom: number },
): number {
    const selbst = Math.abs(wunsch.pitch - vorher.pitch) > 1e-3;
    return !selbst && aufDerKurve(vorher) ? begleitNeigung(wunsch.zoom) : clampPitch(wunsch.pitch, wunsch.zoom);
}

/** Eine Drehung auf (−180, 180] bringen, damit Vergleiche und die Adresse eindeutig sind. */
export function normalizeBearing(bearing: number): number {
    const wrapped = ((((bearing + 180) % 360) + 360) % 360) - 180;
    return wrapped === -180 ? 180 : wrapped;
}

/**
 * Zur nächsten der acht Himmelsrichtungen drehen (Steuerring ‹ ›, Spez. § 6).
 *
 * Steht die Karte schon auf einer Himmelsrichtung, geht es 45° weiter. Steht sie dazwischen, geht
 * es zur nächsten in Drehrichtung: von 37° mit `+1` auf 45°, mit `-1` auf 0°.
 */
export function nextCompassBearing(bearing: number, step: 1 | -1): number {
    // Ein halbes Grad Spielraum, damit eine Fahrt, die knapp vor dem Ziel endet, nicht doppelt zählt.
    const tolerance = 0.5;
    const position = normalizeBearing(bearing) / COMPASS_STEP;
    const nearest = Math.round(position);
    const onDirection = Math.abs(position - nearest) * COMPASS_STEP <= tolerance;
    let target: number;
    if (onDirection) {
        target = (nearest + step) * COMPASS_STEP;
    } else {
        target = (step > 0 ? Math.ceil(position) : Math.floor(position)) * COMPASS_STEP;
    }
    return normalizeBearing(target);
}

/** Liegt die Drehung so nah an Norden, dass die Karte einrasten soll? */
export function snapsToNorth(bearing: number): boolean {
    return Math.abs(normalizeBearing(bearing)) < NORTH_SNAP;
}

/** MapLibres Kachelgröße: die Welt misst bei Zoom z `512 · 2^z` Bildpunkte. */
const WORLD_TILE_SIZE = 512;

/**
 * Wohin die Mitte rückt, wenn man die Karte um `(dx, dy)` Bildpunkte verschiebt (Tasten, WI-0039).
 *
 * Gerechnet auf der flachen Karte bei `zoom` und `bearing`, wie MapLibres `panBy` in der Draufsicht.
 * So baut ein Schritt auf dem ZIEL einer laufenden Fahrt auf statt auf ihrem halben Weg - `panBy`
 * rechnete vom Stand dieses Bildes, und gedrückt gehaltene Pfeile verloren dabei Strecke.
 */
export function shiftCenter(
    center: readonly [number, number],
    dx: number,
    dy: number,
    zoom: number,
    bearing: number,
): [number, number] {
    const size = WORLD_TILE_SIZE * 2 ** zoom;
    const [lng, lat] = center;
    const x = ((lng + 180) / 360) * size;
    const y = ((1 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / Math.PI) / 2) * size;
    // Ein Schritt auf dem Bildschirm ist auf der Welt um die Drehung gedreht.
    const angle = (bearing * Math.PI) / 180;
    const worldX = x + dx * Math.cos(angle) - dy * Math.sin(angle);
    const worldY = y + dx * Math.sin(angle) + dy * Math.cos(angle);
    return [
        (worldX / size) * 360 - 180,
        (360 / Math.PI) * Math.atan(Math.exp((1 - (2 * worldY) / size) * Math.PI)) - 90,
    ];
}

/**
 * Wo eine Stelle des Bildes auf dem Boden liegt, gemessen von der Bildmitte aus (WI-0218): `right` quer, `ahead` in Blickrichtung
 * (vom Betrachter weg), in Weltbildpunkten beim Zoom des Blicks. `dx`, `dy` ist die Stelle relativ zur Bildmitte (nach unten positiv).
 *
 * Eine Lochkamera wie MapLibres: Sie steht `0,5 · Höhe / tan(Sichtfeld / 2)` Bildpunkte vor der Mitte, um `pitch` aus der Senkrechten
 * gekippt; der Boden liegt in der Höhe der Mitte (wie `setLocationAtPoint`). Flach ist es die Verschiebung selbst. Auch der
 * Blickraum des Playmodes rechnet so (`traveler-view.ts`). Über dem Horizont gibt es keinen Boden: `undefined`.
 */
export function groundOffset(
    dx: number,
    dy: number,
    pitch: number,
    fov: number,
    height: number,
): { right: number; ahead: number } | undefined {
    const distance = (0.5 * height) / Math.tan((fov * Math.PI) / 360);
    const tilt = (pitch * Math.PI) / 180;
    const facing = distance * Math.cos(tilt) + dy * Math.sin(tilt);
    // Der Strahl trifft den Boden nicht mehr, oder erst am Horizont.
    if (facing <= distance * Math.cos(tilt) * 0.05) return undefined;
    const scale = (distance * Math.cos(tilt)) / facing;
    return {
        right: scale * dx,
        ahead: scale * (distance * Math.sin(tilt) - dy * Math.cos(tilt)) - distance * Math.sin(tilt),
    };
}

/**
 * Die Mitte der Karte, bei der `point` an der Stelle `(dx, dy)` relativ zur Bildmitte steht, im Blick `view` (WI-0218). Liegt die
 * Stelle über dem Horizont, bleibt `point` die Mitte.
 */
export function centreForOffset(
    point: readonly [number, number],
    dx: number,
    dy: number,
    view: { zoom: number; bearing: number; pitch: number },
    fov: number,
    height: number,
): [number, number] {
    const ground = groundOffset(dx, dy, view.pitch, fov, height);
    if (ground === undefined) return [point[0], point[1]];
    return shiftCenter(point, -ground.right, ground.ahead, view.zoom, view.bearing);
}

/** Was an der Stelle `(dx, dy)` relativ zur Bildmitte liegt, wenn die Mitte der Karte `center` ist (Umkehrung von `centreForOffset`). */
export function locationAtOffset(
    center: readonly [number, number],
    dx: number,
    dy: number,
    view: { zoom: number; bearing: number; pitch: number },
    fov: number,
    height: number,
): [number, number] {
    const ground = groundOffset(dx, dy, view.pitch, fov, height);
    if (ground === undefined) return [center[0], center[1]];
    return shiftCenter(center, ground.right, -ground.ahead, view.zoom, view.bearing);
}

/** Die Mitte eines Umrisses auf der Karte (Mercator, wie MapLibre einpasst), nicht die Mitte der Grade. */
export function boundsMiddle(
    bounds: readonly [readonly [number, number], readonly [number, number]],
): [number, number] {
    const [[west, south], [east, north]] = bounds;
    const y = (lat: number): number => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
    const lat = (2 * Math.atan(Math.exp((y(south) + y(north)) / 2)) - Math.PI / 2) * (180 / Math.PI);
    return [(west + east) / 2, lat];
}

/** Ein Flug zu einem neuen Ziel dauert mindestens und höchstens so lange, in Millisekunden. */
export const FLIGHT_MS = { min: 750, max: 2200 } as const;

/**
 * Wie lange die Kamera zu einem neuen Ziel fliegt (Kamerakanon 2026-09-29: sie springt nie), nach der
 * Entfernung: `screens` sind Bildschirme Weg (Bildpunkte durch die längere Kante der Karte), `zoomDelta` die
 * Änderung der Zoomstufe. Das Minimum ist der Punkt der Suche (0,75 s); jede Verdopplung der Strecke kostet rund
 * 0,4 s, jede Zoomstufe 0,25 s; bei 2,2 s ist Schluss.
 *
 * 🪤 Die Dauer rechnet dieser Aufruf, nicht MapLibre mit `maxDuration`: Überschreitet die errechnete Dauer
 * dort den Deckel, setzt MapLibre sie auf **0** - der Flug wird zum Sprung.
 */
export function flightDuration(screens: number, zoomDelta: number): number {
    const raw = FLIGHT_MS.min + 400 * Math.log2(1 + Math.max(0, screens)) + 250 * Math.abs(zoomDelta);
    return Math.round(Math.min(FLIGHT_MS.max, Math.max(FLIGHT_MS.min, raw)));
}

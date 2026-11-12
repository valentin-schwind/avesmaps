import type { Map as MapLibreMap } from "maplibre-gl";
import { AVENTURIA, fromRenderLngLat, toRenderLngLat } from "@avesmaps3d/shared";
import { CAMERA_DURATION, type Camera } from "./camera/camera";
import { clampPitch, normalizeBearing } from "./camera/camera-math";
import { flugHoehe, flugNeigung } from "./flug-probe";
import { centreFor, locationAt } from "./camera/target-centre";
import { visibleCentre, visibleRect } from "./camera/visible-area";
import type { MapInteractionCoordinator } from "./interaction/types";
import type { TravelerFlightHeight, TravelerPosition } from "./traveler-layer";

/**
 * Was der Playmode auf der Karte tut (WI-0031): den Pfeil setzen und die Kamera nachführen.
 *
 * - **2D folgt von oben**, ohne die Drehung anzufassen (Betreiber 2026-09-24): nur die Mitte wandert.
 * - **3D folgt wie eine Kamera hinter den Reisenden**: Sie blickt dorthin, wo der Pfeil gleich sein
 *   wird (`course`), und der Pfeil sitzt unter der Bildmitte, damit man sieht, wohin es geht. Die
 *   Neigung bleibt, wie man sie gewählt hat.
 * - **Mitte und Blickraum gehören der sichtbaren Kartenfläche** (WI-0039): Ist der Planer offen oder
 *   steht am Telefon die Leiste oben, folgt die Kamera in der freien Fläche daneben bzw. darunter.
 * - **Flughöhe:** Beginnt die Wiedergabe, steigt oder sinkt die Kamera weich auf einen festen Zoom,
 *   wie ein Navi (Betreiber 2026-09-25: „wenn es quasi mit dem flug losgeht auf eine bestimmte flughöhe
 *   zoomen (wie beim auto-navi), sodass man den pfeil besser im sichtfeld hat“). Wer zoomt, hält die
 *   Wiedergabe an. 🔴 **Selbst gewählter Zoom bleibt** (WI-0053, Betreiber 2026-09-27: „der zoom wird im
 *   playmode immer zurückgestellt, wär schön wenn er bleibt nachdem er mit dem mausrad geändert wurde“):
 *   Zoomt man mit Rad, Fingern, Doppelklick, Ring oder Taste, während der Pfeil auf der Karte ist, wird das die
 *   Flughöhe dieser Reise; ▶ geht dorthin statt auf `FLIGHT_ZOOM`. Eine neue Route beginnt wieder dort.
 * - **3D-Flug geneigt bis zum Anschlag** (Betreiber 2026-09-27: „und die neigung aufs maximum“): Beginnt die
 *   Wiedergabe in 3D, neigt sich die Kamera mit dem Steigen auf `FLIGHT_PITCH` (75°, die Neigung der Reise),
 *   begrenzt durch die Regel nach Zoom. In 2D bleibt die Karte flach.
 * - **Freie Kamera** (WI-0053): Bewegt man die Karte, läuft die Wiedergabe weiter (`use-playmode.ts`). Hier
 *   wird mitgehört, ob noch jemand auf der Karte ist (`watch`), und der Kompass führt während der Wiedergabe
 *   zum Pfeil zurück. Die Rückkehr (`rejoin`) fährt weich wie „Punkt zeigen“ (0,75 s) von der freien Kamera
 *   in die Folge hinein, bei „Bewegung reduzieren“ springt sie.
 * - **Geglättet:** Die Route knickt an jedem Stützpunkt. Pfeil und Kamera drehen deshalb weich nach,
 *   die Kamera träger als der Pfeil - über den kürzesten Winkel, sonst drehte sie an ±180° einmal
 *   ganz herum. Ein Sprung (Etappe, Anfang, Ende) dreht sofort.
 * - **Ruhig auch im Gebirge** (WI-0053, Betreiber 2026-09-27: „insbesondere bei gebirgen, wo es wild
 *   hin- und hergeht“): Die Kamera blickt ein festes Stück Weg auf dem Schirm voraus
 *   (`LOOK_AHEAD_PX`), nicht eine feste Zeit - im Gebirge kriecht der Pfeil, und 0,75 s Wiedergabe
 *   waren dort nur rund 90 px, jede Kehre ein Schwenk. Kleine Abweichungen lässt sie liegen
 *   (`DEAD_ZONE`): Sie dreht nur um das, was darüber hinausgeht, und das träger als zuvor. Gemessen
 *   auf Greifenfurt → Lowangen: 4 statt 22 °/s, 1,5 statt 7 Wenden je 10 s (Variante 4 im WI).
 * - **Spielraum statt Rutschen** (WI-0053 Stufe 2, Betreiber: „kann man auch die verschiebung beruhigen,
 *   wenn der pfeil haken schlägt?“, entschieden „3“): Vorwärts bleibt der Pfeil, wo er ist; seitlich
 *   darf er `spielraumPx` neben der Mitte wandern (mit dem Zoom wachsend), erst darüber hinaus rückt die Kamera nach - dasselbe
 *   Gummiband wie die Totzone der Drehung. Sonst schob jede Kehre die ganze Karte zur Seite.
 * - **Gelände:** Der Blickraum wird auf der Ebene durch den Pfeil gerechnet, nicht per `unproject` auf
 *   dem Hang, und die Kamera hält die Höhe des Bodens unter dem Pfeil, weich (`camera.follow`, `ground`).
 *   Sonst hüpfte der Pfeil über einem Kamm.
 * - **Im Flug** (WI-0051 F3, Betreiber 2026-09-28: „er soll in der luft mitfliegen“): Geneigt fliegt der Pfeil
 *   auf der Flugbahn (`traveler-layer.ts`), und die Kamera hält statt des Bodens seine Höhe (`altitude`),
 *   ebenso weich. Die Ebene durch den Pfeil liegt dann in dieser Höhe, und Blickraum und Spielraum bleiben,
 *   wie sie sind. Flach bleibt alles wie bisher.
 */

/** Wie träge der Pfeil und die Kamera der Fahrtrichtung folgen: Zeitkonstante in Sekunden. */
export const TURN_SECONDS = { arrow: 0.12, camera: 1.2 } as const;
/**
 * So weit blickt die Kamera entlang der Route voraus, in Bildpunkten beim aktuellen Zoom. 700 statt 400 seit 2026-10-17 (WI-0218): Auf der
 * Flughöhe 7,5 (`4d53f4167`) deckten 400 px nur noch 71 % des Bodens von Zoom 7, und die Karte rutschte im Gebirge seitlich mit 49–52 px/s
 * (Grenze 45). Der Betreiber wählte 2026-10-17 „Kamera ruhiger“ statt einer höheren Grenze (über die Orchestrierung); gemessen auf
 * Greifenfurt → Lowangen: 400 → 50, 566 → 44,5, 700 → 41, 900 → 35 px/s, Pfeil unverändert 93,7 px neben der freien Mitte.
 */
export const LOOK_AHEAD_PX = 700;
/** Um so viel Grad darf die Fahrtrichtung vom Blick abweichen, bevor die Kamera nachdreht. */
export const DEAD_ZONE = 10;
/**
 * So weit darf der Pfeil in 3D seitlich neben der Mitte wandern, in Bildpunkten bei `SPIELRAUM_ZOOM` … 🔴 Darüber wächst der Spielraum
 * mit dem Zoom (`spielraumPx`): Er ist eine Strecke auf dem Boden, keine feste Zahl Bildpunkte (WI-0248 S2, Betreiber 2026-10-23).
 * Die Kehren eines Passes werden mit dem Zoom breiter im Bild, ein fester Spielraum ließ sie bei Flughöhe 8 öfter aus dem Band laufen,
 * und die Karte rutschte seitlich (Greifenfurt → Lowangen, Sekunde 5–15: 54,5 px/s bei 80 px, 25,0 bei 160 px; bei Zoom 7 17,5; Grenze 45).
 */
export const SPIELRAUM_PX = 80;
/** Bei diesem Zoom misst der Spielraum `SPIELRAUM_PX` Bildpunkte (die Flughöhe, auf der er abgenommen wurde); darunter wird er nicht kleiner. */
export const SPIELRAUM_ZOOM = 7;
/** … höchstens aber dieser Teil der sichtbaren Breite (Telefon, sehr hoher Zoom): Der Pfeil läuft nie an den Bildrand. */
export const SPIELRAUM_SHARE = 0.2;
/** Der Spielraum in Bildpunkten bei diesem Zoom: dieselbe Bodenstrecke wie `SPIELRAUM_PX` bei `SPIELRAUM_ZOOM`, vor der Obergrenze. */
export function spielraumPx(zoom: number): number {
    return SPIELRAUM_PX * 2 ** Math.max(0, zoom - SPIELRAUM_ZOOM);
}
/**
 * Um so viel der sichtbaren Höhe steht der Pfeil in 3D unter der Mitte, genau auf dem Schirm (Blickraum vor
 * ihm). Betreiber 2026-09-27: „kannst du die kamera während des 3D flugs etwas mehr ins zentrum bringen
 * (vertikal)“ - vorher 18 %, gemessen als Punkt über dem Pfeil; geneigt landete der Pfeil damit bei rund 24 %.
 */
export const FOLLOW_AHEAD = 0.12;
/**
 * Bis zu dieser Neigung wachsen Blickraum und Spielraum mit ihr: Kippt man während der Wiedergabe zwischen 2D
 * und 3D, gleitet der Pfeil zwischen Mitte und seinem Platz darunter, statt an der Grenze zu springen.
 */
const TILT_EASE_IN = 20;
/** Unter dieser Neigung gilt die Karte als flach - 2D. */
const FLAT_PITCH = 0.5;
/** So lange gleitet die Kamera am Ziel aus der Folge in den Vogelflug, in Sekunden: weich wie „Punkt zeigen“ (`CAMERA_DURATION.point`). */
export const ORBIT_BLEND_SECONDS = CAMERA_DURATION.point / 1000;
/**
 * Der Auslauf vor dem Ziel (WI-0218, Betreiber 2026-10-17: am Übergang in den Vogelflug „kein sprung“; 2026-10-14: „nicht aprupt
 * stoppt“): So viele Male den Abstand zwischen Pfeil und Mitte vor dem Ziel beginnt die Kamera zu bremsen, und der Pfeil rückt dabei in
 * die Mitte. Kein Stellwert, sondern gerechnet: Fährt der Pfeil gleichmäßig weiter und bremst die Mitte gleichmäßig auf null, braucht
 * sie genau den doppelten Abstand (`brake`).
 */
export const BRAKE_SHARE = 2;

/**
 * Der Weg der Mitte im Auslauf, kubisch (Hermite): von `from` mit der Steigung `slope` (Änderung je Einheit Weg des Pfeils, mal `span`)
 * nach `to`, dort in Ruhe. `s` ist der Anteil des Auslaufs, den der Pfeil schon gefahren ist, 0…1.
 */
export function brakePath(
    from: { x: number; y: number },
    slope: { x: number; y: number },
    to: { x: number; y: number },
    s: number,
): { x: number; y: number } {
    const t = Math.min(1, Math.max(0, s));
    const h00 = 2 * t ** 3 - 3 * t ** 2 + 1;
    const h10 = t ** 3 - 2 * t ** 2 + t;
    const h01 = -2 * t ** 3 + 3 * t ** 2;
    return { x: from.x * h00 + slope.x * h10 + to.x * h01, y: from.y * h00 + slope.y * h10 + to.y * h01 };
}
/**
 * Die Flughöhe der Wiedergabe: nah genug für den Pfeil, weit genug für die Gegend. 8 seit 2026-10-18 (Betreiber, mit der Abnahme von
 * WI-0218, wörtlich: „kannst du die reisehöhe der zoomkamera beim playbutton flug auf 8 setzen“); davor 7,5 (2026-10-14), 7.
 */
export const FLIGHT_ZOOM = 8;
/** So lange nach Rad, Fingern oder Doppelklick gilt ein Zoomende als selbst gewählt, in Millisekunden. */
const GESTURE_ZOOM_MS = 1000;
/** So lange steigt oder sinkt die Kamera auf die Flughöhe, in Sekunden. */
export const CLIMB_SECONDS = 1.2;

/** Der Zoom unterwegs zur Flughöhe: weich auslaufend, nach Zeit, nicht nach Bildern. */
export function climbZoom(from: number, to: number, seconds: number, duration: number = CLIMB_SECONDS): number {
    if (duration <= 0 || seconds >= duration) return to;
    const share = 1 - (1 - Math.max(0, seconds) / duration) ** 3;
    return from + (to - from) * share;
}

/**
 * Wohin die Kamera dreht (Totzone): Liegt die Fahrtrichtung höchstens `zone` Grad neben dem Blick,
 * bleibt der Blick; sonst nur um das, was darüber hinausgeht - wie an einem Gummiband.
 */
export function outsideDeadZone(bearing: number, course: number, zone: number): number {
    const off = normalizeBearing(course - bearing);
    return Math.abs(off) <= zone ? bearing : normalizeBearing(bearing + off - Math.sign(off) * zone);
}

/**
 * Karteneinheiten je Bildpunkt an dieser Stelle der Karte, bei diesem Zoom und flach von oben: MapLibres
 * Welt ist `512 · 2^zoom` Bildpunkte breit. Gerechnet über die Projektion der Karte, nicht als feste Zahl
 * (heute 1/64 Einheit je Bildpunkt bei Zoom 7, überall gleich) - so kommt ein Wechsel der Projektion mit.
 */
export function mapUnitsPerPixel(point: { x: number; y: number }, zoom: number): number {
    const space = AVENTURIA.coordinateSpace;
    const world = (at: { x: number; y: number }): { x: number; y: number } => {
        const { lng, lat } = toRenderLngLat(space, at);
        return { x: lng / 360, y: Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / (2 * Math.PI) };
    };
    const from = world(point);
    const to = world({ x: point.x + 1, y: point.y });
    const pixels = Math.hypot(to.x - from.x, to.y - from.y) * 512 * 2 ** zoom;
    return pixels > 0 ? 1 / pixels : 0;
}

/**
 * Der Punkt, dem die Kamera folgt (Spielraum): vorwärts genau mit dem Pfeil, seitlich darf der Pfeil `band`
 * Karteneinheiten neben ihm liegen - nur was darüber hinausgeht, zieht ihn nach. `bearing` ist der Blick.
 */
export function keepInBand(
    anchor: { x: number; y: number },
    arrow: { x: number; y: number },
    bearing: number,
    band: number,
): { x: number; y: number } {
    // Karten-y wächst nach Norden: vorwärts (sin b, cos b), rechts (cos b, −sin b).
    const b = (bearing * Math.PI) / 180;
    const dx = arrow.x - anchor.x;
    const dy = arrow.y - anchor.y;
    const ahead = dx * Math.sin(b) + dy * Math.cos(b);
    const side = dx * Math.cos(b) - dy * Math.sin(b);
    const shift = Math.abs(side) <= band ? 0 : side - Math.sign(side) * band;
    return {
        x: anchor.x + Math.sin(b) * ahead + Math.cos(b) * shift,
        y: anchor.y + Math.cos(b) * ahead - Math.sin(b) * shift,
    };
}

/** Ein Winkel, der sich einem Ziel über den kürzesten Weg nähert: exponentiell, nach Zeit, nicht nach Bildern. */
export function turnTowards(current: number, target: number, seconds: number, tau: number): number {
    const share = tau <= 0 ? 1 : 1 - Math.exp(-Math.max(0, seconds) / tau);
    return normalizeBearing(current + normalizeBearing(target - current) * share);
}

/** Das Ziel der Reise und wie weit der Pfeil noch fährt, in Karteneinheiten auf der gezeichneten Linie. */
export interface TravelerGoal {
    readonly x: number;
    readonly y: number;
    readonly rest: number;
}

export interface TravelerView {
    show(position: TravelerPosition | null): void;
    /** `goal`: das Ziel und der Weg dorthin in Karteneinheiten; davor bremst die Kamera in 3D aus (`BRAKE_SHARE`). */
    follow(position: TravelerPosition, jump: boolean, course: number, goal?: TravelerGoal): void;
    /**
     * Die Kamera fliegt zum Pfeil - beim Start der Wiedergabe und nach einem Sprung der Leiste (Kamerakanon
     * 2026-09-29: sie springt nie). Endet dort, wo das erste Folgebild beginnt. Gibt `true` zurück, sobald sie
     * angekommen ist, `false`, wenn die Fahrt vorher endet.
     */
    approach(position: TravelerPosition, course: number): Promise<boolean>;
    /** Wie weit die Kamera voraus blickt, in Karteneinheiten: `LOOK_AHEAD_PX` beim aktuellen Zoom. */
    lookAhead(position: TravelerPosition): number;
    /** Die Wiedergabe beginnt: auf Flughöhe - bei „Bewegung reduzieren“ ohne Fahrt. */
    takeOff(reducedMotion: boolean): void;
    /** Während der Wiedergabe: Eingaben auf der Karte und den Kompass melden; gibt die Abmeldung zurück. */
    watch(listeners: { activity(): void; compass(): void }): () => void;
    /** Die freie Kamera kehrt zum Pfeil zurück: weich, bei „Bewegung reduzieren“ sofort. */
    rejoin(reducedMotion: boolean): void;
    /**
     * Der Vogelflug am Ziel (Betreiber 2026-10-14): Die Kamera dreht sich um die Zielstelle, `drehung` Grad je Bild.
     * Die Mitte rückt dabei nicht voraus - das Ziel steht, der Blick wandert um es herum.
     */
    orbit(position: TravelerPosition, drehung: number): void;
    /** Die Kamera folgt nicht mehr (angehalten oder frei). */
    letGo(): void;
    /** Der Pfeil, wie er gerade steht - für einen neu gebauten Stil. */
    current(): TravelerPosition | null;
}

/**
 * @param flightHeight - auf einem Flug die Höhe seiner Bahn über dem Pfeil, wie die Flugbahn sie zeichnet
 *   (`flight-arcs.ts`); ohne sie folgt die Kamera immer dem Boden.
 * @param interaction - der Koordinator der Karteninteraktion, der meldet, ob noch jemand auf der Karte ist
 *   (`watch`); ohne ihn hört die Ansicht nicht zu, und die freie Kamera kehrt nur nach der Ruhezeit zurück.
 */
export function createTravelerView(
    map: () => MapLibreMap | undefined,
    camera: () => Camera | undefined,
    now: () => number = () => performance.now(),
    flightHeight?: TravelerFlightHeight,
    interaction?: () => MapInteractionCoordinator | undefined,
): TravelerView {
    const space = AVENTURIA.coordinateSpace;
    let shown: TravelerPosition | null = null;
    let arrowHeading: number | undefined;
    let cameraBearing: number | undefined;
    let lastArrow: number | undefined;
    let lastCamera: number | undefined;
    let climb: { from: number; pitch: number | undefined; start: number; duration: number } | undefined;
    /** Der Punkt, dem die Kamera in 3D folgt, in Kartenkoordinaten - der Pfeil wandert im Spielraum darum. */
    let anchor: { x: number; y: number } | undefined;
    /** Die Rückkehr einer freien Kamera: von wo, seit wann - die Folge blendet über. */
    let returning:
        { centre: [number, number]; bearing: number; pitch: number; zoom: number; start: number } | undefined;
    /** Die Flughöhe, die man auf dieser Reise selbst gewählt hat - sonst `FLIGHT_ZOOM`. */
    let chosenZoom: number | undefined;
    /** Das letzte Ziel der Folge (was in der Mitte der freien Fläche lag): Dort beginnt der Vogelflug am Ziel. */
    let lastTarget: [number, number] | undefined;
    /** Wie schnell die Folge zuletzt drehte, in Grad je Sekunde: Der Vogelflug dreht von dort an, nicht aus dem Stand. */
    let turnRate = 0;
    /** Das letzte Folgebild vor dem Auslauf (Mitte, Rest) und der Auslauf selbst, sobald er begonnen hat (`brake`). */
    let lastFollow: { centre: { x: number; y: number }; rest: number } | undefined;
    let braking: { from: { x: number; y: number }; slope: { x: number; y: number }; rest: number } | undefined;
    /** Der Übergang der Folge in den Vogelflug: von wo, mit welcher Drehung, seit wann (`ORBIT_BLEND_SECONDS`). */
    let landing: { from: [number, number]; rate: number; start: number } | undefined;
    /** Die Karte, deren Zoomgesten mitgehört werden, und die Kamera, deren Zoom über Ring und Tasten. */
    let heard: MapLibreMap | undefined;
    let heardCamera: Camera | undefined;
    let unhearCamera: (() => void) | undefined;
    /** Wann zuletzt Rad, Finger oder Doppelklick auf der Karte waren. */
    let gestureAt = Number.NEGATIVE_INFINITY;
    /**
     * 🪤 MapLibres Radzoom meldet sein `zoomend` ohne `originalEvent` (gemessen 2026-09-27): Die Geste wird
     * deshalb an der Karte selbst gehört, und das nächste Zoomende gilt ihr - Planer, Ring und Folgeschritte
     * zoomen ohne Geste.
     */
    const hearGesture = (): void => {
        gestureAt = now();
    };
    const hearZoom = (): void => {
        if (shown && heard && now() - gestureAt <= GESTURE_ZOOM_MS) chosenZoom = heard.getZoom();
    };
    const GESTURES = ["wheel", "dblclick", "touchstart"] as const;
    const listen = (target: MapLibreMap): void => {
        if (heard === target && heardCamera === camera()) return;
        if (heard) {
            heard.off("zoomend", hearZoom);
            for (const type of GESTURES) heard.getCanvasContainer().removeEventListener(type, hearGesture, true);
        }
        heard = target;
        target.on("zoomend", hearZoom);
        const view = camera();
        if (view && view !== heardCamera) {
            unhearCamera?.();
            heardCamera = view;
            unhearCamera = view.onZoomChoice((zoom) => {
                if (shown) chosenZoom = zoom;
            });
        }
        for (const type of GESTURES)
            target.getCanvasContainer().addEventListener(type, hearGesture, { capture: true, passive: true });
    };

    /** Zoom und (in 3D) Neigung dieses Bildes, solange die Kamera auf Flughöhe geht - sonst keine. */
    const climbing = (): { zoom: number; pitch: number | undefined } | undefined => {
        if (!climb) return undefined;
        const seconds = (now() - climb.start) / 1000;
        const to = chosenZoom ?? flugHoehe(FLIGHT_ZOOM);
        const zoom = climbZoom(climb.from, to, seconds, climb.duration);
        const pitch =
            climb.pitch === undefined
                ? undefined
                : clampPitch(climbZoom(climb.pitch, flugNeigung(to), seconds, climb.duration), zoom);
        if (seconds >= climb.duration) climb = undefined;
        return { zoom, pitch };
    };

    const renderPoint = (point: { x: number; y: number }): [number, number] => {
        const lngLat = toRenderLngLat(space, point);
        return [lngLat.lng, lngLat.lat];
    };

    /**
     * Der Auslauf vor dem Ziel (`BRAKE_SHARE`; gemessen vorher Gareth → Perricum: 450 px/s auf null in einem Bild, dann bis 300 px/s
     * rückwärts in den Vogelflug). Ist der Rest kürzer als der doppelte Abstand zwischen Pfeil und Mitte, fährt die Mitte nicht mehr voraus,
     * sondern auf das Ziel zu: vom letzten Folgebild aus, mit der Geschwindigkeit, die sie dort hatte, und am Ziel in Ruhe, genau wenn der
     * Pfeil ankommt (`brakePath`). Der Pfeil fährt dabei in die Mitte. Gerechnet über den Weg des Pfeils, nicht die Zeit, damit
     * jede Geschwindigkeit der Reise passt. 🪤 Nicht entlang der Blickrichtung: Biegt die Straße vor dem Ziel ab, lief die Mitte so im
     * letzten Bild zurück.
     */
    const brake = (
        follow: [number, number],
        position: { x: number; y: number },
        goal: TravelerGoal | undefined,
        bearing: number,
    ): [number, number] => {
        const centre = fromRenderLngLat(space, { lng: follow[0], lat: follow[1] });
        const zone = BRAKE_SHARE * Math.hypot(centre.x - position.x, centre.y - position.y);
        if (goal === undefined || !(zone > 0) || goal.rest >= zone) {
            braking = undefined;
            lastFollow = goal === undefined ? undefined : { centre, rest: goal.rest };
            return follow;
        }
        if (braking === undefined) {
            // Die Steigung des letzten Folgebilds je Einheit Weg; ohne eines (ein Sprung in den Auslauf) in Blickrichtung.
            const b = (bearing * Math.PI) / 180;
            const travelled = lastFollow ? lastFollow.rest - goal.rest : 0;
            const perUnit =
                lastFollow && travelled > 1e-9
                    ? {
                          x: (centre.x - lastFollow.centre.x) / travelled,
                          y: (centre.y - lastFollow.centre.y) / travelled,
                      }
                    : { x: Math.sin(b), y: Math.cos(b) };
            braking = { from: centre, slope: { x: perUnit.x * goal.rest, y: perUnit.y * goal.rest }, rest: goal.rest };
        }
        lastFollow = undefined;
        const s = braking.rest > 0 ? 1 - goal.rest / braking.rest : 1;
        return renderPoint(brakePath(braking.from, braking.slope, goal, s));
    };

    /**
     * Ein Folgebild, auf dem Weg zurück von der freien Kamera übergeblendet: Mitte, Drehung (über den kürzesten
     * Winkel), Neigung und Zoom laufen weich auslaufend vom freien Blick in die Folge.
     */
    const blend = (view: { centre: [number, number]; bearing: number; pitch: number; zoom: number }): typeof view => {
        if (!returning) return view;
        const seconds = (now() - returning.start) / 1000;
        const duration = CAMERA_DURATION.point / 1000;
        const share = climbZoom(0, 1, seconds, duration);
        const from = returning;
        if (seconds >= duration) returning = undefined;
        const mix = (a: number, b: number): number => a + (b - a) * share;
        return {
            centre: [mix(from.centre[0], view.centre[0]), mix(from.centre[1], view.centre[1])],
            bearing: normalizeBearing(from.bearing + normalizeBearing(view.bearing - from.bearing) * share),
            pitch: mix(from.pitch, view.pitch),
            zoom: mix(from.zoom, view.zoom),
        };
    };

    /**
     * Zoom und (in 3D) Neigung, bei denen die Kamera auf Flughöhe ankommt: was `climbing()` am Ende der Fahrt
     * liefert. Der Flug zum Start (`approach`) trägt sie selbst, statt dass ein Bild sie nachzieht.
     */
    const arrivalStep = (): { zoom: number; pitch: number | undefined } | undefined => {
        if (!climb) return undefined;
        const to = chosenZoom ?? flugHoehe(FLIGHT_ZOOM);
        return { zoom: to, pitch: climb.pitch === undefined ? undefined : clampPitch(flugNeigung(to), to) };
    };

    /**
     * Die Kamera zu diesem Pfeil: Bild für Bild (`follow`) oder, wo der Pfeil an ein neues Ziel gerückt ist, im Flug
     * (`arrive`: Kamerakanon 2026-09-29, sie springt nie). Beides rechnet dieselbe Stellung - der Flug endet dort, wo
     * das erste Folgebild beginnt, damit an der Naht nichts springt.
     */
    const track = (
        position: TravelerPosition,
        jump: boolean,
        course: number,
        arrive: boolean,
        goal?: TravelerGoal,
    ): Promise<boolean> | undefined => {
        const target = map();
        const view = camera();
        if (!target || !view) return undefined;
        // Der Flug trägt Zoom und Neigung selbst; eine Überblendung der freien Kamera ist damit vorbei.
        const step = arrive ? arrivalStep() : climbing();
        if (arrive) {
            climb = undefined;
            returning = undefined;
        }
        let flight: Promise<boolean> | undefined;
        // Die Folge läuft (wieder): Ein Vogelflug danach beginnt bei ihrem letzten Ziel.
        landing = undefined;
        const deliver = (centre: [number, number], shot: Parameters<Camera["follow"]>[1]): void => {
            lastTarget = centre;
            if (!arrive) {
                view.follow(centre, shot);
                return;
            }
            flight = view.approach(centre, {
                ...(shot?.bearing === undefined ? {} : { bearing: shot.bearing }),
                ...(shot?.pitch === undefined ? {} : { pitch: shot.pitch }),
                ...(shot?.zoom === undefined ? {} : { zoom: shot.zoom }),
            });
        };
        const zoom = step?.zoom;
        const pitch = step?.pitch ?? view.state().pitch;
        if (pitch <= FLAT_PITCH) {
            cameraBearing = undefined;
            anchor = undefined;
            turnRate = 0;
            braking = undefined;
            lastFollow = undefined;
            if (returning) {
                const shot = blend({
                    centre: renderPoint(position),
                    bearing: view.state().bearing,
                    pitch,
                    zoom: zoom ?? target.getZoom(),
                });
                deliver(shot.centre, { zoom: shot.zoom });
                return flight;
            }
            deliver(renderPoint(position), zoom === undefined ? undefined : { zoom });
            return flight;
        }
        const time = now();
        // Ein Sprung blickt gleich in Fahrtrichtung. Kommt die Kamera aus 2D (per 3D-Knopf während der
        // Wiedergabe), beginnt sie beim Blick, den die Karte hat, und dreht weich hinein.
        const since = lastCamera === undefined ? 0 : Math.min(0.25, (time - lastCamera) / 1000);
        const before = cameraBearing ?? view.state().bearing;
        cameraBearing = jump
            ? course
            : turnTowards(before, outsideDeadZone(before, course, DEAD_ZONE), since, TURN_SECONDS.camera);
        turnRate = jump || since <= 0 ? 0 : normalizeBearing(cameraBearing - before) / since;
        lastCamera = time;
        const tiltShare = Math.min(1, pitch / TILT_EASE_IN);
        // Gemessen an der sichtbaren Fläche, nicht am ganzen Canvas.
        const canvas = target.getCanvas();
        const visible = visibleRect({ width: canvas.clientWidth, height: canvas.clientHeight }, view.insets());
        const followZoom = zoom ?? target.getZoom();
        const unitsPerPixel = mapUnitsPerPixel(position, followZoom);
        const band = Math.min(spielraumPx(followZoom), visible.width * SPIELRAUM_SHARE) * unitsPerPixel * tiltShare;
        anchor =
            jump || anchor === undefined
                ? { x: position.x, y: position.y }
                : keepInBand(anchor, position, cameraBearing, band);
        // Die Mitte rückt voraus, damit der Pfeil unter ihr steht und man sieht, wohin es geht: genau `FOLLOW_AHEAD` der sichtbaren
        // Höhe unter der Mitte der freien Fläche. 🪤 Seit WI-0218 bleibt der Fluchtpunkt in der Bildmitte, und neben ihm laufen die
        // Linien in Blickrichtung schräg: Ein Punkt voraus auf dem Boden ließ den Pfeil bei offenem Planer seitlich der Mitte stehen
        // (gemessen 2026-10-17, 1280 × 720, 65°: 30 px). Gerechnet wird darum im Bild (`target-centre.ts`), und das Ziel der Folge ist,
        // was danach in der Mitte der freien Fläche liegt.
        const look = { zoom: zoom ?? target.getZoom(), bearing: cameraBearing, pitch };
        const middle = visibleCentre({ width: canvas.clientWidth, height: canvas.clientHeight }, view.insets());
        const below = visible.height * FOLLOW_AHEAD * tiltShare;
        const placed = centreFor(target, renderPoint(anchor), look, { x: middle.x, y: middle.y + below });
        const ahead = locationAt(target, look, placed, middle);
        // Ein Sprung oder ein Anflug beginnt keinen Auslauf aus einem alten Bild.
        if (jump || arrive) {
            braking = undefined;
            lastFollow = undefined;
        }
        const centre = brake(ahead, position, goal, cameraBearing);
        // Im Flug hält die Kamera die Höhe der Bahn über dem Pfeil statt des Bodens (WI-0051 F3).
        const air = flightHeight?.(position);
        const altitude = air ? { altitude: air.meters } : {};
        if (returning) {
            const shot = blend({
                centre,
                bearing: cameraBearing,
                pitch,
                zoom: zoom ?? target.getZoom(),
            });
            deliver(shot.centre, {
                bearing: shot.bearing,
                pitch: shot.pitch,
                zoom: shot.zoom,
                ground: renderPoint(position),
                ...altitude,
            });
            return flight;
        }
        deliver(centre, {
            bearing: cameraBearing,
            ground: renderPoint(position),
            ...altitude,
            // Ein Sprung setzt auch die Höhe gleich auf den Boden.
            settle: jump,
            ...(zoom === undefined ? {} : { zoom }),
            ...(step?.pitch === undefined ? {} : { pitch }),
        });
        return flight;
    };

    return {
        current: () => shown,
        show(position) {
            if (!position) {
                shown = null;
                arrowHeading = undefined;
                cameraBearing = undefined;
                // Kein Pfeil mehr heißt neue Reise (oder keine): Sie beginnt wieder auf der üblichen Flughöhe.
                chosenZoom = undefined;
                lastTarget = undefined;
                landing = undefined;
            } else {
                const time = now();
                arrowHeading =
                    arrowHeading === undefined || lastArrow === undefined
                        ? position.heading
                        : turnTowards(arrowHeading, position.heading, (time - lastArrow) / 1000, TURN_SECONDS.arrow);
                lastArrow = time;
                shown = { x: position.x, y: position.y, heading: arrowHeading };
                // Auf welchem Abschnitt, wie weit: Auf einem Flug findet der Pfeil so die Höhe seiner Bahn.
                if (position.segment !== undefined) shown.segment = position.segment;
                if (position.along !== undefined) shown.along = position.along;
            }
            // Gezeichnet wird er von seiner Ebene im nächsten Bild (`traveler-layer.ts`), mit derselben Kamera.
            map()?.triggerRepaint();
        },
        lookAhead(position) {
            const target = map();
            return target ? LOOK_AHEAD_PX * mapUnitsPerPixel(position, target.getZoom()) : 0;
        },
        watch(listeners) {
            // Jede Eingabe auf der Karte heißt „es ist noch jemand da“: Der Koordinator der Karteninteraktion
            // meldet sie (`observe("activity")`, M8), statt dass hier eigene Zuhörer an der Karte hängen.
            const unobserve = interaction?.()?.observe("activity", () => listeners.activity());
            // Nur während der Wiedergabe führt der Kompass zum Pfeil zurück, sonst richtet er nach Norden aus.
            const unclaim = camera()?.claimNorth(() => listeners.compass());
            return () => {
                unobserve?.();
                unclaim?.();
            };
        },
        letGo() {
            camera()?.unfollow();
        },
        rejoin(reducedMotion) {
            const target = map();
            if (!target || reducedMotion) {
                returning = undefined;
                return;
            }
            const { lng, lat } = target.getCenter();
            const look = { zoom: target.getZoom(), bearing: target.getBearing(), pitch: target.getPitch() };
            const canvas = target.getCanvas();
            // Übergeblendet wird zwischen Zielen der Folge, also dem, was in der Mitte der freien Fläche liegt (WI-0218), nicht der
            // Kartenmitte: Sonst rückte das erste Bild der Rückkehr um den Abstand der beiden Mitten.
            const middle = visibleCentre(
                { width: canvas.clientWidth, height: canvas.clientHeight },
                camera()?.insets() ?? {},
            );
            returning = {
                centre: locationAt(target, look, [lng, lat], middle),
                ...look,
                start: now(),
            };
        },
        takeOff(reducedMotion) {
            const target = map();
            if (!target) return;
            listen(target);
            const pitch = target.getPitch();
            climb = {
                from: target.getZoom(),
                pitch: pitch > FLAT_PITCH ? pitch : undefined,
                start: now(),
                duration: reducedMotion ? 0 : CLIMB_SECONDS,
            };
        },
        follow(position, jump, course, goal) {
            void track(position, jump, course, false, goal);
        },
        /**
         * Der Vogelflug am Ziel (WI-0142, Betreiber 2026-10-14): Die Kamera dreht sich um die Zielstelle, `drehung`
         * Grad je Bild. Anders als beim Folgen rückt die Mitte NICHT voraus - das Ziel soll stehen bleiben, während
         * sich der Blick um es herum bewegt. Neigung und Zoom bleiben, wie die Reise sie hatte.
         *
         * 🔴 Die Kamera springt nie (Betreiber 2026-10-17 über die Orchestrierung: „ich will aber auch dass am ende des routeflugs im den
         * übergang in den helikopter-flug kein sprung ist“): Bis zum letzten Bild stand die Mitte voraus, der Pfeil 12 % darunter und im
         * Spielraum daneben; der Vogelflug stellt das Ziel in die Mitte. Er gleitet darum vom letzten Ziel der Folge dorthin, weich an- und
         * auslaufend in `ORBIT_BLEND_SECONDS`, und dreht dabei schon.
         */
        orbit(position, drehung) {
            const target = map();
            const view = camera();
            if (!target || !view) return;
            anchor = { x: position.x, y: position.y };
            const time = now();
            const since = lastCamera === undefined ? 0 : Math.min(0.25, (time - lastCamera) / 1000);
            lastCamera = time;
            const goal = renderPoint(position);
            landing ??= { from: lastTarget ?? goal, rate: turnRate, start: time };
            lastTarget = undefined;
            // Weich an- und auslaufend (smoothstep): Die Mitte stand am Ende der Reise still, sie fährt ohne Ruck los. Ebenso die
            // Drehung: von der der Folge (vor dem Ziel meist keine) in die des Vogelflugs, nicht in einem Bild.
            const along = Math.min(1, (time - landing.start) / 1000 / ORBIT_BLEND_SECONDS);
            const share = along * along * (3 - 2 * along);
            cameraBearing = normalizeBearing(
                (cameraBearing ?? view.state().bearing) + drehung * share + landing.rate * since * (1 - share),
            );
            const centre: [number, number] = [
                landing.from[0] + (goal[0] - landing.from[0]) * share,
                landing.from[1] + (goal[1] - landing.from[1]) * share,
            ];
            const air = flightHeight?.(position);
            view.follow(centre, {
                bearing: cameraBearing,
                ground: renderPoint(position),
                ...(air ? { altitude: air.meters } : {}),
            });
        },
        approach(position, course) {
            // Ohne Karte oder Kamera gibt es nichts zu fliegen: angekommen.
            return track(position, true, course, true) ?? Promise.resolve(true);
        },
    };
}

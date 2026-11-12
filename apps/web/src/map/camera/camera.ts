import type { LngLat, LngLatLike, Map as MapLibreMap } from "maplibre-gl";
import {
    begleitNeigung,
    boundsMiddle,
    clampPitch,
    flightDuration,
    FLIGHT_PITCH,
    maxPitchForZoom,
    neigungBeimZoom,
    neigungNachZoom,
    nextCompassBearing,
    normalizeBearing,
    shiftCenter,
} from "./camera-math";
import { mitteFuer, ortUnterAnker, type AnkerTransform, type Bildpunkt } from "./neigung-anker";
import { installHorizonQueryFix } from "./query-horizont";
import { centreFor, locationAt, type ScreenPoint } from "./target-centre";
import { leavesGap, mergeInsets, NO_INSETS, sameInsets, visibleCentre, visibleRect, type Insets } from "./visible-area";

/**
 * Die eine Stelle, über die das Programm die Kamera bewegt (WI-0016, WI-0039).
 *
 * 🔴 Steuerring, 3D-Knopf, Tastatur, Suche, Planer und Playmode rufen NUR diese Schnittstelle. Wer
 * irgendwo sonst `easeTo` oder `flyTo` aufruft, baut eine zweite Kamera - mit eigener Dauer, und eine
 * Taste während ihrer Fahrt rechnet vom falschen Stand.
 *
 * 🔴 **Dieselbe Absicht, dasselbe Verhalten** (Betreiber 2026-09-26), nicht „derselbe Ort, dieselbe
 * Kamera“. Die Methoden sind nach Absicht benannt, nicht nach dem Bauteil, das sie ruft:
 *
 * 1. **Punkt zeigen** (`showPoint`): in die sichtbare Mitte, heran nur bis zur Mindestnähe, nie heraus.
 * 2. **Ausschnitt zeigen** (`showBounds`, `showView`): einpassen, auch heraus.
 * 3. **Manuell navigieren** (Ring, Tasten): um die sichtbare Mitte. Maus und Finger gehören MapLibre.
 * 4. **Reise folgen** (`follow`): der Playmode.
 *
 * ⭐ Alles bezieht sich auf die sichtbare Kartenfläche (`visible-area.ts`, E1), und die Drehung bleibt
 * immer, wie man sie gewählt hat; die Neigung höchstens bis zur Grenze des Zooms (K11, D3).
 *
 * 🔴 Seit WI-0218 ist die Fläche nicht mehr MapLibres `padding`: Der Fluchtpunkt bleibt in der Bildmitte, und jede Fahrt rechnet ihr
 * Ziel selbst in die Mitte der freien Fläche (`target-centre.ts`). Ring und Tasten drehen, neigen und zoomen um diese Mitte.
 *
 * ⭐ Alle Fahrten sind `essential: false`: MapLibre lässt sie bei „Bewegung reduzieren" springen,
 * statt zu fahren. Das ist Kanon (Design Guide § 29.1: „schaltet ab, es verlangsamt nicht").
 *
 * 🔴 **Die Kamera springt nie** (Betreiber 2026-09-29, Design Guide § 17): Jeder Wechsel zu einem neuen Ziel
 * fliegt - Punkt, Ausschnitt, Ring, Tasten und der Anflug des Playmodes (`approach`). Ein Sprung ist nur erlaubt
 * für das Folgen Bild für Bild (`follow`), bei „Bewegung reduzieren“, für direkte Gesten, den Innenabstand und den
 * ersten Blick. Jeder solche Aufruf steht mit `Kamera-Sprung erlaubt (…): Grund` im Code; ein Test
 * (`camera-never-jumps.test.ts`) lässt keinen anderen zu.
 */

export interface CameraState {
    /** Himmelsrichtung am oberen Bildrand, (−180, 180]. */
    bearing: number;
    /** Neigung in Grad, 0 = Draufsicht. */
    pitch: number;
    /** MapLibre-Zoom. */
    zoom: number;
}

/** Ein Rand in Bildpunkten, je Seite. */
export type CameraPadding = Insets;

/** Wohin eine Fahrt geht: der ganze Blick, samt Mitte. */
interface CameraGoal extends CameraState {
    center: [number, number];
}

/**
 * Wohin ein Punkt fliegt, wenn nach der Landung ein Werkzeug aufgeht (WI-0128 E7, EDIT-0001 §4.5, W5).
 *
 * - `free`: was nach der Landung zusätzlich gedeckt ist, je Seite in Bildpunkten (der Ortseditor, der erst danach aufgeht). Je
 *   Seite gilt das Größere aus diesem Wert und dem, was die Panels schon decken (`keepFree`). Ziel ist die Mitte DIESER Fläche,
 *   nicht die Bildmitte: Der Ort liegt nach dem Öffnen nicht unter dem Fenster.
 * - `onlyIfHidden`: Liegt der Punkt schon mit Rand (`fitMargin`) in dieser Fläche und ist die Mindestnähe erreicht, fliegt nichts.
 * - `onlyIfCovered`: wie `onlyIfHidden`, aber ohne Rand: Nur ein Punkt, den nach der Landung ein Panel oder Fenster deckt, kommt in die
 *   Mitte der freien Fläche (WI-0218 Nachbesserung, ein Klick öffnet einen Editor). Bleibt keine Lücke, bewegt sich nichts.
 *
 * Bleibt neben Panels und Fenster keine Lücke (`leavesGap`, Planer und angedocktes Fenster bei 1280 px), zielt die Kamera wie ohne
 * `free`: Man sieht das Ziel, sobald das Fenster geht.
 */
export interface PointOptions {
    free?: Partial<CameraPadding>;
    onlyIfHidden?: boolean;
    onlyIfCovered?: boolean;
}

export interface Camera {
    state(): CameraState;
    /**
     * Der Bezug der Mitte: was die Panels von der Karte nehmen, ohne Seitenleisten (`visible-area.ts`). In seiner Mitte landet, was die
     * Kamera zeigt; bis WI-0218 war er MapLibres `padding`.
     */
    insets(): CameraPadding;
    /** Meldet jede Kamerabewegung; gibt die Abmeldung zurück. */
    onChange(listener: (state: CameraState) => void): () => void;
    zoomBy(delta: number): void;
    /**
     * Meldet jeden Zoom über Ring oder Taste mit seinem Ziel (WI-0053: Im Playmode bleibt er beim nächsten ▶,
     * Betreiber 2026-09-27: „zoom soll auch erhalten bleiben ja“). Gibt die Abmeldung zurück.
     */
    onZoomChoice(listener: (zoom: number) => void): () => void;
    panBy(dx: number, dy: number): void;
    /** Blick nach rechts (positiv) oder links (negativ), in Grad. */
    rotateBy(degrees: number): void;
    /** Stärker (positiv) oder flacher (negativ) neigen, in Grad. */
    tiltBy(degrees: number): void;
    /** Zur nächsten der acht Himmelsrichtungen: `1` nach rechts, `-1` nach links. */
    rotateToNextDirection(step: 1 | -1): void;
    /** Nach Norden ausrichten - oder, solange jemand den Kompass beansprucht (`claimNorth`), dessen Wunsch. */
    northUp(): void;
    /**
     * Den Kompass beanspruchen (WI-0053): Während der Wiedergabe führt er zum Pfeil zurück, statt nach Norden zu
     * drehen (Betreiber 2026-09-27: „oder man den compass drückt … aber nur im playmode“). Gibt die Freigabe zurück.
     */
    claimNorth(handler: () => void): () => void;
    /** 3D-Knopf: flach ↔ 45° (höchstens bis zur Grenze nach Zoom). Die Drehung bleibt. */
    toggleTilt(): void;
    /** Norden und flach zugleich (Taste 0). */
    resetAll(): void;
    /**
     * Punkt zeigen (E2): den Ort in die sichtbare Mitte. Heran nur, bis `nearZoom` erreicht ist -
     * wer schon näher ist, bleibt so nah (`max(aktuell, nearZoom)`). Mit `options` in die Mitte der freien Fläche nach der
     * Landung (`PointOptions`, WI-0128 E7).
     *
     * Gibt wie `approach` zurück, wie der Flug endet: `true` angekommen (auch ohne Flug und bei „Bewegung reduzieren“), `false`,
     * wenn er vorher endet (Geste, ein neuer Flug) oder die Kamera gerade dem Pfeil folgt.
     */
    showPoint(center: [number, number], nearZoom: number, options?: PointOptions): Promise<boolean>;
    /**
     * Ausschnitt zeigen: den Umriss in die sichtbare Fläche einpassen, mit Rand (`FIT_MARGIN`).
     * Grenzen in Renderkoordinaten. `maxZoom` deckelt, wie nah ein kleiner Umriss heranholt (WI-0044). `minZoom` deckelt, wie weit
     * hinaus: Passt der Umriss darüber nicht ganz hinein, rückt nur seine Mitte in die freie Fläche (Formmodi, Betreiber 2026-10-19
     * „formmodus A“). `free` wie bei `showPoint`: was nach der Landung zusätzlich gedeckt ist. Das Ergebnis wie bei `showPoint`.
     */
    showBounds(
        bounds: [[number, number], [number, number]],
        options?: { maxZoom?: number; minZoom?: number; free?: Partial<CameraPadding> },
    ): Promise<boolean>;
    /**
     * Ausschnitt zeigen, wenn das Ziel nur Mitte und Zoom kennt (Wege, Landschaften, Klimazonen der
     * Suche): genau dieser Zoom, auch heraus - der Zusammenhang soll sichtbar werden.
     */
    showView(center: [number, number], zoom: number): void;
    /** Der ganze Blick, wie er gerade steht: Mitte, Zoom, Drehung und Neigung (für `returnTo`). */
    view(): CameraState & { center: [number, number] };
    /**
     * Zurück zu einem Blick, den `view` gemeldet hat, im Flug wie jede Fahrt (WI-0306: „Reise als PDF“ passt die Route für das Kartenbild ein und
     * kehrt danach dorthin zurück, wo der Betrachter war). Das Ergebnis wie bei `showPoint`.
     */
    returnTo(view: CameraState & { center: [number, number] }): Promise<boolean>;
    /**
     * Dem Pfeil des Playmodes folgen (WI-0031): ohne Fahrt, Bild für Bild. Ohne `view` bleiben
     * Drehung und Neigung, wie sie sind (2D); mit `view` dreht und neigt die Kamera mit (3D) -
     * die Neigung höchstens bis zur Grenze des Zooms. Die Bewegung trägt `FOLLOW_EVENT`: Jede
     * andere ist jemand anderes, und dann pausiert das Folgen (`isFollowMove`).
     *
     * Mit `ground` hält die Kamera über Gelände die Höhe des Bodens an diesem Punkt, weich nachgeführt
     * (`FOLLOW_HEIGHT_SECONDS`, WI-0053), statt der Mitte Bild für Bild auf den Boden zu springen. Sie beginnt
     * bei der Höhe, die die Karte gerade hat; `settle` (ein Sprung) setzt sie gleich auf den Boden.
     *
     * Mit `altitude` (Meter wie `queryTerrainElevation`) hält sie stattdessen diese Höhe, genauso weich: Im Flug
     * fliegt der Pfeil auf seiner Bahn, und die Kamera folgt ihm in die Höhe (WI-0051 F3).
     */
    /**
     * Zur Folgestellung fliegen: Der Pfeil steht an einem neuen Ziel (Play beginnt, ein Sprung der Leiste), also
     * fliegt die Kamera dorthin - sie springt nie (Kamerakanon 2026-09-29). Die Dauer richtet sich nach der
     * Entfernung (`flightDuration`). Bis sie ankommt, tut `follow` nichts, und Ring, Tasten und 3D-Knopf gehen in
     * die Folge (`following`). Gibt `true` zurück, sobald sie angekommen ist, `false`, wenn die Fahrt vorher
     * endet (Geste, Pause, ein neuer Flug). Bei „Bewegung reduzieren“ springt sie - dort ist das richtig - und
     * meldet gleich `true`.
     */
    approach(center: [number, number], view?: { bearing?: number; pitch?: number; zoom?: number }): Promise<boolean>;
    /** Die Folge endet (angehalten oder frei): Ring, Tasten und 3D-Knopf fahren wieder selbst; ein Anflug bricht ab. */
    unfollow(): void;
    follow(
        center: [number, number],
        view?: {
            bearing?: number;
            pitch?: number;
            zoom?: number;
            ground?: [number, number];
            altitude?: number;
            settle?: boolean;
        },
    ): void;
    destroy(): void;
}

/**
 * Fahrtdauern (Spez. § 7): Knöpfe wie der Kartenzoom des Kanons, Tastaturschritte kürzer. Das
 * Einpassen fliegt 0,7 s wie Legacys `flyToBounds` (route-plan-map.js), ein Punkt 0,75 s wie Legacys
 * `spotlightFlyTo` (spotlight-search-focus.js).
 */
export const CAMERA_DURATION = { button: 500, key: 300, point: 750, fit: 700 } as const;

/**
 * Der Rand beim Einpassen, innerhalb der sichtbaren Fläche (Legacy `getRouteFitBoundsOptions`, Owner
 * 2026-07-18: „zu knapp zum rand“): 7 % je Seite, mindestens 40 bzw. 32 px.
 */
export const FIT_MARGIN = { share: 0.07, minX: 40, minY: 32 } as const;

/**
 * Wie träge die Kamera beim Folgen der Höhe des Bodens nachgeht, Zeitkonstante in Sekunden (WI-0053):
 * MapLibre setzt die Mitte sonst in jedem Bild auf den Boden, und über einem Kamm hüpfte das Bild.
 */
export const FOLLOW_HEIGHT_SECONDS = 0.6;
/**
 * Solange die Kamera folgt (`follow` bis `unfollow`), gehen Ring, Tasten und 3D-Knopf in die Folge, statt eine
 * eigene Fahrt zu beginnen, die das nächste Folgebild abbräche (WI-0053). Kommt länger kein Folgebild - auch
 * „Bewegung reduzieren“ springt nur alle 1,2 s -, gilt sie als losgelassen, falls `unfollow` fehlt.
 */
export const FOLLOW_ACTIVE_MS = 1500;
/** Liegen zwei Folgebilder weiter auseinander, ist es kein Fahren mehr: Die Höhe springt mit. */
export const FOLLOW_HEIGHT_GAP_MS = 250;

/** Eine Höhe, die sich einem Ziel nähert: exponentiell, nach Zeit, nicht nach Bildern. */
export function approachHeight(current: number, target: number, seconds: number, tau: number): number {
    const share = tau <= 0 ? 1 : 1 - Math.exp(-Math.max(0, seconds) / tau);
    return current + (target - current) * share;
}

/** Unter diesem Wert gilt die Karte als flach. */
const FLAT_EPSILON = 0.5;

/** Das Kennzeichen der eigenen Folgebewegung, als Ereignisdaten von `jumpTo`. */
export const FOLLOW_EVENT = "playmode";

/** Kam diese Bewegung aus `follow`? Ring, Tasten, Maus und Finger tragen das Kennzeichen nie. */
export function isFollowMove(event: object): boolean {
    return (event as Record<string, unknown>)[FOLLOW_EVENT] === true;
}

/** Der Rand beim Einpassen für eine sichtbare Fläche dieser Größe. */
export function fitMargin(visible: { width: number; height: number }): CameraPadding {
    const x = Math.max(FIT_MARGIN.minX, Math.round(visible.width * FIT_MARGIN.share));
    const y = Math.max(FIT_MARGIN.minY, Math.round(visible.height * FIT_MARGIN.share));
    return { top: y, right: x, bottom: y, left: x };
}

/** MapLibres gewünschter Stand, privat (siehe den Haken in `createCamera`). */
interface MitGewuenschtemStand {
    _camera?: {
        _requestedCameraState?: {
            pitch?: number;
            zoom?: number;
            clone?: unknown;
            setPitch?: (pitch: number) => void;
            setCenter?: (center: LngLat) => void;
        };
    };
}

const toPair = (center: LngLatLike): [number, number] =>
    Array.isArray(center)
        ? [center[0], center[1]]
        : "lng" in center
          ? [center.lng, center.lat]
          : [center.lon, center.lat];

export function createCamera(
    map: MapLibreMap,
    area?: { sync(): CameraPadding; insets(): CameraPadding; keepFree(): CameraPadding },
    now: () => number = () => performance.now(),
): Camera {
    const state = (): CameraState => ({
        bearing: normalizeBearing(map.getBearing()),
        pitch: map.getPitch(),
        zoom: map.getZoom(),
    });
    const here = (): CameraGoal => ({ ...state(), center: toPair(map.getCenter()) });
    const clampZoom = (zoom: number): number => Math.min(map.getMaxZoom(), Math.max(map.getMinZoom(), zoom));

    // 🔴 Ohne diesen Eingriff trifft über 71,5° kein Klick mehr einen Ort oder Weg (MapLibre-Issue #2994).
    installHorizonQueryFix(map);

    /**
     * 💣 Zweimal schnell Umschalt + → muss 30° drehen, nicht 20°. Eine neue Fahrt ginge sonst vom
     * halben Weg der laufenden aus - genau so verliert MapLibres eigene Tastatur Schritte. Solange
     * eine unserer Fahrten läuft, baut der nächste Befehl deshalb auf ihrem ZIEL auf, samt Mitte: Ein
     * „+“ während des Flugs zur Suche landet am Ziel der Suche, nicht irgendwo auf halbem Weg.
     *
     * Das Ziel gilt, bis die Fahrt endet oder jemand sie unterbricht (`moveend`). Springt die Karte
     * statt zu fahren („Bewegung reduzieren“), gibt es kein Ziel - sie steht schon dort.
     */
    let goal: CameraGoal | undefined;
    const forget = (): void => {
        goal = undefined;
    };
    map.on("moveend", forget);

    /**
     * Die Höhe, die `follow` über Gelände hält. Solange sie gilt, klemmt MapLibre die Mitte nicht auf den
     * Boden (`centerClampedToGround`, sonst überschriebe es sie in jedem Bild). Jede andere Bewegung gibt
     * das Klemmen zurück: Ring, Tasten, Maus, Finger und Fahrten gehen wieder über den Boden.
     */
    let height: { value: number; time: number } | undefined;
    const release = (): void => {
        if (!height) return;
        height = undefined;
        map.setCenterClampedToGround(true);
    };
    const releaseForOthers = (event: object): void => {
        if (!isFollowMove(event)) release();
    };
    map.on("movestart", releaseForOthers);

    /** Wann `follow` zuletzt kam - bis `unfollow` folgt die Kamera dem Pfeil. */
    let followedAt: number | undefined;
    /**
     * Ein Anflug (`approach`) ist unterwegs: Bis er ankommt oder endet, gehört ihm die Kamera, und sie folgt schon
     * dem Pfeil, auch wenn noch kein Folgebild kam.
     */
    let approaching: { resolve: (arrived: boolean) => void; startedAt: number; duration: number } | undefined;
    const following = (): boolean =>
        approaching !== undefined || (followedAt !== undefined && now() - followedAt <= FOLLOW_ACTIVE_MS);
    /** Ein Flug, der so kurz vor seiner Dauer endet, ist angekommen: Bildtakt und Uhr treffen nie die Millisekunde. */
    const ARRIVAL_SLACK_MS = 80;
    /** Der Anflug ist zu Ende: angekommen oder nicht. `stop`: die Fahrt selbst anhalten (Pause). */
    const settleApproach = (arrived: boolean, stop = false): void => {
        const flight = approaching;
        if (!flight) return;
        approaching = undefined;
        if (stop) map.stop();
        // Die Folge beginnt gleich: Bis ihr erstes Bild kommt, gilt die Kamera weiter als folgend.
        if (arrived) followedAt = now();
        flight.resolve(arrived);
    };
    // `moveend` kommt bei der Ankunft und bei jedem Abbruch (`stop`): Nur wer die ganze Dauer geflogen ist, kam an.
    const onApproachEnd = (): void => {
        const flight = approaching;
        if (flight) settleApproach(now() - flight.startedAt >= flight.duration - ARRIVAL_SLACK_MS);
    };
    // Jede andere Bewegung nimmt der Fahrt die Kamera: Die Hand oder ein Sprung des Innenabstands war schneller.
    const onApproachInterrupted = (event: object): void => {
        if (approaching && !isFollowMove(event)) settleApproach(false);
    };
    map.on("moveend", onApproachEnd);
    map.on("movestart", onApproachInterrupted);

    /**
     * Die laufende eigene Fahrt und wer auf ihr Ende wartet (`showPoint`, `showBounds`). `moveend` kommt bei der Ankunft und bei
     * jedem Abbruch; angekommen ist, wer die ganze Dauer gefahren ist (wie `approach`). Eine neue Fahrt beendet die alte zuerst.
     */
    let travelling: { resolve: (arrived: boolean) => void; startedAt: number; duration: number } | undefined;
    const settleTravel = (arrived: boolean): void => {
        const trip = travelling;
        if (!trip) return;
        travelling = undefined;
        trip.resolve(arrived);
    };
    const onTravelEnd = (): void => {
        const trip = travelling;
        if (trip) settleTravel(now() - trip.startedAt >= trip.duration - ARRIVAL_SLACK_MS);
    };
    map.on("moveend", onTravelEnd);

    /**
     * Die Neigung folgt beim Zoomen ihrer Kurve, wenn sie auf ihr steht (`aufDerKurve`, Betreiber 2026-11-08/09): für Rad, Finger,
     * Doppelklick und Strg + Ziehen, die MapLibre selbst führt. Eigene Fahrten (Ring, Tasten, Punkt, Ausschnitt) und die Folge des
     * Playmodes geben ihre Neigung selbst vor; während sie laufen, klemmt der Haken nur. `eigeneFahrt` deckt den Aufruf selbst ab: Bei
     * „Bewegung reduzieren“ springt MapLibre darin schon.
     *
     * 🪤 MapLibres gewünschter Stand (`_camera._requestedCameraState`, privat) behält die Neigung einer Geste über die Grenze hinweg; ohne
     * Eingriff hätte ein Rad nach dem Link mit 30° immer 30° gewünscht. Der Haken zieht ihn auf die gezeichnete Neigung nach
     * (`neigungBeimZoom`). Fehlt er (andere MapLibre-Fassung), klemmt der Haken nur, wie vor dem 2026-11-08; `camera.test.ts` sieht im
     * Bau von MapLibre nach, ob es ihn gibt.
     */
    let eigeneFahrt = false;
    const eigen = (start: () => void): void => {
        eigeneFahrt = true;
        try {
            start();
        } finally {
            eigeneFahrt = false;
        }
    };
    /**
     * Wo die laufende Zoomgeste ansetzt, in Bildpunkten der Karte: Rad und Doppelklick am Zeiger, zwei Finger in ihrer Mitte (MapLibres
     * `around`, das der Haken nicht mitbekommt). Die Neigung kippt um diesen Punkt (`neigung-anker.ts`); nach `ANKER_FRISCH_MS` ohne
     * neue Eingabe gilt er nicht mehr.
     */
    let anker: { punkt: Bildpunkt; zeit: number } | undefined;
    const ANKER_FRISCH_MS = 800;
    const frischerAnker = (): Bildpunkt | undefined =>
        anker !== undefined && now() - anker.zeit < ANKER_FRISCH_MS ? anker.punkt : undefined;
    const behaelter = typeof map.getCanvasContainer === "function" ? map.getCanvasContainer() : undefined;
    if (behaelter) {
        const merke = (x: number, y: number): void => {
            const rahmen = map.getCanvas().getBoundingClientRect();
            anker = { punkt: { x: x - rahmen.left, y: y - rahmen.top }, zeit: now() };
        };
        const finger = (event: TouchEvent): void => {
            const [a, b] = [event.touches[0], event.touches[1]];
            if (a && b) merke((a.clientX + b.clientX) / 2, (a.clientY + b.clientY) / 2);
        };
        const vorher = { passive: true, capture: true } as const;
        behaelter.addEventListener("wheel", (event) => merke(event.clientX, event.clientY), vorher);
        behaelter.addEventListener("dblclick", (event) => merke(event.clientX, event.clientY), vorher);
        behaelter.addEventListener("touchstart", finger, vorher);
        behaelter.addEventListener("touchmove", finger, vorher);
    }

    /** Die Neigung, die der Haken zuletzt wollte (die Kurve), und der Zoom, auf dem sie gezeichnet wurde; MapLibre kann sie über dem Gelände flacher gezeichnet haben. */
    let beabsichtigt: { pitch: number; zoom: number } | undefined;
    // Attrappen der Tests kennen den Haken nicht; dort klemmt weiter `cameraMapOptions`.
    if (typeof map.setTransformCameraUpdate === "function") {
        map.setTransformCameraUpdate((vorschlag) => {
            const { pitch, zoom } = vorschlag;
            const gewuenscht = (map as unknown as MitGewuenschtemStand)._camera?._requestedCameraState;
            if (eigeneFahrt || goal !== undefined || following() || typeof gewuenscht?.setPitch !== "function") {
                beabsichtigt = undefined;
                return { pitch: clampPitch(pitch, zoom) };
            }
            // 🪤 Vor dem Haken hebt MapLibre die Kamera über das Gelände, wenn sie darin steckt (`_elevateCameraIfInsideTerrain`): flacher und
            // um die Bildmitte. Gemessen wird darum am gewünschten Stand (die Geste, wie MapLibre sie gerechnet hat) und an der Neigung, die der
            // Haken zuletzt wollte; gezeichnet höchstens so steil, wie MapLibre es über dem Gelände erlaubt.
            const quelle = typeof gewuenscht.clone === "function" ? gewuenscht : vorschlag;
            const wunsch = { pitch: quelle.pitch ?? pitch, zoom: quelle.zoom ?? zoom };
            const vorher =
                beabsichtigt !== undefined && beabsichtigt.zoom === map.getZoom()
                    ? beabsichtigt
                    : { pitch: map.getPitch(), zoom: map.getZoom() };
            const kurve = neigungBeimZoom(wunsch, vorher);
            const neigung = pitch < wunsch.pitch - 1e-3 ? Math.min(kurve, pitch) : kurve;
            beabsichtigt = { pitch: kurve, zoom };
            const punkt = frischerAnker();
            const ziel = ortUnterAnker(quelle as unknown as Partial<AnkerTransform<LngLat>>, punkt, map.terrain);
            const anders = Math.abs(neigung - wunsch.pitch) > 1e-6 || Math.abs(zoom - wunsch.zoom) > 1e-9;
            if (ziel !== undefined && punkt !== undefined && quelle === gewuenscht && kurve !== wunsch.pitch) {
                // Kamera-Sprung erlaubt (gesture): keiner - der gewünschte Stand der laufenden Geste kippt um den Anker mit, damit ihr nächster
                // Schritt von dort rechnet; gezeichnet wird die Rückgabe.
                gewuenscht.setCenter?.(mitteFuer(quelle as unknown as AnkerTransform<LngLat>, kurve, ziel, punkt));
            }
            // Kamera-Sprung erlaubt (gesture): wie oben.
            gewuenscht.setPitch(kurve);
            if (ziel === undefined || punkt === undefined || !anders) return { pitch: neigung };
            const mitte = mitteFuer(vorschlag as unknown as AnkerTransform<LngLat>, neigung, ziel, punkt);
            return { pitch: neigung, center: mitte };
        });
    }

    /** Die Fläche messen und sagen, wovon der nächste Befehl ausgeht. */
    const prepare = (): CameraGoal => {
        const pending = goal;
        area?.sync();
        return pending ?? here();
    };
    /** Die Mitte der freien Fläche: Dort landet, was die Kamera zeigt (der Bezug ohne Seitenleisten, E4). */
    const freeCentre = (): ScreenPoint => {
        const canvas = map.getCanvas();
        return visibleCentre({ width: canvas.clientWidth, height: canvas.clientHeight }, area?.insets() ?? {});
    };
    /** Die Mitte der freien Fläche, wenn Panels sie aus der Bildmitte rücken; sonst gibt es nichts zu rechnen. */
    const offCentre = (): ScreenPoint | undefined => {
        const insets = area?.insets();
        return insets === undefined || sameInsets(insets, NO_INSETS) ? undefined : freeCentre();
    };
    /** Wohin die Mitte der Karte muss, damit `point` im Blick `view` in der Mitte der freien Fläche steht. */
    const aim = (point: [number, number], view: CameraState): [number, number] => {
        const at = offCentre();
        return at === undefined ? point : centreFor(map, point, view, at);
    };
    /** Die Mitte dieser Ränder (`keepFree`, `freeAfter`): Dort landet ein eingepasster Ausschnitt. */
    const centreOf = (free: Partial<CameraPadding>): ScreenPoint => {
        const canvas = map.getCanvas();
        return visibleCentre({ width: canvas.clientWidth, height: canvas.clientHeight }, free);
    };
    /**
     * `around`: Ring und Tasten drehen, neigen und zoomen um diesen Ort, der dabei an seiner Stelle im Bild bleibt (MapLibres
     * `around`); `target.center` ist dann, wo die Mitte am Ende steht.
     */
    const travel = (
        target: CameraGoal,
        how: "ease" | "fly",
        duration: number,
        around?: [number, number],
    ): Promise<boolean> => {
        settleTravel(false);
        // Folgt die Kamera dem Pfeil, bleibt sie dort: Das nächste Folgebild bräche die Fahrt ohnehin ab.
        if (following()) return Promise.resolve(false);
        goal = undefined;
        const options = {
            center: target.center,
            zoom: target.zoom,
            bearing: target.bearing,
            pitch: target.pitch,
            duration,
            essential: false,
            ...(around === undefined ? {} : { around }),
        };
        const startedAt = now();
        eigen(() => {
            if (how === "fly") map.flyTo(options);
            else map.easeTo(options);
        });
        if (!map.isMoving()) return Promise.resolve(true);
        goal = target;
        return new Promise<boolean>((resolve) => {
            travelling = { resolve, startedAt, duration };
        });
    };
    /** Die Ränder, die nach der Landung frei bleiben: was die Panels decken, je Seite mindestens `extra`. */
    const freeAfter = (extra: Partial<CameraPadding> | undefined): CameraPadding =>
        mergeInsets(area?.keepFree() ?? {}, extra);
    /**
     * 🔴 Folgt die Kamera gerade dem Pfeil, bleibt sie beim Pfeil (Betreiber 2026-09-27: „die kamera soll nur vom
     * pfeil losgelöst sein, wenn [ich] mit maus oder touch bewusst die kartenansicht verändere“). Ring, Tasten und
     * 3D-Knopf ändern dann Zoom, Neigung und - wo die Folge sie nicht selbst führt - die Drehung, und die Folge
     * fährt den Schritt aus. Die Mitte gehört der Folge: Verschieben per Taste wirkt erst ohne sie.
     */
    let followStep: { from: CameraState; to: Partial<CameraState>; start: number; duration: number } | undefined;
    const reducedMotion = (): boolean => globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
    /** Ein Schritt in die Folge: vom Ziel eines laufenden Schritts aus, damit zwei Tastendrücke zwei Schritte sind. */
    const stepInFollow = (change: (from: CameraGoal) => Partial<CameraGoal>, duration: number): void => {
        const current = here();
        const base = followStep ? { ...current, ...followStep.to } : current;
        const next = change(base);
        const to: Partial<CameraState> = {};
        if (next.zoom !== undefined) to.zoom = clampZoom(next.zoom);
        if (next.bearing !== undefined) to.bearing = normalizeBearing(next.bearing);
        if (next.pitch !== undefined) to.pitch = clampPitch(next.pitch, to.zoom ?? base.zoom);
        if (reducedMotion()) {
            // Bei „Bewegung reduzieren“ springt der Schritt gleich - das nächste Folgebild käme erst in 1,2 s.
            followStep = undefined;
            // Kamera-Sprung erlaubt (reduced-motion): Wer Bewegung abbestellt hat, bekommt den Wechsel sofort (Guide §29.1).
            map.jumpTo({ ...to }, { [FOLLOW_EVENT]: true });
            return;
        }
        followStep = {
            from: state(),
            to: { ...followStep?.to, ...to },
            start: now(),
            duration: reducedMotion() ? 0 : duration,
        };
    };
    /**
     * Ein Schritt von Ring oder Taste: auf dem Ziel der laufenden Fahrt, um die Mitte der freien Fläche. Was dort liegt, bleibt dort,
     * auch geneigt; ein Verschieben (`center`) verschiebt nur.
     */
    const step = (change: (from: CameraGoal) => Partial<CameraGoal>, duration: number): void => {
        if (following()) {
            stepInFollow(change, duration);
            return;
        }
        const pending = goal !== undefined;
        const from = prepare();
        const changed = change(from);
        const next = { ...from, ...changed, zoom: clampZoom(changed.zoom ?? from.zoom) };
        const at = offCentre();
        if (changed.center !== undefined || at === undefined) {
            travel(next, "ease", duration);
            return;
        }
        const pivot = locationAt(map, from, from.center, at);
        const center = centreFor(map, pivot, next, at);
        // MapLibre hält den Ort fest, wo er gerade im Bild steht. Mitten in einer Fahrt steht er dort noch nicht: dann nur das Ziel.
        const moved = center[0] !== next.center[0] || center[1] !== next.center[1];
        travel({ ...next, center }, "ease", duration, moved && !pending ? pivot : undefined);
    };

    /** Wer den Kompass gerade beansprucht - sonst dreht er nach Norden. */
    let northClaim: (() => void) | undefined;

    const zoomChoices = new Set<(zoom: number) => void>();

    const listeners = new Set<(value: CameraState) => void>();
    const notify = (): void => {
        const value = state();
        for (const listener of listeners) {
            listener(value);
        }
    };
    map.on("move", notify);

    return {
        state,
        insets: () => area?.insets() ?? { top: 0, right: 0, bottom: 0, left: 0 },
        onChange(listener) {
            listeners.add(listener);
            listener(state());
            return () => listeners.delete(listener);
        },
        zoomBy(delta) {
            // Auf der Kurve folgt die Neigung ihr, wie beim Rad (`aufDerKurve`); in der Folge des Playmodes bleibt sie, wie die Reise fliegt.
            step((from) => {
                const zoom = from.zoom + delta;
                return following() ? { zoom } : { zoom, pitch: neigungNachZoom(from, clampZoom(zoom)) };
            }, CAMERA_DURATION.button);
            // Das Ziel: in der Folge der laufende Schritt, sonst die laufende Fahrt, sonst der Stand (gesprungen).
            const zoom = followStep?.to.zoom ?? goal?.zoom ?? map.getZoom();
            for (const listener of zoomChoices) listener(zoom);
        },
        onZoomChoice(listener) {
            zoomChoices.add(listener);
            return () => zoomChoices.delete(listener);
        },
        panBy(dx, dy) {
            step(
                (from) => ({ center: shiftCenter(from.center, dx, dy, from.zoom, from.bearing) }),
                CAMERA_DURATION.key,
            );
        },
        rotateBy(degrees) {
            step((from) => ({ bearing: normalizeBearing(from.bearing + degrees) }), CAMERA_DURATION.key);
        },
        tiltBy(degrees) {
            step((from) => ({ pitch: clampPitch(from.pitch + degrees, from.zoom) }), CAMERA_DURATION.key);
        },
        rotateToNextDirection(direction) {
            step((from) => ({ bearing: nextCompassBearing(from.bearing, direction) }), CAMERA_DURATION.button);
        },
        northUp() {
            if (northClaim) {
                northClaim();
                return;
            }
            step(() => ({ bearing: 0 }), CAMERA_DURATION.button);
        },
        claimNorth(handler) {
            northClaim = handler;
            return () => {
                if (northClaim === handler) northClaim = undefined;
            };
        },
        toggleTilt() {
            // Während der Wiedergabe fliegt 3D auf `FLIGHT_PITCH` (Betreiber 2026-09-27: „neigung aufs maximum“ - damals der Anschlag).
            // Sonst auf die Kurve des Zooms (im Überblick 25°, bei Zoom 6 45°), damit das Zoomen danach mitkippt.
            const tilt = (zoom: number): number =>
                following() ? Math.min(FLIGHT_PITCH, maxPitchForZoom(zoom)) : begleitNeigung(zoom);
            step((from) => ({ pitch: from.pitch <= FLAT_EPSILON ? tilt(from.zoom) : 0 }), CAMERA_DURATION.button);
        },
        resetAll() {
            step(() => ({ bearing: 0, pitch: 0 }), CAMERA_DURATION.button);
        },
        showPoint(center, nearZoom, options) {
            const pending = goal !== undefined;
            const from = prepare();
            const zoom = clampZoom(Math.max(from.zoom, nearZoom));
            const view = { zoom, bearing: from.bearing, pitch: clampPitch(from.pitch, zoom) };
            const toFreeCentre = (): Promise<boolean> =>
                travel({ center: aim(center, view), ...view }, "fly", CAMERA_DURATION.point);
            if (options === undefined) return toFreeCentre();
            const canvas = map.getCanvas();
            const size = { width: canvas.clientWidth, height: canvas.clientHeight };
            const free = freeAfter(options.free);
            // Bleibt kaum etwas frei, zielt die Kamera wie ohne Angabe: Man sieht den Ort, sobald das Fenster geht. Wer nur Verdecktes
            // holen wollte, bleibt stehen: Es gibt keine Stelle, an der es frei läge.
            if (!leavesGap(size, free)) return options.onlyIfCovered ? Promise.resolve(true) : toFreeCentre();
            const rect = visibleRect(size, free);
            const edge = options.onlyIfCovered ? NO_INSETS : options.onlyIfHidden ? fitMargin(rect) : undefined;
            if (edge !== undefined && !pending && from.zoom >= zoom - 0.01) {
                const at = map.project(center);
                const inside =
                    at.x >= rect.left + edge.left &&
                    at.x <= rect.left + rect.width - edge.right &&
                    at.y >= rect.top + edge.top &&
                    at.y <= rect.top + rect.height - edge.bottom;
                if (inside) return Promise.resolve(true);
            }
            // Der Ort soll nach der Landung in der Mitte der freien Fläche stehen, auch geneigt (`target-centre.ts`).
            const at = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
            return travel({ center: centreFor(map, center, view, at), ...view }, "fly", CAMERA_DURATION.point);
        },
        view: () => here(),
        returnTo(view) {
            prepare();
            const zoom = clampZoom(view.zoom);
            return travel(
                {
                    center: view.center,
                    zoom,
                    bearing: normalizeBearing(view.bearing),
                    pitch: clampPitch(view.pitch, zoom),
                },
                "fly",
                CAMERA_DURATION.fit,
            );
        },
        showView(center, zoom) {
            const from = prepare();
            const target = clampZoom(zoom);
            const view = { zoom: target, bearing: from.bearing, pitch: clampPitch(from.pitch, target) };
            void travel({ center: aim(center, view), ...view }, "fly", CAMERA_DURATION.point);
        },
        showBounds(bounds, options) {
            const from = prepare();
            const canvas = map.getCanvas();
            // Eingepasst wird in die FREIE Fläche, auch neben einer Seitenleiste, die die Mitte nicht
            // verschiebt (E4): Das Ziel liegt nie unter einem Panel (Owner 2026-07-18). Mit `free` (ein Editor, WI-0218) zwischen allem,
            // was nach der Landung deckt; bleibt dort keine Lücke, wie ohne Angabe.
            const size = { width: canvas.clientWidth, height: canvas.clientHeight };
            const after = options?.free === undefined ? undefined : freeAfter(options.free);
            const free: Partial<CameraPadding> =
                after !== undefined && leavesGap(size, after) ? after : (area?.keepFree() ?? {});
            const visible = visibleRect(size, free);
            const margin = fitMargin(visible);
            // Den Zoom rechnet MapLibre (flach, mit dem Deckel `maxZoom`); die Mitte des Umrisses rückt danach in die Mitte der freien
            // Fläche, auch geneigt (`target-centre.ts`).
            const target = map.cameraForBounds(bounds, {
                padding: {
                    top: margin.top + (free.top ?? 0),
                    right: margin.right + (free.right ?? 0),
                    bottom: margin.bottom + (free.bottom ?? 0),
                    left: margin.left + (free.left ?? 0),
                },
                bearing: from.bearing,
                ...(options?.maxZoom === undefined ? {} : { maxZoom: options.maxZoom }),
            });
            if (target?.center === undefined || target.zoom === undefined) return Promise.resolve(false);
            const zoom = clampZoom(Math.max(target.zoom, options?.minZoom ?? Number.NEGATIVE_INFINITY));
            const view = { zoom, bearing: from.bearing, pitch: clampPitch(from.pitch, zoom) };
            return travel(
                { center: centreFor(map, boundsMiddle(bounds), view, centreOf(free)), ...view },
                "fly",
                CAMERA_DURATION.fit,
            );
        },
        follow(center, view) {
            // Ein Anflug fliegt gerade zur Folgestellung: Ein Folgebild dazwischen bräche ihn ab.
            if (approaching) return;
            // `jumpTo` beendet jede laufende Fahrt; ein Tastenschritt danach baut auf dem echten Stand auf.
            goal = undefined;
            const options: {
                center: [number, number];
                bearing?: number;
                pitch?: number;
                zoom?: number;
                elevation?: number;
            } = {
                center,
            };
            if (view?.zoom !== undefined) options.zoom = view.zoom;
            if (view?.bearing !== undefined) options.bearing = normalizeBearing(view.bearing);
            if (view?.pitch !== undefined) options.pitch = clampPitch(view.pitch, view.zoom ?? map.getZoom());
            followedAt = now();
            if (followStep) {
                // Ein Schritt von Ring, Taste oder 3D-Knopf läuft in der Folge aus, weich wie seine eigene Fahrt.
                const { from, to, start, duration } = followStep;
                const share = duration <= 0 ? 1 : Math.min(1, (now() - start) / duration);
                const eased = 1 - (1 - share) ** 3;
                const mix = (a: number, b: number): number => a + (b - a) * eased;
                if (to.zoom !== undefined) options.zoom = mix(from.zoom, to.zoom);
                if (to.pitch !== undefined)
                    options.pitch = clampPitch(mix(from.pitch, to.pitch), options.zoom ?? map.getZoom());
                // Die Drehung nur, wo die Folge sie nicht selbst führt (2D).
                if (to.bearing !== undefined && view?.bearing === undefined)
                    options.bearing = normalizeBearing(
                        from.bearing + normalizeBearing(to.bearing - from.bearing) * eased,
                    );
                if (share >= 1) followStep = undefined;
            }
            const ground =
                view?.altitude ?? (view?.ground && map.getTerrain() ? map.queryTerrainElevation(view.ground) : null);
            if (ground === null || ground === undefined) {
                release();
            } else {
                const time = now();
                // Liegt das letzte Folgebild weiter zurück (Sprung, „Bewegung reduzieren“), gleich auf den Boden.
                // Kommt sie von einer freien Kamera, beginnt sie auf der Höhe, die die Karte gerade hat - so kehrt
                // sie auch in der Höhe weich zurück.
                const from = height ?? { value: map.getCenterElevation(), time };
                const value =
                    view?.settle || time - from.time > FOLLOW_HEIGHT_GAP_MS
                        ? ground
                        : approachHeight(from.value, ground, (time - from.time) / 1000, FOLLOW_HEIGHT_SECONDS);
                if (!height) map.setCenterClampedToGround(false);
                height = { value, time };
                options.elevation = value;
            }
            // Die Mitte des Folgens steht in der Mitte der freien Fläche, wie jedes Ziel (WI-0218); der Boden in der gehaltenen Höhe.
            options.center = aim(center, {
                zoom: options.zoom ?? map.getZoom(),
                bearing: options.bearing ?? map.getBearing(),
                pitch: options.pitch ?? map.getPitch(),
            });
            // Kamera-Sprung erlaubt (follow): das Folgen Bild für Bild - kleine Schritte auf der Bahn, die die Kamera
            // ohnehin hat. Ein neues Ziel (Anfang, Etappe, Sprung der Leiste) fliegt über `approach`.
            map.jumpTo(options, { [FOLLOW_EVENT]: true });
        },
        approach(center, view) {
            return new Promise<boolean>((resolve) => {
                // Ein älterer Anflug ist vorbei; `flyTo` beendet seine Fahrt ohnehin.
                settleApproach(false);
                // Über Gelände klemmt MapLibre die Mitte wieder auf den Boden: Der Flug geht dorthin, nicht in die Höhe.
                release();
                goal = undefined;
                const from = here();
                const zoom = clampZoom(view?.zoom ?? from.zoom);
                const bearing = view?.bearing === undefined ? from.bearing : normalizeBearing(view.bearing);
                const pitch = clampPitch(view?.pitch ?? from.pitch, zoom);
                // Die Folgestellung liegt in der Mitte der freien Fläche, wie jedes Ziel (WI-0218).
                const target = aim(center, { zoom, bearing, pitch });
                const canvas = map.getCanvas();
                const here0 = map.project(map.getCenter());
                const there = map.project(target);
                const pixels = Math.hypot(here0.x - there.x, here0.y - there.y);
                const screens = pixels / Math.max(1, canvas.clientWidth, canvas.clientHeight);
                const turned = Math.abs(normalizeBearing(bearing - from.bearing));
                // Schon dort (ein Sprung der Leiste auf denselben Punkt): Es gibt nichts zu fliegen.
                const still =
                    pixels < 2 &&
                    Math.abs(zoom - from.zoom) < 0.01 &&
                    turned < 0.5 &&
                    Math.abs(pitch - from.pitch) < 0.5;
                const duration = reducedMotion() || still ? 0 : flightDuration(screens, zoom - from.zoom);
                const startedAt = now();
                eigen(() =>
                    map.flyTo(
                        { center: target, zoom, bearing, pitch, duration, essential: false },
                        { [FOLLOW_EVENT]: true },
                    ),
                );
                // Nichts zu fahren (schon da, oder MapLibre ist bei „Bewegung reduzieren“ gesprungen): angekommen.
                if (!map.isMoving()) {
                    followedAt = now();
                    resolve(true);
                    return;
                }
                approaching = { resolve, startedAt, duration };
            });
        },
        unfollow() {
            // Die Folge endet, und mit ihr der Anflug: Pause oder freie Kamera haben ihn verlassen.
            settleApproach(false, true);
            followedAt = undefined;
            followStep = undefined;
        },
        destroy() {
            settleApproach(false);
            settleTravel(false);
            release();
            map.off("move", notify);
            map.off("moveend", forget);
            map.off("moveend", onApproachEnd);
            map.off("moveend", onTravelEnd);
            map.off("movestart", releaseForOthers);
            map.off("movestart", onApproachInterrupted);
            listeners.clear();
            zoomChoices.clear();
        },
    };
}

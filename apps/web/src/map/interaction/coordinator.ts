import type { Map as MapLibreMap, MapGeoJSONFeature, MapMouseEvent, MapTouchEvent, PointLike } from "maplibre-gl";
import { isLayoutMove } from "../camera/visible-area";
import { LONG_PRESS_RELEASE_CLICK_MS, createLongPress } from "./long-press";
import { INTERACTION_PRIORITY } from "./priorities";
import type {
    Claim,
    HitContext,
    InteractionKind,
    InteractionObservers,
    InteractionOwner,
    MapInteractionCoordinator,
    ObserverKind,
    Screen,
} from "./types";

/**
 * Der Koordinator der Karteninteraktion (M8, Hardening Review 2026-09-28): ein Listener je Ereignis, eine
 * Abfrage der Karte je Ereignis, ein Gewinner, ein Schreiber der Zeigerform. Vorher stand der Vorrang zwischen
 * Ort, Route, Fläche, Kontextmenü und Wegpunktziehen als Bedingung in jedem Handler (`placeAt` dreifach,
 * `claimedByOthers`), ein Klick kostete fünf Abfragen und der Zeiger hatte fünf Schreiber.
 *
 * Wie er arbeitet:
 * - **Ein Besitzer, wer den höchsten Rang hat und trifft** (`INTERACTION_PRIORITY`). Der Koordinator fragt die
 *   Besitzer von oben nach unten; der erste Treffer gewinnt, die anderen erfahren nichts. Ein Besitzer, der
 *   eine Frage an den Server stellt (`Promise`), hält nur die unter ihm auf; die über ihm sind vorher dran.
 * - **Eine Abfrage:** `queryRenderedFeatures` läuft einmal über die Layer aller Besitzer, die dieses Ereignis
 *   beanspruchen und im Stil stehen; das Ergebnis liegt nach Layer gruppiert im `HitContext`.
 * - **Der Cursor gehört dem Gewinner** des Zeigens (`claim.cursor`) oder dem, der eine Geste erfasst hat. Der
 *   Koordinator schreibt ihn und setzt ihn nur zurück, wenn er selbst ihn gesetzt hat und keiner ihn seither
 *   überschrieben hat.
 * - **Erfassen** (`capture`): eine Geste gehört einem Besitzer allein. Solange sie läuft, bekommt kein anderer
 *   Zeigen, Klick, Kontextmenü oder langen Druck; ein langer Druck, der schon läuft, ist abgebrochen.
 * - **Beobachten** ist passiv: `gesture` und `activity` an den Eingaben der Karte (Playmode), `click` wenn ein
 *   Klick verteilt ist. Ein Beobachter entscheidet nichts.
 *
 * 🔴 Kein Ereignisbus und keine Registry außerhalb der Karteninstanz: Der Koordinator gehört einer Karte
 * (`createInteractionCoordinator(map)`) und stirbt mit ihr (`destroy`).
 *
 * Nicht hier, sondern außerhalb bleiben die Listener für Stil und Kamera (`moveend`, `zoomend`, `styledata`,
 * Adresszeile): Sie melden keine Zeigergeste.
 */

type Owner = InteractionOwner;
interface Winner {
    owner: Owner;
    claim: Claim;
    /** Ein Umschalt-Klick, den ein offenes Fenster schon aufgenommen hat (`umschalt`): Es bleibt nichts zu tun. */
    aufgenommen?: true;
}
type Resolution = Winner | undefined;

/** Die DOM-Eingaben, an denen `gesture` und `activity` lauschen (vor jedem anderen Zuhörer der Karte). */
const GESTURE_INPUTS = ["pointerdown", "wheel"] as const;
const ACTIVITY_INPUTS = ["pointermove", "pointerdown", "wheel", "touchstart", "touchmove"] as const;

/** Wer den Zeiger hält: die Erfassung einer Geste. */
interface Holder {
    id: string;
    detach: () => void;
}

export interface CoordinatorOptions {
    /** Für Tests: eigene Uhr und eigenes Bildtakt. Ohne Angabe die des Browsers. */
    requestFrame?: (callback: () => void) => number;
    cancelFrame?: (handle: number) => void;
    setTimer?: (callback: () => void, ms: number) => unknown;
    clearTimer?: (handle: unknown) => void;
    /** Wo das Loslassen eines erfassten Zeigers gehört wird. Ohne Angabe das Fenster. */
    pointerTarget?: Pick<EventTarget, "addEventListener" | "removeEventListener">;
    /**
     * Welche Besitzer gerade teilnehmen (`ownersInView`, die Tafel neben dem Rang); `undefined` heißt alle. Je Ereignis neu
     * gelesen: Ein Wechsel der Ansicht gilt beim nächsten Zeigen oder Klick. Erfassungen (`capture`) sind Gesten, keine
     * Teilnahme, und bleiben davon unberührt.
     */
    scope?: () => readonly string[] | undefined;
}

const isPromise = <T>(value: T | Promise<T>): value is Promise<T> =>
    typeof (value as { then?: unknown } | undefined)?.then === "function";

/** Das Ende einer abgebrochenen Frage ist kein Fehler. */
const isAbort = (error: unknown): boolean => error instanceof Error && error.name === "AbortError";

function report(owner: Owner, error: unknown): void {
    if (!isAbort(error)) console.error(`Interaktion: Besitzer „${owner.id}“ ist gescheitert`, error);
}

/** Wo der Zeiger im Fenster steht: bei der Maus am Ereignis, am Finger beim ersten Finger. */
function screenOf(event: MapMouseEvent | MapTouchEvent): Screen {
    const original = event.originalEvent as MouseEvent | TouchEvent;
    if ("touches" in original) {
        const touch = original.touches[0] ?? original.changedTouches?.[0];
        return { x: touch?.clientX ?? 0, y: touch?.clientY ?? 0 };
    }
    return { x: original.clientX, y: original.clientY };
}

const touchesOf = (event: MapTouchEvent): { clientX: number; clientY: number }[] =>
    Array.from(event.originalEvent.touches);

export function createInteractionCoordinator(
    map: MapLibreMap,
    options: CoordinatorOptions = {},
): MapInteractionCoordinator {
    const requestFrame = options.requestFrame ?? ((callback) => globalThis.requestAnimationFrame(callback));
    const cancelFrame = options.cancelFrame ?? ((handle) => globalThis.cancelAnimationFrame(handle));
    const setTimer = options.setTimer ?? ((callback, ms) => setTimeout(callback, ms));
    const clearTimer = options.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
    const pointerTarget = options.pointerTarget ?? globalThis;

    let destroyed = false;
    /** Nach Rang absteigend; bei gleichem Rang, wer zuerst kam. */
    const owners: Owner[] = [];
    let holder: Holder | undefined;
    const suspensions = new Set<{ reason: string; owners: ReadonlySet<string> | undefined }>();

    // --- Zeigerform ------------------------------------------------------------------------------------------

    /** Was der Koordinator zuletzt als Zeigerform geschrieben hat: nur das setzt er auch zurück. */
    let wroteCursor: string | undefined;
    const setCursor = (cursor: string | undefined): void => {
        const style = map.getCanvas().style;
        if (cursor === undefined) {
            if (wroteCursor !== undefined && style.cursor === wroteCursor) style.cursor = "";
            wroteCursor = undefined;
            return;
        }
        style.cursor = cursor;
        wroteCursor = cursor;
    };

    // --- Anfrage an die Karte --------------------------------------------------------------------------------

    /** Ruht das Zeigen dieses Besitzers (`suspendHover`)? */
    const suspendedFor = (id: string): boolean => {
        for (const suspension of suspensions) {
            if (suspension.owners === undefined || suspension.owners.has(id)) return true;
        }
        return false;
    };

    const eligible = (kind: InteractionKind): Owner[] => {
        const scope = options.scope?.();
        return owners.filter(
            (owner) =>
                owner.kinds.includes(kind) &&
                (scope === undefined || scope.includes(owner.id)) &&
                owner.enabled?.() !== false &&
                !(kind === "hover" && suspendedFor(owner.id)),
        );
    };

    function buildContext(
        kind: InteractionKind,
        event: MapMouseEvent | MapTouchEvent,
        list: readonly Owner[],
        signal: AbortSignal,
    ): HitContext {
        const point: Screen = { x: event.point.x, y: event.point.y };
        const layers = [...new Set(list.flatMap((owner) => owner.layers()))].filter(
            (id) => map.getLayer(id) !== undefined,
        );
        // 🔴 Die eine Abfrage dieses Ereignisses.
        const found: MapGeoJSONFeature[] = layers.length > 0 ? map.queryRenderedFeatures(event.point, { layers }) : [];
        const byLayer = new Map<string, MapGeoJSONFeature[]>();
        for (const feature of found) {
            const group = byLayer.get(feature.layer.id);
            if (group) group.push(feature);
            else byLayer.set(feature.layer.id, [feature]);
        }
        return {
            kind,
            map,
            event,
            point,
            lngLat: { lng: event.lngLat.lng, lat: event.lngLat.lat },
            screen: screenOf(event),
            byLayer,
            features: (wanted) => {
                const ids = new Set(wanted);
                return found.filter((feature) => ids.has(feature.layer.id));
            },
            query: (wanted, reach) => {
                const present = wanted.filter((id) => map.getLayer(id) !== undefined);
                if (present.length === 0) return [];
                const area: PointLike | [PointLike, PointLike] =
                    reach > 0
                        ? [
                              [point.x - reach, point.y - reach],
                              [point.x + reach, point.y + reach],
                          ]
                        : event.point;
                return map.queryRenderedFeatures(area, { layers: present });
            },
            signal,
        };
    }

    /**
     * Die Besitzer von oben nach unten fragen. Ein Ergebnis, das sofort da ist, kommt sofort zurück; sobald ein
     * Besitzer ein Versprechen liefert, wird das Ergebnis eines. `onAsync` meldet, dass es so weit ist.
     */
    function resolve(
        list: readonly Owner[],
        context: HitContext,
        onAsync?: () => void,
        umschalt = false,
    ): Resolution | Promise<Resolution> {
        /**
         * Beim Umschalt-Klick (WI-0209, Editor-Orchestrierung 2026-10-20 „A“): Ein Objekt, das kein offenes Fenster aufnimmt, merkt
         * sich nur seinen Treffer (`erstes`), und die Frage geht weiter nach unten. Nimmt eins auf, ist der Klick erledigt. Trifft sie auf
         * einen Besitzer, der kein Objekt ist (Messung, Anfasser, die freie Karte), oder auf keinen mehr, gilt der Klick gewöhnlich: für
         * das oberste Objekt, sonst für diesen Besitzer.
         */
        const nimm = (owner: Owner, claim: Claim, erstes: Resolution): Resolution | "weiter" => {
            if (!umschalt) return { owner, claim };
            if (owner.umschalt === undefined) return erstes ?? { owner, claim };
            if (owner.umschalt(claim, context)) return { owner, claim, aufgenommen: true };
            return "weiter";
        };
        const from = (index: number, erstes?: Resolution): Resolution | Promise<Resolution> => {
            for (let at = index; at < list.length; at += 1) {
                const owner = list[at] as Owner;
                let result: Claim | undefined | Promise<Claim | undefined>;
                try {
                    result = owner.hit(context);
                } catch (error) {
                    report(owner, error);
                    continue;
                }
                if (isPromise(result)) {
                    onAsync?.();
                    return result.then(
                        (claim): Resolution | Promise<Resolution> => {
                            if (context.signal.aborted) return undefined;
                            if (claim === undefined) return from(at + 1, erstes);
                            const wahl = nimm(owner, claim, erstes);
                            return wahl === "weiter" ? from(at + 1, erstes ?? { owner, claim }) : wahl;
                        },
                        (error: unknown): Resolution | Promise<Resolution> => {
                            report(owner, error);
                            return context.signal.aborted ? undefined : from(at + 1, erstes);
                        },
                    );
                }
                if (result === undefined) continue;
                const wahl = nimm(owner, result, erstes);
                if (wahl !== "weiter") return wahl;
                erstes ??= { owner, claim: result };
            }
            return erstes;
        };
        return from(0);
    }

    /** Ereignis verteilen und dem Gewinner geben: die Wege ohne eigene Vorgeschichte. */
    function dispatch(kind: InteractionKind, event: MapMouseEvent | MapTouchEvent, signal: AbortSignal): void {
        const list = eligible(kind);
        if (list.length === 0) return;
        const context = buildContext(kind, event, list, signal);
        const finish = (winner: Resolution): void => {
            if (winner && !signal.aborted) winner.owner.apply(kind, winner.claim, context);
        };
        const result = resolve(list, context);
        if (isPromise(result)) void result.then(finish);
        else finish(result);
    }

    // Für `press` und `contextmenu` (Rechtsklick wie langer Druck): ein jüngeres Ereignis der Art überholt das ältere.
    const rounds = new Map<InteractionKind, AbortController>();
    const dispatchLatest = (kind: InteractionKind, event: MapMouseEvent | MapTouchEvent): void => {
        rounds.get(kind)?.abort();
        const round = new AbortController();
        rounds.set(kind, round);
        dispatch(kind, event, round.signal);
    };

    // --- Zeigen ----------------------------------------------------------------------------------------------

    let hoverOwner: Owner | undefined;
    let hoverRound: AbortController | undefined;
    let frame: number | undefined;
    let lastMove: MapMouseEvent | undefined;

    /** Das Zeigen endet: Der Gewinner nimmt seine flüchtigen Anzeigen zurück, die Zeigerform geht. */
    function endHover(except?: string): void {
        const previous = hoverOwner;
        hoverOwner = undefined;
        setCursor(undefined);
        if (previous && previous.id !== except) previous.lost?.("hover-ended");
    }

    /** Wie `endHover`, und was noch läuft (Bild, Frage an den Server), ist auch vorbei. */
    function cancelHover(except?: string): void {
        if (frame !== undefined) cancelFrame(frame);
        frame = undefined;
        hoverRound?.abort();
        hoverRound = undefined;
        endHover(except);
    }

    function settleHover(winner: Resolution, context: HitContext): void {
        // Das Zeigen ruht inzwischen (etwa weil eine Liste aufging, während die Frage lief): Es zählt nicht.
        const current = winner && !suspendedFor(winner.owner.id) ? winner : undefined;
        const previous = hoverOwner;
        hoverOwner = current?.owner;
        if (previous && previous !== current?.owner) previous.lost?.("hover-ended");
        setCursor(current?.claim.cursor);
        current?.owner.apply("hover", current.claim, context);
    }

    function runHover(): void {
        frame = undefined;
        const event = lastMove;
        if (!event || destroyed) return;
        // Beim Ziehen gehört der Zeiger der Geste, nicht dem, worüber er fährt.
        if (holder !== undefined || event.originalEvent.buttons !== 0) {
            endHover();
            return;
        }
        hoverRound?.abort();
        const round = new AbortController();
        hoverRound = round;
        const list = eligible("hover");
        if (list.length === 0) {
            endHover();
            return;
        }
        const context = buildContext("hover", event, list, round.signal);
        const result = resolve(list, context);
        if (isPromise(result)) {
            // Die Antwort steht aus: Was bis eben galt, gilt für diese Stelle nicht mehr.
            endHover();
            void result.then((winner) => {
                if (!round.signal.aborted) settleHover(winner, context);
            });
            return;
        }
        settleHover(result, context);
    }

    const onMouseMove = (event: MapMouseEvent): void => {
        lastMove = event;
        if (frame === undefined) frame = requestFrame(runHover);
    };
    const onMouseOut = (): void => {
        lastMove = undefined;
        cancelHover();
    };
    /**
     * Jede Kartenbewegung nimmt das Gezeigte weg; gezeigt wird wieder, wenn der Zeiger sich bewegt.
     *
     * 💣 **Und sie bricht einen laufenden langen Druck ab** (WI-0108): Wer die Karte SCHIEBT, bekommt kein Menü.
     * Die eigene Toleranz (10 px am Finger) deckt das nicht sicher ab, denn MapLibre beginnt das Schieben schon
     * bei seinen `clickTolerance` 3 px - zwischen beiden Zahlen zöge der Finger die Karte, und das Menü ginge
     * mitten im Zug auf. Die Bewegung der Karte ist das eindeutige Zeichen, nicht eine zweite Pixelzahl.
     *
     * 🪤 Das Nachführen der sichtbaren Fläche ist niemandes Geste (`isLayoutMove`) und bricht nichts ab: Geht ein
     * Panel auf, während der Finger liegt, bleibt der Druck ein Druck.
     */
    const onMoveStart = (event: object): void => {
        cancelHover();
        if (!isLayoutMove(event)) longPress.cancel();
    };

    // --- Klick -----------------------------------------------------------------------------------------------

    const clickObservers = new Set<InteractionObservers["click"]>();
    let clickRound: AbortController | undefined;

    /** Hat ein langer Druck gerade ein Menü geöffnet? Dann ist der Klick beim Loslassen keiner (siehe `onClick`). */
    let swallowClick = false;
    /** Der Riegel gilt nach dem Loslassen nur noch `LONG_PRESS_RELEASE_CLICK_MS`: Ein Klick, den der Browser nahm, hinterließe sonst einen Riegel, der den nächsten echten Klick frisst. */
    let swallowTimer: unknown;
    const clearSwallow = (): void => {
        swallowClick = false;
        if (swallowTimer !== undefined) clearTimer(swallowTimer);
        swallowTimer = undefined;
    };

    const onClick = (event: MapMouseEvent): void => {
        if (holder !== undefined) return;
        // 💣 Der Browser macht aus dem Loslassen nach einem langen Druck noch einen Klick (die Finger­stelle hat
        // sich nicht bewegt). Ohne diesen Riegel wählte das Loslassen den Gegenstand unter dem Menü - und damit täte
        // der lange Druck ETWAS ANDERES als der Rechtsklick, der nie wählt. Legacy schluckt denselben Klick, nur eine
        // Stufe tiefer (Leaflets TapHold ruft `preventDefault` auf dem `touchend`).
        if (swallowClick) {
            clearSwallow();
            return;
        }
        // Ein Klick beendet das Zeigen; eine Antwort vom Server für die alte Stelle zeichnet nicht mehr, und ein schon geplantes Bild
        // des letzten Zeigens auch nicht (am Telefon blieb das Schild nach dem Tipp sonst stehen: der Tipp feuert vorher ein `mousemove`).
        cancelHover();
        // Der jüngste Klick zählt: Eine ältere Antwort vom Server entscheidet nichts mehr.
        clickRound?.abort();
        const round = new AbortController();
        clickRound = round;
        const list = eligible("click");
        const context = buildContext("click", event, list, round.signal);
        let told = false;
        const umschalt = (event.originalEvent as MouseEvent | undefined)?.shiftKey === true;
        const tell = (claimedBy: string | undefined): void => {
            if (told) return;
            told = true;
            for (const listener of [...clickObservers]) listener({ claimedBy, umschalt });
        };
        const finish = (winner: Resolution): void => {
            tell(winner?.owner.id);
            if (winner && !winner.aufgenommen && !round.signal.aborted)
                winner.owner.apply("click", winner.claim, context);
        };
        // Ein asynchroner Besitzer hält das Ergebnis auf; wer schon feststeht, wer NICHT gewinnt, erfährt es sofort.
        const result = resolve(list, context, () => tell(undefined), umschalt);
        if (isPromise(result)) void result.then(finish);
        else finish(result);
    };

    // --- Druck, Kontextmenü, langer Druck --------------------------------------------------------------------

    /**
     * 🔴 **Der lange Druck IST der Rechtsklick** (Betreiber 2026-10-08): Er geht durch DIESELBE Verteilung wie
     * `contextmenu`, nicht durch eine eigene Art. Gemessen wird er weiter hier (iOS meldet kein `contextmenu`),
     * entschieden wird er von derselben Rangtafel und denselben Besitzern - sonst entstünden zwei Verhalten für
     * dieselbe Sache.
     *
     * 🪤 `event` ist das `touchstart` vom BEGINN des Drucks: Stelle und Kartenpunkt sind die des Aufsetzens, nicht
     * die nach 550 ms. Sein `preventDefault` ist zu diesem Zeitpunkt folgenlos (MapLibres Handler sind längst
     * durch); das Browsermenü am Finger verhindert die Karte selbst (`contextmenu` wird abgefangen, solange
     * jemand darauf hört).
     */
    const longPress = createLongPress<MapTouchEvent>(
        (event) => {
            if (holder !== undefined) return;
            swallowClick = true;
            dispatchLatest("contextmenu", event);
        },
        { set: setTimer, clear: (handle) => clearTimer(handle) },
    );

    const onMouseDown = (event: MapMouseEvent): void => {
        if (holder === undefined) dispatchLatest("press", event);
    };
    const onTouchStart = (event: MapTouchEvent): void => {
        // Eine neue Berührung: Der Riegel des vorigen langen Drucks ist verbraucht, auch wenn gar kein Klick kam
        // (am echten Gerät unterdrückt der Browser ihn nach einem langen Druck mitunter selbst).
        clearSwallow();
        if (holder !== undefined) {
            longPress.cancel();
            return;
        }
        // Erst der lange Druck, dann der Druck: Wer den Finger beim Druck erfasst, bricht den langen ab.
        longPress.start(event, touchesOf(event));
        dispatchLatest("press", event);
    };
    const onTouchMove = (event: MapTouchEvent): void => longPress.move(touchesOf(event));
    /**
     * 🔴 Das Loslassen nach einem langen Druck tippt nichts an (Volltest 2026-11-01, `editor-menu.touch.spec.ts`): Der Druck hat das Menü geöffnet und über einem Ort auch das Infopanel, und
     * der Klick des Browsers traf, was jetzt unter dem Finger stand. Lag dort „Reiseziel hinzufügen“, war der Ort ein Ziel und das Menü wieder zu. `swallowClick` fängt nur Klicks auf die
     * Karte; `preventDefault` auf dem `touchend` nimmt den Klick ganz weg, wie Legacy (Leaflets TapHold).
     */
    const onTouchEnd = (event: MapTouchEvent): void => {
        longPress.cancel();
        if (!swallowClick) return;
        event.originalEvent.preventDefault();
        // 🔴 Nimmt der Browser den Klick, kommt keiner, der den Riegel verbrauchte; er fiele auf den nächsten echten Klick (Fixrunde zu WI-0272 S3, Befund im Wählmodus am Telefon: der Tipp,
        // der eine Stelle neu wählt, wurde verschluckt, sobald er ohne neuen Touch auf der Karte kam). Der Riegel gilt darum nur noch für das Fenster, in dem ein Browser den Klick trotzdem schickt.
        if (swallowTimer !== undefined) clearTimer(swallowTimer);
        swallowTimer = setTimer(() => {
            swallowTimer = undefined;
            swallowClick = false;
        }, LONG_PRESS_RELEASE_CLICK_MS);
    };
    const onContextMenu = (event: MapMouseEvent): void => {
        if (holder === undefined) dispatchLatest("contextmenu", event);
    };

    // --- Beobachter ------------------------------------------------------------------------------------------

    function domObserver(inputs: readonly string[]): {
        add: (listener: () => void) => () => void;
        dispose: () => void;
    } {
        const listeners = new Set<() => void>();
        const notify = (): void => {
            for (const listener of [...listeners]) listener();
        };
        let attached = false;
        const attach = (): void => {
            const container = map.getCanvasContainer();
            for (const type of inputs) container.addEventListener(type, notify, { capture: true, passive: true });
            attached = true;
        };
        const detach = (): void => {
            if (!attached) return;
            const container = map.getCanvasContainer();
            for (const type of inputs) container.removeEventListener(type, notify, true);
            attached = false;
        };
        return {
            add(listener) {
                listeners.add(listener);
                if (!attached) attach();
                return () => {
                    listeners.delete(listener);
                    if (listeners.size === 0) detach();
                };
            },
            dispose() {
                listeners.clear();
                detach();
            },
        };
    }
    const gestureObserver = domObserver(GESTURE_INPUTS);
    const activityObserver = domObserver(ACTIVITY_INPUTS);

    // --- Anmelden und Erfassen -------------------------------------------------------------------------------

    const priorityOf = (id: string): number =>
        owners.find((owner) => owner.id === id)?.priority ??
        (INTERACTION_PRIORITY as Record<string, number>)[id] ??
        Number.NEGATIVE_INFINITY;

    function release(mine: Holder): void {
        if (holder !== mine) return;
        holder = undefined;
        mine.detach();
        setCursor(undefined);
    }

    /**
     * 🪤 Umschalt-Klick (Mehrfachauswahl, Betreiber 2026-10-20): Drückt man mit Umschalt, beginnt MapLibres Rechteck-Zoom und
     * unterdrückt den folgenden Klick (`DOM.suppressClick`); ohne Zug meldet er nur `boxzoomcancel`. Daraus wird der Klick, den es sonst
     * nicht gäbe, mit Umschalt im `originalEvent`. Umschalt-Ziehen bleibt der Rechteck-Zoom.
     */
    const onBoxZoomCancel = (event: { originalEvent?: Event }): void => {
        const original = event.originalEvent;
        if (original === undefined || !("clientX" in original)) return;
        const maus = original as MouseEvent;
        const rahmen = map.getCanvasContainer().getBoundingClientRect();
        const lngLat = map.unproject([maus.clientX - rahmen.left, maus.clientY - rahmen.top]);
        // 🪤 Ein MapLibre-`Point`, kein `{ x, y }`: `queryRenderedFeatures` nimmt nur einen `Point` oder ein Array als Stelle. Ein
        // einfaches Objekt hielt es für die Optionen und fragte das ganze Bild ab; der Umschalt-Klick traf dann das erste Objekt irgendwo
        // (gemessen: ein fremder Ort statt des Gipfels oder der Kraftlinie unter dem Zeiger). `project` gibt einen `Point`.
        const point = map.project(lngLat);
        onClick({
            type: "click",
            target: map,
            originalEvent: maus,
            point,
            lngLat,
            defaultPrevented: false,
            preventDefault: () => undefined,
        } as unknown as MapMouseEvent);
    };

    map.on("click", onClick);
    map.on("boxzoomcancel", onBoxZoomCancel);
    map.on("mousemove", onMouseMove);
    map.on("mouseout", onMouseOut);
    map.on("movestart", onMoveStart);
    map.on("mousedown", onMouseDown);
    map.on("touchstart", onTouchStart);
    map.on("touchmove", onTouchMove);
    map.on("touchend", onTouchEnd);
    map.on("touchcancel", longPress.cancel);
    map.on("contextmenu", onContextMenu);

    return {
        register(owner) {
            if (destroyed) return () => undefined;
            if (owners.some((known) => known.id === owner.id)) {
                throw new Error(`Interaktion: Besitzer „${owner.id}“ ist schon angemeldet`);
            }
            const at = owners.findIndex((known) => known.priority < owner.priority);
            owners.splice(at === -1 ? owners.length : at, 0, owner);
            return () => {
                const index = owners.indexOf(owner);
                if (index === -1) return;
                owners.splice(index, 1);
                if (holder?.id === owner.id) release(holder);
                if (hoverOwner === owner) {
                    hoverOwner = undefined;
                    setCursor(undefined);
                    owner.lost?.("hover-ended");
                }
            };
        },

        capture(id, pointerId, cursor) {
            if (destroyed) return undefined;
            if (holder) {
                if (priorityOf(id) <= priorityOf(holder.id)) return undefined;
                // Die stärkere Geste verdrängt die laufende; deren Besitzer erfährt es.
                const displaced = holder;
                release(displaced);
                owners.find((owner) => owner.id === displaced.id)?.lost?.("preempted");
            }
            cancelHover(id);
            longPress.cancel();
            const mine: Holder = { id, detach: () => undefined };
            if (pointerId !== undefined) {
                const onEnd = (event: Event): void => {
                    if ((event as PointerEvent).pointerId === pointerId) release(mine);
                };
                pointerTarget.addEventListener("pointerup", onEnd, true);
                pointerTarget.addEventListener("pointercancel", onEnd, true);
                mine.detach = () => {
                    pointerTarget.removeEventListener("pointerup", onEnd, true);
                    pointerTarget.removeEventListener("pointercancel", onEnd, true);
                };
            }
            holder = mine;
            if (cursor !== undefined) setCursor(cursor);
            return () => release(mine);
        },

        captured: () => holder?.id,

        observe(kind: ObserverKind, listener: InteractionObservers[ObserverKind]) {
            if (destroyed) return () => undefined;
            if (kind === "gesture") return gestureObserver.add(listener as InteractionObservers["gesture"]);
            if (kind === "activity") return activityObserver.add(listener as InteractionObservers["activity"]);
            clickObservers.add(listener as InteractionObservers["click"]);
            return () => {
                clickObservers.delete(listener as InteractionObservers["click"]);
            };
        },

        suspendHover(reason, ownerIds) {
            if (destroyed) return () => undefined;
            const suspension = { reason, owners: ownerIds === undefined ? undefined : new Set(ownerIds) };
            suspensions.add(suspension);
            const shown = hoverOwner;
            if (shown && (suspension.owners === undefined || suspension.owners.has(shown.id))) {
                hoverRound?.abort();
                hoverRound = undefined;
                endHover();
            }
            return () => {
                suspensions.delete(suspension);
            };
        },

        destroy() {
            if (destroyed) return;
            cancelHover();
            destroyed = true;
            clickRound?.abort();
            for (const round of rounds.values()) round.abort();
            rounds.clear();
            longPress.cancel();
            clearSwallow();
            if (holder) release(holder);
            map.off("click", onClick);
            map.off("boxzoomcancel", onBoxZoomCancel);
            map.off("mousemove", onMouseMove);
            map.off("mouseout", onMouseOut);
            map.off("movestart", onMoveStart);
            map.off("mousedown", onMouseDown);
            map.off("touchstart", onTouchStart);
            map.off("touchmove", onTouchMove);
            map.off("touchend", onTouchEnd);
            map.off("touchcancel", longPress.cancel);
            map.off("contextmenu", onContextMenu);
            gestureObserver.dispose();
            activityObserver.dispose();
            clickObservers.clear();
            suspensions.clear();
            owners.length = 0;
        },
    };
}

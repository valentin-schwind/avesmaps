import { computed, reactive, ref, shallowRef, watch, type ComputedRef, type Ref, type ShallowRef } from "vue";
import {
    parseMapPointId,
    type RouteResponse,
    type SharePayload,
    type ShareResolved,
    type WaypointHit,
} from "@avesmaps3d/shared";
import {
    clampStartDay,
    copyOptions,
    DEFAULT_OPTIONS,
    DOMAINS,
    isLandmark,
    isMapPoint,
    mapPointHit,
    mapPointName,
    type PlannerOptions,
    type PlannerWaypoint,
    type TravelMode,
} from "./planner-model";
import { airFromShare, airQuery, airShare, copyAirChoice, type AirChoice } from "./air-profiles";
import { parsePointToken, pointToken, readPlannerLink, tragtPlanerangaben, writePlannerLink } from "./planner-link";
import { planerVoreinstellung } from "./planner-presets";
import { fetchNearestPlace, fetchRoute, noRouteMessage, resolveWaypointNames, routeQuery } from "./route-client";
import { startLoading } from "../feedback/loading-bar";
import { locale, t, tPlural } from "../i18n/i18n";

/**
 * Der Zustand des Routenplaners und was aus ihm folgt (WI-0017, Schritt 2): Wegpunkte, Optionen,
 * die Anfrage, die Route, die gewählte Etappe. Die Karte, der Toast und die Adresse sind
 * Wirkungen, die von außen kommen - so lässt sich alles hier ohne Browser prüfen.
 *
 * Legacys Regeln (MCS-020, D1-D3), mit drei Verbesserungen:
 *
 * - **Wann gerechnet wird:** Ein Wegpunkt ändert die Reise, danach wird die Route eingepasst; eine
 *   Option ändert nur die Rechnung, der Ausschnitt bleibt. Legacy passte beim Reisebeginn neu ein
 *   und sonst nicht - hier gilt EINE Regel.
 * - **Überholte Anfragen werden abgebrochen,** nicht nur verworfen. Legacy ließ sie zu Ende laufen.
 * - **Der Ladezustand erscheint erst nach 160 ms** (Legacys Ladebalken). Unsere Route braucht Millisekunden;
 *   ein Satz, der nur blinkt, wäre Unruhe. Die alte Route bleibt solange gedimmt stehen
 *   (Owner 14.09.2026: „gedimmt" statt weg).
 *
 * **Sammeln statt jede Änderung fragen (WI-0292, Vali 2026-11-09):** Ein paar schnelle Änderungen (Wegpunkte ziehen, Optionen umstellen) leerten in Production die
 * Drossel der Reise (429). Eine Option rechnet deshalb erst, wenn `SAMMELN_MS` lang keine weitere kam; ein Ort, ein Klick, ein Drop rechnet sofort, außer kurz nach der
 * letzten Frage: Dann wartet er bis `SAMMELN_MS` nach ihr, und nur die letzte Änderung geht raus. Dieselbe Reise mit denselben Optionen kommt beim Hin- und Herschalten
 * aus einem kleinen Speicher (`ROUTEN_SPEICHER`), ohne Frage - und mit ihr ihre Landschaften und ihr Unterwegs (`frageBeigaben` merkt sie am Routenobjekt).
 *
 * **Die Reiseart (WI-0050, WI-0051):** „Land & Wasser“ rechnet wie immer, „Flug“ fragt mit dem
 * Flugmittel an (`air` in der Route-API, in der Adresse und im Kurzlink). Reiseart und Flugmittel stehen
 * neben den Optionen, nicht in ihnen: Die Optionen gelten für Land und Wasser und bleiben beim Wechsel
 * erhalten; im Flug zählen von ihnen nur Reisestunden und Reisebeginn.
 */

export type PlannerStatus = "idle" | "loading" | "ready" | "none" | "error";

/** Ein gesetzter Wegpunkt auf der Karte; seine Marke lässt sich dort ziehen (`key` ist seine Zeile). */
export interface PlannerMapWaypoint {
    key: number;
    x: number;
    y: number;
    name: string;
}

export interface PlannerMapState {
    route: RouteResponse | null;
    stale: boolean;
    selectedStage: number | null;
    waypoints: readonly PlannerMapWaypoint[];
    /** Die Übertrittsstellen der Route, wenn der Nutzer sie zeigen will (WI-0065 Z3 C); sonst leer. Nur Anzeige. */
    borders: readonly { x: number; y: number; from: string; to: string }[];
}

export interface PlannerEffects {
    /** Die Karte zeigt Route und Wegpunkte. */
    showOnMap(state: PlannerMapState): void;
    /** Die Karte passt die Route ein, oder eine Etappe daraus. */
    fitRoute(route: RouteResponse, stage?: number): void;
    /** Die Karte zeigt einen Ort: in die sichtbare Mitte, heran nach seiner Klasse, nie heraus (WI-0039). */
    showPlace(place: WaypointHit): void;
    /** Ein Satz für den Toast. */
    notify(message: string): void;
    /** Die Parameter der Reise für die Adresse (ohne `?`). */
    writeAddress(query: string): void;
}

/** So lange darf eine Anfrage laufen, bevor „Route wird berechnet …" erscheint (Legacys Ladebalken). */
export const LOADING_DELAY_MS = 160;

/**
 * So lange sammelt der Planer Änderungen, bevor er fragt (WI-0292): nach einer Option, und nach einer Frage, bevor die nächste rausgeht. Unter der Schwelle, ab der man
 * eine Wartezeit spürt, und länger als die Pause zwischen zwei Klicks auf „Reisestunden pro Tag“.
 */
export const SAMMELN_MS = 350;

/** Der kleine Speicher der Routen (WI-0292): die letzten zwölf Antworten, je eine Minute; danach fragt der Planer neu (ein Editor kann das Wegenetz geändert haben). */
export const ROUTEN_SPEICHER = { max: 12, ms: 60_000 } as const;

/** Was der Planer anbietet: Zustand zum Lesen, Handlungen zum Aufrufen. */
export interface Planner {
    waypoints: PlannerWaypoint[];
    options: PlannerOptions;
    /** Land & Wasser oder Flug (WI-0050). */
    mode: Ref<TravelMode>;
    /** Das gewählte Flugmittel und die eigenen Werte; gilt nur im Flug. */
    air: AirChoice;
    route: ShallowRef<RouteResponse | null>;
    /** Die Absage, wenn es nur über gesperrte Wege ginge (WI-0038, `season_closed`); sonst null. */
    closed: ShallowRef<RouteResponse | null>;
    status: Ref<PlannerStatus>;
    stale: Ref<boolean>;
    /**
     * „Auf der Karte zeigen“ in der Liste der Grenzübertritte (WI-0065 Z3 C): Die Stellen erscheinen als Marken. Vorgabe
     * aus, in keinem Link und in keinem Kurzlink - Legacy kennt es nicht. Es gilt für die Route, die steht: Mit einer
     * neuen Anfrage, einer neuen Route und mit dem Neuladen ist es wieder aus.
     */
    showBorders: Ref<boolean>;
    showLoading: Ref<boolean>;
    selectedStage: Ref<number | null>;
    filled: ComputedRef<WaypointHit[]>;
    setPlace(key: number, place: WaypointHit | null): void;
    addWaypoint(): number;
    removeWaypoint(key: number): void;
    reverse(): void;
    clear(): void;
    move(from: number, to: number): void;
    setOptions(change: (options: PlannerOptions) => void): void;
    /** Die Reiseart wechseln: Der Flug nimmt die Route von der Karte, Land & Wasser rechnet sie wieder. */
    setMode(mode: TravelMode): void;
    /** Das Flugmittel oder seine eigenen Werte ändern; gerechnet wird damit erst mit dem Air Routing. */
    setAir(change: (air: AirChoice) => void): void;
    /** Die Unterbringung: Sie ändert nur die Kosten, also keine neue Anfrage (WI-0042). */
    setLodging(lodging: PlannerOptions["lodging"]): void;
    /** Die Übertrittsstellen auf der Karte zeigen oder nicht (WI-0065 Z3 C). Ohne Übertritte bleibt es aus. */
    setShowBorders(show: boolean): void;
    /**
     * „Hierher reisen“ im Kartenmenü (Rechtsklick auf die FREIE Fläche) und die Aktionskachel eines Kartenpunkts: der Punkt in die
     * letzte leere Zeile oder hinten an. Gibt zurück, ob er der Start ist, also noch ein Ziel fehlt. 🪤 Ein ORT geht nicht hier
     * durch, sondern durch `addPlace` - auch der Menüeintrag „Ziel hinzufügen“ (WI-0100).
     */
    addMapPoint(point: { x: number; y: number }): boolean;
    /**
     * „Reiseziel hinzufügen“ im Infopanel (WI-0063 P6, Legacy `add-location-to-route`): der Ort in die letzte leere Zeile oder hinten
     * an. Ein Ort, der schon Wegpunkt ist, wird nicht zweimal eingetragen (Legacy: die Kachel heißt dann „Reiseziel entfernen“).
     * Gibt zurück, ob der Ort der Start ist, also noch ein Ziel fehlt.
     */
    addPlace(place: WaypointHit): boolean;
    /**
     * „Weg als Route“ im Infopanel (WI-0063 P7, B12, Legacy `resetWaypointInputs` und `updateMapView`): Die Orte ERSETZEN alle Wegpunkte -
     * auch Kartenpunkte und eine bestehende Reise -, danach wird gerechnet und die Route eingepasst. Die Optionen bleiben. Ohne Orte
     * geschieht nichts: Eine leere Reise gäbe es nur durch „Löschen“.
     */
    replaceWaypoints(places: readonly WaypointHit[]): Promise<void>;
    /**
     * Eine Marke wurde gezogen (WI-0052): eingerastet auf einen Ort, sonst an eine Lage - dann ist
     * die Zeile ein Kartenpunkt, auch wenn sie vorher ein Ort war.
     */
    moveWaypoint(key: number, to: WaypointHit | { x: number; y: number }): void;
    selectStage(index: number | null, zoom: boolean): void;
    stepStage(step: 1 | -1): void;
    fitWholeRoute(): void;
    restore(search: string, fit: boolean): Promise<void>;
    /** Der Zustand für einen Kurzlink (WI-0034): feste Kennungen und Optionen; `null` ohne Reise. */
    shareState(): { waypoints: string[]; options: PlannerOptions; air?: NonNullable<SharePayload["air"]> } | null;
    /** Eine Reise aus einem Kurzlink; Orte, die es nicht mehr gibt, nennt der Toast. */
    restoreShared(shared: ShareResolved, fit: boolean): Promise<void>;
}

export function createPlanner(effects: PlannerEffects): Planner {
    let nextKey = 1;
    const emptyRow = (): PlannerWaypoint => ({ key: nextKey++, place: null });
    const waypoints = reactive<PlannerWaypoint[]>([emptyRow()]);
    // Ein neuer Besuch beginnt mit der Voreinstellung der Systemsteuerung (WI-0166); trägt die Adresse eine Reise oder eine
    // Option, liest `restore` sie gegen die FESTE Vorgabe und überschreibt das hier (`planner-presets.ts`).
    const start = planerVoreinstellung();
    const options = reactive<PlannerOptions>(copyOptions(start.options));
    const mode = ref<TravelMode>(start.mode);
    const air = reactive<AirChoice>(copyAirChoice(start.air));
    const route = shallowRef<RouteResponse | null>(null);
    const closed = shallowRef<RouteResponse | null>(null);
    const status = ref<PlannerStatus>("idle");
    const stale = ref(false);
    const showBorders = ref(false);
    const showLoading = ref(false);
    const selectedStage = ref<number | null>(null);
    const filled = computed(() =>
        waypoints.map((row) => row.place).filter((place): place is WaypointHit => place !== null),
    );

    let controller: AbortController | undefined;
    let loadingTimer: ReturnType<typeof setTimeout> | undefined;
    let request = 0;
    // Das Sammeln (WI-0292): der Wecker der wartenden Frage, wann die letzte rausging, ob eine gesammelte Änderung einpassen will, und wer auf sie wartet.
    let sammelTimer: ReturnType<typeof setTimeout> | undefined;
    let gesendetUm = Number.NEGATIVE_INFINITY;
    let einpassenOffen = false;
    let wartende: ((fertig: Promise<void>) => void)[] = [];
    const loesen = (fertig: Promise<void>): Promise<void> => {
        const jetzt = wartende;
        wartende = [];
        for (const resolve of jetzt) resolve(fertig);
        return fertig;
    };
    const speicher = new Map<string, { route: RouteResponse; bis: number }>();
    const ausSpeicher = (key: string): RouteResponse | undefined => {
        const eintrag = speicher.get(key);
        if (eintrag === undefined) return undefined;
        speicher.delete(key);
        if (eintrag.bis < Date.now()) return undefined;
        speicher.set(key, eintrag);
        return eintrag.route;
    };
    const merke = (key: string, gemerkt: RouteResponse): void => {
        speicher.delete(key);
        speicher.set(key, { route: gemerkt, bis: Date.now() + ROUTEN_SPEICHER.ms });
        for (const alt of speicher.keys()) {
            if (speicher.size <= ROUTEN_SPEICHER.max) break;
            speicher.delete(alt);
        }
    };

    /** Die Übertrittsstellen der stehenden Route, sobald der Nutzer sie zeigen will: Der Server hat sie im Result. */
    const borderMarks = (): PlannerMapState["borders"] =>
        showBorders.value && !stale.value
            ? (route.value?.travel_costs?.borders?.crossings ?? []).map(({ x, y, from, to }) => ({
                  x,
                  y,
                  from: from.name,
                  to: to.name,
              }))
            : [];

    const syncMap = (): void =>
        effects.showOnMap({
            route: route.value,
            stale: stale.value,
            selectedStage: selectedStage.value,
            borders: borderMarks(),
            waypoints: waypoints.flatMap((row) =>
                row.place
                    ? [
                          {
                              key: row.key,
                              x: row.place.x,
                              y: row.place.y,
                              name: row.place.name,
                          },
                      ]
                    : [],
            ),
        });
    const syncAddress = (): void =>
        effects.writeAddress(
            writePlannerLink(
                // Ein Kartenpunkt steht als Lage, eine Landmarke als Kennung (WI-0271 L6), ein Ort als Name (Legacy).
                filled.value.map((place) =>
                    isMapPoint(place) ? pointToken(place) : isLandmark(place) ? place.id : place.name,
                ),
                options,
                mode.value === "air" ? air : null,
            ),
        );

    const settle = (next: RouteResponse | null, nextStatus: PlannerStatus): void => {
        // Eine neue Route hat neue Übertritte: Das Häkchen gehört der Route, die es gesetzt hat.
        showBorders.value = false;
        route.value = next;
        closed.value = null;
        stale.value = false;
        status.value = nextStatus;
        syncMap();
    };

    /** Was eine Frage braucht, zum Zeitpunkt der Änderung festgehalten: Eine spätere Änderung rechnet ohnehin neu. */
    interface Frage {
        id: number;
        places: WaypointHit[];
        options: PlannerOptions;
        air: AirChoice | null;
        key: string;
    }

    /**
     * Rechnen nach einer Änderung. `sammeln` (eine Option, die Reiseart, das Flugmittel) wartet `SAMMELN_MS` auf die nächste; `sofort` (Ort, Klick, Drop) fragt gleich,
     * außer die letzte Frage ist jünger als `SAMMELN_MS` (WI-0292). Bis dahin steht die alte Route gedimmt da; die Adresse und die Karte folgen sofort.
     */
    function recompute(fit: boolean, art: "sofort" | "sammeln" = "sofort"): Promise<void> {
        syncAddress();
        // Mit der Anfrage wird die Route, an der das Häkchen hing, ersetzt: Die Marken gehen sofort.
        showBorders.value = false;
        controller?.abort();
        clearTimeout(loadingTimer);
        clearTimeout(sammelTimer);
        showLoading.value = false;
        selectedStage.value = null;
        const id = ++request;
        const places = filled.value;
        if (places.length < 2) {
            einpassenOffen = false;
            settle(null, "idle");
            const only = places[0];
            if (fit && only) effects.showPlace(only);
            return loesen(Promise.resolve());
        }
        if (mode.value !== "air" && !DOMAINS.some((domain) => options.enabled[domain])) {
            // Kein Medium erlaubt: Es gibt keine Route, und das weiß man, ohne zu fragen.
            einpassenOffen = false;
            settle(null, "none");
            return loesen(Promise.resolve());
        }
        einpassenOffen ||= fit;
        const frage: Frage = {
            id,
            places,
            options: copyOptions(options),
            air: mode.value === "air" ? copyAirChoice(air) : null,
            key: "",
        };
        frage.key = routeQuery(
            places.map((place) => place.id),
            frage.options,
            frage.air,
        );
        const gemerkt = ausSpeicher(frage.key);
        if (gemerkt !== undefined) {
            // Dieselbe Reise wie vor Kurzem: ohne Frage, ohne Warten (WI-0292).
            const einpassen = einpassenOffen;
            einpassenOffen = false;
            zeige({ ok: true, route: gemerkt }, places, einpassen);
            return loesen(Promise.resolve());
        }
        stale.value = route.value !== null;
        status.value = "loading";
        syncMap();
        const warten = art === "sammeln" ? SAMMELN_MS : gesendetUm + SAMMELN_MS - Date.now();
        if (warten <= 0) return loesen(frageRoute(frage));
        sammelTimer = setTimeout(() => void loesen(frageRoute(frage)), warten);
        return new Promise((resolve) => wartende.push(resolve));
    }

    async function frageRoute({ id, places, options: gefragt, air: flug, key }: Frage): Promise<void> {
        gesendetUm = Date.now();
        const einpassen = einpassenOffen;
        einpassenOffen = false;
        loadingTimer = setTimeout(() => {
            if (id === request) showLoading.value = true;
        }, LOADING_DELAY_MS);
        const current = new AbortController();
        controller = current;
        const loaded = startLoading();
        let outcome: Awaited<ReturnType<typeof fetchRoute>>;
        try {
            outcome = await fetchRoute(
                places.map((place) => place.id),
                gefragt,
                current.signal,
                flug,
            );
        } catch (error) {
            if (id !== request || (error instanceof DOMException && error.name === "AbortError")) return;
            settle(null, "error");
            effects.notify(t("route.error.routing_failed"));
            return;
        } finally {
            loaded();
            if (id === request) {
                clearTimeout(loadingTimer);
                showLoading.value = false;
            }
        }
        if (id !== request) return;
        if (outcome.ok) merke(key, outcome.route);
        zeige(outcome, places, einpassen);
    }

    /** Die Antwort zeigen, aus der Frage oder aus dem Speicher. */
    function zeige(
        outcome: Awaited<ReturnType<typeof fetchRoute>>,
        places: readonly WaypointHit[],
        fit: boolean,
    ): void {
        /*
         * 🔴 Ab hier außerhalb des try (WI-0202, Review W3-03). Bis dahin umschloss er auch `settle` und `fitRoute`, also
         * `syncMap` → `showOnMap` → Kartenzeichencode in `app.vue`: Warf der beim Zeichnen einer fertig berechneten Route, wurde
         * die gültige Route verworfen, der Toast sagte „Route konnte nicht berechnet werden“, und keine Konsole sah den Fehler.
         * Jetzt entkommt ein solcher Fehler als unbehandelte Ablehnung: Er steht mit Stapel in der Konsole, und der Fänger
         * meldet ihn als `unbehandelt`.
         */
        if (!outcome.ok) {
            settle(null, "error");
            effects.notify(outcome.message);
        } else if (!outcome.route.found && outcome.route.reason === "season_closed") {
            // Nur über gesperrte Wege: Die Absage steht mit ihren Gründen im Panel (Owner 14.09.2026).
            settle(null, "none");
            closed.value = outcome.route;
        } else if (!outcome.route.found) {
            settle(null, "none");
            effects.notify(
                noRouteMessage(
                    outcome.route,
                    places.map((place) => place.name),
                    options,
                ),
            );
        } else {
            settle(outcome.route, "ready");
            if (fit) effects.fitRoute(outcome.route);
        }
    }

    const indexOf = (key: number): number => waypoints.findIndex((row) => row.key === key);

    /**
     * Ein Kartenpunkt heißt nach dem Ort, der ihm am nächsten liegt („Kartenpunkt bei Gareth“). Die
     * Frage läuft nach; der Name kommt, wenn die Zeile den Punkt dann noch hält.
     */
    const nameMapPoint = (key: number, point: WaypointHit): void => {
        void fetchNearestPlace(point)
            .then((near) => {
                const row = waypoints[indexOf(key)];
                if (row?.place?.id !== point.id) return;
                row.place = { ...point, name: mapPointName(near.place, near.distance) };
                syncMap();
            })
            .catch(() => undefined);
    };

    // Ein Kartenpunkt heißt in der Sprache der Seite: Wechselt sie, bekommt er seinen Namen neu (WI-0032).
    watch(locale, () => {
        for (const row of waypoints) {
            if (row.place && isMapPoint(row.place)) nameMapPoint(row.key, row.place);
        }
    });

    /** Eine Reise aus einem Link: die gefundenen Orte in Reihenfolge, dann rechnen. */
    async function load(places: readonly (WaypointHit | null)[], fit: boolean): Promise<void> {
        const rows = places
            .filter((place): place is WaypointHit => place !== null)
            .map((place) => ({ ...emptyRow(), place }));
        waypoints.splice(0, waypoints.length, ...(rows.length > 0 ? rows : [emptyRow()]));
        for (const row of rows) if (isMapPoint(row.place)) nameMapPoint(row.key, row.place);
        await recompute(fit);
    }

    /** Eine Etappe wählen: gold auf der Karte; mit `zoom` fliegt die Karte hin (Legacy E6). */
    function selectStage(index: number | null, zoom: boolean): void {
        const current = route.value;
        if (!current || stale.value) return;
        selectedStage.value = index !== null && index >= 0 && index < current.stages.length ? index : null;
        syncMap();
        if (zoom && selectedStage.value !== null) effects.fitRoute(current, selectedStage.value);
    }

    return {
        waypoints,
        options,
        mode,
        air,
        route,
        closed,
        status,
        stale,
        showBorders,
        showLoading,
        selectedStage,
        filled,

        /** Ein Ort für eine Zeile - oder keiner mehr. */
        setPlace(key: number, place: WaypointHit | null): void {
            const row = waypoints[indexOf(key)];
            if (!row || row.place?.id === place?.id) return;
            row.place = place;
            void recompute(true);
        },

        addMapPoint(point): boolean {
            const hit = mapPointHit(point);
            // Legacy `fillLastEmptyWaypointOrAppend`: die letzte Zeile, wenn sie leer ist, sonst eine neue - es HÄNGT AN, nie ersetzt es.
            const last = waypoints[waypoints.length - 1];
            const row = last && last.place === null ? last : emptyRow();
            if (row !== last) waypoints.push(row);
            row.place = hit;
            nameMapPoint(row.key, hit);
            void recompute(true);
            return filled.value.length < 2;
        },

        addPlace(place): boolean {
            if (!filled.value.some((entry) => entry.id === place.id)) {
                const last = waypoints[waypoints.length - 1];
                if (!(last && last.place === null)) waypoints.push(emptyRow());
                // Die Zeile kommt aus dem reaktiven Feld zurück: Am rohen Objekt gesetzt, sähe Vue den Ort nicht, und `filled` bliebe alt.
                const row = waypoints[waypoints.length - 1];
                if (row) row.place = place;
                void recompute(true);
            }
            return filled.value.length < 2;
        },

        replaceWaypoints(places): Promise<void> {
            if (places.length === 0) return Promise.resolve();
            // Dieselbe Naht wie eine Reise aus einem Link: die Orte in Reihenfolge, dann rechnen und einpassen.
            return load(places, true);
        },

        moveWaypoint(key, to): void {
            const row = waypoints[indexOf(key)];
            if (!row?.place) return;
            // Ein Kartenpunkt behält seinen Namen, bis der neue kommt; ein verlassener Ort gibt seinen nicht weiter.
            const place = "id" in to ? to : mapPointHit(to, isMapPoint(row.place) ? row.place.name : undefined);
            if (place.id === row.place.id) return;
            row.place = place;
            if (isMapPoint(place)) nameMapPoint(key, place);
            // Gezogen wird auf der Karte, im Ausschnitt, den man gerade sieht: Er bleibt.
            void recompute(false);
        },

        /** „Ziel hinzufügen": eine leere Zeile ans Ende; gerechnet wird erst mit einem Ort (Legacy). */
        addWaypoint(): number {
            const row = emptyRow();
            waypoints.push(row);
            return row.key;
        },

        /** ✕: Die Zeile verschwindet; die einzige wird nur geleert (Legacy). */
        removeWaypoint(key: number): void {
            const at = indexOf(key);
            if (at < 0) return;
            if (waypoints.length === 1) {
                const only = waypoints[0];
                if (only) only.place = null;
            } else {
                waypoints.splice(at, 1);
            }
            void recompute(true);
        },

        /** ⇅: die ganze Folge umdrehen, leere Zeilen ans Ende (Owner 15.09.2026). */
        reverse(): void {
            const withPlace = waypoints.filter((row) => row.place !== null).reverse();
            const empty = waypoints.filter((row) => row.place === null);
            waypoints.splice(0, waypoints.length, ...withPlace, ...empty);
            void recompute(true);
        },

        /** 🗑: zurück auf eine leere Zeile; die Optionen bleiben (Legacy). */
        clear(): void {
            waypoints.splice(0, waypoints.length, emptyRow());
            void recompute(false);
        },

        /** Eine Zeile an eine andere Stelle ziehen. */
        move(from: number, to: number): void {
            if (from === to || from < 0 || to < 0 || from >= waypoints.length || to >= waypoints.length) return;
            const [row] = waypoints.splice(from, 1);
            if (row) waypoints.splice(to, 0, row);
            void recompute(true);
        },

        /** Eine Option ändert die Rechnung, nicht den Ausschnitt; gesammelt (WI-0292). */
        setOptions(change: (options: PlannerOptions) => void): void {
            change(options);
            void recompute(false, "sammeln");
        },

        setMode(next) {
            if (mode.value === next) return;
            mode.value = next;
            void recompute(false, "sammeln");
        },

        /** Ein anderes Flugmittel rechnet neu; der Name des eigenen ändert nur die Adresse. */
        setAir(change) {
            const before = JSON.stringify(airQuery(air));
            change(air);
            if (mode.value !== "air") return;
            if (JSON.stringify(airQuery(air)) !== before) void recompute(false, "sammeln");
            else syncAddress();
        },

        setLodging(lodging) {
            if (options.lodging === lodging) return;
            options.lodging = lodging;
            syncAddress();
        },

        setShowBorders(show) {
            // Nur mit Übertritten an der stehenden Route gibt es etwas zu zeigen.
            const has = (route.value?.travel_costs?.borders?.count ?? 0) > 0;
            const next = show && has && !stale.value;
            if (showBorders.value === next) return;
            showBorders.value = next;
            syncMap();
        },

        selectStage,

        /** Bild↑/Bild↓: vorige oder nächste Etappe; ohne Wahl beginnt es vorn bzw. hinten (Legacy). */
        stepStage(step: 1 | -1): void {
            const current = route.value;
            if (!current || current.stages.length === 0) return;
            const last = current.stages.length - 1;
            const from = selectedStage.value;
            const next = from === null ? (step > 0 ? 0 : last) : Math.min(last, Math.max(0, from + step));
            selectStage(next, true);
        },

        /** Die ganze Route wieder einpassen (Titelzeile). */
        fitWholeRoute(): void {
            if (route.value) effects.fitRoute(route.value);
        },

        /**
         * Eine Reise aus der Adresse herstellen - `?route=Gareth~Perricum` oder Legacys Form. Namen,
         * die kein Ort eindeutig trägt, nennt der Toast (Kap. 9.57: nie still ein anderer Ort).
         * `fit`: ohne eigenen Kartenausschnitt im Link wird die Route eingepasst.
         */
        async restore(search: string, fit: boolean): Promise<void> {
            const link = readPlannerLink(search);
            // 🔴 Nur eine Adresse MIT Angaben des Planers ersetzt die Voreinstellung, und dann ganz: gelesen gegen die feste
            // Vorgabe, damit ein alter Link dasselbe öffnet wie immer (WI-0166). Ohne Angabe bleibt die Voreinstellung stehen.
            if (tragtPlanerangaben(search)) {
                Object.assign(options, copyOptions(link.options));
                // Der Link trägt den Flug (WI-0051) oder nicht; ohne ihn reist die Route über Land und Wasser.
                if (link.air) Object.assign(air, copyAirChoice(link.air));
                mode.value = link.air ? "air" : "surface";
            }
            if (link.names.length === 0) {
                if (search !== "") syncAddress();
                return;
            }
            // Kartenpunkte stehen als Lage im Link, Orte als Namen - nur die Namen fragen wir nach.
            const points = link.names.map((name) => parsePointToken(name));
            const names = link.names.filter((_, index) => points[index] === null);
            let resolved: (WaypointHit | null)[] = [];
            try {
                resolved = names.length > 0 ? await resolveWaypointNames(names) : [];
            } catch {
                effects.notify(t("route.linkPlacesFailed"));
                return;
            }
            let next = 0;
            const places = points.map((point) => (point ? mapPointHit(point) : (resolved[next++] ?? null)));
            const missing = link.names.filter((_, index) => places[index] === null);
            if (missing.length > 0) effects.notify(t("route.placesNotFound", { names: missing.join(", ") }));
            await load(places, fit);
        },

        shareState() {
            const places = filled.value;
            if (places.length < 2) return null;
            const state = { waypoints: places.map((place) => place.id), options: copyOptions(options) };
            return mode.value === "air" ? { ...state, air: airShare(air) } : state;
        },

        /**
         * Ein Kurzlink trägt Kennungen, keine Namen: Ein Kartenpunkt seine Lage, ein Ort seine
         * `public_id`, die der Server zu den Orten von heute aufgelöst hat. Einen Namen für einen
         * verschwundenen Ort gibt es nicht mehr - der Toast sagt, wie viele fehlen.
         */
        async restoreShared(shared, fit) {
            // Ein Zustand von vor WI-0038 trägt keinen Reisebeginn, einer von vor WI-0042 keine
            // Unterbringung, einer von vor WI-0078 kein Eiltempo: Er reist ohne Datum, mit der Vorgabe und im
            // normalen Tempo.
            Object.assign(
                options,
                copyOptions({
                    ...shared.payload.options,
                    departure: shared.payload.options.departure
                        ? {
                              ...shared.payload.options.departure,
                              day: clampStartDay(
                                  shared.payload.options.departure.day,
                                  shared.payload.options.departure.month,
                              ),
                          }
                        : null,
                    lodging: shared.payload.options.lodging ?? DEFAULT_OPTIONS.lodging,
                    hurry: shared.payload.options.hurry ?? DEFAULT_OPTIONS.hurry,
                }),
            );
            const flight = shared.payload.air ? airFromShare(shared.payload.air) : null;
            if (flight) Object.assign(air, flight);
            mode.value = flight ? "air" : "surface";
            const places = shared.payload.waypoints.map((id, index) => {
                const point = parseMapPointId(id);
                return point ? mapPointHit(point) : (shared.places[index] ?? null);
            });
            const missing = places.filter((place) => place === null).length;
            if (missing > 0) {
                effects.notify(tPlural("share.placeMissing", missing, { n: missing }));
            }
            await load(places, fit);
        },
    };
}

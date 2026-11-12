import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    canonicalSharePayload,
    SharePayload,
    type RouteResponse,
    type RouteSegment,
    type RouteStage,
    type ShareResolved,
    type WaypointHit,
} from "@avesmaps3d/shared";
import { Value } from "@sinclair/typebox/value";
import { offroadShapes, routeLineFeatures, routeRenderBounds } from "../src/map/route-layers.ts";
import { travelerCorners, travelerScale } from "../src/map/traveler-layer.ts";
import { MercatorCoordinate } from "maplibre-gl";
import { groundAt, groundTrack, PILL_PERIOD, placePills, sampleGround, type Pill } from "../src/map/route-pills.ts";
import {
    parsePointToken,
    pointToken,
    readPlannerLink,
    withPlannerLink,
    writePlannerLink,
} from "../src/route-planner/planner-link.ts";
import {
    isMapPoint,
    mapPointHit,
    mapPointName,
    clampHoursPerDay,
    copyOptions,
    DEFAULT_OPTIONS,
    optionsSummary,
    pointLabel,
    transportSummary,
    waypointLabel,
} from "../src/route-planner/planner-model.ts";
import { noRouteMessage, routeQuery } from "../src/route-planner/route-client.ts";
import { copyAirChoice, DEFAULT_AIR_CHOICE } from "../src/route-planner/air-profiles.ts";
import { t } from "../src/i18n/i18n.ts";
import {
    createPlanner,
    ROUTEN_SPEICHER,
    SAMMELN_MS,
    type PlannerEffects,
    type PlannerMapState,
} from "../src/route-planner/use-planner.ts";
import {
    copyToClipboard,
    readShareCode,
    useShareLink,
    type ShareLinkEffects,
} from "../src/route-planner/use-share-link.ts";

/**
 * Der Routenplaner ohne Browser (WI-0017, Schritt 2): die Reise in der Adresse, die Zusammenfassungen
 * der Klappkästen, und was der Planer bei jeder Handlung tut.
 */

describe("Die Reise in der Adresse", () => {
    it("liest die lesbare Form ?route=Gareth~Perricum (Betreiber: „mach ?route=“)", () => {
        expect(readPlannerLink("?route=Gareth~Perricum").names).toEqual(["Gareth", "Perricum"]);
    });

    it("🔴 liest Legacys Links weiter: wiederholtes route, die Aliasse, jede Option unter Legacys Namen", () => {
        const link = readPlannerLink(
            "?route=Gareth&route=Tuzak&routes=Paavi&pathType=shortest&minimizeTransfers=1&allowSea=0&landTransport=lightRider&restHours=14",
        );
        expect(link.names).toEqual(["Gareth", "Tuzak", "Paavi"]);
        expect(link.options).toMatchObject({
            optimize: "shortest",
            minimizeTransfers: true,
            enabled: { land: true, river: true, sea: false },
            transports: { land: "lightRider", river: "riverSailer", sea: "cargoShip" },
            // Legacy speichert die Rast: 14 h Rast sind 10 Reisestunden.
            hoursPerDay: 10,
        });
        expect(readPlannerLink("?route=A&route=B&includeRests=0").options.hoursPerDay).toBe(24);
    });

    it("lässt Unbekanntes auf der Vorgabe und nimmt höchstens 100 Wegpunkte", () => {
        const link = readPlannerLink("?landTransport=Drache&restHours=99&pathType=luftlinie");
        expect(link.options).toEqual(DEFAULT_OPTIONS);
        const hundertEins = Array.from({ length: 101 }, (_, index) => `Ort${String(index)}`).join("~");
        expect(readPlannerLink(`?route=${hundertEins}`).names).toHaveLength(100);
    });

    it("schreibt nur Abweichungen von der Vorgabe, wie Legacy", () => {
        expect(writePlannerLink(["Gareth", "Perricum"], DEFAULT_OPTIONS)).toBe("route=Gareth~Perricum");
        const options = copyOptions(DEFAULT_OPTIONS);
        options.optimize = "shortest";
        options.enabled.river = false;
        options.transports.land = "lightRider";
        options.hoursPerDay = 10;
        expect(writePlannerLink(["Calladûn", "Paßwacht"], options)).toBe(
            "route=Callad%C3%BBn~Pa%C3%9Fwacht&pathType=shortest&landTransport=lightRider&allowRiver=0&restHours=14",
        );
    });

    it("was sie schreibt, liest sie genau so zurück", () => {
        const options = copyOptions(DEFAULT_OPTIONS);
        options.minimizeTransfers = true;
        options.transports.sea = "galley";
        options.hoursPerDay = 24;
        const query = writePlannerLink(["Gareth", "Perricum", "Havena"], options);
        expect(readPlannerLink(`?${query}`)).toEqual({ names: ["Gareth", "Perricum", "Havena"], options, air: null });
    });

    it("🔴 der Flug (WI-0051): ein Flugmittel beim Namen, das eigene mit Werten; Unbekanntes öffnet keinen Flug", () => {
        const flight = copyAirChoice(DEFAULT_AIR_CHOICE);
        flight.profile = "custom";
        flight.custom = { name: "Besen & Stiel", speedMph: 12.5, altitudePaces: 300 };
        const query = writePlannerLink(["Gareth", "Punin"], DEFAULT_OPTIONS, flight);
        expect(query).toBe("route=Gareth~Punin&air=custom&airSpeed=12.5&airAltitude=300&airName=Besen%20%26%20Stiel");
        expect(readPlannerLink(`?${query}`).air).toEqual(flight);
        expect(readPlannerLink("?route=A~B&air=griffin").air?.profile).toBe("griffin");
        expect(readPlannerLink("?route=A~B&air=drache").air).toBeNull();
        // Werte außerhalb der Grenzen werden eingeklemmt, Unlesbares fällt auf die Vorgabe.
        const wild = readPlannerLink("?route=A~B&air=custom&airSpeed=5000&airAltitude=abc").air;
        expect(wild?.custom).toMatchObject({ speedMph: 999, altitudePaces: 250 });
    });

    it("🔴 Eiltempo (WI-0078): `hurry=1` nur als Abweichung; ein Link ohne den Parameter reist im normalen Tempo", () => {
        expect(writePlannerLink(["Gareth", "Perricum"], DEFAULT_OPTIONS)).not.toContain("hurry");
        const options = copyOptions(DEFAULT_OPTIONS);
        options.hurry = true;
        const query = writePlannerLink(["Gareth", "Perricum"], options);
        expect(query).toBe("route=Gareth~Perricum&hurry=1");
        expect(readPlannerLink(`?${query}`)).toEqual({ names: ["Gareth", "Perricum"], options, air: null });
        expect(readPlannerLink("?route=A~B").options.hurry).toBe(false);
        expect(readPlannerLink("?route=A~B&hurry=0").options.hurry).toBe(false);
    });

    it("ersetzt nur die eigenen Parameter und lässt die übrigen stehen", () => {
        expect(withPlannerLink("?besucher&route=Alt&pathType=shortest", "route=Gareth~Perricum")).toBe(
            "?route=Gareth~Perricum&besucher=",
        );
        expect(withPlannerLink("?route=Alt", "")).toBe("");
    });
});

describe("Die Klappkästen und ihre Zusammenfassung", () => {
    it("Transportmittel: Bild und Name je erlaubtem Medium, dahinter die Routenwahl (WI-0050)", () => {
        expect(transportSummary(DEFAULT_OPTIONS).map((part) => part.text)).toEqual([
            "Reisegruppe zu Fuß",
            "Flusssegler",
            "Lastensegler",
            "Schnellste Route",
        ]);
        const none = copyOptions(DEFAULT_OPTIONS);
        none.enabled = { land: false, river: false, sea: false };
        none.optimize = "shortest";
        none.minimizeTransfers = true;
        none.hurry = true;
        // Eiltempo wird hinten angehängt (Betreiber 2026-10-05, F7 = B): nichts wechselt seinen Platz.
        expect(transportSummary(none)).toEqual([
            { text: "kein Transportmittel erlaubt" },
            { text: "Kürzeste Route" },
            { text: "Umsteigen minimieren" },
            { text: "Eiltempo" },
        ]);
    });

    /**
     * 🔴 Die Leiste nennt seit dem 2026-10-06 ALLE DREI Einstellungen des Kastens, in seiner Reihenfolge (Betreiber:
     * „wenn das reisedatum unbekannt ist … sollte das auch im header stehen. Gemeinschaftszimmer kann auch
     * dranstehen"). Die Routenwahl steht weiter unter „Transportmittel", nicht hier.
     */
    it("Reiseoptionen: Reisestunden, Reisebeginn und Unterbringung - die Routenwahl steht unter Transportmittel", () => {
        expect(optionsSummary(DEFAULT_OPTIONS).map((part) => part.text)).toEqual([
            "8,0 h/Tag",
            // Ohne Datum dasselbe Wort wie in der Auswahl selbst - kein zweites dafür.
            "Unbestimmt",
            "Gemeinschaftszimmer",
        ]);
        const options = copyOptions(DEFAULT_OPTIONS);
        options.optimize = "shortest";
        options.minimizeTransfers = true;
        options.hoursPerDay = 10.5;
        options.departure = { month: "firun", day: 15 };
        options.lodging = "zimmer";
        // 🪤 Mit Datum steht das DATUM da, nicht der Vorgabetext.
        expect(optionsSummary(options).map((part) => part.text)).toEqual([
            "10,5 h/Tag",
            "ab 15. Firun",
            "Einzelzimmer",
        ]);
    });

    it("die Reisestunden bleiben in halben Stunden zwischen 0,5 und 24", () => {
        expect(clampHoursPerDay(7.3)).toBe(7.5);
        expect(clampHoursPerDay(0)).toBe(0.5);
        expect(clampHoursPerDay(30)).toBe(24);
        expect(clampHoursPerDay(Number.NaN)).toBe(8);
    });

    it("benennt Etappenenden ohne Ort wie Legacy und versteckte Orte mit Vermerk", () => {
        expect(pointLabel({ point: "exit", place_id: null, name: "", x: 0, y: 0 })).toBe("Abgangspunkt");
        expect(pointLabel({ point: "join", place_id: null, name: "", x: 0, y: 0 })).toBe("Anschlusspunkt");
        expect(pointLabel({ point: "landing", place_id: null, name: "", x: 0, y: 0 })).toBe("Anlegestelle");
        expect(pointLabel({ point: "marker", place_id: null, name: "", x: 0, y: 0 })).toBe("Markierung");
        expect(waypointLabel(hit("Feenplatz", { hidden: true }))).toBe("Feenplatz (verborgen)");
    });
});

function hit(name: string, over: Partial<WaypointHit> = {}): WaypointHit {
    return { id: `id-${name}`, name, subtype: "dorf", hidden: false, x: 1, y: 2, ...over };
}

function routeOf(found: boolean, stages = 2): RouteResponse {
    return {
        found,
        failed_leg_index: found ? null : 0,
        map_domain: "aventuria",
        travel_model_version: "v",
        routing_graph_revision: "r",
        waypoints: [
            { id: "id-Gareth", name: "Gareth" },
            { id: "id-Perricum", name: "Perricum" },
        ],
        legs: [],
        segments: [],
        distance_units: 0,
        travel_hours: 0,
        travel_days: 0,
        hours_per_day: 8,
        rest_hours: 0,
        total_hours: 0,
        miles_per_unit: 3,
        air_legs_units: [],
        stages: Array.from({ length: found ? stages : 0 }, (_, index) => ({
            index,
            leg_index: 0,
            segment_start: index,
            segment_count: 1,
            type: "Strasse",
            transport: "groupFoot",
            flow_state: null,
            path_names: [],
            from: { point: "place" as const, place_id: "a", name: "A", x: 0, y: 0 },
            to: { point: "place" as const, place_id: "b", name: "B", x: 1, y: 1 },
            distance_units: 1,
            travel_hours: 1,
            rest_hours: 0,
        })),
        warnings: [],
    };
}

function effectsSpy() {
    const calls = {
        maps: [] as PlannerMapState[],
        fits: [] as (number | undefined)[],
        flights: 0,
        notes: [] as string[],
        addresses: [] as string[],
    };
    const effects: PlannerEffects = {
        showOnMap: (state) => calls.maps.push(state),
        fitRoute: (_route, stage) => calls.fits.push(stage),
        showPlace: () => {
            calls.flights += 1;
        },
        notify: (message) => calls.notes.push(message),
        writeAddress: (query) => calls.addresses.push(query),
    };
    return { calls, effects };
}

const answer = (body: unknown, status = 200) =>
    Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("Der Planer", () => {
    it("rechnet mit zwei Orten, passt die Route ein und schreibt die Adresse", async () => {
        const fetch = vi.fn<typeof globalThis.fetch>(() => answer(routeOf(true)));
        vi.stubGlobal("fetch", fetch);
        const { calls, effects } = effectsSpy();
        const planner = createPlanner(effects);
        planner.setPlace(planner.waypoints[0]?.key ?? 0, hit("Gareth"));
        planner.setPlace(planner.addWaypoint(), hit("Perricum"));
        await vi.waitFor(() => expect(planner.status.value).toBe("ready"));
        expect(fetch).toHaveBeenCalledTimes(1);
        expect(String(fetch.mock.calls[0]?.[0])).toContain("waypoints=id-Gareth%2Cid-Perricum");
        expect(calls.fits).toEqual([undefined]);
        expect(calls.addresses.at(-1)).toBe("route=Gareth~Perricum");
    });

    it("🪤 ein Fehler beim Zeichnen ist kein Routingfehler und verwirft die Route nicht (WI-0202, W3-03)", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn(() => answer(routeOf(true))),
        );
        const { calls, effects } = effectsSpy();
        effects.showOnMap = (state) => {
            if (state.route !== null && !state.stale) throw new TypeError("Zeichnen gescheitert");
        };
        const planner = createPlanner(effects);
        await expect(planner.replaceWaypoints([hit("Gareth"), hit("Perricum")])).rejects.toThrow(
            "Zeichnen gescheitert",
        );
        expect(planner.status.value).toBe("ready");
        expect(planner.route.value?.found).toBe(true);
        expect(calls.notes).not.toContain(t("route.error.routing_failed"));
    });

    it("eine Option rechnet neu, aber der Ausschnitt bleibt", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn(() => answer(routeOf(true))),
        );
        const { calls, effects } = effectsSpy();
        const planner = createPlanner(effects);
        planner.setPlace(planner.waypoints[0]?.key ?? 0, hit("Gareth"));
        planner.setPlace(planner.addWaypoint(), hit("Perricum"));
        await vi.waitFor(() => expect(planner.status.value).toBe("ready"));
        planner.setOptions((options) => {
            options.optimize = "shortest";
        });
        await vi.waitFor(() => expect(planner.status.value).toBe("ready"));
        expect(calls.fits).toHaveLength(1);
        expect(calls.addresses.at(-1)).toBe("route=Gareth~Perricum&pathType=shortest");
    });

    it("🪤 bricht die überholte Anfrage ab - es zählt nur die jüngste", async () => {
        const signals: AbortSignal[] = [];
        vi.stubGlobal(
            "fetch",
            vi.fn((_url: string, init?: RequestInit) => {
                if (init?.signal) signals.push(init.signal);
                return answer(routeOf(true, signals.length));
            }),
        );
        const { effects } = effectsSpy();
        const planner = createPlanner(effects);
        planner.setPlace(planner.waypoints[0]?.key ?? 0, hit("Gareth"));
        planner.setPlace(planner.addWaypoint(), hit("Perricum"));
        planner.setOptions((options) => {
            options.minimizeTransfers = true;
        });
        await vi.waitFor(() => expect(planner.status.value).toBe("ready"));
        expect(signals[0]?.aborted).toBe(true);
        expect(planner.route.value?.stages).toHaveLength(2);
    });

    it("ohne erlaubtes Medium gibt es keine Route - ohne zu fragen", () => {
        const fetch = vi.fn<typeof globalThis.fetch>(() => answer(routeOf(true)));
        vi.stubGlobal("fetch", fetch);
        const planner = createPlanner(effectsSpy().effects);
        planner.setOptions((options) => {
            options.enabled = { land: false, river: false, sea: false };
        });
        planner.setPlace(planner.waypoints[0]?.key ?? 0, hit("Gareth"));
        planner.setPlace(planner.addWaypoint(), hit("Perricum"));
        expect(planner.status.value).toBe("none");
        expect(fetch).not.toHaveBeenCalled();
    });

    it("sagt, zwischen welchen Orten es keine Route gibt, und übersetzt Serverfehler", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn(() => answer(routeOf(false))),
        );
        const { calls, effects } = effectsSpy();
        const planner = createPlanner(effects);
        planner.setPlace(planner.waypoints[0]?.key ?? 0, hit("Gareth"));
        planner.setPlace(planner.addWaypoint(), hit("Perricum"));
        await vi.waitFor(() => expect(planner.status.value).toBe("none"));
        expect(calls.notes).toEqual(["Keine Route zwischen Gareth und Perricum gefunden."]);

        // Last: Der Planer fragt selbst noch zweimal (Pause aus Retry-After, hier 0) und sagt dann, warum.
        const busy = vi.fn(() =>
            Promise.resolve(
                new Response(JSON.stringify({ error: "routing_busy" }), {
                    status: 503,
                    headers: { "content-type": "application/json", "retry-after": "0" },
                }),
            ),
        );
        vi.stubGlobal("fetch", busy);
        planner.setOptions((options) => {
            options.optimize = "shortest";
        });
        await vi.waitFor(() => expect(planner.status.value).toBe("error"));
        expect(busy).toHaveBeenCalledTimes(3);
        expect(calls.notes.at(-1)).toBe("Route aufgrund von zu viel Last abgelehnt.");
    });

    it("stellt eine Reise aus einem Link her und nennt Orte, die es nicht gibt", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn((url: string) =>
                url.startsWith("/api/route/waypoints/resolve")
                    ? answer({ places: [hit("Gareth"), null, hit("Perricum")] })
                    : answer(routeOf(true)),
            ),
        );
        const { calls, effects } = effectsSpy();
        const planner = createPlanner(effects);
        await planner.restore("?route=Gareth~Nirgendwo~Perricum&pathType=shortest", true);
        expect(planner.filled.value.map((place) => place.name)).toEqual(["Gareth", "Perricum"]);
        expect(planner.options.optimize).toBe("shortest");
        expect(calls.notes).toEqual(["Orte nicht gefunden: Nirgendwo"]);
        expect(planner.status.value).toBe("ready");
        expect(calls.fits).toEqual([undefined]);
    });

    it("🔴 „Weg als Route“ (P7, B12): Die Orte ERSETZEN alle Wegpunkte samt Kartenpunkten, die Optionen bleiben, gerechnet und eingepasst wird einmal", async () => {
        const fetch = vi.fn<typeof globalThis.fetch>(() => answer(routeOf(true, 3)));
        vi.stubGlobal("fetch", fetch);
        const { calls, effects } = effectsSpy();
        const planner = createPlanner(effects);
        planner.setOptions((options) => {
            options.optimize = "shortest";
        });
        planner.setPlace(planner.waypoints[0]?.key ?? 0, hit("Gareth"));
        planner.addMapPoint({ x: 5, y: 6 });
        await vi.waitFor(() => expect(planner.status.value).toBe("ready"));
        fetch.mockClear();
        calls.fits.length = 0;

        await planner.replaceWaypoints([hit("Perz"), hit("Silkwiesen"), hit("Helmdahl")]);
        await vi.waitFor(() => expect(planner.status.value).toBe("ready"));
        expect(planner.filled.value.map((place) => place.name)).toEqual(["Perz", "Silkwiesen", "Helmdahl"]);
        // Jede Zeile trägt ihren Ort: keine leere, kein Kartenpunkt der alten Reise.
        expect(planner.waypoints.map((row) => row.place?.name)).toEqual(["Perz", "Silkwiesen", "Helmdahl"]);
        expect(planner.options.optimize).toBe("shortest");
        expect(fetch).toHaveBeenCalledTimes(1);
        expect(String(fetch.mock.calls[0]?.[0])).toContain("waypoints=id-Perz%2Cid-Silkwiesen%2Cid-Helmdahl");
        expect(calls.fits).toEqual([undefined]);
        expect(calls.addresses.at(-1)).toBe("route=Perz~Silkwiesen~Helmdahl&pathType=shortest");
    });

    it("ohne Orte lässt „Weg als Route“ die Reise, wie sie ist", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn(() => answer(routeOf(true))),
        );
        const planner = createPlanner(effectsSpy().effects);
        planner.setPlace(planner.waypoints[0]?.key ?? 0, hit("Gareth"));
        planner.setPlace(planner.addWaypoint(), hit("Perricum"));
        await vi.waitFor(() => expect(planner.status.value).toBe("ready"));
        await planner.replaceWaypoints([]);
        expect(planner.filled.value.map((place) => place.name)).toEqual(["Gareth", "Perricum"]);
    });

    it("⇅ dreht die Folge um, 🗑 leert sie, und Bild↓ wählt die Etappen der Reihe nach", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn(() => answer(routeOf(true, 3))),
        );
        const { calls, effects } = effectsSpy();
        const planner = createPlanner(effects);
        planner.setPlace(planner.waypoints[0]?.key ?? 0, hit("Gareth"));
        planner.setPlace(planner.addWaypoint(), hit("Perricum"));
        planner.reverse();
        expect(planner.filled.value.map((place) => place.name)).toEqual(["Perricum", "Gareth"]);
        await vi.waitFor(() => expect(planner.status.value).toBe("ready"));
        planner.stepStage(1);
        planner.stepStage(1);
        expect(planner.selectedStage.value).toBe(1);
        expect(calls.fits.slice(-2)).toEqual([0, 1]);
        planner.clear();
        expect(planner.waypoints).toHaveLength(1);
        expect(planner.route.value).toBeNull();
    });
});

describe("Die Reiseart (WI-0050, WI-0051: Flug mit Flugmittel)", () => {
    const flightCalls = (fetch: ReturnType<typeof vi.fn>): string[] =>
        fetch.mock.calls.map(([url]) => String(url)).filter((url) => url.startsWith("/api/route?"));

    it("🔴 im Flug fragt der Planer mit dem Flugmittel an; zurück rechnet er über Land und Wasser, ohne neu einzupassen", async () => {
        const fetch = vi.fn<typeof globalThis.fetch>(() => answer(routeOf(true)));
        vi.stubGlobal("fetch", fetch);
        const { calls, effects } = effectsSpy();
        const planner = createPlanner(effects);
        planner.setPlace(planner.waypoints[0]?.key ?? 0, hit("Gareth"));
        planner.setPlace(planner.addWaypoint(), hit("Perricum"));
        await vi.waitFor(() => expect(planner.status.value).toBe("ready"));
        const amBoden = planner.route.value;

        planner.setMode("air");
        await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
        expect(flightCalls(fetch)[1]).toContain("air=witchFlight");
        await vi.waitFor(() => expect(planner.status.value).toBe("ready"));
        planner.setAir((air) => {
            air.profile = "griffin";
        });
        await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
        expect(flightCalls(fetch)[2]).toContain("air=griffin");

        // Zurück über Land und Wasser: dieselbe Reise wie am Anfang, sie kommt aus dem Speicher des Planers (WI-0292), ohne neue Frage.
        planner.setMode("surface");
        await vi.waitFor(() => expect(planner.route.value).toBe(amBoden));
        expect(planner.status.value).toBe("ready");
        expect(fetch).toHaveBeenCalledTimes(3);
        expect(calls.fits).toHaveLength(1);
    });

    it("🔴 das eigene Flugmittel reist mit seinen Werten; sein Name ändert nur die Adresse, nicht die Rechnung", async () => {
        const fetch = vi.fn<typeof globalThis.fetch>(() => answer(routeOf(true)));
        vi.stubGlobal("fetch", fetch);
        const { calls, effects } = effectsSpy();
        const planner = createPlanner(effects);
        planner.setMode("air");
        planner.setAir((air) => {
            air.profile = "custom";
            air.custom = { name: "", speedMph: 60, altitudePaces: 300 };
        });
        planner.setPlace(planner.waypoints[0]?.key ?? 0, hit("Gareth"));
        planner.setPlace(planner.addWaypoint(), hit("Perricum"));
        await vi.waitFor(() => expect(planner.status.value).toBe("ready"));
        const asked = flightCalls(fetch);
        expect(asked.at(-1)).toContain("air=custom");
        expect(asked.at(-1)).toContain("air_speed=60");
        expect(asked.at(-1)).toContain("air_altitude=300");

        planner.setAir((air) => {
            air.custom.name = "Besen";
        });
        expect(flightCalls(fetch)).toHaveLength(asked.length);
        expect(calls.addresses.at(-1)).toBe(
            "route=Gareth~Perricum&air=custom&airSpeed=60&airAltitude=300&airName=Besen",
        );
        // Im Kurzlink ohne Namen: Er speichert keinen freien Text.
        expect(planner.shareState()?.air).toEqual({ profile: "custom", speedMph: 60, altitudePaces: 300 });
        // Die Optionen bleiben die von Land und Wasser; der Flug steht daneben.
        expect(Object.keys(planner.shareState()?.options ?? {}).sort()).toEqual(Object.keys(DEFAULT_OPTIONS).sort());
    });

    it("ein Link mit `air` öffnet den Flug, einer ohne die Reise über Land und Wasser", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn((url: string) =>
                url.startsWith("/api/route/waypoints/resolve")
                    ? answer({ places: [hit("Gareth"), hit("Perricum")] })
                    : answer(routeOf(true)),
            ),
        );
        const { effects } = effectsSpy();
        const planner = createPlanner(effects);
        await planner.restore("?route=Gareth~Perricum&air=griffin", true);
        expect(planner.mode.value).toBe("air");
        expect(planner.air.profile).toBe("griffin");
        await planner.restore("?route=Gareth~Perricum", true);
        expect(planner.mode.value).toBe("surface");
    });

    it("🔴 der Kurzlink trägt den Flug; ohne Flug fehlt der Schlüssel, und ein alter Zustand behält seinen Code", () => {
        const payload: SharePayload = {
            v: 1,
            waypoints: ["p:1:2", "p:3:4"],
            options: {
                optimize: "fastest",
                minimizeTransfers: false,
                enabled: { land: true, river: true, sea: true },
                transports: { land: "groupFoot", river: "riverSailer", sea: "cargoShip" },
                hoursPerDay: 8,
            },
            view: { series: "modern", view: "standard", layer: "alle" },
        };
        expect("air" in canonicalSharePayload(payload)).toBe(false);
        const named = canonicalSharePayload({ ...payload, air: { profile: "griffin", speedMph: 50 } });
        expect(named.air).toEqual({ profile: "griffin" });
        const own = canonicalSharePayload({ ...payload, air: { profile: "custom", speedMph: 60, altitudePaces: 300 } });
        expect(own.air).toEqual({ profile: "custom", speedMph: 60, altitudePaces: 300 });
        expect(Value.Check(SharePayload, own)).toBe(true);
        expect(Value.Check(SharePayload, { ...payload, air: { profile: "custom", speedMph: 0 } })).toBe(false);
        // Nur Flugmittel des Reisemodells, und kein freier Text.
        expect(Value.Check(SharePayload, { ...payload, air: { profile: "drache" } })).toBe(false);
        expect(Value.Check(SharePayload, { ...payload, air: { profile: "custom", name: "Besen" } })).toBe(false);
    });

    it("ein einzelner Ort wird auch im Flug gezeigt, wie zu Land", () => {
        vi.stubGlobal(
            "fetch",
            vi.fn(() => answer(routeOf(true))),
        );
        const { calls, effects } = effectsSpy();
        const planner = createPlanner(effects);
        planner.setMode("air");
        planner.setPlace(planner.waypoints[0]?.key ?? 0, hit("Gareth"));
        expect(planner.status.value).toBe("idle");
        expect(calls.flights).toBe(1);
    });
});

describe("Die Anfrage", () => {
    it("nennt jede Option, auch die Vorgaben, und die Medien als domains", () => {
        const options = copyOptions(DEFAULT_OPTIONS);
        options.enabled.sea = false;
        expect(routeQuery(["a", "b"], options)).toBe(
            "waypoints=a%2Cb&optimize=fastest&domains=land%2Criver&land=groupFoot&river=riverSailer&sea=cargoShip&minimize_transfers=false&hurry=false&hours_per_day=8",
        );
    });

    it("nennt ohne Etappenangabe nur „Keine Route gefunden.“", () => {
        const route = routeOf(false);
        route.waypoints = [];
        expect(noRouteMessage(route)).toBe("Keine Route gefunden.");
    });
});

function segmentAt(index: number): RouteSegment {
    return {
        index,
        edge_id: `e${String(index)}`,
        public_id: "",
        from_node: "a",
        to_node: "b",
        from_node_id: "a",
        to_node_id: "b",
        subtype: "Strasse",
        path_name: "",
        transport_type: "groupFoot",
        distance_units: 1,
        cost_units: 1,
        cost_factor: 1,
        travel_hours: 1,
        flow_time_factor: 1,
        flow_state: "none",
        synthetic: false,
        offroad: false,
        geometry: { type: "LineString", coordinates: [] },
    };
}

describe("Einpassen", () => {
    it("die ganze Route oder nur eine Etappe, in Renderkoordinaten", () => {
        const route = routeOf(true, 2);
        route.segments = [0, 1].map((index) => ({
            ...segmentAt(index),
            geometry: {
                type: "LineString" as const,
                coordinates: [
                    [100 * index, 100 * index],
                    [100 * index + 50, 100 * index + 50],
                ],
            },
        }));
        const whole = routeRenderBounds(route);
        const second = routeRenderBounds(route, 1);
        expect(whole).toBeDefined();
        expect(second).toBeDefined();
        // Die zweite Etappe ist ein Teil der ganzen Route, und sie beginnt weiter östlich.
        expect(second![0][0]).toBeGreaterThan(whole![0][0]);
        expect(second![1][0]).toBeCloseTo(whole![1][0], 9);
        expect(routeRenderBounds({ ...route, segments: [] })).toBeUndefined();
    });
});

describe("Der Pfeil der Reisenden", () => {
    it("wächst mit dem Zoom: 30 px bis Zoom 5, dann gleichmäßig auf 48 px bei Zoom 8 (Betreiber 2026-09-24)", () => {
        // Das Bild ist die große Fassung; verkleinert steht er auf 30 von 48 Pixeln.
        expect(travelerScale(3)).toBeCloseTo(30 / 48, 9);
        expect(travelerScale(5)).toBeCloseTo(30 / 48, 9);
        expect(travelerScale(6.5)).toBeCloseTo((30 / 48 + 1) / 2, 9);
        expect(travelerScale(8)).toBe(1);
        expect(travelerScale(9)).toBe(1);
    });

    it("🔴 liegt flach auf der Karte und zeigt in Fahrtrichtung: die Spitze (oberer Rand) nach Osten bei 90°", () => {
        const [topLeft, topRight, bottomRight, bottomLeft] = travelerCorners([10, 20], 90, 6, 20);
        // Nach Osten fahrend liegt die obere Kante des Bildes östlich, die untere westlich.
        expect(Math.min(topLeft![0], topRight![0])).toBeGreaterThan(10);
        expect(Math.max(bottomLeft![0], bottomRight![0])).toBeLessThan(10);
        // Nach Norden fahrend steht die obere Kante nördlich (größere Breite).
        const north = travelerCorners([10, 20], 0, 6, 20);
        expect(north[0]![1]).toBeGreaterThan(20);
        expect(north[2]![1]).toBeLessThan(20);
        // Die Ecken liegen symmetrisch um die Mitte.
        expect((north[0]![0] + north[2]![0]) / 2).toBeCloseTo(10, 9);
    });
});

describe("Kartenpunkte („Hierher reisen“, Legacy B11)", () => {
    it("schreibt einen Punkt kurz als @x,y und liest auch Legacys „Kartenpunkt (y, x)“", () => {
        expect(pointToken({ x: 551.625, y: 532.969 })).toBe("@551.63,532.97");
        expect(parsePointToken("@551.63,532.97")).toEqual({ x: 551.63, y: 532.97 });
        // Legacy schreibt Leaflets Reihenfolge: erst y, dann x.
        expect(parsePointToken("Kartenpunkt (532.969, 551.625)")).toEqual({ x: 551.625, y: 532.969 });
        expect(parsePointToken("Gareth")).toBeNull();
        expect(writePlannerLink(["Gareth", "@551.63,532.97"], DEFAULT_OPTIONS)).toBe("route=Gareth~@551.63,532.97");
    });

    it("ein Punkt ist ein Wegpunkt mit Lage in der Kennung, genannt nach dem nächsten Ort in der Nähe", () => {
        const hit = mapPointHit({ x: 551.6254, y: 532.9691 });
        expect(hit).toMatchObject({ id: "p:551.625:532.969", subtype: "kartenpunkt", x: 551.625, y: 532.969 });
        expect(isMapPoint(hit)).toBe(true);
        expect(mapPointName({ name: "Gareth" }, 2)).toBe("Kartenpunkt bei Gareth");
        expect(mapPointName({ name: "Gareth" }, 40)).toBe("Kartenpunkt");
        expect(mapPointName(null, null)).toBe("Kartenpunkt");
    });

    it("„Hierher reisen“ füllt die letzte leere Zeile, sonst hängt es an; allein ist der Punkt der Start", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn(() => answer({ place: null, distance: null })),
        );
        const { effects } = effectsSpy();
        const planner = createPlanner(effects);
        expect(planner.addMapPoint({ x: 10, y: 20 }), "der erste ist der Start").toBe(true);
        expect(planner.waypoints).toHaveLength(1);
        expect(planner.addMapPoint({ x: 30, y: 40 })).toBe(false);
        expect(planner.waypoints).toHaveLength(2);
        expect(planner.waypoints.map((row) => row.place?.id)).toEqual(["p:10:20", "p:30:40"]);
    });

    it("🔴 jede Marke lässt sich ziehen (WI-0052): ein Ort wird Kartenpunkt, eingerastet wird ein Punkt zum Ort", async () => {
        const fetch = vi.fn<typeof globalThis.fetch>((input) =>
            String(input).includes("/nearest") ? answer({ place: hit("Gareth"), distance: 2 }) : answer(routeOf(true)),
        );
        vi.stubGlobal("fetch", fetch);
        const { calls, effects } = effectsSpy();
        const planner = createPlanner(effects);
        const first = planner.waypoints[0]?.key ?? 0;
        planner.setPlace(first, hit("Gareth"));
        planner.setPlace(planner.addWaypoint(), hit("Perricum"));
        await vi.waitFor(() => expect(planner.status.value).toBe("ready"));
        const fits = calls.fits.length;

        // Weggezogen: ein Kartenpunkt. Er trägt nicht den Namen des Orts, den er verlassen hat.
        planner.moveWaypoint(first, { x: 10, y: 20 });
        expect(planner.waypoints[0]?.place).toMatchObject({ id: "p:10:20", name: "Kartenpunkt" });
        expect(calls.maps.at(-1)?.waypoints[0]).toMatchObject({ x: 10, y: 20 });
        await vi.waitFor(() => expect(planner.waypoints[0]?.place?.name).toBe("Kartenpunkt bei Gareth"));
        await vi.waitFor(() => expect(planner.status.value).toBe("ready"));
        expect(calls.addresses.at(-1)).toBe("route=@10.00,20.00~Perricum");

        // Eingerastet: Der Punkt wird der Ort.
        planner.moveWaypoint(first, hit("Wehrheim"));
        expect(planner.waypoints[0]?.place).toEqual(hit("Wehrheim"));
        await vi.waitFor(() => expect(planner.status.value).toBe("ready"));
        expect(calls.addresses.at(-1)).toBe("route=Wehrheim~Perricum");
        // Gezogen wird auf der Karte, im Ausschnitt, den man gerade sieht: Er bleibt.
        expect(calls.fits).toHaveLength(fits);
    });

    it("eine Marke, die auf ihrem eigenen Ort landet, rechnet nichts", async () => {
        const fetch = vi.fn<typeof globalThis.fetch>(() => answer(routeOf(true)));
        vi.stubGlobal("fetch", fetch);
        const planner = createPlanner(effectsSpy().effects);
        const first = planner.waypoints[0]?.key ?? 0;
        planner.setPlace(first, hit("Gareth"));
        planner.setPlace(planner.addWaypoint(), hit("Perricum"));
        await vi.waitFor(() => expect(planner.status.value).toBe("ready"));
        const asked = fetch.mock.calls.length;
        planner.moveWaypoint(first, hit("Gareth"));
        expect(planner.status.value).toBe("ready");
        expect(fetch).toHaveBeenCalledTimes(asked);
    });
});

describe("Der Kurzlink (WI-0034)", () => {
    const view = { series: "modern", view: "standard", layer: "alle" } as const;
    const point = mapPointHit({ x: 547.6, y: 535.5 });

    /** Route, Kurzlink und der Name des Kartenpunkts - je nach Adresse. */
    function serve(share: (url: string, init?: RequestInit) => Promise<Response>) {
        const fetch = vi.fn((url: string, init?: RequestInit) => {
            if (url.startsWith("/api/share")) return share(url, init);
            if (url.startsWith("/api/route/waypoints/nearest")) return answer({ place: null, distance: null });
            return answer(routeOf(true));
        });
        vi.stubGlobal("fetch", fetch);
        return fetch;
    }

    function shareSpy(planner = createPlanner(effectsSpy().effects), copied = true) {
        const calls = {
            notes: [] as [string, string][],
            links: [] as (string | undefined)[],
            copies: [] as Promise<string>[],
            views: [] as unknown[],
            dropped: 0,
        };
        const effects: ShareLinkEffects = {
            planner,
            currentView: () => view,
            applyView: (next) => calls.views.push(next),
            notify: (text, tone, link) => {
                calls.notes.push([text, tone]);
                calls.links.push(link);
            },
            pageUrl: () => "https://karte.test/",
            copy: (text) => {
                calls.copies.push(text);
                return text.then(
                    () => copied,
                    () => false,
                );
            },
            dropCode: () => {
                calls.dropped += 1;
            },
        };
        return { calls, planner, link: useShareLink(effects) };
    }

    it("liest ?s= und gibt s dem Planer: Schreibt er die Reise, verschwindet der Kurzlink aus der Adresse", () => {
        expect(readShareCode("?s=Ab3dEf7h&besucher")).toBe("Ab3dEf7h");
        expect(readShareCode("?route=Gareth~Perricum")).toBeNull();
        expect(readShareCode("?s=")).toBeNull();
        expect(withPlannerLink("?s=Ab3dEf7h&besucher=1", "route=Gareth~Perricum")).toBe(
            "?route=Gareth~Perricum&besucher=1",
        );
    });

    it("teilt Kennungen und Optionen, keine Namen - und erst ab zwei Wegpunkten", async () => {
        serve(() => answer({ code: "Ab3dEf7h" }, 201));
        const planner = createPlanner(effectsSpy().effects);
        planner.setPlace(planner.waypoints[0]?.key ?? 0, hit("Gareth"));
        expect(planner.shareState()).toBeNull();
        planner.addMapPoint(point);
        expect(planner.shareState()).toEqual({
            waypoints: ["id-Gareth", point.id],
            options: copyOptions(DEFAULT_OPTIONS),
        });
    });

    it("🔗 legt den Link an und legt ihn in die Zwischenablage, mit Legacys Meldung", async () => {
        const fetch = serve(() => answer({ code: "Ab3dEf7h" }, 201));
        const { calls, planner, link } = shareSpy();
        planner.setPlace(planner.waypoints[0]?.key ?? 0, hit("Gareth"));
        planner.setPlace(planner.addWaypoint(), hit("Perricum"));
        const pending = link.share();
        expect(link.sharing.value).toBe(true);
        // 🔴 Die Zwischenablage ist schon angestoßen, bevor der Server antwortet: Nach dem awaited POST
        // wäre die Nutzergeste verbraucht, Safari und Firefox verweigerten das Schreiben (Betreiber 2026-09-24).
        expect(calls.copies).toHaveLength(1);
        await pending;
        expect(link.sharing.value).toBe(false);
        await expect(calls.copies[0]).resolves.toBe("https://karte.test/?s=Ab3dEf7h");
        expect(calls.notes).toEqual([["Kurzlink kopiert: https://karte.test/?s=Ab3dEf7h", "success"]]);
        // Die Meldung trägt den Link greifbar mit.
        expect(calls.links).toEqual(["https://karte.test/?s=Ab3dEf7h"]);
        const post = fetch.mock.calls.find(([url]) => url === "/api/share");
        expect(post?.[1]?.method).toBe("POST");
        expect(JSON.parse(String(post?.[1]?.body))).toEqual({
            v: 1,
            waypoints: ["id-Gareth", "id-Perricum"],
            options: copyOptions(DEFAULT_OPTIONS),
            view,
        });
    });

    it("zeigt den Link, wenn die Zwischenablage nicht mitspielt, und sagt, wenn es nicht geht", async () => {
        const antworten = [answer({ code: "Ab3dEf7h" }, 201), answer({ error: "rate_limited" }, 429), answer({}, 500)];
        serve(() => antworten.shift() ?? answer({}, 500));
        const { calls, planner, link } = shareSpy(undefined, false);
        planner.setPlace(planner.waypoints[0]?.key ?? 0, hit("Gareth"));
        planner.setPlace(planner.addWaypoint(), hit("Perricum"));
        await link.share();
        await link.share();
        await link.share();
        expect(calls.notes).toEqual([
            ["Kurzlink: https://karte.test/?s=Ab3dEf7h", "warning"],
            ["Zu viele Kurzlinks in kurzer Zeit; später geht es wieder.", "warning"],
            ["Kurzlink konnte nicht erstellt werden.", "warning"],
        ]);
        expect(calls.links).toEqual(["https://karte.test/?s=Ab3dEf7h", undefined, undefined]);
        // Ohne Link gibt es nichts zu kopieren: Die Zwischenablage wird freigegeben, nicht leer beschrieben.
        await expect(calls.copies[1]).rejects.toThrow();
        await expect(calls.copies[2]).rejects.toThrow();
    });

    it("🔴 öffnet einen Kurzlink: Ansicht, Optionen, Orte von heute - und nennt, was fehlt (Kap. 9.57)", async () => {
        const shared: ShareResolved = {
            code: "Ab3dEf7h",
            payload: {
                v: 1,
                waypoints: [point.id, "id-gareth", "00000000-0000-4000-8000-000000000000"],
                options: { ...copyOptions(DEFAULT_OPTIONS), optimize: "shortest" },
                view: { series: "modern", view: "landscapes", layer: "alle" },
            },
            places: [null, hit("Gareth"), null],
        };
        serve(() => answer(shared));
        const spy = effectsSpy();
        const { calls, planner, link } = shareSpy(createPlanner(spy.effects));
        await link.open("Ab3dEf7h");
        expect(calls.views).toEqual([shared.payload.view]);
        expect(planner.filled.value.map((place) => place.id)).toEqual([point.id, "id-Gareth"]);
        expect(planner.options.optimize).toBe("shortest");
        expect(spy.calls.notes).toEqual(["Ein Ort aus dem Kurzlink ist nicht mehr auf der Karte."]);
        expect(spy.calls.fits).toEqual([undefined]);
        expect(spy.calls.addresses.at(-1)).toBe("route=@547.60,535.50~Gareth&pathType=shortest");
    });

    it("meldet einen unbekannten Code und nimmt ihn aus der Adresse; fehlt das Netz, bleibt er stehen", async () => {
        const fetch = serve(() => answer({ error: "unknown_code" }, 404));
        const { calls, link } = shareSpy();
        await link.open("ab!");
        expect(fetch).not.toHaveBeenCalled();
        await link.open("zzzz2222");
        // Der Code steht in der Meldung: Ein Tippfehler beim Abschreiben fällt so auf (Betreiber 2026-09-24).
        expect(calls.notes).toEqual([
            ["Kurzlink nicht gefunden: ab!", "warning"],
            ["Kurzlink nicht gefunden: zzzz2222", "warning"],
        ]);
        await link.open("x".repeat(300));
        expect(calls.notes.at(-1)).toEqual([`Kurzlink nicht gefunden: ${"x".repeat(24)}…`, "warning"]);
        calls.dropped -= 1;
        expect(calls.dropped).toBe(2);

        serve(() => Promise.reject(new TypeError("offline")));
        await link.open("zzzz2222");
        expect(calls.notes.at(-1)).toEqual(["Der Kurzlink konnte nicht geladen werden.", "warning"]);
        expect(calls.dropped).toBe(2);
    });
});

describe("Die Zwischenablage für den Kurzlink (Betreiber 2026-09-24: „kanns nicht rauskopieren“)", () => {
    /** Ein Link, der erst nach dem POST feststeht. */
    function later() {
        let resolve: (url: string) => void = () => undefined;
        const promise = new Promise<string>((ok) => {
            resolve = ok;
        });
        return { promise, resolve };
    }

    class FakeItem {
        readonly items: Record<string, Promise<Blob>>;
        constructor(items: Record<string, Promise<Blob>>) {
            this.items = items;
        }
    }

    it("🔴 schreibt im Klick: clipboard.write mit einem Promise, bevor der Link feststeht", async () => {
        const written: FakeItem[] = [];
        vi.stubGlobal("ClipboardItem", FakeItem);
        vi.stubGlobal("navigator", {
            clipboard: {
                write: vi.fn(async (items: FakeItem[]) => {
                    written.push(...items);
                    await Promise.all(items.flatMap((item) => Object.values(item.items)));
                }),
                writeText: vi.fn(),
            },
        });
        const link = later();
        const done = copyToClipboard(link.promise);
        expect(written).toHaveLength(1);
        link.resolve("https://karte.test/?s=Ab3dEf7h");
        await expect(done).resolves.toBe(true);
        const blob = await (written[0] as FakeItem).items["text/plain"];
        expect(await blob?.text()).toBe("https://karte.test/?s=Ab3dEf7h");
        expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
    });

    it("weicht aus: erst auf writeText, dann auf Legacys markiertes Textfeld - ohne Link auf nichts", async () => {
        const writeText = vi.fn(async () => undefined);
        vi.stubGlobal("navigator", { clipboard: { writeText } });
        await expect(copyToClipboard(Promise.resolve("https://karte.test/?s=Ab3dEf7h"))).resolves.toBe(true);
        expect(writeText).toHaveBeenCalledWith("https://karte.test/?s=Ab3dEf7h");

        // Ohne sichere Verbindung gibt es navigator.clipboard nicht; execCommand geht trotzdem.
        const field = { value: "", style: {}, setAttribute: vi.fn(), select: vi.fn(), remove: vi.fn() };
        const execCommand = vi.fn(() => true);
        vi.stubGlobal("navigator", {});
        vi.stubGlobal("HTMLElement", class {});
        vi.stubGlobal("document", {
            activeElement: null,
            execCommand,
            createElement: () => field,
            body: { append: vi.fn() },
        });
        await expect(copyToClipboard(Promise.resolve("https://karte.test/?s=Ab3dEf7h"))).resolves.toBe(true);
        expect(field.value).toBe("https://karte.test/?s=Ab3dEf7h");
        expect(execCommand).toHaveBeenCalledWith("copy");
        expect(field.remove).toHaveBeenCalled();

        await expect(copyToClipboard(Promise.reject(new Error("kein Kurzlink")))).resolves.toBe(false);
        expect(execCommand).toHaveBeenCalledTimes(1);
    });
});

describe("Querfeldein als Pillen (Betreiber 2026-09-24: „kreisrund und nicht gedetscht“)", () => {
    /** Eine Route aus einem gezeichneten Weg und einem Gang querfeldein, jede in ihrer Etappe. */
    function offroadRoute(offroadTo: [number, number]): RouteResponse {
        const route = routeOf(true, 2);
        route.segments = [
            {
                ...segmentAt(0),
                geometry: {
                    type: "LineString",
                    coordinates: [
                        [500, 500],
                        [510, 500],
                    ],
                },
            },
            {
                ...segmentAt(1),
                synthetic: true,
                offroad: true,
                subtype: "Querfeldein",
                geometry: { type: "LineString", coordinates: [[510, 500], offroadTo] },
            },
        ];
        route.stages = route.stages.map((stage, index) => ({
            ...stage,
            type: index === 1 ? "Querfeldein" : stage.type,
            segment_start: index,
            segment_count: 1,
        }));
        return route;
    }
    const data = (route: RouteResponse, selectedStage: number | null = null, stale = false) => ({
        route,
        stale,
        selectedStage,
        waypoints: [],
    });

    it("nimmt nur die Stücke querfeldein, mit ihrer Wahl und ihrem Zustand", () => {
        const route = offroadRoute([520, 500]);
        expect(offroadShapes(data(route, 1))).toHaveLength(1);
        expect(offroadShapes(data(route, 1))[0]?.coordinates).toHaveLength(2);
        expect(offroadShapes(data(route, 1))[0]?.selected).toBe(true);
        expect(offroadShapes(data(route, 0))[0]?.selected).toBe(false);
        // Veraltet ist nichts gewählt: Gold gäbe es nur für eine Route, die gilt.
        expect(offroadShapes(data(route, 1, true))[0]).toMatchObject({ selected: false, stale: true });
        expect(offroadShapes(data(routeOf(false)))).toEqual([]);
    });

    /**
     * Betreiber 2026-10-11 (Moorbrück → Gerrun): „ein teilstück von 0 meilen … das darf weder auf der karte noch im
     * routenplaner in den etappen auftauchen.“ Die Brücke über zwei knapp verfehlte Wegenden gehört im Reiseplan zur
     * Etappe des Weges; die Karte zeichnet sie mit ihr als Linie, ohne die Pille, die sonst in ihrer Mitte stünde.
     */
    it("🔴 ein Stück querfeldein, das der Reiseplan keiner Querfeldein-Etappe gibt, zeichnet keine Pille", () => {
        const route = offroadRoute([510.00001, 500.00026]);
        route.stages = [{ ...(route.stages[0] as RouteStage), type: "Pfad", segment_start: 0, segment_count: 2 }];
        expect(offroadShapes(data(route))).toEqual([]);
        const lines = routeLineFeatures(data(route, 0)).features;
        expect(lines.map((line) => [line.properties.stage, line.properties.offroad, line.properties.selected])).toEqual(
            [
                [0, false, true],
                [0, false, true],
            ],
        );
    });
});

describe("Die Pillen in Bildschirmpixeln (Betreiber 2026-09-24: „gedetscht … die kurz ploppen“)", () => {
    const line = (length: number) => [
        { x: 0, y: 0 },
        { x: length, y: 0 },
    ];
    const offsets = (pills: Pill[], length: number) => pills.map((pill) => pill.x - length / 2);

    it("legt die Pillen von der Mitte aus, eine je Strich und Lücke, in Richtung der Linie", () => {
        // Aus der Tafel: Strich 10, Lücke 14 (Betreiber 2026-09-25: „C sieht am richtigsten aus“).
        expect(PILL_PERIOD).toBe(24);
        const pills = placePills(line(100), 18);
        expect(pills).toHaveLength(5);
        for (const [index, x] of [14, 32, 50, 68, 86].entries()) expect(pills[index]?.x).toBeCloseTo(x, 9);
        expect(pills.every((pill) => pill.alpha === 1 && pill.dx === 1 && pill.dy === 0)).toBe(true);
    });

    it("🔴 springt beim Zoomen nie: Wächst das Stück, bleiben die Pillen im Abstand zur Mitte, am Ende blendet eine neue ein", () => {
        let before: Map<number, number> | undefined;
        for (let length = 60; length <= 130; length += 0.5) {
            const pills = placePills(line(length));
            const now = new Map<number, number>();
            for (const [index, offset] of offsets(pills, length).entries()) {
                const k = Math.round(offset / PILL_PERIOD);
                // Jede Pille steht auf einem Vielfachen des Abstands zur Mitte - nie dazwischen.
                expect(offset).toBeCloseTo(k * PILL_PERIOD, 9);
                now.set(k, pills[index]?.alpha ?? 0);
            }
            for (const [k, alpha] of before ? now : []) {
                // Keine Pille wird schwächer, während das Stück wächst, und keine erscheint mit einem Schlag.
                expect(alpha).toBeGreaterThanOrEqual(before?.get(k) ?? 0);
                expect(alpha - (before?.get(k) ?? 0)).toBeLessThanOrEqual(0.12);
            }
            before = now;
        }
    });

    it("gibt einem sehr kurzen Stück seine Pille und folgt der Linie um die Ecke", () => {
        expect(placePills(line(3))).toEqual([{ x: 1.5, y: 0, dx: 1, dy: 0, alpha: 1 }]);
        const corner = placePills(
            [
                { x: 0, y: 0 },
                { x: 50, y: 0 },
                { x: 50, y: 50 },
            ],
            18,
        );
        // Die Mitte der 100 Pixel liegt in der Ecke; davor waagerecht, danach senkrecht.
        expect(corner).toHaveLength(5);
        expect(corner[1]?.x).toBeCloseTo(32, 9);
        expect(corner[1]).toMatchObject({ y: 0, dx: 1, dy: 0 });
        expect(corner[3]?.y).toBeCloseTo(18, 9);
        expect(corner[3]).toMatchObject({ x: 50, dx: 0, dy: 1 });
        expect(placePills([{ x: 1, y: 1 }])).toEqual([]);
        expect(
            placePills([
                { x: 1, y: 1 },
                { x: 1, y: 1 },
            ]),
        ).toEqual([]);
    });
});

describe("Die Pillen im Raum (Betreiber 2026-09-27: „im 3D modus … C, im 2D modus A“)", () => {
    it("tastet ein Stück dicht ab, bis zum Ende, mit wachsendem Laufweg", () => {
        const track = groundTrack([
            [0, 0],
            [0.1, 0],
            [0.1, 0.2],
        ]);
        const start = MercatorCoordinate.fromLngLat({ lng: 0, lat: 0 });
        const ende = MercatorCoordinate.fromLngLat({ lng: 0.1, lat: 0.2 });
        expect(track.points[0]?.x).toBeCloseTo(start.x, 12);
        expect(track.points.at(-1)?.x).toBeCloseTo(ende.x, 12);
        expect(track.points.at(-1)?.y).toBeCloseTo(ende.y, 12);
        // Nicht dichter als ein Viertel Höhenpixel der Stufe 3 (1/16.384), und die Ecke bleibt ein Punkt.
        expect(track.points.length).toBeGreaterThan(10);
        expect(track.lngLat).toContainEqual([0.1, 0]);
        for (let index = 1; index < track.lengths.length; index += 1) {
            expect(track.lengths[index]).toBeGreaterThan(track.lengths[index - 1] as number);
        }
        // Lange Stücke: höchstens 2.048 Abschnitte.
        expect(
            groundTrack([
                [0, 0],
                [60, 0],
            ]).points.length,
        ).toBeLessThanOrEqual(2049);
    });

    it("🔴 speichert die Höhe ohne Überhöhung - das Wachsen beim Kippen braucht keine neue Abfrage", () => {
        const track = groundTrack([
            [0, 0],
            [0.001, 0],
        ]);
        sampleGround(track, () => 500, 0.5);
        const tausend = MercatorCoordinate.fromLngLat({ lng: 0, lat: 0 }, 1000).z;
        expect((track.base[0] as number) / tausend).toBeCloseTo(1, 6);
        // Ohne Überhöhung ist nichts abzulesen: Es bleibt, was da ist.
        sampleGround(track, () => 0, 0);
        expect((track.base[0] as number) / tausend).toBeCloseTo(1, 6);
        sampleGround(track, () => null, 1);
        expect(track.base[0]).toBe(0);
    });

    it("liest die Höhe längs des Stücks linear, an den Enden festgehalten", () => {
        const track = groundTrack([
            [0, 0],
            [0.001, 0],
        ]);
        track.base.set(track.base.map((_, index) => index));
        const last = track.lengths.length - 1;
        const mitte = (track.lengths[1] as number) / 2;
        expect(groundAt(track, mitte)).toBeCloseTo(0.5, 6);
        expect(groundAt(track, -1)).toBe(0);
        expect(groundAt(track, (track.lengths[last] as number) + 1)).toBe(last);
    });
});

/**
 * Sammeln statt jede Änderung fragen (WI-0292, Vali 2026-11-09): Ein paar schnelle Änderungen leerten in Production die Drossel der Reise (20 je Minute, burst 10, je
 * Adresse). Optionen warten `SAMMELN_MS` auf die nächste; ein Ort, ein Klick, ein Drop fragt sofort, außer kurz nach der letzten Frage. Dieselbe Reise kommt aus dem Speicher.
 */
describe("Sammeln und Speicher (WI-0292)", () => {
    const routeCalls = (fetch: ReturnType<typeof vi.fn>): string[] =>
        fetch.mock.calls.map(([url]) => String(url)).filter((url) => url.startsWith("/api/route?"));

    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    function bereit(): {
        fetch: ReturnType<typeof vi.fn<typeof globalThis.fetch>>;
        planner: ReturnType<typeof createPlanner>;
    } {
        const fetch = vi.fn<typeof globalThis.fetch>(() => answer(routeOf(true)));
        vi.stubGlobal("fetch", fetch);
        const planner = createPlanner(effectsSpy().effects);
        planner.setPlace(planner.waypoints[0]?.key ?? 0, hit("Gareth"));
        planner.setPlace(planner.addWaypoint(), hit("Perricum"));
        return { fetch, planner };
    }

    it("🔴 zehn schnelle Änderungen der Reisestunden: EINE Frage, SAMMELN_MS nach der letzten, mit dem letzten Stand", async () => {
        const { fetch, planner } = bereit();
        expect(routeCalls(fetch), "der zweite Ort fragt sofort").toHaveLength(1);
        await vi.advanceTimersByTimeAsync(SAMMELN_MS);
        expect(planner.status.value).toBe("ready");

        for (let schritt = 1; schritt <= 10; schritt += 1) {
            planner.setOptions((options) => {
                options.hoursPerDay = 8 + schritt;
            });
            await vi.advanceTimersByTimeAsync(SAMMELN_MS / 3);
        }
        expect(routeCalls(fetch), "solange Änderungen kommen, fragt er nicht").toHaveLength(1);
        expect(planner.status.value).toBe("loading");
        expect(planner.stale.value, "die alte Route steht gedimmt").toBe(true);

        await vi.advanceTimersByTimeAsync(SAMMELN_MS);
        expect(routeCalls(fetch)).toHaveLength(2);
        expect(routeCalls(fetch)[1]).toContain("hours_per_day=18");
        expect(planner.status.value).toBe("ready");
    });

    it("🔴 ein Ort nach Ruhe fragt sofort; kurz nach einer Frage wartet ein Drop bis SAMMELN_MS nach ihr, und nur der letzte geht raus", async () => {
        const { fetch, planner } = bereit();
        await vi.advanceTimersByTimeAsync(SAMMELN_MS);
        const ziel = planner.addWaypoint();
        planner.setPlace(ziel, hit("Punin"));
        expect(routeCalls(fetch), "ohne spürbare Verzögerung").toHaveLength(2);

        await vi.advanceTimersByTimeAsync(50);
        planner.moveWaypoint(ziel, hit("Havena"));
        planner.moveWaypoint(ziel, hit("Kunchom"));
        expect(routeCalls(fetch)).toHaveLength(2);
        await vi.advanceTimersByTimeAsync(SAMMELN_MS - 50);
        expect(routeCalls(fetch)).toHaveLength(3);
        expect(routeCalls(fetch)[2]).toContain("id-Kunchom");
        expect(routeCalls(fetch).join(" ")).not.toContain("id-Havena");
    });

    it("🪤 wer auf eine überholte Rechnung wartet, wartet nicht ewig: Sie endet mit der Rechnung, die sie ersetzt", async () => {
        const { planner } = bereit();
        const fertig = planner.replaceWaypoints([hit("Perz"), hit("Silkwiesen")]);
        planner.setOptions((options) => {
            options.minimizeTransfers = true;
        });
        await vi.advanceTimersByTimeAsync(SAMMELN_MS * 2);
        await expect(fertig).resolves.toBeUndefined();
        expect(planner.status.value).toBe("ready");
    });

    it("🔴 dieselbe Reise mit denselben Optionen kommt aus dem Speicher, ohne Frage und ohne Warten; nach seiner Zeit fragt der Planer neu", async () => {
        const { fetch, planner } = bereit();
        await vi.advanceTimersByTimeAsync(SAMMELN_MS);
        const vorgabe = planner.options.optimize;
        const schnellste = planner.route.value;

        planner.setOptions((options) => {
            options.optimize = vorgabe === "shortest" ? "fastest" : "shortest";
        });
        await vi.advanceTimersByTimeAsync(SAMMELN_MS);
        expect(routeCalls(fetch)).toHaveLength(2);
        const andere = planner.route.value;

        planner.setOptions((options) => {
            options.optimize = vorgabe;
        });
        expect(planner.route.value, "sofort, ohne SAMMELN_MS").toBe(schnellste);
        planner.setOptions((options) => {
            options.optimize = vorgabe === "shortest" ? "fastest" : "shortest";
        });
        expect(planner.route.value).toBe(andere);
        expect(routeCalls(fetch)).toHaveLength(2);

        await vi.advanceTimersByTimeAsync(ROUTEN_SPEICHER.ms + 1);
        planner.setOptions((options) => {
            options.optimize = vorgabe;
        });
        await vi.advanceTimersByTimeAsync(SAMMELN_MS);
        expect(routeCalls(fetch)).toHaveLength(3);
    });
});

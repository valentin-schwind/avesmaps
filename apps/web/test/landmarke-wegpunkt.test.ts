import { computed, reactive } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RouteResponse, RouteStagePoint, ShareResolved, SubjectDetail, WaypointHit } from "@avesmaps3d/shared";
import { createPanelActions, type PanelActionDeps } from "../src/info-panel/panel-actions.ts";
import { panelModelOf } from "../src/info-panel/panel-model.ts";
import { readPlannerLink, writePlannerLink } from "../src/route-planner/planner-link.ts";
import {
    DEFAULT_OPTIONS,
    isLandmark,
    isMapPoint,
    landmarkeAlsZiel,
    pointLabel,
} from "../src/route-planner/planner-model.ts";
import { stageKindLabel, stagePointRef } from "../src/route-planner/stage-subjects.ts";
import { createPlanner, type PlannerEffects } from "../src/route-planner/use-planner.ts";
import { env, gipfel, shown } from "./panel-fixtures.ts";

/**
 * Landmarken als Wegpunkt im Planer und im Infopanel (WI-0271 L6, §4.3): `l:<uuid>` reist durch den Planer wie ein Ort, die Etappe
 * öffnet die Landmarke als Gipfel-Subject, und das Infopanel einer Landmarke trägt „Reiseziel hinzufügen“, wenn ihre Art Reiseziel
 * sein darf. Ohne Browser; die Rechnung selbst prüft `apps/server/test/route-landmarken.test.ts`.
 *
 * Problemfälle: Die Adresse schreibt den Namen der Landmarke (und öffnet beim Neuladen einen gleichnamigen Ort oder nichts); die Etappe
 * zeigt „Kartenpunkt“ oder ist kein Knopf; Riff oder Strudel bekommen die Kachel; eine Landmarke wird zweimal Wegpunkt.
 */

const UUID = "c2c2c2c2-0271-4000-8000-0000000000a1";
const L = `l:${UUID}`;
const HOEHLE: WaypointHit = {
    id: L,
    name: "Drachenhöhle",
    subtype: "hoehle",
    hidden: false,
    x: 111,
    y: 104,
    landmark: "hoehle",
};
const GARETH: WaypointHit = { id: "id-Gareth", name: "Gareth", subtype: "metropole", hidden: false, x: 1, y: 2 };

const answer = (body: unknown, status = 200) =>
    Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));

function routeOf(): RouteResponse {
    return {
        found: true,
        failed_leg_index: null,
        map_domain: "aventuria",
        travel_model_version: "v",
        routing_graph_revision: "r",
        waypoints: [
            { id: GARETH.id, name: "Gareth" },
            { id: L, name: "Drachenhöhle" },
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
        stages: [],
        warnings: [],
    };
}

function effectsSpy() {
    const addresses: string[] = [];
    const effects: PlannerEffects = {
        showOnMap: () => undefined,
        fitRoute: () => undefined,
        showPlace: () => undefined,
        notify: () => undefined,
        writeAddress: (query) => addresses.push(query),
    };
    return { addresses, effects };
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("Die Landmarke im Planer", () => {
    it("ist ein Wegpunkt mit ihrer Kennung, kein Kartenpunkt", () => {
        expect(isLandmark(HOEHLE)).toBe(true);
        expect(isMapPoint(HOEHLE)).toBe(false);
        expect(isLandmark(GARETH)).toBe(false);
        expect(isLandmark(null)).toBe(false);
    });

    it("🔴 der Rechtsklick auf ihr Zeichen bietet sie als Ziel an (Wegpunkt `l:<uuid>` an ihrer Lage); Riff, Strudel und Unbekanntes nicht", () => {
        const lage = { x: 111, y: 104 };
        expect(landmarkeAlsZiel({ id: UUID, name: "Drachenhöhle", subtype: "hoehle" }, lage)).toEqual(HOEHLE);
        expect(landmarkeAlsZiel({ id: UUID, name: "Drachenriff", subtype: "riff" }, lage)).toBeUndefined();
        expect(landmarkeAlsZiel({ id: UUID, name: "Sog", subtype: "strudel" }, lage)).toBeUndefined();
        expect(landmarkeAlsZiel({ id: UUID, name: "Was", subtype: "unbekannt" }, lage)).toBeUndefined();
    });

    it("🔴 „Reiseziel hinzufügen“ fragt die Route mit `l:<uuid>` an und schreibt die Kennung in die Adresse, nicht den Namen", async () => {
        const fetch = vi.fn<typeof globalThis.fetch>(() => answer(routeOf()));
        vi.stubGlobal("fetch", fetch);
        const { addresses, effects } = effectsSpy();
        const planner = createPlanner(effects);
        planner.setPlace(planner.waypoints[0]?.key ?? 0, GARETH);
        expect(planner.addPlace(HOEHLE)).toBe(false);
        // Ein zweites Mal wird sie nicht eingetragen (wie ein Ort).
        planner.addPlace(HOEHLE);
        expect(planner.filled.value.map((place) => place.id)).toEqual([GARETH.id, L]);
        await vi.waitFor(() => expect(planner.status.value).toBe("ready"));
        const url = String(fetch.mock.calls.at(-1)?.[0]);
        expect(new URLSearchParams(url.split("?")[1]).get("waypoints")).toBe(`${GARETH.id},${L}`);
        expect(addresses.at(-1)).toBe(`route=Gareth~${L}`);
        expect(planner.shareState()?.waypoints).toEqual([GARETH.id, L]);
    });

    it("die Adresse liest sich zurück: Die Kennung geht wie ein Name an die Auflösung des Servers", async () => {
        expect(writePlannerLink(["Gareth", L], DEFAULT_OPTIONS)).toBe(`route=Gareth~${L}`);
        expect(readPlannerLink(`?route=Gareth~${L}`).names).toEqual(["Gareth", L]);
        const fetch = vi.fn<typeof globalThis.fetch>((input) =>
            String(input).startsWith("/api/route/waypoints/resolve")
                ? answer({ places: [GARETH, HOEHLE] })
                : answer(routeOf()),
        );
        vi.stubGlobal("fetch", fetch);
        const planner = createPlanner(effectsSpy().effects);
        await planner.restore(`?route=Gareth~${L}`, true);
        const resolve = fetch.mock.calls.map(([input]) => String(input)).find((url) => url.includes("/resolve"));
        expect(decodeURIComponent(resolve ?? "")).toBe(`/api/route/waypoints/resolve?names=Gareth~${L}`);
        expect(planner.filled.value).toEqual([GARETH, HOEHLE]);
    });

    it("ein Kurzlink bringt sie mit der Antwort des Servers zurück", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn(() => answer(routeOf())),
        );
        const planner = createPlanner(effectsSpy().effects);
        const shared: ShareResolved = {
            code: "Ab3dEf7h",
            payload: {
                v: 1,
                waypoints: [GARETH.id, L],
                options: {
                    optimize: "fastest",
                    minimizeTransfers: false,
                    enabled: { land: true, river: true, sea: true },
                    transports: { land: "groupFoot", river: "riverSailer", sea: "cargoShip" },
                    hoursPerDay: 8,
                },
                view: { series: "modern", view: "standard", layer: "alle" },
            },
            places: [GARETH, HOEHLE],
        };
        await planner.restoreShared(shared, true);
        expect(planner.filled.value.map((place) => place.id)).toEqual([GARETH.id, L]);
    });
});

describe("Die Etappe an einer Landmarke", () => {
    const punkt = (over: Partial<RouteStagePoint>): RouteStagePoint => ({
        point: "point",
        place_id: L,
        name: "Drachenhöhle",
        subtype: "hoehle",
        x: 111,
        y: 104,
        ...over,
    });

    it("🔴 öffnet die Landmarke im Infopanel (Subject `peak`, Kennung ist die uuid) und nennt ihre Art", () => {
        expect(stagePointRef(punkt({}))).toEqual({ kind: "peak", id: UUID });
        expect(stageKindLabel(punkt({}))).toBe("Höhle");
        expect(pointLabel(punkt({}))).toBe("Drachenhöhle");
    });

    it("ein Kartenpunkt und ein Ort bleiben, was sie waren", () => {
        expect(stagePointRef({ point: "point", place_id: "p:111:104", name: "Kartenpunkt", x: 111, y: 104 })).toEqual({
            kind: "mapPoint",
            x: 111,
            y: 104,
        });
        expect(stagePointRef(punkt({ point: "place", place_id: GARETH.id, subtype: "metropole" }))).toEqual({
            kind: "place",
            id: GARETH.id,
        });
        expect(stageKindLabel(punkt({ point: "place", place_id: GARETH.id, subtype: "metropole" }))).toBe("Metropole");
    });
});

describe("„Reiseziel hinzufügen“ im Infopanel einer Landmarke", () => {
    const landmarke = (art: string, id = UUID): SubjectDetail => ({
        ...gipfel,
        subject: { kind: "peak", id },
        title: "Drachenhöhle",
        subtitle: [{ part: "type", key: art }],
    });
    const model = (detail: SubjectDetail, destinations: readonly string[] = []) => {
        const result = panelModelOf(shown(detail), null, env("legacy", destinations));
        if (result === undefined) throw new Error("kein Modell");
        return result;
    };

    it("wie am Ort: über `addPlace`, mit dem Wegpunkt `l:<uuid>`, Name, Art und Lage; vor „Link teilen“", () => {
        const m = model(landmarke("hoehle"));
        expect(m.actions.map((action) => [action.id, action.tone])).toEqual([
            ["addDestination", "accent"],
            ["share", "soft"],
            ["suggest", "soft"],
        ]);
        const target = gipfel.target!;
        expect(m.actions[0]?.run).toEqual({
            type: "addPlace",
            hit: {
                id: L,
                name: "Drachenhöhle",
                subtype: "hoehle",
                hidden: false,
                x: target.x,
                y: target.y,
                landmark: "hoehle",
            },
        });
        // Berggipfel und Vulkan sind Landmarken wie die anderen.
        expect(model(gipfel).actions[0]?.id).toBe("addDestination");
        expect(model(landmarke("vulkan")).actions[0]?.id).toBe("addDestination");
    });

    it("🔴 nicht an Riff und Strudel (kein Reiseziel) und nicht an einer unbekannten Art", () => {
        for (const art of ["riff", "strudel", "unbekannt"]) {
            expect(
                model(landmarke(art)).actions.map((action) => action.id),
                art,
            ).toEqual(["share", "suggest"]);
        }
    });

    it("ist sie schon Wegpunkt, heißt die Kachel „Reiseziel entfernen“", () => {
        expect(model(landmarke("hoehle"), [L]).actions[0]).toMatchObject({
            id: "removeDestination",
            tone: "danger",
            run: { type: "removeDestination", id: L },
        });
    });

    it("die Kachel führt über die Naht des Planers aus, der Planer geht auf", () => {
        const calls: string[] = [];
        const waypoints = reactive<{ key: number; place: WaypointHit | null }[]>([{ key: 3, place: HOEHLE }]);
        const deps = {
            planner: {
                filled: computed(() => waypoints.flatMap((row) => (row.place ? [row.place] : []))),
                waypoints,
                addPlace: (place: WaypointHit) => {
                    calls.push(`addPlace:${place.id}`);
                    return false;
                },
                addMapPoint: () => true,
                removeWaypoint: (key: number) => {
                    calls.push(`removeWaypoint:${String(key)}`);
                },
                replaceWaypoints: () => Promise.resolve(),
                stepStage: () => undefined,
            },
            selection: { closeSubject: () => true },
            fly: () => undefined,
            copy: async () => true,
            notify: () => undefined,
            revealPlanner: () => calls.push("revealPlanner"),
            startSet: () => calls.push("startSet"),
            openCatalog: () => undefined,
            openSuggest: () => undefined,
            openSuggestMap: () => undefined,
            openReview: () => undefined,
            openReviewReport: () => undefined,
        } satisfies PanelActionDeps;
        const actions = createPanelActions(deps);
        expect(actions.isDestination(L)).toBe(true);
        actions.run({ type: "addPlace", hit: HOEHLE }, shown(landmarke("hoehle")));
        actions.run({ type: "removeDestination", id: L }, shown(landmarke("hoehle")));
        expect(calls).toEqual([`addPlace:${L}`, "revealPlanner", "removeWaypoint:3"]);
    });
});

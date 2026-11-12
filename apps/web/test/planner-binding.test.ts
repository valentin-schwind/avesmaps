import { computed, nextTick, ref, shallowRef } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RouteResponse, SubjectRef } from "@avesmaps3d/shared";
import {
    bindPlannerStage,
    routeKeyOf,
    stageRefOf,
    type PlannerSelectionSource,
} from "../src/info-panel/planner-binding.ts";
import { keepPlannerAndPanelApart } from "../src/info-panel/phone-exclusion.ts";
import { createSubjectSelection } from "../src/info-panel/subject-selection.ts";
import { createPlanner } from "../src/route-planner/use-planner.ts";

/**
 * Die Etappe als Subject und der Ausschluss von Planer und Panel am Telefon (WI-0063 4.3, 4.7).
 */

const quiet = (): ReturnType<typeof createSubjectSelection> =>
    createSubjectSelection({
        client: { detail: () => new Promise(() => undefined), resolveLink: () => Promise.reject(new Error("-")) },
        effects: { present: () => undefined, clear: () => undefined, fly: () => undefined },
    });

function planner(ids: string[] = ["a", "b"]): PlannerSelectionSource & {
    waypoints: ReturnType<typeof ref<{ id: string }[]>>;
} {
    const waypoints = ref(ids.map((id) => ({ id })));
    return {
        selectedStage: ref<number | null>(null),
        route: shallowRef<RouteResponse | null>({ found: true } as unknown as RouteResponse),
        filled: computed(() => waypoints.value),
        waypoints,
    };
}

describe("die Etappe öffnet ihre Information im Infopanel (WI-0063 4.7)", () => {
    it("🔴 eine gewählte Etappe wird der Subject `routeStage` samt Schlüssel der Reise, und das Panel geht auf", () => {
        const selection = quiet();
        const source = planner();
        bindPlannerStage(selection, source);
        source.selectedStage.value = 2;
        expect(selection.selected.value).toEqual({ kind: "routeStage", index: 2, routeKey: "a~b" });
        expect(selection.panelVisible.value).toBe(true);
    });

    it("eine andere Etappe tauscht den Subject, ohne den Abruf eines Servers (sie lebt im Planer)", () => {
        const selection = quiet();
        const source = planner();
        bindPlannerStage(selection, source);
        source.selectedStage.value = 1;
        source.selectedStage.value = 2;
        expect((selection.selected.value as { index: number }).index).toBe(2);
    });

    it("🔴 die Wiedergabe öffnet nie ein Panel, folgt aber einer offenen Etappe", () => {
        const selection = quiet();
        const source = planner();
        let playing = true;
        bindPlannerStage(selection, source, () => playing);
        source.selectedStage.value = 1;
        expect(selection.selected.value).toBeUndefined();
        expect(selection.panelVisible.value).toBe(false);
        // Eine Etappe, die schon im Panel steht, folgt dem Pfeil.
        playing = false;
        source.selectedStage.value = 2;
        expect(selection.selected.value).toMatchObject({ kind: "routeStage", index: 2 });
        playing = true;
        source.selectedStage.value = 3;
        expect(selection.selected.value).toMatchObject({ kind: "routeStage", index: 3 });
    });

    it("🔴 wählt der Planer die Etappe ab, schließt die Etappe im Panel", () => {
        const selection = quiet();
        const source = planner();
        bindPlannerStage(selection, source);
        source.selectedStage.value = 1;
        source.selectedStage.value = null;
        expect(selection.selected.value).toBeUndefined();
    });

    it("🔴 eine andere Reise macht die Etappe veraltet: Der Subject schließt", async () => {
        const selection = quiet();
        const source = planner(["a", "b"]);
        bindPlannerStage(selection, source);
        source.selectedStage.value = 1;
        // Die andere Reise kommt als neue Route an (der Planer rechnet sie nach jeder Änderung der Wegpunkte).
        source.waypoints.value = [{ id: "a" }, { id: "c" }];
        source.route.value = { found: true } as unknown as RouteResponse;
        await nextTick();
        expect(selection.selected.value).toBeUndefined();
    });

    it("🔴 verschwindet die Route, schließt die Etappe", async () => {
        const selection = quiet();
        const source = planner();
        bindPlannerStage(selection, source);
        source.selectedStage.value = 1;
        source.route.value = null;
        await nextTick();
        expect(selection.selected.value).toBeUndefined();
    });

    it("ein anderer Subject (ein Ort) bleibt, wenn die Reise wechselt", async () => {
        const selection = quiet();
        const source = planner();
        bindPlannerStage(selection, source);
        selection.openSubject(
            { kind: "place", id: "80558060-4299-54aa-b520-814b10819885" },
            { source: "map", camera: "none" },
        );
        source.route.value = null;
        await nextTick();
        expect(selection.selected.value?.kind).toBe("place");
    });

    it("der Schlüssel der Reise sind die Kennungen der Wegpunkte in Reihenfolge", () => {
        expect(routeKeyOf(planner(["x", "y", "z"]))).toBe("x~y~z");
        const stage: SubjectRef = stageRefOf(planner(["x", "y"]), 4);
        expect(stage).toEqual({ kind: "routeStage", index: 4, routeKey: "x~y" });
    });

    it("🔴 die Bindung ist abmeldbar", () => {
        const selection = quiet();
        const source = planner();
        const stop = bindPlannerStage(selection, source);
        stop();
        source.selectedStage.value = 1;
        expect(selection.selected.value).toBeUndefined();
    });
});

describe("🔴 die Bindung lässt den echten Planer in Ruhe", () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("„Hierher reisen“ rechnet weiter, auch mit gebundener Etappe (Befund 2026-10-04, map-points.spec)", async () => {
        // Ein Beobachter, der `planner.filled` sofort las, ließ ihn mitten in `addMapPoint` auf einem alten Stand stehen:
        // Die Zeile stand schon im Feld, ihr Ort wird dort am rohen Objekt gesetzt. Der Planer rechnete danach nie.
        const requests: string[] = [];
        vi.stubGlobal(
            "fetch",
            vi.fn((input: string | URL | Request) => {
                const url = String(input);
                requests.push(url);
                const body = url.includes("/nearest") ? { place: null, distance: null } : { error: "routing_failed" };
                return Promise.resolve(
                    new Response(JSON.stringify(body), { status: url.includes("/nearest") ? 200 : 500 }),
                );
            }),
        );
        const planner = createPlanner({
            showOnMap: () => undefined,
            fitRoute: () => undefined,
            showPlace: () => undefined,
            notify: () => undefined,
            writeAddress: () => undefined,
        });
        bindPlannerStage(quiet(), planner);
        planner.addMapPoint({ x: 10, y: 20 });
        planner.addMapPoint({ x: 30, y: 40 });
        expect(planner.filled.value).toHaveLength(2);
        await vi.waitFor(() => expect(requests.some((url) => url.includes("/api/route?"))).toBe(true));
    });
});

describe("🔴 am Telefon schließen Planer und Panel einander aus, in beide Richtungen (WI-0063 4.3)", () => {
    const open = (selection: ReturnType<typeof quiet>): void => {
        selection.openSubject(
            { kind: "place", id: "80558060-4299-54aa-b520-814b10819885" },
            { source: "map", camera: "none" },
        );
    };

    it("geht das Panel auf, fährt der Planer zu", () => {
        const selection = quiet();
        const plannerOpen = ref(true);
        keepPlannerAndPanelApart(selection, plannerOpen, ref(true));
        open(selection);
        expect(selection.panelVisible.value).toBe(true);
        expect(plannerOpen.value).toBe(false);
    });

    it("geht der Planer auf, klappt das Panel ein - die Auswahl bleibt", () => {
        const selection = quiet();
        const plannerOpen = ref(false);
        keepPlannerAndPanelApart(selection, plannerOpen, ref(true));
        open(selection);
        plannerOpen.value = true;
        expect(selection.panelVisible.value).toBe(false);
        expect(selection.hasContent.value).toBe(true);
        expect(plannerOpen.value).toBe(true);
    });

    it("🔴 am Telefon gilt dasselbe für das Editorpanel (WI-0128 E3), in beide Richtungen", () => {
        const selection = quiet();
        const plannerOpen = ref(true);
        keepPlannerAndPanelApart(selection, plannerOpen, ref(true));
        selection.showEditor();
        expect(plannerOpen.value).toBe(false);
        plannerOpen.value = true;
        expect(selection.editorVisible.value).toBe(false);
    });

    it("🔴 am Rechner stehen beide nebeneinander", () => {
        const selection = quiet();
        const plannerOpen = ref(true);
        keepPlannerAndPanelApart(selection, plannerOpen, ref(false));
        open(selection);
        expect(selection.panelVisible.value).toBe(true);
        expect(plannerOpen.value).toBe(true);
        plannerOpen.value = false;
        plannerOpen.value = true;
        expect(selection.panelVisible.value).toBe(true);
    });

    it("abmelden: Danach gilt nichts mehr", () => {
        const selection = quiet();
        const plannerOpen = ref(true);
        const stop = keepPlannerAndPanelApart(selection, plannerOpen, ref(true));
        stop();
        open(selection);
        expect(plannerOpen.value).toBe(true);
    });
});

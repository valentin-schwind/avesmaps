import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Map as MapLibreMap } from "maplibre-gl";
import { AVENTURIA, toRenderLngLat } from "@avesmaps3d/shared";
import { installAreaSelection } from "../src/map/area-selection-input.ts";
import { AREA_SELECTION_FILL_LAYER_ID, type AreaSelection } from "../src/map/area-selection.ts";
import { locale, t } from "../src/i18n/i18n.ts";
import { LONG_PRESS_MS } from "../src/map/interaction/long-press.ts";
import {
    climateOwner,
    contextOwner,
    emptyOwner,
    placeOwner,
    routeOwner,
    type ClimateZone,
} from "../src/map/interaction/owners.ts";
import { INTERACTION_PRIORITY } from "../src/map/interaction/priorities.ts";
import { CLIMATE_FILL_LAYER_ID, LANDSCAPE_FILL_LAYER_IDS } from "../src/map/landscape-layers.ts";
import { PLACE_MARKER_LAYER_ID, STRUCTURE_MARKER_LAYER_ID } from "../src/map/place-layers.ts";
import type { PointerHint } from "../src/map/pointer-hint.ts";
import { POWERLINE_HIT_LAYER_ID } from "../src/map/powerline-layers.ts";
import {
    distinctPowerlines,
    installPowerlineSelection,
    nextPowerline,
    type PowerlineCandidate,
    type PowerlineChoices,
} from "../src/map/powerline-selection-input.ts";
import { PATH_HIT_LAYER_IDS } from "../src/map/path-layers.ts";
import { installPathSelection } from "../src/map/path-selection-input.ts";
import { ROUTE_HIT_LAYER_ID, ROUTE_MARKER_LAYER_ID } from "../src/map/route-layers.ts";
import { createHarness, feature, mouse, touch, type Harness } from "./fake-interaction-map.ts";

/**
 * Kraftlinien und Klimabänder sind auf der Karte anklickbar (WI-0063 P8, Betreiber 2026-10-04: „Jedes Objekt, das bei auf unserer
 * Karte vorkommt, anklickbar sein sollte“). Die Besitzer am echten Koordinator, die Karte ist ein Testdoppel: geprüft werden der
 * Vorrang (Ort und Route gehen vor, Weg und Fläche kommen danach), die Auswahlliste, das Zeiger-Schild, der lange Druck und der
 * Klickpunkt für das Editor-Menü.
 */

const space = AVENTURIA.coordinateSpace;
const LAND = LANDSCAPE_FILL_LAYER_IDS[0] as string;

let harness: Harness;

beforeEach(() => {
    vi.useFakeTimers();
    harness = createHarness();
    for (const id of [
        PLACE_MARKER_LAYER_ID,
        STRUCTURE_MARKER_LAYER_ID,
        ROUTE_HIT_LAYER_ID,
        ROUTE_MARKER_LAYER_ID,
        POWERLINE_HIT_LAYER_ID,
        CLIMATE_FILL_LAYER_ID,
        LAND,
        AREA_SELECTION_FILL_LAYER_ID,
    ]) {
        harness.map.layers.add(id);
    }
});

afterEach(() => {
    harness.coordinator.destroy();
    vi.useRealTimers();
});

const line = (id: string, name: string): ReturnType<typeof feature> =>
    feature(POWERLINE_HIT_LAYER_ID, { public_id: id, name, label_visible: true });

const band = (type_key: string, label: string): ReturnType<typeof feature> =>
    feature(CLIMATE_FILL_LAYER_ID, { type_key, label, sort_order: 1 });

const placeAt = (): ReturnType<typeof feature> => {
    const { lng, lat } = toRenderLngLat(space, { x: 551.625, y: 532.969 });
    return feature(
        PLACE_MARKER_LAYER_ID,
        { public_id: "p1", name: "Gareth", subtype: "metropole" },
        { type: "Point", coordinates: [lng, lat] },
    );
};

describe("die Rangtafel kennt Kraftlinie und Klimaband", () => {
    it("🔴 Ort vor Route vor Kraftlinie vor Weg vor Fläche vor Klimaband vor Kontextmenü", () => {
        const p = INTERACTION_PRIORITY;
        expect(p.place).toBeGreaterThan(p.route);
        expect(p.route).toBeGreaterThan(p.powerline);
        expect(p.powerline).toBeGreaterThan(p.path);
        expect(p.path).toBeGreaterThan(p.area);
        expect(p.area).toBeGreaterThan(p.climate);
        expect(p.climate).toBeGreaterThan(p.context);
        // 🔴 Das Kontextmenü ist der unterste Besitzer über dem Rückfall (WI-0108): Die Zeile `map-point` 10
        // ist weg, „Was ist hier?“ ist ein EINTRAG dieses Menüs.
        expect(p.context).toBeGreaterThan(p.empty);
    });
});

describe("die Kraftlinie als Besitzer", () => {
    let visible: boolean;
    let current: string | undefined;
    let selects: { line: PowerlineCandidate; at: { x: number; y: number } | undefined }[];
    let choices: (PowerlineChoices | undefined)[];
    let hints: (PointerHint | undefined)[];
    let drawn: ((point: { x: number; y: number }, reach: number) => PowerlineCandidate[] | undefined) | undefined;
    let reaches: number[];
    let cleared: number;
    let told: (string | undefined)[];

    beforeEach(() => {
        visible = true;
        current = undefined;
        selects = [];
        choices = [];
        hints = [];
        drawn = undefined;
        reaches = [];
        cleared = 0;
        told = [];
        installPowerlineSelection(harness.map as unknown as MapLibreMap, harness.coordinator, {
            visible: () => visible,
            current: () => current,
            select: (picked, at) => {
                current = picked.name;
                selects.push({ line: picked, at });
            },
            hint: (hint) => hints.push(hint),
            choices: (next) => choices.push(next),
            reach: () => 11,
            drawn: (point, reach) => {
                reaches.push(reach);
                return drawn?.(point, reach);
            },
        });
        harness.coordinator.register(
            emptyOwner({
                clear: () => {
                    cleared += 1;
                },
            }),
        );
        harness.coordinator.observe("click", ({ claimedBy }) => told.push(claimedBy));
    });

    it("🔴 ein Klick auf eine Kraftlinie wählt sie, mit dem Klickpunkt in Fensterkoordinaten für das Editor-Menü", () => {
        harness.map.hits = [line("s1", "Basiliuslinie")];
        harness.map.fire("click", mouse(5, 5));
        expect(selects).toEqual([{ line: { id: "s1", name: "Basiliuslinie" }, at: { x: 105, y: 105 } }]);
        expect(choices.at(-1)).toBeUndefined();
        expect(cleared).toBe(0);
        expect(told).toEqual(["powerline"]);
    });

    it("🔴 Segmente gleichen Namens sind EINE Kraftlinie: keine Liste, das nächste steht für die Gruppe", () => {
        harness.map.hits = [line("s1", "Basiliuslinie"), line("s2", "Basiliuslinie"), line("s3", "Basiliuslinie")];
        harness.map.fire("click", mouse(5, 5));
        expect(selects).toHaveLength(1);
        expect(selects[0]?.line.id).toBe("s1");
        expect(choices.at(-1)).toBeUndefined();
    });

    it("🔴 liegen mehrere Kraftlinien unter dem Zeiger, öffnet der Klick die Liste: gewählt die erste, kein Klickpunkt", () => {
        harness.map.hits = [line("b", "Yaquirlinie"), line("a", "Basiliuslinie")];
        harness.map.fire("click", mouse(5, 5));
        // Die Kachel kennt keine Entfernung: nach Name geordnet.
        expect(selects).toEqual([{ line: { id: "a", name: "Basiliuslinie" }, at: undefined }]);
        expect(choices.at(-1)?.candidates.map((candidate) => candidate.name)).toEqual(["Basiliuslinie", "Yaquirlinie"]);
        expect(choices.at(-1)?.selected).toBe("a");
        expect(choices.at(-1)?.screen).toEqual({ x: 105, y: 105 });
    });

    it("🔴 ein zweiter Klick an derselben Stelle nimmt die nächste Kraftlinie (Durchklicken), nach der letzten wieder die erste", () => {
        harness.map.hits = [line("a", "Basiliuslinie"), line("b", "Yaquirlinie")];
        harness.map.fire("click", mouse(5, 5));
        harness.map.fire("click", mouse(5, 5));
        harness.map.fire("click", mouse(5, 5));
        expect(selects.map((entry) => entry.line.name)).toEqual(["Basiliuslinie", "Yaquirlinie", "Basiliuslinie"]);
    });

    it("🔴 wo die Bögen gezeichnet sind, gilt der Bogen im Bild: die nächste zuerst, mit dem Spielraum des Zeigers", () => {
        // Die Kacheln liegen woanders: Gezeichnet ist, was die Bögen melden.
        harness.map.hits = [line("kachel", "Kachellinie")];
        drawn = () => [
            { id: "nah", name: "Nahlinie" },
            { id: "fern", name: "Fernlinie" },
        ];
        harness.map.fire("click", mouse(5, 5));
        expect(reaches).toEqual([11]);
        expect(selects[0]?.line).toEqual({ id: "nah", name: "Nahlinie" });
        expect(choices.at(-1)?.candidates.map((candidate) => candidate.id)).toEqual(["nah", "fern"]);
    });

    it("🔴 zeichnen die Bögen und finden nichts, gilt der Klick der freien Karte - die Kacheln am Boden zählen dann nicht", () => {
        harness.map.hits = [line("kachel", "Kachellinie")];
        drawn = () => [];
        harness.map.fire("click", mouse(5, 5));
        expect(selects).toEqual([]);
        expect(cleared).toBe(1);
    });

    it("zeichnen die Bögen nicht (Rückfall auf die flachen Lagen), gelten die Kacheln", () => {
        harness.map.hits = [line("kachel", "Kachellinie")];
        drawn = () => undefined;
        harness.map.fire("click", mouse(5, 5));
        expect(selects.map((entry) => entry.line.name)).toEqual(["Kachellinie"]);
    });

    it("🔴 in jeder anderen Ansicht nimmt der Besitzer an nichts teil: Der Klick gehört der freien Karte", () => {
        visible = false;
        harness.map.hits = [line("s1", "Basiliuslinie")];
        harness.map.fire("click", mouse(5, 5));
        expect(selects).toEqual([]);
        expect(cleared).toBe(1);
        expect(told).toEqual(["empty"]);
    });

    it("🔴 ein Klick, unter dem keine Kraftlinie liegt, beendet die Auswahl (der Rückfall)", () => {
        harness.map.fire("click", mouse(5, 5));
        expect(selects).toEqual([]);
        expect(cleared).toBe(1);
    });

    it("🔴 der lange Druck wählt sie NICHT mehr: Er ist der Rechtsklick, und der öffnet das Kartenmenü (WI-0108)", () => {
        const menus: unknown[] = [];
        harness.coordinator.register(contextOwner({ open: (screen) => menus.push(screen) }));
        harness.map.hits = [line("s1", "Basiliuslinie")];
        harness.map.fire("touchstart", touch(5, 5));
        vi.advanceTimersByTime(LONG_PRESS_MS);
        expect(selects).toEqual([]);
        expect(menus).toEqual([{ x: 105, y: 105 }]);
        // Der Tipp wählt sie weiter - das ist der Weg zum Objekt am Finger. 🪰 Ein EIGENER Tipp: Den Klick, den der
        // Browser aus dem Loslassen des langen Drucks macht, schluckt der Koordinator (siehe `interaction-coordinator`).
        harness.map.fire("touchend", touch(0, 0));
        harness.map.fire("touchstart", touch(5, 5));
        harness.map.fire("touchend", touch(0, 0));
        harness.map.fire("click", mouse(5, 5));
        expect(selects.map((entry) => entry.line.name)).toEqual(["Basiliuslinie"]);
    });

    it("Zeigen: die Hand und das Schild „Name · Kraftlinie“ an der Stelle des Zeigers, beim Verlassen weg", () => {
        harness.map.hits = [line("s1", "Basiliuslinie")];
        harness.map.fire("mousemove", mouse(5, 5));
        harness.flushFrames();
        expect(harness.map.canvas.style.cursor).toBe("pointer");
        expect(hints.at(-1)).toEqual({ name: "Basiliuslinie", type: "Kraftlinie", screen: { x: 105, y: 105 } });
        harness.map.fire("mouseout", mouse(5, 5));
        expect(hints.at(-1)).toBeUndefined();
        expect(harness.map.canvas.style.cursor).toBe("");
    });

    it("auf Touch gibt es kein Zeigen und deshalb kein Schild", () => {
        harness.map.hits = [line("s1", "Basiliuslinie")];
        harness.map.fire("touchstart", touch(5, 5));
        harness.flushFrames();
        expect(hints).toEqual([]);
    });

    it("jede Kartenbewegung schließt die Liste, das Nachführen der sichtbaren Fläche nicht", () => {
        choices.length = 0;
        harness.map.fire("movestart", { visibleArea: true });
        expect(choices).toEqual([]);
        harness.map.fire("movestart", {});
        expect(choices).toEqual([undefined]);
    });

    describe("der Vorrang", () => {
        let areaSelection: AreaSelection | undefined;
        let places: string[];
        let stages: number[];
        let areas: string[];

        beforeEach(() => {
            areaSelection = undefined;
            places = [];
            stages = [];
            areas = [];
            harness.coordinator.register(placeOwner({ select: (place) => places.push(place.id) }));
            harness.coordinator.register(
                routeOwner({ stale: () => false, selectStage: (stage) => stages.push(stage) }),
            );
            installAreaSelection(harness.map as unknown as MapLibreMap, harness.coordinator, {
                current: () => areaSelection,
                select: (area) => {
                    areaSelection = area;
                    areas.push(area.id);
                },
                hint: () => undefined,
                choices: () => undefined,
            });
            // Der Weg gehört seit WI-0090 seinem eigenen Besitzer (Rang 45): Die Kraftlinie muss über ihm stehen.
            installPathSelection(harness.map as unknown as MapLibreMap, harness.coordinator, {
                current: () => (areaSelection?.kind === "path" ? areaSelection.id : undefined),
                select: (path) => {
                    areaSelection = path;
                    areas.push(path.id);
                },
                hint: () => undefined,
                outline: () => false,
            });
            for (const id of PATH_HIT_LAYER_IDS) harness.map.layers.add(id);
        });

        it("🔴 Ort vor Kraftlinie (Legacys Klick-Schiedsrichter: Kraftlinien enden an Orten)", () => {
            harness.map.hits = [line("s1", "Basiliuslinie"), placeAt()];
            harness.map.fire("click", mouse(5, 5));
            expect(places).toEqual(["p1"]);
            expect(selects).toEqual([]);
        });

        it("🔴 Route vor Kraftlinie", () => {
            harness.map.hits = [line("s1", "Basiliuslinie"), feature(ROUTE_HIT_LAYER_ID, { stage: 2 })];
            harness.map.fire("click", mouse(5, 5));
            expect(stages).toEqual([2]);
            expect(selects).toEqual([]);
        });

        it("🔴 Kraftlinie vor Fläche darunter", () => {
            harness.map.hits = [
                feature(LAND, { region_public_id: "r1", region_type: "wald", name: "Reichsforst", area: 10 }),
                line("s1", "Basiliuslinie"),
            ];
            harness.map.fire("click", mouse(5, 5));
            expect(selects.map((entry) => entry.line.name)).toEqual(["Basiliuslinie"]);
            expect(areas).toEqual([]);
        });

        it("🔴 Kraftlinie vor Weg: Rang 50 gegen 45 (WI-0090 - sie wird über den Wegen gezeichnet)", () => {
            for (const [was, weg] of [
                ["Fluss", feature("path-hit-flussweg", { name: "Großer Fluss", subtype: "Flussweg" })],
                [
                    "Reichsstraße",
                    feature("path-hit-reichsstrasse", { name: "Reichsstraße 2", subtype: "Reichsstrasse" }),
                ],
            ] as const) {
                selects.length = 0;
                areas.length = 0;
                harness.map.hits = [weg, line("s1", "Basiliuslinie")];
                harness.map.fire("click", mouse(5, 5));
                expect(
                    selects.map((entry) => entry.line.name),
                    was,
                ).toEqual(["Basiliuslinie"]);
                expect(areas, was).toEqual([]);
            }
        });

        it("🔴 ohne Kraftlinie darunter wählt der Weg - Fluss wie bisher, Straße neu (WI-0090)", () => {
            for (const [weg, kette] of [
                [feature("path-hit-flussweg", { name: "Großer Fluss", subtype: "Flussweg" }), "name:Großer Fluss"],
                [
                    feature("path-hit-reichsstrasse", { name: "Reichsstraße 2", subtype: "Reichsstrasse" }),
                    "name:Reichsstraße 2",
                ],
            ] as const) {
                areas.length = 0;
                selects.length = 0;
                areaSelection = undefined;
                harness.map.hits = [weg];
                harness.map.fire("click", mouse(5, 5));
                expect(areas, kette).toEqual([kette]);
                expect(selects, kette).toEqual([]);
            }
        });

        it("🔴 ohne Kraftlinie darunter wählt die Fläche wie bisher", () => {
            harness.map.hits = [
                feature(LAND, { region_public_id: "r1", region_type: "wald", name: "Reichsforst", area: 10 }),
            ];
            harness.map.fire("click", mouse(5, 5));
            expect(areas).toEqual(["r1"]);
            expect(selects).toEqual([]);
        });
    });
});

describe("Segmente, Gruppen und die Reihenfolge der Auswahl", () => {
    it("distinctPowerlines: je Name eine, das erste Segment steht für die Gruppe; eine namenlose ist nur sie selbst", () => {
        expect(
            distinctPowerlines([
                { id: "1", name: "A" },
                { id: "2", name: "B" },
                { id: "3", name: "A" },
                { id: "4", name: "" },
                { id: "5", name: "" },
                { id: "", name: "ohne Kennung" },
            ]),
        ).toEqual([
            { id: "1", name: "A" },
            { id: "2", name: "B" },
            { id: "4", name: "" },
            { id: "5", name: "" },
        ]);
    });

    it("nextPowerline: ohne Auswahl die erste, sonst die nach der gewählten, nach der letzten wieder die erste", () => {
        const list = [
            { id: "1", name: "A" },
            { id: "2", name: "B" },
        ];
        expect(nextPowerline(list, undefined)?.id).toBe("1");
        expect(nextPowerline(list, "A")?.id).toBe("2");
        expect(nextPowerline(list, "B")?.id).toBe("1");
        // Die gewählte liegt nicht hier: die erste.
        expect(nextPowerline(list, "Z")?.id).toBe("1");
        expect(nextPowerline([], "A")).toBeUndefined();
    });
});

describe("das Klimaband als Besitzer", () => {
    let selects: { zone: ClimateZone; at: { x: number; y: number } }[];
    let hints: (PointerHint | undefined)[];
    let cleared: number;
    let areas: string[];

    beforeEach(() => {
        selects = [];
        hints = [];
        cleared = 0;
        areas = [];
        harness.coordinator.register(
            climateOwner({
                select: (zone, at) => selects.push({ zone, at }),
                hover: (hint) => hints.push(hint),
            }),
        );
        harness.coordinator.register(
            emptyOwner({
                clear: () => {
                    cleared += 1;
                },
            }),
        );
        installAreaSelection(harness.map as unknown as MapLibreMap, harness.coordinator, {
            current: () => undefined,
            select: (area) => areas.push(area.id),
            hint: () => undefined,
            choices: () => undefined,
        });
    });

    it("🔴 ein Klick auf ein Band wählt es: Schlüssel aus der Kachel, Name aus der Tafel, Klickpunkt für das Menü", () => {
        harness.map.hits = [band("gemaessigt", "Gemäßigte Zone")];
        harness.map.fire("click", mouse(5, 5));
        expect(selects).toEqual([
            { zone: { band: "gemaessigt", name: t("climate.zone.gemaessigt") }, at: { x: 105, y: 105 } },
        ]);
        expect(cleared).toBe(0);
    });

    /**
     * 🔴 **Der Name kommt aus der Sprachtafel, nicht aus der Kachel** (WI-0171, Betreiber 2026-10-15: „übersetzen,
     * auch der Name vom Server“).
     *
     * 💣 Die Kachel trägt den deutschen Stamm (`climate_zone_type.label`) - in JEDER Sprache. Wer ihn durchreicht,
     * zeigt einem niederländischen Besucher einen deutschen Namen, während die Zonentabelle im ⓘ daneben den
     * übersetzten nennt. Genau so liefen die Stellen vor WI-0171 auseinander.
     */
    it("🔴 in einer anderen Sprache heißt das Band wie in DEREN Tafel, nicht wie in der Kachel", () => {
        locale.value = "nl";
        try {
            harness.map.hits = [band("gemaessigt", "Gemäßigte Zone")];
            harness.map.fire("click", mouse(5, 5));
            expect(selects.map((entry) => entry.zone.name)).toEqual([t("climate.zone.gemaessigt")]);
        } finally {
            locale.value = "de";
        }
    });

    it("🔴 der lange Druck wählt das Band NICHT mehr (WI-0108) - der Tipp tut es", () => {
        harness.map.hits = [band("tropisch", "Tropische Zone")];
        harness.map.fire("touchstart", touch(5, 5));
        vi.advanceTimersByTime(LONG_PRESS_MS);
        expect(selects).toEqual([]);
        // 🪰 Ein eigener Tipp: Der Klick aus dem Loslassen des langen Drucks zählt nicht.
        harness.map.fire("touchend", touch(0, 0));
        harness.map.fire("touchstart", touch(5, 5));
        harness.map.fire("touchend", touch(0, 0));
        harness.map.fire("click", mouse(5, 5));
        expect(selects.map((entry) => entry.zone.band)).toEqual(["tropisch"]);
    });

    it("🔴 in jeder anderen Ansicht gibt es keine Bänder (auch nicht in „Alle“): der Klick bleibt bei der Fläche", () => {
        // Bänder zeichnet nur die Klimaansicht (Betreiber 2026-10-05); ohne die Ebene im Stil trifft der Besitzer nichts.
        harness.map.layers.delete(CLIMATE_FILL_LAYER_ID);
        harness.map.hits = [
            band("gemaessigt", "Gemäßigte Zone"),
            feature(LAND, { region_public_id: "r1", region_type: "wald", name: "Reichsforst", area: 10 }),
        ];
        harness.map.fire("click", mouse(5, 5));
        expect(selects).toEqual([]);
        expect(areas).toEqual(["r1"]);
    });

    it("🔴 ein Fluss oder eine Fläche über dem Band gewinnt vor ihm (Rang 40 gegen 30)", () => {
        harness.map.hits = [
            band("gemaessigt", "Gemäßigte Zone"),
            feature(LAND, { region_public_id: "r1", region_type: "wald", name: "Reichsforst", area: 10 }),
        ];
        harness.map.fire("click", mouse(5, 5));
        expect(areas).toEqual(["r1"]);
        expect(selects).toEqual([]);
    });

    it("🔴 Ort und Route gehen vor dem Band", () => {
        const places: string[] = [];
        const stages: number[] = [];
        harness.coordinator.register(placeOwner({ select: (place) => places.push(place.id) }));
        harness.coordinator.register(routeOwner({ stale: () => false, selectStage: (stage) => stages.push(stage) }));
        harness.map.hits = [band("gemaessigt", "Gemäßigte Zone"), placeAt()];
        harness.map.fire("click", mouse(5, 5));
        expect(places).toEqual(["p1"]);
        harness.map.hits = [band("gemaessigt", "Gemäßigte Zone"), feature(ROUTE_HIT_LAYER_ID, { stage: 1 })];
        harness.map.fire("click", mouse(5, 5));
        expect(stages).toEqual([1]);
        expect(selects).toEqual([]);
    });

    it("🔴 in der Klimaansicht öffnet der lange Druck das Kartenmenü, nicht das Band (WI-0108)", () => {
        // Ein Band deckt in seiner Ansicht die ganze Karte. Hätte es den langen Druck behalten, wäre das Menü dort
        // am Finger nirgends zu öffnen - genau der Befund, den dieses Work Item abstellt.
        const menus: unknown[] = [];
        harness.coordinator.register(contextOwner({ open: (screen) => menus.push(screen) }));
        harness.map.hits = [band("polar", "Polare Zone")];
        harness.map.fire("touchstart", touch(5, 5));
        vi.advanceTimersByTime(LONG_PRESS_MS);
        expect(selects).toEqual([]);
        expect(menus).toEqual([{ x: 105, y: 105 }]);
        // Der Tipp wählt das Band weiter - als eigener Tipp, nicht als Klick aus dem Loslassen.
        harness.map.fire("touchend", touch(0, 0));
        harness.map.fire("touchstart", touch(5, 5));
        harness.map.fire("touchend", touch(0, 0));
        harness.map.fire("click", mouse(5, 5));
        expect(selects.map((entry) => entry.zone.band)).toEqual(["polar"]);
    });

    it("Zeigen: die Hand und das Schild „Name · Klimazone“, auch wenn die Kachel keinen Namen trägt", () => {
        harness.map.hits = [band("gemaessigt", "Gemäßigte Zone")];
        harness.map.fire("mousemove", mouse(5, 5));
        harness.flushFrames();
        expect(harness.map.canvas.style.cursor).toBe("pointer");
        expect(hints.at(-1)).toEqual({
            name: t("climate.zone.gemaessigt"),
            type: "Klimazone",
            screen: { x: 105, y: 105 },
        });

        // 🪤 Bis WI-0171 unterdrückte eine Kachel ohne `label` das Schild. Jetzt kommt der Name aus der Tafel,
        // und das Schild steht - mit demselben Wort wie überall sonst.
        hints.length = 0;
        harness.map.hits = [band("gemaessigt", "")];
        harness.map.fire("mousemove", mouse(6, 6));
        harness.flushFrames();
        expect(hints.at(-1)).toEqual({
            name: t("climate.zone.gemaessigt"),
            type: "Klimazone",
            screen: { x: 106, y: 106 },
        });
    });

    it("ein Treffer ohne Schlüssel beansprucht nichts", () => {
        harness.map.hits = [feature(CLIMATE_FILL_LAYER_ID, { label: "ohne Schlüssel" })];
        harness.map.fire("click", mouse(5, 5));
        expect(selects).toEqual([]);
        expect(cleared).toBe(1);
    });
});

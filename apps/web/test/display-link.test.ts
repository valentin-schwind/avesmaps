import { describe, expect, it } from "vitest";
import { Value } from "@sinclair/typebox/value";
import {
    canonicalSharePayload,
    MAP_VIEWS,
    ROUTE_DEFAULTS,
    SHARE_DISPLAY_KEYS,
    SHARE_PLACE_LEVEL_MAX,
    SharePayload,
    type LandscapeSelection,
    type MapView,
    type ShareDisplay,
} from "@avesmaps3d/shared";
import {
    ALL_PLACES_PARAM,
    applyDisplayDeviation,
    displayDeviation,
    displayParams,
    PLACE_PARAMS,
    queryWithoutDisplayParams,
    readAddressDisplay,
    readDisplayParams,
    SWITCH_PARAMS,
} from "../src/map/display-state.ts";
import { LEGACY_VIEW_PARAMS, openingView, readLegacyView } from "../src/map/legacy-view.ts";
import { displayDefaults, PLACE_TIERS, type DisplayContext, type MapDisplay } from "../src/map/map-display.ts";
import { formatViewState, parseViewState, type ViewState } from "../src/map/view-state.ts";

/**
 * Die Schalter des Auge-Menüs in Adresse und Kurzlink (WI-0072): was geschrieben wird (nur Abweichungen), was gelesen
 * wird (Legacys Namen, Hash vor Query), was überlesen wird (Ungültiges, Gesperrtes, Editorwerkzeuge für Besucher).
 */

const SERIES = ["original", "modern"] as const;
const SERIES_WITH_OLD = ["original", "old", "modern"] as const;

const baseView = (over: Partial<ViewState> = {}): ViewState => ({
    center: { x: 520, y: 500 },
    zoom: 5,
    series: "modern",
    view: "standard",
    landscape: "alle",
    ...over,
});

/** Der Kontext einer Vorgabe: Ansicht, Ebene (Vorgabe „Alle“) und ob ein Editor schaut. */
const ctx = (view: MapView, editor = false, layer: LandscapeSelection = "alle"): DisplayContext => ({
    view,
    layer,
    editor,
});

/**
 * Schreibt die Abweichung einer Anzeige in einen Hash und liest ihn wieder - der Weg, den ein kopierter Link nimmt.
 * Dieselbe Rolle schreibt und liest: Ein Editor hat in Standard andere Vorgaben als ein Besucher (OPS-000117).
 */
function roundTrip(view: MapView, display: MapDisplay, tileGrid = false, editor = true) {
    const hash = formatViewState(baseView({ view, display: displayDeviation(ctx(view, editor), display, tileGrid) }));
    return { hash, read: applyDisplayDeviation(ctx(view, editor), readAddressDisplay("", hash)) };
}

describe("Schreiben: nur Abweichungen von der Vorgabe der Ansicht", () => {
    it("🔴 die Vorgaben jeder Ansicht stehen nicht in der Adresse: dieselbe Adresse wie vor WI-0072", () => {
        for (const view of MAP_VIEWS) {
            const hash = formatViewState(
                baseView({ view, display: displayDeviation(ctx(view), displayDefaults(view), false) }),
            );
            expect(hash, view).toBe(formatViewState(baseView({ view })));
            expect(hash, view).not.toMatch(/toggle|areas|flow|grid/);
        }
    });

    it("jeder Schalter, einzeln umgelegt, ist genau ein Parameter mit Legacys Namen (Standard)", () => {
        const standard = displayDefaults("standard");
        const cases: [Partial<MapDisplay>, string, string][] = [
            [{ paths: false }, "togglePaths", "0"],
            [{ labels: false }, "toggleMapLabels", "0"],
            [{ borders: false }, "toggleTerritoryBorders", "0"],
            [{ rivers: true }, "toggleRivers", "1"],
            [{ flow: true }, "flow", "1"],
        ];
        for (const [change, name, value] of cases) {
            const deviation = displayDeviation(ctx("standard"), { ...standard, ...change }, false);
            expect(displayParams(deviation), name).toEqual([[name, value]]);
        }
        expect(displayParams(displayDeviation(ctx("standard"), standard, true))).toEqual([["grid", "1"]]);
    });

    it("die Ortsstufe schreibt sich in Legacys Kaskade: Stufe n ist die Klasse n auf 1, keine Orte toggleLocations=0", () => {
        const standard = displayDefaults("standard");
        PLACE_TIERS.forEach((tier, index) => {
            const level = index + 1;
            const pairs = displayParams(displayDeviation(ctx("standard"), { ...standard, placeLevel: level }, false));
            // Stufe 6 ist die Vorgabe von Standard: nichts steht in der Adresse.
            expect(pairs, tier).toEqual(level === PLACE_TIERS.length ? [] : [[PLACE_PARAMS[tier], "1"]]);
        });
        expect(displayParams(displayDeviation(ctx("standard"), { ...standard, placeLevel: 0 }, false))).toEqual([
            [ALL_PLACES_PARAM, "0"],
        ]);
        // In „Nur Karte“ ist keine Ortsklasse die Vorgabe, jede Stufe darüber weicht ab.
        expect(
            displayParams(displayDeviation(ctx("none"), { ...displayDefaults("none"), placeLevel: 3 }, false)),
        ).toEqual([["toggleStaedte", "1"]]);
    });

    it("gesperrt heißt nicht geschrieben: die Kraftlinien-Ansicht sperrt Orte, Wege, Flüsse und Strömung", () => {
        const display: MapDisplay = { ...displayDefaults("powerlines"), placeLevel: 3, paths: true, rivers: true };
        expect(displayDeviation(ctx("powerlines"), display, false)).toEqual({});
    });

    it("„Grenzen“ ist in „Nur Karte“ gesperrt, „Ebenen“ gibt es nur in den Landschaften", () => {
        expect(displayDeviation(ctx("none"), { ...displayDefaults("none"), borders: true }, false)).toEqual({});
        expect(displayDeviation(ctx("standard"), { ...displayDefaults("standard"), layers: false }, false)).toEqual({});
        expect(displayDeviation(ctx("landscapes"), { ...displayDefaults("landscapes"), layers: false }, false)).toEqual(
            {
                layers: false,
            },
        );
        expect(displayParams({ layers: false })).toEqual([["areas", "0"]]);
    });

    it("die Schalter stehen hinter Ausschnitt, Drehung und Neigung: der Anfang der Adresse bleibt", () => {
        const hash = formatViewState(baseView({ bearing: 20, pitch: 30, display: { paths: false, placeLevel: 0 } }));
        expect(hash.indexOf("b=20.0")).toBeLessThan(hash.indexOf("toggleLocations"));
        expect(hash.indexOf("p=30.0")).toBeLessThan(hash.indexOf("togglePaths"));
        // Und die Adresse bleibt ein gültiger Link der bisherigen Art.
        expect(parseViewState(hash, SERIES)).toMatchObject({ view: "standard", bearing: 20, pitch: 30 });
    });

    it("jeder Schalter der Anzeige hat einen Parameter (eine neue Zeile in MapDisplay ohne Namen fällt hier)", () => {
        // Die Ortsstufe und die Feldgröße des Hexrasters (`hex`, WI-0273) tragen Zahlen, keine Schalterwerte.
        const named = new Set<string>(["placeLevel", "hexraster", ...Object.keys(SWITCH_PARAMS)]);
        for (const view of MAP_VIEWS) {
            for (const key of Object.keys(displayDefaults(view))) {
                expect(named.has(key), `${view}: ${key}`).toBe(true);
            }
        }
        expect(PLACE_TIERS.length).toBe(SHARE_PLACE_LEVEL_MAX);
        expect([...SHARE_DISPLAY_KEYS].sort()).toEqual([...named].sort());
    });
});

describe("Hin und zurück: ein kopierter Link öffnet dieselben Schalter", () => {
    const touched: [MapView, Partial<MapDisplay>][] = [
        ["standard", { paths: false }],
        ["standard", { labels: false, rivers: true }],
        ["standard", { placeLevel: 0 }],
        ["standard", { placeLevel: 2, borders: false }],
        ["landscapes", { layers: false }],
        ["landscapes", { placeLevel: 6, rivers: false, paths: false }],
        ["none", { placeLevel: 1, labels: true, paths: true }],
        ["political", { borders: false }],
    ];
    for (const [view, change] of touched) {
        it(`${view} mit ${JSON.stringify(change)}`, () => {
            const display: MapDisplay = { ...displayDefaults(view), ...change };
            const { read } = roundTrip(view, display);
            expect(read.display).toEqual(display);
            expect(read.tileGrid).toBe(false);
        });
    }

    it("das Raster und die Strömung eines Editors kommen für einen Editor an", () => {
        const display: MapDisplay = { ...displayDefaults("standard"), rivers: true, flow: true };
        const { hash, read } = roundTrip("standard", display, true, true);
        expect(hash).toContain("flow=1");
        expect(hash).toContain("grid=1");
        expect(read.display.flow).toBe(true);
        expect(read.tileGrid).toBe(true);
    });

    it("🔴 für einen Besucher sind Strömung und Raster still aus, der Rest gilt", () => {
        const display: MapDisplay = { ...displayDefaults("standard"), rivers: true, flow: true, paths: false };
        const { read } = roundTrip("standard", display, true, false);
        expect(read.display.flow).toBe(false);
        expect(read.tileGrid).toBe(false);
        expect(read.display.rivers).toBe(true);
        expect(read.display.paths).toBe(false);
    });
});

describe("Lesen: Legacys Namen und Schreibweisen", () => {
    const read = (search: string, view: MapView = "standard", editor = false) =>
        applyDisplayDeviation(ctx(view, editor), readAddressDisplay(search, "")).display;

    it("🔴 togglePaths=0 und =1 (Legacys Name) schalten die Wege", () => {
        expect(read("?togglePaths=0").paths).toBe(false);
        expect(read("?togglePaths=1", "none").paths).toBe(true);
        expect(read("?togglePaths=0", "none").paths).toBe(false);
    });

    it("🔴 die Ortsklassen sind Legacys Kaskade: die höchste wahre Klasse bestimmt die Stufe", () => {
        expect(read("?toggleMetropolen=1").placeLevel).toBe(1);
        expect(read("?toggleStaedte=1").placeLevel).toBe(3);
        expect(read("?toggleMetropolen=1&toggleGrossstaedte=1&toggleStaedte=1").placeLevel).toBe(3);
        expect(read("?toggleDoerfer=1&toggleMetropolen=1").placeLevel).toBe(5);
        expect(read("?toggleGebaeude=1").placeLevel).toBe(6);
        // Alle Parameter da, alle aus: keine Orte (Legacy: ein Parameter unterdrückt die Vorgaben der Ansicht).
        expect(read("?toggleMetropolen=0&toggleStaedte=0").placeLevel).toBe(0);
    });

    it("🔴 der alte Sammelschalter toggleLocations gibt jeder Klasse ihre Vorgabe, eigene Parameter gehen vor", () => {
        expect(read("?toggleLocations=0").placeLevel).toBe(0);
        expect(read("?toggleLocations=1").placeLevel).toBe(6);
        // Legacy: Die höchste Klasse, die nicht ausdrücklich aus ist, gewinnt - eine Lücke zählt nicht.
        expect(read("?toggleLocations=1&toggleStaedte=0").placeLevel).toBe(6);
        expect(read("?toggleLocations=1&toggleGebaeude=0&toggleDoerfer=0").placeLevel).toBe(4);
        expect(read("?toggleLocations=0&toggleStaedte=1").placeLevel).toBe(3);
    });

    it("Legacys Wahrheitswerte in jeder Schreibung: 1, true, yes, on und 0, false, no, off", () => {
        for (const yes of ["1", "true", "TRUE", "Yes", "on", " ON "]) {
            expect(read(`?toggleRivers=${encodeURIComponent(yes)}`).rivers, yes).toBe(true);
        }
        for (const no of ["0", "false", "False", "no", "OFF"]) {
            expect(read(`?togglePaths=${no}`).paths, no).toBe(false);
        }
    });

    it("🔴 Ungültiges wird überlesen: der Schalter bleibt bei der Vorgabe, ohne Fehler", () => {
        const standard = displayDefaults("standard");
        expect(read("?togglePaths=vielleicht&toggleMapLabels=&toggleRivers=2&toggleStaedte=x")).toEqual(standard);
        expect(read("?areas=jein&flow=&grid=7", "landscapes", true)).toEqual(displayDefaults("landscapes"));
        expect(readDisplayParams(new URLSearchParams("togglePaths=%E0%A4%A&a"))).toEqual({});
    });

    it("alle Namen der Tafel kommen an: Labels, Grenzen, Flüsse, Ebenen, Strömung", () => {
        const display = read("?toggleMapLabels=0&toggleTerritoryBorders=0&toggleRivers=1&flow=1", "standard", true);
        expect(display).toMatchObject({ labels: false, borders: false, rivers: true, flow: true });
        expect(read("?areas=0", "landscapes").layers).toBe(false);
    });

    it("🔴 gesperrt gilt: die Kraftlinien nehmen weder Orte noch Wege aus einem Link, „Ebenen“ nur in den Landschaften", () => {
        expect(read("?togglePaths=1&toggleStaedte=1&toggleRivers=1", "powerlines")).toEqual(
            displayDefaults("powerlines"),
        );
        expect(read("?areas=0", "standard").layers).toBe(true);
        expect(read("?toggleTerritoryBorders=1", "none").borders).toBe(false);
    });

    it("🔴 der Hash geht vor der Query, je Schalter; die Ortsstufe zählt als einer", () => {
        const both = readAddressDisplay(
            "?togglePaths=0&toggleRivers=1&toggleStaedte=1",
            "#togglePaths=1&toggleDoerfer=1",
        );
        expect(both).toEqual({ paths: true, rivers: true, placeLevel: 5 });
        // Nur die Query sagt etwas: Legacys Link.
        expect(readAddressDisplay("?togglePaths=0", "#x=1&y=2")).toEqual({ paths: false });
        expect(readAddressDisplay("", "")).toEqual({});
    });
});

describe("Query aufräumen: gelesene Werte wandern in den Hash", () => {
    it("entfernt die Parameter der Schalter und die genannten Legacy-Ansichtsparameter, der Rest bleibt Zeichen für Zeichen", () => {
        expect(queryWithoutDisplayParams("?route=Gareth~Perricum&togglePaths=0&toggleStaedte=1&besucher")).toBe(
            "?route=Gareth~Perricum&besucher",
        );
        expect(queryWithoutDisplayParams("?togglePaths=0")).toBe("");
        expect(
            queryWithoutDisplayParams(
                "?mapLayerMode=ecosystem&mapstyle=original&toggleBorders=1&lang=en",
                LEGACY_VIEW_PARAMS,
            ),
        ).toBe("?lang=en");
    });

    it("🪤 eine Adresse ohne diese Parameter bleibt unverändert, auch mit leeren Teilen", () => {
        for (const search of ["", "?route=Gareth~Perricum", "?a=b&&c", "?s=abcd2345"]) {
            expect(queryWithoutDisplayParams(search, LEGACY_VIEW_PARAMS)).toBe(search);
        }
    });

    it("kennt jeden Parameter der Tafel", () => {
        const all = [ALL_PLACES_PARAM, ...Object.values(PLACE_PARAMS), ...Object.values(SWITCH_PARAMS)];
        expect(queryWithoutDisplayParams(`?${all.map((name) => `${name}=1`).join("&")}&keep=1`)).toBe("?keep=1");
    });
});

describe("Legacys Parameter für Ansicht und Untergrund", () => {
    const legacy = (search: string, known: readonly string[] = SERIES) =>
        readLegacyView(new URLSearchParams(search), known);

    it("🔴 mapLayerMode: Legacys Namen auf unsere Ansichten", () => {
        expect(legacy("mapLayerMode=none").view).toBe("none");
        expect(legacy("mapLayerMode=political").view).toBe("political");
        expect(legacy("mapLayerMode=deregraphic").view).toBe("standard");
        expect(legacy("mapLayerMode=powerlines").view).toBe("powerlines");
        expect(legacy("mapLayerMode=ecosystem").view).toBe("landscapes");
    });

    it("das alte original ist „Nur Karte“ auf dem Untergrund original (Legacy übersetzt es ebenso)", () => {
        expect(legacy("mapLayerMode=original")).toEqual({ view: "none", series: "original" });
    });

    it("toggleBorders=1 (alte Links) ist die politische Ansicht, aber nur ohne mapLayerMode", () => {
        expect(legacy("toggleBorders=1").view).toBe("political");
        expect(legacy("toggleBorders=0").view).toBeUndefined();
        expect(legacy("toggleBorders=1&mapLayerMode=ecosystem").view).toBe("landscapes");
        expect(legacy("toggleBorders=1&mapLayerMode=unsinn").view).toBeUndefined();
    });

    it("mapstyle: stylized ist unsere Serie modern; old nur, wo die Serie bekannt ist", () => {
        expect(legacy("mapstyle=stylized").series).toBe("modern");
        expect(legacy("mapstyle=original").series).toBe("original");
        expect(legacy("mapstyle=old", SERIES).series).toBeUndefined();
        expect(legacy("mapstyle=old", SERIES_WITH_OLD).series).toBe("old");
        expect(legacy("mapstyle=unsinn").series).toBeUndefined();
    });

    it("Unbekanntes wird überlesen", () => {
        expect(legacy("mapLayerMode=unsinn&mapstyle=x")).toEqual({});
        expect(legacy("mapLayerMode=constructor")).toEqual({});
    });

    it("🔴 openingView: ein Legacy-Link ohne Ausschnitt öffnet die Vorgabe mit Legacys Ansicht", () => {
        const fallback = baseView();
        const opened = openingView(undefined, fallback, "?mapLayerMode=ecosystem&mapstyle=original", "", SERIES);
        expect(opened).toMatchObject({ view: "landscapes", series: "original", zoom: 5, center: { x: 520, y: 500 } });
    });

    it("🔴 openingView: was der Hash selbst benennt, geht vor", () => {
        const hash = "#x=551.625&y=532.969&z=6.00&series=modern&view=political";
        const linked = parseViewState(hash, SERIES);
        const opened = openingView(linked, baseView(), "?mapLayerMode=ecosystem&mapstyle=original", hash, SERIES);
        expect(opened).toMatchObject({ view: "political", series: "modern", zoom: 6 });
        // Ein Hash ohne `view` lässt Legacys Ansicht gelten, die Serie bleibt die des Hashes.
        const bare = "#x=551.625&y=532.969&z=6.00&series=modern";
        const withoutView = openingView(
            parseViewState(bare, SERIES),
            baseView(),
            "?mapLayerMode=ecosystem",
            bare,
            SERIES,
        );
        expect(withoutView).toMatchObject({ view: "landscapes", series: "modern" });
    });

    it("🔴 openingView: ein Hash nur mit Wahl öffnet sie an der Startlage (Betreiber 2026-10-19, `/edit#view=political`)", () => {
        const auf = (hash: string, search = "") =>
            openingView(parseViewState(hash, SERIES), baseView(), search, hash, SERIES);
        expect(auf("#view=political")).toMatchObject({ view: "political", zoom: 5, center: { x: 520, y: 500 } });
        expect(auf("#view=powerlines")).toMatchObject({ view: "powerlines", zoom: 5 });
        expect(auf("#view=landscapes&layer=topographie&topo=hoehenstufen")).toMatchObject({
            view: "landscapes",
            landscape: "topographie",
            topography: "hoehenstufen",
        });
        expect(auf("#view=political&series=original")).toMatchObject({ view: "political", series: "original" });
        // Der Hash geht vor Legacys Parametern; Unbekanntes kostet nur sich selbst.
        expect(auf("#view=political", "?mapLayerMode=ecosystem")).toMatchObject({ view: "political" });
        expect(auf("#view=landschaften&layer=topographie")).toMatchObject({
            view: "standard",
            landscape: "topographie",
        });
        expect(auf("#series=unsinn&view=powerlines")).toMatchObject({ view: "powerlines", series: baseView().series });
    });

    it("🔴 openingView: Old per Link öffnet Besuchern „Nur Karte“ (Betreiber 2026-11-10); nennt der Link eine andere Ansicht, die Vorgabe", () => {
        const NUR_KARTE = ["old"];
        const auf = (hash: string, search = "") =>
            openingView(parseViewState(hash, SERIES_WITH_OLD), baseView(), search, hash, SERIES_WITH_OLD, NUR_KARTE);
        // Ohne Ansicht: „Nur Karte“ auf Old, mit und ohne Ausschnitt, auch Legacys `?mapstyle=old`.
        expect(auf("#series=old")).toMatchObject({ view: "none", series: "old" });
        expect(auf("#x=551.625&y=532.969&z=6.00&series=old")).toMatchObject({ view: "none", series: "old", zoom: 6 });
        expect(auf("", "?mapstyle=old")).toMatchObject({ view: "none", series: "old" });
        // Die Adresse, die die Karte selbst schreibt, öffnet wieder dasselbe.
        expect(auf("#x=551.625&y=532.969&z=6.00&series=old&view=none")).toMatchObject({ view: "none", series: "old" });
        // Eine andere Ansicht gilt, die Serie wird die Vorgabe: Dort stünde jeder Name doppelt.
        expect(auf("#x=551.625&y=532.969&z=6.00&series=old&view=political")).toMatchObject({
            view: "political",
            series: "modern",
        });
        expect(auf("", "?mapLayerMode=deregraphic&mapstyle=old")).toMatchObject({ view: "standard", series: "modern" });
        // Editoren (keine Serie nur unter „Nur Karte“) öffnet Old jede Ansicht.
        const hash = "#x=551.625&y=532.969&z=6.00&series=old&view=political";
        expect(openingView(parseViewState(hash, SERIES_WITH_OLD), baseView(), "", hash, SERIES_WITH_OLD)).toMatchObject(
            {
                view: "political",
                series: "old",
            },
        );
    });

    it("ohne Legacy-Parameter ändert openingView nichts", () => {
        const fallback = baseView();
        expect(openingView(undefined, fallback, "?route=Gareth~Perricum", "", SERIES)).toEqual(fallback);
    });
});

describe("Kurzlink: derselbe Zustand, derselbe Code", () => {
    const payload = (view: SharePayload["view"]): SharePayload => ({
        v: 1,
        waypoints: ["p:547.6:535.5", "p:500.1:500.2"],
        options: {
            optimize: "fastest",
            minimizeTransfers: false,
            enabled: { land: true, river: true, sea: true },
            transports: { land: ROUTE_DEFAULTS.land, river: ROUTE_DEFAULTS.river, sea: ROUTE_DEFAULTS.sea },
            hoursPerDay: 8,
        },
        view,
    });
    const plain = { series: "modern", view: "standard", layer: "alle" } as const;

    it("🔴 ohne Abweichung und mit Vorgabe-Topographie fehlen beide Schlüssel: alte Codes bleiben gültig", () => {
        const old = canonicalSharePayload(payload(plain));
        const explicit = canonicalSharePayload(payload({ ...plain, topo: "hoehenlinien", display: {} }));
        expect(JSON.stringify(explicit)).toBe(JSON.stringify(old));
        expect(old.view).toEqual({ series: "modern", view: "standard", layer: "alle" });
    });

    it("schreibt die Abweichungen in fester Reihenfolge, gleich welche Reihenfolge sie hatten", () => {
        const a = canonicalSharePayload(
            payload({ ...plain, topo: "hoehenstufen", display: { labels: false, paths: false } }),
        );
        const b = canonicalSharePayload(
            payload({ ...plain, topo: "hoehenstufen", display: { paths: false, labels: false } }),
        );
        expect(JSON.stringify(a)).toBe(JSON.stringify(b));
        expect(a.view).toEqual({
            series: "modern",
            view: "standard",
            layer: "alle",
            topo: "hoehenstufen",
            display: { paths: false, labels: false },
        });
    });

    it("das Schema nimmt feste Werte und weist alles andere ab: kein Freitext, keine fremden Schlüssel", () => {
        expect(Value.Check(SharePayload, payload({ ...plain, display: { placeLevel: 0, tileGrid: true } }))).toBe(true);
        for (const display of [
            { placeLevel: 7 },
            { placeLevel: -1 },
            { placeLevel: 1.5 },
            { paths: "ja" },
            { frei: true },
        ]) {
            const invalid = payload({ ...plain, display: display as unknown as ShareDisplay });
            expect(Value.Check(SharePayload, invalid), JSON.stringify(display)).toBe(false);
        }
        expect(Value.Check(SharePayload, payload({ ...plain, topo: "hoehenstufen" }))).toBe(true);
        expect(Value.Check(SharePayload, { ...payload(plain), view: { ...plain, topo: "wolken" } })).toBe(false);
    });

    it("die Abweichung des Kurzlinks ist dieselbe wie die der Adresse", () => {
        const display: MapDisplay = { ...displayDefaults("landscapes"), layers: false, placeLevel: 0, rivers: false };
        const deviation = displayDeviation(ctx("landscapes"), display, false);
        const stored = canonicalSharePayload(payload({ ...plain, view: "landscapes", display: deviation })).view
            .display;
        expect(applyDisplayDeviation(ctx("landscapes", true), stored).display).toEqual(display);
    });
});

describe("Flusslinien in der Standardansicht nur für Editoren (OPS-000117)", () => {
    it("🔴 ein Editor mit Flüssen schreibt nichts, der Besucher öffnet den Link ohne Flüsse", () => {
        const editor = displayDefaults("standard", "alle", true);
        expect(editor.rivers).toBe(true);
        const deviation = displayDeviation(ctx("standard", true), editor, false);
        expect(displayParams(deviation)).toEqual([]);
        expect(applyDisplayDeviation(ctx("standard"), deviation).display.rivers).toBe(false);
    });

    it("schaltet ein Editor sie aus, steht das im Link, und ein Besucher-Link öffnet beim Editor mit Flüssen", () => {
        const editor = displayDefaults("standard", "alle", true);
        expect(displayParams(displayDeviation(ctx("standard", true), { ...editor, rivers: false }, false))).toEqual([
            ["toggleRivers", "0"],
        ]);
        expect(applyDisplayDeviation(ctx("standard", true), {}).display.rivers).toBe(true);
    });
});

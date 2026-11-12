import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { Map as MapLibreMap } from "maplibre-gl";
import {
    DESIGN_CANON,
    MAP_VIEWS,
    WATER_CARTOGRAPHY_LAYER,
    layersOfSelection,
    parsePathChain,
} from "@avesmaps3d/shared";
import { installAreaSelection } from "../src/map/area-selection-input.ts";
import {
    AREA_SELECTION_FILL_LAYER_ID,
    AREA_SELECTION_PATH_LAYER_ID,
    areaFilter,
    buildPathPreviewLayer,
    buildPathPreviewSource,
    PATH_PREVIEW_LAYER_ID,
    PATH_PREVIEW_SOURCE_ID,
    pathSelectionWidth,
    type AreaSelection,
} from "../src/map/area-selection.ts";
import { subjectRefOfArea } from "../src/info-panel/subject-refs.ts";
import { contextOwner, emptyOwner, placeOwner, routeOwner } from "../src/map/interaction/owners.ts";
import { LONG_PRESS_MS } from "../src/map/interaction/long-press.ts";
import { areaLayersInView, INTERACTION_PRIORITY, pathPreviewOutlined } from "../src/map/interaction/priorities.ts";
import { LANDSCAPE_FILL_LAYER_IDS } from "../src/map/landscape-layers.ts";
import {
    buildPathLayers,
    buildPathSource,
    PATH_HIT_LAYER_IDS,
    PATH_SOURCE_ID,
    PATH_SOURCE_LAYER,
} from "../src/map/path-layers.ts";
import { installPathSelection } from "../src/map/path-selection-input.ts";
import { PLACE_MARKER_LAYER_ID } from "../src/map/place-layers.ts";
import { pathPointerHint, pathTypeLabel, type PointerHint } from "../src/map/pointer-hint.ts";
import { ROUTE_HIT_LAYER_ID, ROUTE_HIT_WIDTH } from "../src/map/route-layers.ts";
import { createHarness, feature, mouse, touch, type FakeSourceFeature, type Harness } from "./fake-interaction-map.ts";

/**
 * Wege sind auf der Karte anklickbar (WI-0090, Betreiber 2026-10-06: „wege kann man noch nicht anklicken, kannst du das
 * mal für die standardansicht machen?“).
 *
 * 🔴 **Die eine Regel, die dieser Test festhält: Die Auswahl ist überall gleich; der Unterschied sitzt allein in der
 * Vorschau.** Ein Schild kommt immer, die gestrichelte Umrandung nur dort, wo genau eine Landschaftsebene das Bild trägt.
 *
 * 🪤 Der Fluss ist mit WI-0090 von `area` zu `path` umgezogen - er IST ein Weg. Dass er dabei seine Teilnahmeregel
 * behält (wählbar nur in Topographie und „Alle“, Nachtrag zu WI-0083), steht hier, nicht mehr in `area-view-scope.test.ts`.
 */

const LAND = LANDSCAPE_FILL_LAYER_IDS[0] as string;

/** Ein Weg in seiner unsichtbaren Trefferebene, wie die Kachel ihn trägt. */
const weg = (name: unknown, subtype: string, bach = false): ReturnType<typeof feature> =>
    feature(`path-hit-${subtype.toLowerCase()}${bach ? "-bach" : ""}`, { name, subtype, is_bach: bach });

const strasse = weg("Reichsstraße 2", "Reichsstrasse");
const pfad = weg("Alter Saumpfad", "Pfad");
const fluss = weg("Großer Fluss", "Flussweg");
const bach = weg("Mühlbach", "Flussweg", true);

/**
 * Die Form eines Abschnitts in der Kachel, wie `querySourceFeatures` sie liefert. Ihre Lage (`x`) ist je Abschnitt eine andere: Aus ihr liest
 * der Test, welche Abschnitte die Vorschau trägt (die Linie behält von den Eigenschaften nur die Art, `subtype`).
 */
type Abschnitt = FakeSourceFeature & { geometry: { type: "LineString"; coordinates: [number, number][] } };
const lage = new Map<string, number>();
const linie = (id: string): Abschnitt["geometry"] => {
    const x = lage.get(id) ?? lage.size + 1;
    lage.set(id, x);
    return {
        type: "LineString",
        coordinates: [
            [x, 0],
            [x, 1],
        ],
    };
};
/** Welcher Abschnitt an dieser Lage liegt. */
const abschnittBei = (x: number): string => [...lage].find(([, lageX]) => lageX === x)?.[0] ?? "?";

/**
 * Die Abschnitte in den geladenen Kacheln, je mit ihrer Kennung `public_id`: eine Kette ist mehrere Abschnitte, und derselbe
 * Name mit einer anderen Art gehört dazu (ein Weg ist sein Name, WI-0177 Schritt 2b).
 */
const abschnitt = (id: string, name: string, subtype: string): Abschnitt => ({
    source: PATH_SOURCE_ID,
    sourceLayer: PATH_SOURCE_LAYER,
    id,
    properties: { public_id: id, name, subtype },
    geometry: linie(id),
});
const ABSCHNITTE = [
    abschnitt("s1", "Reichsstraße 2", "Reichsstrasse"),
    abschnitt("s2", "Reichsstraße 2", "Reichsstrasse"),
    abschnitt("s3", "Reichsstraße 2", "Pfad"),
    abschnitt("p1", "Alter Saumpfad", "Pfad"),
    abschnitt("f1", "Großer Fluss", "Flussweg"),
    abschnitt("f2", "Großer Fluss", "Flussweg"),
    abschnitt("b1", "Mühlbach", "Flussweg"),
];

/** Der Filter einer Kette: ihr Name, ohne die Abschnitte, die blank nach ihrer Art heißen (`isInPathChain`). */
const kettenFilter = (name: string): unknown => [
    "all",
    ["==", ["get", "name"], name],
    ["!=", ["get", "subtype"], name],
];

const flaeche = (id: string, size = 10): ReturnType<typeof feature> =>
    feature(LAND, { region_public_id: id, region_type: "wald", name: id, area: size });

let harness: Harness;
let selection: AreaSelection | undefined;
let hints: (PointerHint | undefined)[];
let anchors: ({ x: number; y: number } | undefined)[];
let cleared: number;
let layers: readonly string[] | undefined;
let outlined: boolean;
/** Was die Vorschau-Quelle der Wege zuletzt bekam (`setData`) - das Testdoppel der Karte gibt ihr nur ein leeres Objekt. */
let vorschau: Mock<(daten: unknown) => void>;
/** Markiert der zweite Klick den Abschnitt (Editor, WI-0177 W2b)? Aus: Besucher. */
let editor: boolean;

beforeEach(() => {
    vi.useFakeTimers();
    selection = undefined;
    hints = [];
    anchors = [];
    cleared = 0;
    layers = undefined;
    outlined = false;
    editor = false;
    harness = createHarness();
    for (const id of [...PATH_HIT_LAYER_IDS, PATH_PREVIEW_LAYER_ID, LAND, AREA_SELECTION_FILL_LAYER_ID]) {
        harness.map.layers.add(id);
    }
    harness.map.sources.add(PATH_SOURCE_ID);
    harness.map.sources.add(PATH_PREVIEW_SOURCE_ID);
    vorschau = vorschauQuelle();
    harness.map.sourceFeatures = ABSCHNITTE;
    installPathSelection(harness.map as unknown as MapLibreMap, harness.coordinator, {
        current: () => (selection?.kind === "path" ? selection.id : undefined),
        select: (path, at) => {
            selection = path;
            anchors.push(at);
        },
        hint: (hint) => hints.push(hint),
        outline: () => outlined,
        layers: () => layers,
        abschnitte: () => editor,
        currentSegment: () => (selection?.kind === "path" ? selection.segment : undefined),
    });
    harness.coordinator.register(
        emptyOwner({
            clear: () => {
                cleared += 1;
                selection = undefined;
            },
        }),
    );
});

afterEach(() => {
    harness.coordinator.destroy();
    vi.useRealTimers();
});

const click = (...hits: ReturnType<typeof feature>[]): void => {
    harness.map.hits = hits;
    harness.map.fire("click", mouse(10, 20));
};

const hover = (...hits: ReturnType<typeof feature>[]): void => {
    harness.map.hits = hits;
    harness.map.fire("mousemove", mouse(10, 20));
    harness.flushFrames();
};

/** Die Linien, die die Vorschau-Quelle der Wege zuletzt bekam: je Abschnitt eine, mit der Art als Eigenschaft. */
interface Vorschau {
    features: { properties: Record<string, unknown>; geometry: { coordinates: number[][][] } }[];
}
const gezeigt = (): Vorschau["features"] => (vorschau.mock.lastCall?.[0] as Vorschau | undefined)?.features ?? [];

/**
 * Die Vorschau-Quelle der Wege der Karte: `setData` und `serialize` wie bei MapLibres GeoJSON-Quelle. Nach `replaceSource` (ein neuer Stil) ruft
 * der Test sie für die neue, leere Quelle noch einmal auf.
 */
function vorschauQuelle(): Mock<(daten: unknown) => void> {
    const setData = vi.fn<(daten: unknown) => void>();
    Object.assign(harness.map.getSource(PATH_PREVIEW_SOURCE_ID) as object, {
        setData,
        serialize: () => ({ type: "geojson", data: setData.mock.lastCall?.[0] }),
    });
    return setData;
}

/** Welche Abschnitte gestrichelt werden: die Linien in der Vorschau-Quelle der Wege. */
const outlinedIds = (): string[] => gezeigt().map((entry) => abschnittBei(entry.geometry.coordinates[0]![0]![0]!));

/** Welcher Weg gestrichelt wird: der Name der Kette, deren Abschnitte in der Vorschau stehen; `""` heißt keiner. */
const outlinedName = (): string => {
    const names = new Set(
        outlinedIds().map((id) =>
            String(harness.map.sourceFeatures.find((entry) => entry.id === id)?.properties["name"]),
        ),
    );
    expect(names.size).toBeLessThanOrEqual(1);
    return [...names][0] ?? "";
};

// -----------------------------------------------------------------------------------------------------------------

describe("der Rang des Wegs (WI-0090 § 3.5)", () => {
    it("🔴 45: unter der Kraftlinie, über der Fläche - und jede Zahl der Tafel bleibt eigen", () => {
        const p = INTERACTION_PRIORITY;
        expect(p.path).toBe(45);
        expect(p.powerline).toBeGreaterThan(p.path);
        expect(p.path).toBeGreaterThan(p.area);
        const values = Object.values(p);
        expect(new Set(values).size).toBe(values.length);
    });

    it("🔴 A9: eine Route über einer Straße gewinnt - sie wird ENTLANG der Wege gerechnet", () => {
        harness.map.layers.add(ROUTE_HIT_LAYER_ID);
        const stages: number[] = [];
        harness.coordinator.register(routeOwner({ stale: () => false, selectStage: (stage) => stages.push(stage) }));
        click(strasse, feature(ROUTE_HIT_LAYER_ID, { stage: 3 }));
        expect(stages).toEqual([3]);
        expect(selection).toBeUndefined();
    });

    it("🔴 A8: ein Ort auf einer Straße gewinnt (Legacys Klick-Schiedsrichter: Ort vor Weg)", () => {
        harness.map.layers.add(PLACE_MARKER_LAYER_ID);
        const places: string[] = [];
        harness.coordinator.register(placeOwner({ select: (place) => places.push(place.id) }));
        click(
            strasse,
            feature(
                PLACE_MARKER_LAYER_ID,
                { public_id: "p1", name: "Gareth", subtype: "metropole" },
                { type: "Point", coordinates: [0, 0] },
            ),
        );
        expect(places).toEqual(["p1"]);
        expect(selection).toBeUndefined();
    });

    it("🔴 der Weg gewinnt vor der Fläche unter ihm: Legacys „Ort vor Weg vor Region“", () => {
        let area: AreaSelection | undefined;
        installAreaSelection(harness.map as unknown as MapLibreMap, harness.coordinator, {
            current: () => area,
            select: (chosen) => {
                area = chosen;
            },
            hint: () => undefined,
            choices: () => undefined,
        });
        click(strasse, flaeche("wald-1"));
        expect(selection?.id).toBe("name:Reichsstraße 2");
        expect(area).toBeUndefined();
    });
});

describe("die Trefferfläche (WI-0090 § 3.6): die Lösung der Route, keine zweite Rechnung", () => {
    it("🔴 dieselbe Breite wie die Route, unsichtbar - MapLibre prüft gegen die Breite, nicht die Deckkraft", () => {
        const ebenen = buildPathLayers({ hitWidth: ROUTE_HIT_WIDTH.touch }) as {
            id: string;
            paint: Record<string, unknown>;
        }[];
        const treffer = ebenen.filter((ebene) => ebene.id.startsWith("path-hit-"));
        expect(treffer.length).toBeGreaterThan(0);
        for (const ebene of treffer) {
            expect(ebene.paint["line-opacity"], ebene.id).toBe(0);
            expect(ebene.paint["line-width"], ebene.id).toBe(ROUTE_HIT_WIDTH.touch);
        }
        // Ohne Angabe die des Zeigers - und das ist die Zahl der Route, keine eigene.
        const vorgabe = (buildPathLayers({}) as { id: string; paint: Record<string, unknown> }[]).find((ebene) =>
            ebene.id.startsWith("path-hit-"),
        );
        expect(vorgabe?.paint["line-width"]).toBe(ROUTE_HIT_WIDTH.pointer);
    });

    it("🔴 sie erbt Filter und minzoom der gezeichneten Linie: was nicht gezeichnet ist, ist nicht anklickbar", () => {
        const ebenen = buildPathLayers({}) as { id: string; filter?: unknown; minzoom?: number }[];
        const kern = new Map(
            ebenen.filter((e) => e.id.startsWith("path-center-") && !e.id.endsWith("-tunnel")).map((e) => [e.id, e]),
        );
        const treffer = ebenen.filter((e) => e.id.startsWith("path-hit-"));
        expect(treffer.length).toBe(kern.size);
        // Der Kern steht zweimal, durchgezogen und im Tunnel gestrichelt (WI-0177): Die Trefferfläche deckt beide.
        const imTunnel = ["==", ["get", "is_tunnel"], true];
        for (const ebene of treffer) {
            const zwilling = kern.get(ebene.id.replace("path-hit-", "path-center-"));
            const tunnel = ebenen.find((e) => e.id === `${zwilling?.id ?? ""}-tunnel`);
            expect(zwilling, ebene.id).toBeDefined();
            expect(zwilling?.filter, ebene.id).toEqual(["all", ebene.filter, ["!", imTunnel]]);
            expect(tunnel?.filter, ebene.id).toEqual(["all", ebene.filter, imTunnel]);
            expect(ebene.minzoom, ebene.id).toBe(zwilling?.minzoom);
            expect(ebene.minzoom, ebene.id).toBe(tunnel?.minzoom);
        }
    });

    it("💣 die statische Liste des Besitzers nennt JEDE Trefferebene des Stils", () => {
        // Fehlt eine, wäre ein gezeichneter Weg still nicht anklickbar - der Koordinator fragt nur, was hier steht.
        const imStil = (buildPathLayers({}) as { id: string }[])
            .map((ebene) => ebene.id)
            .filter((id) => id.startsWith("path-hit-"));
        expect([...PATH_HIT_LAYER_IDS].sort()).toEqual([...imStil].sort());
        // Der Seeweg steht auf keiner Karte (`hidden`) und hat deshalb auch keine Trefferebene.
        expect(PATH_HIT_LAYER_IDS).not.toContain("path-hit-seeweg");
    });

    it("🔴 eine ausgeschaltete Wegart hat keine Trefferebene (A2 des Anzeige-Menüs)", () => {
        const ohneWege = (buildPathLayers({ land: false }) as { id: string }[])
            .map((ebene) => ebene.id)
            .filter((id) => id.startsWith("path-hit-"));
        expect(ohneWege).toEqual(["path-hit-flussweg-bach", "path-hit-flussweg"]);
        const ohneFluesse = (buildPathLayers({ rivers: false }) as { id: string }[])
            .map((ebene) => ebene.id)
            .filter((id) => id.startsWith("path-hit-"));
        expect(ohneFluesse).not.toContain("path-hit-flussweg");
        expect(ohneFluesse).toContain("path-hit-reichsstrasse");
    });

    it("🪤 der Besitzer stellt KEINE zweite Frage an die Karte: eine Abfrage je Ereignis", () => {
        harness.map.queries.length = 0;
        hover(strasse);
        expect(harness.map.queries.length).toBe(1);
        harness.map.queries.length = 0;
        click(strasse);
        expect(harness.map.queries.length).toBe(1);
    });
});

describe("§ 2: die Auswahl ist überall gleich, der Unterschied sitzt in der Vorschau", () => {
    it("🔴 gestrichelt in jeder Ansicht außer „Standard“ (WI-0090 O2, Betreiber 2026-10-09: „Kartenfächer auf Standard“)", () => {
        expect(pathPreviewOutlined("standard")).toBe(false);
        for (const view of MAP_VIEWS.filter((entry) => entry !== "standard")) {
            expect(pathPreviewOutlined(view), view).toBe(true);
        }
    });

    it("🔴 A2 und A6: in der ruhigen Ansicht NUR das Schild - Straße wie Fluss", () => {
        outlined = false;
        for (const [was, hit] of [
            ["Straße", strasse],
            ["Fluss", fluss],
        ] as const) {
            hints.length = 0;
            hover(hit);
            expect(hints.at(-1)?.name, was).toBe(hit.properties["name"]);
            expect(harness.map.canvas.style.cursor, was).toBe("pointer");
            // Kein Weg gestrichelt: Die Vorschau-Quelle bekommt keine Linie.
            expect(outlinedName(), was).toBe("");
            expect(vorschau, was).not.toHaveBeenCalled();
        }
    });

    it("🔴 A3 und A7: in einer Landschaftsebene Schild UND Strichelung - Straße wie Fluss", () => {
        outlined = true;
        for (const [was, hit] of [
            ["Straße", strasse],
            ["Fluss", fluss],
        ] as const) {
            hints.length = 0;
            hover(hit);
            expect(hints.at(-1)?.name, was).toBe(hit.properties["name"]);
            expect(outlinedName(), was).toBe(hit.properties["name"]);
        }
    });

    it("🔴 A4: die AUSWAHL kennt die Ansicht nicht - dieselbe Markierung, egal wie die Vorschau aussieht", () => {
        const gewaehlt: AreaSelection[] = [];
        for (const wert of [false, true]) {
            selection = undefined;
            outlined = wert;
            click(strasse);
            if (selection) gewaehlt.push(selection);
        }
        expect(gewaehlt.length).toBe(2);
        expect(gewaehlt[0]).toEqual(gewaehlt[1]);
        // Und die Markierung selbst ist die von WI-0044: Gold, Breite je Wegart.
        expect(pathSelectionWidth("Reichsstrasse")).toBe(DESIGN_CANON.mapSelection.pathWidthByType["Reichsstrasse"]);
    });

    it("💣 Zeigen setzt NIE einen Filter: ein Filterwechsel lädt in MapLibre die ganze Kachelquelle neu (Betreiber 2026-10-09)", () => {
        // Der Fehler: Jeder neue Weg unter dem Zeiger setzte den Filter der Vorschau-Ebene. MapLibre (`Style#setFilter` →
        // `_updateLayer`) lädt dann jede Kachel der Quelle `paths` neu; die Neuladungen stauten sich, und die Strichelung
        // lief Weg für Weg hinter dem Zeiger her. Gemessen am lokalen Stapel: vier Wegwechsel, 43 Kachel-Neuladungen.
        outlined = true;
        for (const hit of [strasse, pfad, fluss, strasse, fluss]) hover(hit);
        expect(harness.map.filters).toEqual([]);
        // Auch kein Feature-State an den Kacheln der Wege: Die Kette steht in der kleinen eigenen Quelle (WI-0266).
        expect(harness.map.stateCalls).toBe(0);
        // Nur der zuletzt gezeigte Weg steht in der Vorschau - mit allen seinen Abschnitten, und keiner der Vorgänger.
        expect(outlinedIds()).toEqual(["f1", "f2"]);
    });

    it("🔴 die ganze Kette, aber nur sie: derselbe Name, über Wegtypen hinweg (WI-0177 Schritt 2b)", () => {
        outlined = true;
        hover(strasse);
        expect(outlinedIds()).toEqual(["s1", "s2", "s3"]);
        // Jede Linie behält ihre Wegart: Der Abstand der zwei Striche hängt an ihr (`buildPathPreviewLayer`).
        expect(gezeigt().map((entry) => entry.properties)).toEqual([
            { subtype: "Reichsstrasse" },
            { subtype: "Reichsstrasse" },
            { subtype: "Pfad" },
        ]);
    });

    it("🪤 derselbe Weg noch einmal fasst die Karte nicht an", () => {
        outlined = true;
        hover(strasse);
        const abfragen = vi.spyOn(harness.map, "querySourceFeatures");
        const gesetzt = vorschau.mock.calls.length;
        hover(strasse);
        expect(abfragen).not.toHaveBeenCalled();
        expect(vorschau).toHaveBeenCalledTimes(gesetzt);
    });

    it("🪤 ein neuer Stil (neue Quelle) bekommt die Kette neu, statt sie für erledigt zu halten", () => {
        outlined = true;
        hover(strasse);
        harness.map.replaceSource(PATH_PREVIEW_SOURCE_ID);
        const neu = vorschauQuelle();
        hover(strasse);
        expect(neu).toHaveBeenCalledTimes(1);
        expect(outlinedIds()).toEqual(["s1", "s2", "s3"]);
    });

    it("🪤 ein neuer Stil bringt die Vorschau-Quelle leer zurück: die gezeigte Kette geht ohne neues Zeigen wieder hinein", () => {
        outlined = true;
        hover(strasse);
        harness.map.replaceSource(PATH_PREVIEW_SOURCE_ID);
        const neu = vorschauQuelle();
        harness.map.fire("styledata", {});
        expect(neu).toHaveBeenCalledTimes(1);
        expect(outlinedIds()).toEqual(["s1", "s2", "s3"]);
        // Ein weiteres `styledata` ändert nichts mehr: Die Quelle trägt die Kette schon.
        harness.map.fire("styledata", {});
        expect(neu).toHaveBeenCalledTimes(1);
    });

    it("🔴 die Vorschau hängt an einer eigenen GeoJSON-Quelle, ohne Filter und ohne Feature-State an den Kacheln der Wege", () => {
        const layer = buildPathPreviewLayer();
        expect(layer).toMatchObject({ id: PATH_PREVIEW_LAYER_ID, type: "line", source: PATH_PREVIEW_SOURCE_ID });
        expect(layer).not.toHaveProperty("source-layer");
        expect(layer).not.toHaveProperty("filter");
        expect(JSON.stringify(layer)).not.toContain("feature-state");
        expect(layer).not.toHaveProperty("paint.line-opacity");
        // Der Abstand der Striche liest die Art, die jede Linie behält.
        expect(JSON.stringify(layer.paint)).toContain('["get","subtype"]');
        expect(buildPathPreviewSource()).toMatchObject({ type: "geojson" });
        expect(PATH_PREVIEW_SOURCE_ID).not.toBe(PATH_SOURCE_ID);
    });

    it("🔴 die Quelle der Wege hebt `public_id` als Kennung je Abschnitt", () => {
        expect(buildPathSource("/tiles/paths/{z}/{x}/{y}")).toMatchObject({
            promoteId: { [PATH_SOURCE_LAYER]: "public_id" },
        });
    });

    it("das Ende des Zeigens nimmt Schild UND Strichelung zurück", () => {
        outlined = true;
        hover(strasse);
        expect(outlinedName()).toBe("Reichsstraße 2");
        harness.map.fire("mouseout", {});
        expect(hints.at(-1)).toBeUndefined();
        expect(outlinedName()).toBe("");
    });
});

describe("das Zeiger-Schild eines Wegs (WI-0090 § 3.7)", () => {
    it("🔴 Name und Wegart, aus denselben Sprachtafeln wie Suche und Planer", () => {
        expect(pathTypeLabel("Reichsstrasse")).toBe("Reichsstraße");
        expect(pathTypeLabel("Strasse")).toBe("Straße");
        expect(pathTypeLabel("Gebirgspass")).toBe("Gebirgspass");
        expect(pathTypeLabel("Wuestenpfad")).toBe("Wüstenpfad");
        // Eine unbekannte Art heißt „Weg“, nie der rohe Schlüssel.
        expect(pathTypeLabel("Hyperschleuse")).toBe("Weg");
        expect(pathTypeLabel("")).toBe("Weg");
    });

    it("🪤 Fluss und Bach behalten ihre gewohnten Wörter, nicht „Flussweg“", () => {
        expect(pathTypeLabel("Flussweg")).toBe("Fluss");
        expect(pathTypeLabel("Flussweg", true)).toBe("Bach");
    });

    it("ohne Namen gibt es kein Schild: ein Lauf „Pfad-17“ hätte nichts zu sagen", () => {
        expect(pathPointerHint({ name: null, type: "Pfad" }, { x: 1, y: 2 })).toBeUndefined();
        expect(pathPointerHint({ name: "   ", type: "Pfad" }, { x: 1, y: 2 })).toBeUndefined();
    });

    it("🔴 das Schild trägt die Art des Bachs, auch wenn er als Flussweg kommt", () => {
        hover(bach);
        expect(hints.at(-1)).toMatchObject({ name: "Mühlbach", type: "Bach" });
    });

    it("🔴 es ist das EINE Schild, ohne Hinweis auf weitere: der Weg hat keine Auswahlliste", () => {
        hover(strasse, pfad);
        expect(hints.at(-1)).toMatchObject({ name: "Reichsstraße 2", type: "Reichsstraße" });
        expect(hints.at(-1)?.note).toBeUndefined();
    });
});

describe("die Öffnungsnaht (WI-0090 § 3.1)", () => {
    it("🔴 der gewählte Weg ist ein Subject: der Kettenschlüssel ergibt einen `path`-Ref", () => {
        click(strasse);
        expect(selection).toMatchObject({ kind: "path", id: "name:Reichsstraße 2", type: "Reichsstrasse" });
        // Genau diese Kette liest `parsePathChain`, und genau daraus baut `subjectRefOfArea` den Ref für `openSubject`.
        expect(parsePathChain(selection?.id ?? "")).toEqual({ name: "Reichsstraße 2" });
        expect(subjectRefOfArea(selection as AreaSelection)).toEqual({
            kind: "path",
            chain: "name:Reichsstraße 2",
        });
    });

    it("🔴 jede Wegart ergibt einen lesbaren Ref - keine fällt still durch", () => {
        // 🪤 Über einen Getter gelesen: Sonst verengt TypeScript `selection` nach der Zuweisung auf `undefined` und
        // sieht nicht, dass `click` sie über den Abschluss setzt.
        const current = (): AreaSelection | undefined => selection;
        for (const art of ["Reichsstrasse", "Strasse", "Weg", "Pfad", "Gebirgspass", "Wuestenpfad", "Flussweg"]) {
            selection = undefined;
            click(weg(`Probe ${art}`, art));
            const gewaehlt = current();
            expect(gewaehlt, art).toBeDefined();
            expect(subjectRefOfArea(gewaehlt as AreaSelection), art).toEqual({
                kind: "path",
                chain: `name:Probe ${art}`,
            });
        }
    });

    it("🔴 der Klickpunkt geht mit: dort verankert das Editor-Menü (WI-0063 P9)", () => {
        click(strasse);
        expect(anchors).toEqual([{ x: 110, y: 120 }]);
    });

    it("🔴 A11 ist umgedreht (WI-0108): der lange Druck öffnet das Kartenmenü, der Tipp wählt den Weg", () => {
        // Jede Wegart trägt am Finger eine 28 px breite Trefferfläche. Hätte der Weg (Rang 45) den langen Druck
        // behalten, wäre das Menü (Rang 20) über jeder Straße und jedem Fluss unerreichbar geblieben.
        const menus: { x: number; y: number }[] = [];
        harness.coordinator.register(contextOwner({ open: (screen) => menus.push(screen) }));
        harness.map.hits = [strasse];
        harness.map.fire("touchstart", touch(10, 20));
        vi.advanceTimersByTime(LONG_PRESS_MS + 10);
        expect(selection).toBeUndefined();
        expect(menus).toEqual([{ x: 110, y: 120 }]);

        // 🪰 Ein eigener Tipp: Den Klick, den der Browser aus dem Loslassen macht, schluckt der Koordinator.
        harness.map.fire("touchend", touch(0, 0));
        harness.map.fire("touchstart", touch(10, 20));
        harness.map.fire("touchend", touch(0, 0));
        harness.map.fire("click", mouse(10, 20));
        expect(selection?.id).toBe("name:Reichsstraße 2");
    });
});

describe("Teilnahme: der Fluss behält seine Regel, die Straße bekommt keine (WI-0083 Nachtrag × WI-0090)", () => {
    for (const selectionName of ["topographie", "alle"] as const) {
        it(`🔴 ${selectionName}: der Fluss ist wählbar`, () => {
            layers = layersOfSelection(selectionName);
            hover(fluss);
            expect(harness.map.canvas.style.cursor).toBe("pointer");
            click(fluss);
            expect(selection?.id).toBe("name:Großer Fluss");
        });
    }

    for (const selectionName of ["vegetation", "derographisch"] as const) {
        it(`🔴 ${selectionName}: der Fluss nimmt nicht teil, die STRASSE schon`, () => {
            layers = layersOfSelection(selectionName);
            hover(fluss);
            expect(hints.at(-1)).toBeUndefined();
            expect(harness.map.canvas.style.cursor).toBe("");
            click(fluss);
            expect(selection).toBeUndefined();
            expect(cleared).toBe(1);
            // Eine Straße trägt keine Landschaftsebene: Sie nimmt hier teil wie überall, wo sie gezeichnet ist.
            click(strasse);
            expect(selection?.id).toBe("name:Reichsstraße 2");
        });
    }

    it("🔴 ein Bach folgt dem Fluss: er ist dasselbe Wasser", () => {
        layers = layersOfSelection("vegetation");
        click(bach);
        expect(selection).toBeUndefined();
        layers = layersOfSelection("topographie");
        click(bach);
        expect(selection?.id).toBe("name:Mühlbach");
    });

    it("🪤 die Ebene kommt aus der Tafel, nicht aus einer Frage im Besitzer", () => {
        expect(areaLayersInView("landscapes", "topographie")).toContain(WATER_CARTOGRAPHY_LAYER);
        expect(areaLayersInView("landscapes", "vegetation")).not.toContain(WATER_CARTOGRAPHY_LAYER);
        expect(areaLayersInView("standard", "alle")).toBeUndefined();
    });

    it("🔴 ein ausgeschlossener Fluss fällt durch auf die Fläche darunter", () => {
        layers = layersOfSelection("vegetation");
        let area: AreaSelection | undefined;
        installAreaSelection(harness.map as unknown as MapLibreMap, harness.coordinator, {
            current: () => area,
            select: (chosen) => {
                area = chosen;
            },
            hint: () => undefined,
            choices: () => undefined,
            areaLayers: () => layers,
        });
        click(fluss, flaeche("wald-1"));
        expect(selection).toBeUndefined();
        expect(area?.id).toBe("wald-1");
    });
});

describe("Durchklicken (WI-0043 Stufe 2 B), auch über die Besitzergrenze", () => {
    it("🔴 mehrere Wege an einer Kreuzung: der zweite Klick nimmt den nächsten", () => {
        click(strasse, pfad);
        expect(selection?.id).toBe("name:Reichsstraße 2");
        click(strasse, pfad);
        expect(selection?.id).toBe("name:Alter Saumpfad");
        click(strasse, pfad);
        expect(selection?.id).toBe("name:Reichsstraße 2");
    });

    it("🔴 liegt nur der gewählte Weg hier, gehört der Klick dem, was darunter liegt", () => {
        let area: AreaSelection | undefined;
        installAreaSelection(harness.map as unknown as MapLibreMap, harness.coordinator, {
            current: () => area,
            select: (chosen) => {
                area = chosen;
            },
            hint: () => undefined,
            choices: () => undefined,
        });
        click(fluss, flaeche("tal-1"));
        expect(selection?.id).toBe("name:Großer Fluss");
        // Zweiter Klick an derselben Stelle: Der Weg tritt zurück, die Fläche kommt dran - wie vor WI-0090.
        click(fluss, flaeche("tal-1"));
        expect(area?.id).toBe("tal-1");
    });

    it("🔴 A13: ein Klick in die freie Karte beendet die Auswahl wie bisher", () => {
        click(strasse);
        expect(selection?.id).toBe("name:Reichsstraße 2");
        click();
        expect(selection).toBeUndefined();
        expect(cleared).toBe(1);
    });

    it("🪤 der Klick auf die goldene Linie allein löscht die Auswahl NICHT", () => {
        // Der Weg tritt zurück (nur der gewählte liegt hier); die Auswahl-Ebene hält den Klick beim Besitzer `area`.
        harness.map.layers.add(AREA_SELECTION_PATH_LAYER_ID);
        installAreaSelection(harness.map as unknown as MapLibreMap, harness.coordinator, {
            current: () => undefined,
            select: () => undefined,
            hint: () => undefined,
            choices: () => undefined,
        });
        click(strasse);
        expect(selection?.id).toBe("name:Reichsstraße 2");
        click(strasse, feature(AREA_SELECTION_PATH_LAYER_ID, {}));
        expect(selection?.id).toBe("name:Reichsstraße 2");
        expect(cleared).toBe(0);
    });
});

describe("der zweite Klick markiert im Editor den Abschnitt (WI-0177 W2b, EDIT-0003 T24 (1))", () => {
    /** Ein Abschnitt der Reichsstraße in seiner Trefferebene, mit seiner Kennung wie die Kachel. */
    const teil = (id: string): ReturnType<typeof feature> =>
        feature("path-hit-reichsstrasse", {
            name: "Reichsstraße 2",
            subtype: "Reichsstrasse",
            is_bach: false,
            public_id: id,
        });

    it("🔴 erst die ganze Straße, dann der Abschnitt unter dem Zeiger, ein anderer Abschnitt, derselbe noch einmal wieder die Straße", () => {
        editor = true;
        click(teil("s1"));
        expect(selection).toMatchObject({ id: "name:Reichsstraße 2" });
        expect(selection?.segment).toBeUndefined();
        click(teil("s1"));
        expect(selection).toMatchObject({ id: "name:Reichsstraße 2", segment: "s1" });
        click(teil("s2"));
        expect(selection?.segment).toBe("s2");
        click(teil("s2"));
        expect(selection?.segment).toBeUndefined();
        // Der Ref des Infopanels bleibt die Straße: Ein Weg ist dort die Gruppe seiner Abschnitte.
        expect(subjectRefOfArea(selection as AreaSelection)).toEqual({
            kind: "path",
            chain: "name:Reichsstraße 2",
        });
    });

    it("🔴 Besucher: Der zweite Klick fällt wie bisher durch auf das, was darunter liegt", () => {
        click(teil("s1"));
        click(teil("s1"));
        expect(selection).toBeUndefined();
        expect(cleared).toBe(1);
    });

    it("🔴 ein markierter Abschnitt leuchtet allein, über seine Kennung", () => {
        const kette: AreaSelection = {
            kind: "path",
            id: "name:Reichsstraße 2",
            name: "Reichsstraße 2",
            type: "Reichsstrasse",
            anchor: { x: 0, y: 0 },
        };
        expect(areaFilter({ ...kette, segment: "s2" })).toEqual(["==", ["get", "public_id"], "s2"]);
        expect(areaFilter(kette)).toEqual(kettenFilter("Reichsstraße 2"));
    });
});

describe("Ein Weg ist sein Name (WI-0177 Schritt 2b): EINE Kette über Wegtypen und Kennzeichen hinweg", () => {
    const ROUTE = "Keft–Rashdul";
    /** Ein Abschnitt der Route in seiner Trefferebene, mit Kennzeichen wie die Kachel. */
    const route = (id: string, subtype: string): ReturnType<typeof feature> =>
        feature(`path-hit-${subtype.toLowerCase()}`, {
            name: ROUTE,
            subtype,
            is_bach: false,
            public_id: id,
            mark: "karawanenroute",
        });
    const kachel = (id: string, subtype: string, mark?: string): Abschnitt => ({
        source: PATH_SOURCE_ID,
        sourceLayer: PATH_SOURCE_LAYER,
        id,
        properties: { public_id: id, name: ROUTE, subtype, ...(mark === undefined ? {} : { mark }) },
        geometry: linie(id),
    });

    beforeEach(() => {
        harness.map.sourceFeatures = [
            ...ABSCHNITTE,
            kachel("k1", "Pfad", "karawanenroute"),
            kachel("k2", "Wuestenpfad", "karawanenroute"),
            // Gleicher Name ohne Kennzeichen: gehört dazu (wie in der Wegeliste).
            kachel("k3", "Pfad"),
        ];
    });

    it("🔴 Zeigen strichelt den ganzen Weg über seine Wegtypen, auch den gleichnamigen Abschnitt ohne Kennzeichen", () => {
        outlined = true;
        hover(route("k1", "Pfad"));
        expect(outlinedIds().sort()).toEqual(["k1", "k2", "k3"]);
    });

    it("🔴 zwei Wegtypen desselben Wegs unter dem Zeiger sind EIN Kandidat; die Auswahl leuchtet über den Namen", () => {
        click(route("k1", "Pfad"), route("k2", "Wuestenpfad"));
        expect(selection).toMatchObject({ id: `name:${ROUTE}`, type: "Pfad" });
        expect(selection).not.toHaveProperty("mark");
        expect(areaFilter(selection as AreaSelection)).toEqual(kettenFilter(ROUTE));
    });

    it("🔴 im Editor markiert ein Klick auf einen anderen Wegtyp der gewählten Route den Abschnitt; die Kennung der Route bleibt", () => {
        editor = true;
        click(route("k1", "Pfad"));
        click(route("k2", "Wuestenpfad"));
        expect(selection).toMatchObject({ id: `name:${ROUTE}`, segment: "k2" });
        click(route("k2", "Wuestenpfad"));
        expect(selection?.segment).toBeUndefined();
        expect(selection?.id).toBe(`name:${ROUTE}`);
    });

    it("Besucher: ein Klick auf den anderen Wegtyp der gewählten Route fällt durch wie auf dieselbe Kette", () => {
        click(route("k1", "Pfad"));
        click(route("k2", "Wuestenpfad"));
        expect(selection).toBeUndefined();
        expect(cleared).toBe(1);
    });
});

describe("Ein Griff ist kein Name (Betreiber 2026-11-09: „Unbezeichneter Weg“, Gold bei Angbar, Gareth und Caldaia zugleich)", () => {
    /** Ein Abschnitt in seiner Trefferebene, mit seiner Kennung wie die Kachel. */
    const treffer = (id: string, name: string, subtype: string): ReturnType<typeof feature> =>
        feature(`path-hit-${subtype.toLowerCase()}`, { name, subtype, is_bach: false, public_id: id });

    beforeEach(() => {
        harness.map.sourceFeatures = [
            ...ABSCHNITTE,
            // Drei Wege, die blank nach ihrer Art heißen, weit auseinander - und ein Pfad, der wirklich „Weg“ heißt.
            abschnitt("w1", "Weg", "Weg"),
            abschnitt("w2", "Weg", "Weg"),
            abschnitt("w3", "Weg", "Weg"),
            abschnitt("pw", "Weg", "Pfad"),
            abschnitt("g1", "Pfad-3443", "Pfad"),
        ];
    });

    it("🔴 ein Klick auf einen „Weg“ wählt nur diesen Abschnitt: Gold, Ref und Kennung nennen ihn, keinen anderen", () => {
        click(treffer("w2", "Weg", "Weg"));
        expect(selection).toMatchObject({ kind: "path", id: "#w2", name: "Weg", type: "Weg" });
        expect(areaFilter(selection as AreaSelection)).toEqual(["==", ["get", "public_id"], "w2"]);
        // Der Server löst den Abschnitt auf (sein Artikel oder er allein), nicht eine Kette, die alle „Weg“ der Karte meint.
        expect(subjectRefOfArea(selection as AreaSelection)).toEqual({ kind: "path", anchor: "w2" });
    });

    it("🔴 ein zweiter „Weg“ anderswo ist ein anderer Weg: Er wird gewählt, statt durchzufallen", () => {
        click(treffer("w1", "Weg", "Weg"));
        click(treffer("w3", "Weg", "Weg"));
        expect(selection?.id).toBe("#w3");
        expect(cleared).toBe(0);
    });

    it("🔴 Zeigen strichelt nur den Abschnitt unter dem Zeiger", () => {
        outlined = true;
        hover(treffer("w1", "Weg", "Weg"));
        expect(outlinedIds()).toEqual(["w1"]);
        hover(treffer("g1", "Pfad-3443", "Pfad"));
        expect(outlinedIds()).toEqual(["g1"]);
    });

    it("🪤 ein Pfad, der „Weg“ heißt, bleibt eine Kette - ohne die namenlosen „Weg“ der Karte", () => {
        outlined = true;
        hover(treffer("pw", "Weg", "Pfad"));
        expect(outlinedIds()).toEqual(["pw"]);
        click(treffer("pw", "Weg", "Pfad"));
        expect(selection?.id).toBe("name:Weg");
        expect(subjectRefOfArea(selection as AreaSelection)).toEqual({ kind: "path", chain: "name:Weg" });
    });

    it("🔴 an einer Kreuzung zweier namenloser Wege stehen zwei Kandidaten, kein gemeinsamer", () => {
        click(treffer("w1", "Weg", "Weg"), treffer("w2", "Weg", "Weg"));
        expect(selection?.id).toBe("#w1");
        // Derselbe Punkt noch einmal: der zweite (Durchklicken, WI-0043 Stufe 2).
        click(treffer("w1", "Weg", "Weg"), treffer("w2", "Weg", "Weg"));
        expect(selection?.id).toBe("#w2");
    });

    it("🔴 im Editor markiert der zweite Klick denselben Abschnitt, der Weg bleibt er selbst", () => {
        editor = true;
        click(treffer("w1", "Weg", "Weg"));
        click(treffer("w1", "Weg", "Weg"));
        expect(selection).toMatchObject({ id: "#w1", segment: "w1" });
        expect(areaFilter(selection as AreaSelection)).toEqual(["==", ["get", "public_id"], "w1"]);
    });
});

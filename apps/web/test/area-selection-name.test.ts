import { describe, expect, it, vi } from "vitest";
import type { Map as MapLibreMap } from "maplibre-gl";
import { installAreaSelectionName } from "../src/map/area-selection-name.ts";
import { AREA_SELECTION_LABEL_SOURCE_ID, type DrawnArea } from "../src/map/area-selection.ts";
import {
    LANDSCAPE_NAME_LAYER_IDS,
    LANDSCAPE_RUN_SOURCE_ID,
    LANDSCAPE_SOURCE_ID,
    MAP_LABEL_SOURCE_ID,
} from "../src/map/landscape-layers.ts";

/**
 * Wann der Name einer gewählten Fläche VERSETZT auftritt (WI-0093).
 *
 * 🔴 Betreiber 2026-10-06 aus dem Nutzertest: „wenn der der text schon voll sichtbar/lesbar ist, braucht er
 * keine verschiebung erfahren (das ist nur praktisch für flächen, wo man nur zu nah dran ist)".
 *
 * 🪤 Geprüft wird die WIRKUNG an einer Kartenattrappe: welche Ereignisse messen, was die Quelle danach trägt.
 * Dass MapLibres `queryRenderedFeatures` nur PLATZIERTE Symbole liefert, ist seine Zusicherung und wird im
 * Browser belegt (`e2e/area-selection.spec.ts`), nicht hier nachgebaut.
 */

const WEIDEN: DrawnArea = {
    kind: "landscape",
    id: "region-weiden",
    name: "Weiden",
    type: "",
    anchor: { x: 480, y: 330 },
    label: "Weiden",
};

interface Feature {
    properties: Record<string, unknown>;
}

function mapDouble(options: { layers?: string[]; areaTiles?: Feature[] } = {}) {
    const listeners = new Map<string, ((event: never) => void)[]>();
    const layers = new Set(options.layers ?? [...LANDSCAPE_NAME_LAYER_IDS]);
    const setData = vi.fn();
    /** Was die Karte gerade ZEICHNET, je Abfrage gesetzt. */
    let rendered: Feature[] = [];
    /** Was in den geladenen Kacheln steht - auch das Verworfene. */
    let inTiles: Feature[] = [];
    const queries: unknown[] = [];
    const map = {
        getLayer: (id: string) => (layers.has(id) ? {} : undefined),
        getSource: (id: string) =>
            id === AREA_SELECTION_LABEL_SOURCE_ID
                ? { setData }
                : id === MAP_LABEL_SOURCE_ID ||
                    id === LANDSCAPE_RUN_SOURCE_ID ||
                    (id === LANDSCAPE_SOURCE_ID && options.areaTiles !== undefined)
                  ? {}
                  : undefined,
        queryRenderedFeatures: vi.fn((parameters: unknown) => {
            queries.push(parameters);
            return rendered;
        }),
        // Die Flächenkacheln (WI-0135) mit dem Namensfilter, den `area-selection-name.ts` stellt: `["==", ["get", "name"], …]`.
        querySourceFeatures: (source: string, parameters?: { filter?: unknown[] }) =>
            source === LANDSCAPE_SOURCE_ID
                ? (options.areaTiles ?? []).filter(
                      (feature) => feature.properties["name"] === (parameters?.filter?.[2] as string | undefined),
                  )
                : inTiles,
        triggerRepaint: vi.fn(),
        on: (event: string, handler: (event: never) => void) => {
            listeners.set(event, [...(listeners.get(event) ?? []), handler]);
        },
        off: (event: string, handler: (event: never) => void) => {
            listeners.set(
                event,
                (listeners.get(event) ?? []).filter((entry) => entry !== handler),
            );
        },
    };
    const fire = (event: string, payload: unknown = {}): void => {
        for (const handler of [...(listeners.get(event) ?? [])]) handler(payload as never);
    };
    /** Ein gesetztes Bild: das Ereignis, der zusätzliche Frame und das `idle`, bei dem gemessen wird. */
    const settle = (): void => {
        fire("idle");
        fire("idle");
    };
    return {
        map: map as unknown as MapLibreMap,
        api: map,
        setData,
        fire,
        settle,
        queries,
        draws: (features: Feature[]) => {
            rendered = features;
        },
        tiles: (features: Feature[]) => {
            inTiles = features;
        },
        /** Was die Quelle zuletzt bekommen hat. */
        last: () =>
            setData.mock.calls.at(-1)?.[0] as { features: { properties: Record<string, unknown> }[] } | undefined,
    };
}

const name = (region: string, size = 18, type = "region"): Feature => ({
    properties: { region_public_id: region, label_size: size, label_type: type },
});

describe("Der Ersatzname tritt nur an, wo der gewöhnliche fehlt (WI-0093 P2)", () => {
    it("🔴 steht der gewöhnliche Name im Bild, bleibt die Quelle leer", () => {
        const double = mapDouble();
        installAreaSelectionName(double.map, { area: () => WEIDEN });
        double.draws([name(WEIDEN.id)]);
        double.settle();
        expect(double.last()?.features).toEqual([]);
    });

    it("🔴 fehlt er, tritt der Ersatz an seine Stelle - mit der Form, die die Karte zuletzt zeigte", () => {
        const double = mapDouble();
        installAreaSelectionName(double.map, { area: () => WEIDEN });
        // Erst sichtbar: dabei lernt die Karte Größe und Art der Beschriftung.
        double.draws([name(WEIDEN.id, 24, "gebirge")]);
        double.settle();
        // Dann hineingezoomt, bis sein Band endet.
        double.draws([]);
        double.fire("moveend");
        double.settle();
        expect(double.last()?.features[0]?.properties).toMatchObject({
            name: "Weiden",
            label_size: 24,
            label_type: "gebirge",
        });
    });

    it("🔴 und verschwindet wieder, sobald der gewöhnliche zurückkommt", () => {
        const double = mapDouble();
        installAreaSelectionName(double.map, { area: () => WEIDEN });
        double.draws([]);
        double.settle();
        expect(double.last()?.features).toHaveLength(1);
        double.draws([name(WEIDEN.id)]);
        double.fire("moveend");
        double.settle();
        expect(double.last()?.features).toEqual([]);
    });

    it("🪤 ein fremder Name im Bild zählt nicht - gefragt wird nach DIESER Region", () => {
        const double = mapDouble();
        installAreaSelectionName(double.map, { area: () => WEIDEN });
        double.draws([name("andere-region")]);
        double.settle();
        expect(double.last()?.features).toHaveLength(1);
    });

    it("🔴 eine Gruppe gleichnamiger Regionen zählt ganz: ein Teil im Bild genügt (WI-0047)", () => {
        const gruppe: DrawnArea = { ...WEIDEN, group: [WEIDEN.id, "zweite-region"] };
        const double = mapDouble();
        installAreaSelectionName(double.map, { area: () => gruppe });
        double.draws([name("zweite-region")]);
        double.settle();
        expect(double.last()?.features).toEqual([]);
    });

    it("🔴 ohne Namensebenen im Stil gibt es nichts zu finden - dann tritt der Ersatz an", () => {
        const double = mapDouble({ layers: [] });
        installAreaSelectionName(double.map, { area: () => WEIDEN });
        double.settle();
        // 🪤 Und zwar OHNE eine Abfrage: Ohne Ebene hätte MapLibre nichts zu durchsuchen.
        expect(double.api.queryRenderedFeatures).not.toHaveBeenCalled();
        expect(double.last()?.features).toHaveLength(1);
    });

    it("🪤 hat die Karte den Namen nie gezeigt, kommt die Form aus den geladenen Kacheln", () => {
        const double = mapDouble();
        double.tiles([name(WEIDEN.id, 15, "insel")]);
        installAreaSelectionName(double.map, { area: () => WEIDEN });
        double.draws([]);
        double.settle();
        expect(double.last()?.features[0]?.properties).toMatchObject({ label_size: 15, label_type: "insel" });
    });

    it("ohne Auswahl, bei einem Weg und bei einem Gebiet bleibt die Quelle leer, und niemand fragt die Karte", () => {
        for (const area of [
            undefined,
            { ...WEIDEN, kind: "path" as const },
            { ...WEIDEN, kind: "territory" as const },
        ]) {
            const double = mapDouble();
            installAreaSelectionName(double.map, { area: () => area });
            double.settle();
            expect(double.api.queryRenderedFeatures).not.toHaveBeenCalled();
            expect(double.last()?.features ?? []).toEqual([]);
        }
    });

    it("🔴 ein gewähltes Gebiet bekommt KEINEN zweiten Namen (WI-0121 Nachtrag): Sein Name steht in der Ebene der Gebietsnamen und wird dort gelb", () => {
        const gebiet: DrawnArea = {
            kind: "territory",
            id: "gebiet-1",
            name: "Baronie Eins",
            type: "Baronie",
            anchor: { x: 1, y: 2 },
            label: "Baronie Eins",
        };
        const double = mapDouble();
        installAreaSelectionName(double.map, { area: () => gebiet });
        // 💣 Weder nach dem Stilumbau noch nach der Messung steht ein Punkt in der Quelle.
        double.fire("styledata");
        expect(double.last()?.features ?? []).toEqual([]);
        double.settle();
        expect(double.last()?.features ?? []).toEqual([]);
        expect(double.api.queryRenderedFeatures).not.toHaveBeenCalled();
    });
});

describe("Die Entscheidung fällt laufend neu, nicht beim Klick (WI-0093 AC4)", () => {
    it("🔴 jedes Verschieben und jeder Kachelnachschub misst neu", () => {
        const double = mapDouble();
        installAreaSelectionName(double.map, { area: () => WEIDEN });
        double.draws([name(WEIDEN.id)]);
        double.settle();
        const nachErstem = double.api.queryRenderedFeatures.mock.calls.length;
        for (const [event, payload] of [
            ["moveend", {}],
            ["styledata", {}],
            ["sourcedata", { sourceId: MAP_LABEL_SOURCE_ID }],
        ] as const) {
            double.fire(event, payload);
            double.settle();
        }
        expect(double.api.queryRenderedFeatures.mock.calls.length).toBe(nachErstem + 3);
    });

    it("💣 gemessen wird einen Frame NACH `idle` - das Bild bei `idle` ist nicht immer das letzte", () => {
        const double = mapDouble();
        installAreaSelectionName(double.map, { area: () => WEIDEN });
        double.fire("moveend");
        // Das erste `idle` zeichnet nur noch einmal; gefragt wird beim zweiten.
        double.fire("idle");
        expect(double.api.triggerRepaint).toHaveBeenCalledTimes(1);
        expect(double.api.queryRenderedFeatures).not.toHaveBeenCalled();
        double.fire("idle");
        expect(double.api.queryRenderedFeatures).toHaveBeenCalledTimes(1);
    });

    it("🪤 die eigene Quelle löst keinen weiteren Frame aus, sonst liefe die Messung im Kreis", () => {
        const double = mapDouble();
        installAreaSelectionName(double.map, { area: () => WEIDEN });
        double.draws([name(WEIDEN.id)]);
        double.settle();
        double.api.triggerRepaint.mockClear();
        double.fire("sourcedata", { sourceId: AREA_SELECTION_LABEL_SOURCE_ID });
        double.fire("idle");
        expect(double.api.triggerRepaint).not.toHaveBeenCalled();
    });

    it("🔴 gefragt wird nur über die beiden Namensebenen", () => {
        const double = mapDouble();
        installAreaSelectionName(double.map, { area: () => WEIDEN });
        double.settle();
        expect(double.queries).toEqual([{ layers: [...LANDSCAPE_NAME_LAYER_IDS] }]);
    });

    it("abgemeldet hört sie auf zu messen", () => {
        const double = mapDouble();
        const name = installAreaSelectionName(double.map, { area: () => WEIDEN });
        name.remove();
        double.settle();
        expect(double.api.queryRenderedFeatures).not.toHaveBeenCalled();
    });
});

describe("Die Art als zweite Zeile am Ersatznamen (WI-0135)", () => {
    /**
     * Betreiber 2026-10-11 mit Bild: die gewählte Tiefebene „Große Öde“ hat keinen eigenen Kartennamen, ihr Ersatzname stand
     * gold neben dem Namen der gleichnamigen Steppe. Ob eine zweite gleichnamige Fläche daneben liegt, liest die Auswahl aus den
     * geladenen Flächenkacheln; ob die Zeile erscheint, entscheidet der Stil (nur in „Alle“).
     */
    const TIEFEBENE: DrawnArea = {
        kind: "landscape",
        id: "oede-tief",
        name: "Große Öde",
        type: "tiefebene",
        anchor: { x: 508, y: 692 },
        label: "Große Öde",
    };
    const flaeche = (region: string, layer: string, name = "Große Öde"): Feature => ({
        properties: { region_public_id: region, region_layer: layer, name },
    });
    const zeile = (areaTiles: Feature[]): unknown => {
        const double = mapDouble({ areaTiles });
        installAreaSelectionName(double.map, { area: () => TIEFEBENE });
        double.settle();
        return double.last()?.features[0]?.properties["type_line"];
    };

    it("🔴 liegt eine gleichnamige Steppe daneben, trägt der Ersatzname „Tiefebene“", () => {
        expect(zeile([flaeche("oede-tief", "topographie"), flaeche("oede-steppe", "vegetation")])).toBe("Tiefebene");
    });

    it("ohne gleichnamige zweite Fläche keine Zeile", () => {
        expect(zeile([flaeche("oede-tief", "topographie")])).toBeUndefined();
    });

    it("🪤 ein gleichnamiger Name der Derographie zählt nicht (Betreiber: „nur bei vegetation und topographie“)", () => {
        expect(zeile([flaeche("oede-tief", "topographie"), flaeche("svelltland", "derographisch")])).toBeUndefined();
    });

    it("🪤 liegt die gewählte Fläche selbst in der Derographie, bekommt sie keine Zeile", () => {
        expect(zeile([flaeche("oede-tief", "derographisch"), flaeche("oede-steppe", "vegetation")])).toBeUndefined();
    });

    it("ohne geladene Flächenkacheln keine Zeile, und kein Fehler", () => {
        const double = mapDouble();
        installAreaSelectionName(double.map, { area: () => TIEFEBENE });
        double.settle();
        expect(double.last()?.features[0]?.properties["type_line"]).toBeUndefined();
    });
});

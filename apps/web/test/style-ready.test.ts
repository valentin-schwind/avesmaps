import { describe, expect, it, vi } from "vitest";
import { FLIGHT_ARCS_LAYER_ID, installFlightArcs } from "../src/map/flight-arcs";
import { EMPTY_ROUTE_LAYER, ROUTE_HIT_LAYER_ID } from "../src/map/route-layers";
import { installRoutePills, ROUTE_PILLS_LAYER_ID } from "../src/map/route-pills";
import { registerRuntimeImages, RUNTIME_IMAGES } from "../src/map/runtime-images";
import { onStyleData, styleTakesChanges, whenStyleTakesChanges } from "../src/map/style-ready";
import { installTravelerLayer, ROUTE_TRAVELER_LAYER_ID } from "../src/map/traveler-layer";

/**
 * Eine Karte, die sich beim Laden des Stils verhält wie MapLibre 6 (`Style._checkLoaded`, `_afterImageUpdated`):
 * Ebenen nimmt sie erst an, wenn der Stil geladen ist, ein Bild jederzeit - und meldet es danach mit `styledata`, auch
 * an einen Stil, der noch lädt. `isStyleLoaded()` sagt durchgehend „nein“: Kacheln laden noch.
 */
interface FalscheKarte {
    style: { _loaded: boolean };
    ebenen: string[];
    bilder: Set<string>;
    handler: Map<string, Set<() => void>>;
    on(ereignis: string, handler: () => void): void;
    off(ereignis: string, handler: () => void): void;
    feuere(ereignis: string): void;
    isStyleLoaded(): boolean;
    getLayer(id: string): { id: string } | undefined;
    getLayersOrder(): string[];
    addLayer(layer: { id: string }, before?: string): void;
    moveLayer(id: string, before?: string): void;
    removeLayer(id: string): void;
    hasImage(id: string): boolean;
    addImage(id: string): void;
    getPitch(): number;
    getTerrain(): null;
    getGlobalState(): Record<string, unknown>;
    setGlobalStateProperty(name: string, wert: unknown): void;
    triggerRepaint(): void;
}

function pruefeGeladen(karte: FalscheKarte): void {
    if (!karte.style._loaded) throw new Error("Style is not done loading.");
}

function falscheKarte(geladen: boolean): FalscheKarte {
    const zustand: Record<string, unknown> = {};
    const karte: FalscheKarte = {
        style: { _loaded: geladen },
        ebenen: [],
        bilder: new Set(),
        handler: new Map(),
        on: (ereignis, handler) => {
            karte.handler.set(ereignis, (karte.handler.get(ereignis) ?? new Set()).add(handler));
        },
        off: (ereignis, handler) => {
            karte.handler.get(ereignis)?.delete(handler);
        },
        feuere: (ereignis) => {
            for (const handler of [...(karte.handler.get(ereignis) ?? [])]) handler();
        },
        isStyleLoaded: () => false,
        getLayer: (id) => (karte.ebenen.includes(id) ? { id } : undefined),
        getLayersOrder: () => [...karte.ebenen],
        addLayer: (layer, before) => {
            pruefeGeladen(karte);
            const an = before === undefined ? -1 : karte.ebenen.indexOf(before);
            karte.ebenen.splice(an < 0 ? karte.ebenen.length : an, 0, layer.id);
        },
        moveLayer: (id, before) => {
            pruefeGeladen(karte);
            karte.ebenen = karte.ebenen.filter((ebene) => ebene !== id);
            const an = before === undefined ? -1 : karte.ebenen.indexOf(before);
            karte.ebenen.splice(an < 0 ? karte.ebenen.length : an, 0, id);
        },
        removeLayer: (id) => {
            pruefeGeladen(karte);
            karte.ebenen = karte.ebenen.filter((ebene) => ebene !== id);
        },
        hasImage: (id) => karte.bilder.has(id),
        addImage: (id) => {
            karte.bilder.add(id);
            karte.feuere("styledata");
        },
        getPitch: () => 0,
        getTerrain: () => null,
        getGlobalState: () => zustand,
        setGlobalStateProperty: (name, wert) => {
            pruefeGeladen(karte);
            zustand[name] = wert;
        },
        triggerRepaint: () => undefined,
    };
    return karte;
}

/** Das Ende des Ladens: Der Stil bringt seine Ebenen mit und feuert selbst `styledata` (`Style._load`). */
function stilGeladen(karte: FalscheKarte, ebenen: string[] = []): void {
    karte.style._loaded = true;
    karte.ebenen = [...ebenen];
    karte.feuere("styledata");
}

const kleinesBild = (): ImageData => ({ width: 1, height: 1 }) as ImageData;

describe("Ebenen erst, wenn der Stil sie annimmt (style-ready.ts)", () => {
    it("🔴 ein Bild, das ein ladender Stil mit `styledata` meldet, wirft nicht; die Ebene der Reisenden kommt mit dem Ende des Ladens", () => {
        const karte = falscheKarte(false);
        installTravelerLayer(karte as never, () => null);
        // Der Befund vom 2026-10-04: `addImage` → `styledata` → `addLayer` warf „Style is not done loading“.
        for (const [id] of RUNTIME_IMAGES) expect(() => karte.addImage(id)).not.toThrow();
        expect(karte.ebenen).toEqual([]);
        stilGeladen(karte, ["orte"]);
        expect(karte.ebenen).toEqual(["orte", ROUTE_TRAVELER_LAYER_ID]);
    });

    it("🔴 keine Ebene, die nach `styledata` angelegt wird, wirft in einen ladenden Stil: Reisende, Pillen, Flugbögen", () => {
        const karte = falscheKarte(false);
        installTravelerLayer(karte as never, () => null);
        installRoutePills(karte as never, () => EMPTY_ROUTE_LAYER);
        installFlightArcs(karte as never, () => EMPTY_ROUTE_LAYER);
        // Ein Neubau vor dem ersten Laden: Der neue Stil kennt schon die Ebenen des Planers nicht mehr.
        expect(() => karte.feuere("styledata")).not.toThrow();
        expect(karte.ebenen).toEqual([]);
        stilGeladen(karte, [ROUTE_HIT_LAYER_ID, "orte"]);
        expect(karte.ebenen).toEqual([
            ROUTE_HIT_LAYER_ID,
            ROUTE_PILLS_LAYER_ID,
            FLIGHT_ARCS_LAYER_ID,
            "orte",
            ROUTE_TRAVELER_LAYER_ID,
        ]);
    });

    it("ein geladener Stil bekommt die Ebene sofort, ohne auf Kacheln zu warten (`isStyleLoaded` wäre noch „nein“)", () => {
        const karte = falscheKarte(true);
        installTravelerLayer(karte as never, () => null);
        expect(karte.ebenen).toEqual([ROUTE_TRAVELER_LAYER_ID]);
    });

    it("`onStyleData` ruft nur bei angenommenen Änderungen und lässt sich abmelden", () => {
        const karte = falscheKarte(false);
        const abgleich = vi.fn();
        const abmelden = onStyleData(karte as never, abgleich);
        karte.feuere("styledata");
        expect(abgleich).not.toHaveBeenCalled();
        karte.style._loaded = true;
        karte.feuere("styledata");
        expect(abgleich).toHaveBeenCalledTimes(1);
        abmelden();
        karte.feuere("styledata");
        expect(abgleich).toHaveBeenCalledTimes(1);
    });

    it("`whenStyleTakesChanges` läuft genau einmal: beim ersten `styledata`, ab dem der Stil Änderungen annimmt", () => {
        const karte = falscheKarte(false);
        const lauf = vi.fn();
        whenStyleTakesChanges(karte as never, lauf);
        karte.addImage("vorher");
        expect(lauf).not.toHaveBeenCalled();
        stilGeladen(karte);
        stilGeladen(karte);
        expect(lauf).toHaveBeenCalledTimes(1);

        const sofort = vi.fn();
        whenStyleTakesChanges(karte as never, sofort);
        expect(sofort).toHaveBeenCalledTimes(1);
    });

    it("eine entfernte Karte ohne Stil nimmt nichts an", () => {
        expect(styleTakesChanges({ style: undefined } as never)).toBe(false);
    });
});

describe("Laufzeitbilder anmelden (runtime-images.ts)", () => {
    it("🔴 „nicht angemeldet“ nur, wenn das Bild fehlt; wirft danach ein `styledata`-Zuhörer, heißt die Meldung so", () => {
        const fehler = vi.spyOn(console, "error").mockImplementation(() => undefined);
        try {
            const karte = falscheKarte(false);
            // Ein Zuhörer, der in den Aufrufer wirft, wie die Ebene der Reisenden vor dem Fix.
            karte.on("styledata", () => karte.addLayer({ id: "zu-frueh" }));
            registerRuntimeImages(karte as never, [["steht", kleinesBild]]);
            expect(karte.hasImage("steht")).toBe(true);
            expect(fehler).toHaveBeenCalledTimes(1);
            expect(String(fehler.mock.calls[0]?.[0])).toBe(
                "Laufzeitbild steht angemeldet, ein styledata-Zuhörer warf danach",
            );

            fehler.mockClear();
            const scheitert = falscheKarte(true);
            scheitert.addImage = () => {
                throw new Error("kaputt");
            };
            registerRuntimeImages(scheitert as never, [["fehlt", kleinesBild]]);
            expect(fehler).toHaveBeenCalledTimes(1);
            expect(String(fehler.mock.calls[0]?.[0])).toBe("Laufzeitbild fehlt nicht angemeldet");
        } finally {
            fehler.mockRestore();
        }
    });

    it("🔴 mit den echten Ebenen meldet ein ladender Stil keinen einzigen Fehler, und jedes Bild steht", () => {
        const fehler = vi.spyOn(console, "error").mockImplementation(() => undefined);
        try {
            const karte = falscheKarte(false);
            installTravelerLayer(karte as never, () => null);
            installRoutePills(karte as never, () => EMPTY_ROUTE_LAYER);
            installFlightArcs(karte as never, () => EMPTY_ROUTE_LAYER);
            registerRuntimeImages(
                karte as never,
                RUNTIME_IMAGES.map(([id]) => [id, kleinesBild]),
            );
            expect(fehler).not.toHaveBeenCalled();
            expect([...karte.bilder]).toEqual(RUNTIME_IMAGES.map(([id]) => id));
            // Schon angemeldete Bilder bleiben, wie sie sind.
            registerRuntimeImages(karte as never, [[RUNTIME_IMAGES[0]?.[0] ?? "", kleinesBild]]);
            expect(karte.bilder.size).toBe(RUNTIME_IMAGES.length);
        } finally {
            fehler.mockRestore();
        }
    });
});

import { describe, expect, it } from "vitest";
import type { Map as MapLibreMap } from "maplibre-gl";
import {
    ENTWURF_BESCHRIFTUNG_QUELLE,
    entwurfBeschriftungEbene,
    HALTEN_MS,
    installEntwurfsBeschriftungen,
} from "../src/map/entwurfs-beschriftungen";
import { MAP_LABEL_SOURCE_ID, mapLabelLayerId } from "../src/map/landscape-layers";
import { gespeicherteBeschriftungen } from "../src/landschaftseditor/gezogene-beschriftungen";

/**
 * Beschriftungen im Entwurf an ihrer neuen Lage (`map/entwurfs-beschriftungen.ts`; WI-0178 C4, Betreiber 2026-10-18: „kannst du nach
 * "Verschieben beenden" auch das label korrekt positionieren? unabhängig von "fertig" machen“). Problemfälle: Die Kachel zeigt den Namen
 * weiter an der alten Stelle (doppelt); die Kopie trägt den Filter zum Ausblenden und blendet sich selbst aus; nach einem Stilwechsel
 * fehlt sie, oder jedes `styledata` setzt alles neu (Schleife); nach „Fertig“ springt sie zurück, bis die Kachel kommt; nach Verwerfen
 * bleibt sie stehen.
 */
const DERO = mapLabelLayerId("derographisch");
const STIL_FILTER = ["all", ["!=", ["get", "has_curve_run"], true], ["==", ["get", "region_layer"], "derographisch"]];
const TALNAME = "a6a6a6a6-0000-4000-8000-0000000000b1";
const KURVENNAME = "a6a6a6a6-0000-4000-8000-0000000000b2";

function ersatzKarte() {
    const quellen = new Map<string, { data: unknown; setData(daten: unknown): void }>();
    const schichten: { id: string; type: string; source?: string; "source-layer"?: string; filter?: unknown }[] = [];
    const hoerer = new Map<string, () => void>();
    const zaehler = { setFilter: 0, addLayer: 0, setData: 0 };
    let geladen = true;
    const stil = () => [
        { id: "landscape-fill-derographisch", type: "fill", source: "landscapes" },
        {
            id: DERO,
            type: "symbol",
            source: MAP_LABEL_SOURCE_ID,
            "source-layer": "map_label_render",
            filter: STIL_FILTER,
            layout: { "text-field": ["get", "name"] },
        },
        { id: "place-label", type: "symbol", source: "places" },
    ];
    schichten.push(...stil());
    const karte = {
        on: (art: string, f: () => void) => hoerer.set(art, f),
        off: (art: string) => hoerer.delete(art),
        once: (art: string, f: () => void) => hoerer.set(`once-${art}`, f),
        loaded: () => geladen,
        getSource: (id: string) => (id === MAP_LABEL_SOURCE_ID ? {} : quellen.get(id)),
        addSource: (id: string, quelle: { data: unknown }) =>
            quellen.set(id, {
                data: quelle.data,
                setData(daten) {
                    zaehler.setData += 1;
                    this.data = daten;
                },
            }),
        removeSource: (id: string) => quellen.delete(id),
        getLayer: (id: string) => schichten.find((s) => s.id === id),
        addLayer: (spec: (typeof schichten)[number], vor?: string) => {
            zaehler.addLayer += 1;
            const i = vor === undefined ? schichten.length : schichten.findIndex((s) => s.id === vor);
            schichten.splice(i, 0, spec);
        },
        removeLayer: (id: string) =>
            schichten.splice(
                schichten.findIndex((s) => s.id === id),
                1,
            ),
        getFilter: (id: string) => schichten.find((s) => s.id === id)?.filter,
        setFilter: (id: string, filter: unknown) => {
            zaehler.setFilter += 1;
            schichten.find((s) => s.id === id)!.filter = filter ?? undefined;
        },
        getStyle: () => ({ layers: schichten.map((s) => ({ ...s })) }),
        querySourceFeatures: (_quelle: string, { filter }: { filter: unknown[] }) => {
            const id = filter[2];
            if (id === TALNAME)
                return [
                    {
                        properties: {
                            public_id: TALNAME,
                            name: "Probetal",
                            label_size: 14,
                            region_layer: "derographisch",
                        },
                    },
                ];
            if (id === KURVENNAME)
                return [{ properties: { public_id: KURVENNAME, name: "Kurve", has_curve_run: true } }];
            return [];
        },
    };
    /** Ein neuer Stil (`setStyle` mit `diff`): Kopien und Quelle sind weg, die Punktebene trägt wieder den Filter des Stils. */
    const neuerStil = () => {
        schichten.splice(0, schichten.length, ...stil());
        quellen.clear();
        hoerer.get("styledata")?.();
    };
    return {
        karte: karte as unknown as MapLibreMap,
        quellen,
        schichten,
        hoerer,
        zaehler,
        neuerStil,
        setzeGeladen: (wert: boolean) => (geladen = wert),
    };
}

const daten = (k: ReturnType<typeof ersatzKarte>) =>
    k.quellen.get(ENTWURF_BESCHRIFTUNG_QUELLE)?.data as
        { features: { properties: Record<string, unknown>; geometry: { coordinates: number[] } }[] } | undefined;

describe("Beschriftungen im Entwurf", () => {
    it("🔴 die Kachel blendet den Namen aus, die Kopie ihrer Punktebene zeigt ihn an der neuen Lage, mit dem Text des Entwurfs", () => {
        const k = ersatzKarte();
        const schicht = installEntwurfsBeschriftungen(k.karte, { kachelRevision: () => 0 });
        schicht.zeige([{ id: TALNAME, x: 500, y: 500, text: "Neues Tal" }]);
        expect(k.schichten.find((s) => s.id === DERO)?.filter).toEqual([
            "all",
            ["!", ["in", ["get", "public_id"], ["literal", [TALNAME]]]],
            STIL_FILTER,
        ]);
        const kopie = k.schichten.find((s) => s.id === entwurfBeschriftungEbene("derographisch"))!;
        // Gleich hinter ihrer Vorlage, aus der eigenen Quelle, mit dem Filter des Stils (nicht dem zum Ausblenden).
        expect(k.schichten.map((s) => s.id).indexOf(kopie.id)).toBe(k.schichten.map((s) => s.id).indexOf(DERO) + 1);
        expect(kopie).toMatchObject({ source: ENTWURF_BESCHRIFTUNG_QUELLE, filter: STIL_FILTER });
        expect(kopie["source-layer"]).toBeUndefined();
        const [feature] = daten(k)!.features;
        expect(feature?.properties).toMatchObject({ public_id: TALNAME, name: "Neues Tal", label_size: 14 });
        expect(feature?.geometry.coordinates).toHaveLength(2);
    });

    it("ein Name auf einer Kurve: Die Karte zeichnet den Punkt nicht, also auch hier nichts", () => {
        const k = ersatzKarte();
        installEntwurfsBeschriftungen(k.karte, { kachelRevision: () => 0 }).zeige([{ id: KURVENNAME, x: 1, y: 1 }]);
        expect(daten(k)?.features).toEqual([]);
    });

    it("🔴 nach einem Stilwechsel steht alles wieder; ein `styledata` ohne Änderung setzt nichts neu", () => {
        const k = ersatzKarte();
        const schicht = installEntwurfsBeschriftungen(k.karte, { kachelRevision: () => 0 });
        schicht.zeige([{ id: TALNAME, x: 500, y: 500 }]);
        const vorher = { ...k.zaehler };
        k.hoerer.get("styledata")!();
        expect(k.zaehler).toEqual(vorher);
        k.neuerStil();
        expect(k.schichten.some((s) => s.id === entwurfBeschriftungEbene("derographisch"))).toBe(true);
        expect((k.schichten.find((s) => s.id === DERO)?.filter as unknown[])[0]).toBe("all");
        expect(daten(k)?.features).toHaveLength(1);
    });

    it("🔴 ohne Entwurf (Verwerfen) gilt wieder der Filter des Stils, Kopien und Quelle sind weg", () => {
        const k = ersatzKarte();
        const schicht = installEntwurfsBeschriftungen(k.karte, { kachelRevision: () => 0 });
        schicht.zeige([{ id: TALNAME, x: 500, y: 500 }]);
        schicht.zeige([]);
        expect(k.schichten.find((s) => s.id === DERO)?.filter).toEqual(STIL_FILTER);
        expect(k.schichten.some((s) => s.id.startsWith("editor-entwurf-beschriftung"))).toBe(false);
        expect(k.quellen.has(ENTWURF_BESCHRIFTUNG_QUELLE)).toBe(false);
    });

    it("🔴 nach „Fertig“ steht sie, bis die Kacheln die Revision geladen haben; kommt die Kachel nicht, nach HALTEN_MS", () => {
        const k = ersatzKarte();
        let revision = 7;
        const uhren: (() => void)[] = [];
        const schicht = installEntwurfsBeschriftungen(k.karte, {
            kachelRevision: () => revision,
            setTimeout: (f, ms) => {
                expect(ms).toBe(HALTEN_MS);
                uhren.push(f);
                return uhren.length;
            },
            clearTimeout: () => undefined,
        });
        const tal = { id: TALNAME, x: 500, y: 500 };
        schicht.zeige([tal]);
        // Die Kacheln laden noch.
        k.setzeGeladen(false);
        schicht.halte([tal], 8);
        schicht.zeige([]);
        revision = 8;
        k.hoerer.get("idle")!();
        expect(daten(k)?.features).toHaveLength(1);
        k.setzeGeladen(true);
        k.hoerer.get("idle")!();
        expect(k.quellen.has(ENTWURF_BESCHRIFTUNG_QUELLE)).toBe(false);
        expect(k.schichten.find((s) => s.id === DERO)?.filter).toEqual(STIL_FILTER);

        // Ohne Kachel: nach der Frist.
        k.setzeGeladen(false);
        schicht.halte([tal], 9);
        expect(daten(k)?.features).toHaveLength(1);
        uhren.at(-1)!();
        expect(k.quellen.has(ENTWURF_BESCHRIFTUNG_QUELLE)).toBe(false);
    });

    it("gehalten wird nur, was mit einer Speicherung aus dem Entwurf fiel, nicht was mit Verwerfen fiel", () => {
        const a = { id: "a", landschaft: "gespeichert", x: 1, y: 1 };
        const b = { id: "b", landschaft: "verworfen", x: 2, y: 2 };
        const c = { id: "c", landschaft: "gespeichert", x: 3, y: 3 };
        expect(gespeicherteBeschriftungen([a, b, c], [c], (id) => id === "gespeichert")).toEqual([a]);
    });
});

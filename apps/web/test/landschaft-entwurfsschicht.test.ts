import { afterEach, describe, expect, it, vi } from "vitest";
import type { Map as MapLibreMap } from "maplibre-gl";
import { ENTWURF_EBENEN, ENTWURF_QUELLE, installEntwurfsFlaechen } from "../src/map/entwurfs-flaechen.ts";

/**
 * Die gemeinsame Schicht der Flächen im Entwurf (`map/entwurfs-flaechen.ts`; WI-0178, Betreiber 2026-10-18 „A“; Andockung der Gebiete mit
 * eigener Ebenenkennung). Problemfälle: Eine Fläche steht in einer Ebene, die die Karte gerade nicht zeigt; nach einem Stilwechsel
 * fehlt die Schicht; „entferne“ lässt Quelle oder Ebenen stehen; der Ring kommt offen an.
 *
 * Seit WI-0249 (Kammeditor) kommt die Schicht nach einem Stilwechsel erst im NÄCHSTEN Bild (`nachStilwechsel`, `map/style-ready.ts`):
 * Der Test hält die Bilder an (`naechstesBild`), und der Stil sagt wie MapLibre selbst, ob er Ebenen annimmt (`style._loaded`).
 */
function ersatzKarte(stil = { geladen: true }) {
    const quellen = new Map<string, { data: unknown; setData(daten: unknown): void }>();
    const ebenen = new Map<string, { filter: unknown }>();
    // Mehrere Zuhörer je Ereignis: Die Schicht meldet sich selbst an und im Fehlerfall ein zweites Mal.
    const hoerer = new Map<string, Set<() => void>>();
    const feuere = (art: string): void => {
        for (const f of [...(hoerer.get(art) ?? [])]) f();
    };
    const karte = {
        // Wie MapLibre: `isStyleLoaded` wartet auch auf Kacheln (hier immer falsch), `style._loaded` nur auf den Stil.
        isStyleLoaded: () => false,
        get style() {
            return { _loaded: stil.geladen };
        },
        on: (art: string, f: () => void) => {
            if (!hoerer.has(art)) hoerer.set(art, new Set());
            hoerer.get(art)!.add(f);
        },
        off: (art: string, f: () => void) => void hoerer.get(art)?.delete(f),
        getSource: (id: string) => quellen.get(id),
        // Wie MapLibre: Solange der Stil lädt, wirft das Anlegen („Style is not done loading“); auf Kacheln wartet es nicht.
        addSource: (id: string, quelle: { data: unknown }) => {
            if (!stil.geladen) throw new Error("Style is not done loading.");
            quellen.set(id, {
                data: quelle.data,
                setData(daten) {
                    this.data = daten;
                },
            });
        },
        removeSource: (id: string) => quellen.delete(id),
        getLayer: (id: string) => ebenen.get(id),
        addLayer: (ebene: { id: string; filter: unknown }) => ebenen.set(ebene.id, { filter: ebene.filter }),
        removeLayer: (id: string) => ebenen.delete(id),
        setFilter: (id: string, filter: unknown) => ebenen.set(id, { filter }),
        getStyle: () => ({ layers: [{ id: "schrift", type: "symbol" }] }),
    };
    return { karte: karte as unknown as MapLibreMap, quellen, ebenen, hoerer, feuere };
}

/**
 * Ein Ersatz für die Bildtaktung des Browsers (Node kennt keine): Angemeldete Bilder laufen erst mit `naechstesBild`, abgemeldete nie.
 * Der Ersatz gehört in den Test, nicht ins Produkt.
 */
const bilder = new Map<number, () => void>();
let bildNummer = 0;
vi.stubGlobal("requestAnimationFrame", (f: () => void) => {
    bildNummer += 1;
    bilder.set(bildNummer, f);
    return bildNummer;
});
vi.stubGlobal("cancelAnimationFrame", (nummer: number) => void bilder.delete(nummer));
function naechstesBild(): void {
    const faellig = [...bilder.values()];
    bilder.clear();
    for (const f of faellig) f();
}
afterEach(() => bilder.clear());

const TAL = {
    id: "tal",
    ebene: "vegetation",
    farbe: "#88aa55",
    polygone: [
        [
            [
                [0, 0],
                [10, 0],
                [10, 10],
            ] as const,
        ],
    ],
};
const GEBIET = { ...TAL, id: "gebiet", ebene: "gebiete-band-3" };

describe("Schicht der Flächen im Entwurf", () => {
    it("🔴 zeichnet nur in Ebenen, die die Karte zeigt; Ringe geschlossen; eine eigene Ebenenkennung (Gebiete) geht mit", () => {
        const { karte, quellen, ebenen } = ersatzKarte();
        const schicht = installEntwurfsFlaechen(karte, (ebene) => ebene !== "derographisch");
        schicht.zeige([TAL, GEBIET, { ...TAL, id: "fern", ebene: "derographisch" }]);
        const daten = quellen.get(ENTWURF_QUELLE)!.data as {
            features: { properties: { id: string }; geometry: { coordinates: number[][][] } }[];
        };
        expect(daten.features.map((f) => f.properties.id)).toEqual(["tal", "gebiet", "fern"]);
        const ring = daten.features[0]!.geometry.coordinates[0]!;
        expect(ring).toHaveLength(4);
        expect(ring[3]).toEqual(ring[0]);
        // Der Filter lässt nur die gezeigten Ebenen durch.
        expect(ebenen.get(ENTWURF_EBENEN.flaeche)?.filter).toEqual([
            "in",
            ["get", "ebene"],
            ["literal", ["vegetation", "gebiete-band-3"]],
        ]);
    });

    it("🔴 nach einem Stilwechsel kommen Quelle und Ebenen im nächsten Bild wieder; „entferne“ räumt alles ab und hört nicht mehr zu", () => {
        const { karte, quellen, ebenen, hoerer, feuere } = ersatzKarte();
        const schicht = installEntwurfsFlaechen(karte, () => true);
        schicht.zeige([TAL]);
        quellen.clear();
        ebenen.clear();
        feuere("styledata");
        // Nicht mitten in MapLibres Stilaktualisierung: Sonst zeichnet es die Füllebene unausgewertet (WI-0249).
        expect(quellen.size + ebenen.size).toBe(0);
        naechstesBild();
        expect(quellen.has(ENTWURF_QUELLE)).toBe(true);
        expect([...ebenen.keys()]).toEqual([ENTWURF_EBENEN.flaeche, ENTWURF_EBENEN.kante]);
        // Ein Bild, das beim Entfernen noch ansteht, zeichnet nichts mehr.
        feuere("styledata");
        schicht.entferne();
        naechstesBild();
        expect(quellen.size + ebenen.size).toBe(0);
        expect(hoerer.get("styledata")?.size ?? 0).toBe(0);
    });

    it("🔴 wartet nur auf den Stil, nicht auf die Kacheln; lädt der Stil gerade, zeichnet sie gleich danach", () => {
        // `isStyleLoaded()` ist hier immer falsch (Kacheln laden): Die Schicht steht trotzdem sofort.
        const sofort = ersatzKarte();
        installEntwurfsFlaechen(sofort.karte, () => true).zeige([TAL]);
        expect(sofort.quellen.has(ENTWURF_QUELLE)).toBe(true);
        const stil = { geladen: false };
        const { karte, quellen, feuere } = ersatzKarte(stil);
        installEntwurfsFlaechen(karte, () => true).zeige([TAL]);
        expect(quellen.has(ENTWURF_QUELLE)).toBe(false);
        // Der Stil ist fertig und meldet sich; gezeichnet wird im nächsten Bild.
        stil.geladen = true;
        feuere("styledata");
        naechstesBild();
        expect(quellen.has(ENTWURF_QUELLE)).toBe(true);
    });
});

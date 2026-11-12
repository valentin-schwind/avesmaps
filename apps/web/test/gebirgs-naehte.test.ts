import { describe, expect, it, vi } from "vitest";
import type { Map as MapLibreMap } from "maplibre-gl";
import { EDITOR_LANDSCAPE_NAEHTE_URL, LANDSCAPE_SELECTIONS, MAP_VIEWS } from "@avesmaps3d/shared";
import {
    installGebirgsNaehte,
    NAEHTE_EBENE,
    NAEHTE_QUELLE,
    naehteSichtbar,
} from "../src/landschaftseditor/gebirgs-naehte";
import { sichtbarAn } from "../src/editor-panel/fenster-verwaltung";

/**
 * Gemeinsame Grenzen auf der Karte (OPS-000089). Problemfälle: Besucher oder eine andere Ansicht laden die Liste; die Linie bleibt nach dem Ausblenden stehen; nach dem Speichern zeigt sie
 * den alten Stand; ein Fehler des Servers stört die Bearbeitung.
 */

function karte() {
    const quellen = new Map<string, { data: unknown; setData: (d: unknown) => void }>();
    const ebenen = new Set<string>();
    const map = {
        on: vi.fn(),
        off: vi.fn(),
        once: vi.fn(),
        getSource: (id: string) => quellen.get(id),
        addSource: (id: string, spec: { data: unknown }) => {
            const quelle = {
                data: spec.data,
                setData(d: unknown) {
                    quelle.data = d;
                },
            };
            quellen.set(id, quelle);
        },
        removeSource: (id: string) => quellen.delete(id),
        getLayer: (id: string) => (ebenen.has(id) ? {} : undefined),
        addLayer: (spec: { id: string }) => ebenen.add(spec.id),
        removeLayer: (id: string) => ebenen.delete(id),
    };
    return { map: map as unknown as MapLibreMap, quellen, ebenen };
}

const antwort = (kanten: number[][][]): Response =>
    new Response(JSON.stringify({ kanten }), { status: 200, headers: { "content-type": "application/json" } });
const EINE = [
    [
        [10, 10],
        [20, 10],
    ],
];
const warte = () => new Promise((fertig) => setTimeout(fertig, 0));
const linien = (k: ReturnType<typeof karte>): number =>
    (k.quellen.get(NAEHTE_QUELLE)?.data as { features: unknown[] }).features.length;

describe("Gemeinsame Grenzen auf der Karte", () => {
    it("🔴 lädt erst beim Zeigen, zeichnet die Kanten und nimmt die Linie wieder weg", async () => {
        const k = karte();
        const abruf = vi.fn(async () => antwort(EINE));
        const naehte = installGebirgsNaehte(k.map, abruf as unknown as typeof fetch);
        expect(abruf).not.toHaveBeenCalled();
        naehte.zeige(true);
        await warte();
        expect(abruf).toHaveBeenCalledTimes(1);
        expect((abruf.mock.calls[0] as unknown as [string])[0]).toBe(EDITOR_LANDSCAPE_NAEHTE_URL);
        expect(k.ebenen.has(NAEHTE_EBENE)).toBe(true);
        expect(linien(k)).toBe(1);

        naehte.zeige(false);
        expect(k.ebenen.has(NAEHTE_EBENE)).toBe(false);
        expect(k.quellen.has(NAEHTE_QUELLE)).toBe(false);

        // Wieder zeigen braucht keinen zweiten Abruf.
        naehte.zeige(true);
        expect(abruf).toHaveBeenCalledTimes(1);
        expect(linien(k)).toBe(1);
    });

    it("🔴 nach dem Speichern der neue Stand; ausgeblendet erst beim nächsten Zeigen", async () => {
        const k = karte();
        const abruf = vi
            .fn()
            .mockResolvedValueOnce(antwort(EINE))
            .mockResolvedValueOnce(antwort([...EINE, ...EINE]))
            .mockResolvedValueOnce(antwort([]));
        const naehte = installGebirgsNaehte(k.map, abruf as unknown as typeof fetch);
        naehte.zeige(true);
        await warte();
        naehte.lade();
        await warte();
        expect(linien(k)).toBe(2);

        naehte.zeige(false);
        naehte.lade();
        expect(abruf).toHaveBeenCalledTimes(2);
        naehte.zeige(true);
        await warte();
        expect(abruf).toHaveBeenCalledTimes(3);
        expect(linien(k)).toBe(0);
    });

    it("🔴 ein Fehler des Servers lässt nur die Linie fehlen", async () => {
        const k = karte();
        const naehte = installGebirgsNaehte(k.map, (async () => {
            throw new Error("weg");
        }) as unknown as typeof fetch);
        naehte.zeige(true);
        await warte();
        expect(k.ebenen.has(NAEHTE_EBENE)).toBe(false);
        naehte.entferne();
        expect(k.map.off).toHaveBeenCalled();
    });
});

describe("Wann die Naht steht (Vali 2026-11-11)", () => {
    it("🔴 nur beim Bearbeiten von Gebirgen, in den Landschaften unter „Alle“ oder „Topographie“ und mit dem Auge „Ebenen“ an", () => {
        for (const ansicht of MAP_VIEWS)
            for (const ebene of LANDSCAPE_SELECTIONS)
                for (const flaechen of [true, false])
                    for (const gebirge of [true, false])
                        expect(
                            naehteSichtbar({ ansicht, ebene, flaechen, gebirge }),
                            `${ansicht}/${ebene}/${flaechen}/${gebirge}`,
                        ).toBe(
                            gebirge &&
                                ansicht === "landscapes" &&
                                flaechen &&
                                (ebene === "alle" || ebene === "topographie"),
                        );
        // Valis Bild: Topographie gewählt, Ebenen aus, nur Relief, Flüsse und Seen.
        expect(naehteSichtbar({ ansicht: "landscapes", ebene: "topographie", flaechen: false, gebirge: true })).toBe(
            false,
        );
        // Editor-Modus mit sichtbarer Topographie, aber niemand bearbeitet Gebirge.
        expect(naehteSichtbar({ ansicht: "landscapes", ebene: "topographie", flaechen: true, gebirge: false })).toBe(
            false,
        );
    });

    it("🔴 Gebirge bearbeiten heißt: ein sichtbares Landschaftsfenster an einem Gebirge, abgelegte zählen nicht", () => {
        const gebirge = new Set(["harotrutz", "koschberge"]);
        const ist = (id: string): boolean => gebirge.has(id);
        expect(sichtbarAn([], ist)).toBe(false);
        expect(sichtbarAn([{ lage: "angedockt", gegenstand: "harotrutz" }], ist)).toBe(true);
        expect(sichtbarAn([{ lage: "geloest", gegenstand: "reichsforst" }], ist)).toBe(false);
        expect(sichtbarAn([{ lage: "geloest", gegenstand: undefined }], ist)).toBe(false);
        // Nach dem Neuladen liegt der Entwurf eines Gebirges unter „Offene Bearbeitungen“: keine Naht.
        expect(sichtbarAn([{ lage: "versenkt", gegenstand: "koschberge" }], ist)).toBe(false);
        expect(
            sichtbarAn(
                [
                    { lage: "versenkt", gegenstand: "koschberge" },
                    { lage: "geloest", gegenstand: "reichsforst" },
                    { lage: "angedockt", gegenstand: "harotrutz" },
                ],
                ist,
            ),
        ).toBe(true);
    });
});

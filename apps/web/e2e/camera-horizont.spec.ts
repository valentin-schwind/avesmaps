import { expect, test, type Page } from "@playwright/test";
import { clickMap, openMap, selectedPlace, settleFrame, showCamera } from "./map-handle.ts";

/**
 * Der Klick trifft auch bei voller Neigung (WI-0142, MapLibre-Issue
 * [#2994](https://github.com/maplibre/maplibre-gl-js/issues/2994)).
 *
 * 💣 **Warum es diesen Test gibt.** MapLibre rechnet vor jeder Trefferabfrage einen Maßstabsfaktor aus der oberen linken
 * Bildecke. Liegt die über dem Horizont, wird er negativ und schrumpft den Suchbereich jeder Kachel, bis keine mehr
 * übrig ist: Über 71,5° traf dann kein Klick mehr einen Ort oder Weg, während Beschriftungen und Bauwerke weiter
 * ansprachen. `installHorizonQueryFix` (`camera/query-horizont.ts`) klemmt den Faktor und zieht das nach, wenn MapLibre
 * den Transform austauscht (Gelände, Stilwechsel).
 *
 * 🪤 Geprüft werden **Punktabfragen**, wie der Klick sie macht - nicht `queryRenderedFeatures()` über das ganze Bild.
 * Die bleibt über dem Horizont kaputt, weil dort die Bildecken selbst die Suchgeometrie sind; der Klick fragt nie so.
 *
 * 🪤 Die Ziele kommen aus der QUELLE (`querySourceFeatures`) und werden selbst projiziert - käme die Liste aus
 * `queryRenderedFeatures`, prüfte der Test seine eigene Annahme.
 *
 * 🔴 Mit Grafikkarte, weil die Neigung über 60° nur mit Gelände der Wirklichkeit entspricht.
 */
test.use({
    launchOptions: { args: ["--use-angle=d3d11", "--ignore-gpu-blocklist"] },
    viewport: { width: 1600, height: 900 },
});

/** Die Koschberge mit Orten, Bauwerken und Wegen im Bild (Betreiberbefund 2026-10-13). */
const KOSCHBERGE = { x: 463.722, y: 515.612 };

interface Probe {
    kandidaten: number;
    treffer: number;
    sichtfeld: number;
    erste: { name: string; x: number; y: number } | null;
}

/** Ortsmarken aus der Quelle projizieren und an ihrem Bildpunkt abfragen - genau das tut der Klick. */
async function probe(page: Page): Promise<Probe> {
    return page.evaluate(() => {
        const map = globalThis.avesmapsMap;
        if (!map) throw new Error("map handle missing");
        const karte = map as unknown as {
            getCanvas(): { clientWidth: number; clientHeight: number };
            querySourceFeatures(
                quelle: string,
                optionen: { sourceLayer: string },
            ): { geometry: { type: string; coordinates: [number, number] }; properties: Record<string, unknown> }[];
            project(lngLat: { lng: number; lat: number }): { x: number; y: number };
            queryRenderedFeatures(geometrie: unknown, optionen: { layers: string[] }): unknown[];
            getVerticalFieldOfView(): number;
        };
        const breite = karte.getCanvas().clientWidth;
        const hoehe = karte.getCanvas().clientHeight;
        const kandidaten = karte
            .querySourceFeatures("places", { sourceLayer: "place_render" })
            .filter((eintrag) => eintrag.geometry.type === "Point")
            .map((eintrag) => {
                const [lng, lat] = eintrag.geometry.coordinates;
                return { name: String(eintrag.properties["name"] ?? ""), punkt: karte.project({ lng, lat }) };
            })
            .filter(
                (eintrag) =>
                    Number.isFinite(eintrag.punkt.x) &&
                    eintrag.punkt.x > 60 &&
                    eintrag.punkt.x < breite - 60 &&
                    eintrag.punkt.y > hoehe * 0.4 &&
                    eintrag.punkt.y < hoehe - 20,
            )
            .sort((a, b) => b.punkt.y - a.punkt.y);
        let treffer = 0;
        let erste: { name: string; x: number; y: number } | null = null;
        for (const eintrag of kandidaten) {
            const x = Math.round(eintrag.punkt.x);
            const y = Math.round(eintrag.punkt.y);
            if (karte.queryRenderedFeatures([x, y], { layers: ["place-marker"] }).length === 0) continue;
            treffer += 1;
            erste ??= { name: eintrag.name, x, y };
        }
        return { kandidaten: kandidaten.length, treffer, erste, sichtfeld: karte.getVerticalFieldOfView() };
    });
}

test("🔴 Ortsmarken bleiben bis zum Anschlag der Neigung treffbar, mit MapLibres eigenem Sichtfeld", async ({
    page,
}) => {
    await openMap(page);
    for (const pitch of [60, 71, 72, 75, 80]) {
        await showCamera(page, { point: KOSCHBERGE, zoom: 8.61, bearing: 24, pitch });
        await settleFrame(page);
        const stand = await probe(page);
        expect(stand.kandidaten, `Orte im Bild bei ${pitch}°`).toBeGreaterThan(0);
        // 🔴 Ohne den Eingriff fiel das ab 72° auf null - bei unveränderter Zahl der Orte im Bild.
        expect(stand.treffer, `treffbare Orte bei ${pitch}°`).toBeGreaterThan(0);
        // Das Sichtfeld bleibt MapLibres Vorgabe: ein engeres sah aus wie ein Teleobjektiv, ein mitgeführtes wie Vertigo.
        expect(stand.sichtfeld, `Sichtfeld bei ${pitch}°`).toBeCloseTo(36.87, 1);
    }
});

test("🔴 ein Klick auf eine Marke wählt sie auch am Anschlag der Neigung", async ({ page }) => {
    await openMap(page);
    await showCamera(page, { point: KOSCHBERGE, zoom: 8.61, bearing: 24, pitch: 80 });
    await settleFrame(page);
    const stand = await probe(page);
    expect(stand.erste, "bei voller Neigung ist mindestens eine Marke treffbar").not.toBeNull();
    await clickMap(page, { x: stand.erste!.x, y: stand.erste!.y });
    await expect.poll(async () => (await selectedPlace(page))?.name).toBe(stand.erste!.name);
});

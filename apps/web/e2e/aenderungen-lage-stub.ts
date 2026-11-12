import { expect, type Page } from "@playwright/test";
import type { MapChangeLage, MapHistoryEntry, MapHistoryPage } from "@avesmaps3d/shared";
import { GRATENFELS, GRATENFELS_LAGE } from "./ortseditor-stub.ts";

/**
 * Der gestellte Server für „Auf der Karte zeigen“ bei jeder Änderung (WI-0265 B9): sechs Änderungen ohne Lage im Protokoll und die Lage, die der Server zu jeder nennt. Beide Specs
 * (`aenderungen-lage.spec.ts` am Rechner, `aenderungen-lage.touch.spec.ts` am Telefon) lesen dieselbe Seite.
 */

export const RECHTE = [
    "use_editor_menu",
    "edit_map_objects",
    "edit_map_geometry",
    "edit_territories",
    "edit_landscapes",
    "edit_territory_form",
    "edit_landscape_form",
    "edit_mountains",
];
export const op = (n: number): string => `b9b90265-0000-4000-9000-${String(n).padStart(12, "0")}`;
export const GEBIET = "b9b90265-0000-4000-8700-000000000001";
export const GEBIET_KASTEN: [number, number, number, number] = [420, 500, 520, 570];
/** Ein Lauf über 608 Sprachartikel (WI-0265 B9b): Der Kasten reicht fast über ganz Aventurien (Production, 2026-11-01). */
export const LAUF_KASTEN: [number, number, number, number] = [6, 10, 1018, 1012];
/** Ein Kasten, der über die Karte hinausreicht (jede Lage, die der Server so nennte): größer als Aventurien. */
export const UEBERGROSS_KASTEN: [number, number, number, number] = [-300, -300, 1400, 1400];

export const json = (body: unknown): { status: number; contentType: string; body: string } => ({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(body),
});

function eintrag(n: number, kind: "place" | "territory", id: string, name: string, feld: string): MapHistoryEntry {
    return {
        operationId: op(n),
        seq: 100 - n,
        at: `2026-11-01T1${String(n)}:00:00.000Z`,
        operation: kind === "place" ? "place.update" : "territory.update",
        source: "editor",
        actor: { kind: "person", name: "Rondrikan", self: true },
        status: "ruecknehmbar",
        objects: [
            {
                kind,
                id,
                name,
                action: `${kind}.updated`,
                revisionBefore: 1,
                revisionAfter: 2,
                changes: { [feld]: { before: "vorher", after: "nachher" } },
            },
        ],
    };
}

/** Eine Feldänderung am Ort, drei am Gebiet (eine mit Lage, eine mit stillgelegtem Gegenstand, eine ohne Lage). */
export const SEITE: MapHistoryPage = {
    entries: [
        eintrag(1, "place", GRATENFELS, "Gratenfels", "description"),
        eintrag(2, "territory", GEBIET, "Königreich Probeland", "statusText"),
        eintrag(3, "territory", GEBIET, "Königreich Altland", "statusText"),
        eintrag(4, "territory", GEBIET, "Königreich Nirgendwo", "statusText"),
        eintrag(5, "territory", GEBIET, "Sprachen: 608 Artikel", "statusText"),
        eintrag(6, "territory", GEBIET, "Über die Karte hinaus", "statusText"),
    ],
};

export const LAGEN: Record<string, MapChangeLage> = {
    [op(1)]: {
        grenzen: [GRATENFELS_LAGE.x, GRATENFELS_LAGE.y, GRATENFELS_LAGE.x, GRATENFELS_LAGE.y],
        gegenstaende: 1,
        stillgelegt: 0,
    },
    [op(2)]: { grenzen: GEBIET_KASTEN, gegenstaende: 2, stillgelegt: 0 },
    [op(3)]: { grenzen: GEBIET_KASTEN, gegenstaende: 1, stillgelegt: 1 },
    [op(4)]: { grenzen: null, gegenstaende: 0, stillgelegt: 0 },
    [op(5)]: { grenzen: LAUF_KASTEN, gegenstaende: 608, stillgelegt: 0 },
    [op(6)]: { grenzen: UEBERGROSS_KASTEN, gegenstaende: 9, stillgelegt: 0 },
};

/** Stellt den Server: die Liste der Änderungen und die Lage je Operation. Das Ergebnis sammelt, was die Oberfläche gefragt hat. */
export async function stubs(page: Page): Promise<string[]> {
    const lagen: string[] = [];
    await page.route("**/api/editor/status", (route) => route.fulfill(json({ mapEditing: "testwelt" })));
    await page.route("**/api/editor/changes*", (route) => route.fulfill(json(SEITE)));
    await page.route(/\/api\/editor\/changes\/[0-9a-f-]+\/lage/, (route) => {
        lagen.push(route.request().url());
        const id = /changes\/([0-9a-f-]+)\/lage/.exec(route.request().url())![1]!;
        return route.fulfill(json(LAGEN[id] ?? { grenzen: null, gegenstaende: 0, stillgelegt: 0 }));
    });
    return lagen;
}

/** Die Kante der Karte in Kartenpunkten (`aventuria-v1`). */
export const KARTE_KANTE = 1024;

/**
 * Kein Kartenrand im Bild (WI-0265 B9b/B9c/B9d): Die LEINWAND liegt ganz im Kartenbild, nirgends erscheint der leere Hintergrund außerhalb des Bilds, auch nicht unter dem halbhohen Routenplaner. Ausgenommen ist, was das
 * Editorpanel rechts deckt (es deckt die ganze Höhe; sichtbar ist dort nichts). Gemessen wird an den projizierten Ecken der Karte. Das Ergebnis nennt die Breite des Kartenbilds und der Leinwand in Bildpunkten, damit ein
 * Test auch prüfen kann, dass nicht weiter herangefahren wurde als nötig.
 */
export async function pruefeKeinKartenrand(page: Page): Promise<{ kartenBreite: number; leinwandBreite: number }> {
    const rand = await page.evaluate((kante) => {
        const karte = globalThis.avesmapsMap!;
        const leinwand = karte.getCanvas();
        const flaeche = leinwand.getBoundingClientRect();
        const panel = document.querySelector('[data-testid="editor-panel"]')?.getBoundingClientRect();
        const bild = [
            { x: 0, y: 0 },
            { x: kante, y: kante },
        ].map((p) => karte.project(globalThis.avesmapsRenderProjection!.toRenderLngLat(p)));
        // Das Editorpanel steht rechts und deckt die ganze Höhe: Was hinter ihm liegt, sieht niemand.
        const sichtbarBis =
            panel !== undefined && panel.width > 0 && panel.left > flaeche.left
                ? panel.left - flaeche.left
                : leinwand.clientWidth;
        return {
            kartenLinks: Math.min(...bild.map((p) => p.x)),
            kartenRechts: Math.max(...bild.map((p) => p.x)),
            kartenOben: Math.min(...bild.map((p) => p.y)),
            kartenUnten: Math.max(...bild.map((p) => p.y)),
            sichtbarBis,
            hoehe: leinwand.clientHeight,
            leinwandBreite: leinwand.clientWidth,
        };
    }, KARTE_KANTE);
    expect(rand.kartenLinks).toBeLessThanOrEqual(1);
    expect(rand.kartenOben).toBeLessThanOrEqual(1);
    expect(rand.kartenRechts).toBeGreaterThanOrEqual(rand.sichtbarBis - 1);
    expect(rand.kartenUnten).toBeGreaterThanOrEqual(rand.hoehe - 1);
    return { kartenBreite: rand.kartenRechts - rand.kartenLinks, leinwandBreite: rand.leinwandBreite };
}

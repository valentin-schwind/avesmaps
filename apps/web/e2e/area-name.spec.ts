import { expect, test, type Page } from "@playwright/test";
import { openMap, settleFrame, showCamera, showLandscapes } from "./map-handle.ts";

/**
 * Der Name einer gewählten Fläche am echten Stack (WI-0093).
 *
 * 🔴 Betreiber 2026-10-06 aus einem Nutzertest, zu zwei Bildpaaren derselben Stelle: „was die leute stört ist,
 * dass der text beim anklicken von regionen plötzlich eine andere schriftform animmt. außerdem: wenn der der
 * text schon voll sichtbar/lesbar ist, braucht er keine verschiebung erfahren (das ist nur praktisch für
 * flächen, wo man nur zu nah dran ist)" und, zum Raschtulswall: „das betrifft insbesondere auch
 * kurvenbeschriftungen".
 *
 * 🪤 Gemessen wird, was GEZEICHNET ist. Dass der gewöhnliche Name stehen bleibt und nur die Farbe wechselt,
 * ist hier an seiner Stelle im Bild zu sehen: dieselben Bildpunkte vor und nach dem Klick. Die Gleichheit der
 * Ausdrücke prüft `test/area-selection.test.ts`, die Entscheidung „gezeichnet oder nicht"
 * `test/area-selection-name.test.ts`.
 *
 * 🪤 Kennungen und Koordinaten kommen aus der Suche des laufenden Servers, nicht aus dem Test: Der Kartenstand
 * ändert sich mit jedem Legacy-Import.
 */

const NAME_LAYERS = ["map-label", "landscape-label-run"];

/**
 * Die Zoomstufe, auf der beide Namen stehen (am laufenden Stack gemessen, 2026-10-06).
 *
 * 🪤 Keine Zahl aus dem Kopf. „Herz des Kontinents“ trägt das Band 1 bis 3, der Raschtulswall 1 bis 7, und
 * MapLibre liegt eine Stufe darüber (RENDER_ZOOM_OFFSET): Bei z5 zeichnet die Karte den ersten schon nicht
 * mehr - genau das ist der Fall „zu nah dran“ weiter unten. Der Test misst das Band trotzdem selbst, statt
 * sich darauf zu verlassen: Es ist eine redaktionelle Einstellung und gehört den Editoren.
 */
const SICHTBAR = 4;
const SELECTION_LABEL = "area-selection-label";

interface Flaeche {
    region: string;
    name: string;
    x: number;
    y: number;
}

/** Die Fläche hinter einem Namen, aus der Suche des Servers. */
async function sucheFlaeche(page: Page, name: string, subtype: string): Promise<Flaeche> {
    const hit = await page.evaluate(
        async ({ query, art }) => {
            const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
            const body = (await response.json()) as {
                hits: { kind: string; name: string; subtype?: string; region?: string; x: number; y: number }[];
            };
            return body.hits.find(
                (entry) => entry.kind === "landschaft" && entry.name === query && entry.subtype === art,
            );
        },
        { query: name, art: subtype },
    );
    if (!hit?.region) throw new Error(`die Suche kennt „${name}" (${subtype}) nicht als Fläche`);
    return { region: hit.region, name: hit.name, x: hit.x, y: hit.y };
}

/**
 * Wo die gewöhnlichen Namen dieser Region gerade stehen - in KARTENKOORDINATEN, und in welcher Ebene.
 *
 * 🪤 Nicht in Bildpunkten. Beim Wählen fährt das Infopanel herein, und die Karte hält ihre Mitte im freien
 * Streifen: Dieselbe Beschriftung an derselben Stelle der WELT läge dann 200 Bildpunkte weiter. Gemessen wird
 * also, was die Karte zeigt, nicht wohin die Panels sie geschoben haben.
 */
async function nameSpots(page: Page, region: string): Promise<{ layer: string; x: number; y: number }[]> {
    return page.evaluate(
        ({ id, layers }) => {
            const map = globalThis.avesmapsMap!;
            const projection = globalThis.avesmapsRenderProjection!;
            // Seit WI-0135 je Landschaftsebene eigene Namensebenen (Familien `map-label-…`, `landscape-label-run-…`).
            const present = map
                .getStyle()
                .layers.map((layer) => layer.id)
                .filter((id) => layers.some((familie) => id.startsWith(`${familie}-`)));
            if (present.length === 0) return [];
            return map
                .queryRenderedFeatures({ layers: present })
                .filter((feature) => feature.properties["region_public_id"] === id)
                .map((feature) => {
                    const raw = (feature.geometry as { coordinates: unknown }).coordinates as
                        [number, number] | [number, number][];
                    const point = Array.isArray(raw[0]) ? (raw as [number, number][])[0]! : (raw as [number, number]);
                    const at = projection.fromRenderLngLat({ lng: point[0], lat: point[1] });
                    return {
                        layer: feature.layer.id,
                        x: Math.round(at.x * 100) / 100,
                        y: Math.round(at.y * 100) / 100,
                    };
                })
                .sort((a, b) => a.x - b.x || a.y - b.y);
        },
        { id: region, layers: NAME_LAYERS },
    );
}

/** Wie viele versetzte Namen die Auswahl gerade zeichnet. */
async function offsetNames(page: Page): Promise<number> {
    return page.evaluate((layer) => {
        const map = globalThis.avesmapsMap!;
        return map.getLayer(layer) ? map.queryRenderedFeatures({ layers: [layer] }).length : 0;
    }, SELECTION_LABEL);
}

/** Eine Stelle im Bild, an der genau diese Region als Fläche liegt und kein Ort den Klick fängt. */
async function spotIn(page: Page, region: string): Promise<{ x: number; y: number }> {
    const found = await page.evaluate((id) => {
        const map = globalThis.avesmapsMap!;
        const fills = (map.getStyle().layers ?? [])
            .map((layer) => layer.id)
            .filter((layer) => layer.startsWith("landscape-fill-"));
        if (fills.length === 0) return undefined;
        const marker = ["place-marker", "place-marker-structure"].filter((entry) => map.getLayer(entry));
        const canvas = map.getCanvas();
        for (let y = 200; y < canvas.clientHeight - 200; y += 7) {
            for (let x = 430; x < canvas.clientWidth - 440; x += 7) {
                const at: [number, number] = [x, y];
                const hit = map
                    .queryRenderedFeatures(at, { layers: fills })
                    .some((feature) => feature.properties["region_public_id"] === id);
                if (!hit) continue;
                if (marker.length > 0 && map.queryRenderedFeatures(at, { layers: marker }).length > 0) continue;
                return { x, y };
            }
        }
        return undefined;
    }, region);
    if (!found) throw new Error(`keine freie Stelle der Region ${region} im Bild`);
    return found;
}

/** Zwei gesetzte Bilder: Die Entscheidung fällt einen Frame nach `idle` (`area-selection-name.ts`). */
async function decided(page: Page): Promise<void> {
    await settleFrame(page);
    await settleFrame(page);
}

async function selectArea(page: Page, region: string): Promise<void> {
    const box = await page.getByTestId("map").boundingBox();
    const spot = await spotIn(page, region);
    await page.mouse.click((box?.x ?? 0) + spot.x, (box?.y ?? 0) + spot.y);
    await page.waitForFunction((id) => globalThis.avesmapsAreaSelection?.()?.id === id, region, { timeout: 15_000 });
    await decided(page);
}

/**
 * Wählt die Fläche über die Suche - einer der drei Wege hinein (WI-0043).
 *
 * 🪤 Für den Raschtulswall der einzig verlässliche: In der Topographie liegen Gebirge ineinander, und ein Klick
 * nimmt die KLEINSTE Fläche zuerst (WI-0043 Stufe 2). Die Suche meint den ganzen Zug.
 */
async function selectBySearch(page: Page, name: string, region: string): Promise<void> {
    await page.getByTestId("search-open").click();
    await page.getByTestId("search-input").fill(name);
    await page
        .locator('[data-testid="search-hit"][data-kind="landschaft"]')
        .filter({ has: page.locator(".spotlight__name", { hasText: new RegExp(`^${name}$`) }) })
        .first()
        .click();
    await expect(page.getByTestId("search")).toBeHidden();
    await page.waitForFunction((id) => globalThis.avesmapsAreaSelection?.()?.id === id, region, { timeout: 15_000 });
}

test("🔴 ist der Name im Bild, bleibt er stehen - die Auswahl setzt keinen zweiten daneben", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await openMap(page);
    // „Herz des Kontinents": die Fläche aus dem Befund. Eine derographische Region mit Punktlabel.
    const herz = await sucheFlaeche(page, "Herz des Kontinents", "region");
    await showLandscapes(page, "derographisch");
    await showCamera(page, { point: { x: herz.x, y: herz.y }, zoom: SICHTBAR });
    await decided(page);

    const vorher = await nameSpots(page, herz.region);
    expect(vorher.length, "der gewöhnliche Name steht im Bild").toBeGreaterThan(0);

    await selectArea(page, herz.region);
    // 🔴 Dieselben Namen an denselben Stellen: Die Auswahl hat sie weder genommen noch verschoben.
    expect(await nameSpots(page, herz.region)).toEqual(vorher);
    // 🔴 Und kein zweiter daneben.
    expect(await offsetNames(page), "kein zweiter Name").toBe(0);
});

test("🔴 ein Gebirgsname behält seine Kurve, wenn er gewählt wird (Raschtulswall)", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await openMap(page);
    const wall = await sucheFlaeche(page, "Raschtulswall", "gebirge");
    await showLandscapes(page, "topographie");
    await showCamera(page, { point: { x: wall.x, y: wall.y }, zoom: SICHTBAR });
    await decided(page);

    const aufKurve = (await nameSpots(page, wall.region)).filter((spot) =>
        spot.layer.startsWith("landscape-label-run-"),
    );
    expect(aufKurve.length, "der Name läuft auf seiner Kurve").toBeGreaterThan(0);

    await selectBySearch(page, wall.name, wall.region);
    // Die Suche fliegt hin; für den Vergleich zählt dieselbe Kamera wie vorher.
    await showCamera(page, { point: { x: wall.x, y: wall.y }, zoom: SICHTBAR });
    await decided(page);
    // 💣 Bis WI-0093 verschwand die Kurve, und ein gerader Ersatz stand woanders.
    expect(
        (await nameSpots(page, wall.region)).filter((spot) => spot.layer.startsWith("landscape-label-run-")),
    ).toEqual(aufKurve);
    expect(await offsetNames(page)).toBe(0);
});

test("🔴 zu nah dran: der versetzte Name kommt, wenn der gewöhnliche geht - und geht, wenn er kommt", async ({
    page,
}) => {
    test.setTimeout(300_000);
    await page.setViewportSize({ width: 1280, height: 900 });
    await openMap(page);
    const herz = await sucheFlaeche(page, "Herz des Kontinents", "region");
    await showLandscapes(page, "derographisch");
    await showCamera(page, { point: { x: herz.x, y: herz.y }, zoom: SICHTBAR });
    await decided(page);
    await selectArea(page, herz.region);
    expect(await offsetNames(page), "sichtbar: kein Ersatz").toBe(0);

    // Auf den Namen zufahren und hineinzoomen, bis die Karte ihn nicht mehr zeichnet.
    let zoom = SICHTBAR;
    while ((await nameSpots(page, herz.region)).length > 0 && zoom < 11) {
        zoom += 1;
        await showCamera(page, { point: { x: herz.x, y: herz.y }, zoom });
        await decided(page);
    }
    expect((await nameSpots(page, herz.region)).length, `bei z${String(zoom)} ist der Name weg`).toBe(0);
    // 🔴 Jetzt - und erst jetzt - tritt der versetzte an seine Stelle.
    expect(await offsetNames(page), "der versetzte Name erscheint").toBe(1);

    // Und wieder heraus: Er verschwindet, sobald der gewöhnliche zurück ist.
    await showCamera(page, { point: { x: herz.x, y: herz.y }, zoom: SICHTBAR });
    await decided(page);
    expect((await nameSpots(page, herz.region)).length, "der gewöhnliche Name ist zurück").toBeGreaterThan(0);
    expect(await offsetNames(page), "der versetzte Name geht wieder").toBe(0);
});
